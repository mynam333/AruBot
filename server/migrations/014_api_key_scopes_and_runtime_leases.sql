begin;

alter table if exists public.api_keys
  add column if not exists scopes text[] not null default array['user-api','desktop','warudo']::text[],
  add column if not exists expires_at timestamptz,
  add column if not exists device_id text;

update public.api_keys
   set expires_at = coalesce(expires_at, now() + interval '90 days')
 where expires_at is null;

alter table if exists public.api_keys
  alter column expires_at set not null;

create index if not exists idx_api_keys_owner_active
  on public.api_keys(owner_pid, expires_at desc)
  where revoked = false;

create table if not exists public.runtime_leases (
  resource_key text primary key,
  owner_id text not null,
  fencing_token bigint not null default 1,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_runtime_leases_expiry
  on public.runtime_leases(expires_at);

commit;
