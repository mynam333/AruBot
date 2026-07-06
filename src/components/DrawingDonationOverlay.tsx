'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiWsUrl, getBrowserApiBase } from '@/shared/api/http';

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

const MAX_CANVAS_DPR = 2;
const FADE_OUT_MS = 850;

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
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x * width, points[0].y * height, Math.max(0.5, ctx.lineWidth / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  if (brush.type === 'crayon' || brush.type === 'marker') {
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
    const baseLineWidth = ctx.lineWidth;
    const baseAlpha = ctx.globalAlpha;
    ctx.globalAlpha = baseAlpha * 0.36;
    ctx.lineWidth = baseLineWidth * 1.85;
    traceDrawingPath(ctx, points, width, height);
    ctx.stroke();
    ctx.globalAlpha = baseAlpha * 0.82;
    ctx.lineWidth = baseLineWidth * 0.92;
    traceDrawingPath(ctx, points, width, height);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.beginPath();
  traceDrawingPath(ctx, points, width, height);
  ctx.stroke();
  ctx.restore();
}

function drawStrokeDelta(ctx: CanvasRenderingContext2D, stroke: ReplayStroke, width: number, height: number, fromMs: number, toMs: number) {
  const points = stroke.points || [];
  if (!points.length) return;
  let firstNewIndex = -1;
  for (let index = 0; index < points.length; index += 1) {
    const replayT = points[index].replayT;
    if (replayT > fromMs && replayT <= toMs) {
      firstNewIndex = index;
      break;
    }
    if (replayT > toMs) break;
  }
  if (firstNewIndex < 0) return;
  let lastNewIndex = firstNewIndex;
  while (lastNewIndex + 1 < points.length && points[lastNewIndex + 1].replayT <= toMs) lastNewIndex += 1;

  const brush = stroke.brush || {};
  ctx.save();
  applyBrush(ctx, brush, width, height);
  if (brush.type === 'airbrush') {
    drawAirbrushPath(ctx, points.slice(Math.max(0, firstNewIndex - 1), lastNewIndex + 1), width, height, Math.max(1, ctx.lineWidth * 0.9), String(brush.color || '#ff6b9a'));
    ctx.restore();
    return;
  }
  const startIndex = Math.max(0, firstNewIndex - 1);
  if (brush.type === 'crayon' || brush.type === 'marker' || brush.type === 'brush' || brush.type === 'highlighter') {
    ctx.restore();
    drawStroke(ctx, { ...stroke, points: points.slice(startIndex, lastNewIndex + 1) }, width, height);
    return;
  }
  if (startIndex === lastNewIndex) {
    const point = points[lastNewIndex];
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, Math.max(0.5, ctx.lineWidth / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[startIndex].x * width, points[startIndex].y * height);
  for (let index = startIndex + 1; index <= lastNewIndex; index += 1) ctx.lineTo(points[index].x * width, points[index].y * height);
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

export default function DrawingDonationOverlay({ viewerToken }: { viewerToken: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const animationRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const playingIdRef = useRef<string | null>(null);
  const lastRenderedMsRef = useRef(0);
  const [item, setItem] = useState<DrawingItem | null>(null);

  const apiBase = useMemo(() => (getBrowserApiBase() || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, ''), []);
  const replayStrokes = useMemo(() => buildReplayStrokes(item), [item]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ratio = Math.max(1, Math.min(MAX_CANVAS_DPR, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.floor(window.innerWidth * ratio));
    const height = Math.max(1, Math.floor(window.innerHeight * ratio));
    let resized = false;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      resized = true;
    }
    const ctx = ctxRef.current || canvas.getContext('2d', { alpha: true, desynchronized: true });
    ctxRef.current = ctx;
    return ctx ? { canvas, ctx, width, height, resized } : null;
  }, []);

  const renderAt = useCallback((atMs = Infinity) => {
    const target = resizeCanvas();
    if (!target) return;
    target.ctx.clearRect(0, 0, target.width, target.height);
    if (atMs > 0) {
      for (const stroke of replayStrokes) drawStroke(target.ctx, stroke, target.width, target.height, atMs);
    }
    lastRenderedMsRef.current = Number.isFinite(atMs) ? Math.max(0, atMs) : Number.POSITIVE_INFINITY;
  }, [replayStrokes, resizeCanvas]);

  const renderDelta = useCallback((fromMs: number, toMs: number) => {
    const target = resizeCanvas();
    if (!target) return;
    if (target.resized || toMs < fromMs || !Number.isFinite(fromMs)) {
      renderAt(toMs);
      return;
    }
    for (const stroke of replayStrokes) drawStrokeDelta(target.ctx, stroke, target.width, target.height, fromMs, toMs);
    lastRenderedMsRef.current = toMs;
  }, [renderAt, replayStrokes, resizeCanvas]);

  const setCanvasOpacity = useCallback((opacity: number, transitionMs = 0) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.transition = transitionMs > 0 ? `opacity ${transitionMs}ms ease` : 'none';
    canvas.style.opacity = String(opacity);
  }, []);

  const pop = useCallback(async () => {
    await fetch(`${apiBase}/api/drawing-donation/pop-by-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: viewerToken }),
    }).catch(() => undefined);
    playingIdRef.current = null;
    setItem(null);
  }, [apiBase, viewerToken]);

  const applyIncomingItem = useCallback((nextItem: DrawingItem | null) => {
    if (!nextItem?.id) {
      playingIdRef.current = null;
      setItem(null);
      return;
    }
    if (nextItem.id === playingIdRef.current) return;
    playingIdRef.current = nextItem.id;
    setItem(nextItem);
  }, []);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | null = null;
    let ws: WebSocket | null = null;

    const connect = () => {
      if (disposed) return;
      try {
        ws = new WebSocket(apiWsUrl(`/api/drawing-donation/ws?token=${encodeURIComponent(viewerToken)}`, apiBase));
        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(String(event.data || '{}')) as { type?: string; item?: DrawingItem | null };
            if (payload.type === 'drawing-donation.current') applyIncomingItem(payload.item || null);
          } catch {
            // Ignore malformed overlay payloads.
          }
        };
        ws.onclose = () => {
          if (disposed) return;
          reconnectTimer = window.setTimeout(connect, 1800);
        };
        ws.onerror = () => {
          try { ws?.close(); } catch {}
        };
      } catch {
        reconnectTimer = window.setTimeout(connect, 1800);
      }
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      try { ws?.close(); } catch {}
    };
  }, [apiBase, applyIncomingItem, viewerToken]);

  useEffect(() => {
    if (!item) {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      if (fadeTimerRef.current) window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
      setCanvasOpacity(0, 0);
      renderAt(0);
      return;
    }
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (fadeTimerRef.current) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    setCanvasOpacity(1, 0);
    renderAt(0);
    const replayMs = Math.max(1000, Number(item.replay?.targetReplayMs || 12000) || 12000);
    const holdMs = Math.max(1000, Number(item.resultHoldSec || 8) * 1000);
    const startedAt = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startedAt;
      if (elapsed < replayMs) {
        renderDelta(lastRenderedMsRef.current, elapsed);
        animationRef.current = requestAnimationFrame(tick);
        return;
      }
      renderAt(Infinity);
      holdTimerRef.current = window.setTimeout(() => {
        setCanvasOpacity(0, FADE_OUT_MS);
        fadeTimerRef.current = window.setTimeout(() => {
          renderAt(0);
          void pop();
        }, FADE_OUT_MS);
      }, holdMs);
    };
    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      if (holdTimerRef.current) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      if (fadeTimerRef.current) {
        window.clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, [item, pop, renderAt, renderDelta, setCanvasOpacity]);

  useEffect(() => {
    const onResize = () => renderAt(item ? lastRenderedMsRef.current : 0);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [item, renderAt]);

  return <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', background: 'transparent', opacity: 0, willChange: 'opacity' }} />;
}
