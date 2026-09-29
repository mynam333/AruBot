'use client';

import { useEffect, useRef, useState } from 'react';
import { PredictionOverlayCard } from '@/features/predictions/prediction-overlay-card';
import { apiWsUrl, readJson } from '@/shared/api/http';
import { connectOverlaySocket } from '@/shared/api/overlay-socket';

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

type OverlayPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const OVERLAY_POSITION_CLASSES: Record<OverlayPosition, string> = {
  'top-left': 'items-start justify-start',
  'top-right': 'items-start justify-end',
  'bottom-left': 'items-end justify-start',
  'bottom-right': 'items-end justify-end',
};

function normalizeOverlayPosition(value: string | null): OverlayPosition {
  if (value === 'top-left' || value === 'top-right' || value === 'bottom-left' || value === 'bottom-right') {
    return value;
  }
  return 'bottom-right';
}

export function PredictionOverlay({ channelUid }: { channelUid: string }) {
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [position, setPosition] = useState<OverlayPosition>('bottom-right');
  const [hiddenResultId, setHiddenResultId] = useState<string | null>(null);
  const playedResultRef = useRef('');
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setPosition(normalizeOverlayPosition(params.get('position')));
  }, []);

  useEffect(() => {
    if (!channelUid) return;
    let disposed = false;
    let version = 0;
    let fallback: AbortController | null = null;
    const load = async () => {
      if (disposed || fallback) return;
      const requestedVersion = version;
      const controller = new AbortController();
      fallback = controller;
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const data = await readJson<PublicPredictionResponse>(`/api/public/${encodeURIComponent(channelUid)}/prediction`, { signal: controller.signal });
        if (!disposed && version === requestedVersion) setPrediction(data?.prediction || null);
      } catch {} finally {
        clearTimeout(timeout);
        fallback = null;
      }
    };
    const disconnect = connectOverlaySocket({
      url: () => apiWsUrl(`/api/prediction/ws?channelUid=${encodeURIComponent(channelUid)}`),
      onRetry: () => { void load(); },
      onMessage: (event) => {
        try {
          const message = JSON.parse(String(event.data || '{}')) as { type?: string; prediction?: Prediction | null };
          if (message.type === 'prediction:clear') {
            version += 1;
            setPrediction(null);
            return;
          }
          if (message.type === 'prediction:snapshot' || message.type === 'prediction:update') {
            version += 1;
            setPrediction(message.prediction || null);
          }
        } catch {}
      },
    });
    return () => {
      disposed = true;
      fallback?.abort();
      disconnect();
    };
  }, [channelUid]);

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

  if (!displayPrediction) return null;

  return (
    <main className={`viewer-surface flex h-screen w-screen bg-transparent p-[clamp(0.65rem,1.7vw,1.15rem)] ${OVERLAY_POSITION_CLASSES[position]}`}>
      <PredictionOverlayCard prediction={displayPrediction} />
    </main>
  );
}
