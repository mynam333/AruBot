const loadSource = require('./helpers/load-source.cjs');
const mixParsing = loadSource('shared/youtube-mix.js');
const idleModel = loadSource('src/components/pvdIdlePlaylist.ts');
const { createPvdYouTubeMixPlayer } = loadSource('src/components/pvdYouTubeMixPlayer.ts', {
  '../../shared/youtube-mix.js': mixParsing,
  './pvdIdlePlaylist': idleModel,
});
const video = (n) => `video${String(n).padStart(6, '0')}`;
const playlist = (patch = {}) => ({ enabled: true, mode: 'recommended', topic: 'jazz', loop: true, shuffle: false, tracks: [], mixUrl: `https://www.youtube.com/watch?v=${video(1)}&list=RD${video(1)}`, ...patch });
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
let savedGlobals;
let cleanup;

beforeEach(() => {
  jest.useFakeTimers();
  savedGlobals = { document: global.document, window: global.window };
  global.document = { createElement: () => ({}), addEventListener() {}, removeEventListener() {} };
  global.window = { location: { origin: 'http://localhost' } };
});
afterEach(() => {
  cleanup?.();
  cleanup = null;
  for (const [key, value] of Object.entries(savedGlobals)) {
    if (value === undefined) delete global[key]; else global[key] = value;
  }
  jest.clearAllTimers();
  jest.useRealTimers();
});

test.each([
  [`https://www.youtube.com/watch?v=${video(1)}&list=RD${video(1)}&start_radio=1`, `RD${video(1)}`, video(1)],
  [`https://music.youtube.com/watch?v=${video(2)}&list=RDAMVM${video(2)}`, `RDAMVM${video(2)}`, video(2)],
  [`https://youtu.be/${video(1)}?list=RD${video(1)}`, `RD${video(1)}`, video(1)],
  [`RD${video(1)}`, `RD${video(1)}`, video(1)],
  ['https://www.youtube.com/playlist?list=RDCLAK5uy_abcdefghijk', 'RDCLAK5uy_abcdefghijk', null],
])('parses a public Mix input: %s', (input, id, seed) => {
  expect(mixParsing.parseYouTubeMix(input)).toMatchObject({ playlistId: id, videoId: seed });
});
test.each(['https://youtube.com.evil.test/watch?list=RDvideo000001', 'https://evil.test/?list=RDvideo000001', 'javascript:alert(1)', 'https://youtube.com/watch?v=video000001', 'https://youtube.com/playlist?list=PLvideo000001', 'https://user:password@youtube.com/playlist?list=RDvideo000001'])('rejects unsafe or non-Mix input: %s', (input) => {
  expect(mixParsing.parseYouTubeMix(input)).toBeNull();
});

function setup(overrides = {}) {
  let player;
  let visible = true;
  let deferred = false;
  const instances = [];
  const host = { dataset: {}, replaceChildren: jest.fn(), appendChild: jest.fn() };
  const fetchSeed = jest.fn(async () => video(1));
  const onPlaying = jest.fn();
  const onBoundary = jest.fn(() => deferred);
  class Player {
    constructor(_mount, options) {
      this.options = options;
      this.ids = [video(1), video(2), video(3)];
      this.index = 0;
      this.id = options.videoId || this.ids[0];
      this.duration = 180;
      this.time = 0;
      this.playVideo = jest.fn(); this.pauseVideo = jest.fn(); this.destroy = jest.fn();
      this.playVideoAt = jest.fn((index) => { this.index = index; this.id = this.ids[index]; });
      this.loadPlaylist = jest.fn();
      this.setLoop = jest.fn(); this.setVolume = jest.fn(); this.mute = jest.fn(); this.unMute = jest.fn();
      this.loadModule = jest.fn(); this.unloadModule = jest.fn();
      player = this; instances.push(this);
    }
    getPlaylist() { return this.ids; }
    getPlaylistIndex() { return this.index; }
    getVideoData() { return { video_id: this.id }; }
    getDuration() { return this.duration; }
    getCurrentTime() { return this.time; }
    ready() { this.options.events.onReady({ target: this }); }
    emit(data) { this.options.events.onStateChange({ data, target: this }); }
    error(code = 150) { this.options.events.onError({ data: code, target: this }); }
    at(index, state = 1) { this.index = index; this.id = this.ids[index]; this.emit(state); }
  }
  const controller = createPvdYouTubeMixPlayer({ getApi: async () => ({ Player }), getHost: () => host, fetchSeed, onPlaying, onBoundary, isVisible: () => visible, ...overrides });
  cleanup = () => controller.dispose();
  return { controller, fetchSeed, onPlaying, onBoundary, host, instances, get player() { return player; }, setDeferred(value) { deferred = value; }, setVisible(value) { visible = value; } };
}

