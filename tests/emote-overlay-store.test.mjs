import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmoteOverlayStore } from '../server/emote-overlay-store.js';
import { normalizeEmoteSettings } from '../shared/emote-overlay.js';
import { createChzzkEmoteSamples } from '../shared/emote-samples.js';

const token = `emo_${'a'.repeat(43)}`;
const image = { url: 'https://ssl.pstatic.net/emotes/heart.webp', name: 'heart', provider: 'chzzk' };
const settings = extra => normalizeEmoteSettings({ enabled: true, ...extra });
const row = extra => ({ owner_user_id: 'owner', viewer_token: token, config: settings(), revision: 1, epoch: '4', ...extra });
const event = extra => ({ key: 'message-key', actor: 'actor-hash', items: [image], ...extra });
const savedEvent = extra => ({ id: '17', created_at: '2026-10-12T01:00:00Z', payload: { items: [image], settings: settings(), seed: 42 }, ...extra });

function fixture(t, steps = []) {
  const calls = [], clients = [];
  let identityCalls = 0, failIdentity = false;
  const pg = {
    async query(sql, values = []) {
      const text = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: text, values });
      if (/^(begin|commit|rollback)$/.test(text) || text.startsWith('select pg_advisory_xact_lock') || text.startsWith('create table if not exists emote_overlay_settings')) return { rows: [] };
      const step = steps.shift();
      assert.ok(step, `Unexpected query: ${text}`);
      assert.match(text, step.sql);
      if (step.values) assert.deepEqual(values, step.values);
      if (step.check) step.check(values, text);
      if (step.error) throw step.error;
      return { rows: structuredClone(step.rows || []) };
    },
  };
  const store = createEmoteOverlayStore({
    withPgClient: async (fn, retries) => { clients.push(retries); return fn(pg); },
    ensureIdentityTables: async () => { identityCalls++; if (failIdentity) { failIdentity = false; throw new Error('schema offline'); } },
  });
  t.after(() => assert.equal(steps.length, 0, 'All expected SQL must execute'));
  return { store, calls, clients, steps, get identityCalls() { return identityCalls; }, failIdentity() { failIdentity = true; } };
}

const locked = current => ({ sql: /^select \* from emote_overlay_settings where owner_user_id=\$1 for update$/, values: ['owner'], rows: current ? [current] : [] });
const insertSettings = { sql: /^insert into emote_overlay_settings/, check(values) { assert.equal(values[0], 'owner'); assert.match(values[1], /^emo_[\w-]{43}$/); } };
const viewerRow = current => ({ sql: /^select \* from emote_overlay_settings where viewer_token=\$1 for share$/, values: [token], rows: current ? [current] : [] });
const latest = (id = '17') => ({ sql: /^select coalesce\(max\(id\),0\) as id from emote_overlay_events where owner_user_id=\$1$/, values: ['owner'], rows: [{ id }] });
const duplicate = (rows = []) => ({ sql: /where owner_user_id=\$1 and event_key=\$2$/, values: ['owner', 'message-key'], rows });
const cooldown = (rows = []) => ({ sql: /where owner_user_id=\$1 and actor_key=\$2 and created_at>clock_timestamp\(\)-\(\$3 \* interval '1 millisecond'\) limit 1$/, values: ['owner', 'actor-hash', 500], rows });
const budget = (count = '0') => ({ sql: /coalesce\(sum\(count\),0\).*where owner_user_id=\$1.*interval '1 second'/, values: ['owner'], rows: [{ count }] });
const prune = { sql: /^delete from emote_overlay_events where owner_user_id=\$1 and created_at<clock_timestamp\(\)-interval '30 seconds'$/, values: ['owner'] };

test('unconfigured owners are not implicitly created by chat reads; admin creation is tokenized', async t => {
  const db = fixture(t, [
    { sql: /^select \* from emote_overlay_settings where owner_user_id=\$1$/, values: ['owner'], rows: [] },
    insertSettings, locked(row({ config: {} })),
    { sql: /^select \* from emote_overlay_settings where owner_user_id=\$1$/, values: ['owner'], rows: [row({ config: {} })] },
  ]);
  assert.equal(await db.store.get('owner'), null);
  const value = await db.store.get('owner', { create: true });
  assert.equal(value.settings.enabled, false);
  assert.equal(value.viewerPath, `/viewer/emotes/${token}`);
  assert.equal(value.epoch, 4);
  assert.equal(db.identityCalls, 1);
});

