import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { WebSocket, WebSocketServer } from 'ws';
import { createChatIngressJournal } from '../server/chat-ingress-journal.mjs';
import { createChatIngressService, loadChatIngressSecret, main } from '../server/chat-ingress-service.mjs';

const secret = 'test-ingress-credential-not-for-production-123456789';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const identity = (owner = 'alice', provider = 'chzzk') => ({ provider, ownerUserId: owner, sid: `user:${owner}`, channelId: `channel:${owner}` });
const envelope = (id, owner = 'alice', extra = {}) => ({ ...identity(owner), eventName: 'chat', dedupeKey: id, payload: { id, ...extra } });

async function waitFor(check, message, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(10);
  }
  throw new Error(message || 'Condition did not become true');
}

async function fixture(t, options = {}, journalOptions = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'arubot-ingress-http-'));
  const journal = await createChatIngressJournal({ directory, ...journalOptions });
  const stored = new Map();
  let shutdowns = 0;
  const providers = {
    async ensure(input) {
      const metadata = { ...input, channelId: input.channelId || `resolved:${input.ownerUserId}`, connected: true, sessionKey: 'session-key', liveChatId: 'live-chat', broadcastId: 'broadcast', botChannelId: 'bot', title: 'Live title', subscribed: true, lastError: null, accessToken: 'DO_NOT_RETURN', nested: { refresh_token: 'DO_NOT_RETURN' } };
      stored.set(input.provider + ':' + input.ownerUserId, metadata);
      return metadata;
    },
    async close(input) { stored.delete(input.provider + ':' + input.ownerUserId); },
    async list() { return [...stored.values()]; },
    async shutdown() { shutdowns++; stored.clear(); },
  };
  const service = createChatIngressService({ journal, providers, secret, controlPort: 0, publicPort: 0, publicHost: '127.0.0.1', runtimeProbeIntervalMs: 0, compactionIntervalMs: 0, logger: { error() {} }, ...options });
  const address = await service.start();
  const control = `http://127.0.0.1:${address.control.port}`;
  const gateway = `http://127.0.0.1:${address.gateway.port}`;
  async function request(route, body, auth = secret) {
    const response = await fetch(control + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, body: await response.json() };
  }
  t.after(async () => { await service.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  return { journal, service, providers, control, gateway, request, directory, shutdowns: () => shutdowns };
}

async function upstream(t, name) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
    res.setHeader('content-type', 'application/json');
    res.setHeader('set-cookie', 'session=retained; HttpOnly');
    res.end(JSON.stringify({ name, seen: seen.at(-1) }));
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (socket) => socket.on('message', (data) => socket.send(`${name}:${data}`)));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const socket of wss.clients) socket.terminate();
    server.closeAllConnections();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });
  return { url: `http://127.0.0.1:${server.address().port}`, server, seen };
}

test('control server is loopback-only, authenticated, bounded, and metadata does not expose OAuth credentials', async (t) => {
  const f = await fixture(t, { maxRequestBytes: 256 });
  assert.equal(f.service.controlServer.address().address, '127.0.0.1');
  assert.equal((await f.request('/status', undefined, 'wrong')).status, 401);
  assert.equal((await f.request('/session/ensure', { ...identity(), padding: 'x'.repeat(300) })).status, 413);
  const ensured = await f.request('/session/ensure', { provider: 'youtube', ownerUserId: 'alice', sid: 'user:alice' });
  assert.equal(ensured.status, 200);
  assert.equal(ensured.body.channelId, 'resolved:alice');
  for (const key of ['sessionKey', 'liveChatId', 'broadcastId', 'botChannelId', 'title', 'subscribed', 'lastError']) assert.ok(key in ensured.body, key);
  assert.equal(JSON.stringify(ensured.body).includes('DO_NOT_RETURN'), false);
  const listed = await f.request('/sessions');
  assert.equal(listed.body.sessions.length, 1);
  assert.equal(JSON.stringify(listed.body).includes('DO_NOT_RETURN'), false);
  assert.equal((await f.request('/status')).body.protocolVersion, 1);
});

