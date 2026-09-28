import perspectiveTransform from 'perspective-transform';
import { selectionCorners } from './selection.js';

/** Inverse mapping avoids cracks between mesh triangles and interpolates premultiplied alpha. */
export function drawSelectionImage(ctx, image, frame, rect, size, cache, createCanvas) {
  const corners = selectionCorners(frame, rect, size), [a, b, c, d] = corners;
  if (Math.abs(a.x + c.x - b.x - d.x) + Math.abs(a.y + c.y - b.y - d.y) < 1e-6) {
    ctx.save(); ctx.transform((b.x - a.x) / image.width, (b.y - a.y) / image.width, (d.x - a.x) / image.height, (d.y - a.y) / image.height, a.x, a.y);
    ctx.drawImage(image, 0, 0); ctx.restore(); return;
  }
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x))) - 1), y0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y))) - 1);
  const x1 = Math.min(size.width, Math.ceil(Math.max(...corners.map((p) => p.x))) + 1), y1 = Math.min(size.height, Math.ceil(Math.max(...corners.map((p) => p.y))) + 1);
  if (x1 <= x0 || y1 <= y0) return;
  const w = image.width, h = image.height;
  const matrix = perspectiveTransform([0, 0, w, 0, w, h, 0, h], corners.flatMap((p) => [p.x, p.y])).coeffsInv;
  if (!matrix.every(Number.isFinite)) throw new Error('drawing_invalid_selection');
  cache.pixels ||= image.getContext('2d').getImageData(0, 0, w, h).data;
  const source = cache.pixels, buffer = cache.warp ||= createCanvas(size.width, size.height), context = buffer.getContext('2d');
  const output = context.createImageData(x1 - x0, y1 - y0), data = output.data;
  for (let y = y0; y < y1; y++) {
    let nx = matrix[0] * (x0 + 0.5) + matrix[1] * (y + 0.5) + matrix[2];
    let ny = matrix[3] * (x0 + 0.5) + matrix[4] * (y + 0.5) + matrix[5];
    let denominator = matrix[6] * (x0 + 0.5) + matrix[7] * (y + 0.5) + matrix[8];
    for (let x = x0; x < x1; x++, nx += matrix[0], ny += matrix[3], denominator += matrix[6]) {
      const sx = nx / denominator - 0.5, sy = ny / denominator - 0.5;
      if (sx < -1 || sy < -1 || sx >= w || sy >= h) continue;
      const left = Math.floor(sx), top = Math.floor(sy), fx = sx - left, fy = sy - top;
      let alpha = 0, red = 0, green = 0, blue = 0;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const px = left + i, py = top + j;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        const index = (py * w + px) * 4, weight = (i ? fx : 1 - fx) * (j ? fy : 1 - fy) * source[index + 3];
        alpha += weight; red += source[index] * weight; green += source[index + 1] * weight; blue += source[index + 2] * weight;
      }
      if (!alpha) continue;
      const index = ((y - y0) * output.width + x - x0) * 4;
      data[index] = red / alpha; data[index + 1] = green / alpha; data[index + 2] = blue / alpha; data[index + 3] = alpha;
    }
  }
  context.putImageData(output, x0, y0);
  ctx.drawImage(buffer, x0, y0, output.width, output.height, x0, y0, output.width, output.height);
}
