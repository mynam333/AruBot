const loadSource = require('./helpers/load-source.cjs');
const loadServerFunctions = require('./helpers/load-server-functions.cjs');
const { resolveAttendanceDate } = loadSource('server/attendance-calendar.js');
const { normalizePointAward } = loadSource('server/point-earning-policy.js');

const sid = 'user:streamer';
const start = Date.parse('2026-10-22T23:00:00+09:00');
const midnight = Date.parse('2026-10-23T00:00:00+09:00');
const session = { live: true, startDate: '2026-10-22', sessionStartTime: start };

function harness(extra = {}) {
  const bindings = {
    resolveAttendanceDate,
    liveSession: new Map([[sid, session]]),
    sessionStateUpdateQueues: new Map(),
    getLiveSessionFromDB: jest.fn(async () => null),
    logPerformanceMetrics: jest.fn(),
    ...extra,
  };
  return { ...bindings, ...loadServerFunctions(['getAttendanceDate'], bindings) };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(midnight);
});
afterEach(() => jest.useRealTimers());

test.each([midnight - 1, midnight, midnight + 5 * 3600000, midnight + 48 * 3600000])(
  'one broadcast keeps its KST start day before and after midnight: %s', (now) => {
    expect(resolveAttendanceDate(now, session)).toBe('2026-10-22');
  },
);

test('a new broadcast after midnight uses its own start day', () => {
  const next = { live: true, sessionStartTime: midnight + 3600000, startDate: '2026-10-23' };
  expect(resolveAttendanceDate(midnight + 7200000, next)).toBe('2026-10-23');
});

test('DB session columns and legacy date-only sessions use the same start-day rule', () => {
  expect(resolveAttendanceDate(midnight, { live: true, session_start_time: String(start), start_date: '2026-10-22' })).toBe('2026-10-22');
  expect(resolveAttendanceDate(midnight, { live: true, start_date: '2026-10-22' })).toBe('2026-10-22');
  expect(resolveAttendanceDate(midnight, { ...session, startDate: '2026-10-21' })).toBe('2026-10-22');
});

test.each([
  null, { ...session, live: false }, { live: true },
  { live: true, startDate: '2026-02-30' },
  { live: true, startDate: 'invalid', sessionStartTime: NaN },
  { live: true, startDate: '2026-10-24', sessionStartTime: midnight + 86400000 },
])('missing, offline, or invalid sessions cannot select a stale or future date: %j', (current) => {
  expect(resolveAttendanceDate(midnight, current)).toBe('2026-10-23');
});

test('ordinary chat attendance uses cached start time without additional DB requests', async () => {
  const h = harness();
  expect(await h.getAttendanceDate(sid)).toBe('2026-10-22');
  expect(h.getLiveSessionFromDB).not.toHaveBeenCalled();
  expect(h.logPerformanceMetrics).toHaveBeenCalledWith('getAttendanceDate', sid, expect.objectContaining({ source: 'session_cache', cacheHit: true }));
});

test('after restart the persisted start time is used, not the restart day', async () => {
  const h = harness({ liveSession: new Map(), getLiveSessionFromDB: jest.fn(async () => ({ live: true, start_date: '2026-10-22', session_start_time: start })) });
  expect(await h.getAttendanceDate(sid)).toBe('2026-10-22');
  expect(h.getLiveSessionFromDB).toHaveBeenCalledWith(sid);
});

test('a failed restore does not silently record attendance on the wrong day', async () => {
  const h = harness({ liveSession: new Map(), getLiveSessionFromDB: jest.fn(async () => { throw new Error('DB unavailable'); }) });
  await expect(h.getAttendanceDate(sid)).rejects.toThrow('DB unavailable');
});

test('attendance waits for an in-flight broadcast transition', async () => {
  const h = harness({ liveSession: new Map([[sid, { live: false }]]) });
  let finish;
  h.sessionStateUpdateQueues.set(sid, new Promise((resolve) => { finish = resolve; }));
  const date = h.getAttendanceDate(sid);
  h.liveSession.set(sid, session);
  finish();
  expect(await date).toBe('2026-10-22');
});

test('a live update arriving during DB recovery wins over the old DB session', async () => {
  jest.setSystemTime(midnight + 7200000);
  const liveSession = new Map();
  const h = harness({ liveSession, getLiveSessionFromDB: async () => {
    liveSession.set(sid, { live: true, sessionStartTime: midnight + 3600000 });
    return { live: true, session_start_time: start };
  } });
  expect(await h.getAttendanceDate(sid)).toBe('2026-10-23');
});

test('attendance commands share one recorded day and award points once across midnight', async () => {
  const h = harness();
  const days = new Set();
  const record = jest.fn(async (_sid, _user, _name, day) => {
    const isNew = !days.has(day);
    days.add(day);
    return { isNew, streak: 1, totalDays: days.size };
  });
  const award = jest.fn();
  const render = jest.fn(async (_message, context) => context.date);
  const { recordAttendanceFromCommand } = loadServerFunctions(['recordAttendanceFromCommand'], {
    getAttendanceDate: h.getAttendanceDate,
    attendanceFeatureEnabled: () => true,
    admitChatCommand: async () => true,
    recordAttendanceAndGetStreak: record,
    attendanceDedupe: new Set(),
    getUserAttendanceTotalDays: async () => days.size,
    normalizePointAward,
    isChannelPointExcluded: async () => false,
    incrChannelPoints: award,
    renderAttendanceMessage: render,
    normalizeAttendanceCommandKeyword: () => '!attendance',
  });
  const args = { sid, settings: { channelPointsPerAttendance: 50 }, userId: 'viewer', username: 'Viewer', channelUid: 'channel' };
  jest.setSystemTime(midnight - 1000);
  const before = await recordAttendanceFromCommand(args);
  jest.setSystemTime(midnight + 1000);
  const after = await recordAttendanceFromCommand(args);
  expect(before).toMatchObject({ date: '2026-10-22', isNew: true, points: 50 });
  expect(after).toMatchObject({ date: '2026-10-22', isNew: false, points: 0 });
  expect(days.size).toBe(1);
  expect(award).toHaveBeenCalledTimes(1);
  expect(render).toHaveBeenLastCalledWith(undefined, expect.objectContaining({ date: '2026-10-22', executeSpecialVariables: false }));
});
