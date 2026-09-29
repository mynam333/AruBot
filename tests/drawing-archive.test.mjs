import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';
import { createCanvas } from '@napi-rs/canvas';
import { createDrawing, createBrush, canonicalDrawing, buildTimeline } from '../shared/drawing/document.js';
import { createDrawingRenderer } from '../shared/drawing/renderer.js';
import { encodeDrawingRecording, decodeDrawingRecording } from '../server/drawing-recording-storage.js';
import { encodeDrawingArchive, decodeDrawingArchive } from '../shared/drawing/archive.js';
import { MAX_DOCUMENT_BYTES } from '../shared/drawing/limits.js';

function fixture() {
  const doc = createDrawing(16, 9, 'archive-test'); doc.width = 640; doc.height = 360;
  doc.strokes = [{ id: 's1', layerId: 'layer-1', seed: 271828, kind: 'freehand', mirror: false,
    brush: createBrush('pencil', '#db4467'), transform: { x: 0, y: 0, scale: 1 },
    points: Array.from({ length: 180 }, (_, i) => ({ x: 0.1 + i / 200, y: 0.5 + Math.sin(i) / 10, p: 0.73, t: i * 37.25 })) }];
  return doc;
}
const renderer = () => createDrawingRenderer((w, h) => createCanvas(w, h));
const image = (doc) => sharp(renderer().render(doc).toBuffer('image/png')).webp({ quality: 60, alphaQuality: 100 }).toBuffer();

test('gzip level 9 preserves canonical recording bytes and timing without sampling', async () => {
  const doc = fixture(), saved = await encodeDrawingRecording(doc), loaded = await decodeDrawingRecording(saved.buffer);
  assert.deepEqual(loaded, doc); assert.equal(canonicalDrawing(loaded), canonicalDrawing(doc));
  assert.deepEqual(buildTimeline(loaded), buildTimeline(doc));
  assert.ok(saved.byteLength < saved.rawByteLength / 2);
  assert.equal(saved.contentType, 'application/gzip');
});

test('legacy JSON recordings remain readable; truncated and oversized gzip are rejected', async () => {
  const doc = fixture(); assert.deepEqual(await decodeDrawingRecording(Buffer.from(canonicalDrawing(doc))), doc);
  const saved = await encodeDrawingRecording(doc);
  await assert.rejects(decodeDrawingRecording(saved.buffer.subarray(0, saved.buffer.length - 10)));
  await assert.rejects(decodeDrawingRecording(gzipSync(Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 32))));
});

test('aruart preserves final image bytes, metadata, and rendered replay frames', async () => {
  const doc = fixture(), original = await image(doc);
  const archive = await encodeDrawingArchive(doc, original, { replayMaxSec: 7 });
  const loaded = await decodeDrawingArchive(archive);
  assert.deepEqual(loaded.document, doc);
  assert.deepEqual(Buffer.from(loaded.image), original);
  assert.equal(loaded.manifest.replayMaxSec, 7);
  assert.equal(loaded.manifest.contentType, 'image/webp');
  const before = renderer(), after = renderer();
  for (const time of [100, 1700, 4800, Infinity]) {
    assert.deepEqual(before.render(doc, time, 7).toBuffer('image/png'), after.render(loaded.document, time, 7).toBuffer('image/png'));
  }
});

test('legacy PNG images can be archived without recompression', async () => {
  const doc = fixture(), png = renderer().render(doc).toBuffer('image/png');
  const loaded = await decodeDrawingArchive(await encodeDrawingArchive(doc, png));
  assert.equal(loaded.manifest.contentType, 'image/png'); assert.deepEqual(Buffer.from(loaded.image), png);
});

test('aruart rejects altered image, unknown versions, invalid lengths and truncated files', async () => {
  const doc = fixture(), bytes = await encodeDrawingArchive(doc, await image(doc));
  const altered = bytes.slice(); altered[altered.length - 1] ^= 1;
  await assert.rejects(decodeDrawingArchive(altered));
  await assert.rejects(decodeDrawingArchive(bytes.subarray(0, bytes.length - 1)));
  const badHeader = bytes.slice(); new DataView(badHeader.buffer).setUint32(8, 0xffffffff, true);
  await assert.rejects(decodeDrawingArchive(badHeader));
  const badVersion = bytes.slice(); badVersion[7] = 50;
  await assert.rejects(decodeDrawingArchive(badVersion));
  await assert.rejects(encodeDrawingArchive(doc, new TextEncoder().encode('<svg/>')));
});

test('aruart limits decompressed JSON size before parsing or rendering', async () => {
  const doc = fixture(), valid = await encodeDrawingArchive(doc, await image(doc));
  const header = new DataView(valid.buffer), metaSize = header.getUint32(8, true), oldSize = header.getUint32(12, true);
  const bomb = gzipSync(Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 32));
  const packed = Buffer.concat([valid.subarray(0, 20 + metaSize), bomb, valid.subarray(20 + metaSize + oldSize)]);
  packed.writeUInt32LE(bomb.length, 12);
  await assert.rejects(decodeDrawingArchive(new Uint8Array(packed)));
});
