'use client';

import { BarChart3, CheckCircle2, Copy, Lock, RotateCcw, Send, Trophy, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiUrl, readJson } from '@/shared/api/http';

type PredictionOption = {
  id: string;
  label: string;
  total: number;
  count: number;
  percentage: number;
  payoutMultiplier: number | null;
  payoutPer100: number | null;
};

type PredictionBet = {
  id: string;
  userId: string;
  username: string | null;
  optionId: string;
  amount: number;
  payout: number;
  refunded: boolean;
  createdAt: string;
};

type Prediction = {
  id: string;
  channelUid: string;
  question: string;
  status: 'open' | 'locked' | 'settled' | 'cancelled';
  minBet: number;
  maxBet: number;
  options: PredictionOption[];
  winningOptionId: string | null;
  totalPoints: number;
  participantCount: number;
  createdAt: string;
  closesAt: string | null;
  settledAt: string | null;
  bets: PredictionBet[];
};

type PredictionsResponse = { predictions: Prediction[] };
type PredictionResponse = { prediction: Prediction | null };
type ChannelContextResponse = { channelId?: string };

function statusLabel(status?: string) {
  if (status === 'open') return '진행 중';
  if (status === 'locked') return '마감됨';
  if (status === 'settled') return '정산 완료';
  if (status === 'cancelled') return '취소됨';
  return '대기 중';
}

function statusTone(status?: string): 'mint' | 'lemon' | 'sky' | 'coral' | 'neutral' {
  if (status === 'open') return 'mint';
  if (status === 'locked') return 'lemon';
  if (status === 'settled') return 'sky';
  if (status === 'cancelled') return 'coral';
  return 'neutral';
}

function formatPoints(value: number) {
  return `${Number(value || 0).toLocaleString('ko-KR')}P`;
}

async function postJson<T>(path: string, body?: unknown): Promise<T | null> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!response.ok) return null;
  return (await response.json()) as T;
}

function OptionMeter({ option, index, selected }: { option: PredictionOption; index: number; selected?: boolean }) {
  return (
    <div className="group rounded-[var(--radius-card)] border bg-background/78 p-[clamp(0.875rem,1.6vw,1.125rem)] transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-subtle">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="grid aspect-square w-[2em] shrink-0 place-items-center rounded-[var(--radius-control)] bg-pastel-mint/75 text-sm font-bold text-teal-900 dark:bg-primary/25 dark:text-teal-50">
              {index + 1}
            </span>
            <div className="truncate text-sm font-semibold">{option.label}</div>
            {selected ? <Trophy className="h-4 w-4 shrink-0 text-amber-500" /> : null}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {option.count.toLocaleString('ko-KR')}명 참여
          </div>
        </div>
        <div className="text-right">
          <div className="text-base font-bold">{option.percentage}%</div>
          <div className="text-xs text-muted-foreground">{formatPoints(option.total)}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border bg-card/75 px-2.5 py-1 font-semibold text-muted-foreground">
          예상 배당 {option.payoutMultiplier ? `x${option.payoutMultiplier}` : '-'}
        </span>
        <span className="rounded-full border bg-card/75 px-2.5 py-1 font-semibold text-muted-foreground">
          100P당 {option.payoutPer100 ? formatPoints(option.payoutPer100) : '-'}
        </span>
      </div>
      <div className="mt-3 h-[0.72rem] overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,hsl(var(--primary)),hsl(var(--accent)))] transition-all duration-500"
          style={{ width: `${Math.max(0, Math.min(100, option.percentage))}%` }}
        />
      </div>
    </div>
  );
}

