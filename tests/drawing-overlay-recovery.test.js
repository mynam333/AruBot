const loadSource = require('./helpers/load-source.cjs');
const loadServerFunctions = require('./helpers/load-server-functions.cjs');
const { connectDrawingOverlay, scheduleDrawingOverlayReload } = loadSource('src/shared/drawing/overlay-connection.ts');

const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
let savedGlobals;
let sockets;
let cleanups;

beforeEach(() => {
  jest.useFakeTimers({ now: 1800000000000 });
  savedGlobals = Object.fromEntries(['window', 'document', 'WebSocket', 'fetch'].map((key) => [key, global[key]]));
  sockets = [];
  cleanups = [];
  global.window = Object.assign(new EventTarget(), {
    location: { href: 'https://example.test/drawing-overlay/test', reload: jest.fn() },
    sessionStorage: { getItem: jest.fn(() => null), setItem: jest.fn() },
  });
  global.document = Object.assign(new EventTarget(), { hidden: false });
  global.fetch = jest.fn(async () => ({ ok: true }));
  global.WebSocket = class {
    static OPEN = 1;
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.send = jest.fn();
      this.close = jest.fn(() => { this.readyState = 3; });
      sockets.push(this);
    }
    push(payload) { this.readyState = 1; this.onmessage?.({ data: JSON.stringify(payload) }); }
  };
});

afterEach(() => {
  cleanups.reverse().forEach((cleanup) => cleanup());
  for (const [key, value] of Object.entries(savedGlobals)) {
    if (value === undefined) delete global[key];
    else global[key] = value;
  }
  jest.clearAllTimers();
  jest.useRealTimers();
});

function connect(options = {}) {
  const callbacks = { onItem: jest.fn(), onUpdateRequired: jest.fn(), onConnectionChange: jest.fn() };
  cleanups.push(connectDrawingOverlay({ url: 'wss://example.test/drawing', ...options, ...callbacks }));
  return callbacks;
}

test('recovers the token from persistent settings after a restart with no active bots', async () => {
  const drawingTokenToSid = new Map();
  const findSidByDrawingViewerToken = jest.fn(async () => 'user:streamer');
  const getBotSettings = jest.fn();
  const { getDrawingSidByToken } = loadServerFunctions(['getDrawingSidByToken'], {
    drawingTokenToSid, findSidByDrawingViewerToken, getBotSettings, activeSids: new Map(),
  });
  await expect(getDrawingSidByToken('draw_saved')).resolves.toBe('user:streamer');
  expect(drawingTokenToSid.get('draw_saved')).toBe('user:streamer');
  expect(findSidByDrawingViewerToken).toHaveBeenCalledWith('draw_saved');
  expect(getBotSettings).not.toHaveBeenCalled();
});

test('does not cache failed token lookups and can recover when the database returns', async () => {
  const drawingTokenToSid = new Map();
  const findSidByDrawingViewerToken = jest.fn().mockRejectedValueOnce(new Error('database restarting')).mockResolvedValue('user:streamer');
  const { getDrawingSidByToken } = loadServerFunctions(['getDrawingSidByToken'], {
    drawingTokenToSid, findSidByDrawingViewerToken, activeSids: new Map(),
  });
  await expect(getDrawingSidByToken('draw_saved')).rejects.toThrow('database restarting');
  expect(drawingTokenToSid.size).toBe(0);
  await expect(getDrawingSidByToken('draw_saved')).resolves.toBe('user:streamer');
});

test('reconnects after server restart and receives the current drawing again', () => {
  const callbacks = connect();
  sockets[0].push({ type: 'drawing-donation.current', item: { id: 'drawing-1' } });
  sockets[0].onclose();
  expect(callbacks.onConnectionChange).toHaveBeenLastCalledWith(false);
  jest.advanceTimersByTime(1800);
  expect(sockets).toHaveLength(2);
  sockets[1].push({ type: 'drawing-donation.current', item: { id: 'drawing-2' } });
  expect(callbacks.onItem).toHaveBeenLastCalledWith({ id: 'drawing-2' });
  expect(callbacks.onConnectionChange).toHaveBeenLastCalledWith(true);
});

