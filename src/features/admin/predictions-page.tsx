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
    <div className="group min-w-0 rounded-[var(--radius-card)] border bg-background/78 p-[clamp(0.875rem,1.6vw,1.125rem)] transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-subtle">
      <div className="flex items-start justify-between gap-[clamp(0.75rem,1.8vw,1.25rem)]">
        <div className="min-w-0">
          <div className="flex items-center gap-[clamp(0.45rem,1vw,0.75rem)]">
            <span className="grid aspect-square w-[2.25em] shrink-0 place-items-center rounded-[var(--radius-control)] bg-pastel-mint/75 text-[clamp(0.9rem,1.3vw,1.05rem)] font-bold text-teal-900 dark:bg-primary/25 dark:text-teal-50">
              {index + 1}
            </span>
            <div className="truncate text-[clamp(1rem,1.5vw,1.15rem)] font-semibold">{option.label}</div>
            {selected ? <Trophy className="h-[1.1em] w-[1.1em] shrink-0 text-amber-500" /> : null}
          </div>
          <div className="mt-[clamp(0.4rem,0.9vw,0.65rem)] text-[clamp(0.82rem,1.1vw,0.95rem)] text-muted-foreground">
            {option.count.toLocaleString('ko-KR')}명 참여
          </div>
        </div>
        <div className="min-w-0 text-right">
          <div className="text-[clamp(1.1rem,1.8vw,1.35rem)] font-bold">{option.percentage}%</div>
          <div className="text-[clamp(0.82rem,1.1vw,0.95rem)] text-muted-foreground">{formatPoints(option.total)}</div>
        </div>
      </div>
      <div className="mt-[clamp(0.7rem,1.4vw,1rem)] flex flex-wrap gap-[clamp(0.45rem,1vw,0.75rem)] text-[clamp(0.78rem,1vw,0.92rem)]">
        <span className="rounded-full border bg-card/75 px-[clamp(0.65rem,1.2vw,0.9rem)] py-[clamp(0.25rem,0.7vw,0.4rem)] font-semibold text-muted-foreground">
          예상 배당 {option.payoutMultiplier ? `x${option.payoutMultiplier}` : '-'}
        </span>
        <span className="rounded-full border bg-card/75 px-[clamp(0.65rem,1.2vw,0.9rem)] py-[clamp(0.25rem,0.7vw,0.4rem)] font-semibold text-muted-foreground">
          100P당 {option.payoutPer100 ? formatPoints(option.payoutPer100) : '-'}
        </span>
      </div>
      <div className="mt-[clamp(0.7rem,1.4vw,1rem)] h-[clamp(0.72rem,1vw,0.9rem)] overflow-hidden rounded-full bg-muted">
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
        <div className="grid gap-[clamp(1.25rem,2.4vw,2rem)] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-end">
          <div className="min-w-0">
            <div className="mb-[clamp(0.9rem,1.8vw,1.25rem)] flex flex-wrap items-center gap-[clamp(0.5rem,1vw,0.75rem)]">
              <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-primary/12 text-primary">
                <BarChart3 className="h-[1.15em] w-[1.15em]" />
              </span>
              <Badge tone="mint">시청자 예측</Badge>
              <Badge tone={statusTone(active?.status)}>{statusLabel(active?.status)}</Badge>
            </div>
            <h1 className="text-[clamp(2rem,4vw,3rem)] font-semibold leading-tight">예측 베팅</h1>
            <p className="mt-[clamp(0.75rem,1.5vw,1rem)] max-w-2xl text-[clamp(0.95rem,1.35vw,1.12rem)] leading-relaxed text-muted-foreground">
              방송의 다음 순간을 시청자가 포인트로 예측하게 열고, 채팅 명령어와 OBS 오버레이로 참여 흐름을 자연스럽게 보여줘요.
            </p>
          </div>
          <div className="grid min-w-0 grid-cols-[repeat(3,minmax(0,1fr))] gap-[clamp(0.5rem,1.1vw,0.85rem)]">
            <div className="min-w-0 rounded-[var(--radius-card)] border bg-card/78 p-[clamp(0.75rem,1.5vw,1rem)] text-center">
              <div className="truncate text-[clamp(1.1rem,2vw,1.45rem)] font-bold">{formatPoints(latest?.totalPoints || 0)}</div>
              <div className="mt-[clamp(0.2rem,0.6vw,0.4rem)] text-[clamp(0.78rem,1vw,0.92rem)] text-muted-foreground">총 베팅</div>
            </div>
            <div className="min-w-0 rounded-[var(--radius-card)] border bg-card/78 p-[clamp(0.75rem,1.5vw,1rem)] text-center">
              <div className="truncate text-[clamp(1.1rem,2vw,1.45rem)] font-bold">{latest?.participantCount || 0}</div>
              <div className="mt-[clamp(0.2rem,0.6vw,0.4rem)] text-[clamp(0.78rem,1vw,0.92rem)] text-muted-foreground">참여자</div>
            </div>
            <div className="min-w-0 rounded-[var(--radius-card)] border bg-card/78 p-[clamp(0.75rem,1.5vw,1rem)] text-center">
              <div className="truncate text-[clamp(1.1rem,2vw,1.45rem)] font-bold">{latest?.options.length || optionRows.length}</div>
              <div className="mt-[clamp(0.2rem,0.6vw,0.4rem)] text-[clamp(0.78rem,1vw,0.92rem)] text-muted-foreground">선택지</div>
            </div>
          </div>
        </div>
      </section>

      {notice ? (
        <div className="rounded-[var(--radius-card)] border bg-pastel-lemon/55 p-[clamp(0.85rem,1.5vw,1.1rem)] text-[clamp(0.9rem,1.2vw,1rem)] font-medium text-amber-950 dark:bg-amber-500/12 dark:text-amber-100">
          {notice}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <Card>
          <CardHeader>
            <CardTitle>새 예측 열기</CardTitle>
            <CardDescription>선택지는 줄바꿈으로 입력해요. 최소 2개 이상이면 개수 제한 없이 사용할 수 있어요.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-[clamp(0.95rem,1.8vw,1.35rem)]">
            <label className="grid min-w-0 gap-[clamp(0.45rem,1vw,0.65rem)] text-[clamp(0.95rem,1.25vw,1.05rem)] font-semibold">
              질문
              <Input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="예: 다음 판 결과는?" />
            </label>
            <label className="grid min-w-0 gap-[clamp(0.45rem,1vw,0.65rem)] text-[clamp(0.95rem,1.25vw,1.05rem)] font-semibold">
              선택지
              <textarea
                value={optionsText}
                onChange={(event) => setOptionsText(event.target.value)}
                placeholder="선택지를 한 줄에 하나씩 입력"
                className="box-border min-h-[12rem] w-full min-w-0 max-w-full resize-y rounded-[var(--radius-control)] border bg-background/80 p-[clamp(0.75rem,1.4vw,1rem)] text-[clamp(0.95rem,1.25vw,1.05rem)] leading-relaxed outline-none transition placeholder:text-muted-foreground focus:border-primary/45 focus:ring-2 focus:ring-ring"
              />
            </label>
            <div className="grid min-w-0 gap-[clamp(0.75rem,1.4vw,1rem)] rounded-[var(--radius-card)] border bg-background/62 p-[clamp(0.75rem,1.5vw,1rem)] sm:grid-cols-[repeat(3,minmax(0,1fr))]">
              <label className="grid min-w-0 gap-[clamp(0.45rem,1vw,0.65rem)] text-[clamp(0.9rem,1.2vw,1rem)] font-semibold">
                최소 포인트
                <Input value={minBet} onChange={(event) => setMinBet(event.target.value)} inputMode="numeric" className="min-h-[var(--control-height-sm)] text-center text-[clamp(0.95rem,1.25vw,1.08rem)] font-semibold tabular-nums" />
              </label>
              <label className="grid min-w-0 gap-[clamp(0.45rem,1vw,0.65rem)] text-[clamp(0.9rem,1.2vw,1rem)] font-semibold">
                최대 포인트
                <Input value={maxBet} onChange={(event) => setMaxBet(event.target.value)} inputMode="numeric" className="min-h-[var(--control-height-sm)] text-center text-[clamp(0.95rem,1.25vw,1.08rem)] font-semibold tabular-nums" />
              </label>
              <label className="grid min-w-0 gap-[clamp(0.45rem,1vw,0.65rem)] text-[clamp(0.9rem,1.2vw,1rem)] font-semibold">
                자동 마감(분)
                <Input value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} inputMode="numeric" placeholder="비움" className="min-h-[var(--control-height-sm)] text-center text-[clamp(0.95rem,1.25vw,1.08rem)] font-semibold tabular-nums" />
              </label>
            </div>
            <Button type="button" onClick={create} disabled={isPending}>
              <Send className="h-[1em] w-[1em]" />
              예측 열기
            </Button>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <div className="flex flex-col gap-[clamp(0.75rem,1.5vw,1rem)] md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle>진행 현황</CardTitle>
                <CardDescription>채팅에서는 `!투표 번호 포인트` 형식으로 참여해요. `1만`, `1k`, `올인`도 사용할 수 있고 `!배팅`, `!예측`도 지원해요.</CardDescription>
              </div>
              <Badge tone={statusTone(latest?.status)}>{statusLabel(latest?.status)}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {latest ? (
              <div className="grid gap-[clamp(0.95rem,1.8vw,1.35rem)]">
                <div className="min-w-0 rounded-[var(--radius-card)] bg-muted/55 p-[clamp(0.875rem,1.6vw,1rem)]">
                  <div className="text-[clamp(1.1rem,1.8vw,1.35rem)] font-semibold leading-relaxed">{latest.question}</div>
                  {winner ? <div className="mt-[clamp(0.45rem,0.9vw,0.7rem)] text-[clamp(0.88rem,1.15vw,1rem)] text-muted-foreground">정산 결과: {winner.label}</div> : null}
                </div>
                <div className="grid max-h-[min(52vh,38rem)] gap-[clamp(0.75rem,1.4vw,1rem)] overflow-y-auto pr-[clamp(0.2rem,0.5vw,0.35rem)]">
                  {latest.options.map((option, index) => (
                    <OptionMeter key={option.id} option={option} index={index} selected={option.id === latest.winningOptionId} />
                  ))}
                </div>
                <div className="grid gap-[clamp(0.55rem,1.1vw,0.85rem)] sm:grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))]">
                  {latest.status === 'open' ? (
                    <Button type="button" variant="outline" onClick={() => action(`/api/predictions/${latest.id}/lock`, null, '예측을 마감했습니다.')} disabled={isPending}>
                      <Lock className="h-[1em] w-[1em]" />
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
                          <CheckCircle2 className="h-[1em] w-[1em]" />
                          {index + 1}번 정산
                        </Button>
                      ))}
                      <Button type="button" variant="destructive" onClick={() => action(`/api/predictions/${latest.id}/cancel`, null, '예측을 취소하고 환불했습니다.')} disabled={isPending}>
                        <XCircle className="h-[1em] w-[1em]" />
                        취소/환불
                      </Button>
                    </>
                  ) : null}
                  <Button type="button" variant="outline" onClick={load} disabled={isPending}>
                    <RotateCcw className="h-[1em] w-[1em]" />
                    새로고침
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-[var(--radius-card)] border border-dashed bg-muted/40 p-[clamp(1.25rem,3vw,2rem)] text-center">
                <div className="text-[clamp(1rem,1.4vw,1.15rem)] font-semibold">열려 있는 예측이 없습니다.</div>
                <div className="mt-[clamp(0.45rem,1vw,0.7rem)] text-[clamp(0.88rem,1.15vw,1rem)] leading-relaxed text-muted-foreground">질문과 선택지를 입력하면 채팅과 OBS에서 바로 사용할 수 있어요.</div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>OBS 오버레이</CardTitle>
            <CardDescription>브라우저 소스에 주소를 넣으면 현재 예측 현황이 방송 화면에 표시돼요.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-[clamp(0.75rem,1.4vw,1rem)]">
            <button
              type="button"
              onClick={copyOverlay}
              disabled={!overlayUrl}
              className="group min-w-0 rounded-[var(--radius-card)] border bg-background/70 p-[clamp(0.75rem,1.4vw,1rem)] text-left text-[clamp(0.88rem,1.15vw,1rem)] break-all text-muted-foreground transition hover:border-primary/35 hover:bg-pastel-sky/35 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="block blur-sm transition group-hover:blur-0 group-focus-visible:blur-0">
              {overlayUrl || '채널 연결 후 오버레이 주소가 표시됩니다.'}
              </span>
            </button>
            <Button type="button" variant="outline" onClick={copyOverlay} disabled={!overlayUrl}>
              <Copy className="h-[1em] w-[1em]" />
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
              <div className="flex items-center justify-between gap-[clamp(0.75rem,1.6vw,1.1rem)]">
                <div className="min-w-0">
                  <div className="truncate text-[clamp(1.1rem,1.8vw,1.35rem)] font-bold">{latest?.question || '예측이 열리면 여기에 표시됩니다.'}</div>
                  <div className="mt-[clamp(0.25rem,0.7vw,0.45rem)] text-[clamp(0.85rem,1.1vw,0.98rem)] text-white/65">{formatPoints(latest?.totalPoints || 0)} · {latest?.participantCount || 0}명</div>
                </div>
                <Badge tone={active ? 'mint' : 'neutral'}>{statusLabel(active?.status)}</Badge>
              </div>
              <div className="mt-[clamp(0.9rem,1.8vw,1.25rem)] grid max-h-[18rem] gap-[clamp(0.55rem,1.1vw,0.8rem)] overflow-hidden">
                {(latest?.options || []).slice(0, 8).map((option, index) => (
                  <div key={option.id}>
                    <div className="mb-[clamp(0.25rem,0.6vw,0.4rem)] flex justify-between gap-[clamp(0.75rem,1.6vw,1rem)] text-[clamp(0.88rem,1.15vw,1rem)]">
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
          <div className="grid gap-[clamp(0.55rem,1.1vw,0.85rem)]">
            {predictions.map((prediction) => (
              <div key={prediction.id} className="grid min-w-0 gap-[clamp(0.45rem,0.9vw,0.65rem)] rounded-[var(--radius-card)] border bg-background/65 p-[clamp(0.875rem,1.6vw,1rem)] md:grid-cols-[minmax(0,1fr)_minmax(0,auto)] md:items-center">
                <div className="min-w-0">
                  <div className="truncate text-[clamp(0.95rem,1.25vw,1.08rem)] font-semibold">{prediction.question}</div>
                  <div className="mt-[clamp(0.25rem,0.6vw,0.4rem)] text-[clamp(0.78rem,1vw,0.9rem)] text-muted-foreground">
                    {formatPoints(prediction.totalPoints)} · {prediction.participantCount}명 · {prediction.options.length}개 선택지
                  </div>
                </div>
                <Badge tone={statusTone(prediction.status)}>{statusLabel(prediction.status)}</Badge>
              </div>
            ))}
            {!predictions.length ? (
              <div className="rounded-[var(--radius-card)] border border-dashed bg-muted/40 p-[clamp(1rem,2vw,1.5rem)] text-center text-[clamp(0.88rem,1.15vw,1rem)] text-muted-foreground">
                아직 기록된 예측이 없습니다.
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
