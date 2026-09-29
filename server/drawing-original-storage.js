import crypto from 'node:crypto';
import sharp from 'sharp';
import { MAX_ORIGINAL_BYTES } from '../shared/drawing/limits.js';

const inputOptions = { limitInputPixels: 3686400 };
const digest = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

export async function optimizeDrawingOriginal(buffer, deadline = Date.now() + 8000) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_ORIGINAL_BYTES) throw new Error('drawing_invalid_original');
  const metadata = await sharp(buffer, inputOptions).metadata();
  if (metadata.format !== 'png' || metadata.depth !== 'uchar' || (metadata.orientation && metadata.orientation !== 1) || (metadata.pages || 1) !== 1 || metadata.width < 32 || metadata.height < 32 || metadata.width > 1920 || metadata.height > 1920) throw new Error('drawing_invalid_original');
  const sourceHash = digest(buffer);
  let stored;
  const image = (bytes) => {
    const seconds = Math.min(8, Math.floor((deadline - Date.now()) / 1000));
    if (seconds < 1) throw new Error('drawing_compression_timeout');
    return sharp(bytes, inputOptions).timeout({ seconds });
  };
  try {
    stored = await image(buffer).keepIccProfile().webp({ lossless: false, nearLossless: false, quality: 60, alphaQuality: 100, effort: 6, preset: 'drawing', smartSubsample: true }).toBuffer();
    // Colour may be lossy, but every transparency value and the canvas size must survive.
    const before = await image(buffer).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true });
    const after = await image(stored).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true });
    if (before.info.width !== after.info.width || before.info.height !== after.info.height || !before.data.equals(after.data)) throw new Error('drawing_alpha_mismatch');
  } catch (error) {
    throw Object.assign(new Error('drawing_compression_failed', { cause: error }), { status: 503 });
  }
  return {
    buffer: stored,
    original: {
      width: metadata.width, height: metadata.height, format: 'webp', contentType: 'image/webp',
      hash: digest(stored), sourceHash,
      byteLength: stored.length, sourceByteLength: buffer.length,
      lossless: false, alphaLossless: true, quality: 60, alphaQuality: 100, encoding: 'webp-lossy-alpha-lossless',
    },
  };
}
