alter table if exists public.platform_tokens
  add column if not exists consent_granted_at timestamptz not null default now(),
  add column if not exists consent_confirmed_at timestamptz not null default now(),
  add column if not exists last_used_at timestamptz not null default now();

create index if not exists idx_platform_tokens_youtube_activity
  on public.platform_tokens (last_used_at)
  where provider = 'youtube';

alter table if exists public.youtube_bot_profiles
  add column if not exists consent_granted_at timestamptz not null default now(),
  add column if not exists consent_confirmed_at timestamptz not null default now(),
  add column if not exists last_used_at timestamptz not null default now();

create index if not exists idx_youtube_bot_profiles_activity
  on public.youtube_bot_profiles (last_used_at);
