import test from 'node:test';
import assert from 'node:assert/strict';
import { connectEmoteOverlay, createEmoteInbox } from '../src/features/emote-overlay/emote-connection.js';
import { DEFAULT_EMOTE_SETTINGS, EMOTE_NUMERIC_FIELDS, normalizeEmoteSettings, safeEmoteImageUrl } from '../shared/emote-overlay.js';
import { botManagementRoutePolicy, canUseBotManagementRoute, redactBotManagerLogSecrets } from '../shared/bot-management-policy.js';

const packet = (id, age = 0) => ({ id, createdAt: 100000 - age, items: [{ url: 'https://cdn.example.com/emote.webp' }] });
const snapshot = (cursor, events = [], extra = {}) => ({ cursor, events, epoch: 0, revision: 1, serverNow: 100000, settings: { enabled: true }, ...extra });

test('initial connection skips history; overlapping snapshots never repeat images', () => {
  const got = []; const inbox = createEmoteInbox(value => got.push(value));
  inbox.accept(snapshot('20', [packet('20')]));
  inbox.accept(snapshot('22', [packet('21'), packet('22'), packet('22')]));
  inbox.accept(snapshot('21', [packet('21')]));
  assert.deepEqual(got.map(value => value.events.map(event => event.id)), [[], ['21', '22'], []]);
  assert.equal(inbox.cursor, '22');
});

test('clear epoch wins over stale responses and expired events cannot replay', () => {
  const got = []; const inbox = createEmoteInbox(value => got.push(value));
  inbox.accept(snapshot('2'));
  inbox.accept(snapshot('5', [packet('3', 8001), packet('4', -10000), packet('5', 1000)]));
  assert.deepEqual(got.at(-1).events.map(event => event.id), ['5']);
  inbox.accept(snapshot('0', [], { epoch: 1 }));
  assert.equal(got.at(-1).cleared, true);
  assert.equal(inbox.accept(snapshot('5', [packet('5')])), false);
  inbox.accept(snapshot('6', [packet('6')], { epoch: 1 }));
  assert.equal(got.at(-1).events[0].id, '6');
});

test('disabled and malformed snapshots do not enqueue anything', () => {
  const got = []; const inbox = createEmoteInbox(value => got.push(value));
  assert.equal(inbox.accept(snapshot('9999999999999999999')), false);
  assert.equal(inbox.accept(snapshot('1', [], { epoch: NaN })), false);
  inbox.accept(snapshot('1'));
  inbox.accept(snapshot('2', [packet('2')], { settings: { enabled: false }, revision: 2 }));
  assert.deepEqual(got.at(-1).events, []);
  assert.equal(inbox.accept(snapshot('3', [packet('3')], { revision: 1 })), false);
});

