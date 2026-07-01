'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  Coins,
  ExternalLink,
  Link2,
  Loader2,
  MessageSquare,
  RefreshCw,
  SearchX,
  Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Tooltip } from '@/components/ui/tooltip';
import { apiUrl } from '@/shared/api/http';
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

type ViewerPointsResponse = {
  userId?: string | null;
  platforms?: PlatformAccount[];
  balances?: ViewerBalance[];
  totalPoints?: number;
  error?: string;
};

type AccountPlatformsResponse = {
  userId?: string | null;
  platforms?: PlatformAccount[];
};

const providers = [
  { id: 'chzzk', label: 'CHZZK', loginPath: '/api/auth/chzzk/login', iconPath: '/brands/chzzk.svg' },
  { id: 'cime', label: 'CIME', loginPath: '/api/auth/cime/login', iconPath: '/brands/cime.svg' },
] as const;

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
          <LinkButton href="/streamer" variant="ghost" className="hidden sm:inline-flex">스트리머 콘솔</LinkButton>
          <ThemeToggle />
        </div>
      </header>
      {children}
    </main>
  );
}

function PlatformLoginButtons() {
  return (
    <div className="flex flex-wrap gap-2">
      {providers.map((provider) => (
        <Button key={provider.id} asChild variant="outline" className="bg-card/80">
          <a href={apiUrl(provider.loginPath)}>
            <img src={provider.iconPath} alt="" aria-hidden="true" className="h-5 w-5 shrink-0 rounded-[calc(var(--radius-control)*0.35)] object-contain" />
            {provider.label}로 로그인
          </a>
        </Button>
      ))}
    </div>
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

function LoadingState() {
  return (
    <ViewerShell>
      <section className="mx-auto mt-[clamp(3rem,8vw,6rem)] max-w-5xl rounded-[var(--radius-panel)] border bg-card/80 p-[clamp(1.5rem,4vw,3rem)] text-center shadow-soft">
        <div className="mx-auto grid aspect-square w-[clamp(4rem,9vw,6rem)] place-items-center rounded-[var(--radius-panel)] bg-muted">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold">포인트를 불러오는 중입니다</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">연결된 플랫폼 계정을 확인하고 방송별 포인트를 합산하고 있습니다.</p>
      </section>
    </ViewerShell>
  );
}

export function ViewerPointsPage() {
  const [data, setData] = useState<ViewerPointsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const accountResponse = await fetch(apiUrl('/api/account/platforms'), {
        credentials: 'include',
        cache: 'no-store',
      });
      const accountPayload = (await accountResponse.json().catch(() => null)) as AccountPlatformsResponse | null;
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
  const totalPoints = data?.totalPoints || balances.reduce((sum, item) => sum + Number(item.points || 0), 0);
  const connectedProviders = new Set(platforms.map((account) => String(account.provider || '').toLowerCase()));
  const hasBothPlatforms = connectedProviders.has('chzzk') && connectedProviders.has('cime');

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
              CHZZK 또는 CIME으로 로그인하면 방송별 포인트를 확인할 수 있습니다. 두 플랫폼을 모두 연결하면 같은 방송인의 포인트가 합산되어 표시됩니다.
            </p>
            <div className="mt-7">
              <PlatformLoginButtons />
            </div>
          </div>
          <Card className="bg-card/82">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="h-5 w-5 text-primary" />
                계정 연결 방식
              </CardTitle>
              <CardDescription>먼저 로그인한 계정에 나중에 연결한 플랫폼이 묶입니다.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {['방송별 포인트 잔액 확인', '공개 명령어 페이지 바로가기', 'CHZZK와 CIME 포인트 합산'].map((item) => (
                <div key={item} className="flex items-center gap-3 rounded-[var(--radius-control)] border bg-background/70 p-3 text-sm">
                  <BadgeCheck className="h-4 w-4 shrink-0 text-primary" />
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
              <Badge tone={hasBothPlatforms ? 'mint' : 'sky'}>{hasBothPlatforms ? '통합 포인트 활성화' : '시청자 포인트'}</Badge>
              <h1 className="mt-5 max-w-4xl break-keep text-[clamp(2.15rem,5.5vw,4.5rem)] font-semibold leading-tight">
                내 방송 참여 포인트를 한눈에 확인하세요.
              </h1>
              <p className="mt-4 max-w-2xl break-keep text-sm leading-7 text-muted-foreground md:text-base">
                연결된 플랫폼 계정을 기준으로 방송별 포인트를 합산했습니다. 방송인의 공개 명령어와 포인트 페이지로 바로 이동할 수 있습니다.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {platforms.length ? platforms.map((account) => <AccountPill key={`${account.provider}-${account.platform_user_id || account.channel_id}`} account={account} />) : <PlatformLoginButtons />}
              </div>
            </div>
            <Card className="bg-card/80">
              <CardHeader>
                <CardTitle>총 보유 포인트</CardTitle>
                <CardDescription>연결된 모든 플랫폼에서 확인된 합산값입니다.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-[clamp(2.4rem,6vw,4rem)] font-semibold leading-none">{formatNumber(totalPoints)}</div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge tone="mint">{balances.length}개 방송</Badge>
                  <Badge tone={platforms.length > 1 ? 'sky' : 'neutral'}>{platforms.length}개 플랫폼</Badge>
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
          {balances.length ? (
            balances.map((balance, index) => (
              <Card key={balance.channelUid} className="animate-fade-up overflow-hidden bg-card/85" style={{ animationDelay: `${index * 45}ms` }}>
                <CardContent className="p-[clamp(1rem,2vw,1.4rem)]">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <BalanceAvatar balance={balance} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="truncate text-lg font-semibold">{balance.channelName || balance.channelUid}</h2>
                          {balance.provider ? <Badge tone="neutral">{providerLabel(balance.provider)}</Badge> : null}
                        </div>
                        <p className="mt-1 truncate text-sm text-muted-foreground">{balance.channelUid}</p>
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
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <Card className="bg-card/85">
              <CardContent className="grid place-items-center p-[clamp(2rem,6vw,4rem)] text-center">
                <span className="grid aspect-square w-[clamp(4rem,9vw,6rem)] place-items-center rounded-[var(--radius-panel)] bg-muted text-muted-foreground">
                  <SearchX className="h-8 w-8" />
                </span>
                <h2 className="mt-6 text-2xl font-semibold">아직 표시할 포인트가 없습니다</h2>
                <p className="mt-3 max-w-xl break-keep text-sm leading-7 text-muted-foreground">
                  방송 채팅에 참여하거나, 다른 플랫폼 계정을 연결하면 확인 가능한 포인트가 이곳에 표시됩니다.
                </p>
                <div className="mt-6">
                  <PlatformLoginButtons />
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="grid h-fit gap-4">
          <Card className="bg-card/85">
            <CardHeader>
              <CardTitle>포인트 합산 기준</CardTitle>
              <CardDescription>같은 AruBot 계정에 연결된 플랫폼 ID를 기준으로 계산합니다.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm leading-6 text-muted-foreground">
              <div className="rounded-[var(--radius-control)] border bg-background/70 p-3">
                CHZZK와 CIME을 모두 연결하면 각 플랫폼에서 쌓은 같은 방송인의 포인트가 합산됩니다.
              </div>
              <div className="rounded-[var(--radius-control)] border bg-background/70 p-3">
                공개 페이지 이동은 방송인이 열어둔 명령어, 포인트, 룰렛 화면으로 연결됩니다.
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/85">
            <CardHeader>
              <CardTitle>플랫폼 추가 연결</CardTitle>
              <CardDescription>다른 플랫폼에서도 같은 시청자로 인식됩니다.</CardDescription>
            </CardHeader>
            <CardContent>
              <PlatformLoginButtons />
              <Button type="button" variant="outline" className="mt-3 w-full justify-center" onClick={() => load(true)} disabled={refreshing}>
                <ArrowRight className="h-4 w-4" />
                연결 상태 다시 확인
              </Button>
            </CardContent>
          </Card>
        </aside>
      </section>
    </ViewerShell>
  );
}
