export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
export const MAX_ORIGINAL_BYTES = 16 * 1024 * 1024;
export const RECORDING_HEADROOM_BYTES = 1024;
export const MAX_FILL_RUNS = 40000;
export const MAX_SELECTION_PIXELS = 67108864;

export function drawingJsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function strokeUsage(stroke) {
  return {
    pointCount: stroke ? stroke.points.length + (stroke.frames?.length || 0) : 0,
    fillRuns: (stroke?.runs?.length || 0) / 3,
    selectionPixels: stroke?.selection ? stroke.selection.rect.width * stroke.selection.rect.height : 0,
  };
}

export function drawingUsage(document) {
  const usage = { jsonSize: drawingJsonBytes(document), strokeCount: document.strokes.length, pointCount: 0, fillRuns: 0, selectionPixels: 0 };
  for (const stroke of document.strokes) {
    const next = strokeUsage(stroke);
    for (const key of ['pointCount', 'fillRuns', 'selectionPixels']) usage[key] += next[key];
  }
  return usage;
}

export function updateDrawingUsage(usage, previous, stroke, byteDelta) {
  const before = strokeUsage(previous), after = strokeUsage(stroke);
  const next = {
    ...usage,
    strokeCount: usage.strokeCount + (previous ? 0 : 1),
    jsonSize: usage.jsonSize + (byteDelta ?? drawingJsonBytes(stroke) - (previous ? drawingJsonBytes(previous) : 0)) + (!previous && usage.strokeCount ? 1 : 0),
  };
  for (const key of ['pointCount', 'fillRuns', 'selectionPixels']) next[key] += after[key] - before[key];
  return next;
}

export function drawingLimitError(usage, limits = {}, reservedBytes = 0) {
  if (usage.strokeCount > (limits.maxStrokes || 120)) return 'too_many_strokes';
  if (usage.pointCount > (limits.maxPoints || 6000)) return 'too_many_points';
  if (usage.fillRuns > MAX_FILL_RUNS) return 'drawing_fill_too_complex';
  if (usage.selectionPixels > MAX_SELECTION_PIXELS) return 'drawing_too_complex';
  if (usage.jsonSize > MAX_DOCUMENT_BYTES - reservedBytes) return 'drawing_too_large';
  return null;
}
