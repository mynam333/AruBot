// Credits and terminal state share one transaction. Only the durable charge, never
// the mutable playback queue or HTTP request, determines the recipient and amount.
export async function settlePaidVideoWithClient(pg, { sid, id, workerId, status, refund }, refundPoints) {
  await pg.query('begin');
  try {
    const { rows: [job] } = await pg.query(
      `select status, locked_by, points_cost, channel_uid, user_id, username, payload, result
         from durable_runtime_jobs where sid=$1 and id=$2 and job_type='video-donation' for update`, [sid, id],
    );
    if (!job) throw new Error('Paid video job not found');
    if (job.status === 'completed') {
      await pg.query('commit');
      return { applied: false, result: job.result };
    }
    if (job.status !== 'processing' || !workerId || job.locked_by !== workerId) {
      throw new Error('Paid video job is not owned by this worker');
    }
    const amount = Number(job.points_cost);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !job.channel_uid || !job.user_id) {
      throw new Error('Invalid durable video charge');
    }
    const { ordinaryRefunded, bonusRefunded } = refund ? await refundPoints(pg, {
      sid, channelUid: job.channel_uid, userId: job.user_id, username: job.username, amount,
      category: job.payload.item?.kind === 'bgm' ? 'bgm' : 'video', receipt: job.payload.pointReceipt,
    }) : { ordinaryRefunded: 0, bonusRefunded: 0 };
    const refundedAmount = ordinaryRefunded + bonusRefunded;
    const result = { status, refundRequested: !!refund, refunded: refundedAmount > 0, refundedAmount, ordinaryRefunded, bonusRefunded };
    await pg.query(`update durable_runtime_jobs set status='completed', result=$3::jsonb,
      completed_at=now(), updated_at=now(), locked_by=null, locked_at=null, last_error=null
      where sid=$1 and id=$2`, [sid, id, JSON.stringify(result)]);
    await pg.query('commit');
    return { applied: true, result, channelUid: job.channel_uid, userId: job.user_id };
  } catch (error) {
    await pg.query('rollback').catch(() => {});
    throw error;
  }
}
