import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPvdIdlePlaybackOrder,
  EMPTY_PVD_IDLE_PLAYLIST,
  getPvdIdlePlaylistSignature,
  normalizePvdIdlePlaylist,
  type PvdIdlePlaylist,
} from '@/components/pvdIdlePlaylist';
import { createPvdYouTubeMixPlayer } from '@/components/pvdYouTubeMixPlayer';
import { isPvdDocumentHidden } from '@/components/pvdPlaybackVisibility';
import { Play } from 'lucide-react';
import { createYouTubeDurationProbeRunner, type YouTubeDurationProbeRequest, type YouTubeDurationProbeResult } from '@/components/youtubeDurationProbe';
import { getBrowserApiBase } from '@/shared/api/http';

type PlaybackTarget = {
  atSec?: number;
  paused?: boolean;
  force?: boolean;
  itemId?: string | null;
};

type VideoDonationItem = {
  [key: string]: unknown;
  id?: string | number;
  mediaProvider?: string;
  mediaId?: string | number;
  videoId?: string | number;
  embedUrl?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  title?: string;
  startSec?: number;
};

type ExternalVideoDonationItem = VideoDonationItem & {
  viewerSrc: string;
  provider: string;
  mediaKey: string;
  targetAtSec: number;
  paused: boolean;
  isDirectVideo: boolean;
  blockedReason: string | null;
};

type YouTubePlayer = {
  destroy?: () => void;
  getCurrentTime?: () => number;
  getDuration?: () => number;
  getVideoData?: () => { video_id?: string };
  loadModule?: (name: string) => void;
  loadVideoById?: (options: { videoId: string; startSeconds: number }) => void;
  mute?: () => void;
  pauseVideo?: () => void;
  playVideo?: () => void;
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume?: (volume: number) => void;
  stopVideo?: () => void;
  unloadModule?: (name: string) => void;
  unMute?: () => void;
};

type YouTubeApi = {
  Player: new (element: HTMLElement, options: Record<string, unknown>) => YouTubePlayer;
  PlayerState: { ENDED: number; PAUSED: number; PLAYING: number };
};

type YouTubePlayerEvent = {
  data?: number;
  target?: YouTubePlayer;
};

type YouTubeWindow = Window & {
  YT?: YouTubeApi;
  onYouTubeIframeAPIReady?: () => void;
};

type PlaybackMode = 'none' | 'donation' | 'idle';

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

const TIKTOK_DURATION_SYNC_WAIT_MS = 20 * 1000;
const PVD_FORWARD_SYNC_THRESHOLD_SEC = 4;
const PVD_BACKWARD_SYNC_THRESHOLD_SEC = 8;
const PVD_FORCE_SYNC_THRESHOLD_SEC = 3;

