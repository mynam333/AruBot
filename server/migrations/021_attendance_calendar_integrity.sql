-- Canonicalize attendance identity keys without rewriting historical dates.

create table if not exists public.attendance_integrity_archive (
  id bigint generated always as identity primary key,
  source_table text not null,
  sid text,
  user_id text,
  attendance_date text,
  row_data jsonb not null,
  reason text not null,
  archived_at timestamptz not null default now()
);

create index if not exists idx_attendance_integrity_archive_identity
  on public.attendance_integrity_archive (source_table, sid, user_id, attendance_date);

revoke all on table public.attendance_integrity_archive from public;
do $$
declare
  archive_sequence text;
begin
  archive_sequence := pg_get_serial_sequence('public.attendance_integrity_archive', 'id');
  if archive_sequence is not null then
    execute format('revoke all on sequence %s from public', archive_sequence);
  end if;
end $$;

alter table public.attendance add column if not exists user_id text;
alter table public.attendance add column if not exists created_at timestamptz;
alter table public.attendance alter column created_at set default now();

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'attendance'
       and column_name = 'userid'
  ) then
    update public.attendance
       set user_id = coalesce(user_id, userid)
     where user_id is null;
  end if;
end $$;

with ranked_attendance as (
  select ctid,
         row_number() over (
           partition by sid, user_id, date
           order by created_at desc nulls last, username desc nulls last, ctid desc
         ) as row_number
    from public.attendance
   where user_id is not null
)
insert into public.attendance_integrity_archive (
  source_table,
  sid,
  user_id,
  attendance_date,
  row_data,
  reason
)
select 'attendance',
       target.sid,
       target.user_id,
       target.date,
       to_jsonb(target),
       'duplicate canonical attendance key archived by migration 021'
  from public.attendance target
  join ranked_attendance duplicate on duplicate.ctid = target.ctid
 where duplicate.row_number > 1;

with ranked_attendance as (
  select ctid,
         row_number() over (
           partition by sid, user_id, date
           order by created_at desc nulls last, username desc nulls last, ctid desc
         ) as row_number
    from public.attendance
   where user_id is not null
)
delete from public.attendance target
 using ranked_attendance duplicate
 where target.ctid = duplicate.ctid
   and duplicate.row_number > 1;

create unique index if not exists attendance_sid_user_id_date_idx
  on public.attendance (sid, user_id, date);

do $$
declare
  primary_key record;
  key_columns text[];
begin
  for primary_key in
    select constraint_row.oid, constraint_row.conname, constraint_row.conkey
      from pg_constraint constraint_row
     where constraint_row.conrelid = 'public.attendance'::regclass
       and constraint_row.contype = 'p'
  loop
    select array_agg(attribute_row.attname::text order by key_row.ordinality)
      into key_columns
      from unnest(primary_key.conkey) with ordinality as key_row(attnum, ordinality)
      join pg_attribute attribute_row
        on attribute_row.attrelid = 'public.attendance'::regclass
       and attribute_row.attnum = key_row.attnum;

    if key_columns is distinct from array['sid', 'user_id', 'date']::text[] then
      execute format('alter table public.attendance drop constraint %I', primary_key.conname);
    end if;
  end loop;
end $$;

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'attendance'
       and column_name = 'userid'
  ) then
    alter table public.attendance alter column userid drop not null;
  end if;
end $$;

alter table public.attendance_state add column if not exists user_id text;
alter table public.attendance_state add column if not exists last_date text;
alter table public.attendance_state add column if not exists total_days integer default 0;
alter table public.attendance_state add column if not exists updated_at timestamptz;
alter table public.attendance_state alter column updated_at set default now();

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'attendance_state'
       and column_name = 'userid'
  ) then
    update public.attendance_state
       set user_id = coalesce(user_id, userid)
     where user_id is null;
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'attendance_state'
       and column_name = 'lastdate'
  ) then
    update public.attendance_state
       set last_date = coalesce(last_date, lastdate)
     where last_date is null;
  end if;
end $$;