test('schema initialization coalesces and failed initialization can retry', async t => {
  const db = fixture(t);
  db.failIdentity();
  await assert.rejects(db.store.ensureSchema(), /schema offline/);
  await Promise.all([db.store.ensureSchema(), db.store.ensureSchema(), db.store.ensureSchema()]);
  assert.equal(db.identityCalls, 2);
  assert.equal(db.calls.filter(call => call.sql.startsWith('create table')).length, 1);
  assert.ok(db.clients.every(value => value === 0));
});

test('saving rejects missing settings, malformed revisions and invalid values before database work', async t => {
  const db = fixture(t);
  for (const [value, revision] of [[undefined, 1], [null, 1], [[], 1], [settings(), '1'], [settings(), [1]], [settings(), 0], [{ size: -1 }, 1]]) {
    await assert.rejects(db.store.save('owner', value, revision), { status: 400 });
  }
  assert.equal(db.calls.length, 0);
});

test('revision conflicts roll back rather than overwrite or retry a write', async t => {
  const db = fixture(t, [insertSettings, locked(row({ revision: 2 }))]);
  await assert.rejects(db.store.save('owner', settings(), 1), { status: 409 });
  assert.equal(db.calls.at(-1).sql, 'rollback');
  assert.equal(db.calls.filter(call => call.sql.startsWith('update ')).length, 0);
  assert.ok(db.clients.every(value => value === 0));
});

test('disabling advances epoch and removes only this owner events in the same transaction', async t => {
  const next = settings({ enabled: false });
  const db = fixture(t, [insertSettings, locked(row()),
    { sql: /^update emote_overlay_settings set config=\$2,revision=revision\+1,epoch=epoch\+\$3.*where owner_user_id=\$1$/, values: ['owner', JSON.stringify(next), 1] },
    { sql: /^delete from emote_overlay_events where owner_user_id=\$1$/, values: ['owner'] },
  ]);
  const result = await db.store.save('owner', next, 1);
  assert.equal(result.revision, 2);
  assert.equal(result.epoch, 5);
  assert.equal(result.settings.enabled, false);
  assert.equal(db.calls.at(-1).sql, 'commit');
});

test('enabled updates preserve epoch and unknown settings never enter persistence', async t => {
  const next = settings({ mode: 'rain' });
  const db = fixture(t, [insertSettings, locked(row()),
    { sql: /^update emote_overlay_settings.*where owner_user_id=\$1$/, values: ['owner', JSON.stringify(next), 0] },
  ]);
  const result = await db.store.save('owner', { ...next, secret: 'discard-me' }, 1);
  assert.equal(result.epoch, 4);
  assert.equal(result.settings.secret, undefined);
});

test('clear and rotation advance epoch, invalidate pending events, and rotate only when requested', async t => {
  let rotated;
  const db = fixture(t, [
    insertSettings, locked(row()),
    { sql: /^update emote_overlay_settings set epoch=epoch\+1,viewer_token=\$2.*where owner_user_id=\$1$/, values: ['owner', token] },
    { sql: /^delete from emote_overlay_events where owner_user_id=\$1$/, values: ['owner'] },
    insertSettings, locked(row({ epoch: '5' })),
    { sql: /^update emote_overlay_settings set epoch=epoch\+1,viewer_token=\$2.*where owner_user_id=\$1$/, check(values) { assert.equal(values[0], 'owner'); assert.match(values[1], /^emo_[\w-]{43}$/); assert.notEqual(values[1], token); rotated = values[1]; } },
    { sql: /^delete from emote_overlay_events where owner_user_id=\$1$/, values: ['owner'] },
  ]);
  assert.equal((await db.store.clear('owner')).viewerPath, `/viewer/emotes/${token}`);
  const result = await db.store.clear('owner', true);
  assert.equal(result.epoch, 6);
  assert.equal(result.viewerPath, `/viewer/emotes/${rotated}`);
});

