alter table public.bot_rules add column if not exists regex_enabled boolean not null default false;
