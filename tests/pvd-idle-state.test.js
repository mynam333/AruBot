const loadSource = require('./helpers/load-source.cjs');
const loadServerFunctions = require('./helpers/load-server-functions.cjs');
const { EventEmitter } = require('node:events');
const { createPvdIdlePlaybackStore } = loadSource('server/pvd-idle-playback.js');
const { isPvdDocumentHidden } = loadSource('src/components/pvdPlaybackVisibility.ts');
const track = { id: 'song:1', mediaId: 'video000001', title: 'Current Mix song', durationSec: 180 };
const report = (patch = {}) => ({ clientId: 'viewer-aaaa', sequence: 1, source: 'obs', mode: 'idle', track, playing: true, atSec: 10, ...patch });

test('reports the real playing song without adding it to the paid donation queue', async () => {
  const idle = createPvdIdlePlaybackStore();
  idle.report('sid', report());
  const queue = [{ id: 'paid-1', title: 'Requested video' }];
  const bindings = {
    pvdIdlePlayback: idle, getVideoQueue: () => queue,
    pvdPlaybackState: new Map([['sid', { idleDeferred: true, paused: true }]]),
    getPvdVolumeForSid: async () => 80, getCurrentAtSec: () => 0, getCurrentPvdElapsedSec: () => 0,
  };
  const api = loadServerFunctions(['getActivePvdIdlePlayback', 'getPvdQueueSnapshot', 'controlPvdIdlePlayback'], {
    ...bindings, broadcastPvdControl: jest.fn(),
  });
  expect(await api.getPvdQueueSnapshot('sid')).toMatchObject({
    currentItem: { title: 'Current Mix song', idle: true }, playbackMode: 'idle', items: queue, waitingItems: queue, waitingSize: 1, paused: false,
  });
  await api.controlPvdIdlePlayback('sid', 'skip', idle.snapshot('sid').item.id);
  expect(queue).toHaveLength(1);
  bindings.pvdPlaybackState.set('sid', { idleDeferred: false, paused: false });
  expect(await api.getPvdQueueSnapshot('sid')).toMatchObject({ currentItem: queue[0], playbackMode: 'donation', waitingItems: [] });
});

test('an out-of-order heartbeat cannot restore an older track or cancel a web pause', () => {
  const store = createPvdIdlePlaybackStore();
  store.report('sid', report());
  const command = store.control('sid', 'pause');
  store.report('sid', report({ sequence: 3, atSec: 12, paused: false }));
  store.report('sid', report({ sequence: 2, track: { ...track, title: 'Outdated title' } }));
  expect(store.snapshot('sid')).toMatchObject({ paused: true, item: { title: track.title } });
  const next = store.control('sid', 'play');
  expect(next.version).toBeGreaterThan(command.version);
  expect(store.snapshot('sid').paused).toBe(false);
});

test('OBS reports take precedence over a second browser preview', () => {
  const store = createPvdIdlePlaybackStore();
  store.report('sid', report({ source: 'browser' }));
  expect(store.report('sid', report({ clientId: 'viewer-bbbb' })).accepted).toBe(true);
  expect(store.report('sid', report({ source: 'browser', sequence: 2 })).accepted).toBe(false);
  expect(store.snapshot('sid').clientId).toBe('viewer-bbbb');
});

test('closing the last player clears the old song and allows a fresh OBS instance immediately', () => {
  const store = createPvdIdlePlaybackStore();
  store.report('sid', report());
  expect(store.release('sid', 'viewer-aaaa')).toBe(true);
  expect(store.snapshot('sid')).toBeNull();
  expect(store.report('sid', report({ sequence: 2 })).accepted).toBe(false);
  expect(store.report('sid', report({ clientId: 'viewer-bbbb', track: { ...track, mediaId: 'video000002', title: 'New random seed' } })).accepted).toBe(true);
  expect(store.snapshot('sid').item.title).toBe('New random seed');
});

test('disconnecting a non-owner cannot clear the OBS song', () => {
  const store = createPvdIdlePlaybackStore();
  store.report('sid', report());
  expect(store.release('sid', 'viewer-bbbb')).toBe(false);
  expect(store.snapshot('sid')).not.toBeNull();
});

