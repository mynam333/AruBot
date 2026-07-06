'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, ExternalLink, Link2, Loader2, RefreshCw, ShieldCheck, Trash2, Unlink, WalletCards } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { LegalFooter } from '@/components/app-shell/legal-footer';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { apiUrl, readJson } from '@/shared/api/http';
import { cn } from '@/shared/lib/utils';

type ProviderId = 'chzzk' | 'cime' | 'youtube';

type PlatformAccount = {
  provider?: string;
  platform_user_id?: string;
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
      canChatDonation?: boolean;
      canVideoDonation?: boolean;
      canMissionDonation?: boolean;
    };
  };
};

type AccountPlatformsResponse = {
  userId?: string | null;
  platforms?: PlatformAccount[];
};

const providers = [
  {
    id: 'chzzk' as const,
    label: 'CHZZK',
    loginPath: '/api/auth/chzzk/login',
    revokePath: '/api/auth/chzzk/revoke',
    iconPath: '/brands/chzzk.svg',
    tone: 'mint' as const,
    description: 'CHZZK에서 즐긴 채팅 참여와 포인트를 내 AruBot 시청 경험으로 이어갑니다.',
  },
  {
    id: 'cime' as const,
    label: 'CIME',
    loginPath: '/api/auth/cime/login',
    revokePath: '/api/auth/cime/revoke',
    iconPath: '/brands/cime.svg',
    tone: 'sky' as const,
    description: 'CIME에서 쌓은 참여 흔적도 같은 시청자 경험으로 자연스럽게 이어집니다.',
  },
  {
    id: 'youtube' as const,
    label: 'YouTube',
    loginPath: '/api/auth/youtube/login?mode=viewer',
    revokePath: '/api/auth/youtube/revoke',
    iconPath: '/brands/youtube.svg',
    tone: 'rose' as const,
    description: 'YouTube에서 쓰는 계정도 같은 시청자로 묶어 채팅 참여와 포인트 경험을 이어갑니다.',
  },
] as const;

const compactNumberFormatter = new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 });

function providerLabel(provider?: string | null) {
  const value = String(provider || '').toLowerCase();
  if (value === 'chzzk') return 'CHZZK';
  if (value === 'cime') return 'CIME';
  if (value === 'youtube') return 'YouTube';
  return '플랫폼';
}

function compactCount(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return compactNumberFormatter.format(value);
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
          <LinkButton href="/viewer/me" variant="ghost" className="hidden sm:inline-flex">내 포인트</LinkButton>
          <LinkButton href="/streamer" variant="ghost" className="hidden sm:inline-flex">스트리머 콘솔</LinkButton>
          <ThemeToggle />
        </div>
      </header>
      {children}
      <div className="mx-auto w-full max-w-7xl">
        <LegalFooter />
      </div>
    </main>
  );
}

function ProviderMark({ provider }: { provider: typeof providers[number] }) {
  return (
    <span
      className={cn(
        'grid aspect-square w-[calc(var(--icon-box)*1.2)] shrink-0 place-items-center overflow-hidden rounded-[var(--radius-card)] border shadow-subtle',
        provider.tone === 'mint' && 'bg-pastel-mint/80 text-teal-950 dark:bg-primary/20 dark:text-teal-50',
        provider.tone === 'sky' && 'bg-pastel-sky/85 text-sky-950 dark:bg-sky-500/20 dark:text-sky-50',
        provider.tone === 'rose' && 'bg-rose-500/10 text-rose-950 dark:bg-rose-500/20 dark:text-rose-50',
      )}
    >
      <img src={provider.iconPath} alt="" aria-hidden="true" className="h-[78%] w-[78%] object-contain" draggable={false} />
    </span>
  );
}

function AccountAvatar({ account, provider }: { account: PlatformAccount; provider: typeof providers[number] }) {
  const imageUrl = account.profile_image_url || account.avatar_url;
  if (imageUrl) {
    return <img src={imageUrl} alt="" referrerPolicy="no-referrer" className="aspect-square w-[calc(var(--icon-box)*1.2)] shrink-0 rounded-[var(--radius-card)] border object-cover shadow-subtle" />;
  }
  return <ProviderMark provider={provider} />;
}

function ProviderLoginButton({
  provider,
  connected,
  compact = false,
}: {
  provider: typeof providers[number];
  connected: boolean;
  compact?: boolean;
}) {
  return (
    <Button
      asChild
      variant="outline"
      className={cn(
        'border-border/80 bg-background/82 text-foreground shadow-subtle hover:border-primary/35 hover:bg-muted/80 dark:bg-card/82 dark:hover:bg-muted/70',
        compact && 'w-fit',
      )}
    >
      <a href={apiUrl(provider.loginPath)}>
        <span className="grid aspect-square h-7 w-7 shrink-0 place-items-center rounded-[calc(var(--radius-control)*0.55)] border bg-white shadow-[inset_0_0_0_1px_rgba(15,23,42,0.04)]">
          <img src={provider.iconPath} alt="" aria-hidden="true" className="max-h-[70%] max-w-[70%] object-contain" draggable={false} />
        </span>
        <span>{connected ? `${provider.label} 추가 연결` : `${provider.label}로 로그인`}</span>
        <ExternalLink className="h-4 w-4 text-muted-foreground" />
      </a>
    </Button>
  );
}

