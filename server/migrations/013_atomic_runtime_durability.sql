-- Atomic point spending, command cooldown claims, and durable paid runtime jobs.

do $$
declare
  target record;
  constraint_name text;
begin
  for target in
    select table_schema, table_name
      from information_schema.tables
     where table_schema = 'public'
       and table_type = 'BASE TABLE'
       and (table_name like 'channelpoint\_%' escape '\' or table_name = 'channel_points_balances')
  loop
    execute format('update %I.%I set points = 0 where points is null or points < 0', target.table_schema, target.table_name);
    execute format('alter table %I.%I alter column points set default 0', target.table_schema, target.table_name);
    execute format('alter table %I.%I alter column points set not null', target.table_schema, target.table_name);

    if not exists (
      select 1
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        join pg_namespace n on n.oid = t.relnamespace
       where n.nspname = target.table_schema
         and t.relname = target.table_name
         and c.contype = 'c'
         and pg_get_constraintdef(c.oid) ~* 'CHECK\s*\(\(?points\s*>=\s*0\)?\)'
    ) then
      constraint_name := substr(target.table_name, 1, 40) || '_points_nonnegative_ck';
      execute format(
        'alter table %I.%I add constraint %I check (points >= 0)',
        target.table_schema,
        target.table_name,
        constraint_name
      );
    end if;
  end loop;
end $$;

create table if not exists public.durable_runtime_jobs (
  id text primary key,
  sid text not null,
  job_type text not null,
  idempotency_key text not null,
  status text not null default 'queued',
  channel_uid text,
  user_id text,
  username text,
  points_cost bigint not null default 0,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint durable_runtime_jobs_status_ck
    check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  constraint durable_runtime_jobs_points_cost_ck check (points_cost >= 0),
  constraint durable_runtime_jobs_attempts_ck check (attempt_count >= 0 and max_attempts > 0),
  constraint durable_runtime_jobs_job_type_ck check (job_type ~ '^[a-z0-9][a-z0-9._:-]{0,63}$'),
  constraint durable_runtime_jobs_idempotency_uniq unique (sid, job_type, idempotency_key)
);

create index if not exists idx_durable_runtime_jobs_claim
  on public.durable_runtime_jobs (status, available_at, created_at)
  where status in ('queued', 'processing');

create index if not exists idx_durable_runtime_jobs_sid_created
  on public.durable_runtime_jobs (sid, created_at desc);

create or replace function public.arubot_channel_point_table_name(p_streamer_uid text)
returns text
language plpgsql
immutable
strict
as $$
declare
  suffix text;
begin
  suffix := regexp_replace(p_streamer_uid, '[^a-zA-Z0-9_]', '_', 'g');
  if suffix = '' then
    suffix := 'unknown';
  end if;
  if suffix !~ '^[A-Za-z_]' then
    suffix := 'u_' || suffix;
  end if;
  return 'channelpoint_' || suffix;
end;
$$;

create or replace function public.arubot_deduct_channel_points_if_enough(
  p_streamer_uid text,
  p_user_id text,
  p_username text,
  p_amount bigint
)
returns table (
  deducted boolean,
  sufficient boolean,
  amount bigint,
  balance_before bigint,
  balance_after bigint,
  canonical_channel_uid text,
  canonical_user_id text
)
language plpgsql
as $$
declare
  table_name text;
  current_balance bigint := 0;
  next_balance bigint := 0;
begin
  if nullif(trim(p_streamer_uid), '') is null or nullif(trim(p_user_id), '') is null then
    raise exception 'streamer uid and user id are required' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'point deduction amount must be positive' using errcode = '22023';
  end if;

  table_name := public.arubot_channel_point_table_name(trim(p_streamer_uid));
  perform pg_advisory_xact_lock(hashtextextended(trim(p_streamer_uid) || ':' || trim(p_user_id), 0));
  execute format(
    'create table if not exists %I (
       user_id text primary key,
       username text,
       points integer not null default 0 check (points >= 0)
     )',
    table_name
  );
  execute format('select coalesce(points, 0)::bigint from %I where user_id = $1 for update', table_name)
    into current_balance
    using trim(p_user_id);
  current_balance := coalesce(current_balance, 0);

  if current_balance < p_amount then
    return query select false, false, p_amount, current_balance, current_balance, trim(p_streamer_uid), trim(p_user_id);
    return;
  end if;

  next_balance := current_balance - p_amount;
  execute format(
    'update %I
        set points = $2,
            username = coalesce($3, username)
      where user_id = $1',
    table_name
  ) using trim(p_user_id), next_balance, nullif(trim(p_username), '');

  return query select true, true, p_amount, current_balance, next_balance, trim(p_streamer_uid), trim(p_user_id);
