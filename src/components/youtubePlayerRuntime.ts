type PlayerControls = {
  getPlayerState?: () => number;
  playVideo?: () => void;
  pauseVideo?: () => void;
  mute?: () => void;
  unMute?: () => void;
  setVolume?: (volume: number) => void;
  loadModule?: (name: string) => void;
  unloadModule?: (name: string) => void;
};

const appliedOptions = new WeakMap<PlayerControls, { volume?: number; captions?: boolean }>();

export function resetYouTubeOptions(player: PlayerControls) {
  appliedOptions.delete(player);
}

export function applyYouTubeVolume(player: PlayerControls, volume: number) {
  const previous = appliedOptions.get(player) || {};
  if (previous.volume === volume) return;
  if (volume <= 0) player.mute?.();
  else if (previous.volume == null || previous.volume <= 0) player.unMute?.();
  // unMute can raise volumes below 5%; set the requested volume afterwards.
  player.setVolume?.(volume);
  appliedOptions.set(player, { ...previous, volume });
}

export function applyYouTubeCaptionState(player: PlayerControls, captions: boolean) {
  const previous = appliedOptions.get(player) || {};
  if (previous.captions === captions) return;
  if (captions) player.loadModule?.('captions');
  else player.unloadModule?.('captions');
  appliedOptions.set(player, { ...previous, captions });
}

export function applyYouTubePlaybackState(player: PlayerControls, paused: boolean, explicit = false) {
  const state = player.getPlayerState?.();
  if (paused) {
    if (state === 2) return false;
    player.pauseVideo?.();
  } else {
    // PLAYING and BUFFERING already express the intent to play. Do not restart them.
    if (!explicit && (state === 1 || state === 3)) return false;
    player.playVideo?.();
  }
  return true;
}

export function isRetryableYouTubeError(code: unknown) {
  return ![2, 100, 101, 150, 153].includes(Number(code));
}

export function createYouTubeApiLoader<T extends { Player: unknown }>() {
  let pending: Promise<T> | null = null;
  return function load(): Promise<T> {
    const win = window as Window & { YT?: T; onYouTubeIframeAPIReady?: () => void };
    if (win.YT?.Player) return Promise.resolve(win.YT);
    if (pending) return pending;
    pending = new Promise<T>((resolve, reject) => {
      const previousReady = win.onYouTubeIframeAPIReady;
      let script = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
      const owned = !script;
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
      }
      const tag = script;
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        clearInterval(poll);
        tag.removeEventListener('error', onError);
        if (win.onYouTubeIframeAPIReady === onReady) win.onYouTubeIframeAPIReady = previousReady;
        if (error) {
          if (owned) tag.remove();
          reject(error);
        } else resolve(win.YT!);
      };
      const onError = () => finish(new Error('youtube_iframe_api_load_failed'));
      const onReady = () => {
        try { previousReady?.(); } catch {}
        if (win.YT?.Player) finish();
      };
      const timeout = setTimeout(() => finish(new Error('youtube_iframe_api_timeout')), 15000);
      // Another embed can replace the global callback; readiness must still settle.
      const poll = setInterval(() => { if (win.YT?.Player) finish(); }, 250);
      win.onYouTubeIframeAPIReady = onReady;
      tag.addEventListener('error', onError, { once: true });
      if (owned) document.body.appendChild(tag);
    }).finally(() => { pending = null; });
    return pending;
  };
}
