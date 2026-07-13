'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { AlertCircle, Cable, CheckCircle2, Copy, ExternalLink, RefreshCw, ShieldCheck, Unlink, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page';
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
  last_login_at?: string;
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

type YoutubeAuthorizationStatus = {
  active?: boolean;
  scope?: string | null;
  consentGrantedAt?: string | null;
  consentConfirmedAt?: string | null;
  lastUsedAt?: string | null;
  lastValidatedAt?: string | null;
  lastActivityAt?: string | null;
  validationIntervalDays?: number;
  inactivityDays?: number;
  nextValidationAt?: string | null;
  inactivityRevocationAt?: string | null;
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

type YoutubeModeratorVerification = {
  reason?: string;
  message?: string;
  checkedBy?: string;
  botChannelId?: string | null;
  observedChannelId?: string | null;
  moderatorListError?: string | null;
  authorDetails?: {
    displayName?: string | null;
    channelId?: string | null;
    isChatOwner?: boolean;
    isChatModerator?: boolean;
  };
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
    description: 'CIME 시청자도 채팅과 후원에 자연스럽게 참여하게 합니다.',
  },
  {
    id: 'youtube' as const,
    label: 'YouTube',
    loginPath: '/api/auth/youtube/login',
    iconPath: '/brands/youtube.svg',
    revokePath: '/api/auth/youtube/revoke',
    color: 'rose',
    description: 'YouTube Live 시청자도 명령어, 포인트, 룰렛에 참여하게 합니다.',
  },
] as const;

const compactNumberFormatter = new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 });
const authorizationDateFormatter = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });

function normalizeProvider(provider?: string) {
  return provider?.toLowerCase() as ProviderId | undefined;
}

function formatYoutubeModeratorError(verification?: YoutubeModeratorVerification | null, fallback = '운영자 등록 완료 확인에 실패했습니다.') {
  if (!verification) return fallback;
  const parts = [verification.message || fallback];
  if (verification.reason) parts.push(`원인: ${verification.reason}`);
  if (verification.checkedBy) parts.push(`확인: ${verification.checkedBy}`);
  if (verification.moderatorListError) parts.push(`목록 조회: ${verification.moderatorListError}`);
  if (verification.botChannelId && verification.observedChannelId && verification.botChannelId !== verification.observedChannelId) {
    parts.push('AruBot에 저장된 봇 채널과 실제 채팅 작성 채널이 다릅니다.');
  }
  return parts.join(' · ');
}

