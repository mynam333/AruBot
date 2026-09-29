export const DRAWING_RETENTION_DAYS = 30;

export function drawingRetentionDays(value) {
  const days = Math.floor(Number(value));
  return Number.isFinite(days) && days > 0 ? Math.min(days, DRAWING_RETENTION_DAYS) : DRAWING_RETENTION_DAYS;
}

// The caller holds the donation row lock and commits points and refund state together.
export async function refundDrawingRow(pg, row, credit) {
  let refundedAmount = 0;
  if (!row.point_refunded) {
    const deductions = Array.isArray(row.point_deductions) ? row.point_deductions : [];
    const cost = Number(row.cost || 0);
    if (!Number.isSafeInteger(cost) || cost < 0 || deductions.some((entry) => !entry.userId
      || !Number.isSafeInteger(Number(entry.amount)) || Number(entry.amount) < 0)
      || deductions.reduce((sum, entry) => sum + Number(entry.amount), 0) !== cost) {
      throw new Error('drawing_refund_deductions_invalid');
    }
    for (const deduction of [...deductions].sort((a, b) => String(a.userId).localeCompare(String(b.userId)))) {
      const amount = Number(deduction.amount);
      if (amount > 0) await credit(pg, row, { ...deduction, amount });
      refundedAmount += amount;
    }
  }
  const updated = await pg.query(
    `update public.drawing_donation_items set status = 'rejected', point_refunded = true,
       rejected_at = coalesce(rejected_at, now()), updated_at = now() where sid = $1 and id = $2 returning *`,
    [row.sid, row.id]
  );
  return { row: updated.rows[0], refundedAmount };
}

export async function refundDrawingWithClient(pg, sid, id, credit) {
  await pg.query('begin');
  try {
    const result = await pg.query('select * from public.drawing_donation_items where sid = $1 and id = $2 for update', [String(sid), String(id)]);
    const refund = result.rows[0] ? await refundDrawingRow(pg, result.rows[0], credit) : null;
    await pg.query('commit');
    return refund;
  } catch (error) { await pg.query('rollback'); throw error; }
}

export async function cleanupDrawingBatch(pg, { cutoff, after = null, credit, deleteObjects, hasJobs = false }) {
  const candidates = await pg.query(
    `select id, sid, created_at::text as created_at from public.drawing_donation_items
      where created_at < $1::timestamptz and status in ('queued', 'approved', 'playing', 'done', 'rejected', 'deleted')
        and (status <> 'playing' or coalesce(playing_at, created_at) < now() - interval '1 hour')
        and ($2::timestamptz is null or (created_at, id) > ($2::timestamptz, $3::text))
      order by created_at, id limit 100`, [cutoff, after?.created_at || null, after?.id || '']
  );
  const summary = { deleted: 0, objectKeysDeleted: 0, objectKeysSkipped: 0, expired: [], failed: [], after: candidates.rows.at(-1), hasMore: candidates.rows.length === 100 };
  for (const candidate of candidates.rows) {
    try {
      await pg.query('begin');
      const found = await pg.query(
        `select * from public.drawing_donation_items where sid = $1 and id = $2 and created_at < $3::timestamptz
          and status in ('queued', 'approved', 'playing', 'done', 'rejected', 'deleted')
          and (status <> 'playing' or coalesce(playing_at, created_at) < now() - interval '1 hour') for update skip locked`,
        [candidate.sid, candidate.id, cutoff]
      );
      let row = found.rows[0];
      if (!row) { await pg.query('commit'); continue; }
      let refundedAmount = 0;
      if (['queued', 'approved', 'playing'].includes(row.status)) {
        ({ row, refundedAmount } = await refundDrawingRow(pg, row, credit));
      }
      // Keep cancellation/refund durable even when object storage is temporarily unavailable.
      await pg.query('commit');
      summary.expired.push({ sid: row.sid, id: row.id, channelUid: row.channel_uid, viewerUserId: row.viewer_user_id, viewerName: row.viewer_name, refundedAmount });
      await pg.query('begin');
      const locked = await pg.query(
        `select * from public.drawing_donation_items where sid = $1 and id = $2 and created_at < $3::timestamptz
          and status in ('done', 'rejected', 'deleted') for update skip locked`, [row.sid, row.id, cutoff]
      );
      row = locked.rows[0];
      if (!row) { await pg.query('commit'); continue; }
      const keys = [...new Set([row.stroke_object_key, row.preview_object_key].filter(Boolean))];
      const removed = await deleteObjects(keys);
      summary.objectKeysDeleted += removed.deleted || 0;
      summary.objectKeysSkipped += removed.skipped || 0;
      if (removed.skipped) throw new Error('drawing_storage_unavailable');
      if (hasJobs) {
        await pg.query(
          `update public.durable_runtime_jobs set payload = '{}'::jsonb, result = '{}'::jsonb,
            status = 'cancelled', locked_by = null, locked_at = null, updated_at = now()
            where sid = $1 and job_type = 'drawing-donation' and payload->'item'->>'id' = $2`, [row.sid, row.id]
        );
      }
      await pg.query('delete from public.drawing_donation_items where sid = $1 and id = $2', [row.sid, row.id]);
      await pg.query('commit');
      summary.deleted++;
    } catch (error) {
      await pg.query('rollback');
      summary.failed.push({ sid: candidate.sid, id: candidate.id, error: error?.message || 'drawing_cleanup_failed' });
    }
  }
  return summary;
}
