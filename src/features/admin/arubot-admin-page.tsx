'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Cable,
  CheckCircle2,
  ListChecks,
  MessageSquare,
  Orbit,
  Radio,
  RefreshCw,
  ServerCog,
  Sparkles,
  Timer,
  Users,
  Workflow,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, PageHeader, SectionHeader } from '@/components/ui/page';
import { apiUrl, readJsonResult } from '@/shared/api/http';
import { cn } from '@/shared/lib/utils';
import { ArubotAdminSystemPanel } from '@/features/admin/arubot-admin-system-panel';
import { providerLabel, runtimeStatusLabel } from '@/features/admin/arubot-admin-format';
import { StreamerDirectory } from '@/features/admin/arubot-admin-streamers';
import type {
  AdminConsoleFilters,
  AdminConsoleSnapshot,
  AdminConsoleTab,
  AdminEvent,
  AdminStatus,
  AdminStreamer,
  YoutubeBotStatus,
} from '@/features/admin/arubot-admin-types';

const PAGE_SIZE = 25;
const EMPTY_FILTERS: AdminConsoleFilters = { q: '', platform: 'all', live: 'all', feature: 'all' };
const ADMIN_TABS: { id: AdminConsoleTab; label: string; description: string; icon: typeof Users }[] = [
  { id: 'overview', label: '운영 개요', description: '핵심 운영 지표와 점검 항목', icon: BarChart3 },
  { id: 'streamers', label: '스트리머', description: '등록 계정, 방송 연결, 봇 상태', icon: Users },
  { id: 'features', label: '기능 현황', description: '명령어, 알림, 룰렛, 액션 사용량', icon: Orbit },
  { id: 'activity', label: '최근 활동', description: '플랫폼별 실제 처리 이벤트', icon: ListChecks },
  { id: 'system', label: '시스템', description: '서버, DB, 중앙 봇과 호환성', icon: ServerCog },
];
const ADMIN_TAB_IDS = new Set(ADMIN_TABS.map((tab) => tab.id));

const YOUTUBE_BOT_ENDPOINTS = {
  login: apiUrl('/api/youtube/bot/login'),
  selectChannel: apiUrl('/api/youtube/bot/select-channel'),
  verify: apiUrl('/api/youtube/bot/verify'),
  confirmConsent: apiUrl('/api/youtube/bot/consent/confirm'),
  delete: apiUrl('/api/youtube/bot'),
};
const YOUTUBE_AUTHORIZATION_HEADING = '중앙 봇 OAuth 권한 보관';

const numberFormatter = new Intl.NumberFormat('ko-KR');
const dateTimeFormatter = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
const REQUEST_TIMEOUT_MS = 12_000;

function formatDateTime(value?: string | null) {
  if (!value) return '기록 없음';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dateTimeFormatter.format(date) : '기록 없음';
}

function getSnapshotUrl(filters: AdminConsoleFilters, cursor: string | null) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.platform !== 'all') params.set('platform', filters.platform);
  if (filters.live !== 'all') params.set('live', filters.live);
  if (filters.feature !== 'all') params.set('feature', filters.feature);
  if (cursor) params.set('cursor', cursor);
  return `/api/arubot-admin/overview?${params.toString()}`;
}

function getSnapshotQueryKey(filters: AdminConsoleFilters, cursor: string | null) {
  return getSnapshotUrl(filters, cursor);
}

function createTimedController(timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  return { controller, clear: () => window.clearTimeout(timeout) };
}

