import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import {
  createRuntimeHandoff, encodeRuntimeValue, decodeRuntimeValue, MAX_RUNTIME_SNAPSHOT_BYTES,
} from '../server/runtime-handoff.js';
import { createCommandExecutionSafety } from '../server/command-execution-safety.js';
import { createPvdIdlePlaybackStore } from '../server/pvd-idle-playback.js';
import { createBgmPlayerPresence } from '../server/pvd-bgm.js';

const idleState = () => ({ getInFlight: () => 0, getActiveCount: () => 0, rouletteProcessing: new Set() });
const handoff = (maps, state = idleState()) => createRuntimeHandoff({ maps, state, now: () => 12345 });
const roundTrip = (value) => decodeRuntimeValue(JSON.parse(JSON.stringify(encodeRuntimeValue(value))));
const errorCode = (code) => (error) => error.code === code;
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('codec survives real JSON transport with nested Maps, Sets, optional undefined and tag-like JSON', () => {
  const value = new Map([
    ['queue', [{ runtimeJobId: 'job', sessionKey: 'test-only-token', optional: undefined, startedAt: null }]],
    ['macros', new Map([['macro', 12345]])],
    ['dedupe', new Set(['provider:chat', 'provider:echo'])],
    ['json', { type: 'map', value: [['x', 1]], nested: ['undefined', null], absent: undefined }],
    ['numbers', [0, -0, Number.MAX_VALUE, Number.MIN_VALUE, -3.25, true, false]],
    ['optional', undefined],
  ]);
  assert.deepEqual(roundTrip(value), value);
  assert.equal(Object.hasOwn(roundTrip({ missing: undefined }), 'missing'), true);
  assert.deepEqual(roundTrip(Object.assign(Object.create(null), { safe: 1 })), { safe: 1 });
  assert.notEqual(roundTrip(value).get('macros'), value.get('macros'));
});

test('codec rejects unsupported values, cycles, proxies and executable properties without invoking them', () => {
  const timer = setTimeout(() => {}, 60000);
  try {
    for (const value of [Infinity, -Infinity, NaN, () => {}, Symbol('x'), 1n, new Date(), timer, Promise.resolve(), /x/]) {
      assert.throws(() => encodeRuntimeValue(value), /runtime_handoff_/);
    }
    const cycle = {}; cycle.self = cycle;
    assert.throws(() => encodeRuntimeValue(cycle), errorCode('runtime_handoff_cyclic_value'));
    const cyclicMap = new Map(); cyclicMap.set('self', cyclicMap);
    assert.throws(() => encodeRuntimeValue(cyclicMap), /cyclic_value/);
    let calls = 0;
    const accessor = Object.defineProperty({}, 'secret', { enumerable: true, get() { calls += 1; return 'secret'; } });
    assert.throws(() => encodeRuntimeValue(accessor), /invalid_property/);
    assert.throws(() => encodeRuntimeValue({ toJSON() { calls += 1; return {}; } }), /unsupported_value/);
    assert.throws(() => encodeRuntimeValue(new Proxy({}, { getPrototypeOf() { calls += 1; return Object.prototype; } })), /unsupported_value/);
    assert.equal(calls, 0);
    const sparse = new Array(2);
    assert.throws(() => encodeRuntimeValue(sparse), /invalid_array/);
    const accessorArray = [0];
    Object.defineProperty(accessorArray, '0', { get() { calls += 1; return 1; } });
    assert.throws(() => decodeRuntimeValue(accessorArray), /invalid_array/);
    assert.equal(calls, 0);
  } finally { clearTimeout(timer); }
});

