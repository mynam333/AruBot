'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PredictionOverlayCard } from '@/features/predictions/prediction-overlay-card';
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
  const [preview, setPreview] = useState(false);
  const [position, setPosition] = useState<OverlayPosition>('bottom-right');
  const [hiddenResultId, setHiddenResultId] = useState<string | null>(null);
  const playedResultRef = useRef('');
  const hideTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    const data = await readJson<PublicPredictionResponse>(`/api/public/${encodeURIComponent(channelUid)}/prediction`);
    setPrediction(data?.prediction || null);
  }, [channelUid]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setPreview(params.get('preview') === '1');
    setPosition(normalizeOverlayPosition(params.get('position')));
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

  if (!displayPrediction && !preview) return null;

  return (
    <main className={`viewer-surface flex h-screen w-screen bg-transparent p-[clamp(0.65rem,1.7vw,1.15rem)] ${OVERLAY_POSITION_CLASSES[position]}`}>
      <PredictionOverlayCard prediction={displayPrediction} />
    </main>
  );
}
