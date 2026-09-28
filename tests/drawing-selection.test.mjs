import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { createDrawing, createBrush, validateDrawing, buildTimeline, rememberDrawingColor } from '../shared/drawing/document.js';
import { createDrawingRenderer } from '../shared/drawing/renderer.js';
import { constrainShapePoint, constrainLinePoint, distortSelection, rotateSelection, selectionCorners, selectionFrameAt, transformSelection } from '../shared/drawing/selection.js';
import { verifyDrawingOriginal } from '../server/drawing-original.js';

const pixel = (canvas, x, y) => [...canvas.getContext('2d').getImageData(x, y, 1, 1).data];
const pixels = (canvas) => Buffer.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data);
function fixture() {
  const doc = createDrawing(4, 3, 'selection-test'); doc.width = 160; doc.height = 120;
  doc.strokes = [{ id: 'shape', layerId: 'layer-1', seed: 1, kind: 'rectangle', mirror: false, brush: { ...createBrush('pen', '#ff0000'), size: 0.05 }, transform: { x: 0, y: 0, scale: 1 }, shape: { strokeEnabled: false, fillEnabled: true, fillColor: '#00ff00', fillAlpha: 1 }, points: [{ x: 20 / 160, y: 20 / 120, p: 1, t: 0 }, { x: 60 / 160, y: 40 / 120, p: 1, t: 1000 }] }];
  return doc;
}
function operation(doc, id, startTime, delta, source = null, copy = false) {
  const rect = { x: 20, y: 20, width: 40, height: 20 };
  const start = { ...(source?.frames.at(-1) || { x: 40 / 160, y: 30 / 120, scaleX: 1, scaleY: 1, angle: 0 }), t: startTime };
  const frame = { ...start, ...delta, t: startTime + 500 };
  const p = { x: 0.25, y: 0.25, p: 1, t: startTime };
  const stroke = { id, layerId: 'layer-1', seed: 0, kind: 'selection', mirror: false, brush: createBrush(), transform: { x: 0, y: 0, scale: 1 }, points: [p, { ...p, t: frame.t }], frames: [start, frame], selection: { rect, sourceId: source?.id || null, copy } };
  doc.strokes.push(stroke); return stroke;
}

test('Shift constraints preserve pressure and time and use actual canvas aspect ratio', () => {
  const doc = fixture(), a = { x: 0.1, y: 0.1, t: 123.5, p: 0.4 }, b = { x: 0.6, y: 0.4, t: 321.75, p: 0.8 };
  const square = constrainShapePoint(a, b, doc);
  assert.ok(Math.abs((square.x - a.x) * doc.width - (square.y - a.y) * doc.height) < 1e-9);
  assert.equal(square.t, b.t); assert.equal(square.p, b.p);
  const first = constrainLinePoint(a, b, doc), next = constrainLinePoint(a, { ...b, x: 0.7, y: 0.25, t: 450 }, doc, first.angle);
  assert.equal(first.angle, next.angle); assert.equal(next.point.t, 450);
  assert.ok(Math.abs((next.point.x - a.x) * doc.width * Math.sin(first.angle) - (next.point.y - a.y) * doc.height * Math.cos(first.angle)) < 1e-9);
});

test('rectangle corners stay square and outline and fill retain independent colors and opacity', () => {
  const doc = fixture(), stroke = doc.strokes[0]; stroke.shape.strokeEnabled = true; stroke.brush.alpha = 0.75; stroke.shape.fillAlpha = 0.25;
  validateDrawing(doc);
  const renderer = createDrawingRenderer(createCanvas), canvas = renderer.render(doc);
  const center = pixel(canvas, 40, 30), edge = pixel(canvas, 40, 18), corner = pixel(canvas, 18, 18);
  assert.deepEqual(center.slice(0, 3), [0, 255, 0]); assert.ok(center[3] >= 63 && center[3] <= 64);
  assert.deepEqual(edge.slice(0, 3), [255, 0, 0]); assert.ok(edge[3] >= 190 && edge[3] <= 192);
  assert.ok(corner[3] >= 190);
  assert.deepEqual(rememberDrawingColor([], stroke), ['#ff0000', '#00ff00']);
  stroke.brush.alpha = 0; validateDrawing(doc); assert.deepEqual(rememberDrawingColor([], stroke), ['#00ff00']);
});

test('vertical and four-way mirrors reproduce the same pixels, including separate shape styles', () => {
  for (const mirror of [false, true]) {
    const doc = fixture(); doc.strokes[0].mirrorY = true; doc.strokes[0].mirror = mirror;
    const canvas = createDrawingRenderer(createCanvas).render(doc), data = pixels(canvas);
    for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
      const at = (px, py) => data[(py * doc.width + px) * 4 + 3];
      assert.equal(at(x, y), at(x, doc.height - 1 - y));
      if (mirror) assert.equal(at(x, y), at(doc.width - 1 - x, y));
    }
  }
});

