'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { readJson } from '@/shared/api/http';

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
  totalPoints: number;
  participantCount: number;
};

type PublicPredictionResponse = {
  prediction: Prediction | null;
};

function formatPoints(value: number) {
  return `${Number(value || 0).toLocaleString('ko-KR')}P`;
}

export function PredictionOverlay({ channelUid }: { channelUid: string }) {
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [preview, setPreview] = useState(false);

  const load = useCallback(async () => {
    const data = await readJson<PublicPredictionResponse>(`/api/public/${encodeURIComponent(channelUid)}/prediction`);
    setPrediction(data?.prediction || null);
  }, [channelUid]);

  useEffect(() => {
    setPreview(new URLSearchParams(window.location.search).get('preview') === '1');
    load();
    const timer = window.setInterval(load, 2200);
    return () => window.clearInterval(timer);
  }, [load]);

  const visibleOptions = useMemo(() => prediction?.options || [], [prediction]);

  if (!prediction && !preview) return null;

  return (
    <main className="viewer-surface grid min-h-screen place-items-end bg-transparent p-[clamp(1rem,3vw,2rem)]">
      <section className="w-[min(42rem,92vw)] overflow-hidden rounded-[clamp(1rem,2vw,1.6rem)] border border-white/14 bg-[linear-gradient(135deg,rgba(18,24,38,0.86),rgba(28,34,54,0.72))] p-[clamp(1rem,2.4vw,1.6rem)] text-white shadow-[0_1.5rem_4rem_rgba(0,0,0,0.34)] backdrop-blur-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[clamp(1rem,2vw,1.35rem)] font-bold leading-tight">
              {prediction?.question || '예측 베팅 대기 중'}
            </div>
            <div className="mt-2 text-[clamp(0.72rem,1.4vw,0.9rem)] text-white/68">
              {formatPoints(prediction?.totalPoints || 0)} · {prediction?.participantCount || 0}명 참여 · !투표 &lt;번호&gt; &lt;배팅 포인트&gt;
            </div>
          </div>
          <div className="shrink-0 rounded-full border border-emerald-300/25 bg-emerald-300/14 px-[clamp(0.6rem,1.5vw,0.9rem)] py-[clamp(0.3rem,0.9vw,0.45rem)] text-[clamp(0.7rem,1.2vw,0.82rem)] font-bold text-emerald-100">
            LIVE
          </div>
        </div>

        <div className="mt-[clamp(0.9rem,2vw,1.25rem)] grid max-h-[min(54vh,28rem)] gap-[clamp(0.55rem,1.2vw,0.8rem)] overflow-hidden">
          {visibleOptions.map((option, index) => (
            <div key={option.id} className="grid gap-1">
              <div className="flex items-center justify-between gap-3 text-[clamp(0.78rem,1.45vw,0.95rem)]">
                <div className="min-w-0 truncate font-semibold">
                  {index + 1}. {option.label}
                </div>
                <div className="shrink-0 font-bold text-white">
                  {option.percentage}% {option.payoutMultiplier ? <span className="text-white/58">x{option.payoutMultiplier}</span> : null}
                </div>
              </div>
              <div className="h-[clamp(0.45rem,1vw,0.7rem)] overflow-hidden rounded-full bg-white/12">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#8ee8d8,#ffc7b5,#d7c3ff)] transition-all duration-700"
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
