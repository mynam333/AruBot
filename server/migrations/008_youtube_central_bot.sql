create table if not exists public.youtube_bot_profiles (
  id text primary key,
  selected_channel_id text not null,
  selected_channel_title text,
  selected_channel_handle text,
  selected_channel_thumbnail_url text,
  google_subject_hash text,
  access_token text not null,
  refresh_token text,
  token_type text,
  expires_at timestamptz,
  scope text,
  status text not null default 'active',
  last_verified_at timestamptz,
  last_error text,
  configured_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.youtube_streamer_channels (
  owner_user_id text primary key references public.app_users(id) on delete cascade,
  youtube_channel_id text,
  youtube_handle text,
  title text,
  thumbnail_url text,
  input_value text,
  bot_profile_id text references public.youtube_bot_profiles(id) on delete set null,
  moderator_registered boolean not null default false,
  websub_status text not null default 'pending',
  websub_secret text,
  websub_lease_expires_at timestamptz,
  last_detected_video_id text,
  last_live_chat_id text,
  last_live_title text,
  last_live_started_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_youtube_streamer_channels_channel_id
  on public.youtube_streamer_channels (youtube_channel_id);

create index if not exists idx_youtube_streamer_channels_bot_profile
  on public.youtube_streamer_channels (bot_profile_id);
