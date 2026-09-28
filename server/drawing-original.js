import { Worker } from 'node:worker_threads';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { canonicalDrawing, validateDrawing, drawingInk, buildTimeline } from '../shared/drawing/document.js';

export const DRAWING_ORIGINAL_LIMIT = 8 * 1024 * 1024;
let running = 0;

export function originalOwnerKey(owner) {
  return crypto.createHash('sha256').update(String(owner)).digest('hex').slice(0, 32);
}

export async function inspectOriginal(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > DRAWING_ORIGINAL_LIMIT) throw Object.assign(new Error('drawing_too_large'), { status: 400 });
  const metadata = await sharp(buffer, { limitInputPixels: 3686400 }).metadata();
  if (metadata.format !== 'png' || (metadata.pages || 1) !== 1 || metadata.width < 32 || metadata.height < 32 || metadata.width > 1920 || metadata.height > 1920) throw Object.assign(new Error('drawing_invalid_original'), { status: 400 });
  return { width: metadata.width, height: metadata.height, hash: crypto.createHash('sha256').update(buffer).digest('hex') };
}

export function validateDrawingSubmission(body, settings) {
  const document = body.document;
  const stats = validateDrawing(document, settings);
  if (!document.strokes.length) throw Object.assign(new Error('drawing_empty'), { status: 400 });
  const expectedRatio = settings.canvas.widthRatio / settings.canvas.heightRatio;
  if (Math.abs(document.width / document.height - expectedRatio) > 0.005) throw Object.assign(new Error('drawing_canvas_changed'), { status: 409 });
  const hash = crypto.createHash('sha256').update(canonicalDrawing(document)).digest('hex');
  if (body.documentHash !== hash) throw Object.assign(new Error('drawing_original_mismatch'), { status: 400 });
  let emissions = 0;
  for (const stroke of document.strokes) {
    if (stroke.brush.type !== 'airbrush') continue;
    const radius = stroke.brush.size * Math.min(document.width, document.height) * 0.85;
    for (let i = 1; i < stroke.points.length; i++) {
      const p = stroke.points[i], a = stroke.points[i - 1];
      emissions += Math.max(Math.hypot((p.x - a.x) * document.width, (p.y - a.y) * document.height) / Math.max(1, radius * 0.13), (p.t - a.t) / 30) * (stroke.mirror ? 2 : 1);
    }
  }
  if (emissions > 40000) throw Object.assign(new Error('drawing_too_complex'), { status: 400 });
  return { document, documentHash: hash, strokes: document.strokes, ...stats, ink: drawingInk(document), replay: buildTimeline(document, settings.replayMaxSec) };
}

export function verifyDrawingOriginal(document, original) {
  if (running >= 2) return Promise.reject(Object.assign(new Error('drawing_renderer_busy'), { status: 503 }));
  running++;
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('./drawing-render-worker.js', import.meta.url), { workerData: { document, original }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    } catch (error) { running--; reject(Object.assign(error, { status: 503 })); return; }
    let finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true; clearTimeout(timer); running--; void worker.terminate();
      if (error) reject(Object.assign(error, { status: error.status || 400 })); else resolve(result);
    };
    const timer = setTimeout(() => finish(Object.assign(new Error('drawing_render_timeout'), { status: 503 })), 20000);
    worker.once('message', (result) => finish(result.ok ? null : new Error(result.error), result));
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => { if (!finished) finish(new Error(`drawing_renderer_exit_${code}`)); });
  });
}
