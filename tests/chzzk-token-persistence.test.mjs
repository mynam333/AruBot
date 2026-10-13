import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import crypto from 'node:crypto';

const source = (await readFile(new URL('../server/supabase.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const tokenSource = source.slice(source.indexOf('// Tokens\n'), source.indexOf('let platformIdentityTablesReadyPromise')).replace(/^export /gm, '');
const secretSource = source.slice(source.indexOf('function protectSecret('), source.indexOf('function secretHash('));
const builderSource = source.slice(source.indexOf('class PgQueryBuilder {'), source.indexOf('function createPostgresProviderClient()'));
const sid = 'user:legacy-channel';
const old = { accessToken: 'old-access', refreshToken: 'old-refresh', tokenType: 'Bearer', expiresAt: '2026-01-01T00:00:00.000Z' };
const next = { accessToken: 'next-access', refreshToken: 'next-refresh', tokenType: 'Bearer', expiresAt: '2026-11-01T00:00:00.000Z' };
const raw = tokens => ({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken, token_type: tokens.tokenType, expires_at: tokens.expiresAt });

function load(supabase, extra = {}) {
  const context = vm.createContext({ supabase, ensure() {}, Buffer, crypto, setTimeout,
    getSecretEncryptionKey: () => Buffer.alloc(32, 7), getDbUrl: () => 'test-only',
    ensureTokensTableExists: async () => {}, ...extra });
  vm.runInContext(`${secretSource}\n${tokenSource}\nthis.api = { upsertTokens, getTokens, updateTokens };`, context);
  return context.api;
}

function fixture({ encryption = true } = {}) {
  const rows = new Map();
  const calls = [];
  let intercept = null, heals = 0;
  const supabase = { from(table) {
    assert.equal(table, 'tokens');
    const query = { action: 'select', filters: [], payload: null, singleMode: false,
      select() { return this; },
      upsert(value) { this.action = 'upsert'; this.payload = value; return this; },
      update(value) { this.action = 'update'; this.payload = value; return this; },
      delete() { this.action = 'delete'; return this; },
      eq(column, value) { this.filters.push({ column, value, op: 'eq' }); return this; },
      is(column, value) { this.filters.push({ column, value, op: 'is' }); return this; },
      single() { this.singleMode = true; return this.execute(); },
      maybeSingle() { this.singleMode = true; return this.execute(); },
      then(resolve, reject) { return this.execute().then(resolve, reject); },
      async execute() {
        calls.push({ action: this.action, filters: structuredClone(this.filters), payload: structuredClone(this.payload) });
        const hook = intercept;
        if (hook) { const result = await hook(this); if (result) return result; }
        if (this.action === 'upsert') {
          rows.set(this.payload.sid, { ...this.payload });
          return { data: null, error: null };
        }
        const matched = [...rows.values()].filter(row => this.filters.every(({ column, value, op }) =>
          op === 'is' && value === null ? row[column] == null : row[column] === value));
        if (this.action === 'delete') for (const row of matched) rows.delete(row.sid);
        if (this.action === 'update') for (const row of matched) Object.assign(row, this.payload);
        return { data: this.singleMode ? structuredClone(matched[0] || null) : structuredClone(matched), error: null };
      },
    };
    return query;
  } };
  const api = load(supabase, {
    getSecretEncryptionKey: () => encryption ? Buffer.alloc(32, 7) : null,
    ensureTokensTableExists: async () => { heals++; },
  });
  return { ...api, rows, calls, get heals() { return heals; }, intercept(fn) { intercept = fn; } };
}

test('initial login still creates or replaces legacy and temporary SID tokens without an app_user', async () => {
  const db = fixture();
  for (const key of [sid, 'sid:temporary-login', 'plain-legacy-sid']) {
    await db.upsertTokens(key, old);
    assert.equal((await db.getTokens(key)).accessToken, old.accessToken);
    await db.upsertTokens(key, next);
    assert.equal((await db.getTokens(key)).accessToken, next.accessToken);
  }
});

test('refresh uses an atomic conditional UPDATE, including nullable columns, never an upsert', async () => {
  const db = fixture();
  await db.upsertTokens(sid, { ...old, refreshToken: null, tokenType: null, expiresAt: null });
  const observed = await db.getTokens(sid);
  db.calls.length = 0;
  await db.updateTokens(sid, next, { expectedTokens: observed });
  assert.deepEqual(db.calls.map(call => call.action), ['update']);
  assert.deepEqual(db.calls[0].filters.map(filter => filter.column), ['sid', 'access_token', 'refresh_token', 'token_type', 'expires_at']);
  assert.equal(db.calls[0].filters.filter(filter => filter.op === 'is').length, 3);
  assert.equal((await db.getTokens(sid)).accessToken, next.accessToken);
});

test('refresh after revoke cannot recreate the deleted row', async () => {
  const db = fixture();
  await db.upsertTokens(sid, old);
  const observed = await db.getTokens(sid);
  await db.updateTokens(sid, null);
  await assert.rejects(db.updateTokens(sid, next, { expectedTokens: observed }), { code: 'chzzk_token_changed', status: 409 });
  assert.equal(db.rows.has(sid), false);
});

test('refresh after reconnect cannot overwrite newly stored credentials, even with equal plaintext', async () => {
  const db = fixture();
  await db.upsertTokens(sid, old);
  const observed = await db.getTokens(sid);
  await db.updateTokens(sid, null);
  await db.upsertTokens(sid, old);
  const reconnected = structuredClone(db.rows.get(sid));
  await assert.rejects(db.updateTokens(sid, next, { expectedTokens: observed }), { code: 'chzzk_token_changed' });
  assert.deepEqual(db.rows.get(sid), reconnected);
});

test('only the first competing refresh of an observation can save', async () => {
  const db = fixture();
  await db.upsertTokens(sid, old);
  const first = await db.getTokens(sid), second = await db.getTokens(sid);
  const results = await Promise.allSettled([
    db.updateTokens(sid, next, { expectedTokens: first }),
    db.updateTokens(sid, { ...next, accessToken: 'other-refresh' }, { expectedTokens: second }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'chzzk_token_changed');
  assert.equal((await db.getTokens(sid)).accessToken, next.accessToken);
});

test('changes to refresh token or expiry invalidate plaintext legacy observations too', async () => {
  for (const change of [{ refresh_token: 'reconnected-refresh' }, { expires_at: next.expiresAt }]) {
    const db = fixture({ encryption: false });
    await db.upsertTokens(sid, old);
    const observed = await db.getTokens(sid);
    Object.assign(db.rows.get(sid), change);
    await assert.rejects(db.updateTokens(sid, next, { expectedTokens: observed }), { code: 'chzzk_token_changed' });
    assert.equal(db.rows.get(sid).access_token, old.accessToken);
  }
});

test('missing, cloned and cross-SID observations fail closed; destination re-read permits migrated identities', async () => {
  const db = fixture();
  const origin = 'sid:temp';
  await db.upsertTokens(origin, old);
  const observed = await db.getTokens(origin);
  for (const expectedTokens of [undefined, null, { ...observed }, JSON.parse(JSON.stringify(observed))]) {
    await assert.rejects(db.updateTokens(origin, next, { expectedTokens }), { code: 'chzzk_token_snapshot_required' });
  }
  db.rows.set(sid, { ...db.rows.get(origin), sid });
  db.rows.delete(origin);
  await assert.rejects(db.updateTokens(sid, next, { expectedTokens: observed }), { code: 'chzzk_token_snapshot_required' });
  await assert.rejects(db.updateTokens(origin, next, { expectedTokens: observed }), { code: 'chzzk_token_changed' });
  await db.updateTokens(sid, next, { expectedTokens: await db.getTokens(sid) });
  assert.equal((await db.getTokens(sid)).accessToken, next.accessToken);
});

test('getTokens encrypts plaintext with CAS, returns a usable observation and exposes no stored ciphertext', async () => {
  const db = fixture();
  db.rows.set(sid, { sid, ...raw(old) });
  const observed = await db.getTokens(sid);
  assert.match(db.rows.get(sid).access_token, /^enc:v1:/);
  assert.deepEqual(Object.keys(observed).sort(), ['accessToken', 'expiresAt', 'refreshToken', 'tokenType']);
  assert.equal(Object.getOwnPropertySymbols(observed).length, 0);
  assert.doesNotMatch(JSON.stringify(observed), /enc:v1:/);
  await db.updateTokens(sid, next, { expectedTokens: observed });
});

test('already-encrypted credentials with null refresh token are not re-encrypted on every read', async () => {
  const db = fixture();
  await db.upsertTokens(sid, { ...old, refreshToken: null });
  const stored = db.rows.get(sid).access_token;
  const observed = await db.getTokens(sid);
  await db.getTokens(sid);
  assert.equal(db.rows.get(sid).access_token, stored);
  assert.equal(db.calls.some(call => call.action === 'update'), false);
  await db.updateTokens(sid, next, { expectedTokens: observed });
});

for (const revoke of [false, true]) test(`read-time encryption cannot overwrite a concurrent ${revoke ? 'revoke' : 'reconnect'}`, async () => {
  const db = fixture();
  db.rows.set(sid, { sid, ...raw(old) });
  db.intercept(async query => {
    if (query.action !== 'update') return;
    db.intercept(null);
    if (revoke) db.rows.delete(sid);
    else await db.upsertTokens(sid, next);
  });
  const observed = await db.getTokens(sid);
  await assert.rejects(db.updateTokens(sid, { ...next, accessToken: 'stale' }, { expectedTokens: observed }), { code: 'chzzk_token_changed' });
  assert.equal((await db.getTokens(sid))?.accessToken ?? null, revoke ? null : next.accessToken);
});

test('CAS database failures propagate without unguarded retry or credential-bearing errors', async () => {
  const db = fixture();
  await db.upsertTokens(sid, old);
  const observed = await db.getTokens(sid);
  const failure = Object.assign(new Error('database unavailable'), { code: '08006' });
  db.intercept(query => query.action === 'update' ? { error: failure } : null);
  const before = db.calls.length;
  await assert.rejects(db.updateTokens(sid, next, { expectedTokens: observed }), error => error === failure);
  assert.equal(db.calls.length, before + 1);
  db.intercept(null);
  assert.equal((await db.getTokens(sid)).accessToken, old.accessToken);
  await db.updateTokens(sid, null);
  await assert.rejects(db.updateTokens(sid, next, { expectedTokens: observed }), error => {
    assert.doesNotMatch(JSON.stringify(error), /old-access|old-refresh|next-access|enc:v1:/);
    return error.code === 'chzzk_token_changed';
  });
});

test('delete propagates first and retry database errors, and permits successful missing-table recovery', async () => {
  for (const mode of ['first-failure', 'retry-failure', 'recovered']) {
    const db = fixture();
    await db.upsertTokens(sid, old);
    let attempts = 0;
    const failure = Object.assign(new Error('database unavailable'), { code: '08006' });
    db.intercept(query => {
      if (query.action !== 'delete') return;
      attempts++;
      if (mode === 'first-failure' || (mode === 'retry-failure' && attempts === 2)) return { error: failure };
      if (attempts === 1) return { error: new Error("Could not find table 'public.tokens'") };
    });
    if (mode === 'recovered') { await db.updateTokens(sid, null); assert.equal(db.rows.has(sid), false); }
    else { await assert.rejects(db.updateTokens(sid, null), error => error === failure); assert.equal(db.rows.has(sid), true); }
    assert.equal(db.heals, mode === 'first-failure' ? 0 : 1);
  }
});

test('undefined or invalid refreshed credentials never accidentally delete a token', async () => {
  const db = fixture();
  await db.upsertTokens(sid, old);
  const observed = await db.getTokens(sid);
  for (const bad of [undefined, {}, { accessToken: '' }]) {
    await assert.rejects(db.updateTokens(sid, bad, { expectedTokens: observed }), { code: 'chzzk_invalid_refresh_tokens' });
  }
  assert.equal((await db.getTokens(sid)).accessToken, old.accessToken);
});

test('actual PostgreSQL-compatible UPDATE predicates reject stale refresh and preserve migrated SID login', {
  skip: !process.env.ARUBOT_TEST_PGLITE_MODULE,
}, async t => {
  const { PGlite } = await import(pathToFileURL(process.env.ARUBOT_TEST_PGLITE_MODULE).href);
  const sql = new PGlite(); t.after(() => sql.close());
  await sql.exec('create table tokens(sid text primary key,access_token text,refresh_token text,token_type text,expires_at timestamptz)');
  const quote = value => `"${String(value).replaceAll('"', '""')}"`;
  const context = vm.createContext({
    withPgClient: fn => fn(sql), quoteIdent: quote,
    buildColumnExpression: quote, parseSelectColumns: value => value === '*' ? '*' : value.split(',').map(part => quote(part.trim())).join(', '),
    addPgColumnValue: (values, _table, _column, value) => `$${values.push(value)}`,
    DEFAULT_UPSERT_CONFLICT_COLUMNS: { tokens: ['sid'] },
  });
  vm.runInContext(`${builderSource}\nthis.client = { from: table => new PgQueryBuilder(table) };`, context);
  const api = load(context.client);
  await api.upsertTokens('sid:legacy', { ...old, refreshToken: null });
  await sql.query("update tokens set sid=$1 where sid='sid:legacy'", [sid]);
  const observed = await api.getTokens(sid);
  await api.updateTokens(sid, next, { expectedTokens: observed });
  await assert.rejects(api.updateTokens(sid, old, { expectedTokens: observed }), { code: 'chzzk_token_changed' });
  const refreshed = await api.getTokens(sid);
  await api.updateTokens(sid, null);
  await assert.rejects(api.updateTokens(sid, old, { expectedTokens: refreshed }), { code: 'chzzk_token_changed' });
  assert.equal((await sql.query('select * from tokens')).rows.length, 0);
  await api.upsertTokens(sid, old);
  await assert.rejects(api.updateTokens(sid, next, { expectedTokens: refreshed }), { code: 'chzzk_token_changed' });
  assert.equal((await api.getTokens(sid)).accessToken, old.accessToken);
});
