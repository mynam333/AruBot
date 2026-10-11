import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createParticipationWheelStore } from '../server/participation-wheel.js';

// The fake stages rows/receipts/points until commit and models SID and identity
// locks separately, so multiple store instances can share one durable database.
function fixture() {
  const db = { wheels: new Map(), receipts: new Map(), balances: new Map(), locks: new Map(),
    calls: [], deductions: [], credits: [], draws: [], now: 1800000000000, nextSlot: 0,
    failNext: '', loseCommitResponse: false, nextId: 0, nextClient: 0 };
  async function acquire(key) {
    const previous = db.locks.get(key) || Promise.resolve();
    let release;
    const tail = new Promise((resolve) => { release = resolve; });
    db.locks.set(key, tail);
    await previous;
    return release;
  }
  db.withPgClient = async (run) => {
    const pg = { id: ++db.nextClient, active: false, held: new Map(), balanceChanges: new Map(), receiptChanges: new Map() };
    const unlock = () => { for (const release of pg.held.values()) release(); pg.held.clear(); };
    pg.lock = async (key) => { if (!pg.held.has(key)) pg.held.set(key, await acquire(key)); };
    pg.balance = (key) => pg.balanceChanges.get(key) ?? db.balances.get(key) ?? 0;
    pg.query = async (raw, params = []) => {
      const sql = raw.replace(/\s+/gu, ' ').trim();
      db.calls.push({ sql, params, client: pg.id });
      if (db.failNext && sql.startsWith(db.failNext)) { db.failNext = ''; throw new Error('injected database failure'); }
      if (sql === 'begin') { pg.active = true; return { rows: [] }; }
      if (sql === 'rollback') { pg.active = false; unlock(); return { rows: [] }; }
      assert.equal(pg.active, true, `query outside transaction: ${sql}`);
      if (sql === 'commit') {
        if (pg.state) db.wheels.set(pg.sid, structuredClone(pg.state));
        for (const [key, value] of pg.receiptChanges) db.receipts.set(key, structuredClone(value));
        for (const [key, value] of pg.balanceChanges) db.balances.set(key, value);
        pg.active = false;
        unlock();
        if (db.loseCommitResponse) { db.loseCommitResponse = false; throw new Error('lost commit response'); }
        return { rows: [] };
      }
      if (sql.startsWith('insert into public.participation_wheels ')) {
        await pg.lock(`wheel:${params[0]}`);
        pg.sid = params[0];
        pg.state = structuredClone(db.wheels.get(pg.sid) || JSON.parse(params[1]));
      } else if (sql === 'select state from public.participation_wheels where sid = $1 for update') {
        assert.equal(pg.sid, params[0]);
        assert.ok(pg.held.has(`wheel:${pg.sid}`));
        return { rows: [{ state: structuredClone(pg.state) }] };
      } else if (sql.startsWith('select operation, fingerprint, outcome')) {
        return { rows: [db.receipts.get(JSON.stringify(params))].filter(Boolean).map((value) => structuredClone(value)) };
      } else if (sql.startsWith('select floor(extract(epoch from clock_timestamp())')) {
        return { rows: [{ now_ms: String(db.now) }] };
      } else if (sql.startsWith('update public.participation_wheels ')) {
        assert.equal(pg.sid, params[0]);
        pg.state = JSON.parse(params[1]);
      } else if (sql.startsWith('insert into public.participation_wheel_requests ')) {
        const key = JSON.stringify(params.slice(0, 2));
        assert.equal(db.receipts.has(key), false);
        pg.receiptChanges.set(key, { operation: params[2], fingerprint: params[3], outcome: JSON.parse(params[4]) });
      } else if (sql.startsWith('select pg_advisory_xact_lock')) await pg.lock(`point:${params[0]}`);
      else throw new Error(`unexpected SQL: ${sql}`);
      return { rows: [], rowCount: 1 };
    };
    try { return await run(pg); }
    finally { assert.equal(pg.active, false, 'transaction must close'); unlock(); }
  };
  const userIdentity = async (pg, userId) => {
    assert.equal(pg.active, true);
    return { canonicalUserId: userId === 'alias-viewer' ? 'viewer' : userId, identityKeys: [userId] };
  };
  const channelIdentity = async (pg, channelUid) => {
    assert.equal(pg.active, true);
    return { canonicalChannelUid: channelUid === 'alias-channel' ? 'channel' : channelUid };
  };
  db.dependencies = {
    withPgClient: db.withPgClient, resolvePointUserIdentity: userIdentity, resolvePointChannelIdentity: channelIdentity,
    randomUUID: () => `id-${++db.nextId}`,
    randomInt: (count) => { db.draws.push(count); return db.nextSlot; },
    deductChannelPointsIfEnoughWithClient: async (pg, channelUid, userId, _username, amount) => {
      const channel = (await channelIdentity(pg, channelUid)).canonicalChannelUid;
      const user = (await userIdentity(pg, userId)).canonicalUserId;
      const key = `${channel}:${user}`;
      await pg.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
      db.deductions.push({ client: pg.id, key, amount });
      const sufficient = pg.balance(key) >= amount;
      if (sufficient) pg.balanceChanges.set(key, pg.balance(key) - amount);
      return { deducted: sufficient, streamerUid: channel, userId: user, amount };
    },
    upsertCanonicalPointDelta: async (pg, channel, user, _username, amount) => {
      const key = `${channel}:${user}`;
      assert.ok(pg.held.has(`point:${key}`));
      db.credits.push({ client: pg.id, key, amount });
      pg.balanceChanges.set(key, pg.balance(key) + amount);
      if (db.failRefund) { db.failRefund = false; throw new Error('refund failure'); }
    },
  };
  db.store = () => createParticipationWheelStore(db.dependencies);
  db.api = db.store();
  db.act = (action, fields = {}, sid = 'sid') => db.api.actParticipationWheel(sid, { action, requestId: `request-${++db.nextId}`, ...fields });
  db.settings = (settings, sid = 'sid') => db.api.updateParticipationWheel(sid, settings, `settings-${++db.nextId}`);
  db.enter = (source = 'chat', fields = {}, sid = 'sid') => db.api.enterParticipationWheel(sid, {
    source, userId: 'viewer', username: 'Viewer', label: 'Entry', channelUid: 'channel',
    eventId: `chzzk:${source}:${++db.nextId}`, ...fields,
  });
  db.prepare = async (settings = {}) => { await db.settings(settings); await db.act('open'); };
  db.balance = (user = 'viewer', channel = 'channel') => db.balances.get(`${channel}:${user}`) || 0;
  db.fund = (amount = 10000, user = 'viewer', channel = 'channel') => db.balances.set(`${channel}:${user}`, amount);
  db.advance = (ms = 8000) => { db.now += ms; };
  return db;
}

