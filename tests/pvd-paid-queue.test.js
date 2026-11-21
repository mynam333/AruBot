const load = require('./helpers/load-server-functions.cjs');
const loadSource = require('./helpers/load-source.cjs');

function harness(settle) {
  const item = { id: 'charged', runtimeJobId: 'charged', cost: 12, kind: 'bgm' };
  const next = { id: 'next', cost: 0 };
  let queue = [item, next];
  const bindings = {
    getVideoQueue: () => queue, pvdPlaybackState: new Map(), DURABLE_RUNTIME_WORKER_ID: 'worker',
    chzzkVideoStore: { settlePaidQueueItem: settle }, refundBroadcastPoints: jest.fn(),
    settleDurableRuntimeItem: jest.fn(), notifyPvdAdminSubscribers: jest.fn(async () => {}),
    recordBotEventLogSafe: jest.fn(async () => {}), getPartitionId: async () => 's',
    getDurableRuntimeJob: jest.fn(), broadcastPvdStart: jest.fn(async () => {}), videoDonationTimers: new Map(),
  };
  const api = load(['finishVideoQueueItem', 'getPvdQueueItemKey', 'popCurrentVideoDonationItem'], bindings);
  return { ...api, ...bindings, item, next, replace: (items) => { queue = items; } };
}

test('missing or stale playback-error IDs cannot refund the next item', async () => {
  const settle = jest.fn();
  const h = harness(settle);
  for (const expectedItemId of ['', 'old']) {
    expect(await h.popCurrentVideoDonationItem('s', { cause: 'error', refundOnError: true, expectedItemId })).toMatchObject({ mismatch: true });
  }
  expect(settle).not.toHaveBeenCalled();
  expect(h.getVideoQueue()).toEqual([h.item, h.next]);
});

test('failed refund leaves the item in place; retry removes only that item even after reordering', async () => {
  let finish;
  const settle = jest.fn().mockRejectedValueOnce(new Error('db')).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const h = harness(settle);
  const args = { cause: 'error', refundOnError: true, expectedItemId: h.item.id };
  await expect(h.popCurrentVideoDonationItem('s', args)).rejects.toThrow('db');
  expect(h.getVideoQueue()).toEqual([h.item, h.next]);
  const retry = h.popCurrentVideoDonationItem('s', args);
  h.replace([h.next, h.item]);
  finish({ applied: true, result: { refundedAmount: 5 } });
  expect(await retry).toMatchObject({ popped: h.item, headChanged: false });
  expect(h.getVideoQueue()).toEqual([h.next]);
  expect(settle).toHaveBeenLastCalledWith({
    sid: 's', id: h.item.id, workerId: 'worker', status: 'error', refund: true,
  }, h.refundBroadcastPoints);
});

test('admin cancellation returns the durable amount once and repeats the receipt without a new credit or log', async () => {
  const result = { status: 'deleted', refundRequested: true, refundedAmount: 5, ordinaryRefunded: 5, bonusRefunded: 0 };
  const settle = jest.fn(async () => ({ applied: true, channelUid: 'canonical-channel', userId: 'canonical-user', result }));
  const h = harness(settle);
  h.getDurableRuntimeJob.mockResolvedValue({ sid: 's', jobType: 'video-donation', status: 'completed', result });
  const cancel = load.route('/api/video-donation/delete-refund', h, 'post');
  const res = { json: (x) => x, status() { return this; } };
  expect(await cancel({ body: { id: h.item.id } }, res)).toEqual({ ok: true, refundedAmount: 5 });
  expect(await cancel({ body: { id: h.item.id } }, res)).toEqual({ ok: true, deduplicated: true, refundedAmount: 5 });
  expect(settle).toHaveBeenCalledTimes(1);
  expect(h.recordBotEventLogSafe).toHaveBeenCalledTimes(1);
  expect(h.recordBotEventLogSafe).toHaveBeenCalledWith('s', expect.objectContaining({ pointDelta: 5, viewerUserId: 'canonical-user' }));
});

test('automatic completion retries a failed settlement without moving to a different item', async () => {
  const item = { id: 'paid', durationSec: 3, cost: 1 };
  const pop = jest.fn().mockRejectedValueOnce(new Error('db')).mockResolvedValueOnce({ headChanged: true });
  const broadcast = jest.fn();
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.useFakeTimers();
  try {
    const { scheduleNextPvdAutoPop } = load(['scheduleNextPvdAutoPop'], {
      getVideoQueue: () => [item], getPvdQueueItemKey: entry => entry.id,
      videoDonationTimers: new Map(), pvdPlaybackState: new Map([['s', {}]]),
      getCurrentPvdElapsedSec: () => 3, popCurrentVideoDonationItem: pop, broadcastPvdStart: broadcast,
    });
    scheduleNextPvdAutoPop('s');
    await jest.advanceTimersByTimeAsync(500);
    await jest.advanceTimersByTimeAsync(4999);
    expect(pop).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(pop).toHaveBeenCalledTimes(2);
    expect(pop).toHaveBeenLastCalledWith('s', { cause: 'auto_timer', expectedItemId: item.id });
    expect(broadcast).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); warning.mockRestore(); }
});

test.each([['video', 2], ['bgm', 3]])('web %s purchase rounds the total once and never re-logs the debit on retry', async (kind, expectedCost) => {
  const settings = { videoDonationAcceptEnabled: true, bgmEnabled: true, bgmAcceptEnabled: true,
    videoDonationPointsPerSecond: 0.75, bgmPointsPerSecond: 1.25 };
  const log = jest.fn();
  let accepted;
  const enqueue = jest.fn(async (input) => {
    if (accepted) return { created: false, job: accepted };
    accepted = input;
    return { created: true, job: input, deduction: { deducted: true, balanceBefore: 5, balanceAfter: 5 - input.pointsCost } };
  });
  const route = load.route('/api/video-donation/request', {
    ...loadSource('server/video-donation-timing.js'), ...loadSource('server/pvd-bgm.js'),
    ...loadSource('server/video-donation-queue.js'), crypto: require('node:crypto'),
    getPartitionId: async () => 's', getBotSettings: async () => settings,
    resolvePvdMedia: async () => ({ provider: 'youtube', mediaId: 'abc', durationSec: 2 }),
    shouldAwaitPvdDurationSync: () => false, resolveStreamerUidForSid: async () => 'channel',
    findBlockedBotUser: () => false, enqueuePaidDurableRuntimeJob: enqueue, recordBotEventLogSafe: log,
    getVideoDonationReceiptQueueSize: async () => 1, runDurableRuntimeWorker: async () => {},
  }, 'post');
  const req = { body: { kind, videoUrl: 'abc', requesterUserId: 'viewer' }, get: () => 'key' };
  const res = { json: (x) => x, status() { return this; } };
  const first = await route(req, res);
  expect(first).toMatchObject({ ok: true, item: { kind, cost: expectedCost }, deduplicated: false });
  expect(await route(req, res)).toMatchObject({ ok: true, item: first.item, deduplicated: true });
  expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ jobType: 'video-donation', pointsCost: expectedCost,
    idempotencyKey: kind === 'bgm' ? 'bgm:key' : 'key' }));
  expect(log).toHaveBeenCalledTimes(1);
});
