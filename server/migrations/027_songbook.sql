create table if not exists songbook_settings (
  owner_user_id text primary key references app_users(id) on delete cascade,
  requests_enabled boolean not null default false,
  per_user_limit integer not null default 1 check (per_user_limit between 1 and 10)
);
create table if not exists songbook_songs (
  id uuid primary key,
  owner_user_id text not null references app_users(id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists songbook_songs_owner on songbook_songs(owner_user_id, created_at desc);
create table if not exists songbook_requests (
  id uuid primary key,
  owner_user_id text not null references app_users(id) on delete cascade,
  viewer_user_id text not null references app_users(id) on delete cascade,
  song_id uuid references songbook_songs(id) on delete set null,
  request_key uuid not null,
  song jsonb not null,
  username text not null,
  message text not null default '',
  status text not null default 'pending' check (status in ('pending', 'singing', 'done', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_user_id, viewer_user_id, request_key)
);
create unique index if not exists songbook_requests_active_duplicate on songbook_requests(owner_user_id, viewer_user_id, song_id) where status in ('pending', 'singing');
create unique index if not exists songbook_requests_one_singing on songbook_requests(owner_user_id) where status = 'singing';
create index if not exists songbook_requests_owner_status on songbook_requests(owner_user_id, status, created_at);
create index if not exists songbook_requests_viewer on songbook_requests(owner_user_id, viewer_user_id, created_at desc);
alter table songbook_settings enable row level security;
alter table songbook_songs enable row level security;
alter table songbook_requests enable row level security;
revoke all on table songbook_settings, songbook_songs, songbook_requests from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table songbook_settings, songbook_songs, songbook_requests from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table songbook_settings, songbook_songs, songbook_requests from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table songbook_settings, songbook_songs, songbook_requests to service_role;
  end if;
end $$;