test('get is durable, SID isolated and does not increment revision on repeated reads', async () => {
  const db = fixture();
  const wheel = await db.api.getParticipationWheel('sid');
  assert.equal(wheel.collecting, false);
  assert.deepEqual(await db.store().getParticipationWheel('sid'), wheel);
  assert.notEqual((await db.api.getParticipationWheel('other')).roundId, wheel.roundId);
  assert.equal(db.wheels.size, 2);
  assert.equal(db.receipts.size, 0);
});

test('all mutations require a stable ID before connecting and invalid sid is rejected', async () => {
  const db = fixture();
  await assert.rejects(db.api.updateParticipationWheel('sid', {}, ''), { code: 'invalid_request_id' });
  await assert.rejects(db.api.actParticipationWheel('sid', { action: 'open' }), { code: 'invalid_request_id' });
  await assert.rejects(db.enter('points', { eventId: '' }), { code: 'invalid_request_id' });
  await assert.rejects(db.api.getParticipationWheel(''), { code: 'invalid_sid' });
  assert.equal(db.calls.length, 0);
});

test('concurrent event duplicates across instances charge once and return durable results', async () => {
  const db = fixture();
  await db.prepare({ points: { enabled: true } }); db.fund();
  const payload = { source: 'points', userId: 'viewer', username: 'Viewer', label: 'Entry', channelUid: 'channel', slots: 3, eventId: 'youtube:chat:stable' };
  const results = await Promise.all([db.api, db.store(), db.store()].map((api) => api.enterParticipationWheel('sid', payload)));
  assert.equal(results.filter((result) => result.duplicate).length, 2);
  assert.equal(db.deductions.length, 1);
  assert.equal(db.balance(), 9700);
  assert.equal(results[0].wheel.entries.length, 1);
  assert.equal(results[0].cost, 300);
  const changedReplay = await db.api.enterParticipationWheel('sid', { ...payload, slots: 9, label: 'Changed metadata' });
  assert.equal(changedReplay.duplicate, true);
  assert.equal(changedReplay.slots, 3);
  assert.equal(db.balance(), 9700);
  const debit = db.deductions[0];
  const calls = db.calls.filter((call) => call.client === debit.client).map((call) => call.sql);
  assert.ok(calls.findIndex((sql) => sql.includes('for update')) < calls.findIndex((sql) => sql.includes('pg_advisory_xact_lock')));
  assert.equal(calls.at(-1), 'commit');
});

