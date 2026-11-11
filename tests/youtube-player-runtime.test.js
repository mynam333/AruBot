const loadSource = require('./helpers/load-source.cjs');
const { applyYouTubeVolume, applyYouTubeCaptionState, applyYouTubePlaybackState, resetYouTubeOptions, createYouTubeApiLoader } = loadSource('src/components/youtubePlayerRuntime.ts');

test('settings are applied once per value and player without repeated low-volume unmuting', () => {
  const player = { mute: jest.fn(), unMute: jest.fn(), setVolume: jest.fn(), unloadModule: jest.fn(), loadModule: jest.fn() };
  applyYouTubeVolume(player, 1); applyYouTubeVolume(player, 1); applyYouTubeVolume(player, 2);
  expect(player.unMute).toHaveBeenCalledTimes(1);
  expect(player.setVolume.mock.calls).toEqual([[1], [2]]);
  applyYouTubeVolume(player, 0); applyYouTubeVolume(player, 2);
  expect(player.unMute).toHaveBeenCalledTimes(2);
  applyYouTubeCaptionState(player, false); applyYouTubeCaptionState(player, false);
  expect(player.unloadModule).toHaveBeenCalledTimes(1);
  resetYouTubeOptions(player); applyYouTubeVolume(player, 2); applyYouTubeCaptionState(player, false);
  expect(player.unloadModule).toHaveBeenCalledTimes(2);
  expect(player.setVolume).toHaveBeenLastCalledWith(2);
});

test.each([0, 1, 3])('state %i never receives a redundant play command', (state) => {
  const player = { getPlayerState: () => state, playVideo: jest.fn(), pauseVideo: jest.fn() };
  expect(applyYouTubePlaybackState(player, false)).toBe(false);
  expect(player.playVideo).not.toHaveBeenCalled();
  applyYouTubePlaybackState(player, true);
  expect(player.pauseVideo).toHaveBeenCalledTimes(1);
});

test('an explicit play action may restart an ended player', () => {
  const player = { getPlayerState: () => 0, playVideo: jest.fn() };
  expect(applyYouTubePlaybackState(player, false, true)).toBe(true);
  expect(player.playVideo).toHaveBeenCalledTimes(1);
});

describe('recoverable YouTube script loading', () => {
  let original;
  let tags;
  beforeEach(() => {
    jest.useFakeTimers();
    original = { window: global.window, document: global.document };
    tags = [];
    global.window = {};
    global.document = {
      querySelector: () => tags.find((tag) => !tag.removed) || null,
      createElement: () => {
        const listeners = new Map();
        return { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name),
          remove() { this.removed = true; }, fail: () => listeners.get('error')?.() };
      },
      body: { appendChild: (tag) => tags.push(tag) },
    };
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
    jest.clearAllTimers(); jest.useRealTimers();
  });
  test('simultaneous players share the pending load and can retry a failed script', async () => {
    const load = createYouTubeApiLoader();
    const first = load();
    expect(load()).toBe(first);
    const failure = expect(first).rejects.toThrow('youtube_iframe_api_load_failed');
    tags[0].fail(); await failure;
    expect(tags[0].removed).toBe(true);
    const second = load();
    expect(tags).toHaveLength(2);
    global.window.YT = { Player: function Player() {} };
    global.window.onYouTubeIframeAPIReady();
    await expect(second).resolves.toBe(global.window.YT);
    expect(jest.getTimerCount()).toBe(0);
  });
  test('a silent network timeout releases the promise for the next retry', async () => {
    const load = createYouTubeApiLoader();
    const first = load();
    const failure = expect(first).rejects.toThrow('youtube_iframe_api_timeout');
    jest.advanceTimersByTime(15000); await failure;
    const second = load();
    global.window.YT = { Player: function Player() {} };
    jest.advanceTimersByTime(250);
    await expect(second).resolves.toBe(global.window.YT);
    expect(jest.getTimerCount()).toBe(0);
  });
  test('another embed replacing the readiness callback cannot leave loading stuck', async () => {
    const load = createYouTubeApiLoader();
    const pending = load();
    global.window.onYouTubeIframeAPIReady = jest.fn();
    global.window.YT = { Player: function Player() {} };
    jest.advanceTimersByTime(250);
    await expect(pending).resolves.toBe(global.window.YT);
  });
});
