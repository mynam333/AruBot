-- Copy both tables together when migrating backends. Receipts must survive round
-- resets/cutovers or replayed provider events could charge/add entries twice.
-- JSON contains private refund identities; expose only the server's public DTO.
create table if not exists public.participation_wheels (
  sid text primary key check (char_length(sid) between 1 and 512),
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint participation_wheels_state_ck check (
    jsonb_typeof(state) = 'object'
    and state @> '{"schemaVersion":1}'::jsonb
    and state ?& array['roundId', 'revision', 'collecting', 'settings', 'entries', 'totalSlots', 'latestSpin', 'history', 'chatUsage']
    and jsonb_typeof(state->'roundId') = 'string'
    and jsonb_typeof(state->'collecting') = 'boolean'
    and jsonb_typeof(state->'settings') = 'object'
    and jsonb_typeof(state->'entries') = 'array'
    and jsonb_typeof(state->'totalSlots') = 'number'
    and jsonb_typeof(state->'revision') = 'number'
    and jsonb_typeof(state->'chatUsage') = 'object'
    and jsonb_typeof(state->'history') = 'array'
    and jsonb_typeof(state->'latestSpin') in ('object', 'null')
    and jsonb_array_length(state->'entries') <= 200
    and jsonb_array_length(state->'history') <= 50
    and (state->>'totalSlots')::integer between 0 and 1000
    and (state->>'revision')::bigint >= 0
  )
);

create table if not exists public.participation_wheel_requests (
  sid text not null references public.participation_wheels(sid) on delete cascade,
  request_id text not null check (char_length(request_id) between 1 and 520),
  operation text not null check (operation in ('settings', 'action', 'entry')),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  outcome jsonb not null check (jsonb_typeof(outcome) = 'object'),
  created_at timestamptz not null default now(),
  primary key (sid, request_id)
);

alter table public.participation_wheels enable row level security;
alter table public.participation_wheel_requests enable row level security;
revoke all on table public.participation_wheels, public.participation_wheel_requests from public;

-- Supabase roles are optional on self-hosted Postgres. The trusted direct DB
-- owner/BYPASSRLS connection is the only access path; no client policies exist.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.participation_wheels, public.participation_wheel_requests from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.participation_wheels, public.participation_wheel_requests from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.participation_wheels, public.participation_wheel_requests to service_role;
  end if;
end $$;