test('pixel selection moves and Alt copies preserve originals and replay each gesture without idle time', () => {
  const doc = fixture(), renderer = createDrawingRenderer(createCanvas);
  const move = operation(doc, 'move', 6000, { x: 0.5 });
  validateDrawing(doc);
  assert.equal(pixel(renderer.render(doc, 1250, 60), 60, 30)[3], 255);
  assert.equal(pixel(renderer.render(doc), 30, 30)[3], 0); assert.equal(pixel(renderer.render(doc), 80, 30)[3], 255);
  const copy = operation(doc, 'copy', 30000, { x: 0.75 }, move, true);
  operation(doc, 'move-copy', 45000, { y: 0.7 }, copy);
  validateDrawing(doc); assert.equal(buildTimeline(doc, 60).sourceDurationMs, 2500);
  const expected = pixels(renderer.render(doc));
  assert.equal(pixel(renderer.render(doc), 80, 30)[3], 255);
  assert.equal(pixel(renderer.render(doc), 120, 30)[3], 0);
  assert.equal(pixel(renderer.render(doc), 120, 84)[3], 255);
  for (const t of [150, 1250, 1650, 2000, 2450, 100, 2250]) renderer.render(doc, t, 60);
  assert.deepEqual(pixels(renderer.render(doc)), expected);
  assert.deepEqual(pixels(createDrawingRenderer(createCanvas).render(doc)), expected);
});

test('rotation and edge resize keep the opposite edge anchored with interpolated transform frames', () => {
  const doc = fixture(), rect = { x: 20, y: 20, width: 40, height: 20 }, frame = { x: 0.25, y: 0.25, scaleX: 1, scaleY: 1, angle: 0, t: 0 };
  const next = transformSelection(frame, rect, 'e', { x: 0.375, y: 0.25 }, { x: 0.5, y: 0.25 }, doc);
  assert.equal(next.scaleX, 1.5); assert.equal(next.x * 160 - rect.width * next.scaleX / 2, 20);
  const half = selectionFrameAt([frame, { ...next, angle: 90, t: 1000 }], 250);
  assert.equal(half.angle, 22.5); assert.equal(half.scaleX, 1.125);
  const rotation = operation(doc, 'rotate', 10000, { angle: 90, scaleX: 1.5 }); validateDrawing(doc);
  const renderer = createDrawingRenderer(createCanvas), final = pixels(renderer.render(doc));
  renderer.render(doc, 1250); assert.deepEqual(pixels(renderer.render(doc)), final);
  assert.notDeepEqual(pixels(renderer.render(doc, 1100)), final);
  assert.equal(rotation.frames.at(-1).angle, 90);
});

test('rotation records multiple turns and reversals at their actual sample times and replays identical pixels', async () => {
  const doc = fixture(), op = operation(doc, 'rotate', 10000, {}), base = op.frames[0];
  let rotation = { last: -Math.PI / 2, total: 0 };
  op.frames = [base];
  const turns = [0, 45, 100, 170, 190, 270, 350, 370, 460, 540, 630, 710, 720, 675, 620];
  turns.forEach((angle, i) => {
    const radians = (angle - 90) * Math.PI / 180;
    const p = { x: base.x + Math.cos(radians) * 50 / doc.width, y: base.y + Math.sin(radians) * 50 / doc.height, p: 1, t: 10000 + i * i * 10 };
    const next = rotateSelection(base, rotation, p, doc);
    rotation = next.rotation;
    assert.ok(Math.abs(next.frame.angle - angle) < 1e-9);
    assert.equal(next.frame.t, p.t);
    op.frames.push(next.frame);
  });
  op.points[1].t = op.frames.at(-1).t;
  const saved = JSON.parse(JSON.stringify(doc)); validateDrawing(saved);
  assert.equal(buildTimeline(saved, 60).sourceDurationMs, 1000 + turns.indexOf(620) ** 2 * 10);
  const renderer = createDrawingRenderer(createCanvas);
  for (let i = 1; i < op.frames.length; i++) {
    const frame = op.frames[i], live = JSON.parse(JSON.stringify(saved)), active = live.strokes.at(-1);
    active.frames = active.frames.slice(0, i + 1); active.points[1].t = frame.t;
    assert.deepEqual(pixels(renderer.render(saved, 1000 + frame.t - 10000, 60)), pixels(createDrawingRenderer(createCanvas).render(live)));
  }
  const final = pixels(renderer.render(saved));
  assert.deepEqual(pixels(renderer.render(saved, buildTimeline(saved, 60).targetReplayMs, 60)), final);
  const result = await verifyDrawingOriginal(saved, renderer.render(saved).toBuffer('image/png'));
  assert.equal(result.ok, true);
});