test('admin request retries never reapply old controls, draws, clears or settings', async () => {
  const db = fixture();
  const open = { action: 'open', requestId: 'open-once' };
  await db.api.actParticipationWheel('sid', open);
  await db.act('close');
  const closed = await db.api.actParticipationWheel('sid', open);
  assert.equal(closed.collecting, false);
  await db.api.updateParticipationWheel('sid', { title: 'First' }, 'title-once');
  await db.settings({ title: 'Second' });
  assert.equal((await db.api.updateParticipationWheel('sid', { title: 'First' }, 'title-once')).settings.title, 'Second');
  await assert.rejects(db.api.updateParticipationWheel('sid', { title: 'Third' }, 'title-once'), { code: 'request_id_conflict' });
  await db.act('add', { label: 'Manual', slots: 2 });
  const spin = { action: 'spin', requestId: 'spin-once' };
  const first = await db.api.actParticipationWheel('sid', spin);
  assert.deepEqual((await db.store().actParticipationWheel('sid', spin)).latestSpin, first.latestSpin);
  assert.equal(db.draws.length, 1);
  db.advance();
  const clear = { action: 'clear', requestId: 'clear-once' };
  const cleared = await db.api.actParticipationWheel('sid', clear);
  await db.act('add', { label: 'New' });
  const repeated = await db.api.actParticipationWheel('sid', clear);
  assert.equal(repeated.roundId, cleared.roundId);
  assert.equal(repeated.entries.length, 1);
  assert.equal(repeated.history.length, 1);
});

test('event namespace includes provider/kind, excludes round and is scoped to SID', async () => {
  const db = fixture(); await db.prepare();
  const first = await db.enter('chat', { eventId: 'chzzk:chat:hash' });
  await db.act('clear');
  const replay = await db.enter('chat', { eventId: 'chzzk:chat:hash' });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.wheel.entries.length, 0);
  assert.notEqual(replay.wheel.roundId, first.wheel.roundId);
  assert.equal((await db.enter('chat', { eventId: 'youtube:chat:hash' })).accepted, true);
  await db.settings({ donation: { enabled: true } });
  assert.equal((await db.enter('donation', { eventId: 'chzzk:donation:hash', amount: 1000 })).accepted, true);
  await db.act('open', {}, 'other');
  assert.equal((await db.enter('chat', { eventId: 'chzzk:chat:hash' }, 'other')).accepted, true);
});

test('rejected event receipts remain rejected after settings/open/balance changes', async () => {
  const db = fixture();
  const closed = await db.enter('chat', { eventId: 'closed' });
  assert.equal(closed.reason, 'closed');
  await db.prepare({ points: { enabled: true } });
  const replay = await db.enter('chat', { eventId: 'closed' });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.accepted, false);
  const insufficient = await db.enter('points', { eventId: 'poor', slots: 2 });
  assert.equal(insufficient.reason, 'insufficient_points');
  db.fund();
  assert.equal((await db.enter('points', { eventId: 'poor', slots: 2 })).accepted, false);
  assert.equal(db.balance(), 10000);
});

for (const failAt of ['update public.participation_wheels ', 'insert into public.participation_wheel_requests ', 'commit']) {
  test(`charge, state and receipt roll back together on ${failAt}`, async () => {
    const db = fixture(); await db.prepare({ points: { enabled: true } }); db.fund();
    const before = await db.api.getParticipationWheel('sid'), receipts = db.receipts.size;
    db.failNext = failAt;
    await assert.rejects(db.enter('points', { slots: 2, eventId: 'retry' }), /injected database failure/);
    assert.equal(db.balance(), 10000);
    assert.equal(db.receipts.size, receipts);
    assert.deepEqual(await db.api.getParticipationWheel('sid'), before);
    assert.equal((await db.enter('points', { slots: 2, eventId: 'retry' })).accepted, true);
    assert.equal(db.balance(), 9800);
  });
}

