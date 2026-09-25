const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TOPICS = 100;
const MAX_TRACKS = 1000;
const ORDERS = ['relevance', 'viewCount', 'date', 'rating'];

export function createYoutubeIdleRecommendations({ search, hydrate, now = Date.now, random = Math.random }) {
  const cache = new Map();
  const inFlight = new Map();

  return async function recommend(topic, limit = 12, { excludeIds = [], maxPages = 10 } = {}) {
    const normalizedTopic = String(topic || '로파이 집중').trim().slice(0, 80);
    const key = normalizedTopic.normalize('NFKC').toLocaleLowerCase('ko-KR');
    const safeLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 12)));
    const excluded = new Set((Array.isArray(excludeIds) ? excludeIds : []).slice(-MAX_TRACKS).map(String));
    const previous = inFlight.get(key) || Promise.resolve();
    const task = previous.catch(() => null).then(async () => {
      for (const [cachedKey, entry] of cache) {
        if (entry.expiresAt <= now()) cache.delete(cachedKey);
      }
      const hadFreshCache = cache.has(key);
      const entry = cache.get(key) || {
        tracks: [], order: 0, nextPageToken: '', pages: 0,
        retryAt: 0, expiresAt: now() + CACHE_TTL_MS,
      };
      cache.delete(key);
      cache.set(key, entry);
      while (cache.size > MAX_TOPICS) cache.delete(cache.keys().next().value);

      let searchRequests = 0;
      let detailRequests = 0;
      let excludedCount = 0;
      let excludedTooLongCount = 0;
      let lookupError = null;
      const available = () => entry.tracks.filter((track) => !excluded.has(track.mediaId));
      const pageBudget = Math.max(1, Math.min(10, Number(maxPages) || 1));
      while (available().length < safeLimit && searchRequests < pageBudget && entry.retryAt <= now()) {
        if (entry.order >= ORDERS.length) {
          entry.order = 0;
          entry.pages = 0;
          entry.nextPageToken = '';
        }
        try {
          searchRequests += 1;
          const response = await search({
            part: 'snippet', type: 'video',
            q: `${normalizedTopic} 음악 -플레이리스트 -모음 -mix`,
            maxResults: 50, order: ORDERS[entry.order], regionCode: 'KR',
            relevanceLanguage: 'ko', safeSearch: 'moderate', videoCategoryId: '10',
            videoEmbeddable: 'true', videoSyndicated: 'true',
            videoDuration: entry.order % 2 === 0 ? 'short' : 'medium',
            pageToken: entry.nextPageToken,
          });
          const data = response?.data || {};
          const items = Array.isArray(data.items) ? data.items : [];
          const known = new Set(entry.tracks.map((track) => track.mediaId));
          const seeds = items.filter((item) => item?.id?.videoId && !known.has(item.id.videoId))
            .map((item) => ({ mediaId: item.id.videoId, title: item.snippet?.title }));
          // Advance the cursor only after metadata was fetched successfully.
          const hydrated = await hydrate(seeds);
          detailRequests += hydrated.detailRequests || 0;
          excludedCount += hydrated.excludedCount || 0;
          excludedTooLongCount += hydrated.excludedTooLongCount || 0;
          for (const track of hydrated.tracks) {
            if (!known.has(track.mediaId)) {
              known.add(track.mediaId);
              entry.tracks.push(track);
            }
          }
          entry.tracks = entry.tracks.slice(-MAX_TRACKS);
          entry.pages += 1;
          const nextPage = String(data.nextPageToken || '');
          if (!nextPage || nextPage === entry.nextPageToken || entry.pages >= 10) {
            entry.order += 1;
            entry.pages = 0;
            entry.nextPageToken = '';
            if (entry.order >= ORDERS.length) entry.retryAt = now() + 15 * 60 * 1000;
          } else {
            entry.nextPageToken = nextPage;
          }
        } catch (error) {
          lookupError = error;
          const reason = String(error?.response?.data?.error?.errors?.[0]?.reason || '').toLowerCase();
          const quotaExceeded = reason === 'quotaexceeded' || reason === 'dailylimitexceeded';
          entry.retryAt = now() + (quotaExceeded ? 5 * 60 * 1000 : 60 * 1000);
          break;
        }
      }
      const tracks = available();
      for (let index = tracks.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        [tracks[index], tracks[swap]] = [tracks[swap], tracks[index]];
      }
      if (lookupError && !tracks.length) throw lookupError;
      return {
        topic: normalizedTopic, requestedCount: safeLimit, availableCount: tracks.length,
        tracks: tracks.slice(0, safeLimit),
        retryAfterMs: tracks.length ? 0 : Math.max(30000, entry.retryAt - now()),
        cacheHit: hadFreshCache && searchRequests === 0 && detailRequests === 0,
        excludedCount, excludedTooLongCount,
        apiRequests: { search: searchRequests, videos: detailRequests },
      };
    });
    inFlight.set(key, task);
    try {
      return await task;
    } finally {
      if (inFlight.get(key) === task) inFlight.delete(key);
    }
  };
}
