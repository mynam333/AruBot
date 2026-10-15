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

function mount(initialPayload = {}, playerRole = 'video') {
  const effects = [];
  const listeners = new Map();
  let socket;
  let player;
  const players = [];
  let payload = { item: { id: 'donation-1', mediaProvider: 'youtube', videoId: 'video000001', startSec: 12 }, paused: false, atSec: 20, ...initialPayload };
  let getSnapshot = async () => payload;
  const calls = [];
  const node = () => ({ style: {}, dataset: {}, appendChild() {}, replaceChildren() {} });
  class Player {
    constructor(_mount, options) {
      this.id = options.videoId; this.events = options.events; this.time = 20; this.options = options;
      this.pauseVideo = jest.fn(); this.playVideo = jest.fn();
      this.seekTo = jest.fn((time) => { this.time = time; });
      player = this;
      players.push(this);
    }
    getVideoData() { return { video_id: this.id }; }
    getCurrentTime() { return this.time; }
    getPlayerState() { return this.state; }
    getDuration() { return 180; }
    loadVideoById({ videoId }) { this.id = videoId; }
    setVolume(volume) { this.volume = volume; }
    mute() { this.muted = true; }
    unMute() { this.muted = false; this.volume = Math.max(5, this.volume || 0); }
    unloadModule() {} destroy() {} stopVideo() {}
    ready() { this.events.onReady({ target: this }); }
    emit(data) { this.state = data; this.events.onStateChange({ data, target: this }); }
  }
  global.window = { YT: { Player, PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 } }, location: { origin: 'http://localhost', pathname: '/pvd/test' }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener() {}, setTimeout };
  global.document = { hidden: false, createElement: node, addEventListener() {}, removeEventListener() {} };
  global.WebSocket = class {
    static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor() { socket = this; this.readyState = 1; }
    close() { this.readyState = 3; }
    send(data) { if (JSON.parse(data).type === 'ping') this.onmessage?.({ data: '{"type":"pong"}' }); }
  };
  global.fetch = jest.fn(async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ url, body });
    return { ok: true, json: url.includes('/now-playing') ? getSnapshot : async () => ({ ok: true, ...(body.op === 'bgm_status' ? { accepted: true } : {}) }) };
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
    '@/components/pvdPlaybackVisibility': loadSource('src/components/pvdPlaybackVisibility.ts'),
    '@/components/youtubeDurationProbe': { createYouTubeDurationProbeRunner: () => ({ dispose() {} }) },
    '@/shared/api/http': { getBrowserApiBase: () => 'http://localhost' },
    '@/shared/api/overlay-socket': loadSource('src/shared/api/overlay-socket.ts'),
  });
  const render = () => { stateIndex = 0; refIndex = 0; Viewer({ viewerToken: 'test', playerRole }); firstRender = false; };
  render();
  const disposers = effects.map((effect) => effect());
  cleanup = () => disposers.reverse().forEach((dispose) => { if (typeof dispose === 'function') dispose(); });
  return {
    calls, render, players, get player() { return player; },
    get externalVideo() { return externalVideo; },
    get externalVideoProps() { return externalVideoProps; },
    control: (op, atSec = 83) => socket.onmessage({ data: JSON.stringify({ type: 'control', op, atSec, paused: op === 'pause' }) }),
    message: (data) => socket.onmessage({ data: JSON.stringify(data) }),
    volume: (volume) => socket.onmessage({ data: JSON.stringify({ type: 'control', op: 'volume', volume }) }),
    snapshot: (patch) => { payload = { ...payload, ...patch }; },
    deferSnapshot: (fn) => { getSnapshot = fn; },
    focus: () => listeners.get('focus')(),
  };
}

test.each([0, 1, 2, 4, 5, 100])('YouTube keeps the configured %i%% volume after readiness and synchronization', async (volume) => {
  const h = mount({ volume }); await flush();
  h.player.ready();
  expect(h.player.volume).toBe(volume);
  expect(h.player.muted).toBe(volume === 0);
  jest.advanceTimersByTime(1000); await flush();
  h.focus(); await flush();
  expect(h.player.volume).toBe(volume);
  expect(h.player.muted).toBe(volume === 0);
});

