import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  createLocalAvatarRelay,
  normalizeChzzkAvatarEvent,
} from '../server/local-avatar-relay.js';

function bus() {
  const clients = new Set();
  return {
    createClient() {
      const client = new EventEmitter();
      client.connect = async () => clients.add(client);
      client.query = async () => {};
      client.end = async () => clients.delete(client);
      return client;
    },
    async publish(channel, payload) {
      for (const client of clients)
        client.emit('notification', { channel, payload });
    },
  };
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const socket = () => ({
  readyState: 1,
  bufferedAmount: 0,
  received: [],
  send(message) {
    this.received.push(JSON.parse(message));
  },
  close() {
    this.readyState = 3;
  },
});

test('normalization takes stable user identity and trusted platform role', () => {
  const event = normalizeChzzkAvatarEvent(
    { channelId: 'owner' },
    {
      type: 'chat',
      user: '<b>name</b>',
      message: '!jump',
      raw: {
        senderChannelId: 'user',
        messageId: 'one',
        profile: { userRoleCode: 'streaming_channel_manager' },
      },
    },
    123,
  );
  assert.equal(event.role, 'moderator');
  assert.equal(event.userId, 'user');
  assert.equal(event.at, 123);
  assert.equal(event.test, undefined);
  assert.equal(
    event.id,
    normalizeChzzkAvatarEvent(
      {},
      { type: 'chat', raw: { senderChannelId: 'user', messageId: 'one' } },
    ).id,
  );
  assert.equal(normalizeChzzkAvatarEvent({}, { type: 'chat', raw: {} }), null);
});
test('events cross API instances only for subscribed owner and are never echoed twice', async (t) => {
  const transport = bus(),
    a = createLocalAvatarRelay(transport),
    b = createLocalAvatarRelay(transport);
  t.after(async () => {
    await a.stop();
    await b.stop();
  });
  a.start();
  b.start();
  await wait(5);
  const own = socket(),
    other = socket();
  b.subscribe('owner-a', own, true);
  b.subscribe('owner-b', other, true);
  await wait(5);
  a.emit('owner-a', { id: 'one', at: Date.now() });
  await wait(100);
  assert.equal(
    own.received.filter((v) => v.type === 'avatars.event').length,
    1,
  );
  assert.equal(
    other.received.filter((v) => v.type === 'avatars.event').length,
    0,
  );
  b.emit('owner-a', { id: 'two', at: Date.now() });
  await wait(100);
  assert.equal(
    own.received.filter((v) => v.type === 'avatars.event').length,
    2,
  );
  b.remove(own);
  a.emit('owner-a', { id: 'three', at: Date.now() });
  await wait(100);
  assert.equal(
    own.received.filter((v) => v.type === 'avatars.event').length,
    2,
  );
});
test('slow readers are closed and missing DB configuration is recoverable', async (t) => {
  const transport = bus(),
    relay = createLocalAvatarRelay(transport);
  t.after(() => relay.stop());
  relay.start();
  await wait(5);
  const ws = socket();
  relay.subscribe('a', ws, true);
  ws.bufferedAmount = 300000;
  relay.emit('a', { id: 'one', at: Date.now() });
  assert.equal(ws.readyState, 3);
  let errors = 0;
  const broken = createLocalAvatarRelay({
    createClient() {
      throw new Error('no DB');
    },
    publish() {},
    onError() {
      errors++;
    },
  });
  broken.start();
  await wait(5);
  await broken.stop();
  assert.equal(errors, 1);
});

const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const avatarEvent = (id, at, extra = {}) => ({
  id, at, kind: 'chat', userId: `user-${id}`, name: 'Viewer',
  text: 'hello', role: 'everyone', amount: 0, ...extra,
});
const eventsOf = (ws) => ws.received.filter((message) => message.type === 'avatars.event').map((message) => message.event);
const lastStatus = (ws) => ws.received.findLast((message) => message.type === 'avatars.status');

async function harness(t, override = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let time = 100000;
  const clients = [], payloads = [], errors = [];
  const transport = {
    now: () => time,
    createClient() {
      const client = new EventEmitter();
      client.connect = async () => {};
      client.query = async () => {};
      client.end = async () => {};
      clients.push(client);
      return client;
    },
    async publish(channel, payload) {
      payloads.push(payload);
      if (override.publish) await override.publish(channel, payload);
    },
    onError: (error) => errors.push(error),
  };
  const relay = createLocalAvatarRelay(transport);
  t.after(() => relay.stop());
  relay.start();
  await settle();
  const receive = (data, client = clients.at(-1)) => client.emit('notification', {
    channel: 'arubot_local_avatars_v1', payload: JSON.stringify({ instance: 'peer', ...data }),
  });
  return {
    relay, clients, payloads, errors, receive,
    now: () => time,
    async advance(ms) { time += ms; t.mock.timers.tick(ms); await settle(); },
    packets: () => payloads.map((payload) => JSON.parse(payload)).filter((data) => data.kind === 'events'),
  };
}

test('normalization preserves its wire shape and legitimate combining marks using shared text safety', () => {
  const event = normalizeChzzkAvatarEvent({}, {
    type: 'chat', message: '\u0915\u093f cafe\u0301', user: '\u0915\u093f',
    raw: { senderChannelId: 'viewer', messageId: 'unicode' },
  }, 123);
  assert.deepEqual(Object.keys(event).sort(), ['id', 'kind', 'userId', 'name', 'text', 'role', 'amount', 'at'].sort());
  assert.equal(event.name, '\u0915\u093f');
  assert.equal(event.text, '\u0915\u093f caf\u00e9');
  assert.equal(normalizeChzzkAvatarEvent({}, {
    type: 'chat', message: '!le\u0301\u0301\u0301\u0301ave', raw: { senderChannelId: 'viewer' },
  }), null);
  assert.equal(normalizeChzzkAvatarEvent({}, {
    type: 'chat', message: 'x'.repeat(8193), raw: { senderChannelId: 'viewer' },
  }), null);
});

test('two-owner synthetic burst is bounded, round robin, and weighted without starving chat', async (t) => {
  const h = await harness(t);
  h.receive({ kind: 'interest', owners: ['a', 'b'] });
  for (const owner of ['a', 'b']) {
    for (let i = 0; i < 500; i++) h.relay.emit(owner, avatarEvent(`${owner}-chat-${i}`, h.now()));
    for (let i = 0; i < 24; i++) {
      h.relay.emit(owner, avatarEvent(`${owner}-command-${i}`, h.now(), { text: '!jump', userId: 'same' }));
      h.relay.emit(owner, avatarEvent(`${owner}-paid-${i}`, h.now(), { kind: i % 2 ? 'donation' : 'subscription', userId: 'same' }));
      h.relay.emit(owner, avatarEvent(`${owner}-control-${i}`, h.now(), { text: i % 2 ? '!leave' : '!\uD1F4\uC7A5', userId: 'same' }));
    }
  }
  assert.equal(h.relay.getMetrics().remoteQueue.depth, 128);
  assert.equal(h.relay.getMetrics().remoteQueue.owners, 2);
  assert.equal(h.relay.getMetrics().coalesced, 0);
  assert.equal(h.relay.getMetrics().drops.overflow, 1016);
  for (let i = 0; i < 8; i++) await h.advance(50);
  const sent = h.packets().flatMap((data) => data.events);
  assert.equal(sent.length, 32);
  assert.deepEqual(sent.map((item) => item.owner), Array.from({ length: 32 }, (_, i) => i % 2 ? 'b' : 'a'));
  for (const owner of ['a', 'b']) {
    const firstCycle = sent.filter((item) => item.owner === owner).slice(0, 15);
    assert.deepEqual(['control', 'paid', 'command', 'chat'].map((kind) => firstCycle.filter((item) => item.event.id.includes(`-${kind}-`)).length), [8, 4, 2, 1]);
  }
  for (const payload of h.payloads) assert.ok(Buffer.byteLength(payload) < 8000);
  assert.equal(h.relay.getMetrics().maxQueueAgeMs, 400);
});

test('ordinary chat alone coalesces by owner/user and snapshots do not retain caller objects', async (t) => {
  const h = await harness(t);
  const a = socket(), b = socket();
  h.relay.subscribe('a', a, true);
  h.relay.subscribe('b', b, true);
  const first = avatarEvent('old', h.now(), { userId: 'same' });
  h.relay.emit('a', first);
  first.text = 'mutated';
  h.relay.emit('a', avatarEvent('new', h.now(), { userId: 'same', text: 'latest' }));
  h.relay.emit('b', avatarEvent('other-owner', h.now(), { userId: 'same' }));
  for (const id of ['cmd1', 'cmd2']) h.relay.emit('a', avatarEvent(id, h.now(), { userId: 'same', text: '!jump' }));
  for (const id of ['paid1', 'paid2']) h.relay.emit('a', avatarEvent(id, h.now(), { userId: 'same', kind: 'donation' }));
  const immutable = avatarEvent('immutable', h.now());
  h.relay.emit('a', immutable);
  immutable.text = 'mutated';
  assert.equal(h.relay.getMetrics().coalesced, 1);
  assert.equal(h.relay.getMetrics().localQueue.depth, 7);
  await h.advance(50);
  assert.deepEqual(eventsOf(a).map((event) => event.id).sort(), ['cmd1', 'cmd2', 'immutable', 'new', 'paid1', 'paid2']);
  assert.equal(eventsOf(a).find((event) => event.id === 'new').text, 'latest');
  assert.equal(eventsOf(a).find((event) => event.id === 'immutable').text, 'hello');
  assert.deepEqual(eventsOf(b).map((event) => event.id), ['other-owner']);
});

test('direct delivery has its own bounded fair budget even without the database', async (t) => {
  const h = await harness(t);
  const a = socket(), b = socket();
  h.relay.subscribe('a', a, true);
  h.relay.subscribe('b', b, true);
  h.clients[0].emit('error', new Error('disconnect'));
  for (const owner of ['a', 'b']) for (let i = 0; i < 500; i++) h.relay.emit(owner, avatarEvent(`${owner}-${i}`, h.now()));
  assert.equal(h.relay.getMetrics().localQueue.depth, 48);
  assert.equal(h.relay.getMetrics().drops.overflow, 952);
  assert.equal(eventsOf(a).length, 0);
  await h.advance(50);
  assert.equal(eventsOf(a).length, 16);
  assert.equal(eventsOf(b).length, 16);
  assert.equal(h.relay.getMetrics().ready, false);
  assert.equal(h.relay.getMetrics().localReady, true);
});

test('serialized UTF-8 envelope including escaping stays below PostgreSQL limit', async (t) => {
  const h = await harness(t);
  const owner = '\uD83D\uDE00'.repeat(60);
  h.receive({ kind: 'interest', owners: [owner] });
  for (let i = 0; i < 8; i++) h.relay.emit(owner, avatarEvent(`id-${i}`, h.now(), {
    name: '\u0001'.repeat(32), userId: `${i}${'\u754c'.repeat(120)}`, text: '\u0001'.repeat(300),
  }));
  for (let i = 0; i < 8; i++) await h.advance(50);
  assert.equal(h.packets().flatMap((data) => data.events).length, 8);
  assert.ok(h.packets().some((data) => data.events.length < 4));
  for (const payload of h.payloads) assert.ok(Buffer.byteLength(payload) < 8000);
});

test('publish failure reports health separately from LISTEN readiness and never retries a batch', async (t) => {
  let fail = true;
  const h = await harness(t, { publish(channel, payload) {
    if (fail && JSON.parse(payload).kind === 'events') throw new Error('publish failed');
  } });
  const ws = socket();
  h.relay.subscribe('a', ws, true);
  await settle();
  h.receive({ kind: 'interest', owners: ['a'] });
  h.relay.emit('a', avatarEvent('lost', h.now()));
  await h.advance(50);
  assert.equal(h.relay.getMetrics().ready, true);
  assert.equal(h.relay.getMetrics().deliveryReady, false);
  assert.equal(h.relay.getMetrics().drops.publishFailed, 1);
  assert.equal(h.errors.length, 1);
  assert.equal(eventsOf(ws).length, 1);
  assert.equal(lastStatus(ws).ready, true);
  assert.equal(lastStatus(ws).deliveryReady, false);
  fail = false;
  h.relay.emit('a', avatarEvent('next', h.now()));
  await h.advance(50);
  assert.equal(h.relay.getMetrics().deliveryReady, true);
  assert.deepEqual(h.packets().flatMap((data) => data.events).map((item) => item.event.id), ['lost', 'next']);
});

test('a stalled publish cannot block local delivery or retain waiting events past five seconds', async (t) => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const h = await harness(t, { publish(channel, payload) {
    if (JSON.parse(payload).kind === 'events') return blocked;
  } });
  const ws = socket();
  h.relay.subscribe('a', ws, true);
  h.receive({ kind: 'interest', owners: ['a'] });
  for (let i = 0; i < 24; i++) h.relay.emit('a', avatarEvent(`first-${i}`, h.now()));
  await h.advance(50);
  assert.equal(h.packets().length, 1);
  assert.equal(eventsOf(ws).length, 24);
  h.relay.emit('a', avatarEvent('local-still-works', h.now()));
  await h.advance(50);
  assert.equal(eventsOf(ws).length, 25);
  await h.advance(4950);
  assert.equal(h.relay.getMetrics().remoteQueue.depth, 0);
  assert.equal(h.relay.getMetrics().drops.expired, 21);
  assert.equal(h.relay.getMetrics().ready, true);
  assert.equal(h.relay.getMetrics().deliveryReady, false);
  assert.equal(h.relay.getMetrics().publishInFlightAgeMs, 5000);
  release();
  await settle();
  await h.advance(50);
  assert.equal(h.packets().length, 1);
});

