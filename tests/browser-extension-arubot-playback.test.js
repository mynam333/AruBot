const fs = require('fs');
const path = require('path');
const vm = require('vm');

const backgroundSource = fs.readFileSync(path.join(__dirname, '..', 'browser-extension/background.js'), 'utf8');
const contentSource = fs.readFileSync(path.join(__dirname, '..', 'browser-extension/content-youtube.js'), 'utf8');

async function flushMessages() {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function response(payload) {
  return { ok: true, text: async () => JSON.stringify(payload) };
}

function playback(id = 'donation-1', durationSec = 120, extra = {}) {
  return {
    type: 'start',
    item: { id, title: id, startSec: 0, durationSec },
    paused: false,
    idleDeferred: false,
    atSec: 0,
    elapsedSec: 0,
    serverNow: Date.now(),
    ...extra
  };
}

function createYouTubePage(paused = false) {
  let onMessage;
  const video = {
    paused,
    ended: false,
    readyState: 4,
    pause: jest.fn(function () { this.paused = true; }),
    play: jest.fn(function () { this.paused = false; return Promise.resolve(); })
  };
  const countdown = { textContent: '' };
  const overlay = {
    style: {},
    setAttribute() {},
    querySelector: () => countdown
  };
  vm.runInNewContext(contentSource, {
    window: {},
    chrome: { runtime: { onMessage: { addListener: (listener) => { onMessage = listener; } } } },
    document: {
      querySelectorAll: () => [video],
      createElement: () => overlay,
      documentElement: { contains: () => true, appendChild() {} }
    },
    Date, setInterval, clearInterval
  });
  return { video, overlay, countdown, onMessage };
}

async function createExtension({ fetchSnapshot, initiallyPaused = false, extraDelaySec = 1, focusedOnly = false } = {}) {
  const page = createYouTubePage(initiallyPaused);
  const sockets = [];
  const listeners = {};
  const chrome = {
    runtime: {
      sendMessage: jest.fn().mockResolvedValue(undefined),
      onMessage: { addListener: (listener) => { listeners.message = listener; } },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} }
    },
    storage: {
      local: {
        get: jest.fn().mockResolvedValue({ settings: {
          monitoring: true,
          extraDelaySec,
          resumeFocusedOnly: focusedOnly,
          services: { arubot: { enabled: true, overlayUrl: 'https://arubot.yuaru.com/pvd/test-token' } }
        } }),
        set: jest.fn().mockResolvedValue(undefined)
      },
      onChanged: { addListener() {} }
    },
    tabs: {
      query: jest.fn().mockResolvedValue([{ id: 1, windowId: 1, url: 'https://www.youtube.com/watch?v=test' }]),
      sendMessage: jest.fn(async (_tabId, message) => page.onMessage(message))
    },
    windows: { getLastFocused: jest.fn().mockResolvedValue({ id: 1 }) },
    scripting: { executeScript: jest.fn().mockResolvedValue(undefined) },
    alarms: {
      create: jest.fn(),
      onAlarm: { addListener: (listener) => { listeners.alarm = listener; } }
    }
  };
  class FakeWebSocket {
    static OPEN = 1;
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.listeners = {};
      this.send = jest.fn();
      sockets.push(this);
    }
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    }
    close() {
      this.readyState = 3;
      this.listeners.close?.();
    }
  }
  const fetchMock = jest.fn(fetchSnapshot || (async () => response({ item: null, serverNow: Date.now() })));
  const context = vm.createContext({
    chrome,
    self: {},
    console,
    URL,
    Date,
    AbortController,
    structuredClone: (value) => JSON.parse(JSON.stringify(value)),
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: fetchMock,
    WebSocket: FakeWebSocket
  });
  vm.runInContext(`${backgroundSource}\nglobalThis.testHooks = { runtime, enqueuePause, getPublicState };`, context);
  await flushMessages();
  const socket = sockets[0];
  socket.readyState = 1;
  socket.listeners.open();
  await flushMessages();
  chrome.tabs.sendMessage.mockClear();
  return {
    ...context.testHooks,
    page,
    chrome,
    fetchMock,
    socket,
    listeners,
    async emit(payload) {
      socket.listeners.message({ data: JSON.stringify(payload) });
      await flushMessages();
    },
    async command(message) {
      const reply = await new Promise((resolve) => listeners.message(message, {}, resolve));
      await flushMessages();
      return reply;
    },
    lastMessage() {
      return chrome.tabs.sendMessage.mock.calls.at(-1)?.[1];
    }
  };
}

