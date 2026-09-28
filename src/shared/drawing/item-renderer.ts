import { apiUrl } from '@/shared/api/http';
import { drawingFromItem, hashDrawing } from '../../../shared/drawing/document.js';
import { createDrawingRenderer } from '../../../shared/drawing/renderer.js';
import { renderLegacyDrawing } from './legacy';

export function createItemRenderer() {
  const renderer = createDrawingRenderer((width, height) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; });
  return {
    clear: renderer.clear,
    draw(ctx: CanvasRenderingContext2D, item: unknown, width: number, height: number, time = Infinity, original: HTMLImageElement | null = null) {
      const document = drawingFromItem(item);
      if (!document) { renderLegacyDrawing(ctx, item as Parameters<typeof renderLegacyDrawing>[1], width, height, time); return; }
      const source = original && time === Infinity ? original : renderer.render(document, time, Number((item as { replay?: { targetReplayMs?: number } }).replay?.targetReplayMs || 12000) / 1000);
      const scale = Math.min(width / document.width, height / document.height);
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(source, (width - document.width * scale) / 2, (height - document.height * scale) / 2, document.width * scale, document.height * scale);
    },
  };
}

export async function loadDrawingOriginal(item: { id: string }, token?: string, signal?: AbortSignal) {
  const document = drawingFromItem(item);
  if (!document) return null;
  if (!document.strokes.length) throw new Error('drawing_original_unavailable');
  const metrics = (item as { metrics?: { documentHash?: string; original?: { hash?: string } } }).metrics;
  if (!metrics?.documentHash || await hashDrawing(document) !== metrics.documentHash) throw new Error('drawing_original_mismatch');
  const suffix = token ? `?token=${encodeURIComponent(token)}` : '';
  const response = await fetch(apiUrl(`/api/drawing-donation/originals/${encodeURIComponent(item.id)}${suffix}`), { credentials: 'include', signal, cache: 'no-store' });
  if (!response.ok) throw new Error('drawing_original_unavailable');
  const blob = await response.blob();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (n) => n.toString(16).padStart(2, '0')).join('');
  if (hash !== metrics.original?.hash) throw new Error('drawing_original_mismatch');
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (image.naturalWidth !== document.width || image.naturalHeight !== document.height) throw new Error('drawing_original_mismatch');
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return image;
  } finally { URL.revokeObjectURL(url); }
}