test('explicit Mix URLs start without a search or metadata request', async () => {
  const h = setup();
  h.controller.configure(playlist());
  await flush();
  expect(h.instances).toHaveLength(0);
  h.controller.start(playlist());
  await flush();
  h.player.ready(); h.player.emit(1);
  expect(h.fetchSeed).not.toHaveBeenCalled();
  expect(h.player.options.playerVars.list).toBe(`RD${video(1)}`);
  expect(h.onPlaying).toHaveBeenLastCalledWith(true);
});

test('topic mode fetches one seed and preserves the Mix player over donation pauses and server polls', async () => {
  const h = setup();
  const config = playlist({ mixUrl: '' });
  h.controller.start(config);
  await flush();
  h.player.ready(); h.player.emit(1);
  h.player.time = 83;
  h.controller.pause();
  h.controller.start(config);
  h.controller.start(config);
  expect(h.fetchSeed).toHaveBeenCalledTimes(1);
  expect(h.instances).toHaveLength(1);
  expect(h.player.time).toBe(83);
  expect(h.player.destroy).not.toHaveBeenCalled();
});

test('native automatic transitions yield to a deferred donation before accepting the next song', async () => {
  const h = setup();
  h.controller.start(playlist()); await flush(); h.player.ready(); h.player.emit(1);
  h.setDeferred(true);
  h.player.at(1, -1);
  expect(h.onBoundary).toHaveBeenCalledTimes(1);
  expect(h.player.pauseVideo).toHaveBeenCalled();
  h.setDeferred(false);
  h.controller.start(playlist());
  h.player.emit(1);
  expect(h.player.playVideoAt).not.toHaveBeenCalled();
  expect(h.onPlaying).toHaveBeenLastCalledWith(true);
});

test('a donation at the end resumes on the next song rather than replaying the completed song', async () => {
  const h = setup();
  h.controller.start(playlist()); await flush(); h.player.ready(); h.player.emit(1);
  h.setDeferred(true); h.player.emit(0);
  expect(h.player.playVideoAt).not.toHaveBeenCalled();
  h.setDeferred(false); h.controller.start(playlist());
  expect(h.player.playVideoAt).toHaveBeenLastCalledWith(1);
});

test('rotates to a new Mix at the last song and skips the already-played seed', async () => {
  const h = setup();
  h.controller.start(playlist()); await flush(); h.player.ready();
  h.player.at(2); h.player.emit(0);
  expect(h.player.loadPlaylist).toHaveBeenCalledWith({ listType: 'playlist', list: `RD${video(3)}`, index: 0 });
  h.player.ids = [video(3), video(4), video(5)]; h.player.at(0);
  expect(h.player.playVideoAt).toHaveBeenLastCalledWith(1);
  h.player.at(1);
  expect(h.onPlaying).toHaveBeenLastCalledWith(true);
  expect(h.fetchSeed).not.toHaveBeenCalled();
});

