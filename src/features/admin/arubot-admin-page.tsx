'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Bot, CheckCircle2, Copy, ExternalLink, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiUrl, readJson } from '@/shared/api/http';

type AdminStatus = {
  userId?: string | null;
  isAdmin?: boolean;
  displayName?: string | null;
};

type YoutubePendingChannel = {
  channelId?: string;
  channelName?: string | null;
  channelHandle?: string | null;
  channelImageUrl?: string | null;
};

type YoutubeBotStatus = {
  configured?: boolean;
  profile?: {
    selectedChannelId?: string | null;
    selectedChannelTitle?: string | null;
    selectedChannelHandle?: string | null;
    selectedChannelThumbnailUrl?: string | null;
    status?: string | null;
    scope?: string | null;
    consentGrantedAt?: string | null;
    consentConfirmedAt?: string | null;
    lastUsedAt?: string | null;
    lastActivityAt?: string | null;
    validationIntervalDays?: number;
    inactivityDays?: number;
    lastVerifiedAt?: string | null;
    nextValidationAt?: string | null;
    inactivityRevocationAt?: string | null;
    lastError?: string | null;
    updatedAt?: string | null;
  } | null;
  pending?: {
    channels?: YoutubePendingChannel[];
    expiresAt?: string;
  } | null;
};

const authorizationDateFormatter = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });

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

