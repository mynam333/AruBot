import test from 'node:test';
import assert from 'node:assert/strict';
import { drawingRetentionDays, cleanupDrawingBatch, refundDrawingWithClient } from '../server/drawing-retention.js';

const cutoff = '2026-09-01T00:00:00.000Z';
const row = (id, status = 'queued') => ({ id, sid: 'user:s', channel_uid: 'channel', viewer_user_id: 'viewer', status,
  created_at: '2026-08-01T00:00:00.000Z', cost: 100, point_refunded: false, point_deductions: [{ userId: 'viewer', amount: 100 }],
  stroke_object_key: `local:${id}.json.gz`, preview_object_key: `local:${id}.webp` });

function database(initial) {
  const db = { rows: initial, points: 0, clearedJobs: [], calls: [], tail: Promise.resolve() };
  const eligible = (r) => r.status !== 'playing' || new Date(r.playing_at || r.created_at).getTime() < Date.now() - 3600000;
  db.connect = () => {
    let snapshot, release;
    return { async query(sql, params = []) {
      sql = sql.replace(/\s+/g, ' ').trim(); db.calls.push(sql);
      if (sql === 'begin') {
        const previous = db.tail; db.tail = new Promise((resolve) => { release = resolve; }); await previous;
        snapshot = structuredClone({ rows: db.rows, points: db.points, clearedJobs: db.clearedJobs });
      } else if (sql === 'commit' || sql === 'rollback') {
        if (sql === 'rollback' && snapshot) Object.assign(db, snapshot);
        snapshot = null; release?.();
      } else if (sql.startsWith('select id, sid, created_at')) {
        return { rows: db.rows.filter((r) => r.created_at < params[0] && eligible(r)
          && (!params[1] || r.created_at > params[1] || (r.created_at === params[1] && r.id > params[2]))).slice(0, 100) };
      } else if (sql.startsWith('select *')) {
        return { rows: db.rows.filter((r) => r.sid === params[0] && r.id === params[1]
          && (!params[2] || (r.created_at < params[2] && eligible(r)))) };
      } else if (sql.startsWith('update public.drawing_donation_items')) {
        const found = db.rows.find((r) => r.sid === params[0] && r.id === params[1]);
        Object.assign(found, { status: 'rejected', point_refunded: true }); return { rows: [found] };
      } else if (sql.startsWith('update public.durable_runtime_jobs')) db.clearedJobs.push(params[1]);
      else if (sql.startsWith('delete from')) db.rows = db.rows.filter((r) => r.sid !== params[0] || r.id !== params[1]);
      else throw new Error(`unexpected query: ${sql}`);
      return { rows: [] };
    } };
  };
  db.credit = async (_pg, _row, deduction) => { db.points += deduction.amount; };
  return db;
}

test('drawing retention defaults to 30 days and cannot be disabled or extended', () => {
  for (const value of [undefined, 'invalid', 0, -1, 365]) assert.equal(drawingRetentionDays(value), 30);
  assert.equal(drawingRetentionDays(7), 7);
});

test('concurrent refunds acquire a row lock and credit exactly once', async () => {
  const db = database([row('one')]);
  const result = await Promise.all([1, 2].map(() => refundDrawingWithClient(db.connect(), 'user:s', 'one', db.credit)));
  assert.equal(db.points, 100); assert.equal(result.reduce((sum, r) => sum + r.refundedAmount, 0), 100);
  assert.ok(db.calls.some((sql) => sql.endsWith('for update')));
  assert.equal(db.rows[0].point_refunded, true);
});

test('credit failure rolls back both points and refund state', async () => {
  const db = database([row('one')]);
  await assert.rejects(refundDrawingWithClient(db.connect(), 'user:s', 'one', async () => { db.points += 100; throw new Error('offline'); }));
  assert.equal(db.points, 0); assert.equal(db.rows[0].point_refunded, false); assert.equal(db.rows[0].status, 'queued');
});

test('expired pending items refund; finished items delete without refund; active playback stays', async () => {
  const db = database([row('one'), row('two', 'approved'), row('three', 'done'), { ...row('four', 'playing'), playing_at: new Date().toISOString() }, { ...row('new'), created_at: '2026-09-02T00:00:00.000Z' }]);
  const result = await cleanupDrawingBatch(db.connect(), { cutoff, credit: db.credit, hasJobs: true, deleteObjects: async (keys) => ({ deleted: keys.length }) });
  assert.equal(result.deleted, 3); assert.equal(db.points, 200); assert.equal(result.objectKeysDeleted, 6);
  assert.deepEqual(db.rows.map((r) => r.id), ['four', 'new']); assert.equal(db.clearedJobs.length, 3);
  assert.ok(db.calls.some((sql) => sql.endsWith('for update skip locked')));
});

test('expired playback abandoned for over an hour is cancelled, refunded and removed', async () => {
  const db = database([{ ...row('stale', 'playing'), playing_at: new Date(Date.now() - 7200000).toISOString() }]);
  const result = await cleanupDrawingBatch(db.connect(), { cutoff, credit: db.credit, deleteObjects: async (keys) => ({ deleted: keys.length }) });
  assert.equal(result.deleted, 1); assert.equal(db.points, 100);
});

test('storage failure retains references; retry removes assets without a second refund', async () => {
  const db = database([row('one')]);
  const first = await cleanupDrawingBatch(db.connect(), { cutoff, credit: db.credit, deleteObjects: async () => { throw new Error('storage offline'); } });
  assert.equal(first.deleted, 0); assert.equal(first.failed.length, 1); assert.equal(db.points, 100);
  assert.equal(db.rows[0].status, 'rejected'); assert.equal(db.rows[0].stroke_object_key, 'local:one.json.gz');
  const second = await cleanupDrawingBatch(db.connect(), { cutoff, credit: db.credit, deleteObjects: async (keys) => ({ deleted: keys.length }) });
  assert.equal(second.deleted, 1); assert.equal(db.points, 100); assert.equal(db.rows.length, 0);
});

test('missing object storage and invalid deductions never silently discard data', async () => {
  const db = database([row('one'), { ...row('bad'), point_deductions: [] }]);
  const result = await cleanupDrawingBatch(db.connect(), { cutoff, credit: db.credit, deleteObjects: async () => ({ skipped: 2 }) });
  assert.equal(result.deleted, 0); assert.equal(result.failed.length, 2); assert.equal(db.rows.length, 2);
  assert.equal(db.points, 100); assert.equal(db.rows[1].point_refunded, false);
});
