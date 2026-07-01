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
  const playerDivRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const pollTimerRef = useRef<any>(null);
  const currentVidRef = useRef<string | null>(null);
  const currentStartRef = useRef<number>(0);
  const reconnectRef = useRef<{ attempts: number; timer: any; closed: boolean }>({ attempts: 0, timer: null, closed: false });
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

  const emitControl = useCallback((op: 'pause' | 'play' | 'seek', atSec?: number) => {
    if (!token) return;
    const apiBase = getViewerApiBase();
    const body = { token, op, atSec } as any;
    fetch(`${apiBase}/api/video-donation/control-by-token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).catch(() => {});
  }, [getViewerApiBase, token]);

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

  const stopPlayer = useCallback(() => {
    try { playerRef.current && playerRef.current.stopVideo && playerRef.current.stopVideo(); } catch {}
    try { playerRef.current && playerRef.current.destroy && playerRef.current.destroy(); } catch {}
    playerRef.current = null;
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
      const onReady = () => applyPlaybackTarget(target, opts?.paused, true);

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

      setTimeout(() => applyPlaybackTarget(target, opts?.paused, true), 250);
    }).catch(() => {});
  }, [applyPlaybackTarget, emitControl, getYouTubeApi, report]);

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
      const item = data?.item;
      if (item && item.videoId) {
        const start = Math.max(0, Math.floor(Number(item.startSec || 0) || 0));
        ensurePlayer(String(item.videoId), start, {
          atSec: getPlaybackAtSec(item, data),
          paused: data?.paused === true,
          force
        });
        suppressUntilRef.current = Date.now() + 1000;
      } else {
        stopPlayer();
      }
    } catch {}
  }, [ensurePlayer, getViewerApiBase, stopPlayer, token]);

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
            if (data?.item && data.item.videoId) {
              const start = Math.max(0, Math.floor(Number(data.item.startSec || 0) || 0));
              const paused = data?.paused === true;
              ensurePlayer(String(data.item.videoId), start, {
                atSec: getPlaybackAtSec(data.item, data),
                paused,
                force: true
              });
              suppressUntilRef.current = Date.now() + 1000;
            } else {
              // start notification with no item -> stop the player immediately (end of queue)
              stopPlayer();
            }
          } else if (data?.type === 'control') {
            const op = String(data.op || '').toLowerCase();
            const at = Number(data.atSec || 0) || 0;
            if (playerRef.current) {
              applyPlaybackTarget(Math.max(0, Math.floor(at)), op === 'pause' || data?.paused === true, true);
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
  }, [applyPlaybackTarget, ensurePlayer, getViewerApiBase, resyncFromServer, stopPlayer, token]);

  // Low-frequency drift guard for viewers that stay connected but whose YouTube iframe stalls.
  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => {
      if (!document.hidden && playerRef.current) void resyncFromServer(false);
    }, 7500);
    return () => { try { clearInterval(id); } catch {} };
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
      <div ref={playerDivRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