function isDirectVideoUrl(value: unknown) {
  try {
    const url = new URL(String(value || ''));
    return /\.(mp4|webm|ogg)(?:$|[?#])/i.test(url.pathname);
  } catch {
    return /\.(mp4|webm|ogg)(?:$|[?#])/i.test(String(value || ''));
  }
}

function getPlaybackAtSec(item: VideoDonationItem, payload: Record<string, unknown>) {
  const start = Math.max(0, Math.floor(Number(item?.startSec || 0) || 0));
  if (payload?.paused === true) {
    const pausedAt = Number(payload.atSec);
    return Number.isFinite(pausedAt) && pausedAt >= 0 ? Math.max(start, Math.floor(pausedAt)) : start;
  }

  const startedAt = Number(payload?.startedAt || 0) || 0;
  if (startedAt) {
    const serverNow = Number(payload?.serverNow || 0) || 0;
    const referenceNow = serverNow || Date.now();
    return Math.max(start, Math.floor((referenceNow - startedAt) / 1000) + start);
  }

  const explicitAtSec = Number(payload?.atSec);
  if (Number.isFinite(explicitAtSec) && explicitAtSec >= 0) {
    return Math.max(start, Math.floor(explicitAtSec));
  }

  return start;
}

export default function PvdViewer({ viewerToken }: { viewerToken?: string } = {}) {
  const [token, setToken] = useState<string>(viewerToken || '');
  const [volume, setVolume] = useState(100);
  const [externalItem, setExternalItem] = useState<ExternalVideoDonationItem | null>(null);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [youtubeActive, setYoutubeActive] = useState(false);
  const [mixActive, setMixActive] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [volumeControlsVisible, setVolumeControlsVisible] = useState(false);
  const playerDivRef = useRef<HTMLDivElement | null>(null);
  const mixDivRef = useRef<HTMLDivElement | null>(null);
  const mixPlayerRef = useRef<ReturnType<typeof createPvdYouTubeMixPlayer> | null>(null);
  const mixActiveRef = useRef(false);
  const externalFrameRef = useRef<HTMLIFrameElement | null>(null);
  const externalVideoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const expectedYouTubeMediaIdRef = useRef<string | null>(null);
  const volumeRef = useRef(100);
  const externalProviderRef = useRef<string | null>(null);
  const externalMediaKeyRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentVidRef = useRef<string | null>(null);
  const currentStartRef = useRef<number>(0);
  const reconnectRef = useRef<{ attempts: number; timer: ReturnType<typeof setTimeout> | null; closed: boolean }>({ attempts: 0, timer: null, closed: false });
  const volumeEmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ytReadyPromiseRef = useRef<Promise<YouTubeApi> | null>(null);
  const youtubeDurationProbeRunnerRef = useRef<ReturnType<typeof createYouTubeDurationProbeRunner> | null>(null);
  const ensureSeqRef = useRef<number>(0);
  const lastServerSyncRef = useRef<number>(0);
  const playbackPayloadVersionRef = useRef(0);
  const youtubePlaybackTargetRef = useRef({ atSec: 0, paused: false });
  const lastEmitRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const suppressUntilRef = useRef<number>(0);
  const currentItemIdRef = useRef<string | null>(null);
  const lastReportRef = useRef<{ itemId: string | null; at: number } | null>(null);
  const youtubeDurationReportedRef = useRef<{ itemId: string | null; durationSec: number } | null>(null);
  const externalTargetRef = useRef(0);
  const externalPausedRef = useRef(false);
  const tiktokPlayingSeenRef = useRef(false);
  const tiktokReadyAtRef = useRef(0);
  const tiktokPlayingStartedAtRef = useRef(0);
  const tiktokDurationRef = useRef(0);
  const tiktokDurationReportedRef = useRef(0);
  const tiktokEarlyEndRetryRef = useRef(0);
  const playbackModeRef = useRef<PlaybackMode>('none');
  const idlePlaylistRef = useRef<PvdIdlePlaylist>(EMPTY_PVD_IDLE_PLAYLIST);
  const idleSignatureRef = useRef('');
  const idleOrderRef = useRef<string[]>([]);
  const idleCursorRef = useRef(0);
  const idleCurrentMediaIdRef = useRef<string | null>(null);
  const idleResumeAtRef = useRef(0);
  const idleExhaustedRef = useRef(false);
  const idlePlayingRef = useRef(false);
  const idleFailedMediaIdsRef = useRef<Set<string>>(new Set());
  const idleAdvanceRef = useRef<(cause: 'end' | 'error') => void>(() => {});
  const deferredDonationRef = useRef<VideoDonationItem | null>(null);
  const deferredActivationItemIdRef = useRef<string | null>(null);
  const playbackSyncRef = useRef<(force?: boolean) => void | Promise<void>>(() => {});
  const idleTrackRef = useRef<{ id: string; mediaId: string; title: string; durationSec: number } | null>(null);
  const idlePausedRef = useRef(false);
  const idleOwnerRef = useRef(true);
  const idleClientIdRef = useRef('');
  const idleSequenceRef = useRef(0);
  const idleControlVersionRef = useRef(0);
  const idleReportRef = useRef<() => void>(() => {});
  const idleControlRef = useRef<(command: Record<string, unknown>) => void>(() => {});

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
    const win = window as YouTubeWindow;
    if (win.YT && win.YT.Player) return Promise.resolve(win.YT);
    if (ytReadyPromiseRef.current) return ytReadyPromiseRef.current;

    ytReadyPromiseRef.current = new Promise((resolve) => {
      const previousReady = win.onYouTubeIframeAPIReady;
      win.onYouTubeIframeAPIReady = () => {
        try { previousReady && previousReady(); } catch {}
        if (win.YT) resolve(win.YT);
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

  useEffect(() => {
    const mix = createPvdYouTubeMixPlayer({
      getApi: getYouTubeApi,
      getHost: () => mixDivRef.current,
      isVisible: () => !isPvdDocumentHidden() && idleOwnerRef.current,
      fetchSeed: async (signal) => {
        const response = await fetch(`${getViewerApiBase()}/api/video-donation/idle-playlist/next-by-token`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
          body: JSON.stringify({ token, seedOnly: true }),
        });
        const payload = await response.json();
        const seed = payload?.tracks?.[0]?.mediaId;
        if (!response.ok || !seed) {
          throw Object.assign(new Error(payload?.error || 'mix_seed_not_found'), { retryAfterMs: payload?.retryAfterMs });
        }
        return String(seed);
      },
      onPlaying: (playing) => {
        if (mixActiveRef.current && idlePlayingRef.current !== playing) {
          idlePlayingRef.current = playing;
          idleReportRef.current();
        }
      },
      onTrack: (track) => { idleTrackRef.current = track; idleReportRef.current(); },
      onBlocked: setAutoplayBlocked,
      onBoundary: () => {
        if (!deferredDonationRef.current) return false;
        idleAdvanceRef.current('end');
        return true;
      },
    });
    mixPlayerRef.current = mix;
    return () => {
      mix.dispose();
      if (mixPlayerRef.current === mix) mixPlayerRef.current = null;
    };
  }, [getViewerApiBase, getYouTubeApi, token]);

  const probeYouTubeDuration = useCallback((
    request: YouTubeDurationProbeRequest,
    report: (result: YouTubeDurationProbeResult) => void,
  ) => {
    let runner = youtubeDurationProbeRunnerRef.current;
    if (!runner) {
      runner = createYouTubeDurationProbeRunner(getYouTubeApi);
      youtubeDurationProbeRunnerRef.current = runner;
    }
    runner.probe(request, report);
  }, [getYouTubeApi]);

  const handleDurationProbe = useCallback((
    request: YouTubeDurationProbeRequest,
    socket?: WebSocket | null,
  ) => {
    if (!token) return;
    probeYouTubeDuration(request, (result) => {
      if (socket?.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify(result));
          return;
        } catch {}
      }
      const apiBase = getViewerApiBase();
      fetch(`${apiBase}/api/video-donation/control-by-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, op: 'duration_probe_result', ...result }),
      }).catch(() => {});
    });
  }, [getViewerApiBase, probeYouTubeDuration, token]);

  const getItemProvider = useCallback((item: VideoDonationItem) => {
    return String(item?.mediaProvider || 'youtube').toLowerCase();
  }, []);

  const getMediaKey = useCallback((item: VideoDonationItem) => {
    const provider = getItemProvider(item);
    return `${provider}:${item?.mediaId || item?.videoId || item?.embedUrl || item?.mediaUrl || ''}`;
  }, [getItemProvider]);

  const postToExternalPlayer = useCallback((message: Record<string, unknown>) => {
    const frame = externalFrameRef.current;
    if (!frame?.contentWindow) return;
    try {
      frame.contentWindow.postMessage({ ...message, 'x-tiktok-player': true }, 'https://www.tiktok.com');
    } catch {}
  }, []);

  const buildExternalSrc = useCallback((item: VideoDonationItem, atSec: number, paused?: boolean) => {
    const provider = getItemProvider(item);
    let src = String(item?.embedUrl || item?.mediaUrl || '');
    if (!src && provider === 'cime_clip' && item?.mediaId) src = `https://ci.me/clips/${encodeURIComponent(String(item.mediaId))}`;
    if (provider === 'tiktok' && item?.mediaId) src = `https://www.tiktok.com/player/v1/${encodeURIComponent(String(item.mediaId))}`;
    if (!src) return '';
    try {
      const url = new URL(src);
      if (isDirectVideoUrl(url.toString())) {
        return url.toString();
      }
      if (provider === 'chzzk_clip') return '';
      if (provider === 'tiktok') {
        url.searchParams.set('autoplay', paused ? '0' : '1');
        url.searchParams.set('controls', '1');
        url.searchParams.set('progress_bar', '1');
        url.searchParams.set('play_button', '1');
        url.searchParams.set('volume_control', '1');
        url.searchParams.set('fullscreen_button', '1');
        url.searchParams.set('timestamp', '1');
        url.searchParams.set('loop', '0');
        url.searchParams.set('rel', '0');
        url.searchParams.set('native_context_menu', '0');
        url.searchParams.set('closed_caption', '0');
        url.searchParams.set('muted', volumeRef.current <= 0 ? '1' : '0');
      } else if (provider === 'chzzk_clip') {
        url.searchParams.set('autoplay', paused ? 'false' : 'true');
      }
      if (Number.isFinite(atSec) && atSec > 0) url.searchParams.set('start', String(Math.floor(atSec)));
      return url.toString();
    } catch {
      if (provider === 'chzzk_clip' && !isDirectVideoUrl(src)) return '';
      return src;
    }
  }, [getItemProvider]);

  const applyVolume = useCallback((nextVolume: number) => {
    const normalized = Math.max(0, Math.min(100, Math.round(Number(nextVolume || 0))));
    volumeRef.current = normalized;
    setVolume(normalized);
    mixPlayerRef.current?.setVolume(normalized);
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

  const applyYouTubeCaptions = useCallback((enabled = captionsEnabled) => {
    mixPlayerRef.current?.setCaptions(enabled);
    const player = playerRef.current;
    if (!player) return;
    try {
      if (enabled) {
        if (player.loadModule) player.loadModule('captions');
        if (player.loadModule) player.loadModule('cc');
      } else {
        if (player.unloadModule) player.unloadModule('captions');
        if (player.unloadModule) player.unloadModule('cc');
      }
    } catch {}
  }, [captionsEnabled]);

  const emitControl = useCallback((op: 'pause' | 'play' | 'seek' | 'volume' | 'duration', atSec?: number, nextVolume?: number, durationSec?: number) => {
    if (!token) return;
    const apiBase = getViewerApiBase();
    const body = { token, op, atSec, volume: nextVolume, durationSec, source: 'player', itemId: currentItemIdRef.current };
    fetch(`${apiBase}/api/video-donation/control-by-token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).catch(() => {});
  }, [getViewerApiBase, token]);

  const reportYouTubeDuration = useCallback(() => {
    if (playbackModeRef.current !== 'donation') return;
    const player = playerRef.current;
    const duration = Number(player?.getDuration?.());
    if (!Number.isFinite(duration) || duration <= 0) return;
    const durationSec = Math.ceil(duration);
    const itemId = currentItemIdRef.current;
    const previous = youtubeDurationReportedRef.current;
    if (previous?.itemId === itemId && previous.durationSec === durationSec) return;
    youtubeDurationReportedRef.current = { itemId, durationSec };
    emitControl('duration', undefined, undefined, durationSec);
  }, [emitControl]);

  const emitVolumeControl = useCallback((nextVolume: number) => {
    if (volumeEmitTimerRef.current) clearTimeout(volumeEmitTimerRef.current);
    volumeEmitTimerRef.current = setTimeout(() => {
      emitControl('volume', undefined, nextVolume);
    }, 180);
  }, [emitControl]);

  const applyPlaybackTarget = useCallback((targetSec: number, paused?: boolean, force?: boolean, strict?: boolean) => {
    youtubePlaybackTargetRef.current = { atSec: Math.max(0, Math.floor(targetSec)), paused: paused === true };
    const player = playerRef.current;
    if (!player) return;

    const target = Math.max(0, Math.floor(targetSec));
    let current = target;
    try {
      if (player.getCurrentTime) current = Number(player.getCurrentTime());
    } catch {}

    const drift = Math.abs(current - target);
    const forwardDrift = target - current;
    const backwardDrift = current - target;
    const shouldSeek = strict === true
      ? (force === true || drift > 1.25)
      : force === true
      ? drift > PVD_FORCE_SYNC_THRESHOLD_SEC
      : (forwardDrift > PVD_FORWARD_SYNC_THRESHOLD_SEC || backwardDrift > PVD_BACKWARD_SYNC_THRESHOLD_SEC);
    suppressUntilRef.current = Date.now() + 1000;

    try {
      if (shouldSeek && player.seekTo) player.seekTo(target, true);
      lastTimeRef.current = target;
    } catch {}

    try {
      if (paused || isPvdDocumentHidden()) {
        player.pauseVideo && player.pauseVideo();
      } else {
        player.playVideo && player.playVideo();
      }
    } catch {}
  }, []);

  const applyExternalPlaybackTarget = useCallback((targetSec: number, paused?: boolean) => {
    const provider = externalProviderRef.current;
    const target = Math.max(0, Math.floor(Number(targetSec || 0)));
    externalTargetRef.current = target;
    externalPausedRef.current = paused === true;
    suppressUntilRef.current = Date.now() + 1000;
    lastTimeRef.current = target;
    const video = externalVideoRef.current;
    if (video) {
      try {
        if (Math.abs(Number(video.currentTime || 0) - target) > 1.25) video.currentTime = target;
        if (paused || isPvdDocumentHidden()) {
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
      postToExternalPlayer({ type: paused || isPvdDocumentHidden() ? 'pause' : 'play' });
    }
  }, [postToExternalPlayer]);

  const clearYouTubePlayerHost = useCallback(() => {
    try { playerDivRef.current?.replaceChildren(); } catch {}
  }, []);

  const createYouTubePlayerMount = useCallback(() => {
    const host = playerDivRef.current;
    if (!host) return null;
    clearYouTubePlayerHost();
    const mount = document.createElement('div');
    mount.style.width = '100%';
    mount.style.height = '100%';
    mount.dataset.youtubePlayerMount = 'true';
    host.appendChild(mount);
    return mount;
  }, [clearYouTubePlayerHost]);

  const stopPlayer = useCallback(() => {
    mixPlayerRef.current?.pause();
    mixActiveRef.current = false;
    setMixActive(false);
    ensureSeqRef.current += 1;
    expectedYouTubeMediaIdRef.current = null;
    try { playerRef.current && playerRef.current.stopVideo && playerRef.current.stopVideo(); } catch {}
    try { playerRef.current && playerRef.current.destroy && playerRef.current.destroy(); } catch {}
    playerRef.current = null;
    clearYouTubePlayerHost();
    setExternalItem(null);
    externalFrameRef.current = null;
    externalVideoRef.current = null;
    externalProviderRef.current = null;
    externalMediaKeyRef.current = null;
    externalTargetRef.current = 0;
    externalPausedRef.current = false;
    tiktokPlayingSeenRef.current = false;
    tiktokReadyAtRef.current = 0;
    tiktokPlayingStartedAtRef.current = 0;
    tiktokDurationRef.current = 0;
    tiktokDurationReportedRef.current = 0;
    tiktokEarlyEndRetryRef.current = 0;
    currentVidRef.current = null;
    currentStartRef.current = 0;
    currentItemIdRef.current = null;
    playbackModeRef.current = 'none';
    idlePlayingRef.current = false;
    idleReportRef.current();
    setYoutubeActive(false);
  }, [clearYouTubePlayerHost]);

  const isExpectedYouTubePlayerMedia = useCallback((sourcePlayer?: YouTubePlayer | null) => {
    if (sourcePlayer && sourcePlayer !== playerRef.current) return false;
    const expected = expectedYouTubeMediaIdRef.current;
    if (!expected || expected === '__external__') return expected !== '__external__';
    try {
      const actual = String((sourcePlayer || playerRef.current)?.getVideoData?.()?.video_id || '').trim();
      return !actual || actual === expected;
    } catch {
      return true;
    }
  }, []);

  const captureIdlePosition = useCallback(() => {
    if (playbackModeRef.current !== 'idle') return;
    if (mixActiveRef.current) {
      mixPlayerRef.current?.pause();
      mixActiveRef.current = false;
      setMixActive(false);
    }
    idlePlayingRef.current = false;
    try {
      const current = Number(playerRef.current?.getCurrentTime?.() || 0);
      if (Number.isFinite(current) && current >= 0) idleResumeAtRef.current = current;
    } catch {}
    try { playerRef.current?.pauseVideo?.(); } catch {}
  }, []);

  const report = useCallback((cause: 'error' | 'end') => {
    if (!token || playbackModeRef.current !== 'donation') return;
    const itemId = currentItemIdRef.current;
    const now = Date.now();
    const lastReport = lastReportRef.current;
    if (lastReport && lastReport.itemId === itemId && now - lastReport.at < 5000) return;
    lastReportRef.current = { itemId, at: now };
    const apiBase = getViewerApiBase();
    fetch(`${apiBase}/api/video-donation/pop-by-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, cause, itemId })
    }).catch(() => null).finally(() => {
      void playbackSyncRef.current(true);
    });
    stopPlayer();
  }, [getViewerApiBase, stopPlayer, token]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== externalFrameRef.current?.contentWindow) return;
      try {
        if (!/(^|\.)tiktok\.com$/i.test(new URL(event.origin).hostname)) return;
      } catch {
        return;
      }
      const data = event.data as unknown;
      if (!isUnknownRecord(data) || data['x-tiktok-player'] !== true) return;
      if (externalProviderRef.current !== 'tiktok') return;

      const type = String(data.type || '');
      if (type === 'onPlayerReady') {
        tiktokReadyAtRef.current = Date.now();
        applyVolume(volumeRef.current);
        window.setTimeout(() => {
          applyExternalPlaybackTarget(externalTargetRef.current, externalPausedRef.current);
        }, 120);
        return;
      }

      if (type === 'onStateChange') {
        const state = Number(data.value);
        const now = Date.now();
        if (state === 1) {
          if (externalPausedRef.current || isPvdDocumentHidden()) {
            postToExternalPlayer({ type: 'pause' });
            return;
          }
          tiktokPlayingSeenRef.current = true;
          if (!tiktokPlayingStartedAtRef.current) tiktokPlayingStartedAtRef.current = now;
          if (!isPvdDocumentHidden() && now > suppressUntilRef.current && now - lastEmitRef.current > 300) {
            lastEmitRef.current = now;
            emitControl('play', Math.floor(lastTimeRef.current));
          }
          return;
        }
        if (state === 0) {
          if (externalPausedRef.current || isPvdDocumentHidden()) return;
          const playedMs = tiktokPlayingStartedAtRef.current ? now - tiktokPlayingStartedAtRef.current : 0;
          const duration = Number(tiktokDurationRef.current || 0);
          const current = Number(lastTimeRef.current || 0);
          const reachedKnownEnd = duration > 0 && current >= Math.max(0, duration - 0.75);
          const waitedForDuration = duration <= 0 && playedMs >= TIKTOK_DURATION_SYNC_WAIT_MS;
          if (tiktokPlayingSeenRef.current && (reachedKnownEnd || waitedForDuration)) {
            report('end');
          } else if (tiktokEarlyEndRetryRef.current < 2) {
            tiktokEarlyEndRetryRef.current += 1;
            window.setTimeout(() => {
              if (!externalPausedRef.current && !isPvdDocumentHidden() && externalProviderRef.current === 'tiktok') postToExternalPlayer({ type: 'play' });
            }, 350);
          }
          return;
        }
        if (state === 2) {
          if (!isPvdDocumentHidden() && now - tiktokReadyAtRef.current > 1000 && now > suppressUntilRef.current && now - lastEmitRef.current > 300) {
            lastEmitRef.current = now;
            emitControl('pause', Math.floor(lastTimeRef.current));
          }
        }
        return;
      }

      if (type === 'onCurrentTime') {
        const value = data.value;
        const current = Number(isUnknownRecord(value) ? value.currentTime : value);
        const duration = Number(isUnknownRecord(value) ? value.duration : 0);
        if (Number.isFinite(current)) lastTimeRef.current = current;
        if (Number.isFinite(duration) && duration > 0) {
          tiktokDurationRef.current = duration;
          if (Math.abs(duration - tiktokDurationReportedRef.current) >= 0.5) {
            tiktokDurationReportedRef.current = duration;
            emitControl('duration', undefined, undefined, Math.ceil(duration));
          }
        }
        return;
      }

      if (type === 'onMute') {
        if (data.value === true) {
          volumeRef.current = 0;
          setVolume(0);
        }
        return;
      }

      if (type === 'onVolumeChange') {
        const nextVolume = Number(data.value);
        if (Number.isFinite(nextVolume)) {
          const normalized = Math.max(0, Math.min(100, Math.round(nextVolume)));
          volumeRef.current = normalized;
          setVolume(normalized);
        }
        return;
      }

      if (type === 'onPlayerError') {
        const value = data.value;
        const errorCode = Number(isUnknownRecord(value) ? value.errorCode : value);
        if (errorCode === 3002) {
          window.setTimeout(() => {
            if (!externalPausedRef.current && !isPvdDocumentHidden() && externalProviderRef.current === 'tiktok') postToExternalPlayer({ type: 'play' });
          }, 500);
          return;
        }
        report('error');
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [applyExternalPlaybackTarget, applyVolume, emitControl, postToExternalPlayer, report]);

  const ensurePlayer = useCallback((videoId: string, start: number, opts?: PlaybackTarget) => {
    expectedYouTubeMediaIdRef.current = videoId;
    const seq = ++ensureSeqRef.current;
    const safeStart = Math.max(0, Math.floor(Number(start || 0)));
    const target = Math.max(safeStart, Math.floor(Number(opts?.atSec ?? safeStart)));
    youtubePlaybackTargetRef.current = { atSec: target, paused: opts?.paused === true };

    void getYouTubeApi().then((YT) => {
      if (seq !== ensureSeqRef.current || !YT || !YT.Player || !playerDivRef.current) return;
      setExternalItem(null);
      setYoutubeActive(true);
      externalProviderRef.current = null;
      externalMediaKeyRef.current = null;
      const nextItemId = String(opts?.itemId || videoId || '');
      if (currentItemIdRef.current !== nextItemId) {
        currentItemIdRef.current = nextItemId;
        lastReportRef.current = null;
        youtubeDurationReportedRef.current = null;
      }

      const sameItem = currentVidRef.current === videoId && currentStartRef.current === safeStart && playerRef.current;
      if (sameItem) {
        applyYouTubeCaptions(captionsEnabled);
        const latest = youtubePlaybackTargetRef.current;
        applyPlaybackTarget(latest.atSec, latest.paused, opts?.force);
        reportYouTubeDuration();
        return;
      }

      const shouldAutoplay = youtubePlaybackTargetRef.current.paused || isPvdDocumentHidden() ? 0 : 1;
      const playerVars = {
        autoplay: shouldAutoplay,
        start: target,
        playsinline: 1,
        controls: 0,
        cc_load_policy: captionsEnabled ? 1 : 0,
        cc_lang_pref: 'ko',
        disablekb: 1,
        iv_load_policy: 3,
        rel: 0,
        modestbranding: 1,
        origin: window.location.origin
      };

      const onError = (event: YouTubePlayerEvent) => {
        if (!isExpectedYouTubePlayerMedia(event?.target)) return;
        if (playbackModeRef.current === 'idle') {
          idlePlayingRef.current = false;
          idleAdvanceRef.current('error');
        }
        else report('error');
      };
      const onStateChange = (e: YouTubePlayerEvent) => {
        try {
          if (!isExpectedYouTubePlayerMedia(e?.target)) return;
          const activePlayer = e?.target || playerRef.current;
          const t = activePlayer?.getCurrentTime ? Number(activePlayer.getCurrentTime()) : 0;
          lastTimeRef.current = t;
          const now = Date.now();
          if (playbackModeRef.current === 'idle') {
            if (idlePausedRef.current || !idleOwnerRef.current || isPvdDocumentHidden()) {
              activePlayer?.pauseVideo?.();
              return;
            }
            const track = idlePlaylistRef.current.tracks.find((entry) => entry.mediaId === currentVidRef.current);
            if (track && e?.data === YT.PlayerState.PLAYING) {
              idleTrackRef.current = { id: track.id, mediaId: track.mediaId, title: track.title, durationSec: Number(activePlayer?.getDuration?.() || track.durationSec || 0) };
            }
            if (e?.data === YT.PlayerState.PLAYING) idlePlayingRef.current = true;
            else if (e?.data === YT.PlayerState.PAUSED || e?.data === YT.PlayerState.ENDED) idlePlayingRef.current = false;
            idleReportRef.current();
          }
          if (e && e.data === YT.PlayerState.ENDED) {
            if (playbackModeRef.current === 'idle') idleAdvanceRef.current('end');
            else report('end');
          } else if (playbackModeRef.current !== 'donation') {
            return;
          } else if (e && e.data === YT.PlayerState.PAUSED) {
            if (!isPvdDocumentHidden() && now > suppressUntilRef.current && now - lastEmitRef.current > 300) { lastEmitRef.current = now; emitControl('pause', Math.floor(t)); }
          } else if (e && e.data === YT.PlayerState.PLAYING) {
            if (youtubePlaybackTargetRef.current.paused || isPvdDocumentHidden()) {
              activePlayer?.pauseVideo?.();
              return;
            }
            reportYouTubeDuration();
            if (!isPvdDocumentHidden() && now > suppressUntilRef.current && now - lastEmitRef.current > 300) { lastEmitRef.current = now; emitControl('play', Math.floor(t)); }
          }
        } catch {}
      };
      const onReady = (event: YouTubePlayerEvent) => {
        if (!isExpectedYouTubePlayerMedia(event?.target)) return;
        applyYouTubeCaptions(captionsEnabled);
        applyVolume(volumeRef.current);
        const latest = youtubePlaybackTargetRef.current;
        applyPlaybackTarget(latest.atSec, latest.paused, true);
        reportYouTubeDuration();
      };

      if (!playerRef.current) {
        const mount = createYouTubePlayerMount();
        if (!mount) return;
        playerRef.current = new YT.Player(mount, {
          width: '100%', height: '100%', videoId,
          playerVars,
          events: { onError, onReady, onStateChange }
        });
      } else {
        try {
          suppressUntilRef.current = Date.now() + 1000;
          playerRef.current.loadVideoById?.({ videoId, startSeconds: target });
          setTimeout(() => applyYouTubeCaptions(captionsEnabled), 200);
        } catch {
          try { playerRef.current.destroy?.(); } catch {}
          playerRef.current = null;
          const mount = createYouTubePlayerMount();
          if (!mount) return;
          playerRef.current = new YT.Player(mount, {
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
        if (seq !== ensureSeqRef.current) return;
        applyYouTubeCaptions(captionsEnabled);
        applyVolume(volumeRef.current);
        const latest = youtubePlaybackTargetRef.current;
        applyPlaybackTarget(latest.atSec, latest.paused, true);
      }, 250);
    }).catch(() => {});
  }, [applyPlaybackTarget, applyVolume, applyYouTubeCaptions, captionsEnabled, createYouTubePlayerMount, emitControl, getYouTubeApi, isExpectedYouTubePlayerMedia, report, reportYouTubeDuration]);

  const ensureExternalPlayer = useCallback((item: VideoDonationItem, opts?: PlaybackTarget) => {
    const seq = ++ensureSeqRef.current;
    expectedYouTubeMediaIdRef.current = '__external__';
    const provider = getItemProvider(item);
    const start = Math.max(0, Math.floor(Number(item?.startSec || 0) || 0));
    const target = Math.max(start, Math.floor(Number(opts?.atSec ?? start)));
    const key = getMediaKey(item);
    const nextItemId = item?.id ? String(item.id) : key;
    if (currentItemIdRef.current !== nextItemId) {
      currentItemIdRef.current = nextItemId;
      lastReportRef.current = null;
    }
    externalProviderRef.current = provider;
    externalTargetRef.current = target;
    externalPausedRef.current = opts?.paused === true;
    if (provider === 'tiktok') {
      tiktokPlayingSeenRef.current = false;
      tiktokReadyAtRef.current = Date.now();
      tiktokPlayingStartedAtRef.current = 0;
      tiktokDurationRef.current = 0;
      tiktokDurationReportedRef.current = 0;
      tiktokEarlyEndRetryRef.current = 0;
    }

    try { playerRef.current && playerRef.current.stopVideo && playerRef.current.stopVideo(); } catch {}
    try { playerRef.current && playerRef.current.destroy && playerRef.current.destroy(); } catch {}
    playerRef.current = null;
    clearYouTubePlayerHost();
    setYoutubeActive(false);
    currentVidRef.current = null;
    currentStartRef.current = 0;

    if (externalMediaKeyRef.current === key && externalFrameRef.current) {
      applyExternalPlaybackTarget(target, opts?.paused);
      return;
    }

    externalMediaKeyRef.current = key;
    lastTimeRef.current = target;
    const viewerSrc = buildExternalSrc(item, target, opts?.paused);
    setExternalItem({
      ...item,
      viewerSrc,
      provider,
      mediaKey: key,
      targetAtSec: target,
      paused: opts?.paused === true,
      isDirectVideo: isDirectVideoUrl(viewerSrc),
      blockedReason: provider === 'chzzk_clip' && !isDirectVideoUrl(viewerSrc) ? 'chzzk_clip_mp4_unavailable' : null,
    });
    setTimeout(() => {
      if (seq !== ensureSeqRef.current) return;
      applyVolume(volumeRef.current);
      applyExternalPlaybackTarget(externalTargetRef.current, externalPausedRef.current);
    }, 450);
  }, [applyExternalPlaybackTarget, applyVolume, buildExternalSrc, clearYouTubePlayerHost, getItemProvider, getMediaKey]);

  const applyIdlePlaylistConfig = useCallback((value: unknown) => {
    const next = normalizePvdIdlePlaylist(value);
    const signature = getPvdIdlePlaylistSignature(next);
    if (signature === idleSignatureRef.current) return idlePlaylistRef.current;
    if (signature !== idleSignatureRef.current) {
      mixPlayerRef.current?.configure(next);
      idleSignatureRef.current = signature;
      idleOrderRef.current = createPvdIdlePlaybackOrder(next);
      idleCursorRef.current = 0;
      idleCurrentMediaIdRef.current = null;
      idleResumeAtRef.current = 0;
      idleExhaustedRef.current = false;
      idleFailedMediaIdsRef.current = new Set();
    }
    idlePlaylistRef.current = next;
    return next;
  }, []);

  const startIdlePlayback = useCallback(() => {
    const playlist = idlePlaylistRef.current;
    if (playlist.enabled && playlist.mode === 'recommended') {
      if (!mixActiveRef.current) stopPlayer();
      playbackModeRef.current = 'idle';
      mixActiveRef.current = true;
      setMixActive(true);
      setYoutubeActive(true);
      mixPlayerRef.current?.setVolume(volumeRef.current);
      mixPlayerRef.current?.setCaptions(captionsEnabled);
      mixPlayerRef.current?.start(playlist);
      mixPlayerRef.current?.setPaused(idlePausedRef.current);
      return;
    }
    if (mixActiveRef.current) stopPlayer();
    if (!playlist.enabled || !playlist.tracks.length) {
      if (playbackModeRef.current === 'idle') stopPlayer();
      return;
    }
    if (idleExhaustedRef.current) {
      if (playbackModeRef.current === 'donation') stopPlayer();
      return;
    }
    if (!idleOrderRef.current.length) {
      idleOrderRef.current = createPvdIdlePlaybackOrder(playlist);
      idleCursorRef.current = 0;
    }

    let mediaId = idleCurrentMediaIdRef.current;
    if (!mediaId || !idleOrderRef.current.includes(mediaId)) {
      idleCursorRef.current = Math.max(0, Math.min(idleCursorRef.current, idleOrderRef.current.length - 1));
      mediaId = idleOrderRef.current[idleCursorRef.current] || null;
      idleCurrentMediaIdRef.current = mediaId;
      idleResumeAtRef.current = 0;
    }
    const track = playlist.tracks.find((item) => item.mediaId === mediaId);
    if (!track) {
      idleExhaustedRef.current = true;
      stopPlayer();
      return;
    }

    const alreadyActive = playbackModeRef.current === 'idle'
      && currentVidRef.current === track.mediaId
      && !!playerRef.current;
    playbackModeRef.current = 'idle';
    if (alreadyActive) {
      applyYouTubeCaptions(captionsEnabled);
      applyVolume(volumeRef.current);
      try {
        if (isPvdDocumentHidden() || idlePausedRef.current || !idleOwnerRef.current) playerRef.current?.pauseVideo?.();
        else playerRef.current?.playVideo?.();
      } catch {}
      return;
    }

    idlePlayingRef.current = false;
    ensurePlayer(track.mediaId, 0, {
      atSec: Math.max(0, idleResumeAtRef.current),
      paused: isPvdDocumentHidden() || idlePausedRef.current || !idleOwnerRef.current,
      force: true,
      itemId: `idle:${track.id}`,
    });
  }, [applyVolume, applyYouTubeCaptions, captionsEnabled, ensurePlayer, stopPlayer]);

  const activateDeferredDonation = useCallback((itemOverride?: VideoDonationItem | null) => {
    const item = itemOverride || deferredDonationRef.current;
    const itemId = String(item?.id || '').trim();
    if (!token || !item || !itemId || deferredActivationItemIdRef.current === itemId) return;

    deferredActivationItemIdRef.current = itemId;
    const apiBase = getViewerApiBase();
    fetch(`${apiBase}/api/video-donation/activate-by-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, itemId, clientId: idleClientIdRef.current }),
    }).catch(() => null).finally(() => {
      if (deferredActivationItemIdRef.current === itemId) deferredActivationItemIdRef.current = null;
      void playbackSyncRef.current(true);
    });
  }, [getViewerApiBase, token]);

  const advanceIdlePlayback = useCallback((cause: 'end' | 'error') => {
    const playlist = idlePlaylistRef.current;
    const currentMediaId = idleCurrentMediaIdRef.current;
    const deferredItem = deferredDonationRef.current;
    if (playlist.mode === 'recommended') {
      if (deferredItem) { stopPlayer(); activateDeferredDonation(deferredItem); }
      return;
    }
    if (!playlist.enabled || !idleOrderRef.current.length) {
      stopPlayer();
      if (deferredItem) activateDeferredDonation(deferredItem);
      return;
    }
    if (cause === 'error' && currentMediaId) idleFailedMediaIdsRef.current.add(currentMediaId);

    let order = idleOrderRef.current;
    let cursor = idleCursorRef.current;
    let nextMediaId: string | null = null;
    let inspected = 0;
    while (inspected < order.length) {
      cursor += 1;
      if (cursor >= order.length) {
        if (!playlist.loop) break;
        order = createPvdIdlePlaybackOrder(playlist);
        if (order.length > 1 && order[0] === currentMediaId) {
          [order[0], order[1]] = [order[1], order[0]];
        }
        idleOrderRef.current = order;
        cursor = 0;
      }
      const candidate = order[cursor] || null;
      inspected += 1;
      if (candidate && !idleFailedMediaIdsRef.current.has(candidate)) {
        nextMediaId = candidate;
        break;
      }
    }

    if (!nextMediaId) {
      idleCursorRef.current = order.length;
      idleExhaustedRef.current = true;
      idleCurrentMediaIdRef.current = null;
      idleResumeAtRef.current = 0;
      stopPlayer();
      if (deferredItem) activateDeferredDonation(deferredItem);
      return;
    }
    idleCursorRef.current = cursor;
    idleCurrentMediaIdRef.current = nextMediaId;
    idleResumeAtRef.current = 0;
    currentVidRef.current = null;
    if (deferredItem) {
      stopPlayer();
      activateDeferredDonation(deferredItem);
      return;
    }
    startIdlePlayback();
  }, [activateDeferredDonation, startIdlePlayback, stopPlayer]);

  useEffect(() => {
    idleAdvanceRef.current = advanceIdlePlayback;
    return () => {
      idleAdvanceRef.current = () => {};
    };
  }, [advanceIdlePlayback]);

  const playDonationItem = useCallback((item: VideoDonationItem, payload: Record<string, unknown>, force = false) => {
    deferredDonationRef.current = null;
    deferredActivationItemIdRef.current = null;
    captureIdlePosition();
    playbackModeRef.current = 'donation';
    const start = Math.max(0, Math.floor(Number(item.startSec || 0) || 0));
    const target = {
      atSec: getPlaybackAtSec(item, payload),
      paused: payload.paused === true,
      force,
      itemId: item.id ? String(item.id) : null,
    };
    if (getItemProvider(item) === 'youtube') {
      ensurePlayer(String(item.videoId || item.mediaId), start, target);
    } else {
      ensureExternalPlayer(item, target);
    }
    suppressUntilRef.current = Date.now() + 1000;
  }, [captureIdlePosition, ensureExternalPlayer, ensurePlayer, getItemProvider]);

  const applyServerPlaybackPayload = useCallback((payload: Record<string, unknown>, force = false) => {
    playbackPayloadVersionRef.current += 1;
    if (payload.volume != null) applyVolume(Number(payload.volume));
    const playlist = Object.prototype.hasOwnProperty.call(payload, 'idlePlaylist')
      ? applyIdlePlaylistConfig(payload.idlePlaylist)
      : idlePlaylistRef.current;
    const item = payload.item as VideoDonationItem | null | undefined;
    if (item && (item.mediaProvider || item.videoId || item.embedUrl)) {
      if (payload.idleDeferred === true) {
        deferredDonationRef.current = item;
        if (playlist.enabled && playbackModeRef.current === 'idle') return;
        if (!idleOwnerRef.current) return;
        activateDeferredDonation(item);
        return;
      }
      playDonationItem(item, payload, force);
      return;
    }
    deferredDonationRef.current = null;
    deferredActivationItemIdRef.current = null;
    if (playlist.enabled) startIdlePlayback();
    else stopPlayer();
  }, [activateDeferredDonation, applyIdlePlaylistConfig, applyVolume, playDonationItem, startIdlePlayback, stopPlayer]);

  const toggleCaptions = useCallback(() => {
    const next = !captionsEnabled;
    setCaptionsEnabled(next);
    applyYouTubeCaptions(next);
  }, [applyYouTubeCaptions, captionsEnabled]);

  const resyncFromServer = useCallback(async (force = false) => {
    if (!token) return;
    const now = Date.now();
    if (!force && now - lastServerSyncRef.current < 1000) return;
    lastServerSyncRef.current = now;
    const version = playbackPayloadVersionRef.current;

    try {
      const apiBase = getViewerApiBase();
      const r = await fetch(`${apiBase}/api/video-donation/now-playing?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json() as Record<string, unknown>;
      if (version !== playbackPayloadVersionRef.current) return;
      const durationProbes = Array.isArray(data.durationProbes) ? data.durationProbes : [];
      for (const probe of durationProbes) {
        if (isUnknownRecord(probe)) handleDurationProbe(probe);
      }
      applyServerPlaybackPayload(data, force);
    } catch {}
  }, [applyServerPlaybackPayload, getViewerApiBase, handleDurationProbe, token]);

  useEffect(() => {
    playbackSyncRef.current = resyncFromServer;
    return () => {
      playbackSyncRef.current = () => {};
    };
  }, [resyncFromServer]);

  useEffect(() => {
    idleControlRef.current = (command) => {
      const version = Number(command.version || 0);
      if (command.clientId !== idleClientIdRef.current || version <= idleControlVersionRef.current) return;
      idleControlVersionRef.current = version;
      if (playbackModeRef.current !== 'idle') return;
      const op = String(command.op || '');
      if (op === 'skip' && command.itemId !== `idle:${idleClientIdRef.current}:${idleTrackRef.current?.id}`) return;
      idlePausedRef.current = op === 'pause';
      if (mixActiveRef.current) {
        mixPlayerRef.current?.setPaused(idlePausedRef.current);
        if (op === 'skip') mixPlayerRef.current?.skip();
      } else if (op === 'skip') advanceIdlePlayback('end');
      else if (op === 'pause') {
        youtubePlaybackTargetRef.current.paused = true;
        playerRef.current?.pauseVideo?.();
      } else {
        youtubePlaybackTargetRef.current.paused = false;
        startIdlePlayback();
      }
      idleReportRef.current();
    };
    return () => { idleControlRef.current = () => {}; };
  }, [advanceIdlePlayback, startIdlePlayback]);

  useEffect(() => {
    if (!token) return;
    idleClientIdRef.current ||= crypto.randomUUID?.() || `pvd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    let disposed = false;
    let sending = false;
    let pending = false;
    let controller: AbortController | null = null;
    const reportIdle = async () => {
      if (disposed) return;
      if (sending) { pending = true; return; }
      sending = true;
      pending = false;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 5000);
      try {
        const response = await fetch(`${getViewerApiBase()}/api/video-donation/control-by-token`, {
          signal: controller.signal,
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token, op: 'idle_status', clientId: idleClientIdRef.current, sequence: ++idleSequenceRef.current,
            source: (window as Window & { obsstudio?: unknown }).obsstudio ? 'obs' : 'browser',
            mode: playbackModeRef.current, track: idleTrackRef.current,
            playing: idlePlayingRef.current, paused: idlePausedRef.current || isPvdDocumentHidden(),
            atSec: mixActiveRef.current ? mixPlayerRef.current?.getCurrentTime() : playerRef.current?.getCurrentTime?.(),
            controlVersion: idleControlVersionRef.current,
          }),
        });
        if (!response.ok || disposed) return;
        const result = await response.json();
        if (disposed) return;
        const wasOwner = idleOwnerRef.current;
        idleOwnerRef.current = result.accepted !== false;
        if (!idleOwnerRef.current && playbackModeRef.current === 'idle') {
          mixPlayerRef.current?.setPaused(true);
          playerRef.current?.pauseVideo?.();
        } else if (!wasOwner && playbackModeRef.current === 'idle') startIdlePlayback();
        if (isUnknownRecord(result.command)) idleControlRef.current(result.command);
      } catch {
        // Keep local playback alive through a temporary API outage.
      } finally {
        clearTimeout(timeout);
        controller = null;
        sending = false;
        if (pending && !disposed) void reportIdle();
      }
    };
    idleReportRef.current = () => { void reportIdle(); };
    const interval = setInterval(() => { void reportIdle(); }, 5000);
    void reportIdle();
    return () => {
      disposed = true;
      controller?.abort();
      clearInterval(interval);
      idleReportRef.current = () => {};
    };
  }, [getViewerApiBase, startIdlePlayback, token]);

  // Page lifecycle handling: pause locally while hidden, then force-align to server on return.
  useEffect(() => {
    if (!token) return;

    const pauseLocalOnly = () => {
      captureIdlePosition();
      suppressUntilRef.current = Date.now() + 4000;
      try { playerRef.current && playerRef.current.pauseVideo && playerRef.current.pauseVideo(); } catch {}
    };

    const onVisibility = () => {
      if (isPvdDocumentHidden()) {
        pauseLocalOnly();
      } else {
        void resyncFromServer(true);
      }
    };

    const onResume = () => {
      if (!isPvdDocumentHidden()) void resyncFromServer(true);
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
  }, [captureIdlePosition, resyncFromServer, token]);

  // WS first; fallback to HTTP polling on error/close
  useEffect(() => {
    if (!token) return;
    const apiBase = getViewerApiBase();
    reconnectRef.current.closed = false;
    let apiUrl: URL;
    try { apiUrl = new URL(apiBase); } catch { apiUrl = new URL(window.location.origin); }
    const wsProto = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws: WebSocket | null = null;
    let disposed = false;

    const startPolling = () => {
      if (pollTimerRef.current) return; // already polling
      pollTimerRef.current = setInterval(async () => {
        if (!isPvdDocumentHidden()) void resyncFromServer(false);
      }, 2500);
    };

    const stopPolling = () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    };

    const connectWs = () => {
      try {
        ws = new WebSocket(`${wsProto}//${apiUrl.host}/api/pvd/ws?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(idleClientIdRef.current)}`);
      } catch {
        ws = null;
        scheduleReconnect();
        startPolling();
        return;
      }
      ws.onopen = () => {
        if (disposed) { ws?.close(); return; }
        // Connected: stop polling and reset backoff
        stopPolling();
        reconnectRef.current.attempts = 0;
        void resyncFromServer(true);
      };
      ws.onmessage = (ev) => {
        if (disposed) return;
        try {
          const data = JSON.parse(ev.data) as Record<string, unknown>;
          if (data?.type === 'duration_probe') {
            handleDurationProbe(data, ws);
            return;
          }
          if (data?.type === 'start') {
            applyServerPlaybackPayload(data, true);
          } else if (data?.type === 'control') {
            playbackPayloadVersionRef.current += 1;
            const op = String(data.op || '').toLowerCase();
            if (op === 'volume') {
              applyVolume(Number(data.volume));
              return;
            }
            if (op === 'idle-playlist') {
              const playlist = applyIdlePlaylistConfig(data.idlePlaylist);
              if (playbackModeRef.current !== 'donation') {
                if (playlist.enabled) startIdlePlayback();
                else {
                  const deferredItem = deferredDonationRef.current;
                  stopPlayer();
                  if (deferredItem) activateDeferredDonation(deferredItem);
                }
              }
              return;
            }
            if (op === 'idle-control' && isUnknownRecord(data.command)) {
              idleControlRef.current(data.command);
              return;
            }
            if (playbackModeRef.current !== 'donation') return;
            const at = Number(data.atSec || 0) || 0;
            if (expectedYouTubeMediaIdRef.current !== '__external__') {
              applyPlaybackTarget(Math.max(0, Math.floor(at)), op === 'pause' || data?.paused === true, true, true);
            } else {
              applyExternalPlaybackTarget(Math.max(0, Math.floor(at)), op === 'pause' || data?.paused === true);
            }
          }
        } catch {}
      };
      ws.onerror = () => {
        if (!disposed) startPolling();
      };
      ws.onclose = () => {
        if (!disposed && !reconnectRef.current.closed) {
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
      disposed = true;
      reconnectState.closed = true;
      if (reconnectState.timer) clearTimeout(reconnectState.timer);
      reconnectState.timer = null;
      if (ws) { try { ws.close(); } catch {} }
      stopPolling();
      youtubeDurationProbeRunnerRef.current?.dispose();
      youtubeDurationProbeRunnerRef.current = null;
      try { playerRef.current && playerRef.current.destroy && playerRef.current.destroy(); } catch {}
      playerRef.current = null;
    };
  }, [activateDeferredDonation, applyExternalPlaybackTarget, applyIdlePlaylistConfig, applyPlaybackTarget, applyServerPlaybackPayload, applyVolume, getViewerApiBase, handleDurationProbe, resyncFromServer, startIdlePlayback, stopPlayer, token]);

  // Low-frequency drift guard for viewers that stay connected but whose YouTube iframe stalls.
  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => {
      if (!isPvdDocumentHidden() && playbackModeRef.current === 'donation' && playerRef.current) void resyncFromServer(false);
    }, 7500);
    return () => {
      try { clearInterval(id); } catch {}
      if (volumeEmitTimerRef.current) clearTimeout(volumeEmitTimerRef.current);
    };
  }, [resyncFromServer, token]);

  // Detect manual seek (scrub) and broadcast 'seek' when a significant jump is detected
  useEffect(() => {
    const id = setInterval(() => {
      try {
        const YT = (window as YouTubeWindow).YT;
        if (!YT || !playerRef.current || !playerRef.current.getCurrentTime) return;
        const t = Number(playerRef.current.getCurrentTime());
        if (playbackModeRef.current !== 'donation') {
          lastTimeRef.current = t;
          return;
        }
        const diff = Math.abs(t - lastTimeRef.current);
        const now = Date.now();
        if (!isPvdDocumentHidden() && diff > 1.5 && now > suppressUntilRef.current) {
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
      <div ref={playerDivRef} style={{ width: '100%', height: '100%', display: externalItem || mixActive ? 'none' : 'block' }} />
      <div ref={mixDivRef} data-youtube-mix-player style={{ position: 'fixed', inset: 0, display: mixActive ? 'block' : 'none' }} />
      {autoplayBlocked && mixActive ? (
        <button type="button" aria-label="대기 음악 재생" title="대기 음악 재생"
          onClick={() => { idlePausedRef.current = false; mixPlayerRef.current?.setPaused(false); }}
          style={{ position: 'fixed', zIndex: 10, left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 56, height: 56, display: 'grid', placeItems: 'center', borderRadius: 8, color: 'white', background: '#222' }}>
          <Play size={28} />
        </button>
      ) : null}
      {externalItem ? (
        <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
          {externalItem.viewerSrc && externalItem.isDirectVideo ? (
            <video
              key={externalItem.mediaKey}
              ref={externalVideoRef}
              src={externalItem.viewerSrc}
              autoPlay={!externalItem.paused}
              playsInline
              controls={false}
              muted={volume <= 0}
              poster={externalItem.thumbnailUrl || undefined}
              onLoadedMetadata={(event) => {
                try {
                  event.currentTarget.volume = volumeRef.current / 100;
                  event.currentTarget.muted = volumeRef.current <= 0;
                  const duration = Number(event.currentTarget.duration);
                  if (Number.isFinite(duration) && duration > 0) {
                    emitControl('duration', undefined, undefined, Math.ceil(duration));
                  }
                  const start = Math.max(0, Math.floor(externalTargetRef.current));
                  if (start > 0) event.currentTarget.currentTime = start;
                } catch {}
              }}
              onCanPlay={(event) => {
                try {
                  event.currentTarget.volume = volumeRef.current / 100;
                  event.currentTarget.muted = volumeRef.current <= 0;
                  if (externalPausedRef.current || isPvdDocumentHidden()) {
                    event.currentTarget.pause();
                  } else {
                    const result = event.currentTarget.play();
                    if (result && typeof result.catch === 'function') result.catch(() => {});
                  }
                } catch {}
              }}
              onPlay={(event) => {
                if (externalPausedRef.current || isPvdDocumentHidden()) event.currentTarget.pause();
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
              onLoad={() => {
                if (externalItem.provider !== 'tiktok') return;
                window.setTimeout(() => {
                  if (externalMediaKeyRef.current !== externalItem.mediaKey || expectedYouTubeMediaIdRef.current !== '__external__') return;
                  applyVolume(volumeRef.current);
                  applyExternalPlaybackTarget(externalTargetRef.current, externalPausedRef.current);
                }, 250);
              }}
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
                <div style={{ marginBottom: '0.75rem', fontSize: 'clamp(1.35rem,3vw,2rem)' }}>{externalItem.title || '영상 후원'}</div>
                <div>
                  {externalItem.blockedReason === 'chzzk_clip_mp4_unavailable'
                    ? '치지직 클립 mp4를 가져오지 못했습니다.'
                    : externalItem.blockedReason}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <div
        style={{
          position: 'fixed',
          right: 0,
          bottom: 0,
          padding: 'clamp(0.75rem,2vw,1.25rem)',
          background: 'transparent',
        }}
        onMouseEnter={() => setVolumeControlsVisible(true)}
        onMouseLeave={() => setVolumeControlsVisible(false)}
        onFocusCapture={() => setVolumeControlsVisible(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setVolumeControlsVisible(false);
        }}
      >
        <div
          style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'clamp(0.55rem,1.3vw,0.8rem)',
          padding: 'clamp(0.55rem,1.2vw,0.75rem) clamp(0.75rem,1.6vw,1rem)',
          borderRadius: '999px',
          border: '1px solid rgba(255,255,255,0.22)',
          background: 'rgba(15, 23, 42, 0.72)',
          color: 'white',
          font: '600 clamp(0.78rem,1.3vw,0.92rem) system-ui, sans-serif',
          opacity: volumeControlsVisible ? 1 : 0,
          visibility: volumeControlsVisible ? 'visible' : 'hidden',
          pointerEvents: volumeControlsVisible ? 'auto' : 'none',
          transform: volumeControlsVisible ? 'translateY(0)' : 'translateY(8%)',
          transition: 'opacity 160ms ease, transform 160ms ease, visibility 0s linear 160ms',
          backdropFilter: volumeControlsVisible ? 'blur(14px)' : 'none',
        }}
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
          {youtubeActive ? (
            <button
              type="button"
              onClick={toggleCaptions}
              style={{
                minHeight: '2rem',
                border: '1px solid rgba(255,255,255,0.24)',
                borderRadius: '999px',
                background: captionsEnabled ? 'rgba(110,231,183,0.28)' : 'rgba(255,255,255,0.12)',
                color: 'white',
                padding: '0 0.75rem',
                font: '700 0.78rem system-ui, sans-serif',
                cursor: 'pointer',
              }}
              aria-pressed={captionsEnabled}
              aria-label={captionsEnabled ? '유튜브 자막 끄기' : '유튜브 자막 켜기'}
            >
              자막 {captionsEnabled ? '켬' : '끔'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
