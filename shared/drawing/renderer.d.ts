import type { DrawingDocument, DrawingStroke } from './document.js';
export type DrawingRenderer = { render(doc: DrawingDocument, time?: number, maxSeconds?: number, onlyLayer?: string | null): HTMLCanvasElement; clear(): void };
export function createDrawingRenderer(createCanvas: (width: number, height: number) => HTMLCanvasElement): DrawingRenderer;
export function strokeBounds(stroke: DrawingStroke, doc: DrawingDocument): { x: number; y: number; width: number; height: number };
export function floodFillRuns(image: ImageData, x: number, y: number, tolerance?: number): number[];
