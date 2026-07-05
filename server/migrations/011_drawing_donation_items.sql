create table if not exists public.drawing_donation_items (
  id text primary key,
  sid text not null,
  owner_user_id text,
  channel_uid text not null,
  viewer_user_id text not null,
  viewer_name text,
  status text not null default 'queued'
    check (status in ('queued', 'approved', 'playing', 'done', 'rejected', 'deleted')),
  cost integer not null default 0,
  point_deductions jsonb not null default '[]'::jsonb,
  point_refunded boolean not null default false,
  canvas jsonb not null default '{}'::jsonb,
  strokes jsonb not null default '[]'::jsonb,
  stroke_object_key text,
  preview_image text,
  preview_object_key text,
  metrics jsonb not null default '{}'::jsonb,
  replay jsonb not null default '{}'::jsonb,
  result_hold_sec integer not null default 8,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  playing_at timestamptz,
  rejected_at timestamptz,
  done_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_drawing_donation_sid_status_created
  on public.drawing_donation_items(sid, status, created_at);

create index if not exists idx_drawing_donation_sid_status_position_created
  on public.drawing_donation_items(sid, status, position, created_at);

create index if not exists idx_drawing_donation_sid_position
  on public.drawing_donation_items(sid, position, created_at);

create index if not exists idx_drawing_donation_viewer_created
  on public.drawing_donation_items(sid, viewer_user_id, created_at desc);

alter table public.drawing_donation_items add column if not exists stroke_object_key text;
alter table public.drawing_donation_items add column if not exists preview_object_key text;
