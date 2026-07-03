import { useCallback, useEffect, useRef, useState } from 'react';
import { getBrowserApiBase } from '@/shared/api/http';

type PlaybackTarget = {
  atSec?: number;
  paused?: boolean;
  force?: boolean;
};

function getPlaybackAtSec(item: any, payload: any) {
  const start = Math.max(0, Math.floor(Number(item?.startSec || 0) || 0));
  const explicitAtSec = Number(payload?.atSec);
  if (Number.isFinite(explicitAtSec) && explicitAtSec >= 0) {
    return Math.max(start, Math.floor(explicitAtSec));
  }

  if (payload?.paused === true) return start;

  const startedAt = Number(payload?.startedAt || 0) || 0;
  if (!startedAt) return start;

  const serverNow = Number(payload?.serverNow || 0) || 0;
  const referenceNow = serverNow || Date.now();
  return Math.max(start, Math.floor((referenceNow - startedAt) / 1000) + start);
}

export default function PvdViewer({ viewerToken }: { viewerToken?: string } = {}) {
  const [token, setToken] = useState<string>(viewerToken || '');
  const [volume, setVolume] = useState(100);
  const [externalItem, setExternalItem] = useState<any | null>(null);
  const playerDivRef = useRef<HTMLDivElement | null>(null);
  const externalFrameRef = useRef<HTMLIFrameElement | null>(null);
  const externalVideoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<any>(null);
  const volumeRef = useRef(100);
  const externalProviderRef = useRef<string | null>(null);
  const externalMediaKeyRef = useRef<string | null>(null);
  const pollTimerRef = useRef<any>(null);
  const currentVidRef = useRef<string | null>(null);
  const currentStartRef = useRef<number>(0);
  const reconnectRef = useRef<{ attempts: number; timer: any; closed: boolean }>({ attempts: 0, timer: null, closed: false });
  const volumeEmitTimerRef = useRef<any>(null);
  const ytReadyPromiseRef = useRef<Promise<any> | null>(null);
  const ensureSeqRef = useRef<number>(0);
  const lastServerSyncRef = useRef<number>(0);
  const lastEmitRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const suppressUntilRef = useRef<number>(0);

  // Parse token from /pvd/:token
  useEffect(() => {
    if (viewerToken) {
      setToken(viewerToken);
      return;
    }
    const parts = (typeof window !== 'undefined' ? window.location.pathname : '').split('/').filter(Boolean);
    const idx = parts.indexOf('pvd');
    const t = idx >= 0 && parts[idx + 1] ? parts[idx + 1] : '';
    setToken(t);
  }, [viewerToken]);

  const getViewerApiBase = useCallback(() => {
    return (getBrowserApiBase() || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');
  }, []);

  const getYouTubeApi = useCallback(() => {
    const win = window as any;
    if (win.YT && win.YT.Player) return Promise.resolve(win.YT);
    if (ytReadyPromiseRef.current) return ytReadyPromiseRef.current;

    ytReadyPromiseRef.current = new Promise((resolve) => {
      const previousReady = win.onYouTubeIframeAPIReady;
      win.onYouTubeIframeAPIReady = () => {
        try { previousReady && previousReady(); } catch {}
        resolve(win.YT);
      };

      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        tag.async = true;
        document.body.appendChild(tag);
      }
    });

    return ytReadyPromiseRef.current;
  }, []);

  const getItemProvider = useCallback((item: any) => {
    return String(item?.mediaProvider || 'youtube').toLowerCase();
  }, []);

  const getMediaKey = useCallback((item: any) => {
    const provider = getItemProvider(item);
    return `${provider}:${item?.mediaId || item?.videoId || item?.embedUrl || item?.mediaUrl || ''}`;
  }, [getItemProvider]);

  const postToExternalPlayer = useCallback((message: Record<string, unknown>) => {
    const frame = externalFrameRef.current;
    if (!frame?.contentWindow) return;
    try {
      frame.contentWindow.postMessage({ ...message, 'x-tiktok-player': true }, '*');
    } catch {}
  }, []);

  const buildExternalSrc = useCallback((item: any, atSec: number, paused?: boolean) => {
    const provider = getItemProvider(item);
    let src = String(item?.embedUrl || item?.mediaUrl || '');
    if (!src && provider === 'chzzk_clip' && item?.mediaId) src = `https://chzzk.naver.com/embed/clip/${encodeURIComponent(String(item.mediaId))}`;
    if (!src && provider === 'cime_clip' && item?.mediaId) src = `https://ci.me/clips/${encodeURIComponent(String(item.mediaId))}`;
    if (!src && provider === 'tiktok' && item?.mediaId) src = `https://www.tiktok.com/player/v1/${encodeURIComponent(String(item.mediaId))}`;
    if (!src) return '';
    try {
      const url = new URL(src);
      if (provider === 'cime_clip' && /\.(mp4|webm|ogg)(?:$|[?#])/i.test(url.pathname)) {
        return url.toString();
      }
      if (provider === 'tiktok') {
        url.searchParams.set('autoplay', paused ? '0' : '1');
        url.searchParams.set('controls', '1');
        url.searchParams.set('progress_bar', '1');
        url.searchParams.set('play_button', '1');
        url.searchParams.set('volume_control', '1');
        url.searchParams.set('fullscreen_button', '1');
      } else if (provider === 'chzzk_clip') {
        url.searchParams.set('autoplay', paused ? 'false' : 'true');
      }
      if (Number.isFinite(atSec) && atSec > 0) url.searchParams.set('start', String(Math.floor(atSec)));
      return url.toString();
    } catch {
      return src;
    }
  }, [getItemProvider]);

  const applyVolume = useCallback((nextVolume: number) => {
    const normalized = Math.max(0, Math.min(100, Math.round(Number(nextVolume || 0))));
    volumeRef.current = normalized;
    setVolume(normalized);
    const player = playerRef.current;
    const video = externalVideoRef.current;
    if (video) {
      try {
        video.volume = normalized / 100;
        video.muted = normalized <= 0;
      } catch {}
    }
    if (!player) {
      if (externalProviderRef.current === 'tiktok') {
        postToExternalPlayer({ type: normalized <= 0 ? 'mute' : 'unMute' });
      }
      return;
    }
    try {
      if (player.setVolume) player.setVolume(normalized);
      if (normalized <= 0) {
        player.mute && player.mute();
      } else {
        player.unMute && player.unMute();
      }
    } catch {}
    if (externalProviderRef.current === 'tiktok') {
      postToExternalPlayer({ type: normalized <= 0 ? 'mute' : 'unMute' });
    }
  }, [postToExternalPlayer]);

  const emitControl = useCallback((op: 'pause' | 'play' | 'seek' | 'volume', atSec?: number, nextVolume?: number) => {
    if (!token) return;
    const apiBase = getViewerApiBase();
    const body = { token, op, atSec, volume: nextVolume } as any;
    fetch(`${apiBase}/api/video-donation/control-by-token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).catch(() => {});
  }, [getViewerApiBase, token]);

  const emitVolumeControl = useCallback((nextVolume: number) => {
    try { clearTimeout(volumeEmitTimerRef.current); } catch {}
    volumeEmitTimerRef.current = setTimeout(() => {
      emitControl('volume', undefined, nextVolume);
    }, 180);
  }, [emitControl]);

  const applyPlaybackTarget = useCallback((targetSec: number, paused?: boolean, force?: boolean) => {
    const player = playerRef.current;
    if (!player) return;

    const target = Math.max(0, Math.floor(targetSec));
    let current = target;
    try {
      if (player.getCurrentTime) current = Number(player.getCurrentTime());
    } catch {}

    const drift = Math.abs(current - target);
    const shouldSeek = force === true || drift > 1.25;
    suppressUntilRef.current = Date.now() + 1000;

    try {
      if (shouldSeek && player.seekTo) player.seekTo(target, true);
      lastTimeRef.current = target;
    } catch {}

    try {
      if (paused || document.hidden) {
        player.pauseVideo && player.pauseVideo();
      } else {
        player.playVideo && player.playVideo();
      }
    } catch {}
  }, []);

  const applyExternalPlaybackTarget = useCallback((targetSec: number, paused?: boolean) => {
    const provider = externalProviderRef.current;
    const target = Math.max(0, Math.floor(Number(targetSec || 0)));
    lastTimeRef.current = target;
    const video = externalVideoRef.current;
    if (video) {
      try {
        if (Math.abs(Number(video.currentTime || 0) - target) > 1.25) video.currentTime = target;
        if (paused) {
          video.pause();
        } else {
          const result = video.play();
          if (result && typeof result.catch === 'function') result.catch(() => {});
        }
      } catch {}
      return;
    }
    if (provider === 'tiktok') {
      postToExternalPlayer({ type: 'seekTo', value: target });
      postToExternalPlayer({ type: paused ? 'pause' : 'play' });
    }
  }, [postToExternalPlayer]);

  const stopPlayer = useCallback(() => {
    try { playerRef.current && playerRef.current.stopVideo && playerRef.current.stopVideo(); } catch {}
    try { playerRef.current && playerRef.current.destroy && playerRef.current.destroy(); } catch {}
    playerRef.current = null;
    setExternalItem(null);
    externalFrameRef.current = null;
    externalVideoRef.current = null;
    externalProviderRef.current = null;
    externalMediaKeyRef.current = null;
    currentVidRef.current = null;
    currentStartRef.current = 0;
  }, []);

  const report = useCallback((cause: 'error' | 'end') => {
    if (!token) return;
    const apiBase = getViewerApiBase();
    fetch(`${apiBase}/api/video-donation/pop-by-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, cause })
    }).catch(() => {});
    stopPlayer();
  }, [getViewerApiBase, stopPlayer, token]);

  const ensurePlayer = useCallback((videoId: string, start: number, opts?: PlaybackTarget) => {
    const seq = ++ensureSeqRef.current;
    const safeStart = Math.max(0, Math.floor(Number(start || 0)));
    const target = Math.max(safeStart, Math.floor(Number(opts?.atSec ?? safeStart)));

    void getYouTubeApi().then((YT) => {
      if (seq !== ensureSeqRef.current || !YT || !YT.Player || !playerDivRef.current) return;
      setExternalItem(null);
      externalProviderRef.current = null;
      externalMediaKeyRef.current = null;

      const sameItem = currentVidRef.current === videoId && currentStartRef.current === safeStart && playerRef.current;
      if (sameItem) {
        applyPlaybackTarget(target, opts?.paused, opts?.force);
        return;
      }

      const shouldAutoplay = opts?.paused ? 0 : (document.hidden ? 0 : 1);
      const playerVars = {
        autoplay: shouldAutoplay,
        start: target,
        playsinline: 1,
        controls: 0,
        disablekb: 1,
        rel: 0,
        modestbranding: 1,
        origin: window.location.origin
      };

      const onError = () => report('error');
      const onStateChange = (e: any) => {
        try {
          const t = playerRef.current && playerRef.current.getCurrentTime ? Number(playerRef.current.getCurrentTime()) : 0;
          lastTimeRef.current = t;
          const now = Date.now();
          if (e && e.data === YT.PlayerState.ENDED) {
            report('end');
          } else if (e && e.data === YT.PlayerState.PAUSED) {
            if (!document.hidden && now > suppressUntilRef.current && now - lastEmitRef.current > 300) { lastEmitRef.current = now; emitControl('pause', Math.floor(t)); }
          } else if (e && e.data === YT.PlayerState.PLAYING) {
            if (!document.hidden && now > suppressUntilRef.current && now - lastEmitRef.current > 300) { lastEmitRef.current = now; emitControl('play', Math.floor(t)); }
          }
        } catch {}
      };
      const onReady = () => {
        applyVolume(volumeRef.current);
        applyPlaybackTarget(target, opts?.paused, true);
      };

      if (!playerRef.current) {
        playerRef.current = new YT.Player(playerDivRef.current, {
          width: '100%', height: '100%', videoId,
          playerVars,
          events: { onError, onReady, onStateChange }
        });
      } else {
        try {
          suppressUntilRef.current = Date.now() + 1000;
          playerRef.current.loadVideoById({ videoId, startSeconds: target });
        } catch {
          try { playerRef.current.destroy(); } catch {}
          playerRef.current = new YT.Player(playerDivRef.current, {
            width: '100%', height: '100%', videoId,
            playerVars,
            events: { onError, onReady, onStateChange }
          });
        }
      }

      currentVidRef.current = videoId;
      currentStartRef.current = safeStart;
      lastTimeRef.current = target;

      setTimeout(() => {
        applyVolume(volumeRef.current);
        applyPlaybackTarget(target, opts?.paused, true);
      }, 250);
    }).catch(() => {});
  }, [applyPlaybackTarget, applyVolume, emitControl, getYouTubeApi, report]);

  const ensureExternalPlayer = useCallback((item: any, opts?: PlaybackTarget) => {
    const provider = getItemProvider(item);
    const start = Math.max(0, Math.floor(Number(item?.startSec || 0) || 0));
    const target = Math.max(start, Math.floor(Number(opts?.atSec ?? start)));
    const key = getMediaKey(item);
    externalProviderRef.current = provider;

    try { playerRef.current && playerRef.current.stopVideo && playerRef.current.stopVideo(); } catch {}
    try { playerRef.current && playerRef.current.destroy && playerRef.current.destroy(); } catch {}
    playerRef.current = null;
    currentVidRef.current = null;
    currentStartRef.current = 0;

    if (externalMediaKeyRef.current === key && externalFrameRef.current) {
      applyExternalPlaybackTarget(target, opts?.paused);
      return;
    }

    externalMediaKeyRef.current = key;
    lastTimeRef.current = target;
    setExternalItem({
      ...item,
      viewerSrc: buildExternalSrc(item, target, opts?.paused),
      provider,
      mediaKey: key,
      targetAtSec: target,
      paused: opts?.paused === true,
      isDirectVideo: provider === 'cime_clip' && /\.(mp4|webm|ogg)(?:$|[?#])/i.test(String(item?.embedUrl || item?.mediaUrl || '')),
      blockedReason: null,
    });
    setTimeout(() => {
      applyVolume(volumeRef.current);
      applyExternalPlaybackTarget(target, opts?.paused);
    }, 450);
  }, [applyExternalPlaybackTarget, applyVolume, buildExternalSrc, getItemProvider, getMediaKey]);

  const resyncFromServer = useCallback(async (force = false) => {
    if (!token) return;
    const now = Date.now();
    if (!force && now - lastServerSyncRef.current < 1000) return;
    lastServerSyncRef.current = now;

    try {
      const apiBase = getViewerApiBase();
      const r = await fetch(`${apiBase}/api/video-donation/now-playing?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      if (data?.volume != null) applyVolume(Number(data.volume));
      const item = data?.item;
      if (item && (item.mediaProvider || item.videoId || item.embedUrl)) {
        const start = Math.max(0, Math.floor(Number(item.startSec || 0) || 0));
        const target = {
          atSec: getPlaybackAtSec(item, data),
          paused: data?.paused === true,
          force
        };
        if (getItemProvider(item) === 'youtube') {
          ensurePlayer(String(item.videoId || item.mediaId), start, target);
        } else {
          ensureExternalPlayer(item, target);
        }
        suppressUntilRef.current = Date.now() + 1000;
      } else {
        stopPlayer();
      }
    } catch {}
  }, [applyVolume, ensureExternalPlayer, ensurePlayer, getItemProvider, getViewerApiBase, stopPlayer, token]);

  // Page lifecycle handling: pause locally while hidden, then force-align to server on return.
  useEffect(() => {
    if (!token) return;

    const pauseLocalOnly = () => {
      suppressUntilRef.current = Date.now() + 4000;
      try { playerRef.current && playerRef.current.pauseVideo && playerRef.current.pauseVideo(); } catch {}
    };

    const onVisibility = () => {
      if (document.hidden) {
        pauseLocalOnly();
      } else {
        void resyncFromServer(true);
      }
    };

    const onResume = () => {
      if (!document.hidden) void resyncFromServer(true);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onResume);
    window.addEventListener('pageshow', onResume);
    window.addEventListener('online', onResume);
    void resyncFromServer(true);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onResume);
      window.removeEventListener('pageshow', onResume);
      window.removeEventListener('online', onResume);
    };
  }, [resyncFromServer, token]);

  // WS first; fallback to HTTP polling on error/close
  useEffect(() => {
    if (!token) return;
    const apiBase = getViewerApiBase();
    reconnectRef.current.closed = false;
    let apiUrl: URL;
    try { apiUrl = new URL(apiBase); } catch { apiUrl = new URL(window.location.origin); }
    const wsProto = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws: WebSocket | null = null;

    const startPolling = () => {
      if (pollTimerRef.current) return; // already polling
      pollTimerRef.current = setInterval(async () => {
        if (!document.hidden) void resyncFromServer(false);
      }, 2500);
    };

    const stopPolling = () => {
      try { clearInterval(pollTimerRef.current); } catch {}
      pollTimerRef.current = null;
    };

    const connectWs = () => {
      try {
        ws = new WebSocket(`${wsProto}//${apiUrl.host}/api/pvd/ws?token=${encodeURIComponent(token)}`);
      } catch {
        ws = null;
        scheduleReconnect();
        startPolling();
        return;
      }
      ws.onopen = () => {
        // Connected: stop polling and reset backoff
        stopPolling();
        reconnectRef.current.attempts = 0;
        void resyncFromServer(true);
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data?.type === 'start') {
            if (data?.volume != null) applyVolume(Number(data.volume));
            if (data?.item && (data.item.mediaProvider || data.item.videoId || data.item.embedUrl)) {
              const start = Math.max(0, Math.floor(Number(data.item.startSec || 0) || 0));
              const paused = data?.paused === true;
              const target = {
                atSec: getPlaybackAtSec(data.item, data),
                paused,
                force: true
              };
              if (getItemProvider(data.item) === 'youtube') {
                ensurePlayer(String(data.item.videoId || data.item.mediaId), start, target);
              } else {
                ensureExternalPlayer(data.item, target);
              }
              suppressUntilRef.current = Date.now() + 1000;
            } else {
              // start notification with no item -> stop the player immediately (end of queue)
              stopPlayer();
            }
          } else if (data?.type === 'control') {
            const op = String(data.op || '').toLowerCase();
            if (op === 'volume') {
              applyVolume(Number(data.volume));
              return;
            }
            const at = Number(data.atSec || 0) || 0;
            if (playerRef.current) {
              applyPlaybackTarget(Math.max(0, Math.floor(at)), op === 'pause' || data?.paused === true, true);
            } else if (externalFrameRef.current) {
              applyExternalPlaybackTarget(Math.max(0, Math.floor(at)), op === 'pause' || data?.paused === true);
            }
          }
        } catch {}
      };
      ws.onerror = () => {
        startPolling();
      };
      ws.onclose = () => {
        if (!reconnectRef.current.closed) {
          scheduleReconnect();
          startPolling();
        }
      };
    };

    const scheduleReconnect = () => {
      const { attempts, timer } = reconnectRef.current;
      if (timer) return;
      const delay = Math.min(30000, 1000 * Math.pow(2, attempts)); // 1s -> 2s -> 4s ... max 30s
      reconnectRef.current.timer = setTimeout(() => {
        reconnectRef.current.timer = null;
        reconnectRef.current.attempts = attempts + 1;
        connectWs();
      }, delay);
    };

    connectWs();
    const reconnectState = reconnectRef.current;

    return () => {
      reconnectState.closed = true;
      try { clearTimeout(reconnectState.timer); } catch {}
      reconnectState.timer = null;
      if (ws) { try { ws.close(); } catch {} }
      stopPolling();
      try { playerRef.current && playerRef.current.destroy && playerRef.current.destroy(); } catch {}
      playerRef.current = null;
    };
  }, [applyExternalPlaybackTarget, applyPlaybackTarget, applyVolume, ensureExternalPlayer, ensurePlayer, getItemProvider, getViewerApiBase, resyncFromServer, stopPlayer, token]);

  // Low-frequency drift guard for viewers that stay connected but whose YouTube iframe stalls.
  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => {
      if (!document.hidden && playerRef.current) void resyncFromServer(false);
    }, 7500);
    return () => {
      try { clearInterval(id); } catch {}
      try { clearTimeout(volumeEmitTimerRef.current); } catch {}
    };
  }, [resyncFromServer, token]);

  // Detect manual seek (scrub) and broadcast 'seek' when a significant jump is detected
  useEffect(() => {
    const id = setInterval(() => {
      try {
        const YT = (window as any).YT;
        if (!YT || !playerRef.current || !playerRef.current.getCurrentTime) return;
        const t = Number(playerRef.current.getCurrentTime());
        const diff = Math.abs(t - lastTimeRef.current);
        const now = Date.now();
        if (!document.hidden && diff > 1.5 && now > suppressUntilRef.current) {
          lastTimeRef.current = t;
          if (now - lastEmitRef.current > 200) { lastEmitRef.current = now; emitControl('seek', Math.floor(t)); }
        } else {
          lastTimeRef.current = t;
        }
      } catch {}
    }, 300);
    return () => { try { clearInterval(id); } catch {} };
  }, [emitControl]);

  return (
    <div style={{ width: '100vw', height: '100vh', background: 'transparent' }}>
      <div ref={playerDivRef} style={{ width: '100%', height: '100%', display: externalItem ? 'none' : 'block' }} />
      {externalItem ? (
        <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
          {externalItem.viewerSrc && externalItem.isDirectVideo ? (
            <video
              key={externalItem.mediaKey}
              ref={externalVideoRef}
              src={externalItem.viewerSrc}
              autoPlay
              playsInline
              controls={false}
              muted={volume <= 0}
              poster={externalItem.thumbnailUrl || undefined}
              onLoadedMetadata={(event) => {
                try {
                  event.currentTarget.volume = volumeRef.current / 100;
                  event.currentTarget.muted = volumeRef.current <= 0;
                  const start = Math.max(0, Math.floor(Number(externalItem.targetAtSec ?? externalItem.startSec ?? 0) || 0));
                  if (start > 0) event.currentTarget.currentTime = start;
                } catch {}
              }}
              onCanPlay={(event) => {
                try {
                  event.currentTarget.volume = volumeRef.current / 100;
                  event.currentTarget.muted = volumeRef.current <= 0;
                  if (externalItem.paused) {
                    event.currentTarget.pause();
                  } else {
                    const result = event.currentTarget.play();
                    if (result && typeof result.catch === 'function') result.catch(() => {});
                  }
                } catch {}
              }}
              onEnded={() => report('end')}
              onError={() => report('error')}
              style={{
                width: '100vw',
                height: '100vh',
                objectFit: 'contain',
                background: 'transparent',
              }}
            />
          ) : externalItem.viewerSrc ? (
            <iframe
              key={externalItem.mediaKey}
              ref={externalFrameRef}
              title={externalItem.title || '영상 후원'}
              src={externalItem.viewerSrc}
              allow="autoplay; fullscreen; picture-in-picture; clipboard-write; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              style={{
                width: externalItem.provider === 'tiktok' ? 'min(100vw, 56.25vh)' : '100vw',
                height: '100vh',
                border: 0,
                background: 'transparent',
              }}
            />
          ) : null}
          {externalItem.blockedReason ? (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                padding: 'clamp(1.25rem,4vw,3rem)',
                background: 'rgba(15,23,42,0.78)',
                color: 'white',
                textAlign: 'center',
                font: '600 clamp(1rem,2vw,1.35rem) system-ui, sans-serif',
              }}
            >
              <div style={{ maxWidth: '42rem', lineHeight: 1.7 }}>
                <div style={{ marginBottom: '0.75rem', fontSize: 'clamp(1.35rem,3vw,2rem)' }}>{externalItem.title || 'CIME 클립'}</div>
                <div>{externalItem.blockedReason}</div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <div
        style={{
          position: 'fixed',
          right: 'clamp(0.75rem,2vw,1.25rem)',
          bottom: 'clamp(0.75rem,2vw,1.25rem)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.65rem',
          padding: '0.65rem 0.85rem',
          borderRadius: '999px',
          border: '1px solid rgba(255,255,255,0.22)',
          background: 'rgba(15, 23, 42, 0.72)',
          color: 'white',
          font: '600 0.82rem system-ui, sans-serif',
          opacity: 0.08,
          transition: 'opacity 160ms ease',
          backdropFilter: 'blur(14px)',
        }}
        onMouseEnter={(event) => { event.currentTarget.style.opacity = '1'; }}
        onMouseLeave={(event) => { event.currentTarget.style.opacity = '0.08'; }}
      >
        <span>소리</span>
        <input
          aria-label="영상 후원 볼륨"
          type="range"
          min="0"
          max="100"
          value={volume}
          onChange={(event) => {
            const next = Math.max(0, Math.min(100, Number(event.currentTarget.value || 0)));
            applyVolume(next);
            emitVolumeControl(next);
          }}
          style={{ width: 'min(28vw, 10rem)' }}
        />
        <span style={{ minWidth: '3ch', textAlign: 'right' }}>{volume}</span>
      </div>
    </div>
  );
}
