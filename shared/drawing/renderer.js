import { getStroke } from 'perfect-freehand';
import { buildTimeline, canonicalDrawing, pointsAtTime, SUPPORTED_RENDERER_VERSIONS } from './document.js';
import { selectionCorners, selectionFrameAt } from './selection.js';
import { drawSelectionImage } from './perspective.js';

function noise(x, y, seed) {
  let n = Math.imul(x ^ seed, 374761393) ^ Math.imul(y + 17, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function convexNib(points) {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => { const hull = []; for (const point of list) { while (hull.length >= 2 && cross(hull.at(-2), hull.at(-1), point) <= 0) hull.pop(); hull.push(point); } return hull.slice(0, -1); };
  return [...half(sorted), ...half(sorted.slice().reverse())];
}

function outlinePath(ctx, outline) {
  ctx.beginPath();
  if (!outline.length) return;
  const last = outline[outline.length - 1], first = outline[0];
  ctx.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  ctx.closePath();
}

function curvePath(ctx, points, offset = 0) {
  ctx.beginPath();
  const coords = points.map((point, i) => {
    const prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
    const d = Math.hypot(next[0] - prev[0], next[1] - prev[1]) || 1;
    return [point[0] - (next[1] - prev[1]) / d * offset * (0.25 + point[2]), point[1] + (next[0] - prev[0]) / d * offset * (0.25 + point[2])];
  });
  ctx.moveTo(...coords[0]);
  for (let i = 1; i < coords.length - 1; i++) ctx.quadraticCurveTo(...coords[i], (coords[i][0] + coords[i + 1][0]) / 2, (coords[i][1] + coords[i + 1][1]) / 2);
  if (coords.length > 1) ctx.lineTo(...coords.at(-1));
}

function freehandOutline(points, size, type) {
  return getStroke(points, { size, thinning: type === 'brush' ? 0.85 : type === 'pencil' ? 0.45 : type === 'crayon' ? 0.2 : 0,
    smoothing: 0.65, streamline: 0, simulatePressure: false, last: true, start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 } });
}

function nibPath(ctx, points, size, degrees) {
  const angle = degrees * Math.PI / 180, nx = Math.cos(angle) * size * 0.5, ny = Math.sin(angle) * size * 0.5;
  const tx = -Math.sin(angle) * size * 0.12, ty = Math.cos(angle) * size * 0.12;
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], p = points[i];
    const corners = convexNib([a, p].flatMap((point) => [[point[0] - nx - tx, point[1] - ny - ty], [point[0] + nx - tx, point[1] + ny - ty], [point[0] + nx + tx, point[1] + ny + ty], [point[0] - nx + tx, point[1] - ny + ty]]));
    ctx.moveTo(...corners[0]); for (const corner of corners.slice(1)) ctx.lineTo(...corner); ctx.closePath();
  }
}

