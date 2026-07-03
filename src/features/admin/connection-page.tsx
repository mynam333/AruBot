'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { AlertCircle, Cable, CheckCircle2, Copy, ExternalLink, RefreshCw, ShieldCheck, Unlink, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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

type YoutubeBotProfile = {
  selectedChannelId?: string | null;
  selectedChannelTitle?: string | null;
  selectedChannelHandle?: string | null;
  selectedChannelThumbnailUrl?: string | null;
  status?: string | null;
  lastError?: string | null;
  updatedAt?: string | null;
};

type YoutubeStreamerStatus = {
  configured?: boolean;
  botConfigured?: boolean;
  channel?: {
    youtubeChannelId?: string | null;
    youtubeHandle?: string | null;
    title?: string | null;
    thumbnailUrl?: string | null;
    inputValue?: string | null;
    moderatorRegistered?: boolean;
    websubStatus?: string | null;
    lastDetectedVideoId?: string | null;
    lastLiveChatId?: string | null;
    lastLiveTitle?: string | null;
    lastError?: string | null;
    moderatorUrl?: string | null;
    botChannelUrl?: string | null;
  } | null;
  botProfile?: YoutubeBotProfile | null;
};

const providerConfigs = [
  {
    id: 'chzzk' as const,
    label: 'CHZZK',
    loginPath: '/api/auth/chzzk/login',
    iconPath: '/brands/chzzk.svg',
    revokePath: '/api/auth/chzzk/revoke',
    color: 'mint',
    description: 'CHZZK 시청자가 채팅 명령어, 포인트, 룰렛에 자연스럽게 참여하게 합니다.',
  },
  {
    id: 'cime' as const,
    label: 'CIME',
    loginPath: '/api/auth/cime/login',
    iconPath: '/brands/cime.svg',
    revokePath: '/api/auth/cime/revoke',
    color: 'sky',
    description: 'CIME 시청자도 같은 방송 경험 안에서 채팅과 후원을 이어가게 합니다.',
  },
  {
    id: 'youtube' as const,
    label: 'YouTube',
    loginPath: '/api/auth/youtube/login',
    iconPath: '/brands/youtube.svg',
    revokePath: '/api/auth/youtube/revoke',
    color: 'rose',
    description: 'YouTube Live 시청자도 같은 명령어, 포인트, 룰렛 흐름으로 참여하게 합니다.',
  },
] as const;

function normalizeProvider(provider?: string) {
  return provider?.toLowerCase() as ProviderId | undefined;
}

function ProviderMark({ label, color, iconPath }: { label: string; color: string; iconPath: string }) {
  return (
    <span
      className={cn(
        'grid aspect-square w-[calc(var(--icon-box)*1.22)] shrink-0 place-items-center overflow-hidden rounded-[var(--radius-card)] border shadow-subtle',
        color === 'mint' && 'bg-pastel-mint/80 text-teal-950 dark:bg-primary/20 dark:text-teal-50',
        color === 'sky' && 'bg-pastel-sky/85 text-sky-950 dark:bg-sky-500/20 dark:text-sky-50',
        color === 'rose' && 'bg-rose-500/10 text-rose-950 dark:bg-rose-500/20 dark:text-rose-50',
      )}
    >
      <img
        src={iconPath}
        alt={`${label} 아이콘`}
        className="h-[78%] w-[78%] object-contain"
        draggable={false}
      />
    </span>
  );
}

function AccountAvatar({ account, label, color, iconPath }: { account: PlatformAccount; label: string; color: string; iconPath: string }) {
  const imageUrl = account.profile_image_url || account.avatar_url;
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        referrerPolicy="no-referrer"
        className="aspect-square w-[calc(var(--icon-box)*1.22)] shrink-0 rounded-[var(--radius-card)] border object-cover shadow-subtle"
      />
    );
  }
  return <ProviderMark label={label} color={color} iconPath={iconPath} />;
}

