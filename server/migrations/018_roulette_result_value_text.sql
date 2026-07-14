-- Roulette item values can be numbers, commands, or action-variable tokens.
-- The legacy numeric column rejects values such as `${action::name}` on PostgreSQL.

alter table if exists public.roulette_sessions
  alter column result_value type text
  using result_value::text;
