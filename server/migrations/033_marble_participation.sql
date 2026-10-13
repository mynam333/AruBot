create table if not exists marble_participation (
  source_user_id text primary key references app_users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  settings jsonb not null check (jsonb_typeof(settings) = 'object'),
  -- Keep a stale destination after deletion; only explicit disconnect restores
  -- local routing. A cascading or SET NULL foreign key would enable paid rolls.
  connected_owner_user_id text,
  updated_at timestamptz not null default clock_timestamp(),
  check (connected_owner_user_id is null or connected_owner_user_id <> source_user_id)
);
create table if not exists marble_source_requests (
  owner_user_id text not null references app_users(id) on delete cascade,
  request_id text not null,
  fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (owner_user_id, request_id)
);
insert into marble_source_requests(owner_user_id,request_id,fingerprint,result,created_at)
  select owner_user_id,request_id,fingerprint,result,created_at from marble_requests
  where request_id like 'event:%' on conflict(owner_user_id,request_id) do nothing;
alter table marble_participation enable row level security;
alter table marble_source_requests enable row level security;
revoke all on table marble_participation, marble_source_requests from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on table marble_participation, marble_source_requests from anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    revoke all on table marble_participation, marble_source_requests from authenticated;
  end if;
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant select, insert, update, delete on table marble_participation, marble_source_requests to service_role;
  end if;
end $$;
