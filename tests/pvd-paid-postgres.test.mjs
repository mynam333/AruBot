import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

test('paid video and BGM: durable debit, refund allocation, rollback and concurrent settlement', {
  skip: !process.env.ARUBOT_TEST_POSTGRES_URL, timeout: 45000,
}, async () => {
  const url = new URL(process.env.ARUBOT_TEST_POSTGRES_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname));
  const name = 'pvd_paid_test_' + randomUUID().replaceAll('-', '');
  const admin = new pg.Client({ connectionString: url.href, ssl: false });
  await admin.connect();
  let pool, api, created = false;
  try {
    await admin.query('create database ' + name);
    created = true;
    url.pathname = '/' + name;
    process.env.ARUBOT_DB_PROVIDER = 'postgres';
    process.env.POSTGRES_RUNTIME_URL = url.href;
    process.env.POSTGRES_SSL = 'false';
    api = await import('../server/supabase.js');
    pool = new pg.Pool({ connectionString: url.href, ssl: false, max: 8 });
    await pool.query(await readFile(new URL('../server/migrations/038_broadcast_bonus_points.sql', import.meta.url), 'utf8'));
    await pool.query(`create table platform_accounts(user_id text, provider text, platform_user_id text,
      channel_id text, channel_name text, channel_handle text, avatar_url text, metadata jsonb);
      insert into platform_accounts(user_id, provider, platform_user_id, channel_id) values
      ('streamer', 'chzzk', 'ch-1', 'ch-1'), ('viewer', 'youtube', 'yt-1', 'yt-1');
      insert into live_sessions(sid,live,last_update,bonus_amount,bonus_categories)
        values ('s',true,1,20,'{video,bgm}')`);
    await api.setChannelPoints('ch-1', 'yt-1', 'Viewer', 30);
    const balance = () => api.getChannelPoints('streamer', 'viewer');
    const used = async () => Number((await pool.query("select coalesce(sum(spent),0) as n from broadcast_bonus_usage where sid='s'")).rows[0].n);
    const buy = (key, kind, cost, type = 'video-donation', id = randomUUID()) => {
      return api.enqueuePaidDurableRuntimeJob({ id, sid: 's', jobType: type, idempotencyKey: key,
        channelUid: 'ch-1', userId: 'youtube:yt-1', username: 'Viewer', pointsCost: cost,
        payload: { item: { id, runtimeJobId: id, kind, cost } } });
    };
    const claim = () => api.claimDurableRuntimeJobs({ workerId: 'worker', jobTypes: ['video-donation'] });
    const settle = (id, extra = {}, credit = api.refundBroadcastPoints) =>
      api.chzzkVideoStore.settlePaidQueueItem({ sid: 's', id, workerId: 'worker', refund: true, status: 'deleted', ...extra }, credit);
    assert.equal((await buy('insufficient', 'video', 51)).deduction.balanceBefore, 50);
    assert.equal((await buy('drawing', 'video', 31, 'drawing-donation')).deduction.deducted, false);
    const buys = await Promise.all([buy('key', 'video', 35), buy('key', 'video', 35)]);
    const { job, deduction } = buys.find(entry => entry.created);
    assert.equal(buys.filter(entry => entry.created).length, 1);
    assert.deepEqual(job.payload.pointReceipt, deduction);
    assert.equal(job.payload.item.pointReceipt, undefined);
    assert.deepEqual([job.userId, job.channelUid, deduction.bonusSpent, deduction.ordinarySpent], ['viewer', 'streamer', 20, 15]);
    await assert.rejects(buy('insert-failure', 'video', 2, 'video-donation', job.id), { code: '23505' });
    assert.deepEqual([await balance(), await used()], [15, 20]);
    await claim();
    await assert.rejects(settle(job.id, { workerId: 'stale' }), /not owned/);
    await assert.rejects(settle(job.id, {}, async (...args) => {
      await api.refundBroadcastPoints(...args);
      throw new Error('after credit');
    }), /after credit/);
    assert.deepEqual([await balance(), await used(), (await api.getDurableRuntimeJob(job.id)).status], [15, 20, 'processing']);
    const refunds = await Promise.all(Array.from({ length: 6 }, () => settle(job.id)));
    assert.equal(refunds.filter(entry => entry.applied).length, 1);
    assert.ok(refunds.every(entry => entry.result.refundedAmount === 35));
    assert.deepEqual([await balance(), await used()], [30, 0]);

    const bgm = await buy('bgm', 'bgm', 24);
    await claim();
    await pool.query("update live_sessions set live=false where sid='s'");
    await pool.query("update live_sessions set live=true where sid='s'");
    await pool.query("update live_sessions set bonus_amount=20, bonus_categories='{video}' where sid='s'");
    const expired = await settle(bgm.job.id);
    assert.deepEqual([expired.result.ordinaryRefunded, expired.result.bonusRefunded, await balance(), await used()], [4, 0, 30, 0]);

    const legacy = await buy('legacy', 'bgm', 7);
    assert.equal(legacy.deduction.bonusSpent, 0);
    await pool.query("update durable_runtime_jobs set payload=payload-'pointReceipt' where id=$1", [legacy.job.id]);
    await claim();
    assert.equal((await settle(legacy.job.id)).result.ordinaryRefunded, 7);
    assert.equal(await balance(), 30);

    const played = await buy('played', 'video', 9);
    await claim();
    await settle(played.job.id, { refund: false, status: 'end' });
    assert.equal((await settle(played.job.id)).applied, false);
    assert.deepEqual([await balance(), await used()], [30, 9]);
    const free = await buy('free', 'bgm', 0);
    assert.equal(free.deduction, null);
    assert.equal(free.job.payload.pointReceipt, undefined);
    const drawing = await buy('ordinary-drawing', 'video', 3, 'drawing-donation');
    assert.equal(drawing.job.payload.pointReceipt, undefined);
    assert.deepEqual([await balance(), await used()], [27, 9]);
  } finally {
    await api?.closeDatabaseConnections();
    await pool?.end();
    if (created) await admin.query('drop database ' + name);
    await admin.end();
  }
});
