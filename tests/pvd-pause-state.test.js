const loadServerFunctions = require('./helpers/load-server-functions.cjs');

function setupServer() {
  const sid = 'test';
  const item = { id: 'donation-1', mediaProvider: 'youtube', videoId: 'video000001', startSec: 12 };
  const queue = [item];
  const state = { itemKey: item.id, paused: true, pausedAtSec: 83, baseStartMs: 1000, idleDeferred: false };
  const states = new Map([[sid, state]]);
  const broadcasts = [];
  const bindings = {
    getVideoQueue: () => queue, pvdPlaybackState: states,
    getPvdViewerSettingsForSid: async () => ({ volume: 100, idlePlaylist: { enabled: true, tracks: [] } }),
    refreshChzzkClipPlaybackForItem: async () => {},
    broadcastToChannelBySid: async (_sid, _channel, message) => { broadcasts.push(message); return { success: 1 }; },
    pvdSidSockets: new Map(), videoDonationTimers: new Map(),
    notifyPvdAdminSubscribers: async () => {}, scheduleNextPvdAutoPop: jest.fn(),
    console: { log() {}, error() {} },
  };
  const server = loadServerFunctions(['getPvdItemStartSec', 'getPvdQueueItemKey', 'createPvdPlaybackState', 'getCurrentAtSec', 'getCurrentPvdElapsedSec', 'broadcastPvdStart'], bindings);
  return { sid, item, queue, state, states, broadcasts, server };
}

test('rebroadcasting the same head preserves manual pause, position and clock', async () => {
  const h = setupServer();
  await h.server.broadcastPvdStart(h.sid);
  expect(h.states.get(h.sid)).toBe(h.state);
  expect(h.broadcasts[0]).toMatchObject({ paused: true, atSec: 83, startedAt: 1000 });
});

test('only a new head or explicit deferred activation resets playback state', async () => {
  const h = setupServer();
  h.queue[0] = { ...h.item, id: 'donation-2' };
  await h.server.broadcastPvdStart(h.sid);
  expect(h.states.get(h.sid)).toMatchObject({ itemKey: 'donation-2', paused: false });
  h.states.get(h.sid).paused = true;
  h.states.get(h.sid).idleDeferred = true;
  await h.server.broadcastPvdStart(h.sid, { activateDeferredPlayback: true });
  expect(h.states.get(h.sid)).toMatchObject({ paused: false, idleDeferred: false });
});

test('a Mix without saved seed tracks can still defer an incoming donation', async () => {
  const h = setupServer();
  h.states.clear();
  await h.server.broadcastPvdStart(h.sid, { deferForIdle: true });
  expect(h.states.get(h.sid)).toMatchObject({ paused: true, idleDeferred: true });
});

function setupRoute() {
  const control = jest.fn(async () => ({ ok: true, paused: false }));
  const broadcast = jest.fn(async () => ({}));
  const route = loadServerFunctions.route('/api/video-donation/control-by-token', {
    pvdTokenToSid: new Map([['viewer-token', 'test']]),
    getBotSettings: async () => ({ videoDonationViewerToken: 'viewer-token' }),
    getVideoQueue: () => [{ id: 'donation-1' }],
    getPvdQueueItemKey: (item) => item.id,
    pvdPlaybackState: new Map([['test', { paused: true, idleDeferred: false }]]),
    getCurrentAtSec: () => 83, broadcastPvdControl: broadcast,
    controlPvdPlaybackForSid: control,
  });
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  return { route, response, control, broadcast };
}

test('a late automatic PLAYING report cannot cancel the web pause', async () => {
  const h = setupRoute();
  await h.route({ body: { token: 'viewer-token', itemId: 'donation-1', op: 'play', source: 'player' } }, h.response);
  expect(h.control).not.toHaveBeenCalled();
  expect(h.broadcast).toHaveBeenCalledWith('test', { op: 'pause', paused: true, atSec: 83 });
  expect(h.response.body).toMatchObject({ ignored: true, paused: true, atSec: 83 });
});

test('explicit playback requests still use the normal control path', async () => {
  const h = setupRoute();
  await h.route({ body: { token: 'viewer-token', itemId: 'donation-1', op: 'play' } }, h.response);
  expect(h.control).toHaveBeenCalledWith('test', 'play', undefined);
});

test('a stale player cannot change the next donation', async () => {
  const h = setupRoute();
  await h.route({ body: { token: 'viewer-token', itemId: 'old-item', op: 'pause', source: 'player' } }, h.response);
  expect(h.response.statusCode).toBe(409);
  expect(h.control).not.toHaveBeenCalled();
});
