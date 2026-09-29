import crypto from 'node:crypto';
import sharp from 'sharp';
import { MAX_ORIGINAL_BYTES } from '../shared/drawing/limits.js';

const inputOptions = { limitInputPixels: 3686400 };
const digest = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
export const DRAWING_COMPRESSION_BUDGET_MS = 15000;

export async function optimizeDrawingOriginal(buffer, deadline = Date.now() + DRAWING_COMPRESSION_BUDGET_MS) {
  const startedAt = Date.now();
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_ORIGINAL_BYTES) throw new Error('drawing_invalid_original');
  const metadata = await sharp(buffer, inputOptions).metadata();
  if (metadata.format !== 'png' || metadata.depth !== 'uchar' || (metadata.orientation && metadata.orientation !== 1) || (metadata.pages || 1) !== 1 || metadata.width < 32 || metadata.height < 32 || metadata.width > 1920 || metadata.height > 1920) throw new Error('drawing_invalid_original');
  const sourceHash = digest(buffer);
  let stored, effort, stage = 'source_alpha';
  const attempts = [];
  const image = (bytes, maxSeconds = Infinity, reserveMs = 0) => {
    const remaining = deadline - Date.now() - reserveMs;
    if (remaining <= 0) throw new Error('drawing_compression_timeout');
    const seconds = Math.min(maxSeconds, Math.max(1, Math.floor(remaining / 1000)));
    return sharp(bytes, inputOptions).timeout({ seconds });
  };
  try {
    const before = await image(buffer).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true });
    stage = 'encode';
    // Effort 6 can exceed ten seconds on a supported 1920px textured canvas.
    // Reserve time for a faster WebP retry without reducing quality or alpha precision.
    for (const candidate of [4, 2]) {
      try {
        stored = await image(buffer, candidate === 4 ? 6 : Infinity, candidate === 4 ? 3000 : 0)
          .keepIccProfile().webp({ lossless: false, nearLossless: false, quality: 60, alphaQuality: 100, effort: candidate, preset: 'drawing', smartSubsample: true }).toBuffer();
        effort = candidate;
        break;
      } catch (error) {
        attempts.push({ effort: candidate, reason: String(error.message || error).slice(0, 500) });
        if (candidate === 2) throw error;
      }
    }
    // Colour may be lossy, but every transparency value and the canvas size must survive.
    stage = 'stored_alpha';
    const after = await image(stored).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true });
    if (before.info.width !== after.info.width || before.info.height !== after.info.height || !before.data.equals(after.data)) throw new Error('drawing_alpha_mismatch');
  } catch (error) {
    throw Object.assign(new Error('drawing_compression_failed', { cause: error }), {
      status: 503,
      diagnostics: { stage, reason: String(error.message || error).slice(0, 500), attempts, elapsedMs: Date.now() - startedAt,
        width: metadata.width, height: metadata.height, inputBytes: buffer.length },
    });
  }
  return {
    buffer: stored,
    original: {
      width: metadata.width, height: metadata.height, format: 'webp', contentType: 'image/webp',
      hash: digest(stored), sourceHash,
      byteLength: stored.length, sourceByteLength: buffer.length,
      lossless: false, alphaLossless: true, quality: 60, alphaQuality: 100, effort, encoding: 'webp-lossy-alpha-lossless',
    },
  };
}
