import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { createCanvas } from '@napi-rs/canvas';
import { createBrush, createDrawing, BRUSHES, canonicalDrawing, validateDrawing, drawingCost, buildTimeline, pointsAtTime, rememberDrawingColor } from '../shared/drawing/document.js';
import { createDrawingRenderer, floodFillRuns, strokeBounds } from '../shared/drawing/renderer.js';
import { validateDrawingSubmission, verifyDrawingOriginal } from '../server/drawing-original.js';
import { MAX_DOCUMENT_BYTES, MAX_ORIGINAL_BYTES, RECORDING_HEADROOM_BYTES, drawingJsonBytes, drawingUsage, updateDrawingUsage, drawingLimitError } from '../shared/drawing/limits.js';
import { DEFAULT_QUAD } from '../shared/drawing/selection.js';
import { optimizeDrawingOriginal } from '../server/drawing-original-storage.js';

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

test('outlines round-trip without changing samples and legacy drawings retain their original rendering', () => {
  const doc = fixture(), legacy = { ...doc, rendererVersion: '2.0.0' };
  validateDrawing(legacy);
  assert.deepEqual(pixels(createDrawingRenderer(createCanvas).render(legacy)), pixels(createDrawingRenderer(createCanvas).render(doc)));
  doc.strokes[0].outline = { size: 0.012, color: '#123456', alpha: 0.37 };
  const original = canonicalDrawing(doc); validateDrawing(doc);
  assert.equal(canonicalDrawing(doc), original); assert.deepEqual(JSON.parse(original), doc);
  for (const edit of [d => d.strokes[0].outline.size = 0, d => d.strokes[0].outline.size = 0.11, d => d.strokes[0].outline.alpha = -1, d => d.strokes[0].outline.color = 'red', d => d.strokes[0].outline.blur = 10, d => d.strokes[0].kind = 'fill', d => d.strokes[0].brush.type = 'eraser', d => d.rendererVersion = '2.0.0']) {
    const changed = structuredClone(doc); edit(changed); assert.throws(() => validateDrawing(changed));
  }
});

test('line outline width, colour and alpha are independent and never tint the translucent body', () => {
  const doc = fixture(), stroke = doc.strokes[0], renderer = createDrawingRenderer(createCanvas);
  stroke.kind = 'line'; stroke.brush = { ...createBrush('pen', '#ff0000', 0.25), size: 0.05 };
  stroke.points = [{ x: 0.2, y: 0.5, p: 1, t: 0 }, { x: 0.8, y: 0.5, p: 1, t: 1000 }];
  const plain = pixels(renderer.render(doc));
  stroke.outline = { size: 0.025, color: '#0000ff', alpha: 0.5 };
  const at = (data, x, y) => Array.from(data.subarray((y * doc.width + x) * 4, (y * doc.width + x) * 4 + 4));
  const outlined = pixels(renderer.render(doc));
  assert.deepEqual(at(outlined, 320, 180), at(plain, 320, 180));
  assert.deepEqual(at(outlined, 320, 165), [0, 0, 255, 128]);
  assert.deepEqual(at(outlined, 320, 159), [0, 0, 0, 0]);
  stroke.outline.size = 0.01; assert.deepEqual(at(pixels(renderer.render(doc)), 320, 165), [0, 0, 0, 0]);
  stroke.outline.alpha = 0; assert.deepEqual(pixels(renderer.render(doc)), plain);
  stroke.outline = { size: 0.025, color: '#00ff00', alpha: 1 }; stroke.brush.alpha = 0;
  const onlyOutline = pixels(renderer.render(doc));
  assert.deepEqual(at(onlyOutline, 320, 165), [0, 255, 0, 255]); assert.equal(at(onlyOutline, 320, 180)[3], 0);
});

