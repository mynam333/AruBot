const loadSource = require('./helpers/load-source.cjs');
const { createYouTubeDurationProbeRunner } = loadSource('src/components/youtubeDurationProbe.ts');
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
let saved;
let runner;

beforeEach(() => {
  jest.useFakeTimers();
  saved = { window: global.window, document: global.document };
  global.window = { location: { origin: 'http://localhost' }, setTimeout, clearTimeout, setInterval, clearInterval };
  global.document = { body: { appendChild() {} }, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }) };
});
afterEach(() => {
  runner?.dispose();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete global[key]; else global[key] = value;
  }
  jest.clearAllTimers(); jest.useRealTimers();
});

function setup() {
  const players = [];
  const report = jest.fn();
  class Player {
    constructor(_mount, options) { this.options = options; this.duration = 0; this.destroy = jest.fn(); players.push(this); }
    getDuration() { return this.duration; }
    cueVideoById() {}
    ready(duration) { this.duration = duration; this.options.events.onReady(); }
    fail() { this.options.events.onError({ data: 150 }); }
  }
  runner = createYouTubeDurationProbeRunner(async () => ({ Player }));
  return { players, report, request: (id, timeoutMs = 10000) => runner.probe({ probeId: `probe-${id}`, mediaProvider: 'youtube', mediaId: `video${String(id).padStart(6, '0')}`, timeoutMs }, report) };
}

test('at most two hidden players exist at once while queued requests still complete', async () => {
  const h = setup();
  for (let i = 0; i < 10; i += 1) h.request(i);
  await flush();
  expect(h.players).toHaveLength(2);
  for (let i = 0; i < 10; i += 1) {
    h.players[i].ready(180 + i);
    await flush();
    expect(h.players.filter(p => !p.destroy.mock.calls.length).length).toBeLessThanOrEqual(2);
  }
  expect(h.report).toHaveBeenCalledTimes(10);
  expect(h.report.mock.calls.every(([value]) => value.durationSec >= 180)).toBe(true);
});

test.each(['success', 'failure'])('replayed %s probe results never create another iframe', async outcome => {
  const h = setup(); h.request(1); await flush();
  if (outcome === 'success') h.players[0].ready(180); else h.players[0].fail();
  for (let i = 0; i < 20; i += 1) h.request(1);
  await flush();
  expect(h.players).toHaveLength(1);
  expect(h.report).toHaveBeenCalledTimes(21);
  expect(h.report.mock.calls[20][0]).toEqual(h.report.mock.calls[0][0]);
});

test('expired queued requests are removed without constructing players', async () => {
  const h = setup();
  for (let i = 0; i < 10; i += 1) h.request(i, 1000);
  await flush(); jest.advanceTimersByTime(1000); await flush();
  expect(h.players).toHaveLength(2);
  expect(h.report).toHaveBeenCalledTimes(10);
  expect(h.players.every(p => p.destroy.mock.calls.length === 1)).toBe(true);
});

test('dispose cancels active and queued probes without starting more players', async () => {
  const h = setup();
  for (let i = 0; i < 10; i += 1) h.request(i);
  await flush(); runner.dispose(); await flush();
  jest.advanceTimersByTime(20000); await flush();
  expect(h.players).toHaveLength(2);
  expect(h.players.every(p => p.destroy.mock.calls.length === 1)).toBe(true);
  expect(h.report).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test('a request burst cannot grow an unlimited hidden-player backlog', async () => {
  const h = setup();
  for (let i = 0; i < 50; i += 1) h.request(i);
  await flush();
  expect(h.players).toHaveLength(2);
  expect(h.report.mock.calls.filter(([value]) => value.errorCode === 'probe_busy')).toHaveLength(18);
});
