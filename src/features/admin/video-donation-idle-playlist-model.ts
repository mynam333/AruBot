export type VideoDonationIdleTrack = {
  id: string;
  mediaProvider: 'youtube';
  mediaId: string;
  videoId: string;
  mediaUrl: string;
  title: string;
  thumbnailUrl: string;
  durationSec: number | null;
};

export type VideoDonationIdlePlaylist = {
  enabled: boolean;
  mode: 'recommended' | 'custom';
  topic: string;
  loop: boolean;
  shuffle: boolean;
  recommendedTracks: VideoDonationIdleTrack[];
  customTracks: VideoDonationIdleTrack[];
};

export const MAX_VIDEO_DONATION_IDLE_TRACKS = 200;

export function createDefaultVideoDonationIdlePlaylist(): VideoDonationIdlePlaylist {
  return {
    enabled: false,
    mode: 'recommended',
    topic: '로파이 집중',
    loop: true,
    shuffle: false,
    recommendedTracks: [],
    customTracks: [],
  };
}

function normalizeTrack(value: unknown): VideoDonationIdleTrack | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<VideoDonationIdleTrack>;
  const mediaId = String(source.mediaId || source.videoId || '').trim();
  if (!mediaId) return null;
  const duration = Number(source.durationSec);
  return {
    id: String(source.id || `youtube:${mediaId}`),
    mediaProvider: 'youtube',
    mediaId,
    videoId: mediaId,
    mediaUrl: String(source.mediaUrl || `https://www.youtube.com/watch?v=${encodeURIComponent(mediaId)}`),
    title: String(source.title || `YouTube ${mediaId}`),
    thumbnailUrl: String(source.thumbnailUrl || `https://i.ytimg.com/vi/${encodeURIComponent(mediaId)}/hqdefault.jpg`),
    durationSec: Number.isFinite(duration) && duration > 0 ? Math.ceil(duration) : null,
  };
}

export function normalizeVideoDonationIdleTracks(value: unknown) {
  const tracks: VideoDonationIdleTrack[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    const track = normalizeTrack(item);
    if (!track || seen.has(track.mediaId)) continue;
    seen.add(track.mediaId);
    tracks.push(track);
    if (tracks.length >= MAX_VIDEO_DONATION_IDLE_TRACKS) break;
  }
  return tracks;
}

export function normalizeVideoDonationIdlePlaylist(value: unknown): VideoDonationIdlePlaylist {
  const defaults = createDefaultVideoDonationIdlePlaylist();
  if (!value || typeof value !== 'object') return defaults;
  const source = value as Partial<VideoDonationIdlePlaylist> & { tracks?: unknown };
  const mode = source.mode === 'custom' ? 'custom' : 'recommended';
  const legacyTracks = Array.isArray(source.tracks) ? source.tracks : [];
  return {
    enabled: source.enabled === true,
    mode,
    topic: String(source.topic || defaults.topic).trim().slice(0, 80) || defaults.topic,
    loop: source.loop !== false,
    shuffle: source.shuffle === true,
    recommendedTracks: normalizeVideoDonationIdleTracks(source.recommendedTracks ?? (mode === 'recommended' ? legacyTracks : [])),
    customTracks: normalizeVideoDonationIdleTracks(source.customTracks ?? (mode === 'custom' ? legacyTracks : [])),
  };
}
