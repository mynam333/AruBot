// Recover only exhausted leases which the still-serving instance actually lists.
// A historical failed row alone is not evidence that it should play again.
export async function recoverVisiblePvdJobs(pg, sid, readPage) {
  const first = await readPage(0);
  if (!Array.isArray(first?.waitingItems) || !Number.isSafeInteger(first.waitingCount) || first.waitingCount < 0) {
    throw new Error('Invalid queue snapshot');
  }
  const head = first.currentItem;
  const ids = new Set();
  if (head?.id && !head.idle) ids.add(head.id);
  let page = first, offset = 0;
  for (;;) {
    for (const item of page.waitingItems) if (item?.id && !item.idle) ids.add(item.id);
    offset += page.waitingItems.length;
    if (!page.waitingItems.length || offset >= first.waitingCount || offset >= 10000) break;
    page = await readPage(offset);
    if (page.offset !== offset || page.currentItem?.id !== head?.id || !Array.isArray(page.waitingItems)) {
      throw new Error('Queue changed during snapshot');
    }
  }
  if (!ids.size) return [];
  const finished = first.status === 'playing' && head?.kind === 'video' && !head.idle && !head.durationPending
    && head.durationSec > 0 && first.elapsedSec > head.durationSec + 30 ? head.id : null;
  const { rows } = await pg.query(`
    with visible as (
      select id, ord from unnest($2::text[]) with ordinality as items(id,ord)
    ), base as (
      select min(j.available_at) as at from durable_runtime_jobs j join visible using(id) where j.sid=$1
    )
    update durable_runtime_jobs j
      set status=case when j.id=$3 then 'completed' else 'queued' end,
          result=case when j.id=$3 then '{"status":"auto_timer","refunded":false,"leaseRecovered":true}'::jsonb else null end,
          completed_at=case when j.id=$3 then now() else null end,
          available_at=least(base.at,now()-interval '1 minute')+visible.ord*interval '1 microsecond',
          attempt_count=0, last_error=null, updated_at=now()
      from visible, base where j.id=visible.id and j.sid=$1 and j.job_type='video-donation'
        and j.status='failed' and j.last_error='max_attempts_exhausted' and j.attempt_count>=j.max_attempts
        and j.locked_by is null and j.result is null
      returning j.id,j.status`, [sid, [...ids], finished]);
  return rows;
}
