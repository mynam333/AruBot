const loadSource = require('./helpers/load-source.cjs');
const loadServerFunctions = require('./helpers/load-server-functions.cjs');
const volume = loadSource('shared/pvd-volume.js');
const bgm = loadSource('server/pvd-bgm.js');
const { normalizeChzzkVideoDonationSettings } = loadSource('server/chzzk-video-donation.js');

test.each([
  [{}, { video: 100, bgm: 100 }],
  [{ videoDonationVolume: 42 }, { video: 42, bgm: 42 }],
  [{ videoDonationVolume: 0 }, { video: 0, bgm: 0 }],
  [{ videoDonationVolume: 80, videoDonationBgmVolume: 0 }, { video: 80, bgm: 0 }],
  [{ videoDonationVolume: 0, videoDonationBgmVolume: 15 }, { video: 0, bgm: 15 }],
  [{ videoDonationVolume: 'NaN', videoDonationBgmVolume: 250 }, { video: 100, bgm: 100 }],
  [{ videoDonationVolume: 26.7, videoDonationBgmVolume: -3 }, { video: 27, bgm: 0 }],
])('resolves independent player volumes, with legacy fallback: %j', (settings, expected) => {
  expect(volume.getPvdVolumes(settings)).toEqual(expected);
});

test('invalid volume fallback preserves an explicitly muted fallback', () => {
  expect(volume.normalizePvdVolume(NaN, 0)).toBe(0);
  expect(volume.getPvdVolumes({ videoDonationVolume: 0, videoDonationBgmVolume: 'bad' }).bgm).toBe(0);
});

test.each(['video', 'bgm'])('the first %s update freezes the old shared volume for the other player', (target) => {
  const settings = { videoDonationVolume: 47 };
  const input = target === 'bgm' ? { bgm: { volume: 0 } } : { volume: 0 };
  const patched = { ...settings, ...volume.getPvdVolumePatch(settings, input) };
  expect(volume.getPvdVolumes(patched)).toEqual(target === 'bgm' ? { video: 47, bgm: 0 } : { video: 0, bgm: 47 });
  expect(volume.getPvdVolumePatch(patched, {})).toEqual(patched);
});

function harness(initial = {}) {
  let settings = structuredClone({ videoDonationViewerToken: 'token', ...initial });
  let tail = Promise.resolve();
  const state = { paused: true, pausedAtSec: 17.5, baseStartMs: 1000, playbackEpoch: 'epoch' };
  const queue = [{ id: 'bgm-1', kind: 'bgm', resumePlayback: { atSec: 17.5, paused: true } }];
  const send = jest.fn();
  const broadcast = jest.fn(async () => ({ success: 1 }));
  const notify = jest.fn(async () => undefined);
  const bindings = {
    ...volume, ...bgm, normalizeChzzkVideoDonationSettings,
    getPartitionId: async () => 'sid', getLocalRemoteSid: () => 'sid',
    getBotSettings: async () => structuredClone(settings), getBotSettingsStrict: async () => structuredClone(settings),
    updateBotSettingsAtomically: jest.fn((_sid, update) => {
      const operation = tail.then(async () => { settings = await update(structuredClone(settings)); return structuredClone(settings); });
      tail = operation.catch(() => undefined);
      return operation;
    }),
    pvdTokenToSid: new Map([['token', 'sid']]),
    pvdPlaybackState: new Map([['sid', state]]),
    getVideoQueue: () => queue, getActivePvdIdlePlayback: () => null,
    getCurrentAtSec: () => 17.5, getCurrentPvdElapsedSec: () => 17.5,
    broadcastToChannelBySid: broadcast, pvdSidSockets: new Map([['sid', new Set([{ readyState: 1, send }])]]),
    notifyPvdAdminSubscribers: notify,
    normalizePvdProviders: (value) => value || {},
    normalizePvdIdlePlaylist: (value) => value || {}, getPvdIdlePlaylistForViewer: (value) => value || {},
    chzzkVideoRuntime: { configure: jest.fn(), paused: () => false },
    getChzzkVideoDonationPublicSettings: () => ({ configured: false }),
    broadcastPvdStart: jest.fn(async () => undefined),
  };
  Object.assign(bindings, loadServerFunctions([
    'controlPvdVolumeForSid', 'broadcastPvdControl', 'getPvdVolumesForSid', 'getPvdVolumeForSid',
    'getPvdBgmViewerSettings', 'getPvdViewerSettingsForSid', 'getPvdQueueSnapshot',
  ], bindings));
  return {
    read: () => structuredClone(settings), bindings, state, queue, send, broadcast, notify,
    async route(url, body, method = 'post') {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
      await loadServerFunctions.route(url, bindings, method)({ body: { token: 'token', ...body } }, res);
      return res;
    },
  };
}

const controlRoutes = ['/api/video-donation/control', '/api/video-donation/control-by-token', '/api/local-remote/video-donation/control'];