test('receiver rejects stale/future/malformed data and bounds inbound notification size', async (t) => {
  const h = await harness(t);
  const ws = socket();
  h.relay.subscribe('a', ws, true);
  h.receive({ kind: 'events', events: [
    { owner: 'a', event: avatarEvent('expired', h.now() - 5000) },
    { owner: 'a', event: avatarEvent('future', h.now() + 5001) },
    { owner: 'a', event: { id: 'bad', at: 'not-a-time' } },
    { owner: 'a', event: { id: 'legacy', at: h.now() } },
  ] });
  h.clients[0].emit('notification', { payload: 'x'.repeat(8000) });
  h.clients[0].emit('notification', { payload: '{bad-json' });
  h.relay.emit('a', avatarEvent('too-long', h.now(), { text: 'x'.repeat(301) }));
  await h.advance(50);
  assert.deepEqual(eventsOf(ws), [{ id: 'legacy', at: 100000 }]);
  assert.equal(h.relay.getMetrics().drops.expired, 1);
  assert.equal(h.relay.getMetrics().drops.invalid, 4);
  assert.equal(h.relay.getMetrics().drops.oversize, 1);
});

test('queued events expire at the five-second boundary on both paths', async (t) => {
  const h = await harness(t);
  const ws = socket();
  h.relay.subscribe('a', ws, true);
  h.receive({ kind: 'interest', owners: ['a'] });
  h.relay.emit('a', avatarEvent('deadline', h.now() - 4950));
  await h.advance(50);
  assert.equal(eventsOf(ws).length, 0);
  assert.equal(h.packets().length, 0);
  assert.equal(h.relay.getMetrics().drops.expired, 2);
  assert.equal(h.relay.getMetrics().maxQueueAgeMs, 5000);
});