test('YouTube remote volume controls retain low volume when leaving mute', async () => {
  const h = mount({ volume: 100 }); await flush(); h.player.ready();
  for (const volume of [1, 0, 2, 4, 100, 1]) {
    h.volume(volume);
    expect(h.player.volume).toBe(volume);
    expect(h.player.muted).toBe(volume === 0);
  }
});

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

const bgmPayload = (patch = {}) => ({
  item: { id: 'bgm-1', kind: 'bgm', mediaProvider: 'youtube', videoId: 'video000001', startSec: 12, durationSec: 100 },
  bgm: { enabled: true }, ...patch,
});

test('tolerated BGM clock drift is not reported back as a manual seek', async () => {
  const h = mount(bgmPayload(), 'bgm'); await flush(); h.player.ready(); h.player.emit(1);
  jest.advanceTimersByTime(1500); await flush();
  h.player.time = 22.5;
  h.focus(); await flush();
  jest.advanceTimersByTime(300); await flush();
  expect(h.calls.filter(({ body }) => body.op === 'seek')).toEqual([]);
  expect(h.player.time).toBe(22.5);
});

test('a delayed programmatic BGM seek never echoes the old position to the server', async () => {
  const h = mount(bgmPayload(), 'bgm'); await flush(); h.player.ready(); h.player.emit(1);
  jest.advanceTimersByTime(1500); await flush();
  h.player.seekTo.mockImplementation(() => {});
  h.control('seek', 83);
  jest.advanceTimersByTime(300); await flush();
  h.player.time = 83;
  jest.advanceTimersByTime(300); await flush();
  expect(h.calls.filter(({ body }) => body.op === 'seek')).toEqual([]);
});

test('duplicate control acknowledgements do not seek an already aligned player', async () => {
  const h = mount(bgmPayload(), 'bgm'); await flush(); h.player.ready();
  h.player.seekTo.mockClear();
  h.control('seek', 83); h.control('seek', 83);
  expect(h.player.seekTo).toHaveBeenCalledTimes(1);
});

test('delayed controls for a previous queue item cannot rewind or pause the current song', async () => {
  const h = mount(); await flush(); h.player.ready();
  h.player.seekTo.mockClear(); h.player.pauseVideo.mockClear();
  h.message({ type: 'control', itemId: 'old-item', op: 'pause', atSec: 12, paused: true });
  h.player.emit(1);
  expect(h.player.seekTo).not.toHaveBeenCalled();
  expect(h.player.pauseVideo).not.toHaveBeenCalled();
});

test('controls without a position and unrelated control messages never seek to zero', async () => {
  const h = mount(); await flush(); h.player.ready();
  h.player.seekTo.mockClear();
  h.message({ type: 'control', op: 'pause', paused: true });
  h.message({ type: 'control', op: 'status' });
  expect(h.player.seekTo).not.toHaveBeenCalled();
  expect(h.player.time).toBe(20);
});

test('normal playback across a throttled timer is not a native seek', async () => {
  const h = mount(bgmPayload(), 'bgm'); await flush(); h.player.ready(); h.player.emit(1);
  jest.advanceTimersByTime(1500); await flush();
  jest.setSystemTime(Date.now() + 10000);
  h.player.time += 10;
  jest.advanceTimersByTime(300); await flush();
  expect(h.calls.filter(({ body }) => body.op === 'seek')).toEqual([]);
});

test('video buffering recovery does not emit a new playback command', async () => {
  const h = mount(); await flush(); h.player.ready();
  jest.advanceTimersByTime(1500); await flush();
  h.player.emit(3); h.player.emit(1);
  expect(h.calls.filter(({ body }) => body.op === 'play')).toEqual([]);
});

test('older snapshots and controls cannot overwrite a newer seek revision', async () => {
  const h = mount(bgmPayload(), 'bgm'); await flush(); h.player.ready();
  h.message({ type: 'control', op: 'seek', atSec: 83, itemId: 'bgm-1', playbackRevision: 2 });
  h.player.seekTo.mockClear();
  h.message({ type: 'start', ...bgmPayload({ atSec: 20, playbackRevision: 1 }) });
  h.message({ type: 'control', op: 'seek', atSec: 20, itemId: 'bgm-1', playbackRevision: 1 });
  await flush();
  expect(h.player.time).toBe(83);
  expect(h.player.seekTo).not.toHaveBeenCalled();
});

