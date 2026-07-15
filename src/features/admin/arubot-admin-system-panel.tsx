'use client';

import { useState } from 'react';
import {
  Bot,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  Gauge,
  HardDrive,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Trash2,
  Wifi,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SectionHeader, StatusDot } from '@/components/ui/page';
import { cn } from '@/shared/lib/utils';
import type { AdminConsoleSnapshot, AdminStatus, YoutubeBotStatus } from '@/features/admin/arubot-admin-types';

const dateTimeFormatter = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });

function formatDateTime(value?: string | null) {
  if (!value) return '기록 없음';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dateTimeFormatter.format(date) : '기록 없음';
}

function formatDuration(seconds?: number) {
  const total = Math.max(0, Number(seconds || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days}일 ${hours}시간`;
  if (hours) return `${hours}시간 ${minutes}분`;
  return `${minutes}분`;
}

function formatYoutubeScope(value?: string | null) {
  const scope = String(value || '');
  if (scope.includes('youtube.force-ssl')) return '라이브 채팅 관리';
  if (scope.includes('youtube.readonly')) return 'YouTube 채널 읽기';
  return 'Google 동의 화면에서 승인한 범위';
}

function SystemMetric({
  icon: Icon,
  label,
  value,
  detail,
  healthy = true,
}: {
  icon: typeof Database;
  label: string;
  value: string;
  detail: string;
  healthy?: boolean;
}) {
  return (
    <div className="min-w-0 border-b px-4 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Icon className="h-4 w-4" aria-hidden="true" />{label}</div>
      <div className="mt-2 flex items-center gap-2"><span className="truncate text-lg font-bold tracking-tight">{value}</span><span className={cn('h-2 w-2 shrink-0 rounded-full', healthy ? 'bg-emerald-500' : 'bg-amber-500')} aria-hidden="true" /></div>
      <p className="mt-1 truncate text-[0.6875rem] text-muted-foreground">{detail}</p>
    </div>
  );
}

export function ArubotAdminSystemPanel({
  adminStatus,
  youtubeBotStatus,
  youtubeError,
  system,
  endpoints,
  authorizationHeading,
  onChanged,
  onCopy,
}: {
  adminStatus: AdminStatus | null;
  youtubeBotStatus: YoutubeBotStatus | null;
  youtubeError?: string | null;
  system: AdminConsoleSnapshot['system'] | null;
  endpoints: {
    login: string;
    selectChannel: string;
    verify: string;
    confirmConsent: string;
    delete: string;
  };
  authorizationHeading: string;
  onChanged: () => Promise<void> | void;
  onCopy: (value: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const profile = youtubeBotStatus?.profile || null;
  const configured = youtubeBotStatus?.configured === true;
  const reauthRequired = profile?.reauthRequired === true || profile?.status === 'reauth_required';
  const healthy = configured && !reauthRequired;
  const botChannelUrl = profile?.selectedChannelId ? `https://www.youtube.com/channel/${profile.selectedChannelId}` : null;

  const runAction = async (key: string, request: () => Promise<Response>, successMessage: string, failureMessage: string) => {
    setBusy(key);
    try {
      const response = await request();
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || 'request_failed');
      toast.success(successMessage);
    } catch {
      toast.error(failureMessage);
    } finally {
      try { await onChanged(); } catch { /* The action result toast remains authoritative; the stale banner handles refresh failures. */ }
      setBusy(null);
    }
  };

  const selectYoutubeBotChannel = (channelId?: string) => {
    if (!channelId) return;
    return runAction(
      `select:${channelId}`,
      () => fetch(endpoints.selectChannel, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelId }) }),
      'YouTube 중앙 봇 채널을 선택했습니다.',
      'YouTube 봇 채널을 선택하지 못했습니다.',
    );
  };

  const verifyYoutubeBot = () => runAction(
    'verify',
    () => fetch(endpoints.verify, { method: 'POST', credentials: 'include' }),
    'YouTube 중앙 봇 연결을 확인했습니다.',
    'YouTube 중앙 봇 연결 확인에 실패했습니다.',
  );

  const confirmYoutubeBotConsent = () => {
    if (!window.confirm('현재 승인 범위와 목적에 따라 중앙 봇의 YouTube 권한을 계속 보관하고 사용할까요?')) return;
    return runAction(
      'consent',
      () => fetch(endpoints.confirmConsent, { method: 'POST', credentials: 'include' }),
      'YouTube 중앙 봇 권한 유지 동의를 확인했습니다.',
      'YouTube 중앙 봇 권한을 확인하지 못했습니다. 다시 연결해 주세요.',
    );
  };

  const deleteYoutubeBot = () => {
    const confirmation = window.prompt('모든 스트리머의 YouTube 봇 응답이 중단됩니다. 계속하려면 “연결 해제”를 입력해 주세요.');
    if (confirmation !== '연결 해제') {
      if (confirmation !== null) toast.error('확인 문구가 일치하지 않아 연결을 유지합니다.');
      return;
    }
    return runAction(
      'delete',
      () => fetch(endpoints.delete, { method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: '연결 해제' }) }),
      'YouTube 중앙 봇 연결을 해제했습니다.',
      'YouTube 중앙 봇 연결 해제에 실패했습니다.',
    );
  };

  const runtimeTotal = Object.entries(system?.runtime || {})
    .filter(([key]) => key !== 'leases')
    .reduce((sum, [, value]) => sum + Number(value || 0), 0);

  return (
    <div className="grid gap-6">
      <section aria-labelledby="system-status-heading">
        <SectionHeader title={<span id="system-status-heading">서비스 상태</span>} description="현재 API 프로세스와 PostgreSQL 연결을 실제 상태값으로 확인합니다." />
        <div className="mt-4 overflow-hidden rounded-[var(--radius-card)] border bg-card shadow-subtle sm:grid sm:grid-cols-2 xl:grid-cols-4">
          <SystemMetric icon={ServerCog} label="API 준비 상태" value={system?.readiness?.ready ? '정상' : '점검 필요'} detail={`가동 ${formatDuration(system?.uptimeSec)}`} healthy={system?.readiness?.ready === true} />
          <SystemMetric icon={Database} label="PostgreSQL" value={system?.database?.ok ? '연결됨' : '연결 오류'} detail={`응답 ${system?.database?.latencyMs || 0}ms`} healthy={system?.database?.ok === true} />
          <SystemMetric icon={Wifi} label="채팅 런타임" value={`${runtimeTotal}개 연결`} detail={`활성 lease ${system?.runtime?.leases || 0}개`} healthy={system?.readiness?.initialBootstrapCompleted === true} />
          <SystemMetric icon={HardDrive} label="프로세스 메모리" value={`${system?.memory?.rssMb || 0}MB`} detail={`heap ${system?.memory?.heapUsedMb || 0}/${system?.memory?.heapTotalMb || 0}MB`} />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(19rem,0.55fr)]" aria-labelledby="youtube-central-bot-heading">
        <div className="grid min-w-0 gap-3">
          {youtubeError ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200" role="alert">
              <span>{youtubeError}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => onChanged()}><RefreshCw className="h-4 w-4" />다시 확인</Button>
            </div>
          ) : null}
          <Card className="overflow-hidden border-rose-200/70 bg-rose-50/55 dark:border-rose-500/20 dark:bg-rose-500/10">
          <CardHeader className="border-b border-rose-200/70 dark:border-rose-500/20">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <Badge tone={healthy ? 'mint' : configured ? 'amber' : 'neutral'}>YouTube 중앙 봇</Badge>
                <CardTitle className="mt-3 flex items-center gap-2"><Bot className="h-5 w-5 text-rose-500" /><span id="youtube-central-bot-heading">채팅 응답 계정</span></CardTitle>
                <CardDescription>모든 중앙 봇 모드 YouTube 채팅 응답은 여기에서 선택한 채널로 전송됩니다.</CardDescription>
              </div>
              <Badge tone={healthy ? 'mint' : configured ? 'amber' : 'neutral'}>{healthy ? '정상' : configured ? '재확인 필요' : '설정 필요'}</Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-5">
            {profile?.selectedChannelId ? (
              <div className="flex min-w-0 items-center gap-3 rounded-[var(--radius-control)] border bg-background/85 p-3">
                {profile.selectedChannelThumbnailUrl ? <img src={profile.selectedChannelThumbnailUrl} alt="" className="h-12 w-12 rounded-lg object-cover" referrerPolicy="no-referrer" /> : null}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{profile.selectedChannelTitle || 'YouTube 봇 채널'}</div>
                  <div className="truncate text-xs text-muted-foreground">{profile.selectedChannelHandle || profile.selectedChannelId}</div>
                  {profile.lastError ? <div className="mt-1 text-xs text-destructive">{profile.lastError}</div> : null}
                </div>
                <StatusDot status={healthy ? 'success' : 'warning'} label={healthy ? '사용 가능' : '재연결 필요'} />
              </div>
            ) : (
              <div className="rounded-[var(--radius-control)] border border-dashed bg-background/75 p-4 text-sm leading-6 text-muted-foreground">중앙 봇 채널이 아직 설정되지 않았습니다. 이 상태에서는 YouTube 중앙 봇 응답이 전송되지 않습니다.</div>
            )}

            {profile ? (
              <div className="mt-4 grid gap-3 rounded-[var(--radius-control)] border border-rose-200/70 bg-background/75 p-4 text-sm dark:border-rose-500/20">
                <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold">{authorizationHeading}</div><Badge tone={healthy ? 'mint' : 'amber'}>{healthy ? '활성 동의' : '확인 필요'}</Badge></div>
                <dl className="grid gap-3 text-xs leading-5 text-muted-foreground sm:grid-cols-2">
                  <div><dt className="font-semibold text-foreground">권한 범위</dt><dd>{formatYoutubeScope(profile.scope)}</dd></div>
                  <div><dt className="font-semibold text-foreground">최근 동의 확인</dt><dd>{formatDateTime(profile.consentConfirmedAt)}</dd></div>
                  <div><dt className="font-semibold text-foreground">최근 권한 검증</dt><dd>{formatDateTime(profile.lastVerifiedAt)}</dd></div>
                  <div><dt className="font-semibold text-foreground">다음 검증 기한</dt><dd>{formatDateTime(profile.nextValidationAt)}</dd></div>
                  <div><dt className="font-semibold text-foreground">미사용 자동 철회</dt><dd>{formatDateTime(profile.inactivityRevocationAt)}</dd></div>
                </dl>
                <p className="text-xs leading-5 text-muted-foreground">활성 동의가 유지되는 동안만 암호화된 OAuth 토큰을 보관합니다. {profile.validationIntervalDays || 29}일 이내 주기로 재검증하며, {profile.inactivityDays || 180}일 동안 사용 또는 동의 확인이 없으면 권한과 연결 데이터를 자동 삭제합니다.</p>
              </div>
            ) : null}

            {youtubeBotStatus?.pending?.channels?.length ? (
              <div className="mt-4 grid gap-2">
                <div className="text-sm font-semibold">봇으로 사용할 채널 선택</div>
                {youtubeBotStatus.pending.channels.map((channel) => (
                  <button key={channel.channelId} type="button" onClick={() => selectYoutubeBotChannel(channel.channelId)} disabled={!!busy} className="flex min-w-0 items-center gap-3 rounded-[var(--radius-control)] border bg-background/80 p-3 text-left transition hover:border-primary/40 disabled:opacity-60">
                    {channel.channelImageUrl ? <img src={channel.channelImageUrl} alt="" className="h-10 w-10 rounded-lg object-cover" referrerPolicy="no-referrer" /> : null}
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold">{channel.channelName || channel.channelId}</span><span className="block truncate text-xs text-muted-foreground">{channel.channelHandle || channel.channelId}</span></span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild variant={configured ? 'outline' : 'default'}><a href={endpoints.login}><ShieldCheck className="h-4 w-4" />{configured ? '봇 채널 재연결' : '중앙 봇 채널 설정'}<ExternalLink className="h-4 w-4" /></a></Button>
              {configured ? <Button type="button" variant="outline" onClick={verifyYoutubeBot} disabled={!!busy}><RefreshCw className={cn('h-4 w-4', busy === 'verify' && 'animate-spin')} />연결 확인</Button> : null}
              {configured ? <Button type="button" variant="outline" onClick={confirmYoutubeBotConsent} disabled={!!busy}><ShieldCheck className="h-4 w-4" />권한 유지 확인</Button> : null}
              {botChannelUrl ? <Button type="button" variant="outline" onClick={() => onCopy(botChannelUrl)}><Copy className="h-4 w-4" />봇 채널 URL 복사</Button> : null}
            </div>

            {configured ? (
              <div className="mt-6 border-t border-rose-200/70 pt-5 dark:border-rose-500/20">
                <div className="text-xs font-semibold text-destructive">위험 작업</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">연결 해제 시 Google 권한과 저장된 중앙 봇 연결 데이터가 삭제되고 모든 스트리머의 YouTube 봇 응답이 중단됩니다.</p>
                <Button type="button" variant="destructive" size="sm" className="mt-3" onClick={deleteYoutubeBot} disabled={!!busy}><Trash2 className="h-4 w-4" />중앙 봇 연결 해제</Button>
              </div>
            ) : null}
          </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-primary" />현재 관리자</CardTitle><CardDescription>이 세션의 서비스 관리자 권한입니다.</CardDescription></CardHeader>
            <CardContent><div className="rounded-[var(--radius-control)] border bg-background/70 p-3 text-sm"><div className="font-semibold">{adminStatus?.displayName || adminStatus?.userId || '관리자'}</div><div className="mt-1 break-all text-xs text-muted-foreground">{adminStatus?.userId || '사용자 ID 없음'}</div><div className="mt-3"><StatusDot status="success" label="app_users.is_admin = true" /></div></div></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Gauge className="h-5 w-5 text-primary" />호환성 고정</CardTitle><CardDescription>플랫폼 연결에 필요한 핵심 런타임 규격입니다.</CardDescription></CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border bg-background/70 p-3"><span>CHZZK 채팅 전송</span><Badge tone="sky">{system?.chzzkTransport?.protocol || 'Socket.IO 2.x'}</Badge></div>
              <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border bg-background/70 p-3"><span>클라이언트 버전</span><span className="font-mono text-xs font-semibold">{system?.chzzkTransport?.clientVersion || '2.0.3'}</span></div>
              <p className="text-xs leading-5 text-muted-foreground">CHZZK API 호환성을 위해 Socket.IO 2.x와 클라이언트 2.0.3은 업그레이드 대상에서 제외하고 고정합니다.</p>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
