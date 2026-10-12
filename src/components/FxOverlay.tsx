'use client';

import React from 'react';
import { getBrowserApiBase } from '@/shared/api/http';
import { connectOverlaySocket } from '@/shared/api/overlay-socket';
import { fxPlacementStyle, sampleFxPosition } from '@/shared/lib/fx-placement';
import { createFxMediaCache } from '@/shared/lib/fx-media';

type FxPayload = {
  id?: string;
  deliveryId?: string;
  kind?: 'image' | 'sticker' | 'video' | 'sound' | 'text' | 'tts';
  assetUrl?: string;
  youtubeUrl?: string;
  assetName?: string;
  text?: string;
  overlayId?: string;
  animation?: string;
  animationKey?: string;
  cssCode?: string;
  positionMode?: 'fixed' | 'random';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  xUnit?: '%' | 'px';
  yUnit?: '%' | 'px';
  widthUnit?: '%' | 'px';
  heightUnit?: '%' | 'px';
  durationMs?: number;
  enterCss?: string;
  exitCss?: string;
  chromaKey?: boolean;
  chromaKeyColor?: string;
  chromaKeyTolerance?: number;
  volume?: number;
  voice?: string;
  rate?: number;
  pitch?: number;
};

type FxItem = FxPayload & {
  id: string;
  instanceId: number;
  positionAnchor: { x: number; y: number };
  exiting?: boolean;
  ready?: boolean;
};

function getFxApiBase() {
  const configured = getBrowserApiBase();
  return (configured || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');
}

function getWsUrl(token: string, apiBase?: string) {
  const base = new URL('/api/fx/ws', apiBase || getFxApiBase());
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.searchParams.set('token', token);
  return base.toString();
}

function parseColor(hex = '#00ff00') {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  const value = match?.[1] || '00ff00';
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function youtubeEmbedUrl(url?: string) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    let id = '';
    if (host === 'youtu.be') id = parsed.pathname.slice(1);
    if (host.endsWith('youtube.com')) {
      if (parsed.pathname.startsWith('/shorts/')) id = parsed.pathname.split('/')[2] || '';
      else if (parsed.pathname.startsWith('/embed/')) id = parsed.pathname.split('/')[2] || '';
      else id = parsed.searchParams.get('v') || '';
    }
    if (!id) return '';
    const embed = new URL(`https://www.youtube.com/embed/${encodeURIComponent(id)}`);
    embed.searchParams.set('autoplay', '1');
    embed.searchParams.set('controls', '0');
    embed.searchParams.set('rel', '0');
    embed.searchParams.set('modestbranding', '1');
    return embed.toString();
  } catch {
    return '';
  }
}