test('command metadata is optional, bounded, owner-scoped, and distinguishes unknown from empty', async (t) => {
  const h = await harness(t);
  const a = socket(), b = socket();
  h.relay.subscribe('a', a, true);
  h.relay.subscribe('b', b, true);
  assert.equal(lastStatus(a).subscribed, true);
  assert.equal(lastStatus(a).commandsKnown, false);
  assert.deepEqual(lastStatus(a).commandAliases, []);
  assert.equal(h.relay.setCommands('a', ['!JUMP', '!jump', 'wave']), true);
  assert.equal(lastStatus(a).commandsKnown, true);
  assert.deepEqual(lastStatus(a).commandAliases, ['!jump', 'wave']);
  assert.equal(lastStatus(b).commandsKnown, false);
  for (const aliases of [['bad alias'], ['x'.repeat(65)], new Array(129).fill('!a'), ['x\u0301\u0301\u0301\u0301']]) assert.equal(h.relay.setCommands('a', aliases), false);
  assert.deepEqual(lastStatus(a).commandAliases, ['!jump', 'wave']);
  h.relay.emit('a', avatarEvent('command1', h.now(), { userId: 'same', text: 'wave' }));
  h.relay.emit('a', avatarEvent('command2', h.now(), { userId: 'same', text: 'wave' }));
  assert.equal(h.relay.getMetrics().coalesced, 0);
  await h.advance(50);
  assert.equal(eventsOf(a).length, 2);
  assert.equal(h.relay.setCommands('a', []), true);
  assert.equal(lastStatus(a).commandsKnown, true);
  assert.deepEqual(lastStatus(a).commandAliases, []);
  assert.equal(h.relay.setCommands('a', null), true);
  assert.equal(lastStatus(a).commandsKnown, false);
  h.relay.setCommands('a', ['!jump']);
  h.clients[0].emit('end');
  assert.equal(lastStatus(a).commandsKnown, false);
  assert.deepEqual(lastStatus(a).commandAliases, []);
  assert.equal(lastStatus(a).ready, false);
  h.relay.subscribe('b', b, false);
  assert.equal(lastStatus(b).subscribed, false);
});