export function PredictionsPage() {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [active, setActive] = useState<Prediction | null>(null);
  const [channelUid, setChannelUid] = useState('');
  const [question, setQuestion] = useState('');
  const [optionsText, setOptionsText] = useState('');
  const [minBet, setMinBet] = useState('10');
  const [maxBet, setMaxBet] = useState('100000');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [notice, setNotice] = useState('');
  const [isPending, startTransition] = useTransition();

  const overlayUrl = useMemo(() => {
    if (!channelUid || typeof window === 'undefined') return '';
    return `${window.location.origin}/viewer/prediction/${encodeURIComponent(channelUid)}`;
  }, [channelUid]);

  const optionRows = useMemo(
    () => optionsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    [optionsText],
  );

  const load = useCallback(() => {
    startTransition(async () => {
      const [listData, activeData, contextData] = await Promise.all([
        readJson<PredictionsResponse>('/api/predictions'),
        readJson<PredictionResponse>('/api/predictions/active'),
        readJson<ChannelContextResponse>('/api/channel/context'),
      ]);
      setPredictions(listData?.predictions || []);
      setActive(activeData?.prediction || null);
      if (contextData?.channelId) setChannelUid(String(contextData.channelId));
    });
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 3500);
    return () => window.clearInterval(timer);
  }, [load]);

  const create = () => {
    if (!question.trim()) {
      setNotice('질문을 입력해 주세요.');
      return;
    }
    if (optionRows.length < 2) {
      setNotice('예측 선택지는 2개 이상 필요합니다.');
      return;
    }
    startTransition(async () => {
      const data = await postJson<PredictionResponse>('/api/predictions/create', {
        question,
        options: optionRows,
        minBet: Number(minBet || 1),
        maxBet: Number(maxBet || 100000),
        durationMinutes: durationMinutes ? Number(durationMinutes) : null,
      });
      if (!data?.prediction) {
        setNotice('예측을 열지 못했습니다. 채널 연결과 포인트 설정을 확인해 주세요.');
        return;
      }
      setQuestion('');
      setOptionsText('');
      setNotice('예측 베팅을 열었습니다.');
      load();
    });
  };

  const action = (path: string, body?: unknown, message = '반영했습니다.') => {
    startTransition(async () => {
      const data = await postJson<PredictionResponse>(path, body);
      if (!data?.prediction) {
        setNotice('요청을 처리하지 못했습니다.');
        return;
      }
      setNotice(message);
      load();
    });
  };

  const copyOverlay = async () => {
    if (!overlayUrl) return;
    await navigator.clipboard?.writeText(overlayUrl).catch(() => undefined);
    setNotice('OBS 오버레이 주소를 복사했습니다.');
  };

  const latest = active || predictions[0] || null;
  const winner = latest?.options.find((option) => option.id === latest.winningOptionId);

  return (
    <div className="grid gap-[clamp(1rem,2vw,1.5rem)]">
      <section className="relative overflow-hidden rounded-[var(--radius-panel)] border bg-[radial-gradient(circle_at_10%_10%,hsl(var(--accent-mint)/0.72),transparent_34%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent-sky)/0.28))] p-[clamp(1.25rem,2.8vw,2rem)] shadow-subtle">
        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
          <div>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-primary/12 text-primary">
                <BarChart3 className="h-5 w-5" />
              </span>
              <Badge tone="mint">시청자 예측</Badge>
              <Badge tone={statusTone(active?.status)}>{statusLabel(active?.status)}</Badge>
            </div>
            <h1 className="text-3xl font-semibold leading-tight md:text-4xl">예측 베팅</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
              방송의 다음 순간을 시청자가 포인트로 예측하게 열고, 채팅 명령어와 OBS 오버레이로 참여 흐름을 자연스럽게 보여줘요.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-[var(--radius-card)] border bg-card/78 p-4 text-center">
              <div className="text-xl font-bold">{formatPoints(latest?.totalPoints || 0)}</div>
              <div className="mt-1 text-xs text-muted-foreground">총 베팅</div>
            </div>
            <div className="rounded-[var(--radius-card)] border bg-card/78 p-4 text-center">
              <div className="text-xl font-bold">{latest?.participantCount || 0}</div>
              <div className="mt-1 text-xs text-muted-foreground">참여자</div>
            </div>
            <div className="rounded-[var(--radius-card)] border bg-card/78 p-4 text-center">
              <div className="text-xl font-bold">{latest?.options.length || optionRows.length}</div>
              <div className="mt-1 text-xs text-muted-foreground">선택지</div>
            </div>
          </div>
        </div>
      </section>

      {notice ? (
        <div className="rounded-[var(--radius-card)] border bg-pastel-lemon/55 p-4 text-sm font-medium text-amber-950 dark:bg-amber-500/12 dark:text-amber-100">
          {notice}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <CardTitle>새 예측 열기</CardTitle>
            <CardDescription>선택지는 줄바꿈으로 입력해요. 최소 2개 이상이면 개수 제한 없이 사용할 수 있어요.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <label className="grid gap-2 text-sm font-semibold">
              질문
              <Input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="예: 다음 판 결과는?" />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              선택지
              <textarea
                value={optionsText}
                onChange={(event) => setOptionsText(event.target.value)}
                placeholder="선택지를 한 줄에 하나씩 입력"
                className="min-h-[12rem] resize-y rounded-[var(--radius-control)] border bg-background/80 p-[clamp(0.75rem,1.4vw,1rem)] text-sm leading-6 outline-none transition placeholder:text-muted-foreground focus:border-primary/45 focus:ring-2 focus:ring-ring"
              />
            </label>
            <div className="grid gap-3 rounded-[var(--radius-card)] border bg-background/62 p-3 sm:grid-cols-3">
              <label className="grid min-w-0 gap-2 text-sm font-semibold">
                최소 포인트
                <Input value={minBet} onChange={(event) => setMinBet(event.target.value)} inputMode="numeric" className="min-h-[var(--control-height-sm)] text-center font-semibold" />
              </label>
              <label className="grid min-w-0 gap-2 text-sm font-semibold">
                최대 포인트
                <Input value={maxBet} onChange={(event) => setMaxBet(event.target.value)} inputMode="numeric" className="min-h-[var(--control-height-sm)] text-center font-semibold" />
              </label>
              <label className="grid min-w-0 gap-2 text-sm font-semibold">
                자동 마감(분)
                <Input value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} inputMode="numeric" placeholder="비움" className="min-h-[var(--control-height-sm)] text-center font-semibold" />
              </label>
            </div>
            <Button type="button" onClick={create} disabled={isPending}>
              <Send className="h-4 w-4" />
              예측 열기
            </Button>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle>진행 현황</CardTitle>
            <CardDescription>채팅에서는 `!투표 번호 포인트` 형식으로 참여해요. `1만`, `1k`, `올인`도 사용할 수 있고 `!배팅`, `!예측`도 지원해요.</CardDescription>
              </div>
              <Badge tone={statusTone(latest?.status)}>{statusLabel(latest?.status)}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {latest ? (
              <div className="grid gap-4">
                <div className="rounded-[var(--radius-card)] bg-muted/55 p-4">
                  <div className="text-lg font-semibold leading-7">{latest.question}</div>
                  {winner ? <div className="mt-2 text-sm text-muted-foreground">정산 결과: {winner.label}</div> : null}
                </div>
                <div className="grid max-h-[min(52vh,38rem)] gap-3 overflow-y-auto pr-1">
                  {latest.options.map((option, index) => (
                    <OptionMeter key={option.id} option={option} index={index} selected={option.id === latest.winningOptionId} />
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {latest.status === 'open' ? (
                    <Button type="button" variant="outline" onClick={() => action(`/api/predictions/${latest.id}/lock`, null, '예측을 마감했습니다.')} disabled={isPending}>
                      <Lock className="h-4 w-4" />
                      베팅 마감
                    </Button>
                  ) : null}
                  {latest.status === 'open' || latest.status === 'locked' ? (
                    <>
                      {latest.options.map((option, index) => (
                        <Button
                          key={option.id}
                          type="button"
                          variant="soft"
                          onClick={() => action(`/api/predictions/${latest.id}/settle`, { winningOptionId: option.id }, `${option.label} 결과로 정산했습니다.`)}
                          disabled={isPending}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          {index + 1}번 정산
                        </Button>
                      ))}
                      <Button type="button" variant="destructive" onClick={() => action(`/api/predictions/${latest.id}/cancel`, null, '예측을 취소하고 환불했습니다.')} disabled={isPending}>
                        <XCircle className="h-4 w-4" />
                        취소/환불
                      </Button>
                    </>
                  ) : null}
                  <Button type="button" variant="outline" onClick={load} disabled={isPending}>
                    <RotateCcw className="h-4 w-4" />
                    새로고침
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-[var(--radius-card)] border border-dashed bg-muted/40 p-8 text-center">
                <div className="text-base font-semibold">열려 있는 예측이 없습니다.</div>
                <div className="mt-2 text-sm leading-6 text-muted-foreground">질문과 선택지를 입력하면 채팅과 OBS에서 바로 사용할 수 있어요.</div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle>OBS 오버레이</CardTitle>
            <CardDescription>브라우저 소스에 주소를 넣으면 현재 예측 현황이 방송 화면에 표시돼요.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <button
              type="button"
              onClick={copyOverlay}
              disabled={!overlayUrl}
              className="group rounded-[var(--radius-card)] border bg-background/70 p-3 text-left text-sm break-all text-muted-foreground transition hover:border-primary/35 hover:bg-pastel-sky/35 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="block blur-sm transition group-hover:blur-0 group-focus-visible:blur-0">
              {overlayUrl || '채널 연결 후 오버레이 주소가 표시됩니다.'}
              </span>
            </button>
            <Button type="button" variant="outline" onClick={copyOverlay} disabled={!overlayUrl}>
              <Copy className="h-4 w-4" />
              주소 복사
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-[linear-gradient(135deg,hsl(222_30%_12%),hsl(225_28%_18%))] text-white">
          <CardHeader>
            <CardTitle>오버레이 미리보기</CardTitle>
            <CardDescription className="text-white/65">선택지가 많으면 방송 화면에 맞게 압축된 리스트로 표시됩니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-[var(--radius-panel)] border border-white/10 bg-white/10 p-[clamp(1rem,2vw,1.5rem)] shadow-2xl backdrop-blur-xl">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-lg font-bold">{latest?.question || '예측이 열리면 여기에 표시됩니다.'}</div>
                  <div className="mt-1 text-sm text-white/65">{formatPoints(latest?.totalPoints || 0)} · {latest?.participantCount || 0}명</div>
                </div>
                <Badge tone={active ? 'mint' : 'neutral'}>{statusLabel(active?.status)}</Badge>
              </div>
              <div className="mt-4 grid max-h-[18rem] gap-2 overflow-hidden">
                {(latest?.options || []).slice(0, 8).map((option, index) => (
                  <div key={option.id}>
                    <div className="mb-1 flex justify-between gap-3 text-sm">
                      <span className="truncate">{index + 1}. {option.label}</span>
                      <span>{option.percentage}%</span>
                    </div>
                    <div className="h-[0.55rem] overflow-hidden rounded-full bg-white/12">
                      <div className="h-full rounded-full bg-[linear-gradient(90deg,#7ee7d4,#ffc3ad)]" style={{ width: `${option.percentage}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>최근 예측</CardTitle>
          <CardDescription>정산된 예측과 취소된 예측까지 함께 확인할 수 있어요.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            {predictions.map((prediction) => (
              <div key={prediction.id} className="grid gap-2 rounded-[var(--radius-card)] border bg-background/65 p-4 md:grid-cols-[1fr_auto] md:items-center">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{prediction.question}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatPoints(prediction.totalPoints)} · {prediction.participantCount}명 · {prediction.options.length}개 선택지
                  </div>
                </div>
                <Badge tone={statusTone(prediction.status)}>{statusLabel(prediction.status)}</Badge>
              </div>
            ))}
            {!predictions.length ? (
              <div className="rounded-[var(--radius-card)] border border-dashed bg-muted/40 p-6 text-center text-sm text-muted-foreground">
                아직 기록된 예측이 없습니다.
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
