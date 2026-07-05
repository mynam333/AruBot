'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Coins,
  ExternalLink,
  Loader2,
  Radio,
  RefreshCw,
  Search,
  SearchX,
  SlidersHorizontal,
  Tv,
  Trophy,
  UserRoundPlus,
  WalletCards,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { apiUrl, readJson } from '@/shared/api/http';
import { cn, formatNumber } from '@/shared/lib/utils';

type PlatformAccount = {
  provider?: string;
  platform_user_id?: string;
  channel_id?: string;
  channel_name?: string;
  channel_handle?: string;
  avatar_url?: string;
  profile_image_url?: string;
};

type StationChannel = {
  provider?: string;
  platformUserId?: string;
  platform_user_id?: string;
  channelId?: string;
  channel_id?: string;
  channelName?: string;
  channel_name?: string;
  channelHandle?: string | null;
  channel_handle?: string | null;
  avatarUrl?: string | null;
  avatar_url?: string | null;
  profileImageUrl?: string | null;
  profile_image_url?: string | null;
  url?: string | null;
  live?: boolean | null;
  liveTitle?: string | null;
};

type ViewerBalance = {
  channelUid: string;
  canonicalChannelUid?: string | null;
  channelName?: string | null;
  avatarUrl?: string | null;
  provider?: string | null;
  points: number;
  identities?: Array<{ userId?: string; username?: string | null; points?: number }>;
  stationChannels?: StationChannel[];
  publicLinks?: {
    home?: string;
    commands?: string;
    points?: string;
    roulette?: string;
  };
};

type LiveStatus = {
  live?: boolean;
  title?: string;
  viewers?: number;
};

type ViewerPointsResponse = {
  userId?: string | null;
  platforms?: PlatformAccount[];
  viewerIdentity?: {
    arubotUuid?: string | null;
    identityKeys?: string[];
  };
  balances?: ViewerBalance[];
  totalPoints?: number;
  error?: string;
};

type AccountPlatformsResponse = {
  userId?: string | null;
  platforms?: PlatformAccount[];
};

const VIEWER_POINTS_PAGE_SIZE = 10;

function providerLabel(provider?: string | null) {
  const value = String(provider || '').toLowerCase();
  if (value === 'chzzk') return 'CHZZK';
  if (value === 'cime') return 'CIME';
  if (value === 'youtube') return 'YouTube';
  return '방송';
}

function providerTone(provider?: string | null): 'neutral' | 'mint' | 'sky' | 'rose' {
  const value = String(provider || '').toLowerCase();
  if (value === 'chzzk') return 'mint';
  if (value === 'cime') return 'sky';
  if (value === 'youtube') return 'rose';
  return 'neutral';
}

function ViewerShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen px-[var(--page-gutter)] py-[clamp(1rem,2.6vw,1.75rem)]">
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <Link href="/" className="inline-flex items-center gap-3 rounded-full bg-card/75 px-3 py-2 shadow-subtle backdrop-blur-xl transition hover:-translate-y-0.5">
          <img src="/files/logo.png" alt="" className="aspect-square w-[clamp(2rem,4vw,2.5rem)] object-contain" />
          <span className="text-sm font-semibold">AruBot</span>
        </Link>
        <div className="flex items-center gap-2">
          <LinkButton href="/viewer/connect" variant="ghost" className="hidden sm:inline-flex">계정 연결</LinkButton>
          <LinkButton href="/streamer" variant="ghost" className="hidden sm:inline-flex">스트리머 콘솔</LinkButton>
          <ThemeToggle />
        </div>
      </header>
      {children}
    </main>
  );
}

