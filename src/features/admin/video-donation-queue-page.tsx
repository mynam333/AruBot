'use client';

import { GripVertical, Loader2, PlaySquare, RefreshCw, RotateCcw, Trash2, UserRound, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { VideoDonationSettingsDialog } from '@/features/admin/admin-action-dialogs';
import { ViewerTokenPanel } from '@/features/admin/viewer-token-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiUrl, apiWsUrl, readJson } from '@/shared/api/http';

type VideoDonationItem = {
  id: string;
  ts?: number;
  mediaProvider?: string;
  mediaId?: string | null;
  mediaUrl?: string | null;
  embedUrl?: string | null;
  thumbnailUrl?: string | null;
  videoId?: string;
  title?: string | null;
  durationSec?: number;
  startSec?: number;
  cost?: number;
  userId?: string;
  username?: string | null;
  status?: string;
};

type VideoDonationQueueResponse = {
  items?: VideoDonationItem[];
  currentItem?: VideoDonationItem | null;
  volume?: number;
  type?: string;
  reason?: string;
  serverNow?: number;
};

type VideoDonationSettingsResponse = {
  volume?: number;
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error || 'request_failed');
  }
  return response.json();
}

function formatSeconds(value?: number) {
  const total = Math.max(0, Math.floor(Number(value || 0)));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function requestedRange(item: VideoDonationItem) {
  const start = Math.max(0, Number(item.startSec || 0));
  const duration = Math.max(0, Number(item.durationSec || 0));
  if (!duration) return `${formatSeconds(start)}부터`;
  return `${formatSeconds(start)} - ${formatSeconds(start + duration)} · ${formatSeconds(duration)} 재생`;
}

function thumbnailUrl(item: VideoDonationItem) {
  if (item.thumbnailUrl) return item.thumbnailUrl;
  return item.videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(item.videoId)}/hqdefault.jpg` : null;
}

function providerLabel(provider?: string) {
  if (provider === 'tiktok') return 'TikTok';
  if (provider === 'chzzk_clip') return 'CHZZK 클립';
  if (provider === 'cime_clip') return 'CIME 클립';
  return 'YouTube';
}

function mediaIdLabel(item: VideoDonationItem) {
  return item.mediaId || item.videoId || '-';
}

function requestedAt(item: VideoDonationItem) {
  if (!item.ts) return null;
  try {
    return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date(item.ts));
  } catch {
    return null;
  }
}

function VideoDonationItemCard({
  item,
  index,
  current = false,
  draggable = false,
  dragging = false,
  busy = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onDelete,
  onRefundDelete,
}: {
  item: VideoDonationItem;
  index?: number;
  current?: boolean;
  draggable?: boolean;
  dragging?: boolean;
  busy?: boolean;
  onDragStart?: () => void;
  onDragOver?: () => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
  onDelete: () => void;
  onRefundDelete: () => void;
}) {
  const thumb = thumbnailUrl(item);
  const time = requestedAt(item);

  return (
    <div
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        onDragStart?.();
      }}
      onDragOver={(event) => {
        if (!draggable) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        onDragOver?.();
      }}
      onDrop={(event) => {
        if (!draggable) return;
        event.preventDefault();
        onDrop?.();
      }}
      onDragEnd={onDragEnd}
      className={[
        'grid min-w-0 gap-[clamp(0.85rem,1.6vw,1.15rem)] rounded-[var(--radius-card)] border bg-card/88 p-[clamp(0.85rem,1.6vw,1.1rem)] shadow-subtle transition',
        current ? 'border-primary/28 bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent-mint)/0.18))]' : '',
        dragging ? 'scale-[0.99] opacity-55 ring-2 ring-primary/30' : 'hover:-translate-y-0.5 hover:shadow-lift',
      ].filter(Boolean).join(' ')}
    >
      <div className="grid min-w-0 gap-[clamp(0.85rem,1.6vw,1.15rem)] md:grid-cols-[minmax(0,24%)_minmax(0,1fr)]">
        <div className="relative aspect-video overflow-hidden rounded-[var(--radius-control)] border bg-muted">
          {thumb ? (
            <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <div className="grid h-full place-items-center text-muted-foreground">
              <PlaySquare className="h-[2rem] w-[2rem]" />
            </div>
          )}
          {current ? <Badge tone="mint" className="absolute left-2 top-2">재생 중</Badge> : null}
          {!current && index != null ? <Badge tone="neutral" className="absolute left-2 top-2">대기 {index + 1}</Badge> : null}
          <Badge tone="sky" className="absolute bottom-2 left-2">{providerLabel(item.mediaProvider)}</Badge>
        </div>

        <div className="grid min-w-0 gap-[clamp(0.75rem,1.4vw,1rem)]">
          <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h3 className="break-keep text-base font-semibold leading-7 md:text-lg">
                {item.title || mediaIdLabel(item) || '제목을 불러오지 못한 영상'}
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <UserRound className="h-[1em] w-[1em]" />
                  {item.username || item.userId || '신청자 정보 없음'}
                </span>
                {time ? <span>{time} 신청</span> : null}
              </div>
            </div>
            {draggable ? (
              <div className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border bg-background/70 px-[clamp(0.75rem,1.2vw,0.95rem)] py-[clamp(0.45rem,0.9vw,0.65rem)] text-xs font-semibold text-muted-foreground">
                <GripVertical className="h-[1rem] w-[1rem]" />
                드래그
              </div>
            ) : null}
          </div>

          <div className="grid min-w-0 gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))]">
            <div className="min-w-0 rounded-[var(--radius-control)] border bg-background/70 p-[clamp(0.75rem,1.4vw,1rem)]">
              <div className="text-xs text-muted-foreground">신청 구간</div>
              <div className="mt-1 break-keep text-sm font-semibold">{requestedRange(item)}</div>
            </div>
            <div className="min-w-0 rounded-[var(--radius-control)] border bg-background/70 p-[clamp(0.75rem,1.4vw,1rem)]">
              <div className="text-xs text-muted-foreground">사용 포인트</div>
              <div className="mt-1 truncate text-sm font-semibold tabular-nums">{Number(item.cost || 0).toLocaleString()}P</div>
            </div>
            <div className="min-w-0 rounded-[var(--radius-control)] border bg-background/70 p-[clamp(0.75rem,1.4vw,1rem)]">
              <div className="text-xs text-muted-foreground">미디어 ID</div>
              <div className="mt-1 truncate text-sm font-semibold">{mediaIdLabel(item)}</div>
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={onDelete} disabled={busy}>
              {busy ? <Loader2 className="h-[1em] w-[1em] animate-spin" /> : <Trash2 className="h-[1em] w-[1em]" />}
              삭제
            </Button>
            <Button type="button" variant="destructive" onClick={onRefundDelete} disabled={busy}>
              {busy ? <Loader2 className="h-[1em] w-[1em] animate-spin" /> : <RotateCcw className="h-[1em] w-[1em]" />}
              삭제 후 반환
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function VideoDonationQueuePage() {
  const [items, setItems] = useState<VideoDonationItem[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [volume, setVolume] = useState(100);
  const [volumePending, setVolumePending] = useState(false);
  const [realtimeState, setRealtimeState] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [isPending, startTransition] = useTransition();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);

  const currentItem = items[0] || null;
  const waitingItems = useMemo(() => items.slice(1), [items]);
  const totalCost = useMemo(() => items.reduce((sum, item) => sum + Number(item.cost || 0), 0), [items]);
  const totalDuration = useMemo(() => items.reduce((sum, item) => sum + Number(item.durationSec || 0), 0), [items]);

  const applyQueuePayload = useCallback((data: VideoDonationQueueResponse | null) => {
    setItems(Array.isArray(data?.items) ? data.items : []);
    if (data?.volume != null) {
      setVolume(Math.max(0, Math.min(100, Math.round(Number(data.volume)))));
    }
  }, []);

  const load = useCallback(() => {
    startTransition(async () => {
      const [data, settings] = await Promise.all([
        readJson<VideoDonationQueueResponse>('/api/video-donation/queue'),
        readJson<VideoDonationSettingsResponse>('/api/video-donation/settings').catch(() => null),
      ]);
      applyQueuePayload(data);
      if (settings?.volume != null) {
        setVolume(Math.max(0, Math.min(100, Math.round(Number(settings.volume)))));
      }
    });
  }, [applyQueuePayload]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let disposed = false;

    const clearReconnect = () => {
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const connect = () => {
      clearReconnect();
      if (disposed) return;
      setRealtimeState('connecting');

      try {
        const ws = new WebSocket(apiWsUrl('/api/video-donation/admin/ws'));
        wsRef.current = ws;

        ws.onopen = () => {
          reconnectAttemptRef.current = 0;
          setRealtimeState('connected');
        };

        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(String(event.data || '{}')) as VideoDonationQueueResponse;
            if (payload?.type === 'video-donation.queue') {
              applyQueuePayload(payload);
            }
          } catch {
            // Ignore malformed realtime messages.
          }
        };

        ws.onclose = () => {
          if (wsRef.current === ws) wsRef.current = null;
          if (disposed) return;
          setRealtimeState('disconnected');
          const attempt = Math.min(6, reconnectAttemptRef.current + 1);
          reconnectAttemptRef.current = attempt;
          const delay = Math.min(10000, 600 * 2 ** (attempt - 1));
          reconnectTimerRef.current = window.setTimeout(connect, delay);
        };

        ws.onerror = () => {
          try { ws.close(); } catch { }
        };
      } catch {
        setRealtimeState('disconnected');
        reconnectTimerRef.current = window.setTimeout(connect, 2000);
      }
    };

    connect();

    return () => {
      disposed = true;
      clearReconnect();
      try { wsRef.current?.close(); } catch { }
      wsRef.current = null;
    };
  }, [applyQueuePayload]);

  useEffect(() => {
    const refresh = (event: Event) => {
      const endpoint = (event as CustomEvent<{ endpoint?: string }>).detail?.endpoint;
      if (!endpoint || endpoint === '/api/video-donation/queue') load();
    };
    window.addEventListener('arubot:resource-refresh', refresh);
    return () => window.removeEventListener('arubot:resource-refresh', refresh);
  }, [load]);

  const persistOrder = async (nextItems: VideoDonationItem[]) => {
    setItems(nextItems);
    try {
      await postJson('/api/video-donation/reorder', { ids: nextItems.map((item) => item.id) });
      toast.success('대기열 순서를 저장했어요.');
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '순서를 저장하지 못했어요.');
      load();
    }
  };

  const moveWaitingItem = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    const from = waitingItems.findIndex((item) => item.id === draggingId);
    const to = waitingItems.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const nextWaiting = waitingItems.slice();
    const [moved] = nextWaiting.splice(from, 1);
    nextWaiting.splice(to, 0, moved);
    const nextItems = currentItem ? [currentItem, ...nextWaiting] : nextWaiting;
    setDraggingId(null);
    void persistOrder(nextItems);
  };

  const removeItem = async (item: VideoDonationItem, refund: boolean) => {
    const action = refund ? '삭제하고 포인트를 반환할까요?' : '대기열에서 삭제할까요?';
    if (!window.confirm(`${item.title || mediaIdLabel(item) || '영상'}을 ${action}`)) return;
    setBusyId(item.id);
    try {
      await postJson(refund ? '/api/video-donation/delete-refund' : '/api/video-donation/delete', { id: item.id });
      toast.success(refund ? '삭제하고 포인트를 반환했어요.' : '대기열에서 삭제했어요.');
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '처리하지 못했어요.');
    } finally {
      setBusyId(null);
    }
  };

  const applyVolume = async () => {
    const nextVolume = Math.max(0, Math.min(100, Math.round(Number(volume || 0))));
    setVolumePending(true);
    try {
      await postJson('/api/video-donation/control', { op: 'volume', volume: nextVolume });
      toast.success(`영상 후원 소리를 ${nextVolume}%로 조절했어요.`);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '소리 크기를 조절하지 못했어요.');
    } finally {
      setVolumePending(false);
    }
  };

  return (
    <div className="grid gap-[clamp(1rem,2vw,1.5rem)]">
      <section className="relative overflow-hidden rounded-[var(--radius-panel)] border bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent-coral)/0.16),hsl(var(--accent-sky)/0.14))] p-[clamp(1.25rem,2.6vw,1.75rem)] shadow-subtle">
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-4xl">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-primary/12 text-primary ring-1 ring-primary/25">
                <PlaySquare className="h-5 w-5" />
              </span>
              <Badge tone="mint">영상 후원</Badge>
              <Badge tone="sky">{waitingItems.length}개 대기</Badge>
              <Badge tone="lemon">{totalCost.toLocaleString()}P</Badge>
              <Badge tone={realtimeState === 'connected' ? 'mint' : realtimeState === 'connecting' ? 'sky' : 'neutral'}>
                {realtimeState === 'connected' ? '실시간 연결' : realtimeState === 'connecting' ? '실시간 연결 중' : '실시간 재연결 대기'}
              </Badge>
            </div>
            <h1 className="text-3xl font-semibold leading-tight tracking-normal md:text-4xl">영상 후원 큐</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground md:text-base">
              시청자가 신청한 영상을 지금 나가는 항목과 다음 순서로 나눠 보여줍니다. 방송 흐름에 맞게 순서를 바꾸고, 맞지 않는 신청은 포인트 반환과 함께 정리하세요.
            </p>
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <div className="flex min-h-[var(--control-height)] min-w-[min(100%,18rem)] items-center gap-2 rounded-[var(--radius-control)] border bg-card/74 px-[clamp(0.8rem,1.4vw,1rem)] shadow-subtle backdrop-blur">
              {volume <= 0 ? <VolumeX className="h-[1em] w-[1em] text-muted-foreground" /> : <Volume2 className="h-[1em] w-[1em] text-primary" />}
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(event) => setVolume(Math.max(0, Math.min(100, Number(event.target.value || 0))))}
                className="min-w-0 flex-1 accent-primary"
                aria-label="영상 후원 소리 크기"
              />
              <span className="w-[4ch] text-right text-sm font-semibold tabular-nums">{volume}%</span>
            </div>
            <Button type="button" variant="secondary" onClick={() => void applyVolume()} disabled={volumePending}>
              {volumePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
              소리 적용
            </Button>
            <VideoDonationSettingsDialog />
            <Button type="button" variant="outline" onClick={load} disabled={isPending}>
              <RefreshCw className={isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              새로고침
            </Button>
          </div>
        </div>
      </section>

      <ViewerTokenPanel
        title="영상 후원 화면 주소"
        description="이 주소를 OBS 브라우저 소스에 넣으면 시청자가 신청한 영상이 방송 화면에 표시돼요."
        endpoint="/api/video-donation/viewer-url"
        rotateEndpoint="/api/video-donation/rotate-viewer-token"
      />

      <div className="grid gap-[clamp(0.85rem,1.6vw,1.15rem)] md:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">현재 재생</div>
            <div className="mt-2 text-2xl font-semibold">{currentItem ? '1개' : '없음'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">대기열</div>
            <div className="mt-2 text-2xl font-semibold">{waitingItems.length.toLocaleString()}개</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">총 사용 포인트</div>
            <div className="mt-2 text-2xl font-semibold">{totalCost.toLocaleString()}P</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">예상 재생 시간</div>
            <div className="mt-2 text-2xl font-semibold">{formatSeconds(totalDuration)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>현재 재생 중</CardTitle>
              <CardDescription>지금 방송 화면에 나가는 영상입니다. 넘기면 다음 신청 영상으로 이어집니다.</CardDescription>
            </div>
            <Badge tone={currentItem ? 'mint' : 'neutral'}>{currentItem ? '재생 중' : '비어 있음'}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {currentItem ? (
            <VideoDonationItemCard
              item={currentItem}
              current
              busy={busyId === currentItem.id}
              onDelete={() => void removeItem(currentItem, false)}
              onRefundDelete={() => void removeItem(currentItem, true)}
            />
          ) : (
            <div className="rounded-[var(--radius-card)] border bg-background/70 p-[clamp(1.25rem,3vw,2rem)] text-center text-sm text-muted-foreground">
              현재 재생 중인 영상이 없습니다.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>신청 대기열</CardTitle>
              <CardDescription>드래그로 방송 흐름에 맞는 순서를 만들 수 있습니다.</CardDescription>
            </div>
            <Badge tone="sky">{waitingItems.length}개</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-[clamp(0.85rem,1.6vw,1.15rem)]">
          {waitingItems.map((item, index) => (
            <VideoDonationItemCard
              key={item.id}
              item={item}
              index={index}
              draggable={waitingItems.length > 1}
              dragging={draggingId === item.id}
              busy={busyId === item.id}
              onDragStart={() => setDraggingId(item.id)}
              onDragOver={() => undefined}
              onDrop={() => moveWaitingItem(item.id)}
              onDragEnd={() => setDraggingId(null)}
              onDelete={() => void removeItem(item, false)}
              onRefundDelete={() => void removeItem(item, true)}
            />
          ))}
          {!waitingItems.length ? (
            <div className="rounded-[var(--radius-card)] border bg-background/70 p-[clamp(1.25rem,3vw,2rem)] text-center text-sm text-muted-foreground">
              신청 대기열이 비어 있습니다.
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