test('a committed charge with a lost response is recovered without charging again', async () => {
  const db = fixture(); await db.prepare({ points: { enabled: true } }); db.fund();
  db.loseCommitResponse = true;
  await assert.rejects(db.enter('points', { eventId: 'lost', slots: 2 }), /lost commit response/);
  const recovered = await db.enter('points', { eventId: 'lost', slots: 2 });
  assert.equal(recovered.duplicate, true);
  assert.equal(db.balance(), 9800);
  assert.equal(db.deductions.length, 1);
});

test('free quota is cumulative across wins/removes, aliases and settings, and only clear resets it', async () => {
  const db = fixture(); await db.prepare({ chat: { perUserLimit: 3 } });
  assert.equal((await db.enter('chat', { slots: 2 })).accepted, true);
  await db.act('spin'); db.advance();
  let wheel = await db.api.getParticipationWheel('sid');
  await db.act('remove', { entryId: wheel.entries[0].id });
  assert.equal((await db.enter('chat', { userId: 'alias-viewer', slots: 2 })).reason, 'chat_limit');
  assert.equal((await db.enter('chat', { slots: 1 })).accepted, true);
  await db.act('close'); await db.act('open');
  await db.settings({ title: 'Renamed', chat: { perUserLimit: 2 } });
  assert.equal((await db.enter()).reason, 'chat_limit');
  const cleared = await db.act('clear');
  assert.equal(cleared.history.length, 1);
  assert.equal(cleared.latestSpin, null);
  assert.equal((await db.enter()).accepted, true);
});

test('concurrent quota and capacity attempts cannot exceed limits or partially charge', async () => {
  const db = fixture(); await db.prepare({ points: { enabled: true } }); db.fund(100000);
  const joins = await Promise.all([db.enter(), db.enter('chat', { userId: 'alias-viewer' })]);
  assert.equal(joins.filter((join) => join.accepted).length, 1);
  await db.act('clear');
  for (let i = 0; i < 9; i++) await db.act('add', { label: `Manual ${i}`, slots: 100 });
  await db.act('add', { label: 'Manual last', slots: 50 });
  const before = db.balance();
  assert.equal((await db.enter('points', { slots: 51 })).reason, 'capacity');
  assert.equal(db.balance(), before);
  const results = await Promise.all([db.enter('points', { slots: 50 }), db.enter('points', { slots: 50 })]);
  assert.equal(results.filter((join) => join.accepted).length, 1);
  assert.equal(db.balance(), before - 5000);
  assert.equal((await db.api.getParticipationWheel('sid')).totalSlots, 1000);
  assert.equal(db.deductions.length, 1);
});

test('200 entry boundary rejects more entries even below the slot cap', async () => {
  const db = fixture(); await db.prepare({ points: { enabled: true } }); db.fund();
  for (let i = 0; i < 200; i++) await db.act('add', { label: `Entry ${i}` });
  assert.equal((await db.enter('points')).reason, 'capacity');
  assert.equal(db.deductions.length, 0);
  await assert.rejects(db.act('add', { label: 'Overflow' }), { code: 'capacity' });
});

test('donations floor KRW independently, allow over 100 slots and reject capacity all-or-none', async () => {
  const db = fixture(); await db.prepare({ donation: { enabled: true } });
  assert.equal((await db.enter('donation', { amount: 999 })).reason, 'below_minimum');
  assert.equal((await db.enter('donation', { userId: 'anonymous', amount: 1999 })).slots, 1);
  assert.equal((await db.enter('donation', { userId: 'anonymous', amount: 999 })).accepted, false);
  assert.equal((await db.enter('donation', { amount: 101999, slots: 1 })).slots, 101);
  assert.equal((await db.enter('donation', { amount: 899000 })).reason, 'capacity');
  assert.equal((await db.api.getParticipationWheel('sid')).totalSlots, 102);
  await db.act('clear');
  assert.equal((await db.enter('donation', { amount: 1001000 })).reason, 'capacity');
  assert.equal((await db.enter('donation', { amount: 1000000 })).slots, 1000);
  assert.equal(db.deductions.length, 0);
});

