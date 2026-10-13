import test from 'node:test';
import assert from 'node:assert/strict';
import { createChzzkVideoRuntime } from '../server/chzzk-video-runtime.js';
import { setChzzkPlaybackBlocked } from '../server/pvd-chzzk-pause.js';
import { insertPvdRequest, updateBgmPlaybackAvailability } from '../server/pvd-bgm.js';
import { createChzzkVideoStore } from '../server/chzzk-video-store.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
function harness(pauseEnabled, queueEnabled, hooks = {}) {
  let now = 1000;
  let connector;
  const scheduled = new Map();
  let timerId = 0;
  const paused = [], imports = [], removed = [], notifications = [], connections = [], closed = [];
  const runtime = createChzzkVideoRuntime({
    now: () => now,
    timers: { setTimeout(fn, delay) { scheduled.set(++timerId, { fn, at: now + delay }); return timerId; }, clearTimeout(id) { scheduled.delete(id); } },
    connectorFactory(options) {
      connector = options;
      connections.push(options);
      return {
        close() { closed.push(options); },
        async notifyPlayback(...args) {
          notifications.push(args);
          return hooks.notifyPlayback ? hooks.notifyPlayback(...args) : true;
        },
      };
    },
    enqueue: async (...args) => { imports.push(args); return hooks.enqueue?.(...args); },
    remove: async (...args) => { removed.push(args); return hooks.remove?.(...args); },
    setPaused: async (sid, value) => paused.push(value), resolveDuration: hooks.resolveDuration || (async () => 90),
  });
  const settings = { videoDonationChzzkPauseEnabled: pauseEnabled, videoDonationChzzkQueueEnabled: queueEnabled, videoDonationChzzkOverlaySecret: 'https://chzzk.naver.com/video-donation/video@abcdefghijklmnop' };
  runtime.configure('sid', settings);
  return {
    runtime, settings, paused, imports, removed, notifications, connections, closed,
    get connector() { return connector; }, get timerCount() { return scheduled.size; },
    event(donationId = 'd1', extra = {}) { connector?.onDonation({ donationId, provider: 'youtube', mediaId: 'abcdefghijk', url: 'https://youtu.be/abcdefghijk', startSec: 5, durationSec: 10, delayMs: 3000, ...extra }); },
    async advance(ms) {
      const end = now + ms;
      while (true) {
        const due = [...scheduled].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        scheduled.delete(due[0]); now = due[1].at; due[1].fn(); await flush();
      }
      now = end;
    },
  };
}

for (const pause of [false, true]) for (const queue of [false, true]) {
  test(`independent toggles pause=${pause} queue=${queue}; unified queue never pauses itself`, async () => {
    const h = harness(pause, queue);
    h.event(); await flush();
    assert.equal(h.imports.length, queue ? 1 : 0);
    assert.equal(h.runtime.paused('sid'), pause && !queue);
    h.runtime.closeAll();
  });
}

test('native donation durations accumulate; skip removes only that donation', async () => {
  const h = harness(true, false);
  h.event('d1'); h.event('d2'); await flush();
  await h.advance(5000);
  h.connector.onControl({ donationId: 'd1', stopVideo: true });
  await h.advance(12999);
  assert.equal(h.runtime.paused('sid'), true);
  await h.advance(1);
  assert.equal(h.runtime.paused('sid'), false);
  assert.deepEqual(h.paused, [true, false]);
});

test('duplicate deliveries are ignored and switching off releases the interruption', async () => {
  const h = harness(true, false);
  h.event(); h.event(); await flush();
  await h.advance(13000);
  assert.equal(h.runtime.paused('sid'), false);
  h.event('d2'); await flush();
  h.runtime.configure('sid', { ...h.settings, videoDonationChzzkPauseEnabled: false });
  assert.equal(h.runtime.paused('sid'), false);
  assert.deepEqual(h.paused, [true, false, true, false]);
});