test('owner session conflicts and foreign event envelopes cannot cross channel boundaries', async (t) => {
  const f = await fixture(t);
  await f.request('/session/ensure', identity());
  assert.equal((await f.request('/session/ensure', { ...identity(), channelId: 'other' })).status, 409);
  assert.equal((await f.request('/session/close', { ...identity(), sid: 'user:other' })).status, 409);
  await assert.rejects(f.service.acceptEvent({ ...envelope('one'), sid: 'user:other' }), { code: 'session_identity_conflict' });
  await assert.rejects(f.service.acceptEvent(envelope('one', 'bob')), { code: 'session_identity_conflict' });
  await f.service.acceptEvent(envelope('one'));
  assert.equal(f.journal.status().backlog, 1);
  assert.equal((await f.request('/session/close', identity())).body.closed, true);
});

test('provider inventory can persist before any API session ensure and adapter eventKey deduplicates', async (t) => {
  const f = await fixture(t);
  await f.providers.ensure(identity());
  const input = { ...identity(), eventName: 'CHAT', eventKey: 'provider-stable-message-id', payload: 'raw provider packet', receivedAt: 123456789 };
  const first = await f.service.acceptEvent(input);
  const second = await f.service.acceptEvent(input);
  assert.equal(second.duplicate, true);
  assert.equal(first.event.id, second.event.id);
  assert.equal(first.event.receivedAt, 123456789);
  assert.equal(first.event.payload, 'raw provider packet');
  assert.equal(f.journal.status().backlog, 1);
});

test('activation rejects public/credentialed/control-port targets and public proxy never exposes control routes', async (t) => {
  const f = await fixture(t);
  const blue = await upstream(t, 'blue');
  for (const url of ['https://127.0.0.1:3710', 'http://localhost:3710', 'http://example.com:3710', 'http://user:pass@127.0.0.1:3710', f.control, f.gateway]) {
    assert.equal((await f.request('/runtime/activate', { runtimeId: 'blue', url, expectedRuntimeId: null })).status, 400, url);
  }
  await f.request('/runtime/activate', { runtimeId: 'blue', url: blue.url, expectedRuntimeId: null });
  for (const route of ['/status', '/runtime/activate', '/events/claim', '/session/ensure', '/sessions', '/api/runtime/drain', '/API/RUNTIME/drain', '/api%2fruntime/drain']) {
    const response = await fetch(f.gateway + route, { headers: { authorization: `Bearer ${secret}` } });
    assert.equal(response.status, 404, route);
  }
  assert.equal(blue.seen.length, 0);
});

test('HTTP forwarding preserves cookies/body/status but strips ingress secrets and untrusted forwarding headers', async (t) => {
  const f = await fixture(t, { trustedProxies: [] });
  const blue = await upstream(t, 'blue');
  await f.request('/runtime/activate', { runtimeId: 'blue', url: blue.url, expectedRuntimeId: null });
  const response = await fetch(f.gateway + '/api/commands?x=1', { method: 'POST', headers: { authorization: `Bearer ${secret}`, cookie: 'viewer=one', 'content-type': 'application/json', 'x-forwarded-for': 'spoofed', 'x-arubot-ingress-secret': secret }, body: '{"message":"hello"}' });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.equal(body.seen.body, '{"message":"hello"}');
  assert.equal(body.seen.headers.cookie, 'viewer=one');
  assert.equal(body.seen.headers.authorization, undefined);
  assert.equal(body.seen.headers['x-arubot-ingress-secret'], undefined);
  assert.equal(body.seen.headers['x-forwarded-for'], '127.0.0.1');
});