test('current DB settings defeat stale aliases/enable flags/prices from runtime caches', async () => {
  const db = fixture(); await db.prepare({ points: { enabled: true, command: '!buy' } }); db.fund();
  await db.settings({ points: { command: '!new', costPerSlot: 250 } });
  assert.equal((await db.enter('points', { command: '!buy' })).reason, 'disabled');
  assert.equal(db.deductions.length, 0);
  assert.equal((await db.enter('points', { command: '!NEW', slots: 2, cost: 1 })).cost, 500);
  assert.equal((await db.enter('points')).cost, 250);
  await db.settings({ points: { enabled: false } });
  assert.equal((await db.enter('points', { command: '!new' })).reason, 'disabled');
  await db.act('close');
  assert.equal((await db.enter('points', { command: '!new' })).reason, 'closed');
  assert.equal(db.balance(), 9250);
});

test('spin is persisted before return, allows new joins, and its snapshot and duration stay fixed', async () => {
  const db = fixture(); await db.prepare({ points: { enabled: true }, removal: 'one' }); db.fund();
  await db.enter('points', { slots: 3 });
  await db.act('add', { label: 'Manual' });
  db.nextSlot = 2;
  const wheel = await db.act('spin');
  assert.equal(wheel.latestSpin.startedAt, db.now);
  assert.equal(wheel.entries[0].createdAt, db.now);
  assert.equal(wheel.latestSpin.totalSlots, 4);
  assert.equal(wheel.totalSlots, 3);
  assert.equal(wheel.latestSpin.entries[0].slots, 3);
  assert.deepEqual(db.draws, [4]);
  assert.equal(db.wheels.get('sid').latestSpin.id, wheel.latestSpin.id);
  await assert.rejects(db.act('spin', { requestId: 'blocked-spin' }), { code: 'spinning' });
  await assert.rejects(db.act('clear', { requestId: 'blocked-clear' }), { code: 'spinning' });
  await db.enter('points', { label: 'During animation' });
  await db.settings({ spinDurationMs: 4000 });
  const joined = await db.api.getParticipationWheel('sid');
  assert.deepEqual(joined.latestSpin, wheel.latestSpin);
  db.advance(7999);
  await assert.rejects(db.act('spin'), { code: 'spinning' });
  db.advance(1); db.nextSlot = 0;
  await assert.rejects(db.act('spin', { requestId: 'blocked-spin' }), { code: 'spinning' });
  await assert.rejects(db.act('clear', { requestId: 'blocked-clear' }), { code: 'spinning' });
  const next = await db.act('spin');
  assert.equal(next.latestSpin.durationMs, 4000);
});

test('two simultaneous spins produce one durable winner and no second removal', async () => {
  const db = fixture(); await db.act('add', { label: 'Manual', slots: 3 });
  await db.settings({ removal: 'one' });
  const results = await Promise.allSettled([db.act('spin'), db.act('spin')]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'spinning');
  assert.equal(db.draws.length, 1);
  assert.equal((await db.api.getParticipationWheel('sid')).totalSlots, 2);
});

test('empty and stale-revision actions are rejected without changing state', async () => {
  const db = fixture();
  await assert.rejects(db.act('spin'), { code: 'empty' });
  await db.act('add', { label: 'Manual' });
  await assert.rejects(db.act('clear', { revision: 0 }), { code: 'revision_conflict' });
  assert.equal((await db.api.getParticipationWheel('sid')).entries.length, 1);
});

test('one removal refunds only remaining paid slots at original price and canonical identity', async () => {
  const db = fixture(); await db.prepare({ points: { enabled: true }, removal: 'one' }); db.fund();
  await db.enter('points', { slots: 3, userId: 'alias-viewer', channelUid: 'alias-channel' });
  await db.settings({ points: { costPerSlot: 999 } });
  await db.act('spin');
  const before = await db.api.getParticipationWheel('sid');
  const removed = await db.act('remove', { entryId: before.entries[0].id, requestId: 'refund-once' });
  assert.equal(db.balance(), 9900);
  assert.equal(db.credits[0].amount, 200);
  assert.equal(removed.totalSlots, 0);
  assert.deepEqual(removed.latestSpin, before.latestSpin);
  await db.act('remove', { entryId: before.entries[0].id, requestId: 'refund-once' });
  assert.equal(db.credits.length, 1);
});

test('default keep retains slots but consumes refundable slots, including repeated wins down to zero', async () => {
  const db = fixture(); await db.prepare({ points: { enabled: true } }); db.fund();
  await db.enter('points', { slots: 3 });
  await db.act('spin'); db.advance();
  const first = db.wheels.get('sid').entries[0];
  assert.equal(first.slots, 3);
  assert.equal(first.paid.refundableSlots, 2);
  await db.act('clear');
  assert.equal(db.balance(), 9900);
  await db.enter('points', { slots: 1 });
  for (let i = 0; i < 3; i++) { await db.act('spin'); db.advance(); }
  assert.equal(db.wheels.get('sid').entries[0].paid.refundableSlots, 0);
  await db.act('clear');
  assert.equal(db.balance(), 9800);
});

