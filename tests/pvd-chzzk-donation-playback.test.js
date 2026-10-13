const loadSource = require('./helpers/load-source.cjs');
const idleModel = loadSource('src/components/pvdIdlePlaylist.ts');
const mixPlayer = loadSource('src/components/pvdYouTubeMixPlayer.ts', {
  '../../shared/youtube-mix.js': loadSource('shared/youtube-mix.js'), './pvdIdlePlaylist': idleModel,
});
const flush = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };
const track = (n) => ({ id: `track-${n}`, mediaId: `video00000${n}`, title: `Track ${n}`, durationSec: 180 });
const playlist = (mode) => ({ enabled: true, mode, loop: true, tracks: [track(1), track(2)] });
const donation = { id: 'donation-1', mediaProvider: 'youtube', videoId: 'donation001' };
let cleanup;
let savedGlobals;

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Math, 'random').mockReturnValue(0);
  savedGlobals = Object.fromEntries(['window', 'document', 'WebSocket', 'fetch'].map((name) => [name, global[name]]));
});

afterEach(() => {
  cleanup?.();
  for (const [name, value] of Object.entries(savedGlobals)) {
    if (value === undefined) delete global[name]; else global[name] = value;
  }
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function mount(initial = {}, playerRole = 'video') {
  const effects = [];
  const listeners = new Map();
  const listen = (name, fn) => listeners.set(name, [...(listeners.get(name) || []), fn]);
  const dispatch = (name, event) => listeners.get(name)?.forEach((fn) => fn(event));
  const calls = [];
  const players = [];
  const loads = [];
  const buttons = new Map();
  let socket;
  let payload = { item: null, paused: false, chzzkDonationPaused: false, ...initial };
  let getSnapshot = async () => payload;
  let bgmOwner = true;
  let idleOwner = true;
  let externalVideo;
  let videoProps;
  let externalFrame;
  const node = () => ({ style: {}, dataset: {}, appendChild() {}, replaceChildren() {} });
  class Player {
    constructor(_mount, options) {
      this.options = options;
      this.events = options.events;
      this.id = options.videoId;
      this.time = Number(options.playerVars.start || 0);
      this.ids = options.playerVars.list ? [track(1).mediaId, track(2).mediaId] : [];
      this.index = 0;
      this.pauseVideo = jest.fn(() => { this.state = 2; });
      this.playVideo = jest.fn(() => { this.state = 1; });
      this.seekTo = jest.fn((time) => { this.time = time; });
      this.loadVideoById = jest.fn(({ videoId, startSeconds }) => { this.id = videoId; this.time = startSeconds; loads.push(videoId); });
      this.cueVideoById = jest.fn(({ videoId, startSeconds }) => { this.id = videoId; this.time = startSeconds; });
      this.playVideoAt = jest.fn((index) => { this.index = index; this.id = this.ids[index]; this.time = 0; loads.push(this.id); });
      this.loadPlaylist = jest.fn();
      this.destroy = jest.fn();
      players.push(this);
      loads.push(this.id);
    }
    getVideoData() { return { video_id: this.id }; }
    getCurrentTime() { return this.time; }
    getDuration() { return 180; }
    getPlayerState() { return this.state; }
    getPlaylist() { return this.ids; }
    getPlaylistIndex() { return this.index; }
    setVolume() {} mute() {} unMute() {} unloadModule() {} stopVideo() {} setLoop() {}
    ready() { this.events.onReady({ target: this }); }
    emit(data) { this.state = data; this.events.onStateChange({ target: this, data }); }
  }
  global.window = {
    YT: { Player, PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 } },
    location: { origin: 'http://localhost', pathname: '/pvd/test' },
    addEventListener: listen, removeEventListener() {}, setTimeout,
  };
  global.document = { hidden: false, createElement: node, addEventListener: listen, removeEventListener() {} };
  global.WebSocket = class {
    static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor() { socket = this; this.readyState = 1; }
    close() { this.readyState = 3; }
    send(data) { if (JSON.parse(data).type === 'ping') this.onmessage?.({ data: '{"type":"pong"}' }); }
  };
  global.fetch = jest.fn(async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ url, body });
    if (body.op === 'bgm_status') return { ok: true, json: async () => ({ accepted: bgmOwner && body.visible }) };
    if (body.op === 'idle_status') return { ok: true, json: async () => ({ accepted: idleOwner }) };
    if (url.includes('/activate-by-token')) payload = { ...payload, idleDeferred: false, paused: false };
    return { ok: true, json: url.includes('/now-playing') ? getSnapshot : async () => ({ ok: true }) };
  });
  const states = [];
  const refs = [];
  let stateIndex = 0;
  let refIndex = 0;
  let firstRender = true;
  const jsx = (type, props) => {
    if (props?.ref && !props.ref.current) props.ref.current = node();
    if (type === 'button') buttons.set(props['aria-label'], props.onClick);
    if (type === 'video') {
      externalVideo = props.ref.current;
      externalVideo.play ||= jest.fn();
      externalVideo.pause ||= jest.fn();
      externalVideo.currentTime ??= 0;
      videoProps = props;
    }
    if (type === 'iframe') {
      externalFrame = props.ref.current;
      externalFrame.contentWindow ||= { postMessage: jest.fn() };
    }
    return null;
  };
  const { default: Viewer } = loadSource('src/components/PvdViewer.tsx', {
    react: {
      useCallback: (fn) => fn,
      useState: (initialState) => {
        const index = stateIndex++;
        if (firstRender) states[index] = typeof initialState === 'function' ? initialState() : initialState;
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
  const render = () => { stateIndex = 0; refIndex = 0; buttons.clear(); Viewer({ viewerToken: 'test', playerRole }); firstRender = false; };
  render();
  const disposers = effects.map((effect) => effect());
  cleanup = () => disposers.reverse().forEach((dispose) => { if (typeof dispose === 'function') dispose(); });
  const push = (data) => socket.onmessage({ data: JSON.stringify(data) });
  return {
    calls, players, loads, buttons, render,
    get player() { return players.at(-1); },
    get video() { return externalVideo; },
    get videoProps() { return videoProps; },
    get frame() { return externalFrame; },
    push,
    snapshot(patch, type = 'state') {
      payload = { ...payload, ...patch };
      if (type === 'http') dispatch('focus'); else push({ ...payload, type });
    },
    interrupt(active, patch = {}) {
      payload = { ...payload, paused: active, chzzkDonationPaused: active, ...patch };
      push({ type: 'control', op: 'chzzk-donation', paused: payload.paused, chzzkDonationPaused: active, ...patch });
    },
    idleCommand(op, version = 1) {
      const clientId = calls.find((call) => call.body.op === 'idle_status').body.clientId;
      push({ type: 'control', op: 'idle-control', command: { clientId, op, version } });
    },
    deferSnapshot(fn) { getSnapshot = fn; },
    visibility(hidden) { document.hidden = hidden; dispatch('visibilitychange'); },
    bgmOwner(accepted) { bgmOwner = accepted; },
    idleOwner(accepted) { idleOwner = accepted; },
    tiktok(type, value) { dispatch('message', { source: externalFrame.contentWindow, origin: 'https://www.tiktok.com', data: { 'x-tiktok-player': true, type, value } }); },
  };
}

test.each(['custom', 'recommended'])('%s idle freezes at its current position and ignores ENDED throughout interruption', async (mode) => {
  const h = mount({ idlePlaylist: playlist(mode) }); await flush();
  h.player.ready(); h.player.emit(1);
  jest.advanceTimersByTime(1000); await flush();
  h.player.time = 47.5;
  h.interrupt(true);
  h.player.playVideo.mockClear();
  h.player.seekTo.mockClear();
  h.player.emit(0); h.player.emit(1);
  jest.advanceTimersByTime(65000); await flush();
  expect(h.player.playVideo).not.toHaveBeenCalled();
  expect(h.player.playVideoAt).not.toHaveBeenCalled();
  expect(h.player.loadPlaylist).not.toHaveBeenCalled();
  expect(h.loads).toEqual([track(1).mediaId]);
  expect(h.player.time).toBe(47.5);
  expect(h.calls.filter((call) => call.body.op === 'idle_status').at(-1).body).toMatchObject({ playing: false, paused: true });
  h.interrupt(false); await flush();
  expect(h.player.playVideo).toHaveBeenCalled();
  expect(h.player.seekTo).not.toHaveBeenCalled();
  expect(h.player.time).toBe(47.5);
  expect(h.loads).toEqual([track(1).mediaId]);
  expect(h.calls.filter((call) => call.body.op === 'idle_status').at(-1).body.paused).toBe(false);
});

test.each(['custom', 'recommended'])('%s idle does not start from an interrupted initial snapshot', async (mode) => {
  const h = mount({ idlePlaylist: playlist(mode), paused: true, chzzkDonationPaused: true });
  await flush(); jest.advanceTimersByTime(3000); await flush();
  expect(h.loads).toEqual([]);
  h.interrupt(false); await flush();
  expect(h.loads).toEqual([track(1).mediaId]);
});

test.each(['http', 'now-playing', 'start', 'state', 'init'])('%s snapshots both apply and release interruption', async (type) => {
  const h = mount({ idlePlaylist: playlist('custom') }); await flush();
  h.player.ready(); jest.advanceTimersByTime(1000); await flush(); h.player.time = 51;
  h.snapshot({ paused: true, chzzkDonationPaused: true }, type); await flush();
  h.player.playVideo.mockClear(); h.player.emit(0);
  expect(h.player.pauseVideo).toHaveBeenCalled();
  expect(h.loads).toHaveLength(1);
  h.snapshot({ paused: false, chzzkDonationPaused: false }, type); await flush();
  expect(h.player.playVideo).toHaveBeenCalled();
  expect(h.player.time).toBe(51);
});

test.each(['custom', 'recommended'])('%s manual idle pause survives CHZZK activation, release and snapshots', async (mode) => {
  const h = mount({ idlePlaylist: playlist(mode) }); await flush(); h.player.ready(); h.player.emit(1);
  h.idleCommand('pause'); h.interrupt(true); h.player.playVideo.mockClear();
  h.interrupt(false); h.snapshot({}); await flush(); jest.advanceTimersByTime(2000); await flush();
  expect(h.player.playVideo).not.toHaveBeenCalled();
  expect(h.calls.filter((call) => call.body.op === 'idle_status').at(-1).body.paused).toBe(true);
  h.idleCommand('play', 2); await flush();
  expect(h.player.playVideo).toHaveBeenCalled();
});

test.each(['custom', 'recommended'])('%s idle waits for a separate server queue pause to release', async (mode) => {
  const h = mount({ idlePlaylist: playlist(mode) }); await flush(); h.player.ready();
  h.interrupt(true); h.player.playVideo.mockClear();
  h.interrupt(false, { paused: true }); jest.advanceTimersByTime(2000); await flush();
  expect(h.player.playVideo).not.toHaveBeenCalled();
  h.push({ type: 'control', op: 'play', paused: false }); await flush();
  expect(h.player.playVideo).toHaveBeenCalled();
});

test('late YouTube readiness, repeated snapshots and artificial pause events do not report a manual pause', async () => {
  const h = mount({ item: donation, atSec: 42 }); await flush();
  h.interrupt(true, { atSec: 42 }); h.player.ready();
  jest.advanceTimersByTime(5000); await flush(); h.player.emit(2); h.player.emit(1); h.player.emit(0);
  expect(h.player.playVideo).not.toHaveBeenCalled();
  expect(h.calls.some((call) => ['pause', 'play', 'seek'].includes(call.body.op) || call.url.includes('/pop-by-token'))).toBe(false);
  h.snapshot({ chzzkDonationPaused: false, paused: true, atSec: 42 }); await flush();
  expect(h.player.playVideo).not.toHaveBeenCalled();
  h.snapshot({ paused: false }); await flush();
  expect(h.player.playVideo).toHaveBeenCalled();
  expect(h.player.time).toBe(42);
});

test('a new YouTube item is cued without autoplay while interrupted', async () => {
  const h = mount({ item: donation }); await flush(); h.player.ready();
  h.interrupt(true); h.player.playVideo.mockClear();
  h.snapshot({ item: { ...donation, id: 'donation-2', videoId: 'donation002' }, atSec: 24 }); await flush();
  expect(h.player.cueVideoById).toHaveBeenCalledWith({ videoId: 'donation002', startSeconds: 24 });
  expect(h.player.loadVideoById).not.toHaveBeenCalled();
  expect(h.player.playVideo).not.toHaveBeenCalled();
});

test('stale HTTP snapshots and partial controls cannot clear a newer interruption', async () => {
  const h = mount({ item: donation }); await flush();
  let resolve;
  h.deferSnapshot(() => new Promise((done) => { resolve = done; }));
  h.snapshot({}, 'http'); await flush(); h.interrupt(true);
  resolve({ item: donation, paused: false, chzzkDonationPaused: false }); await flush();
  h.push({ type: 'control', op: 'volume', volume: 20 });
  h.push({ type: 'control', op: 'play', paused: false, atSec: 22 });
  h.player.ready(); jest.advanceTimersByTime(2000); await flush(); h.player.emit(1);
  expect(h.player.playVideo).not.toHaveBeenCalled();
});

test('deferred donations neither activate nor replace the idle track during interruption', async () => {
  const h = mount({ idlePlaylist: playlist('custom') }); await flush(); h.player.ready();
  h.player.time = 38; h.interrupt(true);
  h.snapshot({ item: donation, idleDeferred: true }); await flush(); h.player.emit(0);
  expect(h.calls.some((call) => call.url.includes('/activate-by-token'))).toBe(false);
  h.player.playVideo.mockClear();
  h.snapshot({ paused: true, chzzkDonationPaused: false }); await flush();
  expect(h.player.playVideo).toHaveBeenCalled();
  expect(h.player.time).toBe(38);
  expect(h.loads).toEqual([track(1).mediaId]);
});

test.each(['custom', 'recommended'])('%s idle continues until end while the deferred donation head is paused', async (mode) => {
  const h = mount({ idlePlaylist: playlist(mode) }); await flush(); h.player.ready(); h.player.emit(1);
  jest.advanceTimersByTime(1000); await flush(); h.player.time = 38;
  h.player.pauseVideo.mockClear();
  h.snapshot({ item: donation, paused: true, idleDeferred: true }); await flush(); h.player.emit(1);
  expect(h.player.pauseVideo).not.toHaveBeenCalled();
  expect(h.player.time).toBe(38);
  expect(h.loads).toEqual([track(1).mediaId]);
  expect(h.calls.some((call) => call.url.includes('/activate-by-token'))).toBe(false);
  expect(h.calls.filter((call) => call.body.op === 'idle_status').at(-1).body.paused).toBe(false);
  h.player.emit(0); await flush();
  expect(h.calls.filter((call) => call.url.includes('/activate-by-token'))).toHaveLength(1);
  expect(h.loads).toEqual([track(1).mediaId, donation.videoId]);
});

test.each(['custom', 'recommended'])('another player\'s paused BGM request does not block video %s idle', async (mode) => {
  const h = mount({ idlePlaylist: playlist(mode), bgm: { enabled: true } }); await flush(); h.player.ready(); h.player.emit(1);
  jest.advanceTimersByTime(1000); await flush(); h.player.time = 38;
  h.player.pauseVideo.mockClear();
  h.snapshot({ item: { ...donation, kind: 'bgm' }, paused: true }); await flush(); h.player.emit(1);
  expect(h.player.pauseVideo).not.toHaveBeenCalled();
  expect(h.player.time).toBe(38);
  expect(h.loads).toEqual([track(1).mediaId]);
  h.interrupt(true); h.player.playVideo.mockClear();
  h.interrupt(false, { paused: true }); await flush();
  expect(h.player.playVideo).toHaveBeenCalled();
  expect(h.player.time).toBe(38);
});

test('direct video pauses immediately, ignores readiness/end, and restores the same position', async () => {
  const h = mount({ item: { id: 'clip', mediaProvider: 'chzzk_clip', mediaId: 'clip', embedUrl: 'https://example.com/video.mp4' } });
  await flush(); h.render(); jest.advanceTimersByTime(1000); await flush(); h.video.currentTime = 43;
  h.interrupt(true); h.video.play.mockClear(); h.render();
  h.videoProps.onCanPlay({ currentTarget: h.video }); h.videoProps.onPlay({ currentTarget: h.video }); h.videoProps.onEnded();
  expect(h.videoProps.autoPlay).toBe(false);
  expect(h.video.pause).toHaveBeenCalled();
  expect(h.video.play).not.toHaveBeenCalled();
  expect(h.calls.some((call) => call.url.includes('/pop-by-token'))).toBe(false);
  h.interrupt(false);
  expect(h.video.play).toHaveBeenCalled();
  expect(h.video.currentTime).toBe(43);
});

test('TikTok iframe retries and late pause events stay suppressed until server release', async () => {
  const h = mount({ item: { id: 'tiktok', mediaProvider: 'tiktok', mediaId: '12345' }, atSec: 32 });
  await flush(); h.render(); h.tiktok('onPlayerReady');
  h.tiktok('onStateChange', 0); h.tiktok('onPlayerError', { errorCode: 3002 });
  h.interrupt(true); h.frame.contentWindow.postMessage.mockClear();
  jest.advanceTimersByTime(5000); await flush(); h.tiktok('onStateChange', 2); h.tiktok('onStateChange', 1);
  expect(h.frame.contentWindow.postMessage.mock.calls.some(([message]) => message.type === 'play')).toBe(false);
  expect(h.frame.contentWindow.postMessage.mock.calls.some(([message]) => message.type === 'pause')).toBe(true);
  expect(h.calls.some((call) => call.body.op === 'pause')).toBe(false);
  h.interrupt(false);
  expect(h.frame.contentWindow.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'play' }), 'https://www.tiktok.com');
});

test.each(['custom', 'recommended'])('BGM %s retains owner and visibility restrictions on release', async (mode) => {
  const h = mount({ bgm: { enabled: true, idlePlaylist: playlist(mode) } }, 'bgm');
  await flush(); jest.advanceTimersByTime(3000); await flush();
  h.player.ready(); h.player.emit(1); jest.advanceTimersByTime(1000); await flush();
  h.player.time = 36; h.interrupt(true); h.player.playVideo.mockClear();
  h.bgmOwner(false); jest.advanceTimersByTime(3000); await flush();
  h.interrupt(false); await flush();
  expect(h.player.playVideo).not.toHaveBeenCalled();
  h.bgmOwner(true); h.visibility(true); jest.advanceTimersByTime(3000); await flush();
  expect(h.player.playVideo).not.toHaveBeenCalled();
  h.visibility(false); await flush();
  h.player.ready();
  expect(h.players.at(-1).playVideo).toHaveBeenCalled();
});

test('the BGM play button cannot bypass an active interruption', async () => {
  const h = mount({ item: { ...donation, kind: 'bgm' }, bgm: { enabled: true } }, 'bgm');
  await flush(); jest.advanceTimersByTime(3000); await flush();
  h.player.ready(); h.interrupt(true); h.player.playVideo.mockClear();
  h.snapshot({}); await flush(); h.render();
  await h.buttons.get('BGM 재생')(); await flush();
  expect(h.player.playVideo).not.toHaveBeenCalled();
});

test('idle ownership is still required after a CHZZK release', async () => {
  const h = mount({ idlePlaylist: playlist('recommended') }); await flush(); h.player.ready();
  h.interrupt(true); h.idleOwner(false); jest.advanceTimersByTime(5000); await flush(); h.player.playVideo.mockClear();
  h.interrupt(false); await flush(); jest.advanceTimersByTime(2000); await flush();
  expect(h.player.playVideo).not.toHaveBeenCalled();
});

test('a donation removed by an interrupted snapshot cannot resume on release', async () => {
  const h = mount({ item: donation, idlePlaylist: playlist('custom') }); await flush(); h.player.ready();
  const previous = h.player;
  h.interrupt(true); h.snapshot({ item: null }); await flush(); previous.playVideo.mockClear();
  h.interrupt(false); await flush();
  expect(previous.playVideo).not.toHaveBeenCalled();
  expect(h.player.id).toBe(track(1).mediaId);
});

test('a missed release control recovers idle through the existing snapshot timer', async () => {
  const h = mount({ idlePlaylist: playlist('recommended') }); await flush(); h.player.ready(); h.player.emit(1);
  h.interrupt(true); h.player.playVideo.mockClear();
  h.deferSnapshot(async () => ({ item: null, idlePlaylist: playlist('recommended'), paused: false, chzzkDonationPaused: false }));
  jest.advanceTimersByTime(7500); await flush();
  expect(h.player.playVideo).toHaveBeenCalled();
  expect(h.loads).toEqual([track(1).mediaId]);
});

test('a pause-only CHZZK control preserves a pending YouTube seek before readiness', async () => {
  const h = mount({ item: donation, atSec: 42 }); await flush();
  h.player.time = 0;
  h.interrupt(true); h.player.ready();
  expect(h.player.seekTo).toHaveBeenLastCalledWith(42, true);
  expect(h.player.playVideo).not.toHaveBeenCalled();
  h.interrupt(false);
  expect(h.player.time).toBe(42);
});

test('a pause-only CHZZK control preserves direct-video metadata positioning', async () => {
  const h = mount({ item: { id: 'clip', mediaProvider: 'chzzk_clip', mediaId: 'clip', embedUrl: 'https://example.com/video.mp4' }, atSec: 42 });
  await flush(); h.render(); h.interrupt(true);
  h.videoProps.onLoadedMetadata({ currentTarget: h.video });
  h.videoProps.onCanPlay({ currentTarget: h.video });
  expect(h.video.currentTime).toBe(42);
  expect(h.video.play).not.toHaveBeenCalled();
  h.interrupt(false);
  expect(h.video.currentTime).toBe(42);
  expect(h.video.play).toHaveBeenCalled();
});