test('codec rejects prototype pollution, duplicate keys and malformed tags', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    assert.throws(() => encodeRuntimeValue(JSON.parse(`{"${key}":{"polluted":true}}`)), /unsafe_key/);
    assert.throws(() => decodeRuntimeValue(['object', [[key, true]]]), /unsafe_key/);
  }
  assert.equal({}.polluted, undefined);
  for (const wire of [
    {}, ['unknown', []], ['map', [['x']]], ['object', [[1, 2]]],
    ['map', [['x', 1], ['x', 2]]], ['set', [1, 1]], ['object', [['x', 1], ['x', 2]]],
    ['undefined', false], ['number', 'Infinity'], ['array', [] , null], ['array', [undefined]],
  ]) assert.throws(() => decodeRuntimeValue(wire), /runtime_handoff_/);
  assert.deepEqual(roundTrip(new Map([['__proto__', 'safe map key']])), new Map([['__proto__', 'safe map key']]));
});

test('codec and snapshots enforce byte, depth, node and collection bounds', () => {
  const exact = 'x'.repeat(MAX_RUNTIME_SNAPSHOT_BYTES - 2);
  assert.equal(Buffer.byteLength(JSON.stringify(encodeRuntimeValue(exact))), MAX_RUNTIME_SNAPSHOT_BYTES);
  assert.equal(decodeRuntimeValue(exact).length, exact.length);
  assert.throws(() => encodeRuntimeValue(exact + 'x'), /too_large/);
  assert.throws(() => encodeRuntimeValue('\uac00'.repeat(Math.ceil(MAX_RUNTIME_SNAPSHOT_BYTES / 3))), /too_large/);
  assert.throws(() => encodeRuntimeValue('\n'.repeat(MAX_RUNTIME_SNAPSHOT_BYTES / 2)), /too_large/);
  assert.throws(() => handoff({ values: new Map([['large', exact]]) }).capture(), /too_large/);
  assert.throws(() => handoff({}).validate(' '.repeat(MAX_RUNTIME_SNAPSHOT_BYTES + 1)), /too_large/);
  let deep = null;
  for (let i = 0; i < 66; i += 1) deep = [deep];
  assert.throws(() => encodeRuntimeValue(deep), /too_deep/);
  assert.throws(() => encodeRuntimeValue(new Array(100001).fill(null)), /too_many_entries/);
  assert.throws(() => encodeRuntimeValue(Array.from({ length: 90000 }, () => [1, 2])), /too_many_nodes/);
});

test('snapshot validation is non-mutating and restore atomically replaces contents while retaining references', () => {
  const sourceMaps = {
    pvd: new Map([['sid', [{ id: 'pvd', runtimeJobId: 'job', optional: undefined }]]]),
    macros: new Map([['sid', new Map([['macro', 500]])]]),
    dedupe: new Set(['echo']),
  };
  const source = handoff(sourceMaps);
  const snapshot = source.capture();
  sourceMaps.pvd.get('sid')[0].id = 'changed-after-capture';
  const serialized = JSON.stringify(snapshot);
  const maps = { pvd: new Map([['old', []]]), macros: new Map([['stale', null]]), dedupe: new Set(['old']) };
  const refs = { ...maps };
  const target = handoff(maps);
  const decoded = target.validate(serialized);
  assert.equal(decoded.maps.pvd.get('sid')[0].id, 'pvd');
  assert.deepEqual([...maps.pvd.keys()], ['old']);
  target.restore(serialized);
  assert.deepEqual(maps, decoded.maps);
  for (const key of Object.keys(maps)) assert.equal(maps[key], refs[key]);
  assert.notEqual(maps.pvd, decoded.maps.pvd);
  assert.deepEqual(target.restore(serialized), { version: 1, capturedAt: 12345, collections: 3 });
});

