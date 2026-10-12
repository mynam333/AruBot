'use client';

import { ChevronLeft, ChevronRight, Clapperboard, Clock3, ExternalLink, ListMusic, Loader2, Music2, Pause, RefreshCw, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiUrl } from '@/shared/api/http';
import { getPublicEndpoint } from '@/shared/api/public';

type RequestItem = {
  id: string;
  title: string;
  username: string;
  kind: 'video' | 'bgm';
  idle: boolean;
  resumed: boolean;
  durationSec: number;
  durationPending: boolean;
  startSec: number;
  thumbnailUrl: string | null;
  watchUrl: string | null;
  provider: string | null;
};

type QueueData = {
  currentItem: RequestItem | null;
  waitingItems: RequestItem[];
  waitingCount: number;
  status: 'playing' | 'paused' | 'waiting' | 'empty';
  elapsedSec: number;
  serverNow: number;
  offset: number;
  limit: number;
};

function queueData(value: unknown): QueueData | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as QueueData;
  return Array.isArray(data.waitingItems) && Number.isFinite(data.waitingCount)
    && Number.isFinite(data.offset) && Number.isFinite(data.limit) && data.limit > 0 ? data : null;
}

function time(value: number) {
  const total = Math.max(0, Math.floor(value || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

function duration(item: RequestItem) {
  return item.durationPending || !item.durationSec ? '확인 중' : time(item.durationSec);
}

function range(item: RequestItem) {
  return item.durationPending || !item.durationSec ? `${time(item.startSec)}부터` : `${time(item.startSec)} – ${time(item.startSec + item.durationSec)}`;
}

function provider(item: RequestItem) {
  return ({ youtube: 'YouTube', tiktok: 'TikTok', chzzk_clip: 'CHZZK 클립', cime_clip: 'CIME 클립' } as Record<string, string>)[item.provider || ''] || '영상';
}

function Artwork({ item }: { item: RequestItem }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.thumbnailUrl]);
  return <div className="relative grid aspect-video w-full place-items-center overflow-hidden rounded-md border bg-muted text-muted-foreground">
    {item.kind === 'bgm' ? <Music2 className="h-6 w-6" /> : <Clapperboard className="h-6 w-6" />}
    {item.thumbnailUrl && !failed ? <img src={item.thumbnailUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={() => setFailed(true)} /> : null}
  </div>;
}

function ItemKind({ item }: { item: RequestItem }) {
  return <Badge tone={item.kind === 'bgm' ? 'mint' : 'coral'}>{item.idle ? '대기 음악' : item.kind === 'bgm' ? 'BGM' : '영상 후원'}</Badge>;
}

function WatchLink({ item, iconOnly = false }: { item: RequestItem; iconOnly?: boolean }) {
  if (!item.watchUrl) return iconOnly ? <span className="w-9" /> : null;
  return <a href={item.watchUrl} target="_blank" rel="noopener noreferrer" title={`${item.title} 영상 바로가기 (새 탭)`} aria-label={`${item.title} 영상 바로가기 (새 탭)`}
    className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-md border bg-card text-sm font-semibold text-primary transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${iconOnly ? 'h-9 w-9' : 'min-h-9 px-3 py-2'}`}>
    <ExternalLink className="h-4 w-4" />{iconOnly ? null : '영상 바로가기'}
  </a>;
}

export function PublicRequestQueue({ channelUid, initialData }: { channelUid: string; initialData: unknown }) {
  const [data, setData] = useState<QueueData | null>(() => queueData(initialData));
  const [offset, setOffset] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const received = useRef({ monotonic: 0, age: 0 });

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    let inFlight = false;
    let failures = 0;
    const endpoint = `${getPublicEndpoint(channelUid, 'requests')}?offset=${offset}`;
    async function sync() {
      clearTimeout(timer);
      if (disposed || inFlight) return;
      if (document.hidden) { timer = setTimeout(sync, 5000); return; }
      inFlight = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 8000);
      setRefreshing(true);
      try {
        const response = await fetch(apiUrl(endpoint), { signal: controller.signal, credentials: 'omit', cache: 'no-store' });
        if (!response.ok) {
          if (response.status === 404 && !disposed) setData(null);
          throw new Error(response.status === 404 ? '채널을 찾을 수 없습니다.' : '대기열 연결이 지연되고 있습니다. 잠시 후 다시 확인합니다.');
        }
        const next = queueData(await response.json());
        if (!next) throw new Error('대기열 정보를 확인하지 못했습니다.');
        if (!disposed) {
          received.current = { monotonic: performance.now(), age: Math.min(5, Math.max(0, (Date.now() - next.serverNow) / 1000)) || 0 };
          setClock(performance.now());
          setData(next);
          setError(null);
          if (next.offset !== offset) setOffset(next.offset);
        }
        failures = 0;
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : '대기열을 불러오지 못했습니다.');
        failures += 1;
      } finally {
        clearTimeout(timeout);
        inFlight = false;
        if (!disposed) {
          setRefreshing(false);
          timer = setTimeout(sync, Math.min(30000, 5000 * 2 ** Math.min(failures, 3)));
        }
      }
    }
    const onVisible = () => { if (!document.hidden) void sync(); };
    void sync();
    document.addEventListener('visibilitychange', onVisible);
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', onVisible); };
  }, [channelUid, offset, refreshKey]);

  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) setClock(performance.now()); }, 1000);
    return () => clearInterval(timer);
  }, []);

  const current = data?.currentItem;
  const playing = data?.status === 'playing' && !error;
  const elapsed = Math.min(current?.durationSec || Infinity, (data?.elapsedSec || 0)
    + (playing && received.current.monotonic ? received.current.age + Math.min(10, Math.max(0, clock - received.current.monotonic) / 1000) : 0));
  const status = data?.status === 'paused' ? '일시정지' : data?.status === 'waiting' ? '재생 대기' : current ? '재생 중' : '재생 대기';
  const waitingCount = data?.waitingCount || 0;
  const page = data ? Math.floor(data.offset / data.limit) + 1 : 1;
  const pages = data ? Math.max(1, Math.ceil(waitingCount / data.limit)) : 1;

  return <div className="grid min-w-0 gap-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge tone={error ? 'amber' : 'mint'}>{error ? '연결 지연' : data ? '자동 갱신' : '불러오는 중'}</Badge>
        {data?.serverNow ? <span>최근 확인 {new Date(data.serverNow).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })}</span> : null}
      </div>
      <Button type="button" variant="outline" size="icon" title="대기열 새로고침" aria-label="대기열 새로고침" disabled={refreshing} onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /></Button>
    </div>
    {error ? <div role="alert" className="border-l-2 border-amber-500 bg-amber-500/5 px-4 py-3 text-sm">{error}{data ? ' 마지막으로 확인한 목록입니다.' : ''}</div> : null}
    {!data ? <div role="status" className="flex min-h-44 items-center justify-center gap-2 text-sm text-muted-foreground">{!error ? <><Loader2 className="h-4 w-4 animate-spin" />신청곡을 불러오고 있습니다</> : '대기열을 표시할 수 없습니다'}</div> : <>
      <section aria-label="현재 재생" className="min-w-0 border-b pb-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h3 className="mr-1 text-base font-semibold">현재 재생</h3>
          {current ? <><Badge tone={playing ? 'mint' : 'amber'}>{data.status === 'paused' ? <Pause className="mr-1 h-3 w-3" /> : null}{status}</Badge><ItemKind item={current} /></> : null}
        </div>
        {current ? <>
          <div className="grid min-w-0 grid-cols-[100px_minmax(0,1fr)] items-start gap-4 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-6">
            <Artwork item={current} />
            <div className="min-w-0">
              <p className="mb-1 text-xs font-medium text-muted-foreground">{provider(current)}</p>
              <h4 className="break-words text-base font-semibold leading-relaxed [overflow-wrap:anywhere] sm:text-xl">{current.title}</h4>
              <p className="mt-2 flex min-w-0 items-start gap-1.5 text-sm text-muted-foreground"><UserRound className="mt-0.5 h-4 w-4 shrink-0" /><span className="break-words [overflow-wrap:anywhere]">{current.idle ? '자동 재생' : current.username || '익명 시청자'}{current.resumed ? ' · 이어 재생' : ''}</span></p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
            <dl className="flex flex-wrap gap-x-7 gap-y-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">{current.idle ? '곡 길이' : '신청 길이'}</dt><dd className="mt-1 font-semibold tabular-nums">{duration(current)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">재생 구간</dt><dd className="mt-1 font-medium tabular-nums">{range(current)}</dd></div>
              {!current.durationPending && current.durationSec > 0 ? <div><dt className="text-xs text-muted-foreground">남은 시간</dt><dd className="mt-1 font-medium tabular-nums">{time(current.durationSec - elapsed)}</dd></div> : null}
            </dl>
            <WatchLink item={current} />
          </div>
          <div className="mt-5 flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
            <span>{time(elapsed)}</span>
            <div role="progressbar" aria-label="현재 곡 재생 진행" aria-valuemin={0} aria-valuemax={Math.max(1, current.durationSec)} aria-valuenow={Math.floor(elapsed)} className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width] duration-1000 ease-linear motion-reduce:transition-none" style={{ width: `${current.durationSec ? Math.min(100, elapsed / current.durationSec * 100) : 0}%` }} /></div>
            <span>{duration(current)}</span>
          </div>
        </> : <div className="flex min-h-28 items-center justify-center gap-3 bg-muted/30 text-sm text-muted-foreground"><Music2 className="h-5 w-5" />{waitingCount ? '다음 곡 재생을 기다리고 있습니다' : '현재 재생 중인 곡이 없습니다'}</div>}
      </section>

      <section aria-label="신청곡 대기열" className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-base font-semibold"><ListMusic className="h-5 w-5 text-primary" />대기열 <span className="text-primary">{waitingCount}<span className="ml-1 text-sm font-normal text-muted-foreground">곡</span></span></h3>
          {pages > 1 ? <span className="text-xs tabular-nums text-muted-foreground">{data.offset + 1}–{Math.min(waitingCount, data.offset + data.limit)} / {waitingCount}</span> : null}
        </div>
        {waitingCount ? <ol start={data.offset + 1} className={`divide-y border-y transition-opacity ${offset !== data.offset ? 'opacity-50' : ''}`} aria-busy={offset !== data.offset}>
          {data.waitingItems.map((item, index) => <li key={item.id} className="grid min-w-0 grid-cols-[20px_64px_minmax(0,1fr)_36px] items-start gap-x-3 gap-y-2 py-4 sm:grid-cols-[28px_96px_minmax(0,1fr)_36px] sm:gap-x-4">
            <span className="pt-1 text-center text-sm font-semibold tabular-nums text-muted-foreground">{data.offset + index + 1}</span>
            <Artwork item={item} />
            <div className="min-w-0">
              <div className="mb-1.5 flex flex-wrap items-center gap-2"><ItemKind item={item} /><span className="text-[11px] text-muted-foreground">{provider(item)}</span>{item.resumed ? <span className="text-xs text-primary">이어 재생</span> : null}</div>
              <p className="break-words text-sm font-semibold leading-6 [overflow-wrap:anywhere] sm:text-base">{item.title}</p>
            </div>
            <WatchLink item={item} iconOnly />
            <div className="col-span-2 col-start-2 flex min-w-0 flex-wrap gap-x-5 gap-y-1 text-xs leading-5 text-muted-foreground sm:col-start-3 sm:col-span-1">
              <span className="inline-flex min-w-0 items-start gap-1.5"><UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="break-words [overflow-wrap:anywhere]">{item.username || '익명 시청자'}</span></span>
              <span className="inline-flex items-center gap-1.5 tabular-nums"><Clock3 className="h-3.5 w-3.5" />신청 길이 <b className="font-semibold text-foreground">{duration(item)}</b></span>
              <span className="tabular-nums">구간 {range(item)}</span>
            </div>
          </li>)}
        </ol> : <div className="py-12 text-center text-sm text-muted-foreground">대기 중인 신청곡이 없습니다</div>}
        {pages > 1 ? <nav aria-label="대기열 페이지" className="mt-5 flex items-center justify-center gap-4">
          <Button type="button" size="icon" variant="outline" title="이전 페이지" aria-label="이전 페이지" disabled={refreshing || offset === 0} onClick={() => setOffset(Math.max(0, data.offset - data.limit))}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-sm tabular-nums text-muted-foreground">{page} / {pages}</span>
          <Button type="button" size="icon" variant="outline" title="다음 페이지" aria-label="다음 페이지" disabled={refreshing || data.offset + data.limit >= waitingCount} onClick={() => setOffset(data.offset + data.limit)}><ChevronRight className="h-4 w-4" /></Button>
        </nav> : null}
      </section>
    </>}
  </div>;
}
