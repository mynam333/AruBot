import { parentPort, workerData } from 'node:worker_threads';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import sharp from 'sharp';
import { createDrawingRenderer } from '../shared/drawing/renderer.js';

try {
  const { document, original } = workerData;
  const bytes = Buffer.from(original);
  const metadata = await sharp(bytes, { limitInputPixels: 3686400 }).metadata();
  if (metadata.format !== 'png' || metadata.width !== document.width || metadata.height !== document.height || (metadata.pages || 1) !== 1) throw new Error('drawing_original_mismatch');
  const renderer = createDrawingRenderer(createCanvas), expected = renderer.render(document);
  const canvas = createCanvas(document.width, document.height), ctx = canvas.getContext('2d');
  ctx.drawImage(await loadImage(bytes), 0, 0);
  const actual = ctx.getImageData(0, 0, document.width, document.height).data;
  const reference = expected.getContext('2d').getImageData(0, 0, document.width, document.height).data;
  let occupied = 0, different = 0, alphaDifference = 0;
  for (let i = 0; i < actual.length; i += 4) {
    const a = actual[i + 3], b = reference[i + 3];
    if (a < 12 && b < 12) continue;
    occupied++;
    const alpha = Math.abs(a - b);
    const color = Math.max(...[0, 1, 2].map((c) => Math.abs(actual[i + c] * a / 255 - reference[i + c] * b / 255)));
    alphaDifference += alpha;
    if (alpha > 48 || color > 48) different++;
  }
  if (!occupied || different / occupied > 0.06 || alphaDifference / occupied > 9) throw new Error('drawing_original_mismatch');
  const thumbnail = await sharp(bytes, { limitInputPixels: 3686400 }).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  parentPort.postMessage({ ok: true, previewImage: `data:image/webp;base64,${thumbnail.toString('base64')}`, comparison: { occupied, different, meanAlphaError: alphaDifference / occupied } });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error.message || 'drawing_render_failed' });
}
