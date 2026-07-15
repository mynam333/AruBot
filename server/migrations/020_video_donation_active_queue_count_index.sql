create index if not exists idx_durable_runtime_jobs_sid_type_active
  on public.durable_runtime_jobs (sid, job_type)
  where status in ('queued', 'processing');