function ChromaCanvas({ item, video, onReady, onError }: { item: FxItem; video?: boolean; onReady: () => void; onError: () => void }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const mediaRef = React.useRef<HTMLImageElement & HTMLVideoElement | null>(null);

  React.useEffect(() => {
    let raf = 0;
    let stopped = false;
    const canvas = canvasRef.current;
    const media = mediaRef.current;
    if (!canvas || !media || !item.assetUrl) return undefined;
    const key = parseColor(item.chromaKeyColor);
    const tolerance = Math.max(0, Math.min(160, Number(item.chromaKeyTolerance ?? 42)));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) { onError(); return undefined; }
    let firstFrame = true;
    let previousTime = -1;
    let previousFrameAt = 0;
    let videoFrame = 0;
    const animatedImage = /\.(gif|webp|avif)(?:[?#]|$)/i.test(item.assetUrl);

    const draw = () => {
      if (stopped) return;
      const ready = video ? media.readyState >= 2 : media.complete;
      const width = video ? media.videoWidth : media.naturalWidth;
      const height = video ? media.videoHeight : media.naturalHeight;
      if (ready && width && height && (!video || media.currentTime !== previousTime)) {
        // Process displayed pixels, not a full-resolution source on every frame.
        const scale = Math.min(1, Math.max(1, canvas.clientWidth) / width, Math.max(1, canvas.clientHeight) / height);
        const w = Math.max(1, Math.round(width * scale));
        const h = Math.max(1, Math.round(height * scale));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        try {
          ctx.drawImage(media, 0, 0, w, h);
          const image = ctx.getImageData(0, 0, w, h);
          for (let i = 0; i < image.data.length; i += 4) {
            const dr = image.data[i] - key.r;
            const dg = image.data[i + 1] - key.g;
            const db = image.data[i + 2] - key.b;
            if (dr * dr + dg * dg + db * db <= tolerance * tolerance) image.data[i + 3] = 0;
          }
          ctx.putImageData(image, 0, 0);
          previousTime = media.currentTime;
          if (firstFrame) { firstFrame = false; onReady(); }
        } catch { stopped = true; onError(); }
      }
    };
    const nextFrame = (time: number) => {
      if (stopped) return;
      if (time - previousFrameAt >= 1000 / 30) { previousFrameAt = time; draw(); }
      raf = window.requestAnimationFrame(nextFrame);
    };
    const nextVideoFrame = () => {
      if (stopped) return;
      draw();
      videoFrame = media.requestVideoFrameCallback(nextVideoFrame);
    };

    if (video) {
      const mediaElement = media as HTMLVideoElement;
      mediaElement.muted = true;
      mediaElement.loop = false;
      mediaElement.play().catch(() => undefined);
      if (mediaElement.requestVideoFrameCallback) videoFrame = mediaElement.requestVideoFrameCallback(nextVideoFrame);
      else raf = window.requestAnimationFrame(nextFrame);
    } else {
      const mediaElement = media as HTMLImageElement;
      if (mediaElement.complete) draw();
      else mediaElement.onload = draw;
      if (animatedImage) raf = window.requestAnimationFrame(nextFrame);
    }

    return () => {
      stopped = true;
      if (raf) window.cancelAnimationFrame(raf);
      if (videoFrame) media.cancelVideoFrameCallback(videoFrame);
      media.onload = null;
      if (video) media.pause();
    };
  }, [item.assetUrl, item.chromaKeyColor, item.chromaKeyTolerance, video, onReady, onError]);

  return (
    <>
      {video ? (
        <video ref={mediaRef as React.RefObject<HTMLVideoElement>} crossOrigin="anonymous" src={item.assetUrl} onError={onError} playsInline className="hidden" />
      ) : (
        <img ref={mediaRef as React.RefObject<HTMLImageElement>} crossOrigin="anonymous" src={item.assetUrl} onError={onError} alt="" className="hidden" />
      )}
      <canvas ref={canvasRef} className="h-full w-full object-contain" />
    </>
  );
}

function FxVisual({ item, ready, failed }: { item: FxItem; ready: (id: string) => void; failed: (id: string) => void }) {
  const onReady = React.useCallback(() => ready(item.id), [ready, item.id]);
  const onError = React.useCallback(() => failed(item.id), [failed, item.id]);
  React.useEffect(() => { if (item.kind === 'text') onReady(); }, [item.kind, onReady]);
  if (item.kind === 'text') {
    return (
      <div className="flex h-full w-full items-center justify-center whitespace-pre-wrap break-keep rounded-[min(2vw,1.4rem)] bg-black/46 px-[4%] py-[3%] text-center text-[clamp(1.4rem,4vw,4.5rem)] font-extrabold leading-tight text-white shadow-[0_1.2rem_3rem_rgba(0,0,0,0.28)] [text-shadow:0_0.08em_0.16em_rgba(0,0,0,0.45)]">
        {item.text}
      </div>
    );
  }
  const embed = youtubeEmbedUrl(item.youtubeUrl);
  if (item.kind === 'video' && embed) {
    return <iframe title={item.assetName || 'FX video'} src={embed} onLoad={onReady} onError={onError} allow="autoplay; encrypted-media" className="h-full w-full border-0" />;
  }
  if (item.kind === 'video') {
    return item.chromaKey ? <ChromaCanvas item={item} video onReady={onReady} onError={onError} /> : <video src={item.assetUrl} onLoadedData={onReady} onError={onError} autoPlay playsInline className="h-full w-full object-contain" />;
  }
  return item.chromaKey ? <ChromaCanvas item={item} onReady={onReady} onError={onError} /> : <img src={item.assetUrl} onLoad={onReady} onError={onError} alt="" className="h-full w-full object-contain" />;
}

export function FxOverlay({ token, apiBase, localSocketUrl }: { token: string; apiBase?: string; localSocketUrl?: string }) {
  const [items, setItems] = React.useState<FxItem[]>([]);
  const [viewport, setViewport] = React.useState({ width: 1920, height: 1080 });
  const lifecycles = React.useRef(new Map<string, { start: () => void; cancel: () => void }>());
  const ready = React.useCallback((id: string) => lifecycles.current.get(id)?.start(), []);
  const failed = React.useCallback((id: string) => {
    lifecycles.current.get(id)?.cancel();
    lifecycles.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
    console.warn('[FX] Media could not be loaded');
  }, []);

  const speak = React.useCallback((payload: FxPayload) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const text = String(payload.text || '').trim();
    if (!text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const voiceName = String(payload.voice || '').trim();
    const voice = voices.find((item) => item.name === voiceName);
    if (voice) utterance.voice = voice;
    utterance.rate = Math.max(0.5, Math.min(2, Number(payload.rate || 1)));
    utterance.pitch = Math.max(0.5, Math.min(2, Number(payload.pitch || 1)));
    window.speechSynthesis.speak(utterance);
  }, []);

  React.useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    resize();
    window.addEventListener('resize', resize);
    return () => {
      document.documentElement.style.background = '';
      document.body.style.background = '';
      window.removeEventListener('resize', resize);
    };
  }, []);

  React.useEffect(() => {
    if (!token && !localSocketUrl) return undefined;
    const media = createFxMediaCache();
    const deliveries = new Set<string>();
    const lifetimes = lifecycles.current;
    const timers = new Set<number>();
    let instanceId = 0;
    const later = (callback: () => void, ms: number) => {
      const timer = window.setTimeout(() => { timers.delete(timer); callback(); }, ms);
      timers.add(timer); return timer;
    };
    const cancelTimer = (timer: number) => { window.clearTimeout(timer); timers.delete(timer); };
    const remove = (id: string) => {
      lifetimes.get(id)?.cancel(); lifetimes.delete(id);
      setItems((current) => current.filter((item) => item.id !== id));
    };
    const exit = (id: string) => {
      const lifetime = lifetimes.get(id);
      if (!lifetime) return;
      lifetime.cancel();
      lifetime.start = () => {};
      setItems((current) => current.map((item) => item.id === id ? { ...item, exiting: true } : item));
      const timer = later(() => remove(id), 700);
      lifetime.cancel = () => cancelTimer(timer);
    };
    const onMessage = (event: MessageEvent) => {
        const message = JSON.parse(String(event.data || '{}'));
        if (message?.type === 'fx:preload') {
          if (Array.isArray(message.assets)) message.assets.slice(0, 32).forEach(media.warm);
          return;
        }
        const payload = message.payload as FxPayload;
        if (!payload || typeof payload !== 'object') return;
        if (message?.type === 'fx:update') {
          const targetId = payload.overlayId || payload.id;
          if (!targetId) return;
          setItems((current) => current.map((item) => item.id === targetId ? { ...item, ...payload, id: item.id } : item));
          return;
        }
        if (message?.type === 'fx:hide') {
          const targetId = payload.overlayId || payload.id;
          if (!targetId) return;
          exit(targetId);
          return;
        }
        if (message?.type !== 'fx:play') return;
        // Local delivery and the cloud fallback describe the same execution.
        if (payload.deliveryId) {
          if (deliveries.has(payload.deliveryId)) return;
          deliveries.add(payload.deliveryId);
          if (deliveries.size > 1024) deliveries.delete(deliveries.values().next().value!);
        }
        const id = payload.id || `fx_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        if (payload.kind === 'tts') {
          speak(payload);
          return;
        }
        if (payload.kind === 'sound') {
          if (payload.assetUrl) {
            media.play(payload.assetUrl, Number(payload.volume ?? 1));
          }
          return;
        }
        const positionAnchor = sampleFxPosition();
        lifetimes.get(id)?.cancel();
        let started = false;
        let timer = later(() => remove(id), 15_000);
        const duration = Math.max(250, Math.min(60000, Number(payload.durationMs || 4000)));
        lifetimes.set(id, {
          start: () => {
            if (started) return;
            started = true; cancelTimer(timer);
            setItems((current) => current.map((item) => item.id === id ? { ...item, ready: true } : item));
            timer = later(() => exit(id), duration);
          },
          cancel: () => cancelTimer(timer),
        });
        setItems((current) => [...current.filter((item) => item.id !== id), { ...payload, id, instanceId: ++instanceId, positionAnchor }]);
    };
    const disconnect = token ? connectOverlaySocket({
      url: () => getWsUrl(token, apiBase), onMessage,
    }) : undefined;
    const disconnectLocal = localSocketUrl ? connectOverlaySocket({ url: localSocketUrl, onMessage }) : undefined;
    return () => {
      disconnect?.(); disconnectLocal?.(); media.dispose();
      for (const timer of timers) window.clearTimeout(timer);
      lifetimes.clear(); setItems([]);
    };
  }, [speak, token, apiBase, localSocketUrl]);

  return (
    <main className="fixed inset-0 overflow-hidden bg-transparent">
      <style>{`
        @keyframes fx-pop-in { from { opacity: 0; transform: translate(-50%, -50%) scale(.72); filter: blur(8px); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); filter: blur(0); } }
        @keyframes fx-fade-out { from { opacity: 1; } to { opacity: 0; transform: translate(-50%, -50%) scale(.96); } }
        @keyframes fx-slide-up { from { opacity: 0; transform: translate(-50%, calc(-50% + 3rem)); } to { opacity: 1; transform: translate(-50%, -50%); } }
        @keyframes fx-spin-in { from { opacity: 0; transform: translate(-50%, -50%) rotate(-18deg) scale(.65); } to { opacity: 1; transform: translate(-50%, -50%) rotate(0) scale(1); } }
      `}</style>
      {items.map((item) => (
        <div
          key={item.instanceId}
          className="absolute"
          style={{
            ...fxPlacementStyle(item, viewport),
            transform: 'translate(-50%, -50%)',
            visibility: item.ready ? 'visible' : 'hidden',
          }}
        >
          <div className={`absolute h-full w-full ${String(item.animationKey || '').replace(/[^\w:-]+/g, ' ').trim()}`} style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)', animation: item.ready ? item.exiting ? (item.exitCss || undefined) : (item.animation || item.enterCss || undefined) : undefined }}>
            {item.cssCode ? <style>{item.cssCode}</style> : null}
            <FxVisual item={item} ready={ready} failed={failed} />
          </div>
        </div>
      ))}
    </main>
  );
}
