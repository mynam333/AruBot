const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadMetadataParser() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'browser-extension', 'chzzk-video-metadata.js'),
    'utf8'
  );
  const context = { self: {}, URL };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.self.AruChzzkVideoMetadata;
}

describe('CHZZK extension video metadata parser', () => {
  const metadata = loadMetadataParser();

  test('MV3 background startup imports the metadata parser without an initialization error', async () => {
    const extensionRoot = path.join(__dirname, '..', 'browser-extension');
    const eventTarget = () => ({ addListener: jest.fn() });
    const chrome = {
      alarms: { create: jest.fn(), onAlarm: eventTarget() },
      runtime: {
        onInstalled: eventTarget(),
        onMessage: eventTarget(),
        onStartup: eventTarget(),
        sendMessage: jest.fn(async () => undefined)
      },
      scripting: { executeScript: jest.fn(async () => undefined) },
      storage: {
        local: {
          get: jest.fn(async () => ({})),
          set: jest.fn(async () => undefined)
        },
        onChanged: eventTarget()
      },
      tabs: { query: jest.fn(async () => []) },
      windows: { getLastFocused: jest.fn(async () => null) }
    };
    const context = {
      AbortController,
      URL,
      chrome,
      clearInterval,
      clearTimeout,
      console,
      fetch,
      self: {},
      setInterval: jest.fn(() => 1),
      setTimeout,
      structuredClone
    };
    vm.createContext(context);
    context.importScripts = (...files) => {
      for (const file of files) {
        const source = fs.readFileSync(path.join(extensionRoot, file), 'utf8');
        vm.runInContext(source, context, { filename: file });
      }
    };

    const background = fs.readFileSync(path.join(extensionRoot, 'background.js'), 'utf8');
    expect(() => vm.runInContext(background, context, { filename: 'background.js' })).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));

    expect(context.self.AruChzzkVideoMetadata).toBeDefined();
    expect(chrome.alarms.create).toHaveBeenCalledWith('aru-pause-tick', { periodInMinutes: 0.5 });
  });

  test('a CHZZK packet without endSecond resolves YouTube metadata before pausing', async () => {
    const extensionRoot = path.join(__dirname, '..', 'browser-extension');
    const eventTarget = () => ({ addListener: jest.fn() });
    const settings = {
      monitoring: true,
      extraDelaySec: 1,
      services: {
        chzzk: {
          enabled: true,
          overlayUrl: 'https://chzzk.naver.com/video-donation/video@test-session'
        },
        cime: { enabled: false, overlayUrl: '' },
        toonation: { enabled: false, overlayUrl: '' },
        arubot: { enabled: false, overlayUrl: '' }
      }
    };
    const chrome = {
      alarms: { create: jest.fn(), onAlarm: eventTarget() },
      runtime: {
        onInstalled: eventTarget(),
        onMessage: eventTarget(),
        onStartup: eventTarget(),
        sendMessage: jest.fn(async () => undefined)
      },
      scripting: { executeScript: jest.fn(async () => undefined) },
      storage: {
        local: {
          get: jest.fn(async () => ({ settings })),
          set: jest.fn(async () => undefined)
        },
        onChanged: eventTarget()
      },
      tabs: {
        query: jest.fn(async () => [{ id: 7, url: 'https://www.youtube.com/watch?v=idle' }]),
        sendMessage: jest.fn(async () => undefined)
      },
      windows: { getLastFocused: jest.fn(async () => null) }
    };
    const fetch = jest.fn(async (input) => {
      const url = String(input);
      if (url.includes('/session-url')) {
        return {
          ok: true,
          json: async () => ({
            content: { sessionUrl: 'https://ssio09.nchat.naver.com:443?auth=test-token' }
          })
        };
      }
      if (url.startsWith('https://www.youtube.com/watch?')) {
        return {
          ok: true,
          text: async () => '<script>{"videoDetails":{"lengthSeconds":"33"}}</script>'
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const sockets = [];
    class MockWebSocket {
      static OPEN = 1;

      constructor(url) {
        this.url = url;
        this.readyState = MockWebSocket.OPEN;
        this.listeners = new Map();
        this.sent = [];
        sockets.push(this);
      }

      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
      }

      emit(type, event = {}) {
        for (const listener of this.listeners.get(type) || []) listener(event);
      }

      send(message) {
        this.sent.push(message);
      }

      close() {}
    }
    const context = {
      AbortController,
      URL,
      WebSocket: MockWebSocket,
      chrome,
      clearInterval: jest.fn(),
      clearTimeout: jest.fn(),
      console,
      fetch,
      self: {},
      setInterval: jest.fn(() => 1),
      setTimeout: jest.fn(() => 1),
      structuredClone
    };
    vm.createContext(context);
    context.importScripts = (...files) => {
      for (const file of files) {
        const source = fs.readFileSync(path.join(extensionRoot, file), 'utf8');
        vm.runInContext(source, context, { filename: file });
      }
    };
    const background = fs.readFileSync(path.join(extensionRoot, 'background.js'), 'utf8');
    vm.runInContext(background, context, { filename: 'background.js' });

    for (let attempt = 0; attempt < 10 && sockets.length === 0; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toContain('EIO=3');
    expect(sockets[0].url).not.toContain('EIO=4');

    sockets[0].emit('message', {
      data: `42${JSON.stringify(['donation', JSON.stringify({
        donationId: 'donation-without-end',
        startSecond: 5,
        endSecond: null,
        videoType: 'YOUTUBE',
        videoId: 'o6OWF-IMFVs'
      })])}`
    });
    for (let attempt = 0; attempt < 10 && chrome.tabs.sendMessage.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    const pauseCall = chrome.tabs.sendMessage.mock.calls.find(([, message]) => message?.type === 'aru-pause:pause');
    expect(pauseCall).toBeDefined();
    expect(pauseCall[0]).toBe(7);
    expect(pauseCall[1].until - Date.now()).toBeGreaterThanOrEqual(28000);
    expect(pauseCall[1].until - Date.now()).toBeLessThanOrEqual(30000);
    expect(fetch.mock.calls.some(([url]) => String(url).startsWith('https://www.youtube.com/watch?'))).toBe(true);
  });

  test('identifies YouTube and CHZZK clip donations from current event fields', () => {
    const youtube = metadata.extractDonationMedia({
      videoType: 'YOUTUBE',
      videoId: 'o6OWF-IMFVs'
    });
    const clip = metadata.extractDonationMedia({
      videoType: 'CHZZK_CLIP',
      videoId: 'zn2c8wcIXB'
    });

    expect({ ...youtube }).toEqual({
      kind: 'youtube',
      id: 'o6OWF-IMFVs',
      url: 'https://www.youtube.com/watch?v=o6OWF-IMFVs'
    });
    expect({ ...clip }).toEqual({
      kind: 'chzzk_clip',
      id: 'zn2c8wcIXB',
      url: 'https://chzzk.naver.com/clips/zn2c8wcIXB'
    });
  });

  test('parses current YouTube watch metadata without using a quota API', () => {
    const html = '<script>{"videoDetails":{"videoId":"o6OWF-IMFVs","lengthSeconds":"33"}}</script>';
    expect(metadata.parseYouTubeDurationHtml(html)).toBe(33);
    expect(metadata.parseYouTubeDurationHtml('{\\"approxDurationMs\\":\\"33111\\"}')).toBe(34);
  });

  test('reads the CHZZK clip detail duration and applies an open-ended start offset', () => {
    const detail = {
      code: 200,
      content: {
        clipUID: 'zn2c8wcIXB',
        duration: 36
      }
    };
    const payload = {
      startSecond: 6,
      endSecond: null,
      videoType: 'CHZZK_CLIP',
      videoId: 'zn2c8wcIXB'
    };

    const total = metadata.extractDurationSeconds(detail.content);
    expect(total).toBe(36);
    expect(metadata.durationForPlaybackRange(payload, total)).toBe(30);
  });

  test('supports renamed playback range fields and caps them at media duration', () => {
    expect(metadata.extractPlaybackRange({
      videoStartSecond: 8,
      videoEndSecond: 20
    })).toEqual(expect.objectContaining({ startSec: 8, endSec: 20 }));
    expect(metadata.durationForPlaybackRange({
      playStartSecond: 8,
      playEndSecond: 99
    }, 33)).toBe(25);
    expect(metadata.durationForPlaybackRange({ startSecond: 100 }, 10800)).toBe(10700);
  });
});
