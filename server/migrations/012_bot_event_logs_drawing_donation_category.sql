alter table if exists public.bot_event_logs
  drop constraint if exists bot_event_logs_category_check;

alter table if exists public.bot_event_logs
  add constraint bot_event_logs_category_check
  check (category in ('command', 'donation', 'roulette', 'video_donation', 'drawing_donation', 'prediction'));
