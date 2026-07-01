create table if not exists public.prediction_events (
  id text primary key,
  sid text not null,
  channel_uid text not null,
  question text not null,
  status text not null default 'open'
    check (status in ('open', 'locked', 'settled', 'cancelled')),
  command text not null default '!투표',
  options jsonb not null default '[]'::jsonb,
  min_bet integer not null default 1,
  max_bet integer not null default 100000,
  winning_option_id text,
  settlement_note text,
  created_at timestamptz not null default now(),
  closes_at timestamptz,
  locked_at timestamptz,
  settled_at timestamptz
);

alter table public.prediction_events
  alter column command set default '!투표';

create table if not exists public.prediction_bets (
  id text primary key,
  prediction_id text not null references public.prediction_events(id) on delete cascade,
  channel_uid text not null,
  user_id text not null,
  username text,
  option_id text not null,
  amount integer not null check (amount > 0),
  payout integer not null default 0,
  refunded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (prediction_id, user_id)
);

create index if not exists idx_prediction_events_sid_created
  on public.prediction_events (sid, created_at desc);

create index if not exists idx_prediction_events_channel_status
  on public.prediction_events (channel_uid, status, created_at desc);

create index if not exists idx_prediction_bets_prediction_amount
  on public.prediction_bets (prediction_id, amount desc);

create index if not exists idx_prediction_bets_user
  on public.prediction_bets (prediction_id, user_id);
