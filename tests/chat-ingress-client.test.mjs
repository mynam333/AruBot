import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatIngressClient, createIngressSocket } from '../server/chat-ingress-client.mjs';

const secret = 'test-only-secret-'.repeat(3);
const quiet = { warn() {}, error() {} };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const settle = () => new Promise(resolve => setImmediate(resolve));

test('ingress client remains standby, awaits command completion, and retries only lost ACK', async () => {
  let activeRuntimeId = 'old';
  let ackAttempts = 0;
  let claims = 0;
  let executed = 0;
  const command = deferred();
  const client = createChatIngressClient({ url: 'http://127.0.0.1:3701', secret, runtimeId: 'new', logger: quiet,
    fetchImpl: async (url, options) => {
      assert.equal(options.headers.authorization, `Bearer ${secret}`);
      const route = new URL(url).pathname;
      if (route === '/status') return Response.json({ protocolVersion: 1, activeRuntimeId, healthy: true });
      if (route === '/events/claim') {
        claims += 1;
        return Response.json({ events: claims === 1 ? [{ id: 'one' }] : [] });
      }
      if (route === '/events/ack') {
        ackAttempts += 1;
        if (ackAttempts === 1) throw new Error('response lost after durable ACK');
        return Response.json({ ok: true });
      }
      throw new Error(route);
    },
  });
  const handler = async () => { executed += 1; await command.promise; };
  await client.tick(handler);
  assert.equal(claims, 0);
  activeRuntimeId = 'new';
  await client.tick(handler);
  assert.equal(executed, 1);
  assert.equal(ackAttempts, 0);
  client.drain();
  command.resolve();
  await settle();
  assert.equal(client.pending, 1);
  await client.tick(handler);
  assert.equal(ackAttempts, 2);
  assert.equal(executed, 1);
  assert.equal(client.pending, 0);
  assert.equal(claims, 1);
  await client.stop();
});

test('claim request itself counts toward drain so a late response cannot escape the handoff', async () => {
  const claim = deferred();
  const command = deferred();
  const client = createChatIngressClient({ url: 'http://localhost:3701', secret, runtimeId: 'worker', logger: quiet,
    fetchImpl: async url => {
      if (url.endsWith('/status')) return Response.json({ protocolVersion: 1, activeRuntimeId: 'worker' });
      if (url.endsWith('/events/claim')) return claim.promise;
      return Response.json({ ok: true });
    },
  });
  const tick = client.tick(() => command.promise);
  await settle();
  assert.equal(client.pending, 1);
  client.drain();
  claim.resolve(Response.json({ events: [{ id: 'late' }] }));
  await tick;
  assert.equal(client.pending, 1);
  command.resolve();
  await settle();
  assert.equal(client.pending, 0);
  await client.stop();
});

test('failed handler is parked without retrying side effects and protocol errors fence new work', async () => {
  let version = 1;
  let failures = 0;
  let calls = 0;
  const client = createChatIngressClient({ url: 'http://127.0.0.1:3701', secret, runtimeId: 'worker', logger: quiet,
    fetchImpl: async url => {
      if (url.endsWith('/status')) return Response.json({ protocolVersion: version, activeRuntimeId: 'worker' });
      if (url.endsWith('/events/claim')) return Response.json({ events: [{ id: 'uncertain' }] });
      if (url.endsWith('/events/fail')) failures += 1;
      return Response.json({ ok: true });
    },
  });
  await client.tick(async () => { calls += 1; throw new Error('external effect outcome unknown'); });
  await settle();
  assert.equal(failures, 1);
  version = 2;
  await client.tick(async () => { calls += 1; });
  assert.equal(calls, 1);
  assert.equal(client.canRun(), false);
  await client.stop();
});

test('facade dispatch awaits original handler and detach never terminates platform transport', async () => {
  const socket = createIngressSocket({ connected: true });
  const command = deferred();
  let done = false;
  socket.on('CHAT', async () => { await command.promise; done = true; });
  const processing = socket.dispatch('CHAT', {});
  assert.equal(done, false);
  command.resolve();
  await processing;
  assert.equal(done, true);
  socket.disconnect();
  assert.equal(socket.connected, false);
});

test('ingress configuration rejects external targets and missing strong credentials', () => {
  for (const url of ['https://127.0.0.1:3701', 'http://example.com', 'http://127.0.0.1:3701/admin']) {
    assert.throws(() => createChatIngressClient({ url, secret, runtimeId: 'worker' }));
  }
  assert.throws(() => createChatIngressClient({ url: 'http://127.0.0.1:3701', secret: 'short', runtimeId: 'worker' }));
});

test('authoritative draining and unhealthy status fence HTTP and background work as well as claims', async () => {
  let state = { protocolVersion: 1, activeRuntimeId: 'worker', healthy: true, draining: false };
  const client = createChatIngressClient({ url: 'http://127.0.0.1:3701', secret, runtimeId: 'worker', logger: quiet,
    fetchImpl: async () => Response.json(state),
  });
  await client.refresh();
  assert.equal(client.canRun(), true);
  state = { ...state, draining: true };
  await client.refresh();
  assert.equal(client.canRun(), false);
  state = { ...state, draining: false, healthy: false };
  await client.refresh();
  assert.equal(client.canRun(), false);
  state = { ...state, healthy: true };
  await client.refresh();
  assert.equal(client.canRun(), true);
  await client.stop();
});