test('owner, subscription, metadata and interest-instance bounds are enforced', async (t) => {
  const h = await harness(t);
  for (let i = 0; i < 200; i++) {
    assert.equal(h.relay.subscribe(`owner-${i}`, socket(), true), true);
    assert.equal(h.relay.setCommands(`owner-${i}`, []), true);
  }
  assert.equal(h.relay.subscribe('extra', socket(), true), false);
  assert.equal(h.relay.setCommands('extra', []), false);
  for (let i = 0; i < 3; i++) assert.equal(h.relay.subscribe('owner-0', socket(), true), true);
  assert.equal(h.relay.subscribe('owner-0', socket(), true), false);
  h.receive({ kind: 'interest', owners: Array.from({ length: 200 }, (_, i) => `owner-${i}`) });
  h.receive({ instance: 'peer2', kind: 'interest', owners: ['extra'] });
  for (let i = 0; i < 200; i++) h.relay.emit(`owner-${i}`, avatarEvent(`${i}`, h.now()));
  h.relay.emit('extra', avatarEvent('extra', h.now()));
  assert.equal(h.relay.getMetrics().remoteQueue.owners, 200);
  assert.equal(h.relay.getMetrics().remoteQueue.depth, 200);
  assert.equal(h.relay.getMetrics().drops.ownerLimit, 3);
  for (let i = 0; i < 110; i++) h.receive({ instance: `instance-${i}`, kind: 'interest', owners: ['other'] });
  assert.equal(h.relay.getMetrics().interestInstances, 100);
  assert.equal(h.relay.getMetrics().commandOwners, 200);
  await settle();
  for (const payload of h.payloads) assert.ok(Buffer.byteLength(payload) < 8000);
});

