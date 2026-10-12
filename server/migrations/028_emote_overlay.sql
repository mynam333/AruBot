create table if not exists emote_overlay_settings (
  owner_user_id text primary key references app_users(id) on delete cascade,
  config jsonb not null default '{}',
  revision integer not null default 1,
  epoch bigint not null default 0,
  viewer_token text not null unique,
  updated_at timestamptz not null default now()
);
create table if not exists emote_overlay_events (
  id bigserial primary key,
  owner_user_id text not null references emote_overlay_settings(owner_user_id) on delete cascade,
  event_key text not null,
  actor_key text not null,
  epoch bigint not null,
  count smallint not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique(owner_user_id, event_key)
);
create index if not exists emote_overlay_events_owner_time on emote_overlay_events(owner_user_id, created_at desc);
create index if not exists emote_overlay_events_expiry on emote_overlay_events(created_at);
alter table emote_overlay_settings enable row level security;
alter table emote_overlay_events enable row level security;
revoke all on emote_overlay_settings, emote_overlay_events from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on emote_overlay_settings, emote_overlay_events from anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    revoke all on emote_overlay_settings, emote_overlay_events from authenticated;
  end if;
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant select, insert, update, delete on emote_overlay_settings, emote_overlay_events to service_role;
    grant usage, select on sequence emote_overlay_events_id_seq to service_role;
  end if;
end $$;
