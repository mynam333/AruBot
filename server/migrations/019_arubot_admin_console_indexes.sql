create index if not exists idx_app_users_created_id
  on public.app_users (created_at desc, id desc);

create index if not exists idx_platform_accounts_provider_user
  on public.platform_accounts (provider, user_id);

create index if not exists idx_platform_tokens_user_provider
  on public.platform_tokens (user_id, provider);

create index if not exists idx_sessions_account_last_seen_active
  on public.sessions (account_user_id, last_seen desc)
  where revoked = false;

create index if not exists idx_bot_event_logs_created
  on public.bot_event_logs (created_at desc, id desc);
