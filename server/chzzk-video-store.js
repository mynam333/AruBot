export function createChzzkVideoStore({ withPgClient }) {
  return {
    listConfigured() {
      return withPgClient(async (pg) => {
        const { rows } = await pg.query(`select sid, settings from bot_settings
          where settings->>'videoDonationChzzkOverlaySecret' <> ''
            and (settings->>'videoDonationChzzkPauseEnabled' = 'true'
              or settings->>'videoDonationChzzkQueueEnabled' = 'true')`);
        return rows || [];
      });
    },
    cancel(sid, donationId) {
      return withPgClient(async (pg) => {
        const { rows } = await pg.query(`update durable_runtime_jobs
          set status = 'completed', result = '{"status":"chzzk_skipped"}'::jsonb,
              completed_at = now(), updated_at = now(), locked_by = null, locked_at = null
          where sid = $1 and job_type = 'video-donation' and status in ('queued', 'processing')
            and payload->'item'->>'source' = 'chzzk-donation'
            and payload->'item'->>'chzzkDonationId' = $2 returning id`, [sid, String(donationId)]);
        return (rows || []).map((row) => row.id);
      });
    },
    renew(ids, workerId) {
      if (!ids.length) return Promise.resolve([]);
      return withPgClient(async (pg) => {
        const { rows } = await pg.query(`update durable_runtime_jobs set locked_at = now(), updated_at = now()
          where id = any($1::uuid[]) and locked_by = $2 and status = 'processing'
            and job_type = 'video-donation' and payload->'item'->>'source' = 'chzzk-donation'
          returning id`, [ids, workerId]);
        return (rows || []).map((row) => row.id);
      });
    },
  };
}
