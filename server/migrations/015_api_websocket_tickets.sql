begin;

create table if not exists public.api_websocket_tickets (
  ticket_hash text primary key,
  owner_pid text not null,
  scope text not null check (scope in ('desktop', 'warudo')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists idx_api_websocket_tickets_expiry
  on public.api_websocket_tickets(expires_at)
  where consumed_at is null;

commit;