export function ArubotAdminPage() {
  const searchParams = useSearchParams();
  const [adminStatus, setAdminStatus] = useState<AdminStatus | null>(null);
  const [youtubeBotStatus, setYoutubeBotStatus] = useState<YoutubeBotStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const controller = new AbortController();
    let alive = true;
    setLoading(true);
    Promise.all([
      readJson<AdminStatus>('/api/arubot-admin/me', { signal: controller.signal }),
      readJson<YoutubeBotStatus>('/api/youtube/bot/status', { signal: controller.signal }),
    ]).then(([admin, bot]) => {
      if (!alive) return;
      setAdminStatus(admin);
      setYoutubeBotStatus(bot);
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
    const reason = searchParams.get('reason');
    if (auth === 'error' && reason === 'admin_required') toast.error('AruBot 관리자 권한이 필요합니다.');
    if (reason === 'central_bot_select_channel') toast.info('YouTube 봇으로 사용할 채널을 선택해 주세요.');
    if (reason === 'central_bot_configured') toast.success('YouTube 중앙 봇 채널을 설정했습니다.');
  }, [searchParams]);

  const copyText = async (value?: string | null) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success('복사했습니다.');
    } catch {
      toast.error('복사하지 못했습니다.');
    }
  };

  const selectYoutubeBotChannel = async (channelId?: string) => {
    if (!channelId) return;
    setBusy(`select:${channelId}`);
    try {
      const response = await fetch(apiUrl('/api/youtube/bot/select-channel'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'bot select failed');
      toast.success('YouTube 중앙 봇 채널을 선택했습니다.');
      refresh();
    } catch {
      toast.error('YouTube 봇 채널을 선택하지 못했습니다.');
    } finally {
      setBusy(null);
    }
  };

  const verifyYoutubeBot = async () => {
    setBusy('verify');
    try {
      const response = await fetch(apiUrl('/api/youtube/bot/verify'), {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'verify failed');
      toast.success('YouTube 중앙 봇 연결을 확인했습니다.');
      refresh();
    } catch {
      toast.error('YouTube 중앙 봇 연결 확인에 실패했습니다.');
    } finally {
      setBusy(null);
    }
  };

  const confirmYoutubeBotConsent = async () => {
    if (!window.confirm('현재 동의한 범위와 목적에 따라 AruBot이 중앙 봇의 YouTube 권한을 계속 보관하고 사용하는 것에 동의하시겠습니까?')) return;
    setBusy('consent');
    try {
      const response = await fetch(apiUrl('/api/youtube/bot/consent/confirm'), {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'consent confirmation failed');
      toast.success('YouTube 중앙 봇 권한 유지 동의를 확인했습니다.');
      refresh();
    } catch {
      toast.error('YouTube 중앙 봇 권한을 확인하지 못했습니다. 다시 연결해 주세요.');
    } finally {
      setBusy(null);
    }
  };

  const deleteYoutubeBot = async () => {
    if (!window.confirm('YouTube 중앙 봇 연결을 해제하면 Google OAuth 권한과 AruBot에 저장된 봇 연결 데이터가 삭제되고 모든 스트리머의 YouTube 봇 동작이 중단됩니다. YouTube 원본 콘텐츠는 삭제되지 않습니다. 계속할까요?')) return;
    setBusy('delete');
    try {
      const response = await fetch(apiUrl('/api/youtube/bot'), {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('delete failed');
      toast.success('YouTube 중앙 봇 연결을 해제했습니다.');
      refresh();
    } catch {
      toast.error('YouTube 중앙 봇 연결 해제에 실패했습니다.');
    } finally {
      setBusy(null);
    }
  };

  if (!loading && adminStatus?.isAdmin !== true) {
    return (
      <section className="rounded-[var(--radius-panel)] border bg-card p-[clamp(1.25rem,3vw,2rem)] shadow-soft">
        <Badge tone="amber">접근 제한</Badge>
        <h1 className="mt-4 text-3xl font-semibold">AruBot 관리자 권한이 필요합니다</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          관리자 권한이 있는 사용자만 사용할 수 있습니다.
        </p>
      </section>
    );
  }

  const profile = youtubeBotStatus?.profile || null;
  const configured = youtubeBotStatus?.configured === true;
  const botChannelUrl = profile?.selectedChannelId ? `https://www.youtube.com/channel/${profile.selectedChannelId}` : null;

  return (
    <>
      <section className="border-b pb-5">
        <Badge tone="sky">AruBot 관리자</Badge>
        <h1 className="mt-3 max-w-3xl break-keep text-2xl font-bold leading-tight tracking-tight md:text-3xl">
          서비스 전체 봇 운영을 한곳에서 관리합니다.
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
          중앙 봇 계정, 전역 연결 상태, 운영 진단처럼 개별 스트리머 설정이 아닌 AruBot 서비스 설정을 관리합니다.
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.42fr)]">
        <Card className="overflow-hidden border-rose-200/70 bg-rose-50/60 dark:border-rose-500/20 dark:bg-rose-500/10">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <Badge tone={configured ? 'mint' : 'amber'}>YouTube 중앙 봇</Badge>
                <CardTitle className="mt-3 flex items-center gap-2">
                  <Bot className="h-5 w-5 text-rose-500" />
                  채팅 응답 계정
                </CardTitle>
                <CardDescription>모든 중앙 봇 모드 YouTube 채팅 응답은 여기에서 선택한 채널로 전송됩니다.</CardDescription>
              </div>
              <Badge tone={configured ? 'mint' : 'amber'}>{configured ? '설정됨' : '설정 필요'}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {profile?.selectedChannelId ? (
              <div className="flex min-w-0 items-center gap-3 rounded-[var(--radius-control)] border bg-background/80 p-3">
                {profile.selectedChannelThumbnailUrl ? (
                  <img src={profile.selectedChannelThumbnailUrl} alt="" className="h-12 w-12 rounded-[var(--radius-control)] object-cover" referrerPolicy="no-referrer" />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{profile.selectedChannelTitle || 'YouTube 봇 채널'}</div>
                  <div className="truncate text-xs text-muted-foreground">{profile.selectedChannelHandle || profile.selectedChannelId}</div>
                  {profile.lastError ? <div className="mt-1 text-xs text-destructive">{profile.lastError}</div> : null}
                </div>
              </div>
            ) : (
              <div className="rounded-[var(--radius-control)] border bg-background/80 p-4 text-sm leading-6 text-muted-foreground">
                중앙 봇 채널이 아직 설정되지 않았습니다. 이 상태에서는 어떤 스트리머의 YouTube 중앙 봇도 동작하지 않습니다.
              </div>
            )}

            {profile ? (
              <div className="mt-4 grid gap-3 rounded-[var(--radius-control)] border border-rose-200/70 bg-background/75 p-4 text-sm dark:border-rose-500/20">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold">중앙 봇 OAuth 권한 보관</div>
                  <Badge tone="mint">활성 동의</Badge>
                </div>
                <div className="grid gap-2 text-xs leading-5 text-muted-foreground sm:grid-cols-2">
                  <div><span className="font-semibold text-foreground">권한 범위</span><br />{formatYoutubeScope(profile.scope)}</div>
                  <div><span className="font-semibold text-foreground">최근 동의 확인</span><br />{formatAuthorizationDate(profile.consentConfirmedAt)}</div>
                  <div><span className="font-semibold text-foreground">최근 권한 검증</span><br />{formatAuthorizationDate(profile.lastVerifiedAt)}</div>
                  <div><span className="font-semibold text-foreground">다음 검증 기한</span><br />{formatAuthorizationDate(profile.nextValidationAt)}</div>
                  <div><span className="font-semibold text-foreground">미사용 자동 철회</span><br />{formatAuthorizationDate(profile.inactivityRevocationAt)}</div>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  활성 동의가 유지되는 동안만 암호화된 OAuth 토큰을 보관합니다. {profile.validationIntervalDays || 29}일 이내 주기로 재검증하며, {profile.inactivityDays || 180}일 동안 실제 사용 또는 동의 확인이 없으면 Google 권한과 관련 AruBot 연결 데이터를 자동 삭제합니다.
                </p>
                <p className="text-xs leading-5 text-muted-foreground">
                  연결 해제는 Google 권한과 AruBot 저장 데이터만 제거하며 YouTube 채널, 영상, 채팅 원본은 삭제하지 않습니다.
                </p>
              </div>
            ) : null}

            {youtubeBotStatus?.pending?.channels?.length ? (
              <div className="mt-4 grid gap-2">
                <div className="text-sm font-semibold">봇으로 사용할 채널 선택</div>
                {youtubeBotStatus.pending.channels.map((channel) => (
                  <button
                    key={channel.channelId}
                    type="button"
                    onClick={() => selectYoutubeBotChannel(channel.channelId)}
                    disabled={!!busy}
                    className="flex min-w-0 items-center gap-3 rounded-[var(--radius-control)] border bg-background/80 p-3 text-left transition hover:border-primary/40"
                  >
                    {channel.channelImageUrl ? <img src={channel.channelImageUrl} alt="" className="h-10 w-10 rounded-[var(--radius-control)] object-cover" referrerPolicy="no-referrer" /> : null}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{channel.channelName || channel.channelId}</span>
                      <span className="block truncate text-xs text-muted-foreground">{channel.channelHandle || channel.channelId}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild variant={configured ? 'outline' : 'default'}>
                <a href={apiUrl('/api/youtube/bot/login')}>
                  <ShieldCheck className="h-4 w-4" />
                  {configured ? '봇 채널 재연결' : '중앙 봇 채널 설정'}
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
              {configured ? (
                <Button type="button" variant="outline" onClick={verifyYoutubeBot} disabled={!!busy}>
                  <RefreshCw className={busy === 'verify' ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                  연결 확인
                </Button>
              ) : null}
              {configured ? (
                <Button type="button" variant="outline" onClick={confirmYoutubeBotConsent} disabled={!!busy}>
                  <ShieldCheck className="h-4 w-4" />
                  {busy === 'consent' ? '확인 중' : '권한 유지 확인'}
                </Button>
              ) : null}
              {botChannelUrl ? (
                <Button type="button" variant="outline" onClick={() => copyText(botChannelUrl)}>
                  <Copy className="h-4 w-4" />
                  봇 채널 URL 복사
                </Button>
              ) : null}
              {configured ? (
                <Button type="button" variant="destructive" onClick={deleteYoutubeBot} disabled={!!busy}>
                  <Trash2 className="h-4 w-4" />
                  연결 해제
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              관리자 권한
            </CardTitle>
            <CardDescription>관리자 권한이 있는 계정을 확인합니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-[var(--radius-control)] border bg-background/80 p-3 text-sm leading-6">
              <div className="font-semibold">{adminStatus?.displayName || adminStatus?.userId || '관리자'}</div>
              <div className="mt-1 break-all text-xs text-muted-foreground">
                `app_users.is_admin = true`
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
