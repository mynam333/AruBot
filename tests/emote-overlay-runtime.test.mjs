import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmoteOverlayRuntime } from '../server/emote-overlay-runtime.js';
import { normalizeEmoteSettings } from '../shared/emote-overlay.js';
import { CHZZK_EMOTE_SAMPLES, createChzzkEmoteSamples, chzzkEmoteSampleFallbacks } from '../shared/emote-samples.js';

const token = `emo_${'a'.repeat(43)}`;
const path = `/viewer/emotes/${token}`;
const settle = () => new Promise(resolve => setImmediate(resolve));
const chat = (id, extra = {}) => ({ type: 'chat', ts: 100000, raw: {
  messageId: id, senderChannelId: 'viewer', content: '{:heart:}', emojis: { heart: 'https://ssl.pstatic.net/emotes/heart.webp' },
}, ...extra });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function fixture(t, overrides = {}) {
  let time = 100000;
  const calls = { get: [], append: [], warnings: [], clear: [] };
  const record = { settings: normalizeEmoteSettings({ enabled: true }), epoch: 1, revision: 1, viewerPath: path };
  const store = {
    async get(owner, options) { calls.get.push({ owner, options }); return structuredClone(record); },
    async append(owner, event, options) { calls.append.push({ owner, event, options }); return { ...event, id: '1' }; },
    async save(owner, settings, revision) { assert.equal(revision, record.revision); record.settings = settings; record.revision++; return structuredClone(record); },
    async clear(owner, rotate) { calls.clear.push({ owner, rotate }); record.epoch++; if (rotate) record.viewerPath = `/viewer/emotes/emo_${'b'.repeat(43)}`; return { epoch: record.epoch, viewerPath: record.viewerPath }; },
    async snapshot(token, after) { return { token, after }; },
    async cleanup() {},
    ...overrides,
  };
  const runtime = createEmoteOverlayRuntime({ store, now: () => time, logger: { warn: (...args) => calls.warnings.push(args) } });
  t.after(() => runtime.stop());
  return { runtime, store, record, calls, advance(ms) { time += ms; }, now: () => time };
}

test('ingress deduplicates owner aliases, preserves channel isolation and emits images only', async t => {
  const h = fixture(t);
  let wakes = 0;
  h.runtime.subscribe(token, () => wakes++);
  h.runtime.ingestEvent({ ownerUserId: 'owner', primarySid: 'user:owner', sids: new Set(['owner', 'user:other']) }, chat('one'));
  await settle();
  assert.deepEqual(h.calls.append.map(call => call.owner).sort(), ['other', 'owner']);
  assert.equal(wakes, 2);
  assert.ok(h.calls.append.every(call => call.options.epoch === 1));
  assert.doesNotMatch(JSON.stringify(h.calls.append.map(call => call.event)), /senderChannelId|content|viewer|profile|raw/);
});

test('disabled or unconfigured owners never append and short-lived config cache avoids repeated reads', async t => {
  const h = fixture(t);
  h.record.settings.enabled = false;
  h.runtime.ingestEvent({ ownerUserId: 'owner' }, chat('one'));
  await settle();
  h.runtime.ingestEvent({ ownerUserId: 'owner' }, chat('two'));
  await settle();
  assert.equal(h.calls.get.length, 1);
  assert.equal(h.calls.append.length, 0);
  h.advance(5000);
  h.record.settings.enabled = true;
  h.runtime.ingestEvent({ ownerUserId: 'owner' }, chat('three', { ts: h.now() }));
  await settle();
  assert.equal(h.calls.get.length, 2);
  assert.equal(h.calls.append.length, 1);
  h.store.get = async () => null;
  h.runtime.ingestEvent({ ownerUserId: 'missing' }, chat('four', { ts: h.now() }));
  await settle();
  assert.equal(h.calls.append.length, 1);
});

test('non-chat, old numeric/ISO chat, and absent emotes are rejected before storage', async t => {
  const h = fixture(t);
  for (const event of [chat('one', { type: 'donation' }), chat('two', { ts: 84999 }), chat('three', { ts: new Date(84999).toISOString() }), chat('four', { raw: { content: 'text' } })]) {
    h.runtime.ingestEvent({ ownerUserId: 'owner' }, event);
  }
  await settle();
  assert.equal(h.calls.get.length, 0);
});

test('provider selection handles CIME and YouTube without extra receiver connections', async t => {
  const h = fixture(t);
  h.runtime.ingestEvent({ provider: 'cime', ownerUserId: 'owner' }, chat('cime', { raw: { content: ':wave:', emojis: { ':wave:': 'https://cdn.ci.me/wave.gif' } } }));
  h.runtime.ingestEvent({ provider: 'cime', ownerUserId: 'owner' }, chat('yt', { provider: 'youtube', raw: { receiverRaw: { id: 'yt', message: [{ url: 'https://yt3.ggpht.com/heart.png', emojiText: ':heart:' }] } } }));
  await settle();
  assert.deepEqual(h.calls.append.map(call => call.event.items[0].provider), ['cime', 'youtube']);
});