test('HTTP polling cannot restore the old position while a native seek is being submitted', async () => {
  const h = mount(bgmPayload(), 'bgm'); await flush(); h.player.ready(); h.player.emit(1);
  jest.advanceTimersByTime(1500); await flush();
  const originalFetch = global.fetch;
  let finish;
  global.fetch = (url, options) => {
    if (options?.body && JSON.parse(options.body).op === 'seek') return new Promise((resolve) => { finish = resolve; });
    return originalFetch(url, options);
  };
  h.player.time = 83;
  jest.advanceTimersByTime(900); await flush();
  h.focus(); await flush();
  h.message({ type: 'start', ...bgmPayload({ atSec: 20 }) }); await flush();
  expect(h.player.time).toBe(83);
  finish({ ok: true }); await flush();
});

test('a newly loaded BGM does not report the previous song position before readiness', async () => {
  const h = mount(bgmPayload(), 'bgm'); await flush(); h.player.ready(); h.player.emit(1);
  jest.advanceTimersByTime(1500); await flush();
  h.player.time = 80;
  h.player.seekTo.mockImplementation(() => {});
  h.message({ type: 'start', ...bgmPayload({ item: { ...bgmPayload().item, id: 'bgm-2', videoId: 'video000002' }, atSec: 12 }) });
  await flush(); h.player.emit(3);
  jest.advanceTimersByTime(1800); await flush();
  const reports = h.calls.filter(({ body }) => body.op === 'bgm_status' && body.itemId === 'bgm-2');
  expect(reports.length).toBeGreaterThan(0);
  expect(reports.every(({ body }) => body.positionValid === false && body.atSec === undefined)).toBe(true);
  expect(h.calls.filter(({ body }) => body.op === 'seek')).toEqual([]);
});

test('BGM native controls expose the timeline and synchronize seeks across buffering events', async () => {
  const h = mount(bgmPayload(), 'bgm'); await flush(); h.player.ready();
  expect(h.player.options.playerVars).toMatchObject({ controls: 1, disablekb: 0 });
  jest.advanceTimersByTime(1500); await flush();
  h.player.time = 83; h.player.emit(3); h.player.emit(1);
  jest.advanceTimersByTime(900); await flush();
  expect(h.calls.filter(({ body }) => body.op === 'seek').map(({ body }) => body))
    .toEqual([expect.objectContaining({ atSec: 83, itemId: 'bgm-1' })]);
});

test('BGM native seek updates a paused queue without resuming it', async () => {
  const h = mount(bgmPayload({ paused: true }), 'bgm'); await flush(); h.player.ready();
  jest.advanceTimersByTime(1500); await flush(); h.player.playVideo.mockClear();
  h.player.time = 83; h.player.emit(2);
  jest.advanceTimersByTime(900); await flush();
  expect(h.calls).toContainEqual(expect.objectContaining({ body: expect.objectContaining({ op: 'seek', atSec: 83 }) }));
  expect(h.calls.some(({ body }) => body.op === 'play')).toBe(false);
  expect(h.player.playVideo).not.toHaveBeenCalled();
});

test('BGM native pause and resume are explicit controls, not automatic recovery events', async () => {
  const h = mount(bgmPayload(), 'bgm'); await flush(); h.player.ready();
  jest.advanceTimersByTime(1500); await flush();
  h.player.emit(2); await flush();
  h.player.time = 40; h.player.emit(1); await flush();
  expect(h.calls.filter(({ body }) => ['pause', 'play'].includes(body.op)).map(({ body }) => body))
    .toEqual([
      expect.objectContaining({ op: 'pause', source: 'bgm-window', itemId: 'bgm-1' }),
      expect.objectContaining({ op: 'play', source: 'bgm-window', atSec: 40 }),
    ]);
});

test('a native BGM pause is accepted immediately after player readiness', async () => {
  const h = mount(bgmPayload(), 'bgm'); await flush(); h.player.ready();
  h.player.emit(2); await flush();
  expect(h.calls).toContainEqual(expect.objectContaining({ body: expect.objectContaining({ op: 'pause', source: 'bgm-window' }) }));
});

