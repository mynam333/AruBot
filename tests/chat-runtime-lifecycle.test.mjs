import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createChatRuntimeLifecycle, protectRuntimeSocket } from '../server/chat-runtime-lifecycle.mjs';

function fixture(runtimeId, active = true) {
  const client = { runtimeId, active, draining: false, authorize: value => value === 'Bearer test',
    canRun() { return this.active && !this.draining; }, drain() { this.draining = true; },
    resume() { this.draining = false; }, async refresh() {}, async request() {} };
  const maps = { videoDonationQueues: new Map(), playback: new Map(), dedupe: new Set() };
  let pending = 0;
  let resumed = 0;
  const transfers = [];
  const lifecycle = createChatRuntimeLifecycle({ client, getPending: () => pending, getMaps: () => maps,
    getWorkerId: () => runtimeId + ':runtime', transferJobs: async input => transfers.push(input),
    onResume: () => { resumed += 1; },
  });
  async function call(action, body, auth = 'Bearer test', address = '127.0.0.1') {
    const response = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
    await lifecycle.handle({ path: '/api/runtime/' + action, method: action === 'checkpoint' ? 'GET' : 'POST', body,
      socket: { remoteAddress: address }, headers: { authorization: auth } }, response);
    return response;
  }
  return { client, maps, lifecycle, call, transfers, setPending: value => { pending = value; }, resumed: () => resumed };
}

test('drain waits for commands and import atomically preserves queues, timestamps and duplicate guards', async () => {
  const old = fixture('old');
  const next = fixture('new', false);
  old.maps.videoDonationQueues.set('user:one', [{ runtimeJobId: 'job-1', resumePlayback: { atSec: 83 } }]);
  old.maps.playback.set('user:one', { baseStartMs: 1000, playbackEpoch: 'unchanged', paused: false });
  old.maps.dedupe.add('already-sent');
  assert.equal((await old.call('checkpoint')).statusCode, 409);
  old.setPending(1);
  const draining = old.call('drain', { timeoutMs: 1000 });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(old.client.canRun(), false);
  assert.equal(old.lifecycle.drained, false);
  old.setPending(0);
  assert.equal((await draining).statusCode, 200);
  const snapshot = (await old.call('checkpoint')).body;
  assert.equal((await next.call('import', snapshot)).statusCode, 200);
  assert.deepEqual(next.maps, old.maps);
  assert.deepEqual(next.transfers, [{ fromWorkerId: 'old:runtime', toWorkerId: 'new:runtime', jobIds: ['job-1'] }]);
  assert.equal((await next.call('resume')).statusCode, 409);
  next.client.active = true;
  assert.equal((await next.call('resume')).statusCode, 200);
  assert.equal(next.resumed(), 1);
});

test('bad credentials and public connections cannot capture sensitive runtime state', async () => {
  const f = fixture('one');
  assert.equal((await f.call('checkpoint', null, 'bad')).statusCode, 404);
  assert.equal((await f.call('checkpoint', null, 'Bearer test', '203.0.113.1')).statusCode, 404);
});

test('a failed snapshot import keeps the old state and does not transfer job ownership', async () => {
  const f = fixture('new', false);
  f.maps.playback.set('existing', { atSec: 40 });
  const result = await f.call('import', { runtimeId: 'old', workerId: 'old:runtime', state: { version: 999 } });
  assert.equal(result.statusCode, 409);
  assert.equal(f.transfers.length, 0);
  assert.deepEqual(f.maps.playback.get('existing'), { atSec: 40 });
});

test('socket message tasks are included in drain and new messages are fenced', async () => {
  const socket = new EventEmitter();
  let active = true;
  let count = 0;
  let closed = 0;
  let resolve;
  const task = new Promise(r => { resolve = r; });
  socket.close = () => { closed += 1; };
  protectRuntimeSocket(socket, { canRun: () => active, started: () => { count += 1; }, finished: () => { count -= 1; } });
  socket.on('message', () => task);
  socket.emit('message', 'first');
  assert.equal(count, 1);
  active = false;
  socket.emit('message', 'second');
  assert.equal(closed, 1);
  assert.equal(count, 1);
  resolve();
  await new Promise(r => setImmediate(r));
  assert.equal(count, 0);
});