test('skips repeat recommendations and songs longer than ten minutes', async () => {
  const h = setup();
  h.controller.start(playlist()); await flush(); h.player.ready(); h.player.emit(1);
  h.player.ids = [video(1), video(1), video(2), video(3)];
  h.player.at(1);
  expect(h.player.playVideoAt).toHaveBeenLastCalledWith(2);
  h.player.duration = 601; h.player.at(2);
  expect(h.player.playVideoAt).toHaveBeenLastCalledWith(3);
});

test('does not accept a single-video fallback as a working Mix', async () => {
  const h = setup();
  h.controller.start(playlist()); await flush(); h.player.ready();
  h.player.ids = []; h.player.emit(1);
  expect(h.host.dataset.mixError).toBe('mix_playlist_unavailable');
  expect(h.player.destroy).toHaveBeenCalled();
  jest.advanceTimersByTime(30000); await flush();
  expect(h.instances).toHaveLength(1);
});

test('backs off after repeated player errors without searching again', async () => {
  const h = setup();
  h.controller.start(playlist()); await flush(); h.player.ready(); h.player.emit(1);
  for (let index = 0; index < 15; index += 1) h.player.error();
  expect(h.player.destroy).toHaveBeenCalled();
  jest.advanceTimersByTime(59000); await flush();
  expect(h.instances).toHaveLength(1);
  expect(h.fetchSeed).not.toHaveBeenCalled();
});

test('times out a stalled iframe and pauses playback in hidden documents', async () => {
  const h = setup();
  h.controller.start(playlist()); await flush();
  jest.advanceTimersByTime(31000); await flush();
  expect(h.host.dataset.mixError).toBe('mix_player_timeout');
  h.controller.start(playlist({ topic: 'new topic' })); await flush();
  h.player.ready(); h.player.emit(1);
  h.setVisible(false); jest.advanceTimersByTime(1000);
  expect(h.player.pauseVideo).toHaveBeenCalled();
  expect(h.onPlaying).toHaveBeenLastCalledWith(false);
});

test('discards stale seed responses after a configuration change', async () => {
  let resolve;
  const h = setup({ fetchSeed: () => new Promise((done) => { resolve = done; }) });
  h.controller.start(playlist({ mixUrl: '' })); await flush();
  h.controller.start(playlist({ mixUrl: `RD${video(2)}` })); await flush();
  resolve(video(1)); await flush();
  expect(h.instances).toHaveLength(1);
  expect(h.player.options.playerVars.list).toBe(`RD${video(2)}`);
});

test('retains a completed seed lookup while paused before player creation', async () => {
  let resolve;
  const fetchSeed = jest.fn(() => new Promise((done) => { resolve = done; }));
  const h = setup({ fetchSeed });
  const config = playlist({ mixUrl: '' });
  h.controller.start(config); await flush(); h.controller.pause();
  resolve(video(1)); await flush();
  expect(h.instances).toHaveLength(0);
  h.controller.start(config); await flush();
  expect(fetchSeed).toHaveBeenCalledTimes(1);
  expect(h.instances).toHaveLength(1);
});

test('resumes a player that became ready during a long donation without counting paused time as a timeout', async () => {
  const h = setup();
  h.controller.start(playlist()); await flush();
  h.controller.pause(); h.player.ready();
  jest.advanceTimersByTime(120000); await flush();
  h.controller.start(playlist());
  expect(h.player.destroy).not.toHaveBeenCalled();
  expect(h.player.playVideo).toHaveBeenCalledTimes(1);
  h.player.emit(1);
  expect(h.onPlaying).toHaveBeenLastCalledWith(true);
});

test.each(['fetchSeed', 'getApi'])('bounds an unresponsive %s promise and backs off', async (method) => {
  const unresponsive = jest.fn(() => new Promise(() => {}));
  const h = setup({ [method]: unresponsive });
  h.controller.start(playlist({ mixUrl: '' })); await flush();
  jest.advanceTimersByTime(45000); await flush();
  expect(h.host.dataset.mixError).toBe('mix_load_aborted');
  jest.advanceTimersByTime(59000); await flush();
  expect(unresponsive).toHaveBeenCalledTimes(1);
});
