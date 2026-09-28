import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { createBrush, createDrawing, BRUSHES, canonicalDrawing, validateDrawing, drawingCost, buildTimeline, pointsAtTime, rememberDrawingColor } from '../shared/drawing/document.js';
import { createDrawingRenderer, floodFillRuns, strokeBounds } from '../shared/drawing/renderer.js';
import { validateDrawingSubmission, verifyDrawingOriginal } from '../server/drawing-original.js';
import { MAX_DOCUMENT_BYTES, MAX_ORIGINAL_BYTES, RECORDING_HEADROOM_BYTES, drawingJsonBytes, drawingUsage, updateDrawingUsage, drawingLimitError } from '../shared/drawing/limits.js';
import { DEFAULT_QUAD } from '../shared/drawing/selection.js';

function fixture(type = 'pen') {
  const doc = createDrawing(16, 9, 'fixture'); doc.width = 640; doc.height = 360;
  doc.strokes = [{ id: 's1', layerId: 'layer-1', seed: 271828, kind: 'freehand', mirror: false, brush: { ...createBrush(type, '#db4467'), size: 0.065 }, transform: { x: 0, y: 0, scale: 1 }, points: Array.from({ length: 80 }, (_, i) => ({ x: 0.1 + i / 79 * 0.8, y: 0.5 + Math.sin(i / 79 * Math.PI * 3) * 0.12, p: 0.1 + Math.sin(i / 79 * Math.PI) * 0.85, t: i * 37.25 })) }];
  return doc;
}
const pixels = (canvas) => Buffer.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data);
const digest = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

test('recent colors follow actual drawing use, deduplicate and ignore erasers or selection-only actions', () => {
  const stroke = fixture().strokes[0];
  let colors = rememberDrawingColor([], stroke);
  assert.deepEqual(colors, ['#db4467']);
  assert.equal(rememberDrawingColor(colors), colors);
  assert.equal(rememberDrawingColor(colors, { ...stroke, brush: createBrush('eraser', '#00ff00') }), colors);
  assert.equal(rememberDrawingColor(colors, { ...stroke, points: [] }), colors);
  colors = rememberDrawingColor(colors, { ...stroke, brush: createBrush('pen', '#00ff00') });
  assert.deepEqual(colors, ['#00ff00', '#db4467']);
  colors = rememberDrawingColor(colors, stroke);
  assert.deepEqual(colors, ['#db4467', '#00ff00']);
});

test('all brushes start at 100% opacity and preserve settings and every sample', () => {
  for (const type of Object.keys(BRUSHES)) {
    const doc = fixture(type), before = canonicalDrawing(doc);
    assert.equal(createBrush(type).alpha, 1); validateDrawing(doc);
    assert.equal(canonicalDrawing(doc), before);
    assert.deepEqual(JSON.parse(before), doc);
  }
});

test('rejects unsupported brushes, dropped timestamps, invalid fields and silent clamping', () => {
  for (const edit of [d => d.strokes[0].brush.type = 'future', d => d.strokes[0].points[1].x = -0.01, d => d.strokes[0].points[1].t = -1, d => d.strokes[0].brush.alpha = -0.01, d => d.strokes[0].script = 'no', d => d.rendererVersion = '99']) {
    const doc = fixture(); edit(doc); assert.throws(() => validateDrawing(doc));
  }
});

test('preserves pressure zero and submillisecond timing without server compaction', () => {
  const doc = fixture('brush'); doc.strokes[0].points[0].p = 0;
  const hash = digest(canonicalDrawing(doc)), copy = structuredClone(doc);
  const accepted = validateDrawingSubmission({ document: doc, documentHash: hash }, { maxStrokes: 120, maxPoints: 6000, replayMaxSec: 12, canvas: { widthRatio: 16, heightRatio: 9 } });
  assert.deepEqual(accepted.document, copy); assert.equal(accepted.pointCount, 80);
});

