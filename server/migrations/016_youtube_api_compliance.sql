alter table if exists public.platform_tokens
  add column if not exists last_validated_at timestamptz not null default now();

create index if not exists idx_platform_tokens_validation
  on public.platform_tokens (provider, last_validated_at);
