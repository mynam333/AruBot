create table if not exists public.automation_settings (
  owner_user_id text primary key,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_connections (
  id text primary key,
  owner_user_id text not null,
  type text not null,
  name text not null,
  enabled boolean not null default true,
  execution_mode text not null default 'oracle_direct'
    check (execution_mode in ('oracle_direct', 'local_program')),
  endpoint text,
  config jsonb not null default '{}'::jsonb,
  capabilities jsonb not null default '{}'::jsonb,
  discovery_cache jsonb not null default '{}'::jsonb,
  discovery_updated_at timestamptz,
  last_status text,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_automation_connections_owner
  on public.automation_connections(owner_user_id, type, enabled);

create table if not exists public.automation_jobs (
  id text primary key,
  owner_user_id text not null,
  connection_id text,
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  priority integer not null default 100,
  run_after timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_automation_jobs_claim
  on public.automation_jobs(status, run_after, priority, created_at)
  where status = 'queued';

create index if not exists idx_automation_jobs_owner_recent
  on public.automation_jobs(owner_user_id, created_at desc);

create table if not exists public.automation_local_agents (
  id text primary key,
  owner_user_id text not null,
  name text not null,
  token_hash text not null unique,
  status text not null default 'offline',
  capabilities jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists idx_automation_local_agents_owner
  on public.automation_local_agents(owner_user_id, revoked_at, last_seen_at desc);
