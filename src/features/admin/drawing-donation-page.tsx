'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Ban, Check, Copy, Eraser, Eye, GripVertical, ImagePlus, Play, RefreshCw, RotateCw, Settings, ShieldAlert, Trash2, Undo2, Wifi, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiUrl, apiWsUrl } from '@/shared/api/http';
import { formatNumber } from '@/shared/lib/utils';

type DrawingSettings = {
  enabled: boolean;
  pricingMode: 'fixed' | 'ink';
  costPoints: number;
  inkCostPerUnit: number;
  approvalMode: 'manual' | 'auto';
  replayMaxSec: number;
  resultHoldSec: number;
  maxStrokes: number;
  maxPoints: number;
  submitCooldownSec: number;
  perUserQueueLimit: number;
  canvas: { widthRatio: number; heightRatio: number };
};

type DrawingItem = {
  id: string;
  status: string;
  cost: number;
  viewerName?: string | null;
  viewerUserId?: string | null;
  previewImage?: string | null;
  strokes?: AdminStroke[];
  canvas?: { widthRatio?: number; heightRatio?: number };
  metrics?: { strokeCount?: number; pointCount?: number; ink?: { units?: number; raw?: number } };
  replay?: { targetReplayMs?: number; speed?: number };
  createdAt?: string;
};

type AdminStrokePoint = { x: number; y: number; t?: number; replayT?: number };
type AdminStroke = { brush?: { type?: string; color?: string; alpha?: number; size?: number }; points?: AdminStrokePoint[] };

type QueuePayload = {
  items?: DrawingItem[];
  reason?: string;
  queueSize?: number;
};

type BlockedUser = {
  userId: string;
  username?: string | null;
  reason?: string | null;
  createdAt?: string;
};

const defaultSettings: DrawingSettings = {
  enabled: false,
  pricingMode: 'fixed',
  costPoints: 100,
  inkCostPerUnit: 1,
  approvalMode: 'manual',
  replayMaxSec: 12,
  resultHoldSec: 8,
  maxStrokes: 120,
  maxPoints: 6000,
  submitCooldownSec: 20,
  perUserQueueLimit: 3,
  canvas: { widthRatio: 16, heightRatio: 9 },
};

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path), { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error(path);
  return response.json();
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(path);
  return response.json();
}