export function ViewerConnectPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [platforms, setPlatforms] = useState<PlatformAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyAccount, setBusyAccount] = useState<string | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const payload = await readJson<AccountPlatformsResponse>('/api/account/platforms');
      setUserId(payload?.userId || null);
      setPlatforms(Array.isArray(payload?.platforms) ? payload.platforms : []);
    } catch {
      setUserId(null);
      setPlatforms([]);
      toast.error('계정 연결 상태를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    return platforms.reduce<Record<ProviderId, PlatformAccount[]>>(
      (acc, account) => {
        const provider = String(account.provider || '').toLowerCase() as ProviderId;
        if (provider === 'chzzk' || provider === 'cime' || provider === 'youtube') acc[provider].push(account);
        return acc;
      },
      { chzzk: [], cime: [], youtube: [] },
    );
  }, [platforms]);

  const connectedProviders = useMemo(() => new Set(platforms.map((account) => String(account.provider || '').toLowerCase())), [platforms]);

  const revoke = async (provider: typeof providers[number], account: PlatformAccount) => {
    const platformUserId = account.platform_user_id || account.channel_id || '';
    const accountKey = `${provider.id}:${platformUserId || account.channel_name || 'account'}`;
    setBusyAccount(accountKey);
    try {
      const response = await fetch(apiUrl(provider.revokePath), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platformUserId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error('revoke_failed');
      setPlatforms(Array.isArray(payload?.platforms) ? payload.platforms : []);
      toast.success(`${account.channel_name || provider.label} 연결을 해제했습니다.`);
    } catch {
      toast.error('연결 해제에 실패했습니다.');
    } finally {
      setBusyAccount(null);
    }
  };

  const deleteAccount = async () => {
    if (!userId || deletingAccount) return;
    const firstConfirm = window.confirm('AruBot 계정 연결, 포인트, 참여 기록, 그림 후원 데이터 등 서비스에 저장된 개인정보를 삭제할까요? 이 작업은 되돌릴 수 없습니다.');
    if (!firstConfirm) return;
    const typed = window.prompt('계정 삭제를 계속하려면 delete-account 를 입력하세요.');
    if (typed !== 'delete-account') {
      toast.info('계정 삭제가 취소되었습니다.');
      return;
    }
    setDeletingAccount(true);
    try {
      const response = await fetch(apiUrl('/api/account'), {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'delete-account' }),
      });
      if (!response.ok) throw new Error('delete_failed');
      setUserId(null);
      setPlatforms([]);
      toast.success('AruBot 계정과 저장된 참여 데이터를 삭제했습니다.');
      window.location.assign('/');
    } catch {
      toast.error('계정 삭제에 실패했습니다. 개인정보 보호담당자에게 문의해주세요.');
    } finally {
      setDeletingAccount(false);
    }
  };

  if (loading) {
    return (
      <ViewerShell>
        <section className="mx-auto mt-[clamp(3rem,8vw,6rem)] max-w-5xl rounded-[var(--radius-panel)] border bg-card/80 p-[clamp(1.5rem,4vw,3rem)] text-center shadow-soft">
          <div className="mx-auto grid aspect-square w-[clamp(4rem,9vw,6rem)] place-items-center rounded-[var(--radius-panel)] bg-muted">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
          <h1 className="mt-6 text-2xl font-semibold">시청 경험을 불러오는 중입니다</h1>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">내가 연결한 플랫폼과 참여 기록을 준비하고 있어요.</p>
        </section>
      </ViewerShell>
    );
  }

  return (
    <ViewerShell>
      <section className="mx-auto mt-[clamp(2rem,6vw,4rem)] max-w-7xl">
        <div className="rounded-[var(--radius-panel)] border bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent-mint)/0.35)_54%,hsl(var(--accent-sky)/0.28))] p-[clamp(1.25rem,3.5vw,2.5rem)] shadow-soft">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(28%,0.38fr)] lg:items-end">
            <div>
              <Badge tone={platforms.length ? 'mint' : 'sky'}>{platforms.length ? '계정 연결됨' : '계정 연결'}</Badge>
              <h1 className="mt-5 max-w-4xl break-keep text-[clamp(2.15rem,5.5vw,4.5rem)] font-semibold leading-tight">
                어디서 보든 내 참여가 이어지게.
              </h1>
              <p className="mt-4 max-w-2xl break-keep text-sm leading-7 text-muted-foreground md:text-base">
                CHZZK, CIME, YouTube 중 어디에서 보더라도 같은 시청자로 포인트와 참여 경험을 이어가세요.
              </p>
              <p className="mt-3 max-w-2xl break-keep text-xs leading-6 text-muted-foreground">
                계정 연결과 참여 기록은 저장형 기능입니다. 만 14세 미만은 법정대리인 동의 후 이용해야 합니다.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {providers.map((provider) => {
                  const connected = connectedProviders.has(provider.id);
                  return <ProviderLoginButton key={provider.id} provider={provider} connected={connected} />;
                })}
              </div>
            </div>
            <Card className="bg-card/80">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  내 시청 계정
                </CardTitle>
                <CardDescription>연결할수록 참여할 수 있는 방송 경험이 넓어집니다.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="text-[clamp(2.4rem,6vw,4rem)] font-semibold leading-none">{platforms.length}</div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="mint">{userId ? 'AruBot 계정 활성화' : '로그인 필요'}</Badge>
                  <Badge tone={connectedProviders.size > 1 ? 'sky' : 'neutral'}>{connectedProviders.size}개 플랫폼</Badge>
                </div>
                <Button type="button" variant="outline" className="mt-2 w-full justify-center bg-background/70" onClick={() => load(true)} disabled={refreshing}>
                  <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
                  최신 상태 보기
                </Button>
                <LinkButton href="/viewer/me" variant="soft" className="w-full justify-center">
                  <WalletCards className="h-4 w-4" />
                  내 포인트 보기
                </LinkButton>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-5 grid max-w-7xl gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {providers.map((provider) => {
          const accounts = grouped[provider.id];
          const connected = accounts.length > 0;
          return (
            <Card key={provider.id} className="animate-fade-up bg-card/85">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <ProviderMark provider={provider} />
                    <div className="min-w-0">
                      <CardTitle>{provider.label}</CardTitle>
                      <CardDescription>{provider.description}</CardDescription>
                    </div>
                  </div>
                  <Badge tone={connected ? 'mint' : 'amber'}>{connected ? '연결됨' : '미연결'}</Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                {accounts.length ? (
                  accounts.map((account) => {
                    const accountKey = `${provider.id}:${account.platform_user_id || account.channel_id || account.channel_name || 'account'}`;
                    const profile = account.metadata?.publicProfile;
                    return (
                      <div key={accountKey} className="grid min-w-0 gap-3 overflow-hidden rounded-[var(--radius-control)] border bg-background/75 p-[clamp(0.75rem,1.6vw,1rem)] xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
                        <div className="flex min-w-0 max-w-full items-center gap-3 overflow-hidden">
                          <AccountAvatar account={account} provider={provider} />
                          <div className="min-w-0 max-w-full overflow-hidden">
                            <div className="max-w-full truncate text-sm font-semibold">{account.channel_name || account.channel_id || `${provider.label} 계정`}</div>
                            <div className="mt-1 max-w-full truncate text-xs font-medium text-muted-foreground">
                              {account.channel_handle || account.channel_id || account.platform_user_id || providerLabel(account.provider)}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {profile?.isLive ? <Badge tone="rose">라이브 중</Badge> : null}
                              {profile?.canChatDonation ? <Badge tone="coral">채팅 후원</Badge> : null}
                              {profile?.canVideoDonation ? <Badge tone="sky">영상 후원</Badge> : null}
                              {profile?.canMissionDonation ? <Badge tone="lemon">미션 후원</Badge> : null}
                              {profile?.status === 'failed' ? <Badge tone="amber">프로필 확인 필요</Badge> : null}
                            </div>
                          </div>
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 xl:justify-end">
                          {compactCount(profile?.followerCount) ? <Badge tone="neutral">{compactCount(profile?.followerCount)} 팔로워</Badge> : null}
                          {compactCount(profile?.subscriberCount) ? <Badge tone="neutral">{compactCount(profile?.subscriberCount)} 구독자</Badge> : null}
                          <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => revoke(provider, account)} disabled={busyAccount === accountKey}>
                            <Unlink className="h-4 w-4" />
                            {busyAccount === accountKey ? '처리 중' : '연결 해제'}
                          </Button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-[var(--radius-control)] border bg-background/75 p-[clamp(1rem,1.8vw,1.25rem)] text-sm leading-6 text-muted-foreground">
                    아직 연결된 {provider.label} 계정이 없습니다. 로그인하면 이 플랫폼에서 쌓은 참여도 함께 볼 수 있습니다.
                  </div>
                )}
                <ProviderLoginButton provider={provider} connected={connected} compact />
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="mx-auto mt-5 max-w-7xl rounded-[var(--radius-card)] border bg-card/85 p-[clamp(1.25rem,2.2vw,1.5rem)] shadow-subtle">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">한 번 연결하면 참여가 이어집니다</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              포인트를 확인하고, 방송별 명령어와 룰렛으로 바로 이동하며, 플랫폼이 달라도 같은 시청자로 참여할 수 있습니다.
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              더 이상 이용하지 않을 경우 AruBot 계정과 저장된 참여 데이터를 삭제할 수 있습니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="mint">
              <BadgeCheck className="mr-1 h-3.5 w-3.5" />
              통합 포인트
            </Badge>
            <Badge tone="sky">
              <Link2 className="mr-1 h-3.5 w-3.5" />
              추가 연결
            </Badge>
            <Button type="button" variant="outline" onClick={deleteAccount} disabled={!userId || deletingAccount}>
              {deletingAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              계정 삭제
            </Button>
          </div>
        </div>
      </section>
    </ViewerShell>
  );
}