test('provider alert pause holds future alerts but does not release an active interruption', async () => {
  const h = harness(true, false);
  h.event(); h.event('d2'); await flush(); await h.advance(4000);
  h.connector.onSettings({ alertPauseActive: true });
  assert.equal(h.runtime.paused('sid'), true);
  await h.advance(30000);
  assert.equal(h.runtime.paused('sid'), false);
  h.connector.onSettings({ alertPauseActive: false });
  assert.equal(h.runtime.paused('sid'), true);
  await h.advance(13000);
  assert.equal(h.runtime.paused('sid'), false);
});

test('queue imports are idempotent and upstream skip propagates', async () => {
  const h = harness(true, true);
  h.event(); h.event(); await flush();
  assert.equal(h.imports.length, 1);
  assert.match(h.imports[0][2], /^chzzk:[a-f0-9]{16}:d1$/);
  h.connector.onControl({ donationId: 'd1', stopVideo: true }); await flush();
  assert.deepEqual(h.removed, [['sid', 'd1']]);
  assert.deepEqual(h.paused, []);
});

for (const manualPause of [false, true]) {
  test(`resume retains position and explicit pause=${manualPause}`, () => {
    const item = { startSec: 10 };
    const state = { baseStartMs: 1000, paused: manualPause, pausedAtSec: manualPause ? 13 : null };
    setChzzkPlaybackBlocked(state, item, true, 4000);
    assert.equal(state.pausedAtSec, 13);
    setChzzkPlaybackBlocked(state, item, false, 14000);
    assert.equal(state.paused, manualPause);
    assert.equal(state.baseStartMs, 11000);
  });
}

test('BGM disconnect/reconnect during an interruption never clears external pause', () => {
  const item = { id: 'bgm', kind: 'bgm', startSec: 10 };
  const state = { baseStartMs: 1000, paused: false, bgmBlocked: false };
  setChzzkPlaybackBlocked(state, item, true, 4000);
  updateBgmPlaybackAvailability(state, item, false, 5000);
  updateBgmPlaybackAvailability(state, item, true, 6000);
  assert.equal(state.paused, true);
  assert.equal(state.chzzkResumePaused, false);
  setChzzkPlaybackBlocked(state, item, false, 10000);
  assert.equal(state.paused, false);
  assert.equal(state.baseStartMs, 7000);
});

test('video interruption of an externally paused BGM preserves manual intent, not temporary pause', () => {
  const item = { id: 'bgm', kind: 'bgm', startSec: 0 };
  const state = { baseStartMs: 1000, paused: false };
  setChzzkPlaybackBlocked(state, item, true, 4000);
  insertPvdRequest([item], { id: 'video' }, state, 3);
  assert.deepEqual(item.resumePlayback, { atSec: 3, paused: false });
});

