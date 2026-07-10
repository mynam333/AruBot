'use client';

import { CalendarDays, Filter, ListChecks, Play, RefreshCw, Search, TrendingDown, TrendingUp } from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { apiUrl, readJson } from '@/shared/api/http';
import { cn, formatNumber } from '@/shared/lib/utils';

type EventLog = {
  id: string;
  provider?: string | null;
  category: 'command' | 'donation' | 'roulette' | 'video_donation' | 'drawing_donation' | 'prediction';
  event_type?: string;
  source?: string | null;
  trigger_name?: string | null;
  target_name?: string | null;
  viewer_user_id?: string | null;
  viewer_name?: string | null;
  point_delta?: number;
  point_before?: number | null;
  point_after?: number | null;
  status?: string;
  summary?: string | null;
  result_label?: string | null;
  result_value?: string | null;
  created_at?: string;
  metadata?: Record<string, unknown>;
};

type EventLogsResponse = {
  logs?: EventLog[];
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
};

const PAGE_SIZE = 25;

const CATEGORY_OPTIONS = [
  ['all', '전체'],
  ['command', '명령어'],
  ['donation', '후원'],
  ['roulette', '룰렛'],
  ['video_donation', '영상 후원'],
  ['drawing_donation', '그림 후원'],
  ['prediction', '배팅'],
] as const;

const PROVIDER_OPTIONS = [
  ['all', '전체'],
  ['chzzk', 'CHZZK'],
  ['cime', 'CIME'],
  ['youtube', 'YouTube'],
  ['admin', '관리자'],
] as const;

function categoryLabel(category?: string) {
  return CATEGORY_OPTIONS.find(([value]) => value === category)?.[1] || '이벤트';
}

function providerLabel(provider?: string | null) {
  const value = String(provider || '').toLowerCase();
  return PROVIDER_OPTIONS.find(([key]) => key === value)?.[1] || '공통';
}

function categoryTone(category?: string): 'neutral' | 'mint' | 'sky' | 'rose' | 'lemon' | 'coral' | 'violet' {
  if (category === 'command') return 'mint';
  if (category === 'donation') return 'coral';
  if (category === 'roulette') return 'lemon';
  if (category === 'video_donation') return 'sky';
  if (category === 'drawing_donation') return 'violet';
  if (category === 'prediction') return 'rose';
  return 'neutral';
}

function formatDateTime(value?: string) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function pointDeltaText(value?: number) {
  const delta = Number(value || 0);
  if (!delta) return '변동 없음';
  return `${delta > 0 ? '+' : ''}${formatNumber(delta)}P`;
}

function pointDeltaTone(value?: number): 'neutral' | 'mint' | 'rose' {
  const delta = Number(value || 0);
  if (delta > 0) return 'mint';
  if (delta < 0) return 'rose';
  return 'neutral';
}

function getReplayActionIds(log: EventLog) {
  const metadata = log.metadata || {};
  const ids = new Set<string>();
  const actionIds = Array.isArray(metadata.actionIds) ? metadata.actionIds : [];
  actionIds.forEach((id) => { if (id) ids.add(String(id)); });
  const actionJobs = Array.isArray(metadata.actionJobs) ? metadata.actionJobs : [];
  actionJobs.forEach((job) => {
    if (job && typeof job === 'object') {
      const data = job as Record<string, unknown>;
      if (data.actionId) ids.add(String(data.actionId));
      if (data.blueprintId) ids.add(String(data.blueprintId));
    }
  });
  for (const match of String(log.result_value || '').matchAll(/\$\{\s*(?:action|automation|blueprint)::([^}]+)\s*\}/ig)) {
    if (match[1]) ids.add(match[1]);
  }
  return Array.from(ids);
}

function canReplayLog(log: EventLog) {
  if (log.category === 'video_donation') return true;
  if (log.category === 'drawing_donation') return !!(log.metadata?.drawingId || log.metadata?.drawing_id);
  return getReplayActionIds(log).length > 0;
}

