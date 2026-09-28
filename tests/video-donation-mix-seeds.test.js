const loadSource = require('./helpers/load-source.cjs');
const loadServerFunctions = require('./helpers/load-server-functions.cjs');
const { normalizeVideoDonationIdlePlaylist, normalizeVideoDonationIdleTracks, mergeVideoDonationIdleTracks } = loadSource('src/features/admin/video-donation-idle-playlist-model.ts');
const { parseYouTubeVideoId } = loadSource('shared/youtube-mix.js');
const video = (n) => `video${String(n).padStart(6, '0')}`;
const track = (n, durationSec = 180) => ({ mediaId: video(n), title: `Song ${n}`, durationSec });
const server = loadServerFunctions(['extractYouTubeId', 'normalizePvdIdleRecommendationCount', 'normalizePvdIdleTrack', 'normalizePvdIdleTracks', 'normalizePvdIdlePlaylist', 'mapYouTubeApiVideoToIdleTrack', 'youtubeThumbnailFromSnippet', 'hydrateYouTubeIdleTracks'], {
  PVD_IDLE_PLAYLIST_MAX_TRACKS: 200, PVD_IDLE_RECOMMENDATION_TRACKS: 12,
  PVD_IDLE_TRACK_MIN_DURATION_SEC: 60, PVD_IDLE_TRACK_MAX_DURATION_SEC: 600,
  compactLogText: (value, max) => String(value).slice(0, max),
  parseIso8601Duration: (value) => Number(value) || null,
  youtubeApiGetPublic: async () => ({ data: { items: [30, 59.9, 60, 600, 601].map((duration, index) => ({ id: video(index), contentDetails: { duration: String(duration) } })) } }),
});

test('appends new topics in order without replacing existing songs or duplicating IDs', () => {
  const first = normalizeVideoDonationIdleTracks([track(1), track(2)]);
  expect(mergeVideoDonationIdleTracks(first, [track(2), track(3)]).map((item) => item.mediaId)).toEqual([video(1), video(2), video(3)]);
  expect(first).toHaveLength(2);
});

test('saved candidate lists are independent of the per-search count on both server and client', () => {
  const input = { recommendationCount: 1, recommendedTracks: [track(1), track(2), track(3)] };
  expect(normalizeVideoDonationIdlePlaylist(input).recommendedTracks).toHaveLength(3);
  expect(server.normalizePvdIdlePlaylist(input).recommendedTracks).toHaveLength(3);
});

test('caps cumulative lists at 200 even when an already-full list receives more tracks', () => {
  const tracks = Array.from({ length: 200 }, (_, index) => track(index));
  expect(mergeVideoDonationIdleTracks(normalizeVideoDonationIdleTracks(tracks), [track(300)])).toHaveLength(200);
  expect(server.normalizePvdIdlePlaylist({ recommendedTracks: [...tracks, track(300)] }).recommendedTracks).toHaveLength(200);
});

test.each([0, 1, 30, 59.9, 600.1, null, undefined, Infinity])('rejects invalid idle duration %s in saved models', (duration) => {
  expect(normalizeVideoDonationIdleTracks([{ ...track(1), durationSec: duration }])).toHaveLength(0);
  expect(server.normalizePvdIdleTrack({ ...track(1), durationSec: duration }, { requireKnownDuration: true })).toBeNull();
});

test.each([60, 600])('allows exact idle duration boundary %s', (duration) => {
  expect(normalizeVideoDonationIdleTracks([track(1, duration)])).toHaveLength(1);
  expect(server.normalizePvdIdleTrack(track(1, duration), { requireKnownDuration: true })).not.toBeNull();
});

test('metadata hydration filters short and long videos and reports exclusion counts', async () => {
  const result = await server.hydrateYouTubeIdleTracks([0, 1, 2, 3, 4].map((n) => ({ mediaId: video(n) })), { strict: true });
  expect(result.tracks.map((item) => item.mediaId)).toEqual([video(2), video(3)]);
  expect(result).toMatchObject({ excludedCount: 3, excludedTooShortCount: 2, excludedTooLongCount: 1 });
});

test.each([
  `https://www.youtube.com/watch?v=${video(1)}&list=PL123456789`,
  `https://youtu.be/${video(1)}?t=60`,
  `https://youtube.com/shorts/${video(1)}`,
  `https://m.youtube.com/embed/${video(1)}`,
  `https://music.youtube.com/watch?v=${video(1)}`,
])('accepts a regular YouTube video URL: %s', (url) => {
  expect(parseYouTubeVideoId(url)).toBe(video(1));
});

test.each(['https://notyoutube.com/watch?v=video000001', 'https://youtube.com.evil.test/watch?v=video000001', 'javascript:alert(1)', 'https://youtube.com/playlist?list=PL123456789', 'https://user@youtube.com/watch?v=video000001'])('rejects a non-video or unsafe URL: %s', (url) => {
  expect(parseYouTubeVideoId(url)).toBeNull();
});
