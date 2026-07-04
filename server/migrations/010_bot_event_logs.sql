create table if not exists public.bot_event_logs (
  id text primary key,
  owner_user_id text not null,
  sid text,
  channel_uid text,
  provider text,
  category text not null
    check (category in ('command', 'donation', 'roulette', 'video_donation', 'prediction')),
  event_type text not null,
  source text,
  trigger_name text,
  target_name text,
  viewer_user_id text,
  viewer_name text,
  point_delta integer not null default 0,
  point_before integer,
  point_after integer,
  status text not null default 'success'
    check (status in ('success', 'failed', 'cancelled', 'refunded')),
  summary text,
  result_label text,
  result_value text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_bot_event_logs_owner_created
  on public.bot_event_logs(owner_user_id, created_at desc);

create index if not exists idx_bot_event_logs_owner_category_created
  on public.bot_event_logs(owner_user_id, category, created_at desc);

create index if not exists idx_bot_event_logs_owner_provider_created
  on public.bot_event_logs(owner_user_id, provider, created_at desc);

create index if not exists idx_bot_event_logs_owner_viewer_created
  on public.bot_event_logs(owner_user_id, viewer_user_id, created_at desc);
