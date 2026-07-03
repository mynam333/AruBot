'use client';

import {
  Cable,
  ChevronRight,
  Coins,
  HeartHandshake,
  MessageSquare,
  PlaySquare,
  Radio,
  Settings,
  Sparkles,
  Timer,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip } from '@/components/ui/tooltip';
import { CommandCreateDialog, RouletteCreateDialog } from '@/features/admin/admin-action-dialogs';
import { apiUrl, readJson } from '@/shared/api/http';
import { cn } from '@/shared/lib/utils';

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

type DashboardData = {
  platforms?: PlatformAccount[];
  settings?: Record<string, unknown> | null;
  stats?: Record<string, unknown> | null;
  queue?: unknown;
};

const providers = [
  {
    id: 'chzzk',
    label: 'CHZZK',
    loginPath: '/api/auth/chzzk/login',
    iconPath: '/brands/chzzk.svg',
    tone: 'mint',
  },
  {
    id: 'cime',
    label: 'CIME',
    loginPath: '/api/auth/cime/login',
    iconPath: '/brands/cime.svg',
    tone: 'sky',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    loginPath: '/api/auth/youtube/login',
    iconPath: '/brands/youtube.svg',
    tone: 'rose',
  },
] as const;

const featureCards = [
  {
    href: '/commands',
    title: '채팅 명령어',
    body: '반복 안내와 자주 묻는 질문을 자동으로 응답해 방송 흐름을 지켜줍니다.',
    action: '명령어 관리',
    icon: MessageSquare,
    tone: 'sky',
  },
  {
    href: '/points',
    title: '시청자 포인트',
    body: '출석, 채팅, 이벤트 참여를 포인트로 이어 시청자의 재방문 이유를 만듭니다.',
    action: '포인트 설정',
    icon: Coins,
    tone: 'mint',
  },
  {
    href: '/video-donations/queue',
    title: '영상 후원',
    body: '신청된 영상이 순서대로 이어져 방송 화면에 깔끔하게 재생됩니다.',
    action: '후원 큐 열기',
    icon: PlaySquare,
    tone: 'coral',
  },
  {
    href: '/roulette',
    title: '룰렛',
    body: '시청자 참여와 후원이 긴장감 있는 당첨 순간으로 바뀝니다.',
    action: '룰렛 관리',
    icon: Sparkles,
    tone: 'lemon',
  },
  {
    href: '/donations/rules',
    title: '후원 반응',
    body: '후원 순간에 맞춘 채팅과 화면 반응으로 감사 표현이 더 또렷해집니다.',
    action: '반응 설정',
    icon: HeartHandshake,
    tone: 'coral',
  },
  {
    href: '/macros',
    title: '자동 알림',
    body: '공지와 안내 메시지를 방송 분위기에 맞춰 자연스럽게 반복합니다.',
    action: '알림 관리',
    icon: Timer,
    tone: 'sky',
  },
] as const;

const quickActions = [
  { href: '/connection', label: '플랫폼 연결', icon: Cable, help: 'CHZZK, CIME, YouTube 시청자가 같은 방송 경험으로 들어오게 합니다.' },
  { href: 'dialog:command', label: '명령어 만들기', icon: MessageSquare, help: '채팅에서 바로 반응하는 참여 문구를 추가합니다.' },
  { href: '/video-donations/queue', label: '포인트 영상후원', icon: PlaySquare, help: '신청 영상이 방송 화면에 자연스럽게 이어지게 합니다.' },
  { href: 'dialog:roulette', label: '룰렛 만들기', icon: Sparkles, help: '포인트와 후원이 당첨의 재미로 바뀌게 합니다.' },
  { href: '/settings', label: '방송 스타일', icon: Settings, help: 'AruBot의 말투와 공개 화면을 내 방송 분위기에 맞춥니다.' },
] as const;

function pickRows(data: unknown) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  const object = data as Record<string, unknown>;
  return (
    (['items', 'queue', 'rows', 'data']
      .map((key) => object[key])
      .find(Array.isArray) as unknown[] | undefined) || []
  );
}

function providerLabel(provider?: string) {
  const value = provider?.toLowerCase();
  if (value === 'chzzk') return 'CHZZK';
  if (value === 'cime') return 'CIME';
  if (value === 'youtube') return 'YouTube';
  return provider || '채널';
}

function compactCount(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function ChannelAvatar({ account }: { account: PlatformAccount }) {
  const imageUrl = account.profile_image_url || account.avatar_url;
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        referrerPolicy="no-referrer"
        className="aspect-square w-[var(--icon-box)] rounded-[var(--radius-control)] border object-cover"
      />
    );
  }
  return <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-muted text-xs font-semibold text-primary">{providerLabel(account.provider).slice(0, 2)}</span>;
}

