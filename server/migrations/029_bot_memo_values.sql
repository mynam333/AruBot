create table if not exists public.bot_memo_values (
  sid text not null check (char_length(sid) between 1 and 512),
  memo_key text not null check (char_length(memo_key) between 6 and 133),
  value text not null check (char_length(value) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (sid, memo_key)
);
alter table public.bot_memo_values enable row level security;
revoke all on public.bot_memo_values from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.bot_memo_values from anon;
  end if;
  if exists(select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.bot_memo_values from authenticated;
  end if;
  if exists(select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.bot_memo_values to service_role;
  end if;
end $$;
