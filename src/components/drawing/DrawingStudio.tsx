'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDown, ArrowUp, Check, Circle, Download, Eye, EyeOff, Hand, Heart, Layers, Loader2, Lock, Maximize, Minus, MousePointer2, PaintBucket, Pause, PenLine, Pipette, Play, Plus, Redo2, RotateCw, Save, Send, Slash, Square, Star, Trash2, Undo2, Unlock, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { DrawingArchiveDialog } from './DrawingArchiveDialog';
import { saveDrawingArchive } from '@/shared/drawing/archive-files';
import { apiUrl } from '@/shared/api/http';
import { readDraft, writeDraft } from '@/shared/drawing/draft-store';
import { BRUSH_SHORTCUTS, TOOL_SHORTCUTS, drawingShortcut, type DrawingTool as Tool } from '@/shared/drawing/shortcuts';
import { BRUSHES, RENDERER_VERSION, buildTimeline, createBrush, createDrawing, drawingCost, hashDrawing, rememberDrawingColor, validateDrawing, visibleStrokes, type BrushType, type DrawingDocument, type DrawingBrush, type DrawingPoint, type DrawingStroke, type DrawingShapeStyle, type DrawingOutlineStyle, type SelectionFrame, type SelectionRect } from '../../../shared/drawing/document.js';
import { createDrawingRenderer, floodFillRuns, type DrawingRenderer } from '../../../shared/drawing/renderer.js';
import { MAX_DOCUMENT_BYTES, MAX_ORIGINAL_BYTES, RECORDING_HEADROOM_BYTES, drawingJsonBytes, drawingUsage, updateDrawingUsage, drawingLimitError } from '../../../shared/drawing/limits.js';
import { constrainLinePoint, constrainShapePoint, distortSelection, rotateSelection, selectionCorners, selectionRect, transformSelection } from '../../../shared/drawing/selection.js';

export type DrawingStudioSettings = { pricingMode: string; costPoints: number; inkCostPerUnit: number; replayMaxSec: number; canvas: { widthRatio: number; heightRatio: number }; maxStrokes?: number; maxPoints?: number; blocked?: boolean };
type Props = { channelUid: string; viewerUserId: string; points: number; settings: DrawingStudioSettings; background?: ReactNode; onSubmitted?: (cost: number) => void; localOnly?: boolean };
type Selection = { rect: SelectionRect; frame: SelectionFrame; layerId: string; operationId: string | null };
const CLOSED_SHAPES = ['rectangle', 'ellipse', 'star', 'heart'];
const HANDLES = [ ['nw', '왼쪽 위', 0, 0], ['n', '위', 50, 0], ['ne', '오른쪽 위', 100, 0], ['e', '오른쪽', 100, 50], ['se', '오른쪽 아래', 100, 100], ['s', '아래', 50, 100], ['sw', '왼쪽 아래', 0, 100], ['w', '왼쪽', 0, 50] ] as const;
const pointCount = (doc: DrawingDocument) => doc.strokes.reduce((n, s) => n + s.points.length + (s.frames?.length || 0), 0);
const SWATCHES = ['#f05b84', '#eb5757', '#f3a43b', '#f3d457', '#68b984', '#39afc2', '#517ee1', '#9775ce', '#ffffff', '#191b20'];
const makeCanvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const uid = () => crypto.randomUUID();
const errorMessages: Record<string, string> = { too_many_points: '그리기 점 수 한도에 도달했습니다. 한도까지 그린 부분은 보존됩니다.', too_many_strokes: '획 수 한도에 도달했습니다.', drawing_too_large: '그리기 기록 용량 한도에 도달했습니다. 한도까지 그린 부분은 보존되며, 실행 취소나 레이어 삭제로 공간을 확보할 수 있습니다.', drawing_original_too_large: 'PNG 원본 이미지가 전송 용량 한도를 초과했습니다. 그림은 그대로 보존되어 있습니다.', drawing_too_complex: '선택 변형 기록 한도에 도달했습니다. 기존 그림은 보존됩니다.', drawing_fill_too_complex: '이 영역은 너무 복잡해 채울 수 없습니다.', insufficient_points: '포인트가 부족합니다.', drawing_price_changed: '후원 비용이 변경되었습니다. 정보를 새로 불러온 뒤 다시 확인해 주세요.', drawing_original_mismatch: '원본 일치 검증에 실패했습니다. 그림은 보존되어 있습니다.', drawing_storage_unavailable: '원본 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', blocked_user: '이 방송에서는 봇 기능을 사용할 수 없습니다.', drawing_queue_limit: '대기 중인 그림 후원이 너무 많습니다.', drawing_submit_cooldown: '잠시 후 다시 보내 주세요.' };
errorMessages.drawing_compression_failed = 'WebP 압축에 실패했습니다. 그림은 보존되어 있으며 포인트는 차감되지 않았습니다. 다시 시도해 주세요.';
errorMessages.drawing_webp_unsupported = '이 브라우저에서는 WebP 저장을 지원하지 않습니다. 최신 Chrome 또는 Edge에서 저장해 주세요.';

function BrushSample({ brush }: { brush: DrawingBrush }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const renderer = createDrawingRenderer(makeCanvas), doc = createDrawing(4, 1, 'sample');
    doc.width = 220; doc.height = 48;
    doc.strokes = [{ id: 'sample', layerId: 'layer-1', kind: 'freehand', seed: 3181, mirror: false, transform: { x: 0, y: 0, scale: 1 }, brush: { ...brush, color: brush.type === 'eraser' ? '#8b939f' : brush.color, type: brush.type === 'eraser' ? 'pen' : brush.type, size: brush.type === 'pencil' ? 0.07 : brush.type === 'airbrush' ? 0.48 : 0.26 },
      points: Array.from({ length: 36 }, (_, i) => ({ x: 0.08 + i / 35 * 0.84, y: 0.52 + Math.sin(i / 35 * Math.PI * 2) * 0.17, p: 0.15 + Math.sin(i / 35 * Math.PI) * 0.75, t: i * 25 })) }];
    ref.current?.getContext('2d')?.drawImage(renderer.render(doc), 0, 0);
    renderer.clear();
  }, [brush]);
  return <canvas ref={ref} width={220} height={48} className="h-6 w-full" aria-hidden="true" />;
}

function ToolHint({ label, shortcut }: { label: string; shortcut?: string }) {
  return <span className="inline-flex items-center gap-2"><span>{label}</span>{shortcut ? <kbd className="shrink-0 rounded border border-current/30 px-1 text-[11px]">{shortcut}</kbd> : null}</span>;
}

