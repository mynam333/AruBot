'use client';

import React from 'react';
import { getBrowserApiBase } from '@/shared/api/http';

type FxPayload = {
  id?: string;
  kind?: 'image' | 'sticker' | 'video' | 'sound' | 'text' | 'tts';
  assetUrl?: string;
  youtubeUrl?: string;
  assetName?: string;
  text?: string;
  overlayId?: string;
  animation?: string;
  animationKey?: string;
  cssCode?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
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
  exiting?: boolean;
};

function getFxApiBase() {
  const configured = getBrowserApiBase();
  return (configured || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');
}

function getWsUrl(token: string) {
  const base = new URL('/api/fx/ws', getFxApiBase());
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

function ChromaCanvas({ item, video }: { item: FxItem; video?: boolean }) {
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

    const draw = () => {
      if (stopped) return;
      const width = video ? (media.videoWidth || 1280) : (media.naturalWidth || 800);
      const height = video ? (media.videoHeight || 720) : (media.naturalHeight || 450);
      if (width && height) {
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(media, 0, 0, width, height);
          const image = ctx.getImageData(0, 0, width, height);
          for (let i = 0; i < image.data.length; i += 4) {
            const dr = image.data[i] - key.r;
            const dg = image.data[i + 1] - key.g;
            const db = image.data[i + 2] - key.b;
            if (Math.sqrt(dr * dr + dg * dg + db * db) <= tolerance) image.data[i + 3] = 0;
          }
          ctx.putImageData(image, 0, 0);
        }
      }
      if (video) raf = window.requestAnimationFrame(draw);
    };

    if (video) {
      const mediaElement = media as HTMLVideoElement;
      mediaElement.muted = true;
      mediaElement.loop = false;
      mediaElement.play().catch(() => undefined);
      raf = window.requestAnimationFrame(draw);
    } else {
      const mediaElement = media as HTMLImageElement;
      if (mediaElement.complete) draw();
      else mediaElement.onload = draw;
    }

    return () => {
      stopped = true;
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [item.assetUrl, item.chromaKeyColor, item.chromaKeyTolerance, video]);

  return (
    <>
      {video ? (
        <video ref={mediaRef as React.RefObject<HTMLVideoElement>} src={item.assetUrl} playsInline className="hidden" />
      ) : (
        <img ref={mediaRef as React.RefObject<HTMLImageElement>} src={item.assetUrl} alt="" className="hidden" />
      )}
      <canvas ref={canvasRef} className="h-full w-full object-contain" />
    </>
  );
}

function FxVisual({ item }: { item: FxItem }) {
  if (item.kind === 'text') {
    return (
      <div className="flex h-full w-full items-center justify-center whitespace-pre-wrap break-keep rounded-[min(2vw,1.4rem)] bg-black/46 px-[4%] py-[3%] text-center text-[clamp(1.4rem,4vw,4.5rem)] font-extrabold leading-tight text-white shadow-[0_1.2rem_3rem_rgba(0,0,0,0.28)] [text-shadow:0_0.08em_0.16em_rgba(0,0,0,0.45)]">
        {item.text}
      </div>
    );
  }
  const embed = youtubeEmbedUrl(item.youtubeUrl);
  if (item.kind === 'video' && embed) {
    return <iframe title={item.assetName || 'FX video'} src={embed} allow="autoplay; encrypted-media" className="h-full w-full border-0" />;
  }
  if (item.kind === 'video') {
    return item.chromaKey ? <ChromaCanvas item={item} video /> : <video src={item.assetUrl} autoPlay playsInline className="h-full w-full object-contain" />;
  }
  return item.chromaKey ? <ChromaCanvas item={item} /> : <img src={item.assetUrl} alt="" className="h-full w-full object-contain" />;
}

export function FxOverlay({ token }: { token: string }) {
  const [items, setItems] = React.useState<FxItem[]>([]);

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
    return () => {
      document.documentElement.style.background = '';
      document.body.style.background = '';
    };
  }, []);

  React.useEffect(() => {
    if (!token) return undefined;
    let closed = false;
    let reconnectTimer = 0;
    let ws: WebSocket | null = null;

    const connect = () => {
      ws = new WebSocket(getWsUrl(token));
      ws.onmessage = (event) => {
        const message = JSON.parse(String(event.data || '{}'));
        const payload = message.payload as FxPayload;
        if (message?.type === 'fx:update') {
          const targetId = payload.overlayId || payload.id;
          if (!targetId) return;
          setItems((current) => current.map((item) => item.id === targetId ? { ...item, ...payload, id: item.id } : item));
          return;
        }
        if (message?.type === 'fx:hide') {
          const targetId = payload.overlayId || payload.id;
          if (!targetId) return;
          setItems((current) => current.map((item) => item.id === targetId ? { ...item, exiting: true } : item));
          window.setTimeout(() => {
            setItems((current) => current.filter((item) => item.id !== targetId));
          }, 700);
          return;
        }
        if (message?.type !== 'fx:play') return;
        const id = payload.id || `fx_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        if (payload.kind === 'tts') {
          speak(payload);
          return;
        }
        if (payload.kind === 'sound') {
          if (payload.assetUrl) {
            const audio = new Audio(payload.assetUrl);
            audio.volume = Math.max(0, Math.min(1, Number(payload.volume ?? 1)));
            audio.play().catch(() => undefined);
          }
          return;
        }
        setItems((current) => [...current, { ...payload, id }]);
        const duration = Math.max(250, Math.min(60000, Number(payload.durationMs || 4000)));
        window.setTimeout(() => {
          setItems((current) => current.map((item) => item.id === id ? { ...item, exiting: true } : item));
          window.setTimeout(() => {
            setItems((current) => current.filter((item) => item.id !== id));
          }, 700);
        }, duration);
      };
      ws.onclose = () => {
        if (!closed) reconnectTimer = window.setTimeout(connect, 1500);
      };
      ws.onerror = () => {
        try { ws?.close(); } catch { /* ignore */ }
      };
    };
    connect();

    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      try { ws?.close(); } catch { /* ignore */ }
    };
    }, [speak, token]);

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
          key={item.id}
          className={`absolute ${String(item.animationKey || '').replace(/[^\w:-]+/g, ' ').trim()}`}
          style={{
            left: `${Number(item.x ?? 50)}%`,
            top: `${Number(item.y ?? 50)}%`,
            width: `${Number(item.width ?? 30)}vw`,
            height: `${Number(item.height ?? 30)}vh`,
            transform: 'translate(-50%, -50%)',
            animation: item.exiting ? (item.exitCss || undefined) : (item.animation || item.enterCss || undefined),
          }}
        >
          {item.cssCode ? <style>{item.cssCode}</style> : null}
          <FxVisual item={item} />
        </div>
      ))}
    </main>
  );
}
