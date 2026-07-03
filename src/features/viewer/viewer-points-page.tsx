'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Coins,
  ExternalLink,
  Loader2,
  MessageSquare,
  Radio,
  RefreshCw,
  Search,
  SearchX,
  SlidersHorizontal,
  Sparkles,
  UserRoundPlus,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Tooltip } from '@/components/ui/tooltip';
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

type ViewerBalance = {
  channelUid: string;
  channelName?: string | null;
  avatarUrl?: string | null;
  provider?: string | null;
  points: number;
  identities?: Array<{ userId?: string; username?: string | null; points?: number }>;
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
  return '방송';
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

function stationUrl(balance: ViewerBalance) {
  const uid = encodeURIComponent(balance.channelUid);
  const provider = String(balance.provider || '').toLowerCase();
  if (provider === 'cime') return `https://ci.me/channels/${uid}`;
  return `https://chzzk.naver.com/${uid}`;
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
              자주 보는 방송의 포인트를 한곳에서 보고, 명령어와 룰렛 페이지로 바로 이동해 다음 참여를 이어가세요.
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
              {['방송별 포인트 잔액 확인', '공개 명령어 페이지 바로가기', 'CHZZK와 CIME 포인트 합산'].map((item) => (
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
                로그인한 계정에 연결된 플랫폼 포인트를 모아 보고, 공개 명령어와 룰렛으로 바로 이어가세요.
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
                          {balance.provider ? <Badge tone="neutral">{providerLabel(balance.provider)}</Badge> : null}
                          <Badge tone={live?.live ? 'rose' : 'neutral'}>
                            <Radio className="mr-1 h-3 w-3" />
                            {live?.live ? '라이브 중' : '오프라인'}
                          </Badge>
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
                    <LinkButton href={balance.publicLinks?.commands || `/c/${balance.channelUid}/commands`} variant="soft">
                      <MessageSquare className="h-4 w-4" />
                      명령어 보기
                    </LinkButton>
                    <LinkButton href={balance.publicLinks?.points || `/c/${balance.channelUid}/points`} variant="outline">
                      <Coins className="h-4 w-4" />
                      포인트 페이지
                    </LinkButton>
                    <Tooltip content="방송인이 공개한 룰렛 목록으로 이동합니다.">
                      <LinkButton href={balance.publicLinks?.roulette || `/c/${balance.channelUid}/roulette`} variant="outline">
                        <Sparkles className="h-4 w-4" />
                        룰렛
                      </LinkButton>
                    </Tooltip>
                    <LinkButton href={balance.publicLinks?.home || `/c/${balance.channelUid}`} variant="ghost">
                      공개 페이지
                      <ExternalLink className="h-4 w-4" />
                    </LinkButton>
                    <Button asChild variant="ghost">
                      <a href={stationUrl(balance)} target="_blank" rel="noreferrer">
                        방송국 바로가기
                        <ExternalLink className="h-4 w-4" />
                      </a>
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
                각 방송 카드에서 명령어, 포인트, 룰렛 페이지로 바로 이동해 참여할 수 있습니다.
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
                방송마다 열린 명령어와 룰렛을 바로 찾아가고, 지금 라이브 중인 채널을 먼저 볼 수 있습니다.
              </div>
              <LinkButton href="/viewer/connect" variant="soft" className="w-full justify-center">
                <UserRoundPlus className="h-4 w-4" />
                내 시청 계정 보기
              </LinkButton>
            </CardContent>
          </Card>
        </aside>
      </section>
    </ViewerShell>
  );
}
