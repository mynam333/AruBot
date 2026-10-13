import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { platformTokenSnapshotMatches } from '../server/platform-token-guard.js';

const expected = { accessToken: 'old', refreshToken: 'refresh', platformUserId: 'channel', consentGrantedAt: '2026-10-01T00:00:00Z' };
const row = { access_token: 'old', refresh_token: 'refresh', platform_user_id: 'channel', consent_granted_at: '2026-10-01T00:00:00Z' };
test('only the observed authorization can be refreshed or removed', () => {
  assert.equal(platformTokenSnapshotMatches(row, expected, value => value), true);
  for (const changed of [null, { ...row, access_token: 'new' }, { ...row, refresh_token: 'new' },
    { ...row, platform_user_id: 'new-channel' }, { ...row, consent_granted_at: '2026-10-13T00:00:00Z' },
    { ...row, identity_updated_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }]) {
    assert.equal(platformTokenSnapshotMatches(changed, expected, value => value), false);
  }
});

test('actual SQL cannot delete a reconnected YouTube account or recreate revoked platform tokens', { skip: !process.env.ARUBOT_TEST_PGLITE_MODULE }, async t => {
  const { PGlite } = await import(pathToFileURL(process.env.ARUBOT_TEST_PGLITE_MODULE).href);
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create table app_users(id text primary key);
    create table platform_accounts(user_id text,provider text,platform_user_id text,last_login_at timestamptz);
    create table platform_tokens(user_id text,provider text,platform_user_id text,access_token text,refresh_token text,
      token_type text,expires_at timestamptz,scope text,consent_granted_at timestamptz,last_validated_at timestamptz,updated_at timestamptz);
    create table youtube_streamer_channels(owner_user_id text);
    insert into app_users values('owner');
    insert into platform_accounts values('owner','youtube','channel',null);
    insert into platform_tokens(user_id,provider,platform_user_id,access_token,refresh_token,consent_granted_at)
      values('owner','youtube','channel','new','refresh','2026-10-01T00:00:00Z');
    insert into youtube_streamer_channels values('owner');`);
  const pg = { async query(sql, args) { const result = await db.query(sql, args); return { ...result, rowCount: result.affectedRows ?? result.rows.length }; } };
  const source = await readFile(new URL('../server/supabase.js', import.meta.url), 'utf8');
  const remove = source.slice(source.indexOf('export async function deletePlatformAccount('), source.indexOf('async function ensureYoutubeCentralBotTables(')).replace(/^export /gm, '');
  const refresh = source.slice(source.indexOf('export async function upsertPlatformTokens('), source.indexOf('export async function getPlatformTokens(')).replace(/^export /gm, '');
  const ctx = vm.createContext({ platformTokenSnapshotMatches, normalizeProvider: value => value, getDbUrl: () => 'test',
    ensurePlatformIdentityTables: async () => {}, withPgClient: fn => fn(pg), revealSecret: value => value, protectSecret: value => value,
    tableExistsPg: async () => true, invalidatePublicPointTableOwnerIndex: () => {} });
  vm.runInContext(`${remove}\n${refresh}\nthis.remove=deletePlatformAccount;this.refresh=upsertPlatformTokens;`, ctx);
  const result = await ctx.remove('youtube', 'owner', null, { expectedTokens: expected, deleteStreamerChannel: true });
  assert.equal(result.skipped, 'authorization_changed');
  assert.equal((await db.query('select * from platform_accounts')).rows.length, 1);
  assert.equal((await db.query('select * from youtube_streamer_channels')).rows.length, 1);
  assert.equal(await ctx.refresh('youtube', 'owner', 'channel', { accessToken: 'stale-result' }, { expectedTokens: expected }), false);
  assert.equal((await db.query('select access_token from platform_tokens')).rows[0].access_token, 'new');
  const active = { ...expected, accessToken: 'new' };
  await db.exec("update platform_accounts set last_login_at='2026-10-13T00:00:00Z'; update platform_tokens set updated_at='2026-10-01T00:00:00Z'");
  const reconnecting = await ctx.remove('youtube', 'owner', null, { expectedTokens: active, deleteStreamerChannel: true });
  assert.equal(reconnecting.skipped, 'authorization_changed');
  assert.equal(await ctx.refresh('youtube', 'owner', 'channel', { accessToken: 'stale-result' }, { expectedTokens: active }), false);
  await db.exec('update platform_accounts set last_login_at=null');
  assert.equal(await ctx.refresh('youtube', 'owner', 'channel', { accessToken: 'refreshed', refreshToken: 'refresh' }, { expectedTokens: active }), true);
  const deleted = await ctx.remove('youtube', 'owner', null, { expectedTokens: { ...active, accessToken: 'refreshed' }, deleteStreamerChannel: true });
  assert.equal(deleted.accountsDeleted, 1); assert.equal(deleted.streamerChannelDeleted, true);
  assert.equal(await ctx.refresh('youtube', 'owner', 'channel', { accessToken: 'stale-result' }, { expectedTokens: active }), false);
  assert.equal((await db.query('select * from platform_tokens')).rows.length, 0);
});
