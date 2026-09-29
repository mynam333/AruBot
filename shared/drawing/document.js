import { DEFAULT_QUAD, validSelectionQuad } from './selection.js';
import { MAX_DOCUMENT_BYTES, MAX_FILL_RUNS, MAX_SELECTION_PIXELS, drawingJsonBytes } from './limits.js';
export { MAX_DOCUMENT_BYTES } from './limits.js';

export const DRAWING_VERSION = 2;
export const RENDERER_VERSION = '2.1.0';
export const SUPPORTED_RENDERER_VERSIONS = ['2.0.0', RENDERER_VERSION];
export const BRUSHES = {
  pen: { label: '정밀 펜', size: 0.007, texture: 0, hardness: 1, flow: 1, angle: 35 },
  pencil: { label: '연필', size: 0.005, texture: 0.7, hardness: 0.8, flow: 1, angle: 35 },
  crayon: { label: '크레용', size: 0.025, texture: 0.8, hardness: 0.75, flow: 1, angle: 35 },
  brush: { label: '먹붓', size: 0.022, texture: 0.32, hardness: 0.9, flow: 1, angle: 35 },
  marker: { label: '평붓 마커', size: 0.025, texture: 0.12, hardness: 1, flow: 1, angle: 35 },
  highlighter: { label: '형광펜', size: 0.038, texture: 0.08, hardness: 1, flow: 0.38, angle: 15 },
  airbrush: { label: '에어브러시', size: 0.065, texture: 0, hardness: 0.25, flow: 0.35, angle: 35 },
  watercolor: { label: '수채화', size: 0.042, texture: 0.5, hardness: 0.3, flow: 0.65, angle: 35 },
  eraser: { label: '지우개', size: 0.03, texture: 0, hardness: 1, flow: 1, angle: 35 },
};

export function createBrush(type = 'pen', color = '#ff6b9a', alpha = 1) {
  const { label: _label, ...settings } = BRUSHES[type] || BRUSHES.pen;
  return { type, version: 1, color, alpha, ...settings, smoothing: 0.18 };
}

