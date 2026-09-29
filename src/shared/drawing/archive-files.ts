import { encodeDrawingArchive } from '../../../shared/drawing/archive.js';
import { drawingFromItem, type DrawingDocument } from '../../../shared/drawing/document.js';
import { loadDrawingOriginalBlob } from './item-renderer';

export function downloadDrawingBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function saveDrawingArchive(document: DrawingDocument, image: Blob, replayMaxSec = 12) {
  const bytes = await encodeDrawingArchive(document, new Uint8Array(await image.arrayBuffer()), { replayMaxSec });
  downloadDrawingBlob(new Blob([bytes], { type: 'application/octet-stream' }), `arubot-${new Date().toISOString().slice(0, 10)}.aruart`);
}

export async function saveDrawingItemArchive(item: { id: string; replay?: { targetReplayMs?: number } }) {
  const document = drawingFromItem(item), image = await loadDrawingOriginalBlob(item);
  if (!document || !image) throw new Error('drawing_archive_unsupported');
  await saveDrawingArchive(document, image, (item.replay?.targetReplayMs || 12000) / 1000);
}
