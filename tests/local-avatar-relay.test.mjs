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