export function rememberDrawingColor(colors, stroke) {
  const color = stroke?.brush?.color?.toLowerCase();
  if (!stroke?.points?.length || stroke.kind === 'selection' || stroke.brush.type === 'eraser' || !/^#[0-9a-f]{6}$/.test(color || '')) return colors;
  const used = [...(stroke.outline?.alpha > 0 ? [stroke.outline.color] : []), ...(stroke.shape ? [...(stroke.shape.fillEnabled && stroke.shape.fillAlpha > 0 ? [stroke.shape.fillColor] : []), ...(stroke.shape.strokeEnabled && stroke.brush.alpha > 0 ? [color] : [])] : stroke.brush.alpha > 0 ? [color] : [])];
  return used.reduce((previous, next) => [next.toLowerCase(), ...previous.filter((c) => c.toLowerCase() !== next.toLowerCase())].slice(0, 8), colors);
}

export function createDrawing(widthRatio = 16, heightRatio = 9, id = '') {
  const scale = 1920 / Math.max(widthRatio, heightRatio);
  return {
    version: DRAWING_VERSION, rendererVersion: RENDERER_VERSION, id, revision: 0,
    width: Math.round(widthRatio * scale), height: Math.round(heightRatio * scale),
    layers: [{ id: 'layer-1', name: '레이어 1', visible: true, locked: false }],
    strokes: [], replayMode: 'drawing-only',
  };
}

export function drawingFromItem(item) {
  const metadata = item?.document || item?.canvas?.document;
  return metadata?.version === DRAWING_VERSION ? { ...metadata, strokes: item.strokes || metadata.strokes || [] } : null;
}

export function canonicalDrawing(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalDrawing).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalDrawing(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function hashDrawing(document) {
  const bytes = new TextEncoder().encode(canonicalDrawing(document));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
}

function invalid(reason) {
  throw Object.assign(new Error(reason), { status: 400 });
}
function number(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) invalid('drawing_invalid_fields');
}

export function validateDrawing(document, limits = {}) {
  keys(document, ['version', 'rendererVersion', 'id', 'revision', 'width', 'height', 'layers', 'strokes', 'replayMode']);
  if (document.version !== DRAWING_VERSION || !SUPPORTED_RENDERER_VERSIONS.includes(document.rendererVersion)) invalid('drawing_version_unsupported');
  if (typeof document.id !== 'string' || !/^[\w-]{1,80}$/.test(document.id) || !Number.isInteger(document.revision) || document.revision < 0) invalid('drawing_invalid_identity');
  if (![document.width, document.height].every((n) => Number.isInteger(n) && n >= 32 && n <= 1920) || document.width * document.height > 3686400) invalid('drawing_invalid_canvas');
  if (!['drawing-only', 'original', 'trim-gaps'].includes(document.replayMode)) invalid('drawing_invalid_replay');
  if (!Array.isArray(document.layers) || document.layers.length < 1 || document.layers.length > 3) invalid('drawing_invalid_layers');
  const layerIds = new Set();
  for (const layer of document.layers) {
    keys(layer, ['id', 'name', 'visible', 'locked']);
    if (typeof layer.id !== 'string' || !/^[\w-]{1,80}$/.test(layer.id) || layerIds.has(layer.id) || typeof layer.name !== 'string' || layer.name.length > 40 || typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean') invalid('drawing_invalid_layers');
    layerIds.add(layer.id);
  }
  if (!Array.isArray(document.strokes) || document.strokes.length > (limits.maxStrokes || 120)) invalid('too_many_strokes');
  let pointCount = 0;
  let fillRuns = 0, selectionPixels = 0;
  const ids = new Set();
  const lastInLayer = new Map();
  for (const stroke of document.strokes) {
    keys(stroke, ['id', 'layerId', 'seed', 'brush', 'points', 'kind', 'transform', 'mirror', 'mirrorY', 'runs', 'selection', 'frames', 'shape', 'outline']);
    if (!layerIds.has(stroke.layerId) || typeof stroke.id !== 'string' || !/^[\w-]{1,80}$/.test(stroke.id) || ids.has(stroke.id) || !Number.isInteger(stroke.seed) || !number(stroke.seed, 0, 4294967295)) invalid('drawing_invalid_stroke');
    ids.add(stroke.id);
    if (!['freehand', 'line', 'rectangle', 'ellipse', 'star', 'heart', 'fill', 'selection'].includes(stroke.kind) || typeof stroke.mirror !== 'boolean') invalid('drawing_invalid_tool');
    if (stroke.mirrorY !== undefined && typeof stroke.mirrorY !== 'boolean') invalid('drawing_invalid_tool');
    if (stroke.shape !== undefined) {
      keys(stroke.shape, ['fillEnabled', 'fillColor', 'fillAlpha', 'strokeEnabled']);
      if (!['rectangle', 'ellipse', 'star', 'heart'].includes(stroke.kind) || typeof stroke.shape.fillEnabled !== 'boolean' || typeof stroke.shape.strokeEnabled !== 'boolean' || !/^#[0-9a-f]{6}$/i.test(stroke.shape.fillColor) || !number(stroke.shape.fillAlpha, 0, 1)) invalid('drawing_invalid_shape');
    }
    const b = stroke.brush;
    keys(b, ['type', 'version', 'color', 'alpha', 'size', 'texture', 'hardness', 'flow', 'angle', 'smoothing']);
    if (!Object.hasOwn(BRUSHES, b.type) || b.version !== 1 || !/^#[0-9a-f]{6}$/i.test(b.color) || !number(b.alpha, 0, 1) || !number(b.size, 0.001, 0.2) || !number(b.texture, 0, 1) || !number(b.hardness, 0, 1) || !number(b.flow, 0.05, 1) || !number(b.angle, 0, 180) || !number(b.smoothing, 0, 0.85)) invalid('drawing_invalid_brush');
    if (stroke.outline !== undefined) {
      keys(stroke.outline, ['size', 'color', 'alpha']);
      if (document.rendererVersion === '2.0.0') invalid('drawing_version_unsupported');
      if (['fill', 'selection'].includes(stroke.kind) || b.type === 'eraser' || !number(stroke.outline.size, 0.001, 0.1) || !/^#[0-9a-f]{6}$/i.test(stroke.outline.color) || !number(stroke.outline.alpha, 0, 1)) invalid('drawing_invalid_outline');
    }
    keys(stroke.transform, ['x', 'y', 'scale']);
    if (!number(stroke.transform.x, -1, 1) || !number(stroke.transform.y, -1, 1) || !number(stroke.transform.scale, 0.1, 4)) invalid('drawing_invalid_transform');
    if (!Array.isArray(stroke.points) || stroke.points.length < 1) invalid('drawing_invalid_points');
    pointCount += stroke.points.length;
    if (pointCount > (limits.maxPoints || 6000)) invalid('too_many_points');
    let previous = -1;
    for (const p of stroke.points) {
      keys(p, ['x', 'y', 'p', 't']);
      if (!number(p.x, 0, 1) || !number(p.y, 0, 1) || !number(p.p, 0, 1) || !number(p.t, 0, 43200000) || p.t < previous) invalid('drawing_invalid_points');
      previous = p.t;
    }
    if (stroke.kind === 'selection') {
      keys(stroke.selection, ['rect', 'sourceId', 'copy']);
      const rect = stroke.selection.rect, source = lastInLayer.get(stroke.layerId);
      keys(rect, ['x', 'y', 'width', 'height']);
      if (![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger) || !number(rect.x, 0, document.width - 1) || !number(rect.y, 0, document.height - 1) || !number(rect.width, 1, document.width - rect.x) || !number(rect.height, 1, document.height - rect.y) || typeof stroke.selection.copy !== 'boolean' || stroke.mirror || stroke.mirrorY) invalid('drawing_invalid_selection');
      if (stroke.selection.sourceId !== null && (source?.kind !== 'selection' || source.id !== stroke.selection.sourceId || canonicalDrawing(source.selection.rect) !== canonicalDrawing(rect))) invalid('drawing_invalid_selection');
      if (stroke.transform.x || stroke.transform.y || stroke.transform.scale !== 1 || b.type !== 'pen' || b.alpha !== 1) invalid('drawing_invalid_selection');
      selectionPixels += rect.width * rect.height;
      if (selectionPixels > MAX_SELECTION_PIXELS) invalid('drawing_too_complex');
      if (!Array.isArray(stroke.frames) || !stroke.frames.length || stroke.points.length !== 2) invalid('drawing_invalid_selection');
      let previousTime = stroke.points[0].t;
      for (const frame of stroke.frames) {
        keys(frame, ['t', 'x', 'y', 'scaleX', 'scaleY', 'angle', 'quad']);
        if (!number(frame.t, previousTime, stroke.points[1].t) || !number(frame.x, -4, 5) || !number(frame.y, -4, 5) || !number(frame.scaleX, 0.1, 4) || !number(frame.scaleY, 0.1, 4) || !number(frame.angle, -36000, 36000)) invalid('drawing_invalid_selection');
        if (frame.quad !== undefined && !validSelectionQuad(frame.quad)) invalid('drawing_invalid_selection');
        previousTime = frame.t;
      }
      if (stroke.frames[0].t !== stroke.points[0].t || stroke.frames.at(-1).t !== stroke.points[1].t) invalid('drawing_invalid_selection');
      const start = stroke.selection.sourceId ? source.frames.at(-1) : { x: (rect.x + rect.width / 2) / document.width, y: (rect.y + rect.height / 2) / document.height, scaleX: 1, scaleY: 1, angle: 0 };
      if (['x', 'y', 'scaleX', 'scaleY', 'angle'].some((key) => Math.abs(stroke.frames[0][key] - start[key]) > 1e-9)) invalid('drawing_invalid_selection');
      if ((stroke.frames[0].quad || DEFAULT_QUAD).some((n, i) => Math.abs(n - (start.quad || DEFAULT_QUAD)[i]) > 1e-9)) invalid('drawing_invalid_selection');
      pointCount += stroke.frames.length;
      if (pointCount > (limits.maxPoints || 6000)) invalid('too_many_points');
    } else if (stroke.selection !== undefined || stroke.frames !== undefined) invalid('drawing_invalid_selection');
    if (stroke.kind === 'fill') {
      if (!Array.isArray(stroke.runs) || !stroke.runs.length || stroke.runs.length % 3) invalid('drawing_invalid_fill');
      fillRuns += stroke.runs.length / 3;
      if (fillRuns > MAX_FILL_RUNS) invalid('drawing_fill_too_complex');
      let lastY = -1, lastEnd = 0;
      for (let i = 0; i < stroke.runs.length; i += 3) {
        const [y, x, length] = stroke.runs.slice(i, i + 3);
        if (![x, y, length].every(Number.isInteger) || !number(y, 0, document.height - 1) || !number(x, 0, document.width - 1) || !number(length, 1, document.width - x) || y < lastY || (y === lastY && x < lastEnd)) invalid('drawing_invalid_fill');
        lastY = y; lastEnd = x + length;
      }
    } else if (stroke.runs !== undefined) invalid('drawing_invalid_fill');
    lastInLayer.set(stroke.layerId, stroke);
  }
  const jsonSize = drawingJsonBytes(document);
  if (jsonSize > MAX_DOCUMENT_BYTES) invalid('drawing_too_large');
  return { pointCount, rawPointCount: pointCount, jsonSize, strokeCount: document.strokes.length };
}

export function visibleStrokes(document) {
  const visible = new Set(document.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  return document.strokes.filter((stroke) => visible.has(stroke.layerId));
}

export function drawingInk(document) {
  let raw = 0;
  for (const stroke of visibleStrokes(document)) {
    const { brush: b, points } = stroke;
    const scale = stroke.transform.scale;
    const factor = b.type === 'eraser' ? 0.35 : b.type === 'airbrush' ? 1.25 : b.type === 'brush' ? 1.1 : 1;
    let amount = 0;
    if (stroke.kind === 'selection') {
      const frame = stroke.frames.at(-1), rect = stroke.selection.rect;
      amount = stroke.selection.copy ? rect.width * rect.height * frame.scaleX * frame.scaleY / (document.width * document.height) : 0;
    } else if (stroke.kind === 'fill') {
      for (let i = 2; i < stroke.runs.length; i += 3) amount += stroke.runs[i] / (document.width * document.height);
    } else if (['star', 'heart'].includes(stroke.kind)) {
      const last = points[points.length - 1];
      amount = Math.max(b.size ** 2, Math.abs(last.x - points[0].x) * Math.abs(last.y - points[0].y));
    } else {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], p = points[i];
        amount += Math.hypot(p.x - a.x, p.y - a.y) * b.size * Math.max(0.1, (p.p + a.p) / 2);
      }
      if (stroke.kind === 'rectangle') amount = (Math.abs(points.at(-1).x - points[0].x) + Math.abs(points.at(-1).y - points[0].y)) * 2 * b.size;
      if (stroke.kind === 'ellipse') amount *= Math.PI;
      if (points.length === 1) amount = b.size * 0.2;
      if (b.type === 'airbrush') amount += Math.min(60, (points.at(-1).t - points[0].t) / 1000) * b.size ** 2 * b.flow * 0.1;
    }
    amount *= b.alpha;
    if (stroke.shape) {
      if (!stroke.shape.strokeEnabled) amount = 0;
      if (stroke.shape.fillEnabled) amount += Math.abs(points.at(-1).x - points[0].x) * Math.abs(points.at(-1).y - points[0].y) * stroke.shape.fillAlpha;
    }
    if (stroke.outline?.alpha > 0) {
      const dx = Math.abs(points.at(-1).x - points[0].x), dy = Math.abs(points.at(-1).y - points[0].y);
      let perimeter = 0;
      if (stroke.kind === 'rectangle') perimeter = 2 * (dx + dy);
      else if (stroke.kind === 'ellipse') perimeter = Math.PI * Math.hypot(dx, dy) / Math.SQRT2;
      else if (['star', 'heart'].includes(stroke.kind)) perimeter = 4 * Math.hypot(dx, dy);
      else {
        for (let i = 1; i < points.length; i++) perimeter += 2 * Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
        perimeter += Math.PI * b.size;
      }
      amount += (perimeter + Math.PI * stroke.outline.size) * stroke.outline.size * stroke.outline.alpha;
    }
    raw += amount * factor * scale ** 2 * (stroke.mirror ? 2 : 1) * (stroke.mirrorY ? 2 : 1);
  }
  return { raw, units: Math.max(1, Math.ceil(raw * 1000)) };
}

export function drawingCost(document, settings) {
  if (!visibleStrokes(document).length) return 0;
  return settings.pricingMode === 'ink' ? Math.max(0, Math.ceil(drawingInk(document).units * settings.inkCostPerUnit)) : Math.max(0, Math.floor(settings.costPoints));
}

export function buildTimeline(document, maxSeconds = 12) {
  const strokes = visibleStrokes(document).slice().sort((a, b) => a.points[0].t - b.points[0].t);
  const first = strokes[0]?.points[0].t || 0;
  let last = first, removed = 0;
  const entries = strokes.map((stroke) => {
    const start = stroke.points[0].t, end = stroke.points.at(-1).t;
    // Pen-up time is never playback time; retain the original timestamps in the document.
    removed += Math.max(0, start - last);
    const offset = first + removed;
    last = Math.max(last, end);
    return { id: stroke.id, start: start - offset, end: end - offset, offset };
  });
  const duration = Math.max(1, ...entries.map((entry) => entry.end));
  const speed = Math.max(1, duration / Math.max(1000, maxSeconds * 1000));
  return { entries, speed, sourceDurationMs: duration, targetReplayMs: duration / speed, mode: 'drawing-only' };
}

export function pointsAtTime(points, at = Infinity) {
  if (at < points[0].t) return [];
  if (at >= points.at(-1).t) return points;
  let lo = 0, hi = points.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (points[mid].t <= at) lo = mid + 1; else hi = mid; }
  const out = points.slice(0, lo);
  if (lo > 0 && lo < points.length) {
    const a = points[lo - 1], b = points[lo];
    const u = (at - a.t) / (b.t - a.t);
    out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, p: a.p + (b.p - a.p) * u, t: at });
  }
  return out;
}