test('keeps retrying drawing overlay connections after repeated server failures', () => {
  connect();
  for (let i = 0; i < 30; i += 1) {
    sockets.at(-1).onclose();
    jest.advanceTimersByTime(10000);
    expect(sockets).toHaveLength(i + 2);
  }
});

test('replaces a silently stalled socket even when no close event arrives', () => {
  connect();
  sockets[0].push({ type: 'drawing-donation.current', item: null });
  jest.advanceTimersByTime(30000);
  expect(sockets[0].send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }));
  expect(sockets[0].close).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1800);
  expect(sockets).toHaveLength(2);
});

test('times out a handshake without an authenticated snapshot', () => {
  connect();
  sockets[0].readyState = WebSocket.OPEN;
  jest.advanceTimersByTime(11800);
  expect(sockets).toHaveLength(2);
  expect(sockets[0].close).toHaveBeenCalledTimes(1);
});

test('retries socket errors without depending on onclose and ignores stale callbacks', () => {
  const callbacks = connect();
  const staleMessage = sockets[0].onmessage;
  sockets[0].onerror();
  jest.advanceTimersByTime(1800);
  staleMessage({ data: JSON.stringify({ type: 'drawing-donation.current', item: { id: 'stale' } }) });
  expect(callbacks.onItem).not.toHaveBeenCalled();
  expect(sockets).toHaveLength(2);
});

test('healthy heartbeats keep an idle overlay connected without interrupting playback', () => {
  const callbacks = connect();
  sockets[0].push({ type: 'drawing-donation.current', item: { id: 'drawing-1' } });
  for (let i = 0; i < 12; i += 1) {
    jest.advanceTimersByTime(10000);
    sockets[0].push({ type: 'pong' });
  }
  expect(sockets).toHaveLength(1);
  expect(callbacks.onItem).toHaveBeenCalledTimes(1);
});

test('starts and advances queued drawings when a healthy socket misses notifications from another instance', async () => {
  const currentUrl = 'https://example.test/api/drawing-donation/current?token=draw_test&renderer=v2';
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ item: null }) });
  const callbacks = connect({ currentUrl });
  await flush();
  sockets[0].push({ type: 'drawing-donation.current', item: null });
  callbacks.onItem.mockClear();
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ item: { id: 'drawing-1' } }) });
  jest.advanceTimersByTime(3000); await flush();
  expect(callbacks.onItem).toHaveBeenLastCalledWith({ id: 'drawing-1' });
  expect(new URL(fetch.mock.calls.at(-1)[0]).searchParams.get('knownItemId')).toBe('');

  fetch.mockResolvedValue({ ok: true, json: async () => ({ unchanged: true, itemId: 'drawing-1' }) });
  for (let i = 0; i < 5; i += 1) {
    jest.advanceTimersByTime(3000); sockets[0].push({ type: 'pong' }); await flush();
  }
  expect(callbacks.onItem).toHaveBeenCalledTimes(1);
  expect(new URL(fetch.mock.calls.at(-1)[0]).searchParams.get('knownItemId')).toBe('drawing-1');

  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ item: { id: 'drawing-2' } }) });
  jest.advanceTimersByTime(3000); await flush();
  expect(callbacks.onItem).toHaveBeenLastCalledWith({ id: 'drawing-2' });
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ item: null }) });
  jest.advanceTimersByTime(3000); await flush();
  expect(callbacks.onItem).toHaveBeenLastCalledWith(null);
  expect(sockets).toHaveLength(1);
});

test('ignores stale HTTP snapshots that arrive after a newer socket snapshot', async () => {
  let resolveJson;
  fetch.mockResolvedValueOnce({ ok: true, json: () => new Promise((resolve) => { resolveJson = resolve; }) });
  const callbacks = connect({ currentUrl: 'https://example.test/current' });
  await flush();
  sockets[0].push({ type: 'drawing-donation.current', item: { id: 'new' } });
  resolveJson({ item: { id: 'old' } }); await flush();
  expect(callbacks.onItem.mock.calls).toEqual([[{ id: 'new' }]]);
});