test.each(controlRoutes)('%s preserves the legacy video control and separates BGM mute/resume', async (route) => {
  const h = harness({ videoDonationVolume: 37, botEnabled: false, bgmIdlePlaylist: { enabled: true } });
  const playbackBefore = structuredClone({ state: h.state, queue: h.queue });
  const muted = await h.route(route, { op: 'volume', target: 'bgm', volume: 0 });
  expect(muted.statusCode).toBe(200);
  expect(muted.body.message).toMatchObject({ type: 'control', op: 'bgm-volume', target: 'bgm', volume: 0 });
  expect(h.read()).toMatchObject({ videoDonationVolume: 37, videoDonationBgmVolume: 0, botEnabled: false, bgmIdlePlaylist: { enabled: true } });
  const legacy = await h.route(route, { op: 'volume', value: 12 });
  expect(legacy.body.message).toMatchObject({ op: 'volume', target: 'video', volume: 12 });
  expect(h.read()).toMatchObject({ videoDonationVolume: 12, videoDonationBgmVolume: 0 });
  await h.route(route, { op: 'volume', target: 'bgm', volume: 37 });
  expect(h.read()).toMatchObject({ videoDonationVolume: 12, videoDonationBgmVolume: 37 });
  expect({ state: h.state, queue: h.queue }).toEqual(playbackBefore);
  const payloads = h.send.mock.calls.map(([text]) => JSON.parse(text));
  expect(payloads.map(({ op, volume }) => [op, volume])).toEqual([['bgm-volume', 0], ['volume', 12], ['bgm-volume', 37]]);
  expect(h.broadcast.mock.calls.map(([, , payload]) => payload)).toEqual(payloads);
  expect(h.notify).toHaveBeenCalledWith('sid', 'volume_changed');
});

test.each(controlRoutes)('%s rejects an unknown volume target without altering either player', async (route) => {
  const h = harness({ videoDonationVolume: 35, videoDonationBgmVolume: 70 });
  const before = h.read();
  expect((await h.route(route, { op: 'volume', target: 'typo', volume: 0 })).statusCode).toBe(400);
  expect(h.read()).toEqual(before);
  expect(h.broadcast).not.toHaveBeenCalled();
});

test('concurrent BGM and video controls merge against the latest locked settings', async () => {
  const h = harness({ videoDonationVolume: 31, unrelated: { saved: true } });
  await Promise.all([
    h.route(controlRoutes[0], { op: 'volume', target: 'bgm', volume: 0 }),
    h.route(controlRoutes[1], { op: 'volume', volume: 93 }),
  ]);
  expect(h.read()).toMatchObject({ videoDonationVolume: 93, videoDonationBgmVolume: 0, unrelated: { saved: true } });
});

test('video settings preserve omitted BGM volume, then BGM settings preserve current video volume', async () => {
  const h = harness({ videoDonationVolume: 44, songbook: { enabled: true } });
  expect((await h.route('/api/video-donation/settings', { volume: 0 })).statusCode).toBe(200);
  expect(h.read()).toMatchObject({ videoDonationVolume: 0, videoDonationBgmVolume: 44 });
  await h.route(controlRoutes[0], { op: 'volume', volume: 63 });
  const saved = await h.route('/api/video-donation/settings', { bgm: { volume: 0, pointsPerSecond: 5 } });
  expect(saved.statusCode).toBe(200);
  expect(saved.body.bgm.volume).toBe(0);
  expect(h.read()).toMatchObject({ videoDonationVolume: 63, videoDonationBgmVolume: 0, bgmPointsPerSecond: 5, songbook: { enabled: true } });
  await h.route('/api/video-donation/settings', {});
  expect(h.read()).toMatchObject({ videoDonationVolume: 63, videoDonationBgmVolume: 0 });
  expect(h.broadcast.mock.calls.filter(([, , payload]) => payload.op === 'volume').map(([, , payload]) => payload.volume)).toEqual([0, 63]);
});

test('concurrent settings save and BGM control retain independent values', async () => {
  const h = harness({ videoDonationVolume: 44 });
  const results = await Promise.all([
    h.route('/api/video-donation/settings', { volume: 0 }),
    h.route(controlRoutes[0], { op: 'volume', target: 'bgm', volume: 18 }),
  ]);
  expect(results.map((result) => result.statusCode)).toEqual([200, 200]);
  expect(h.read()).toMatchObject({ videoDonationVolume: 0, videoDonationBgmVolume: 18 });
});

test.each([undefined, 0, 83])('settings, initial viewer state and admin snapshots carry both volumes (BGM %s)', async (bgmVolume) => {
  const h = harness({ videoDonationVolume: 32, videoDonationBgmVolume: bgmVolume, bgmEnabled: true });
  const expected = { volume: 32, bgm: { volume: bgmVolume ?? 32 } };
  const settings = await h.route('/api/video-donation/settings', {}, 'get');
  expect(settings.statusCode).toBe(200);
  expect(settings.body).toMatchObject(expected);
  expect(await h.bindings.getPvdViewerSettingsForSid('sid')).toMatchObject(expected);
  expect(await h.bindings.getPvdQueueSnapshot('sid')).toMatchObject(expected);
});