function drawAdminStroke(ctx: CanvasRenderingContext2D, stroke: AdminStroke, width: number, height: number, atMs = Infinity) {
  const points = (stroke.points || []).filter((point) => Number(point.replayT ?? point.t ?? 0) <= atMs);
  if (!points.length) return;
  const brush = stroke.brush || {};
  const shortSide = Math.min(width, height);
  const lineWidth = Math.max(1, shortSide * Math.max(0.002, Math.min(0.08, Number(brush.size ?? 0.012) || 0.012)));
  ctx.save();
  ctx.globalAlpha = brush.type === 'eraser' ? 1 : Math.max(0.05, Math.min(1, Number(brush.alpha ?? 1) || 1));
  ctx.globalCompositeOperation = brush.type === 'eraser' ? 'destination-out' : brush.type === 'highlighter' ? 'multiply' : 'source-over';
  ctx.strokeStyle = String(brush.color || '#ff6b9a');
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (points.length === 1) {
    ctx.fillStyle = String(brush.color || '#ff6b9a');
    ctx.beginPath();
    ctx.arc(points[0].x * width, points[0].y * height, Math.max(0.5, lineWidth / 2), 0, Math.PI * 2);
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

function buildAdminReplayStrokes(item: DrawingItem | null) {
  if (!item?.strokes?.length) return [];
  const speed = Math.max(0.01, Number(item.replay?.speed || 1) || 1);
  let cursor = 0;
  return item.strokes.map((stroke) => {
    let previousT: number | null = null;
    const points = (stroke.points || []).map((point, index) => {
      const t = Math.max(0, Number(point.t || 0));
      if (index > 0 && previousT != null) cursor += Math.min(120, Math.max(0, t - previousT)) / speed;
      previousT = t;
      return { ...point, replayT: cursor };
    });
    return { ...stroke, points };
  });
}

export function DrawingDonationPage() {
  const [settings, setSettings] = useState<DrawingSettings>(defaultSettings);
  const [items, setItems] = useState<DrawingItem[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [viewerPath, setViewerPath] = useState('');
  const [blockForm, setBlockForm] = useState({ userId: '', username: '', reason: '' });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reviewItem, setReviewItem] = useState<DrawingItem | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [realtimeState, setRealtimeState] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const reviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const reviewAnimationRef = useRef<number | null>(null);
  const [isPending, startTransition] = useTransition();

  const overlayUrl = useMemo(() => {
    if (!viewerPath || typeof window === 'undefined') return viewerPath;
    return `${window.location.origin}${viewerPath}`;
  }, [viewerPath]);

  const applyQueuePayload = useCallback((payload: QueuePayload | null) => {
    if (payload?.items) setItems(payload.items);
  }, []);

  const refresh = useCallback(async () => {
    const [settingsPayload, queuePayload, blockPayload, viewerPayload] = await Promise.all([
      readJson<{ settings: DrawingSettings }>('/api/drawing-donation/settings'),
      readJson<{ items: DrawingItem[] }>('/api/drawing-donation/queue'),
      readJson<{ items: BlockedUser[] }>('/api/bot/blocked-users'),
      readJson<{ path: string }>('/api/drawing-donation/viewer-url'),
    ]);
    setSettings({ ...defaultSettings, ...settingsPayload.settings, canvas: { ...defaultSettings.canvas, ...settingsPayload.settings?.canvas } });
    setItems(queuePayload.items || []);
    setBlockedUsers(blockPayload.items || []);
    setViewerPath(viewerPayload.path || '');
  }, []);

  useEffect(() => {
    refresh().catch(() => toast.error('그림 후원 정보를 불러오지 못했어요.'));
  }, [refresh]);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | undefined;
    let ws: WebSocket | null = null;

    const connect = () => {
      if (disposed) return;
      setRealtimeState('connecting');
      try {
        ws = new WebSocket(apiWsUrl('/api/drawing-donation/admin/ws'));
        ws.onopen = () => setRealtimeState('connected');
        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(String(event.data || '{}')) as QueuePayload & { type?: string };
            if (payload.type === 'drawing-donation.queue') applyQueuePayload(payload);
          } catch {
            // Ignore malformed realtime payloads.
          }
        };
        ws.onclose = () => {
          if (disposed) return;
          setRealtimeState('disconnected');
          reconnectTimer = window.setTimeout(connect, 1800);
        };
        ws.onerror = () => {
          try { ws?.close(); } catch {}
        };
      } catch {
        setRealtimeState('disconnected');
        reconnectTimer = window.setTimeout(connect, 1800);
      }
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      try { ws?.close(); } catch {}
    };
  }, [applyQueuePayload]);

  const saveSettings = () => {
    startTransition(async () => {
      try {
        const payload = await postJson<{ settings: DrawingSettings }>('/api/drawing-donation/settings', settings);
        setSettings(payload.settings);
        toast.success('그림 후원 설정을 저장했어요.');
      } catch {
        toast.error('그림 후원 설정을 저장하지 못했어요.');
      }
    });
  };

  const runItemAction = (path: string, id: string, message: string) => {
    startTransition(async () => {
      try {
        await postJson(path, { id });
        toast.success(message);
        await refresh();
      } catch {
        toast.error('요청을 처리하지 못했어요.');
      }
    });
  };

  const removeItem = (item: DrawingItem, refund: boolean) => {
    const label = item.viewerName || item.viewerUserId || '시청자 그림';
    const action = refund ? '삭제하고 포인트를 반환할까요?' : '대기열에서 삭제할까요?';
    if (!window.confirm(`${label} 항목을 ${action}`)) return;
    setBusyId(item.id);
    startTransition(async () => {
      try {
        await postJson(refund ? '/api/drawing-donation/delete-refund' : '/api/drawing-donation/delete', { id: item.id });
        toast.success(refund ? '삭제하고 포인트를 반환했어요.' : '항목을 삭제했어요.');
        await refresh();
      } catch {
        toast.error('요청을 처리하지 못했어요.');
      } finally {
        setBusyId(null);
      }
    });
  };

  const moveItem = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    const from = items.findIndex((item) => item.id === draggingId);
    const to = items.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const nextItems = items.slice();
    const [moved] = nextItems.splice(from, 1);
    nextItems.splice(to, 0, moved);
    setDraggingId(null);
    setItems(nextItems);
    startTransition(async () => {
      try {
        await postJson('/api/drawing-donation/reorder', { ids: nextItems.map((item) => item.id) });
        toast.success('대기열 순서를 저장했어요.');
      } catch {
        toast.error('순서를 저장하지 못했어요.');
        await refresh().catch(() => undefined);
      }
    });
  };

  const rotateOverlayToken = () => {
    if (!window.confirm('OBS 오버레이 주소를 새로 만들까요? 기존 주소는 더 이상 연결되지 않습니다.')) return;
    startTransition(async () => {
      try {
        const payload = await postJson<{ path: string }>('/api/drawing-donation/rotate-viewer-token', {});
        setViewerPath(payload.path || '');
        toast.success('오버레이 주소를 새로 만들었어요.');
      } catch {
        toast.error('오버레이 주소를 새로 만들지 못했어요.');
      }
    });
  };

  const moderateBlock = (item: DrawingItem) => {
    if (!window.confirm('이 그림을 거절하고 시청자의 봇 기능 사용을 차단할까요? 포인트는 반환됩니다.')) return;
    startTransition(async () => {
      try {
        await postJson('/api/drawing-donation/moderate-block', { id: item.id, reason: '그림 후원 검수 차단' });
        toast.success('그림을 거절하고 시청자를 차단했어요.');
        closeReview();
        await refresh();
      } catch {
        toast.error('차단 처리에 실패했어요.');
      }
    });
  };

  const renderReview = useCallback((item = reviewItem, atMs = Infinity) => {
    const canvas = reviewCanvasRef.current;
    if (!canvas || !item) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(rect.width * ratio));
    const height = Math.max(1, Math.floor(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    for (const stroke of buildAdminReplayStrokes(item)) drawAdminStroke(ctx, stroke, width, height, atMs);
  }, [reviewItem]);

  const openReview = (item: DrawingItem) => {
    setReviewItem(item);
    setReviewLoading(true);
    startTransition(async () => {
      try {
        const payload = await readJson<{ item: DrawingItem }>(`/api/drawing-donation/items/${encodeURIComponent(item.id)}`);
        setReviewItem(payload.item);
        window.setTimeout(() => renderReview(payload.item), 0);
      } catch {
        toast.error('그림 원본을 불러오지 못했어요.');
      } finally {
        setReviewLoading(false);
      }
    });
  };

  const closeReview = () => {
    if (reviewAnimationRef.current) cancelAnimationFrame(reviewAnimationRef.current);
    reviewAnimationRef.current = null;
    setReviewItem(null);
  };

  const playReview = () => {
    if (!reviewItem) return;
    if (reviewAnimationRef.current) cancelAnimationFrame(reviewAnimationRef.current);
    const replayMs = Math.max(1000, Number(reviewItem.replay?.targetReplayMs || 12000) || 12000);
    const startedAt = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startedAt;
      renderReview(reviewItem, elapsed >= replayMs ? Infinity : elapsed);
      if (elapsed < replayMs) reviewAnimationRef.current = requestAnimationFrame(tick);
    };
    reviewAnimationRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    if (!reviewItem?.strokes?.length) return;
    const id = window.setTimeout(() => renderReview(reviewItem), 0);
    return () => window.clearTimeout(id);
  }, [renderReview, reviewItem]);

  const addBlock = () => {
    if (!blockForm.userId.trim()) return;
    startTransition(async () => {
      try {
        const payload = await postJson<{ items: BlockedUser[] }>('/api/bot/blocked-users', blockForm);
        setBlockedUsers(payload.items || []);
        setBlockForm({ userId: '', username: '', reason: '' });
        toast.success('해당 시청자의 봇 기능 사용을 막았어요.');
      } catch {
        toast.error('차단 목록에 추가하지 못했어요.');
      }
    });
  };

  const removeBlock = (userId: string) => {
    startTransition(async () => {
      try {
        const response = await fetch(apiUrl(`/api/bot/blocked-users/${encodeURIComponent(userId)}`), {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!response.ok) throw new Error('delete failed');
        const payload = await response.json();
        setBlockedUsers(payload.items || []);
        toast.success('차단을 해제했어요.');
      } catch {
        toast.error('차단을 해제하지 못했어요.');
      }
    });
  };

  return (
    <main className="space-y-[clamp(1rem,2vw,1.5rem)]">
      <section className="rounded-[var(--radius-panel)] border bg-card/80 p-[clamp(1rem,2.5vw,1.5rem)] shadow-subtle">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="mint">그림 후원</Badge>
              <Badge tone={realtimeState === 'connected' ? 'mint' : realtimeState === 'connecting' ? 'sky' : 'neutral'}>
                <Wifi className="h-[1em] w-[1em]" /> {realtimeState === 'connected' ? '실시간 연결' : realtimeState === 'connecting' ? '실시간 연결 중' : '재연결 대기'}
              </Badge>
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-normal">시청자가 그린 순간을 방송 화면에 띄워요.</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              그림을 그리는 과정부터 완성본까지 OBS 오버레이로 재생합니다. 승인 방식과 비용을 정하고, 불편한 시청자는 봇 기능 사용을 막을 수 있어요.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => refresh().catch(() => undefined)}>
              <RefreshCw className="h-[1em] w-[1em]" /> 새로고침
            </Button>
            <Button type="button" onClick={saveSettings} disabled={isPending}>
              <Settings className="h-[1em] w-[1em]" /> 설정 저장
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-[clamp(1rem,2vw,1.5rem)] xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.7fr)]">
        <Card className="bg-card/85">
          <CardHeader>
            <CardTitle>접수 설정</CardTitle>
            <CardDescription>포인트 비용과 OBS 표시 시간을 정합니다.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <label className="flex min-h-[var(--control-height)] items-center justify-between gap-3 rounded-[var(--radius-control)] border bg-background/70 px-4">
              <span className="text-sm font-semibold">그림 후원 받기</span>
              <input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))} />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              비용 방식
              <select value={settings.pricingMode} onChange={(event) => setSettings((current) => ({ ...current, pricingMode: event.target.value === 'ink' ? 'ink' : 'fixed' }))} className="min-h-[var(--control-height)] rounded-[var(--radius-control)] border bg-background/80 px-3">
                <option value="fixed">고정 비용</option>
                <option value="ink">잉크 사용량 비례</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              고정 비용
              <Input value={settings.costPoints} inputMode="numeric" onChange={(event) => setSettings((current) => ({ ...current, costPoints: Number(event.target.value || 0) }))} />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              잉크 1단위당 포인트
              <Input value={settings.inkCostPerUnit} inputMode="decimal" onChange={(event) => setSettings((current) => ({ ...current, inkCostPerUnit: Number(event.target.value || 0) }))} />
            </label>
            <div className="rounded-[var(--radius-control)] border bg-background/70 p-3 text-sm leading-6 text-muted-foreground">
              고정 비용은 언제나 같은 포인트를 사용합니다. 잉크 비례 방식은 선의 길이, 붓 크기, 투명도, 압력을 기준으로 서버가 최종 비용을 다시 계산합니다.
            </div>
            <label className="grid gap-2 text-sm font-semibold">
              승인 방식
              <select value={settings.approvalMode} onChange={(event) => setSettings((current) => ({ ...current, approvalMode: event.target.value === 'auto' ? 'auto' : 'manual' }))} className="min-h-[var(--control-height)] rounded-[var(--radius-control)] border bg-background/80 px-3">
                <option value="manual">직접 승인</option>
                <option value="auto">자동 승인</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              그리는 과정 최대 표시 시간
              <Input value={settings.replayMaxSec} inputMode="numeric" onChange={(event) => setSettings((current) => ({ ...current, replayMaxSec: Number(event.target.value || 1) }))} />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              완성본 유지 시간
              <Input value={settings.resultHoldSec} inputMode="numeric" onChange={(event) => setSettings((current) => ({ ...current, resultHoldSec: Number(event.target.value || 1) }))} />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              최대 포인트 수
              <Input value={settings.maxPoints} inputMode="numeric" onChange={(event) => setSettings((current) => ({ ...current, maxPoints: Number(event.target.value || 10) }))} />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              최대 선 개수
              <Input value={settings.maxStrokes} inputMode="numeric" onChange={(event) => setSettings((current) => ({ ...current, maxStrokes: Number(event.target.value || 1) }))} />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              제출 쿨다운(초)
              <Input value={settings.submitCooldownSec} inputMode="numeric" onChange={(event) => setSettings((current) => ({ ...current, submitCooldownSec: Number(event.target.value || 0) }))} />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              시청자별 대기 제한
              <Input value={settings.perUserQueueLimit} inputMode="numeric" onChange={(event) => setSettings((current) => ({ ...current, perUserQueueLimit: Number(event.target.value || 0) }))} />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              캔버스 가로 비율
              <Input value={settings.canvas.widthRatio} inputMode="decimal" onChange={(event) => setSettings((current) => ({ ...current, canvas: { ...current.canvas, widthRatio: Number(event.target.value || 16) } }))} />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              캔버스 세로 비율
              <Input value={settings.canvas.heightRatio} inputMode="decimal" onChange={(event) => setSettings((current) => ({ ...current, canvas: { ...current.canvas, heightRatio: Number(event.target.value || 9) } }))} />
            </label>
          </CardContent>
        </Card>

        <Card className="bg-card/85">
          <CardHeader>
            <CardTitle>OBS 오버레이</CardTitle>
            <CardDescription>브라우저 소스로 추가하면 승인된 그림이 자동으로 재생됩니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <button
              type="button"
              onClick={() => overlayUrl && navigator.clipboard?.writeText(overlayUrl).then(() => toast.success('오버레이 주소를 복사했어요.')).catch(() => undefined)}
              className="group w-full rounded-[var(--radius-control)] border bg-background/70 p-3 text-left text-sm blur-[0.08rem] transition hover:blur-0"
            >
              {overlayUrl || '오버레이 주소를 준비하는 중'}
            </button>
            <Button type="button" variant="secondary" className="w-full" onClick={() => overlayUrl && navigator.clipboard?.writeText(overlayUrl)}>
              <Copy className="h-[1em] w-[1em]" /> 주소 복사
            </Button>
            <Button type="button" variant="outline" className="w-full" onClick={rotateOverlayToken} disabled={isPending}>
              <RotateCw className="h-[1em] w-[1em]" /> 주소 새로 만들기
            </Button>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-[clamp(1rem,2vw,1.5rem)] xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.7fr)]">
        <Card className="bg-card/85">
          <CardHeader>
            <CardTitle>그림 후원 대기열</CardTitle>
            <CardDescription>승인된 항목은 OBS 오버레이에서 순서대로 재생됩니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.length ? items.map((item) => (
              <article
                key={item.id}
                draggable
                onDragStart={() => setDraggingId(item.id)}
                onDragEnd={() => setDraggingId(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => moveItem(item.id)}
                className="grid gap-3 rounded-[var(--radius-control)] border bg-background/70 p-3 transition hover:border-primary/35 md:grid-cols-[minmax(9rem,0.28fr)_minmax(0,1fr)]"
              >
                <div className="aspect-video overflow-hidden rounded-[var(--radius-control)] border bg-muted/40">
                  {item.previewImage ? <img src={item.previewImage} alt="" className="h-full w-full object-contain" /> : <div className="grid h-full place-items-center text-muted-foreground"><ImagePlus /></div>}
                </div>
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="cursor-grab text-muted-foreground active:cursor-grabbing" aria-label="순서 변경">
                      <GripVertical className="h-[1em] w-[1em]" />
                    </span>
                    <Badge tone={item.status === 'approved' ? 'mint' : item.status === 'queued' ? 'amber' : 'neutral'}>{item.status}</Badge>
                    <span className="text-sm font-semibold">{item.viewerName || item.viewerUserId || '시청자'}</span>
                    <span className="text-sm text-muted-foreground">{formatNumber(item.cost)}P</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    선 {formatNumber(item.metrics?.strokeCount || 0)}개 · 점 {formatNumber(item.metrics?.pointCount || 0)}개
                    {item.metrics?.ink?.units ? ` · 잉크 ${formatNumber(item.metrics.ink.units)}단위` : ''} · {Math.round(Number(item.replay?.targetReplayMs || 0) / 1000)}초 재생
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {item.status === 'queued' ? <Button type="button" size="sm" onClick={() => runItemAction('/api/drawing-donation/approve', item.id, '그림을 승인했어요.')}><Check className="h-[1em] w-[1em]" /> 승인</Button> : null}
                    <Button type="button" size="sm" variant="secondary" onClick={() => openReview(item)}><Eye className="h-[1em] w-[1em]" /> 검수</Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => runItemAction('/api/drawing-donation/reject', item.id, '거절하고 포인트를 반환했어요.')}><Undo2 className="h-[1em] w-[1em]" /> 거절/환불</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => removeItem(item, false)} disabled={busyId === item.id}><Trash2 className="h-[1em] w-[1em]" /> 삭제</Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => removeItem(item, true)} disabled={busyId === item.id}><Undo2 className="h-[1em] w-[1em]" /> 삭제/환불</Button>
                  </div>
                </div>
              </article>
            )) : (
              <div className="rounded-[var(--radius-control)] border border-dashed bg-background/60 p-6 text-center text-sm text-muted-foreground">아직 도착한 그림 후원이 없습니다.</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/85">
          <CardHeader>
            <CardTitle>봇 기능 차단</CardTitle>
            <CardDescription>차단된 시청자는 그림 후원과 영상 후원 등 포인트 참여 기능을 사용할 수 없습니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2">
              <Input placeholder="시청자 ID 또는 platform:userId" value={blockForm.userId} onChange={(event) => setBlockForm((current) => ({ ...current, userId: event.target.value }))} />
              <Input placeholder="닉네임" value={blockForm.username} onChange={(event) => setBlockForm((current) => ({ ...current, username: event.target.value }))} />
              <Input placeholder="사유" value={blockForm.reason} onChange={(event) => setBlockForm((current) => ({ ...current, reason: event.target.value }))} />
              <Button type="button" onClick={addBlock} disabled={isPending}><Ban className="h-[1em] w-[1em]" /> 차단 추가</Button>
            </div>
            <div className="space-y-2">
              {blockedUsers.length ? blockedUsers.map((item) => (
                <div key={item.userId} className="flex min-w-0 items-center justify-between gap-2 rounded-[var(--radius-control)] border bg-background/70 p-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{item.username || item.userId}</div>
                    <div className="truncate text-xs text-muted-foreground">{item.userId}{item.reason ? ` · ${item.reason}` : ''}</div>
                  </div>
                  <Button type="button" size="icon" variant="ghost" onClick={() => removeBlock(item.userId)} aria-label="차단 해제">
                    <Eraser className="h-[1em] w-[1em]" />
                  </Button>
                </div>
              )) : <div className="rounded-[var(--radius-control)] border border-dashed p-4 text-center text-sm text-muted-foreground">차단된 시청자가 없습니다.</div>}
            </div>
          </CardContent>
        </Card>
      </section>
      {reviewItem ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/24 p-[var(--page-gutter)] backdrop-blur-[clamp(0.5rem,1.4vw,1rem)]">
          <section className="max-h-[min(90vh,54rem)] w-[min(96vw,72rem)] overflow-y-auto rounded-[var(--radius-panel)] border bg-card shadow-lift">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b p-[clamp(1rem,2.2vw,1.5rem)]">
              <div>
                <Badge tone="violet">그림 검수</Badge>
                <h2 className="mt-2 text-xl font-semibold">{reviewItem.viewerName || reviewItem.viewerUserId || '시청자'}님의 그림</h2>
                <p className="mt-1 text-sm text-muted-foreground">큰 화면에서 완성본과 그리는 과정을 확인하고 바로 처리할 수 있습니다.</p>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={closeReview} aria-label="검수 닫기"><X className="h-[1em] w-[1em]" /></Button>
            </header>
            <div className="grid gap-[clamp(1rem,2vw,1.25rem)] p-[clamp(1rem,2.2vw,1.5rem)] lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.32fr)]">
              <div className="overflow-hidden rounded-[var(--radius-card)] border bg-[linear-gradient(45deg,rgba(148,163,184,.12)_25%,transparent_25%),linear-gradient(-45deg,rgba(148,163,184,.12)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,rgba(148,163,184,.12)_75%),linear-gradient(-45deg,transparent_75%,rgba(148,163,184,.12)_75%)] bg-[length:2rem_2rem] bg-[position:0_0,0_1rem,1rem_-1rem,-1rem_0]" style={{ aspectRatio: `${reviewItem.canvas?.widthRatio || settings.canvas.widthRatio} / ${reviewItem.canvas?.heightRatio || settings.canvas.heightRatio}` }}>
                {reviewItem.previewImage && !reviewItem.strokes?.length ? <img src={reviewItem.previewImage} alt="" className="h-full w-full object-contain" /> : <canvas ref={reviewCanvasRef} className="h-full w-full" />}
              </div>
              <aside className="space-y-3">
                <div className="rounded-[var(--radius-control)] border bg-background/70 p-3 text-sm leading-6">
                  <div className="flex justify-between gap-3"><span className="text-muted-foreground">사용 포인트</span><b>{formatNumber(reviewItem.cost)}P</b></div>
                  <div className="flex justify-between gap-3"><span className="text-muted-foreground">선/점</span><b>{formatNumber(reviewItem.metrics?.strokeCount || 0)} / {formatNumber(reviewItem.metrics?.pointCount || 0)}</b></div>
                  <div className="flex justify-between gap-3"><span className="text-muted-foreground">잉크</span><b>{formatNumber(reviewItem.metrics?.ink?.units || 0)}단위</b></div>
                </div>
                <Button type="button" variant="secondary" className="w-full" onClick={playReview} disabled={reviewLoading || !reviewItem.strokes?.length}>
                  <Play className="h-[1em] w-[1em]" /> 리플레이 보기
                </Button>
                {reviewItem.status === 'queued' ? <Button type="button" className="w-full" onClick={() => { runItemAction('/api/drawing-donation/approve', reviewItem.id, '그림을 승인했어요.'); closeReview(); }}><Check className="h-[1em] w-[1em]" /> 승인</Button> : null}
                <Button type="button" variant="secondary" className="w-full" onClick={() => { runItemAction('/api/drawing-donation/reject', reviewItem.id, '거절하고 포인트를 반환했어요.'); closeReview(); }}><Undo2 className="h-[1em] w-[1em]" /> 거절/환불</Button>
                <Button type="button" variant="outline" className="w-full" onClick={() => { removeItem(reviewItem, true); closeReview(); }}><Trash2 className="h-[1em] w-[1em]" /> 삭제/환불</Button>
                <Button type="button" variant="destructive" className="w-full" onClick={() => moderateBlock(reviewItem)}>
                  <ShieldAlert className="h-[1em] w-[1em]" /> 거절하고 차단
                </Button>
              </aside>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
