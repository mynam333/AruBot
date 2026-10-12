const loadSource = require('./helpers/load-source.cjs');
const loadServerFunctions = require('./helpers/load-server-functions.cjs');
const { createPvdQueueDisplay } = loadSource('server/pvd-queue-display.js');
const { visibleQueueRows, titleScrollTiming } = loadSource('src/features/viewer/request-queue-layout.ts');
const { insertPvdRequest } = loadSource('server/pvd-bgm.js');

const track = (id, kind = 'video') => ({ id, kind, title: `Song ${id}`, durationSec: 180, username: 'Viewer', videoId: 'S7-Lw14P5sQ' });
function snapshot(queue, state = {}, idle = null) {
  return loadServerFunctions(['getPvdQueueSnapshot'], {
    getVideoQueue: () => queue,
    pvdPlaybackState: new Map([['sid', state]]),
    getActivePvdIdlePlayback: () => idle,
    getPvdVolumeForSid: async () => 30,
    getCurrentAtSec: () => 40,
    getCurrentPvdElapsedSec: () => 30,
  }).getPvdQueueSnapshot('sid');
}

test('the display follows video priority and interrupted BGM resume order', async () => {
  const queue = [track('bgm1', 'bgm'), track('bgm2', 'bgm')];
  insertPvdRequest(queue, track('video1'), { paused: false }, 50);
  insertPvdRequest(queue, track('video2'));
  const result = createPvdQueueDisplay(await snapshot(queue));
  expect(result.currentItem.id).toBe('video1');
  expect(result.waitingItems.map((item) => item.id)).toEqual(['video2', 'bgm1', 'bgm2']);
  expect(result.waitingItems[1].resumed).toBe(true);
  expect(result.waitingCount).toBe(3);
  expect(result.status).toBe('playing');
  queue.shift();
  expect(createPvdQueueDisplay(await snapshot(queue)).currentItem.id).toBe('video2');
});

test('idle music remains current while every donated song is waiting', async () => {
  const result = createPvdQueueDisplay(await snapshot([track('v')], { idleDeferred: true }, {
    item: { ...track('idle'), idle: true }, paused: true, atSec: 60,
  }));
  expect(result).toMatchObject({ currentItem: { id: 'idle', idle: true }, status: 'paused', elapsedSec: 60, waitingCount: 1 });
  expect(result.waitingItems[0].id).toBe('v');
});

test('disconnected BGM players and deferred requests never look like playing', async () => {
  expect(createPvdQueueDisplay(await snapshot([track('b', 'bgm')], { paused: true }), { bgmBlocked: true }).status).toBe('waiting');
  const result = createPvdQueueDisplay(await snapshot([track('v')], { idleDeferred: true }));
  expect(result).toMatchObject({ currentItem: null, waitingCount: 1, status: 'waiting' });
  expect(createPvdQueueDisplay(await snapshot([])).status).toBe('empty');
});

test('the public display only exposes presentation fields and caps payload size', () => {
  const raw = { ...track('v'), userId: 'secret', cost: 999, mediaUrl: 'secret', token: 'secret', thumbnailUrl: 'javascript:alert(1)' };
  const result = createPvdQueueDisplay({ currentItem: raw, waitingItems: Array.from({ length: 125 }, (_, i) => track(String(i))), serverNow: 123 });
  expect(result.waitingItems).toHaveLength(100);
  expect(result.waitingCount).toBe(125);
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(result.currentItem.thumbnailUrl).toBe('https://i.ytimg.com/vi/S7-Lw14P5sQ/hqdefault.jpg');
});

function routeHarness({ settings = { videoDonationViewerToken: 'token' }, lookup = 'sid' } = {}) {
  const getSnapshot = jest.fn(async () => ({ currentItem: track('current'), waitingItems: [], elapsedSec: 8 }));
  const route = loadServerFunctions.route('/api/video-donation/queue-display', {
    createPvdQueueDisplay, pvdTokenToSid: new Map([['token', 'sid']]),
    findSidByViewerToken: async () => lookup,
    getBotSettings: async () => { if (settings instanceof Error) throw settings; return settings; },
    pvdPlaybackState: new Map(), getPvdQueueSnapshot: getSnapshot,
  });
  const res = { code: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  return { route, res, getSnapshot };
}

test('display endpoint works without a session, cookies or playback registration', async () => {
  const { route, res, getSnapshot } = routeHarness();
  await route({ query: { token: 'token' } }, res);
  expect(res.code).toBe(200);
  expect(res.headers['Cache-Control']).toContain('no-store');
  expect(getSnapshot).toHaveBeenCalledWith('sid', 'display_sync');
  expect(res.body.currentItem.id).toBe('current');
});

test.each([
  ['', {}, 400],
  [['token'], {}, 400],
  ['x'.repeat(257), {}, 400],
  ['token', { settings: { videoDonationViewerToken: 'rotated' } }, 404],
  ['unknown', { lookup: null }, 404],
  ['token', { settings: new Error('db offline') }, 503],
])('invalid or unverifiable credentials fail closed: %p', async (token, options, code) => {
  const { route, res, getSnapshot } = routeHarness(options);
  await route({ query: { token } }, res);
  expect(res.code).toBe(code);
  expect(getSnapshot).not.toHaveBeenCalled();
});

test.each([
  [304, 76, 4, 4], [303, 76, 4, 3], [182, 76, 9, 2],
  [29, 76, 9, 0], [0, 76, 9, 0], [500, 76, 0, 0],
])('responsive rows reserve room for omitted count: %i/%i/%i', (height, rowHeight, total, visible) => {
  expect(visibleQueueRows(height, rowHeight, total)).toBe(visible);
});

test('title animation pauses at both ends, then jumps back within one millisecond', () => {
  const timing = titleScrollTiming(320);
  expect(timing.start * timing.duration).toBeCloseTo(1800);
  expect((timing.end - timing.start) * timing.duration).toBeCloseTo(10000);
  expect((timing.reset - timing.end) * timing.duration).toBeCloseTo(1800);
  expect((1 - timing.reset) * timing.duration).toBeCloseTo(1);
});