test('switching keep to one never restores already consumed refundable slots', async () => {
  const db = fixture(); await db.prepare({ points: { enabled: true }, removal: 'keep' }); db.fund();
  await db.enter('points', { slots: 3 });
  await db.act('spin'); db.advance();
  await db.settings({ removal: 'one' });
  await db.act('spin'); db.advance();
  const entry = db.wheels.get('sid').entries[0];
  assert.equal(entry.slots, 2);
  assert.equal(entry.paid.refundableSlots, 1);
  await db.act('clear');
  assert.equal(db.balance(), 9800);
});

test('all removes every NFC-equal label across users/sources with no winning-removal refunds', async () => {
  const db = fixture(); await db.prepare({ points: { enabled: true }, donation: { enabled: true }, removal: 'all' });
  db.fund(); db.fund(10000, 'other');
  await db.enter('points', { label: '\u00e9', slots: 2 });
  await db.enter('points', { userId: 'other', label: 'e\u0301', slots: 3 });
  await db.enter('donation', { label: '\u00e9', amount: 2000 });
  await db.act('add', { label: 'Distinct' });
  const wheel = await db.act('spin');
  assert.deepEqual(wheel.entries.map((entry) => entry.label), ['Distinct']);
  assert.equal(wheel.latestSpin.entries.length, 4);
  assert.equal(wheel.latestSpin.totalSlots, 8);
  db.advance(); await db.act('clear');
  assert.equal(db.balance(), 9800);
  assert.equal(db.balance('other'), 9700);
  assert.equal(db.credits.length, 0);
});

test('multi-user clear refunds each original rate under sorted point locks, exactly once', async () => {
  const db = fixture(); await db.prepare({ points: { enabled: true } }); db.fund(); db.fund(10000, 'other');
  await db.enter('points', { slots: 2 });
  await db.settings({ points: { costPerSlot: 250 } });
  await db.enter('points', { userId: 'other', slots: 3 });
  await db.enter('points', { slots: 1 });
  await db.act('clear', { requestId: 'clear-refund' });
  assert.equal(db.balance(), 10000);
  assert.equal(db.balance('other'), 10000);
  assert.deepEqual(db.credits.map((credit) => [credit.key, credit.amount]), [['channel:other', 750], ['channel:viewer', 450]]);
  await db.act('clear', { requestId: 'clear-refund' });
  assert.equal(db.credits.length, 2);
});

test('refund grouping never merges distinct identities containing delimiter characters', async () => {
  const db = fixture(); await db.prepare({ points: { enabled: true } });
  db.fund(1000, 'c', 'a:b');
  await db.enter('points', { channelUid: 'a:b', userId: 'c', slots: 2 });
  await db.enter('points', { channelUid: 'a', userId: 'b:c', slots: 3 });
  const credited = [];
  const store = createParticipationWheelStore({ ...db.dependencies,
    upsertCanonicalPointDelta: async (pg, channel, user, _username, amount) => {
      assert.ok(pg.held.has(`point:${channel}:${user}`));
      credited.push({ channel, user, amount });
    },
  });
  await store.actParticipationWheel('sid', { action: 'clear', requestId: 'separate-identities' });
  assert.deepEqual(credited, [{ channel: 'a:b', user: 'c', amount: 200 }, { channel: 'a', user: 'b:c', amount: 300 }]);
});

test('failed spin persistence leaves the wheel unchanged and retries only uncommitted draws', async () => {
  const db = fixture(); await db.act('add', { label: 'Manual', slots: 3 });
  await db.settings({ removal: 'one' });
  const before = await db.api.getParticipationWheel('sid');
  db.failNext = 'insert into public.participation_wheel_requests ';
  await assert.rejects(db.act('spin', { requestId: 'spin-retry' }), /injected database failure/);
  assert.deepEqual(await db.api.getParticipationWheel('sid'), before);
  const committed = await db.act('spin', { requestId: 'spin-retry' });
  assert.equal(committed.totalSlots, 2);
  assert.equal(committed.history.length, 1);
  assert.equal(db.draws.length, 2);
  assert.deepEqual((await db.act('spin', { requestId: 'spin-retry' })).latestSpin, committed.latestSpin);
  assert.equal(db.draws.length, 2);
});

