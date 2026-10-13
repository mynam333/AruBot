alter table songbook_settings add column if not exists overlay_config jsonb not null default '{}'::jsonb;
alter table songbook_settings add column if not exists overlay_revision integer not null default 1;
alter table songbook_settings add column if not exists overlay_token text;
create unique index if not exists songbook_overlay_token_unique on songbook_settings(overlay_token) where overlay_token is not null;
