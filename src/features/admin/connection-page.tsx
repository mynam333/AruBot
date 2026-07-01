'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { AlertCircle, Cable, CheckCircle2, ExternalLink, RefreshCw, ShieldCheck, Unlink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip } from '@/components/ui/tooltip';
import { apiUrl, readJson } from '@/shared/api/http';
import { cn } from '@/shared/lib/utils';

type ProviderId = 'chzzk' | 'cime';

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
      description?: string | null;
      followerCount?: number | null;
      subscriberCount?: number | null;
      isLive?: boolean;
      canChatDonation?: boolean;
      canVideoDonation?: boolean;
      canMissionDonation?: boolean;
      error?: string | null;
      fetchedAt?: string;
      source?: string;
    };
  };
};

const providerConfigs = [
  {
    id: 'chzzk' as const,
    label: 'CHZZK',
    loginPath: '/api/auth/chzzk/login',
    iconPath: '/brands/chzzk.svg',
    revokePath: '/api/auth/chzzk/revoke',
    revokeLabel: '연결 해제',
    color: 'mint',
    description: '채팅 명령어, 포인트, 룰렛, 영상 후원 기능을 CHZZK 채널과 연결합니다.',
  },
  {
    id: 'cime' as const,
    label: 'CIME',
    loginPath: '/api/auth/cime/login',
    iconPath: '/brands/cime.svg',
    revokePath: '/api/auth/cime/revoke',
    revokeLabel: '연결 해제',
    color: 'sky',
    description: 'CIME 채팅과 후원 흐름을 같은 AruBot 계정으로 동기화합니다.',
  },
] as const;

function normalizeProvider(provider?: string) {
  return provider?.toLowerCase() as ProviderId | undefined;
}

function ProviderMark({ label, color }: { label: string; color: string }) {
  return (
    <span
      className={cn(
        'grid aspect-square w-[calc(var(--icon-box)*1.08)] place-items-center rounded-[var(--radius-card)] border text-sm font-semibold shadow-subtle',
        color === 'mint' && 'bg-pastel-mint/80 text-teal-950 dark:bg-primary/20 dark:text-teal-50',
        color === 'sky' && 'bg-pastel-sky/85 text-sky-950 dark:bg-sky-500/20 dark:text-sky-50',
      )}
    >
      {label.slice(0, 2)}
    </span>
  );
}

function AccountAvatar({ account, label, color }: { account: PlatformAccount; label: string; color: string }) {
  const imageUrl = account.profile_image_url || account.avatar_url;
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        referrerPolicy="no-referrer"
        className="aspect-square w-[calc(var(--icon-box)*1.08)] rounded-[var(--radius-card)] border object-cover shadow-subtle"
      />
    );
  }
  return <ProviderMark label={label} color={color} />;
}

