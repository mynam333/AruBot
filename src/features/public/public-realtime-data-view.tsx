'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Coins, History, Loader2, Radio, RefreshCw, Search, Sparkles, Trophy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataView } from '@/components/ui/data-view';
import { Input } from '@/components/ui/input';
import { ErrorState } from '@/components/ui/page';
import { apiUrl } from '@/shared/api/http';
import type { PublicChannelKind } from '@/shared/api/public';
import { cn, compactDateTime, formatNumber } from '@/shared/lib/utils';

type PointRow = {
  user_id?: string;
  userId?: string;
  username?: string | null;
  points?: number;
};

type PublicPointsPayload = {
  points?: PointRow[];
  total?: number;
  totalPoints?: number;
  updatedAt?: string;
};

type LivePayload = {
  live?: boolean;
  status?: string;
  channelName?: string;
  title?: string;
  category?: string;
  viewers?: number;
  startedAt?: string;
  updatedAt?: string;
};

type RouletteItem = {
  label?: string;
  value?: unknown;
  weight?: number | null;
  probabilityPercent?: number | null;
};

type RouletteDefinition = {
  name?: string;
  type?: string;
  theme?: string | null;
  items?: RouletteItem[];
};

type RouletteLogRow = {
  id?: string | number;
  token?: string;
  roulette_name?: string;
  rouletteName?: string;
  username?: string | null;
  user_id?: string | null;
  userId?: string | null;
  result_label?: string | null;
  resultLabel?: string | null;
  result_value?: unknown;
  resultValue?: unknown;
  created_at?: string | null;
  createdAt?: string | null;
};

type RouletteHistoryPayload = {
  items?: RouletteLogRow[];
  viewerKnown?: boolean | null;
  updatedAt?: string;
};

const refreshMsByKind: Record<PublicChannelKind, number> = {
  commands: 30000,
  points: 7000,
  roulette: 20000,
  rouletteLogs: 9000,
  live: 8000,
};

function rowsFromData(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  if (!data || typeof data !== 'object') return [];
  const object = data as Record<string, unknown>;
  const rows = ['items', 'rules', 'rows', 'data', 'points', 'logs', 'definitions', 'defs']
    .map((key) => object[key])
    .find(Array.isArray);
  return Array.isArray(rows)
    ? rows.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    : [];
}

function rouletteDefsFromData(data: unknown): RouletteDefinition[] {
  const rows = rowsFromData(data);
  return rows.map((row) => ({
    name: String(row.name || ''),
    type: String(row.type || 'items'),
    theme: typeof row.theme === 'string' ? row.theme : null,
    items: Array.isArray(row.items) ? row.items as RouletteItem[] : [],
  })).filter((row) => row.name || row.items.length);
}

function formatPercent(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0%';
  if (numeric > 0 && numeric < 0.01) return '<0.01%';
  const fractionDigits = numeric >= 10 || Number.isInteger(numeric) ? 0 : numeric >= 1 ? 1 : 2;
  return `${numeric.toFixed(fractionDigits)}%`;
}

function rouletteItemLabel(item: RouletteItem) {
  return String(item.label || item.value || '당첨 항목');
}

function rouletteLogRouletteName(row: RouletteLogRow) {
  return String(row.roulette_name || row.rouletteName || '룰렛');
}