with ranked_state as (
  select ctid,
         row_number() over (
           partition by sid, user_id
           order by last_date desc nulls last,
                    total_days desc nulls last,
                    streak desc nulls last,
                    ctid desc
         ) as row_number
    from public.attendance_state
   where user_id is not null
)
insert into public.attendance_integrity_archive (
  source_table,
  sid,
  user_id,
  attendance_date,
  row_data,
  reason
)
select 'attendance_state',
       target.sid,
       target.user_id,
       target.last_date,
       to_jsonb(target),
       'duplicate canonical attendance state key archived by migration 021'
  from public.attendance_state target
  join ranked_state duplicate on duplicate.ctid = target.ctid
 where duplicate.row_number > 1;

with ranked_state as (
  select ctid,
         row_number() over (
           partition by sid, user_id
           order by last_date desc nulls last,
                    total_days desc nulls last,
                    streak desc nulls last,
                    ctid desc
         ) as row_number
    from public.attendance_state
   where user_id is not null
)
delete from public.attendance_state target
 using ranked_state duplicate
 where target.ctid = duplicate.ctid
   and duplicate.row_number > 1;

update public.attendance_state state
   set total_days = totals.total_days,
       updated_at = now()
  from (
    select sid, user_id, count(distinct date)::integer as total_days
      from public.attendance
     where user_id is not null
     group by sid, user_id
  ) totals
 where state.sid = totals.sid
   and state.user_id = totals.user_id
   and state.total_days is distinct from totals.total_days;

create unique index if not exists attendance_state_sid_user_id_uniq
  on public.attendance_state (sid, user_id);

do $$
declare
  primary_key record;
  key_columns text[];
begin
  for primary_key in
    select constraint_row.oid, constraint_row.conname, constraint_row.conkey
      from pg_constraint constraint_row
     where constraint_row.conrelid = 'public.attendance_state'::regclass
       and constraint_row.contype = 'p'
  loop
    select array_agg(attribute_row.attname::text order by key_row.ordinality)
      into key_columns
      from unnest(primary_key.conkey) with ordinality as key_row(attnum, ordinality)
      join pg_attribute attribute_row
        on attribute_row.attrelid = 'public.attendance_state'::regclass
       and attribute_row.attnum = key_row.attnum;

    if key_columns is distinct from array['sid', 'user_id']::text[] then
      execute format('alter table public.attendance_state drop constraint %I', primary_key.conname);
    end if;
  end loop;
end $$;

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'attendance_state'
       and column_name = 'userid'
  ) then
    alter table public.attendance_state alter column userid drop not null;
  end if;
end $$;

create index if not exists idx_attendance_sid_user_date_desc
  on public.attendance (sid, user_id, date desc);

create index if not exists idx_live_days_sid_date_desc
  on public.live_days (sid, date desc);

-- Rows from the oldest username-only schema cannot be assigned to a stable
-- viewer ID without operator confirmation. Keep them queryable and provide a
-- narrowly scoped recovery function instead of guessing or dropping history.
create or replace view public.attendance_legacy_identity_review as
select sid,
       username,
       count(*)::integer as attendance_days,
       min(date) as first_date,
       max(date) as last_date
  from public.attendance
 where user_id is null
 group by sid, username;

revoke all on table public.attendance_legacy_identity_review from public;

do $$
declare
  unresolved_count bigint;
begin
  select count(*) into unresolved_count
    from public.attendance
   where user_id is null;
  if unresolved_count > 0 then
    raise warning '[Attendance] % username-only row(s) require operator review in attendance_legacy_identity_review', unresolved_count;
  end if;
end $$;

create or replace function public.resolve_attendance_legacy_identity(
  target_sid text,
  target_date text,
  target_username text,
  target_user_id text
)
returns table (resolution_status text, affected_rows integer, archive_id bigint)
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  matched_count integer := 0;
  archived_count integer := 0;
  latest_archive_id bigint := null;
  keep_row tid := null;
  canonical_exists boolean := false;
  canonical_total integer := 0;
  canonical_last_date text := null;
  canonical_streak integer := 0;
