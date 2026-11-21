import { withPgClient } from './db-common.js';
import { recoverVisiblePvdJobs } from '../server/pvd-lease-recovery.js';

// In legacy deployments the old process is the last witness of its in-memory queue.
// Read it over loopback before PM2 replaces it. Never rebuild a queue from history.
const port = Number(process.env.PORT || process.env.SERVER_PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API port');
await withPgClient('current', async pg => {
  const { rows } = await pg.query(`select distinct on (j.sid) j.sid, a.provider,
      coalesce(nullif(a.channel_id,''), a.platform_user_id) as uid
    from durable_runtime_jobs j join platform_accounts a on j.sid='user:'||a.user_id
    where j.job_type='video-donation' and j.status='failed' and j.last_error='max_attempts_exhausted'
      and j.updated_at > now()-interval '1 day' and j.result is null
      and a.provider in ('chzzk','youtube','cime') and coalesce(nullif(a.channel_id,''),a.platform_user_id,'')<>''
    order by j.sid, case a.provider when 'chzzk' then 0 when 'cime' then 1 else 2 end, a.platform_user_id`);
  let completed = 0, restored = 0;
  for (const {sid,provider,uid} of rows) {
    let jobs;
    try {
      jobs = await recoverVisiblePvdJobs(pg,sid,async offset => {
        const path = '/api/public/'+encodeURIComponent(provider+':'+uid)+'/requests?offset='+offset;
        const res = await fetch('http://127.0.0.1:'+port+path, {signal:AbortSignal.timeout(4000),redirect:'error'});
        if (!res.ok) throw new Error('Queue snapshot HTTP '+res.status);
        return res.json();
      });
    } catch (error) {
      console.warn('[pvd:lease-recovery] No changes for unverifiable queue:', error.message);
      continue;
    }
    completed += jobs.filter(job=>job.status==='completed').length;
    restored += jobs.filter(job=>job.status==='queued').length;
  }
  console.log(`[pvd:lease-recovery] checked=${rows.length} elapsed_completed=${completed} waiting_restored=${restored}`);
});
