export const DEFAULT_QUAD = [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5];

export function validSelectionQuad(quad) {
  if (!Array.isArray(quad) || quad.length !== 8 || !quad.every((n) => Number.isFinite(n) && Math.abs(n) <= 4)) return false;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, k = (i + 2) % 4;
    if ((quad[j * 2] - quad[i * 2]) * (quad[k * 2 + 1] - quad[j * 2 + 1]) - (quad[j * 2 + 1] - quad[i * 2 + 1]) * (quad[k * 2] - quad[j * 2]) < 0.01) return false;
  }
  return true;
}

export function selectionCorners(frame, rect, document) {
  const quad = frame.quad || DEFAULT_QUAD, a = frame.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [0, 1, 2, 3].map((i) => {
    const x = quad[i * 2] * rect.width * frame.scaleX, y = quad[i * 2 + 1] * rect.height * frame.scaleY;
    return { x: frame.x * document.width + x * c - y * s, y: frame.y * document.height + x * s + y * c };
  });
}

export function distortSelection(start, rect, selected, pointerStart, pointer, document) {
  const dx = (pointer.x - pointerStart.x) * document.width, dy = (pointer.y - pointerStart.y) * document.height;
  const a = start.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), base = start.quad || DEFAULT_QUAD;
  const lx = (dx * c + dy * s) / (rect.width * start.scaleX), ly = (-dx * s + dy * c) / (rect.height * start.scaleY);
  const make = (u) => base.map((value, i) => value + (selected.includes(Math.floor(i / 2)) ? (i % 2 ? ly : lx) * u : 0));
  let quad = make(1);
  if (!validSelectionQuad(quad)) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (validSelectionQuad(make(mid))) lo = mid; else hi = mid; }
    quad = make(lo);
  }
  return { ...start, quad };
}

export function selectionFrameAt(frames, time = Infinity) {
  if (time >= frames.at(-1).t) return frames.at(-1);
  const index = frames.findIndex((frame) => frame.t > time);
  if (index <= 0) return frames[0];
  const a = frames[index - 1], b = frames[index], u = (time - a.t) / Math.max(0.001, b.t - a.t);
  const frame = { t: time };
  for (const key of ['x', 'y', 'scaleX', 'scaleY', 'angle']) frame[key] = a[key] + (b[key] - a[key]) * u;
  if (a.quad || b.quad) frame.quad = (a.quad || DEFAULT_QUAD).map((value, i) => value + ((b.quad || DEFAULT_QUAD)[i] - value) * u);
  return frame;
}

export function rotateSelection(start, rotation, pointer, document, snap = false) {
  const radians = Math.atan2((pointer.y - start.y) * document.height, (pointer.x - start.x) * document.width);
  let delta = radians - rotation.last;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  // Keep turns unwrapped so replay retains direction and complete revolutions.
  const total = Math.max(-36000, Math.min(36000, rotation.total + delta * 180 / Math.PI));
  return { frame: { ...start, t: pointer.t, angle: snap ? Math.round(total / 15) * 15 : total }, rotation: { last: radians, total } };
}

export function constrainShapePoint(anchor, point, document) {
  const dx = (point.x - anchor.x) * document.width, dy = (point.y - anchor.y) * document.height;
  const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
  const length = Math.min(Math.max(Math.abs(dx), Math.abs(dy)), (sx > 0 ? 1 - anchor.x : anchor.x) * document.width, (sy > 0 ? 1 - anchor.y : anchor.y) * document.height);
  return { ...point, x: anchor.x + sx * length / document.width, y: anchor.y + sy * length / document.height };
}

export function constrainLinePoint(anchor, point, document, angle) {
  const dx = (point.x - anchor.x) * document.width, dy = (point.y - anchor.y) * document.height;
  const radians = angle ?? Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4;
  const c = Math.cos(radians), s = Math.sin(radians), distance = dx * c + dy * s;
  const x = anchor.x + distance * c / document.width, y = anchor.y + distance * s / document.height;
  let fraction = 1;
  if (x < 0 || x > 1) fraction = Math.min(fraction, ((x < 0 ? 0 : 1) - anchor.x) / (x - anchor.x));
  if (y < 0 || y > 1) fraction = Math.min(fraction, ((y < 0 ? 0 : 1) - anchor.y) / (y - anchor.y));
  return { point: { ...point, x: anchor.x + (x - anchor.x) * fraction, y: anchor.y + (y - anchor.y) * fraction }, angle: radians };
}

export function selectionRect(a, b, document) {
  const x = Math.min(document.width - 1, Math.floor(Math.min(a.x, b.x) * document.width)), y = Math.min(document.height - 1, Math.floor(Math.min(a.y, b.y) * document.height));
  return { x, y, width: Math.max(1, Math.min(document.width - x, Math.ceil(Math.max(a.x, b.x) * document.width) - x)), height: Math.max(1, Math.min(document.height - y, Math.ceil(Math.max(a.y, b.y) * document.height) - y)) };
}

export function transformSelection(start, rect, handle, pointerStart, pointer, document, keepRatio = false, fromCenter = false) {
  const dx = (pointer.x - pointerStart.x) * document.width, dy = (pointer.y - pointerStart.y) * document.height;
  if (handle === 'move') return { ...start, x: Math.max(-4, Math.min(5, start.x + dx / document.width)), y: Math.max(-4, Math.min(5, start.y + dy / document.height)) };
  const angle = start.angle * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  const hx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const hy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
  const multiplier = fromCenter ? 2 : 1;
  let w = Math.max(rect.width * 0.1, Math.min(rect.width * 4, rect.width * start.scaleX + hx * lx * multiplier));
  let h = Math.max(rect.height * 0.1, Math.min(rect.height * 4, rect.height * start.scaleY + hy * ly * multiplier));
  if (keepRatio) {
    const factor = hx && hy ? Math.max(w / (rect.width * start.scaleX), h / (rect.height * start.scaleY)) : hx ? w / (rect.width * start.scaleX) : h / (rect.height * start.scaleY);
    const safe = Math.min(4 / start.scaleX, 4 / start.scaleY, Math.max(0.1 / start.scaleX, 0.1 / start.scaleY, factor));
    w = rect.width * start.scaleX * safe; h = rect.height * start.scaleY * safe;
  }
  if (fromCenter) return { ...start, scaleX: w / rect.width, scaleY: h / rect.height };
  const localX = hx * (w - rect.width * start.scaleX) / 2, localY = hy * (h - rect.height * start.scaleY) / 2;
  return { ...start, x: Math.max(-4, Math.min(5, start.x + (localX * c - localY * s) / document.width)), y: Math.max(-4, Math.min(5, start.y + (localX * s + localY * c) / document.height)), scaleX: w / rect.width, scaleY: h / rect.height };
}
