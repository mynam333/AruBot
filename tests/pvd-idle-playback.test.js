const loadSource = require('./helpers/load-source.cjs');
const idleModel = loadSource('src/components/pvdIdlePlaylist.ts');
const mixPlayer = loadSource('src/components/pvdYouTubeMixPlayer.ts', {
  '../../shared/youtube-mix.js': loadSource('shared/youtube-mix.js'),
  './pvdIdlePlaylist': idleModel,
});
const track = (n) => ({ id: `youtube:video00000${n}`, mediaId: `video00000${n}`, title: `Song ${n}`, durationSec: 180 });
const playlist = (tracks = []) => ({ enabled: true, mode: 'recommended', topic: 'jazz', loop: true, shuffle: false, tracks });
const flush = async () => { for (let i = 0; i < 25; i += 1) await Promise.resolve(); };
let cleanup;
let savedGlobals;

beforeEach(() => {
  jest.useFakeTimers();
  savedGlobals = Object.fromEntries(['window', 'document', 'WebSocket', 'fetch'].map((name) => [name, global[name]]));
});

afterEach(() => {
  cleanup?.();
  for (const [name, value] of Object.entries(savedGlobals)) {
    if (value === undefined) delete global[name];
    else global[name] = value;
  }
  jest.clearAllTimers();
  jest.useRealTimers();
});

function mount(initial, getRecommendations) {
  let state = initial;
  let socket;
  let player;
  const effects = [];
  const loads = [];
  const calls = [];
  const mixLoads = [];
  const node = () => ({ style: {}, dataset: {}, appendChild() {}, replaceChildren() {} });
  class Player {
    constructor(_mount, options) {
      this.id = options.videoId;
      this.events = options.events;
      this.ids = options.playerVars?.list ? [track(1).mediaId, track(2).mediaId] : [];
      this.index = 0;
      player = this;
      loads.push(this.id);
      if (options.playerVars?.list) Promise.resolve().then(() => { this.events.onReady({ target: this }); this.emit(1); });
    }
    loadVideoById({ videoId }) { this.id = videoId; loads.push(videoId); }
    getVideoData() { return { video_id: this.id }; }
    getCurrentTime() { return 0; }
    getDuration() { return 180; }
    getPlaylist() { return this.ids; }
    getPlaylistIndex() { return this.index; }
    playVideoAt(index) { this.index = index; this.id = this.ids[index]; loads.push(this.id); Promise.resolve().then(() => this.emit(1)); }
    loadPlaylist({ list }) {
      mixLoads.push(list);
      const n = Number(list.slice(-1));
      this.ids = [track(n).mediaId, track(n + 1).mediaId, track(n + 2).mediaId];
      this.index = 0; this.id = this.ids[0];
      Promise.resolve().then(() => this.emit(1));
    }
    setLoop() {}
    playVideo() {}
    pauseVideo() {}
    stopVideo() {}
    destroy() {}
    setVolume() {}
    unMute() {}
    seekTo() {}
    emit(data) { this.events.onStateChange({ data, target: this }); }
  }
  global.window = { YT: { Player, PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 } }, location: { origin: 'http://localhost', pathname: '/pvd/test' }, addEventListener() {}, removeEventListener() {}, setTimeout };
  global.document = { hidden: false, createElement: node, addEventListener() {}, removeEventListener() {} };
  global.WebSocket = class { constructor() { socket = this; } close() {} };
  global.fetch = jest.fn(async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ url, body });
    if (url.includes('/next-by-token')) return { ok: true, json: () => getRecommendations(body) };
    if (url.includes('/activate-by-token')) state = { ...state, idleDeferred: false };
    return { ok: true, json: async () => state };
  });
  const jsx = (_type, props) => { if (props?.ref) props.ref.current = node(); return null; };
  const { default: Viewer } = loadSource('src/components/PvdViewer.tsx', {
    react: { useCallback: (fn) => fn, useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}], useRef: (current) => ({ current }), useEffect: (fn) => effects.push(fn) },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/pvdIdlePlaylist': idleModel,
    '@/components/pvdYouTubeMixPlayer': mixPlayer,
    '@/components/youtubeDurationProbe': { createYouTubeDurationProbeRunner: () => ({ dispose() {} }) },
    '@/shared/api/http': { getBrowserApiBase: () => 'http://localhost' },
  });
  Viewer({ viewerToken: 'test' });
  const disposers = effects.map((effect) => effect());
  cleanup = () => disposers.reverse().forEach((dispose) => { if (typeof dispose === 'function') dispose(); });
  return {
    loads, calls, mixLoads,
    emit: (data) => player.emit(data),
    push: (payload) => {
      state = payload;
      socket.onmessage({ data: JSON.stringify({ type: 'start', ...payload }) });
    },
  };
}

test('autoplays an empty topic and retains fetched songs across server resynchronization', async () => {
  const original = { item: null, idlePlaylist: playlist() };
  const harness = mount(original, async () => ({ topic: 'jazz', tracks: [track(1), track(2)] }));
  await flush();
  expect(harness.loads).toEqual(['video000001']);
  harness.push(original);
  await flush();
  harness.emit(0);
  await flush();
  expect(harness.loads).toEqual(['video000001', 'video000002']);
  const nextCalls = harness.calls.filter((call) => call.url.includes('/next-by-token'));
  expect(nextCalls).toHaveLength(1);
});

test('continues with a new Mix after exhaustion without additional searches', async () => {
  let batches = 0;
  const harness = mount({ item: null, idlePlaylist: playlist() }, async () => ({ topic: 'jazz', tracks: batches++ ? [track(3), track(4)] : [track(1), track(2)] }));
  await flush();
  harness.emit(0);
  await flush();
  harness.emit(0);
  await flush();
  jest.advanceTimersByTime(31000);
  await flush();
  expect(harness.loads).toEqual(['video000001', 'video000002', 'video000003']);
  const requests = harness.calls.filter((call) => call.url.includes('/next-by-token'));
  expect(requests).toHaveLength(1);
  expect(requests[0].body.seedOnly).toBe(true);
  expect(harness.mixLoads).toEqual(['RDvideo000002']);
});

test('ignores an outstanding recommendation response after idle music is disabled', async () => {
  let finish;
  const harness = mount({ item: null, idlePlaylist: playlist() }, () => new Promise((resolve) => { finish = resolve; }));
  await flush();
  harness.push({ item: null, idlePlaylist: { ...playlist(), enabled: false } });
  finish({ topic: 'jazz', tracks: [track(1)] });
  await flush();
  expect(harness.loads).toEqual([]);
});

test('finishes idle music, activates a deferred donation, then resumes at the next song', async () => {
  const idlePlaylist = playlist([1, 2, 3, 4].map(track));
  const harness = mount({ item: null, idlePlaylist }, async () => ({ topic: 'jazz', tracks: [track(5)] }));
  await flush();
  harness.emit(1);
  harness.push({ item: { id: 'donation-1', mediaProvider: 'youtube', videoId: 'donation001' }, idleDeferred: true, idlePlaylist });
  expect(harness.loads).toEqual(['video000001']);
  harness.emit(0);
  await flush();
  expect(harness.calls.filter((call) => call.url.includes('/activate-by-token'))).toHaveLength(1);
  expect(harness.loads).toEqual(['video000001', 'donation001']);
  harness.push({ item: null, idlePlaylist });
  await flush();
  expect(harness.loads).toEqual(['video000001', 'donation001', 'video000002']);
});