test('keeps playing across API failures and resumes reconciliation after a timeout', async () => {
  fetch.mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const callbacks = connect({ currentUrl: 'https://example.test/current' });
  sockets[0].push({ type: 'drawing-donation.current', item: { id: 'playing' } });
  jest.advanceTimersByTime(9000); await flush();
  expect(fetch).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1000); await flush();
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  fetch.mockResolvedValueOnce({ ok: false, status: 500 });
  jest.advanceTimersByTime(2000); await flush();
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ error: 'invalid_snapshot' }) });
  jest.advanceTimersByTime(3000); await flush();
  expect(callbacks.onItem.mock.calls).toEqual([[{ id: 'playing' }]]);
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ item: { id: 'next' } }) });
  jest.advanceTimersByTime(3000); await flush();
  expect(callbacks.onItem).toHaveBeenLastCalledWith({ id: 'next' });
});

test('handles a renderer update discovered by polling and aborts pending polls on cleanup', async () => {
  fetch.mockResolvedValueOnce({ ok: false, status: 426 });
  const callbacks = connect({ currentUrl: 'https://example.test/current' });
  await flush();
  expect(callbacks.onUpdateRequired).toHaveBeenLastCalledWith(true);
  let resolveResponse;
  fetch.mockImplementationOnce(() => new Promise((resolve) => { resolveResponse = resolve; }));
  jest.advanceTimersByTime(3000);
  const signal = fetch.mock.calls.at(-1)[1].signal;
  cleanups.pop()();
  expect(signal.aborted).toBe(true);
  resolveResponse({ ok: true, json: async () => ({ item: { id: 'late' } }) }); await flush();
  jest.advanceTimersByTime(60000); await flush();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(callbacks.onItem).not.toHaveBeenCalled();
});

test('handles renderer updates, network recovery, and disposes every reconnect listener', () => {
  const callbacks = connect();
  sockets[0].push({ type: 'drawing-donation.update-required' });
  expect(callbacks.onUpdateRequired).toHaveBeenLastCalledWith(true);
  window.dispatchEvent(new Event('online'));
  expect(sockets).toHaveLength(2);
  sockets[1].push({ type: 'drawing-donation.current', item: null });
  expect(callbacks.onUpdateRequired).toHaveBeenLastCalledWith(false);
  cleanups.pop()();
  window.dispatchEvent(new Event('online'));
  document.dispatchEvent(new Event('visibilitychange'));
  jest.advanceTimersByTime(120000);
  expect(sockets).toHaveLength(2);
});

test('automatically refreshes an outdated renderer after the retry delay', async () => {
  cleanups.push(scheduleDrawingOverlayReload(15000));
  jest.advanceTimersByTime(15000);
  await flush();
  expect(fetch).toHaveBeenCalledWith(window.location.href, expect.objectContaining({ method: 'HEAD', cache: 'no-store' }));
  expect(window.location.reload).toHaveBeenCalledTimes(1);
  expect(window.sessionStorage.setItem).toHaveBeenCalled();
});

test('rate-limits reloads across page loads and cancels them when recovery succeeds', async () => {
  window.sessionStorage.getItem.mockReturnValue(String(Date.now() - 5000));
  const cancel = scheduleDrawingOverlayReload(15000);
  cleanups.push(cancel);
  jest.advanceTimersByTime(54000);
  await flush();
  expect(fetch).not.toHaveBeenCalled();
  cancel();
  jest.advanceTimersByTime(120000);
  await flush();
  expect(window.location.reload).not.toHaveBeenCalled();
});

test('keeps the overlay document during frontend downtime and refreshes once it recovers', async () => {
  fetch.mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true });
  cleanups.push(scheduleDrawingOverlayReload(15000));
  jest.advanceTimersByTime(15000);
  await flush();
  expect(window.location.reload).not.toHaveBeenCalled();
  jest.advanceTimersByTime(60000);
  await flush();
  expect(window.location.reload).toHaveBeenCalledTimes(1);
});
