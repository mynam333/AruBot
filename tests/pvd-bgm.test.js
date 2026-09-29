const crypto = require('crypto');
const loadSource = require('./helpers/load-source.cjs');
const loadServerFunctions = require('./helpers/load-server-functions.cjs');
const bgm = loadSource('server/pvd-bgm.js');
const timing = loadSource('server/video-donation-timing.js');
const queueModel = loadSource('server/video-donation-queue.js');

const bgmItem = () => ({ id: 'bgm-1', kind: 'bgm', startSec: 10, durationSec: 180, cost: 540 });
const playback = loadServerFunctions(['createPvdPlaybackState', 'getPvdItemStartSec', 'getPvdQueueItemKey']);

test('BGM is off by default and cannot coexist with video idle music', () => {
  expect(bgm.getPvdBgmSettings()).toEqual({ enabled: false, acceptEnabled: false, pointsPerSecond: 1 });
  expect(bgm.getPvdBgmSettings({ bgmEnabled: true, videoDonationIdlePlaylist: { enabled: true } }).enabled).toBe(false);
  expect(bgm.getPvdBgmSettings({ bgmEnabled: true, bgmAcceptEnabled: false, bgmPointsPerSecond: 3 })).toEqual({ enabled: true, acceptEnabled: false, pointsPerSecond: 3 });
});

test('video interrupts BGM, retains exact position and resumes after all videos', () => {
  const item = bgmItem();
  const queue = [item];
  expect(bgm.insertPvdRequest(queue, { id: 'video-1' }, { paused: false }, 83.25)).toBe(true);
  expect(item.resumePlayback).toEqual({ atSec: 83.25, paused: false });
  bgm.insertPvdRequest(queue, { id: 'bgm-2', kind: 'bgm' });
  bgm.insertPvdRequest(queue, { id: 'video-2' });
  expect(queue.map((entry) => entry.id)).toEqual(['video-1', 'video-2', 'bgm-1', 'bgm-2']);
  queue.splice(0, 2);
  const state = playback.createPvdPlaybackState(queue[0]);
  expect(state).toMatchObject({ paused: true, pausedAtSec: 83.25, bgmBlocked: true });
  bgm.updateBgmPlaybackAvailability(state, queue[0], true, 100000);
  expect(state).toMatchObject({ paused: false, baseStartMs: 26750, bgmBlocked: false });
  expect(item.cost).toBe(540);
});

test.each([false, true])('interrupting a manually paused BGM preserves pause (blocked=%s)', (blocked) => {
  const item = bgmItem();
  bgm.insertPvdRequest([item], { id: 'video' }, { paused: true, bgmBlocked: blocked, bgmResumePaused: true }, 72);
  const state = playback.createPvdPlaybackState(item);
  bgm.updateBgmPlaybackAvailability(state, item, true);
  expect(state).toMatchObject({ paused: true, pausedAtSec: 72 });
});

test('missing or hidden BGM window pauses time and reopening resumes it', () => {
  const item = bgmItem();
  const state = { paused: false, baseStartMs: 1000, bgmBlocked: false };
  bgm.updateBgmPlaybackAvailability(state, item, false, 12000);
  expect(state).toMatchObject({ paused: true, pausedAtSec: 21, bgmResumePaused: false });
  expect(bgm.updateBgmPlaybackAvailability(state, item, false, 90000)).toBe(false);
  bgm.updateBgmPlaybackAvailability(state, item, true, 100000);
  expect(state).toMatchObject({ paused: false, baseStartMs: 89000 });
});

test('only one visible BGM player owns playback; expired leases are reclaimed', () => {
  let now = 1000;
  const presence = bgm.createBgmPlayerPresence({ now: () => now });
  expect(presence.report('sid', { clientId: 'player-001', visible: true })).toBe(true);
  expect(presence.report('sid', { clientId: 'player-002', visible: true })).toBe(false);
  presence.report('sid', { clientId: 'player-002', visible: false });
  expect(presence.current('sid').clientId).toBe('player-001');
  now += 13000;
  expect(presence.current('sid')).toBeNull();
  expect(presence.report('sid', { clientId: 'player-002', visible: true })).toBe(true);
  presence.report('sid', { clientId: 'player-002', visible: false });
  expect(presence.current('sid')).toBeNull();
});

test('a late visibility report cannot reclaim a closed player', () => {
  const presence = bgm.createBgmPlayerPresence();
  presence.report('sid', { clientId: 'player-001', sequence: 2, visible: false });
  presence.report('sid', { clientId: 'player-001', sequence: 1, visible: true });
  expect(presence.current('sid')).toBeNull();
});