test('shape outlines remain outside the shape while stroke and fill keep separate transparency', () => {
  const doc = fixture(), stroke = doc.strokes[0], renderer = createDrawingRenderer(createCanvas);
  stroke.kind = 'rectangle'; stroke.brush = { ...createBrush('pen', '#ff0000', 0.25), size: 0.02 };
  stroke.shape = { fillEnabled: true, fillColor: '#00ff00', fillAlpha: 0.3, strokeEnabled: true };
  stroke.points = [{ x: 0.2, y: 0.2, p: 1, t: 0 }, { x: 0.8, y: 0.8, p: 1, t: 1000 }];
  const at = (data, x, y) => Array.from(data.subarray((y * doc.width + x) * 4, (y * doc.width + x) * 4 + 4));
  const plain = pixels(renderer.render(doc)); stroke.outline = { size: 0.02, color: '#0000ff', alpha: 0.5 };
  const outlined = pixels(renderer.render(doc));
  assert.deepEqual(at(outlined, 320, 180), at(plain, 320, 180));
  assert.deepEqual(at(outlined, 128, 180), at(plain, 128, 180));
  assert.deepEqual(at(outlined, 320, 64), [0, 0, 255, 128]);
  stroke.shape.fillEnabled = false;
  assert.deepEqual(at(pixels(renderer.render(doc)), 320, 78), [0, 0, 0, 0]);
  stroke.shape.strokeEnabled = false;
  const onlyOutline = pixels(renderer.render(doc));
  assert.deepEqual(at(onlyOutline, 320, 68), [0, 0, 255, 128]); assert.equal(at(onlyOutline, 320, 180)[3], 0);
});

test('all outlined brush and shape paths replay identically, including symmetry and transforms', () => {
  const entries = [...Object.keys(BRUSHES).filter((type) => type !== 'eraser').map((type) => [type, 'freehand']), ...['line', 'rectangle', 'ellipse', 'star', 'heart'].map((kind) => ['pen', kind])];
  for (const [type, kind] of entries) {
    const doc = fixture(type), stroke = doc.strokes[0];
    stroke.kind = kind; stroke.outline = { size: 0.018, color: '#18306f', alpha: 0.63 }; stroke.brush.alpha = 0.45;
    stroke.mirror = true; stroke.mirrorY = true; stroke.transform = { x: 0.02, y: 0.01, scale: 0.6 };
    if (!['freehand', 'line'].includes(kind)) stroke.shape = { fillEnabled: true, fillColor: '#4fbc70', fillAlpha: 0.3, strokeEnabled: true };
    validateDrawing(doc);
    const renderer = createDrawingRenderer(createCanvas), expected = pixels(renderer.render(doc));
    for (const time of [300, 1400, 900]) {
      assert.deepEqual(pixels(renderer.render(doc, time)), pixels(createDrawingRenderer(createCanvas).render(doc, time)), `${type}/${kind} at ${time}`);
    }
    assert.deepEqual(pixels(renderer.render(JSON.parse(canonicalDrawing(doc)))), expected, `${type}/${kind} saved replay`);
    const without = structuredClone(doc); delete without.strokes[0].outline;
    assert.notDeepEqual(expected, pixels(createDrawingRenderer(createCanvas).render(without)), `${type}/${kind} visible outline`);
    assert.ok(strokeBounds(stroke, doc).width > strokeBounds(without.strokes[0], doc).width);
  }
});

test('only used outline colours enter recent colours and visible outlines count towards ink pricing', () => {
  const doc = fixture(), stroke = doc.strokes[0], settings = { pricingMode: 'ink', inkCostPerUnit: 2 };
  const price = drawingCost(doc, settings);
  stroke.outline = { size: 0.02, color: '#AABBCC', alpha: 0.8 };
  assert.deepEqual(rememberDrawingColor([], stroke), ['#db4467', '#aabbcc']);
  assert.ok(drawingCost(doc, settings) > price);
  stroke.outline.alpha = 0; assert.deepEqual(rememberDrawingColor([], stroke), ['#db4467']); assert.equal(drawingCost(doc, settings), price);
  stroke.brush.alpha = 0; stroke.outline.alpha = 0.8;
  assert.deepEqual(rememberDrawingColor([], stroke), ['#aabbcc']); assert.ok(drawingCost(doc, settings) > 2);
});

