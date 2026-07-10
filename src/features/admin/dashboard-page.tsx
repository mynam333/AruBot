'use client';

import {
  Activity,
  Cable,
  ChevronRight,
  Clapperboard,
  Coins,
  HeartHandshake,
  MessageSquare,
  Radio,
  RefreshCw,
  Settings,
  Sparkles,
  Timer,
  Wand2,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, PageHeader, SectionHeader, StatusDot } from '@/components/ui/page';
import { CommandCreateDialog, RouletteCreateDialog } from '@/features/admin/admin-action-dialogs';
import { apiUrl, readJsonResult } from '@/shared/api/http';

type PlatformAccount = {
  provider?: string;
  channel_id?: string;
  channel_name?: string;
  channel_handle?: string;
  avatar_url?: string;
  profile_image_url?: string;
  metadata?: {
    publicProfile?: {
      status?: 'ok' | 'failed' | 'skipped';
      followerCount?: number | null;
      subscriberCount?: number | null;
      isLive?: boolean;
    };
  };
};

type YoutubeStreamerStatus = {
  configured?: boolean;
  channel?: {
    youtubeChannelId?: string | null;
    youtubeHandle?: string | null;
    title?: string | null;
    thumbnailUrl?: string | null;
  } | null;
};

type DashboardData = {
  platforms: PlatformAccount[];
  youtubeStreamerStatus: YoutubeStreamerStatus | null;
  settings: Record<string, unknown> | null;
  stats: Record<string, unknown> | null;
  queue: unknown;
};

type DashboardDetailKey = 'settings' | 'stats' | 'queue';

type SetupTemplateResult = {
  applied?: Array<{ type?: string; name?: string }>;
  skipped?: Array<{ type?: string; name?: string }>;
  counts?: { applied?: number; skipped?: number };
};

const providers = [
  { id: 'chzzk', label: 'CHZZK', loginPath: '/api/auth/chzzk/login', iconPath: '/brands/chzzk.svg' },
  { id: 'cime', label: 'CIME', loginPath: '/api/auth/cime/login', iconPath: '/brands/cime.svg' },
  { id: 'youtube', label: 'YouTube', iconPath: '/brands/youtube.svg' },
] as const;

const featureLinks = [
  { href: '/commands', title: '채팅 명령어', description: '반복 안내와 참여 명령을 관리합니다.', icon: MessageSquare },
  { href: '/points', title: '시청자 포인트', description: '적립 정책과 시청자 잔액을 관리합니다.', icon: Coins },
  { href: '/roulette', title: '룰렛', description: '참여 항목과 방송 오버레이를 설정합니다.', icon: Sparkles },
  { href: '/video-donations/queue', title: '영상 후원', description: '재생 대기열과 현재 후원을 제어합니다.', icon: Clapperboard },
  { href: '/donations/rules', title: '후원 반응', description: '금액과 조건별 반응 규칙을 구성합니다.', icon: HeartHandshake },
  { href: '/macros', title: '자동 알림', description: '주기적인 채팅 공지를 예약합니다.', icon: Timer },
] as const;

const compactNumber = new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 });

function pickRows(data: unknown) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  const object = data as Record<string, unknown>;
  return (['items', 'queue', 'rows', 'data'].map((key) => object[key]).find(Array.isArray) as unknown[] | undefined) || [];
}

function providerLabel(provider?: string) {
  if (provider?.toLowerCase() === 'chzzk') return 'CHZZK';
  if (provider?.toLowerCase() === 'cime') return 'CIME';
  if (provider?.toLowerCase() === 'youtube') return 'YouTube';
  return provider || '채널';
}

function countLabel(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? compactNumber.format(value) : null;
}

function ChannelAvatar({ account }: { account: PlatformAccount }) {
  const imageUrl = account.profile_image_url || account.avatar_url;
  if (imageUrl) {
    return <img src={imageUrl} alt="" referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded-lg border object-cover" />;
  }
  return <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border bg-muted text-[0.6875rem] font-bold text-primary">{providerLabel(account.provider).slice(0, 2)}</span>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || '요청을 처리하지 못했습니다.');
  return data as T;
}

