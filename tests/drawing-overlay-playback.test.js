const loadSource = require('./helpers/load-source.cjs');
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
let savedGlobals;
let cleanup;

beforeEach(() => {
  jest.useFakeTimers();
  savedGlobals = Object.fromEntries(['window', 'document', 'fetch', 'requestAnimationFrame', 'cancelAnimationFrame'].map((key) => [key, global[key]]));
});
afterEach(() => {
  cleanup?.();
  for (const [key, value] of Object.entries(savedGlobals)) {
    if (value === undefined) delete global[key]; else global[key] = value;
  }
  jest.clearAllTimers(); jest.useRealTimers();
});

function mount({ canvasAvailable = true } = {}) {
  const hooks = [];
  let cursor = 0, dirty = true, pending = [], callbacks;
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const memo = (factory, deps) => {
    const index = cursor++;
    if (!hooks[index] || !equal(hooks[index].deps, deps)) hooks[index] = { value: factory(), deps };
    return hooks[index].value;
  };
  const context = { clearRect: jest.fn() };
  const node = { style: {}, width: 1280, height: 720, getContext: () => canvasAvailable ? context : null };
  const audio = { load: jest.fn(), pause: jest.fn(), play: jest.fn().mockResolvedValue(undefined) };
  const draw = jest.fn();
  const loadOriginal = jest.fn().mockResolvedValue(null);
  const reload = jest.fn(() => jest.fn());
  const disconnected = jest.fn();
  global.window = Object.assign(new EventTarget(), { location: { origin: 'http://localhost' }, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, setTimeout, clearTimeout });
  global.document = {};
  global.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 16);
  global.cancelAnimationFrame = clearTimeout;
  global.fetch = jest.fn(async (_url, options) => ({ ok: true, status: 200, json: async () => ({ item: { id: JSON.parse(options.body).itemId, status: 'done' } }) }));
  const jsx = (type, props) => {
    if (props?.ref) props.ref.current = type === 'audio' ? audio : node;
    return { type, props };
  };
  const { default: Overlay } = loadSource('src/components/DrawingDonationOverlay.tsx', {
    react: {
      useState: (initial) => {
        const index = cursor++;
        hooks[index] ||= { value: typeof initial === 'function' ? initial() : initial };
        return [hooks[index].value, (next) => {
          const value = typeof next === 'function' ? next(hooks[index].value) : next;
          if (!Object.is(value, hooks[index].value)) { hooks[index].value = value; dirty = true; }
        }];
      },
      useRef: (initial) => { const index = cursor++; return hooks[index] ||= { current: initial }; },
      useMemo: memo,
      useCallback: (callback, deps) => memo(() => callback, deps),
      useEffect: (effect, deps) => {
        const index = cursor++;
        if (!hooks[index] || !equal(hooks[index].deps, deps)) pending.push(() => {
          hooks[index]?.cleanup?.(); hooks[index] = { deps, cleanup: effect() };
        });
      },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/shared/api/http': { getBrowserApiBase: () => 'http://localhost', apiWsUrl: (path) => `ws://localhost${path}` },
    '@/shared/drawing/item-renderer': { createItemRenderer: () => ({ draw, clear: jest.fn() }), loadDrawingOriginal: loadOriginal },
    '@/shared/drawing/overlay-connection': { connectDrawingOverlay: (options) => { callbacks = options; return disconnected; }, scheduleDrawingOverlayReload: reload },
    '../../shared/drawing/document.js': { RENDERER_VERSION: 'test' },
  });
  const render = () => {
    while (dirty) {
      dirty = false; cursor = 0; pending = [];
      Overlay({ viewerToken: 'draw_test' });
      for (const effect of pending) effect();
    }
  };
  const settle = async () => { for (let i = 0; i < 5; i += 1) { await flush(); render(); } };
  render();
  cleanup = () => { hooks.forEach((hook) => hook.cleanup?.()); };
  return {
    draw, loadOriginal, reload, audio, disconnected, settle,
    receive: async (item) => { callbacks.onItem(item); await settle(); },
    advance: async (ms) => { jest.advanceTimersByTime(ms); await settle(); },
    item: (id = 'drawing-1') => ({ id, replay: { targetReplayMs: 100 }, resultHoldSec: 1 }),
    updateRequired: async () => { callbacks.onUpdateRequired(true); await settle(); },
  };
}