function AccountPill({ account }: { account: PlatformAccount }) {
  const imageUrl = account.profile_image_url || account.avatar_url;
  return (
    <div className="flex items-center gap-2 rounded-full border bg-card/75 px-3 py-2 shadow-subtle">
      {imageUrl ? (
        <img src={imageUrl} alt="" referrerPolicy="no-referrer" className="aspect-square w-[clamp(1.5rem,3vw,2rem)] rounded-full object-cover" />
      ) : (
        <span className="grid aspect-square w-[clamp(1.5rem,3vw,2rem)] place-items-center rounded-full bg-muted text-[0.7rem] font-semibold text-primary">
          {providerLabel(account.provider).slice(0, 2)}
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold">{account.channel_name || account.channel_id || providerLabel(account.provider)}</span>
        <span className="block truncate text-[0.7rem] text-muted-foreground">{providerLabel(account.provider)}</span>
      </span>
    </div>
  );
}

function BalanceAvatar({ balance }: { balance: ViewerBalance }) {
  if (balance.avatarUrl) {
    return <img src={balance.avatarUrl} alt="" referrerPolicy="no-referrer" className="aspect-square w-[var(--icon-box)] rounded-[var(--radius-control)] border object-cover" />;
  }
  return (
    <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-pastel-mint/70 text-primary">
      <Coins className="h-5 w-5" />
    </span>
  );
}

function stationChannelUrl(channel: StationChannel, fallbackBalance?: ViewerBalance) {
  const provider = String(channel.provider || fallbackBalance?.provider || '').toLowerCase();
  const channelId = String(channel.channelId || channel.channel_id || channel.platformUserId || channel.platform_user_id || fallbackBalance?.channelUid || '').trim();
  const handle = String(channel.channelHandle || channel.channel_handle || '').trim().replace(/^@/, '');
  if (provider === 'cime') {
    const cimeId = handle || channelId.replace(/^@/, '');
    if (cimeId) return `https://ci.me/@${encodeURIComponent(cimeId)}`;
  }
  if (channel.url) return String(channel.url);
  if (provider === 'youtube') {
    if (handle) {
      const normalizedHandle = handle.startsWith('@') ? handle : `@${handle}`;
      return `https://www.youtube.com/${encodeURIComponent(normalizedHandle).replace('%40', '@')}`;
    }
    if (channelId) return `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`;
  }
  if (channelId) return `https://chzzk.naver.com/${encodeURIComponent(channelId)}`;
  return '';
}

function getStationChannelName(channel: StationChannel, fallbackBalance?: ViewerBalance) {
  return String(
    channel.channelName ||
    channel.channel_name ||
    channel.channelHandle ||
    channel.channel_handle ||
    channel.channelId ||
    channel.channel_id ||
    fallbackBalance?.channelName ||
    fallbackBalance?.channelUid ||
    '방송국',
  );
}

function getStationChannelAvatar(channel: StationChannel, fallbackBalance?: ViewerBalance) {
  return String(channel.avatarUrl || channel.avatar_url || channel.profileImageUrl || channel.profile_image_url || fallbackBalance?.avatarUrl || '');
}

function getStationChannels(balance: ViewerBalance | null) {
  if (!balance) return [];
  const fallback: StationChannel = {
    provider: balance.provider || 'chzzk',
    channelId: balance.channelUid,
    channelName: balance.channelName || balance.channelUid,
    avatarUrl: balance.avatarUrl || null,
  };
  const channels = (balance.stationChannels?.length ? balance.stationChannels : [fallback])
    .map((channel) => ({ ...channel, url: stationChannelUrl(channel, balance) }))
    .filter((channel) => Boolean(channel.url));
  const seen = new Set<string>();
  return channels.filter((channel) => {
    const key = `${String(channel.provider || '').toLowerCase()}:${channel.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function PlatformLiveBadges({ balance, className }: { balance: ViewerBalance; className?: string }) {
  const channels = getStationChannels(balance);
  if (!channels.length) return null;
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {channels.map((channel) => {
        const provider = channel.provider || balance.provider || 'chzzk';
        const live = channel.live === true;
        const label = `${providerLabel(provider)} ${live ? '라이브' : '오프라인'}`;
        return (
          <Badge key={`${provider}:${channel.channelId || channel.url}`} tone={live ? 'rose' : providerTone(provider)}>
            <Radio className="mr-1 h-3 w-3" />
            {label}
          </Badge>
        );
      })}
    </div>
  );
}

function StationChannelDialog({
  balance,
  open,
  onOpenChange,
}: {
  balance: ViewerBalance | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const channels = getStationChannels(balance);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/24 backdrop-blur-[clamp(0.5rem,1.4vw,1rem)] data-[state=open]:animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[min(90svh,44rem)] w-[min(94vw,42rem)] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[var(--radius-panel)] border bg-card/96 shadow-lift outline-none backdrop-blur-2xl data-[state=open]:animate-modal-in">
          <div className="border-b bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent-mint)/0.32),hsl(var(--accent-sky)/0.24))] p-[clamp(1rem,3vw,1.6rem)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Badge tone="mint">
                  <Tv className="mr-1 h-3 w-3" />
                  방송국 선택
                </Badge>
                <Dialog.Title className="mt-3 break-keep text-[clamp(1.45rem,4vw,2.3rem)] font-semibold leading-tight">
                  {balance?.channelName || balance?.channelUid || '방송'}의 채널로 이동하기
                </Dialog.Title>
                <Dialog.Description className="mt-2 max-w-[60ch] break-keep text-sm leading-7 text-muted-foreground">
                  스트리머가 연결해 둔 플랫폼 중 보고 싶은 방송국을 선택하세요.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" size="icon" aria-label="방송국 선택 닫기" className="shrink-0 bg-background/60">
                  <X className="h-4 w-4" />
                </Button>
              </Dialog.Close>
            </div>
          </div>
          <div className="arubot-modal-scroll overflow-y-auto p-[clamp(1rem,3vw,1.5rem)]">
            <div className="grid gap-3">
              {channels.map((channel) => {
                const provider = channel.provider || balance?.provider || 'chzzk';
                const url = String(channel.url || '#');
                const avatar = getStationChannelAvatar(channel, balance || undefined);
                const title = getStationChannelName(channel, balance || undefined);
                const subtitle = channel.channelHandle || channel.channel_handle || channel.channelId || channel.channel_id || channel.platformUserId || channel.platform_user_id || '';
                return (
                  <article key={`${provider}-${url}`} className="group rounded-[var(--radius-panel)] border bg-background/70 p-[clamp(0.9rem,2.4vw,1.15rem)] shadow-subtle transition hover:-translate-y-0.5 hover:border-primary/35 hover:bg-card">
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div className="flex min-w-0 items-center gap-3">
                        {avatar ? (
                          <img src={avatar} alt="" referrerPolicy="no-referrer" className="aspect-square w-[clamp(2.75rem,7vw,3.4rem)] rounded-[var(--radius-control)] border object-cover" />
                        ) : (
                          <span className="grid aspect-square w-[clamp(2.75rem,7vw,3.4rem)] place-items-center rounded-[var(--radius-control)] bg-pastel-mint/65 text-primary">
                            <Tv className="h-5 w-5" />
                          </span>
                        )}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="min-w-0 truncate text-base font-semibold">{title}</h3>
                            <Badge tone={providerTone(provider)}>{providerLabel(provider)}</Badge>
                          </div>
                          {subtitle ? <p className="mt-1 truncate text-sm text-muted-foreground">{subtitle}</p> : null}
                        </div>
                      </div>
                      <Button asChild variant="soft" className="w-full justify-center sm:w-auto">
                        <a href={url} target="_blank" rel="noreferrer">
                          열기
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function LoadingState() {
  return (
    <ViewerShell>
      <section className="mx-auto mt-[clamp(3rem,8vw,6rem)] max-w-5xl rounded-[var(--radius-panel)] border bg-card/80 p-[clamp(1.5rem,4vw,3rem)] text-center shadow-soft">
        <div className="mx-auto grid aspect-square w-[clamp(4rem,9vw,6rem)] place-items-center rounded-[var(--radius-panel)] bg-muted">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold">내 참여 포인트를 모으는 중입니다</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">방송마다 쌓인 포인트와 바로 참여할 수 있는 페이지를 준비하고 있어요.</p>
      </section>
    </ViewerShell>
  );
}

export function ViewerPointsPage() {
  const [data, setData] = useState<ViewerPointsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'points' | 'name' | 'live'>('points');
  const [page, setPage] = useState(1);
  const [liveByChannel, setLiveByChannel] = useState<Record<string, LiveStatus>>({});
  const [stationBalance, setStationBalance] = useState<ViewerBalance | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const accountPayload = await readJson<AccountPlatformsResponse>('/api/account/platforms');
      if (!accountPayload?.userId) {
        setUnauthorized(true);
        setData(null);
        return;
      }

      const response = await fetch(apiUrl('/api/viewer/points'), {
        credentials: 'include',
        cache: 'no-store',
      });
      if (response.status === 401) {
        setUnauthorized(true);
        setData(null);
        return;
      }
      const payload = (await response.json().catch(() => null)) as ViewerPointsResponse | null;
      setUnauthorized(false);
      setData(payload || { userId: accountPayload.userId, platforms: accountPayload.platforms || [], balances: [], totalPoints: 0 });
    } catch {
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const platforms = data?.platforms || [];
  const balances = useMemo(() => data?.balances || [], [data?.balances]);
  const visibleBalances = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = term
      ? balances.filter((balance) => [
        balance.channelName,
        balance.channelUid,
        providerLabel(balance.provider),
      ].some((value) => String(value || '').toLowerCase().includes(term)))
      : balances;
    return [...filtered].sort((a, b) => {
      if (sortBy === 'name') return String(a.channelName || a.channelUid).localeCompare(String(b.channelName || b.channelUid), 'ko-KR');
      if (sortBy === 'live') return Number(liveByChannel[b.channelUid]?.live === true) - Number(liveByChannel[a.channelUid]?.live === true) || Number(b.points || 0) - Number(a.points || 0);
      return Number(b.points || 0) - Number(a.points || 0);
    });
  }, [balances, liveByChannel, query, sortBy]);
  const totalPoints = data?.totalPoints || balances.reduce((sum, item) => sum + Number(item.points || 0), 0);
  const totalPages = Math.max(1, Math.ceil(visibleBalances.length / VIEWER_POINTS_PAGE_SIZE));
  const paginatedBalances = useMemo(() => {
    const currentPage = Math.min(page, totalPages);
    const start = (currentPage - 1) * VIEWER_POINTS_PAGE_SIZE;
    return visibleBalances.slice(start, start + VIEWER_POINTS_PAGE_SIZE);
  }, [page, totalPages, visibleBalances]);
  const connectedProviders = new Set(platforms.map((account) => String(account.provider || '').toLowerCase()));
  const hasBothPlatforms = connectedProviders.has('chzzk') && connectedProviders.has('cime');
  const hasArubotIdentity = Boolean(data?.viewerIdentity?.arubotUuid);
  const liveBalances = useMemo(() => balances.filter((balance) => liveByChannel[balance.channelUid]?.live === true), [balances, liveByChannel]);
  const topBalance = useMemo(() => (
    balances.reduce<ViewerBalance | null>((best, current) => (
      !best || Number(current.points || 0) > Number(best.points || 0) ? current : best
    ), null)
  ), [balances]);

  useEffect(() => {
    setPage(1);
  }, [query, sortBy]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    if (!balances.length) return;
    const controller = new AbortController();
    const channels = balances.map((balance) => balance.channelUid).filter(Boolean).slice(0, 40);
    Promise.all(channels.map(async (channelUid) => {
      try {
        const response = await fetch(apiUrl(`/api/public/${encodeURIComponent(channelUid)}/live`), {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) return [channelUid, { live: false }] as const;
        const payload = (await response.json().catch(() => null)) as LiveStatus | null;
        return [channelUid, payload || { live: false }] as const;
      } catch {
        return [channelUid, { live: false }] as const;
      }
    })).then((entries) => {
      if (controller.signal.aborted) return;
      setLiveByChannel(Object.fromEntries(entries));
    });
    return () => controller.abort();
  }, [balances]);

  if (loading) return <LoadingState />;

  if (unauthorized) {
    return (
      <ViewerShell>
        <section className="mx-auto mt-[clamp(3rem,8vw,6rem)] grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(30%,0.42fr)] lg:items-center">
          <div className="rounded-[var(--radius-panel)] border bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent-mint)/0.38),hsl(var(--accent-sky)/0.28))] p-[clamp(1.5rem,4vw,3rem)] shadow-soft">
            <Badge tone="mint">시청자 포인트</Badge>
            <h1 className="mt-5 max-w-3xl break-keep text-[clamp(2.25rem,6vw,4.75rem)] font-semibold leading-tight">
              보는 플랫폼이 달라도 내 포인트는 하나로.
            </h1>
            <p className="mt-5 max-w-2xl break-keep text-sm leading-7 text-muted-foreground md:text-base">
              자주 보는 방송의 포인트를 한곳에서 보고, 지금 켜진 플랫폼을 확인해 다음 참여를 이어가세요.
            </p>
            <LinkButton href="/viewer/connect" className="mt-7">
              <UserRoundPlus className="h-4 w-4" />
              계정 연결하기
            </LinkButton>
          </div>
          <Card className="bg-card/82">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRoundPlus className="h-5 w-5 text-primary" />
                시청자에게 열리는 것들
              </CardTitle>
              <CardDescription>포인트를 확인하는 순간 다음 참여까지 이어집니다.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {['방송별 포인트 잔액 확인', '플랫폼별 라이브 상태 확인', 'CHZZK와 CIME 포인트 합산'].map((item) => (
                <div key={item} className="flex items-center gap-3 rounded-[var(--radius-control)] border bg-background/70 p-3 text-sm">
                  <Coins className="h-4 w-4 shrink-0 text-primary" />
                  {item}
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      </ViewerShell>
    );
  }

  return (
    <ViewerShell>
      <section className="mx-auto mt-[clamp(2rem,6vw,4rem)] max-w-7xl">
        <div className="rounded-[var(--radius-panel)] border bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent-mint)/0.35)_52%,hsl(var(--accent-coral)/0.24))] p-[clamp(1.25rem,3.5vw,2.5rem)] shadow-soft">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(28%,0.38fr)] lg:items-end">
            <div>
              <Badge tone={hasArubotIdentity ? 'mint' : 'sky'}>{hasArubotIdentity ? '아루봇 계정 연동' : '시청자 포인트'}</Badge>
              <h1 className="mt-5 max-w-4xl break-keep text-[clamp(2.15rem,5.5vw,4.5rem)] font-semibold leading-tight">
                내가 쌓은 방송별 포인트를 한눈에.
              </h1>
              <p className="mt-4 max-w-2xl break-keep text-sm leading-7 text-muted-foreground md:text-base">
                로그인한 계정에 연결된 플랫폼 포인트를 모아 보고, 방송별 라이브 상태를 함께 확인하세요.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {platforms.length ? (
                  platforms.map((account) => <AccountPill key={`${account.provider}-${account.platform_user_id || account.channel_id}`} account={account} />)
                ) : (
                  <LinkButton href="/viewer/connect" variant="soft">
                    <UserRoundPlus className="h-4 w-4" />
                    계정 연결하기
                  </LinkButton>
                )}
              </div>
            </div>
            <Card className="bg-card/80">
              <CardHeader>
                <CardTitle>내 참여 포인트</CardTitle>
                <CardDescription>방송마다 쌓인 참여 기록을 모두 더한 값입니다.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-[clamp(2.4rem,6vw,4rem)] font-semibold leading-none">{formatNumber(totalPoints)}</div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge tone="mint">{balances.length}개 방송</Badge>
                  <Badge tone={hasBothPlatforms ? 'sky' : 'neutral'}>{platforms.length}개 플랫폼</Badge>
                </div>
                <Button type="button" variant="outline" className="mt-5 w-full justify-center bg-background/70" onClick={() => load(true)} disabled={refreshing}>
                  <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
                  새로고침
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-5 grid max-w-7xl gap-4 md:grid-cols-3">
        <Card className="bg-card/85">
          <CardContent className="grid h-full gap-4 p-[clamp(1rem,2vw,1.25rem)]">
            <div className="flex items-start justify-between gap-3">
              <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-pastel-coral/65 text-rose-700 dark:text-rose-100">
                <Radio className="h-5 w-5" />
              </span>
              <Badge tone={liveBalances.length ? 'rose' : 'neutral'}>{liveBalances.length ? '라이브 중' : '대기 중'}</Badge>
            </div>
            <div>
              <h2 className="text-lg font-semibold">지금 볼 수 있는 방송</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {liveBalances.length ? `${liveBalances.length}개 방송이 라이브 중입니다. 라이브 우선 정렬로 바로 찾아보세요.` : '라이브 상태가 확인되면 이곳에서 먼저 보여줍니다.'}
              </p>
            </div>
            <Button type="button" variant="outline" className="mt-auto justify-center" onClick={() => setSortBy('live')}>
              <Radio className="h-4 w-4" />
              라이브 우선 보기
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-card/85">
          <CardContent className="grid h-full gap-4 p-[clamp(1rem,2vw,1.25rem)]">
            <div className="flex items-start justify-between gap-3">
              <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-pastel-lemon/75 text-amber-700 dark:text-amber-100">
                <Trophy className="h-5 w-5" />
              </span>
              <Badge tone="lemon">{topBalance ? `${formatNumber(topBalance.points)}P` : '준비 중'}</Badge>
            </div>
            <div>
              <h2 className="text-lg font-semibold">가장 많이 쌓인 방송</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {topBalance ? `${topBalance.channelName || topBalance.channelUid}에서 가장 많은 포인트를 가지고 있습니다.` : '포인트가 쌓이면 자주 참여한 방송을 바로 보여줍니다.'}
              </p>
            </div>
            {topBalance ? (
              <LinkButton href={topBalance.publicLinks?.home || `/c/${topBalance.channelUid}`} variant="soft" className="mt-auto justify-center">
                공개 페이지 열기
                <ExternalLink className="h-4 w-4" />
              </LinkButton>
            ) : (
              <LinkButton href="/viewer/connect" variant="soft" className="mt-auto justify-center">
                <UserRoundPlus className="h-4 w-4" />
                계정 연결하기
              </LinkButton>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/85">
          <CardContent className="grid h-full gap-4 p-[clamp(1rem,2vw,1.25rem)]">
            <div className="flex items-start justify-between gap-3">
              <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-pastel-sky/75 text-sky-700 dark:text-sky-100">
                <WalletCards className="h-5 w-5" />
              </span>
              <Badge tone={platforms.length ? 'mint' : 'amber'}>{platforms.length}개 플랫폼</Badge>
            </div>
            <div>
              <h2 className="text-lg font-semibold">내 참여 계정</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {hasBothPlatforms ? 'CHZZK와 CIME 계정이 함께 연결되어 참여 기록을 이어볼 수 있습니다.' : '자주 보는 플랫폼을 더 연결하면 방송별 포인트를 더 정확히 모아볼 수 있습니다.'}
              </p>
            </div>
            <LinkButton href="/viewer/connect" variant="outline" className="mt-auto justify-center">
              <UserRoundPlus className="h-4 w-4" />
              계정 연결 관리
            </LinkButton>
          </CardContent>
        </Card>
      </section>

      <section className="mx-auto mt-5 grid max-w-7xl gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(26%,0.34fr)]">
        <div className="grid gap-3">
          <Card className="bg-card/85">
            <CardContent className="grid gap-3 p-[clamp(1rem,2vw,1.25rem)] md:grid-cols-[minmax(0,1fr)_minmax(0,0.46fr)] md:items-center">
              <div className="relative min-w-0">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="스트리머 이름이나 채널 ID로 검색"
                  className="box-border min-h-[var(--control-height)] w-full min-w-0 max-w-full rounded-[var(--radius-control)] border bg-background/80 pl-[clamp(2.25rem,4vw,2.75rem)] pr-[clamp(0.75rem,1.4vw,1rem)] text-sm outline-none transition focus:border-primary/45 focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {([
                  ['points', '포인트순'],
                  ['live', '라이브 우선'],
                  ['name', '이름순'],
                ] as const).map(([value, label]) => (
                  <Button key={value} type="button" variant={sortBy === value ? 'soft' : 'outline'} size="sm" onClick={() => setSortBy(value)}>
                    <SlidersHorizontal className="h-4 w-4" />
                    {label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {visibleBalances.length ? (
            paginatedBalances.map((balance, index) => {
              const live = liveByChannel[balance.channelUid];
              return (
              <Card key={balance.channelUid} className="animate-fade-up overflow-hidden bg-card/85" style={{ animationDelay: `${index * 45}ms` }}>
                <CardContent className="p-[clamp(1rem,2vw,1.4rem)]">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <BalanceAvatar balance={balance} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="truncate text-lg font-semibold">{balance.channelName || balance.channelUid}</h2>
                          <PlatformLiveBadges balance={balance} />
                        </div>
                        <p className="mt-1 truncate text-sm text-muted-foreground">{live?.live && live.title ? live.title : balance.channelUid}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 md:text-right">
                      <div>
                        <div className="text-2xl font-semibold">{formatNumber(balance.points)}</div>
                        <div className="text-xs text-muted-foreground">보유 포인트</div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <LinkButton href={balance.publicLinks?.home || `/c/${balance.channelUid}`} variant="ghost">
                      공개 페이지
                      <ExternalLink className="h-4 w-4" />
                    </LinkButton>
                    <Button type="button" variant="ghost" onClick={() => setStationBalance(balance)}>
                      방송국 바로가기
                      <Tv className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );})
          ) : (
            <Card className="bg-card/85">
              <CardContent className="grid place-items-center p-[clamp(2rem,6vw,4rem)] text-center">
                <span className="grid aspect-square w-[clamp(4rem,9vw,6rem)] place-items-center rounded-[var(--radius-panel)] bg-muted text-muted-foreground">
                  <SearchX className="h-8 w-8" />
                </span>
                <h2 className="mt-6 text-2xl font-semibold">아직 쌓인 포인트가 없습니다</h2>
                <p className="mt-3 max-w-xl break-keep text-sm leading-7 text-muted-foreground">
                  방송 채팅에 참여하면 이곳에 포인트가 쌓입니다. 자주 보는 방송에서 명령어와 이벤트를 즐겨보세요.
                </p>
                <div className="mt-6">
                  <LinkButton href="/viewer/connect" variant="soft">
                    <UserRoundPlus className="h-4 w-4" />
                    시청 계정 연결하기
                  </LinkButton>
                </div>
              </CardContent>
            </Card>
          )}
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>

        <aside className="grid h-fit gap-4">
          <Card className="bg-card/85">
            <CardHeader>
              <CardTitle>포인트가 이어지는 방식</CardTitle>
              <CardDescription>어느 플랫폼에서 봐도 같은 방송 참여로 느껴지도록 모아 보여줍니다.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm leading-6 text-muted-foreground">
              <div className="rounded-[var(--radius-control)] border bg-background/70 p-3">
                아루봇에 연결한 플랫폼 계정의 포인트만 한 줄로 모여 보입니다.
              </div>
              <div className="rounded-[var(--radius-control)] border bg-background/70 p-3">
                각 방송 카드에서 공개 페이지와 방송국으로 바로 이동해 필요한 참여 화면을 이어갈 수 있습니다.
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/85">
            <CardHeader>
              <CardTitle>다음 참여를 빠르게</CardTitle>
              <CardDescription>포인트를 확인한 뒤 바로 쓸 수 있는 참여 페이지를 모았습니다.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="rounded-[var(--radius-control)] border bg-background/70 p-3 text-sm leading-6 text-muted-foreground">
                공개 페이지에서 명령어와 룰렛을 확인하고, 지금 라이브 중인 플랫폼을 먼저 볼 수 있습니다.
              </div>
              <LinkButton href="/viewer/connect" variant="soft" className="w-full justify-center">
                <UserRoundPlus className="h-4 w-4" />
                내 시청 계정 보기
              </LinkButton>
            </CardContent>
          </Card>
        </aside>
      </section>
      <StationChannelDialog
        balance={stationBalance}
        open={Boolean(stationBalance)}
        onOpenChange={(open) => {
          if (!open) setStationBalance(null);
        }}
      />
    </ViewerShell>
  );
}
