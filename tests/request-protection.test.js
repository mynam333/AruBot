const { EventEmitter, once } = require('events');
const http = require('http');
const express = require('express');
const proxyaddr = require('proxy-addr');
const { WebSocket, WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');
const loadSource = require('./helpers/load-source.cjs');
const loadServerFunctions = require('./helpers/load-server-functions.cjs');
const safety = loadSource('shared/text-safety.js');
const { createBoundedRateStore, createRequestProtection, getClientNetworkKey, rejectUnsafeTextInput } = loadSource('server/request-protection.js', {
  'proxy-addr': { default: proxyaddr }, 'ipaddr.js': { default: require('ipaddr.js') }, '../shared/text-safety.js': safety,
  '../shared/drawing/limits.js': loadSource('shared/drawing/limits.js'),
});

function request(ip = '203.0.113.4', headers = {}) {
  return { url: '/api/test', path: '/api/test', method: 'GET', socket: { remoteAddress: ip }, headers };
}
function response() {
  const res = new EventEmitter();
  res.headers = {};
  res.setHeader = (key, value) => { res.headers[key] = value; };
  res.status = (status) => { res.statusCode = status; return res; };
  res.json = (body) => { res.body = body; res.emit('finish'); return res; };
  return res;
}
function socket() {
  const ws = new EventEmitter();
  ws.readyState = WebSocket.OPEN;
  ws.bufferedAmount = 0;
  ws.send = jest.fn();
  ws.close = jest.fn(() => { ws.readyState = WebSocket.CLOSED; ws.emit('close'); });
  ws.terminate = jest.fn(() => ws.emit('close'));
  return ws;
}

test('rate store stays bounded and never evicts live quotas to admit address churn', () => {
  let time = 0;
  const store = createBoundedRateStore({ maxEntries: 2, now: () => time });
  expect(store.take('a', 1, 10000)).toBe(0);
  expect(store.take('b', 1, 10000)).toBe(0);
  expect(store.take('c', 1, 10000)).toBeGreaterThan(0);
  expect(store.take('a', 1, 10000)).toBeGreaterThan(0);
  expect(store.size).toBe(2);
  time = 10001;
  expect(store.take('c', 1, 10000)).toBe(0);
  expect(store.size).toBe(1);
});

test('only trusted peers may supply IPs; mapped IPv4 and IPv6 rotations share keys', () => {
  const trusted = proxyaddr.compile('loopback');
  expect(getClientNetworkKey(request('203.0.113.4', { 'x-forwarded-for': '1.2.3.4' }), trusted)).toBe('203.0.113.4');
  expect(getClientNetworkKey(request('127.0.0.1', { 'x-forwarded-for': '1.2.3.4, 203.0.113.4' }), trusted)).toBe('203.0.113.4');
  expect(getClientNetworkKey(request('127.0.0.1', { 'x-forwarded-for': 'invalid' }), trusted)).toBe('127.0.0.1');
  expect(getClientNetworkKey(request('::ffff:203.0.113.4'), trusted)).toBe('203.0.113.4');
  expect(getClientNetworkKey(request('2001:db8:abcd:12::1'), trusted)).toBe(getClientNetworkKey(request('2001:db8:abcd:12::ffff'), trusted));
});

test('releases weighted HTTP slots exactly once on finish or abort', () => {
  const guard = createRequestProtection({ limits: { httpConcurrent: 24, httpConcurrentPerIp: 12 } });
  const req = { ...request(), method: 'POST', headers: { 'content-length': '1000000' } };
  const first = response();
  const next = jest.fn();
  guard.http(req, first, next);
  expect(next).toHaveBeenCalledTimes(1);
  const blocked = response();
  guard.http(req, blocked, next);
  expect(blocked.statusCode).toBe(429);
  expect(blocked.headers['Retry-After']).toBe('1');
  first.emit('close');
  first.emit('finish');
  const second = response();
  guard.http(req, second, next);
  expect(next).toHaveBeenCalledTimes(2);
  second.emit('finish');
});

test('caps global concurrency even across different clients', () => {
  const guard = createRequestProtection({ limits: { httpConcurrent: 1 } });
  const first = response();
  guard.http(request(), first, () => {});
  const blocked = response();
  guard.http(request('198.51.100.1'), blocked, () => { throw new Error('must not enter'); });
  expect(blocked.statusCode).toBe(503);
  first.emit('close');
});

test('auth route casing cannot obtain a second budget', () => {
  const guard = createRequestProtection();
  for (let i = 0; i < 60; i += 1) {
    const res = response();
    guard.http({ ...request(), path: '/api/auth/login' }, res, () => res.emit('finish'));
    expect(res.statusCode).toBeUndefined();
  }
  const blocked = response();
  guard.http({ ...request(), path: '/API/Auth/login' }, blocked, () => { throw new Error('must not enter'); });
  expect(blocked.statusCode).toBe(429);
});

test('pre-parser body budgets include GET bodies and aggregate traffic across IPs', () => {
  const guard = createRequestProtection({ limits: { bodyBytesPerTenSecondsGlobal: 1000, bodyBytesPerMinutePerIp: 1000 } });
  const allowed = response();
  guard.http(request('203.0.113.1', { 'content-length': '600' }), allowed, () => allowed.emit('finish'));
  expect(allowed.statusCode).toBeUndefined();
  const blocked = response();
  guard.http(request('203.0.113.2', { 'content-length': '600' }), blocked, () => { throw new Error('must not parse'); });
  expect(blocked.body.error).toBe('request_body_rate_exceeded');
  const tooLarge = response();
  createRequestProtection().http(request('203.0.113.1', { 'content-length': String(17 * 1024 * 1024) }), tooLarge, () => {});
  expect(tooLarge.statusCode).toBe(413);
});

test('WebSocket upgrades have process/IP caps and release slots on early disconnect', () => {
  const guard = createRequestProtection({ limits: { sockets: 1, socketsPerIp: 1 } });
  const first = new EventEmitter();
  const rejected = new EventEmitter();
  rejected.end = jest.fn();
  rejected.destroy = jest.fn();
  expect(guard.upgrade(request(), first)).toBe(true);
  expect(guard.upgrade(request('198.51.100.1'), rejected)).toBe(false);
  expect(rejected.end.mock.calls[0][0]).toContain('429');
  rejected.emit('close');
  first.emit('close');
  const third = new EventEmitter();
  expect(guard.upgrade(request(), third)).toBe(true);
  third.emit('close');
});

test('blocks rate/byte abuse and unsafe JSON before application listeners', () => {
  const guard = createRequestProtection({ limits: { messagesPerTenSeconds: 2, messageBytesPerTenSecondsPerIp: 1000 } });
  const ws = socket();
  const handler = jest.fn();
  guard.protectSocket(ws, request());
  ws.on('message', handler);
  ws.emit('message', Buffer.from('{"type":"ping"}'));
  ws.emit('pong', Buffer.alloc(0));
  ws.emit('message', Buffer.from('{"type":"command"}'));
  expect(handler).toHaveBeenCalledTimes(1);
  expect(ws.close).toHaveBeenCalledWith(1008, 'Message rate limit exceeded');
  const unsafe = socket();
  guard.protectSocket(unsafe, request('198.51.100.1'));
  unsafe.on('message', handler);
  unsafe.emit('message', Buffer.from('{"text":"a\\u0301\\u0301"}'));
  expect(handler).toHaveBeenCalledTimes(1);
  expect(unsafe.close).toHaveBeenCalledWith(1008, 'Unsafe text or payload');
  const large = socket();
  guard.protectSocket(large, request());
  large.emit('message', Buffer.alloc(1001));
  expect(large.close).toHaveBeenCalledWith(1008, 'Message rate limit exceeded');
});

test('limits output buffers and closes sockets whose authentication never completes', () => {
  jest.useFakeTimers();
  try {
    const guard = createRequestProtection({ limits: { bufferedBytes: 20, socketSetupTimeoutMs: 1000 } });
    const slow = socket();
    guard.protectSocket(slow, request());
    slow.bufferedAmount = 19;
    slow.send('{}');
    expect(slow.close).toHaveBeenCalledWith(1013, 'Slow consumer');
    const pending = socket();
    guard.protectSocket(pending, request());
    const passive = socket();
    guard.protectSocket(passive, request());
    passive.__arubotSetupComplete();
    jest.advanceTimersByTime(1001);
    expect(pending.close).toHaveBeenCalledWith(1013, 'Connection setup timed out');
    expect(passive.close).not.toHaveBeenCalled();
    passive.emit('close');
  } finally { jest.useRealTimers(); }
});

test('distributed WebSocket senders share a process-wide byte budget', () => {
  const guard = createRequestProtection({ limits: { messageBytesPerTenSecondsGlobal: 3 } });
  const first = socket();
  const second = socket();
  guard.protectSocket(first, request('203.0.113.1'));
  guard.protectSocket(second, request('203.0.113.2'));
  const handler = jest.fn();
  first.on('message', handler);
  second.on('message', handler);
  first.emit('message', Buffer.from('{}'));
  second.emit('message', Buffer.from('{}'));
  expect(handler).toHaveBeenCalledTimes(1);
  expect(second.close).toHaveBeenCalledWith(1008, 'Message rate limit exceeded');
  first.emit('close');
});

test('a synchronized heartbeat round does not disconnect healthy overlay sockets', () => {
  const guard = createRequestProtection();
  const clients = [];
  try {
    for (let i = 0; i < 2048; i += 1) {
      const ws = socket();
      clients.push(ws);
      guard.protectSocket(ws, request(`198.51.${Math.floor(i / 250)}.${i % 250}`));
      ws.__arubotSetupComplete();
      ws.emit('pong', Buffer.alloc(0));
      ws.emit('pong', Buffer.alloc(0));
      expect(ws.close).not.toHaveBeenCalled();
    }
  } finally { for (const ws of clients) ws.emit('close'); }
});

test('HTTP admission runs before JSON parsing; legitimate input and validation remain usable', async () => {
  const app = express();
  const guard = createRequestProtection({ limits: { httpPerMinute: 4 } });
  let parsed = 0;
  app.use(guard.http);
  app.use(express.json({ limit: '5mb', inflate: false, verify: () => { parsed += 1; } }));
  app.use(rejectUnsafeTextInput);
  app.post('/api/test', (req, res) => res.json(req.body));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.type }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const send = (body, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/test', method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text), headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
  try {
    expect((await send('{"message":"hello"}')).status).toBe(200);
    expect((await send('{"message":"a\\u0301\\u0301"}')).body.error).toBe('zalgo_text_not_allowed');
    expect((await send('compressed', { 'Content-Encoding': 'gzip' })).status).toBe(415);
    expect((await send('{"message":"ok"}')).status).toBe(200);
    const before = parsed;
    const blocked = await send('invalid json');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(parsed).toBe(before);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('real WebSockets preserve normal pings and reject Zalgo commands before execution', async () => {
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  const guard = createRequestProtection();
  let commands = 0;
  server.on('upgrade', (req, socket, head) => {
    if (guard.upgrade(req, socket)) wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws, req) => {
    guard.protectSocket(ws, req);
    ws.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === 'ping') ws.send('{"type":"pong"}');
      else commands += 1;
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const client = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/test`);
  try {
    await once(client, 'open');
    const reply = once(client, 'message');
    client.send('{"type":"ping"}');
    expect(String((await reply)[0])).toBe('{"type":"pong"}');
    const closed = once(client, 'close');
    client.send('{"type":"command","text":"a\\u0301\\u0301"}');
    expect((await closed)[0]).toBe(1008);
    expect(commands).toBe(0);
  } finally {
    client.terminate();
    for (const ws of wss.clients) ws.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
});

test('production middleware and every upgrade use the shared guards before expensive work', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server/index.js'), 'utf8');
  expect(source.indexOf('app.use(requestProtection.http)')).toBeLessThan(source.indexOf('express.text({'));
  expect(source.indexOf('app.use(rejectUntrustedBrowserOrigin)')).toBeLessThan(source.indexOf('app.use(express.json('));
  expect(source).toContain('requestProtection.protectSocket(socket, req)');
  const upgrade = source.slice(source.indexOf('// Single upgrade dispatcher'));
  expect(upgrade.indexOf('requestProtection.upgrade(req, socket)')).toBeLessThan(upgrade.indexOf('.handleUpgrade('));
  expect(source).not.toContain("app.set('trust proxy', 1)");
  expect(source).not.toContain('perMessageDeflate: {');
});

test('public prediction sockets clean up when disconnected during the initial DB await', async () => {
  let connected;
  let finishSnapshot;
  const snapshot = new Promise((resolve) => { finishSnapshot = resolve; });
  const predictionChannelSockets = new Map();
  const sendPredictionWs = jest.fn();
  const { registerPredictionRoutes } = loadServerFunctions(['registerPredictionRoutes'], {
    WebSocketServer: class { on(event, callback) { if (event === 'connection') connected = callback; } },
    WebSocket, wssPrediction: null, enableWebSocketHeartbeat() {}, PORT: 1, URL,
    console: { log() {}, error() {} }, predictionChannelSockets,
    getPredictionChannelKey: (value) => value,
    getActivePredictionForChannel: () => snapshot,
    schedulePredictionAutoLock: jest.fn(), toPublicPrediction: (value) => value, sendPredictionWs,
  });
  registerPredictionRoutes();
  const ws = socket();
  const pending = connected(ws, { url: '/api/prediction/ws?channelUid=channel' });
  expect(predictionChannelSockets.get('channel').has(ws)).toBe(true);
  ws.close();
  expect(predictionChannelSockets.size).toBe(0);
  finishSnapshot({ id: 'prediction' });
  await pending;
  expect(sendPredictionWs).not.toHaveBeenCalled();
});

test('local-agent heartbeat bursts coalesce DB writes and unregister on close', async () => {
  let connected;
  let finishWrite;
  const write = new Promise((resolve) => { finishWrite = resolve; });
  const unregister = jest.fn();
  const localAvatarRelay = { start: jest.fn(), subscribe: jest.fn(), remove: jest.fn() };
  const touchAutomationLocalAgent = jest.fn().mockResolvedValueOnce(null).mockImplementation(() => write);
  const { registerAutomationLocalAgentRoutes } = loadServerFunctions(['registerAutomationLocalAgentRoutes'], {
    WebSocketServer: class { on(event, callback) { if (event === 'connection') connected = callback; } },
    WebSocket, wssAutomationLocalAgent: null, enableWebSocketHeartbeat() {}, PORT: 1, URL,
    console: { log() {}, error() {} }, authenticateAutomationLocalAgent: async () => ({ id: 'agent', ownerUserId: 'owner-a' }),
    registerAutomationLocalAgentSocket: () => unregister, touchAutomationLocalAgent,
    getAutomationCapabilitiesFromMessage: () => ({}),
    localAvatarRelay, crypto: require('crypto'),
  });
  registerAutomationLocalAgentRoutes();
  const ws = socket();
  await connected(ws, { url: '/api/automations/local-agent/ws', headers: { authorization: 'Bearer test' } });
  ws.emit('message', '{"type":"avatars.subscribe","enabled":true,"owner":"untrusted-owner"}');
  expect(localAvatarRelay.subscribe).toHaveBeenCalledWith('owner-a', ws, true);
  for (let i = 0; i < 10; i += 1) ws.emit('message', '{"type":"heartbeat"}');
  expect(touchAutomationLocalAgent).toHaveBeenCalledTimes(2);
  finishWrite(null);
  await write;
  ws.close();
  expect(unregister).toHaveBeenCalledTimes(1);
  expect(localAvatarRelay.remove).toHaveBeenCalledWith(ws);
});

test('locks patched security dependencies without widening the legacy CHZZK exception', () => {
  const semver = require('semver');
  const root = path.join(__dirname, '..');
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const floors = { 'proxy-addr': '2.0.8', sharp: '0.35.5', 'source-map-js': '1.2.2' };
  for (const [name, floor] of Object.entries(floors)) {
    const installed = Object.entries(lock.packages).filter(([key]) => key.endsWith(`node_modules/${name}`));
    expect(installed.length).toBeGreaterThan(0);
    for (const [, pkg] of installed) expect(semver.gte(pkg.version, floor)).toBe(true);
  }
  expect(lock.packages['node_modules/socket.io-client'].version).toBe('2.0.3');
});
