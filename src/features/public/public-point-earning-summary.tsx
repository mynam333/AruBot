import { CalendarCheck2, Gift, MessageCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatNumber } from '@/shared/lib/utils';

export type PublicPointEarningPolicy = {
  chatPointsPerMessage?: number;
  attendancePoints?: number;
  attendanceEnabled?: boolean;
  attendanceOperational?: boolean;
  attendanceMode?: 'first_chat' | 'command' | 'disabled';
  attendanceUnavailableReason?: 'bot_disabled' | string | null;
  attendanceCommandKeyword?: string | null;
  donationPointsPer1000Won?: number;
  donationRounding?: 'floor_total' | string;
};

function normalizePointRate(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function pointRewardLabel(value: unknown) {
  const points = normalizePointRate(value);
  return points > 0 ? `+${formatNumber(points)}P` : '0P';
}

export function PublicPointEarningSummary({ policy }: { policy?: PublicPointEarningPolicy | null }) {
  if (!policy) return null;

  const chatPoints = normalizePointRate(policy.chatPointsPerMessage);
  const attendancePoints = normalizePointRate(policy.attendancePoints);
  const donationPoints = normalizePointRate(policy.donationPointsPer1000Won);
  const attendanceEnabled = policy.attendanceEnabled !== false && policy.attendanceMode !== 'disabled';
  const attendanceOperational = attendanceEnabled && policy.attendanceOperational !== false;
  const attendanceDetail = !attendanceEnabled
    ? `설정값 ${formatNumber(attendancePoints)}P`
    : !attendanceOperational && policy.attendanceUnavailableReason === 'bot_disabled'
      ? `봇이 꺼져 있어 명령어 출석 일시 중지 · 설정값 ${formatNumber(attendancePoints)}P`
      : policy.attendanceMode === 'command'
        ? `방송 중 · 하루 한 번 · ${policy.attendanceCommandKeyword || '출석 명령어'} 입력`
        : '방송 중 · 하루 한 번 · 첫 채팅 자동 출석';

  return (
    <Card aria-label="포인트 적립 기준" className="overflow-hidden bg-card/90">
      <CardHeader className="border-b bg-muted/20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>포인트 적립 기준</CardTitle>
            <CardDescription>이 스트리머가 설정한 포인트 지급 기준입니다.</CardDescription>
          </div>
          <Badge tone="mint">스트리머 설정</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-[clamp(1rem,2.2vw,1.5rem)]">
        <dl className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[var(--radius-control)] border bg-background/70 p-4">
              <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-pastel-sky/75 text-sky-700 dark:text-sky-100">
                  <MessageCircle aria-hidden="true" className="h-4 w-4" />
                </span>
                방송 중 채팅 1회
              </dt>
              <dd className="mt-3 text-xl font-semibold tabular-nums">{pointRewardLabel(chatPoints)}</dd>
              <dd className="mt-1 text-xs leading-5 text-muted-foreground">일반·명령어 채팅 기준</dd>
            </div>
            <div className="rounded-[var(--radius-control)] border bg-background/70 p-4">
              <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-pastel-mint/75 text-emerald-700 dark:text-emerald-100">
                  <CalendarCheck2 aria-hidden="true" className="h-4 w-4" />
                </span>
                출석 완료 1회
              </dt>
              <dd className="mt-3 text-xl font-semibold tabular-nums">
                {!attendanceEnabled ? '사용 안 함' : attendanceOperational ? pointRewardLabel(attendancePoints) : '일시 중지'}
              </dd>
              <dd className="mt-1 break-words text-xs leading-5 text-muted-foreground">{attendanceDetail}</dd>
            </div>
            <div className="rounded-[var(--radius-control)] border bg-background/70 p-4">
              <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-pastel-lemon/80 text-amber-700 dark:text-amber-100">
                  <Gift aria-hidden="true" className="h-4 w-4" />
                </span>
                후원 1,000원 기준
              </dt>
              <dd className="mt-3 text-xl font-semibold tabular-nums">{pointRewardLabel(donationPoints)}</dd>
              <dd className="mt-1 text-xs leading-5 text-muted-foreground">후원 금액에 비례해 계산한 뒤 소수점 내림</dd>
            </div>
        </dl>
      </CardContent>
    </Card>
  );
}