test('detailed transform recordings fit the advertised default point budget without losing samples', () => {
  const doc = fixture(), rect = { x: 80, y: 80, width: 240, height: 160 };
  const base = { x: 200 / doc.width, y: 160 / doc.height, scaleX: 1, scaleY: 1, angle: 0, t: 10000 };
  const frames = Array.from({ length: 5800 }, (_, i) => i === 0 ? base : {
    x: base.x + Math.sin(i) * 0.01, y: base.y + Math.cos(i) * 0.01,
    scaleX: 1 + Math.sin(i) * 0.1, scaleY: 1 + Math.cos(i) * 0.1,
    angle: i * 0.123456789012345, t: 10000 + i * 0.23456789012345,
    quad: DEFAULT_QUAD.map((n, index) => n + (index % 2 ? Math.sin(i) : Math.cos(i)) * 0.031415926535898),
  });
  doc.strokes.push({ id: 'warp', layerId: 'layer-1', kind: 'selection', seed: 0, mirror: false, brush: createBrush(), transform: { x: 0, y: 0, scale: 1 }, selection: { rect, sourceId: null, copy: false }, frames, points: [{ x: 0.5, y: 0.5, p: 1, t: base.t }, { x: 0.5, y: 0.5, p: 1, t: frames.at(-1).t }] });
  const before = canonicalDrawing(doc), usage = drawingUsage(doc);
  assert.ok(usage.pointCount < 6000); assert.ok(usage.jsonSize > 1024 * 1024);
  assert.ok(usage.jsonSize < MAX_DOCUMENT_BYTES - RECORDING_HEADROOM_BYTES);
  assert.equal(usage.jsonSize, Buffer.byteLength(before));
  assert.equal(drawingLimitError(usage), null);
  const accepted = validateDrawingSubmission({ document: doc, documentHash: digest(before) }, { maxPoints: 6000, replayMaxSec: 12, canvas: { widthRatio: 16, heightRatio: 9 } });
  assert.equal(accepted.jsonSize, usage.jsonSize); assert.equal(accepted.pointCount, usage.pointCount);
  assert.equal(canonicalDrawing(accepted.document), before);
});

test('incremental byte accounting matches complete UTF-8 serialization for points, frames and fill masks', () => {
  const doc = createDrawing(4, 3, 'bytes'), stroke = { ...fixture().strokes[0], points: [{ x: 1 / 3, y: 1 / 7, p: 0.123456789, t: 1000.5 }] };
  let usage = updateDrawingUsage(drawingUsage(doc), undefined, stroke); doc.strokes.push(stroke);
  assert.deepEqual(usage, drawingUsage(doc));
  for (let i = 1; i <= 40; i++) {
    const point = { x: i / 43, y: i / 47, p: i / 53, t: 1000.5 + i / 7 };
    const next = { ...doc.strokes[0], points: [...doc.strokes[0].points, point] };
    usage = updateDrawingUsage(usage, doc.strokes[0], next, drawingJsonBytes(point) + 1); doc.strokes[0] = next;
    assert.deepEqual(usage, drawingUsage(doc));
  }
  const fill = { ...stroke, id: 'fill', kind: 'fill', runs: [0, 0, 10, 1, 0, 10] };
  usage = updateDrawingUsage(usage, undefined, fill); doc.strokes.push(fill);
  assert.deepEqual(usage, drawingUsage(doc)); assert.equal(usage.fillRuns, 2);
  assert.equal(drawingJsonBytes(doc), Buffer.byteLength(canonicalDrawing(doc)));
  for (const [field, value, error] of [['jsonSize', MAX_DOCUMENT_BYTES + 1, 'drawing_too_large'], ['pointCount', 6001, 'too_many_points'], ['strokeCount', 121, 'too_many_strokes'], ['fillRuns', 40001, 'drawing_fill_too_complex'], ['selectionPixels', 67108865, 'drawing_too_complex']]) {
    assert.equal(drawingLimitError({ ...usage, [field]: value }), error);
  }
  assert.equal(drawingLimitError({ ...usage, jsonSize: MAX_DOCUMENT_BYTES }, {}, RECORDING_HEADROOM_BYTES), 'drawing_too_large');
  assert.equal(drawingLimitError({ ...usage, jsonSize: MAX_DOCUMENT_BYTES - RECORDING_HEADROOM_BYTES }, {}, RECORDING_HEADROOM_BYTES), null);
  assert.ok(MAX_ORIGINAL_BYTES > 1920 * 1920 * 4);
});