function environment() {
  let id = 0;
  const timers = new Map(), intervals = new Map(), sources = [], fetches = [], got = [];
  class Source {
    handlers = {}; closed = false;
    constructor(url) { this.url = url; sources.push(this); }
    addEventListener(name, callback) { this.handlers[name] = callback; }
    send(name, value) { this.handlers[name]?.({ data: JSON.stringify(value) }); }
    close() { this.closed = true; }
  }
  const env = { EventSource: Source,
    fetch: (...args) => new Promise(resolve => fetches.push({ args, resolve })),
    setTimeout: (fn, delay) => { timers.set(++id, { fn, delay }); return id; },
    clearTimeout: key => timers.delete(key),
    setInterval: fn => { intervals.set(++id, fn); return id; }, clearInterval: key => intervals.delete(key),
  };
  const stop = connectEmoteOverlay({ streamUrl: 'https://api.example.com/stream?token=x', stateUrl: 'https://api.example.com/state?token=x', onSnapshot: value => got.push(value), onClear: () => got.push('cleared') }, env);
  return { env, stop, timers, intervals, sources, fetches, got };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('SSE failure falls back to HTTP and retries forever with cursor preservation', async () => {
  const e = environment();
  e.sources[0].send('state', snapshot('10'));
  e.sources[0].onerror();
  assert.equal(e.sources[0].closed, true);
  assert.match(e.fetches[0].args[0], /after=10/);
  e.fetches[0].resolve({ ok: true, json: async () => snapshot('11', [packet('11')]) });
  await flush();
  assert.equal(e.got.at(-1).events[0].id, '11');
  const retry = [...e.timers.values()].find(timer => timer.delay < 2000); retry.fn();
  assert.match(e.sources.at(-1).url, /after=11/);
  e.sources.at(-1).send('state', snapshot('11', [packet('11')]));
  assert.deepEqual(e.got.at(-1).events, []);
  e.stop(); assert.equal(e.intervals.size, 0); assert.equal(e.timers.size, 0);
});

test('late HTTP responses cannot overwrite a newer stream snapshot; cleanup aborts requests', async () => {
  const e = environment();
  e.sources[0].send('state', snapshot('1')); e.sources[0].onerror();
  [...e.timers.values()].find(timer => timer.delay < 2000).fn();
  e.sources.at(-1).send('state', snapshot('3', [packet('2'), packet('3')]));
  e.fetches[0].resolve({ ok: true, json: async () => snapshot('2', [packet('2')]) });
  await flush(); assert.equal(e.got.at(-1).cursor, '3');
  e.sources.at(-1).onerror(); const pending = e.fetches.at(-1);
  e.stop(); assert.equal(pending.args[1].signal.aborted, true);
  pending.resolve({ ok: true, json: async () => snapshot('4', [packet('4')]) });
  await flush(); assert.equal(e.got.at(-1).cursor, '3');
});

test('all documented numeric limits are enforced without mutating defaults', () => {
  const before = JSON.stringify(DEFAULT_EMOTE_SETTINGS);
  const set = (path, value) => { const [key, sub] = path.split('.'); return sub ? { [key]: { [sub]: value } } : { [key]: value }; };
  for (const [path, [min, max]] of Object.entries(EMOTE_NUMERIC_FIELDS)) {
    assert.throws(() => normalizeEmoteSettings(set(path, min - 1), { strict: true }), { status: 400 });
    assert.throws(() => normalizeEmoteSettings(set(path, max + 1), { strict: true }), { status: 400 });
    assert.throws(() => normalizeEmoteSettings(set(path, '1'), { strict: true }), { status: 400 });
  }
  const result = normalizeEmoteSettings({ area: { x: 95, y: 95, width: 100, height: 100 }, unknown: true });
  assert.deepEqual(result.area, { x: 95, y: 95, width: 5, height: 5 });
  assert.equal(result.unknown, undefined); assert.equal(JSON.stringify(DEFAULT_EMOTE_SETTINGS), before);
});

test('image metadata cannot point to local hosts, executable protocols or credentialed URLs', () => {
  for (const value of ['javascript:alert(1)', 'data:image/svg+xml,hi', 'http://cdn.example.com/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://u:p@cdn.example.com/a', 'https://cdn.example.com:3001/a']) assert.equal(safeEmoteImageUrl(value), null);
  assert.equal(safeEmoteImageUrl('https://yt3.ggpht.com/emote=s48'), 'https://yt3.ggpht.com/emote=s48');
});

test('delegated permissions are explicit and log output masks overlay secrets', () => {
  const reader = { role: 'manager', scopes: ['emotes:read'] };
  assert.equal(canUseBotManagementRoute(reader, botManagementRoutePolicy('GET', '/api/emote-overlay')), true);
  for (const route of ['settings', 'clear', 'rotate', 'test']) assert.equal(canUseBotManagementRoute(reader, botManagementRoutePolicy('POST', `/api/emote-overlay/${route}`)), false);
  assert.equal(botManagementRoutePolicy('GET', '/api/emote-overlay/state'), null);
  assert.equal(botManagementRoutePolicy('GET', '/api/emote-overlay/stream'), null);
  assert.equal(redactBotManagerLogSecrets({ path: '/viewer/emotes/secret', query: '/api/emote-overlay/state?token=secret' }).path, '/viewer/emotes/[redacted]');
});
