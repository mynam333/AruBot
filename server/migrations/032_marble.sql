create table if not exists marble_rooms (
  owner_user_id text primary key references app_users(id) on delete cascade,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  revision bigint not null default 0 check (revision >= 0),
  overlay_token text not null unique,
  updated_at timestamptz not null default clock_timestamp()
);
create table if not exists marble_requests (
  owner_user_id text not null references marble_rooms(owner_user_id) on delete cascade,
  request_id text not null,
  fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (owner_user_id, request_id)
);
create table if not exists marble_invites (
  id uuid primary key,
  owner_user_id text not null references marble_rooms(owner_user_id) on delete cascade,
  member_user_id text not null references app_users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','revoked')),
  expires_at timestamptz not null default (clock_timestamp() + interval '7 days'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (owner_user_id <> member_user_id)
);
create unique index if not exists marble_invites_active_member
  on marble_invites(owner_user_id, member_user_id) where status in ('pending','accepted');
create index if not exists marble_invites_member on marble_invites(member_user_id, created_at desc);
create index if not exists marble_invites_owner on marble_invites(owner_user_id, created_at desc);
alter table marble_rooms enable row level security;
alter table marble_requests enable row level security;
alter table marble_invites enable row level security;
revoke all on table marble_rooms, marble_requests, marble_invites from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on table marble_rooms, marble_requests, marble_invites from anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    revoke all on table marble_rooms, marble_requests, marble_invites from authenticated;
  end if;
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant select, insert, update, delete on table marble_rooms, marble_requests, marble_invites to service_role;
  end if;
end $$;