test('BGM queue waits for its player to be ready before starting the clock', async () => {
  const item = bgmItem();
  const state = playback.createPvdPlaybackState(item);
  const presence = bgm.createBgmPlayerPresence();
  const broadcast = jest.fn();
  const route = loadServerFunctions.route('/api/video-donation/control-by-token', {
    ...bgm, bgmPlayerPresence: presence, broadcastPvdStart: broadcast,
    pvdTokenToSid: new Map([['token', 'sid']]),
    getBotSettings: async () => ({ videoDonationViewerToken: 'token', bgmEnabled: true }),
    getVideoQueue: () => [item], pvdPlaybackState: new Map([['sid', state]]),
  });
  const res = { status() { return this; }, json(value) { this.body = value; return this; } };
  const body = { token: 'token', op: 'bgm_status', clientId: 'player-001', visible: true };
  await route({ body }, res);
  expect(state.paused).toBe(true);
  expect(broadcast).not.toHaveBeenCalled();
  await route({ body: { ...body, readyItemId: item.id } }, res);
  expect(state.paused).toBe(false);
  expect(broadcast).toHaveBeenCalledWith('sid');
});

function commandHarness(settings) {
  const enqueue = jest.fn(async (job) => ({ job, created: true, deduction: { deducted: true } }));
  const resolve = jest.fn(async () => ({ provider: 'youtube', mediaId: 'video000001', title: 'Song', durationSec: 180 }));
  const log = jest.fn();
  const { enqueueVideoDonationFromArgs } = loadServerFunctions(['enqueueVideoDonationFromArgs'], {
    ...bgm, ...timing, ...queueModel, crypto,
    getBotSettings: async () => settings, resolvePvdMedia: resolve,
    shouldAwaitPvdDurationSync: () => false, findBlockedBotUser: () => false,
    providerFromLogContext: () => 'youtube', enqueuePaidDurableRuntimeJob: enqueue,
    getVideoDonationReceiptQueueSize: async () => 1, runDurableRuntimeWorker: async () => {}, recordBotEventLogSafe: log,
  });
  const request = (response = '${bgm_request}') => enqueueVideoDonationFromArgs({
    sid: 'sid', channelUid: 'channel', userId: 'viewer', username: 'Viewer',
    args: ['https://youtu.be/video000001', '1:00', '2:00'], response,
    vdReAll: /\$\{\s*(?:bgm_request|video_donation)\s*\}/ig, context: { eventId: 'message-1' },
  });
  return { request, enqueue, resolve, log };
}

test('BGM requests work when video requests are off and use the BGM rate', async () => {
  const h = commandHarness({ bgmEnabled: true, bgmAcceptEnabled: true, bgmPointsPerSecond: 3, videoDonationPointsPerSecond: 99 });
  expect(await h.request()).toContain('요청을 접수했습니다. Song');
  expect(h.enqueue).toHaveBeenCalledWith(expect.objectContaining({ pointsCost: 180, idempotencyKey: 'bgm:message-1', payload: { item: expect.objectContaining({ kind: 'bgm', startSec: 60, durationSec: 60, cost: 180 }) } }));
  expect(h.resolve.mock.calls[0][1].videoDonationProviders).toEqual({ youtube: true, tiktok: false, chzzk_clip: false, cime_clip: false });
  expect(h.log).toHaveBeenCalledWith('sid', expect.objectContaining({ eventType: 'bgm_request', pointDelta: -180 }));
});

test.each([
  { bgmEnabled: false, bgmAcceptEnabled: true },
  { bgmEnabled: true, bgmAcceptEnabled: false },
  { bgmEnabled: true, bgmAcceptEnabled: true, videoDonationIdlePlaylist: { enabled: true } },
])('disabled BGM requests do not charge points or resolve media: %j', async (settings) => {
  const h = commandHarness(settings);
  expect(await h.request()).toContain('BGM 신청을 받을 수 없습니다');
  expect(h.resolve).not.toHaveBeenCalled();
  expect(h.enqueue).not.toHaveBeenCalled();
});

test('video requests keep their own rate and idempotency key', async () => {
  const h = commandHarness({ videoDonationAcceptEnabled: true, videoDonationPointsPerSecond: 2, bgmPointsPerSecond: 9 });
  await h.request('${video_donation}');
  expect(h.enqueue).toHaveBeenCalledWith(expect.objectContaining({ pointsCost: 120, idempotencyKey: 'message-1', payload: { item: expect.objectContaining({ kind: 'video' }) } }));
});

test('backend settings reject simultaneous BGM and video idle music', async () => {
  const save = jest.fn();
  const route = loadServerFunctions.route('/api/video-donation/settings', {
    getPartitionId: async () => 'sid', getBotSettings: async () => ({}), setBotSettings: save,
    normalizePvdVolume: Number, normalizePvdProviders: () => ({}), normalizePvdIdlePlaylist: (value) => value || {},
  }, 'post');
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await route({ body: { idlePlaylist: { enabled: true }, bgm: { enabled: true } } }, res);
  expect(res.code).toBe(400);
  expect(save).not.toHaveBeenCalled();
});
