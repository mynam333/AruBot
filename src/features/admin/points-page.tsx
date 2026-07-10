'use client';

import { Loader2, RefreshCw, Save, Search, Settings, ShieldOff, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { PageHeader } from '@/components/ui/page';
import { apiUrl, readJson } from '@/shared/api/http';

type PointRow = {
  user_id?: string;
  userId?: string;
  username?: string | null;
  points?: number;
  arubotUuid?: string;
  appUserId?: string | null;
  pointBlocked?: boolean;
  platformAccounts?: Array<{
    provider?: string;
    platformUserId?: string;
    channelId?: string;
    nickname?: string | null;
    handle?: string | null;
  }>;
};

type PointsResponse = {
  points: PointRow[];
  total?: number;
  totalPoints?: number;
  filteredTotal?: number;
  filteredPoints?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
  settings?: {
    channelPointsPerChat?: number;
    channelPointsPerAttendance?: number;
    channelPointsExcludeUserIdsText?: string;
  };
};

type BotSettingsResponse = {
  settings?: Record<string, unknown>;
};

type DonationSettingsResponse = {
  settings?: {
    pointsPerK?: number;
  };
};

type PointsSortKey = 'points-desc' | 'points-asc' | 'name-asc' | 'name-desc' | 'connected-first' | 'blocked-first';

const POINTS_PAGE_SIZE = 25;

function rowUserId(row: PointRow) {
  return String(row.user_id || row.userId || '');
}

function formatPoints(value: number) {
  return `${Number(value || 0).toLocaleString('ko-KR')}P`;
}

async function postJson(path: string, body: unknown) {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'request_failed');
  return data;
}