test('interpolates drawing time and removes all pen-up gaps without changing speed ratios', () => {
  const doc = fixture(); doc.strokes[0].points = [{ x: 0, y: 0.2, p: 0.4, t: 0 }, { x: 0.5, y: 0.2, p: 0.8, t: 1000 }, { x: 1, y: 0.2, p: 0.4, t: 4000 }];
  const timeline = buildTimeline(doc, 2); assert.equal(timeline.speed, 2);
  assert.equal(pointsAtTime(doc.strokes[0].points, 500).at(-1).x, 0.25);
  assert.equal(pointsAtTime(doc.strokes[0].points, 2500).at(-1).x, 0.75);
  doc.strokes.push({ ...doc.strokes[0], id: 's2', points: [{ x: 0, y: 0.5, p: 1, t: 10000 }, { x: 1, y: 0.5, p: 1, t: 11000 }] });
  assert.equal(buildTimeline(doc, 60).sourceDurationMs, 5000);
  assert.equal(buildTimeline(doc, 60).entries[1].start, 4000);
  assert.equal(buildTimeline(doc, 60).entries[1].offset, 6000);
  doc.replayMode = 'original'; assert.equal(buildTimeline(doc, 60).sourceDurationMs, 5000);
  doc.replayMode = 'trim-gaps'; assert.equal(buildTimeline(doc, 60).sourceDurationMs, 5000);
  assert.equal(buildTimeline(doc, 2).speed, 2.5);
  doc.strokes = [{ ...doc.strokes[0], points: [{ x: 0, y: 0.2, p: 1, t: 30000 }, { x: 1, y: 0.2, p: 1, t: 30400 }] }];
  assert.equal(buildTimeline(doc, 12).targetReplayMs, 400);
  assert.equal(buildTimeline(doc, 12).entries[0].start, 0);
});

test('all materials remain identical after progressive replay, seek and final hold', () => {
  const hashes = new Set();
  for (const type of Object.keys(BRUSHES).filter((type) => type !== 'eraser')) {
    const doc = fixture(type), renderer = createDrawingRenderer(createCanvas);
    const reference = pixels(renderer.render(doc)); hashes.add(digest(reference));
    for (const time of [0, 100, 420, 800, 2300, 100, 2800]) renderer.render(doc, time);
    assert.deepEqual(pixels(renderer.render(doc)), reference, type);
    assert.deepEqual(pixels(createDrawingRenderer(createCanvas).render(doc)), reference, `${type} new instance`);
    assert.ok(reference.some((value, i) => i % 4 === 3 && value > 50), type);
  }
  assert.equal(hashes.size, 8);
});

test('layer changes, erasing and undo invalidate the right cached pixels', () => {
  const doc = fixture(), renderer = createDrawingRenderer(createCanvas), original = pixels(renderer.render(doc));
  const eraser = { ...structuredClone(doc.strokes[0]), id: 'erase', brush: { ...createBrush('eraser'), size: 0.15 }, points: doc.strokes[0].points.map((p) => ({ ...p, t: p.t + 5000 })) };
  const erased = { ...doc, strokes: [...doc.strokes, eraser] };
  assert.notDeepEqual(pixels(renderer.render(erased)), original);
  assert.deepEqual(pixels(renderer.render(doc)), original);
  assert.ok(pixels(renderer.render({ ...doc, layers: [{ ...doc.layers[0], visible: false }] })).every((n) => n === 0));
});

