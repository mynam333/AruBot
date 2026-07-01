-- Stable public/viewer token and runtime-state improvements for the Next.js migration.
-- Safe to run more than once.

create extension if not exists pgcrypto;

-- Existing production token table used by the current backend.
-- Keep this optimized while the newer channel_viewer_tokens table is adopted gradually.
create table if not exists public.channel_tokens (
  id bigint generated always as identity primary key,
  channel_id text not null,
  token_type text not null,
  token_value text not null unique,
  sid text not null,
  created_at timestamptz default now(),
  expires_at timestamptz,
  last_used timestamptz,
  active boolean default true,
  usage_count integer default 0,
  metadata jsonb default '{}'::jsonb
);

create index if not exists idx_channel_tokens_viewer_lookup
  on public.channel_tokens (token_value, token_type)
  where active = true;

create index if not exists idx_channel_tokens_viewer_active
  on public.channel_tokens (channel_id, token_type, sid, created_at desc)
  where active = true;

create table if not exists public.channel_viewer_tokens (
  id uuid primary key default gen_random_uuid(),
  channel_uid text not null,
  token_type text not null check (token_type in ('pvd', 'roulette', 'commands', 'points')),
  token text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_channel_viewer_tokens_channel_type
  on public.channel_viewer_tokens (channel_uid, token_type)
  where is_active = true;

create unique index if not exists idx_channel_viewer_tokens_one_active
  on public.channel_viewer_tokens (channel_uid, token_type)
  where is_active = true;

create table if not exists public.video_donation_queue (
  id uuid primary key default gen_random_uuid(),
  channel_uid text not null,
  requester_user_id text not null,
  requester_username text,
  video_id text not null,
  title text,
  start_sec integer not null default 0 check (start_sec >= 0),
  duration_sec integer not null check (duration_sec > 0),
  cost integer not null default 0 check (cost >= 0),
  status text not null default 'queued' check (status in ('queued', 'playing', 'played', 'refunded', 'failed', 'skipped')),
  sort_order bigint not null default extract(epoch from now())::bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  played_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_video_donation_queue_active
  on public.video_donation_queue (channel_uid, status, sort_order, created_at)
  where status in ('queued', 'playing');

create table if not exists public.viewer_playback_state (
  channel_uid text primary key,
  current_queue_id uuid references public.video_donation_queue(id) on delete set null,
  base_start_ms bigint,
  paused boolean not null default false,
  paused_at_sec integer,
  server_updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.channel_points_balances (
  channel_uid text not null,
  user_id text not null,
  username text,
  points bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (channel_uid, user_id)
);

create index if not exists idx_channel_points_balances_rank
  on public.channel_points_balances (channel_uid, points desc);

create table if not exists public.macro_schedules (
  id uuid primary key default gen_random_uuid(),
  channel_uid text not null,
  name text not null,
  message text not null,
  enabled boolean not null default true,
  interval_sec integer not null check (interval_sec >= 10),
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_macro_schedules_due
  on public.macro_schedules (channel_uid, next_run_at)
  where enabled = true;
