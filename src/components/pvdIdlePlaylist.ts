export type PvdIdleTrack = {
  id: string;
  mediaId: string;
  videoId: string;
  title: string;
  thumbnailUrl?: string;
  durationSec?: number | null;
};

export type PvdIdlePlaylist = {
  enabled: boolean;
  mode: 'recommended' | 'custom';
  topic: string;
  loop: boolean;
  shuffle: boolean;
  tracks: PvdIdleTrack[];
};

export const EMPTY_PVD_IDLE_PLAYLIST: PvdIdlePlaylist = {
  enabled: false,
  mode: 'recommended',
  topic: '',
  loop: true,
  shuffle: false,
  tracks: [],
};

export function normalizePvdIdlePlaylist(value: unknown): PvdIdlePlaylist {
  if (!value || typeof value !== 'object') return EMPTY_PVD_IDLE_PLAYLIST;
  const source = value as Partial<PvdIdlePlaylist>;
  const tracks: PvdIdleTrack[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(source.tracks) ? source.tracks : []) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Partial<PvdIdleTrack>;
    const mediaId = String(raw.mediaId || raw.videoId || '').trim();
    if (!mediaId || seen.has(mediaId)) continue;
    seen.add(mediaId);
    tracks.push({
      id: String(raw.id || `youtube:${mediaId}`),
      mediaId,
      videoId: mediaId,
      title: String(raw.title || `YouTube ${mediaId}`),
      thumbnailUrl: raw.thumbnailUrl ? String(raw.thumbnailUrl) : undefined,
      durationSec: Number.isFinite(Number(raw.durationSec)) && Number(raw.durationSec) > 0 ? Number(raw.durationSec) : null,
    });
    if (tracks.length >= 200) break;
  }
  return {
    enabled: source.enabled === true && tracks.length > 0,
    mode: source.mode === 'custom' ? 'custom' : 'recommended',
    topic: String(source.topic || ''),
    loop: source.loop !== false,
    shuffle: source.shuffle === true,
    tracks,
  };
}

export function getPvdIdlePlaylistSignature(playlist: PvdIdlePlaylist) {
  return JSON.stringify({
    enabled: playlist.enabled,
    mode: playlist.mode,
    topic: playlist.topic,
    loop: playlist.loop,
    shuffle: playlist.shuffle,
    tracks: playlist.tracks.map((track) => track.mediaId),
  });
}

export function createPvdIdlePlaybackOrder(playlist: PvdIdlePlaylist) {
  const order = playlist.tracks.map((track) => track.mediaId);
  if (!playlist.shuffle) return order;
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
  }
  return order;
}
