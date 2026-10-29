const loadServerFunctions = require('./helpers/load-server-functions.cjs');
const { setChzzkPlaybackBlocked } = require('./helpers/load-source.cjs')('server/pvd-chzzk-pause.js');
const { insertPvdRequest, updateBgmPlaybackAvailability } = require('./helpers/load-source.cjs')('server/pvd-bgm.js');

function setupServer(viewerSettings = { volume: 100, idlePlaylist: { enabled: true, tracks: [] } }) {
  const sid = 'test';
  const item = { id: 'donation-1', mediaProvider: 'youtube', videoId: 'video000001', startSec: 12 };
  const queue = [item];
  const state = { itemKey: item.id, paused: true, pausedAtSec: 83, baseStartMs: 1000, idleDeferred: false };
  const states = new Map([[sid, state]]);
  const broadcasts = [];
  const bindings = {
    setChzzkPlaybackBlocked,
    chzzkVideoRuntime: { paused: () => false },
    getVideoQueue: () => queue, pvdPlaybackState: states,
    getPvdViewerSettingsForSid: async () => viewerSettings,
    updateBgmPlaybackAvailability, bgmPlayerPresence: { current: () => ({ clientId: 'bgm-player' }) },
    refreshChzzkClipPlaybackForItem: async () => {},
    broadcastToChannelBySid: async (_sid, _channel, message) => { broadcasts.push(message); return { success: 1 }; },
    pvdSidSockets: new Map(), videoDonationTimers: new Map(),
    notifyPvdAdminSubscribers: async () => {}, scheduleNextPvdAutoPop: jest.fn(),
    console: { log() {}, error() {} },
  };
  const server = loadServerFunctions(['getPvdItemStartSec', 'getPvdQueueItemKey', 'createPvdPlaybackState', 'getCurrentAtSec', 'getCurrentPvdElapsedSec', 'broadcastPvdStart', 'activateDeferredPvdPlayback'], bindings);
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

test('BGM requests wait for their idle song, then play FIFO without another idle gap', async () => {
  const h = setupServer({ idlePlaylist: { enabled: false }, bgm: { enabled: true, idlePlaylist: { enabled: true } } });
  h.states.clear();
  h.item.kind = 'bgm';
  await h.server.broadcastPvdStart(h.sid, { deferForIdle: true });
  expect(h.states.get(h.sid)).toMatchObject({ idleDeferred: true, paused: true, pausedAtSec: 12 });
  const waitingState = h.states.get(h.sid);
  expect(insertPvdRequest(h.queue, { id: 'bgm-2', kind: 'bgm', startSec: 0 }, waitingState)).toBe(false);
  await h.server.broadcastPvdStart(h.sid);
  expect(h.states.get(h.sid)).toBe(waitingState);
  expect(h.queue.map(item => item.id)).toEqual(['donation-1', 'bgm-2']);
  expect(await h.server.activateDeferredPvdPlayback(h.sid, 'donation-1')).toMatchObject({ activated: true });
  expect(h.states.get(h.sid)).toMatchObject({ idleDeferred: false, bgmBlocked: true, pausedAtSec: 12 });
  h.queue.shift();
  await h.server.broadcastPvdStart(h.sid);
  expect(h.states.get(h.sid)).toMatchObject({ itemKey: 'bgm-2', idleDeferred: false, pausedAtSec: 0 });
});

test.each([false, true])('video donations still interrupt BGM immediately (idle enabled=%s)', async enabled => {
  const h = setupServer({ idlePlaylist: { enabled: false }, bgm: { enabled: true, idlePlaylist: { enabled } } });
  h.states.clear();
  await h.server.broadcastPvdStart(h.sid, { deferForIdle: true });
  expect(h.states.get(h.sid)).toMatchObject({ paused: false, idleDeferred: false });
});

test.each([false, true])('BGM without its own enabled idle playlist is not deferred (video idle=%s)', async videoIdle => {
  const h = setupServer({ idlePlaylist: { enabled: videoIdle }, bgm: { enabled: true, idlePlaylist: { enabled: false } } });
  h.states.clear();
  h.item.kind = 'bgm';
  await h.server.broadcastPvdStart(h.sid, { deferForIdle: true });
  expect(h.states.get(h.sid)).toMatchObject({ bgmBlocked: true, idleDeferred: false });
});

function setupRoute(paused = true, { kind = 'video', playbackEpoch = 'epoch-1', playbackRevision = 0, owner = 'owner-client' } = {}) {
  const control = jest.fn(async () => ({ ok: true, paused: false }));
  const broadcast = jest.fn(async () => ({}));
  const route = loadServerFunctions.route('/api/video-donation/control-by-token', {
    pvdTokenToSid: new Map([['viewer-token', 'test']]),
    getBotSettings: async () => ({ videoDonationViewerToken: 'viewer-token' }),
    getVideoQueue: () => [{ id: 'donation-1', kind }],
    getPvdQueueItemKey: (item) => item.id,
    pvdPlaybackState: new Map([['test', { paused, idleDeferred: false, playbackEpoch, playbackRevision }]]),
    bgmPlayerPresence: { current: () => owner ? { clientId: owner } : null },
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
  expect(h.broadcast).toHaveBeenCalledWith('test', { op: 'pause', paused: true, atSec: 83, itemId: 'donation-1', playbackRevision: 0 });
  expect(h.response.body).toMatchObject({ ignored: true, paused: true, atSec: 83 });
});

test('explicit playback requests still use the normal control path', async () => {
  const h = setupRoute();
  await h.route({ body: { token: 'viewer-token', itemId: 'donation-1', op: 'play' } }, h.response);
  expect(h.control).toHaveBeenCalledWith('test', 'play', undefined, { clientId: '', controlId: '' });
});

test('repeated automatic PLAYING events cannot reset an already running clock', async () => {
  const h = setupRoute(false);
  await h.route({ body: { token: 'viewer-token', itemId: 'donation-1', op: 'play', atSec: 12, source: 'player' } }, h.response);
  expect(h.response.statusCode).toBe(200);
  expect(h.response.body).toMatchObject({ ignored: true, paused: false, atSec: 83 });
  expect(h.control).not.toHaveBeenCalled();
  expect(h.broadcast).not.toHaveBeenCalled();
});

test('a stale player cannot change the next donation', async () => {
  const h = setupRoute();
  await h.route({ body: { token: 'viewer-token', itemId: 'old-item', op: 'pause', source: 'player' } }, h.response);
  expect(h.response.statusCode).toBe(409);
  expect(h.control).not.toHaveBeenCalled();
});

test.each(['other-client', '', undefined])('a non-owner BGM window (%s) cannot seek the queue', async (clientId) => {
  const h = setupRoute(false, { kind: 'bgm' });
  await h.route({ body: { token: 'viewer-token', itemId: 'donation-1', op: 'seek', atSec: 12, source: 'player', clientId } }, h.response);
  expect(h.response.statusCode).toBe(409);
  expect(h.response.body.error).toBe('bgm_player_owned');
  expect(h.control).not.toHaveBeenCalled();
});

test.each([{ playbackEpoch: 'old-epoch', playbackRevision: 3 }, { playbackEpoch: 'epoch-1', playbackRevision: 2 }])('stale BGM controls cannot reset the current clock: %j', async (version) => {
  const h = setupRoute(false, { kind: 'bgm', playbackRevision: 3 });
  await h.route({ body: { token: 'viewer-token', itemId: 'donation-1', op: 'seek', source: 'player', clientId: 'owner-client', ...version } }, h.response);
  expect(h.response.statusCode).toBe(409);
  expect(h.response.body.error).toBe('stale_playback_control');
  expect(h.control).not.toHaveBeenCalled();
});

test('the owning BGM window can issue an explicit control with its identity echoed', async () => {
  const h = setupRoute(false, { kind: 'bgm', playbackRevision: 3 });
  await h.route({ body: { token: 'viewer-token', itemId: 'donation-1', op: 'seek', atSec: 80, source: 'player', clientId: 'owner-client', controlId: 'control-1', playbackEpoch: 'epoch-1', playbackRevision: 3 } }, h.response);
  expect(h.control).toHaveBeenCalledWith('test', 'seek', 80, { clientId: 'owner-client', controlId: 'control-1' });
});

test('automatic position observations from a video overlay cannot become seeks', async () => {
  const h = setupRoute(false);
  await h.route({ body: { token: 'viewer-token', itemId: 'donation-1', op: 'seek', atSec: 12, source: 'player' } }, h.response);
  expect(h.response.body).toMatchObject({ ok: true, ignored: true });
  expect(h.control).not.toHaveBeenCalled();
});

test('playback commands include the item and revision, and null position preserves the current time', async () => {
  const item = { id: 'donation-1', startSec: 12 };
  const state = { itemKey: item.id, paused: true, pausedAtSec: 83 };
  const broadcast = jest.fn(async (_sid, message) => message);
  const server = loadServerFunctions(['controlPvdPlaybackForSid', 'setPvdPlaybackBaseFromAtSec', 'getPvdItemStartSec'], {
    getVideoQueue: () => [item], getPvdQueueItemKey: (entry) => entry.id,
    pvdPlaybackState: new Map([['sid', state]]), getCurrentAtSec: () => 83,
    videoDonationTimers: new Map(), scheduleNextPvdAutoPop: jest.fn(), broadcastPvdControl: broadcast,
  });
  await server.controlPvdPlaybackForSid('sid', 'play', null);
  expect(broadcast).toHaveBeenLastCalledWith('sid', { op: 'play', itemId: item.id, playbackRevision: 1, atSec: 83, paused: false });
  await server.controlPvdPlaybackForSid('sid', 'seek', 40);
  expect(broadcast).toHaveBeenLastCalledWith('sid', { op: 'seek', itemId: item.id, playbackRevision: 2, atSec: 40, paused: false });
});
