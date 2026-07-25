'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FilterX,
  RefreshCw,
  Search,
  Settings2,
  UserRound,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, SectionHeader, StatusDot } from '@/components/ui/page';
import { Input } from '@/components/ui/input';
import { readJsonResult } from '@/shared/api/http';
import { cn } from '@/shared/lib/utils';
import { providerLabel, runtimeStatusLabel } from '@/features/admin/arubot-admin-format';
import type {
  AdminConsoleFilters,
  AdminPlatformRuntime,
  AdminStreamer,
  AdminStreamerFeatureDetails,
} from '@/features/admin/arubot-admin-types';

const dateTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const numberFormatter = new Intl.NumberFormat('ko-KR');

const selectClassName = 'min-h-[var(--control-height)] w-full rounded-[var(--radius-control)] border bg-card px-3 text-sm font-medium outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/20';

function runtimeStatusTone(status?: AdminStreamer['runtime']['status']): 'mint' | 'sky' | 'amber' | 'neutral' {
  if (status === 'running') return 'mint';
  if (status === 'managed_elsewhere' || status === 'checking') return 'sky';
  if (status === 'attention') return 'amber';
  return 'neutral';
}

function formatDateTime(value?: string | number | null) {
  if (!value) return '기록 없음';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  return Number.isFinite(date.getTime()) ? dateTimeFormatter.format(date) : '기록 없음';
}

function streamerName(streamer: AdminStreamer) {
  return streamer.displayName || streamer.platforms.find((platform) => platform.channelName)?.channelName || streamer.userId;
}

function featureTotal(streamer: AdminStreamer) {
  return Number(streamer.features.commands.total || 0)
    + Number(streamer.features.macros.total || 0)
    + Number(streamer.features.roulettes.total || 0)
    + Number(streamer.features.actions.total || 0)
    + Number(streamer.features.donations.total || 0)
    + Number(streamer.features.automations.total || 0);
}

function PlatformBadges({ platforms }: { platforms: AdminPlatformRuntime[] }) {
  if (!platforms.length) return <span className="text-xs text-muted-foreground">연결 없음</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {platforms.map((platform, index) => (
        <Badge
          key={`${platform.provider}-${platform.platformUserId || platform.channelId || index}`}
          tone={platform.live === true ? 'mint' : platform.recovering ? 'sky' : platform.reauthRequired || platform.lastError ? 'amber' : 'neutral'}
        >
          {providerLabel(platform.provider)}{platform.live === true ? ' · LIVE' : platform.recovering ? ' · 복구 중' : ''}
        </Badge>
      ))}
    </div>
  );
}

function FeatureSummary({ streamer }: { streamer: AdminStreamer }) {
  const entries = [
    ['명령어', streamer.features.commands.total],
    ['알림', streamer.features.macros.total],
    ['룰렛', streamer.features.roulettes.total],
    ['액션', streamer.features.actions.total],
  ] as const;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {entries.map(([label, value]) => (
        <span key={label}><span className="font-semibold text-foreground">{numberFormatter.format(Number(value || 0))}</span> {label}</span>
      ))}
    </div>
  );
}

function featureStateLabel(enabled?: boolean) {
  return enabled === false ? '사용 안 함' : '사용 중';
}

function formatInterval(seconds?: number | null) {
  const value = Math.max(0, Number(seconds || 0));
  if (!value) return '주기 미설정';
  if (value % 3600 === 0) return `${value / 3600}시간마다`;
  if (value >= 60) return `${Math.round(value / 60)}분마다`;
  return `${value}초마다`;
}

function FeatureDetailGroup({
  title,
  count,
  truncated,
  children,
}: {
  title: string;
  count: number;
  truncated?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="group overflow-hidden rounded-[var(--radius-control)] border bg-background/60">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-sm font-semibold marker:content-none hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <span>{title}</span>
        <span className="flex items-center gap-2"><Badge tone={count ? 'sky' : 'neutral'}>{count}개</Badge><ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden="true" /></span>
      </summary>
      <div className="border-t">
        {count ? children : <div className="px-4 py-4 text-xs text-muted-foreground">등록된 항목이 없습니다.</div>}
        {truncated ? <div className="border-t bg-amber-500/5 px-4 py-2 text-xs text-amber-800 dark:text-amber-200">최대 100개까지만 표시합니다.</div> : null}
      </div>
    </details>
  );
}

