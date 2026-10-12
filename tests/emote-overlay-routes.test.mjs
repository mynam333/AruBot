import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import express from 'express';
import { registerEmoteOverlayRoutes } from '../server/emote-overlay-routes.js';
import { createEmoteOverlayRuntime } from '../server/emote-overlay-runtime.js';

const token = `emo_${'a'.repeat(43)}`;
const snapshot = extra => ({ settings: { enabled: true }, revision: 1, epoch: 0, cursor: '0', events: [], serverNow: Date.now(), ...extra });
const settle = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t, options = {}) {
  const calls = [], watchers = new Set(), requests = [], errors = [];
  const state = { snapshot: snapshot(), unsubscribed: 0, promoted: 0, writes: 0 };
  const runtime = {
    async get(owner) { calls.push(['get', owner]); return { settings: {} }; },
    async save(...args) { calls.push(['save', ...args]); return { saved: true }; },
    async clear(owner) { calls.push(['clear', owner]); return { cleared: true }; },
    async rotate(owner) { calls.push(['rotate', owner]); return { rotated: true }; },
    async test(owner) { calls.push(['test', owner]); return { sent: 5 }; },
    async snapshot(value, after) {
      calls.push(['snapshot', value, after]);
      if (value !== token) throw Object.assign(new Error('invalid token'), { status: 401 });
      if (state.error) throw state.error;
      return structuredClone(state.snapshot);
    },
    subscribe(value, callback) {
      calls.push(['subscribe', value]);
      watchers.add(callback);
      return () => { state.unsubscribed++; watchers.delete(callback); };
    },
    ...options.runtime,
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { requests.push({ req, res }); next(); });
  registerEmoteOverlayRoutes(app, {
    runtime, getOwner: async req => req.headers['x-owner'] || null,
    writeLimiter: (_req, _res, next) => { state.writes++; next(); },
    promoteStream: options.promoteStream || ((_req, _res) => { state.promoted++; return true; }),
    logger: { error: (...args) => errors.push(args) },
  });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return {
    base: `http://127.0.0.1:${server.address().port}`, server, calls, watchers, state, runtime, requests, errors,
    wake() { for (const callback of watchers) callback(); },
  };
}

async function stream(t, url) {
  const frames = [], waiting = [];
  let text = '', ended = false;
  const request = http.get(url);
  t.after(() => request.destroy());
  const response = await new Promise((resolve, reject) => { request.once('response', resolve); request.once('error', reject); });
  response.setEncoding('utf8');
  response.on('data', chunk => {
    text += chunk;
    let index;
    while ((index = text.indexOf('\n\n')) !== -1) {
      const frame = text.slice(0, index); text = text.slice(index + 2);
      const event = /^event: (.+)$/m.exec(frame)?.[1], data = /^data: (.+)$/m.exec(frame)?.[1];
      if (!event || !data) continue;
      const value = { event, data: JSON.parse(data) };
      if (waiting.length) waiting.shift()(value); else frames.push(value);
    }
  });
  response.on('end', () => { ended = true; });
  response.on('error', () => { ended = true; });
  return {
    response, request, get ended() { return ended; },
    next(timeout = 3000) {
      if (frames.length) return Promise.resolve(frames.shift());
      return new Promise((resolve, reject) => {
        const done = value => { clearTimeout(timer); resolve(value); };
        const timer = setTimeout(() => { const index = waiting.indexOf(done); if (index >= 0) waiting.splice(index, 1); reject(new Error('SSE frame timeout')); }, timeout);
        waiting.push(done);
      });
    },
  };
}

test('admin endpoints require identity, pass canonical owner, and use write limiter', async t => {
  const h = await fixture(t);
  const anonymous = await fetch(`${h.base}/api/emote-overlay`);
  assert.equal(anonymous.status, 401);
  assert.equal(h.calls.length, 0);
  const own = await fetch(`${h.base}/api/emote-overlay`, { headers: { 'x-owner': 'managed-owner' } });
  assert.equal(own.status, 200);
  assert.match(own.headers.get('cache-control'), /no-store/);
  assert.equal(own.headers.get('referrer-policy'), 'no-referrer');
  const saved = await fetch(`${h.base}/api/emote-overlay/settings`, { method: 'PUT', headers: { 'x-owner': 'managed-owner', 'content-type': 'application/json' }, body: JSON.stringify({ settings: { enabled: true }, revision: 3 }) });
  assert.equal(saved.status, 200);
  for (const action of ['clear', 'rotate', 'test']) {
    const result = await fetch(`${h.base}/api/emote-overlay/${action}`, { method: 'POST', headers: { 'x-owner': 'managed-owner' } });
    assert.equal(result.status, 200);
  }
  assert.deepEqual(h.calls, [['get', 'managed-owner'], ['save', 'managed-owner', { enabled: true }, 3], ['clear', 'managed-owner'], ['rotate', 'managed-owner'], ['test', 'managed-owner']]);
  assert.equal(h.state.writes, 4);
});