test('outlined submissions pass isolated verification and retain their alpha in WebP', async () => {
  const doc = fixture('marker'); doc.strokes[0].outline = { size: 0.012, color: '#08284e', alpha: 0.42 };
  const png = createDrawingRenderer(createCanvas).render(doc).toBuffer('image/png');
  const result = await verifyDrawingOriginal(doc, png);
  assert.equal(result.ok, true); assert.equal(result.comparison.different, 0);
  assert.deepEqual(await sharp(Buffer.from(result.storage.buffer)).ensureAlpha().extractChannel('alpha').raw().toBuffer(), await sharp(png).ensureAlpha().extractChannel('alpha').raw().toBuffer());
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
  const png = canvas.toBuffer('image/png');
  const result = await verifyDrawingOriginal(doc, png); assert.equal(result.ok, true); assert.equal(result.comparison.different, 0);
  const stored = Buffer.from(result.storage.buffer);
  assert.equal(result.storage.original.sourceHash, digest(png)); assert.equal(result.storage.original.hash, digest(stored));
  assert.equal(result.storage.original.format, 'webp'); assert.equal(result.storage.original.lossless, false);
  assert.ok(stored.length <= png.length);
  assert.deepEqual(await sharp(stored).ensureAlpha().extractChannel('alpha').raw().toBuffer(), await sharp(png).ensureAlpha().extractChannel('alpha').raw().toBuffer());
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, 100, 100);
  await assert.rejects(verifyDrawingOriginal(doc, canvas.toBuffer('image/png')), /drawing_original_mismatch/);
});

test('lossy WebP compresses colour while retaining every transparency value and pixel dimension', async () => {
  const width = 256, height = 128, rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    rgba[i] = x; rgba[i + 1] = y * 2; rgba[i + 2] = (x + y) % 256;
    rgba[i + 3] = [0, 1, 16, 64, 128, 254, 255][x % 7];
  }
  const png = await sharp(rgba, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 0 }).toBuffer();
  const storage = await optimizeDrawingOriginal(png);
  assert.equal(storage.original.format, 'webp'); assert.equal(storage.original.lossless, false); assert.equal(storage.original.alphaLossless, true);
  assert.equal(storage.original.quality, 60); assert.equal(storage.original.alphaQuality, 100);
  assert.equal(storage.original.contentType, 'image/webp'); assert.ok(storage.buffer.length < png.length);
  assert.equal(storage.original.sourceHash, digest(png)); assert.equal(storage.original.hash, digest(storage.buffer));
  assert.equal(storage.original.sourceByteLength, png.length); assert.equal(storage.original.byteLength, storage.buffer.length);
  const after = await sharp(storage.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(after.info.width, width); assert.equal(after.info.height, height);
  assert.notDeepEqual(after.data, rgba);
  for (let i = 3; i < rgba.length; i += 4) assert.equal(after.data[i], rgba[i]);
});

test('compression budget exhaustion fails safely without saving a PNG fallback', async () => {
  const png = createDrawingRenderer(createCanvas).render(fixture()).toBuffer('image/png');
  await assert.rejects(optimizeDrawingOriginal(png, Date.now() - 1), { message: 'drawing_compression_failed', status: 503 });
});

test('maximum-size textured PNG compresses to WebP and retains every alpha value', async () => {
  const width = 1920, height = 1920, rgba = Buffer.alloc(width * height * 4);
  let seed = 1234;
  for (let i = 0; i < rgba.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; rgba[i] = seed >>> 24; }
  const png = await sharp(rgba, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 0 }).toBuffer();
  const result = await optimizeDrawingOriginal(png);
  assert.equal(result.original.format, 'webp'); assert.ok(result.buffer.length < png.length);
  assert.ok([4, 2].includes(result.original.effort));
  const after = await sharp(result.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(after.info.width, width); assert.equal(after.info.height, height);
  assert.equal(after.info.channels, 4);
  for (let i = 3; i < rgba.length; i += 4) assert.equal(after.data[i], rgba[i]);
});

test('colour profiles are preserved and non-PNG input is not silently converted', async () => {
  const png = await sharp({ create: { width: 160, height: 80, channels: 4, background: { r: 12, g: 93, b: 231, alpha: 0.4 } } }).withIccProfile('p3').png({ compressionLevel: 0 }).toBuffer();
  const storage = await optimizeDrawingOriginal(png);
  assert.deepEqual((await sharp(storage.buffer).metadata()).icc, (await sharp(png).metadata()).icc);
  assert.equal(storage.original.format, 'webp');
  assert.deepEqual(await sharp(storage.buffer).ensureAlpha().extractChannel('alpha').raw().toBuffer(), await sharp(png).ensureAlpha().extractChannel('alpha').raw().toBuffer());
  const jpg = await sharp(png).jpeg().toBuffer();
  await assert.rejects(optimizeDrawingOriginal(jpg), /drawing_invalid_original/);
});
