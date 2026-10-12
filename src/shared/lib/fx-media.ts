export type FxMediaAsset = { kind?: string; assetUrl?: string };

export function createFxMediaCache() {
  const images = new Map<string, HTMLImageElement>();
  const sounds = new Map<string, HTMLAudioElement>();
  const playing = new Set<HTMLAudioElement>();
  const trim = <T,>(cache: Map<string, T>) => {
    while (cache.size > 32) cache.delete(cache.keys().next().value!);
  };
  const warm = (asset: FxMediaAsset) => {
    const url = asset.assetUrl;
    if (!url) return;
    if (asset.kind === 'sound') {
      if (sounds.has(url)) return;
      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = url;
      audio.load();
      sounds.set(url, audio);
      trim(sounds);
    } else if (asset.kind === 'image' || asset.kind === 'sticker') {
      if (images.has(url)) return;
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.src = url;
      void image.decode?.().catch(() => undefined);
      images.set(url, image);
      trim(images);
    }
  };
  const play = (url: string, volume: number) => {
    const audio = sounds.get(url) || new Audio(url);
    sounds.delete(url);
    audio.volume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
    playing.add(audio);
    const release = () => {
      if (!playing.delete(audio)) return;
      audio.onended = audio.onerror = null;
      audio.currentTime = 0;
      sounds.set(url, audio);
      trim(sounds);
    };
    audio.onended = audio.onerror = release;
    void audio.play().catch((error) => { release(); console.warn('[FX] Audio playback failed', error); });
  };
  const dispose = () => {
    for (const audio of [...playing, ...sounds.values()]) {
      audio.onended = audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    playing.clear(); sounds.clear(); images.clear();
  };
  return { warm, play, dispose };
}