function QuickStartPanel() {
  const [result, setResult] = useState<SetupTemplateResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const applyTemplate = () => {
    startTransition(async () => {
      try {
        const payload = await postJson<SetupTemplateResult>('/api/setup/templates/apply', { template: 'quick-start' });
        setResult(payload);
        ['/api/bot/rules', '/api/roulette/definitions', '/api/macros', '/api/bot/settings'].forEach((endpoint) => {
          window.dispatchEvent(new CustomEvent('arubot:resource-refresh', { detail: { endpoint } }));
        });
        const applied = Number(payload.counts?.applied || payload.applied?.length || 0);
        const skipped = Number(payload.counts?.skipped || payload.skipped?.length || 0);
        toast.success(applied ? `기본 설정 ${applied}개를 추가했습니다.` : '필요한 기본 설정이 이미 준비되어 있습니다.', {
          description: skipped ? `${skipped}개 기존 설정은 유지했습니다.` : undefined,
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '기본 설정을 적용하지 못했습니다.');
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2"><Wand2 className="h-4 w-4 text-primary" /><CardTitle>초기 설정 도구</CardTitle></div>
        <CardDescription>포인트 확인, 기본 명령어, 룰렛과 참여 안내를 추가하며 기존 설정은 변경하지 않습니다.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-sm text-muted-foreground">
          {result ? (
            <span><strong className="text-foreground">{Number(result.counts?.applied || 0)}개 추가</strong> · {Number(result.counts?.skipped || 0)}개 유지</span>
          ) : '새 채널의 필수 참여 기능을 안전하게 구성합니다.'}
        </div>
        <Button type="button" size="sm" onClick={applyTemplate} disabled={isPending}>
          <Wand2 className={isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />{isPending ? '적용 중' : '기본 설정 적용'}
        </Button>
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingDetails, setPendingDetails] = useState<Set<DashboardDetailKey>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  const loadDashboard = useCallback(async (signal?: AbortSignal) => {
    setRefreshing(true);
    if (!hasLoadedRef.current) setLoading(true);
    setPendingDetails(new Set());
    setError(null);
    try {
      const [platformsResult, youtubeResult] = await Promise.all([
        readJsonResult<{ platforms?: PlatformAccount[] }>('/api/account/platforms', { signal }),
        readJsonResult<YoutubeStreamerStatus>('/api/youtube/streamer-channel', { signal }),
      ]);
      if (signal?.aborted) return;
      if (!platformsResult.ok && !youtubeResult.ok) {
        setError('message' in platformsResult ? platformsResult.message : 'message' in youtubeResult ? youtubeResult.message : '운영 정보를 불러오지 못했습니다.');
        return;
      }

      const platforms = platformsResult.ok && Array.isArray(platformsResult.data.platforms) ? platformsResult.data.platforms : [];
      const youtube = youtubeResult.ok ? youtubeResult.data : null;
      const hasConnectedChannel = platforms.length > 0 || youtube?.configured === true;
      setDashboardData((current) => ({
        platforms,
        youtubeStreamerStatus: youtube,
        settings: hasConnectedChannel ? current?.settings ?? null : null,
        stats: hasConnectedChannel ? current?.stats ?? null : null,
        queue: hasConnectedChannel ? current?.queue ?? [] : [],
      }));
      setLoading(false);
      hasLoadedRef.current = true;

      if (!hasConnectedChannel) return;

      const detailRequests: Array<{
        key: DashboardDetailKey;
        request: Promise<ReturnType<typeof readJsonResult<unknown>> extends Promise<infer T> ? T : never>;
        fallback: unknown;
      }> = [
        { key: 'settings', request: readJsonResult<Record<string, unknown>>('/api/bot/settings', { signal }), fallback: null },
        { key: 'stats', request: readJsonResult<Record<string, unknown>>('/api/bot/stats', { signal }), fallback: null },
        { key: 'queue', request: readJsonResult<unknown>('/api/video-donation/queue', { signal }), fallback: [] },
      ];
      setPendingDetails(new Set(detailRequests.map(({ key }) => key)));
      await Promise.all(detailRequests.map(async ({ key, request, fallback }) => {
        try {
          const result = await request;
          if (signal?.aborted) return;
          setDashboardData((current) => current ? { ...current, [key]: result.ok ? result.data : fallback } : current);
        } finally {
          if (!signal?.aborted) {
            setPendingDetails((current) => {
              const next = new Set(current);
              next.delete(key);
              return next;
            });
          }
        }
      }));
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
      setError(loadError instanceof Error ? loadError.message : '운영 정보를 불러오지 못했습니다.');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadDashboard(controller.signal);
    return () => controller.abort();
  }, [loadDashboard]);

  const accounts = useMemo(() => dashboardData?.platforms || [], [dashboardData]);
  const youtubeStatus = dashboardData?.youtubeStreamerStatus || null;
  const youtubeConfigured = youtubeStatus?.configured === true;
  const youtubeAccount = useMemo<PlatformAccount | null>(() => {
    if (!youtubeConfigured || accounts.some((account) => account.provider?.toLowerCase() === 'youtube')) return null;
    const channel = youtubeStatus?.channel || {};
    return {
      provider: 'youtube',
      channel_id: channel.youtubeChannelId || undefined,
      channel_name: channel.title || channel.youtubeHandle || channel.youtubeChannelId || 'YouTube 채널',
      channel_handle: channel.youtubeHandle || undefined,
      avatar_url: channel.thumbnailUrl || undefined,
    };
  }, [accounts, youtubeConfigured, youtubeStatus]);
  const visibleAccounts = useMemo(() => youtubeAccount ? [...accounts, youtubeAccount] : accounts, [accounts, youtubeAccount]);
  const queueCount = pickRows(dashboardData?.queue).length;
  const settingsLoading = pendingDetails.has('settings');
  const statsLoading = pendingDetails.has('stats');
  const queueLoading = pendingDetails.has('queue');
  const botEnabled = dashboardData?.settings && 'botEnabled' in dashboardData.settings ? dashboardData.settings.botEnabled !== false : null;
  const commandCount = typeof dashboardData?.stats?.commands === 'number' ? dashboardData.stats.commands : null;
  const connectedProviders = new Set(accounts.map((account) => account.provider?.toLowerCase()).filter(Boolean));
  if (youtubeConfigured) connectedProviders.add('youtube');
  const youtubeLoginHref = apiUrl(`/api/auth/youtube/login?returnTo=${encodeURIComponent('/connection?platform=youtube')}`);

  const metrics = [
    { label: '연결 채널', value: loading ? '—' : `${visibleAccounts.length}개`, detail: visibleAccounts.length ? '연결 정상' : '연결 필요', icon: Cable, status: visibleAccounts.length ? 'success' : 'warning' },
    { label: '봇 상태', value: loading || settingsLoading ? '—' : botEnabled == null ? '확인 불가' : botEnabled ? '사용 중' : '중지', detail: settingsLoading ? '설정 확인 중' : botEnabled ? '응답 가능' : botEnabled === false ? '설정에서 켜기' : '채널 연결 후 확인', icon: Radio, status: botEnabled ? 'success' : botEnabled === false ? 'danger' : 'neutral' },
    { label: '영상 대기열', value: loading || queueLoading ? '—' : `${queueCount}개`, detail: queueLoading ? '대기열 확인 중' : queueCount ? '재생 대기 중' : '대기 없음', icon: Clapperboard, status: queueCount ? 'info' : 'neutral' },
    { label: '명령 응답', value: loading || statsLoading ? '—' : commandCount == null ? '확인 불가' : `${commandCount}회`, detail: statsLoading ? '통계 확인 중' : commandCount ? '누적 처리' : '기록 없음', icon: Activity, status: commandCount ? 'success' : 'neutral' },
  ] as const;

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="방송 운영 현황"
        description="연결 상태와 진행 중인 참여 기능을 확인하고, 필요한 작업으로 바로 이동합니다."
        actions={<Button type="button" variant="outline" size="sm" onClick={() => void loadDashboard()} disabled={refreshing}><RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />새로고침</Button>}
      />

      {error ? <ErrorState description={error} onRetry={() => void loadDashboard()} /> : null}

      <section aria-label="운영 지표" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card key={metric.label}>
              <CardContent className="flex items-start gap-3 p-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Icon className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-muted-foreground">{metric.label}</div>
                  <div className="mt-1 text-xl font-bold tracking-tight">{metric.value}</div>
                  <div className="mt-2"><StatusDot status={metric.status} label={metric.detail} /></div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div><CardTitle>연결된 채널</CardTitle><CardDescription>현재 AruBot이 운영하는 방송 채널입니다.</CardDescription></div>
              <Badge tone={visibleAccounts.length ? 'mint' : 'amber'}>{visibleAccounts.length ? `${visibleAccounts.length}개 연결` : '연결 필요'}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {visibleAccounts.length ? (
              <div className="divide-y rounded-lg border">
                {visibleAccounts.map((account) => (
                  <div key={`${account.provider}-${account.channel_id || account.channel_name}`} className="flex min-w-0 items-center gap-3 p-3.5">
                    <ChannelAvatar account={account} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{account.channel_name || account.channel_id || '연결된 채널'}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{account.channel_handle || providerLabel(account.provider)}</span>
                        {account.metadata?.publicProfile?.followerCount != null ? <span>팔로워 {countLabel(account.metadata.publicProfile.followerCount)}</span> : null}
                        {account.metadata?.publicProfile?.subscriberCount != null ? <span>구독자 {countLabel(account.metadata.publicProfile.subscriberCount)}</span> : null}
                      </div>
                    </div>
                    {account.metadata?.publicProfile?.isLive ? <Badge tone="rose">LIVE</Badge> : <StatusDot status={account.metadata?.publicProfile?.status === 'failed' ? 'warning' : 'success'} label={account.metadata?.publicProfile?.status === 'failed' ? '정보 확인 필요' : '연결됨'} />}
                  </div>
                ))}
              </div>
            ) : loading ? (
              <div className="loading-skeleton h-48 rounded-lg" />
            ) : (
              <EmptyState title="연결된 방송 채널이 없습니다" description="플랫폼을 연결하면 명령어, 포인트, 룰렛과 후원 기능이 활성화됩니다." action={<LinkButton href="/connection" size="sm"><Cable className="h-4 w-4" />플랫폼 연결</LinkButton>} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>빠른 작업</CardTitle><CardDescription>방송 중 자주 사용하는 관리 작업입니다.</CardDescription></CardHeader>
          <CardContent className="grid gap-2">
            <CommandCreateDialog variant="outline" label="명령어 만들기" trailingChevron className="w-full justify-between" />
            <RouletteCreateDialog variant="outline" label="룰렛 만들기" trailingChevron className="w-full justify-between" />
            <LinkButton href="/video-donations/queue" variant="outline" className="w-full justify-between"><span className="inline-flex items-center gap-2"><Clapperboard className="h-4 w-4 text-primary" />영상 후원 대기열</span><ChevronRight className="h-4 w-4 text-muted-foreground" /></LinkButton>
            <LinkButton href="/settings" variant="outline" className="w-full justify-between"><span className="inline-flex items-center gap-2"><Settings className="h-4 w-4 text-primary" />방송 설정</span><ChevronRight className="h-4 w-4 text-muted-foreground" /></LinkButton>
          </CardContent>
        </Card>
      </section>

      {!visibleAccounts.length && !loading ? (
        <Card>
          <CardHeader><CardTitle>플랫폼 연결</CardTitle><CardDescription>실제로 사용할 방송 계정으로 로그인하세요.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {providers.map((provider) => {
              const connected = connectedProviders.has(provider.id);
              const href = provider.id === 'youtube' ? youtubeLoginHref : apiUrl(provider.loginPath);
              return (
                <Button key={provider.id} asChild variant={connected ? 'secondary' : 'default'}>
                  <a href={href}><img src={provider.iconPath} alt="" aria-hidden="true" className={provider.id === 'youtube' ? 'h-5 w-auto shrink-0 object-contain' : 'h-5 w-5 rounded-sm object-contain'} />{provider.label}{connected ? ' 다시 연결' : '로 로그인'}</a>
                </Button>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      <section>
        <SectionHeader title="기능 관리" description="방송 참여와 연출 기능을 설정합니다." className="mb-3" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {featureLinks.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} prefetch={false} className="group flex min-w-0 items-center gap-3 rounded-[var(--radius-card)] border bg-card p-4 shadow-subtle transition-colors hover:border-primary/35 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{item.title}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{item.description}</span></span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            );
          })}
        </div>
      </section>

      {visibleAccounts.length ? <QuickStartPanel /> : null}
    </>
  );
}