test('invalid later collections and envelopes leave every existing collection unchanged', () => {
  const maps = { first: new Map([['old', 1]]), second: new Set(['old']) };
  const target = handoff(maps);
  const before = JSON.stringify(target.capture());
  const valid = handoff({ first: new Map([['new', 2]]), second: new Set(['new']) }).capture();
  const invalidMaps = { first: new Map([['new', 2]]), second: new Map() };
  for (const snapshot of [
    { ...valid, maps: encodeRuntimeValue(invalidMaps) },
    { ...valid, maps: encodeRuntimeValue({ first: new Map() }) },
    { ...valid, maps: encodeRuntimeValue({ ...invalidMaps, extra: new Map() }) },
    { ...valid, version: 2 }, { ...valid, capturedAt: Infinity }, { ...valid, extra: 1 }, '{invalid-json',
  ]) {
    assert.throws(() => target.restore(snapshot), /runtime_handoff_/);
    assert.equal(JSON.stringify(target.capture()), before);
  }
  let getterCalls = 0;
  const bad = Object.defineProperty({ ...valid }, 'maps', { enumerable: true, get() { getterCalls += 1; return []; } });
  assert.throws(() => target.restore(bad), /invalid_property/);
  assert.equal(getterCalls, 0);
  const aliased = new Map();
  assert.throws(() => handoff({ first: aliased, second: aliased }), /invalid_target/);
});

test('capture and restore require zero ingress, zero active commands and no roulette processor', () => {
  const maps = { queue: new Map([['old', []]]) };
  const state = idleState();
  const target = handoff(maps, state);
  const snapshot = target.capture();
  for (const busy of [
    { getInFlight: () => 1 }, { getActiveCount: () => 1 }, { rouletteProcessing: new Set(['sid']) },
    { getInFlight: () => NaN }, { getActiveCount: () => undefined },
  ]) {
    const guarded = handoff(maps, { ...state, ...busy });
    assert.throws(() => guarded.capture(), /not_drained/);
    assert.throws(() => guarded.restore(snapshot), /not_drained/);
  }
  assert.throws(() => createRuntimeHandoff({ maps }), /invalid_state/);
  assert.deepEqual([...maps.queue.keys()], ['old']);
});

test('getActiveCount drains awaited children, independent scopes, bound children and failures', async () => {
  const safety = createCommandExecutionSafety();
  const first = deferred(), second = deferred();
  assert.equal(safety.getActiveCount(), 0);
  const root = safety.scope('sid', () => safety.scope('sid', async () => { await first.promise; }));
  const other = safety.scope('other', () => second.promise);
  assert.equal(safety.getActiveCount(), 2);
  first.resolve(); await root;
  assert.equal(safety.getActiveCount(), 1);
  second.resolve(); await other;
  assert.equal(safety.getActiveCount(), 0);
  const gate = deferred();
  let child;
  await safety.scope('sid', () => { child = safety.bind(() => gate.promise)(); });
  assert.equal(safety.getActiveCount(), 1, 'child retains the lease after its parent returns');
  const guarded = handoff({}, { ...idleState(), getActiveCount: safety.getActiveCount });
  assert.throws(() => guarded.capture(), /not_drained/);
  gate.resolve(); await child;
  assert.equal(safety.getActiveCount(), 0);
  guarded.capture();
  await assert.rejects(safety.scope('sid', async () => { throw new Error('failure'); }), /failure/);
  assert.equal(safety.getActiveCount(), 0);
});

test('idle playback handoff retains track, pause command, sequence, disconnect tombstones and control version', () => {
  let now = 1000;
  const old = createPvdIdlePlaybackStore({ now: () => now });
  const report = { clientId: 'client_123', sequence: 1, mode: 'idle', source: 'obs', playing: true, atSec: 10,
    track: { mediaId: 'abcdefghijk', durationSec: 180 } };
  assert.equal(old.report('sid', report).accepted, true);
  old.release('other', 'client_dead');
  const command = old.control('sid', 'pause');
  const before = old.snapshot('sid');
  const snapshot = JSON.stringify(handoff(old.runtimeState()).capture());
  now += 1000;
  const next = createPvdIdlePlaybackStore({ now: () => now });
  const refs = next.runtimeState();
  handoff(next.runtimeState()).restore(snapshot);
  assert.deepEqual(next.snapshot('sid'), before);
  assert.equal(next.runtimeState().states, refs.states);
  assert.equal(next.runtimeState().counters, refs.counters);
  assert.equal(next.report('other', { ...report, clientId: 'client_dead' }).accepted, false);
  assert.deepEqual(next.report('sid', report).command, command);
  next.connect('sid', report.clientId);
  assert.equal(next.report('sid', { ...report, sequence: 2 }).accepted, true);
  assert.equal(next.control('sid', 'play').version, command.version + 1);
  now += 20001;
  assert.equal(next.snapshot('sid'), null);
});