function StreamerFeatureDetails({ userId }: { userId: string }) {
  const [details, setDetails] = useState<AdminStreamerFeatureDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    let active = true;
    setDetails(null);
    setError(null);
    setLoading(true);
    readJsonResult<AdminStreamerFeatureDetails>(`/api/arubot-admin/streamers/${encodeURIComponent(userId)}/features`, { signal: controller.signal })
      .then((result) => {
        if (!active) return;
        if (result.ok) setDetails(result.data);
        else setError(result.status === 404 ? '이 스트리머의 계정을 찾을 수 없습니다.' : '등록 기능 상세를 불러오지 못했습니다.');
      })
      .catch((reason) => {
        if (!active) return;
        if (reason instanceof DOMException && reason.name === 'AbortError') setError('기능 상세 확인 시간이 초과되었습니다.');
        else setError('등록 기능 상세를 불러오지 못했습니다.');
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [revision, userId]);

  return (
    <Card aria-label="등록 기능 상세">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><CardTitle>등록 기능 상세</CardTitle><p className="mt-1 text-xs leading-5 text-muted-foreground">선택한 스트리머가 실제로 저장해 사용 중인 기능 이름과 상태입니다. 인증 정보와 실행 비밀값은 제외합니다.</p></div>
          <Button type="button" variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)} disabled={loading}><RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />다시 확인</Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 pt-4" aria-busy={loading} aria-live="polite">
        {loading ? <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" />실제 기능 설정을 확인하고 있습니다.</div> : null}
        {error && !loading ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"><span>{error}</span><Button type="button" variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>다시 시도</Button></div> : null}
        {details && !loading ? (
          <>
            <FeatureDetailGroup title="채팅 명령어" count={details.commands.length} truncated={details.truncated?.commands}>
              <div className="divide-y">{details.commands.map((item) => <div key={item.id} className="grid gap-1.5 px-4 py-3 text-xs"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-foreground">{item.name || item.keywords?.[0] || item.id}</span><Badge tone={item.enabled === false ? 'neutral' : 'mint'}>{featureStateLabel(item.enabled)}</Badge>{item.adminOnly ? <Badge tone="violet">관리자 전용</Badge> : null}</div><div className="text-muted-foreground">{item.keywords?.length ? item.keywords.join(', ') : '키워드 없음'}</div>{item.responsePreview ? <div className="break-words text-muted-foreground">응답 · {item.responsePreview}</div> : null}</div>)}</div>
            </FeatureDetailGroup>
            <FeatureDetailGroup title="자동 알림" count={details.macros.length} truncated={details.truncated?.macros}>
              <div className="divide-y">{details.macros.map((item) => <div key={item.id} className="grid gap-1.5 px-4 py-3 text-xs"><div className="flex items-center gap-2"><span className="font-semibold text-foreground">{formatInterval(item.intervalSec)}</span><Badge tone={item.enabled === false ? 'neutral' : 'mint'}>{featureStateLabel(item.enabled)}</Badge></div><div className="break-words text-muted-foreground">{item.messagePreview || '메시지 없음'}</div></div>)}</div>
            </FeatureDetailGroup>
            <FeatureDetailGroup title="룰렛" count={details.roulettes.length} truncated={details.truncated?.roulettes}>
              <div className="divide-y">{details.roulettes.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs"><span className="font-semibold text-foreground">{item.name || item.id}</span><span className="text-muted-foreground">{item.theme || item.type || '기본'} · 항목 {Number(item.itemCount || 0)}개</span></div>)}</div>
            </FeatureDetailGroup>
            <FeatureDetailGroup title="실행 액션" count={details.actions.length} truncated={details.truncated?.actions}>
              <div className="divide-y">{details.actions.map((item) => <div key={item.id} className="grid gap-1.5 px-4 py-3 text-xs"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-foreground">{item.name || item.slug || item.id}</span><Badge tone={item.enabled === false ? 'neutral' : 'mint'}>{featureStateLabel(item.enabled)}</Badge><Badge tone={item.published ? 'sky' : 'neutral'}>{item.published ? '게시됨' : '초안'}</Badge></div>{item.description ? <div className="break-words text-muted-foreground">{item.description}</div> : null}</div>)}</div>
            </FeatureDetailGroup>
            <FeatureDetailGroup title="후원 반응" count={details.donations.length} truncated={details.truncated?.donations}>
              <div className="divide-y">{details.donations.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs"><span className="font-semibold text-foreground">{item.name || item.id}</span><span className="flex items-center gap-2"><span className="text-muted-foreground">{item.amountSummary || '금액 조건'}</span><Badge tone={item.enabled === false ? 'neutral' : 'mint'}>{featureStateLabel(item.enabled)}</Badge></span></div>)}</div>
            </FeatureDetailGroup>
            <FeatureDetailGroup title="자동화 연결" count={details.automations.length} truncated={details.truncated?.automations}>
              <div className="divide-y">{details.automations.map((item) => <div key={item.id} className="grid gap-1.5 px-4 py-3 text-xs"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-foreground">{item.name || item.id}</span><Badge tone={item.enabled === false ? 'neutral' : 'mint'}>{featureStateLabel(item.enabled)}</Badge><Badge tone="neutral">{item.type || item.executionMode || '자동화'}</Badge></div><div className="text-muted-foreground">상태 {item.lastStatus || '미확인'} · 최근 확인 {formatDateTime(item.lastCheckedAt)}</div></div>)}</div>
            </FeatureDetailGroup>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StreamerIdentity({ streamer, compact = false }: { streamer: AdminStreamer; compact?: boolean }) {
  const name = streamerName(streamer);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className={cn('grid shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted text-muted-foreground', compact ? 'h-9 w-9' : 'h-11 w-11')}>
        {streamer.avatarUrl ? (
          <img src={streamer.avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <UserRound className="h-4 w-4" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-foreground">{name}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{streamer.userId}</span>
      </span>
    </div>
  );
}

function StreamerMobileCard({
  streamer,
  selected,
  onSelect,
}: {
  streamer: AdminStreamer;
  selected: boolean;
  onSelect: () => void;
}) {
  const inspectorId = `streamer-inspector-${encodeURIComponent(streamer.userId)}`;
  return (
    <article className={cn('rounded-[var(--radius-card)] border bg-card p-4 shadow-subtle', selected && 'border-primary/45 ring-2 ring-primary/10')}>
      <div className="flex items-start justify-between gap-3">
        <StreamerIdentity streamer={streamer} />
        <Badge tone={runtimeStatusTone(streamer.runtime.status)}>{runtimeStatusLabel(streamer.runtime.status)}</Badge>
      </div>
      <div className="mt-4"><PlatformBadges platforms={streamer.platforms} /></div>
      <div className="mt-3 border-t pt-3"><FeatureSummary streamer={streamer} /></div>
      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{streamer.live.live ? '현재 라이브' : `최근 활동 ${formatDateTime(streamer.activity.lastEventAt || streamer.lastPlatformActivityAt)}`}</span>
        <Button type="button" variant={selected ? 'soft' : 'outline'} size="sm" onClick={onSelect} aria-label={`${streamerName(streamer)} 상세 보기`} aria-expanded={selected} aria-controls={inspectorId}>
          상세 보기
        </Button>
      </div>
    </article>
  );
}

function StreamerInspector({
  streamer,
  refreshing,
  onRefreshRuntime,
  onCopy,
}: {
  streamer: AdminStreamer;
  refreshing: boolean;
  onRefreshRuntime: () => void;
  onCopy: (value: string) => void;
}) {
  const name = streamerName(streamer);
  const features = [
    { label: '채팅 명령어', value: streamer.features.commands.total, detail: `사용 ${streamer.features.commands.enabled || 0}개` },
    { label: '자동 알림', value: streamer.features.macros.total, detail: `사용 ${streamer.features.macros.enabled || 0}개` },
    { label: '룰렛', value: streamer.features.roulettes.total, detail: `항목 ${streamer.features.roulettes.items || 0}개` },
    { label: '실행 액션', value: streamer.features.actions.total, detail: `게시 ${streamer.features.actions.published || 0}개` },
    { label: '후원 반응', value: streamer.features.donations.total, detail: '등록 규칙' },
    { label: '자동화 연결', value: streamer.features.automations.total, detail: `사용 ${streamer.features.automations.enabled || 0}개` },
  ];

  return (
    <Card className="border-primary/20" aria-label={`${name} 운영 상세`}>
      <CardHeader className="border-b">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{name}</CardTitle>
              {streamer.isAdmin ? <Badge tone="violet">관리자</Badge> : null}
              <Badge tone={runtimeStatusTone(streamer.runtime.status)}>{runtimeStatusLabel(streamer.runtime.status)}</Badge>
            </div>
            <button type="button" onClick={() => onCopy(streamer.userId)} className="mt-2 inline-flex max-w-full items-center gap-1.5 break-all text-left text-xs text-muted-foreground hover:text-foreground">
              {streamer.userId}<Copy className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </button>
          </div>
          <Button type="button" variant="outline" onClick={onRefreshRuntime} disabled={refreshing}>
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} aria-hidden="true" />
            {refreshing ? '반영 중' : '봇 설정 즉시 반영'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 pt-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
        <section aria-labelledby="streamer-platform-heading">
          <h3 id="streamer-platform-heading" className="text-sm font-semibold">연결된 방송</h3>
          <div className="mt-3 divide-y rounded-[var(--radius-control)] border bg-background/60">
            {streamer.platforms.map((platform, index) => (
              <div key={`${platform.provider}-${platform.platformUserId || index}`} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={platform.live ? 'mint' : 'neutral'}>{providerLabel(platform.provider)}</Badge>
                    <span className="truncate text-sm font-semibold">{platform.channelName || platform.channelHandle || platform.channelId || platform.platformUserId}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{platform.live === true ? '라이브 중' : platform.live === false ? '오프라인' : '라이브 상태 미확인'}</span>
                    <span>{platform.streamConnected ? '채팅 연결됨' : platform.recovering ? '채팅 자동 재연결 중' : platform.runtimeLeaseActive ? '실행 lease 감지됨 · 응답 확인 전' : '채팅 대기'}</span>
                    {platform.authorization === 'expired' ? <span className="text-amber-700 dark:text-amber-300">재인증 필요</span> : null}
                  </div>
                  {platform.provider === 'youtube' ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      운영자 확인 {platform.moderatorRegistered ? '완료' : '필요'} · WebSub {platform.websubStatus || '미확인'}
                    </div>
                  ) : null}
                  {platform.lastError ? <p className="mt-2 break-words text-xs text-destructive">{platform.lastError}</p> : null}
                </div>
                <StatusDot
                  status={platform.lastError || platform.reauthRequired ? 'warning' : platform.streamConnected ? 'success' : platform.recovering || platform.runtimeLeaseActive ? 'info' : 'neutral'}
                  label={platform.lastError || platform.reauthRequired ? '점검 필요' : platform.streamConnected ? '응답 가능' : platform.recovering ? '자동 복구 중' : platform.runtimeLeaseActive ? '실행 정보 감지' : '대기'}
                />
              </div>
            ))}
            {!streamer.platforms.length ? (
              <div className="p-4 text-sm text-muted-foreground">연결된 방송 플랫폼이 없습니다.</div>
            ) : null}
          </div>
        </section>

        <section aria-labelledby="streamer-feature-heading">
          <h3 id="streamer-feature-heading" className="text-sm font-semibold">사용 중인 기능</h3>
          <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-control)] border bg-border">
            {features.map((feature) => (
              <div key={feature.label} className="bg-card p-3.5">
                <dt className="text-xs text-muted-foreground">{feature.label}</dt>
                <dd className="mt-1 text-xl font-bold tracking-tight">{numberFormatter.format(Number(feature.value || 0))}</dd>
                <div className="mt-1 text-[0.6875rem] text-muted-foreground">{feature.detail}</div>
              </div>
            ))}
          </dl>
          <div className="mt-4 rounded-[var(--radius-control)] border bg-background/60 p-4 text-xs leading-6 text-muted-foreground">
            <div className="flex items-center justify-between gap-3"><span>최근 이벤트</span><span className="font-semibold text-foreground">{formatDateTime(streamer.activity.lastEventAt)}</span></div>
            <div className="mt-1 flex items-center justify-between gap-3"><span>24시간 처리</span><span className="font-semibold text-foreground">{numberFormatter.format(Number(streamer.activity.events24h || 0))}건</span></div>
            <div className="mt-1 flex items-center justify-between gap-3"><span>누적 명령 응답</span><span className="font-semibold text-foreground">{numberFormatter.format(Number(streamer.bot.commandsHandled || 0))}건</span></div>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

export function StreamerDirectory({
  filters,
  onFiltersChange,
  streamers,
  total,
  selectedUserId,
  onSelect,
  onResetFilters,
  onExport,
  onCopy,
  onRefreshRuntime,
  refreshingUserId,
  loading,
  pageIndex,
  totalPages,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: {
  filters: AdminConsoleFilters;
  onFiltersChange: (filters: AdminConsoleFilters) => void;
  streamers: AdminStreamer[];
  total: number;
  selectedUserId: string | null;
  onSelect: (userId: string) => void;
  onResetFilters: () => void;
  onExport: () => void;
  onCopy: (value: string) => void;
  onRefreshRuntime: (streamer: AdminStreamer) => void;
  refreshingUserId: string | null;
  loading: boolean;
  pageIndex: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const selected = streamers.find((streamer) => streamer.userId === selectedUserId) || null;
  const filtered = filters.q || filters.platform !== 'all' || filters.live !== 'all' || filters.feature !== 'all';
  const inspectorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selected || !inspectorRef.current || !window.matchMedia('(max-width: 1023px)').matches) return;
    const frame = window.requestAnimationFrame(() => {
      inspectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      inspectorRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selected]);

  return (
    <div className="grid gap-5" aria-busy={loading}>
      <section className="rounded-[var(--radius-card)] border bg-card p-4 shadow-subtle" aria-labelledby="streamer-filter-heading">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
          <label className="min-w-0 flex-1" htmlFor="admin-streamer-search">
            <span id="streamer-filter-heading" className="mb-2 block text-xs font-semibold">스트리머 검색</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id="admin-streamer-search"
                value={filters.q}
                onChange={(event) => onFiltersChange({ ...filters, q: event.target.value })}
                placeholder="이름, 사용자 ID, 채널명, 핸들 검색"
                className="pl-10"
              />
            </span>
          </label>
          <div className="grid min-w-0 flex-[1.2] gap-3 sm:grid-cols-3">
            <label className="min-w-0 text-xs font-semibold">
              <span className="mb-2 block">플랫폼</span>
              <select className={selectClassName} value={filters.platform} onChange={(event) => onFiltersChange({ ...filters, platform: event.target.value as AdminConsoleFilters['platform'] })}>
                <option value="all">전체 플랫폼</option><option value="chzzk">CHZZK</option><option value="cime">CIME</option><option value="youtube">YouTube</option>
              </select>
            </label>
            <label className="min-w-0 text-xs font-semibold">
              <span className="mb-2 block">라이브</span>
              <select className={selectClassName} value={filters.live} onChange={(event) => onFiltersChange({ ...filters, live: event.target.value as AdminConsoleFilters['live'] })}>
                <option value="all">전체 상태</option><option value="live">라이브 중</option><option value="offline">오프라인</option>
              </select>
            </label>
            <label className="min-w-0 text-xs font-semibold">
              <span className="mb-2 block">사용 기능</span>
              <select className={selectClassName} value={filters.feature} onChange={(event) => onFiltersChange({ ...filters, feature: event.target.value as AdminConsoleFilters['feature'] })}>
                <option value="all">전체 기능</option><option value="commands">명령어</option><option value="macros">자동 알림</option><option value="roulettes">룰렛</option><option value="actions">실행 액션</option><option value="donations">후원 반응</option><option value="automations">자동화 연결</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {filtered ? <Button type="button" variant="ghost" onClick={onResetFilters}><FilterX className="h-4 w-4" aria-hidden="true" />초기화</Button> : null}
            <Button type="button" variant="outline" onClick={onExport} disabled={!streamers.length}><Download className="h-4 w-4" aria-hidden="true" />현재 목록 CSV</Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="streamer-list-heading">
        <SectionHeader
          title={<span id="streamer-list-heading">등록 스트리머</span>}
          description={`조건에 맞는 ${numberFormatter.format(total)}개 계정 · PostgreSQL 실데이터 기준`}
          actions={<Badge tone={loading ? 'sky' : 'neutral'}>{loading ? '최신화 중' : `${numberFormatter.format(streamers.length)}개 표시`}</Badge>}
        />

        {streamers.length ? (
          <>
            <div className="mt-4 hidden overflow-x-auto rounded-[var(--radius-card)] border bg-card shadow-subtle lg:block">
              <table className="min-w-[920px] w-full text-left text-sm">
                <caption className="sr-only">등록 스트리머의 연결 플랫폼, 라이브 상태, 봇 상태, 사용 기능</caption>
                <thead className="border-b bg-muted/45 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3.5 font-semibold">스트리머</th>
                    <th scope="col" className="px-4 py-3.5 font-semibold">연결 방송</th>
                    <th scope="col" className="px-4 py-3.5 font-semibold">봇 상태</th>
                    <th scope="col" className="px-4 py-3.5 font-semibold">등록 기능</th>
                    <th scope="col" className="px-4 py-3.5 font-semibold">최근 활동</th>
                    <th scope="col" className="px-4 py-3.5 text-right font-semibold">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {streamers.map((streamer) => {
                    const active = selectedUserId === streamer.userId;
                    return (
                      <tr key={streamer.userId} className={cn('transition-colors', active ? 'bg-primary/5' : 'hover:bg-muted/30')} style={{ contentVisibility: 'auto', containIntrinsicSize: '0 72px' }}>
                        <td className="px-4 py-3.5"><StreamerIdentity streamer={streamer} compact /></td>
                        <td className="px-4 py-3.5"><PlatformBadges platforms={streamer.platforms} /></td>
                        <td className="px-4 py-3.5"><Badge tone={runtimeStatusTone(streamer.runtime.status)}>{runtimeStatusLabel(streamer.runtime.status)}</Badge>{streamer.runtime.lastError ? <div className="mt-1 max-w-[22ch] truncate text-xs text-destructive">{streamer.runtime.lastError}</div> : null}</td>
                        <td className="px-4 py-3.5"><FeatureSummary streamer={streamer} /><div className="mt-1 text-[0.6875rem] text-muted-foreground">총 {numberFormatter.format(featureTotal(streamer))}개 구성</div></td>
                        <td className="px-4 py-3.5 text-xs text-muted-foreground"><time dateTime={streamer.activity.lastEventAt || streamer.lastPlatformActivityAt || undefined}>{formatDateTime(streamer.activity.lastEventAt || streamer.lastPlatformActivityAt)}</time></td>
                        <td className="px-4 py-3.5 text-right"><Button type="button" variant={active ? 'soft' : 'outline'} size="sm" onClick={() => onSelect(streamer.userId)} aria-label={`${streamerName(streamer)} 상세 보기`} aria-expanded={active} aria-controls={`streamer-inspector-${encodeURIComponent(streamer.userId)}`}>상세</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-4 grid gap-3 lg:hidden">
              {streamers.map((streamer) => <StreamerMobileCard key={streamer.userId} streamer={streamer} selected={selectedUserId === streamer.userId} onSelect={() => onSelect(streamer.userId)} />)}
            </div>
          </>
        ) : (
          <EmptyState
            className="mt-4"
            icon={filtered ? Search : UserRound}
            title={filtered ? '조건에 맞는 스트리머가 없습니다' : '등록된 스트리머가 없습니다'}
            description={filtered ? '검색어나 필터를 바꾸면 다른 계정을 확인할 수 있습니다.' : '플랫폼 로그인으로 등록된 계정이 생기면 여기에 실제 운영 정보가 표시됩니다.'}
            action={filtered ? <Button type="button" variant="outline" onClick={onResetFilters}><FilterX className="h-4 w-4" />필터 초기화</Button> : undefined}
          />
        )}

        {(hasPrevious || hasNext) ? (
          <nav className="mt-5 flex flex-wrap items-center justify-between gap-3" aria-label="스트리머 목록 페이지 이동">
            <div className="text-xs text-muted-foreground">{pageIndex} / {Math.max(pageIndex, totalPages)} 페이지</div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onPrevious} disabled={!hasPrevious || loading}><ChevronLeft className="h-4 w-4" />이전</Button>
              <Button type="button" variant="outline" size="sm" onClick={onNext} disabled={!hasNext || loading}>다음<ChevronRight className="h-4 w-4" /></Button>
            </div>
          </nav>
        ) : null}
      </section>

      {selected ? (
        <div ref={inspectorRef} id={`streamer-inspector-${encodeURIComponent(selected.userId)}`} tabIndex={-1} className="scroll-mt-5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <StreamerInspector streamer={selected} refreshing={refreshingUserId !== null} onRefreshRuntime={() => onRefreshRuntime(selected)} onCopy={onCopy} />
          <div className="mt-5"><StreamerFeatureDetails userId={selected.userId} /></div>
        </div>
      ) : streamers.length ? (
        <div className="rounded-[var(--radius-card)] border border-dashed bg-muted/15 px-5 py-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-2 font-semibold text-foreground"><Settings2 className="h-4 w-4" />상세 운영 정보</div>
          <p className="mt-2">스트리머 행의 상세 버튼을 누르면 플랫폼별 채팅 연결과 사용 기능을 확인하고, 현재 봇에 설정 반영을 요청할 수 있습니다.</p>
        </div>
      ) : null}
    </div>
  );
}