test('reconnect drops remote backlog, ignores the old client and start/stop are idempotent', async (t) => {
  const h = await harness(t);
  h.relay.start();
  assert.equal(h.clients.length, 1);
  const ws = socket();
  h.relay.subscribe('a', ws, true);
  h.receive({ kind: 'interest', owners: ['a'] });
  h.relay.emit('a', avatarEvent('before-failure', h.now()));
  const old = h.clients[0];
  old.emit('end');
  assert.equal(h.relay.getMetrics().drops.unavailable, 1);
  h.relay.emit('a', avatarEvent('during-failure', h.now()));
  assert.equal(h.relay.getMetrics().drops.unavailable, 2);
  await h.advance(5000);
  assert.equal(h.clients.length, 2);
  assert.equal(h.relay.getMetrics().ready, true);
  h.receive({ kind: 'events', events: [{ owner: 'a', event: avatarEvent('old-client', h.now()) }] }, old);
  h.relay.emit('a', avatarEvent('after-recovery', h.now()));
  await h.advance(50);
  assert.deepEqual(eventsOf(ws).map((event) => event.id), ['after-recovery']);
  assert.deepEqual(h.packets().flatMap((data) => data.events).map((item) => item.event.id), ['after-recovery']);
  await h.relay.stop();
  await h.relay.stop();
  h.relay.start();
  h.relay.emit('a', avatarEvent('after-stop', h.now()));
  await h.advance(20000);
  assert.equal(h.clients.length, 2);
  assert.equal(h.relay.getMetrics().ready, false);
  assert.equal(h.relay.getMetrics().localQueue.depth, 0);
});

test('rapid subscription changes announce the latest owners without waiting for the pulse', async (t) => {
  const transport = bus();
  const a = createLocalAvatarRelay(transport), b = createLocalAvatarRelay(transport);
  t.after(async () => { await a.stop(); await b.stop(); });
  a.start(); b.start();
  await settle();
  const one = socket(), two = socket();
  b.subscribe('one', one, true);
  b.subscribe('two', two, true);
  await settle();
  a.emit('two', avatarEvent('latest-owner', Date.now()));
  await wait(150);
  assert.deepEqual(eventsOf(two).map((event) => event.id), ['latest-owner']);
});

