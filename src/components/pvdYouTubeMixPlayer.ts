import { parseYouTubeMix } from '../../shared/youtube-mix.js';
import { getPvdIdlePlaylistSignature, type PvdIdlePlaylist } from './pvdIdlePlaylist';

type MixPlayer = {
  destroy?: () => void;
  getCurrentTime?: () => number;
  getDuration?: () => number;
  getPlaylist?: () => string[];
  getPlaylistIndex?: () => number;
  getVideoData?: () => { video_id?: string; title?: string };
  loadPlaylist?: (options: { listType: string; list: string; index?: number }) => void;
  playVideoAt?: (index: number) => void;
  pauseVideo?: () => void;
  playVideo?: () => void;
  setLoop?: (loop: boolean) => void;
  setVolume?: (volume: number) => void;
  mute?: () => void;
  unMute?: () => void;
  loadModule?: (name: string) => void;
  unloadModule?: (name: string) => void;
};

type MixApi = { Player: new (element: HTMLElement, options: Record<string, unknown>) => MixPlayer };
type MixTarget = { playlistId: string; videoId: string | null };
type MixEvent = { data?: number; target?: MixPlayer };
type MixOptions = {
  getApi: () => Promise<MixApi>;
  getHost: () => HTMLElement | null;
  fetchSeed: (signal: AbortSignal) => Promise<string>;
  isVisible: () => boolean;
  onPlaying: (playing: boolean) => void;
  onBoundary: () => boolean;
  now?: () => number;
};

const HISTORY_LIMIT = 1000;
const MAX_DURATION_SEC = 600;
const LOAD_TIMEOUT_MS = 30000;
const RETRY_MS = 60000;