test('plays each drawing, confirms completion and starts the next item without replaying stale snapshots', async () => {
  const h = mount(); await h.receive(h.item());
  await h.advance(2100);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0][1].body).itemId).toBe('drawing-1');
  expect(h.draw).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'drawing-1' }), 1280, 720, Infinity, null);
  await h.receive(h.item());
  expect(h.audio.play).toHaveBeenCalledTimes(1);
  await h.receive(h.item('drawing-2'));
  await h.receive(h.item());
  await h.advance(2100);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[1][1].body).itemId).toBe('drawing-2');
  expect(h.audio.play).toHaveBeenCalledTimes(2);
});

test.each([null, { ok: false, status: 500 }, { ok: true, status: 200, json: async () => ({ item: null }) }])('retries unconfirmed completion without replaying the drawing (%j)', async (response) => {
  const h = mount();
  fetch.mockResolvedValueOnce(response);
  await h.receive(h.item()); await h.advance(2100);
  expect(fetch).toHaveBeenCalledTimes(1);
  await h.advance(3000);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(h.audio.play).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[1][1].body).itemId).toBe('drawing-1');
});

test('a late completion response for the previous drawing does not clear the next drawing', async () => {
  const h = mount(); let resolve;
  fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await h.receive(h.item()); await h.advance(2100);
  await h.receive(h.item('drawing-2'));
  resolve({ ok: true, status: 200, json: async () => ({ item: { id: 'drawing-1', status: 'done' } }) });
  await h.settle(); await h.receive(h.item()); await h.advance(2100);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[1][1].body).itemId).toBe('drawing-2');
});

test('times out a stalled completion response body and retries the same drawing', async () => {
  const h = mount();
  fetch.mockImplementationOnce(async (_url, { signal }) => ({ ok: true, status: 200,
    json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')))),
  }));
  await h.receive(h.item()); await h.advance(2100);
  await h.advance(10000); await h.advance(3000);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(h.audio.play).toHaveBeenCalledTimes(1);
});

test('a completion conflict for a removed drawing stops retries and permits the next item', async () => {
  const h = mount(); fetch.mockResolvedValueOnce({ ok: false, status: 409 });
  await h.receive(h.item()); await h.advance(2100); await h.advance(5000);
  expect(fetch).toHaveBeenCalledTimes(1);
  await h.receive(h.item('drawing-2')); await h.advance(2100);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('original-image failures retain the queue item and replay after loading recovers', async () => {
  const h = mount(); h.loadOriginal.mockRejectedValueOnce(new Error('storage offline'));
  await h.receive(h.item()); await h.advance(2500);
  expect(fetch).not.toHaveBeenCalled(); expect(h.draw).not.toHaveBeenCalled();
  await h.advance(500); await h.advance(2100);
  expect(h.loadOriginal).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('rendering failures request recovery without falsely completing an unseen drawing', async () => {
  const h = mount(); h.draw.mockImplementation(() => { throw new Error('canvas error'); });
  await h.receive(h.item()); await h.advance(2100);
  expect(fetch).not.toHaveBeenCalled();
  expect(h.reload).toHaveBeenCalledWith(60000);
});

test('canvas initialization failures trigger recovery rather than leaving playback stuck silently', async () => {
  const h = mount({ canvasAvailable: false }); await h.receive(h.item()); await h.advance(2100);
  expect(fetch).not.toHaveBeenCalled();
  expect(h.reload).toHaveBeenCalledWith(60000);
});

test('a renderer-version mismatch schedules an automatic refresh', async () => {
  const h = mount(); await h.updateRequired();
  expect(h.reload).toHaveBeenCalledWith(15000);
  expect(fetch).not.toHaveBeenCalled();
});

test('removing the current item cancels replay completion and leaves the next item untouched', async () => {
  const h = mount(); await h.receive(h.item());
  await h.advance(100); await h.receive(null); await h.advance(5000);
  expect(fetch).not.toHaveBeenCalled();
  await h.receive(h.item('drawing-2')); await h.advance(2100);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0][1].body).itemId).toBe('drawing-2');
});