function rouletteLogResult(row: RouletteLogRow) {
  const label = row.result_label || row.resultLabel;
  if (label) return String(label);
  const value = row.result_value ?? row.resultValue;
  if (value == null || value === '') return '결과 없음';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function rouletteLogUser(row: RouletteLogRow) {
  return String(row.username || row.userId || row.user_id || '나');
}

function pointName(row: PointRow) {
  return String(row.username || row.userId || row.user_id || '익명 시청자');
}

function pointUserId(row: PointRow) {
  return String(row.userId || row.user_id || '');
}

function buildEndpoint(channelUid: string, kind: PublicChannelKind) {
  const encodedUid = encodeURIComponent(channelUid);
  const endpoint = kind === 'commands'
    ? `/api/public/${encodedUid}/rules`
    : kind === 'points'
      ? `/api/public/${encodedUid}/points`
      : kind === 'roulette'
        ? `/api/public/${encodedUid}/roulette-defs`
        : kind === 'rouletteLogs'
          ? `/api/roulette/logs?uid=${encodedUid}`
          : `/api/public/${encodedUid}/live`;
  if (kind !== 'points') return endpoint;
  return `${endpoint}${endpoint.includes('?') ? '&' : '?'}limit=100`;
}

function lastUpdatedLabel(value?: string | number | null) {
  if (!value) return '방금 전';
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return compactDateTime(date.toISOString());
  }
  if (typeof value === 'number') return compactDateTime(new Date(value).toISOString());
  return '방금 전';
}