function replayLabel(log: EventLog) {
  if (log.category === 'video_donation') return '영상 재생';
  if (log.category === 'drawing_donation') return '그림 재생';
  return '효과 재생';
}

function LogCard({ log, replaying, onReplay }: { log: EventLog; replaying?: boolean; onReplay: (log: EventLog) => void }) {
  const delta = Number(log.point_delta || 0);
  const DeltaIcon = delta < 0 ? TrendingDown : TrendingUp;
  const replayable = canReplayLog(log);
  return (
    <Card className="bg-card/86">
      <CardContent className="p-[clamp(1rem,2.4vw,1.35rem)]">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={categoryTone(log.category)}>{categoryLabel(log.category)}</Badge>
              <Badge tone="neutral">{providerLabel(log.provider)}</Badge>
              <span className="text-xs font-medium text-muted-foreground">{formatDateTime(log.created_at)}</span>
            </div>
            <h2 className="mt-3 break-keep text-lg font-semibold leading-snug">
              {log.summary || `${categoryLabel(log.category)} 실행`}
            </h2>
            <div className="mt-2 flex flex-wrap gap-2 text-sm text-muted-foreground">
              {log.viewer_name || log.viewer_user_id ? <span className="truncate">시청자: {log.viewer_name || log.viewer_user_id}</span> : null}
              {log.trigger_name ? <span className="truncate">트리거: {log.trigger_name}</span> : null}
              {log.target_name ? <span className="truncate">대상: {log.target_name}</span> : null}
            </div>
            {log.result_label || log.result_value ? (
              <div className="mt-3 rounded-[var(--radius-control)] border bg-background/70 p-[clamp(0.75rem,1.6vw,1rem)] text-sm">
                <span className="font-semibold">결과</span>
                <span className="ml-2 text-muted-foreground">{log.result_label || log.result_value}</span>
              </div>
            ) : null}
          </div>
          <div className="grid gap-2 rounded-[var(--radius-control)] border bg-background/70 p-[clamp(0.75rem,1.8vw,1rem)] lg:min-w-[min(16rem,28vw)]">
            <Badge tone={pointDeltaTone(delta)} className="justify-center">
              <DeltaIcon className="mr-1 h-3 w-3" />
              {pointDeltaText(delta)}
            </Badge>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <span>이전</span>
              <span className="text-right font-semibold text-foreground">{log.point_before == null ? '-' : `${formatNumber(Number(log.point_before))}P`}</span>
              <span>이후</span>
              <span className="text-right font-semibold text-foreground">{log.point_after == null ? '-' : `${formatNumber(Number(log.point_after))}P`}</span>
            </div>
            {replayable ? (
              <Button type="button" variant="outline" onClick={() => onReplay(log)} disabled={replaying} className="mt-1 w-full">
                <Play className={cn('h-4 w-4', replaying && 'animate-pulse')} />
                {replaying ? '재생 중' : replayLabel(log)}
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function EventLogsPage() {
  const [logs, setLogs] = useState<EventLog[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('all');
  const [provider, setProvider] = useState('all');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const deferredQuery = useDeferredValue(query);

  const params = useMemo(() => {
    const next = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
      category,
      provider,
    });
    if (deferredQuery.trim()) next.set('q', deferredQuery.trim());
    if (from) next.set('from', from);
    if (to) next.set('to', to);
    return next.toString();
  }, [category, deferredQuery, from, page, provider, to]);

  const load = useCallback(() => {
    startTransition(async () => {
      const data = await readJson<EventLogsResponse>(`/api/bot/event-logs?${params}`);
      const nextLogs = data?.logs || [];
      setLogs(nextLogs);
      setTotal(Number(data?.total || 0));
      setTotalPages(Math.max(1, Number(data?.totalPages || 1)));
      if (data?.page && Number(data.page) !== page) setPage(Math.max(1, Number(data.page)));
    });
  }, [page, params]);

  useEffect(() => {
    setPage(1);
  }, [category, deferredQuery, from, provider, to]);

  useEffect(() => {
    load();
  }, [load]);

  const replay = useCallback(async (log: EventLog) => {
    if (!log.id || replayingId) return;
    setReplayingId(log.id);
    try {
      const response = await fetch(apiUrl(`/api/bot/event-logs/${encodeURIComponent(log.id)}/replay`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.ok === false) {
        const error = data?.error === 'drawing_source_not_found'
          ? '원본 그림 후원을 찾을 수 없습니다.'
          : data?.error === 'replay_not_available' || data?.error?.includes?.('metadata')
            ? '이 로그에는 재생에 필요한 정보가 없습니다.'
            : '다시 재생하지 못했습니다.';
        toast.error(error);
        return;
      }
      toast.success(`${replayLabel(log)}을 대기열에 넣었습니다.`);
      load();
    } catch {
      toast.error('다시 재생하지 못했습니다.');
    } finally {
      setReplayingId(null);
    }
  }, [load, replayingId]);

  return (
    <div className="grid gap-5">
      <Card className="overflow-hidden">
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Badge tone="mint">
                <ListChecks className="mr-1 h-3 w-3" />
                이벤트 로그
              </Badge>
              <CardTitle className="mt-4 text-[clamp(1.65rem,4vw,2.6rem)]">시청자 참여 흐름을 한눈에</CardTitle>
              <CardDescription className="mt-2 max-w-[70ch] break-keep">
                명령어, 후원 반응, 룰렛 결과, 영상 후원, 예측 배팅에서 포인트가 어떻게 움직였는지 빠르게 확인합니다.
              </CardDescription>
            </div>
            <Button type="button" onClick={load} disabled={isPending}>
              <RefreshCw className={cn('h-4 w-4', isPending && 'animate-spin')} />
              새로고침
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.34fr)_minmax(0,0.34fr)]">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-[clamp(0.85rem,1.6vw,1rem)] top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="유저, 명령어, 룰렛 이름으로 검색" className="pl-[clamp(2.4rem,4vw,2.8rem)]" />
            </div>
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="min-h-[var(--control-height)] rounded-[var(--radius-control)] border bg-background/80 px-[clamp(0.85rem,1.6vw,1rem)] text-sm">
              {CATEGORY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={provider} onChange={(event) => setProvider(event.target.value)} className="min-h-[var(--control-height)] rounded-[var(--radius-control)] border bg-background/80 px-[clamp(0.85rem,1.6vw,1rem)] text-sm">
              {PROVIDER_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,0.5fr)_minmax(0,0.5fr)_auto] md:items-center">
            <div className="relative min-w-0">
              <CalendarDays className="pointer-events-none absolute left-[clamp(0.85rem,1.6vw,1rem)] top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="pl-[clamp(2.4rem,4vw,2.8rem)]" aria-label="시작일" />
            </div>
            <div className="relative min-w-0">
              <CalendarDays className="pointer-events-none absolute left-[clamp(0.85rem,1.6vw,1rem)] top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="pl-[clamp(2.4rem,4vw,2.8rem)]" aria-label="종료일" />
            </div>
            <Badge tone="sky" className="min-h-[var(--control-height)] px-[clamp(0.85rem,1.6vw,1rem)]">
              <Filter className="mr-1 h-3 w-3" />
              {formatNumber(total)}건
            </Badge>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-3">
        {logs.length ? logs.map((log) => <LogCard key={log.id} log={log} replaying={replayingId === log.id} onReplay={replay} />) : (
          <Card className="bg-card/86">
            <CardContent className="grid place-items-center p-[clamp(2rem,6vw,4rem)] text-center">
              <ListChecks className="h-10 w-10 text-muted-foreground" />
              <h2 className="mt-4 text-xl font-semibold">조건에 맞는 이벤트가 없습니다</h2>
              <p className="mt-2 text-sm text-muted-foreground">필터를 넓히거나 기간을 비워 전체 기록을 확인하세요.</p>
            </CardContent>
          </Card>
        )}
      </section>

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