function ProviderMark({ label, color, iconPath }: { label: string; color: string; iconPath: string }) {
  const mark = (
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
  return label === 'YouTube' ? (
    <a href="https://www.youtube.com/" target="_blank" rel="noreferrer" aria-label="YouTube 열기">
      {mark}
    </a>
  ) : mark;
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
  return compactNumberFormatter.format(value);
}

function formatAuthorizationDate(value?: string | null) {
  if (!value) return '기록 없음';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? authorizationDateFormatter.format(date)
    : '기록 없음';
}

function formatYoutubeScope(value?: string | null) {
  const scope = String(value || '');
  if (scope.includes('youtube.force-ssl')) return '라이브 채팅 관리';
  if (scope.includes('youtube.readonly')) return 'YouTube 채널 읽기';
  return 'Google 동의 화면에서 승인한 범위';
}

export function ConnectionPage() {
  const searchParams = useSearchParams();
  const [platforms, setPlatforms] = useState<PlatformAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAccount, setBusyAccount] = useState<string | null>(null);
  const [syncingProvider, setSyncingProvider] = useState<ProviderId | 'all' | null>(null);
  const [youtubeStreamerStatus, setYoutubeStreamerStatus] = useState<YoutubeStreamerStatus | null>(null);
  const [youtubeAuthorization, setYoutubeAuthorization] = useState<YoutubeAuthorizationStatus | null>(null);
  const [showYoutubeModal, setShowYoutubeModal] = useState(false);
  const [youtubeInput, setYoutubeInput] = useState('');
  const [youtubeBusy, setYoutubeBusy] = useState(false);
  const openedYoutubeParamRef = useRef(false);

  const refresh = useCallback(() => {
    const controller = new AbortController();
    let alive = true;
    setLoading(true);
    Promise.all([
      readJson<{ platforms?: PlatformAccount[]; authorizations?: { youtube?: YoutubeAuthorizationStatus | null } }>('/api/account/platforms', { signal: controller.signal }),
      readJson<YoutubeStreamerStatus>('/api/youtube/streamer-channel', { signal: controller.signal }),
    ]).then(([platformResult, streamerResult]) => {
      if (!alive) return;
      setPlatforms(Array.isArray(platformResult?.platforms) ? platformResult.platforms : []);
      setYoutubeAuthorization(platformResult?.authorizations?.youtube || null);
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
    if (provider === 'youtube' && !window.confirm('YouTube 연결을 해제하면 Google OAuth 권한과 AruBot에 저장된 YouTube 연결 데이터가 삭제됩니다. YouTube에 있는 채널, 영상, 채팅 원본은 삭제되지 않습니다. 계속할까요?')) return;
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

  const confirmYoutubeConsent = async () => {
    if (!window.confirm('현재 동의한 범위와 목적에 따라 AruBot이 YouTube 권한을 계속 보관하고 사용하는 것에 동의하시겠습니까?')) return;
    setBusyAccount('youtube:consent');
    try {
      const response = await fetch(apiUrl('/api/auth/youtube/consent/confirm'), {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'consent confirmation failed');
      setYoutubeAuthorization(data?.authorization || null);
      toast.success('YouTube 권한 유지 동의를 확인했습니다.');
      refresh();
    } catch {
      toast.error('YouTube 권한을 확인하지 못했습니다. 다시 연결해 주세요.');
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
  const youtubeAccount = grouped.youtube[0] || (youtubeAuthorization ? { provider: 'youtube', channel_name: 'YouTube' } : null);
  const youtubeLoginHref = apiUrl(`/api/auth/youtube/login?returnTo=${encodeURIComponent('/connection?platform=youtube')}`);

  useEffect(() => {
    if (openedYoutubeParamRef.current) return;
    if (searchParams.get('platform') !== 'youtube') return;
    if (!youtubeStreamerStatus) return;
    openedYoutubeParamRef.current = true;
    if (!youtubeRegistered && youtubeBotConfigured) setShowYoutubeModal(true);
  }, [searchParams, youtubeBotConfigured, youtubeRegistered, youtubeStreamerStatus]);

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
      if (!response.ok) {
        console.warn('[YouTube] Moderator confirmation failed', data?.verification || data);
        throw new Error(formatYoutubeModeratorError(data?.verification, data?.error || '운영자 등록 완료 확인에 실패했습니다.'));
      }
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
      <section className="border-b pb-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(24%,0.34fr)] lg:items-end">
          <PageHeader className="border-0 pb-0" eyebrow="Accounts" title="플랫폼 연결" description="CHZZK, CIME, YouTube 채널의 연결 상태와 권한을 관리합니다." />
          <Card>
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
                      아직 연결된 {config.label} 채널이 없습니다. 로그인하면 이 플랫폼 시청자도 참여할 수 있습니다.
                    </div>
                  )}
                </div>
                {config.id === 'youtube' && youtubeAuthorization ? (
                  <div className="mt-4 grid gap-3 rounded-[var(--radius-control)] border border-rose-200/70 bg-rose-50/55 p-4 text-sm dark:border-rose-500/20 dark:bg-rose-500/10">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold">YouTube 권한 보관</div>
                      <Badge tone="mint">활성 동의</Badge>
                    </div>
                    <div className="grid gap-2 text-xs leading-5 text-muted-foreground sm:grid-cols-2">
                      <div><span className="font-semibold text-foreground">권한 범위</span><br />{formatYoutubeScope(youtubeAuthorization.scope)}</div>
                      <div><span className="font-semibold text-foreground">최근 동의 확인</span><br />{formatAuthorizationDate(youtubeAuthorization.consentConfirmedAt)}</div>
                      <div><span className="font-semibold text-foreground">최근 권한 검증</span><br />{formatAuthorizationDate(youtubeAuthorization.lastValidatedAt)}</div>
                      <div><span className="font-semibold text-foreground">다음 검증 기한</span><br />{formatAuthorizationDate(youtubeAuthorization.nextValidationAt)}</div>
                      <div><span className="font-semibold text-foreground">미사용 자동 철회</span><br />{formatAuthorizationDate(youtubeAuthorization.inactivityRevocationAt)}</div>
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      활성 동의가 유지되는 동안만 암호화된 OAuth 토큰을 보관합니다. 권한은 {youtubeAuthorization.validationIntervalDays || 29}일 이내 주기로 재검증하며, {youtubeAuthorization.inactivityDays || 180}일 동안 사용 또는 동의 확인이 없으면 자동으로 철회하고 관련 YouTube 연결 데이터를 삭제합니다.
                    </p>
                    <p className="text-xs leading-5 text-muted-foreground">
                      연결 해제는 Google 권한과 AruBot 저장 데이터만 제거하며 YouTube의 채널, 영상, 채팅 원본은 삭제하지 않습니다.
                    </p>
                    <div>
                      <Button type="button" variant="outline" size="sm" onClick={confirmYoutubeConsent} disabled={busyAccount === 'youtube:consent'}>
                        <ShieldCheck className="h-4 w-4" />
                        {busyAccount === 'youtube:consent' ? '확인 중' : '권한 유지 확인'}
                      </Button>
                    </div>
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  {config.id === 'youtube' ? (
                    <>
                      <Button asChild variant={youtubeRegistered ? 'secondary' : 'default'}>
                        <a href={youtubeLoginHref}>
                          <img
                            src={config.iconPath}
                            alt=""
                            aria-hidden="true"
                            className="h-5 w-auto shrink-0 object-contain"
                            draggable={false}
                          />
                          {youtubeRegistered ? 'YouTube 다시 연결' : 'YouTube로 시작'}
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                      {youtubeBotConfigured ? (
                        <Button type="button" variant="outline" onClick={() => setShowYoutubeModal(true)}>
                          <Cable className="h-4 w-4" />
                          {youtubeRegistered ? '채널 수동 등록' : '채널 직접 등록'}
                        </Button>
                      ) : null}
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
                      {youtubeAuthorization && youtubeAccount ? (
                        <Button type="button" variant="destructive" onClick={() => revoke('youtube', youtubeAccount)} disabled={busyAccount?.startsWith('youtube:')}>
                          <Unlink className="h-4 w-4" />
                          OAuth 연결 해제
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
              시청자는 익숙한 플랫폼에서 들어오고, 방송에서는 명령어와 포인트, 룰렛, 후원 반응을 함께 관리합니다.
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
                등록 버튼을 누르면 새 탭에서 YouTube Studio가 열립니다.
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
