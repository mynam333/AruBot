const loadSource = require('./helpers/load-source.cjs');
const idleModel = loadSource('src/components/pvdIdlePlaylist.ts');
const mixPlayer = loadSource('src/components/pvdYouTubeMixPlayer.ts', {
  '../../shared/youtube-mix.js': loadSource('shared/youtube-mix.js'), './pvdIdlePlaylist': idleModel,
});
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
let cleanup;
let globals;
beforeEach(() => {
  jest.useFakeTimers();
  globals = Object.fromEntries(['window', 'document', 'WebSocket', 'fetch'].map((key) => [key, global[key]]));
});
afterEach(() => {
  cleanup?.();
  for (const [key, value] of Object.entries(globals)) {
    if (value === undefined) delete global[key]; else global[key] = value;
  }
  jest.clearAllTimers(); jest.useRealTimers();
});

function mount(initialPayload = {}) {
  const effects = [];
  const listeners = new Map();
  let socket;
  let player;
  let payload = { item: { id: 'donation-1', mediaProvider: 'youtube', videoId: 'video000001', startSec: 12 }, paused: false, atSec: 20, ...initialPayload };
  let getSnapshot = async () => payload;
  const calls = [];
  const node = () => ({ style: {}, dataset: {}, appendChild() {}, replaceChildren() {} });
  class Player {
    constructor(_mount, options) {
      this.id = options.videoId; this.events = options.events; this.time = 20;
      this.pauseVideo = jest.fn(); this.playVideo = jest.fn();
      this.seekTo = jest.fn((time) => { this.time = time; });
      player = this;
    }
    getVideoData() { return { video_id: this.id }; }
    getCurrentTime() { return this.time; }
    getDuration() { return 180; }
    loadVideoById({ videoId }) { this.id = videoId; }
    setVolume() {} unMute() {} unloadModule() {} destroy() {} stopVideo() {}
    ready() { this.events.onReady({ target: this }); }
    emit(data) { this.events.onStateChange({ data, target: this }); }
  }
  global.window = { YT: { Player, PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 } }, location: { origin: 'http://localhost', pathname: '/pvd/test' }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener() {}, setTimeout };
  global.document = { hidden: false, createElement: node, addEventListener() {}, removeEventListener() {} };
  global.WebSocket = class { constructor() { socket = this; } close() {} };
  global.fetch = jest.fn(async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ url, body });
    return { ok: true, json: url.includes('/now-playing') ? getSnapshot : async () => ({ ok: true }) };
  });
  const states = [];
  const refs = [];
  let stateIndex = 0;
  let refIndex = 0;
  let firstRender = true;
  let externalVideo;
  let externalVideoProps;
  const jsx = (type, props) => {
    if (props?.ref && !props.ref.current) props.ref.current = node();
    if (type === 'video') {
      externalVideo = props.ref.current;
      externalVideo.play ||= jest.fn();
      externalVideo.pause ||= jest.fn();
      externalVideo.currentTime ??= 0;
      externalVideoProps = props;
    }
    return null;
  };
  const { default: Viewer } = loadSource('src/components/PvdViewer.tsx', {
    react: {
      useCallback: (fn) => fn,
      useState: (initial) => {
        const index = stateIndex++;
        if (firstRender) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
      },
      useRef: (current) => { const index = refIndex++; return refs[index] ||= { current }; },
      useEffect: (fn) => { if (firstRender) effects.push(fn); },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/components/pvdIdlePlaylist': idleModel, '@/components/pvdYouTubeMixPlayer': mixPlayer,
    '@/components/youtubeDurationProbe': { createYouTubeDurationProbeRunner: () => ({ dispose() {} }) },
    '@/shared/api/http': { getBrowserApiBase: () => 'http://localhost' },
  });
  const render = () => { stateIndex = 0; refIndex = 0; Viewer({ viewerToken: 'test' }); firstRender = false; };
  render();
  const disposers = effects.map((effect) => effect());
  cleanup = () => disposers.reverse().forEach((dispose) => { if (typeof dispose === 'function') dispose(); });
  return {
    calls, render, get player() { return player; },
    get externalVideo() { return externalVideo; },
    get externalVideoProps() { return externalVideoProps; },
    control: (op, atSec = 83) => socket.onmessage({ data: JSON.stringify({ type: 'control', op, atSec, paused: op === 'pause' }) }),
    snapshot: (patch) => { payload = { ...payload, ...patch }; },
    deferSnapshot: (fn) => { getSnapshot = fn; },
    focus: () => listeners.get('focus')(),
  };
}

test('late readiness, initial sync timers and PLAYING events respect the latest web pause', async () => {
  const h = mount(); await flush();
  h.control('pause');
  h.player.ready();
  jest.advanceTimersByTime(2500); await flush();
  h.player.emit(1);
  expect(h.player.playVideo).not.toHaveBeenCalled();
  expect(h.player.pauseVideo).toHaveBeenCalled();
  expect(h.player.seekTo).toHaveBeenLastCalledWith(83, true);
  expect(h.calls.some((call) => call.body.op === 'play')).toBe(false);
  h.control('play');
  expect(h.player.playVideo).toHaveBeenCalledTimes(1);
});

test('paused HTTP snapshots preserve the pause position instead of seeking to the start', async () => {
  const h = mount(); await flush();
  h.snapshot({ paused: true, atSec: 83 }); h.focus(); await flush();
  expect(h.player.seekTo).toHaveBeenLastCalledWith(83, true);
  expect(h.player.pauseVideo).toHaveBeenCalled();
});

test('an HTTP response started before a pause cannot overwrite the newer WebSocket control', async () => {
  const h = mount(); await flush();
  let resolve;
  h.deferSnapshot(() => new Promise((done) => { resolve = done; }));
  h.focus(); await flush();
  h.control('pause');
  resolve({ item: { id: 'donation-1', mediaProvider: 'youtube', videoId: 'video000001', startSec: 12 }, paused: false, atSec: 22 });
  await flush(); jest.advanceTimersByTime(2500); await flush(); h.player.ready();
  expect(h.player.playVideo).not.toHaveBeenCalled();
  expect(h.player.seekTo).toHaveBeenLastCalledWith(83, true);
});

test('external media respects a pause received before mounting and delayed initial synchronization', async () => {
  const h = mount({ item: { id: 'clip-1', mediaProvider: 'chzzk_clip', mediaId: 'clip1', embedUrl: 'https://example.com/video.mp4', startSec: 12 } });
  await flush();
  h.control('pause');
  h.render();
  h.externalVideoProps.onCanPlay({ currentTarget: h.externalVideo });
  jest.advanceTimersByTime(1000); await flush();
  expect(h.externalVideo.play).not.toHaveBeenCalled();
  expect(h.externalVideo.pause).toHaveBeenCalled();
  expect(h.externalVideo.currentTime).toBe(83);
  h.control('play');
  expect(h.externalVideo.play).toHaveBeenCalledTimes(1);
});
