import { canonicalDrawing, validateDrawing } from './document.js';
import { MAX_DOCUMENT_BYTES, MAX_ORIGINAL_BYTES } from './limits.js';

const MAGIC = new TextEncoder().encode('ARUART01');
const HEADER_BYTES = 20, MAX_MANIFEST_BYTES = 16384;
export const MAX_ARUART_BYTES = HEADER_BYTES + MAX_MANIFEST_BYTES + MAX_DOCUMENT_BYTES + 65536 + MAX_ORIGINAL_BYTES;

const fail = () => { throw new Error('drawing_archive_invalid'); };
const hash = async (bytes) => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)), (n) => n.toString(16).padStart(2, '0')).join('');

async function gzipBytes(bytes, decompress = false) {
  const stream = new Blob([bytes]).stream().pipeThrough(decompress ? new DecompressionStream('gzip') : new CompressionStream('gzip'));
  const reader = stream.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length;
      if (size > MAX_DOCUMENT_BYTES + (decompress ? 0 : 65536)) { await reader.cancel(); fail(); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function imageType(bytes) {
  if (bytes.length > MAX_ORIGINAL_BYTES) fail();
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)) return 'image/png';
  fail();
}

export async function encodeDrawingArchive(document, image, options = {}) {
  validateDrawing(document, { maxStrokes: 1000, maxPoints: 50000 });
  const json = new TextEncoder().encode(canonicalDrawing(document));
  const compressed = await gzipBytes(json), contentType = imageType(image);
  const manifest = {
    version: 1, createdAt: new Date().toISOString(), rendererVersion: document.rendererVersion,
    documentHash: await hash(json), imageHash: await hash(image), contentType,
    width: document.width, height: document.height, documentBytes: json.length,
    replayMaxSec: Math.max(1, Math.min(43200, Number(options.replayMaxSec) || 12)),
  };
  const metadata = new TextEncoder().encode(JSON.stringify(manifest));
  const output = new Uint8Array(HEADER_BYTES + metadata.length + compressed.length + image.length), header = new DataView(output.buffer);
  output.set(MAGIC); header.setUint32(8, metadata.length, true); header.setUint32(12, compressed.length, true); header.setUint32(16, image.length, true);
  output.set(metadata, HEADER_BYTES); output.set(compressed, HEADER_BYTES + metadata.length); output.set(image, HEADER_BYTES + metadata.length + compressed.length);
  return output;
}

export async function decodeDrawingArchive(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < HEADER_BYTES || bytes.length > MAX_ARUART_BYTES || !MAGIC.every((n, i) => bytes[i] === n)) fail();
  const header = new DataView(bytes.buffer, bytes.byteOffset, HEADER_BYTES);
  const metadataSize = header.getUint32(8, true), recordingSize = header.getUint32(12, true), imageSize = header.getUint32(16, true);
  if (!metadataSize || metadataSize > MAX_MANIFEST_BYTES || !recordingSize || recordingSize > MAX_DOCUMENT_BYTES + 65536 || !imageSize || imageSize > MAX_ORIGINAL_BYTES || HEADER_BYTES + metadataSize + recordingSize + imageSize !== bytes.length) fail();
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + metadataSize)));
  if (!manifest || manifest.version !== 1 || !Number.isFinite(manifest.replayMaxSec) || manifest.replayMaxSec < 1 || manifest.replayMaxSec > 43200) fail();
  const recordingStart = HEADER_BYTES + metadataSize;
  const json = await gzipBytes(bytes.subarray(recordingStart, recordingStart + recordingSize), true);
  const image = bytes.slice(recordingStart + recordingSize);
  if (manifest.documentBytes !== json.length || manifest.contentType !== imageType(image) || await hash(json) !== manifest.documentHash || await hash(image) !== manifest.imageHash) fail();
  const document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json));
  validateDrawing(document, { maxStrokes: 1000, maxPoints: 50000 });
  if (manifest.rendererVersion !== document.rendererVersion || manifest.width !== document.width || manifest.height !== document.height) fail();
  return { document, image, manifest };
}
