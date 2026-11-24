import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { validateBroadcastBonus } from '../../shared/broadcast-bonus.js';
import { closeDatabaseConnections, debitBroadcastPoints, refundBroadcastPoints, getBroadcastBonusSettings,
  saveBroadcastBonusSettings, getViewerBroadcastBonus, listChannelPoints } from '../../server/supabase.js';

const url = new URL(process.env.ARUBOT_TEST_POSTGRES_URL);
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !/test/i.test(url.pathname)) throw new Error('Requires an explicitly configured local PostgreSQL test database');
const db = 'bonus_test_' + randomBytes(8).toString('hex');
const admin = new pg.Client({ connectionString: url.href });
await admin.connect();
let pool, created = false;
try {
  // Wallet tables are explicitly public-qualified. Isolate those as well as the migration.
  await admin.query('create database ' + db);
  created = true;
  url.pathname = '/' + db;
  process.env.ARUBOT_DB_PROVIDER = 'postgres';
  process.env.POSTGRES_RUNTIME_URL = url.href;
  process.env.POSTGRES_SSL = 'false';
  pool = new pg.Pool({ connectionString: url.href });
  const migration = await readFile(new URL('../../server/migrations/038_broadcast_bonus_points.sql', import.meta.url), 'utf8');
  await pool.query(migration);
  await pool.query(migration);
  await pool.query(`create table platform_accounts(user_id text, provider text, platform_user_id text, channel_id text,
    channel_name text, channel_handle text, avatar_url text, metadata jsonb);
    insert into platform_accounts(user_id,provider,platform_user_id) values
      ('owner','youtube','OwnerCh'),('v','chzzk','viewerch'),('v','youtube','vieweryt');
    create table "channelpoint_OwnerCh"(user_id text primary key, username text, points integer);
    insert into "channelpoint_OwnerCh" values('v','viewer',55);
    insert into live_sessions(sid,live,session_start_time,last_update) values ('user:owner',true,10,10)`);
  const sid = 'user:owner';
  const first = (await getBroadcastBonusSettings(sid)).sessionKey;
  const categories = ['video','roulette','wheel'];
  const configure = (amount, sessionKey = first) => saveBroadcastBonusSettings(sid, { sessionKey, amount, categories });
  assert.throws(() => validateBroadcastBonus({sessionKey:first, amount:5, categories:[]}), {status:400});
  assert.throws(() => validateBroadcastBonus({sessionKey:first, amount:-1, categories}), {status:400});
  assert.throws(() => validateBroadcastBonus({sessionKey:first, amount:5, categories:['all']}), {status:400});
  assert.throws(() => validateBroadcastBonus({sessionKey:first, amount:5, categories:['prediction']}), {status:400});
  async function tx(work) {
    const c = await pool.connect();
    try { await c.query('begin'); const result = await work(c); await c.query('commit'); return result; }
    catch (error) { await c.query('rollback'); throw error; } finally { c.release(); }
  }
  const args = { sid, channelUid:'OwnerCh', username:'viewer' };
  const debit = (userId, amount, category) => tx(c => debitBroadcastPoints(c,{...args,userId,amount,category}));
  const refund = receipt => tx(c => refundBroadcastPoints(c,{...args,userId:'v',amount:receipt.amount,receipt}));
  const remaining = async viewer => (await getViewerBroadcastBonus(sid,viewer)).remaining;
  const ordinary = async () => (await listChannelPoints('OwnerCh'))[0].points;
  const additions = ['drawing', 'marble', 'blueprint'];
  await saveBroadcastBonusSettings(sid, { sessionKey: first, amount: 60, categories: additions });
  for (const category of additions) assert.equal((await debit('newCategoriesViewer', 20, category)).bonusSpent, 20);
  assert.equal(await remaining('newCategoriesViewer'), 0);
  assert.equal((await debit('newCategoriesViewer', 1, 'marble')).ok, false);
  assert.equal((await debit('predictionViewer', 1, 'prediction')).ok, false);
  await configure(100);
  for (const category of additions) assert.equal((await debit('unselectedViewer', 1, category)).ok, false);
  assert.equal(await remaining(null), null);
  assert.equal(await remaining('newViewer'), 100);
  assert.equal((await debit('viewerch',56,'command')).ok, false);
  assert.equal((await debit('viewerch',156,'video')).ok, false);
  assert.equal(await remaining('v'), 100);
  const bonusOnly = await debit('viewerch',70,'video');
  assert.equal(bonusOnly.bonusSpent,70);
  assert.equal(await remaining('vieweryt'),30);
  assert.equal(await ordinary(),55);
  await configure(0);
  await configure(50);
  assert.equal(await remaining('v'),0);
  await configure(100);
  await pool.query('update live_sessions set last_update=100000000 where sid=$1',[sid]);
  assert.equal((await getBroadcastBonusSettings(sid)).sessionKey,first);
  const mixed = await debit('vieweryt',50,'wheel');
  assert.deepEqual([mixed.bonusSpent,mixed.ordinarySpent,await ordinary()],[30,20,35]);
  assert.deepEqual(await refund(mixed), {bonusRefunded:30,ordinaryRefunded:20});
  assert.equal(await remaining('viewerch'),30);
  const result = await Promise.all([debit('newViewer',80,'wheel'),debit('newViewer',80,'roulette')]);
  assert.equal(result.filter(r=>r.ok).length,1);
  assert.equal(await remaining('newViewer'),20);
  assert.equal(await remaining('v'),30);
  const final = await debit('v',65,'roulette');
  assert.deepEqual([final.bonusSpent,final.ordinarySpent],[30,35]);
  await pool.query('update live_sessions set live=false where sid=$1',[sid]);
  assert.equal((await getBroadcastBonusSettings(sid)).live,false);
  assert.equal((await pool.query('select * from broadcast_bonus_usage')).rowCount,0);
  await assert.rejects(configure(100),{status:409});
  await pool.query('update live_sessions set live=true,session_start_time=20 where sid=$1',[sid]);
  const second = await getBroadcastBonusSettings(sid);
  assert.notEqual(second.sessionKey,first);
  assert.equal(second.amount,0);
  await assert.rejects(configure(100),{status:409});
  await configure(15,second.sessionKey);
  assert.deepEqual(await refund(final), {bonusRefunded:0,ordinaryRefunded:35});
  assert.equal(await ordinary(),55);
  assert.equal(await remaining('v'),15);
} finally {
  await closeDatabaseConnections();
  await pool?.end();
  if (created) await admin.query('drop database ' + db);
  await admin.end();
}