function quoteCsvCell(value: unknown) {
  let text = String(value ?? '').split(String.fromCharCode(0)).join('');
  let firstMeaningfulIndex = 0;
  while (firstMeaningfulIndex < text.length && text.charCodeAt(firstMeaningfulIndex) <= 32) firstMeaningfulIndex += 1;
  const firstCode = text.charCodeAt(0);
  if ('=+-@'.includes(text[firstMeaningfulIndex] || '') || firstCode === 9 || firstCode === 13) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function eventCategoryLabel(category?: string | null) {
  const labels: Record<string, string> = {
    command: '명령어',
    donation: '후원',
    roulette: '룰렛',
    video_donation: '영상 후원',
    drawing_donation: '그림 후원',
    prediction: '예측',
    admin: '관리 작업',
  };
  return labels[String(category || '')] || category || '이벤트';
}

function eventStatusLabel(status?: string | null) {
  if (status === 'failed') return '실패';
  if (status === 'cancelled') return '취소';
  if (status === 'refunded') return '환불';
  return '완료';
}

function eventStatusTone(status?: string | null): 'mint' | 'amber' | 'neutral' {
  if (status === 'failed') return 'amber';
  if (status === 'cancelled' || status === 'refunded') return 'neutral';
  return 'mint';
}

function SummaryMetric({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  icon: typeof Users;
  label: string;
  value: number;
  detail: string;
  tone?: 'neutral' | 'mint' | 'sky' | 'amber';
}) {
  const iconTone = tone === 'mint' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
    : tone === 'sky' ? 'bg-sky-500/10 text-sky-600 dark:text-sky-300'
      : tone === 'amber' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
        : 'bg-muted text-muted-foreground';
  return (
    <div className="min-w-0 px-4 py-4 sm:px-5">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><span className={cn('grid h-7 w-7 place-items-center rounded-md', iconTone)}><Icon className="h-4 w-4" aria-hidden="true" /></span>{label}</div>
      <div className="mt-3 text-3xl font-bold tracking-[-0.04em]">{numberFormatter.format(value)}</div>
      <p className="mt-1 truncate text-[0.6875rem] text-muted-foreground">{detail}</p>
    </div>
  );
}

function FeatureAdoptionRow({
  label,
  icon: Icon,
  users,
  total,
  enabled,
  registered,
  detail,
}: {
  label: string;
  icon: typeof MessageSquare;
  users: number;
  total: number;
  enabled?: number;
  registered: number;
  detail: string;
}) {
  const rate = registered > 0 ? Math.min(100, Math.round((users / registered) * 100)) : 0;
  return (
    <div className="grid gap-4 border-b py-4 last:border-b-0 md:grid-cols-[minmax(12rem,0.8fr)_minmax(12rem,1fr)_auto] md:items-center">
      <div className="flex min-w-0 items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border bg-muted/45 text-muted-foreground"><Icon className="h-4 w-4" aria-hidden="true" /></span><div className="min-w-0"><div className="text-sm font-semibold">{label}</div><div className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</div></div></div>
      <div className="min-w-0"><div className="mb-2 flex items-center justify-between text-xs"><span className="text-muted-foreground">사용 계정</span><span className="font-semibold">{numberFormatter.format(users)} / {numberFormatter.format(registered)} · {rate}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${rate}%` }} /></div></div>
      <div className="text-left md:min-w-32 md:text-right"><div className="text-lg font-bold">{numberFormatter.format(total)}개</div><div className="text-[0.6875rem] text-muted-foreground">{enabled == null ? '등록 합계' : `사용 ${numberFormatter.format(enabled)}개`}</div></div>
    </div>
  );
}

function OverviewPanel({ snapshot, onOpenTab, onInspect }: { snapshot: AdminConsoleSnapshot; onOpenTab: (tab: AdminConsoleTab) => void; onInspect: (userId: string) => void }) {
  const summary = snapshot.summary || {};
  const registered = Number(summary.registeredUsers || 0);
  const attention = snapshot.streamers.filter((streamer) => streamer.runtime.status === 'attention');
  const features = summary.features || {};
  const featureRows = [
    { key: 'commands', label: '채팅 명령어', icon: MessageSquare, detail: '등록된 응답 규칙' },
    { key: 'macros', label: '자동 알림', icon: Timer, detail: '방송 중 반복 공지' },
    { key: 'roulettes', label: '룰렛', icon: Sparkles, detail: '등록된 룰렛 정의' },
    { key: 'actions', label: '실행 액션', icon: Workflow, detail: '방송 자동화 흐름' },
  ] as const;

  return (
    <div className="grid gap-6">
      <section aria-labelledby="admin-summary-heading">
        <h2 id="admin-summary-heading" className="sr-only">서비스 운영 요약</h2>
        <div className="grid overflow-hidden rounded-[var(--radius-card)] border bg-card shadow-subtle sm:grid-cols-2 xl:grid-cols-4 sm:[&>*:nth-child(odd)]:border-r xl:[&>*]:border-r xl:[&>*:last-child]:border-r-0 [&>*]:border-b sm:[&>*:nth-last-child(-n+2)]:border-b-0 xl:[&>*]:border-b-0">
          <SummaryMetric icon={Users} label="등록 계정" value={registered} detail={`방송 연결 ${numberFormatter.format(Number(summary.linkedStreamers || 0))}개`} />
          <SummaryMetric icon={Cable} label="연결 플랫폼" value={Number(summary.connectedPlatforms || 0)} detail="CHZZK · CIME · YouTube" tone="sky" />
          <SummaryMetric icon={Radio} label="현재 라이브" value={Number(summary.liveStreamers || 0)} detail="통합 라이브 세션 기준" tone="mint" />
          <SummaryMetric icon={Activity} label="24시간 활동" value={Number(summary.activeLast24h || 0)} detail={`실패 이벤트 ${numberFormatter.format(Number(summary.failedEvents24h || 0))}건`} tone={Number(summary.failedEvents24h || 0) > 0 ? 'amber' : 'neutral'} />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
        <Card>
          <CardHeader className="border-b"><div className="flex items-center justify-between gap-3"><div><CardTitle>기능 도입 현황</CardTitle><CardDescription>등록 계정 중 실제 기능을 구성한 비율입니다.</CardDescription></div><Button type="button" variant="ghost" size="sm" onClick={() => onOpenTab('features')}>전체 보기</Button></div></CardHeader>
          <CardContent>
            {featureRows.map((row) => {
              const feature = features[row.key] || { total: 0, users: 0 };
              return <FeatureAdoptionRow key={row.key} label={row.label} icon={row.icon} users={Number(feature.users || 0)} total={Number(feature.total || 0)} enabled={feature.enabled} registered={registered} detail={row.detail} />;
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b"><div className="flex items-center justify-between gap-3"><div><CardTitle>현재 조회 결과 점검</CardTitle><CardDescription>지금 표시된 계정 중 운영 확인이 필요한 항목입니다.</CardDescription></div><Badge tone={attention.length ? 'amber' : 'mint'}>{attention.length ? `${attention.length}건` : '정상'}</Badge></div></CardHeader>
          <CardContent className="pt-4">
            {attention.length ? (
              <div className="divide-y">
                {attention.slice(0, 6).map((streamer) => (
                  <button key={streamer.userId} type="button" onClick={() => onInspect(streamer.userId)} className="flex w-full items-start gap-3 py-3 text-left first:pt-0 last:pb-0">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300"><AlertTriangle className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{streamer.displayName || streamer.userId}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{streamer.runtime.lastError || '라이브 중 채팅 응답 연결을 확인해 주세요.'}</span></span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState className="min-h-52 border-0 bg-transparent" icon={CheckCircle2} title="현재 점검 항목이 없습니다" description="조회된 계정의 인증과 런타임에서 확인할 오류가 없습니다." />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(19rem,0.6fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader><CardTitle>플랫폼 분포</CardTitle><CardDescription>가상 YouTube 스트리머 채널까지 중복 없이 포함합니다.</CardDescription></CardHeader>
          <CardContent className="grid gap-2">
            {(['chzzk', 'cime', 'youtube'] as const).map((provider) => (
              <div key={provider} className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0"><div className="flex items-center gap-2"><span className={cn('h-2.5 w-2.5 rounded-full', provider === 'chzzk' ? 'bg-emerald-500' : provider === 'cime' ? 'bg-violet-500' : 'bg-rose-500')} /><span className="text-sm font-semibold">{providerLabel(provider)}</span></div><span className="text-xl font-bold">{numberFormatter.format(Number(summary.platforms?.[provider] || 0))}</span></div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b"><div className="flex items-center justify-between gap-3"><div><CardTitle>최근 처리 이벤트</CardTitle><CardDescription>전체 스트리머에서 가장 최근에 처리된 이벤트입니다.</CardDescription></div><Button type="button" variant="ghost" size="sm" onClick={() => onOpenTab('activity')}>이벤트 보기</Button></div></CardHeader>
          <CardContent className="pt-2">
            {snapshot.recentEvents.length ? snapshot.recentEvents.slice(0, 6).map((event) => (
              <div key={event.id} className="grid gap-2 border-b py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge tone={eventStatusTone(event.status)}>{eventCategoryLabel(event.category)}</Badge><span className="truncate text-sm font-semibold">{event.streamerName || event.ownerUserId}</span></div><p className="mt-1 truncate text-xs text-muted-foreground">{event.summary || event.triggerName || event.eventType}</p></div>
                <time dateTime={event.createdAt || undefined} className="text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</time>
              </div>
            )) : <EmptyState className="min-h-52 border-0 bg-transparent" icon={Activity} title="아직 처리 이벤트가 없습니다" description="실제 명령어, 후원, 룰렛 이벤트가 처리되면 이곳에 표시됩니다." />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FeaturePanel({ snapshot, onInspect }: { snapshot: AdminConsoleSnapshot; onInspect: (userId: string) => void }) {
  const registered = Number(snapshot.summary.registeredUsers || 0);
  const features = snapshot.summary.features || {};
  const rows = [
    { key: 'commands', label: '채팅 명령어', icon: MessageSquare, detail: '플랫폼 채팅에서 실행되는 명령 응답' },
    { key: 'macros', label: '자동 알림', icon: Timer, detail: '방송 중 주기적으로 전송되는 공지' },
    { key: 'roulettes', label: '룰렛', icon: Sparkles, detail: '실제 오버레이에서 사용하는 룰렛 정의' },
    { key: 'actions', label: '실행 액션', icon: Workflow, detail: '채팅·후원·연출을 잇는 자동화 흐름' },
    { key: 'donations', label: '후원 반응', icon: Radio, detail: '금액과 조건에 따라 실행되는 후원 규칙' },
    { key: 'automations', label: '자동화 연결', icon: Orbit, detail: 'OBS·로컬 프로그램 등 실행 대상 연결' },
  ] as const;

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="border-b"><CardTitle>전체 기능 도입 현황</CardTitle><CardDescription>PostgreSQL의 현재 설정만 집계하며, 예시 수치나 실행 결과 로그를 정의 개수로 섞지 않습니다.</CardDescription></CardHeader>
        <CardContent>
          {rows.map((row) => {
            const feature = features[row.key] || { total: 0, users: 0 };
            return <FeatureAdoptionRow key={row.key} label={row.label} icon={row.icon} users={Number(feature.users || 0)} total={Number(feature.total || 0)} enabled={feature.enabled} registered={registered} detail={row.detail} />;
          })}
        </CardContent>
      </Card>

      <section aria-labelledby="feature-streamer-matrix-heading">
        <SectionHeader title={<span id="feature-streamer-matrix-heading">스트리머별 기능 구성</span>} description="현재 조회 페이지의 계정별 등록 수를 나란히 비교합니다." />
        {snapshot.streamers.length ? (
          <div className="mt-4 overflow-x-auto rounded-[var(--radius-card)] border bg-card shadow-subtle">
            <table className="min-w-[800px] w-full text-left text-sm">
              <caption className="sr-only">스트리머별 명령어, 자동 알림, 룰렛, 실행 액션, 후원 반응, 자동화 연결 개수</caption>
              <thead className="border-b bg-muted/45 text-xs text-muted-foreground"><tr><th scope="col" className="px-4 py-3 font-semibold">스트리머</th>{rows.map((row) => <th key={row.key} scope="col" className="px-3 py-3 text-center font-semibold">{row.label}</th>)}<th scope="col" className="px-4 py-3 text-right font-semibold">상세</th></tr></thead>
              <tbody className="divide-y">{snapshot.streamers.map((streamer) => (
                <tr key={streamer.userId} className="hover:bg-muted/25">
                  <td className="px-4 py-3"><div className="max-w-[18rem] truncate font-semibold">{streamer.displayName || streamer.userId}</div><div className="mt-0.5 max-w-[18rem] truncate text-xs text-muted-foreground">{streamer.userId}</div></td>
                  <td className="px-3 py-3 text-center font-semibold">{streamer.features.commands.total}</td><td className="px-3 py-3 text-center font-semibold">{streamer.features.macros.total}</td><td className="px-3 py-3 text-center font-semibold">{streamer.features.roulettes.total}</td><td className="px-3 py-3 text-center font-semibold">{streamer.features.actions.total}</td><td className="px-3 py-3 text-center font-semibold">{streamer.features.donations.total}</td><td className="px-3 py-3 text-center font-semibold">{streamer.features.automations.total}</td>
                  <td className="px-4 py-3 text-right"><Button type="button" variant="outline" size="sm" onClick={() => onInspect(streamer.userId)}>확인</Button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState className="mt-4" icon={Orbit} title="표시할 기능 구성이 없습니다" description="스트리머가 기능을 등록하면 실제 설정 수가 이곳에 표시됩니다." />}
      </section>
    </div>
  );
}

function ActivityPanel({ events, category, onCategoryChange, onInspect }: { events: AdminEvent[]; category: string; onCategoryChange: (value: string) => void; onInspect: (userId: string) => void }) {
  const filtered = category === 'all' ? events : events.filter((event) => event.category === category);
  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
        <SectionHeader title="최근 처리 활동" description="명령어, 후원, 룰렛 등 실제 봇 이벤트의 최근 기록 30건입니다." />
        <label className="min-w-44 text-xs font-semibold"><span className="mb-2 block">이벤트 종류</span><select value={category} onChange={(event) => onCategoryChange(event.target.value)} className="min-h-[var(--control-height)] w-full rounded-[var(--radius-control)] border bg-card px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/20"><option value="all">전체 이벤트</option><option value="command">명령어</option><option value="donation">후원</option><option value="roulette">룰렛</option><option value="video_donation">영상 후원</option><option value="drawing_donation">그림 후원</option><option value="prediction">예측</option><option value="admin">관리 작업</option></select></label>
      </div>
      {filtered.length ? (
        <div className="overflow-hidden rounded-[var(--radius-card)] border bg-card shadow-subtle">
          {filtered.map((event) => (
            <article key={event.id} className="grid gap-3 border-b p-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(11rem,auto)] md:items-center" style={{ contentVisibility: 'auto', containIntrinsicSize: '0 82px' }}>
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge tone={eventStatusTone(event.status)}>{eventCategoryLabel(event.category)}</Badge>{event.provider ? <Badge tone="neutral">{providerLabel(event.provider)}</Badge> : null}<button type="button" className="truncate text-sm font-semibold hover:text-primary" onClick={() => onInspect(event.ownerUserId)}>{event.streamerName || event.ownerUserId}</button></div><p className="mt-2 break-words text-sm text-foreground">{event.summary || event.triggerName || event.eventType || '처리 이벤트'}</p>{event.viewerName ? <p className="mt-1 text-xs text-muted-foreground">시청자 {event.viewerName}</p> : null}</div>
              <div className="flex items-center justify-between gap-3 md:flex-col md:items-end"><Badge tone={eventStatusTone(event.status)}>{eventStatusLabel(event.status)}</Badge><time dateTime={event.createdAt || undefined} className="text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</time></div>
            </article>
          ))}
        </div>
      ) : <EmptyState icon={Activity} title={category === 'all' ? '아직 처리 활동이 없습니다' : '선택한 종류의 최근 활동이 없습니다'} description="실제 봇 이벤트가 처리되면 스트리머와 플랫폼, 처리 결과가 표시됩니다." />}
    </div>
  );
}

function LoadingConsole() {
  return <section className="flex min-h-[24rem] items-center justify-center rounded-[var(--radius-card)] border bg-card" aria-busy="true" aria-live="polite"><div className="text-center"><RefreshCw className="mx-auto h-6 w-6 animate-spin text-primary" /><div className="mt-4 text-sm font-semibold">관리자 권한과 운영 데이터를 확인하고 있습니다</div><p className="mt-1 text-xs text-muted-foreground">실제 서비스 상태를 불러온 뒤 화면을 표시합니다.</p></div></section>;
}

export function ArubotAdminPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab') as AdminConsoleTab | null;
  const activeTab: AdminConsoleTab = requestedTab && ADMIN_TAB_IDS.has(requestedTab) ? requestedTab : 'overview';
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const accessAbortRef = useRef<AbortController | null>(null);
  const youtubeAbortRef = useRef<AbortController | null>(null);
  const snapshotAbortRef = useRef<AbortController | null>(null);
  const snapshotQueryKeyRef = useRef<string | null>(null);
  const runtimeRefreshRef = useRef(false);
  const oauthNoticeRef = useRef<string | null>(null);

  const [adminStatus, setAdminStatus] = useState<AdminStatus | null>(null);
  const [youtubeBotStatus, setYoutubeBotStatus] = useState<YoutubeBotStatus | null>(null);
  const [snapshot, setSnapshot] = useState<AdminConsoleSnapshot | null>(null);
  const [snapshotQueryKey, setSnapshotQueryKey] = useState<string | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const [filters, setFilters] = useState<AdminConsoleFilters>(EMPTY_FILTERS);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [refreshingUserId, setRefreshingUserId] = useState<string | null>(null);
  const [activityCategory, setActivityCategory] = useState('all');

  const changeTab = useCallback((tab: AdminConsoleTab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'overview') params.delete('tab'); else params.set('tab', tab);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const loadAccess = useCallback(async (showLoading = false) => {
    accessAbortRef.current?.abort();
    const { controller, clear } = createTimedController();
    accessAbortRef.current = controller;
    if (showLoading) setAccessLoading(true);
    try {
      const adminResult = await readJsonResult<AdminStatus>('/api/arubot-admin/me', { signal: controller.signal });
      if (accessAbortRef.current !== controller) return;
      if (adminResult.ok) {
        setAdminStatus(adminResult.data);
        setAccessError(null);
      } else {
        if (adminResult.status === 401 || adminResult.status === 403) {
          setAdminStatus(null);
          setSnapshot(null);
          setSnapshotQueryKey(null);
          snapshotQueryKeyRef.current = null;
        }
        setAccessError(adminResult.status === 401 ? '로그인이 필요합니다.' : adminResult.status === 403 ? 'AruBot 관리자 권한이 필요합니다.' : '관리자 권한을 확인하지 못했습니다. 서버 연결을 확인해 주세요.');
      }
    } catch (error) {
      if (accessAbortRef.current !== controller) return;
      setAccessError(error instanceof DOMException && error.name === 'AbortError'
        ? '관리자 권한 확인 시간이 초과되었습니다. 서버 상태를 확인해 주세요.'
        : '관리자 권한을 확인하지 못했습니다.');
    } finally {
      clear();
      if (accessAbortRef.current === controller) {
        accessAbortRef.current = null;
        setAccessLoading(false);
      }
    }
  }, []);

  const loadYoutubeStatus = useCallback(async () => {
    youtubeAbortRef.current?.abort();
    const { controller, clear } = createTimedController();
    youtubeAbortRef.current = controller;
    try {
      const result = await readJsonResult<YoutubeBotStatus>('/api/youtube/bot/status', { signal: controller.signal });
      if (youtubeAbortRef.current !== controller) return;
      if (result.ok) {
        setYoutubeBotStatus(result.data);
        setYoutubeError(null);
      } else {
        setYoutubeError('YouTube 중앙 봇 상태를 불러오지 못했습니다. 표시된 정보는 이전 확인값일 수 있습니다.');
      }
    } catch (error) {
      if (youtubeAbortRef.current !== controller) return;
      setYoutubeError(error instanceof DOMException && error.name === 'AbortError'
        ? 'YouTube 중앙 봇 상태 확인 시간이 초과되었습니다. 표시된 정보는 이전 확인값일 수 있습니다.'
        : 'YouTube 중앙 봇 상태를 불러오지 못했습니다.');
    } finally {
      clear();
      if (youtubeAbortRef.current === controller) youtubeAbortRef.current = null;
    }
  }, []);

  const loadSnapshot = useCallback(async (requestedFilters: AdminConsoleFilters, requestedCursor: string | null, silent = false) => {
    snapshotAbortRef.current?.abort();
    const { controller, clear } = createTimedController();
    const requestKey = getSnapshotQueryKey(requestedFilters, requestedCursor);
    snapshotAbortRef.current = controller;
    if (!silent) setSnapshotLoading(true);
    if (snapshotQueryKeyRef.current !== requestKey) {
      setSnapshotError(null);
      setRefreshWarning(null);
    }
    try {
      const result = await readJsonResult<AdminConsoleSnapshot>(getSnapshotUrl(requestedFilters, requestedCursor), { signal: controller.signal });
      if (snapshotAbortRef.current !== controller) return;
      if (!result.ok) {
        const message = result.status === 403 ? '관리자 권한이 필요합니다.' : '운영 데이터를 최신 상태로 불러오지 못했습니다.';
        if (result.status === 401 || result.status === 403) {
          setAdminStatus(null);
          setSnapshot(null);
          setSnapshotQueryKey(null);
          snapshotQueryKeyRef.current = null;
          setAccessError(result.status === 401 ? '로그인이 필요합니다.' : 'AruBot 관리자 권한이 필요합니다.');
        } else if (snapshotQueryKeyRef.current === requestKey) {
          setRefreshWarning(`${message} 마지막으로 확인한 동일 조건의 데이터를 유지합니다.`);
        } else {
          setSnapshotError(message);
        }
        return;
      }
      snapshotQueryKeyRef.current = requestKey;
      setSnapshotQueryKey(requestKey);
      setSnapshot(result.data);
      setSnapshotError(null);
      setRefreshWarning(null);
    } catch (error) {
      if (snapshotAbortRef.current !== controller) return;
      const message = error instanceof DOMException && error.name === 'AbortError'
        ? '운영 데이터 확인 시간이 초과되었습니다.'
        : '운영 데이터를 불러오지 못했습니다.';
      if (snapshotQueryKeyRef.current === requestKey) setRefreshWarning(`${message} 마지막으로 확인한 동일 조건의 데이터를 유지합니다.`);
      else setSnapshotError(message);
    } finally {
      clear();
      if (snapshotAbortRef.current === controller) {
        snapshotAbortRef.current = null;
        setSnapshotLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadAccess(true);
    return () => {
      accessAbortRef.current?.abort();
      youtubeAbortRef.current?.abort();
      snapshotAbortRef.current?.abort();
    };
  }, [loadAccess]);

  useEffect(() => {
    if (adminStatus?.isAdmin === true) loadYoutubeStatus();
  }, [adminStatus?.isAdmin, loadYoutubeStatus]);

  useEffect(() => {
    if (adminStatus?.isAdmin !== true) return;
    const verifyAccess = () => {
      if (document.visibilityState === 'visible') loadAccess(false);
    };
    const timer = window.setInterval(verifyAccess, 60_000);
    window.addEventListener('focus', verifyAccess);
    document.addEventListener('visibilitychange', verifyAccess);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', verifyAccess);
      document.removeEventListener('visibilitychange', verifyAccess);
    };
  }, [adminStatus?.isAdmin, loadAccess]);

  useEffect(() => {
    const auth = searchParams.get('auth');
    const reason = searchParams.get('reason');
    const noticeKey = `${auth || ''}:${reason || ''}`;
    const recognized = (auth === 'error' && reason === 'admin_required')
      || reason === 'central_bot_select_channel'
      || reason === 'central_bot_configured';
    if (!recognized || oauthNoticeRef.current === noticeKey) return;
    oauthNoticeRef.current = noticeKey;
    if (auth === 'error' && reason === 'admin_required') toast.error('AruBot 관리자 권한이 필요합니다.');
    if (reason === 'central_bot_select_channel') toast.info('YouTube 봇으로 사용할 채널을 선택해 주세요.');
    if (reason === 'central_bot_configured') toast.success('YouTube 중앙 봇 채널을 설정했습니다.');
    const params = new URLSearchParams(searchParams.toString());
    params.delete('auth');
    params.delete('reason');
    params.delete('platform');
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (adminStatus?.isAdmin !== true) return;
    const timer = window.setTimeout(() => loadSnapshot(filters, cursor), filters.q ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [adminStatus?.isAdmin, cursor, filters, loadSnapshot]);

  const updateFilters = useCallback((next: AdminConsoleFilters) => {
    setFilters(next);
    setCursor(null);
    setCursorHistory([]);
    setSelectedUserId(null);
    setSnapshotError(null);
    setRefreshWarning(null);
    setSnapshotLoading(true);
  }, []);

  const refreshAll = useCallback(async () => {
    if (refreshingAll) return;
    setRefreshingAll(true);
    try {
      await Promise.all([loadAccess(false), loadYoutubeStatus(), loadSnapshot(filters, cursor, true)]);
    } finally {
      setRefreshingAll(false);
    }
  }, [cursor, filters, loadAccess, loadSnapshot, loadYoutubeStatus, refreshingAll]);

  const copyText = useCallback(async (value: string) => {
    try { await navigator.clipboard.writeText(value); toast.success('복사했습니다.'); }
    catch { toast.error('복사하지 못했습니다.'); }
  }, []);

  const inspectStreamer = useCallback((userId: string) => {
    setSelectedUserId(userId);
    changeTab('streamers');
  }, [changeTab]);

  const inspectEventOwner = useCallback((userId: string) => {
    updateFilters({ ...EMPTY_FILTERS, q: userId });
    setSelectedUserId(userId);
    changeTab('streamers');
  }, [changeTab, updateFilters]);

  const refreshStreamerRuntime = useCallback(async (streamer: AdminStreamer) => {
    if (runtimeRefreshRef.current) return;
    runtimeRefreshRef.current = true;
    setRefreshingUserId(streamer.userId);
    try {
      const response = await fetch(apiUrl('/api/arubot-admin/streamers/runtime-refresh'), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: streamer.userId }) });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; state?: string } | null;
      if (!response.ok || data?.ok !== true) throw new Error(data?.state || data?.error || 'runtime_refresh_failed');
      toast.success(`${streamer.displayName || streamer.userId}님의 봇 설정을 현재 런타임에 반영했습니다.`);
      await loadSnapshot(filters, cursor, true);
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      if (reason === 'managed_elsewhere') toast.error('이 봇은 다른 서버에서 실행 중이므로 해당 런타임에서 설정 동기화가 필요합니다.');
      else if (reason === 'no_local_session' || reason === 'session_lost' || reason === 'runtime_unavailable') toast.error('현재 연결된 방송 봇 런타임이 없어 즉시 반영할 수 없습니다.');
      else toast.error('봇 설정을 즉시 반영하지 못했습니다.');
    } finally {
      runtimeRefreshRef.current = false;
      setRefreshingUserId(null);
    }
  }, [cursor, filters, loadSnapshot]);

  const exportCurrentCsv = useCallback(() => {
    const activeSnapshot = snapshotQueryKey === getSnapshotQueryKey(filters, cursor) ? snapshot : null;
    if (!activeSnapshot?.streamers.length) return;
    const rows = activeSnapshot.streamers.map((streamer) => [
      streamer.userId,
      streamer.displayName || '',
      streamer.platforms.map((platform) => providerLabel(platform.provider)).join(', '),
      streamer.live.live ? 'LIVE' : 'OFFLINE',
      runtimeStatusLabel(streamer.runtime.status),
      streamer.features.commands.total,
      streamer.features.macros.total,
      streamer.features.roulettes.total,
      streamer.features.actions.total,
      streamer.activity.lastEventAt || '',
    ]);
    const csv = '\uFEFF' + [['사용자 ID', '표시 이름', '연결 플랫폼', '라이브', '봇 상태', '명령어', '자동 알림', '룰렛', '실행 액션', '최근 이벤트'], ...rows].map((row) => row.map(quoteCsvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `arubot-streamers-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [cursor, filters, snapshot, snapshotQueryKey]);

  const currentQueryKey = getSnapshotQueryKey(filters, cursor);
  const activeSnapshot = snapshotQueryKey === currentQueryKey ? snapshot : null;

  const goNext = useCallback(() => {
    if (!activeSnapshot?.nextCursor) return;
    setCursorHistory((history) => [...history, cursor]);
    setCursor(activeSnapshot.nextCursor || null);
    setSelectedUserId(null);
    setSnapshotLoading(true);
    setSnapshotError(null);
  }, [activeSnapshot?.nextCursor, cursor]);

  const goPrevious = useCallback(() => {
    setCursorHistory((history) => {
      if (!history.length) return history;
      const next = [...history];
      setCursor(next.pop() ?? null);
      return next;
    });
    setSelectedUserId(null);
    setSnapshotLoading(true);
    setSnapshotError(null);
  }, []);

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % ADMIN_TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + ADMIN_TABS.length) % ADMIN_TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = ADMIN_TABS.length - 1;
    else return;
    event.preventDefault();
    changeTab(ADMIN_TABS[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  };

  const totalPages = activeSnapshot ? Math.max(1, Math.ceil(activeSnapshot.total / PAGE_SIZE)) : 1;
  const pageIndex = cursorHistory.length + 1;
  const tabDescription = ADMIN_TABS.find((tab) => tab.id === activeTab)?.description || '';

  if (accessLoading && !adminStatus) return <LoadingConsole />;
  if (accessError && !adminStatus) return <ErrorState title="관리자 페이지를 열 수 없습니다" description={accessError} onRetry={() => loadAccess(true)} />;
  if (adminStatus?.isAdmin !== true) {
    return <section className="rounded-[var(--radius-card)] border bg-card p-[clamp(1.5rem,4vw,2.5rem)] shadow-soft"><Badge tone="amber">접근 제한</Badge><h1 className="mt-4 text-2xl font-bold tracking-tight md:text-3xl">AruBot 관리자 권한이 필요합니다</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">서비스 전체의 스트리머와 운영 정보는 PostgreSQL의 <code>app_users.is_admin = true</code> 권한을 가진 계정만 볼 수 있습니다.</p></section>;
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="AruBot 서비스 관리"
        description="등록 스트리머, 연결 방송, 라이브와 봇 상태, 기능 사용량, 최근 처리 이벤트와 시스템 건전성을 한곳에서 관리합니다."
        actions={<><div className="hidden text-right text-xs text-muted-foreground sm:block"><div>최근 갱신</div><div className="mt-0.5 font-semibold text-foreground">{formatDateTime(activeSnapshot?.generatedAt)}</div></div><Button type="button" variant="outline" onClick={refreshAll} disabled={snapshotLoading || refreshingAll}><RefreshCw className={cn('h-4 w-4', (snapshotLoading || refreshingAll) && 'animate-spin')} />새로고침</Button></>}
      />

      <nav className="-mx-1 overflow-x-auto px-1 scrollbar-none" aria-label="AruBot 관리자 하위 메뉴">
        <div role="tablist" aria-label="관리자 페이지 섹션" className="flex min-w-max gap-1 border-b">
          {ADMIN_TABS.map((tab, index) => {
            const active = tab.id === activeTab;
            const Icon = tab.icon;
            return <button key={tab.id} ref={(node) => { tabRefs.current[index] = node; }} type="button" role="tab" id={`admin-tab-${tab.id}`} aria-selected={active} aria-controls={`admin-panel-${tab.id}`} tabIndex={active ? 0 : -1} onKeyDown={(event) => handleTabKeyDown(event, index)} onClick={() => changeTab(tab.id)} className={cn('relative flex min-h-12 shrink-0 items-center gap-2 px-3.5 text-sm font-semibold text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', active && 'text-foreground after:absolute after:inset-x-2 after:bottom-[-1px] after:h-0.5 after:bg-primary')}><Icon className="h-4 w-4" aria-hidden="true" />{tab.label}</button>;
          })}
        </div>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{tabDescription}</span><span aria-live="polite">{snapshotLoading ? '최신 데이터 확인 중' : activeSnapshot ? `${numberFormatter.format(activeSnapshot.total)}개 계정 조회됨` : '데이터 대기 중'}</span></div>
      {accessError && adminStatus ? <div role="status" className="flex items-start gap-2 rounded-[var(--radius-control)] border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{accessError} 마지막으로 확인된 관리자 화면을 표시하고 있습니다.</div> : null}
      {refreshWarning ? <div role="status" className="flex items-start gap-2 rounded-[var(--radius-control)] border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{refreshWarning}</div> : null}

      {snapshotError && !activeSnapshot ? <ErrorState title="운영 데이터를 불러오지 못했습니다" description={snapshotError} onRetry={() => loadSnapshot(filters, cursor)} /> : null}
      {!activeSnapshot && !snapshotError ? <LoadingConsole /> : null}

      {activeSnapshot ? (
        <section role="tabpanel" id={`admin-panel-${activeTab}`} aria-labelledby={`admin-tab-${activeTab}`} tabIndex={0} className="min-w-0 outline-none">
          {activeTab === 'overview' ? <OverviewPanel snapshot={activeSnapshot} onOpenTab={changeTab} onInspect={inspectStreamer} /> : null}
          {activeTab === 'streamers' ? <StreamerDirectory filters={filters} onFiltersChange={updateFilters} streamers={activeSnapshot.streamers} total={activeSnapshot.total} selectedUserId={selectedUserId} onSelect={setSelectedUserId} onResetFilters={() => updateFilters(EMPTY_FILTERS)} onExport={exportCurrentCsv} onCopy={copyText} onRefreshRuntime={refreshStreamerRuntime} refreshingUserId={refreshingUserId} loading={snapshotLoading} pageIndex={pageIndex} totalPages={totalPages} hasPrevious={cursorHistory.length > 0} hasNext={!!activeSnapshot.nextCursor} onPrevious={goPrevious} onNext={goNext} /> : null}
          {activeTab === 'features' ? <FeaturePanel snapshot={activeSnapshot} onInspect={inspectStreamer} /> : null}
          {activeTab === 'activity' ? <ActivityPanel events={activeSnapshot.recentEvents} category={activityCategory} onCategoryChange={setActivityCategory} onInspect={inspectEventOwner} /> : null}
          {activeTab === 'system' ? <ArubotAdminSystemPanel adminStatus={adminStatus} youtubeBotStatus={youtubeBotStatus} youtubeError={youtubeError} system={activeSnapshot.system} endpoints={YOUTUBE_BOT_ENDPOINTS} authorizationHeading={YOUTUBE_AUTHORIZATION_HEADING} onChanged={refreshAll} onCopy={copyText} /> : null}
        </section>
      ) : null}
    </div>
  );
}