test('public polling requires only a valid dedicated token and forwards exact string cursor', async t => {
  const h = await fixture(t);
  const bad = await fetch(`${h.base}/api/emote-overlay/state?token=bad`);
  assert.equal(bad.status, 401);
  const result = await fetch(`${h.base}/api/emote-overlay/state?token=${token}&after=9223372036854775807`);
  assert.equal(result.status, 200);
  assert.deepEqual(h.calls.at(-1), ['snapshot', token, '9223372036854775807']);
  assert.match(result.headers.get('cache-control'), /no-store/);
});

test('unexpected DB errors return generic 503 rather than exposing SQL or succeeding with stale state', async t => {
  const h = await fixture(t, { runtime: { async get() { throw new Error('postgres://private/password SELECT secret'); } } });
  const result = await fetch(`${h.base}/api/emote-overlay`, { headers: { 'x-owner': 'owner' } });
  assert.equal(result.status, 503);
  assert.doesNotMatch(JSON.stringify(await result.json()), /postgres|password|SELECT|secret/);
  assert.equal(h.errors.length, 1);
});

test('real Express SSE survives completed request lifecycle, emits subsequent events and releases on disconnect', { timeout: 7000 }, async t => {
  const h = await fixture(t);
  const connection = await stream(t, `${h.base}/api/emote-overlay/stream?token=${token}&after=9`);
  assert.equal(connection.response.statusCode, 200);
  assert.match(connection.response.headers['content-type'], /text\/event-stream/);
  assert.equal(connection.response.headers['x-accel-buffering'], 'no');
  assert.equal((await connection.next()).event, 'state');
  // A completed IncomingMessage is not a closed long-lived ServerResponse.
  h.requests.at(-1).req.emit('close');
  h.state.snapshot = snapshot({ cursor: '10', events: [{ id: '10', items: [] }] });
  h.wake();
  const second = await connection.next();
  assert.equal(second.data.events[0].id, '10');
  assert.equal(connection.ended, false);
  assert.deepEqual(h.calls.filter(call => call[0] === 'snapshot').map(call => call[2]), ['9', '0']);
  assert.equal(h.state.promoted, 1);
  connection.request.destroy();
  await new Promise(resolve => h.requests.at(-1).res.once('close', resolve));
  assert.equal(h.watchers.size, 0);
  assert.equal(h.state.unsubscribed, 1);
});

test('SSE reconciliation receives changes made without a local wake and resumes with prior cursor', { timeout: 7000 }, async t => {
  const h = await fixture(t);
  h.state.snapshot = snapshot({ cursor: '40' });
  const connection = await stream(t, `${h.base}/api/emote-overlay/stream?token=${token}&after=39`);
  assert.equal((await connection.next()).data.cursor, '40');
  h.state.snapshot = snapshot({ cursor: '41', epoch: 2, events: [{ id: '41', items: [] }] });
  const reconciled = await connection.next();
  assert.equal(reconciled.data.cursor, '41');
  assert.equal(reconciled.data.epoch, 2);
  assert.deepEqual(h.calls.filter(call => call[0] === 'snapshot').at(-1), ['snapshot', token, '40']);
});

test('SSE reports token revocation or database failure then unsubscribes for a clean retry', async t => {
  const h = await fixture(t);
  const connection = await stream(t, `${h.base}/api/emote-overlay/stream?token=${token}`);
  await connection.next();
  h.state.error = Object.assign(new Error('token rotated'), { status: 401 });
  h.wake();
  assert.deepEqual(await connection.next(), { event: 'unavailable', data: { status: 401 } });
  assert.equal(h.state.unsubscribed, 1);
  assert.equal(h.watchers.size, 0);
});

