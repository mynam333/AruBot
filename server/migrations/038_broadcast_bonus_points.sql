begin;

-- A fresh installation may run migrations before the legacy runtime bootstrap.
create table if not exists live_sessions (
  sid text primary key, live boolean not null default false, start_date text,
  session_start_time bigint, last_update bigint not null, created_at timestamptz default now()
);
alter table live_sessions
  add column if not exists bonus_session_key uuid not null default gen_random_uuid(),
  add column if not exists bonus_amount integer not null default 0 check (bonus_amount between 0 and 1000000000),
  add column if not exists bonus_categories text[] not null default '{}';

create table if not exists broadcast_bonus_usage (
  sid text not null references live_sessions(sid) on delete cascade,
  user_id text not null, spent bigint not null check (spent >= 0),
  primary key (sid, user_id)
);
alter table broadcast_bonus_usage enable row level security;

create or replace function arubot_reset_broadcast_bonus() returns trigger
language plpgsql as $$
begin
  delete from broadcast_bonus_usage where sid = old.sid;
  new.bonus_session_key := gen_random_uuid();
  new.bonus_amount := 0;
  new.bonus_categories := '{}';
  return new;
end;
$$;
drop trigger if exists reset_broadcast_bonus on live_sessions;
create trigger reset_broadcast_bonus before update of live, session_start_time on live_sessions
  for each row when (old.live is distinct from new.live or old.session_start_time is distinct from new.session_start_time)
  execute function arubot_reset_broadcast_bonus();
commit;