test('append is disabled for missing owners, disabled config, excluded providers, stale epochs and expired work', async t => {
  const db = fixture(t, [locked(null), locked(row({ config: {} })), locked(row({ config: settings({ providers: { chzzk: false } }) })), locked(row()), locked(row())]);
  assert.equal(await db.store.append('owner', event()), null);
  assert.equal(await db.store.append('owner', event()), null);
  assert.equal(await db.store.append('owner', event()), null);
  assert.equal(await db.store.append('owner', event(), { epoch: 3 }), null);
  assert.equal(await db.store.append('owner', event(), { epoch: 4, expiresAt: 0 }), null);
  assert.equal(db.calls.some(call => call.sql.startsWith('insert ')), false);
});

test('dedupe, actor cooldown and per-second limits short-circuit under the owner lock', async t => {
  const db = fixture(t, [locked(row()), duplicate([{ id: '1' }]), locked(row()), duplicate(), cooldown([{ id: '2' }]), locked(row()), duplicate(), cooldown(), budget('20')]);
  for (let i = 0; i < 3; i++) assert.equal(await db.store.append('owner', event()), null);
  assert.equal(db.calls.filter(call => call.sql.endsWith('for update')).length, 3);
  assert.equal(db.calls.some(call => call.sql.startsWith('insert ')), false);
});

test('append clips message/rate limits, strips private fields and unsafe images, and prunes old events', async t => {
  const next = settings({ maxPerMessage: 4, perSecond: 10 });
  let payload;
  const db = fixture(t, [locked(row({ config: next })), duplicate(), cooldown(), budget('8'),
    { sql: /^insert into emote_overlay_events\(owner_user_id,event_key,actor_key,epoch,count,payload\).*returning \*$/, check(values) {
      assert.deepEqual(values.slice(0, 5), ['owner', 'message-key', 'actor-hash', '4', 2]);
      payload = JSON.parse(values[5]);
      assert.deepEqual(payload.items, [image, image]);
      assert.deepEqual(payload.settings, next);
      assert.ok(Number.isInteger(payload.seed));
    }, rows: [savedEvent()] }, prune,
  ]);
  const result = await db.store.append('owner', event({ items: [
    { ...image, url: 'http://127.0.0.1/private' }, { ...image, provider: '__proto__' },
    ...Array.from({ length: 8 }, () => ({ ...image, userId: 'private', raw: 'chat text', avatar: 'private' })),
  ] }), { epoch: 4 });
  assert.equal(result.id, '17');
  assert.equal(result.createdAt, Date.parse('2026-10-12T01:00:00Z'));
  assert.doesNotMatch(JSON.stringify(payload), /private|avatar|raw|userId/);
});

test('per-message cap applies independently of the per-second budget', async t => {
  const db = fixture(t, [locked(row({ config: settings({ maxPerMessage: 2, cooldownMs: 0 }) })), duplicate(), budget(),
    { sql: /^insert into emote_overlay_events/, check(values) { assert.equal(values[4], 2); }, rows: [savedEvent()] }, prune]);
  await db.store.append('owner', event({ items: Array(10).fill(image) }));
});

test('admin sample bypasses provider/cooldown only, not enabled or aggregate limits', async t => {
  const sample = { url: '/files/logo.png', name: 'sample', provider: 'sample' };
  const db = fixture(t, [locked(row()), duplicate(), budget(),
    { sql: /^insert into emote_overlay_events/, check(values) { assert.deepEqual(JSON.parse(values[5]).items, [sample]); }, rows: [savedEvent()] }, prune,
    locked(row()), duplicate(), budget('20'), locked(row({ config: {} }))]);
  await db.store.append('owner', event({ items: [sample] }), { test: true });
  assert.equal(await db.store.append('owner', event({ items: [sample] }), { test: true }), null);
  assert.equal(await db.store.append('owner', event({ items: [sample] }), { test: true }), null);
});