test('coalescing cannot extend the original queue deadline during a stalled publish', async (t) => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const h = await harness(t, { publish(channel, payload) {
    if (JSON.parse(payload).kind === 'events') return blocked;
  } });
  h.receive({ kind: 'interest', owners: ['a'] });
  for (let i = 0; i < 4; i++) h.relay.emit('a', avatarEvent(`inflight-${i}`, h.now()));
  await h.advance(50);
  h.relay.emit('a', avatarEvent('waiting', h.now(), { userId: 'same' }));
  await h.advance(4950);
  h.relay.emit('a', avatarEvent('refresh', h.now(), { userId: 'same' }));
  assert.equal(h.relay.getMetrics().coalesced, 1);
  assert.equal(h.relay.getMetrics().remoteQueue.oldestAgeMs, 4950);
  await h.advance(50);
  assert.equal(h.relay.getMetrics().remoteQueue.depth, 0);
  assert.equal(h.relay.getMetrics().drops.expired, 1);
  release();
  await settle();
});

test('a receiver never plays a publish that completed after the event expired', async (t) => {
  const h = await harness(t);
  const ws = socket();
  h.relay.subscribe('a', ws, true);
  const delayed = { owner: 'a', event: avatarEvent('delayed', h.now()) };
  await h.advance(5000);
  h.receive({ kind: 'events', events: [delayed] });
  await h.advance(50);
  assert.equal(eventsOf(ws).length, 0);
  assert.equal(h.relay.getMetrics().drops.expired, 1);
});

test('stalled control publishes remain bounded and cannot report healthy indefinitely', async (t) => {
  let block = false, release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const h = await harness(t, { publish(channel, payload) {
    if (block && JSON.parse(payload).kind === 'interest') return blocked;
  } });
  block = true;
  const before = h.payloads.length;
  for (let i = 0; i < 20; i++) h.relay.subscribe(`owner-${i}`, socket(), true);
  assert.equal(h.payloads.length, before + 1);
  await h.advance(5000);
  assert.equal(h.relay.getMetrics().deliveryReady, false);
  assert.equal(h.relay.getMetrics().publishInFlightAgeMs, 5000);
  block = false;
  release();
  await settle();
  const latest = JSON.parse(h.payloads.at(-1));
  assert.equal(latest.owners.length, 20);
  assert.equal(h.relay.getMetrics().deliveryReady, true);
});

test('a connection completing after failure or stop cannot resurrect readiness', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let connected;
  const connection = new Promise((resolve) => { connected = resolve; });
  const client = new EventEmitter();
  client.connect = () => connection;
  client.query = async () => assert.fail('failed connection must not LISTEN');
  client.end = async () => {};
  const relay = createLocalAvatarRelay({ createClient: () => client, publish: async () => {} });
  t.after(() => relay.stop());
  relay.start();
  client.emit('end');
  connected();
  await settle();
  assert.equal(relay.getMetrics().ready, false);
  await relay.stop();
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(relay.getMetrics().ready, false);
});

test('socket failures are isolated and diagnostics contain no chat or user history', async (t) => {
  const h = await harness(t);
  const broken = socket(), healthy = socket();
  h.relay.subscribe('a', broken, true);
  h.relay.subscribe('a', healthy, true);
  broken.send = () => { throw new Error('closed transport'); };
  h.relay.emit('a', avatarEvent('private-id', h.now(), { userId: 'private-user', text: 'private chat' }));
  await h.advance(50);
  assert.equal(eventsOf(healthy).length, 1);
  assert.ok(h.relay.getMetrics().socketFailures >= 1);
  assert.doesNotMatch(JSON.stringify(h.relay.getMetrics()), /private/);
  const metrics = h.relay.getMetrics();
  metrics.drops.overflow = 999;
  assert.equal(h.relay.getMetrics().drops.overflow, 0);
});

test('command metadata is retained for remaining subscribers and released with the last socket', async (t) => {
  const h = await harness(t);
  const a = socket(), b = socket();
  h.relay.subscribe('owner', a, true);
  h.relay.subscribe('owner', b, true);
  h.relay.setCommands('owner', ['!jump']);
  h.relay.remove(a);
  assert.equal(h.relay.getMetrics().commandOwners, 1);
  h.relay.subscribe('owner', b, true);
  assert.equal(lastStatus(b).commandsKnown, true);
  h.relay.subscribe('owner', b, false);
  assert.equal(h.relay.getMetrics().commandOwners, 0);
  assert.equal(lastStatus(b).commandsKnown, false);
  h.relay.subscribe('owner', a, true);
  assert.equal(lastStatus(a).commandsKnown, false);
  h.relay.setCommands('owner', ['!jump']);
  h.relay.subscribe('new-owner', a, true);
  assert.equal(h.relay.getMetrics().commandOwners, 0);
});