end;
$$;

create or replace function public.arubot_claim_bot_rule_cooldown(
  p_sid text,
  p_rule_id text,
  p_now_ms bigint default null,
  p_cooldown_ms bigint default null
)
returns table (
  sid text,
  rule_id text,
  found boolean,
  claimed boolean,
  claimed_at bigint,
  last_used bigint,
  cooldown_ms bigint
)
language sql
as $$
  with input as (
    select coalesce(p_now_ms, floor(extract(epoch from clock_timestamp()) * 1000)::bigint) as claim_time
  ),
  claimed_rule as (
    update public.bot_rules as rule
       set last_used = input.claim_time
      from input
     where rule.sid = p_sid
       and rule.id = p_rule_id
       and input.claim_time - coalesce(rule.last_used, 0) >= greatest(0, coalesce(p_cooldown_ms, rule.cooldown::bigint, 0))
    returning rule.sid, rule.id, input.claim_time, rule.last_used,
              greatest(0, coalesce(p_cooldown_ms, rule.cooldown::bigint, 0)) as effective_cooldown
  ),
  current_rule as (
    select rule.sid, rule.id, input.claim_time, coalesce(rule.last_used, 0)::bigint as current_last_used,
           greatest(0, coalesce(p_cooldown_ms, rule.cooldown::bigint, 0)) as effective_cooldown
      from public.bot_rules as rule
      cross join input
     where rule.sid = p_sid and rule.id = p_rule_id
       and not exists (select 1 from claimed_rule)
  )
  select claimed_rule.sid, claimed_rule.id, true, true, claimed_rule.claim_time,
         claimed_rule.last_used, claimed_rule.effective_cooldown
    from claimed_rule
  union all
  select current_rule.sid, current_rule.id, true, false, current_rule.claim_time,
         current_rule.current_last_used, current_rule.effective_cooldown
    from current_rule
  union all
  select p_sid, p_rule_id, false, false, input.claim_time, 0::bigint,
         greatest(0, coalesce(p_cooldown_ms, 0))
    from input
   where not exists (select 1 from claimed_rule)
     and not exists (select 1 from current_rule);
$$;

create or replace function public.arubot_enqueue_paid_durable_runtime_job(
  p_id text,
  p_sid text,
  p_job_type text,
  p_idempotency_key text,
  p_channel_uid text,
  p_user_id text,
  p_username text,
  p_points_cost bigint,
  p_payload jsonb default '{}'::jsonb,
  p_max_attempts integer default 5,
  p_available_at timestamptz default now()
)
returns table (
  job jsonb,
  created boolean,
  deducted boolean,
  sufficient boolean,
  amount bigint,
  balance_before bigint,
  balance_after bigint,
  canonical_channel_uid text,
  canonical_user_id text
)
language plpgsql
as $$
declare
  existing_job jsonb;
  inserted_job jsonb;
  deduction_succeeded boolean;
  deduction_sufficient boolean;
  deduction_amount bigint;
  deduction_before bigint;
  deduction_after bigint;
  deduction_channel_uid text;
  deduction_user_id text;
  normalized_id text := coalesce(nullif(trim(p_id), ''), md5(random()::text || clock_timestamp()::text));
