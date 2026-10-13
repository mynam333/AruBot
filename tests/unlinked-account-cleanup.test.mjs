import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { lockUnlinkedAccount, cleanupUnlinkedAccountBatch } from '../server/unlinked-account-cleanup.js';

const source = await readFile(new URL('../server/supabase.js', import.meta.url), 'utf8');
const cleanupSource = source.slice(source.indexOf('async function tableExistsPg('), source.indexOf('function retentionDays(')).replace(/^export /gm, '');
const fixedNow = '2026-10-13T00:00:00Z';
function guardFixture({ missing = false, linked = false, legacy = '', recent = false, fail = false } = {}) {
  const calls = [];
  return { calls, async query(sql, args) {
    calls.push(sql);
    if (fail) throw new Error('database unavailable');
    if (sql.startsWith('select id,created_at')) return { rows: missing ? [] : [{ id: args[0], created_at: recent ? '2026-10-14' : '2026-01-01' }] };
    if (sql.startsWith('select 1 from platform_accounts')) return { rows: linked ? [{}] : [] };
    if (sql.startsWith('select to_regclass')) return { rows: [{ table_name: args[0].endsWith(legacy) && legacy ? args[0] : null }] };
    return { rows: [{}] };
  } };
}
for (const [label, options, expected] of [
  ['unlinked', {}, null], ['connected', { linked: true }, 'platform_connected'],
  ['missing', { missing: true }, 'account_missing'], ['recent', { recent: true }, 'recent_account'],
  ...['platform_tokens', 'tokens', 'youtube_streamer_channels'].map(legacy => [legacy, { legacy }, 'legacy_connection']),
]) test(`cleanup guard: ${label}`, async () => {
  const pg = guardFixture(options);
  assert.equal(await lockUnlinkedAccount(pg, 'owner', fixedNow), expected);
  assert.match(pg.calls[0], /for update$/);
});
test('database failure is not treated as an empty account', async () => {
  await assert.rejects(lockUnlinkedAccount(guardFixture({ fail: true }), 'owner'), /database unavailable/);
});
test('batch defaults to dry run, rechecks candidates transactionally and reports failures separately', async () => {
  const seen = [];
  const dependencies = { withPgClient: fn => fn({ query: async () => ({ rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }) }),
    deleteAccountData: async (id, options) => {
      seen.push(options);
      if (id === 'b') return { ok: true, skipReason: 'platform_connected' };
      if (id === 'c') throw new Error('database failed');
      return { ok: true, eligible: true };
    } };
  const result = await cleanupUnlinkedAccountBatch(dependencies, { limit: 3, before: fixedNow });
  assert.equal(result.dryRun, true); assert.equal(result.eligible, 1); assert.equal(result.deleted, 0);
  assert.equal(result.failed.length, 1); assert.equal(result.skipped.platform_connected, 1);
  assert.equal(result.after, 'c'); assert.equal(result.hasMore, true);
  assert.ok(seen.every(item => item.requireNoPlatforms && item.dryRun && item.unlinkedBefore === fixedNow));
  await assert.rejects(cleanupUnlinkedAccountBatch(dependencies, { limit: 10000 }), /limit/);
});

test('actual deletion SQL removes only unlinked-owned data, preserves reused platform aliases, and rolls back failures', { skip: !process.env.ARUBOT_TEST_PGLITE_MODULE }, async t => {
  const { PGlite } = await import(pathToFileURL(process.env.ARUBOT_TEST_PGLITE_MODULE).href);
  const sql = new PGlite(); t.after(() => sql.close());
  await sql.exec(`create table app_users(id text primary key,created_at timestamptz not null default '2026-01-01');
    create table platform_accounts(user_id text references app_users(id) on delete cascade,provider text,platform_user_id text,channel_id text,channel_handle text);
    create table platform_tokens(user_id text references app_users(id) on delete cascade,access_token text,platform_user_id text);
    create table tokens(sid text,access_token text);
    create table youtube_streamer_channels(owner_user_id text references app_users(id) on delete cascade);
    create table sessions(sid text,user_id text,account_user_id text,channel_id text);
    create table bot_settings(sid text,value text);
    insert into app_users(id) values('orphan'),('linked'),('legacy'),('token'),('failed');
    insert into platform_accounts values('linked','chzzk','orphan','orphan',null);
    insert into youtube_streamer_channels values('legacy');
    insert into platform_tokens values('token','stored-token','platform-token');
    insert into bot_settings values('user:orphan','delete'),('orphan','preserve reused channel'),('user:linked','preserve'),('user:failed','rollback');
    insert into sessions values('orphan-cookie','orphan','orphan',null),('linked-cookie','linked','linked','orphan'),('old-cookie','orphan',null,null);`);
  let fail = false;
  const pg = { async query(query, args) {
    if (fail && query.startsWith('delete from "public"."app_users"')) { fail = false; throw new Error('injected deletion failure'); }
    const result = await sql.query(query, args);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  } };
  const context = vm.createContext({ crypto, console,
    lockUnlinkedAccount, cleanupUnlinkedAccountBatch, getDbUrl: () => 'test-only', withPgClient: fn => fn(pg),
    makeArubotViewerUuid: value => `aru_${crypto.createHash('sha256').update(value).digest('hex').slice(0, 24)}`,
    uniqueNonEmpty: values => [...new Set(values.filter(Boolean).map(String))],
    sanitizeTableNameSuffix: value => value.replace(/[^a-zA-Z0-9_]/g, '_'),
    quoteIdent: value => value.split('.').map(part => `"${part.replaceAll('"', '""')}"`).join('.'),
    deleteDrawingDonationObjectKeys: async keys => ({ deleted: keys.length }),
    invalidatePublicPointTableOwnerIndex: () => {},
  });
  vm.runInContext(`${cleanupSource}\nthis.removeAccount = deleteAccountData;`, context);
  const remove = context.removeAccount;
  const dry = await remove('orphan', { requireNoPlatforms: true, dryRun: true });
  assert.equal(dry.eligible, true);
  assert.equal((await sql.query("select 1 from app_users where id='orphan'")).rows.length, 1);
  for (const id of ['linked', 'legacy', 'token']) {
    const result = await remove(id, { requireNoPlatforms: true });
    assert.equal(result.accountDeleted, false); assert.ok(result.skipReason);
  }
  const deleted = await remove('orphan', { requireNoPlatforms: true });
  assert.equal(deleted.accountDeleted, true);
  assert.equal((await sql.query("select 1 from app_users where id='orphan'")).rows.length, 0);
  assert.equal((await sql.query("select 1 from bot_settings where sid='user:orphan'")).rows.length, 0);
  assert.equal((await sql.query("select 1 from bot_settings where sid='orphan'")).rows.length, 1);
  assert.equal((await sql.query("select 1 from platform_accounts where user_id='linked'")).rows.length, 1);
  assert.deepEqual((await sql.query('select sid from sessions')).rows.map(row => row.sid), ['linked-cookie']);
  fail = true;
  await assert.rejects(remove('failed', { requireNoPlatforms: true }), /injected deletion failure/);
  assert.equal((await sql.query("select 1 from app_users where id='failed'")).rows.length, 1);
  assert.equal((await sql.query("select 1 from bot_settings where sid='user:failed'")).rows.length, 1);
});