export function PointsPage() {
  const [rows, setRows] = useState<PointRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pointsPerChat, setPointsPerChat] = useState('1');
  const [pointsPerAttendance, setPointsPerAttendance] = useState('0');
  const [pointsPerDonationK, setPointsPerDonationK] = useState('10');
  const [excludeText, setExcludeText] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [totalPoints, setTotalPoints] = useState(0);
  const [filteredTotalRows, setFilteredTotalRows] = useState(0);
  const [filteredPoints, setFilteredPoints] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<PointsSortKey>('points-desc');
  const [isPending, startTransition] = useTransition();
  const deferredQuery = useDeferredValue(query);

  const visibleRows = rows;

  useEffect(() => {
    setPage(1);
  }, [deferredQuery, sortBy]);

  const load = useCallback(() => {
    startTransition(async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(POINTS_PAGE_SIZE),
        sort: sortBy,
      });
      const term = deferredQuery.trim();
      if (term) params.set('q', term);
      const [data, donationData] = await Promise.all([
        readJson<PointsResponse>(`/api/channelpoints/list?${params.toString()}`),
        readJson<DonationSettingsResponse>('/api/donation/settings'),
      ]);
      const nextRows = data?.points || [];
      setRows(nextRows);
      setDrafts(Object.fromEntries(nextRows.map((row) => [rowUserId(row), String(Number(row.points || 0))])));
      setTotalRows(Number(data?.total ?? nextRows.length));
      setTotalPoints(Number(data?.totalPoints ?? nextRows.reduce((sum, row) => sum + Number(row.points || 0), 0)));
      setFilteredTotalRows(Number(data?.filteredTotal ?? nextRows.length));
      setFilteredPoints(Number(data?.filteredPoints ?? nextRows.reduce((sum, row) => sum + Number(row.points || 0), 0)));
      setTotalPages(Math.max(1, Number(data?.totalPages || 1)));
      if (data?.page && Number(data.page) !== page) setPage(Math.max(1, Number(data.page)));
      setPointsPerChat(String(data?.settings?.channelPointsPerChat ?? 1));
      setPointsPerAttendance(String(data?.settings?.channelPointsPerAttendance ?? 0));
      setExcludeText(data?.settings?.channelPointsExcludeUserIdsText || '');
      setPointsPerDonationK(String(donationData?.settings?.pointsPerK ?? 10));
    });
  }, [deferredQuery, page, sortBy]);

  useEffect(() => {
    load();
  }, [load]);

  const savePoints = async (row: PointRow) => {
    const userId = rowUserId(row);
    if (!userId) return;
    setBusyId(`save:${userId}`);
    try {
      await postJson('/api/channelpoints/set', {
        userId,
        username: row.username || null,
        points: Math.max(0, Math.floor(Number(drafts[userId] || 0))),
      });
      toast.success('시청자 포인트를 수정했습니다.');
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '포인트를 수정하지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  const adjustPoints = async (row: PointRow, delta: number) => {
    const userId = rowUserId(row);
    if (!userId) return;
    setBusyId(`adjust:${userId}:${delta}`);
    try {
      await postJson('/api/channelpoints/incr', {
        userId,
        username: row.username || null,
        delta,
      });
      toast.success(delta > 0 ? '포인트를 지급했습니다.' : '포인트를 차감했습니다.');
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '포인트를 변경하지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  const deletePoints = async (row: PointRow) => {
    const userId = rowUserId(row);
    if (!userId || !window.confirm(`${row.username || userId}님의 포인트 기록을 삭제할까요?`)) return;
    setBusyId(`delete:${userId}`);
    try {
      await postJson('/api/channelpoints/delete', { userId });
      toast.success('포인트 기록을 삭제했습니다.');
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '포인트 기록을 삭제하지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  const savePointSettings = async () => {
    setBusyId('settings');
    try {
      const current = await readJson<BotSettingsResponse>('/api/bot/settings');
      await postJson('/api/bot/settings', {
        settings: {
          ...(current?.settings || {}),
          channelPointsPerChat: Math.max(0, Number(pointsPerChat || 0)),
          channelPointsPerAttendance: Math.max(0, Number(pointsPerAttendance || 0)),
          channelPointsExcludeUserIdsText: excludeText,
        },
      });
      await postJson('/api/donation/settings', {
        settings: {
          pointsPerK: Math.max(0, Number(pointsPerDonationK || 0)),
        },
      });
      toast.success('포인트 적립 설정을 저장했습니다.');
      setSettingsOpen(false);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '포인트 설정을 저장하지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="grid gap-[clamp(1rem,2vw,1.5rem)]">
      <section className="border-b pb-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <PageHeader className="border-0 pb-0" eyebrow="Audience economy" title="시청자 포인트" description="시청자별 잔액과 적립 정책을 확인하고 지급·차감 내역을 관리합니다." />
          <div className="grid min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-2 lg:basis-[34%]">
            <div className="min-w-0 rounded-[var(--radius-card)] border bg-card p-[clamp(0.75rem,1.5vw,1rem)] text-center shadow-subtle">
              <div className="truncate text-xl font-bold">{totalRows.toLocaleString('ko-KR')}</div>
              <div className="mt-1 text-xs text-muted-foreground">시청자</div>
            </div>
            <div className="min-w-0 rounded-[var(--radius-card)] border bg-card p-[clamp(0.75rem,1.5vw,1rem)] text-center shadow-subtle">
              <div className="truncate text-xl font-bold">{formatPoints(totalPoints)}</div>
              <div className="mt-1 text-xs text-muted-foreground">총 포인트</div>
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setSettingsOpen(true)}>
          <Settings className="h-4 w-4" />
          포인트 설정
        </Button>
        <LinkButton href="/points/import" variant="outline">가져오기</LinkButton>
        <LinkButton href="/points/export" variant="outline">내보내기</LinkButton>
        <Button type="button" variant="secondary" onClick={load} disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          새로고침
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>포인트 목록</CardTitle>
          <CardDescription>활발한 시청자를 찾고, 이벤트 보상 포인트를 바로 더하거나 조정할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 rounded-[var(--radius-panel)] border bg-background/62 p-[clamp(0.875rem,1.8vw,1.2rem)] lg:grid-cols-[minmax(0,1fr)_minmax(14rem,0.28fr)_auto] lg:items-center">
            <label className="relative min-w-0">
              <span className="sr-only">시청자 검색</span>
              <Search className="pointer-events-none absolute left-[clamp(0.85rem,1.6vw,1.05rem)] top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="닉네임, 플랫폼 ID, 아루봇 UUID로 검색"
                className="pl-[clamp(2.4rem,4vw,2.8rem)]"
              />
            </label>
            <label className="grid min-w-0 gap-1.5 text-xs font-bold text-muted-foreground">
              정렬
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as PointsSortKey)}
                className="box-border min-h-[var(--control-height)] w-full min-w-0 rounded-[var(--radius-control)] border bg-background/80 px-[clamp(0.85rem,1.6vw,1.1rem)] text-sm font-semibold text-foreground outline-none transition focus:border-primary/45 focus:ring-2 focus:ring-ring"
              >
                <option value="points-desc">포인트 많은 순</option>
                <option value="points-asc">포인트 적은 순</option>
                <option value="name-asc">이름 가나다 순</option>
                <option value="name-desc">이름 역순</option>
                <option value="connected-first">연결 계정 우선</option>
                <option value="blocked-first">적립 제외 우선</option>
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-muted-foreground lg:justify-end">
              <Badge tone="sky">{filteredTotalRows.toLocaleString('ko-KR')}명 표시</Badge>
              <Badge tone="mint">{formatPoints(filteredPoints)}</Badge>
              {query ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setQuery('')}>
                  <X className="h-4 w-4" />
                  검색 지우기
                </Button>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border bg-card/70 px-2.5 py-1">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  전체 목록
                </span>
              )}
            </div>
          </div>

          {totalRows > 0 && filteredTotalRows > 0 ? (
            <div className="overflow-x-auto rounded-[var(--radius-control)] border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-muted/70 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-semibold">시청자</th>
                    <th className="px-4 py-3 font-semibold">식별자</th>
                    <th className="px-4 py-3 font-semibold">연결 계정</th>
                    <th className="px-4 py-3 font-semibold">현재 포인트</th>
                    <th className="px-4 py-3 font-semibold">수정</th>
                    <th className="px-4 py-3 font-semibold">빠른 조정</th>
                    <th className="px-4 py-3 font-semibold">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const userId = rowUserId(row);
                    const identityValue = row.arubotUuid || userId;
                    const identityLabel = row.arubotUuid ? '아루봇 UUID' : '플랫폼 채팅 ID';
                    return (
                      <tr key={userId} className="border-t bg-background/45">
                        <td className="px-4 py-3">
                          <div className="font-semibold">{row.username || userId}</div>
                          <div className="mt-1 max-w-[22ch] truncate text-xs text-muted-foreground">{userId}</div>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => navigator.clipboard?.writeText(identityValue).then(() => toast.success(`${identityLabel}를 복사했습니다.`)).catch(() => undefined)}
                            className="rounded-full border bg-muted/55 px-2.5 py-1 text-xs font-bold transition hover:border-primary/35 hover:bg-pastel-mint/55"
                          >
                            {identityValue}
                          </button>
                          <div className="mt-1 text-[0.7rem] font-semibold text-muted-foreground">{identityLabel}</div>
                          {row.pointBlocked ? (
                            <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-1 text-xs font-bold text-destructive">
                              <ShieldOff className="h-3 w-3" />
                              적립 제외
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <div className="grid gap-1.5">
                            {(row.platformAccounts || []).length ? row.platformAccounts?.map((account) => (
                              <div key={`${account.provider}:${account.platformUserId}`} className="rounded-[var(--radius-control)] border bg-card/70 px-2.5 py-1.5 text-xs">
                                <div className="font-bold uppercase">{account.provider || 'platform'}</div>
                                <div className="mt-0.5 text-muted-foreground">{account.nickname || account.handle || account.platformUserId}</div>
                                <div className="mt-0.5 max-w-[24ch] truncate text-muted-foreground">{account.platformUserId}</div>
                              </div>
                            )) : (
                              <div className="text-xs leading-5 text-muted-foreground">아루봇 로그인 계정과 연결되지 않은 플랫폼 채팅 ID입니다.</div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-bold">{formatPoints(Number(row.points || 0))}</td>
                        <td className="px-4 py-3">
                          <Input
                            value={drafts[userId] ?? String(Number(row.points || 0))}
                            onChange={(event) => setDrafts((current) => ({ ...current, [userId]: event.target.value }))}
                            inputMode="numeric"
                            className="min-h-[var(--control-height-sm)] text-right tabular-nums"
                            aria-label={`${row.username || userId} 포인트`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {[100, 1000, -100].map((delta) => (
                              <Button key={delta} type="button" variant="outline" size="sm" onClick={() => adjustPoints(row, delta)} disabled={!!busyId}>
                                {delta > 0 ? `+${delta}` : delta}
                              </Button>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <Button type="button" variant="ghost" size="icon" onClick={() => savePoints(row)} disabled={!!busyId} aria-label="포인트 저장">
                              {busyId === `save:${userId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            </Button>
                            <Button type="button" variant="ghost" size="icon" onClick={() => deletePoints(row)} disabled={!!busyId} aria-label="포인트 삭제">
                              {busyId === `delete:${userId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : totalRows ? (
            <div className="rounded-[var(--radius-control)] border border-dashed bg-background/55 p-[clamp(1.25rem,2.6vw,1.75rem)] text-center text-sm text-muted-foreground">
              검색 조건에 맞는 시청자가 없습니다.
            </div>
          ) : (
            <div className="rounded-[var(--radius-control)] border border-dashed bg-background/55 p-[clamp(1.25rem,2.6vw,1.75rem)] text-center text-sm text-muted-foreground">
              아직 포인트가 쌓인 시청자가 없습니다.
            </div>
          )}
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </CardContent>
      </Card>

      {settingsOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/24 p-[var(--page-gutter)] backdrop-blur-sm">
          <div className="grid max-h-[min(92svh,44rem)] w-[min(94vw,42rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[var(--radius-panel)] border bg-card shadow-lift">
            <div className="flex items-start justify-between gap-4 border-b p-[clamp(1rem,2.4vw,1.5rem)]">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Badge tone="mint">포인트 적립</Badge>
                  <Badge tone="sky">방송 중 채팅만 적립</Badge>
                </div>
                <h2 className="break-keep text-2xl font-semibold">포인트가 쌓이는 순간을 정하세요.</h2>
                <p className="mt-2 break-keep text-sm leading-6 text-muted-foreground">
                  채팅, 출석, 후원이 어떤 보상으로 이어질지 방송 스타일에 맞춰 정합니다. 포인트를 주고 싶지 않은 계정은 목록에서 제외할 수 있어요.
                </p>
              </div>
              <Button type="button" variant="outline" size="icon" onClick={() => setSettingsOpen(false)} aria-label="닫기">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid min-h-0 gap-4 overflow-y-auto p-[clamp(1rem,2.4vw,1.5rem)]">
              <div className="grid min-w-0 gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))]">
                <label className="grid gap-2 text-sm font-semibold">
                  채팅 1개당 포인트
                  <Input value={pointsPerChat} onChange={(event) => setPointsPerChat(event.target.value)} inputMode="numeric" />
                </label>
                <label className="grid gap-2 text-sm font-semibold">
                  출석 포인트
                  <Input value={pointsPerAttendance} onChange={(event) => setPointsPerAttendance(event.target.value)} inputMode="numeric" />
                </label>
                <label className="grid gap-2 text-sm font-semibold">
                  후원 1,000원당 포인트
                  <Input value={pointsPerDonationK} onChange={(event) => setPointsPerDonationK(event.target.value)} inputMode="numeric" />
                </label>
              </div>
              <label className="grid gap-2 text-sm font-semibold">
                포인트 적립 제외 UUID
                <textarea
                  value={excludeText}
                  onChange={(event) => setExcludeText(event.target.value)}
                  placeholder={'aru_로 시작하는 아루봇 UUID\nCHZZK 또는 CIME 플랫폼 채팅 ID'}
                  className="box-border min-h-[12rem] w-full min-w-0 max-w-full resize-y rounded-[var(--radius-control)] border bg-background/80 p-[clamp(0.75rem,1.4vw,1rem)] text-sm leading-6 outline-none transition placeholder:text-muted-foreground focus:border-primary/45 focus:ring-2 focus:ring-ring"
                />
              </label>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t bg-background/64 p-[clamp(1rem,2.4vw,1.5rem)] sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => setSettingsOpen(false)}>취소</Button>
              <Button type="button" onClick={savePointSettings} disabled={busyId === 'settings'}>
                {busyId === 'settings' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                설정 저장
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