describe('AruBot extension playback synchronization', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-29T00:00:00Z'));
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('ending or skipping the last donation resumes YouTube immediately without the extra delay', async () => {
    const ext = await createExtension({ extraDelaySec: 20 });
    await ext.emit(playback('long-video', 600));
    expect(ext.page.video.paused).toBe(true);

    await ext.emit({ type: 'start', item: null, queue: [], serverNow: Date.now() });

    expect(ext.lastMessage()).toEqual({ type: 'aru-pause:resume' });
    expect(ext.page.video.paused).toBe(false);
    expect(ext.page.video.play).toHaveBeenCalledTimes(1);
    expect(ext.getPublicState().pauseUntil).toBe(0);
    expect(ext.getPublicState().services.arubot.queue).toEqual([]);
    expect(ext.runtime.resumeTimer).toBeNull();
  });

  test('skipping to the next donation replaces the old deadline without resuming between videos', async () => {
    const ext = await createExtension();
    await ext.emit(playback('long-video', 600));
    await jest.advanceTimersByTimeAsync(2000);
    await ext.emit(playback('next-video', 3));

    expect(ext.getPublicState().services.arubot.queue).toHaveLength(1);
    expect(ext.lastMessage().until).toBe(Date.now() + 4000);
    expect(ext.page.video.paused).toBe(true);
    expect(ext.page.video.play).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(4200);
    expect(ext.page.video.paused).toBe(false);
  });

  test('resyncing the same donation updates its position instead of deduplicating or accumulating time', async () => {
    const ext = await createExtension();
    await ext.emit(playback('same-video', 120));
    await ext.emit(playback('same-video', 120, { atSec: 100, elapsedSec: 100 }));

    expect(ext.getPublicState().services.arubot.queue).toHaveLength(1);
    expect(ext.lastMessage().until).toBe(Date.now() + 21000);
  });

  test('seek controls override stale elapsed time and account for a nonzero clip start', async () => {
    const ext = await createExtension();
    await ext.emit(playback('clip', 90, {
      item: { id: 'clip', startSec: 60, durationSec: 90 }, atSec: 60
    }));
    await ext.emit({ type: 'control', op: 'seek', atSec: 145, paused: false, serverNow: Date.now() });

    expect(ext.lastMessage().until).toBe(Date.now() + 6000);
    await jest.advanceTimersByTimeAsync(6200);
    expect(ext.page.video.paused).toBe(false);
  });

  test('paused donations remain paused beyond their original duration and resume their remaining countdown on play', async () => {
    const ext = await createExtension();
    await ext.emit(playback('short-video', 10));
    await ext.emit({ type: 'control', op: 'pause', atSec: 2, paused: true, serverNow: Date.now() });
    ext.fetchMock.mockImplementation(async () => response(playback('short-video', 10, {
      atSec: 2, elapsedSec: 2, paused: true
    })));

    await jest.advanceTimersByTimeAsync(60000);
    expect(ext.page.video.paused).toBe(true);
    expect(ext.page.video.play).not.toHaveBeenCalled();

    await ext.emit({ type: 'control', op: 'play', atSec: 2, paused: false, serverNow: Date.now() });
    expect(ext.lastMessage().until).toBe(Date.now() + 9000);
    await jest.advanceTimersByTimeAsync(9200);
    expect(ext.page.video.paused).toBe(false);
  });

  test('unknown video duration still pauses until the actual completion signal', async () => {
    const ext = await createExtension();
    await ext.emit(playback('unknown-length', undefined, { item: { id: 'unknown-length' } }));
    expect(ext.page.video.paused).toBe(true);
    await ext.emit({ type: 'start', item: null });
    expect(ext.page.video.paused).toBe(false);
  });

  test('idle music and deferred donations do not pause YouTube until the donation actually starts', async () => {
    const ext = await createExtension();
    await ext.emit(playback('waiting-video', 120, { idleDeferred: true, paused: true }));
    expect(ext.page.video.paused).toBe(false);
    expect(ext.getPublicState().pauseUntil).toBe(0);

    await ext.emit({ type: 'control', op: 'idle-control', command: { op: 'skip' } });
    expect(ext.page.video.paused).toBe(false);
    await ext.emit(playback('waiting-video', 120));
    expect(ext.page.video.paused).toBe(true);
  });

  test('ending AruBot playback preserves another service pause and shortens the combined deadline', async () => {
    const ext = await createExtension();
    await ext.enqueuePause('cime', 8, { id: 'other-donation' });
    const otherEnd = ext.getPublicState().services.cime.endAt;
    await ext.emit(playback('long-video', 600));
    await ext.emit({ type: 'start', item: null });

    expect(ext.lastMessage().until).toBe(otherEnd);
    expect(ext.getPublicState().services.cime.queue).toHaveLength(1);
    expect(ext.getPublicState().services.arubot.queue).toEqual([]);
    expect(ext.page.video.play).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(9300);
    expect(ext.page.video.paused).toBe(false);
  });

  test('a late initial HTTP response cannot restore an already skipped donation', async () => {
    const pending = deferred();
    const ext = await createExtension({ fetchSnapshot: () => pending.promise });
    await ext.emit(playback('old-video', 600));
    await ext.emit({ type: 'start', item: null, serverNow: Date.now() });
    pending.resolve(response(playback('old-video', 600)));
    await flushMessages();

    expect(ext.page.video.paused).toBe(false);
    expect(ext.getPublicState().pauseUntil).toBe(0);
  });

  test('older server snapshots cannot undo newer playback state', async () => {
    const ext = await createExtension();
    const old = playback('old-video', 600);
    await jest.advanceTimersByTimeAsync(1000);
    await ext.emit({ type: 'start', item: null, serverNow: Date.now() });
    await ext.emit(old);
    expect(ext.page.video.paused).toBe(false);
  });

  test('a missing completion socket event is recovered by the periodic current-playback snapshot', async () => {
    const ext = await createExtension();
    await ext.emit(playback('long-video', 600));
    await jest.advanceTimersByTimeAsync(15000);

    expect(ext.fetchMock).toHaveBeenCalledTimes(2);
    expect(ext.page.video.paused).toBe(false);
    expect(ext.getPublicState().pauseUntil).toBe(0);
  });

  test('disconnected paused playback has a finite fallback instead of permanently pausing YouTube', async () => {
    const ext = await createExtension();
    await ext.emit(playback('video', 600, { paused: true }));
    ext.runtime.connectors.get('arubot').close();
    await jest.advanceTimersByTimeAsync(45300);

    expect(ext.fetchMock).toHaveBeenCalledTimes(1);
    expect(ext.page.video.paused).toBe(false);
  });

  test('late responses from a stopped connector cannot pause YouTube again', async () => {
    const pending = deferred();
    const ext = await createExtension({ fetchSnapshot: () => pending.promise });
    await ext.command({ type: 'toggle-monitoring', monitoring: false });
    pending.resolve(response(playback('late-video', 600)));
    await flushMessages();

    expect(ext.page.video.paused).toBe(false);
    expect(ext.getPublicState().pauseUntil).toBe(0);
  });

  test('manual resume ignores resyncs for the current item but still pauses the next donation', async () => {
    const ext = await createExtension();
    await ext.emit(playback('dismissed-video', 600));
    await ext.command({ type: 'clear-pause' });
    await ext.emit(playback('dismissed-video', 600));
    expect(ext.page.video.paused).toBe(false);
    await ext.emit(playback('next-video', 120));
    expect(ext.page.video.paused).toBe(true);
  });

  test('the alarm resumes expired pauses even when the worker timer was missed', async () => {
    const ext = await createExtension();
    await ext.emit(playback('short-video', 3));
    jest.setSystemTime(Date.now() + 10000);
    ext.listeners.alarm({ name: 'aru-pause-tick' });
    await flushMessages();

    expect(ext.page.video.paused).toBe(false);
    expect(ext.getPublicState().pauseUntil).toBe(0);
  });

  test('an originally paused YouTube video is not started by donation completion', async () => {
    const ext = await createExtension({ initiallyPaused: true });
    await ext.emit(playback());
    await ext.emit({ type: 'start', item: null });
    expect(ext.page.video.paused).toBe(true);
    expect(ext.page.video.play).not.toHaveBeenCalled();
  });

  test('resuming reaches the paused YouTube window even after focus moves to another window', async () => {
    const ext = await createExtension({ focusedOnly: true });
    await ext.emit(playback());
    ext.chrome.windows.getLastFocused.mockResolvedValue({ id: 2 });
    await ext.emit({ type: 'start', item: null });
    expect(ext.page.video.paused).toBe(false);
  });

  test('a slow tab lookup cannot deliver an old pause after completion', async () => {
    const ext = await createExtension();
    const pending = deferred();
    ext.chrome.tabs.query.mockImplementationOnce(() => pending.promise);
    await ext.emit(playback());
    await ext.emit({ type: 'start', item: null });
    pending.resolve([{ id: 1, windowId: 1, url: 'https://www.youtube.com/watch?v=test' }]);
    await flushMessages();

    expect(ext.chrome.tabs.sendMessage.mock.calls.map((call) => call[1].type)).toEqual(['aru-pause:resume']);
    expect(ext.page.video.paused).toBe(false);
  });
});
