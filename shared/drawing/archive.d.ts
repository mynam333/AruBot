import type { DrawingDocument } from './document.js';
export const MAX_ARUART_BYTES: number;
export type DrawingArchive = { document: DrawingDocument; image: Uint8Array<ArrayBuffer>; manifest: { version: number; createdAt: string; rendererVersion: string; documentHash: string; imageHash: string; contentType: string; width: number; height: number; documentBytes: number; replayMaxSec: number } };
export function encodeDrawingArchive(document: DrawingDocument, image: Uint8Array<ArrayBuffer>, options?: { replayMaxSec?: number }): Promise<Uint8Array<ArrayBuffer>>;
export function decodeDrawingArchive(bytes: Uint8Array<ArrayBuffer>): Promise<DrawingArchive>;
