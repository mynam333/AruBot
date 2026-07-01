-- Multi-platform account foundation for CHZZK and CIME.
-- Existing CHZZK sid data stays compatible while new providers can link to the same owner.

create table if not exists public.app_users (
  id text primary key,
  primary_provider text,
  primary_platform_user_id text,
  display_name text,
  avatar_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.app_users(id) on delete cascade,
  provider text not null,
  platform_user_id text not null,
  channel_id text,
  channel_name text,
  channel_handle text,
  avatar_url text,
  metadata jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null default now(),
  last_login_at timestamptz not null default now(),
  unique (provider, platform_user_id)
);

create table if not exists public.platform_tokens (
  provider text not null,
  user_id text not null references public.app_users(id) on delete cascade,
  platform_user_id text not null,
  access_token text not null,
  refresh_token text,
  token_type text,
  expires_at timestamptz,
  scope text,
  updated_at timestamptz not null default now(),
  primary key (provider, user_id),
  unique (provider, platform_user_id)
);

create index if not exists idx_platform_accounts_user_provider
  on public.platform_accounts (user_id, provider);

create index if not exists idx_platform_accounts_provider_channel
  on public.platform_accounts (provider, channel_id);

create index if not exists idx_platform_tokens_expiry
  on public.platform_tokens (provider, expires_at)
  where expires_at is not null;

alter table public.sessions add column if not exists account_user_id text;
create index if not exists idx_sessions_account_user_id on public.sessions(account_user_id);