function IconButton({ label, shortcut, active, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; shortcut?: string; active?: boolean }) {
  return <Tooltip content={<ToolHint label={label} shortcut={shortcut} />}><button type="button" aria-label={label} aria-pressed={active === undefined ? undefined : active} {...props} className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors disabled:opacity-35 ${active ? 'border-primary bg-primary/10 text-primary' : 'border-transparent hover:bg-muted'} ${props.className || ''}`}>{children}</button></Tooltip>;
}

export function DrawingStudio({ channelUid, viewerUserId, points, settings, background, onSubmitted, localOnly = false }: Props) {
  const [doc, setDoc] = useState(() => createDrawing(settings.canvas.widthRatio, settings.canvas.heightRatio, 'new'));
  const docRef = useRef(doc), rendererRef = useRef<DrawingRenderer | null>(null);
  const [usage, setUsage] = useState(() => drawingUsage(doc)), usageRef = useRef(usage);
  const canvasRef = useRef<HTMLCanvasElement>(null), cursorRef = useRef<HTMLDivElement>(null), viewportRef = useRef<HTMLDivElement>(null);
  const [brush, setBrush] = useState(() => createBrush()), [tool, setTool] = useState<Tool>('freehand');
  const lastBrushRef = useRef(brush);
  const [layerId, setLayerId] = useState('layer-1'), [selection, setSelection] = useState<Selection | null>(null);
  const [selectedCorners, setSelectedCorners] = useState<number[]>([]);
  const [shapeStyle, setShapeStyle] = useState<DrawingShapeStyle>({ fillEnabled: false, fillColor: '#517ee1', fillAlpha: 1, strokeEnabled: true });
  const [outlineStyle, setOutlineStyle] = useState<DrawingOutlineStyle & { enabled: boolean }>({ enabled: false, size: 0.004, color: '#191b20', alpha: 1 });
  const [mirror, setMirror] = useState(false), [mirrorY, setMirrorY] = useState(false), [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const viewRef = useRef(view), [backgroundMode, setBackgroundMode] = useState<'live' | 'light' | 'dark'>('live');
  const historyRef = useRef<DrawingDocument[]>([]), redoRef = useRef<DrawingDocument[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0), [recentColors, setRecentColors] = useState<string[]>([]);
  const [favoriteColors, setFavoriteColors] = useState<string[]>([]);
  const [draftReady, setDraftReady] = useState(false), [draftStatus, setDraftStatus] = useState('초안 준비 중');
  const [recoverable, setRecoverable] = useState<DrawingDocument | null>(null), [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false), [playProgress, setPlayProgress] = useState(0);
  const animationRef = useRef(0), frameRef = useRef(0), originRef = useRef(0), airTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef<{ pointer: number; before: DrawingDocument; mode: 'draw' | 'pan' | 'marquee' | 'transform'; strokeId?: string; start: { x: number; y: number }; view: typeof view; selection?: Selection; handle?: string; corners?: number[]; toggleCorner?: number; rotation?: { last: number; total: number }; lineAnchor?: DrawingPoint; lineAngle?: number; moved?: boolean } | null>(null);
  const penPointerRef = useRef<number | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>()), pinchRef = useRef<{ distance: number; center: { x: number; y: number }; view: typeof view } | null>(null);
  const lastPointer = useRef<DrawingPoint | null>(null);
  const [review, setReview] = useState<{ doc: DrawingDocument; blob: Blob; url: string; hash: string; originalHash: string; cost: number; requestId: string } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null), previewRef = useRef<HTMLCanvasElement>(null);
  const draftKey = `${viewerUserId}:${channelUid}`;
  const cost = useMemo(() => drawingCost(doc, settings), [doc, settings]);
  const count = usage.pointCount;
  const timeline = useMemo(() => buildTimeline(doc, settings.replayMaxSec), [doc, settings.replayMaxSec]);
  const isShape = CLOSED_SHAPES.includes(tool);
  const canOutline = isShape || (['freehand', 'line'].includes(tool) && brush.type !== 'eraser');
  const activeLayer = doc.layers.find((layer) => layer.id === layerId);
  const presets = useMemo(() => Object.keys(BRUSHES).map((type) => createBrush(type as BrushType, brush.color)), [brush.color]);

  const renderer = useCallback(() => rendererRef.current ||= createDrawingRenderer(makeCanvas), []);
  const draw = useCallback((time = Infinity, source = docRef.current, preview = false) => {
    const canvas = preview ? previewRef.current : canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== source.width || canvas.height !== source.height) { canvas.width = source.width; canvas.height = source.height; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(renderer().render(source, time, settings.replayMaxSec), 0, 0);
  }, [renderer, settings.replayMaxSec]);

  const schedule = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => { frameRef.current = 0; draw(); setUsage(usageRef.current); });
  }, [draw]);
  const stopPlayback = useCallback(() => { cancelAnimationFrame(animationRef.current); animationRef.current = 0; setPlaying(false); setPlayProgress(0); draw(); }, [draw]);
  const assign = useCallback((next: DrawingDocument) => { docRef.current = next; usageRef.current = drawingUsage(next); setUsage(usageRef.current); setDoc(next); draw(Infinity, next); }, [draw]);
  const remember = useCallback((previous: DrawingDocument) => {
    historyRef.current = [...historyRef.current.slice(-29), previous]; redoRef.current = []; setHistoryVersion((n) => n + 1);
  }, []);
  const commit = useCallback((next: DrawingDocument) => {
    stopPlayback(); remember(docRef.current); assign({ ...next, revision: docRef.current.revision + 1 });
  }, [assign, remember, stopPlayback]);
  const report = useCallback((error: unknown) => toast.error(errorMessages[error instanceof Error ? error.message : ''] || '처리하지 못했습니다. 그림은 그대로 보존되어 있습니다.'), []);

  useEffect(() => {
    let cancelled = false;
    const next = createDrawing(settings.canvas.widthRatio, settings.canvas.heightRatio, uid());
    assign(next); historyRef.current = []; redoRef.current = []; setLayerId('layer-1'); setSelection(null); setRecoverable(null); setDraftReady(false);
    readDraft(draftKey).then((draft) => {
      if (cancelled || !draft) return;
      validateDrawing(draft.document, { maxStrokes: 1000, maxPoints: 50000 });
      if (draft.document.strokes.length) setRecoverable(draft.document);
    }).catch(() => { if (!cancelled) setDraftStatus('초안 저장소 확인 필요'); }).finally(() => { if (!cancelled) setDraftReady(true); });
    try { const colors = JSON.parse(localStorage.getItem(`drawing-used-colors:v2:${viewerUserId}`) || '[]'); if (Array.isArray(colors)) setRecentColors(colors.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 8)); } catch { /* Optional device preferences. */ }
    try { const colors = JSON.parse(localStorage.getItem(`drawing-favorites:${viewerUserId}`) || '[]'); if (Array.isArray(colors)) setFavoriteColors(colors.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 10)); } catch { /* Optional device preferences. */ }
    return () => { cancelled = true; };
  }, [assign, draftKey, settings.canvas.widthRatio, settings.canvas.heightRatio, viewerUserId]);

  useEffect(() => {
    if (!draftReady || recoverable || doc.id === 'new' || (!doc.revision && !doc.strokes.length)) return;
    setDraftStatus('저장 중');
    const timer = setTimeout(() => { writeDraft(draftKey, doc).then(() => setDraftStatus('이 기기에 저장됨')).catch(() => setDraftStatus('초안 저장 실패')); }, 500);
    return () => clearTimeout(timer);
  }, [doc, draftKey, draftReady, recoverable]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (docRef.current.strokes.length) { event.preventDefault(); event.returnValue = ''; } };
    const pageHide = () => { if (draftReady && !recoverable && (docRef.current.revision || docRef.current.strokes.length)) void writeDraft(draftKey, docRef.current).catch(() => undefined); };
    const checkpoint = setInterval(() => { if (activeRef.current?.strokeId) pageHide(); }, 2000);
    window.addEventListener('beforeunload', beforeUnload); window.addEventListener('pagehide', pageHide);
    return () => { clearInterval(checkpoint); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('pagehide', pageHide); };
  }, [draftKey, draftReady, recoverable]);

  useEffect(() => () => { cancelAnimationFrame(animationRef.current); cancelAnimationFrame(frameRef.current); if (airTimerRef.current) clearInterval(airTimerRef.current); rendererRef.current?.clear(); }, []);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { if (brush.type !== 'eraser') lastBrushRef.current = brush; }, [brush]);
  useEffect(() => { setSelection(null); setSelectedCorners([]); }, [layerId, tool]);
  useEffect(() => {
    if (review) { dialogRef.current?.showModal(); draw(Infinity, review.doc, true); }
    else dialogRef.current?.close();
    return () => { if (review) URL.revokeObjectURL(review.url); };
  }, [draw, review]);

  const undo = useCallback(() => {
    if (busy || activeRef.current) return;
    const previous = historyRef.current.pop(); if (!previous) return;
    stopPlayback(); redoRef.current.push(docRef.current); assign({ ...previous, revision: docRef.current.revision + 1 }); setHistoryVersion((n) => n + 1); setSelection(null);
  }, [assign, busy, stopPlayback]);
  const redo = useCallback(() => {
    if (busy || activeRef.current) return;
    const next = redoRef.current.pop(); if (!next) return;
    stopPlayback(); historyRef.current.push(docRef.current); assign({ ...next, revision: docRef.current.revision + 1 }); setHistoryVersion((n) => n + 1); setSelection(null);
  }, [assign, busy, stopPlayback]);
  function chooseTool(next: Tool) {
    if (activeRef.current || busy || review) return;
    if (next === 'freehand' && brush.type === 'eraser') setBrush({ ...lastBrushRef.current, color: brush.color });
    setTool(next); stopPlayback();
  }
  function chooseBrush(type: BrushType) {
    if (activeRef.current || busy || review) return;
    setBrush((current) => current.type === type ? current : { ...createBrush(type, current.color), alpha: current.alpha });
    setTool('freehand'); stopPlayback();
  }
  function handleShortcut(event: React.KeyboardEvent<HTMLDivElement>) {
    const shortcut = drawingShortcut(event.nativeEvent, busy || !!review || !!activeRef.current || !draftReady || !!recoverable);
    if (!shortcut) return;
    event.preventDefault(); event.stopPropagation();
    if (shortcut.action === 'tool') chooseTool(shortcut.tool);
    else if (shortcut.action === 'brush') chooseBrush(shortcut.brush);
    else if (shortcut.action === 'size') setBrush((current) => ({ ...current, size: Math.max(0.001, Math.min(0.2, (Math.round(current.size * 1000) + shortcut.delta) / 1000)) }));
    else if (shortcut.action === 'undo') undo();
    else if (shortcut.action === 'redo') redo();
    else { setSelection(null); setSelectedCorners([]); }
  }

  function chooseColor(color: string) {
    setBrush((b) => ({ ...b, color }));
  }
  function recordUsedColor(stroke?: DrawingStroke) {
    const colors = rememberDrawingColor(recentColors, stroke);
    if (colors === recentColors) return;
    setRecentColors(colors);
    try { localStorage.setItem(`drawing-used-colors:v2:${viewerUserId}`, JSON.stringify(colors)); } catch { /* Drawing remains available without storage. */ }
  }
  function toggleFavorite() {
    const colors = favoriteColors.includes(brush.color) ? favoriteColors.filter((color) => color !== brush.color) : [brush.color, ...favoriteColors].slice(0, 10);
    setFavoriteColors(colors);
    try { localStorage.setItem(`drawing-favorites:${viewerUserId}`, JSON.stringify(colors)); } catch { /* Device preference only. */ }
  }
  function zoomBy(factor: number) {
    const rect = viewportRef.current?.getBoundingClientRect(); if (!rect) return;
    setView((v) => { const zoom = Math.max(0.5, Math.min(4, v.zoom * factor)); return { zoom, x: rect.width / 2 - (rect.width / 2 - v.x) * zoom / v.zoom, y: rect.height / 2 - (rect.height / 2 - v.y) * zoom / v.zoom }; });
  }
  function point(event: Pick<PointerEvent, 'clientX' | 'clientY' | 'pressure' | 'pointerType' | 'timeStamp'>, clamp = true): DrawingPoint {
    const rect = canvasRef.current!.getBoundingClientRect();
    const clock = event.timeStamp > 1e12 ? performance.now() : event.timeStamp;
    if (!originRef.current) originRef.current = clock;
    const p = { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)), p: event.pointerType === 'pen' ? Math.max(0, Math.min(1, event.pressure)) : 0.65, t: Math.max(0, clock - originRef.current) };
    if (!clamp) { p.x = (event.clientX - rect.left) / rect.width; p.y = (event.clientY - rect.top) / rect.height; }
    const last = lastPointer.current;
    if (last && event.pointerType !== 'pen' && brush.type === 'brush') {
      const speed = Math.hypot((p.x - last.x) * docRef.current.width, (p.y - last.y) * docRef.current.height) / Math.max(1, p.t - last.t);
      p.p = 0.18 + 0.68 / (1 + speed * 0.7);
    }
    if (last && tool === 'freehand') {
      const blend = 1 - brush.smoothing * 0.75;
      p.x = last.x + (p.x - last.x) * blend; p.y = last.y + (p.y - last.y) * blend;
    }
    if (last) p.t = Math.max(last.t, p.t);
    return p;
  }
  function cursor(event: ReactPointerEvent<HTMLElement>) {
    const element = cursorRef.current, rect = viewportRef.current?.getBoundingClientRect(); if (!element || !rect) return;
    const canvasRect = canvasRef.current!.getBoundingClientRect();
    const diameter = Math.max(8, Math.min(canvasRect.width, canvasRect.height) * (brush.size * (brush.type === 'airbrush' ? 1.7 : 1) + (canOutline && outlineStyle.enabled && outlineStyle.alpha > 0 ? outlineStyle.size * 2 : 0)));
    element.style.width = `${diameter}px`; element.style.height = `${diameter}px`;
    element.style.transform = `translate(${event.clientX - rect.left - diameter / 2}px, ${event.clientY - rect.top - diameter / 2}px)`;
    element.style.opacity = ['pan', 'select'].includes(tool) || busy ? '0' : '1';
  }
  function recordStroke(stroke: DrawingStroke, byteDelta?: number) {
    const current = docRef.current, index = current.strokes.findIndex((s) => s.id === stroke.id);
    const nextUsage = updateDrawingUsage(usageRef.current, current.strokes[index], stroke, byteDelta);
    const error = drawingLimitError(nextUsage, settings, RECORDING_HEADROOM_BYTES);
    if (error) { toast.error(errorMessages[error]); return false; }
    const strokes = current.strokes.slice();
    if (index < 0) strokes.push(stroke); else strokes[index] = stroke;
    docRef.current = { ...current, rendererVersion: RENDERER_VERSION, strokes }; usageRef.current = nextUsage; schedule();
    return true;
  }
  function updateStroke(p: DrawingPoint, shift = false) {
    const active = activeRef.current; if (!active?.strokeId) return;
    const current = docRef.current, index = current.strokes.findIndex((s) => s.id === active.strokeId), stroke = current.strokes[index];
    if (!stroke) return;
    if (pointCount(current) >= (settings.maxPoints || 6000)) { finishStroke(); toast.error(errorMessages.too_many_points); return; }
    if (shift && stroke.kind === 'freehand') {
      active.lineAnchor ||= stroke.points.at(-1)!;
      const distance = Math.hypot((p.x - active.lineAnchor.x) * current.width, (p.y - active.lineAnchor.y) * current.height);
      if (distance > 2 || active.lineAngle !== undefined) {
        const constrained = constrainLinePoint(active.lineAnchor, p, current, active.lineAngle);
        p = constrained.point; active.lineAngle = constrained.angle;
      } else p = { ...p, x: active.lineAnchor.x, y: active.lineAnchor.y };
    } else { active.lineAnchor = undefined; active.lineAngle = undefined; }
    if (shift && CLOSED_SHAPES.includes(stroke.kind)) p = constrainShapePoint(stroke.points[0], p, current);
    if (shift && stroke.kind === 'line') p = constrainLinePoint(stroke.points[0], p, current).point;
    const points = [...stroke.points, p];
    if (!recordStroke({ ...stroke, points }, drawingJsonBytes(p) + 1)) { finishStroke(); return; }
    lastPointer.current = p;
  }

  function beginSelection(event: ReactPointerEvent<HTMLDivElement>) {
    if (!selection || activeRef.current || busy || review || recoverable || !activeLayer?.visible || activeLayer.locked || event.button !== 0) return;
    if (event.pointerType === 'touch' && penPointerRef.current !== null) return;
    if (event.pointerType === 'pen') penPointerRef.current = event.pointerId;
    const current = docRef.current;
    if (current.strokes.length >= (settings.maxStrokes || 120) || pointCount(current) + 3 > (settings.maxPoints || 6000)) { toast.error('그림 기록 한도에 도달했습니다.'); return; }
    if (selection.operationId && current.strokes.filter((s) => s.layerId === layerId).at(-1)?.id !== selection.operationId) { setSelection(null); return; }
    event.preventDefault(); event.stopPropagation(); canvasRef.current?.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); stopPlayback(); lastPointer.current = null;
    const p = point(event.nativeEvent, false), handle = (event.target as HTMLElement).closest('[data-selection-handle]')?.getAttribute('data-selection-handle') || 'move';
    const corner = ['nw', 'ne', 'se', 'sw'].indexOf(handle);
    let corners: number[] | undefined, toggleCorner: number | undefined;
    if (corner >= 0 && (event.ctrlKey || event.metaKey)) {
      corners = selectedCorners.includes(corner) ? selectedCorners : [...selectedCorners, corner];
      if (selectedCorners.includes(corner)) toggleCorner = corner;
      setSelectedCorners(corners);
    } else if (corner >= 0 && selectedCorners.includes(corner)) corners = selectedCorners;
    else if ((event.ctrlKey || event.metaKey) && ['n', 'e', 's', 'w'].includes(handle)) {
      corners = { n: [0, 1], e: [1, 2], s: [2, 3], w: [3, 0] }[handle as 'n' | 'e' | 's' | 'w']; setSelectedCorners(corners);
    } else setSelectedCorners([]);
    const frame = { ...selection.frame, t: p.t }, id = uid();
    // Only stored anchor points are bounded; transform gestures may start outside the canvas.
    const anchor = { ...p, x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) };
    const stroke: DrawingStroke = { id, layerId, seed: 0, kind: 'selection', brush: createBrush('pen'), mirror: false, transform: { x: 0, y: 0, scale: 1 }, points: [anchor, anchor], selection: { rect: selection.rect, sourceId: selection.operationId, copy: event.altKey && handle === 'move' }, frames: [frame] };
    if (!recordStroke(stroke)) { event.currentTarget.releasePointerCapture(event.pointerId); penPointerRef.current = null; return; }
    activeRef.current = { pointer: event.pointerId, before: current, mode: 'transform', strokeId: id, start: p, view: viewRef.current, selection, handle, corners, toggleCorner,
      rotation: { last: Math.atan2((p.y - frame.y) * current.height, (p.x - frame.x) * current.width), total: frame.angle } };
  }

  function updateSelection(p: DrawingPoint, shift: boolean) {
    const active = activeRef.current;
    if (!active?.selection || !active.strokeId) return;
    const current = docRef.current, index = current.strokes.findIndex((s) => s.id === active.strokeId), stroke = current.strokes[index];
    if (pointCount(current) >= (settings.maxPoints || 6000)) { finishStroke(); toast.error(errorMessages.too_many_points); return; }
    const base = active.selection.frame;
    let frame: SelectionFrame;
    if (active.corners) frame = distortSelection(base, active.selection.rect, active.corners, active.start, p, current);
    else if (active.handle === 'rotate') {
      const result = rotateSelection(base, active.rotation!, p, current, shift);
      frame = result.frame; active.rotation = result.rotation;
    } else frame = transformSelection(base, active.selection.rect, active.handle!, active.start, p, current, shift, shift);
    frame = { ...frame, t: Math.max(stroke.frames!.at(-1)!.t, p.t) };
    const last = { ...stroke.points[0], t: frame.t };
    const byteDelta = drawingJsonBytes(frame) + 1 + drawingJsonBytes(last) - drawingJsonBytes(stroke.points[1]);
    if (!recordStroke({ ...stroke, points: [stroke.points[0], last], frames: [...stroke.frames!, frame] }, byteDelta)) { finishStroke(); return; }
    active.moved ||= Math.hypot((p.x - active.start.x) * current.width, (p.y - active.start.y) * current.height) > 0.5;
    setSelection({ ...active.selection, frame, operationId: stroke.id });
  }
  function beginStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (busy || review || !draftReady || recoverable) return;
    if (event.pointerType === 'touch' && penPointerRef.current !== null) return;
    if (event.pointerType === 'touch') {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.current.size === 2) {
        if (activeRef.current) assign(activeRef.current.before);
        activeRef.current = null; if (airTimerRef.current) clearInterval(airTimerRef.current);
        const [a, b] = [...touches.current.values()];
        pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: viewRef.current };
        event.currentTarget.setPointerCapture(event.pointerId); return;
      }
    }
    if (activeRef.current || (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 1)) return;
    if (event.pointerType === 'pen') penPointerRef.current = event.pointerId;
    event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); stopPlayback(); cursor(event); lastPointer.current = null;
    const p = point(event.nativeEvent), current = docRef.current;
    if (tool === 'pan' || event.button === 1) { activeRef.current = { pointer: event.pointerId, before: current, mode: 'pan', start: { x: event.clientX, y: event.clientY }, view: viewRef.current }; return; }
    if (tool === 'picker') {
      const pixel = renderer().render(current).getContext('2d')!.getImageData(Math.min(current.width - 1, Math.floor(p.x * current.width)), Math.min(current.height - 1, Math.floor(p.y * current.height)), 1, 1).data;
      if (pixel[3]) chooseColor(`#${[pixel[0], pixel[1], pixel[2]].map((n) => n.toString(16).padStart(2, '0')).join('')}`);
      setTool('freehand'); return;
    }
    if (!activeLayer?.visible || activeLayer.locked) { toast.error('표시 중인 잠금 해제 레이어를 선택해 주세요.'); return; }
    if (tool === 'select') {
      setSelection(null); setSelectedCorners([]);
      activeRef.current = { pointer: event.pointerId, before: current, mode: 'marquee', start: p, view: viewRef.current }; return;
    }
    if (current.strokes.length >= (settings.maxStrokes || 120)) { toast.error(errorMessages.too_many_strokes); return; }
    if (pointCount(current) >= (settings.maxPoints || 6000)) { toast.error(errorMessages.too_many_points); return; }
    const stroke: DrawingStroke = { id: uid(), layerId, seed: crypto.getRandomValues(new Uint32Array(1))[0], brush: isShape ? { ...brush, type: 'pen' } : { ...brush }, kind: tool, mirror, mirrorY, transform: { x: 0, y: 0, scale: 1 }, points: [p], ...(isShape ? { shape: { ...shapeStyle } } : {}), ...(canOutline && outlineStyle.enabled ? { outline: { size: outlineStyle.size, color: outlineStyle.color, alpha: outlineStyle.alpha } } : {}) };
    if (tool === 'fill') {
      try {
        const layerCanvas = renderer().render(current, Infinity, settings.replayMaxSec, layerId);
        stroke.runs = floodFillRuns(layerCanvas.getContext('2d')!.getImageData(0, 0, current.width, current.height), Math.min(current.width - 1, Math.floor(p.x * current.width)), Math.min(current.height - 1, Math.floor(p.y * current.height)));
        stroke.brush = createBrush('pen', brush.color, brush.alpha);
        const error = drawingLimitError(updateDrawingUsage(usageRef.current, undefined, stroke), settings, RECORDING_HEADROOM_BYTES);
        if (error) throw new Error(error);
        const next = { ...current, strokes: [...current.strokes, stroke] }; validateDrawing(next, settings); commit(next); recordUsedColor(stroke);
      } catch (error) { report(error); }
      return;
    }
    if (!recordStroke(stroke)) { event.currentTarget.releasePointerCapture(event.pointerId); penPointerRef.current = null; return; }
    activeRef.current = { pointer: event.pointerId, before: current, mode: 'draw', strokeId: stroke.id, start: p, view: viewRef.current, ...(event.shiftKey ? { lineAnchor: p } : {}) };
    lastPointer.current = p;
    if (brush.type === 'airbrush' && tool === 'freehand') airTimerRef.current = setInterval(() => { if (activeRef.current && lastPointer.current) updateStroke({ ...lastPointer.current, t: Math.max(lastPointer.current.t, performance.now() - originRef.current) }); }, 45);
  }
  function moveStroke(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === 'touch' && penPointerRef.current !== null) return;
    cursor(event);
    if (event.pointerType === 'touch' && touches.current.has(event.pointerId)) touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinchRef.current && touches.current.size >= 2) {
      const [a, b] = [...touches.current.values()], base = pinchRef.current, rect = viewportRef.current!.getBoundingClientRect();
      const zoom = Math.max(0.5, Math.min(4, base.view.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, base.distance)));
      const cx = (a.x + b.x) / 2 - rect.left, cy = (a.y + b.y) / 2 - rect.top;
      setView({ zoom, x: cx - (base.center.x - rect.left - base.view.x) * zoom / base.view.zoom, y: cy - (base.center.y - rect.top - base.view.y) * zoom / base.view.zoom }); return;
    }
    const active = activeRef.current; if (!active || active.pointer !== event.pointerId) return;
    if (active.mode === 'pan') { setView({ ...active.view, x: active.view.x + event.clientX - active.start.x, y: active.view.y + event.clientY - active.start.y }); return; }
    if (active.mode === 'marquee') {
      const rect = selectionRect(active.start, point(event.nativeEvent), docRef.current);
      setSelection({ rect, layerId, operationId: null, frame: { t: 0, x: (rect.x + rect.width / 2) / docRef.current.width, y: (rect.y + rect.height / 2) / docRef.current.height, scaleX: 1, scaleY: 1, angle: 0 } }); return;
    }
    const native = event.nativeEvent, events = native.getCoalescedEvents?.() || [];
    for (const sample of events.length ? events : [native]) {
      if (!activeRef.current) break;
      if (active.mode === 'transform') updateSelection(point(sample, false), event.shiftKey);
      else updateStroke(point(sample), event.shiftKey);
    }
  }
  function finishStroke(event?: ReactPointerEvent<HTMLElement>, cancel = false) {
    if (!event || event.pointerId === penPointerRef.current) penPointerRef.current = null;
    if (event) { touches.current.delete(event.pointerId); if (touches.current.size < 2) pinchRef.current = null; }
    const active = activeRef.current; if (!active || (event && event.pointerId !== active.pointer)) return;
    if (airTimerRef.current) { clearInterval(airTimerRef.current); airTimerRef.current = null; }
    if (event && active.strokeId && !cancel && pointCount(docRef.current) < (settings.maxPoints || 6000)) {
      if (active.mode === 'transform') updateSelection(point(event.nativeEvent, false), event.shiftKey);
      else {
        const p = point(event.nativeEvent), stroke = docRef.current.strokes.find((s) => s.id === active.strokeId)!;
        p.p = event.pointerType === 'pen' && brush.type === 'brush' ? p.p : stroke.points.at(-1)!.p;
        updateStroke(p, event.shiftKey);
      }
      // A limit reached on pointer-up may already have committed the accepted part.
      if (activeRef.current !== active) return;
    }
    activeRef.current = null; lastPointer.current = null;
    if (cancel || (active.mode === 'transform' && !active.moved)) {
      assign(active.before); setSelection(active.selection || null);
      if (!cancel && active.toggleCorner !== undefined) setSelectedCorners((corners) => corners.filter((i) => i !== active.toggleCorner));
    } else if (active.strokeId) {
      try {
        validateDrawing(docRef.current, settings); remember(active.before); assign({ ...docRef.current, revision: active.before.revision + 1 });
        if (active.mode === 'draw') recordUsedColor(docRef.current.strokes.find((stroke) => stroke.id === active.strokeId));
      }
      catch (error) { assign(active.before); setSelection(active.selection || null); report(error); }
    }
    if (event && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function play(source = docRef.current, preview = false, originalSpeed = false) {
    cancelAnimationFrame(animationRef.current); setPlaying(true); const start = performance.now(), timing = buildTimeline(source, settings.replayMaxSec);
    const total = originalSpeed ? timing.sourceDurationMs : timing.targetReplayMs;
    const tick = (now: number) => {
      const elapsed = Math.min(total, now - start); setPlayProgress(elapsed / total);
      draw(elapsed >= total ? Infinity : originalSpeed ? elapsed / timing.speed : elapsed, source, preview);
      if (elapsed < total) animationRef.current = requestAnimationFrame(tick); else { setPlaying(false); animationRef.current = 0; }
    };
    animationRef.current = requestAnimationFrame(tick);
  }
  async function png(source = docRef.current) {
    const output = renderer().render(source);
    return await new Promise<Blob>((resolve, reject) => output.toBlob((blob) => blob ? resolve(blob) : reject(new Error('drawing_export_failed')), 'image/png'));
  }
  async function webp(source = docRef.current) {
    return new Promise<Blob>((resolve, reject) => renderer().render(source).toBlob((result) => result?.type === 'image/webp' ? resolve(result) : reject(new Error('drawing_webp_unsupported')), 'image/webp', 0.6));
  }
  async function download() {
    try {
      const blob = await webp();
      const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'arubot-drawing.webp'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { report(error); }
  }
  async function downloadArchive() {
    if (busy) return;
    stopPlayback(); setBusy(true);
    try { const source = structuredClone(docRef.current); await saveDrawingArchive(source, await webp(source), settings.replayMaxSec); }
    catch (error) { report(error); }
    finally { setBusy(false); }
  }
  async function openReview() {
    stopPlayback(); setBusy(true);
    try {
      const frozen = structuredClone(docRef.current); validateDrawing(frozen, settings);
      const blob = await png(frozen); if (blob.size > MAX_ORIGINAL_BYTES) throw new Error('drawing_original_too_large');
      const hash = await hashDrawing(frozen);
      const originalHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (n) => n.toString(16).padStart(2, '0')).join('');
      setReview({ doc: frozen, blob, url: URL.createObjectURL(blob), hash, originalHash, cost: drawingCost(frozen, settings), requestId: hash });
    } catch (error) { report(error); } finally { setBusy(false); }
  }
  async function submit() {
    if (!review || busy) return; setBusy(true); stopPlayback();
    try {
      if (localOnly) { toast.success('로컬 원본 검증 완료'); return; }
      const assetResponse = await fetch(apiUrl('/api/drawing-donation/originals'), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'image/png' }, body: review.blob });
      const asset = await assetResponse.json(); if (!assetResponse.ok) throw new Error(asset.error);
      if (asset.hash !== review.originalHash) throw new Error('drawing_original_mismatch');
      const response = await fetch(apiUrl('/api/drawing-donation/submit'), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': review.requestId }, body: JSON.stringify({ channelUid, document: review.doc, documentHash: review.hash, original: asset, expectedCost: review.cost, requestId: review.requestId }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error);
      if (payload.documentHash !== review.hash || payload.originalHash !== review.originalHash) throw new Error('drawing_original_mismatch');
      const empty = createDrawing(settings.canvas.widthRatio, settings.canvas.heightRatio, uid());
      historyRef.current = []; redoRef.current = []; originRef.current = 0; assign(empty); setLayerId('layer-1'); setSelection(null); setReview(null); onSubmitted?.(review.cost);
      await writeDraft(draftKey, null).catch(() => toast.warning('후원은 접수되었지만 이 기기의 초안을 삭제하지 못했습니다.'));
      toast.success('그림을 후원 대기열에 등록했습니다.');
    } catch (error) { report(error); } finally { setBusy(false); }
  }
  const corners = selection ? selectionCorners(selection.frame, selection.rect, doc) : null;
  const handlePositions = corners ? [corners[0], { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 }, corners[1], { x: (corners[1].x + corners[2].x) / 2, y: (corners[1].y + corners[2].y) / 2 }, corners[2], { x: (corners[2].x + corners[3].x) / 2, y: (corners[2].y + corners[3].y) / 2 }, corners[3], { x: (corners[3].x + corners[0].x) / 2, y: (corners[3].y + corners[0].y) / 2 }] : [];
  const tools: [Tool, string, typeof Hand][] = [['freehand', '자유 그리기', PenLine], ['pan', '화면 이동', Hand], ['select', '선택 및 이동', MousePointer2], ['line', '직선', Slash], ['rectangle', '사각형', Square], ['ellipse', '타원', Circle], ['fill', '영역 채우기', PaintBucket], ['star', '별 도장', Star], ['heart', '하트 도장', Heart]];

  return <div className="space-y-3" data-drawing-studio="v2" onKeyDown={handleShortcut}>
    {localOnly ? <Button size="sm" variant="ghost" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(docRef.current)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'drawing-original.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}><Download size={14} /> 원본 JSON</Button> : null}
    {recoverable && <div className="flex flex-wrap items-center justify-between gap-2 border-y bg-muted/50 p-3 text-sm"><span>저장된 그림이 있습니다.</span><div className="flex gap-2"><Button size="sm" onClick={() => { assign(recoverable); setLayerId(recoverable.layers[0].id); originRef.current = performance.now() - Math.max(0, ...recoverable.strokes.flatMap((s) => s.points.map((p) => p.t))); setRecoverable(null); }}>복구</Button><Button variant="ghost" size="sm" onClick={() => { if (window.confirm('저장된 초안을 삭제할까요?')) { setRecoverable(null); void writeDraft(draftKey, null); } }}>삭제</Button></div></div>}
    <div className="flex flex-wrap items-center justify-between gap-2 border-y py-2">
      <div className="flex flex-wrap gap-1">{tools.map(([id, label, Icon]) => <IconButton key={id} label={label} shortcut={TOOL_SHORTCUTS[id]} aria-keyshortcuts={TOOL_SHORTCUTS[id]} active={tool === id} onClick={() => chooseTool(id)}><Icon size={17} /></IconButton>)}<span className="mx-1 border-l" /><IconButton label="실행 취소" shortcut="Ctrl/Cmd + Z" aria-keyshortcuts="Control+Z Meta+Z" onClick={undo} disabled={!historyRef.current.length || busy} data-history={historyVersion}><Undo2 size={17} /></IconButton><IconButton label="다시 실행" shortcut="Ctrl/Cmd + Shift + Z" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y" onClick={redo} disabled={!redoRef.current.length || busy}><Redo2 size={17} /></IconButton></div>
      <div className="flex flex-wrap items-center gap-1"><IconButton label="축소" onClick={() => zoomBy(0.8)}><Minus size={17} /></IconButton><output className="w-12 text-center text-xs tabular-nums">{Math.round(view.zoom * 100)}%</output><IconButton label="확대" onClick={() => zoomBy(1.25)}><Plus size={17} /></IconButton><IconButton label="화면에 맞춤" onClick={() => setView({ zoom: 1, x: 0, y: 0 })}><Maximize size={17} /></IconButton><IconButton label="WebP 저장" onClick={download} disabled={!doc.strokes.length || busy}><Download size={17} /></IconButton><IconButton label="그리기 기록 저장 (.aruart)" onClick={downloadArchive} disabled={!doc.strokes.length || busy}><Save size={17} /></IconButton><DrawingArchiveDialog compact onOpen={stopPlayback} /></div>
    </div>
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="min-w-0 space-y-3">
        <div ref={viewportRef} className="relative isolate w-full overflow-hidden rounded-md border bg-muted" style={{ aspectRatio: `${doc.width}/${doc.height}` }}>
          <div className="absolute inset-0" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.zoom})`, transformOrigin: '0 0' }}>
            <div className="absolute inset-0" style={{ visibility: backgroundMode === 'live' ? 'visible' : 'hidden' }}>{background}</div>
            {backgroundMode !== 'live' || !background ? <div className="absolute inset-0" style={{ background: backgroundMode === 'dark' ? '#202124' : '#fafafa' }} /> : null}
            <canvas ref={canvasRef} width={doc.width} height={doc.height} tabIndex={0} aria-label="그림 캔버스" className={`relative z-10 h-full w-full touch-none ${tool === 'pan' ? 'cursor-grab' : tool === 'select' ? 'cursor-crosshair' : 'cursor-none'}`} onPointerDown={beginStroke} onPointerMove={moveStroke} onPointerUp={(event) => finishStroke(event)} onPointerCancel={(event) => finishStroke(event, true)} onPointerEnter={cursor} onPointerLeave={() => { if (cursorRef.current) cursorRef.current.style.opacity = '0'; }} />
            {corners && selection && tool === 'select' && !playing ? <div className="pointer-events-none absolute inset-0 z-20 touch-none" onPointerDown={beginSelection} onPointerMove={moveStroke} onPointerUp={(event) => finishStroke(event)} onPointerCancel={(event) => finishStroke(event, true)}>
              <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${doc.width} ${doc.height}`} preserveAspectRatio="none" aria-hidden="true"><polygon data-selection-handle="move" points={corners.map((p) => `${p.x},${p.y}`).join(' ')} fill="transparent" stroke="#0284c7" strokeWidth={1 / view.zoom} strokeDasharray={`${4 / view.zoom} ${3 / view.zoom}`} vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'all', cursor: 'move' }} /></svg>
              {HANDLES.map(([handle, label], index) => <button type="button" key={handle} data-selection-handle={handle} aria-label={`선택 ${label} 조절점`} aria-pressed={index % 2 === 0 ? selectedCorners.includes(index / 2) : undefined} title={`${label} 조절점 · Shift: 중심 고정 비율 조절 · Ctrl/Cmd: 왜곡`} className={`pointer-events-auto absolute h-3 w-3 touch-none border border-sky-600 ${index % 2 === 0 && selectedCorners.includes(index / 2) ? 'bg-sky-500' : 'bg-white'}`} style={{ left: `${handlePositions[index].x / doc.width * 100}%`, top: `${handlePositions[index].y / doc.height * 100}%`, transform: `translate(-50%,-50%) scale(${1 / view.zoom})`, cursor: index % 2 === 0 && selectedCorners.includes(index / 2) ? 'move' : `${handle}-resize` }} />)}
              <button type="button" data-selection-handle="rotate" aria-label="선택 회전" title="회전 · Shift: 15도 간격" className="pointer-events-auto absolute flex h-6 w-6 touch-none items-center justify-center rounded-full border border-sky-600 bg-white text-sky-700" style={{ left: `${handlePositions[1].x / doc.width * 100}%`, top: `${handlePositions[1].y / doc.height * 100}%`, transform: `translate(-50%,-50%) translate(${Math.sin(selection.frame.angle * Math.PI / 180) * 28 / view.zoom}px,${-Math.cos(selection.frame.angle * Math.PI / 180) * 28 / view.zoom}px) scale(${1 / view.zoom})`, cursor: 'grab' }}><RotateCw size={14} /></button>
            </div> : null}
          </div>
          <div ref={cursorRef} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 z-30 rounded-full border border-black bg-transparent opacity-0 shadow-[0_0_0_1px_#fff,inset_0_0_0_1px_#fff]"><span className="absolute left-1/2 top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1px_#000]" /></div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span role="status">{draftStatus}</span><span className="tabular-nums">{usage.strokeCount}/{settings.maxStrokes || 120}획 · {count.toLocaleString()}/{(settings.maxPoints || 6000).toLocaleString()}점</span><span className={`tabular-nums ${usage.jsonSize >= (MAX_DOCUMENT_BYTES - RECORDING_HEADROOM_BYTES) * 0.9 ? 'font-semibold text-rose-500' : ''}`}>기록 용량 {(usage.jsonSize / 1024 / 1024).toFixed(2)} / {(MAX_DOCUMENT_BYTES / 1024 / 1024).toFixed(0)} MB</span></div>
        <div className="flex flex-wrap items-center gap-2 border-y py-2"><div className="inline-flex rounded-md border p-0.5">{([['live', '방송'], ['light', '밝게'], ['dark', '어둡게']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={backgroundMode === value} onClick={() => setBackgroundMode(value)} className={`rounded px-3 py-1.5 text-xs ${backgroundMode === value ? 'bg-muted font-semibold' : ''}`}>{label}</button>)}</div><IconButton label={playing ? '미리보기 중지' : '방송 재생 미리보기'} onClick={() => playing ? stopPlayback() : play()} disabled={!visibleStrokes(doc).length}>{playing ? <Pause size={17} /> : <Play size={17} />}</IconButton><span className="text-xs tabular-nums">{(timeline.targetReplayMs / 1000).toFixed(1)}초 · {timeline.speed.toFixed(1)}배속 · 대기 제외</span><Button size="sm" variant="ghost" onClick={() => play(doc, false, true)} disabled={!doc.strokes.length}>원속도</Button></div>
        {playing ? <progress className="h-1 w-full accent-primary" value={playProgress} max={1} aria-label="재생 진행" /> : null}
        <section className="space-y-2" aria-label="레이어"><div className="flex items-center justify-between"><span className="inline-flex items-center gap-1 text-xs font-semibold"><Layers size={14} /> 레이어</span><IconButton label="레이어 추가" disabled={doc.layers.length >= 3} onClick={() => { const id = uid(); commit({ ...doc, layers: [...doc.layers, { id, name: `레이어 ${doc.layers.length + 1}`, visible: true, locked: false }] }); setLayerId(id); }}><Plus size={15} /></IconButton></div>{[...doc.layers].reverse().map((layer) => <div key={layer.id} className={`flex min-w-0 items-center gap-1 rounded-md border px-1 ${layer.id === layerId ? 'border-primary/50 bg-primary/5' : ''}`}><button type="button" className="h-9 min-w-0 flex-1 truncate px-2 text-left text-xs" onClick={() => setLayerId(layer.id)} onDoubleClick={() => { const name = window.prompt('레이어 이름', layer.name)?.trim().slice(0, 40); if (name) commit({ ...doc, layers: doc.layers.map((l) => l.id === layer.id ? { ...l, name } : l) }); }}>{layer.name}</button><IconButton label={layer.visible ? '레이어 숨기기' : '레이어 표시'} onClick={() => commit({ ...doc, layers: doc.layers.map((l) => l.id === layer.id ? { ...l, visible: !l.visible } : l) })}>{layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}</IconButton><IconButton label={layer.locked ? '잠금 해제' : '레이어 잠금'} onClick={() => commit({ ...doc, layers: doc.layers.map((l) => l.id === layer.id ? { ...l, locked: !l.locked } : l) })}>{layer.locked ? <Lock size={14} /> : <Unlock size={14} />}</IconButton>{([-1, 1] as const).map((direction) => <IconButton key={direction} label={direction === 1 ? '레이어 위로' : '레이어 아래로'} disabled={doc.layers.indexOf(layer) + direction < 0 || doc.layers.indexOf(layer) + direction >= doc.layers.length} onClick={() => { const layers = [...doc.layers], index = layers.indexOf(layer); [layers[index], layers[index + direction]] = [layers[index + direction], layers[index]]; commit({ ...doc, layers }); }}>{direction === 1 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}</IconButton>)}<IconButton label="레이어 삭제" disabled={doc.layers.length <= 1 || layer.locked} onClick={() => { if (window.confirm('이 레이어의 그림을 삭제할까요?')) { const layers = doc.layers.filter((l) => l.id !== layer.id); commit({ ...doc, layers, strokes: doc.strokes.filter((s) => s.layerId !== layer.id) }); setLayerId(layers[0].id); } }}><Trash2 size={14} /></IconButton></div>)}</section>
        {selection && tool === 'select' ? <div className="flex flex-wrap items-center gap-3 border-y py-2 text-xs tabular-nums"><span>{Math.round(selection.rect.width * selection.frame.scaleX)} × {Math.round(selection.rect.height * selection.frame.scaleY)}px</span><span>{selection.frame.angle.toFixed(1)}°</span><IconButton label="선택 해제" shortcut="Esc" aria-keyshortcuts="Escape" onClick={() => { setSelection(null); setSelectedCorners([]); }}><X size={16} /></IconButton></div> : null}
      </div>
      <aside className="min-w-0 space-y-4 lg:border-l lg:pl-4" aria-label="브러시 설정">
        {isShape ? <section className="space-y-3 border-y py-3" aria-label="도형 채움 설정">
          <label className="flex items-center justify-between text-xs">선 표시<input type="checkbox" checked={shapeStyle.strokeEnabled} onChange={(e) => setShapeStyle({ ...shapeStyle, strokeEnabled: e.target.checked })} /></label>
          <label className="flex items-center justify-between text-xs">채우기<input type="checkbox" checked={shapeStyle.fillEnabled} onChange={(e) => setShapeStyle({ ...shapeStyle, fillEnabled: e.target.checked })} /></label>
          <label className="flex items-center justify-between gap-3 text-xs">채움 색상<input aria-label="채움 색상" type="color" value={shapeStyle.fillColor} onChange={(e) => setShapeStyle({ ...shapeStyle, fillColor: e.target.value })} className="h-8 w-20 rounded border bg-transparent" /></label>
          <label className="grid gap-1.5 text-xs"><span className="flex justify-between"><span>채움 불투명도</span><span>{Math.round(shapeStyle.fillAlpha * 100)}%</span></span><input aria-label="채움 불투명도" type="range" min={0} max={100} value={Math.round(shapeStyle.fillAlpha * 100)} onChange={(e) => setShapeStyle({ ...shapeStyle, fillAlpha: Number(e.target.value) / 100 })} className="w-full accent-primary" /></label>
        </section> : null}
        <div className="grid grid-cols-3 gap-1.5">{presets.map((preset) => <Tooltip key={preset.type} content={<ToolHint label={BRUSHES[preset.type].label} shortcut={BRUSH_SHORTCUTS[preset.type]} />}><button type="button" aria-keyshortcuts={BRUSH_SHORTCUTS[preset.type]} aria-pressed={brush.type === preset.type} onClick={() => chooseBrush(preset.type)} className={`min-w-0 rounded-md border px-1 py-2 ${brush.type === preset.type ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}><BrushSample brush={preset} /><span className="block truncate text-[11px] font-medium">{BRUSHES[preset.type].label}</span></button></Tooltip>)}</div>
        <div className="space-y-2">{isShape ? <span className="text-xs font-medium">선 색상</span> : null}<div className="flex items-center gap-2"><input aria-label={isShape ? '선 색상' : '붓 색상'} type="color" value={brush.color} onChange={(e) => chooseColor(e.target.value)} className="h-9 min-w-0 flex-1 rounded-md border bg-transparent" /><IconButton label="그림에서 색 추출" shortcut={TOOL_SHORTCUTS.picker} aria-keyshortcuts={TOOL_SHORTCUTS.picker} active={tool === 'picker'} onClick={() => chooseTool('picker')}><Pipette size={17} /></IconButton></div><div className="grid grid-cols-10 gap-1">{SWATCHES.map((color) => <button type="button" key={color} title={color} aria-label={`${color} 색상`} onClick={() => chooseColor(color)} className="aspect-square rounded-sm border border-foreground/20" style={{ backgroundColor: color }} />)}</div>{recentColors.length ? <div className="flex gap-1" aria-label="최근 색상">{recentColors.map((color) => <button type="button" key={color} title={color} aria-label={`최근 ${color}`} onClick={() => chooseColor(color)} className="h-5 w-5 rounded-sm border border-foreground/20" style={{ backgroundColor: color }} />)}</div> : null}</div>
        <div className="flex flex-wrap items-center gap-1" aria-label="즐겨찾는 색상"><IconButton label="현재 색상 즐겨찾기" active={favoriteColors.includes(brush.color)} onClick={toggleFavorite}><Star size={15} fill={favoriteColors.includes(brush.color) ? 'currentColor' : 'none'} /></IconButton>{favoriteColors.map((color) => <button type="button" key={color} title={color} aria-label={`즐겨찾기 ${color}`} onClick={() => chooseColor(color)} className="h-5 w-5 rounded-sm border border-foreground/20" style={{ backgroundColor: color }} />)}</div>
        {([{ key: 'size', label: isShape ? '선 두께' : '크기', min: 1, max: 200, scale: 1000, suffix: '' }, { key: 'alpha', label: isShape ? '선 불투명도' : '불투명도', min: 0, max: 100, scale: 100, suffix: '%' }, { key: 'smoothing', label: '선 보정', min: 0, max: 85, scale: 100, suffix: '%' }] as const).filter(({ key }) => !isShape || key !== 'smoothing').map(({ key, label, min, max, scale, suffix }) => <Tooltip key={key} content={<ToolHint label={label} shortcut={key === 'size' ? '[ / ]' : undefined} />}><label className="grid gap-1.5 text-xs"><span className="flex justify-between"><span>{label}</span><span className="tabular-nums">{Math.round(brush[key] * scale)}{suffix}</span></span><input aria-label={label} type="range" min={min} max={max} value={Math.round(brush[key] * scale)} onChange={(e) => setBrush({ ...brush, [key]: Number(e.target.value) / scale })} className="w-full accent-primary" /></label></Tooltip>)}
        {canOutline ? <section className="space-y-3 border-y py-3" aria-label="외곽선 설정">
          <label className="flex items-center justify-between text-xs font-medium">외곽선<input aria-label="외곽선 사용" type="checkbox" checked={outlineStyle.enabled} onChange={(e) => { const enabled = e.target.checked; setOutlineStyle((current) => ({ ...current, enabled })); }} /></label>
          <fieldset disabled={!outlineStyle.enabled} className="min-w-0 space-y-3 disabled:opacity-40">
            <label className="flex items-center justify-between gap-3 text-xs">외곽선 색상<input aria-label="외곽선 색상" type="color" value={outlineStyle.color} onInput={(e) => { const color = e.currentTarget.value; setOutlineStyle((current) => ({ ...current, color })); }} className="h-8 w-20 rounded border bg-transparent" /></label>
            <label className="grid gap-1.5 text-xs"><span className="flex justify-between"><span>외곽선 두께</span><span className="tabular-nums">{Math.round(outlineStyle.size * 1000)}</span></span><input aria-label="외곽선 두께" type="range" min={1} max={100} value={Math.round(outlineStyle.size * 1000)} onChange={(e) => { const size = Number(e.target.value) / 1000; setOutlineStyle((current) => ({ ...current, size })); }} className="w-full accent-primary" /></label>
            <label className="grid gap-1.5 text-xs"><span className="flex justify-between"><span>외곽선 불투명도</span><span className="tabular-nums">{Math.round(outlineStyle.alpha * 100)}%</span></span><input aria-label="외곽선 불투명도" type="range" min={0} max={100} value={Math.round(outlineStyle.alpha * 100)} onChange={(e) => { const alpha = Number(e.target.value) / 100; setOutlineStyle((current) => ({ ...current, alpha })); }} className="w-full accent-primary" /></label>
          </fieldset>
        </section> : null}
        <div className="space-y-2 border-y py-3"><label className="flex items-center justify-between text-xs">좌우 대칭<input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /></label><label className="flex items-center justify-between text-xs">상하 대칭<input type="checkbox" checked={mirrorY} onChange={(e) => setMirrorY(e.target.checked)} /></label></div>
        {!isShape ? <details className="border-y py-2"><summary className="cursor-pointer text-xs font-medium">재질 설정</summary><div className="mt-3 space-y-3">{(['texture', 'hardness', 'flow', 'angle'] as const).filter((key) => key === 'texture' ? !['pen', 'airbrush', 'eraser'].includes(brush.type) : key === 'hardness' ? brush.type === 'airbrush' : key === 'angle' ? ['marker', 'highlighter'].includes(brush.type) : ['airbrush', 'watercolor', 'highlighter'].includes(brush.type)).map((key) => <label key={key} className="grid gap-1 text-xs">{{ texture: brush.type === 'brush' ? '마른 붓결' : '종이 질감', hardness: '분사 경도', flow: '재질 농도', angle: '펜촉 각도' }[key]}<input type="range" min={key === 'flow' ? 5 : 0} max={key === 'angle' ? 180 : 100} value={brush[key] * (key === 'angle' ? 1 : 100)} onChange={(e) => setBrush({ ...brush, [key]: Number(e.target.value) / (key === 'angle' ? 1 : 100) })} /></label>)}<Button size="sm" variant="ghost" onClick={() => setBrush(createBrush(brush.type, brush.color))}>브러시 초기화</Button></div></details> : null}
        <div className="flex items-center justify-between text-sm"><span>사용 포인트</span><strong className={cost > points ? 'text-rose-500' : ''}>{cost.toLocaleString()}P</strong></div><div className="text-right text-xs text-muted-foreground">보유 {points.toLocaleString()}P</div>
        <Button className="w-full" onClick={openReview} disabled={busy || !visibleStrokes(doc).some((s) => s.brush.type !== 'eraser') || cost > points || settings.blocked || !!recoverable}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} 그림 보내기</Button>
        <Button variant="ghost" className="w-full" onClick={() => { if (window.confirm('그림을 모두 지울까요? 실행 취소로 복원할 수 있습니다.')) { commit({ ...doc, strokes: [] }); setSelection(null); } }} disabled={!doc.strokes.length || busy}><Trash2 size={15} /> 전체 지우기</Button>
        {settings.blocked ? <p className="text-xs text-rose-500">이 방송에서는 후원할 수 없습니다.</p> : null}
      </aside>
    </div>
    {!localOnly ? <p className="text-xs text-muted-foreground">그림과 재생 기록은 접수 후 30일이 지나면 자동 정리됩니다. 대기 중인 후원은 취소·환불됩니다.</p> : null}
    <dialog ref={dialogRef} onCancel={(e) => { if (busy) e.preventDefault(); else { stopPlayback(); setReview(null); } }} onClose={() => { if (!busy) setReview(null); }} className="m-auto max-h-[calc(100dvh-2rem)] w-[min(44rem,calc(100%-2rem))] overflow-y-auto rounded-lg border bg-background p-4 text-foreground shadow-xl backdrop:bg-black/60">
      {review ? <><div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">전송할 그림 원본</h2><IconButton label="닫기" disabled={busy} onClick={() => { stopPlayback(); setReview(null); }}><X size={18} /></IconButton></div><canvas ref={previewRef} width={review.doc.width} height={review.doc.height} className="w-full rounded-md border bg-white" style={{ aspectRatio: `${review.doc.width}/${review.doc.height}` }} /><div className="my-3 flex items-center justify-between gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => playing ? (cancelAnimationFrame(animationRef.current), setPlaying(false), draw(Infinity, review.doc, true)) : play(review.doc, true)}>{playing ? <Pause size={15} /> : <Play size={15} />} 재생 확인</Button><span className="text-sm font-semibold">{review.cost.toLocaleString()}P</span></div><div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => { stopPlayback(); setReview(null); }}>수정</Button><Button onClick={submit} disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} 이 그림 보내기</Button></div></> : null}
    </dialog>
  </div>;
}
