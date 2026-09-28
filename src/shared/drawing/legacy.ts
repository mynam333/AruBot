type BrushState = { type?: string; color?: string; alpha?: number; size?: number };
type StrokePoint = { x: number; y: number; p?: number; t: number; replayT?: number };
type Stroke = { id?: string; brush?: BrushState; points?: StrokePoint[] };
type ReplayStroke = Stroke & { points: Array<StrokePoint & { replayT: number }> };
type DrawingItem = {
  id: string;
  strokes?: Stroke[];
  canvas?: { widthRatio?: number; heightRatio?: number };
  replay?: { speed?: number; targetReplayMs?: number; idleCapMs?: number };
  resultHoldSec?: number;
};

function hexToRgb(color: string) {
  const match = String(color || '').trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) return { r: 255, g: 107, b: 154 };
  const value = Number.parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function rgbaFromHex(color: string, alpha: number) {
  const { r, g, b } = hexToRgb(color);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

function applyBrush(ctx: CanvasRenderingContext2D, brush: BrushState, width: number, height: number) {
  const shortSide = Math.min(width, height);
  ctx.globalAlpha = brush.type === 'eraser' ? 1 : Math.max(0.05, Math.min(1, Number(brush.alpha ?? 1) || 1));
  ctx.globalCompositeOperation = brush.type === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = String(brush.color || '#ff6b9a');
  ctx.fillStyle = String(brush.color || '#ff6b9a');
  ctx.lineWidth = Math.max(1, shortSide * Math.max(0.002, Math.min(0.2, Number(brush.size ?? 0.012) || 0.012)));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (brush.type === 'brush') {
    ctx.shadowColor = String(brush.color || '#ff6b9a');
    ctx.shadowBlur = Math.max(1, ctx.lineWidth * 0.18);
  } else {
    ctx.shadowBlur = 0;
  }
}

function drawAirbrushDab(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, rgbaFromHex(color, 0.34));
  gradient.addColorStop(0.48, rgbaFromHex(color, 0.12));
  gradient.addColorStop(1, rgbaFromHex(color, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawAirbrushPath(ctx: CanvasRenderingContext2D, points: StrokePoint[], width: number, height: number, radius: number, color: string) {
  const step = Math.max(1, radius * 0.38);
  drawAirbrushDab(ctx, points[0].x * width, points[0].y * height, radius, color);
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const point = points[index];
    const x0 = prev.x * width;
    const y0 = prev.y * height;
    const x1 = point.x * width;
    const y1 = point.y * height;
    const count = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let i = 1; i <= count; i += 1) {
      const t = i / count;
      drawAirbrushDab(ctx, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, color);
    }
  }
}

function traceDrawingPath(ctx: CanvasRenderingContext2D, points: StrokePoint[], width: number, height: number) {
  ctx.beginPath();
  ctx.moveTo(points[0].x * width, points[0].y * height);
  for (const point of points.slice(1)) ctx.lineTo(point.x * width, point.y * height);
}

function crayonNoise(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function drawCrayonGrain(ctx: CanvasRenderingContext2D, x: number, y: number, nx: number, ny: number, lineWidth: number, color: string, alpha: number, seed: number) {
  const half = lineWidth * 0.55;
  const grains = Math.max(5, Math.min(26, Math.ceil(lineWidth * 0.42)));
  for (let i = 0; i < grains; i += 1) {
    const a = crayonNoise(seed + i * 7.13);
    const b = crayonNoise(seed + i * 11.71);
    const c = crayonNoise(seed + i * 17.31);
    const offset = (a - 0.5) * lineWidth * 1.08;
    const along = (b - 0.5) * lineWidth * 0.46;
    const px = x + nx * offset - ny * along;
    const py = y + ny * offset + nx * along;
    const edge = Math.min(1, Math.abs(offset) / half);
    const radius = Math.max(0.55, lineWidth * (0.035 + c * 0.085));
    ctx.globalAlpha = alpha * (0.08 + (1 - edge) * 0.2) * (0.45 + c * 0.75);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(px, py, radius * (1.1 + b), radius * (0.55 + a * 0.75), Math.atan2(ny, nx), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCrayonPath(ctx: CanvasRenderingContext2D, points: StrokePoint[], width: number, height: number, lineWidth: number, color: string, alpha: number) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha * 0.18;
  ctx.lineWidth = lineWidth * 1.18;
  traceDrawingPath(ctx, points, width, height);
  ctx.stroke();
  ctx.globalAlpha = alpha * 0.32;
  ctx.lineWidth = lineWidth * 0.62;
  traceDrawingPath(ctx, points, width, height);
  ctx.stroke();
  const step = Math.max(1.2, lineWidth * 0.24);
  if (points.length === 1) {
    drawCrayonGrain(ctx, points[0].x * width, points[0].y * height, 0, 1, lineWidth, color, alpha, points[0].x * 997 + points[0].y * 577);
    ctx.restore();
    return;
  }
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const point = points[index];
    const x0 = prev.x * width;
    const y0 = prev.y * height;
    const x1 = point.x * width;
    const y1 = point.y * height;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0.01) continue;
    const nx = -dy / distance;
    const ny = dx / distance;
    const count = Math.max(1, Math.ceil(distance / step));
    for (let i = 0; i <= count; i += 1) {
      const t = i / count;
      const pressure = Math.max(0.25, Math.min(2, ((prev.p || 1) + (point.p || 1)) / 2));
      const seed = (index + 1) * 101 + i * 13 + Math.floor((Number(prev.t || 0) + Number(point.t || 0)) * 0.01);
      drawCrayonGrain(ctx, x0 + dx * t, y0 + dy * t, nx, ny, lineWidth * pressure, color, alpha, seed);
    }
  }
  ctx.restore();
}

function drawBrushDab(ctx: CanvasRenderingContext2D, x: number, y: number, tx: number, ty: number, lineWidth: number, color: string, alpha: number, seed: number) {
  const nx = -ty;
  const ny = tx;
  const spread = lineWidth * (0.78 + crayonNoise(seed + 0.21) * 0.38);
  const length = lineWidth * (0.58 + crayonNoise(seed + 0.47) * 0.46);
  const angle = Math.atan2(ty, tx);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha * (0.1 + crayonNoise(seed + 0.73) * 0.06);
  ctx.beginPath();
  ctx.ellipse(x, y, length * 1.05, spread * 1.28, angle, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = alpha * (0.42 + crayonNoise(seed + 1.17) * 0.18);
  ctx.beginPath();
  ctx.ellipse(x + nx * lineWidth * 0.03, y + ny * lineWidth * 0.03, length * 0.62, spread * 0.86, angle, 0, Math.PI * 2);
  ctx.fill();
  const bristles = Math.max(4, Math.min(18, Math.ceil(lineWidth * 0.28)));
  ctx.lineCap = 'round';
  for (let i = 0; i < bristles; i += 1) {
    const a = crayonNoise(seed + i * 5.91);
    const b = crayonNoise(seed + i * 9.37);
    const edge = (a - 0.5) * spread * 1.7;
    const dry = b > 0.62 ? 0.2 : 1;
    ctx.globalAlpha = alpha * dry * (0.12 + (1 - Math.min(1, Math.abs(edge) / Math.max(1, spread))) * 0.26);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.7, lineWidth * (0.018 + crayonNoise(seed + i * 13.11) * 0.035));
    ctx.beginPath();
    ctx.moveTo(x + nx * edge - tx * length * 0.42, y + ny * edge - ty * length * 0.42);
    ctx.lineTo(x + nx * (edge * 0.9) + tx * length * 0.5, y + ny * (edge * 0.9) + ty * length * 0.5);
    ctx.stroke();
  }
}

function drawInkBrushPath(ctx: CanvasRenderingContext2D, points: StrokePoint[], width: number, height: number, lineWidth: number, color: string, alpha: number) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = lineWidth * 0.08;
  if (points.length === 1) {
    drawBrushDab(ctx, points[0].x * width, points[0].y * height, 1, 0, lineWidth * 0.85, color, alpha, points[0].x * 701 + points[0].y * 1301);
    ctx.restore();
    return;
  }
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const point = points[index];
    const x0 = prev.x * width;
    const y0 = prev.y * height;
    const x1 = point.x * width;
    const y1 = point.y * height;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0.01) continue;
    const tx = dx / distance;
    const ty = dy / distance;
    const elapsed = Math.max(8, Math.abs(Number(point.t || 0) - Number(prev.t || 0)));
    const speed = distance / elapsed;
    const pressure = Math.max(0.2, Math.min(2.2, ((prev.p || 1) + (point.p || 1)) / 2));
    const speedTaper = Math.max(0.55, Math.min(1.18, 1.12 - speed * 0.7));
    const endTaper = Math.min(1, index / 3, (points.length - index + 1) / 3);
    const segmentWidth = lineWidth * (0.56 + pressure * 0.5) * speedTaper * (0.52 + endTaper * 0.48);
    const step = Math.max(1.2, segmentWidth * 0.26);
    const count = Math.max(1, Math.ceil(distance / step));
    for (let i = 0; i <= count; i += 1) {
      const t = i / count;
      const wobble = (crayonNoise(index * 97 + i * 19.3) - 0.5) * segmentWidth * 0.16;
      const nx = -ty;
      const ny = tx;
      const seed = index * 211 + i * 17 + Math.floor((Number(prev.t || 0) + Number(point.t || 0)) * 0.01);
      drawBrushDab(ctx, x0 + dx * t + nx * wobble, y0 + dy * t + ny * wobble, tx, ty, segmentWidth * (0.9 + crayonNoise(seed) * 0.26), color, alpha, seed);
    }
  }
  ctx.restore();
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number, atMs = Infinity) {
  const sourcePoints = stroke.points || [];
  const points: StrokePoint[] = [];
  for (const point of sourcePoints) {
    if (Number(point.replayT ?? point.t ?? 0) > atMs) break;
    points.push(point);
  }
  if (!points.length) return;
  const brush = stroke.brush || {};
  ctx.save();
  applyBrush(ctx, brush, width, height);
  if (brush.type === 'airbrush') {
    drawAirbrushPath(ctx, points, width, height, Math.max(1, ctx.lineWidth * 0.9), String(brush.color || '#ff6b9a'));
    ctx.restore();
    return;
  }
  if (brush.type === 'crayon') {
    drawCrayonPath(ctx, points, width, height, ctx.lineWidth, String(brush.color || '#ff6b9a'), ctx.globalAlpha);
    ctx.restore();
    return;
  }
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x * width, points[0].y * height, Math.max(0.5, ctx.lineWidth / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  if (brush.type === 'marker') {
    const baseLineWidth = ctx.lineWidth;
    const baseAlpha = ctx.globalAlpha;
    const layers = [
      { scale: 1.35, alpha: 0.2, dash: [baseLineWidth * 0.42, baseLineWidth * 0.22] },
      { scale: 1.06, alpha: 0.58, dash: [baseLineWidth * 0.28, baseLineWidth * 0.14] },
      { scale: 0.72, alpha: 0.34, dash: [baseLineWidth * 0.18, baseLineWidth * 0.18] },
    ];
    layers.forEach((layer, index) => {
      ctx.globalAlpha = baseAlpha * layer.alpha;
      ctx.lineWidth = baseLineWidth * layer.scale;
      ctx.setLineDash(layer.dash);
      ctx.lineDashOffset = -(index + 1) * baseLineWidth * 0.37;
      traceDrawingPath(ctx, points, width, height);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.restore();
    return;
  }
  if (brush.type === 'brush' || brush.type === 'highlighter') {
    drawInkBrushPath(ctx, points, width, height, ctx.lineWidth, String(brush.color || '#ff6b9a'), ctx.globalAlpha);
    ctx.restore();
    return;
  }
  ctx.beginPath();
  traceDrawingPath(ctx, points, width, height);
  ctx.stroke();
  ctx.restore();
}

function buildReplayStrokes(item: DrawingItem | null): ReplayStroke[] {
  if (!item?.strokes?.length) return [];
  const speed = Math.max(0.01, Number(item.replay?.speed || 1) || 1);
  const idleCap = Math.max(16, Number(item.replay?.idleCapMs || 120) || 120);
  let replayCursor = 0;
  return item.strokes.map((stroke): ReplayStroke => {
    let previousT = null as number | null;
    const points = (stroke.points || []).map((point, index) => {
      const t = Math.max(0, Number(point.t || 0));
      if (index > 0 && previousT != null) replayCursor += Math.min(idleCap, Math.max(0, t - previousT)) / speed;
      previousT = t;
      return { ...point, replayT: replayCursor };
    });
    return { ...stroke, points };
  });
}

export function renderLegacyDrawing(ctx: CanvasRenderingContext2D, item: DrawingItem, width: number, height: number, time = Infinity) {
  ctx.clearRect(0, 0, width, height);
  for (const stroke of buildReplayStrokes(item)) drawStroke(ctx, stroke, width, height, time);
}