test('marker survives reversals, mirrored paths are symmetric, fill is bounded', () => {
  const doc = fixture('marker'); doc.strokes[0].points.reverse(); doc.strokes[0].points.forEach((p, i) => p.t = i * 30);
  const canvas = createDrawingRenderer(createCanvas).render(doc); assert.ok(pixels(canvas).some((n) => n));
  const mirrored = fixture('crayon'); mirrored.strokes[0].mirror = true;
  mirrored.strokes[0].points = mirrored.strokes[0].points.map((p) => ({ ...p, x: p.x / 3 }));
  const data = pixels(createDrawingRenderer(createCanvas).render(mirrored));
  for (let y = 0; y < mirrored.height; y++) for (let x = 0; x < mirrored.width / 2; x++) {
    assert.equal(data[(y * mirrored.width + x) * 4 + 3], data[(y * mirrored.width + mirrored.width - 1 - x) * 4 + 3]);
  }
  const bounds = strokeBounds(mirrored.strokes[0], mirrored);
  assert.ok(bounds.x < mirrored.width / 3 && bounds.x + bounds.width > mirrored.width * 2 / 3);
  const box = createCanvas(80, 80), ctx = box.getContext('2d'); ctx.strokeStyle = '#000'; ctx.lineWidth = 4; ctx.strokeRect(10, 10, 60, 60);
  const runs = floodFillRuns(ctx.getImageData(0, 0, 80, 80), 30, 30);
  assert.ok(runs.length > 0); for (let i = 0; i < runs.length; i += 3) assert.ok(runs[i] > 10 && runs[i] < 70 && runs[i + 1] > 10 && runs[i + 1] + runs[i + 2] < 70);
});

test('shape, fill and transformed strokes retain exact pixels through timed replay', () => {
  for (const kind of ['line', 'rectangle', 'ellipse', 'star', 'heart', 'fill']) {
    const doc = fixture('pen'), stroke = doc.strokes[0];
    stroke.kind = kind; stroke.points = [{ x: 0.2, y: 0.2, p: 1, t: 1000 }, { x: 0.6, y: 0.7, p: 1, t: 3000 }];
    stroke.transform = { x: 0.05, y: 0.02, scale: 1.1 };
    if (kind === 'fill') { stroke.points = [stroke.points[0]]; stroke.runs = [20, 20, 100, 21, 20, 100]; }
    validateDrawing(doc);
    const renderer = createDrawingRenderer(createCanvas), expected = pixels(renderer.render(doc));
    renderer.render(doc, 500); renderer.render(doc, 1200);
    assert.deepEqual(pixels(renderer.render(doc)), expected, kind);
    assert.ok(expected.some((value) => value), kind);
  }
});

test('documents cover supported streamer aspect ratios and keep hidden work out of playback time', () => {
  for (const ratio of [[32, 1], [1, 32], [16, 9], [1, 1]]) validateDrawing(createDrawing(...ratio, 'ratio'));
  const doc = fixture(); doc.layers.push({ id: 'hidden', name: 'hidden', visible: false, locked: false });
  doc.strokes.push({ ...structuredClone(doc.strokes[0]), id: 'hidden-stroke', layerId: 'hidden', points: doc.strokes[0].points.map((p) => ({ ...p, t: p.t + 600000 })) });
  assert.equal(buildTimeline(doc).sourceDurationMs, doc.strokes[0].points.at(-1).t);
});

test('pricing is independent of playback speed and hidden layers are excluded', () => {
  const doc = fixture(), settings = { pricingMode: 'ink', inkCostPerUnit: 2 };
  const price = drawingCost(doc, settings); doc.replayMode = 'trim-gaps'; assert.equal(drawingCost(doc, settings), price);
  doc.layers[0].visible = false; assert.equal(drawingCost(doc, settings), 0);
});

test('isolated verification accepts the original PNG and rejects altered artwork', async () => {
  const doc = fixture('crayon'), renderer = createDrawingRenderer(createCanvas), canvas = renderer.render(doc);
  const result = await verifyDrawingOriginal(doc, canvas.toBuffer('image/png')); assert.equal(result.ok, true); assert.equal(result.comparison.different, 0);
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, 100, 100);
  await assert.rejects(verifyDrawingOriginal(doc, canvas.toBuffer('image/png')), /drawing_original_mismatch/);
});
