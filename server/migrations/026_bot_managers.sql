-- Only trusted server connections may manage delegations or read their audit log.
create table if not exists bot_managers (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null references app_users(id) on delete cascade,
  member_user_id text not null references app_users(id) on delete cascade,
  scopes jsonb not null default '["*"]'::jsonb,
  created_by text references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bot_managers_owner_member_key unique (owner_user_id, member_user_id),
  constraint bot_managers_not_self check (owner_user_id <> member_user_id),
  constraint bot_managers_scopes_check check (
    case when jsonb_typeof(scopes) = 'array' then
      jsonb_array_length(scopes) between 1 and 128
      and not jsonb_path_exists(scopes, '$[*] ? (@.type() != "string")')
      and (not (scopes ? '*') or scopes = '["*"]'::jsonb)
    else false end
  )
);

create index if not exists idx_bot_managers_member_owner
  on bot_managers(member_user_id, owner_user_id);

create table if not exists bot_management_audit (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text not null references app_users(id) on delete cascade,
  actor_user_id text references app_users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 100),
  -- The grant ID remains a historical reference after the grant is removed.
  member_id uuid,
  member_user_id text references app_users(id) on delete set null,
  previous_scopes jsonb check (previous_scopes is null or jsonb_typeof(previous_scopes) = 'array'),
  scopes jsonb check (scopes is null or jsonb_typeof(scopes) = 'array'),
  method text check (method is null or method in ('GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS')),
  path text check (path is null or (char_length(path) between 1 and 512 and path like '/%' and path !~ '[?#]')),
  status integer check (status is null or status between 100 and 599),
  created_at timestamptz not null default now()
);

create index if not exists idx_bot_management_audit_owner_created
  on bot_management_audit(owner_user_id, created_at desc, id desc);

alter table bot_managers enable row level security;
alter table bot_management_audit enable row level security;
revoke all on table bot_managers, bot_management_audit from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table bot_managers, bot_management_audit from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table bot_managers, bot_management_audit from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table bot_managers, bot_management_audit to service_role;
  end if;
end $$;