test('a native BGM seek immediately after the server pause acknowledgement is not discarded', async () => {
  const h = mount(bgmPayload(), 'bgm'); await flush(); h.player.ready();
  jest.advanceTimersByTime(1500); await flush();
  h.control('pause', 20); h.player.emit(2);
  h.player.time = 60; h.player.emit(3); h.player.emit(2);
  jest.advanceTimersByTime(900); await flush();
  expect(h.calls).toContainEqual(expect.objectContaining({ body: expect.objectContaining({ op: 'seek', atSec: 60 }) }));
  expect(h.calls.some(({ body }) => body.op === 'play')).toBe(false);
});

test.each([[0, 12], [175, 112]])('BGM native seek %s stays inside the requested segment at %s', async (time, bounded) => {
  const h = mount(bgmPayload(), 'bgm'); await flush(); h.player.ready();
  jest.advanceTimersByTime(1500); await flush();
  h.player.time = time; h.player.emit(3); h.player.emit(1);
  jest.advanceTimersByTime(900); await flush();
  expect(h.player.seekTo).toHaveBeenLastCalledWith(bounded, true);
  expect(h.calls).toContainEqual(expect.objectContaining({ body: expect.objectContaining({ op: 'seek', atSec: bounded }) }));
});

test('native BGM controls do not resume playback during a Chzzk donation interruption', async () => {
  const h = mount(bgmPayload({ paused: true, chzzkDonationPaused: true }), 'bgm'); await flush();
  h.player.ready(); jest.advanceTimersByTime(1500); await flush();
  h.player.emit(1);
  expect(h.calls.some(({ body }) => body.op === 'play')).toBe(false);
});

test.each(['video', 'bgm'])('%s snapshots and reconnects never rewind an already playing item', async (role) => {
  const h = mount(role === 'bgm' ? bgmPayload() : {}, role); await flush(); h.player.ready(); h.player.emit(1);
  jest.advanceTimersByTime(1500); await flush();
  h.player.time = 70;
  h.player.seekTo.mockClear();
  h.focus(); await flush();
  h.message({ type: 'start', ...(role === 'bgm' ? bgmPayload() : { item: { id: 'donation-1', mediaProvider: 'youtube', videoId: 'video000001', startSec: 12 } }), atSec: 20, paused: false });
  await flush();
  expect(h.player.time).toBe(70);
  expect(h.player.seekTo).not.toHaveBeenCalled();
});

test.each(['video', 'bgm'])('%s transient zero/buffering samples never become a seek command', async (role) => {
  const h = mount(role === 'bgm' ? bgmPayload() : {}, role); await flush(); h.player.ready(); h.player.emit(1);
  jest.advanceTimersByTime(1500); await flush();
  h.player.time = 0; h.player.emit(3);
  jest.advanceTimersByTime(900); await flush();
  h.player.time = 20; h.player.emit(1);
  jest.advanceTimersByTime(900); await flush();
  expect(h.calls.filter(({ body }) => body.op === 'seek')).toEqual([]);
});

test('a duplicate seek revision cannot replay the seek after playback has advanced', async () => {
  const h = mount(bgmPayload(), 'bgm'); await flush(); h.player.ready();
  const control = { type: 'control', op: 'seek', atSec: 20, itemId: 'bgm-1', playbackRevision: 2 };
  h.message(control); h.player.time = 40; h.player.seekTo.mockClear();
  h.message(control);
  expect(h.player.time).toBe(40);
  expect(h.player.seekTo).not.toHaveBeenCalled();
});

test('server restart epochs preserve local progress but accept subsequent explicit controls', async () => {
  const h = mount(bgmPayload({ playbackEpoch: 'before', playbackRevision: 8 }), 'bgm');
  await flush(); h.player.ready(); h.player.time = 70; h.player.seekTo.mockClear();
  h.message({ type: 'start', ...bgmPayload({ atSec: 12, playbackEpoch: 'after', playbackRevision: 0 }) }); await flush();
  expect(h.player.time).toBe(70);
  h.message({ type: 'control', itemId: 'bgm-1', op: 'seek', atSec: 40, playbackEpoch: 'after', playbackRevision: 1 });
  expect(h.player.time).toBe(40);
  h.message({ type: 'start', ...bgmPayload({ atSec: 20, playbackEpoch: 'before', playbackRevision: 9 }) }); await flush();
  expect(h.player.time).toBe(40);
});

