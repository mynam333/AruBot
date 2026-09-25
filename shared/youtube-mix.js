export function parseYouTubeMix(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2048) return null;
  let playlistId = raw;
  let videoId = null;
  if (!/^RD[A-Za-z0-9_-]{8,148}$/.test(raw)) {
    try {
      const url = new URL(raw);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
      if (!/^(?:www\.|music\.|m\.)?youtube\.com$/.test(url.hostname) && url.hostname !== 'youtu.be') return null;
      playlistId = url.searchParams.get('list') || '';
      videoId = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v');
    } catch {
      return null;
    }
  }
  if (!/^RD[A-Za-z0-9_-]{8,148}$/.test(playlistId)) return null;
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || '')) {
    videoId = /^RD[A-Za-z0-9_-]{11}$/.test(playlistId) ? playlistId.slice(2) : null;
  }
  const url = new URL(videoId ? 'https://www.youtube.com/watch' : 'https://www.youtube.com/playlist');
  if (videoId) url.searchParams.set('v', videoId);
  url.searchParams.set('list', playlistId);
  return { playlistId, videoId, url: url.toString() };
}