test('drain buffers bounded HTTP until CAS activation and moves new requests to the candidate', async (t) => {
  const f = await fixture(t, { maxPendingRequests: 1, maxPendingBytes: 128, drainWaitTimeoutMs: 500 });
  const blue = await upstream(t, 'blue');
  const green = await upstream(t, 'green');
  await f.request('/runtime/activate', { runtimeId: 'blue', url: blue.url, expectedRuntimeId: null });
  await f.request('/runtime/drain', { runtimeId: 'blue' });
  const waiting = fetch(f.gateway + '/api/commands', { method: 'POST', body: 'keep-my-command' });
  await waitFor(() => f.service.status().pendingHttpRequests === 1);
  assert.equal(blue.seen.length, 0);
  assert.equal((await fetch(f.gateway + '/api/another')).status, 503);
  const activated = await f.request('/runtime/activate', { runtimeId: 'green', url: green.url, expectedRuntimeId: 'blue' });
  assert.equal(activated.status, 200);
  const response = await waiting;
  const body = await response.json();
  assert.equal(body.name, 'green');
  assert.equal(body.seen.body, 'keep-my-command');
  assert.equal(f.service.status().pendingHttpRequests, 0);
  await f.request('/runtime/drain', { runtimeId: 'green' });
  assert.equal((await fetch(f.gateway + '/api/too-large', { method: 'POST', body: 'x'.repeat(200) })).status, 503);
  assert.equal((await fetch(f.gateway + '/api/times-out')).status, 503);
});

test('rollback resumes buffered requests on the old runtime', async (t) => {
  const f = await fixture(t);
  const blue = await upstream(t, 'blue');
  await f.request('/runtime/activate', { runtimeId: 'blue', url: blue.url, expectedRuntimeId: null });
  await f.request('/runtime/drain', { runtimeId: 'blue' });
  const waiting = fetch(f.gateway + '/api/read');
  await waitFor(() => f.service.status().pendingHttpRequests === 1);
  await f.request('/runtime/resume', { runtimeId: 'blue' });
  assert.equal((await (await waiting).json()).name, 'blue');
});

test('WebSocket data survives proxying and activation closes old sockets with service-restart code', async (t) => {
  const f = await fixture(t);
  const blue = await upstream(t, 'blue');
  const green = await upstream(t, 'green');
  await f.request('/runtime/activate', { runtimeId: 'blue', url: blue.url, expectedRuntimeId: null });
  const socket = new WebSocket(f.gateway.replace('http:', 'ws:') + '/overlay');
  t.after(() => socket.terminate());
  await once(socket, 'open');
  const message = once(socket, 'message');
  socket.send('one');
  assert.equal((await message)[0].toString(), 'blue:one');
  const closed = once(socket, 'close');
  await f.request('/runtime/drain', { runtimeId: 'blue' });
  await f.request('/runtime/activate', { runtimeId: 'green', url: green.url, expectedRuntimeId: 'blue' });
  assert.equal((await closed)[0], 1012);
  const next = new WebSocket(f.gateway.replace('http:', 'ws:') + '/overlay');
  t.after(() => next.terminate());
  await once(next, 'open');
  const nextMessage = once(next, 'message');
  next.send('two');
  assert.equal((await nextMessage)[0].toString(), 'green:two');
  next.close();
});

test('persistence failure makes health fail and stops providers without accepting further messages', async (t) => {
  const f = await fixture(t, {}, { syncFile: async () => { throw new Error('ENOSPC'); } });
  await f.request('/session/ensure', identity());
  await assert.rejects(f.service.acceptEvent(envelope('one')), { code: 'journal_unavailable' });
  await waitFor(() => f.shutdowns() === 1);
  assert.equal((await f.request('/status')).body.healthy, false);
  assert.equal((await f.request('/events/claim', { runtimeId: 'blue' })).status, 503);
  await assert.rejects(f.service.acceptEvent(envelope('two')), { code: 'ingress_unavailable' });
});

test('secret must be explicit, sufficiently long, and can be loaded from a private file', async (t) => {
  await assert.rejects(loadChatIngressSecret({}), /required/);
  await assert.rejects(loadChatIngressSecret({ ARUBOT_CHAT_INGRESS_SECRET: 'weak' }), /32/);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'arubot-ingress-secret-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'secret');
  await fs.writeFile(filename, secret + '\n', { mode: 0o600 });
  assert.equal(await loadChatIngressSecret({ ARUBOT_CHAT_INGRESS_SECRET_FILE: filename }), secret);
});

