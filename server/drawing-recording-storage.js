import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { canonicalDrawing } from '../shared/drawing/document.js';
import { MAX_DOCUMENT_BYTES } from '../shared/drawing/limits.js';

const compress = promisify(gzip), decompress = promisify(gunzip);

export async function encodeDrawingRecording(document) {
  const json = Buffer.from(canonicalDrawing(document));
  if (json.length > MAX_DOCUMENT_BYTES) throw new Error('drawing_too_large');
  const buffer = await compress(json, { level: 9 });
  return { buffer, contentType: 'application/gzip', encoding: 'gzip', byteLength: buffer.length, rawByteLength: json.length };
}

export async function decodeDrawingRecording(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_DOCUMENT_BYTES + 65536) throw new Error('drawing_too_large');
  const json = buffer[0] === 0x1f && buffer[1] === 0x8b ? await decompress(buffer, { maxOutputLength: MAX_DOCUMENT_BYTES }) : buffer;
  if (json.length > MAX_DOCUMENT_BYTES) throw new Error('drawing_too_large');
  return JSON.parse(json.toString('utf8'));
}
