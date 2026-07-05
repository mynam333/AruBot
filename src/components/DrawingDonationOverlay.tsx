'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiWsUrl, getBrowserApiBase } from '@/shared/api/http';

type BrushState = { type?: string; color?: string; alpha?: number; size?: number };
type StrokePoint = { x: number; y: number; p?: number; t: number; replayT?: number };
type Stroke = { id?: string; brush?: BrushState; points?: StrokePoint[] };
type DrawingItem = {
  id: string;
  strokes?: Stroke[];
  canvas?: { widthRatio?: number; heightRatio?: number };
  replay?: { speed?: number; targetReplayMs?: number; idleCapMs?: number };
  resultHoldSec?: number;
};

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number, atMs = Infinity) {
  const points = (stroke.points || []).filter((point) => Number(point.replayT ?? point.t ?? 0) <= atMs);
  if (!points.length) return;
  const brush = stroke.brush || {};
  const shortSide = Math.min(width, height);
  ctx.save();
  ctx.globalAlpha = brush.type === 'eraser' ? 1 : Math.max(0.05, Math.min(1, Number(brush.alpha ?? 1) || 1));
  ctx.globalCompositeOperation = brush.type === 'eraser' ? 'destination-out' : brush.type === 'highlighter' ? 'multiply' : 'source-over';
  ctx.strokeStyle = String(brush.color || '#ff6b9a');
  ctx.lineWidth = Math.max(1, shortSide * Math.max(0.002, Math.min(0.08, Number(brush.size ?? 0.012) || 0.012)));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (brush.type === 'marker') {
    ctx.shadowColor = String(brush.color || '#ff6b9a');
    ctx.shadowBlur = Math.max(1, ctx.lineWidth * 0.35);
  }
  if (brush.type === 'airbrush') {
    const radius = Math.max(1, ctx.lineWidth * 0.9);
    for (const point of points) {
      const x = point.x * width;
      const y = point.y * height;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, String(brush.color || '#ff6b9a'));
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  if (points.length === 1) {
    ctx.fillStyle = String(brush.color || '#ff6b9a');
    ctx.beginPath();
    ctx.arc(points[0].x * width, points[0].y * height, Math.max(0.5, ctx.lineWidth / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x * width, points[0].y * height);
  for (const point of points.slice(1)) ctx.lineTo(point.x * width, point.y * height);
  ctx.stroke();
  ctx.restore();
}

function buildReplayStrokes(item: DrawingItem | null) {
  if (!item?.strokes?.length) return [];
  const speed = Math.max(0.01, Number(item.replay?.speed || 1) || 1);
  const idleCap = Math.max(16, Number(item.replay?.idleCapMs || 120) || 120);
  let replayCursor = 0;
  return item.strokes.map((stroke) => {
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
  const animationRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const playingIdRef = useRef<string | null>(null);
  const [item, setItem] = useState<DrawingItem | null>(null);

  const apiBase = useMemo(() => (getBrowserApiBase() || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, ''), []);
  const replayStrokes = useMemo(() => buildReplayStrokes(item), [item]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(window.innerWidth * ratio));
    const height = Math.max(1, Math.floor(window.innerHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return { canvas, width, height };
  }, []);

  const renderAt = useCallback((atMs = Infinity) => {
    const target = resizeCanvas();
    if (!target) return;
    const ctx = target.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, target.width, target.height);
    for (const stroke of replayStrokes) drawStroke(ctx, stroke, target.width, target.height, atMs);
  }, [replayStrokes, resizeCanvas]);

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
      renderAt(0);
      return;
    }
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    const replayMs = Math.max(1000, Number(item.replay?.targetReplayMs || 12000) || 12000);
    const holdMs = Math.max(1000, Number(item.resultHoldSec || 8) * 1000);
    const startedAt = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startedAt;
      if (elapsed < replayMs) {
        renderAt(elapsed);
        animationRef.current = requestAnimationFrame(tick);
        return;
      }
      renderAt(Infinity);
      holdTimerRef.current = window.setTimeout(() => {
        renderAt(0);
        void pop();
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
    };
  }, [item, pop, renderAt]);

  useEffect(() => {
    const onResize = () => renderAt(item ? Infinity : 0);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [item, renderAt]);

  return <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', background: 'transparent' }} />;
}
