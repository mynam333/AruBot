'use client';

import Link from 'next/link';
import type Hls from 'hls.js';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { ArrowLeft, Brush, Eraser, ExternalLink, Loader2, MonitorPlay, Palette, Pipette, Play, RotateCcw, RotateCw, Send, SlidersHorizontal, Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { apiUrl } from '@/shared/api/http';
import { formatNumber } from '@/shared/lib/utils';

type Streamer = {
  channelUid: string;
  canonicalChannelUid?: string | null;
  channelName?: string | null;
  avatarUrl?: string | null;
  provider?: string | null;
  points: number;
  liveSurfaces?: LiveSurface[];
  drawingDonation: {
    pricingMode: 'fixed' | 'ink';
    costPoints: number;
    inkCostPerUnit: number;
    replayMaxSec: number;
    resultHoldSec: number;
    canvas: { widthRatio: number; heightRatio: number };
    blocked?: boolean;
    blockReason?: string | null;
  };
};

type LiveSurface = {
  provider: 'chzzk' | 'cime' | 'youtube' | string;
  channelId: string;
  channelName?: string | null;
  avatarUrl?: string | null;
  live?: boolean | null;
  watchUrl?: string;
  embedUrl?: string;
  hlsChannelId?: string;
  hlsSupported?: boolean;
  embeddable?: boolean;
};

type StrokePoint = { x: number; y: number; p: number; t: number };
type Stroke = { id: string; brush: BrushState; points: StrokePoint[] };
type BrushState = { type: 'pen' | 'crayon' | 'brush' | 'airbrush' | 'eraser'; color: string; alpha: number; size: number };

const colorSwatches = ['#ff6b9a', '#ffb86b', '#ffe66d', '#7bd88f', '#6bdcff', '#8f7dff', '#ffffff', '#111827'];
const brushLabels: Record<BrushState['type'], string> = {
  pen: '펜',
  crayon: '크레용',
  brush: '먹붓',
  airbrush: '에어브러시',
  eraser: '지우개',
};
const providerLabels: Record<string, string> = {
  chzzk: '치지직',
  cime: '씨미',
  youtube: 'YouTube',
};

function computeInkUsage(strokes: Stroke[]) {
  let rawInk = 0;
  for (const stroke of strokes) {
    const { brush, points } = stroke;
    if (!points.length) continue;
    const size = Math.max(0.002, Math.min(0.2, Number(brush.size || 0.012)));
    const alpha = brush.type === 'eraser' ? 1 : Math.max(0.05, Math.min(1, Number(brush.alpha || 1)));
    const toolFactor = brush.type === 'eraser' ? 0.35 : brush.type === 'airbrush' ? 1.25 : brush.type === 'brush' ? 1.1 : 1;
    if (points.length === 1) {
      rawInk += size * alpha * toolFactor * Math.max(0.5, Number(points[0].p || 1)) * 0.2;
      continue;
    }
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const point = points[i];
      const dx = point.x - prev.x;
      const dy = point.y - prev.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const pressure = Math.max(0.05, Math.min(2, ((prev.p || 1) + (point.p || 1)) / 2));
      rawInk += distance * size * alpha * pressure * toolFactor;
    }
  }
  return { raw: rawInk, units: Math.max(1, Math.ceil(rawInk * 1000)) };
}

function estimateDrawingCost(streamer: Streamer | null, strokes: Stroke[]) {
  if (!streamer || !strokes.length) return 0;
  if (streamer.drawingDonation.pricingMode === 'ink') {
    return Math.max(0, Math.ceil(computeInkUsage(strokes).units * Number(streamer.drawingDonation.inkCostPerUnit || 0)));
  }
  return Math.max(0, Math.floor(Number(streamer.drawingDonation.costPoints || 0)));
}

function ViewerShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen px-[var(--page-gutter)] py-[clamp(1rem,2.6vw,1.75rem)]">
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <Link href="/" className="inline-flex items-center gap-3 rounded-full bg-card/75 px-3 py-2 shadow-subtle backdrop-blur-xl transition hover:-translate-y-0.5">
          <img src="/files/logo.png" alt="" className="aspect-square w-[clamp(2rem,4vw,2.5rem)] object-contain" />
          <span className="text-sm font-semibold">AruBot</span>
        </Link>
        <div className="flex items-center gap-2">
          <LinkButton href="/viewer/me" variant="ghost">내 포인트</LinkButton>
          <ThemeToggle />
        </div>
      </header>
      {children}
    </main>
  );
}

async function loadStreamers() {
  const response = await fetch(apiUrl('/api/viewer/drawing-donation/streamers'), { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error('load failed');
  return response.json() as Promise<{ streamers: Streamer[] }>;
}

async function loadLivePlayback(surface: LiveSurface) {
  const provider = encodeURIComponent(surface.provider);
  const channelId = encodeURIComponent(surface.hlsChannelId || surface.channelId);
  const response = await fetch(apiUrl(`/api/drawing-donation/live-playback?provider=${provider}&channelId=${channelId}`), { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error('live playback unavailable');
  return response.json() as Promise<{ playbackUrl: string }>;
}

function traceDrawingPath(ctx: CanvasRenderingContext2D, points: StrokePoint[], width: number, height: number) {
  ctx.beginPath();
  ctx.moveTo(points[0].x * width, points[0].y * height);
  for (const point of points.slice(1)) ctx.lineTo(point.x * width, point.y * height);
}

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
  const drawPoint = (point: StrokePoint) => drawAirbrushDab(ctx, point.x * width, point.y * height, radius, color);
  drawPoint(points[0]);
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const point = points[index];
    const x0 = prev.x * width;
    const y0 = prev.y * height;
    const x1 = point.x * width;
    const y1 = point.y * height;
    const distance = Math.hypot(x1 - x0, y1 - y0);
    const count = Math.max(1, Math.ceil(distance / step));
    for (let i = 1; i <= count; i += 1) {
      const t = i / count;
      drawAirbrushDab(ctx, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, color);
    }
  }
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
      const seed = (index + 1) * 101 + i * 13 + Math.floor((prev.t + point.t) * 0.01);
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

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number, until = Infinity) {
  const points = stroke.points.filter((point) => point.t <= until);
  if (!points.length) return;
  const shortSide = Math.min(width, height);
  const baseAlpha = Math.max(0.03, Math.min(1, Number(stroke.brush.alpha || 1)));
  const baseLineWidth = Math.max(1, shortSide * stroke.brush.size);
  ctx.save();
  ctx.globalAlpha = stroke.brush.type === 'eraser' ? 1 : baseAlpha;
  ctx.globalCompositeOperation = stroke.brush.type === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.brush.color;
  ctx.lineWidth = baseLineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (stroke.brush.type === 'airbrush') {
    drawAirbrushPath(ctx, points, width, height, Math.max(1, shortSide * stroke.brush.size * 0.9), stroke.brush.color);
    ctx.restore();
    return;
  }
  if (stroke.brush.type === 'crayon') {
    drawCrayonPath(ctx, points, width, height, baseLineWidth, stroke.brush.color, baseAlpha);
    ctx.restore();
    return;
  }
  if (points.length === 1) {
    ctx.fillStyle = stroke.brush.color;
    ctx.beginPath();
    ctx.arc(points[0].x * width, points[0].y * height, Math.max(0.5, ctx.lineWidth / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  if (stroke.brush.type === 'brush') {
    drawInkBrushPath(ctx, points, width, height, baseLineWidth, stroke.brush.color, baseAlpha);
    ctx.restore();
    return;
  }
  traceDrawingPath(ctx, points, width, height);
  ctx.stroke();
  ctx.restore();
}

function shouldAppendDrawingPoint(stroke: Stroke, point: StrokePoint) {
  const previous = stroke.points[stroke.points.length - 1];
  if (!previous) return true;
  const dx = point.x - previous.x;
  const dy = point.y - previous.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const elapsed = point.t - previous.t;
  const minDistance = Math.max(0.0007, stroke.brush.size * 0.04);
  return distance >= minDistance || elapsed >= 32;
}

export function DrawingDonationEditorPage({ channelUid }: { channelUid: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const brushCursorRef = useRef<HTMLDivElement | null>(null);
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewAnimationRef = useRef<number | null>(null);
  const drawingFrameRef = useRef<number | null>(null);
  const drawingStartedAtRef = useRef(0);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const redoStackRef = useRef<Stroke[]>([]);
  const [streamer, setStreamer] = useState<Streamer | null>(null);
  const [selectedSurfaceKey, setSelectedSurfaceKey] = useState('');
  const [livePlaybackUrl, setLivePlaybackUrl] = useState('');
  const [livePlaybackStatus, setLivePlaybackStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [liveMuted, setLiveMuted] = useState(true);
  const [liveVolume, setLiveVolume] = useState(0.35);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoCount, setRedoCount] = useState(0);
  const [brush, setBrush] = useState<BrushState>({ type: 'pen', color: '#ff6b9a', alpha: 0.9, size: 0.012 });
  const [isPending, startTransition] = useTransition();

  const inkUsage = useMemo(() => computeInkUsage(strokes), [strokes]);
  const estimatedCost = useMemo(() => estimateDrawingCost(streamer, strokes), [streamer, strokes]);
  const canSubmit = streamer && !streamer.drawingDonation.blocked && strokes.length > 0 && streamer.points >= estimatedCost;
  const liveSurfaces = useMemo(() => streamer?.liveSurfaces || [], [streamer]);
  const selectedSurface = useMemo(() => {
    if (!liveSurfaces.length) return null;
    return liveSurfaces.find((surface) => `${surface.provider}:${surface.channelId}` === selectedSurfaceKey) || liveSurfaces.find((surface) => surface.live === true) || liveSurfaces[0];
  }, [liveSurfaces, selectedSurfaceKey]);

  const getCanvasTarget = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(rect.width * ratio));
    const height = Math.max(1, Math.floor(rect.height * ratio));
    let resized = false;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      resized = true;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    return { canvas, ctx, width, height, resized };
  }, []);

  const redraw = useCallback((nextStrokes = strokesRef.current) => {
    const target = getCanvasTarget();
    if (!target) return;
    target.ctx.clearRect(0, 0, target.width, target.height);
    for (const stroke of nextStrokes) drawStroke(target.ctx, stroke, target.width, target.height);
  }, [getCanvasTarget]);

  const renderAt = useCallback((atMs = Infinity) => {
    const target = getCanvasTarget();
    if (!target) return;
    target.ctx.clearRect(0, 0, target.width, target.height);
    for (const stroke of strokesRef.current) drawStroke(target.ctx, stroke, target.width, target.height, atMs);
  }, [getCanvasTarget]);

  const scheduleDrawingFrame = useCallback(() => {
    if (drawingFrameRef.current) return;
    drawingFrameRef.current = requestAnimationFrame(() => {
      drawingFrameRef.current = null;
      redraw(strokesRef.current);
    });
  }, [redraw]);

  const flushDrawingFrame = useCallback(() => {
    if (drawingFrameRef.current) {
      cancelAnimationFrame(drawingFrameRef.current);
      drawingFrameRef.current = null;
    }
    redraw(strokesRef.current);
  }, [redraw]);

  const updateBrushCursor = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const cursor = brushCursorRef.current;
    if (!cursor) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const cursorScale = brush.type === 'airbrush' ? 1.8 : brush.type === 'crayon' ? 1.25 : brush.type === 'brush' ? 1.45 : 1;
    const diameter = Math.max(8, Math.min(rect.width, rect.height) * brush.size * cursorScale);
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    cursor.style.width = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
    cursor.style.transform = `translate(${x - diameter / 2}px, ${y - diameter / 2}px)`;
    cursor.style.backgroundColor = brush.type === 'eraser' ? 'rgba(255,255,255,0.16)' : brush.color;
    cursor.style.borderColor = brush.type === 'eraser' ? 'rgba(15,23,42,0.78)' : 'rgba(15,23,42,0.55)';
    cursor.style.opacity = brush.type === 'eraser' ? '1' : String(Math.max(0.24, Math.min(0.72, brush.alpha)));
  }, [brush.alpha, brush.color, brush.size, brush.type]);

  const hideBrushCursor = useCallback(() => {
    if (brushCursorRef.current) brushCursorRef.current.style.opacity = '0';
  }, []);

  useEffect(() => {
    loadStreamers()
      .then((data) => {
        const found = (data.streamers || []).find((item) => item.channelUid === channelUid || item.canonicalChannelUid === channelUid);
        setStreamer(found || null);
        const surfaces = found?.liveSurfaces || [];
        const preferred = surfaces.find((surface) => surface.live === true) || surfaces[0];
        if (preferred) setSelectedSurfaceKey(`${preferred.provider}:${preferred.channelId}`);
      })
      .catch(() => toast.error('그림 후원 정보를 불러오지 못했어요.'));
  }, [channelUid]);

  useEffect(() => {
    redraw(strokesRef.current);
    const onResize = () => redraw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [redraw]);

  useEffect(() => () => {
    if (drawingFrameRef.current) cancelAnimationFrame(drawingFrameRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLivePlaybackUrl('');
    if (!selectedSurface?.hlsSupported) {
      setLivePlaybackStatus('idle');
      return () => {
        cancelled = true;
      };
    }
    setLivePlaybackStatus('loading');
    loadLivePlayback(selectedSurface)
      .then((payload) => {
        if (cancelled) return;
        setLivePlaybackUrl(payload.playbackUrl || '');
        setLivePlaybackStatus(payload.playbackUrl ? 'ready' : 'error');
      })
      .catch(() => {
        if (!cancelled) setLivePlaybackStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSurface]);

  useEffect(() => {
    const video = liveVideoRef.current;
    if (!video || !livePlaybackUrl) return undefined;
    let hls: Hls | null = null;
    let disposed = false;
    video.muted = liveMuted;
    video.volume = Math.max(0, Math.min(1, liveVolume));
    video.playsInline = true;
    const play = () => video.play().catch(() => undefined);
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = livePlaybackUrl;
      video.addEventListener('loadedmetadata', play, { once: true });
      return () => {
        video.removeEventListener('loadedmetadata', play);
        video.removeAttribute('src');
        video.load();
      };
    }
    import('hls.js')
      .then(({ default: Hls }) => {
        if (disposed || !Hls.isSupported()) {
          if (!disposed) setLivePlaybackStatus('error');
          return;
        }
        hls = new Hls({
          lowLatencyMode: true,
          enableWorker: true,
          backBufferLength: 30,
          liveSyncDurationCount: 3,
        });
        hls.loadSource(livePlaybackUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, play);
      })
      .catch(() => {
        if (!disposed) setLivePlaybackStatus('error');
      });
    return () => {
      disposed = true;
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [liveMuted, livePlaybackUrl, liveVolume]);

  useEffect(() => {
    const video = liveVideoRef.current;
    if (!video) return;
    video.muted = liveMuted;
    video.volume = Math.max(0, Math.min(1, liveVolume));
    if (!liveMuted) video.play().catch(() => undefined);
  }, [liveMuted, liveVolume]);

  const getPoint = (event: React.PointerEvent<HTMLCanvasElement>): StrokePoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    const t = drawingStartedAtRef.current ? Date.now() - drawingStartedAtRef.current : 0;
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      p: typeof event.pressure === 'number' && event.pressure > 0 ? event.pressure : 1,
      t,
    };
  };

  const startStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    updateBrushCursor(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!drawingStartedAtRef.current) drawingStartedAtRef.current = Date.now();
    redoStackRef.current = [];
    setRedoCount(0);
    const stroke: Stroke = { id: `s${Date.now()}`, brush: { ...brush }, points: [getPoint(event)] };
    activeStrokeRef.current = stroke;
    const next = [...strokesRef.current, stroke];
    strokesRef.current = next;
    setStrokes(next);
    flushDrawingFrame();
  };

  const moveStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    updateBrushCursor(event);
    const active = activeStrokeRef.current;
    if (!active) return;
    const point = getPoint(event);
    if (!shouldAppendDrawingPoint(active, point)) return;
    active.points.push(point);
    scheduleDrawingFrame();
  };

  const endStroke = () => {
    activeStrokeRef.current = null;
    flushDrawingFrame();
    setStrokes([...strokesRef.current]);
  };

  const createPreviewImage = () => {
    const source = canvasRef.current;
    if (!source) return null;
    const maxWidth = 512;
    const scale = Math.min(1, maxWidth / Math.max(1, source.width));
    const target = document.createElement('canvas');
    target.width = Math.max(1, Math.round(source.width * scale));
    target.height = Math.max(1, Math.round(source.height * scale));
    const ctx = target.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, target.width, target.height);
    return target.toDataURL('image/webp', 0.64);
  };

  const submit = () => {
    if (!streamer || !canSubmit) return;
    startTransition(async () => {
      try {
        const previewImage = createPreviewImage();
        const response = await fetch(apiUrl('/api/drawing-donation/submit'), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channelUid: streamer.channelUid, strokes, previewImage }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.message || payload?.error || 'submit failed');
        toast.success(payload?.item?.status === 'approved' ? '그림이 OBS 대기열에 들어갔어요.' : '그림을 보냈어요. 스트리머 승인 후 화면에 표시됩니다.');
        strokesRef.current = [];
        redoStackRef.current = [];
        setRedoCount(0);
        setStrokes([]);
        drawingStartedAtRef.current = 0;
        redraw([]);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'blocked_user') toast.error('이 방송에서는 봇 기능을 사용할 수 없습니다.');
        else if (message === 'drawing_queue_limit') toast.error('이 방송에 보낸 그림이 아직 대기 중이에요.');
        else if (message === 'drawing_submit_cooldown') toast.error('잠시 후 다시 보낼 수 있어요.');
        else if (message === 'insufficient_points') toast.error('포인트가 부족해요.');
        else toast.error('그림을 보내지 못했어요.');
      }
    });
  };

  const playPreview = () => {
    if (!strokesRef.current.length) return;
    if (previewAnimationRef.current) cancelAnimationFrame(previewAnimationRef.current);
    const maxT = Math.max(1000, ...strokesRef.current.flatMap((stroke) => stroke.points.map((point) => Number(point.t || 0))));
    const targetMs = Math.max(1000, Math.min(maxT, Number(streamer?.drawingDonation.replayMaxSec || 12) * 1000));
    const speed = maxT / targetMs;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startedAt;
      renderAt(elapsed >= targetMs ? Infinity : elapsed * speed);
      if (elapsed < targetMs) {
        previewAnimationRef.current = requestAnimationFrame(tick);
      } else {
        previewAnimationRef.current = null;
      }
    };
    renderAt(0);
    previewAnimationRef.current = requestAnimationFrame(tick);
  };

  const pickWithEyeDropper = async () => {
    const EyeDropperCtor = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!EyeDropperCtor) {
      toast.info('이 브라우저에서는 스포이드가 지원되지 않아요.');
      return;
    }
    try {
      const result = await new EyeDropperCtor().open();
      if (result?.sRGBHex) setBrush((current) => ({ ...current, color: result.sRGBHex }));
    } catch {
      // The user can cancel the picker.
    }
  };

  const aspect = streamer?.drawingDonation.canvas || { widthRatio: 16, heightRatio: 9 };
  const undo = () => {
    const last = strokesRef.current[strokesRef.current.length - 1];
    if (!last) return;
    const next = strokesRef.current.slice(0, -1);
    redoStackRef.current = [last, ...redoStackRef.current].slice(0, 50);
    setRedoCount(redoStackRef.current.length);
    strokesRef.current = next;
    setStrokes(next);
    redraw(next);
  };
  const redo = () => {
    const [nextStroke, ...rest] = redoStackRef.current;
    if (!nextStroke) return;
    const next = [...strokesRef.current, nextStroke];
    redoStackRef.current = rest;
    setRedoCount(rest.length);
    strokesRef.current = next;
    setStrokes(next);
    redraw(next);
  };

  return (
    <ViewerShell>
      <section className="mx-auto mt-[clamp(1rem,3vw,2rem)] max-w-7xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="ghost"><Link href={`/c/${encodeURIComponent(channelUid)}`}><ArrowLeft className="h-[1em] w-[1em]" /> 공개 페이지로</Link></Button>
          {streamer ? <Badge tone={streamer.points >= estimatedCost ? 'mint' : 'rose'}>{formatNumber(streamer.points)}P 보유 · 예상 {formatNumber(estimatedCost)}P</Badge> : null}
        </div>

        {liveSurfaces.length ? (
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-panel)] border bg-card/80 p-3 shadow-subtle">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground"><MonitorPlay className="h-[1em] w-[1em]" /> 그릴 방송 화면</span>
            {liveSurfaces.map((surface) => {
              const key = `${surface.provider}:${surface.channelId}`;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedSurfaceKey(key)}
                  className={`inline-flex min-h-[var(--control-height-sm)] items-center gap-2 rounded-full border px-3 text-xs font-semibold transition ${selectedSurfaceKey === key ? 'border-primary/40 bg-primary/12 text-primary' : 'bg-background/70 text-muted-foreground hover:border-primary/30 hover:text-foreground'}`}
                >
                  {providerLabels[surface.provider] || surface.provider}
                  {surface.live === true ? <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[0.65rem] text-white">LIVE</span> : null}
                </button>
              );
            })}
            {selectedSurface?.watchUrl ? (
              <Button asChild variant="ghost" size="sm">
                <a href={selectedSurface.watchUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-[1em] w-[1em]" /> 방송 열기</a>
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-[clamp(1rem,2vw,1.5rem)] lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.32fr)]">
          <div className="rounded-[var(--radius-panel)] border bg-card/80 p-[clamp(0.75rem,1.5vw,1rem)] shadow-subtle">
            <div className="relative mx-auto w-full overflow-hidden rounded-[var(--radius-card)] border bg-[linear-gradient(45deg,rgba(148,163,184,.12)_25%,transparent_25%),linear-gradient(-45deg,rgba(148,163,184,.12)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,rgba(148,163,184,.12)_75%),linear-gradient(-45deg,transparent_75%,rgba(148,163,184,.12)_75%)] bg-[length:2rem_2rem] bg-[position:0_0,0_1rem,1rem_-1rem,-1rem_0]" style={{ aspectRatio: `${aspect.widthRatio} / ${aspect.heightRatio}` }}>
              {selectedSurface?.hlsSupported ? (
                livePlaybackUrl ? (
                  <video
                    ref={liveVideoRef}
                    className="absolute inset-0 h-full w-full bg-black object-cover"
                    muted={liveMuted}
                    playsInline
                    autoPlay
                  />
                ) : (
                  <div className="absolute inset-0 grid place-items-center bg-black text-center text-sm text-white/72">
                    <span>{livePlaybackStatus === 'loading' ? '방송 화면을 불러오는 중입니다.' : '현재 재생 가능한 방송 화면을 찾지 못했어요.'}</span>
                  </div>
                )
              ) : selectedSurface?.embedUrl ? (
                <iframe
                  key={`${selectedSurface.provider}:${selectedSurface.channelId}`}
                  src={selectedSurface.embedUrl}
                  title={`${providerLabels[selectedSurface.provider] || selectedSurface.provider} 방송 화면`}
                  className="absolute inset-0 h-full w-full border-0 bg-black"
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_30%_20%,rgba(125,211,252,.28),transparent_34%),radial-gradient(circle_at_78%_20%,rgba(251,113,133,.22),transparent_30%),linear-gradient(135deg,rgba(15,23,42,.08),rgba(20,184,166,.08))] text-center text-sm text-muted-foreground">
                  <span>방송 화면 위에 올라갈 위치를 생각하며 그려주세요.</span>
                </div>
              )}
              {selectedSurface?.hlsSupported ? (
                <div className="absolute right-3 top-3 z-20 flex max-w-[min(18rem,calc(100%-1.5rem))] items-center gap-2 rounded-full border bg-card/88 px-2 py-1.5 shadow-subtle backdrop-blur-xl">
                  <Button type="button" size="icon" variant="ghost" onClick={() => setLiveMuted((current) => !current)} aria-label={liveMuted ? '방송 소리 켜기' : '방송 소리 끄기'}>
                    {liveMuted ? <VolumeX className="h-[1em] w-[1em]" /> : <Volume2 className="h-[1em] w-[1em]" />}
                  </Button>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(liveVolume * 100)}
                    onChange={(event) => {
                      const next = Math.max(0, Math.min(100, Number(event.target.value || 0))) / 100;
                      setLiveVolume(next);
                      if (next > 0) setLiveMuted(false);
                    }}
                    className="h-[var(--control-height-sm)] w-[clamp(5rem,12vw,8rem)] accent-primary"
                    aria-label="방송 배경 음량"
                  />
                </div>
              ) : null}
              <div className="pointer-events-none absolute inset-0 bg-background/10 dark:bg-black/20" />
              <canvas
                ref={canvasRef}
                className="relative z-10 h-full w-full touch-none cursor-none"
                onPointerDown={startStroke}
                onPointerMove={moveStroke}
                onPointerUp={endStroke}
                onPointerCancel={endStroke}
                onPointerEnter={updateBrushCursor}
                onPointerLeave={hideBrushCursor}
              />
              <div
                ref={brushCursorRef}
                aria-hidden="true"
                className="pointer-events-none absolute left-0 top-0 rounded-full border opacity-0 shadow-[0_0_0_0.18rem_rgba(255,255,255,0.55)] ring-1 ring-foreground/20 backdrop-blur-[0.02rem] transition-opacity duration-100 dark:shadow-[0_0_0_0.18rem_rgba(0,0,0,0.35)]"
              />
            </div>
            {selectedSurface && !selectedSurface.embeddable ? (
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {selectedSurface.hlsSupported
                  ? `${providerLabels[selectedSurface.provider] || selectedSurface.provider} 생방송은 기본 음소거로 시작합니다. 필요할 때만 소리를 켜고 위치를 맞춰보세요.`
                  : `${providerLabels[selectedSurface.provider] || selectedSurface.provider} 화면은 플랫폼 정책에 따라 일부 브라우저에서 직접 재생되지 않을 수 있습니다. 위치 기준은 동일하게 유지됩니다.`}
              </p>
            ) : null}
          </div>

          <Card className="bg-card/85">
            <CardHeader>
              <CardTitle>그리기 도구</CardTitle>
              <CardDescription>{streamer?.channelName || '방송'} 화면 위에 그대로 올라갑니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {(['pen', 'crayon', 'brush', 'airbrush', 'eraser'] as const).map((type) => (
                  <Button key={type} type="button" variant={brush.type === type ? 'default' : 'secondary'} onClick={() => setBrush((current) => ({ ...current, type }))}>
                    {type === 'eraser' ? <Eraser className="h-[1em] w-[1em]" /> : <Brush className="h-[1em] w-[1em]" />} {brushLabels[type]}
                  </Button>
                ))}
              </div>
              <label className="grid gap-2 text-sm font-semibold">
                <span className="inline-flex items-center gap-2"><Palette className="h-[1em] w-[1em]" /> 색상</span>
                <div className="flex min-w-0 gap-2">
                  <input type="color" value={brush.color} onChange={(event) => setBrush((current) => ({ ...current, color: event.target.value }))} className="min-h-[var(--control-height)] min-w-0 flex-1 rounded-[var(--radius-control)] border bg-background/80" />
                  <Button type="button" variant="secondary" size="icon" onClick={pickWithEyeDropper} aria-label="스포이드로 색상 선택">
                    <Pipette className="h-[1em] w-[1em]" />
                  </Button>
                </div>
                <div className="grid grid-cols-8 gap-1.5">
                  {colorSwatches.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`${color} 색상 선택`}
                      onClick={() => setBrush((current) => ({ ...current, color }))}
                      className="aspect-square rounded-full border shadow-subtle transition hover:scale-105"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                <span className="inline-flex items-center gap-2"><SlidersHorizontal className="h-[1em] w-[1em]" /> 투명도 {Math.round(brush.alpha * 100)}%</span>
                <input type="range" min="5" max="100" value={Math.round(brush.alpha * 100)} disabled={brush.type === 'eraser'} onChange={(event) => setBrush((current) => ({ ...current, alpha: Number(event.target.value) / 100 }))} />
                {brush.type === 'eraser' ? <span className="text-xs font-medium text-muted-foreground">지우개는 선택한 크기만큼 완전히 지웁니다.</span> : null}
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                붓 크기 {Math.round(brush.size * 1000) / 10}%
                <input type="range" min="2" max="200" value={Math.round(brush.size * 1000)} onChange={(event) => setBrush((current) => ({ ...current, size: Number(event.target.value) / 1000 }))} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="secondary" onClick={undo} disabled={!strokes.length}><RotateCcw className="h-[1em] w-[1em]" /> 되돌리기</Button>
                <Button type="button" variant="secondary" onClick={redo} disabled={redoCount <= 0}><RotateCw className="h-[1em] w-[1em]" /> 다시 실행</Button>
                <Button type="button" variant="secondary" className="col-span-2" onClick={playPreview} disabled={!strokes.length}><Play className="h-[1em] w-[1em]" /> 방송 화면 위에서 미리보기</Button>
                <Button type="button" variant="ghost" className="col-span-2" onClick={() => { strokesRef.current = []; redoStackRef.current = []; setRedoCount(0); setStrokes([]); drawingStartedAtRef.current = 0; redraw([]); }}><Eraser className="h-[1em] w-[1em]" /> 전체 지우기</Button>
              </div>
              <div className="rounded-[var(--radius-control)] border bg-background/70 p-3 text-sm leading-6">
                <div className="flex justify-between gap-3 font-semibold">
                  <span>예상 사용 포인트</span>
                  <span>{formatNumber(estimatedCost)}P</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {streamer?.drawingDonation.pricingMode === 'ink'
                    ? `잉크 ${formatNumber(inkUsage.units)}단위 기준으로 계산돼요. 제출 시 서버가 한 번 더 확인합니다.`
                    : '스트리머가 정한 고정 비용으로 계산돼요.'}
                </div>
              </div>
              <Button type="button" className="w-full" onClick={submit} disabled={!canSubmit || isPending}>
                {isPending ? <Loader2 className="h-[1em] w-[1em] animate-spin" /> : <Send className="h-[1em] w-[1em]" />} 그림 보내기
              </Button>
              {streamer?.drawingDonation.blocked ? <p className="text-sm text-muted-foreground">이 방송에서는 봇 기능을 사용할 수 없습니다.</p> : null}
            </CardContent>
          </Card>
        </div>
      </section>
    </ViewerShell>
  );
}