test('a snapshot with a genuinely newer seek revision still applies the requested position', async () => {
  const h = mount({ playbackEpoch: 'epoch', playbackRevision: 1 }); await flush(); h.player.ready();
  h.player.time = 70;
  h.snapshot({ atSec: 30, playbackEpoch: 'epoch', playbackRevision: 2 }); h.focus(); await flush();
  expect(h.player.time).toBe(30);
});

test('a delayed echo of a locally submitted seek does not rewind its sender', async () => {
  const h = mount(bgmPayload({ playbackEpoch: 'epoch', playbackRevision: 0 }), 'bgm'); await flush(); h.player.ready(); h.player.emit(1);
  jest.advanceTimersByTime(1500); await flush();
  h.player.time = 60; jest.advanceTimersByTime(900); await flush();
  const sent = h.calls.find(({ body }) => body.op === 'seek').body;
  h.player.time = 65; h.player.seekTo.mockClear();
  h.message({ type: 'control', ...sent, atSec: 60, playbackRevision: 1, paused: false });
  expect(h.player.time).toBe(65);
  expect(h.player.seekTo).not.toHaveBeenCalled();
});

test('repeated snapshots do not reset a direct-video clip to its initial position', async () => {
  const h = mount({ item: { id: 'clip-1', mediaProvider: 'chzzk_clip', mediaId: 'clip1', embedUrl: 'https://example.com/video.mp4', startSec: 12 } });
  await flush(); h.render(); jest.advanceTimersByTime(1000); await flush();
  h.externalVideo.currentTime = 65;
  h.focus(); await flush(); jest.advanceTimersByTime(1000); await flush();
  expect(h.externalVideo.currentTime).toBe(65);
});

test.each(['video', 'bgm'])('a failed %s completion report retries without replaying the completed item', async (role) => {
  const h = mount(role === 'bgm' ? bgmPayload() : {}, role); await flush(); h.player.ready(); h.player.emit(1);
  const originalFetch = global.fetch;
  const pops = [];
  global.fetch = (url, options) => {
    if (url.includes('/pop-by-token')) { pops.push(JSON.parse(options.body)); return Promise.reject(new Error('offline')); }
    return originalFetch(url, options);
  };
  h.player.emit(0); await flush();
  expect(pops).toHaveLength(1);
  expect(h.players).toHaveLength(1);
  if (role === 'bgm') h.snapshot({ paused: true });
  jest.advanceTimersByTime(5000); await flush();
  expect(pops).toHaveLength(2);
  expect(h.players).toHaveLength(1);
  h.snapshot({ item: { id: 'donation-2', kind: role, mediaProvider: 'youtube', videoId: 'video000002', startSec: 0 }, atSec: 0, paused: false });
  h.focus(); await flush();
  expect(h.players).toHaveLength(2);
  expect(h.player.id).toBe('video000002');
});

test('BGM keeps playing through a short presence outage and releases an expired lease', async () => {
  const h = mount(bgmPayload(), 'bgm'); await flush(); h.player.ready(); h.player.emit(1);
  h.player.pauseVideo.mockClear();
  const originalFetch = global.fetch;
  let failing = true;
  global.fetch = (url, options) => {
    if (failing && options?.body && JSON.parse(options.body).op === 'bgm_status') return Promise.reject(new Error('offline'));
    return originalFetch(url, options);
  };
  jest.advanceTimersByTime(3000); await flush();
  expect(h.player.pauseVideo).not.toHaveBeenCalled();
  jest.advanceTimersByTime(3000); await flush();
  expect(h.player.pauseVideo).not.toHaveBeenCalled();
  jest.advanceTimersByTime(3000); await flush();
  expect(h.player.pauseVideo).toHaveBeenCalled();
  failing = false;
  jest.advanceTimersByTime(3000); await flush();
  h.player.ready();
  expect(h.player.playVideo).toHaveBeenCalled();
});
