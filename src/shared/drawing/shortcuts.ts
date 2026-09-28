import type { BrushType, DrawingKind } from '../../../shared/drawing/document.js';

export type DrawingTool = Exclude<DrawingKind, 'selection'> | 'pan' | 'select' | 'picker';
export const TOOL_SHORTCUTS: Record<DrawingTool, string> = {
  freehand: 'B', pan: 'H', select: 'V', picker: 'I', line: 'L',
  rectangle: 'U', ellipse: 'O', fill: 'G', star: 'S', heart: 'D',
};
export const BRUSH_SHORTCUTS: Record<BrushType, string> = {
  pen: '1', pencil: '2', crayon: '3', brush: '4', marker: '5',
  highlighter: '6', airbrush: '7', watercolor: '8', eraser: 'E',
};
type Shortcut = { action: 'tool'; tool: DrawingTool } | { action: 'brush'; brush: BrushType }
  | { action: 'size'; delta: number } | { action: 'undo' | 'redo' | 'deselect' };

export function drawingShortcut(event: KeyboardEvent, blocked = false): Shortcut | null {
  const target = event.target as HTMLElement | null;
  if (blocked || event.defaultPrevented || event.isComposing
    || target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"]')) return null;
  const key = event.code?.replace(/^(Key|Digit)/, '').toUpperCase() || event.key.toUpperCase();
  if (event.altKey) return null;
  if (event.ctrlKey || event.metaKey) {
    if (key === 'Z') return { action: event.shiftKey ? 'redo' : 'undo' };
    if (key === 'Y' && !event.shiftKey) return { action: 'redo' };
    return null;
  }
  if (key === 'BRACKETLEFT' || key === '[') return { action: 'size', delta: -1 };
  if (key === 'BRACKETRIGHT' || key === ']') return { action: 'size', delta: 1 };
  if (event.repeat) return null;
  if (key === 'ESCAPE') return { action: 'deselect' };
  if (event.shiftKey) return null;
  if (key === 'M') return { action: 'tool', tool: 'select' };
  for (const [tool, shortcut] of Object.entries(TOOL_SHORTCUTS)) {
    if (key === shortcut) return { action: 'tool', tool: tool as DrawingTool };
  }
  for (const [brush, shortcut] of Object.entries(BRUSH_SHORTCUTS)) {
    if (key === shortcut) return { action: 'brush', brush: brush as BrushType };
  }
  return null;
}