test('invalid SSE tokens never subscribe, promote or commit streaming headers', async t => {
  let promotions = 0;
  const h = await fixture(t, { promoteStream() { promotions++; return true; } });
  const result = await fetch(`${h.base}/api/emote-overlay/stream?token=invalid`);
  assert.equal(result.status, 401);
  assert.match(result.headers.get('content-type'), /application\/json/);
  assert.equal(h.watchers.size, 0);
  assert.equal(promotions, 0);
});

test('stream-slot rejection after authentication releases subscription and keeps helper response', async t => {
  let promotions = 0;
  const h = await fixture(t, { promoteStream(_req, res) { promotions++; res.status(429).json({ error: 'stream limit' }); return false; } });
  const result = await fetch(`${h.base}/api/emote-overlay/stream?token=${token}`);
  assert.equal(result.status, 429);
  assert.deepEqual(await result.json(), { error: 'stream limit' });
  assert.equal(promotions, 1);
  assert.equal(h.calls[0][0], 'snapshot');
  assert.equal(h.calls[1][0], 'subscribe');
  assert.equal(h.watchers.size, 0);
  assert.equal(h.state.unsubscribed, 1);
});

test('per-token subscription rejection precedes stream promotion', async t => {
  const h = await fixture(t, { runtime: { subscribe() { return null; } } });
  const result = await fetch(`${h.base}/api/emote-overlay/stream?token=${token}`);
  assert.equal(result.status, 429);
  assert.equal(h.state.promoted, 0);
});

test('disconnect during initial lookup does not reserve a subscriber or stream slot', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const h = await fixture(t, { runtime: { async snapshot() { await pending; return snapshot(); } } });
  const request = http.get(`${h.base}/api/emote-overlay/stream?token=${token}`);
  request.on('error', () => {});
  while (!h.requests.length) await settle();
  const closed = new Promise(resolve => h.requests.at(-1).res.once('close', resolve));
  request.destroy();
  await closed;
  release();
  await settle();
  assert.equal(h.watchers.size, 0);
  assert.equal(h.state.promoted, 0);
});

test('initial backpressure closes once without leaving a reconciliation interval behind', async t => {
  let handler, subscriptions = 0, releases = 0, intervals = 0;
  const app = { get(path, fn) { if (path.endsWith('/stream')) handler = fn; }, put() {}, post() {} };
  const res = new EventEmitter();
  Object.assign(res, {
    headersSent: false, writableEnded: false, destroyed: false,
    setHeader() {}, setTimeout() {}, flushHeaders() { this.headersSent = true; },
    write() { return false; }, end() { this.writableEnded = true; this.emit('close'); },
  });
  t.mock.method(globalThis, 'setInterval', () => { intervals++; return { unref() {} }; });
  registerEmoteOverlayRoutes(app, { runtime: {
    snapshot: async () => snapshot(), subscribe() { subscriptions++; return () => releases++; },
  }, getOwner: () => 'owner', writeLimiter: (_req, _res, next) => next() });
  await handler({ query: { token }, destroyed: true }, res);
  assert.equal(subscriptions, 1, 'request.destroyed does not indicate response disconnection');
  assert.equal(releases, 1);
  assert.equal(res.writableEnded, true);
  assert.equal(intervals, 0);
});

test('runtime shutdown immediately ends real SSE responses and permits graceful server close', { timeout: 3000 }, async t => {
  let snapshots = 0, warnings = 0;
  const runtime = createEmoteOverlayRuntime({
    store: { async snapshot() { snapshots++; return snapshot(); }, async cleanup() {} },
    logger: { warn() { warnings++; } },
  });
  t.after(() => runtime.stop());
  runtime.subscribe(token, () => { throw new Error('broken shutdown listener'); });
  const h = await fixture(t, { runtime });
  const first = await stream(t, `${h.base}/api/emote-overlay/stream?token=${token}`);
  const second = await stream(t, `${h.base}/api/emote-overlay/stream?token=${token}`);
  await first.next();
  await second.next();
  const ended = [first, second].map(connection => new Promise(resolve => connection.response.once('end', resolve)));
  const serverClosed = new Promise(resolve => h.server.close(resolve));
  await runtime.stop();
  await Promise.all([...ended, serverClosed]);
  assert.equal(first.ended, true);
  assert.equal(second.ended, true);
  assert.equal(snapshots, 2, 'shutdown notification must close rather than poll');
  assert.equal(warnings, 1);
  assert.ok(h.requests.every(({ res }) => res.writableEnded));
});