begin
  target_sid := nullif(btrim(target_sid), '');
  target_date := nullif(btrim(target_date), '');
  target_username := nullif(btrim(target_username), '');
  target_user_id := nullif(btrim(target_user_id), '');
  if target_sid is null or target_date is null or target_username is null or target_user_id is null then
    raise exception 'sid, date, username, and user_id are required';
  end if;
  if target_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'date must use YYYY-MM-DD format';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'attendance:' || target_sid || ':' || target_user_id,
    0
  ));

  perform 1
    from public.attendance legacy
   where legacy.sid = target_sid
     and legacy.date = target_date
     and legacy.user_id is null
     and legacy.username = target_username
     for update;
  get diagnostics matched_count = row_count;

  if matched_count = 0 then
    return query select 'not_found'::text, 0, null::bigint;
    return;
  end if;

  select exists (
    select 1
      from public.attendance canonical
     where canonical.sid = target_sid
       and canonical.date = target_date
       and canonical.user_id = target_user_id
  ) into canonical_exists;

  with archived as (
    insert into public.attendance_integrity_archive (
      source_table,
      sid,
      user_id,
      attendance_date,
      row_data,
      reason
    )
    select 'attendance',
           legacy.sid,
           target_user_id,
           legacy.date,
           to_jsonb(legacy),
           'manual username-only identity resolution approved by ' || current_user
      from public.attendance legacy
     where legacy.sid = target_sid
       and legacy.date = target_date
       and legacy.user_id is null
       and legacy.username = target_username
    returning id
  )
  select count(*)::integer, max(id)
    into archived_count, latest_archive_id
    from archived;

  if canonical_exists then
    delete from public.attendance legacy
     where legacy.sid = target_sid
       and legacy.date = target_date
       and legacy.user_id is null
       and legacy.username = target_username;
  else
    select legacy.ctid
      into keep_row
      from public.attendance legacy
     where legacy.sid = target_sid
       and legacy.date = target_date
       and legacy.user_id is null
       and legacy.username = target_username
     order by legacy.created_at desc nulls last, legacy.ctid desc
     limit 1;

    delete from public.attendance legacy
     where legacy.sid = target_sid
       and legacy.date = target_date
       and legacy.user_id is null
       and legacy.username = target_username
       and legacy.ctid <> keep_row;

    update public.attendance
       set user_id = target_user_id
     where ctid = keep_row;
  end if;

  with ordered_days as (
    select live_day.date,
           exists (
             select 1
               from public.attendance attended
              where attended.sid = live_day.sid
                and attended.user_id = target_user_id
                and attended.date = live_day.date
           ) as attended
      from public.live_days live_day
     where live_day.sid = target_sid
  ), marked_days as (
    select date,
           attended,
           sum(case when attended then 0 else 1 end) over (
             order by date desc
             rows between unbounded preceding and current row
           ) as missed_days
      from ordered_days
  ), totals as (
    select count(distinct date)::integer as total_days,
           max(date) as last_date
      from public.attendance
     where sid = target_sid
       and user_id = target_user_id
  )
  select coalesce(totals.total_days, 0),
         totals.last_date,
         coalesce((
           select count(*)::integer
             from marked_days
            where attended = true
              and missed_days = 0
         ), 0)
    into canonical_total, canonical_last_date, canonical_streak
    from totals;

  insert into public.attendance_state (
    sid,
    user_id,
    last_date,
    streak,
    total_days,
    updated_at
  ) values (
    target_sid,
    target_user_id,
    canonical_last_date,
    canonical_streak,
    canonical_total,
    now()
  )
  on conflict (sid, user_id) do update
    set last_date = greatest(public.attendance_state.last_date, excluded.last_date),
        streak = excluded.streak,
        total_days = excluded.total_days,
        updated_at = now();

  return query select
    case when canonical_exists then 'deduplicated'::text else 'updated'::text end,
    archived_count,
    latest_archive_id;
end $$;

revoke all on function public.resolve_attendance_legacy_identity(text, text, text, text) from public;