function compactCount(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function ConnectionPage() {
  const searchParams = useSearchParams();
  const [platforms, setPlatforms] = useState<PlatformAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAccount, setBusyAccount] = useState<string | null>(null);
  const [syncingProvider, setSyncingProvider] = useState<ProviderId | 'all' | null>(null);
  const [youtubeStreamerStatus, setYoutubeStreamerStatus] = useState<YoutubeStreamerStatus | null>(null);
  const [showYoutubeModal, setShowYoutubeModal] = useState(false);
  const [youtubeInput, setYoutubeInput] = useState('');
  const [youtubeBusy, setYoutubeBusy] = useState(false);

  const refresh = useCallback(() => {
    const controller = new AbortController();
    let alive = true;
    setLoading(true);
    Promise.all([
      readJson<{ platforms?: PlatformAccount[] }>('/api/account/platforms', { signal: controller.signal }),
      readJson<YoutubeStreamerStatus>('/api/youtube/streamer-channel', { signal: controller.signal }),
    ]).then(([platformResult, streamerResult]) => {
      if (!alive) return;
      setPlatforms(Array.isArray(platformResult?.platforms) ? platformResult.platforms : []);
      setYoutubeStreamerStatus(streamerResult);
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
      { chzzk: [], cime: [], youtube: [] },
    );
  }, [platforms]);

  const revoke = async (provider: ProviderId, account: PlatformAccount) => {
    const config = providerConfigs.find((item) => item.id === provider);
    if (!config) return;
    const platformUserId = account.platform_user_id || account.channel_id || '';
    const busyKey = `${provider}:${platformUserId || 'account'}`;
    setBusyAccount(busyKey);
    try {
      const response = await fetch(apiUrl(config.revokePath), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platformUserId }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`${provider} revoke failed`);
      if (Array.isArray(data?.platforms)) setPlatforms(data.platforms);
      toast.success(`${account.channel_name || config.label} 연결을 해제했습니다.`);
      refresh();
    } catch {
      toast.error(`${config.label} 연결 해제에 실패했습니다.`);
    } finally {
      setBusyAccount(null);
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
        toast.success('플랫폼 프로필을 최신 정보로 가져왔습니다.');
      }
    } catch {
      toast.error('프로필 정보를 새로 가져오지 못했습니다.');
    } finally {
      setSyncingProvider(null);
    }
  };

  const connectedCount = platforms.length;
  const youtubeBotConfigured = youtubeStreamerStatus?.botConfigured === true;
  const youtubeRegistered = youtubeStreamerStatus?.configured === true;
  const youtubeBotProfile = youtubeStreamerStatus?.botProfile || null;

  const registerYoutubeChannel = async () => {
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    setYoutubeBusy(true);
    try {
      const response = await fetch(apiUrl('/api/youtube/streamer-channel'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: youtubeInput }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'youtube register failed');
      const moderatorUrl = data?.instructions?.moderatorUrl || data?.channel?.moderatorUrl || 'https://studio.youtube.com/settings/community';
      if (popup) popup.location.href = moderatorUrl;
      toast.success('YouTube 채널을 등록했습니다. 새 탭에서 AruBot을 운영자로 추가해 주세요.');
      setShowYoutubeModal(false);
      setYoutubeInput('');
      refresh();
    } catch (error) {
      if (popup) popup.close();
      toast.error(error instanceof Error ? error.message : 'YouTube 채널 등록에 실패했습니다.');
    } finally {
      setYoutubeBusy(false);
    }
  };

  const removeYoutubeChannel = async () => {
    setYoutubeBusy(true);
    try {
      const response = await fetch(apiUrl('/api/youtube/streamer-channel'), {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('delete failed');
      toast.success('YouTube 채널 등록을 해제했습니다.');
      refresh();
    } catch {
      toast.error('YouTube 채널 등록 해제에 실패했습니다.');
    } finally {
      setYoutubeBusy(false);
    }
  };

  const confirmYoutubeModerator = async () => {
    setYoutubeBusy(true);
    try {
      const response = await fetch(apiUrl('/api/youtube/streamer-channel/moderator-confirmed'), {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.verification?.message || data?.error || 'moderator confirm failed');
      toast.success(data?.verification?.message || 'YouTube 운영자 등록 완료를 확인했습니다.');
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '운영자 등록 완료 확인에 실패했습니다.');
    } finally {
      setYoutubeBusy(false);
    }
  };

  const copyText = async (value?: string | null) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success('복사했습니다.');
    } catch {
      toast.error('복사하지 못했습니다.');
    }
  };

  return (
    <>
      <section className="rounded-[var(--radius-panel)] border bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent-mint)/0.34)_58%,hsl(var(--accent-sky)/0.32))] p-[clamp(1.25rem,3vw,2rem)] shadow-soft">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(24%,0.34fr)] lg:items-end">
          <div>
            <Badge tone="mint">계정 연결</Badge>
            <h1 className="mt-4 max-w-3xl break-keep text-3xl font-semibold leading-tight md:text-5xl">
              어느 플랫폼에서 와도 같은 방송 경험으로.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
              CHZZK, CIME, YouTube 시청자가 같은 명령어, 포인트, 이벤트 흐름으로 참여할 수 있게 채널을 이어주세요.
            </p>
          </div>
          <Card className="bg-card/75">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                참여 채널
              </CardTitle>
              <CardDescription>시청자가 AruBot으로 만날 수 있는 방송 채널입니다.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{connectedCount}</div>
              <p className="mt-2 text-sm text-muted-foreground">연결된 채널</p>
              {connectedCount ? (
                <Button type="button" variant="outline" size="sm" className="mt-4 w-full" onClick={() => syncProfile()} disabled={syncingProvider === 'all'}>
                  <RefreshCw className={syncingProvider === 'all' ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                  최신 채널 정보 보기
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {providerConfigs.map((config) => {
          const accounts = grouped[config.id];
          const connected = config.id === 'youtube' ? youtubeRegistered : accounts.length > 0;
          return (
            <Card key={config.id} className="animate-fade-up overflow-hidden">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <ProviderMark label={config.label} color={config.color} iconPath={config.iconPath} />
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
                  {config.id === 'youtube' ? (
                    youtubeStreamerStatus?.channel ? (
                      <div className="grid gap-3 rounded-[var(--radius-control)] border bg-background/75 p-[clamp(0.75rem,1.4vw,1rem)]">
                        <div className="flex min-w-0 items-center gap-3">
                          {youtubeStreamerStatus.channel.thumbnailUrl ? (
                            <img
                              src={youtubeStreamerStatus.channel.thumbnailUrl}
                              alt=""
                              className="aspect-square w-[calc(var(--icon-box)*1.22)] shrink-0 rounded-[var(--radius-card)] border object-cover shadow-subtle"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <ProviderMark label={config.label} color={config.color} iconPath={config.iconPath} />
                          )}
                          <div className="min-w-0 max-w-full overflow-hidden">
                            <div className="max-w-full truncate text-sm font-semibold">{youtubeStreamerStatus.channel.title || youtubeStreamerStatus.channel.inputValue || 'YouTube 채널'}</div>
                            <div className="mt-1 max-w-full truncate text-xs font-medium text-muted-foreground">
                              {youtubeStreamerStatus.channel.youtubeHandle || youtubeStreamerStatus.channel.youtubeChannelId || '채널 확인 필요'}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge tone={youtubeStreamerStatus.channel.moderatorRegistered ? 'mint' : 'amber'}>
                            {youtubeStreamerStatus.channel.moderatorRegistered ? '운영자 등록 확인됨' : '운영자 등록 확인 필요'}
                          </Badge>
                          <Badge tone={youtubeStreamerStatus.channel.lastLiveChatId ? 'mint' : 'neutral'}>
                            {youtubeStreamerStatus.channel.lastLiveChatId ? '라이브 채팅 감지됨' : '라이브 대기'}
                          </Badge>
                          <Badge tone={youtubeStreamerStatus.channel.websubStatus === 'subscribe_requested' || youtubeStreamerStatus.channel.websubStatus === 'verified' ? 'sky' : 'amber'}>
                            WebSub {youtubeStreamerStatus.channel.websubStatus || 'pending'}
                          </Badge>
                        </div>
                        {youtubeStreamerStatus.channel.lastError ? (
                          <div className="flex items-center gap-1.5 text-xs text-destructive">
                            <AlertCircle className="h-3.5 w-3.5" />
                            {youtubeStreamerStatus.channel.lastError}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="rounded-[var(--radius-control)] border bg-background/75 p-[clamp(1rem,1.8vw,1.25rem)] text-sm leading-6 text-muted-foreground">
                        아직 등록된 YouTube 채널이 없습니다. 채널 URL이나 핸들을 등록하고 YouTube Studio에서 AruBot을 운영자로 추가하면 라이브 채팅에 참여할 수 있습니다.
                      </div>
                    )
                  ) : accounts.length ? (
                    accounts.map((account) => {
                      const accountKey = `${config.id}:${account.platform_user_id || account.channel_id || account.channel_name || 'account'}`;
                      return (
                      <div key={accountKey} className="grid min-w-0 gap-3 overflow-hidden rounded-[var(--radius-control)] border bg-background/75 p-[clamp(0.75rem,1.4vw,1rem)] 2xl:grid-cols-[minmax(0,1fr)_auto] 2xl:items-center">
                        <div className="flex min-w-0 max-w-full items-center gap-3 overflow-hidden">
                          <AccountAvatar account={account} label={config.label} color={config.color} iconPath={config.iconPath} />
                          <div className="min-w-0 max-w-full overflow-hidden">
                            <div className="max-w-full truncate text-sm font-semibold">{account.channel_name || account.channel_id || `${config.label} 채널`}</div>
                            <div className="mt-1 max-w-full truncate text-xs font-medium text-muted-foreground">
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
                              <div className="mt-2 line-clamp-2 max-w-full break-words text-xs leading-5 text-muted-foreground">
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
                        <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 2xl:justify-end">
                          {compactCount(account.metadata?.publicProfile?.followerCount) ? (
                            <Badge tone="neutral">{compactCount(account.metadata?.publicProfile?.followerCount)} 팔로워</Badge>
                          ) : null}
                          {compactCount(account.metadata?.publicProfile?.subscriberCount) ? (
                            <Badge tone="neutral">{compactCount(account.metadata?.publicProfile?.subscriberCount)} 구독자</Badge>
                          ) : null}
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full sm:w-auto lg:w-full 2xl:w-auto"
                            onClick={() => revoke(config.id, account)}
                            disabled={busyAccount === accountKey}
                          >
                            <Unlink className="h-4 w-4" />
                            {busyAccount === accountKey ? '처리 중' : '연결 해제'}
                          </Button>
                        </div>
                      </div>
                    );})
                  ) : (
                    <div className="rounded-[var(--radius-control)] border bg-background/75 p-[clamp(1rem,1.8vw,1.25rem)] text-sm leading-6 text-muted-foreground">
                      아직 연결된 {config.label} 채널이 없습니다. 로그인하면 이 플랫폼의 시청자도 같은 참여 흐름으로 들어올 수 있습니다.
                    </div>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {config.id === 'youtube' ? (
                    <>
                      <Button type="button" variant={youtubeRegistered ? 'secondary' : 'default'} onClick={() => setShowYoutubeModal(true)} disabled={!youtubeBotConfigured}>
                        <img
                          src={config.iconPath}
                          alt=""
                          aria-hidden="true"
                          className="h-6 w-6 shrink-0 rounded-[calc(var(--radius-control)*0.35)] object-contain"
                          draggable={false}
                        />
                        {youtubeRegistered ? '채널 다시 등록' : '채널 등록'}
                      </Button>
                      {youtubeStreamerStatus?.channel?.moderatorUrl ? (
                        <Button asChild variant="outline">
                          <a href={youtubeStreamerStatus.channel.moderatorUrl} target="_blank" rel="noreferrer">
                            운영자 등록 열기
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      ) : null}
                      {youtubeRegistered && !youtubeStreamerStatus?.channel?.moderatorRegistered ? (
                        <Button type="button" variant="outline" onClick={confirmYoutubeModerator} disabled={youtubeBusy}>
                          <CheckCircle2 className="h-4 w-4" />
                          운영자 실제 확인
                        </Button>
                      ) : null}
                      {youtubeRegistered ? (
                        <Button type="button" variant="outline" onClick={removeYoutubeChannel} disabled={youtubeBusy}>
                          <Unlink className="h-4 w-4" />
                          등록 해제
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <Button asChild variant={connected ? 'secondary' : 'default'}>
                      <a href={apiUrl(config.loginPath)}>
                      <img
                        src={config.iconPath}
                        alt=""
                        aria-hidden="true"
                        className="h-6 w-6 shrink-0 rounded-[calc(var(--radius-control)*0.35)] object-contain"
                        draggable={false}
                      />
                      {connected ? '추가 연결' : `${config.label}로 로그인`}
                      <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  )}
                  {connected ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        if (config.id === 'youtube') {
                          refresh();
                        } else {
                          void syncProfile(config.id);
                        }
                      }}
                      disabled={config.id === 'youtube' ? loading : syncingProvider === config.id}
                    >
                      <RefreshCw className={(config.id === 'youtube' ? loading : syncingProvider === config.id) ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                      {config.id === 'youtube' ? '채널 상태 보기' : '최신 정보 보기'}
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
            <h2 className="text-lg font-semibold">연결하면 참여가 바로 열립니다</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              시청자는 익숙한 플랫폼에서 들어오고, 방송에서는 명령어와 포인트, 룰렛, 후원 반응이 같은 흐름으로 움직입니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="sky">
              <Cable className="mr-1 h-3.5 w-3.5" />
              플랫폼 참여
            </Badge>
            <Badge tone="mint">통합 포인트</Badge>
            <Badge tone="lemon">방송 화면 참여</Badge>
          </div>
        </div>
      </section>

      {showYoutubeModal ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-[var(--radius-panel)] border bg-card p-[clamp(1rem,2vw,1.5rem)] shadow-lift">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Badge tone="rose">YouTube 채널 등록</Badge>
                <h2 className="mt-3 text-xl font-semibold">방송 채널 URL 또는 핸들</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  등록 후 새 탭에서 등록한 채널의 YouTube Studio가 열립니다. Studio 안에서 설정, 커뮤니티, 사용자 관리로 이동해 AruBot 채널 URL을 표준 운영자 또는 관리 운영자에 추가하고 저장하세요.
                </p>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => setShowYoutubeModal(false)} aria-label="닫기">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-5 grid gap-3">
              <Input
                value={youtubeInput}
                onChange={(event) => setYoutubeInput(event.target.value)}
                placeholder="https://www.youtube.com/@handle 또는 https://www.youtube.com/channel/UC..."
                autoFocus
              />
              {youtubeBotProfile?.selectedChannelId ? (
                <div className="rounded-[var(--radius-control)] border bg-background/80 p-3 text-sm leading-6">
                  <div className="font-semibold">운영자로 추가할 AruBot 채널</div>
                  <div className="mt-1 break-all text-muted-foreground">
                    https://www.youtube.com/channel/{youtubeBotProfile.selectedChannelId}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => copyText(`https://www.youtube.com/channel/${youtubeBotProfile.selectedChannelId}`)}
                  >
                    <Copy className="h-4 w-4" />
                    URL 복사
                  </Button>
                </div>
              ) : null}
              <div className="rounded-[var(--radius-control)] bg-muted/60 p-3 text-xs leading-5 text-muted-foreground">
                등록 버튼을 누르면 브라우저가 새 탭을 즉시 열고, 서버 등록이 끝난 뒤 그 탭을 YouTube Studio로 이동시킵니다.
              </div>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowYoutubeModal(false)}>
                취소
              </Button>
              <Button type="button" onClick={registerYoutubeChannel} disabled={youtubeBusy || !youtubeInput.trim()}>
                {youtubeBusy ? '등록 중' : '등록하고 운영자 설정 열기'}
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