test('per-owner work queue is bounded to sixteen including in-flight work and stays ordered', async t => {
  const gate = deferred();
  const h = fixture(t);
  const originalGet = h.store.get;
  h.store.get = async (...args) => { await gate.promise; return originalGet(...args); };
  for (let i = 0; i < 100; i++) h.runtime.ingestEvent({ ownerUserId: 'owner' }, chat(String(i)));
  gate.resolve();
  await settle();
  assert.equal(h.calls.append.length, 16);
  assert.equal(new Set(h.calls.append.map(call => call.event.key)).size, 16);
  h.runtime.ingestEvent({ ownerUserId: 'owner' }, chat('new'));
  await settle();
  assert.equal(h.calls.append.length, 17);
});

test('total pending owners are bounded so an incoming burst cannot grow without limit', async t => {
  const h = fixture(t);
  for (let i = 0; i < 1005; i++) h.runtime.ingestEvent({ ownerUserId: `owner-${i}` }, chat(String(i)));
  await settle();
  assert.equal(h.calls.append.length, 1000);
  assert.equal(h.calls.append.some(call => call.owner === 'owner-1000'), false);
});

test('events waiting on storage expire before display and are not given a fresh delivery lifetime', async t => {
  const gate = deferred();
  const h = fixture(t);
  const originalGet = h.store.get;
  h.store.get = async (...args) => { await gate.promise; return originalGet(...args); };
  for (let i = 0; i < 8; i++) h.runtime.ingestEvent({ ownerUserId: 'owner' }, chat(String(i)));
  await settle();
  h.advance(8000);
  gate.resolve();
  await settle();
  assert.equal(h.calls.append.length, 0);
  h.runtime.ingestEvent({ ownerUserId: 'owner' }, chat('fresh', { ts: h.now() }));
  await settle();
  assert.equal(h.calls.append.length, 1);
});

test('clear discards in-flight config and pending work; stale config cannot repopulate the cache', async t => {
  const gate = deferred();
  const h = fixture(t);
  const originalGet = h.store.get;
  let first = true;
  h.store.get = async (...args) => {
    const result = await originalGet(...args);
    if (first) { first = false; await gate.promise; }
    return result;
  };
  h.runtime.ingestEvent({ ownerUserId: 'owner' }, chat('waiting'));
  h.runtime.ingestEvent({ ownerUserId: 'owner' }, chat('queued'));
  await settle();
  await h.runtime.clear('owner');
  gate.resolve();
  await settle();
  assert.equal(h.calls.append.length, 0);
  h.runtime.ingestEvent({ ownerUserId: 'owner' }, chat('after-clear'));
  await settle();
  assert.equal(h.calls.append.length, 1);
  assert.equal(h.calls.append[0].options.epoch, 2);
});

test('configuration failures do not poison cache or block later messages, with bounded warnings', async t => {
  const h = fixture(t);
  const original = h.store.get;
  let fail = true;
  h.store.get = async (...args) => { if (fail) throw new Error('offline'); return original(...args); };
  h.runtime.ingestEvent({ ownerUserId: 'owner' }, chat('first'));
  await settle();
  h.runtime.ingestEvent({ ownerUserId: 'owner' }, chat('second'));
  await settle();
  assert.equal(h.calls.warnings.length, 1);
  fail = false;
  h.runtime.ingestEvent({ ownerUserId: 'owner' }, chat('third'));
  await settle();
  assert.equal(h.calls.append.length, 1);
});

test('watchers are bounded, removable and isolated from a failing listener', async t => {
  const h = fixture(t);
  const off = h.runtime.subscribe(token, () => { throw new Error('bad listener'); });
  let wakes = 0;
  for (let i = 0; i < 7; i++) assert.equal(typeof h.runtime.subscribe(token, () => wakes++), 'function');
  assert.equal(h.runtime.subscribe(token, () => {}), null);
  h.runtime.ingestEvent({ ownerUserId: 'owner' }, chat('one'));
  await settle();
  assert.equal(wakes, 7);
  off(); off();
  assert.equal(typeof h.runtime.subscribe(token, () => {}), 'function');
  for (let i = 1; i < 2000; i++) assert.equal(typeof h.runtime.subscribe(`token-${i}`, () => {}), 'function');
  assert.equal(h.runtime.subscribe('overflow', () => {}), null);
});