test('BGM handoff preserves a client lease and sequence over a short gateway reconnect without extending it', () => {
  let now = 1000;
  const old = createBgmPlayerPresence({ now: () => now });
  const report = { clientId: 'client_123', visible: true, sequence: 5, readyItemId: 'bgm-job' };
  assert.equal(old.report('sid', report), true);
  const initial = { ...old.current('sid') };
  const serialized = JSON.stringify(handoff(old.runtimeState()).capture());
  now += 1500;
  const next = createBgmPlayerPresence({ now: () => now });
  const refs = next.runtimeState();
  handoff(refs).restore(serialized);
  assert.equal(next.runtimeState().players, refs.players);
  assert.deepEqual(next.current('sid'), initial);
  assert.equal(next.report('sid', { ...report, clientId: 'other_123' }), false);
  assert.equal(next.report('sid', { ...report, visible: false, sequence: 4 }), true);
  assert.deepEqual(next.current('sid'), initial);
  assert.equal(next.report('sid', { ...report, sequence: 6 }), true);
  assert.equal(next.current('sid').readyItemId, 'bgm-job');
  now += 12000;
  assert.equal(next.current('sid'), null);
});

// Execute the actual adapter functions with a supplied client, without loading
// production environment/configuration or initializing unrelated stores.
const dbSource = readFileSync(new URL('../server/supabase.js', import.meta.url), 'utf8');
const dbAst = ts.createSourceFile('supabase.js', dbSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functionNames = [
  'ensureDurableRuntimeJobsWithClient', 'normalizeDurableRuntimeJob', 'uniqueNonEmpty',
  'transferDurableRuntimeJobs', 'renewDurableRuntimeJobs', 'claimDurableRuntimeJobs', 'completeDurableRuntimeJob',
];
const adapterSource = functionNames.map((name) => {
  const node = dbAst.statements.find((entry) => ts.isFunctionDeclaration(entry) && entry.name?.text === name);
  assert.ok(node, `Missing adapter function ${name}`);
  return node.getText(dbAst).replace(/^export\s+/, '');
}).join('\n');
function adapter(withPgClient, getDbUrl = () => 'postgres://test-only') {
  return new Function('withPgClient', 'getDbUrl', `
    let durableRuntimeJobsReady = false;
    ${adapterSource}
    return { transferDurableRuntimeJobs, renewDurableRuntimeJobs, claimDurableRuntimeJobs, completeDurableRuntimeJob };
  `)(withPgClient, getDbUrl);
}
const job = (id, extra = {}) => ({ id, sid: 'sid', job_type: 'video-donation', idempotency_key: id,
  status: 'processing', locked_by: 'old', locked_at: new Date(0), attempt_count: 2, max_attempts: 8,
  available_at: new Date(0), payload: { item: { id } }, updated_at: new Date(0), ...extra });
function fakeDb(initialRows, { failUpdate = false, shortUpdate = false } = {}) {
  let rows = structuredClone(initialRows), transaction = null;
  const queries = [];
  const query = async (sql, values) => {
    const text = sql.trim().replace(/\s+/g, ' ');
    queries.push({ text, values });
    if (text.startsWith('create table')) return { rows: [] };
    if (text === 'begin') { transaction = structuredClone(rows); return { rows: [] }; }
    if (text === 'rollback') { transaction = null; return { rows: [] }; }
    if (text === 'commit') { rows = transaction; transaction = null; return { rows: [] }; }
    const source = transaction || rows;
    if (text.startsWith('select *')) {
      assert.match(text, /where id = any\(\$1::text\[\]\) order by id for update$/);
      assert.ok(transaction, 'selection must hold transaction row locks');
      return { rows: structuredClone(source.filter((row) => values[0].includes(row.id))) };
    }
    if (text.startsWith('update durable_runtime_jobs')) {
      if (failUpdate) throw new Error('injected update failure');
      assert.doesNotMatch(text, /set[^]*attempt_count\s*=/);
      const transferring = text.includes('set locked_by');
      if (transferring) assert.ok(transaction);
      else assert.match(text, /^update durable_runtime_jobs set locked_at = now\(\) where/);
      const matches = source.filter((row) => values[0].includes(row.id) && row.status === 'processing'
        && (transferring ? [values[1], values[2]].includes(row.locked_by) : row.locked_by === values[1]));
      for (const row of matches) {
        row.locked_at = new Date(100000);
        if (transferring) { row.locked_by = values[1]; row.updated_at = new Date(100000); }
      }
      return { rows: structuredClone(shortUpdate ? matches.slice(1) : matches) };
    }
    throw new Error('Unexpected test query');
  };
  return { api: adapter((fn) => fn({ query })), rows: () => structuredClone(rows), queries };
}

test('durable transfer uses one locked transaction, only exact IDs, preserves attempts and supports retries/reversal', async () => {
  const db = fakeDb([job('a'), job('b', { locked_by: 'new' }), job('unrelated')]);
  const options = { fromWorkerId: 'old', toWorkerId: 'new', jobIds: ['b', 'a'] };
  const result = await db.api.transferDurableRuntimeJobs(options);
  assert.deepEqual(result.map((row) => [row.id, row.lockedBy, row.attemptCount]), [['b', 'new', 2], ['a', 'new', 2]]);
  assert.equal(db.rows().find((row) => row.id === 'unrelated').locked_by, 'old');
  assert.ok(db.queries.some(({ text }) => text === 'commit'));
  assert.equal(db.queries.some(({ text }) => text === 'rollback'), false);
  assert.deepEqual((await db.api.transferDurableRuntimeJobs(options)).map((row) => row.attemptCount), [2, 2]);
  const reversed = await db.api.transferDurableRuntimeJobs({ fromWorkerId: 'new', toWorkerId: 'old', jobIds: ['a', 'b'] });
  assert.ok(reversed.every((row) => row.lockedBy === 'old' && row.attemptCount === 2));
});

test('missing, completed, unclaimed or foreign-owned jobs abort the entire transfer', async () => {
  for (const bad of [null, job('bad', { status: 'completed' }), job('bad', { status: 'queued' }),
    job('bad', { locked_by: 'foreign' }), job('bad', { locked_at: null })]) {
    const db = fakeDb([job('good'), ...(bad ? [bad] : [])]);
    const before = db.rows();
    await assert.rejects(db.api.transferDurableRuntimeJobs({ fromWorkerId: 'old', toWorkerId: 'new', jobIds: ['good', 'bad'] }),
      errorCode('durable_runtime_job_transfer_mismatch'));
    assert.deepEqual(db.rows(), before);
    assert.equal(db.queries.at(-1).text, 'rollback');
    assert.equal(db.queries.some(({ text }) => text.startsWith('update durable_runtime_jobs')), false);
  }
});

test('update failures and partial affected-row responses roll back all changed owners', async () => {
  for (const config of [{ failUpdate: true }, { shortUpdate: true }]) {
    const db = fakeDb([job('a'), job('b')], config);
    const before = db.rows();
    await assert.rejects(db.api.transferDurableRuntimeJobs({ fromWorkerId: 'old', toWorkerId: 'new', jobIds: ['a', 'b'] }));
    assert.deepEqual(db.rows(), before);
    assert.equal(db.queries.at(-1).text, 'rollback');
  }
});

test('transfer and renewal validate bounds without DB writes and reject REST-only configuration', async () => {
  let queries = 0;
  const api = adapter(() => { queries += 1; throw new Error('must not query'); });
  for (const ids of [['a', 'a'], [''], [' leading'], ['nul\0'], [2], new Array(1),
    Array.from({ length: 10001 }, (_, i) => String(i)), null]) {
    await assert.rejects(api.transferDurableRuntimeJobs({ fromWorkerId: 'old', toWorkerId: 'new', jobIds: ids }), /requires/);
    await assert.rejects(api.renewDurableRuntimeJobs({ workerId: 'old', jobIds: ids }), /requires/);
  }
  await assert.rejects(api.transferDurableRuntimeJobs({ fromWorkerId: 'same', toWorkerId: 'same', jobIds: ['a'] }), /requires/);
  await assert.rejects(api.renewDurableRuntimeJobs({ workerId: '', jobIds: ['a'] }), /requires/);
  assert.deepEqual(await api.transferDurableRuntimeJobs({ fromWorkerId: 'old', toWorkerId: 'new', jobIds: [] }), []);
  assert.deepEqual(await api.renewDurableRuntimeJobs({ workerId: 'old', jobIds: [] }), []);
  const rest = adapter(() => { queries += 1; }, () => '');
  await assert.rejects(rest.transferDurableRuntimeJobs({ fromWorkerId: 'old', toWorkerId: 'new', jobIds: ['a'] }),
    errorCode('durable_runtime_job_transfer_unsupported'));
  await assert.rejects(rest.renewDurableRuntimeJobs({ workerId: 'old', jobIds: ['a'] }),
    errorCode('durable_runtime_job_renewal_unsupported'));
  assert.equal(queries, 0);
});

test('renewal updates only matching processing owners and only locked_at, including a transferred owner', async () => {
  const db = fakeDb([job('mine'), job('other', { locked_by: 'foreign' }), job('done', { status: 'completed' })]);
  const before = db.rows();
  assert.deepEqual(await db.api.renewDurableRuntimeJobs({ workerId: 'old', jobIds: ['missing', 'done', 'other', 'mine'] }), ['mine']);
  const after = db.rows();
  assert.deepEqual({ ...after[0], locked_at: before[0].locked_at }, before[0]);
  assert.deepEqual(after.slice(1), before.slice(1));
  await db.api.transferDurableRuntimeJobs({ fromWorkerId: 'old', toWorkerId: 'new', jobIds: ['mine'] });
  assert.deepEqual(await db.api.renewDurableRuntimeJobs({ workerId: 'old', jobIds: ['mine'] }), []);
  assert.deepEqual(await db.api.renewDurableRuntimeJobs({ workerId: 'new', jobIds: ['mine'] }), ['mine']);
  assert.equal(db.rows()[0].attempt_count, 2);
});

test('PostgreSQL: real schema, row-lock atomicity, 30s lease, new-owner completion and attempt-preserving renewal', {
  skip: !process.env.ARUBOT_TEST_POSTGRES_URL && 'Set ARUBOT_TEST_POSTGRES_URL to a local test database; no temporary PostgreSQL installed',
  timeout: 45000,
}, async () => {
  const url = new URL(process.env.ARUBOT_TEST_POSTGRES_URL);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol)
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname),
  'Requires an explicitly configured local PostgreSQL test database');
  const { default: pg } = await import('pg');
  const schema = `runtime_handoff_test_${randomUUID().replaceAll('-', '')}`;
  const pool = new pg.Pool({ connectionString: url.href, ssl: false, max: 4, connectionTimeoutMillis: 5000,
    statement_timeout: 8000, lock_timeout: 4000, idle_in_transaction_session_timeout: 10000,
    options: `-c search_path=${schema}` });
  let created = false;
  const withPgClient = async (fn) => {
    const client = await pool.connect();
    try { return await fn(client); } finally { client.release(); }
  };
  const api = adapter(withPgClient, () => url.href);
  try {
    await pool.query(`create schema ${schema}`); created = true;
    // Initialize the exact production schema, not a simplified test table.
    assert.deepEqual(await api.renewDurableRuntimeJobs({ workerId: 'old', jobIds: ['missing'] }), []);
    for (const [id, owner, status] of [['a', 'old', 'processing'], ['b', 'old', 'processing'], ['foreign', 'other', 'processing']]) {
      await pool.query(`insert into durable_runtime_jobs
        (id, sid, job_type, idempotency_key, status, locked_by, locked_at, attempt_count, max_attempts)
        values ($1, 'sid', 'video-donation', $1, $3, $2, now() - interval '1 minute', 2, 8)`, [id, owner, status]);
    }
    await assert.rejects(api.transferDurableRuntimeJobs({ fromWorkerId: 'old', toWorkerId: 'new', jobIds: ['a', 'foreign'] }), /mismatch/);
    assert.equal((await pool.query("select locked_by from durable_runtime_jobs where id = 'a'")).rows[0].locked_by, 'old');
    const transferred = await api.transferDurableRuntimeJobs({ fromWorkerId: 'old', toWorkerId: 'new', jobIds: ['a', 'b'] });
    assert.ok(transferred.every((row) => row.lockedBy === 'new' && row.attemptCount === 2));
    assert.equal((await api.transferDurableRuntimeJobs({ fromWorkerId: 'old', toWorkerId: 'new', jobIds: ['a', 'b'] })).length, 2);
    assert.deepEqual((await api.claimDurableRuntimeJobs({ workerId: 'competitor', leaseMs: 30000, limit: 100 })).map((row) => row.id), ['foreign']);
    assert.equal(await api.completeDurableRuntimeJob('a', 'old'), null);
    assert.equal((await api.completeDurableRuntimeJob('a', 'new')).status, 'completed');
    for (let i = 0; i < 3; i += 1) {
      await pool.query("update durable_runtime_jobs set locked_at = now() - interval '31 seconds' where id = 'b'");
      assert.deepEqual(await api.renewDurableRuntimeJobs({ workerId: 'new', jobIds: ['b', 'a', 'missing'] }), ['b']);
      assert.deepEqual(await api.claimDurableRuntimeJobs({ workerId: 'competitor', leaseMs: 30000 }), []);
    }
    assert.equal((await pool.query("select attempt_count from durable_runtime_jobs where id = 'b'")).rows[0].attempt_count, 2);

    const locker = await pool.connect();
    let pending;
    try {
      await locker.query('begin');
      await locker.query("select id from durable_runtime_jobs where id = 'b' for update");
      pending = api.transferDurableRuntimeJobs({ fromWorkerId: 'new', toWorkerId: 'old', jobIds: ['b'] });
      let settled = false;
      const observed = pending.then(() => { settled = true; }, () => { settled = true; });
      await new Promise((resolve) => setTimeout(resolve, 75));
      assert.equal(settled, false, 'transfer must wait for the held row lock');
      await locker.query("update durable_runtime_jobs set status = 'completed' where id = 'b'");
      await locker.query('commit');
      await assert.rejects(pending, /mismatch/);
      await observed;
      assert.equal((await pool.query("select locked_by from durable_runtime_jobs where id = 'b'")).rows[0].locked_by, 'new');
    } finally {
      await locker.query('rollback'); locker.release();
      if (pending) await pending.catch(() => {});
    }
  } finally {
    try { if (created) await pool.query(`drop schema ${schema} cascade`); }
    finally { await pool.end(); }
  }
});