test('entrypoint initializes encryption/DB before autonomous providers, persists without API, and closes DB on stop', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'arubot-ingress-main-'));
  const calls = [];
  let metadata;
  const database = {
    validateSecretEncryptionConfig() { calls.push('encryption'); },
    async initDb() { calls.push('db'); },
    async closeDatabaseConnections() { calls.push('db-close'); },
  };
  const service = await main({ ARUBOT_CHAT_INGRESS_SECRET: secret, ARUBOT_CHAT_INGRESS_DATA_DIR: directory, ARUBOT_CHAT_INGRESS_PORT: '0', PORT: '0', ARUBOT_CHAT_INGRESS_HOST: '127.0.0.1' }, {
    database,
    installSignalHandlers: false,
    sendReady() { calls.push('ready'); },
    createIngressProviders({ db, onEvent }) {
      assert.equal(db, database);
      calls.push('providers');
      return {
        list: () => metadata ? [metadata] : [],
        health: () => ({ healthy: true }),
        async start() { calls.push('providers-start'); metadata = identity(); await onEvent(envelope('before-any-api')); },
        async shutdown() {
          // An already-received callback queued before transport shutdown must still persist.
          await onEvent(envelope('shutdown-drain'));
          calls.push('providers-stop');
        },
      };
    },
  });
  t.after(async () => { await service.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  assert.deepEqual(calls, ['encryption', 'db', 'providers', 'providers-start', 'ready']);
  assert.equal(service.status().backlog, 1);
  await service.stop();
  assert.deepEqual(calls.slice(-2), ['providers-stop', 'db-close']);
  const reopened = await createChatIngressJournal({ directory });
  assert.equal(reopened.status().backlog, 2);
  await reopened.close();
});

test('entrypoint does not announce PM2 readiness after failed inventory and closes all resources', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'arubot-ingress-main-fail-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let ready = false;
  let dbClosed = false;
  let stopped = false;
  await assert.rejects(main({ ARUBOT_CHAT_INGRESS_SECRET: secret, ARUBOT_CHAT_INGRESS_DATA_DIR: directory, ARUBOT_CHAT_INGRESS_PORT: '0', PORT: '0', ARUBOT_CHAT_INGRESS_HOST: '127.0.0.1' }, {
    database: { validateSecretEncryptionConfig() {}, async initDb() {}, async closeDatabaseConnections() { dbClosed = true; } },
    installSignalHandlers: false,
    sendReady() { ready = true; },
    createIngressProviders: () => ({ async start() {}, health: () => ({ healthy: false, lastError: 'db_inventory_failed' }), async shutdown() { stopped = true; } }),
  }), /inventory is unhealthy/);
  assert.equal(ready, false);
  assert.equal(dbClosed, true);
  assert.equal(stopped, true);
  const reopened = await createChatIngressJournal({ directory });
  await reopened.close();
});