test('dead players expire and reconnects use a new control version', () => {
  let now = 100;
  const store = createPvdIdlePlaybackStore({ now: () => now });
  store.report('sid', report());
  const oldCommand = store.control('sid', 'pause');
  now += 20001;
  expect(store.expire()).toEqual(['sid']);
  expect(store.snapshot('sid')).toBeNull();
  store.report('sid', report({ clientId: 'viewer-bbbb' }));
  expect(store.control('sid', 'play').version).toBeGreaterThan(oldCommand.version);
});

test('duplicate skips and stale controls cannot skip an additional song', () => {
  const store = createPvdIdlePlaybackStore();
  store.report('sid', report());
  const id = store.snapshot('sid').item.id;
  const command = store.control('sid', 'skip', id);
  expect(store.control('sid', 'skip', id)).toBe(command);
  store.report('sid', report({ sequence: 2, track: { ...track, id: 'song:2', mediaId: 'video000002' }, controlVersion: command.version }));
  expect(store.control('sid', 'skip', id)).toEqual({ mismatch: true });
});

test.each([null, { ...track, durationSec: 30 }, { ...track, durationSec: 601 }, { ...track, mediaId: 'https://evil.example' }])('rejects incomplete or invalid playing songs: %j', (invalid) => {
  const store = createPvdIdlePlaybackStore();
  store.report('sid', report({ track: invalid }));
  expect(store.snapshot('sid')).toBeNull();
});

test('hidden OBS off-screen rendering does not prevent autoplay, unlike a hidden ordinary browser', () => {
  const saved = { window: global.window, document: global.document };
  try {
    global.document = { hidden: true };
    global.window = { obsstudio: {} };
    expect(isPvdDocumentHidden()).toBe(false);
    global.window = {};
    expect(isPvdDocumentHidden()).toBe(true);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
});

describe('OBS connection lifecycle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  function harness(settings = async () => ({})) {
    let server;
    const store = createPvdIdlePlaybackStore();
    const sockets = new Map();
    const notify = jest.fn(async () => {});
    loadServerFunctions(['registerPvdRoutes'], {
      wssPvd: null, PORT: 3001, WebSocket: { OPEN: 1 },
      WebSocketServer: class extends EventEmitter { constructor() { super(); server = this; } },
      console: { log() {}, error() {} }, enableWebSocketHeartbeat() {},
      pvdIdlePlayback: store, pvdSidSockets: sockets,
      validateWebSocketTokenConnection: async () => ({ sid: 'sid', channelId: 'channel' }),
      registerChannelConnection: () => true, unregisterChannelConnection() {}, handleWebSocketError: jest.fn(),
      pvdDurationProbeCoordinator: { dispatchPendingToSocket: () => 0 },
      notifyPvdAdminSubscribers: notify, getVideoQueue: () => [],
      getPvdViewerSettingsForSid: settings, pvdPlaybackState: new Map(),
    }).registerPvdRoutes();
    const connect = (clientId) => {
      const socket = new EventEmitter();
      socket.readyState = 1; socket.send = jest.fn(); socket.ping = jest.fn();
      socket.close = () => { socket.readyState = 3; socket.emit('close', 1000, ''); };
      const ready = server.listeners('connection')[0](socket, { url: `/api/pvd/ws?token=test&clientId=${clientId}`, headers: {} });
      return { socket, ready };
    };
    return { store, sockets, notify, connect };
  }

  test('keeps an owner while one of its sockets remains, then clears on the last close', async () => {
    const h = harness();
    const a = h.connect('viewer-aaaa'); await a.ready;
    const b = h.connect('viewer-aaaa'); await b.ready;
    h.store.report('sid', report());
    a.socket.close();
    expect(h.store.snapshot('sid')).not.toBeNull();
    b.socket.close();
    expect(h.store.snapshot('sid')).toBeNull();
    expect(h.sockets.has('sid')).toBe(false);
    const reopened = h.connect('viewer-bbbb'); await reopened.ready;
    expect(h.store.report('sid', report({ clientId: 'viewer-bbbb' })).accepted).toBe(true);
    reopened.socket.close();
  });

  test('cleans up an OBS source closed while its initial settings are still loading', async () => {
    let finish;
    const h = harness(() => new Promise((resolve) => { finish = resolve; }));
    const connection = h.connect('viewer-aaaa');
    await Promise.resolve();
    h.store.report('sid', report());
    connection.socket.close();
    expect(h.store.snapshot('sid')).toBeNull();
    expect(h.sockets.has('sid')).toBe(false);
    finish({}); await connection.ready;
    expect(h.sockets.has('sid')).toBe(false);
  });
});