export function createPvdYouTubeMixPlayer(options: MixOptions) {
  const now = options.now || Date.now;
  let config: PvdIdlePlaylist | null = null;
  let signature = '';
  let target: MixTarget | null = null;
  let player: MixPlayer | null = null;
  let active = false;
  let disposed = false;
  let ready = false;
  let generation = 0;
  let pending: AbortController | null = null;
  let retryAt = 0;
  let deadline = 0;
  let suspendedAt: number | null = null;
  let advancing = false;
  let advanceOnResume = false;
  let currentId = '';
  let currentIndex = -1;
  let acceptedId = '';
  let acceptedIndex = -1;
  let lastAcceptedId = '';
  let consecutiveSkips = 0;
  let rotationsWithoutPlay = 0;
  let volume = 100;
  let captions = false;
  const seen = new Set<string>();
  const rotationSeeds = new Set<string>();

  const canPlay = () => active && !disposed && options.isVisible();
  const remember = (id: string) => {
    if (!id) return;
    seen.add(id);
    if (seen.size > HISTORY_LIMIT) seen.delete(seen.values().next().value!);
  };
  const tracks = () => player?.getPlaylist?.() || [];
  const annotate = (error = '') => {
    const host = options.getHost();
    if (!host) return;
    host.dataset.mixPlaylist = target?.playlistId || '';
    host.dataset.mixVideo = currentId;
    host.dataset.mixTrackCount = String(tracks().length);
    host.dataset.mixError = error;
  };
  const applyOptions = () => {
    player?.setVolume?.(volume);
    if (volume <= 0) player?.mute?.();
    else player?.unMute?.();
    if (captions) player?.loadModule?.('captions');
    else player?.unloadModule?.('captions');
  };
  const suspend = () => {
    if (suspendedAt === null) suspendedAt = now();
    player?.pauseVideo?.();
    options.onPlaying(false);
  };
  const clearPlayer = () => {
    generation += 1;
    pending?.abort();
    pending = null;
    const previous = player;
    player = null;
    ready = false;
    advancing = false;
    deadline = 0;
    suspendedAt = null;
    previous?.pauseVideo?.();
    previous?.destroy?.();
    options.getHost()?.replaceChildren();
    options.onPlaying(false);
  };
  const fail = (message: string, delay = RETRY_MS) => {
    clearPlayer();
    retryAt = now() + delay;
    currentId = '';
    acceptedId = '';
    acceptedIndex = -1;
    currentIndex = -1;
    annotate(message);
    if (active) options.onBoundary();
  };

  const boundary = () => {
    if (!options.onBoundary()) return false;
    active = false;
    suspend();
    return true;
  };

  const rotate = () => {
    const seed = [lastAcceptedId, ...Array.from(seen).reverse(), target?.videoId || '']
      .find((id) => /^[A-Za-z0-9_-]{11}$/.test(id) && !rotationSeeds.has(id));
    if (!seed || rotationsWithoutPlay >= 3) {
      fail('mix_no_unseen_tracks');
      return;
    }
    rotationSeeds.add(seed);
    rotationsWithoutPlay += 1;
    target = { videoId: seed, playlistId: `RD${seed}` };
    advancing = true;
    currentId = '';
    acceptedId = '';
    acceptedIndex = -1;
    currentIndex = -1;
    deadline = now() + LOAD_TIMEOUT_MS;
    player?.loadPlaylist?.({ listType: 'playlist', list: target.playlistId, index: 0 });
    annotate();
  };

  const advance = () => {
    if (!player || advancing) return;
    options.onPlaying(false);
    if (!canPlay()) { advanceOnResume = true; suspend(); return; }
    const list = tracks();
    const index = Math.max(currentIndex, Number(player.getPlaylistIndex?.() ?? -1));
    const nextIndex = list.findIndex((id, position) => position > index && !seen.has(id));
    advancing = true;
    deadline = now() + LOAD_TIMEOUT_MS;
    if (nextIndex >= 0) player.playVideoAt?.(nextIndex);
    else rotate();
  };

  const onStateChange = (event: MixEvent) => {
    if (!player || (event.target && event.target !== player)) return;
    if (!canPlay()) { suspend(); return; }
    const index = Number(player.getPlaylistIndex?.() ?? -1);
    const id = player.getVideoData?.()?.video_id || tracks()[index] || '';
    const changed = !!id && (id !== currentId || index !== currentIndex);
    const hadCurrent = !!currentId;
    // Native Mix transitions can change the index without an ENDED event.
    if (changed) {
      currentId = id;
      currentIndex = index;
      advancing = false;
      if (hadCurrent && boundary()) return;
    }
    annotate();
    if (event.data === 0) {
      advancing = false;
      advanceOnResume = true;
      if (boundary()) return;
      advanceOnResume = false;
      advance();
      return;
    }
    if (event.data !== 1) {
      if (event.data === 2) options.onPlaying(false);
      return;
    }
    if (!id) return;
    if (!tracks().length) { fail('mix_playlist_unavailable'); return; }
    deadline = 0;
    if (((id !== acceptedId || index !== acceptedIndex) && seen.has(id)) || Number(player.getDuration?.() || 0) > MAX_DURATION_SEC) {
      remember(id);
      consecutiveSkips += 1;
      if (consecutiveSkips >= 15) { fail('mix_skips_exhausted'); return; }
      advancing = false;
      advance();
      return;
    }
    acceptedId = id;
    acceptedIndex = index;
    lastAcceptedId = id;
    remember(id);
    consecutiveSkips = 0;
    rotationsWithoutPlay = 0;
    rotationSeeds.clear();
    options.onPlaying(true);
  };

  const ensure = async () => {
    if (!config || !canPlay() || player || pending || now() < retryAt) return;
    const controller = new AbortController();
    const version = generation;
    pending = controller;
    const timeout = setTimeout(() => controller.abort(), 45000);
    const waitFor = <T,>(promise: Promise<T>) => new Promise<T>((resolve, reject) => {
      const aborted = () => reject(new Error('mix_load_aborted'));
      if (controller.signal.aborted) { aborted(); return; }
      controller.signal.addEventListener('abort', aborted, { once: true });
      promise.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', aborted));
    });
    try {
      let resolvedTarget = target;
      if (!resolvedTarget) {
        resolvedTarget = parseYouTubeMix(config.mixUrl);
        if (!resolvedTarget) {
          const seed = config.tracks[0]?.mediaId || await waitFor(options.fetchSeed(controller.signal));
          if (!/^[A-Za-z0-9_-]{11}$/.test(seed)) throw new Error('mix_seed_not_found');
          resolvedTarget = { videoId: seed, playlistId: `RD${seed}` };
        }
      }
      if (version !== generation || controller.signal.aborted) return;
      const YT = await waitFor(options.getApi());
      if (disposed || version !== generation || controller.signal.aborted) return;
      target = resolvedTarget;
      if (!canPlay()) return;
      const host = options.getHost();
      if (!host) return;
      host.replaceChildren();
      const mount = document.createElement('div');
      host.appendChild(mount);
      deadline = now() + LOAD_TIMEOUT_MS;
      currentId = '';
      acceptedId = '';
      acceptedIndex = -1;
      currentIndex = -1;
      consecutiveSkips = 0;
      rotationsWithoutPlay = 0;
      rotationSeeds.clear();
      player = new YT.Player(mount, {
        width: '100%', height: '100%', videoId: target.videoId || undefined,
        playerVars: { listType: 'playlist', list: target.playlistId, autoplay: 1, playsinline: 1, controls: 0, disablekb: 1, origin: window.location.origin },
        events: {
          onReady: (event: MixEvent) => {
            if (version !== generation || event.target !== player) return;
            ready = true;
            player?.setLoop?.(false);
            applyOptions();
            annotate();
            if (canPlay()) player?.playVideo?.();
            else player?.pauseVideo?.();
          },
          onStateChange,
          onError: (event: MixEvent) => {
            if (event.target && event.target !== player) return;
            remember(currentId);
            consecutiveSkips += 1;
            advancing = false;
            if (boundary()) { advanceOnResume = true; return; }
            if (!tracks().length || consecutiveSkips >= 15) fail(`mix_player_error_${event.data}`);
            else advance();
          },
          onAutoplayBlocked: () => { if (version === generation) fail('mix_autoplay_blocked'); },
        },
      });
    } catch (error) {
      if (version !== generation || disposed) return;
      const retry = Number((error as { retryAfterMs?: number })?.retryAfterMs || RETRY_MS);
      fail(error instanceof Error ? error.message : 'mix_load_failed', Math.max(RETRY_MS, retry));
    } finally {
      clearTimeout(timeout);
      if (pending === controller) pending = null;
    }
  };

  const sync = () => {
    if (!canPlay()) { suspend(); return; }
    if (suspendedAt !== null) {
      if (deadline) deadline += now() - suspendedAt;
      suspendedAt = null;
    }
    if (!player) { void ensure(); return; }
    if (deadline && now() >= deadline) { fail('mix_player_timeout'); return; }
    if (ready) {
      if (advanceOnResume) { advanceOnResume = false; advancing = false; advance(); }
      else player.playVideo?.();
    }
  };
  const timer = setInterval(sync, 1000);
  const visibilityChanged = () => sync();
  document.addEventListener('visibilitychange', visibilityChanged);

  return {
    configure(next: PvdIdlePlaylist) {
      const nextSignature = getPvdIdlePlaylistSignature(next);
      if (signature === nextSignature) return;
      clearPlayer();
      config = next;
      if (!next.enabled || next.mode !== 'recommended') active = false;
      signature = nextSignature;
      target = null;
      retryAt = 0;
      seen.clear();
      rotationSeeds.clear();
      currentId = ''; acceptedId = ''; acceptedIndex = -1; lastAcceptedId = ''; currentIndex = -1;
      consecutiveSkips = 0; rotationsWithoutPlay = 0; advanceOnResume = false;
    },
    start(next: PvdIdlePlaylist) {
      this.configure(next);
      active = next.enabled && next.mode === 'recommended';
      sync();
    },
    pause() { active = false; suspend(); },
    setVolume(next: number) { volume = next; applyOptions(); },
    setCaptions(next: boolean) { captions = next; applyOptions(); },
    dispose() {
      disposed = true;
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibilityChanged);
      clearPlayer();
    },
  };
}