export function DashboardPage() {
  const [dashboardData, setDashboardData] = useState<DashboardData>({});

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    async function loadDashboard() {
      const platforms = await readJson<{ platforms?: PlatformAccount[] }>('/api/account/platforms', { signal: controller.signal });
      if (!alive) return;
      const platformRows = Array.isArray(platforms?.platforms) ? platforms.platforms : [];
      if (!platformRows.length) {
        setDashboardData({ platforms: platformRows, settings: null, stats: null, queue: [] });
        return;
      }
      const [settings, stats, queue] = await Promise.all([
        readJson<Record<string, unknown>>('/api/bot/settings', { signal: controller.signal }),
        readJson<Record<string, unknown>>('/api/bot/stats', { signal: controller.signal }),
        readJson<unknown>('/api/video-donation/queue', { signal: controller.signal }),
      ]);
      if (!alive) return;
      setDashboardData({
        platforms: platformRows,
        settings,
        stats,
        queue,
      });
    }
    loadDashboard();
    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  const accounts = useMemo(() => dashboardData.platforms || [], [dashboardData.platforms]);
  const queueCount = pickRows(dashboardData.queue).length;
  const botEnabled = dashboardData.settings && 'botEnabled' in dashboardData.settings ? dashboardData.settings.botEnabled !== false : null;
  const statsCount = typeof dashboardData.stats?.commands === 'number' ? dashboardData.stats.commands : undefined;
  const connectedProviders = new Set(accounts.map((account) => account.provider?.toLowerCase()).filter(Boolean));

  const statusItems = [
    {
      title: '플랫폼 연결',
      value: accounts.length ? `${accounts.length}개 채널` : '연결 필요',
      label: accounts.length ? '연결됨' : '시작하기',
      tone: accounts.length ? 'mint' : 'amber',
      icon: Cable,
    },
    {
      title: '봇 상태',
      value: botEnabled == null ? '확인 중' : botEnabled ? '사용 중' : '꺼짐',
      label: botEnabled ? '준비됨' : botEnabled === false ? '꺼짐' : '확인',
      tone: botEnabled ? 'mint' : botEnabled === false ? 'rose' : 'neutral',
      icon: Radio,
    },
    {
      title: '영상 후원',
      value: queueCount ? `${queueCount}개 대기` : '대기 없음',
      label: queueCount ? '대기 중' : '비어 있음',
      tone: queueCount ? 'coral' : 'neutral',
      icon: PlaySquare,
    },
    {
      title: '채팅 응답',
      value: statsCount == null ? '확인 중' : `${statsCount}회`,
      label: statsCount ? '활성' : '준비',
      tone: statsCount ? 'sky' : 'neutral',
      icon: MessageSquare,
    },
  ] as const;

  return (
    <>
      <section className="overflow-hidden rounded-[var(--radius-panel)] border bg-[linear-gradient(135deg,hsl(var(--card))_0%,hsl(var(--accent-sky)/0.38)_54%,hsl(var(--accent-lemon)/0.32)_100%)] p-[clamp(1.25rem,3vw,2rem)] shadow-soft">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(28%,0.42fr)] lg:items-stretch">
          <div className="animate-fade-up">
            <Badge tone="mint">방송 관리 콘솔</Badge>
            <h1 className="mt-4 max-w-3xl break-keep text-3xl font-semibold leading-tight tracking-normal md:text-5xl">
              채팅 참여를 더 쉽게 만들고<br />방송 진행은 더 가볍게.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
              CHZZK, CIME, YouTube 시청자가 같은 방식으로 참여하고, 명령어와 포인트 이벤트가 방송 흐름에 자연스럽게 붙습니다.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {providers.map((provider) => {
                const connected = connectedProviders.has(provider.id);
                return (
                  <Button key={provider.id} asChild variant={connected ? 'secondary' : 'default'} size="lg">
                    <a href={apiUrl(provider.loginPath)}>
                      <img
                        src={provider.iconPath}
                        alt=""
                        aria-hidden="true"
                        className="h-5 w-5 shrink-0 rounded-[calc(var(--radius-control)*0.35)] object-contain"
                        draggable={false}
                      />
                      {provider.label}
                      {connected ? ' 다시 연결' : '로 로그인'}
                    </a>
                  </Button>
                );
              })}
              <CommandCreateDialog variant="outline" label="명령어 만들기" />
            </div>
          </div>

          <Card className="animate-fade-up bg-card/80" style={{ animationDelay: '80ms' } as React.CSSProperties}>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>연결된 채널</CardTitle>
                <Badge tone={accounts.length ? 'mint' : 'amber'}>{accounts.length ? '사용 가능' : '연결 필요'}</Badge>
              </div>
              <CardDescription>연결된 채널마다 시청자 참여 기능이 바로 열립니다.</CardDescription>
            </CardHeader>
            <CardContent>
              {accounts.length ? (
                <div className="grid gap-2">
                  {accounts.map((account) => (
                    <div key={`${account.provider}-${account.channel_id}`} className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border bg-background/75 p-[clamp(0.75rem,1.4vw,1rem)]">
                      <div className="flex min-w-0 items-center gap-3">
                        <ChannelAvatar account={account} />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{account.channel_name || account.channel_id || '연결된 채널'}</div>
                          <div className="mt-1 truncate text-xs font-medium uppercase text-muted-foreground">{account.channel_handle || providerLabel(account.provider)}</div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {account.metadata?.publicProfile?.isLive ? <Badge tone="rose">라이브 중</Badge> : null}
                            {compactCount(account.metadata?.publicProfile?.followerCount) ? (
                              <Badge tone="neutral">{compactCount(account.metadata?.publicProfile?.followerCount)} 팔로워</Badge>
                            ) : null}
                            {compactCount(account.metadata?.publicProfile?.subscriberCount) ? (
                              <Badge tone="neutral">{compactCount(account.metadata?.publicProfile?.subscriberCount)} 구독자</Badge>
                            ) : null}
                            {account.metadata?.publicProfile?.status === 'failed' ? <Badge tone="amber">프로필 확인 필요</Badge> : null}
                          </div>
                        </div>
                      </div>
                      <Badge tone="mint">연결됨</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[var(--radius-control)] border bg-background/75 p-[clamp(1rem,1.8vw,1.25rem)] text-sm leading-6 text-muted-foreground">
                  CHZZK, CIME 또는 YouTube로 시작하면 다른 플랫폼 시청자도 같은 참여 흐름으로 맞이할 수 있습니다.
                </div>
              )}
              <LinkButton href="/connection" variant="soft" className="mt-4 w-full justify-center">
                연결 관리 열기
                <ChevronRight className="h-4 w-4" />
              </LinkButton>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {statusItems.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.title} className="animate-fade-up bg-card/85">
              <CardContent className="flex items-center gap-3 p-4">
                <span className="grid aspect-square w-[var(--icon-box)] shrink-0 place-items-center rounded-[var(--radius-control)] bg-muted text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-muted-foreground">{item.title}</div>
                  <div className="mt-1 truncate text-sm font-semibold">{item.value}</div>
                </div>
                <Badge tone={item.tone} className="ml-auto">{item.label}</Badge>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="grid gap-3 md:grid-cols-5">
        {quickActions.map((action) => {
          const Icon = action.icon;
          if (action.href === 'dialog:command') {
            return (
              <CommandCreateDialog
                key={action.href}
                variant="outline"
                label={action.label}
                trailingChevron
                className="min-h-[var(--control-height-lg)] justify-between bg-card/85 px-[clamp(0.875rem,1.6vw,1.125rem)]"
              />
            );
          }
          if (action.href === 'dialog:roulette') {
            return (
              <RouletteCreateDialog
                key={action.href}
                variant="outline"
                label={action.label}
                trailingChevron
                className="min-h-[var(--control-height-lg)] justify-between bg-card/85 px-[clamp(0.875rem,1.6vw,1.125rem)]"
              />
            );
          }
          return (
            <Tooltip key={action.href} content={action.help}>
              <LinkButton href={action.href} variant="outline" className="min-h-[var(--control-height-lg)] justify-between bg-card/85 px-[clamp(0.875rem,1.6vw,1.125rem)]">
                <span className="inline-flex min-w-0 items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate">{action.label}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </LinkButton>
            </Tooltip>
          );
        })}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {featureCards.map((item, index) => {
          const Icon = item.icon;
          return (
            <Card
              key={item.href}
              className="group animate-fade-up overflow-hidden transition hover:-translate-y-0.5 hover:shadow-glow"
              style={{ animationDelay: `${index * 35}ms` } as React.CSSProperties}
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <span
                    className={cn(
                      'grid aspect-square w-[var(--icon-box)] shrink-0 place-items-center rounded-[var(--radius-control)] text-foreground ring-1 ring-border',
                      item.tone === 'mint' && 'bg-pastel-mint/70',
                      item.tone === 'coral' && 'bg-pastel-coral/70',
                      item.tone === 'lemon' && 'bg-pastel-lemon/80',
                      item.tone === 'sky' && 'bg-pastel-sky/75',
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <Badge tone={item.tone}>{item.title}</Badge>
                </div>
                <CardTitle>{item.title}</CardTitle>
                <CardDescription>{item.body}</CardDescription>
              </CardHeader>
              <CardContent>
                <LinkButton href={item.href} variant="outline" className="w-full justify-between">
                  {item.action}
                  <ChevronRight className="h-4 w-4" />
                </LinkButton>
              </CardContent>
            </Card>
          );
        })}
      </section>
    </>
  );
}