begin
  if nullif(trim(p_sid), '') is null
     or nullif(trim(p_job_type), '') is null
     or p_job_type !~ '^[a-z0-9][a-z0-9._:-]{0,63}$'
     or nullif(trim(p_idempotency_key), '') is null then
    raise exception 'invalid durable runtime job identity' using errcode = '22023';
  end if;
  if p_points_cost is null or p_points_cost < 0 then
    raise exception 'points cost must be non-negative' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'durable-job:' || trim(p_sid) || ':' || p_job_type || ':' || trim(p_idempotency_key),
    0
  ));
  select to_jsonb(runtime_job)
    into existing_job
    from public.durable_runtime_jobs as runtime_job
   where runtime_job.sid = trim(p_sid)
     and runtime_job.job_type = p_job_type
     and runtime_job.idempotency_key = trim(p_idempotency_key)
   limit 1;

  if existing_job is not null then
    return query select existing_job, false, null::boolean, null::boolean, p_points_cost,
                        null::bigint, null::bigint, p_channel_uid, p_user_id;
    return;
  end if;

  if p_points_cost > 0 then
    select result.deducted, result.sufficient, result.amount, result.balance_before,
           result.balance_after, result.canonical_channel_uid, result.canonical_user_id
      into deduction_succeeded, deduction_sufficient, deduction_amount, deduction_before,
           deduction_after, deduction_channel_uid, deduction_user_id
      from public.arubot_deduct_channel_points_if_enough(p_channel_uid, p_user_id, p_username, p_points_cost) as result;
    if deduction_succeeded is not true then
      return query select null::jsonb, false, deduction_succeeded, deduction_sufficient, deduction_amount,
                          deduction_before, deduction_after, deduction_channel_uid, deduction_user_id;
      return;
    end if;
  end if;

  insert into public.durable_runtime_jobs as runtime_job (
    id, sid, job_type, idempotency_key, channel_uid, user_id, username,
    points_cost, payload, max_attempts, available_at
  ) values (
    normalized_id, trim(p_sid), p_job_type, trim(p_idempotency_key), p_channel_uid, p_user_id, p_username,
    p_points_cost, coalesce(p_payload, '{}'::jsonb), greatest(1, least(100, p_max_attempts)), coalesce(p_available_at, now())
  )
  returning to_jsonb(runtime_job) into inserted_job;

  return query select inserted_job, true,
                      case when p_points_cost > 0 then deduction_succeeded else null::boolean end,
                      case when p_points_cost > 0 then deduction_sufficient else null::boolean end,
                      p_points_cost,
                      case when p_points_cost > 0 then deduction_before else null::bigint end,
                      case when p_points_cost > 0 then deduction_after else null::bigint end,
                      case when p_points_cost > 0 then deduction_channel_uid else p_channel_uid end,
                      case when p_points_cost > 0 then deduction_user_id else p_user_id end;
end;
$$;

create or replace function public.arubot_claim_durable_runtime_jobs(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_ms bigint default 60000,
  p_job_types text[] default null
)
returns setof public.durable_runtime_jobs
language sql
as $$
  with exhausted as (
    update public.durable_runtime_jobs as runtime_job
       set status = 'failed',
           last_error = coalesce(runtime_job.last_error, 'max_attempts_exhausted'),
           completed_at = coalesce(runtime_job.completed_at, now()),
           updated_at = now(),
           locked_by = null,
           locked_at = null
     where runtime_job.attempt_count >= runtime_job.max_attempts
       and (
         runtime_job.status = 'queued'
         or (
           runtime_job.status = 'processing'
           and runtime_job.locked_at < now() - (greatest(1000, p_lease_ms) * interval '1 millisecond')
         )
       )
    returning runtime_job.id
  ),
  candidates as (
    select runtime_job.id
      from public.durable_runtime_jobs as runtime_job
     where runtime_job.attempt_count < runtime_job.max_attempts
       and nullif(trim(p_worker_id), '') is not null
       and (p_job_types is null or runtime_job.job_type = any(p_job_types))
       and (
         (runtime_job.status = 'queued' and runtime_job.available_at <= now())
         or (
           runtime_job.status = 'processing'
           and runtime_job.locked_at < now() - (greatest(1000, p_lease_ms) * interval '1 millisecond')
         )
       )
     order by runtime_job.available_at asc, runtime_job.created_at asc
     for update skip locked
     limit greatest(1, least(100, p_limit))
  )
  update public.durable_runtime_jobs as runtime_job
     set status = 'processing',
         locked_by = p_worker_id,
         locked_at = now(),
         attempt_count = runtime_job.attempt_count + 1,
         updated_at = now()
    from candidates
   where runtime_job.id = candidates.id
  returning runtime_job.*;
$$;

create or replace function public.arubot_fail_durable_runtime_job(
  p_job_id text,
  p_worker_id text,
  p_error text,
  p_retry_at timestamptz,
  p_terminal boolean default false
)
returns setof public.durable_runtime_jobs
language sql
as $$
  update public.durable_runtime_jobs as runtime_job
     set status = case when p_terminal or runtime_job.attempt_count >= runtime_job.max_attempts then 'failed' else 'queued' end,
         available_at = case
           when p_terminal or runtime_job.attempt_count >= runtime_job.max_attempts then runtime_job.available_at
           else coalesce(p_retry_at, now() + interval '5 seconds')
         end,
         last_error = left(coalesce(p_error, 'durable_runtime_job_failed'), 2000),
         completed_at = case
           when p_terminal or runtime_job.attempt_count >= runtime_job.max_attempts then coalesce(runtime_job.completed_at, now())
           else null
         end,
         updated_at = now(),
         locked_by = null,
         locked_at = null
   where runtime_job.id = p_job_id
     and runtime_job.status = 'processing'
     and runtime_job.locked_by = p_worker_id
  returning runtime_job.*;
$$;