function PublicPointsRanking({ data }: { data: unknown }) {
  const payload = useMemo(() => (
    (data && typeof data === 'object' ? data : {}) as PublicPointsPayload
  ), [data]);
  const points = useMemo(() => {
    const rows = rowsFromData(payload) as PointRow[];
    return [...rows].sort((a, b) => Number(b.points || 0) - Number(a.points || 0));
  }, [payload]);
  const totalUsers = Number(payload.total || points.length || 0);
  const totalPoints = Number(payload.totalPoints || points.reduce((sum, row) => sum + Number(row.points || 0), 0));
  const top = points[0];

  return (
    <div className="grid gap-4">
      <section className="grid gap-3 md:grid-cols-3">
        <Card className="bg-card/88">
          <CardContent className="flex h-full items-center justify-between gap-4 p-[clamp(1rem,2vw,1.25rem)]">
            <div>
              <p className="text-sm text-muted-foreground">등록 시청자</p>
              <div className="mt-2 text-2xl font-semibold">{formatNumber(totalUsers)}</div>
            </div>
            <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-sky-500/10 text-sky-700 dark:text-sky-300">
              <Coins className="h-5 w-5" />
            </span>
          </CardContent>
        </Card>
        <Card className="bg-card/88">
          <CardContent className="flex h-full items-center justify-between gap-4 p-[clamp(1rem,2vw,1.25rem)]">
            <div>
              <p className="text-sm text-muted-foreground">전체 자산량</p>
              <div className="mt-2 text-2xl font-semibold">{formatNumber(totalPoints)}P</div>
            </div>
            <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-primary/10 text-primary">
              <Coins className="h-5 w-5" />
            </span>
          </CardContent>
        </Card>
        <Card className="bg-card/88">
          <CardContent className="flex h-full items-center justify-between gap-4 p-[clamp(1rem,2vw,1.25rem)]">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">현재 1위</p>
              <div className="mt-2 truncate text-2xl font-semibold">{top ? pointName(top) : '준비 중'}</div>
            </div>
            <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-amber-500/10 text-amber-700 dark:text-amber-300">
              <Trophy className="h-5 w-5" />
            </span>
          </CardContent>
        </Card>
      </section>

      <Card className="overflow-hidden bg-card/88">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>실시간 포인트 랭킹</CardTitle>
              <CardDescription>상위 100명의 순위와 보유 포인트를 자동 갱신합니다.</CardDescription>
            </div>
            <Badge tone={points.length ? 'mint' : 'neutral'}>{points.length}명 표시</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {points.length ? (
            <div className="overflow-hidden rounded-[var(--radius-control)] border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-muted/70 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-20 px-[clamp(0.75rem,1.4vw,1rem)] py-3 font-semibold">순위</th>
                    <th className="px-[clamp(0.75rem,1.4vw,1rem)] py-3 font-semibold">시청자</th>
                    <th className="w-36 px-[clamp(0.75rem,1.4vw,1rem)] py-3 text-right font-semibold">포인트</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((row, index) => (
                    <tr key={`${pointUserId(row) || pointName(row)}-${index}`} className="border-t bg-background/45">
                      <td className="px-[clamp(0.75rem,1.4vw,1rem)] py-3">
                        <Badge tone={index < 3 ? 'lemon' : 'neutral'}>{index + 1}위</Badge>
                      </td>
                      <td className="min-w-0 px-[clamp(0.75rem,1.4vw,1rem)] py-3">
                        <div className="truncate font-semibold">{pointName(row)}</div>
                        {pointUserId(row) ? <div className="mt-1 truncate text-xs text-muted-foreground">{pointUserId(row)}</div> : null}
                      </td>
                      <td className="px-[clamp(0.75rem,1.4vw,1rem)] py-3 text-right font-semibold">{formatNumber(Number(row.points || 0))}P</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-[var(--radius-control)] border bg-background/55 p-[clamp(1.25rem,2.6vw,1.75rem)] text-sm text-muted-foreground">
              아직 표시할 포인트 랭킹이 없습니다.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PublicLiveStatus({ data }: { data: unknown }) {
  const live = (data && typeof data === 'object' ? data : {}) as LivePayload;
  const isLive = live.live === true;
  return (
    <Card className="bg-card/88">
      <CardContent className="grid gap-5 p-[clamp(1.25rem,3vw,1.75rem)] md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
        <span className={cn(
          'grid aspect-square w-[clamp(4rem,9vw,5.5rem)] place-items-center rounded-[var(--radius-panel)]',
          isLive ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300' : 'bg-muted text-muted-foreground',
        )}>
          <Radio className={cn('h-8 w-8', isLive && 'animate-pulse')} />
        </span>
        <div className="min-w-0">
          <Badge tone={isLive ? 'rose' : 'neutral'}>{isLive ? '방송 중' : '오프라인'}</Badge>
          <h2 className="mt-4 break-keep text-[clamp(1.6rem,4vw,2.4rem)] font-semibold leading-tight">
            {isLive ? (live.title || '라이브가 진행 중입니다') : '현재 방송 중이 아닙니다'}
          </h2>
          <div className="mt-4 grid gap-2 text-sm leading-6 text-muted-foreground sm:grid-cols-2">
            <div className="rounded-[var(--radius-control)] border bg-background/70 p-3">
              <span className="block text-xs font-semibold text-foreground">채널</span>
              <span className="truncate">{live.channelName || '채널 정보 없음'}</span>
            </div>
            <div className="rounded-[var(--radius-control)] border bg-background/70 p-3">
              <span className="block text-xs font-semibold text-foreground">시청자</span>
              <span>{formatNumber(Number(live.viewers || 0))}명</span>
            </div>
            <div className="rounded-[var(--radius-control)] border bg-background/70 p-3">
              <span className="block text-xs font-semibold text-foreground">카테고리</span>
              <span className="truncate">{live.category || '-'}</span>
            </div>
            <div className="rounded-[var(--radius-control)] border bg-background/70 p-3">
              <span className="block text-xs font-semibold text-foreground">방송 시작</span>
              <span>{live.startedAt || '-'}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PublicRouletteDashboard({
  channelUid,
  data,
}: {
  channelUid: string;
  data: unknown;
}) {
  const definitions = useMemo(() => rouletteDefsFromData(data), [data]);
  const rouletteNames = useMemo(() => definitions.map((definition) => String(definition.name || '')).filter(Boolean), [definitions]);
  const totalItems = useMemo(() => definitions.reduce((sum, definition) => sum + (definition.items?.length || 0), 0), [definitions]);
  const highestProbability = useMemo(() => {
    let best: { roulette: string; label: string; percent: number } | null = null;
    for (const definition of definitions) {
      for (const item of definition.items || []) {
        const percent = Number(item.probabilityPercent || 0);
        if (!Number.isFinite(percent)) continue;
        if (!best || percent > best.percent) {
          best = { roulette: String(definition.name || '룰렛'), label: rouletteItemLabel(item), percent };
        }
      }
    }
    return best;
  }, [definitions]);

  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [rouletteFilter, setRouletteFilter] = useState('');
  const [history, setHistory] = useState<RouletteHistoryPayload>({ items: [] });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyUpdated, setHistoryUpdated] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  const loadHistory = useCallback(async (showLoading = false) => {
    if (showLoading) setHistoryLoading(true);
    try {
      const params = new URLSearchParams({
        uid: channelUid,
        mine: '1',
        limit: '100',
      });
      if (query) params.set('q', query);
      if (rouletteFilter) params.set('roulette', rouletteFilter);
      const response = await fetch(apiUrl(`/api/roulette/logs?${params.toString()}`), {
        credentials: 'include',
        cache: 'no-store',
      });
      if (response.status === 404) {
        setHistory({ items: [], viewerKnown: true, updatedAt: new Date().toISOString() });
        setHistoryUpdated(Date.now());
        return;
      }
      if (!response.ok) return;
      const payload = await response.json().catch(() => null);
      if (!payload) return;
      setHistory(payload as RouletteHistoryPayload);
      setHistoryUpdated(Date.now());
    } finally {
      if (showLoading) setHistoryLoading(false);
    }
  }, [channelUid, query, rouletteFilter]);

  useEffect(() => {
    loadHistory(true);
  }, [loadHistory]);

  useEffect(() => {
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      loadHistory(false);
    };
    const timer = window.setInterval(tick, refreshMsByKind.rouletteLogs);
    const handleVisibility = () => {
      if (!document.hidden) loadHistory(false);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadHistory]);

  const historyRows = useMemo(() => {
    const rows = Array.isArray(history.items) ? history.items : [];
    return rows.filter((row): row is RouletteLogRow => !!row && typeof row === 'object');
  }, [history]);
  const viewerKnown = history.viewerKnown !== false;

  return (
    <div className="grid gap-4">
      <section className="grid gap-3 md:grid-cols-3">
        <Card className="bg-card/88">
          <CardContent className="flex h-full items-center justify-between gap-4 p-[clamp(1rem,2vw,1.25rem)]">
            <div>
              <p className="text-sm text-muted-foreground">현재 열린 룰렛</p>
              <div className="mt-2 text-2xl font-semibold">{formatNumber(definitions.length)}개</div>
            </div>
            <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-amber-500/10 text-amber-700 dark:text-amber-300">
              <Sparkles className="h-5 w-5" />
            </span>
          </CardContent>
        </Card>
        <Card className="bg-card/88">
          <CardContent className="flex h-full items-center justify-between gap-4 p-[clamp(1rem,2vw,1.25rem)]">
            <div>
              <p className="text-sm text-muted-foreground">당첨 항목</p>
              <div className="mt-2 text-2xl font-semibold">{formatNumber(totalItems)}개</div>
            </div>
            <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-primary/10 text-primary">
              <Trophy className="h-5 w-5" />
            </span>
          </CardContent>
        </Card>
        <Card className="bg-card/88">
          <CardContent className="flex h-full items-center justify-between gap-4 p-[clamp(1rem,2vw,1.25rem)]">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">최고 확률</p>
              <div className="mt-2 truncate text-2xl font-semibold">{highestProbability ? formatPercent(highestProbability.percent) : '-'}</div>
              {highestProbability ? <p className="mt-1 truncate text-xs text-muted-foreground">{highestProbability.roulette} · {highestProbability.label}</p> : null}
            </div>
            <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-sky-500/10 text-sky-700 dark:text-sky-300">
              <Coins className="h-5 w-5" />
            </span>
          </CardContent>
        </Card>
      </section>

      <Card className="overflow-hidden bg-card/88">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>현재 열린 룰렛과 확률</CardTitle>
              <CardDescription>참여 가능한 룰렛의 당첨 항목과 계산된 확률을 표시합니다.</CardDescription>
            </div>
            <Badge tone={definitions.length ? 'lemon' : 'neutral'}>{definitions.length}개 룰렛</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {definitions.length ? definitions.map((definition) => {
            const items = Array.isArray(definition.items) ? definition.items : [];
            return (
              <section key={String(definition.name)} className="rounded-[var(--radius-card)] border bg-background/60 p-[clamp(1rem,2vw,1.25rem)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-semibold">{definition.name || '이름 없는 룰렛'}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{definition.type === 'probability' ? '확률형 룰렛' : '가중치 룰렛'} · {items.length}개 항목</p>
                  </div>
                  <Badge tone="sky">{definition.theme || '기본 스킨'}</Badge>
                </div>
                <div className="mt-4 grid gap-2">
                  {items.length ? items.map((item, index) => {
                    const percent = Math.max(0, Math.min(100, Number(item.probabilityPercent || 0)));
                    return (
                      <div key={`${rouletteItemLabel(item)}-${index}`} className="grid gap-2 rounded-[var(--radius-control)] border bg-card/72 p-3">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate font-semibold">{rouletteItemLabel(item)}</span>
                          <span className="shrink-0 font-semibold text-primary">{formatPercent(item.probabilityPercent)}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary/75" style={{ width: `${percent}%` }} />
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="rounded-[var(--radius-control)] border bg-card/72 p-3 text-sm text-muted-foreground">
                      표시할 당첨 항목이 없습니다.
                    </div>
                  )}
                </div>
              </section>
            );
          }) : (
            <div className="rounded-[var(--radius-control)] border bg-background/55 p-[clamp(1.25rem,2.6vw,1.75rem)] text-sm text-muted-foreground">
              아직 공개된 룰렛이 없습니다.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden bg-card/88">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>내 룰렛 당첨 내역</CardTitle>
              <CardDescription>로그인한 시청자 계정의 당첨 내역만 검색하고 필터링합니다.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={viewerKnown ? 'mint' : 'neutral'}>{viewerKnown ? `${historyRows.length}개 표시` : '로그인 필요'}</Badge>
              <Button type="button" variant="outline" size="sm" onClick={() => loadHistory(true)} disabled={historyLoading}>
                {historyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                내역 갱신
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                placeholder="결과, 룰렛명, 닉네임 검색"
                className="pl-9"
              />
            </label>
            <select
              value={rouletteFilter}
              onChange={(event) => setRouletteFilter(event.target.value)}
              className="box-border min-h-[var(--control-height)] w-full min-w-0 rounded-[var(--radius-control)] border bg-background/80 px-[clamp(0.75rem,1.4vw,1rem)] text-sm font-semibold outline-none transition focus:border-primary/45 focus:ring-2 focus:ring-ring"
            >
              <option value="">전체 룰렛</option>
              {rouletteNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <History className="h-4 w-4" />
            <span>마지막 확인 {lastUpdatedLabel(history.updatedAt || historyUpdated)}</span>
          </div>

          {!viewerKnown ? (
            <div className="rounded-[var(--radius-control)] border bg-background/55 p-[clamp(1.25rem,2.6vw,1.75rem)] text-sm text-muted-foreground">
              로그인하면 이 채널에서 본인이 당첨된 룰렛 내역을 볼 수 있습니다.
              <Button asChild variant="soft" size="sm" className="mt-4 w-full sm:w-auto">
                <a href={`/viewer/login?returnTo=${encodeURIComponent(`/c/${channelUid}/roulette`)}`}>시청자 로그인</a>
              </Button>
            </div>
          ) : historyRows.length ? (
            <div className="overflow-hidden rounded-[var(--radius-control)] border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-muted/70 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-[clamp(0.75rem,1.4vw,1rem)] py-3 font-semibold">룰렛</th>
                    <th className="px-[clamp(0.75rem,1.4vw,1rem)] py-3 font-semibold">결과</th>
                    <th className="px-[clamp(0.75rem,1.4vw,1rem)] py-3 font-semibold">시청자</th>
                    <th className="w-40 px-[clamp(0.75rem,1.4vw,1rem)] py-3 text-right font-semibold">시간</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map((row, index) => {
                    const createdAt = row.created_at || row.createdAt || '';
                    return (
                      <tr key={String(row.id || `${rouletteLogRouletteName(row)}-${createdAt}-${index}`)} className="border-t bg-background/45">
                        <td className="max-w-[12rem] truncate px-[clamp(0.75rem,1.4vw,1rem)] py-3 font-semibold">{rouletteLogRouletteName(row)}</td>
                        <td className="max-w-[16rem] truncate px-[clamp(0.75rem,1.4vw,1rem)] py-3">{rouletteLogResult(row)}</td>
                        <td className="max-w-[10rem] truncate px-[clamp(0.75rem,1.4vw,1rem)] py-3 text-muted-foreground">{rouletteLogUser(row)}</td>
                        <td className="px-[clamp(0.75rem,1.4vw,1rem)] py-3 text-right text-muted-foreground">{createdAt ? compactDateTime(String(createdAt)) : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-[var(--radius-control)] border bg-background/55 p-[clamp(1.25rem,2.6vw,1.75rem)] text-sm text-muted-foreground">
              조건에 맞는 내 룰렛 당첨 내역이 없습니다.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function PublicRealtimeDataView({
  channelUid,
  kind,
  initialData,
}: {
  channelUid: string;
  kind: PublicChannelKind;
  initialData: unknown;
}) {
  const [data, setData] = useState(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(initialData == null ? '방송 정보를 불러오지 못했습니다.' : null);
  const [lastUpdated, setLastUpdated] = useState(() => Date.now());

  const refresh = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    try {
      const response = await fetch(apiUrl(buildEndpoint(channelUid, kind)), {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!response.ok) {
        setError(`방송 정보를 불러오지 못했습니다. (${response.status})`);
        return;
      }
      const payload = await response.json().catch(() => null);
      if (!payload) {
        setError('서버 응답을 확인하지 못했습니다.');
        return;
      }
      setData(payload);
      setError(null);
      setLastUpdated(Date.now());
    } catch {
      setError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      if (showRefreshing) setRefreshing(false);
    }
  }, [channelUid, kind]);

  useEffect(() => {
    const intervalMs = refreshMsByKind[kind];
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      refresh(false);
    };
    const timer = window.setInterval(tick, intervalMs);
    const handleVisibility = () => {
      if (!document.hidden) refresh(false);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [kind, refresh]);

  return (
    <div className="grid gap-4">
      {error ? <ErrorState description={error} onRetry={() => void refresh(true)} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border bg-card/72 px-[clamp(0.9rem,2vw,1.1rem)] py-3 text-sm shadow-subtle">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="mint">자동 갱신</Badge>
          <span className="text-muted-foreground">마지막 확인 {lastUpdatedLabel((data as { updatedAt?: string })?.updatedAt || lastUpdated)}</span>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => refresh(true)} disabled={refreshing}>
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          새로고침
        </Button>
      </div>
      {kind === 'points' ? (
        <PublicPointsRanking data={data} />
      ) : kind === 'roulette' ? (
        <PublicRouletteDashboard channelUid={channelUid} data={data} />
      ) : kind === 'live' ? (
        <PublicLiveStatus data={data} />
      ) : (
        <DataView
          title="공개 목록"
          description="지금 방송에서 열려 있는 참여 항목입니다."
          data={data}
          empty="아직 공개된 항목이 없어요."
        />
      )}
    </div>
  );
}
