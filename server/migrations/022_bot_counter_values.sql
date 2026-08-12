-- Persistent command counters shared by every supported chat platform.
-- A single table keeps counter names bounded and makes increments atomic.

create table if not exists public.bot_counter_values (
  sid text not null,
  counter_name text not null,
  counter_scope text not null,
  subject_key text not null default '',
  value bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (sid, counter_name, counter_scope, subject_key)
);

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.bot_counter_values'::regclass
       and conname = 'bot_counter_values_name_ck'
  ) then
    alter table public.bot_counter_values
      add constraint bot_counter_values_name_ck
      check (
        counter_name = btrim(counter_name)
        and char_length(counter_name) between 1 and 64
      );
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.bot_counter_values'::regclass
       and conname = 'bot_counter_values_scope_ck'
  ) then
    alter table public.bot_counter_values
      add constraint bot_counter_values_scope_ck
      check (counter_scope in ('user', 'global'));
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.bot_counter_values'::regclass
       and conname = 'bot_counter_values_subject_ck'
  ) then
    alter table public.bot_counter_values
      add constraint bot_counter_values_subject_ck
      check (
        (counter_scope = 'global' and subject_key = '')
        or (
          counter_scope = 'user'
          and subject_key <> ''
          and char_length(subject_key) <= 512
        )
      );
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.bot_counter_values'::regclass
       and conname = 'bot_counter_values_nonnegative_ck'
  ) then
    alter table public.bot_counter_values
      add constraint bot_counter_values_nonnegative_ck
      check (value >= 0);
  end if;
end $$;

create index if not exists idx_bot_counter_values_user_subject
  on public.bot_counter_values (subject_key, sid)
  where counter_scope = 'user';

revoke all on table public.bot_counter_values from public;
