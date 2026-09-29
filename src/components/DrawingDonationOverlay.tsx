'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiWsUrl, getBrowserApiBase } from '@/shared/api/http';
import { createItemRenderer, loadDrawingOriginal } from '@/shared/drawing/item-renderer';
import { connectDrawingOverlay, scheduleDrawingOverlayReload } from '@/shared/drawing/overlay-connection';
import { RENDERER_VERSION } from '../../shared/drawing/document.js';

type BrushState = { type?: string; color?: string; alpha?: number; size?: number };
type StrokePoint = { x: number; y: number; p?: number; t: number; replayT?: number };
type Stroke = { id?: string; brush?: BrushState; points?: StrokePoint[] };
type DrawingItem = {
  id: string;
  strokes?: Stroke[];
  canvas?: { widthRatio?: number; heightRatio?: number };
  replay?: { speed?: number; targetReplayMs?: number; idleCapMs?: number };
  resultHoldSec?: number;
};

const MAX_CANVAS_DPR = 2;
const FADE_OUT_MS = 850;
const DRAWING_ALERT_AUDIO_SRC = '/files/drawing_alert.mp3';

export default function DrawingDonationOverlay({ viewerToken }: { viewerToken: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const alertAudioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const animationRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const completionTimerRef = useRef<number | null>(null);
  const playingIdRef = useRef<string | null>(null);
  const lastRenderedMsRef = useRef(0);
  const [item, setItem] = useState<DrawingItem | null>(null);

  const apiBase = useMemo(() => (getBrowserApiBase() || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, ''), []);
  const rendererRef = useRef<ReturnType<typeof createItemRenderer> | null>(null);
  const originalRef = useRef<HTMLImageElement | null>(null);
  const [originalReady, setOriginalReady] = useState(false);
  const [renderError, setRenderError] = useState('');
  const [connectionLost, setConnectionLost] = useState(false);
  const [updateRequired, setUpdateRequired] = useState(false);
  useEffect(() => () => {
    playingIdRef.current = null;
    if (completionTimerRef.current) window.clearTimeout(completionTimerRef.current);
    rendererRef.current?.clear();
  }, []);
  useEffect(() => {
    originalRef.current = null; setOriginalReady(false); setRenderError('');
    if (!item) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      controller = new AbortController();
      timeout = setTimeout(() => controller?.abort(), 20000);
      try {
        const original = await loadDrawingOriginal(item, viewerToken, controller.signal);
        if (disposed) return;
        originalRef.current = original;
        setRenderError('');
        setOriginalReady(true);
      } catch {
        if (disposed) return;
        setRenderError('그림 원본을 다시 불러오는 중입니다. 복구되지 않으면 자동으로 새로고침합니다.');
        retryTimer = setTimeout(() => { void load(); }, 3000);
      } finally {
        if (timeout !== null) clearTimeout(timeout);
      }
    };
    void load();
    return () => {
      disposed = true;
      controller?.abort();
      if (retryTimer !== null) clearTimeout(retryTimer);
      if (timeout !== null) clearTimeout(timeout);
    };
  }, [item, viewerToken]);

  const reloadDelay = updateRequired ? 15000 : renderError ? 60000 : connectionLost ? 120000 : 0;
  useEffect(() => reloadDelay ? scheduleDrawingOverlayReload(reloadDelay) : undefined, [reloadDelay]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ratio = Math.max(1, Math.min(MAX_CANVAS_DPR, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.floor(window.innerWidth * ratio));
    const height = Math.max(1, Math.floor(window.innerHeight * ratio));
    let resized = false;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      resized = true;
    }
    const ctx = ctxRef.current || canvas.getContext('2d', { alpha: true, desynchronized: true });
    ctxRef.current = ctx;
    return ctx ? { canvas, ctx, width, height, resized } : null;
  }, []);

  const renderAt = useCallback((atMs = Infinity) => {
    const target = resizeCanvas();
    if (!target) return;
    if (!rendererRef.current) rendererRef.current = createItemRenderer();
    if (item && atMs > 0) rendererRef.current.draw(target.ctx, item, target.width, target.height, atMs, originalRef.current);
    else target.ctx.clearRect(0, 0, target.width, target.height);
    lastRenderedMsRef.current = Number.isFinite(atMs) ? Math.max(0, atMs) : Number.POSITIVE_INFINITY;
  }, [item, resizeCanvas]);

  const setCanvasOpacity = useCallback((opacity: number, transitionMs = 0) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.transition = transitionMs > 0 ? `opacity ${transitionMs}ms ease` : 'none';
    canvas.style.opacity = String(opacity);
  }, []);

  const playDrawingAlert = useCallback(() => {
    const audio = alertAudioRef.current;
    if (!audio) return;
    audio.pause();
    audio.volume = 1;
    try {
      audio.currentTime = 0;
      const playback = audio.play();
      void playback.catch(() => undefined);
    } catch {
      // Audio playback failures must never interrupt the drawing replay.
    }
  }, []);

  const pop = useCallback(async (completedItemId: string) => {
    const complete = async () => {
      if (playingIdRef.current !== completedItemId) return;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${apiBase}/api/drawing-donation/pop-by-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: viewerToken, itemId: completedItemId }),
        signal: controller.signal,
      }).catch(() => null).finally(() => window.clearTimeout(timeout));
      if (playingIdRef.current !== completedItemId) return;
      if (!response || (!response.ok && response.status !== 409)) {
        completionTimerRef.current = window.setTimeout(() => { void complete(); }, 3000);
        return;
      }
      playingIdRef.current = null;
      setItem((current) => current?.id === completedItemId ? null : current);
    };
    await complete();
  }, [apiBase, viewerToken]);

  const applyIncomingItem = useCallback((nextItem: DrawingItem | null) => {
    if (!nextItem?.id) {
      playingIdRef.current = null;
      setItem(null);
      return;
    }
    if (nextItem.id === playingIdRef.current) return;
    playingIdRef.current = nextItem.id;
    originalRef.current = null;
    setOriginalReady(false);
    playDrawingAlert();
    setItem(nextItem);
  }, [playDrawingAlert]);

  useEffect(() => {
    const audio = alertAudioRef.current;
    if (!audio) return;
    audio.load();
    return () => {
      audio.pause();
      try { audio.currentTime = 0; } catch {}
    };
  }, []);

  useEffect(() => {
    return connectDrawingOverlay<DrawingItem>({
      url: apiWsUrl(`/api/drawing-donation/ws?token=${encodeURIComponent(viewerToken)}&renderer=${encodeURIComponent(RENDERER_VERSION)}`, apiBase),
      onItem: applyIncomingItem,
      onUpdateRequired: setUpdateRequired,
      onConnectionChange: (connected) => setConnectionLost(!connected),
    });
  }, [apiBase, applyIncomingItem, viewerToken]);

  useEffect(() => {
    if (!item || !originalReady) {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      if (fadeTimerRef.current) window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
      setCanvasOpacity(0, 0);
      renderAt(0);
      return;
    }
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (fadeTimerRef.current) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    setCanvasOpacity(1, 0);
    renderAt(0);
    const replayMs = Math.max(1, Number(item.replay?.targetReplayMs || 12000) || 12000);
    const holdMs = Math.max(1000, Number(item.resultHoldSec || 8) * 1000);
    const startedAt = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startedAt;
      if (elapsed < replayMs) {
        renderAt(elapsed);
        animationRef.current = requestAnimationFrame(tick);
        return;
      }
      renderAt(Infinity);
      holdTimerRef.current = window.setTimeout(() => {
        setCanvasOpacity(0, FADE_OUT_MS);
        fadeTimerRef.current = window.setTimeout(() => {
          renderAt(0);
          void pop(item.id);
        }, FADE_OUT_MS);
      }, holdMs);
    };
    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      if (holdTimerRef.current) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      if (fadeTimerRef.current) {
        window.clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, [item, originalReady, pop, renderAt, setCanvasOpacity]);

  useEffect(() => {
    const onResize = () => renderAt(item ? lastRenderedMsRef.current : 0);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [item, renderAt]);

  return (
    <>
      <audio ref={alertAudioRef} src={DRAWING_ALERT_AUDIO_SRC} preload="auto" playsInline aria-hidden="true" />
      {updateRequired || renderError ? <div role="alert" style={{ position: 'fixed', left: 16, bottom: 16, color: '#fff', background: '#991b1b', padding: 10, fontSize: 14 }}>{updateRequired ? '그림 렌더러를 업데이트하기 위해 자동으로 새로고침합니다.' : renderError}</div> : null}
      <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', background: 'transparent', opacity: 0, willChange: 'opacity' }} />
    </>
  );
}
