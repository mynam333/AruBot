export function normalizePvdVolume(value, fallback = 100) {
  const n = Number(value);
  const fallbackNumber = Number(fallback);
  const safe = Number.isFinite(n) ? n : Number.isFinite(fallbackNumber) ? fallbackNumber : 100;
  return Math.max(0, Math.min(100, Math.round(safe)));
}

export function getPvdVolumes(settings = {}) {
  const video = normalizePvdVolume(settings.videoDonationVolume ?? 100);
  return { video, bgm: normalizePvdVolume(settings.videoDonationBgmVolume ?? video, video) };
}

export function getPvdVolumePatch(settings, input = {}) {
  const current = getPvdVolumes(settings);
  // Freeze the legacy shared value before either player changes its own volume.
  return {
    videoDonationVolume: normalizePvdVolume(input.volume ?? current.video, current.video),
    videoDonationBgmVolume: normalizePvdVolume(input.bgm?.volume ?? current.bgm, current.bgm),
  };
}
