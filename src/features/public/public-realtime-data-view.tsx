'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Coins, Loader2, Radio, RefreshCw, Trophy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataView } from '@/components/ui/data-view';
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
  const rows = ['items', 'rules', 'rows', 'data', 'points', 'logs', 'definitions']
    .map((key) => object[key])
    .find(Array.isArray);
  return Array.isArray(rows)
    ? rows.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    : [];
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
            <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-pastel-sky/75 text-sky-700 dark:text-sky-100">
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
            <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-pastel-mint/75 text-teal-700 dark:text-teal-100">
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
            <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-pastel-lemon/75 text-amber-700 dark:text-amber-100">
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
          isLive ? 'bg-pastel-coral/80 text-rose-700 dark:text-rose-100' : 'bg-muted text-muted-foreground',
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
  const [lastUpdated, setLastUpdated] = useState(() => Date.now());

  const refresh = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    try {
      const response = await fetch(apiUrl(buildEndpoint(channelUid, kind)), {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = await response.json().catch(() => null);
      if (!payload) return;
      setData(payload);
      setLastUpdated(Date.now());
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
