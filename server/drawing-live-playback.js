function hlsUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' && /\.m3u8$/i.test(url.pathname) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseChzzkLivePlaybackUrl(payload = {}) {
  for (const key of ['livePlaybackJson', 'previewPlaybackJson', 'radioModePlaybackJson']) {
    const raw = payload?.content?.[key];
    if (!raw) continue;
    let playback;
    try {
      playback = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      continue;
    }
    const media = Array.isArray(playback?.media) ? playback.media : [];
    for (const mediaId of ['llhls', 'hls']) {
      const candidate = media.find((item) => String(item?.mediaId || '').toLowerCase() === mediaId);
      const url = hlsUrl(candidate?.path);
      if (url) return url;
    }
  }
  return null;
}

export function parseCimeLivePlaybackUrl(payload = {}) {
  const data = payload?.data || {};
  return hlsUrl(data?.playback?.url) || hlsUrl(data?.playbackUrl);
}

export function parseCimeChannelSlug(payload = {}, expectedChannelId = '') {
  const data = payload?.data || {};
  const slug = String(data.slug || '').trim().replace(/^@/, '');
  if (String(data.id || '') !== String(expectedChannelId || '') || !/^[a-z0-9_-]{1,64}$/i.test(slug)) return null;
  return slug;
}

export function youtubeLiveEmbedUrl(info, channelId) {
  const raw = info?.raw || {};
  const live = String(raw?.snippet?.liveBroadcastContent || '').toLowerCase() === 'live'
    && !raw?.liveStreamingDetails?.actualEndTime;
  if (!live || raw?.status?.embeddable === false) return null;
  const videoChannelId = String(info?.raw?.snippet?.channelId || '').trim();
  if (!videoChannelId || videoChannelId !== String(channelId || '').trim()) return null;
  const videoId = String(raw?.id || '').trim();
  if (!/^[a-z0-9_-]{11}$/i.test(videoId)) return null;
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&mute=1&playsinline=1`;
}