function compactCount(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function ConnectionPage() {
  const searchParams = useSearchParams();
  const [platforms, setPlatforms] = useState<PlatformAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyProvider, setBusyProvider] = useState<ProviderId | null>(null);
  const [syncingProvider, setSyncingProvider] = useState<ProviderId | 'all' | null>(null);

  const refresh = useCallback(() => {
    const controller = new AbortController();
    let alive = true;
    setLoading(true);
    readJson<{ platforms?: PlatformAccount[] }>('/api/account/platforms', { signal: controller.signal }).then((platformResult) => {
      if (!alive) return;
      setPlatforms(Array.isArray(platformResult?.platforms) ? platformResult.platforms : []);
      setLoading(false);
    });
    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  useEffect(() => refresh(), [refresh]);

  useEffect(() => {
    const auth = searchParams.get('auth');
    if (auth === 'success') toast.success('플랫폼 연결이 완료되었습니다.');
    if (auth === 'cancelled') toast.info('플랫폼 연결을 취소했습니다.');
    if (auth === 'failed' || auth === 'error') toast.error('플랫폼 연결을 완료하지 못했습니다.');
  }, [searchParams]);

  const grouped = useMemo(() => {
    return platforms.reduce<Record<ProviderId, PlatformAccount[]>>(
      (acc, platform) => {
        const provider = normalizeProvider(platform.provider);
        if (provider && acc[provider]) acc[provider].push(platform);
        return acc;
      },
      { chzzk: [], cime: [] },
    );
  }, [platforms]);

  const revoke = async (provider: ProviderId) => {
    const config = providerConfigs.find((item) => item.id === provider);
    if (!config) return;
    setBusyProvider(provider);
    try {
      const response = await fetch(apiUrl(config.revokePath), {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`${provider} revoke failed`);
      if (Array.isArray(data?.platforms)) setPlatforms(data.platforms);
      toast.success(`${config.label} 연결 상태를 갱신했습니다.`);
      refresh();
    } catch {
      toast.error(`${config.label} 연결 해제에 실패했습니다.`);
    } finally {
      setBusyProvider(null);
    }
  };

  const syncProfile = async (provider?: ProviderId) => {
    setSyncingProvider(provider || 'all');
    try {
      const response = await fetch(apiUrl('/api/account/platforms/refresh'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(provider ? { provider } : {}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'profile refresh failed');
      setPlatforms(Array.isArray(data?.platforms) ? data.platforms : []);
      const failedCount = Array.isArray(data?.errors) ? data.errors.length : 0;
      if (failedCount) {
        toast.warning(`프로필 일부를 가져오지 못했습니다. 연결은 유지됩니다.`);
      } else {
        toast.success('플랫폼 프로필을 최신 정보로 동기화했습니다.');
      }
    } catch {
      toast.error('프로필 동기화에 실패했습니다.');
    } finally {
      setSyncingProvider(null);
    }
  };

  const connectedCount = platforms.length;

  return (
    <>
      <section className="rounded-[var(--radius-panel)] border bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent-mint)/0.34)_58%,hsl(var(--accent-sky)/0.32))] p-[clamp(1.25rem,3vw,2rem)] shadow-soft">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(24%,0.34fr)] lg:items-end">
          <div>
            <Badge tone="mint">계정 연결</Badge>
            <h1 className="mt-4 max-w-3xl break-keep text-3xl font-semibold leading-tight md:text-5xl">
              원하는 플랫폼으로 시작하고 하나의 계정으로 관리하세요.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
              CHZZK와 CIME 중 원하는 플랫폼으로 로그인한 뒤, 다른 플랫폼을 추가 연결하면 채널 정보와 봇 설정을 같은 사용자 정보로 이어갑니다.
            </p>
          </div>
          <Card className="bg-card/75">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                연결 요약
              </CardTitle>
              <CardDescription>현재 계정에 묶인 방송 채널입니다.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{connectedCount}</div>
              <p className="mt-2 text-sm text-muted-foreground">연결된 채널</p>
              {connectedCount ? (
                <Button type="button" variant="outline" size="sm" className="mt-4 w-full" onClick={() => syncProfile()} disabled={syncingProvider === 'all'}>
                  <RefreshCw className={syncingProvider === 'all' ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                  전체 프로필 동기화
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {providerConfigs.map((config) => {
          const accounts = grouped[config.id];
          const connected = accounts.length > 0;
          return (
            <Card key={config.id} className="animate-fade-up overflow-hidden">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <ProviderMark label={config.label} color={config.color} />
                    <div className="min-w-0">
                      <CardTitle>{config.label}</CardTitle>
                      <CardDescription>{config.description}</CardDescription>
                    </div>
                  </div>
                  <Badge tone={connected ? 'mint' : 'amber'}>{loading ? '확인 중' : connected ? '연결됨' : '미연결'}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2">
                  {accounts.length ? (
                    accounts.map((account) => (
                      <div key={`${account.provider}-${account.channel_id}`} className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border bg-background/75 p-[clamp(0.75rem,1.4vw,1rem)]">
                        <div className="flex min-w-0 items-center gap-3">
                          <AccountAvatar account={account} label={config.label} color={config.color} />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{account.channel_name || account.channel_id || `${config.label} 채널`}</div>
                            <div className="mt-1 truncate text-xs font-medium text-muted-foreground">
                              {account.channel_handle || account.channel_id || config.label}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {account.metadata?.publicProfile?.isLive ? <Badge tone="rose">라이브 중</Badge> : null}
                              {account.metadata?.publicProfile?.canChatDonation ? <Badge tone="coral">채팅 후원</Badge> : null}
                              {account.metadata?.publicProfile?.canVideoDonation ? <Badge tone="sky">영상 후원</Badge> : null}
                              {account.metadata?.publicProfile?.canMissionDonation ? <Badge tone="lemon">미션 후원</Badge> : null}
                              {account.metadata?.publicProfile?.status === 'failed' ? <Badge tone="amber">프로필 확인 필요</Badge> : null}
                            </div>
                            {account.metadata?.publicProfile?.description ? (
                              <div className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                                {account.metadata.publicProfile.description}
                              </div>
                            ) : null}
                            {account.metadata?.publicProfile?.status === 'failed' ? (
                              <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                                <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                                프로필 일부를 가져오지 못했지만 연결은 정상입니다.
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {compactCount(account.metadata?.publicProfile?.followerCount) ? (
                            <Badge tone="neutral">{compactCount(account.metadata?.publicProfile?.followerCount)} 팔로워</Badge>
                          ) : null}
                          {compactCount(account.metadata?.publicProfile?.subscriberCount) ? (
                            <Badge tone="neutral">{compactCount(account.metadata?.publicProfile?.subscriberCount)} 구독자</Badge>
                          ) : null}
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[var(--radius-control)] border bg-background/75 p-[clamp(1rem,1.8vw,1.25rem)] text-sm leading-6 text-muted-foreground">
                      아직 연결된 {config.label} 채널이 없습니다. 로그인하면 현재 계정에 플랫폼 정보가 연결됩니다.
                    </div>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button asChild variant={connected ? 'secondary' : 'default'}>
                    <a href={apiUrl(config.loginPath)}>
                      <img
                        src={config.iconPath}
                        alt=""
                        aria-hidden="true"
                        className="h-5 w-5 shrink-0 rounded-[calc(var(--radius-control)*0.35)] object-contain"
                        draggable={false}
                      />
                      {connected ? '다시 연결' : `${config.label}로 로그인`}
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                  <Tooltip content="서버의 최신 연결 상태를 다시 불러옵니다.">
                    <Button type="button" variant="outline" size="icon" onClick={refresh} disabled={loading} aria-label={`${config.label} 연결 상태 새로고침`}>
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </Tooltip>
                  {connected ? (
                    <Button type="button" variant="outline" onClick={() => syncProfile(config.id)} disabled={syncingProvider === config.id}>
                      <RefreshCw className={syncingProvider === config.id ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                      프로필 동기화
                    </Button>
                  ) : null}
                  {connected ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => revoke(config.id)}
                      disabled={busyProvider === config.id}
                    >
                      <Unlink className="h-4 w-4" />
                      {busyProvider === config.id ? '처리 중' : config.revokeLabel}
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="rounded-[var(--radius-card)] border bg-card/85 p-[clamp(1.25rem,2.2vw,1.5rem)] shadow-subtle">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">연결 후 바로 사용할 수 있는 기능</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              플랫폼이 연결되면 명령어, 포인트, 룰렛, 후원 반응, OBS 영상 후원을 채널 기준으로 관리할 수 있습니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="sky">
              <Cable className="mr-1 h-3.5 w-3.5" />
              플랫폼 동기화
            </Badge>
            <Badge tone="mint">채널별 설정</Badge>
            <Badge tone="lemon">OBS 연동</Badge>
          </div>
        </div>
      </section>
    </>
  );
}