export function strokeBounds(stroke, doc) {
  if (stroke.kind === 'selection') {
    const corners = selectionCorners(stroke.frames.at(-1), stroke.selection.rect, doc), xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  if (stroke.kind === 'fill') {
    for (let i = 0; i < stroke.runs.length; i += 3) {
      minX = Math.min(minX, stroke.runs[i + 1] / doc.width); maxX = Math.max(maxX, (stroke.runs[i + 1] + stroke.runs[i + 2]) / doc.width);
      minY = Math.min(minY, stroke.runs[i] / doc.height); maxY = Math.max(maxY, (stroke.runs[i] + 1) / doc.height);
    }
  } else for (const point of stroke.points) {
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
  }
  const tr = stroke.transform, padding = (stroke.brush.size + (stroke.outline?.alpha > 0 ? stroke.outline.size : 0)) * Math.min(doc.width, doc.height) * tr.scale;
  const x = (minX * tr.scale + tr.x) * doc.width - padding, w = (maxX - minX) * tr.scale * doc.width + padding * 2;
  const left = stroke.mirror ? Math.min(x, doc.width - x - w) : x;
  const right = stroke.mirror ? Math.max(x + w, doc.width - x) : x + w;
  const y = (minY * tr.scale + tr.y) * doc.height - padding, h = (maxY - minY) * tr.scale * doc.height + padding * 2;
  const top = stroke.mirrorY ? Math.min(y, doc.height - y - h) : y;
  const bottom = stroke.mirrorY ? Math.max(y + h, doc.height - y) : y + h;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function shapePoints(stroke, width, height, until) {
  const a = stroke.points[0], b = pointsAtTime(stroke.points, until).at(-1) || a;
  const progress = 1;
  const x = a.x * width, y = a.y * height, dx = (b.x - a.x) * width, dy = (b.y - a.y) * height;
  if (stroke.kind === 'line') return [[x, y, 0.65], [x + dx * progress, y + dy * progress, 0.65]];
  const points = [];
  const count = stroke.kind === 'rectangle' ? 4 : 96;
  for (let i = 0; i <= Math.ceil(count * progress); i++) {
    const u = Math.min(progress, i / count);
    if (stroke.kind === 'rectangle') {
      const side = Math.min(3, Math.floor(u * 4)), t = u === 1 ? 1 : u * 4 - side;
      const corners = [[x, y], [x + dx, y], [x + dx, y + dy], [x, y + dy], [x, y]];
      points.push([corners[side][0] + (corners[side + 1][0] - corners[side][0]) * t, corners[side][1] + (corners[side + 1][1] - corners[side][1]) * t, 0.65]);
    } else points.push([x + dx / 2 + Math.cos(u * Math.PI * 2) * dx / 2, y + dy / 2 + Math.sin(u * Math.PI * 2) * dy / 2, 0.65]);
  }
  return points;
}

/** The canvas factory is injected so Node verification and browsers run identical brush code. */
export function createDrawingRenderer(createCanvas) {
  let width = 0, height = 0, scratch, work, output, border;
  const layers = new Map(), patterns = new Map();
  const strokeKeys = new WeakMap();
  const keyOf = (stroke) => {
    let key = strokeKeys.get(stroke);
    if (!key) { key = canonicalDrawing(stroke); strokeKeys.set(stroke, key); }
    return key;
  };

  function texture(brush, seed) {
    const key = `${brush.type}:${brush.color}:${brush.texture}:${seed % 7}`;
    if (patterns.has(key)) return patterns.get(key);
    const tile = createCanvas(192, 192), ctx = tile.getContext('2d'), image = ctx.createImageData(192, 192);
    const rgb = Number.parseInt(brush.color.slice(1), 16);
    for (let y = 0; y < 192; y++) for (let x = 0; x < 192; x++) {
      const fine = noise(x, y, seed % 7 + 101), grain = noise(Math.floor(x / 3), Math.floor(y / 3), 613);
      const fiber = noise(Math.floor((x + y * 0.18) / 2), Math.floor(y / 9), 127);
      let coverage = 1;
      if (brush.type === 'pencil') coverage = 0.12 + fine ** 1.8 * 0.75 + fiber * 0.18;
      if (brush.type === 'crayon') coverage = grain < 0.24 ? fine * 0.12 : 0.45 + fine * 0.55;
      if (brush.type === 'watercolor') coverage = 0.58 + grain * 0.24 + fine * 0.18;
      if (brush.type === 'brush') coverage = 0.78 + fine * 0.22;
      if (brush.type === 'marker' || brush.type === 'highlighter') coverage = 0.84 + fiber * 0.16;
      const i = (y * 192 + x) * 4;
      image.data[i] = rgb >> 16; image.data[i + 1] = (rgb >> 8) & 255; image.data[i + 2] = rgb & 255;
      image.data[i + 3] = Math.round(255 * (1 - brush.texture + brush.texture * coverage));
    }
    ctx.putImageData(image, 0, 0);
    if (patterns.size >= 48) patterns.delete(patterns.keys().next().value);
    patterns.set(key, tile);
    return tile;
  }

  function drawMaterial(ctx, stroke, points) {
    const b = stroke.brush, size = b.size * Math.min(width, height), type = b.type;
    ctx.fillStyle = b.color; ctx.strokeStyle = b.color;
    ctx.lineJoin = stroke.kind === 'rectangle' ? 'miter' : 'round'; ctx.lineCap = 'round';
    const simplePath = (lineWidth) => {
      ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
      for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
      if (points.length > 2 && Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) < 0.01) ctx.closePath();
      ctx.lineWidth = lineWidth; ctx.stroke();
    };
    if (type === 'airbrush') {
      const radius = size * 0.85;
      const dab = (x, y, pressure, weight) => {
        const r = radius * (0.65 + pressure * 0.35);
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, b.color); gradient.addColorStop(b.hardness * 0.55, `${b.color}cc`); gradient.addColorStop(1, `${b.color}00`);
        ctx.globalAlpha = Math.min(0.8, weight * b.flow * 0.09); ctx.fillStyle = gradient;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      };
      dab(points[0][0], points[0][1], points[0][2], 1);
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], p = points[i], distance = Math.hypot(p[0] - a[0], p[1] - a[1]);
        const time = Math.max(0, (p[3] || 0) - (a[3] || 0));
        const count = Math.max(1, Math.ceil(Math.max(distance / Math.max(1, radius * 0.13), time / 30)));
        const weight = (distance / Math.max(1, radius * 0.13) + time / 45) / count;
        for (let j = 1; j <= count; j++) { const t = j / count; dab(a[0] + (p[0] - a[0]) * t, a[1] + (p[1] - a[1]) * t, a[2] + (p[2] - a[2]) * t, weight); }
      }
      ctx.globalAlpha = 1;
      return;
    }
    if (type === 'marker' || type === 'highlighter') {
      // Convex nib sweeps are filled once, so intersections do not accumulate alpha.
      nibPath(ctx, points, size, b.angle);
      ctx.fill();
    } else {
      const outline = stroke.kind === 'freehand' ? freehandOutline(points, size, type) : null;
      if (outline) { outlinePath(ctx, outline); ctx.fill(); } else simplePath(size);
      if (outline && type === 'brush' && b.texture > 0 && points.length > 1) {
        ctx.save(); outlinePath(ctx, outline); ctx.clip(); ctx.globalCompositeOperation = 'destination-out';
        for (let i = 0; i < 17; i++) {
          const n = noise(i, 0, stroke.seed);
          const offset = (i / 16 - 0.5) * size * 0.8;
          ctx.lineWidth = Math.max(0.35, size * (0.004 + n * 0.012)); ctx.globalAlpha = b.texture * (0.12 + n * 0.65);
          curvePath(ctx, points, offset); ctx.stroke();
        }
        ctx.restore();
      }
      if (type === 'watercolor') {
        ctx.globalAlpha = 0.35; ctx.globalCompositeOperation = 'destination-out';
        if (outline) { const inner = getStroke(points, { size: size * 0.9, thinning: 0.12, smoothing: 0.65, streamline: 0, simulatePressure: false, last: true }); outlinePath(ctx, inner); ctx.fill(); }
        else simplePath(size * 0.9);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      }
    }
    if (b.texture > 0 && !['pen', 'eraser'].includes(type)) {
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = ctx.createPattern(texture(b, stroke.seed), 'repeat');
      ctx.fillRect(-width * 4, -height * 4, width * 9, height * 9);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function paintSelection(target, stroke, until, state, cache) {
    const previous = state.selection, operation = stroke.selection, key = canonicalDrawing(operation);
    let prepared = cache.prepared;
    if (!prepared || prepared.id !== stroke.id || prepared.key !== key || prepared.generation !== cache.generation || prepared.source !== previous) {
      if (operation.sourceId && previous?.id !== operation.sourceId) throw new Error('drawing_invalid_selection');
      const rect = operation.rect;
      let image = previous?.image;
      if (!operation.sourceId) {
        image = createCanvas(rect.width, rect.height);
        image.getContext('2d').drawImage(target.canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
      }
      let background = previous?.background;
      if (!operation.sourceId || operation.copy) {
        cache.backgrounds ||= [createCanvas(width, height), createCanvas(width, height)];
        background = cache.backgrounds.find((canvas) => canvas !== previous?.background);
        const ctx = background.getContext('2d');
        ctx.clearRect(0, 0, width, height); ctx.drawImage(target.canvas, 0, 0);
        if (!operation.copy) ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
      }
      // Retain the original crop between gestures, rather than repeatedly resampling it.
      prepared = { id: stroke.id, key, generation: cache.generation, source: previous, result: { id: stroke.id, image, background, sampling: operation.sourceId ? previous.sampling : {} } };
      cache.prepared = prepared;
    }
    const { image, background } = prepared.result, frame = selectionFrameAt(stroke.frames, until);
    target.clearRect(0, 0, width, height); target.drawImage(background, 0, 0);
    drawSelectionImage(target, image, frame, operation.rect, { width, height }, prepared.result.sampling, createCanvas);
    state.selection = prepared.result;
  }

  function closedShapePath(ctx, stroke, until) {
    const a = stroke.points[0], z = pointsAtTime(stroke.points, until).at(-1) || a;
    const x = Math.min(a.x, z.x) * width, y = Math.min(a.y, z.y) * height;
    const w = Math.abs(z.x - a.x) * width, h = Math.abs(z.y - a.y) * height;
    ctx.beginPath();
    if (stroke.kind === 'rectangle') ctx.rect(x, y, w, h);
    else if (stroke.kind === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    else if (stroke.kind === 'star') {
      for (let i = 0; i < 10; i++) {
        const angle = i * Math.PI / 5 - Math.PI / 2, radius = i % 2 ? 0.22 : 0.5;
        const px = x + w / 2 + Math.cos(angle) * w * radius, py = y + h / 2 + Math.sin(angle) * h * radius;
        if (!i) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
    } else {
      ctx.moveTo(x + w / 2, y + h);
      ctx.bezierCurveTo(x - w * 0.35, y + h * 0.4, x + w * 0.03, y - h * 0.35, x + w / 2, y + h * 0.23);
      ctx.bezierCurveTo(x + w * 0.97, y - h * 0.35, x + w * 1.35, y + h * 0.4, x + w / 2, y + h);
    }
    ctx.closePath();
  }

  function paintOutline(stroke, until) {
    border ||= createCanvas(width, height);
    const ctx = border.getContext('2d'), b = stroke.brush, size = b.size * Math.min(width, height);
    ctx.clearRect(0, 0, width, height); ctx.save();
    ctx.translate(stroke.transform.x * width, stroke.transform.y * height); ctx.scale(stroke.transform.scale, stroke.transform.scale);
    let edgeWidth = 0, closed = true;
    if (['rectangle', 'ellipse', 'star', 'heart'].includes(stroke.kind)) {
      closedShapePath(ctx, stroke, until);
      edgeWidth = stroke.shape?.strokeEnabled === false || (!stroke.shape && ['star', 'heart'].includes(stroke.kind)) ? 0 : size;
    } else {
      const points = stroke.kind === 'freehand' ? pointsAtTime(stroke.points, until).map((p) => [p.x * width, p.y * height, p.p, p.t]) : shapePoints(stroke, width, height, until);
      if (['marker', 'highlighter'].includes(b.type)) nibPath(ctx, points, size, b.angle);
      else if (b.type === 'airbrush') outlinePath(ctx, getStroke(points, { size: size * 1.7 * 0.825, thinning: 0.35 / 1.65, smoothing: 0.65, streamline: 0, simulatePressure: false, last: true }));
      else if (stroke.kind === 'freehand') outlinePath(ctx, freehandOutline(points, size, b.type));
      else {
        closed = false; edgeWidth = size;
        ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
        for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
      }
    }
    ctx.lineJoin = stroke.kind === 'rectangle' ? 'miter' : 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = stroke.outline.color; ctx.lineWidth = edgeWidth + stroke.outline.size * Math.min(width, height) * 2; ctx.stroke();
    // Remove the entire body footprint, not its textured alpha: outlines must not tint translucent interiors.
    ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000000'; ctx.strokeStyle = '#000000';
    if (closed) ctx.fill();
    if (edgeWidth) { ctx.lineWidth = edgeWidth; ctx.stroke(); }
    ctx.restore();
  }

  function paintStroke(target, stroke, until, state, cache) {
    if (until < stroke.points[0].t) return;
    if (stroke.kind === 'selection') { paintSelection(target, stroke, until, state, cache); return; }
    state.selection = null;
    const ctx = scratch.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, width, height);
    const paint = (mirror) => {
      ctx.save();
      if (mirror) { ctx.translate(width, 0); ctx.scale(-1, 1); }
      ctx.translate(stroke.transform.x * width, stroke.transform.y * height); ctx.scale(stroke.transform.scale, stroke.transform.scale);
      const { brush: b, kind } = stroke;
      ctx.fillStyle = b.color;
      if (kind === 'fill') {
        ctx.beginPath(); for (let i = 0; i < stroke.runs.length; i += 3) ctx.rect(stroke.runs[i + 1], stroke.runs[i], stroke.runs[i + 2], 1); ctx.fill();
      } else if (stroke.shape) {
        closedShapePath(ctx, stroke, until);
        if (stroke.shape.fillEnabled) { ctx.fillStyle = stroke.shape.fillColor; ctx.globalAlpha = stroke.shape.fillAlpha; ctx.fill(); }
        if (stroke.shape.strokeEnabled) {
          ctx.strokeStyle = b.color; ctx.globalAlpha = b.alpha; ctx.lineWidth = b.size * Math.min(width, height);
          ctx.lineJoin = kind === 'rectangle' ? 'miter' : 'round'; ctx.stroke();
        }
      } else if (kind === 'star' || kind === 'heart') {
        closedShapePath(ctx, stroke, until); ctx.fill();
      } else {
        const points = kind === 'freehand' ? pointsAtTime(stroke.points, until).map((p) => [p.x * width, p.y * height, p.p, p.t]) : shapePoints(stroke, width, height, until);
        if (points.length) drawMaterial(ctx, stroke, points);
      }
      ctx.restore();
    };
    paint(false);
    const outlined = stroke.outline?.alpha > 0 && stroke.brush.type !== 'eraser' && stroke.kind !== 'fill';
    if (outlined) paintOutline(stroke, until);
    target.save(); target.globalCompositeOperation = stroke.brush.type === 'eraser' ? 'destination-out' : 'source-over';
    const alpha = stroke.shape ? 1 : stroke.brush.alpha * (['highlighter', 'watercolor'].includes(stroke.brush.type) ? stroke.brush.flow : 1);
    for (const flipX of stroke.mirror ? [false, true] : [false]) for (const flipY of stroke.mirrorY ? [false, true] : [false]) {
      target.save(); target.translate(flipX ? width : 0, flipY ? height : 0); target.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      if (outlined) { target.globalAlpha = stroke.outline.alpha; target.drawImage(border, 0, 0); }
      target.globalAlpha = alpha;
      target.drawImage(scratch, 0, 0); target.restore();
    }
    target.restore();
  }

  function render(doc, time = Infinity, maxSeconds = 12, onlyLayer = null) {
    if (!SUPPORTED_RENDERER_VERSIONS.includes(doc.rendererVersion) || (doc.rendererVersion === '2.0.0' && doc.strokes.some((stroke) => stroke.outline))) throw new Error('drawing_version_unsupported');
    if (width !== doc.width || height !== doc.height) {
      width = doc.width; height = doc.height; layers.clear(); border = null;
      scratch = createCanvas(width, height); work = createCanvas(width, height); output = createCanvas(width, height);
    }
    const timeline = buildTimeline(doc, maxSeconds), times = new Map(timeline.entries.map((entry) => [entry.id, time * timeline.speed + entry.offset]));
    const out = output.getContext('2d'); out.clearRect(0, 0, width, height);
    for (const layer of doc.layers) {
      if ((!layer.visible && onlyLayer !== layer.id) || (onlyLayer && onlyLayer !== layer.id)) continue;
      const list = doc.strokes.filter((s) => s.layerId === layer.id && (time === Infinity || (times.get(s.id) ?? -1) >= s.points[0].t));
      let prefix = 0;
      while (prefix < list.length - 1 && (times.get(list[prefix].id) ?? Infinity) >= list[prefix].points.at(-1).t) prefix++;
      const keys = list.slice(0, prefix).map(keyOf);
      let cache = layers.get(layer.id);
      if (!cache) { cache = { canvas: createCanvas(width, height), keys: [], generation: 0, state: { selection: null } }; layers.set(layer.id, cache); }
      const base = cache.canvas.getContext('2d');
      if (cache.keys.length > keys.length || cache.keys.some((key, i) => key !== keys[i])) {
        base.clearRect(0, 0, width, height); cache.keys = []; cache.state.selection = null; cache.prepared = null; cache.generation++;
      }
      for (let i = cache.keys.length; i < prefix; i++) { paintStroke(base, list[i], Infinity, cache.state, cache); cache.generation++; }
      cache.keys = keys;
      const layerCtx = work.getContext('2d'); layerCtx.clearRect(0, 0, width, height); layerCtx.drawImage(cache.canvas, 0, 0);
      const state = { selection: cache.state.selection };
      for (let i = prefix; i < list.length; i++) paintStroke(layerCtx, list[i], times.get(list[i].id) ?? Infinity, state, cache);
      out.drawImage(work, 0, 0);
    }
    for (const key of layers.keys()) if (!doc.layers.some((layer) => layer.id === key)) layers.delete(key);
    return output;
  }
  return { render, clear: () => { layers.clear(); patterns.clear(); width = 0; height = 0; } };
}

export function floodFillRuns(image, x, y, tolerance = 24) {
  const { width, height, data } = image, start = (y * width + x) * 4;
  if (x < 0 || y < 0 || x >= width || y >= height) return [];
  const color = Array.from(data.slice(start, start + 4)), seen = new Uint8Array(width * height), queue = new Int32Array(width * height);
  let head = 0, tail = 1; queue[0] = y * width + x; seen[queue[0]] = 1;
  const matches = (index) => {
    const i = index * 4;
    return Math.abs(data[i + 3] - color[3]) <= tolerance && (color[3] < 8 || Math.max(Math.abs(data[i] - color[0]), Math.abs(data[i + 1] - color[1]), Math.abs(data[i + 2] - color[2])) <= tolerance);
  };
  while (head < tail) {
    const index = queue[head++], px = index % width;
    for (const next of [px > 0 ? index - 1 : -1, px < width - 1 ? index + 1 : -1, index - width, index + width]) {
      if (next >= 0 && next < seen.length && !seen[next] && matches(next)) { seen[next] = 1; queue[tail++] = next; }
    }
  }
  const runs = [];
  for (let row = 0; row < height; row++) {
    let col = 0;
    while (col < width) {
      if (!seen[row * width + col]) { col++; continue; }
      const begin = col; while (col < width && seen[row * width + col]) col++;
      runs.push(row, begin, col - begin);
      if (runs.length > 120000) throw new Error('drawing_fill_too_complex');
    }
  }
  return runs;
}