test('concurrent partial setting changes merge against locked state and validate current commands', async () => {
  const db = fixture();
  await Promise.all([db.settings({ points: { costPerSlot: 250 } }), db.settings({ title: 'Updated' })]);
  const settings = (await db.api.getParticipationWheel('sid')).settings;
  assert.equal(settings.title, 'Updated');
  assert.equal(settings.points.costPerSlot, 250);
  await db.settings({ chat: { enabled: false } });
  await db.settings({ points: { enabled: true, command: settings.chat.command } });
  await assert.rejects(db.settings({ chat: { enabled: true } }), { code: 'command_conflict' });
  assert.equal((await db.api.getParticipationWheel('sid')).settings.chat.enabled, false);
});

test('refund or receipt failure rolls back all refunds and preserves entries for retry', async () => {
  const db = fixture(); await db.prepare({ points: { enabled: true } }); db.fund();
  await db.enter('points', { slots: 2 });
  const before = await db.api.getParticipationWheel('sid');
  db.failRefund = true;
  await assert.rejects(db.act('clear', { requestId: 'clear-retry' }), /refund failure/);
  assert.equal(db.balance(), 9800);
  assert.deepEqual(await db.api.getParticipationWheel('sid'), before);
  db.failNext = 'insert into public.participation_wheel_requests ';
  await assert.rejects(db.act('clear', { requestId: 'clear-retry' }), /injected database failure/);
  assert.equal(db.balance(), 9800);
  assert.deepEqual(await db.api.getParticipationWheel('sid'), before);
  await db.act('clear', { requestId: 'clear-retry' });
  assert.equal(db.balance(), 10000);
});

test('cross-SID spending shares the canonical identity lock and cannot overdraw', async () => {
  const db = fixture(); await db.prepare({ points: { enabled: true } });
  await db.settings({ points: { enabled: true } }, 'other'); await db.act('open', {}, 'other'); db.fund(100);
  const results = await Promise.all([db.enter('points'), db.enter('points', { userId: 'alias-viewer', channelUid: 'alias-channel' }, 'other')]);
  assert.equal(results.filter((result) => result.accepted).length, 1);
  assert.equal(results.find((result) => !result.accepted).reason, 'insufficient_points');
  assert.equal(db.balance(), 0);
});

test('history is bounded and survives clear, and result payloads contain no private identities', async () => {
  const db = fixture(); await db.prepare({ points: { enabled: true }, removal: 'keep' }); db.fund();
  await db.enter('points', { userId: 'viewer', slots: 1 });
  for (let i = 0; i < 52; i++) { await db.act('spin'); db.advance(); }
  const wheel = await db.act('clear');
  assert.equal(wheel.history.length, 50);
  assert.equal(wheel.latestSpin, null);
  assert.doesNotMatch(JSON.stringify(wheel), /userId|channelUid|chatUsage|refundableSlots|paid/);
});

test('unsupported stored versions fail closed without replacing financial state', async () => {
  const db = fixture(); await db.api.getParticipationWheel('sid');
  db.wheels.get('sid').schemaVersion = 2;
  await assert.rejects(db.api.getParticipationWheel('sid'), { code: 'unsupported_wheel_version' });
  assert.equal(db.wheels.get('sid').schemaVersion, 2);
});

test('migration and thin integration retain server-only RLS and account SID cleanup', () => {
  const migration = readFileSync(new URL('../server/migrations/024_participation_wheel.sql', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../server/supabase.js', import.meta.url), 'utf8');
  for (const table of ['participation_wheels', 'participation_wheel_requests']) {
    assert.ok(migration.includes(`alter table public.${table} enable row level security`));
    assert.ok(source.includes(`deleteRowsByColumnValues(pg, summary, 'public.${table}'`));
  }
  assert.match(migration, /primary key \(sid, request_id\)/);
  assert.match(migration, /on delete cascade/);
  assert.match(migration, /from public/);
  assert.match(migration, /from anon/);
  assert.match(migration, /from authenticated/);
  assert.doesNotMatch(migration, /create policy/i);
  assert.match(source, /createParticipationWheelStore\(\{\s*withPgClient, deductChannelPointsIfEnoughWithClient, resolvePointChannelIdentity,\s*resolvePointUserIdentity, upsertCanonicalPointDelta/);
});