test('job cancellation and heartbeat are scoped to source, channel, active state and lease owner', async () => {
  const queries = [];
  const store = createChzzkVideoStore({ withPgClient: (fn) => fn({ query: async (sql, args) => { queries.push([sql, args]); return { rows: [{ id: 'id' }] }; } }) });
  assert.deepEqual(await store.cancel('sid', 'donation'), ['id']);
  assert.match(queries[0][0], /sid = \$1/);
  assert.match(queries[0][0], /source' = 'chzzk-donation'/);
  assert.deepEqual(queries[0][1], ['sid', 'donation']);
  await store.renew(['id'], 'worker');
  assert.match(queries[1][0], /locked_by = \$2 and status = 'processing'/);
  assert.deepEqual(queries[1][1], [['id'], 'worker']);
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const playbackItem = (id = 'd1') => ({ id: `item-${id}`, source: 'chzzk-donation', chzzkDonationId: id });

test('same-secret queue-enabled toggle preserves pending resolution, order and deduplication', async t => {
  const duration = deferred();
  const h = harness(false, true, { resolveDuration: () => duration.promise });
  t.after(() => h.runtime.closeAll());
  h.event('d1', { durationSec: null });
  h.event('d2');
  h.runtime.configure('sid', { ...h.settings, videoDonationChzzkPauseEnabled: true });
  h.event('d1');
  duration.resolve(12);
  await flush();
  assert.deepEqual(h.imports.map(([, event]) => event.donationId), ['d1', 'd2']);
  assert.equal(h.connections.length, 1);
  assert.equal(h.closed.length, 0);
  assert.equal(h.runtime.paused('sid'), false);
});

test('same-secret queue toggle retains failed insert retry without reconnecting', async t => {
  let fail = true;
  const h = harness(true, true, { enqueue: async () => { if (fail) throw new Error('offline'); } });
  t.after(() => h.runtime.closeAll());
  h.event();
  await flush();
  h.runtime.configure('sid', { ...h.settings, videoDonationChzzkPauseEnabled: false });
  fail = false;
  await h.advance(5000);
  assert.equal(h.imports.length, 2);
  assert.equal(h.imports[0][2], h.imports[1][2]);
  assert.equal(h.connections.length, 1);
  assert.equal(h.timerCount, 0);
});

test('unchanged native config does not restart an active pause timer', async t => {
  const h = harness(true, false);
  t.after(() => h.runtime.closeAll());
  h.event();
  await h.advance(5000);
  h.runtime.configure('sid', { ...h.settings, unrelated: true });
  await h.advance(8000);
  assert.equal(h.runtime.paused('sid'), false);
  assert.equal(h.connections.length, 1);
});

test('cancelled inserts remain scheduled for removal through more than eight DB failures', async t => {
  const insert = deferred();
  const jobs = new Set();
  let failures = 10;
  const h = harness(false, true, {
    enqueue: async () => { await insert.promise; jobs.add('d1'); },
    remove: async () => { if (failures-- > 0) throw new Error('offline'); jobs.delete('d1'); },
  });
  t.after(() => h.runtime.closeAll());
  h.event();
  h.connector.onControl({ donationId: 'd1', stopVideo: true });
  await flush();
  insert.resolve();
  await flush();
  assert.equal(jobs.has('d1'), true);
  await h.advance(300000);
  assert.equal(h.removed.length, 11);
  assert.equal(jobs.size, 0);
  assert.equal(h.imports.length, 1);
  assert.equal(h.timerCount, 0);
});

test('a cancellation completing before insert is confirmed again after insert', async t => {
  const insert = deferred();
  const deletion = deferred();
  const jobs = new Set();
  let deletes = 0;
  const h = harness(false, true, {
    enqueue: async () => { await insert.promise; jobs.add('d1'); },
    remove: async () => { jobs.delete('d1'); if (++deletes === 1) await deletion.promise; },
  });
  t.after(() => h.runtime.closeAll());
  h.event();
  h.connector.onControl({ donationId: 'd1', stopVideo: true });
  insert.resolve();
  await flush();
  deletion.resolve();
  await flush();
  assert.equal(jobs.has('d1'), true);
  await h.advance(5000);
  assert.equal(jobs.size, 0);
  assert.equal(deletes, 2);
});

test('cancel during an ambiguous committed insert failure still schedules removal', async t => {
  const insert = deferred();
  const jobs = new Set();
  const h = harness(false, true, {
    enqueue: async () => { await insert.promise; jobs.add('d1'); throw new Error('response lost'); },
    remove: async () => { jobs.delete('d1'); },
  });
  t.after(() => h.runtime.closeAll());
  h.event();
  h.connector.onControl({ donationId: 'd1', stopVideo: true });
  await flush();
  insert.resolve();
  await flush();
  assert.equal(jobs.size, 0);
  assert.equal(h.removed.length, 2);
  assert.equal(h.imports.length, 1);
});

test('cancel before pending duration resolution prevents insertion and retries removal separately', async t => {
  const duration = deferred();
  let failures = 1;
  const h = harness(false, true, {
    resolveDuration: () => duration.promise,
    remove: async () => { if (failures-- > 0) throw new Error('offline'); },
  });
  t.after(() => h.runtime.closeAll());
  h.event('d1', { durationSec: null });
  h.event('d2');
  h.connector.onControl({ donationId: 'd1', stopVideo: true });
  duration.resolve(10);
  await flush();
  await h.advance(5000);
  assert.deepEqual(h.imports.map(([, event]) => event.donationId), ['d2']);
  assert.equal(h.removed.length, 2);
});

test('end supersedes a failed play retry and itself retries without stale play', async t => {
  let endFailures = 1;
  const h = harness(false, true, { notifyPlayback: async (_id, action) => {
    if (action === 'play' || endFailures-- > 0) throw new Error('offline');
    return true;
  } });
  t.after(() => h.runtime.closeAll());
  await h.runtime.notifyPlayback('sid', playbackItem(), 'play');
  await h.runtime.notifyPlayback('sid', playbackItem(), 'end');
  await h.runtime.notifyPlayback('sid', { ...playbackItem(), id: 'different-item' }, 'play');
  await h.advance(5000);
  await h.runtime.notifyPlayback('sid', playbackItem(), 'end');
  assert.deepEqual(h.notifications, [['d1', 'play'], ['d1', 'end'], ['d1', 'end']]);
  assert.equal(h.timerCount, 0);
  assert.equal(h.runtime.status('sid').error, null);
});

for (const rejected of [false, true]) {
  test(`end waits for an in-flight play before dispatch (play rejected=${rejected})`, async t => {
    const play = deferred();
    const h = harness(false, true, { notifyPlayback: (_id, action) => action === 'play' ? play.promise : true });
    t.after(() => h.runtime.closeAll());
    const pending = h.runtime.notifyPlayback('sid', playbackItem(), 'play');
    await h.runtime.notifyPlayback('sid', playbackItem(), 'end');
    assert.deepEqual(h.notifications, [['d1', 'play']]);
    if (rejected) play.reject(new Error('offline')); else play.resolve(true);
    await pending;
    await h.advance(60000);
    await h.runtime.notifyPlayback('sid', playbackItem(), 'play');
    assert.deepEqual(h.notifications, [['d1', 'play'], ['d1', 'end']]);
  });
}

test('notification retries survive same-secret toggles and stop after eight failures', async t => {
  const h = harness(false, true, { notifyPlayback: async () => { throw new Error('offline'); } });
  t.after(() => h.runtime.closeAll());
  await h.runtime.notifyPlayback('sid', playbackItem(), 'end');
  h.runtime.configure('sid', { ...h.settings, videoDonationChzzkPauseEnabled: true });
  await h.advance(300000);
  assert.equal(h.notifications.length, 8);
  assert.equal(h.connections.length, 1);
  assert.equal(h.timerCount, 0);
  assert.match(h.runtime.status('sid').error, /한도/);
});

test('retry queues cap pending work at 200 with one timer per queue', async t => {
  const h = harness(false, true, {
    remove: async () => { throw new Error('offline'); },
    notifyPlayback: async () => { throw new Error('offline'); },
  });
  t.after(() => h.runtime.closeAll());
  for (let i = 0; i < 210; i++) h.connector.onControl({ donationId: `d${i}`, stopVideo: true });
  await flush();
  assert.equal(new Set(h.removed.map(([, id]) => id)).size, 200);
  for (let i = 0; i < 210; i++) await h.runtime.notifyPlayback('sid', playbackItem(`d${i}`), 'end');
  assert.match(h.runtime.status('sid').error, /한도/);
  assert.equal(h.timerCount, 2);
  await h.advance(5000);
  assert.equal(new Set(h.removed.map(([, id]) => id)).size, 200);
  assert.equal(h.timerCount, 2);
});

test('close clears retries and late failed work cannot resurrect timers or notifications', async () => {
  const deletion = deferred();
  const play = deferred();
  const insert = deferred();
  const h = harness(false, true, {
    remove: () => deletion.promise, notifyPlayback: () => play.promise, enqueue: () => insert.promise,
  });
  h.event('incoming');
  h.connector.onControl({ donationId: 'd1', stopVideo: true });
  const pending = h.runtime.notifyPlayback('sid', playbackItem(), 'play');
  await h.runtime.notifyPlayback('sid', playbackItem(), 'end');
  h.runtime.closeAll();
  deletion.reject(new Error('offline'));
  play.reject(new Error('offline'));
  insert.reject(new Error('offline'));
  await pending;
  await flush();
  await h.advance(300000);
  assert.equal(h.timerCount, 0);
  assert.deepEqual(h.notifications, [['d1', 'play']]);
  assert.equal(h.removed.length, 1);
  assert.equal(h.imports.length, 1);
  assert.equal(h.runtime.status('sid').status, 'disabled');
});