async function worker(t, { control, name, log }) {
  const source = `
    import http from 'node:http';
    import fs from 'node:fs/promises';
    const control = process.env.TEST_CONTROL;
    const name = process.env.TEST_NAME;
    let busy = false;
    const holds = new Map();
    async function call(route, body) {
      const res = await fetch(control + route, {method: body ? 'POST' : 'GET', headers: {authorization:'Bearer '+process.env.TEST_SECRET, 'content-type':'application/json'}, body:body ? JSON.stringify(body) : undefined});
      const value = await res.json();
      if(!res.ok) throw new Error(value.error);
      return value;
    }
    const server = http.createServer((_req,res)=>res.end(JSON.stringify({name,ready:true})));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    process.send({type:'ready',url:'http://127.0.0.1:'+server.address().port});
    process.on('message', message=> { if(message.type==='release') { for(const done of holds.values()) done(); holds.clear(); } });
    setInterval(async()=>{
      if(busy)return;
      busy=true;
      try {
        const status=await call('/status');
        if(status.activeRuntimeId!==name||status.draining)return;
        const {events}=await call('/events/claim',{runtimeId:name,limit:100});
        await Promise.all(events.map(async event=>{
          const file=await fs.open(process.env.TEST_LOG,'a');
          await file.writeFile(JSON.stringify({worker:name,id:event.payload.id})+'\\n');
          await file.sync(); await file.close();
          let release;
          const held = new Promise(resolve=>{release=resolve;});
          if(event.payload.hold) holds.set(event.id,release);
          process.send({type:'effect',id:event.payload.id});
          if(event.payload.hold)await held;
          await call('/events/ack',{runtimeId:name,id:event.id});
        }));
      } catch(error) { process.send({type:'error',message:error.message}); }
      finally {busy=false;}
    },20);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env, TEST_CONTROL: control, TEST_NAME: name, TEST_LOG: log, TEST_SECRET: secret }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  const messages = [];
  let stderr = '';
  child.on('message', (message) => messages.push(message));
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode == null && child.signalCode == null) {
      const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    }
  });
  const ready = await waitFor(() => {
    if (child.exitCode != null) throw new Error(stderr);
    return messages.find((message) => message.type === 'ready');
  }, `Worker ${name} did not start`);
  return { child, messages, url: ready.url };
}

test('real child workers hand off without losing/duplicating commands while ingress keeps receiving', async (t) => {
  const f = await fixture(t);
  const log = path.join(f.directory, 'effects.log');
  const blue = await worker(t, { control: f.control, name: 'blue', log });
  const green = await worker(t, { control: f.control, name: 'green', log });
  await f.request('/session/ensure', identity());
  await f.request('/runtime/activate', { runtimeId: 'blue', url: blue.url, expectedRuntimeId: null });
  await f.service.acceptEvent(envelope('before', 'alice', { hold: true }));
  await waitFor(() => blue.messages.some((message) => message.id === 'before'));
  await f.request('/runtime/drain', { runtimeId: 'blue' });
  for (let i = 0; i < 12; i++) {
    await f.service.acceptEvent(envelope(`during-${i}`));
    await f.service.acceptEvent(envelope(`during-${i}`));
  }
  assert.equal(f.journal.status().backlog, 12);
  assert.equal((await f.request('/runtime/activate', { runtimeId: 'green', url: green.url, expectedRuntimeId: 'blue' })).status, 409);
  blue.child.send({ type: 'release' });
  await waitFor(() => f.journal.status().inflight === 0);
  assert.equal((await f.request('/runtime/activate', { runtimeId: 'green', url: green.url, expectedRuntimeId: 'blue' })).status, 200);
  await waitFor(() => f.journal.status().inflight === 0 && f.journal.status().backlog === 0, 'All events must be ACKed');
  const effects = (await fs.readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(effects.map((item) => item.id), ['before', ...Array.from({ length: 12 }, (_, i) => `during-${i}`)]);
  assert.equal(effects[0].worker, 'blue');
  assert.ok(effects.slice(1).every((item) => item.worker === 'green'));
});

test('a real worker crash after a side effect becomes uncertain and never replays on its replacement', async (t) => {
  const f = await fixture(t);
  const log = path.join(f.directory, 'effects.log');
  const blue = await worker(t, { control: f.control, name: 'blue', log });
  const green = await worker(t, { control: f.control, name: 'green', log });
  await f.request('/session/ensure', identity());
  await f.request('/runtime/activate', { runtimeId: 'blue', url: blue.url, expectedRuntimeId: null });
  await f.service.acceptEvent(envelope('side-effect-done', 'alice', { hold: true }));
  await waitFor(() => blue.messages.some((message) => message.id === 'side-effect-done'));
  await f.service.acceptEvent(envelope('next-must-wait'));
  const exited = once(blue.child, 'exit'); blue.child.kill('SIGKILL'); await exited;
  await f.service.probeRuntime();
  assert.equal(f.journal.status().uncertain, 1);
  assert.equal(f.journal.status().draining, true);
  await f.request('/runtime/activate', { runtimeId: 'green', url: green.url, expectedRuntimeId: 'blue' });
  await delay(200);
  assert.equal(f.journal.status().backlog, 1);
  assert.deepEqual((await fs.readFile(log, 'utf8')).trim().split('\n').map(JSON.parse).map((item) => item.id), ['side-effect-done']);
  const uncertain = (await f.request('/events/uncertain')).body.events[0];
  await f.request('/events/resolve', { id: uncertain.event.id, action: 'discard', operator: 'test-operator', reason: 'Confirmed side effect in durable external log', confirm: 'I_HAVE_RECONCILED_SIDE_EFFECTS' });
  await waitFor(() => f.journal.status().inflight === 0 && f.journal.status().backlog === 0);
  assert.equal((await fs.readFile(log, 'utf8')).trim().split('\n').length, 2);
});
