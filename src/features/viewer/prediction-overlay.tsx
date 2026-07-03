'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { readJson } from '@/shared/api/http';
import { useVisibilityPolling } from '@/shared/lib/use-visibility-polling';

type PredictionOption = {
  id: string;
  label: string;
  total: number;
  count: number;
  percentage: number;
  payoutMultiplier: number | null;
  payoutPer100: number | null;
};

type Prediction = {
  id: string;
  question: string;
  status: string;
  options: PredictionOption[];
  winningOptionId: string | null;
  totalPoints: number;
  participantCount: number;
  settledAt?: string | null;
};

type PublicPredictionResponse = {
  prediction: Prediction | null;
};

function formatPoints(value: number) {
  return `${Number(value || 0).toLocaleString('ko-KR')}P`;
}

function ScrollingText({ children, className = '' }: { children: ReactNode; className?: string }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [scrollState, setScrollState] = useState({ active: false, distance: 0, duration: 8 });

  useLayoutEffect(() => {
    const measure = () => {
      const box = boxRef.current;
      const text = textRef.current;
      if (!box || !text) return;
      const boxWidth = box.getBoundingClientRect().width;
      const textWidth = Math.max(text.scrollWidth, text.getBoundingClientRect().width);
      const overflow = Math.ceil(textWidth - boxWidth);
      setScrollState({
        active: overflow > 1,
        distance: Math.max(0, overflow),
        duration: Math.min(28, Math.max(8, overflow / 24)),
      });
    };

    measure();
    const raf = window.requestAnimationFrame(measure);
    const timer = window.setTimeout(measure, 160);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (observer && boxRef.current) observer.observe(boxRef.current);
    if (observer && textRef.current) observer.observe(textRef.current);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [children]);

  const style = scrollState.active
    ? ({
      '--prediction-marquee-distance': `-${scrollState.distance}px`,
      '--prediction-marquee-duration': `${scrollState.duration}s`,
    } as CSSProperties)
    : undefined;

  return (
    <div ref={boxRef} className={`min-w-0 max-w-full overflow-hidden ${scrollState.active ? 'prediction-marquee-mask' : ''} ${className}`}>
      <span ref={textRef} className={scrollState.active ? 'prediction-marquee-track' : 'block truncate'} style={style}>
        {children}
      </span>
    </div>
  );
}

export function PredictionOverlay({ channelUid }: { channelUid: string }) {
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [preview, setPreview] = useState(false);
  const [hiddenResultId, setHiddenResultId] = useState<string | null>(null);
  const playedResultRef = useRef('');
  const hideTimerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    const data = await readJson<PublicPredictionResponse>(`/api/public/${encodeURIComponent(channelUid)}/prediction`);
    setPrediction(data?.prediction || null);
  }, [channelUid]);

  useEffect(() => {
    setPreview(new URLSearchParams(window.location.search).get('preview') === '1');
  }, []);

  useVisibilityPolling(load, 2200);

  useEffect(() => {
    if (prediction?.status !== 'settled' || !prediction.winningOptionId) {
      setHiddenResultId(null);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
      return;
    }

    const resultKey = `${prediction.id}:${prediction.winningOptionId}:${prediction.settledAt || ''}`;
    setHiddenResultId(null);

    if (playedResultRef.current !== resultKey) {
      playedResultRef.current = resultKey;
      try {
        const audio = new Audio('/files/batting_result.mp3');
        audio.volume = 0.2;
        const playResult = audio.play();
        if (playResult && typeof playResult.catch === 'function') playResult.catch(() => undefined);
      } catch {}
    }

    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setHiddenResultId(prediction.id);
    }, 5000);

    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    };
  }, [prediction?.id, prediction?.status, prediction?.winningOptionId, prediction?.settledAt]);

  const displayPrediction = prediction?.status === 'settled' && hiddenResultId === prediction.id ? null : prediction;
  const visibleOptions = useMemo(() => displayPrediction?.options || [], [displayPrediction]);
  const isSettled = displayPrediction?.status === 'settled';
  const winningOption = useMemo(
    () => displayPrediction?.options.find((option) => option.id === displayPrediction.winningOptionId) || null,
    [displayPrediction],
  );
  const statusLabel = isSettled ? 'RESULT' : displayPrediction?.status === 'locked' ? 'LOCKED' : 'LIVE';

  if (!displayPrediction && !preview) return null;

  return (
    <main className="viewer-surface h-screen w-screen bg-transparent">
      <section className="grid h-full w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden border border-white/14 bg-[linear-gradient(135deg,rgba(14,20,34,0.92),rgba(31,37,59,0.82))] p-[clamp(1.4rem,3.3vw,3rem)] text-white shadow-[0_1.5rem_4rem_rgba(0,0,0,0.34)] backdrop-blur-xl">
        <div className="flex items-start justify-between gap-[clamp(0.8rem,2vw,1.4rem)]">
          <div className="min-w-0 flex-1">
            <ScrollingText className="w-full text-[clamp(2.1rem,6.2vw,5rem)] font-black leading-[1.04] tracking-normal">
              {displayPrediction?.question || '예측 베팅 대기 중'}
            </ScrollingText>
            <div className="mt-[clamp(0.55rem,1.2vw,0.9rem)] text-[clamp(1.1rem,2.1vw,1.45rem)] font-semibold leading-relaxed text-white/72">
              {formatPoints(displayPrediction?.totalPoints || 0)} · {displayPrediction?.participantCount || 0}명 참여 · !투표 &lt;번호&gt; &lt;배팅 포인트&gt;
            </div>
          </div>
          <div className={`shrink-0 rounded-full border px-[clamp(0.85rem,1.7vw,1.2rem)] py-[clamp(0.45rem,1vw,0.7rem)] text-[clamp(0.95rem,1.55vw,1.15rem)] font-black tracking-[0.08em] ${isSettled ? 'border-amber-200/35 bg-amber-200/18 text-amber-50' : 'border-emerald-300/25 bg-emerald-300/14 text-emerald-100'}`}>
            {statusLabel}
          </div>
        </div>

        {isSettled && winningOption ? (
          <div className="mt-[clamp(1rem,2vw,1.5rem)] overflow-hidden rounded-[clamp(1rem,2vw,1.5rem)] border border-amber-200/35 bg-[linear-gradient(135deg,rgba(250,204,21,0.26),rgba(45,212,191,0.16),rgba(255,255,255,0.08))] p-[clamp(1rem,2.2vw,1.7rem)] shadow-[0_1rem_3rem_rgba(250,204,21,0.18)]">
            <div className="text-[clamp(0.95rem,1.6vw,1.18rem)] font-black uppercase tracking-[0.16em] text-amber-100/84">예측 결과</div>
            <ScrollingText className="mt-[clamp(0.35rem,0.9vw,0.6rem)] w-full text-[clamp(2.2rem,6vw,4.7rem)] font-black leading-[1.04] text-white">
              {winningOption.label} 승리
            </ScrollingText>
            <div className="mt-[clamp(0.45rem,1vw,0.75rem)] text-[clamp(1.08rem,1.9vw,1.35rem)] font-bold text-white/74">
              총 {formatPoints(displayPrediction?.totalPoints || 0)} · {displayPrediction?.participantCount || 0}명 참여
            </div>
          </div>
        ) : null}

        <div className="mt-[clamp(1.1rem,2.3vw,1.8rem)] grid min-h-0 content-start gap-[clamp(0.85rem,1.65vw,1.25rem)] overflow-hidden">
          {visibleOptions.map((option, index) => (
            <div
              key={option.id}
              className={`grid gap-[clamp(0.55rem,1vw,0.75rem)] rounded-[clamp(0.9rem,1.8vw,1.35rem)] p-[clamp(0.95rem,1.8vw,1.35rem)] transition duration-500 ${
                isSettled && option.id === displayPrediction?.winningOptionId
                  ? 'border border-amber-200/45 bg-[linear-gradient(135deg,rgba(250,204,21,0.22),rgba(34,211,238,0.12))] shadow-[0_0_2.4rem_rgba(250,204,21,0.24)]'
                  : isSettled
                    ? 'bg-white/[0.045] opacity-45'
                    : 'bg-white/8'
              }`}
            >
              <div className="flex items-center justify-between gap-[clamp(0.85rem,2vw,1.35rem)] text-[clamp(1.25rem,2.75vw,1.9rem)]">
                <ScrollingText className="w-full flex-1 font-black">
                  {index + 1}. {option.label}
                </ScrollingText>
                <div className={`shrink-0 font-bold ${isSettled && option.id === displayPrediction?.winningOptionId ? 'text-amber-50' : 'text-white'}`}>
                  {option.percentage}% {option.payoutMultiplier ? <span className="text-white/58">x{option.payoutMultiplier}</span> : null}
                </div>
              </div>
              <div className="h-[clamp(0.82rem,1.45vw,1.08rem)] overflow-hidden rounded-full bg-white/12">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${isSettled && option.id === displayPrediction?.winningOptionId ? 'bg-[linear-gradient(90deg,#fde68a,#8ee8d8,#ffffff)]' : 'bg-[linear-gradient(90deg,#8ee8d8,#ffc7b5,#d7c3ff)]'}`}
                  style={{ width: `${Math.max(0, Math.min(100, option.percentage))}%` }}
                />
              </div>
            </div>
          ))}
          {!visibleOptions.length ? (
            <div className="rounded-[clamp(0.75rem,1.5vw,1rem)] border border-white/10 bg-white/8 p-[clamp(0.9rem,2vw,1.2rem)] text-center text-[clamp(0.78rem,1.4vw,0.95rem)] text-white/70">
              예측이 열리면 자동으로 표시됩니다.
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
