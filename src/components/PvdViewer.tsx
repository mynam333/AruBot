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
import { Pause, Play, SkipForward } from 'lucide-react';
import { createYouTubeDurationProbeRunner, type YouTubeDurationProbeRequest, type YouTubeDurationProbeResult } from '@/components/youtubeDurationProbe';
import { getBrowserApiBase } from '@/shared/api/http';
import { connectOverlaySocket } from '@/shared/api/overlay-socket';

type PlaybackTarget = {
  atSec?: number;
  paused?: boolean;
  force?: boolean;
  itemId?: string | null;
  syncPosition?: boolean;
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
  getPlayerState?: () => number;
  getPlaybackRate?: () => number;
  getVideoData?: () => { video_id?: string };
  loadModule?: (name: string) => void;
  loadVideoById?: (options: { videoId: string; startSeconds: number }) => void;
  cueVideoById?: (options: string | { videoId: string; startSeconds: number }) => void;
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

export default function PvdViewer({ viewerToken, playerRole = 'video' }: { viewerToken?: string; playerRole?: 'video' | 'bgm' } = {}) {
  const isPlayerHidden = useCallback(() => playerRole === 'bgm' ? document.hidden : isPvdDocumentHidden(), [playerRole]);
  const bgmEnabledRef = useRef(false);
  const bgmConfigRef = useRef<Record<string, unknown>>({});
  const bgmOwnerRef = useRef(false);
  const bgmSequenceRef = useRef(0);
  const bgmReadyItemIdRef = useRef<string | null>(null);
  const bgmReportRef = useRef<() => void>(() => {});
  const [bgmStatus, setBgmStatus] = useState('BGM 연결 중');
  const [bgmPaused, setBgmPaused] = useState(false);
  const [token, setToken] = useState<string>(viewerToken || '');
  const [volume, setVolume] = useState(100);
  const [externalItem, setExternalItem] = useState<ExternalVideoDonationItem | null>(null);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const captionsEnabledRef = useRef(false);
  const [youtubeActive, setYoutubeActive] = useState(false);
  const [mixActive, setMixActive] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const autoplayBlockedRef = useRef(false);
  const updateAutoplayBlocked = useCallback((blocked: boolean) => {
    autoplayBlockedRef.current = blocked;
    setAutoplayBlocked(blocked);
  }, []);
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
  const currentEndRef = useRef<number>(Infinity);
  const volumeEmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ytReadyPromiseRef = useRef<Promise<YouTubeApi> | null>(null);
  const youtubeDurationProbeRunnerRef = useRef<ReturnType<typeof createYouTubeDurationProbeRunner> | null>(null);
  const ensureSeqRef = useRef<number>(0);
  const lastServerSyncRef = useRef<number>(0);
  const playbackPayloadVersionRef = useRef(0);
  const serverPlaybackRevisionRef = useRef(0);
  const serverPlaybackEpochRef = useRef('');
  const retiredPlaybackEpochsRef = useRef(new Set<string>());
  const nativeSeekCandidateRef = useRef<{ atSec: number; since: number } | null>(null);
  const localPlaybackControlsRef = useRef(new Set<string>());
  const pendingPlaybackControlsRef = useRef(0);
  const youtubePlaybackTargetRef = useRef({ atSec: 0, paused: false });
  const pendingYouTubeSeekRef = useRef<{ atSec: number; expiresAt: number } | null>(null);
  const lastEmitRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const lastTimeSampleAtRef = useRef(0);
  const suppressUntilRef = useRef<number>(0);
  const currentItemIdRef = useRef<string | null>(null);
  const lastReportRef = useRef<{ itemId: string | null; at: number } | null>(null);
  const pendingFinishRef = useRef<{ itemId: string; cause: 'end' | 'error'; sending: boolean } | null>(null);
  const finishRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const youtubeDurationReportedRef = useRef<{ itemId: string | null; durationSec: number } | null>(null);
  const externalTargetRef = useRef(0);
  const externalPausedRef = useRef(false);
  const chzzkDonationPausedRef = useRef(false);
  const serverQueuePausedRef = useRef(false);
  const serverQueueIdleDeferredRef = useRef(false);
  const serverQueueOtherPlayerRef = useRef(false);
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

  // A deferred or other-role queue head may be paused while this viewer's idle song must continue.
  const isServerQueueBlockingPlayback = useCallback(() => (
    serverQueuePausedRef.current && (playbackModeRef.current === 'donation'
      || (!serverQueueIdleDeferredRef.current && !serverQueueOtherPlayerRef.current))
  ), []);

  const isPlaybackBlocked = useCallback(() => (
    chzzkDonationPausedRef.current || isServerQueueBlockingPlayback() || isPlayerHidden()
    || (playerRole === 'bgm' && (!bgmEnabledRef.current || !bgmOwnerRef.current))
  ), [isPlayerHidden, isServerQueueBlockingPlayback, playerRole]);

  const isIdlePlaybackBlocked = useCallback(() => (
    isPlaybackBlocked() || idlePausedRef.current || !idleOwnerRef.current
  ), [isPlaybackBlocked]);

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
      isVisible: () => !isPlaybackBlocked() && idleOwnerRef.current,
      controls: playerRole === 'bgm',
      onPauseChange: (paused) => {
        idlePausedRef.current = paused;
        setBgmPaused(paused);
        idleReportRef.current();
      },
      fetchSeed: async (signal) => {
        const response = await fetch(`${getViewerApiBase()}/api/video-donation/idle-playlist/next-by-token`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
          body: JSON.stringify({ token, seedOnly: true, playerRole }),
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
      onBlocked: updateAutoplayBlocked,
      onBoundary: () => {
        if (isIdlePlaybackBlocked()) return false;
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
  }, [getViewerApiBase, getYouTubeApi, playerRole, token, isIdlePlaybackBlocked, isPlaybackBlocked, updateAutoplayBlocked]);

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

  const applyServerPauseState = useCallback((payload: Record<string, unknown>) => {
    const wasInterrupted = chzzkDonationPausedRef.current;
    if (typeof payload.chzzkDonationPaused === 'boolean') {
      chzzkDonationPausedRef.current = payload.chzzkDonationPaused;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'paused')) {
      serverQueuePausedRef.current = payload.paused === true;
    }
    if (typeof payload.idleDeferred === 'boolean') serverQueueIdleDeferredRef.current = payload.idleDeferred;
    if (Object.prototype.hasOwnProperty.call(payload, 'item')) {
      const item = isUnknownRecord(payload.item) ? payload.item : null;
      serverQueueOtherPlayerRef.current = !!item && (item.kind === 'bgm') !== (playerRole === 'bgm');
    }
    if (wasInterrupted !== chzzkDonationPausedRef.current) suppressUntilRef.current = Date.now() + 1000;
    if (!chzzkDonationPausedRef.current && !isServerQueueBlockingPlayback()) return;

    // Keep the live players and manual pause intent intact throughout the server lease.
    suppressUntilRef.current = Date.now() + 1000;
    if (playbackModeRef.current === 'idle') {
      const position = mixActiveRef.current ? mixPlayerRef.current?.getCurrentTime() : playerRef.current?.getCurrentTime?.();
      if (typeof position === 'number' && Number.isFinite(position)) {
        idleResumeAtRef.current = position;
        youtubePlaybackTargetRef.current.atSec = position;
      }
      idlePlayingRef.current = false;
    }
    mixPlayerRef.current?.setPaused(true);
    try { playerRef.current?.pauseVideo?.(); } catch {}
    try { externalVideoRef.current?.pause(); } catch {}
    postToExternalPlayer({ type: 'pause' });
  }, [isServerQueueBlockingPlayback, playerRole, postToExternalPlayer]);

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
      if (normalized <= 0) {
        player.mute && player.mute();
      } else {
        player.unMute && player.unMute();
      }
      // YouTube unMute() can raise volumes below 5%; apply the requested value last.
      if (player.setVolume) player.setVolume(normalized);
    } catch {}
    if (externalProviderRef.current === 'tiktok') {
      postToExternalPlayer({ type: normalized <= 0 ? 'mute' : 'unMute' });
    }
  }, [postToExternalPlayer]);

  const applyYouTubeCaptions = useCallback((enabled = captionsEnabledRef.current) => {
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
  }, []);

  const emitControl = useCallback((op: 'pause' | 'play' | 'seek' | 'volume' | 'duration', atSec?: number, nextVolume?: number, durationSec?: number, source = 'player') => {
    if (!token) return;
    const changesPlayback = op === 'pause' || op === 'play' || op === 'seek';
    if (changesPlayback) {
      if (chzzkDonationPausedRef.current) return;
      if (playerRole === 'bgm' && (!bgmEnabledRef.current || !bgmOwnerRef.current || isPlayerHidden())) return;
      if (serverQueuePausedRef.current && !(playerRole === 'bgm' && (op === 'seek' || source === 'bgm-window'))) return;
      playbackPayloadVersionRef.current += 1;
      pendingPlaybackControlsRef.current += 1;
    }
    const apiBase = getViewerApiBase();
    const controlId = changesPlayback ? crypto.randomUUID() : undefined;
    if (controlId) {
      localPlaybackControlsRef.current.add(controlId);
      if (localPlaybackControlsRef.current.size > 64) localPlaybackControlsRef.current.delete(localPlaybackControlsRef.current.values().next().value!);
    }
    const body = { token, op, atSec, volume: nextVolume, durationSec, source, itemId: currentItemIdRef.current,
      clientId: idleClientIdRef.current, controlId, playbackEpoch: serverPlaybackEpochRef.current,
      playbackRevision: serverPlaybackRevisionRef.current,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let needsResync = false;
    fetch(`${apiBase}/api/video-donation/control-by-token`, {
      signal: controller.signal, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(async response => {
      if (!changesPlayback) return;
      if (!response.ok) { needsResync = true; return; }
      if (typeof response.json !== 'function') return;
      const result = await response.json();
      const message = result.message;
      if (body.itemId === currentItemIdRef.current && message?.playbackEpoch === serverPlaybackEpochRef.current
        && Number.isSafeInteger(message.playbackRevision)) {
        serverPlaybackRevisionRef.current = Math.max(serverPlaybackRevisionRef.current, message.playbackRevision);
      }
    }).catch(() => { needsResync = changesPlayback; }).finally(() => {
      clearTimeout(timeout);
      if (changesPlayback) {
        pendingPlaybackControlsRef.current -= 1;
        playbackPayloadVersionRef.current += 1;
        if (needsResync && pendingPlaybackControlsRef.current === 0) void playbackSyncRef.current(true);
      }
    });
  }, [getViewerApiBase, token, playerRole, isPlayerHidden]);

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

  const applyPlaybackTarget = useCallback((targetSec: number | null, paused?: boolean, force?: boolean, strict?: boolean) => {
    const target = targetSec === null ? youtubePlaybackTargetRef.current.atSec : Math.max(0, Math.floor(targetSec));
    youtubePlaybackTargetRef.current = { atSec: target, paused: paused === true };
    const player = playerRef.current;
    if (!player) return;

    let current = target;
    try {
      if (player.getCurrentTime) current = Number(player.getCurrentTime());
    } catch {}

    const drift = Math.abs(current - target);
    const forwardDrift = target - current;
    const backwardDrift = current - target;
    const shouldSeek = targetSec !== null && (strict === true
      ? drift > 1.25
      : force === true
      ? drift > PVD_FORCE_SYNC_THRESHOLD_SEC
      : (forwardDrift > PVD_FORWARD_SYNC_THRESHOLD_SEC || backwardDrift > PVD_BACKWARD_SYNC_THRESHOLD_SEC));
    suppressUntilRef.current = Date.now() + 1000;

    try {
      if (shouldSeek && player.seekTo) {
        const pending = pendingYouTubeSeekRef.current;
        if (!pending || pending.expiresAt <= Date.now() || Math.abs(pending.atSec - target) > 1.25) {
          pendingYouTubeSeekRef.current = { atSec: target, expiresAt: Date.now() + 5000 };
          player.seekTo(target, true);
        }
        current = Number(player.getCurrentTime?.() ?? current);
      }
      if (pendingYouTubeSeekRef.current && Math.abs(current - pendingYouTubeSeekRef.current.atSec) <= 1.25) {
        pendingYouTubeSeekRef.current = null;
      }
      // Observe the actual player, not the server target we may have deliberately left unapplied.
      lastTimeRef.current = current;
      lastTimeSampleAtRef.current = Date.now();
    } catch {}

    try {
      if (paused || isPlaybackBlocked() || (playbackModeRef.current === 'idle' && isIdlePlaybackBlocked())) {
        player.pauseVideo && player.pauseVideo();
      } else {
        player.playVideo && player.playVideo();
      }
    } catch {}
  }, [isIdlePlaybackBlocked, isPlaybackBlocked]);

  const applyExternalPlaybackTarget = useCallback((targetSec: number | null, paused?: boolean) => {
    const provider = externalProviderRef.current;
    const target = targetSec === null ? externalTargetRef.current : Math.max(0, Math.floor(Number(targetSec || 0)));
    externalTargetRef.current = target;
    externalPausedRef.current = paused === true;
    suppressUntilRef.current = Date.now() + 1000;
    if (targetSec !== null) lastTimeRef.current = target;
    const video = externalVideoRef.current;
    if (video) {
      try {
        if (targetSec !== null && Math.abs(Number(video.currentTime || 0) - target) > 1.25) video.currentTime = target;
        if (paused || isPlaybackBlocked()) {
          video.pause();
        } else {
          const result = video.play();
          if (result && typeof result.catch === 'function') result.catch(() => {});
        }
      } catch {}
      return;
    }
    if (provider === 'tiktok') {
      if (targetSec !== null) postToExternalPlayer({ type: 'seekTo', value: target });
      postToExternalPlayer({ type: paused || isPlaybackBlocked() ? 'pause' : 'play' });
    }
  }, [postToExternalPlayer, isPlaybackBlocked]);

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
    bgmReadyItemIdRef.current = null;
    pendingYouTubeSeekRef.current = null;
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
    if (!token || (playbackModeRef.current !== 'donation' && !pendingFinishRef.current)) return;
    if (!pendingFinishRef.current && (chzzkDonationPausedRef.current || serverQueuePausedRef.current)) return;
    const itemId = pendingFinishRef.current?.itemId || currentItemIdRef.current;
    if (!itemId || pendingFinishRef.current?.sending) return;
    const now = Date.now();
    const lastReport = lastReportRef.current;
    if (lastReport && lastReport.itemId === itemId && now - lastReport.at < 5000) return;
    lastReportRef.current = { itemId, at: now };
    pendingFinishRef.current = { itemId, cause, sending: true };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const apiBase = getViewerApiBase();
    fetch(`${apiBase}/api/video-donation/pop-by-token`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, cause, itemId })
    }).catch(() => null).finally(() => {
      clearTimeout(timeout);
      if (pendingFinishRef.current?.itemId === itemId) pendingFinishRef.current.sending = false;
      void playbackSyncRef.current(true);
      if (pendingFinishRef.current?.itemId === itemId) {
        if (finishRetryTimerRef.current) clearTimeout(finishRetryTimerRef.current);
        finishRetryTimerRef.current = setTimeout(() => {
          if (pendingFinishRef.current?.itemId === itemId) void playbackSyncRef.current(true);
        }, 5000);
      }
    });
    stopPlayer();
  }, [getViewerApiBase, stopPlayer, token]);

  useEffect(() => () => {
    pendingFinishRef.current = null;
    if (finishRetryTimerRef.current) clearTimeout(finishRetryTimerRef.current);
  }, []);

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
          if (externalPausedRef.current || isPlaybackBlocked()) {
            postToExternalPlayer({ type: 'pause' });
            return;
          }
          tiktokPlayingSeenRef.current = true;
          if (!tiktokPlayingStartedAtRef.current) tiktokPlayingStartedAtRef.current = now;
          if (!isPlayerHidden() && now > suppressUntilRef.current && now - lastEmitRef.current > 300) {
            lastEmitRef.current = now;
            emitControl('play', Math.floor(lastTimeRef.current));
          }
          return;
        }
        if (state === 0) {
          if (externalPausedRef.current || isPlaybackBlocked()) return;
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
              if (!externalPausedRef.current && !isPlaybackBlocked() && externalProviderRef.current === 'tiktok') postToExternalPlayer({ type: 'play' });
            }, 350);
          }
          return;
        }
        if (state === 2) {
          if (!isPlaybackBlocked() && now - tiktokReadyAtRef.current > 1000 && now > suppressUntilRef.current && now - lastEmitRef.current > 300) {
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
            if (!externalPausedRef.current && !isPlaybackBlocked() && externalProviderRef.current === 'tiktok') postToExternalPlayer({ type: 'play' });
          }, 500);
          return;
        }
        report('error');
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [applyExternalPlaybackTarget, applyVolume, emitControl, postToExternalPlayer, report, isPlaybackBlocked, isPlayerHidden]);

  const ensurePlayer = useCallback((videoId: string, start: number, opts?: PlaybackTarget) => {
    expectedYouTubeMediaIdRef.current = videoId;
    const seq = ++ensureSeqRef.current;
    const safeStart = Math.max(0, Math.floor(Number(start || 0)));
    const target = Math.max(safeStart, Math.floor(Number(opts?.atSec ?? safeStart)));
    const keepPosition = opts?.syncPosition === false && !!playerRef.current
      && currentItemIdRef.current === String(opts.itemId || videoId);
    youtubePlaybackTargetRef.current = { atSec: keepPosition ? youtubePlaybackTargetRef.current.atSec : target, paused: opts?.paused === true };

    void getYouTubeApi().then((YT) => {
      if (seq !== ensureSeqRef.current || !YT || !YT.Player || !playerDivRef.current) return;
      setExternalItem(null);
      setYoutubeActive(true);
      externalProviderRef.current = null;
      externalMediaKeyRef.current = null;
      const nextItemId = String(opts?.itemId || videoId || '');
      const itemChanged = currentItemIdRef.current !== nextItemId;
      if (itemChanged) {
        currentItemIdRef.current = nextItemId;
        bgmReadyItemIdRef.current = null;
        pendingYouTubeSeekRef.current = null;
        nativeSeekCandidateRef.current = null;
        lastReportRef.current = null;
        youtubeDurationReportedRef.current = null;
      }

      const sameItem = !itemChanged && currentVidRef.current === videoId && currentStartRef.current === safeStart && playerRef.current;
      if (sameItem) {
        applyYouTubeCaptions();
        const latest = youtubePlaybackTargetRef.current;
        applyPlaybackTarget(opts?.syncPosition === false ? null : latest.atSec, latest.paused, opts?.force, opts?.syncPosition === true);
        reportYouTubeDuration();
        return;
      }

      const shouldAutoplay = youtubePlaybackTargetRef.current.paused || isPlaybackBlocked()
        || (playbackModeRef.current === 'idle' && isIdlePlaybackBlocked()) ? 0 : 1;
      const playerVars = {
        autoplay: shouldAutoplay,
        start: target,
        playsinline: 1,
        controls: playerRole === 'bgm' ? 1 : 0,
        cc_load_policy: captionsEnabledRef.current ? 1 : 0,
        cc_lang_pref: 'ko',
        disablekb: playerRole === 'bgm' ? 0 : 1,
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
          if (playerRole !== 'bgm') lastTimeRef.current = t;
          const now = Date.now();
          if (bgmReadyItemIdRef.current !== currentItemIdRef.current
            && activePlayer?.getVideoData?.().video_id === expectedYouTubeMediaIdRef.current
            && (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.PAUSED || e.data === 5)) {
            bgmReadyItemIdRef.current = currentItemIdRef.current;
            bgmReportRef.current();
          }
          if (playerRole === 'bgm' && bgmEnabledRef.current && bgmOwnerRef.current
            && !chzzkDonationPausedRef.current && !isPlayerHidden()
            && !pendingYouTubeSeekRef.current
            && (now > suppressUntilRef.current || e.data === YT.PlayerState.PAUSED)) {
            if (playbackModeRef.current === 'donation') {
              if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.PAUSED) {
                const paused = e.data === YT.PlayerState.PAUSED;
                if (serverQueuePausedRef.current !== paused) {
                  emitControl(paused ? 'pause' : 'play', Math.floor(t), undefined, undefined, 'bgm-window');
                  serverQueuePausedRef.current = paused;
                  youtubePlaybackTargetRef.current = { atSec: t, paused };
                  lastTimeRef.current = t;
                  setBgmPaused(paused);
                }
              }
            } else if (playbackModeRef.current === 'idle' && idleOwnerRef.current && !isPlaybackBlocked()
              && (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.PAUSED)) {
              idlePausedRef.current = e.data === YT.PlayerState.PAUSED;
              youtubePlaybackTargetRef.current.paused = idlePausedRef.current;
              idleResumeAtRef.current = t;
              setBgmPaused(idlePausedRef.current);
              idlePlayingRef.current = !idlePausedRef.current;
              idleReportRef.current();
            }
          }
          if (isPlaybackBlocked()) {
            if (e?.data === YT.PlayerState.PLAYING) activePlayer?.pauseVideo?.();
            return;
          }
          if (playbackModeRef.current === 'idle') {
            if (isIdlePlaybackBlocked()) {
              if (e?.data === YT.PlayerState.PLAYING) activePlayer?.pauseVideo?.();
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
          } else if (playerRole === 'bgm') {
            if (e.data === YT.PlayerState.PLAYING) reportYouTubeDuration();
            return;
          } else if (e && e.data === YT.PlayerState.PAUSED) {
            if (!isPlayerHidden() && now > suppressUntilRef.current && now - lastEmitRef.current > 300) { lastEmitRef.current = now; emitControl('pause', Math.floor(t)); }
          } else if (e && e.data === YT.PlayerState.PLAYING) {
            if (youtubePlaybackTargetRef.current.paused || isPlaybackBlocked()) {
              activePlayer?.pauseVideo?.();
              return;
            }
            reportYouTubeDuration();
          }
        } catch {}
      };
      const onReady = (event: YouTubePlayerEvent) => {
        if (!isExpectedYouTubePlayerMedia(event?.target)) return;
        bgmReadyItemIdRef.current = currentItemIdRef.current;
        applyYouTubeCaptions();
        applyVolume(volumeRef.current);
        const latest = youtubePlaybackTargetRef.current;
        applyPlaybackTarget(latest.atSec, latest.paused, true);
        bgmReportRef.current();
        reportYouTubeDuration();
      };

      if (!playerRef.current) {
        const mount = createYouTubePlayerMount();
        if (!mount) return;
        playerRef.current = new YT.Player(mount, {
          width: '100%', height: '100%', videoId,
          playerVars,
          events: { onError, onReady, onStateChange, onAutoplayBlocked: () => updateAutoplayBlocked(true) }
        });
      } else {
        try {
          suppressUntilRef.current = Date.now() + 1000;
          if (!shouldAutoplay && playerRef.current.cueVideoById) {
            playerRef.current.cueVideoById({ videoId, startSeconds: target });
          } else {
            playerRef.current.loadVideoById?.({ videoId, startSeconds: target });
            if (!shouldAutoplay) playerRef.current.pauseVideo?.();
          }
          setTimeout(() => applyYouTubeCaptions(), 200);
        } catch {
          try { playerRef.current.destroy?.(); } catch {}
          playerRef.current = null;
          const mount = createYouTubePlayerMount();
          if (!mount) return;
          playerRef.current = new YT.Player(mount, {
            width: '100%', height: '100%', videoId,
            playerVars,
            events: { onError, onReady, onStateChange, onAutoplayBlocked: () => updateAutoplayBlocked(true) }
          });
        }
      }

      currentVidRef.current = videoId;
      currentStartRef.current = safeStart;
      lastTimeRef.current = target;
      lastTimeSampleAtRef.current = Date.now();

      setTimeout(() => {
        if (seq !== ensureSeqRef.current) return;
        applyYouTubeCaptions();
        applyVolume(volumeRef.current);
        const latest = youtubePlaybackTargetRef.current;
        applyPlaybackTarget(latest.atSec, latest.paused, true);
      }, 250);
    }).catch(() => {});
  }, [applyPlaybackTarget, applyVolume, applyYouTubeCaptions, createYouTubePlayerMount, emitControl, getYouTubeApi, isExpectedYouTubePlayerMedia, isIdlePlaybackBlocked, isPlaybackBlocked, report, reportYouTubeDuration, isPlayerHidden, playerRole, updateAutoplayBlocked]);

  const ensureExternalPlayer = useCallback((item: VideoDonationItem, opts?: PlaybackTarget) => {
    const seq = ++ensureSeqRef.current;
    expectedYouTubeMediaIdRef.current = '__external__';
    const provider = getItemProvider(item);
    const start = Math.max(0, Math.floor(Number(item?.startSec || 0) || 0));
    const target = Math.max(start, Math.floor(Number(opts?.atSec ?? start)));
    const key = getMediaKey(item);
    const nextItemId = item?.id ? String(item.id) : key;
    const sameItem = currentItemIdRef.current === nextItemId && externalMediaKeyRef.current === key
      && !!(externalFrameRef.current || externalVideoRef.current);
    if (sameItem) {
      applyExternalPlaybackTarget(opts?.syncPosition === false ? null : target, opts?.paused);
      return;
    }
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
    const viewerSrc = buildExternalSrc(item, target, opts?.paused || isPlaybackBlocked());
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
  }, [applyExternalPlaybackTarget, applyVolume, buildExternalSrc, clearYouTubePlayerHost, getItemProvider, getMediaKey, isPlaybackBlocked]);

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
    if (isPlaybackBlocked()) return;
    const playlist = idlePlaylistRef.current;
    if (playlist.enabled && playlist.mode === 'recommended') {
      if (!mixActiveRef.current) stopPlayer();
      playbackModeRef.current = 'idle';
      mixActiveRef.current = true;
      setMixActive(true);
      setYoutubeActive(true);
      mixPlayerRef.current?.setVolume(volumeRef.current);
      mixPlayerRef.current?.setCaptions(captionsEnabledRef.current);
      mixPlayerRef.current?.setPaused(isIdlePlaybackBlocked());
      mixPlayerRef.current?.start(playlist);
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
      youtubePlaybackTargetRef.current = {
        atSec: Number(playerRef.current?.getCurrentTime?.() || idleResumeAtRef.current),
        paused: idlePausedRef.current,
      };
      applyYouTubeCaptions();
      applyVolume(volumeRef.current);
      try {
        if (isIdlePlaybackBlocked()) playerRef.current?.pauseVideo?.();
        else playerRef.current?.playVideo?.();
      } catch {}
      return;
    }

    idlePlayingRef.current = false;
    ensurePlayer(track.mediaId, 0, {
      atSec: Math.max(0, idleResumeAtRef.current),
      paused: idlePausedRef.current,
      force: true,
      itemId: `idle:${track.id}`,
    });
  }, [applyVolume, applyYouTubeCaptions, ensurePlayer, stopPlayer, isIdlePlaybackBlocked, isPlaybackBlocked]);

  const activateDeferredDonation = useCallback((itemOverride?: VideoDonationItem | null) => {
    if (isPlaybackBlocked()) return;
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
  }, [getViewerApiBase, isPlaybackBlocked, token]);

  const advanceIdlePlayback = useCallback((cause: 'end' | 'error') => {
    if (isIdlePlaybackBlocked()) return;
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
  }, [activateDeferredDonation, isIdlePlaybackBlocked, startIdlePlayback, stopPlayer]);

  useEffect(() => {
    idleAdvanceRef.current = advanceIdlePlayback;
    return () => {
      idleAdvanceRef.current = () => {};
    };
  }, [advanceIdlePlayback]);

  const playDonationItem = useCallback((item: VideoDonationItem, payload: Record<string, unknown>, force = false, syncPosition = true) => {
    deferredDonationRef.current = null;
    deferredActivationItemIdRef.current = null;
    captureIdlePosition();
    playbackModeRef.current = 'donation';
    const start = Math.max(0, Math.floor(Number(item.startSec || 0) || 0));
    const duration = Number(item.durationSec);
    currentEndRef.current = Number.isFinite(duration) && duration > 0 ? start + duration : Infinity;
    const target = {
      atSec: getPlaybackAtSec(item, payload),
      paused: payload.paused === true,
      force,
      itemId: item.id ? String(item.id) : null,
      syncPosition,
    };
    if (getItemProvider(item) === 'youtube') {
      ensurePlayer(String(item.videoId || item.mediaId), start, target);
    } else {
      ensureExternalPlayer(item, target);
    }
    suppressUntilRef.current = Date.now() + 1000;
  }, [captureIdlePosition, ensureExternalPlayer, ensurePlayer, getItemProvider]);

  const applyServerPlaybackPayload = useCallback((payload: Record<string, unknown>, force = false) => {
    const sameItem = isUnknownRecord(payload.item) && String(payload.item.id || '') === currentItemIdRef.current;
    const revision = Number(payload.playbackRevision || 0);
    const epoch = String(payload.playbackEpoch || '');
    if (epoch && retiredPlaybackEpochsRef.current.has(epoch)) return;
    const epochChanged = !!epoch && epoch !== serverPlaybackEpochRef.current;
    if (sameItem && ((!epochChanged && revision < serverPlaybackRevisionRef.current) || pendingPlaybackControlsRef.current > 0)) return;
    // Polls/presence broadcasts are observations, not seek commands. Reconnects keep local progress.
    const syncPosition = !sameItem || (epochChanged ? revision > 0 : revision > serverPlaybackRevisionRef.current)
      || (typeof payload.playbackRevision !== 'number' && payload.paused === true && !serverQueuePausedRef.current);
    if (epochChanged) {
      if (serverPlaybackEpochRef.current) retiredPlaybackEpochsRef.current.add(serverPlaybackEpochRef.current);
      if (retiredPlaybackEpochsRef.current.size > 64) retiredPlaybackEpochsRef.current.delete(retiredPlaybackEpochsRef.current.values().next().value!);
      serverPlaybackEpochRef.current = epoch;
    }
    serverPlaybackRevisionRef.current = revision;
    playbackPayloadVersionRef.current += 1;
    applyServerPauseState(payload);
    if (payload.volume != null) applyVolume(Number(payload.volume));
    if (isUnknownRecord(payload.bgm)) bgmConfigRef.current = payload.bgm;
    const bgm = bgmConfigRef.current;
    bgmEnabledRef.current = bgm.enabled === true;
    const playlist = Object.prototype.hasOwnProperty.call(payload, 'idlePlaylist') || playerRole === 'bgm'
      ? applyIdlePlaylistConfig(playerRole === 'bgm' ? bgm.idlePlaylist : payload.idlePlaylist)
      : idlePlaylistRef.current;
    let item = payload.item as VideoDonationItem | null | undefined;
    if (pendingFinishRef.current) {
      if (String(item?.id || '') === pendingFinishRef.current.itemId) {
        report(pendingFinishRef.current.cause);
        return;
      }
      pendingFinishRef.current = null;
      if (finishRetryTimerRef.current) clearTimeout(finishRetryTimerRef.current);
    }
    if (playerRole === 'video' && item?.kind === 'bgm' && !bgmEnabledRef.current) item = null;
    const otherPlayerItem = !!item && (item.kind === 'bgm') !== (playerRole === 'bgm');
    if (playerRole === 'bgm') {
      setBgmPaused(item ? payload.paused === true : idlePausedRef.current);
      setBgmStatus(!bgmEnabledRef.current ? 'BGM 사용 안 함' : otherPlayerItem ? '영상 후원 재생 중' : !bgmOwnerRef.current ? 'BGM 플레이어 연결 대기' : item ? (payload.paused ? 'BGM 일시정지' : 'BGM 신청곡') : '대기 BGM');
    }
    if (otherPlayerItem && playerRole === 'video') {
      deferredDonationRef.current = null;
      deferredActivationItemIdRef.current = null;
      if (playbackModeRef.current === 'donation') stopPlayer();
      if (playlist.enabled) startIdlePlayback();
      else stopPlayer();
      return;
    }
    if (otherPlayerItem || (playerRole === 'bgm' && (!bgmEnabledRef.current || (!bgmOwnerRef.current && !autoplayBlockedRef.current)))) {
      if (playerRole === 'bgm' && playbackModeRef.current === 'donation' && currentItemIdRef.current
        && bgmReadyItemIdRef.current === currentItemIdRef.current && !pendingYouTubeSeekRef.current
        && !nativeSeekCandidateRef.current && Number(playerRef.current?.getCurrentTime?.()) >= currentStartRef.current) {
        void fetch(`${getViewerApiBase()}/api/video-donation/control-by-token`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, op: 'bgm_checkpoint', clientId: idleClientIdRef.current, itemId: currentItemIdRef.current, atSec: playerRef.current?.getCurrentTime?.() }),
        }).catch(() => {});
      }
      captureIdlePosition();
      if (playbackModeRef.current !== 'none') stopPlayer();
      return;
    }
    if (item && (item.mediaProvider || item.videoId || item.embedUrl)) {
      if (payload.idleDeferred === true) {
        deferredDonationRef.current = item;
        if (playlist.enabled && playbackModeRef.current === 'idle') {
          startIdlePlayback();
          return;
        }
        if (!idleOwnerRef.current) return;
        activateDeferredDonation(item);
        return;
      }
      playDonationItem(item, payload, force, syncPosition);
      return;
    }
    deferredDonationRef.current = null;
    deferredActivationItemIdRef.current = null;
    if (playbackModeRef.current === 'donation') stopPlayer();
    if (playlist.enabled) startIdlePlayback();
    else stopPlayer();
  }, [activateDeferredDonation, applyIdlePlaylistConfig, applyServerPauseState, applyVolume, captureIdlePosition, getViewerApiBase, playDonationItem, playerRole, report, startIdlePlayback, stopPlayer, token]);

  const toggleCaptions = useCallback(() => {
    const next = !captionsEnabledRef.current;
    captionsEnabledRef.current = next;
    setCaptionsEnabled(next);
    applyYouTubeCaptions(next);
  }, [applyYouTubeCaptions]);

  const resyncFromServer = useCallback(async (force = false) => {
    if (!token || pendingPlaybackControlsRef.current > 0) return;
    const now = Date.now();
    if (!force && now - lastServerSyncRef.current < 1000) return;
    lastServerSyncRef.current = now;
    const version = playbackPayloadVersionRef.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const apiBase = getViewerApiBase();
      const r = await fetch(`${apiBase}/api/video-donation/now-playing?token=${encodeURIComponent(token)}`, { cache: 'no-store', signal: controller.signal });
      if (!r.ok) return;
      const data = await r.json() as Record<string, unknown>;
      if (version !== playbackPayloadVersionRef.current || pendingPlaybackControlsRef.current > 0) return;
      const durationProbes = Array.isArray(data.durationProbes) ? data.durationProbes : [];
      for (const probe of durationProbes) {
        if (isUnknownRecord(probe)) handleDurationProbe(probe);
      }
      applyServerPlaybackPayload(data, force);
    } catch {} finally { clearTimeout(timeout); }
  }, [applyServerPlaybackPayload, getViewerApiBase, handleDurationProbe, token]);

  useEffect(() => {
    playbackSyncRef.current = resyncFromServer;
    return () => {
      playbackSyncRef.current = () => {};
    };
  }, [resyncFromServer]);

  useEffect(() => {
    if (playerRole !== 'bgm' || !token) return;
    idleClientIdRef.current ||= crypto.randomUUID();
    let disposed = false;
    let sending = false;
    let lastAcceptedAt = 0;
    const releasePlayback = () => {
      bgmOwnerRef.current = false;
      captureIdlePosition();
      try { playerRef.current?.pauseVideo?.(); } catch {}
    };
    const reportPresence = async (leaving = false) => {
      if (sending && !leaving) return;
      sending = true;
      const sequence = ++bgmSequenceRef.current;
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const player = playerRef.current;
        const atSec = Number(player?.getCurrentTime?.());
        const elapsed = Math.max(0, (Date.now() - lastTimeSampleAtRef.current) / 1000);
        const delta = atSec - lastTimeRef.current;
        const positionValid = !pendingYouTubeSeekRef.current && !nativeSeekCandidateRef.current && pendingPlaybackControlsRef.current === 0
          && Number.isFinite(atSec) && atSec >= currentStartRef.current
          && delta >= -1.5 && delta <= elapsed * (Number(player?.getPlaybackRate?.()) || 1) + 1.5
          && bgmReadyItemIdRef.current === currentItemIdRef.current
          && player?.getVideoData?.().video_id === expectedYouTubeMediaIdRef.current
          && (player?.getPlayerState?.() === 1 || player?.getPlayerState?.() === 2);
        const response = await fetch(`${getViewerApiBase()}/api/video-donation/control-by-token`, {
          signal: controller.signal, method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: leaving,
          body: JSON.stringify({ token, op: 'bgm_status', clientId: idleClientIdRef.current, sequence, readyItemId: bgmReadyItemIdRef.current, visible: !leaving && !document.hidden && bgmEnabledRef.current && !autoplayBlockedRef.current,
            itemId: currentItemIdRef.current, playbackRevision: serverPlaybackRevisionRef.current,
            playbackEpoch: serverPlaybackEpochRef.current,
            positionValid, atSec: positionValid ? atSec : undefined,
          }),
        });
        if (disposed) return;
        if (!response.ok) throw new Error('BGM presence unavailable');
        const result = await response.json();
        if (disposed || sequence !== bgmSequenceRef.current) return;
        const changed = bgmOwnerRef.current !== (result.accepted === true);
        bgmOwnerRef.current = result.accepted === true;
        if (bgmOwnerRef.current) lastAcceptedAt = startedAt;
        else releasePlayback();
        if (changed) void playbackSyncRef.current(true);
      } catch {
        // A short API outage must not interrupt audio; stop before the 12-second ownership lease expires.
        if (!disposed && Date.now() - lastAcceptedAt >= 9000) releasePlayback();
      } finally { clearTimeout(timeout); sending = false; }
    };
    bgmReportRef.current = () => { void reportPresence(); };
    const onVisibility = () => { void reportPresence(document.hidden); };
    const onPageHide = () => { void reportPresence(true); };
    const timer = setInterval(() => {
      if (bgmOwnerRef.current && Date.now() - lastAcceptedAt >= 9000) releasePlayback();
      void reportPresence();
    }, 3000);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    void reportPresence();
    return () => {
      disposed = true;
      bgmReportRef.current = () => {};
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      void reportPresence(true);
    };
  }, [captureIdlePosition, getViewerApiBase, playerRole, token]);

  useEffect(() => {
    idleControlRef.current = (command) => {
      const version = Number(command.version || 0);
      if (command.clientId !== idleClientIdRef.current || version <= idleControlVersionRef.current) return;
      idleControlVersionRef.current = version;
      if (playbackModeRef.current !== 'idle') return;
      const op = String(command.op || '');
      if (op === 'skip' && command.itemId !== `idle:${idleClientIdRef.current}:${idleTrackRef.current?.id}`) return;
      idlePausedRef.current = op === 'pause';
      if (playerRole === 'bgm') setBgmPaused(idlePausedRef.current);
      if (mixActiveRef.current) {
        mixPlayerRef.current?.setPaused(isIdlePlaybackBlocked());
        if (op === 'skip' && !isIdlePlaybackBlocked()) mixPlayerRef.current?.skip();
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
  }, [advanceIdlePlayback, isIdlePlaybackBlocked, playerRole, startIdlePlayback]);

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
            token, op: 'idle_status', playerRole, clientId: idleClientIdRef.current, sequence: ++idleSequenceRef.current,
            source: (window as Window & { obsstudio?: unknown }).obsstudio ? 'obs' : 'browser',
            mode: playbackModeRef.current, track: idleTrackRef.current,
            playing: idlePlayingRef.current, paused: idlePausedRef.current || isPlaybackBlocked(),
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
  }, [getViewerApiBase, playerRole, startIdlePlayback, token, isPlaybackBlocked]);

  // Reconcile queue and pause intent on return without rewinding the current item.
  useEffect(() => {
    if (!token) return;

    const pauseLocalOnly = () => {
      captureIdlePosition();
      suppressUntilRef.current = Date.now() + 4000;
      try { playerRef.current && playerRef.current.pauseVideo && playerRef.current.pauseVideo(); } catch {}
    };

    const onVisibility = () => {
      if (isPlayerHidden()) {
        pauseLocalOnly();
      } else {
        void resyncFromServer(true);
      }
    };

    const onResume = () => {
      if (!isPlayerHidden()) void resyncFromServer(true);
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
  }, [captureIdlePosition, resyncFromServer, token, isPlayerHidden]);

  // WS first; fallback to HTTP polling on error/close
  useEffect(() => {
    if (!token) return;
    const apiBase = getViewerApiBase();
    let apiUrl: URL;
    try { apiUrl = new URL(apiBase); } catch { apiUrl = new URL(window.location.origin); }
    const wsProto = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';

    const startPolling = () => {
      if (pollTimerRef.current) return; // already polling
      pollTimerRef.current = setInterval(async () => {
        if (!isPlayerHidden()) void resyncFromServer(false);
      }, 2500);
    };

    const stopPolling = () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    };

    const disconnect = connectOverlaySocket({
      url: `${wsProto}//${apiUrl.host}/api/pvd/ws?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(idleClientIdRef.current)}`,
      onRetry: startPolling,
      onOpen: () => {
        stopPolling();
        void resyncFromServer(true);
      },
      onMessage: (ev, ws) => {
        try {
          const data = JSON.parse(ev.data) as Record<string, unknown>;
          if (data?.type === 'duration_probe') {
            handleDurationProbe(data, ws);
            return;
          }
          if (data?.type === 'start' || data?.type === 'state' || data?.type === 'init' || data?.type === 'now-playing') {
            applyServerPlaybackPayload(data, true);
          } else if (data?.type === 'control') {
            const op = String(data.op || '').toLowerCase();
            const positionedControl = op === 'play' || op === 'pause' || op === 'seek';
            if (positionedControl && data.itemId != null && String(data.itemId) !== currentItemIdRef.current) return;
            if (positionedControl && data.playbackEpoch && data.playbackEpoch !== serverPlaybackEpochRef.current) {
              if (!retiredPlaybackEpochsRef.current.has(String(data.playbackEpoch))) void resyncFromServer(true);
              return;
            }
            if (positionedControl && typeof data.playbackRevision === 'number') {
              if (data.playbackRevision <= serverPlaybackRevisionRef.current) return;
              serverPlaybackRevisionRef.current = data.playbackRevision;
            }
            playbackPayloadVersionRef.current += 1;
            applyServerPauseState(data);
            if (positionedControl && data.clientId === idleClientIdRef.current && localPlaybackControlsRef.current.has(String(data.controlId))) return;
            if (op === 'chzzk-donation') {
              if (playbackModeRef.current === 'idle') startIdlePlayback();
              else if (playbackModeRef.current === 'donation') {
                // Pause-only controls must not replace a pending seek with an unready player's zero position.
                const at = typeof data.atSec === 'number' && Number.isFinite(data.atSec) ? data.atSec : null;
                if (expectedYouTubeMediaIdRef.current === '__external__') {
                  applyExternalPlaybackTarget(at, serverQueuePausedRef.current);
                } else applyPlaybackTarget(at, serverQueuePausedRef.current);
              } else if (!isPlaybackBlocked()) void resyncFromServer(true);
              idleReportRef.current();
              return;
            }
            if (op === 'volume') {
              applyVolume(Number(data.volume));
              return;
            }
            if (op === 'idle-playlist') {
              if (playerRole === 'bgm') { void resyncFromServer(true); return; }
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
            if ((op === 'play' || op === 'pause') && playbackModeRef.current !== 'donation') {
              if (playbackModeRef.current === 'idle') startIdlePlayback();
              else if (!isPlaybackBlocked()) void resyncFromServer(true);
              return;
            }
            if (playbackModeRef.current !== 'donation' || !positionedControl) return;
            if (playerRole === 'bgm') setBgmPaused(op === 'pause' || data.paused === true);
            const at = typeof data.atSec === 'number' && Number.isFinite(data.atSec) ? Math.max(0, data.atSec) : null;
            if (expectedYouTubeMediaIdRef.current !== '__external__') {
              applyPlaybackTarget(at, op === 'pause' || data?.paused === true, true, true);
            } else {
              applyExternalPlaybackTarget(at, op === 'pause' || data?.paused === true);
            }
          }
        } catch {}
      },
    });

    return () => {
      disconnect();
      stopPolling();
      youtubeDurationProbeRunnerRef.current?.dispose();
      youtubeDurationProbeRunnerRef.current = null;
      try { playerRef.current && playerRef.current.destroy && playerRef.current.destroy(); } catch {}
      playerRef.current = null;
    };
  }, [activateDeferredDonation, applyExternalPlaybackTarget, applyIdlePlaylistConfig, applyPlaybackTarget, applyServerPauseState, applyServerPlaybackPayload, applyVolume, getViewerApiBase, handleDurationProbe, isPlaybackBlocked, playerRole, resyncFromServer, startIdlePlayback, stopPlayer, token, isPlayerHidden]);

  // Recover missed queue/control messages without treating clock observations as seeks.
  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => {
      if (!isPlayerHidden() && (chzzkDonationPausedRef.current || (playbackModeRef.current === 'donation' && playerRef.current))) void resyncFromServer(false);
    }, 7500);
    return () => {
      try { clearInterval(id); } catch {}
      if (volumeEmitTimerRef.current) clearTimeout(volumeEmitTimerRef.current);
    };
  }, [resyncFromServer, token, isPlayerHidden]);

  // Detect manual seek (scrub) and broadcast 'seek' when a significant jump is detected
  useEffect(() => {
    const id = setInterval(() => {
      try {
        const YT = (window as YouTubeWindow).YT;
        if (!YT || !playerRef.current || !playerRef.current.getCurrentTime) return;
        let t = Number(playerRef.current.getCurrentTime());
        if (!Number.isFinite(t)) return;
        const now = Date.now();
        const pendingSeek = pendingYouTubeSeekRef.current;
        if (pendingSeek) {
          if (Math.abs(t - pendingSeek.atSec) <= 1.25 || now >= pendingSeek.expiresAt) pendingYouTubeSeekRef.current = null;
          lastTimeRef.current = t;
          lastTimeSampleAtRef.current = now;
          nativeSeekCandidateRef.current = null;
          return;
        }
        const state = playerRef.current.getPlayerState?.();
        // Video overlays have no native seek controls. Loading/buffering samples (often 0) are not user input.
        if (playerRole !== 'bgm' || !bgmOwnerRef.current || !bgmEnabledRef.current || chzzkDonationPausedRef.current || isPlayerHidden()
          || playbackModeRef.current !== 'donation' || bgmReadyItemIdRef.current !== currentItemIdRef.current
          || !isExpectedYouTubePlayerMedia(playerRef.current)) {
          lastTimeRef.current = t;
          lastTimeSampleAtRef.current = now;
          nativeSeekCandidateRef.current = null;
          return;
        }
        if (state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.PAUSED) return;
        const elapsed = Math.max(0, (now - lastTimeSampleAtRef.current) / 1000);
        const delta = t - lastTimeRef.current;
        const rate = Number(playerRef.current.getPlaybackRate?.()) || 1;
        const jumped = delta < -1.5 || delta > elapsed * rate + 1.5;
        const nativeBgmSeek = playerRole === 'bgm' && bgmReadyItemIdRef.current === currentItemIdRef.current
          && isExpectedYouTubePlayerMedia(playerRef.current) && (state === YT.PlayerState.PLAYING || state === YT.PlayerState.PAUSED);
        if (!isPlayerHidden() && jumped && (now > suppressUntilRef.current || nativeBgmSeek)) {
          const candidate = nativeSeekCandidateRef.current;
          if (!candidate || Math.abs(t - candidate.atSec) > (now - candidate.since) / 1000 * rate + 1.5) {
            nativeSeekCandidateRef.current = { atSec: t, since: now };
            return;
          }
          if (now - candidate.since < 600) return;
          nativeSeekCandidateRef.current = null;
          if (playerRole === 'bgm') {
            const bounded = Math.max(currentStartRef.current, Math.min(currentEndRef.current, t));
            if (bounded !== t) playerRef.current.seekTo?.(bounded, true);
            t = bounded;
            youtubePlaybackTargetRef.current.atSec = t;
          }
          lastTimeRef.current = t;
          if (now - lastEmitRef.current > 200) { lastEmitRef.current = now; emitControl('seek', Math.floor(t)); }
        } else {
          lastTimeRef.current = t;
          nativeSeekCandidateRef.current = null;
        }
        lastTimeSampleAtRef.current = now;
      } catch {}
    }, 300);
    return () => { try { clearInterval(id); } catch {} };
  }, [emitControl, isExpectedYouTubePlayerMedia, isPlayerHidden, playerRole]);

  const controlBgm = async (op: 'play' | 'pause' | 'skip') => {
    if (op === 'play') {
      updateAutoplayBlocked(false);
      bgmReportRef.current();
      if (!isPlaybackBlocked()) {
        try { playerRef.current?.playVideo?.(); } catch {}
        if (mixActiveRef.current) mixPlayerRef.current?.setPaused(false);
      }
    }
    if (playbackModeRef.current === 'idle') {
      if (idleTrackRef.current && bgmOwnerRef.current) {
        const response = await fetch(`${getViewerApiBase()}/api/video-donation/control-by-token`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, op: 'bgm_idle_control', action: op, clientId: idleClientIdRef.current, itemId: `idle:${idleClientIdRef.current}:${idleTrackRef.current.id}` }),
        }).catch(() => null);
        if (response?.ok || op !== 'play') return;
      }
      idlePausedRef.current = op === 'pause';
      setBgmPaused(idlePausedRef.current);
      if (mixActiveRef.current) {
        mixPlayerRef.current?.setPaused(isIdlePlaybackBlocked());
        if (op === 'skip' && !isIdlePlaybackBlocked()) mixPlayerRef.current?.skip();
      } else if (op === 'skip') advanceIdlePlayback('end');
      else if (op === 'pause') playerRef.current?.pauseVideo?.();
      else startIdlePlayback();
      idleReportRef.current();
      return;
    }
    if (!currentItemIdRef.current) return;
    await fetch(`${getViewerApiBase()}/api/video-donation/${op === 'skip' ? 'pop-by-token' : 'control-by-token'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, op, cause: 'skip', source: 'bgm-window', itemId: currentItemIdRef.current,
        clientId: idleClientIdRef.current, playbackEpoch: serverPlaybackEpochRef.current, playbackRevision: serverPlaybackRevisionRef.current }),
    }).catch(() => {});
    void resyncFromServer(true);
  };

  return (
    <div style={{ width: '100vw', height: '100vh', minWidth: playerRole === 'bgm' ? 200 : undefined, minHeight: playerRole === 'bgm' ? 296 : undefined, background: playerRole === 'bgm' ? '#171717' : 'transparent' }}>
      {playerRole === 'bgm' && !youtubeActive ? <div role="status" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', padding: 24, fontSize: 16 }}>{bgmStatus}</div> : null}
      <div ref={playerDivRef} style={{ width: '100%', height: playerRole === 'bgm' ? 'calc(100% - 96px)' : '100%', display: externalItem || mixActive ? 'none' : 'block' }} />
      <div ref={mixDivRef} data-youtube-mix-player style={{ position: 'fixed', inset: 0, bottom: playerRole === 'bgm' ? 96 : 0, display: mixActive ? 'block' : 'none' }} />
      {autoplayBlocked && mixActive && playerRole !== 'bgm' ? (
        <button type="button" aria-label="대기 음악 재생" title="대기 음악 재생"
          onClick={() => { idlePausedRef.current = false; mixPlayerRef.current?.setPaused(isIdlePlaybackBlocked()); }}
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
              autoPlay={!externalItem.paused && !isPlaybackBlocked()}
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
                  if (externalPausedRef.current || isPlaybackBlocked()) {
                    event.currentTarget.pause();
                  } else {
                    const result = event.currentTarget.play();
                    if (result && typeof result.catch === 'function') result.catch(() => {});
                  }
                } catch {}
              }}
              onPlay={(event) => {
                if (externalPausedRef.current || isPlaybackBlocked()) event.currentTarget.pause();
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
          ...(playerRole === 'bgm' ? { left: 0, height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#171717', padding: 12 } : {}),
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
          opacity: volumeControlsVisible || playerRole === 'bgm' ? 1 : 0,
          visibility: volumeControlsVisible || playerRole === 'bgm' ? 'visible' : 'hidden',
          pointerEvents: volumeControlsVisible || playerRole === 'bgm' ? 'auto' : 'none',
          transform: volumeControlsVisible || playerRole === 'bgm' ? 'translateY(0)' : 'translateY(8%)',
          ...(playerRole === 'bgm' ? { flexWrap: 'wrap', justifyContent: 'center', border: 0, borderRadius: 0, background: 'transparent', padding: 0, fontSize: 14, gap: 12 } : {}),
          transition: 'opacity 160ms ease, transform 160ms ease, visibility 0s linear 160ms',
          backdropFilter: volumeControlsVisible ? 'blur(14px)' : 'none',
        }}
        >
          {playerRole === 'bgm' ? <>
            <button type="button" onClick={() => void controlBgm(bgmPaused || autoplayBlocked ? 'play' : 'pause')} aria-label={bgmPaused || autoplayBlocked ? 'BGM 재생' : 'BGM 일시정지'} title={bgmPaused || autoplayBlocked ? 'BGM 재생' : 'BGM 일시정지'} style={{ width: 32, height: 32, display: 'grid', placeItems: 'center' }}>
              {bgmPaused || autoplayBlocked ? <Play size={20} /> : <Pause size={20} />}
            </button>
            <button type="button" onClick={() => void controlBgm('skip')} aria-label="BGM 스킵" title="BGM 스킵" style={{ width: 32, height: 32, display: 'grid', placeItems: 'center' }}><SkipForward size={20} /></button>
          </> : null}
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
