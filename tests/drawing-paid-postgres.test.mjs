import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import loadServerFunctions from './helpers/load-server-functions.cjs';

test('drawing debit, worker persistence, refunds and retention use the original allocation', {
  skip: !process.env.ARUBOT_TEST_POSTGRES_URL, timeout: 45000,
}, async () => {
  const url = new URL(process.env.ARUBOT_TEST_POSTGRES_URL);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname));
  const name = 'drawing_test_' + randomUUID().replaceAll('-', '');
  const admin = new pg.Client({ connectionString: url.href, ssl: false });
  await admin.connect();
  let api, pool, created = false;
  try {
    await admin.query('create database ' + name);
    created = true;
    url.pathname = '/' + name;
    Object.assign(process.env, { ARUBOT_DB_PROVIDER: 'postgres', POSTGRES_RUNTIME_URL: url.href, POSTGRES_SSL: 'false',
      ARUBOT_ALLOW_SUPABASE_ENV_WITH_POSTGRES: 'false', DRAWING_DONATION_STORAGE_DIR: join(tmpdir(), name) });
    api = await import('../server/supabase.js');
    pool = new pg.Pool({ connectionString: url.href, ssl: false });
    await pool.query(await readFile(new URL('../server/migrations/038_broadcast_bonus_points.sql', import.meta.url), 'utf8'));
    await pool.query(`create table platform_accounts(user_id text, provider text, platform_user_id text, channel_id text,
      channel_name text, channel_handle text, avatar_url text, metadata jsonb);
      insert into platform_accounts(user_id,provider,platform_user_id,channel_id) values
        ('owner','chzzk','channel-alias','channel-alias'), ('viewer','youtube','yt-alias','yt-alias');
      insert into live_sessions(sid,live,last_update,bonus_amount,bonus_categories) values ('user:owner',true,1,20,'{drawing}')`);
    const sid = 'user:owner';
    const buy = (key, cost, id = randomUUID()) => api.enqueuePaidDurableRuntimeJob({
      id, sid, jobType: 'drawing-donation', idempotencyKey: key, channelUid: 'channel-alias', userId: 'youtube:yt-alias',
      pointsCost: cost, payload: { item: { id, ownerSid: sid, cost, status: 'queued', pointDeductions: [] } },
    });
    const { dispatchDurableRuntimeJob } = loadServerFunctions(['dispatchDurableRuntimeJob'], {
      getDrawingDonationItem: api.getDrawingDonationItem, insertDrawingDonationItem: api.insertDrawingDonationItem,
      notifyDrawingSubscribers: async () => {}, notifyDrawingAdminSubscribers: async () => {},
    });
    const dispatch = async id => {
      const [job] = await api.claimDurableRuntimeJobs({ workerId: 'worker', jobTypes: ['drawing-donation'] });
      assert.equal(job.id, id);
      const done = await dispatchDurableRuntimeJob(job);
      assert.equal(done.complete, true);
      await api.completeDurableRuntimeJob(job.id, 'worker', done.result);
      return api.getDrawingDonationItem(sid, id);
    };
    const balances = async () => [await api.getChannelPoints('owner', 'viewer'), (await api.getViewerBroadcastBonus(sid, 'yt-alias')).remaining];
    const refund = id => api.refundDrawingDonationItem(sid, id);
    const only = await buy('first-time-viewer', 12);
    assert.deepEqual([only.deduction.bonusSpent, only.deduction.ordinarySpent], [12, 0]);
    await dispatch(only.job.id);
    assert.equal((await refund(only.job.id)).refundedAmount, 12);
    await api.setChannelPoints('channel-alias', 'yt-alias', 'Viewer', 10);
    assert.equal((await buy('over-budget', 31)).job, null);

    const concurrent = await Promise.all([buy('duplicate', 25), buy('duplicate', 25)]);
    assert.equal(concurrent.filter(r => r.created).length, 1);
    const { job, deduction } = concurrent.find(r => r.created);
    assert.deepEqual(concurrent[0].job.payload.item, concurrent[1].job.payload.item);
    assert.deepEqual((await api.getDrawingSubmissionByKey(sid, 'duplicate')).payload.item, job.payload.item);
    assert.deepEqual([job.channelUid, job.userId, job.payload.item.channelUid, job.payload.item.viewerUserId], ['owner', 'viewer', 'owner', 'viewer']);
    const receipt = { userId: 'viewer', streamerUid: 'owner', username: null, amount: 25, ordinarySpent: 5, bonusSpent: 20,
      sessionKey: (await api.getBroadcastBonusSettings(sid)).sessionKey };
    assert.equal(deduction.sessionKey, receipt.sessionKey);
    assert.deepEqual(job.payload.item.pointDeductions, [receipt]);
    assert.deepEqual((await dispatch(job.id)).pointDeductions, [receipt]);
    await assert.rejects(buy('insert-failure', 3, job.id), { code: '23505' });
    assert.deepEqual(await balances(), [5, 0]);

    const setDeductions = entries => pool.query('update drawing_donation_items set point_deductions=$2::jsonb where id=$1', [job.id, JSON.stringify(entries)]);
    await setDeductions([{ ...receipt, ordinarySpent: 25 }]);
    await assert.rejects(refund(job.id), /refund receipt/);
    assert.equal((await api.getDrawingDonationItem(sid, job.id)).pointRefunded, false);
    assert.deepEqual(await balances(), [5, 0]);
    await setDeductions([receipt]);
    const refunds = await Promise.all([refund(job.id), refund(job.id)]);
    assert.deepEqual(refunds.map(r => r.refundedAmount).sort((a,b) => a-b), [0, 25]);
    assert.deepEqual(await balances(), [10, 20]);

    const expired = await buy('new-session', 27);
    await dispatch(expired.job.id);
    await pool.query('update live_sessions set live=false; update live_sessions set live=true; update live_sessions set bonus_amount=20, bonus_categories=\'{drawing}\'');
    const fresh = await buy('fresh-spend', 12);
    await dispatch(fresh.job.id);
    await pool.query("update drawing_donation_items set created_at=now()-interval '31 days' where id=$1", [expired.job.id]);
    const retention = await api.cleanupPrivacyRetentionData({ drawingDonationDays: 30 });
    assert.deepEqual(retention.drawingFailed, []);
    assert.equal(retention.drawingExpired.find(e => e.id === expired.job.id).refundedAmount, 7);
    assert.equal(await api.getDrawingDonationItem(sid, expired.job.id), null);
    assert.equal((await api.getDurableRuntimeJob(expired.job.id)).status, 'cancelled');
    assert.deepEqual(await balances(), [10, 8]);
    assert.equal((await refund(fresh.job.id)).refundedAmount, 12);

    await pool.query("update live_sessions set bonus_categories='{video}'");
    const ordinary = await buy('drawing-disabled', 6);
    assert.deepEqual([ordinary.deduction.bonusSpent, ordinary.deduction.ordinarySpent, ordinary.deduction.sessionKey], [0, 6, null]);
    const legacy = await dispatch(ordinary.job.id);
    await pool.query('update drawing_donation_items set channel_uid=$2,point_deductions=$3::jsonb where id=$1', [
      legacy.id, 'channel-alias', JSON.stringify([{ userId: 'yt-alias', amount: 2 }, { userId: 'youtube:yt-alias', amount: 4 }]),
    ]);
    assert.equal((await refund(legacy.id)).refundedAmount, 6);
    assert.deepEqual(await balances(), [10, 20]);
  } finally {
    await api?.closeDatabaseConnections();
    await pool?.end();
    try { if (created) await admin.query('drop database ' + name); }
    finally { await admin.end(); }
  }
});
