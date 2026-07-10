'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

export type PredictionOverlayOption = {
  id: string;
  label: string;
  total: number;
  count: number;
  percentage: number;
};

export type PredictionOverlayData = {
  id?: string;
  question: string;
  status: string;
  options: PredictionOverlayOption[];
  winningOptionId: string | null;
  totalPoints: number;
  participantCount: number;
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

export function PredictionOverlayCard({ prediction }: { prediction: PredictionOverlayData | null }) {
  const visibleOptions = useMemo(() => prediction?.options || [], [prediction]);
  const isSettled = prediction?.status === 'settled';
  const winningOption = useMemo(
    () => prediction?.options.find((option) => option.id === prediction.winningOptionId) || null,
    [prediction],
  );
  const statusLabel = isSettled ? '결과' : prediction?.status === 'locked' ? '마감' : '진행 중';

  return (
    <section className="w-[min(40rem,94vw)] shrink-0 overflow-hidden rounded-xl border border-white/15 bg-slate-950/94 p-[clamp(0.72rem,1.35vw,1rem)] text-white shadow-[0_1.1rem_3rem_rgba(0,0,0,0.34)]">
      <div className="flex items-start justify-between gap-[clamp(0.55rem,1.2vw,0.85rem)]">
        <div className="min-w-0 flex-1">
          <ScrollingText className="w-full text-[clamp(1.55rem,3.35vw,2.65rem)] font-black leading-[1.02] tracking-normal">
            {prediction?.question || '예측 베팅 대기 중'}
          </ScrollingText>
          <div className="mt-[clamp(0.28rem,0.62vw,0.42rem)] text-[clamp(0.95rem,1.55vw,1.14rem)] font-semibold leading-tight text-white/76">
            {formatPoints(prediction?.totalPoints || 0)} · {prediction?.participantCount || 0}명 참여 · !투표 &lt;번호&gt; &lt;배팅 포인트&gt;
          </div>
        </div>
        <div className={`shrink-0 rounded-md border p-[clamp(0.3rem,0.62vw,0.44rem)] text-center text-[clamp(0.78rem,1.12vw,0.92rem)] font-bold ${isSettled ? 'border-amber-200/35 bg-amber-200/18 text-amber-50' : 'border-emerald-300/25 bg-emerald-300/14 text-emerald-100'}`}>
          {statusLabel}
        </div>
      </div>

      {isSettled && winningOption ? (
        <div className="mt-[clamp(0.5rem,1vw,0.75rem)] overflow-hidden rounded-lg border border-amber-200/35 bg-amber-300/15 p-[clamp(0.62rem,1.18vw,0.82rem)] shadow-[0_0.9rem_2rem_rgba(250,204,21,0.12)]">
          <div className="text-[clamp(0.8rem,1.15vw,0.94rem)] font-black uppercase tracking-[0.16em] text-amber-100/84">예측 결과</div>
          <ScrollingText className="mt-[clamp(0.16rem,0.4vw,0.28rem)] w-full text-[clamp(1.75rem,3.75vw,2.9rem)] font-black leading-[1.02] text-white">
            {winningOption.label} 승리
          </ScrollingText>
          <div className="mt-[clamp(0.2rem,0.48vw,0.34rem)] text-[clamp(0.92rem,1.35vw,1.05rem)] font-bold text-white/76">
            총 {formatPoints(prediction?.totalPoints || 0)} · {prediction?.participantCount || 0}명 참여
          </div>
        </div>
      ) : null}

      <div className="mt-[clamp(0.5rem,1vw,0.72rem)] grid max-h-[min(48vh,26rem)] content-start gap-[clamp(0.34rem,0.68vw,0.5rem)] overflow-hidden">
        {visibleOptions.map((option, index) => (
          <div
            key={option.id}
            className={`grid gap-[clamp(0.26rem,0.52vw,0.38rem)] rounded-[clamp(0.62rem,1.05vw,0.82rem)] p-[clamp(0.48rem,0.92vw,0.68rem)] transition duration-500 ${
              isSettled && option.id === prediction?.winningOptionId
                ? 'border border-amber-200/45 bg-amber-300/15 shadow-[0_0_2.4rem_rgba(250,204,21,0.18)]'
                : isSettled
                  ? 'bg-white/[0.045] opacity-45'
                  : 'bg-white/8'
            }`}
          >
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[clamp(0.55rem,1.05vw,0.75rem)] text-[clamp(1.16rem,2.08vw,1.55rem)]">
              <ScrollingText className="w-full flex-1 font-black">
                {index + 1}. {option.label}
              </ScrollingText>
              <div className={`shrink-0 rounded-full border-[max(0.0625rem,0.08vw)] p-[clamp(0.22rem,0.45vw,0.34rem)] text-center text-[clamp(0.96rem,1.35vw,1.08rem)] font-black ${isSettled && option.id === prediction?.winningOptionId ? 'border-amber-200/40 bg-amber-200/20 text-amber-50' : 'border-white/12 bg-white/8 text-white'}`}>
                {option.percentage}%
              </div>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[clamp(0.48rem,0.9vw,0.62rem)] text-[clamp(0.88rem,1.22vw,1rem)] font-bold text-white/68">
              <span className="min-w-0 truncate">
                <span className="text-white/42">배팅 포인트 </span>
                <span className="text-white/88">{formatPoints(option.total)}</span>
              </span>
              <span className="shrink-0">
                <span className="text-white/42">참여 </span>
                <span className="text-white/82">{option.count.toLocaleString('ko-KR')}명</span>
              </span>
            </div>
            <div className="h-[clamp(0.38rem,0.68vw,0.52rem)] overflow-hidden rounded-full bg-white/12">
              <div
                className={`h-full rounded-full transition-all duration-700 ${isSettled && option.id === prediction?.winningOptionId ? 'bg-amber-300' : 'bg-emerald-300'}`}
                style={{ width: `${Math.max(0, Math.min(100, option.percentage))}%` }}
              />
            </div>
          </div>
        ))}
        {!visibleOptions.length ? (
          <div className="rounded-[clamp(0.68rem,1.25vw,0.9rem)] border-[max(0.0625rem,0.08vw)] border-white/10 bg-white/8 p-[clamp(0.72rem,1.55vw,0.95rem)] text-center text-[clamp(0.95rem,1.6vw,1.12rem)] font-semibold text-white/72">
            예측이 열리면 자동으로 표시됩니다.
          </div>
        ) : null}
      </div>
    </section>
  );
}
