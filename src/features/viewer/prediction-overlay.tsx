'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { apiWsUrl, readJson } from '@/shared/api/http';

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
    ? (() => {
      const rootFontSize = typeof window !== 'undefined'
        ? Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize || '16')
        : 16;
      const distanceRem = scrollState.distance / Math.max(1, rootFontSize || 16);
      return {
        '--prediction-marquee-distance': `-${distanceRem}rem`,
        '--prediction-marquee-duration': `${scrollState.duration}s`,
      } as CSSProperties;
    })()
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
  const reconnectTimerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    const data = await readJson<PublicPredictionResponse>(`/api/public/${encodeURIComponent(channelUid)}/prediction`);
    setPrediction(data?.prediction || null);
  }, [channelUid]);

  useEffect(() => {
    setPreview(new URLSearchParams(window.location.search).get('preview') === '1');
  }, []);

  useEffect(() => {
    if (!channelUid) return;
    if (typeof WebSocket === 'undefined') {
      void load();
      return;
    }

    let ws: WebSocket | null = null;
    let disposed = false;
    let attempts = 0;

    const connect = () => {
      if (disposed) return;
      try {
        ws = new WebSocket(apiWsUrl(`/api/prediction/ws?channelUid=${encodeURIComponent(channelUid)}`));
      } catch {
        void load();
        return;
      }

      ws.onopen = () => {
        attempts = 0;
      };
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data || '{}')) as { type?: string; prediction?: Prediction | null };
          if (message.type === 'prediction:clear') {
            setPrediction(null);
            return;
          }
          if (message.type === 'prediction:snapshot' || message.type === 'prediction:update') {
            setPrediction(message.prediction || null);
          }
        } catch {}
      };
      ws.onclose = () => {
        if (disposed) return;
        attempts += 1;
        const delay = Math.min(10000, 800 * 2 ** Math.min(4, attempts));
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };
      ws.onerror = () => {
        try { ws?.close(); } catch {}
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      try { ws?.close(); } catch {}
    };
  }, [channelUid, load]);

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
    <main className="viewer-surface flex h-screen w-screen items-end justify-end bg-transparent p-[clamp(0.75rem,2vw,1.35rem)]">
      <section className="w-[min(46rem,96vw)] overflow-hidden rounded-[clamp(0.9rem,1.7vw,1.3rem)] border-[max(0.0625rem,0.08vw)] border-white/14 bg-[linear-gradient(135deg,rgba(14,20,34,0.9),rgba(31,37,59,0.76))] p-[clamp(0.85rem,1.65vw,1.25rem)] text-white shadow-[0_1.25rem_3.5rem_rgba(0,0,0,0.32)] backdrop-blur-xl">
        <div className="flex items-start justify-between gap-[clamp(0.7rem,1.6vw,1.1rem)]">
          <div className="min-w-0 flex-1">
            <ScrollingText className="w-full text-[clamp(1.25rem,2.8vw,2.15rem)] font-black leading-[1.04] tracking-normal">
              {displayPrediction?.question || '예측 베팅 대기 중'}
            </ScrollingText>
            <div className="mt-[clamp(0.35rem,0.8vw,0.55rem)] text-[clamp(0.82rem,1.35vw,1rem)] font-semibold leading-tight text-white/72">
              {formatPoints(displayPrediction?.totalPoints || 0)} · {displayPrediction?.participantCount || 0}명 참여 · !투표 &lt;번호&gt; &lt;배팅 포인트&gt;
            </div>
          </div>
          <div className={`shrink-0 rounded-full border-[max(0.0625rem,0.08vw)] p-[clamp(0.32rem,0.7vw,0.5rem)] text-center text-[clamp(0.72rem,1.05vw,0.86rem)] font-black tracking-[0.08em] ${isSettled ? 'border-amber-200/35 bg-amber-200/18 text-amber-50' : 'border-emerald-300/25 bg-emerald-300/14 text-emerald-100'}`}>
            {statusLabel}
          </div>
        </div>

        {isSettled && winningOption ? (
          <div className="mt-[clamp(0.65rem,1.3vw,0.95rem)] overflow-hidden rounded-[clamp(0.8rem,1.5vw,1.1rem)] border-[max(0.0625rem,0.08vw)] border-amber-200/35 bg-[linear-gradient(135deg,rgba(250,204,21,0.24),rgba(45,212,191,0.14),rgba(255,255,255,0.08))] p-[clamp(0.75rem,1.45vw,1rem)] shadow-[0_1rem_2.4rem_rgba(250,204,21,0.16)]">
            <div className="text-[clamp(0.72rem,1.05vw,0.86rem)] font-black uppercase tracking-[0.16em] text-amber-100/84">예측 결과</div>
            <ScrollingText className="mt-[clamp(0.2rem,0.55vw,0.35rem)] w-full text-[clamp(1.45rem,3.4vw,2.55rem)] font-black leading-[1.04] text-white">
              {winningOption.label} 승리
            </ScrollingText>
            <div className="mt-[clamp(0.28rem,0.6vw,0.45rem)] text-[clamp(0.8rem,1.25vw,0.95rem)] font-bold text-white/74">
              총 {formatPoints(displayPrediction?.totalPoints || 0)} · {displayPrediction?.participantCount || 0}명 참여
            </div>
          </div>
        ) : null}

        <div className="mt-[clamp(0.65rem,1.25vw,0.95rem)] grid max-h-[min(52vh,30rem)] content-start gap-[clamp(0.45rem,0.9vw,0.7rem)] overflow-hidden">
          {visibleOptions.map((option, index) => (
            <div
              key={option.id}
              className={`grid gap-[clamp(0.34rem,0.68vw,0.5rem)] rounded-[clamp(0.7rem,1.25vw,0.95rem)] p-[clamp(0.58rem,1.1vw,0.85rem)] transition duration-500 ${
                isSettled && option.id === displayPrediction?.winningOptionId
                  ? 'border-[max(0.0625rem,0.08vw)] border-amber-200/45 bg-[linear-gradient(135deg,rgba(250,204,21,0.22),rgba(34,211,238,0.12))] shadow-[0_0_2.4rem_rgba(250,204,21,0.24)]'
                  : isSettled
                    ? 'bg-white/[0.045] opacity-45'
                    : 'bg-white/8'
              }`}
            >
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[clamp(0.65rem,1.3vw,0.95rem)] text-[clamp(0.96rem,1.75vw,1.28rem)]">
                <ScrollingText className="w-full flex-1 font-black">
                  {index + 1}. {option.label}
                </ScrollingText>
                <div className={`shrink-0 rounded-full border-[max(0.0625rem,0.08vw)] p-[clamp(0.25rem,0.55vw,0.42rem)] text-center text-[clamp(0.82rem,1.2vw,0.95rem)] font-black ${isSettled && option.id === displayPrediction?.winningOptionId ? 'border-amber-200/40 bg-amber-200/20 text-amber-50' : 'border-white/12 bg-white/8 text-white'}`}>
                  {option.percentage}%
                </div>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[clamp(0.55rem,1vw,0.75rem)] text-[clamp(0.72rem,1.05vw,0.86rem)] font-bold text-white/64">
                <span className="min-w-0 truncate">
                  <span className="text-white/42">배팅 포인트 </span>
                  <span className="text-white/88">{formatPoints(option.total)}</span>
                </span>
                <span className="shrink-0">
                  <span className="text-white/42">참여 </span>
                  <span className="text-white/82">{option.count.toLocaleString('ko-KR')}명</span>
                </span>
              </div>
              <div className="h-[clamp(0.45rem,0.8vw,0.62rem)] overflow-hidden rounded-full bg-white/12">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${isSettled && option.id === displayPrediction?.winningOptionId ? 'bg-[linear-gradient(90deg,#fde68a,#8ee8d8,#ffffff)]' : 'bg-[linear-gradient(90deg,#8ee8d8,#ffc7b5,#d7c3ff)]'}`}
                  style={{ width: `${Math.max(0, Math.min(100, option.percentage))}%` }}
                />
              </div>
            </div>
          ))}
          {!visibleOptions.length ? (
            <div className="rounded-[clamp(0.75rem,1.5vw,1rem)] border-[max(0.0625rem,0.08vw)] border-white/10 bg-white/8 p-[clamp(0.9rem,2vw,1.2rem)] text-center text-[clamp(0.78rem,1.4vw,0.95rem)] text-white/70">
              예측이 열리면 자동으로 표시됩니다.
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