test('Shift rotation snapping retains the unsnapped motion for the next sample', () => {
  const doc = fixture(), base = { x: 0.25, y: 0.25, scaleX: 1, scaleY: 1, angle: 350, t: 0 };
  const p = (degrees, t) => ({ x: base.x + Math.cos(degrees * Math.PI / 180) * 30 / doc.width, y: base.y + Math.sin(degrees * Math.PI / 180) * 30 / doc.height, p: 1, t });
  const snapped = rotateSelection(base, { last: 0, total: 350 }, p(12, 100), doc, true);
  assert.equal(snapped.frame.angle, 360);
  const free = rotateSelection(base, snapped.rotation, p(24, 250), doc);
  assert.ok(Math.abs(free.frame.angle - 374) < 1e-9); assert.equal(free.frame.t, 250);
});

test('Shift resize expands and shrinks all edges around a fixed center, including rotated selections', () => {
  const doc = fixture(), rect = { x: 20, y: 20, width: 40, height: 20 };
  for (const angle of [0, 37, 90]) for (const handle of ['n', 'e', 's', 'w', 'nw', 'ne', 'se', 'sw']) for (const factor of [0.6, 1.5]) {
    const start = { x: 0.5, y: 0.5, scaleX: 1.2, scaleY: 0.8, angle, t: 0 }, radians = angle * Math.PI / 180;
    const hx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0, hy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
    const lx = hx * rect.width * start.scaleX * (factor - 1) / 2, ly = hy * rect.height * start.scaleY * (factor - 1) / 2;
    const next = transformSelection(start, rect, handle, { x: 0, y: 0 }, { x: (lx * Math.cos(radians) - ly * Math.sin(radians)) / doc.width, y: (lx * Math.sin(radians) + ly * Math.cos(radians)) / doc.height }, doc, true, true);
    assert.equal(next.x, start.x); assert.equal(next.y, start.y); assert.equal(next.angle, start.angle);
    assert.ok(Math.abs(next.scaleX - start.scaleX * factor) < 1e-9);
    assert.ok(Math.abs(next.scaleY - start.scaleY * factor) < 1e-9);
    const corners = selectionCorners(next, rect, doc);
    assert.ok(Math.abs((corners[0].x + corners[2].x) / 2 - start.x * doc.width) < 1e-9);
    assert.ok(Math.abs((corners[0].y + corners[2].y) / 2 - start.y * doc.height) < 1e-9);
  }
  const op = operation(doc, 'centered-resize', 15000, {});
  const start = op.frames[0];
  const expanded = transformSelection(start, rect, 'e', { x: 0, y: 0 }, { x: 0.05, y: 0 }, doc, true, true);
  op.frames = [start, { ...expanded, t: 15200 }, { ...start, scaleX: 0.5, scaleY: 0.5, t: 15500 }];
  validateDrawing(doc);
  const half = selectionFrameAt(op.frames, 15100); assert.equal(half.x, start.x); assert.equal(half.y, start.y); assert.equal(half.scaleX, 1.2);
  const renderer = createDrawingRenderer(createCanvas), final = pixels(renderer.render(doc));
  assert.notDeepEqual(pixels(renderer.render(doc, 1200, 60)), final);
  assert.deepEqual(pixels(renderer.render(doc, 1500, 60)), final);
});

test('Ctrl top-corner distortion fixes the lower corners and records independent corner timing', async () => {
  const doc = fixture(), op = operation(doc, 'distort', 10000, {}), start = op.frames[0], rect = op.selection.rect;
  const skew = distortSelection(start, rect, [0, 1], { x: 0, y: 0 }, { x: 0.1, y: 0 }, doc);
  const originalCorners = selectionCorners(start, rect, doc), corners = selectionCorners(skew, rect, doc);
  assert.deepEqual(corners.slice(2), originalCorners.slice(2)); assert.equal(corners[0].x - originalCorners[0].x, 16);
  const perspective = distortSelection(skew, rect, [1], { x: 0, y: 0 }, { x: 0.05, y: 0.02 }, doc);
  op.frames = [start, { ...skew, t: 10200 }, { ...perspective, t: 10500 }]; validateDrawing(doc);
  const half = selectionFrameAt(op.frames, 10100); assert.equal(half.quad[0], -0.3);
  const renderer = createDrawingRenderer(createCanvas), final = pixels(renderer.render(doc));
  renderer.render(doc, 1100); renderer.render(doc, 1400); assert.deepEqual(pixels(renderer.render(doc)), final);
  assert.deepEqual(pixels(createDrawingRenderer(createCanvas).render(doc)), final);
  assert.ok(final.some((n, i) => i % 4 === 3 && n > 100));
  const result = await verifyDrawingOriginal(doc, renderer.render(doc).toBuffer('image/png')); assert.equal(result.ok, true);
});

test('invalid selection references and crossing corners fail without silently altering input', () => {
  const doc = fixture(), op = operation(doc, 'bad', 10000, {});
  op.selection.sourceId = 'missing'; assert.throws(() => validateDrawing(doc), /drawing_invalid_selection/);
  op.selection.sourceId = null; op.frames[1].quad = [-0.5, -0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5];
  assert.throws(() => validateDrawing(doc), /drawing_invalid_selection/);
  delete op.frames[1].quad; op.frames[0].x = 0.3; assert.throws(() => validateDrawing(doc), /drawing_invalid_selection/);
});
