const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const loadSource = require('./helpers/load-source.cjs');
const { connectOverlaySocket } = loadSource('src/shared/api/overlay-socket.ts');
let savedGlobals;
let sockets;
let cleanups;

beforeEach(() => {
  jest.useFakeTimers();
  savedGlobals = Object.fromEntries(['window', 'document', 'WebSocket'].map((key) => [key, global[key]]));
  global.window = new EventTarget();
  global.document = Object.assign(new EventTarget(), { hidden: false });
  sockets = [];
  cleanups = [];
  global.WebSocket = class {
    static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url) {
      this.url = url; this.readyState = 0;
      this.send = jest.fn();
      this.close = jest.fn(() => { this.readyState = 3; });
      sockets.push(this);
    }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(data = '{"type":"pong"}') { this.onmessage?.({ data }); }
    disconnect(code = 1000, wasClean = true, reason = '') {
      this.readyState = 3;
      this.onclose?.({ code, wasClean, reason });
    }
  };
});

afterEach(() => {
  cleanups.reverse().forEach((cleanup) => cleanup());
  for (const [key, value] of Object.entries(savedGlobals)) {
    if (value === undefined) delete global[key]; else global[key] = value;
  }
  jest.clearAllTimers();
  jest.useRealTimers();
});

function connect(options = {}) {
  const onMessage = jest.fn();
  const onRetry = jest.fn();
  const disconnect = connectOverlaySocket({ url: 'ws://localhost/overlay', onMessage, onRetry, ...options });
  cleanups.push(disconnect);
  return { disconnect, onMessage, onRetry };
}

test.each([1000, 1001, 1006, 1008, 1009, 1012, 1013])('keeps retrying clean and unclean server closures (%i) without an attempt limit', (code) => {
  const h = connect();
  for (let i = 0; i < 30; i += 1) {
    sockets.at(-1).open();
    sockets.at(-1).disconnect(code, code !== 1006);
    const [attempt, delay] = h.onRetry.mock.calls.at(-1);
    expect(attempt).toBe(i + 1);
    expect(delay).toBeLessThanOrEqual(30000);
    jest.advanceTimersByTime(delay);
    expect(sockets).toHaveLength(i + 2);
  }
});

test('constructor failures keep retrying and reset backoff after the server responds', () => {
  const Constructor = global.WebSocket;
  const failing = jest.fn(() => { throw new Error('network unavailable'); });
  global.WebSocket = failing;
  const h = connect();
  jest.advanceTimersByTime(300000);
  expect(failing.mock.calls.length).toBeGreaterThan(10);
  global.WebSocket = Constructor;
  for (let i = 0; i < 31 && !sockets.length; i += 1) jest.advanceTimersByTime(1000);
  expect(sockets).toHaveLength(1);
  sockets.at(-1).open();
  sockets.at(-1).receive();
  sockets.at(-1).disconnect();
  expect(h.onRetry).toHaveBeenLastCalledWith(1, 1000);
});

test('recovers an error without a close event and ignores callbacks from the old socket', () => {
  const h = connect();
  const previous = sockets[0];
  previous.open();
  const staleClose = previous.onclose;
  const staleMessage = previous.onmessage;
  previous.onerror(new Event('error'));
  staleClose({ code: 1006 });
  jest.advanceTimersByTime(1000);
  expect(sockets).toHaveLength(2);
  staleMessage({ data: '{"type":"start"}' });
  expect(h.onMessage).not.toHaveBeenCalled();
  expect(h.onRetry).toHaveBeenCalledTimes(1);
});

test('times out stuck handshakes and silent open sockets', () => {
  connect();
  jest.advanceTimersByTime(11000);
  expect(sockets).toHaveLength(2);
  sockets[1].open();
  jest.advanceTimersByTime(31000);
  expect(sockets[1].close).toHaveBeenCalled();
  expect(sockets).toHaveLength(3);
});

test('healthy heartbeats preserve the socket and returning visibility does not restart playback', () => {
  connect();
  sockets[0].open();
  for (let i = 0; i < 20; i += 1) {
    jest.advanceTimersByTime(10000);
    sockets[0].receive();
  }
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('pageshow'));
  expect(sockets).toHaveLength(1);
  expect(sockets[0].send).toHaveBeenCalledWith('{"type":"ping"}');
});

test('returning online reconnects immediately and cleanup cancels every retry and listener', () => {
  const h = connect();
  sockets[0].disconnect();
  window.dispatchEvent(new Event('online'));
  expect(sockets).toHaveLength(2);
  h.disconnect();
  window.dispatchEvent(new Event('online'));
  document.dispatchEvent(new Event('visibilitychange'));
  jest.advanceTimersByTime(300000);
  expect(sockets).toHaveLength(2);
  expect(jest.getTimerCount()).toBe(0);
});

test('only the explicit one-shot roulette test completion may stop retrying', () => {
  connect({ shouldReconnect: (event) => event.reason !== 'Test event delivered' });
  sockets[0].disconnect(1000, true, 'Test event delivered');
  window.dispatchEvent(new Event('online'));
  jest.advanceTimersByTime(300000);
  expect(sockets).toHaveLength(1);
});

test.each(['PvdViewer.tsx', 'RouletteViewer.tsx', 'FxOverlay.tsx', '../features/viewer/prediction-overlay.tsx'])('%s uses the shared unlimited recovery transport', (file) => {
  const source = fs.readFileSync(path.join(__dirname, '../src/components', file), 'utf8');
  expect(source).toContain('connectOverlaySocket({');
  expect(source).not.toContain('new WebSocket(');
  expect(source).not.toContain('reconnectAttemptsRef.current < 3');
});

test.each(['registerPvdRoutes', 'registerRouletteRoutes'])('%s answers application heartbeat without executing effects', (name) => {
  const filename = path.join(__dirname, '../server/index.js');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  let handler;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'ws.on' && node.arguments[0]?.text === 'message') handler = node.arguments[1].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(declaration);
  const ws = { send: jest.fn() };
  const run = new Function('ws', `return (${handler});`)(ws);
  run(Buffer.from('{"type":"ping"}'));
  expect(JSON.parse(ws.send.mock.calls[0][0])).toMatchObject({ type: 'pong' });
});
