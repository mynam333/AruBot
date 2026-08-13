-- Permanent, same-origin short links for public viewer surfaces.
-- Target validation remains an application-layer allowlist; the database enforces
-- the bounded canonical shape so malformed or oversized rows cannot be inserted.

create table if not exists public.public_short_links (
  code text primary key,
  target_path text not null,
  created_by text,
  created_at timestamptz not null default now(),
  constraint public_short_links_code_ck check (code ~ '^[A-Za-z0-9_-]{10,16}$'),
  constraint public_short_links_target_ck check (
    char_length(target_path) between 3 and 512
    and left(target_path, 1) = '/'
    and left(target_path, 2) <> '//'
    and position(E'\\' in target_path) = 0
  )
);

create unique index if not exists public_short_links_target_path_uniq
  on public.public_short_links (target_path);

create index if not exists idx_public_short_links_created_by
  on public.public_short_links (created_by)
  where created_by is not null;

revoke all on table public.public_short_links from public;
