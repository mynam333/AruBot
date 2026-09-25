const loadSource = require('./helpers/load-source.cjs');
const { createYoutubeIdleRecommendations } = loadSource('server/youtube-idle-recommendations.js');

const page = (start, count, nextPageToken) => ({ data: {
  items: Array.from({ length: count }, (_, i) => ({ id: { videoId: `video${String(start + i).padStart(6, '0')}` }, snippet: { title: `Song ${start + i}` } })),
  nextPageToken,
} });
const hydrate = async (tracks) => ({ tracks: tracks.map((track) => ({ ...track, durationSec: 180 })), detailRequests: tracks.length ? 1 : 0 });

test('continues beyond the old 200-song limit without repeating played songs', async () => {
  const search = jest.fn(async ({ pageToken }) => {
    const index = Number(pageToken || 0);
    return page(index * 50, 50, String(index + 1));
  });
  const recommend = createYoutubeIdleRecommendations({ search, hydrate });
  const played = new Set();
  for (let batch = 0; batch < 7; batch += 1) {
    const result = await recommend('jazz', 50, { excludeIds: [...played], maxPages: 2 });
    expect(result.tracks).toHaveLength(50);
    for (const track of result.tracks) {
      expect(played.has(track.mediaId)).toBe(false);
      played.add(track.mediaId);
    }
  }
  expect(played.size).toBe(350);
  expect(search).toHaveBeenCalledTimes(7);
  expect(search.mock.calls[6][0].pageToken).toBe('6');
});

test('shares cached results and serializes simultaneous requests for the same topic', async () => {
  const search = jest.fn(async () => page(0, 50, 'next'));
  const recommend = createYoutubeIdleRecommendations({ search, hydrate });
  const results = await Promise.all([recommend('jazz', 12), recommend('jazz', 12)]);
  expect(results.every((result) => result.tracks.length === 12)).toBe(true);
  expect(search).toHaveBeenCalledTimes(1);
  expect(results[1].cacheHit).toBe(true);
});

test('tries a different search order after reaching the last page', async () => {
  const search = jest.fn(async ({ order }) => page(order === 'relevance' ? 0 : 50, 2, ''));
  const recommend = createYoutubeIdleRecommendations({ search, hydrate });
  const first = await recommend('piano', 2);
  const next = await recommend('piano', 2, { excludeIds: first.tracks.map((track) => track.mediaId) });
  expect(next.tracks).toHaveLength(2);
  expect(search.mock.calls.map(([params]) => params.order)).toEqual(['relevance', 'viewCount']);
});

test('recovers from quota exhaustion without caching a permanently exhausted result', async () => {
  let time = 0;
  const quotaError = { response: { status: 403, data: { error: { errors: [{ reason: 'quotaExceeded' }] } } } };
  const search = jest.fn().mockRejectedValueOnce(quotaError).mockResolvedValue(page(0, 50, 'next'));
  const recommend = createYoutubeIdleRecommendations({ search, hydrate, now: () => time });
  await expect(recommend('jazz')).rejects.toBe(quotaError);
  const coolingDown = await recommend('jazz');
  expect(coolingDown.retryAfterMs).toBe(300000);
  expect(search).toHaveBeenCalledTimes(1);
  time = 300001;
  expect((await recommend('jazz')).tracks).toHaveLength(12);
});

test('does not lose a search page when the video-details request fails', async () => {
  let time = 0;
  const search = jest.fn(async () => page(0, 50, 'next'));
  const hydrateMock = jest.fn().mockRejectedValueOnce(new Error('temporary')).mockImplementation(hydrate);
  const recommend = createYoutubeIdleRecommendations({ search, hydrate: hydrateMock, now: () => time });
  await expect(recommend('jazz')).rejects.toThrow('temporary');
  time = 60001;
  expect((await recommend('jazz')).tracks).toHaveLength(12);
  expect(search.mock.calls.map(([params]) => params.pageToken)).toEqual(['', '']);
});

test('bounds searches and does not repeat songs when the topic has no unseen results', async () => {
  const search = jest.fn(async () => page(0, 1, ''));
  const recommend = createYoutubeIdleRecommendations({ search, hydrate });
  const first = await recommend('rare topic', 1);
  const result = await recommend('rare topic', 12, { excludeIds: first.tracks.map((track) => track.mediaId), maxPages: 2 });
  expect(result.tracks).toHaveLength(0);
  expect(result.apiRequests.search).toBe(2);
  expect(result.retryAfterMs).toBeGreaterThanOrEqual(30000);
});

test('cache entries expire even when the topic is used continuously', async () => {
  let time = 0;
  const search = jest.fn(async () => page(0, 50, 'next'));
  const recommend = createYoutubeIdleRecommendations({ search, hydrate, now: () => time });
  await recommend('jazz');
  time = 23 * 60 * 60 * 1000;
  await recommend('jazz');
  time = 25 * 60 * 60 * 1000;
  await recommend('jazz');
  expect(search).toHaveBeenCalledTimes(2);
});
