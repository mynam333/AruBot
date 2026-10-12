const finiteSeconds = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

function publicMediaLink(item) {
  const provider = item.mediaProvider || (item.videoId ? 'youtube' : '');
  const id = String(item.mediaId || item.videoId || '');
  if (provider === 'youtube' && /^[a-z0-9_-]{11}$/i.test(id)) {
    const start = Math.floor(finiteSeconds(item.startSec));
    return `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ''}`;
  }
  if (provider === 'chzzk_clip' && /^[a-z0-9_-]{1,128}$/i.test(id)) return `https://chzzk.naver.com/clips/${id}`;
  if (provider === 'cime_clip' && /^[a-z0-9_-]{1,128}$/i.test(id)) return `https://ci.me/clips/${id}`;
  if (provider === 'tiktok') {
    try {
      const url = new URL(item.mediaUrl);
      if (url.protocol === 'https:' && ['www.tiktok.com', 'tiktok.com'].includes(url.hostname)
        && /^\/@[\w.-]+\/video\/\d+\/?$/.test(url.pathname) && url.pathname.split('/').filter(Boolean).at(-1) === id) {
        return `https://www.tiktok.com${url.pathname}`;
      }
    } catch { /* Unknown links stay unavailable instead of exposing a playback URL. */ }
  }
  return null;
}

function displayItem(item, includeDetails = false) {
  if (!item) return null;
  const videoId = String(item.videoId || (item.mediaProvider === 'youtube' ? item.mediaId : '') || '');
  const thumbnail = String(item.thumbnailUrl || '');
  return {
    id: String(item.id || ''),
    title: String(item.title || '제목 확인 중').slice(0, 500),
    username: String(item.username || '').slice(0, 80),
    kind: item.kind === 'bgm' ? 'bgm' : 'video',
    idle: item.idle === true,
    resumed: finiteSeconds(item.resumePlayback?.atSec) > finiteSeconds(item.startSec),
    durationSec: finiteSeconds(item.durationSec),
    thumbnailUrl: /^https?:\/\//i.test(thumbnail) ? thumbnail
      : /^[a-z0-9_-]{11}$/i.test(videoId) ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null,
    ...(includeDetails ? {
      provider: ['youtube', 'tiktok', 'chzzk_clip', 'cime_clip'].includes(item.mediaProvider)
        ? item.mediaProvider : videoId ? 'youtube' : null,
      watchUrl: publicMediaLink(item),
      startSec: finiteSeconds(item.startSec),
      durationPending: item.awaitDurationSync === true,
    } : {}),
  };
}

// Deliberately exclude user IDs, point costs, raw playback URLs and credentials.
export function createPvdQueueDisplay(snapshot, { bgmBlocked = false, includeDetails = false, offset = 0, limit = 100 } = {}) {
  const waiting = Array.isArray(snapshot.waitingItems) ? snapshot.waitingItems : [];
  const pageSize = Math.max(1, Math.min(100, Math.floor(Number(limit) || 100)));
  const pageOffset = Math.max(0, Math.min(Math.floor(Number(offset) || 0), Math.floor(Math.max(0, waiting.length - 1) / pageSize) * pageSize));
  const currentItem = displayItem(snapshot.currentItem, includeDetails);
  const waitingForPlayer = currentItem && !currentItem.idle && bgmBlocked;
  return {
    currentItem,
    waitingItems: waiting.slice(pageOffset, pageOffset + pageSize).map((item) => displayItem(item, includeDetails)),
    waitingCount: waiting.length,
    status: waitingForPlayer ? 'waiting' : currentItem ? snapshot.paused ? 'paused' : 'playing'
      : waiting.length ? 'waiting' : 'empty',
    elapsedSec: finiteSeconds(snapshot.elapsedSec),
    serverNow: snapshot.serverNow,
    ...(includeDetails ? { offset: pageOffset, limit: pageSize } : {}),
  };
}
