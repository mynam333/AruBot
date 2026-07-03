alter table public.app_users
  add column if not exists is_admin boolean not null default false;

create index if not exists idx_app_users_is_admin
  on public.app_users (is_admin)
  where is_admin = true;