test('save invalidates disabled cache and rotation wakes old and new subscribers', async t => {
  const h = fixture(t);
  h.record.settings.enabled = false;
  h.runtime.ingestEvent({ ownerUserId: 'owner' }, chat('disabled'));
  await settle();
  await h.runtime.save('owner', normalizeEmoteSettings({ enabled: true }), 1);
  h.runtime.ingestEvent({ ownerUserId: 'owner' }, chat('enabled'));
  await settle();
  assert.equal(h.calls.append.length, 1);
  let oldWake = 0, newWake = 0;
  h.runtime.subscribe(token, () => oldWake++);
  h.runtime.subscribe(`emo_${'b'.repeat(43)}`, () => newWake++);
  await h.runtime.rotate('owner');
  assert.equal(oldWake, 1);
  assert.equal(newWake, 1);
  assert.deepEqual(h.calls.clear, [{ owner: 'owner', rotate: true }]);
});

test('preview sample catalog contains bounded immutable CHZZK PNG/GIF references, not logos or generated images', () => {
  assert.equal(CHZZK_EMOTE_SAMPLES.length, 8);
  const items = createChzzkEmoteSamples();
  assert.equal(new Set(items.map(item => item.url)).size, 8);
  assert.ok(items.every(item => item.provider === 'chzzk' && item.sample === true));
  assert.ok(items.every(item => /^https:\/\/ssl\.pstatic\.net\/static\/nng\/glive\/icon\/[\w]+\.(png|gif)$/.test(item.url)));
  assert.ok(items.some(item => item.url.endsWith('.gif')));
  assert.ok(items.some(item => item.url.endsWith('.png')));
  items[0].url = 'changed';
  assert.notEqual(createChzzkEmoteSamples()[0].url, 'changed');
  assert.ok(Object.isFrozen(CHZZK_EMOTE_SAMPLES) && CHZZK_EMOTE_SAMPLES.every(Object.isFrozen));
  assert.equal(createChzzkEmoteSamples(100000).length, 30);
  assert.equal(createChzzkEmoteSamples(-1).length, 0);
  assert.equal(createChzzkEmoteSamples(NaN).length, 8);
  for (const sample of CHZZK_EMOTE_SAMPLES) {
    const fallback = chzzkEmoteSampleFallbacks(sample.url);
    assert.equal(fallback.length, 2);
    assert.equal(new Set(fallback).size, 2);
    assert.ok(fallback.every(url => url !== sample.url && CHZZK_EMOTE_SAMPLES.some(item => item.url === url)));
  }
  assert.deepEqual(chzzkEmoteSampleFallbacks('https://cdn.example.com/viewer.gif'), []);
});

test('sample sends five actual CHZZK overlay images from the same preview catalog and reports disabled/limited cases', async t => {
  const h = fixture(t);
  h.record.settings.enabled = false;
  await assert.rejects(h.runtime.test('owner'), { status: 409 });
  h.record.settings.enabled = true;
  assert.deepEqual(await h.runtime.test('owner'), { sent: 5 });
  assert.equal(h.calls.append[0].options.test, true);
  assert.deepEqual(h.calls.append[0].event.items, createChzzkEmoteSamples(5));
  assert.ok(h.calls.append[0].event.items.some(item => item.url.endsWith('.gif')));
  h.store.append = async () => null;
  await assert.rejects(h.runtime.test('owner'), { status: 429 });
});

test('stop is idempotent and prevents new deliveries and subscriptions', async t => {
  const h = fixture(t);
  await h.runtime.stop();
  await h.runtime.stop();
  h.runtime.ingestEvent({ ownerUserId: 'owner' }, chat('late'));
  await settle();
  assert.equal(h.calls.get.length, 0);
  assert.equal(h.runtime.subscribe(token, () => {}), null);
});

test('stop notifies every subscriber before waiting for pending DB work and isolates callback errors', async t => {
  const gate = deferred();
  const h = fixture(t, { async get() { await gate.promise; return null; } });
  const notifications = [];
  h.runtime.subscribe(token, () => { throw new Error('broken listener'); });
  const off = h.runtime.subscribe(token, value => { notifications.push(['same-token', value]); off(); });
  h.runtime.subscribe('other-token', value => notifications.push(['other-token', value]));
  h.runtime.ingestEvent({ ownerUserId: 'owner' }, chat('pending'));
  await settle();
  let stopped = false;
  const stop = h.runtime.stop().then(() => { stopped = true; });
  try {
    assert.deepEqual(notifications, [['same-token', { closed: true }], ['other-token', { closed: true }]]);
    assert.equal(stopped, false);
    assert.equal(h.calls.warnings.length, 1);
    assert.equal(h.runtime.subscribe(token, () => {}), null);
  } finally { gate.resolve(); await stop; }
  await h.runtime.stop();
  assert.equal(notifications.length, 2);
});
