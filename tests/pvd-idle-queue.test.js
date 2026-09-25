const loadSource = require('./helpers/load-source.cjs');
const { normalizePvdIdlePlaylist, mergePvdIdleRecommendations } = loadSource('src/components/pvdIdlePlaylist.ts');
const track = (id) => ({ id, mediaId: id, videoId: id, title: id });

test('a topic can start autoplay before any songs have been saved', () => {
  expect(normalizePvdIdlePlaylist({ enabled: true, mode: 'recommended', topic: 'jazz', tracks: [] }).enabled).toBe(true);
  expect(normalizePvdIdlePlaylist({ enabled: true, mode: 'custom', tracks: [] }).enabled).toBe(false);
});

test('refilling keeps the playing song and queued songs while excluding history', () => {
  const playlist = normalizePvdIdlePlaylist({ enabled: true, tracks: ['a', 'b', 'c'].map(track) });
  const result = mergePvdIdleRecommendations(playlist, ['a', 'b', 'c'], 1, ['a', 'b', 'c', 'd'].map(track), new Set(['a', 'b']));
  expect(result.order).toEqual(['b', 'c', 'd']);
  expect(result.playlist.tracks.map((track) => track.mediaId)).toEqual(['b', 'c', 'd']);
});

test('an exhausted queue starts with new songs instead of replaying its seed list', () => {
  const playlist = normalizePvdIdlePlaylist({ enabled: true, tracks: ['a', 'b'].map(track) });
  const result = mergePvdIdleRecommendations(playlist, ['a', 'b'], 2, ['a', 'b', 'c'].map(track), new Set(['a', 'b']));
  expect(result.order).toEqual(['c']);
});
