-- NULL retains the existing role-level policy for previously saved commands.
alter table public.bot_rules add column if not exists execution_permission text
  check (execution_permission in ('everyone', 'subscriber', 'manager', 'streamer'));