test('only curated admin samples retain the fallback marker, even when CHZZK chat is disabled', async t => {
  const sample = createChzzkEmoteSamples(1)[0];
  const unknown = { ...image, sample: true };
  const normalChat = { ...sample };
  delete normalChat.sample;
  const db = fixture(t, [
    locked(row({ config: settings({ providers: { chzzk: false } }) })), duplicate(), budget(),
    { sql: /^insert into emote_overlay_events/, check(values) {
      assert.deepEqual(JSON.parse(values[5]).items, [sample, image]);
    }, rows: [savedEvent()] }, prune,
    locked(row()), duplicate(), cooldown(), budget(),
    { sql: /^insert into emote_overlay_events/, check(values) {
      assert.deepEqual(JSON.parse(values[5]).items, [normalChat]);
    }, rows: [savedEvent()] }, prune,
  ]);
  await db.store.append('owner', event({ items: [sample, unknown] }), { test: true });
  await db.store.append('owner', event({ items: [sample] }));
});

test('failed append rolls back and propagates DB errors without stale success or automatic retry', async t => {
  const db = fixture(t, [locked(row()), duplicate(), cooldown(), budget(), { sql: /^insert into emote_overlay_events/, error: new Error('write unavailable') }]);
  await assert.rejects(db.store.append('owner', event()), /write unavailable/);
  assert.equal(db.calls.at(-1).sql, 'rollback');
  assert.equal(db.calls.filter(call => call.sql.startsWith('insert ')).length, 1);
  assert.ok(db.clients.every(value => value === 0));
});

test('token and bigint cursor validation rejects overflow/malformed values before PG', async t => {
  const db = fixture(t);
  for (const bad of ['9223372036854775808', '99999999999999999999', '-1', '1.2', ' 1', '1e3', '', ['1'], {}, 1]) {
    await assert.rejects(db.store.snapshot(token, bad), { status: 400 });
  }
  for (const bad of ['', 'emo_x', [token], {}, null]) await assert.rejects(db.store.snapshot(bad, null), { status: 401 });
  assert.equal(db.calls.length, 0);
});

test('initial/disabled snapshots have no backlog and revoked tokens fail authentication', async t => {
  const db = fixture(t, [viewerRow(row()), latest(), viewerRow(row({ config: {} })), latest(), viewerRow(null)]);
  const initial = await db.store.snapshot(token, null);
  assert.equal(initial.cursor, '17');
  assert.deepEqual(initial.events, []);
  assert.equal(initial.viewer_token, undefined);
  assert.equal(initial.owner_user_id, undefined);
  assert.deepEqual((await db.store.snapshot(token, '0')).events, []);
  await assert.rejects(db.store.snapshot(token, '17'), { status: 401 });
});

test('recovery query enforces owner, epoch, eight-second TTL, ordered bounded cursor without precision loss', async t => {
  const after = '9223372036854775807';
  const db = fixture(t, [viewerRow(row()), latest('9223372036854775807'),
    { sql: /^select \* from emote_overlay_events where owner_user_id=\$1 and epoch=\$2 and id>\$3 and created_at>clock_timestamp\(\)-interval '8 seconds' order by id limit 120$/, values: ['owner', '4', after], rows: [] },
    viewerRow(row()), latest('500'),
    { sql: /where owner_user_id=\$1 and epoch=\$2 and id>\$3/, values: ['owner', '4', '20'], rows: Array.from({ length: 120 }, (_, i) => savedEvent({ id: String(21 + i) })) },
  ]);
  const max = await db.store.snapshot(token, after);
  assert.equal(max.cursor, after);
  const page = await db.store.snapshot(token, '20');
  assert.equal(page.events.length, 120);
  assert.equal(page.cursor, '140');
  assert.deepEqual(Object.keys(page.events[0]).sort(), ['createdAt', 'id', 'items', 'seed', 'settings']);
});

test('global cleanup has a strict retention predicate', async t => {
  const db = fixture(t, [{ sql: /^delete from emote_overlay_events where created_at<clock_timestamp\(\)-interval '30 seconds'$/, values: [] }]);
  await db.store.cleanup();
});
