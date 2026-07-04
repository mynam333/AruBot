import dotenv from 'dotenv';
import pg from 'pg';
import fs from 'fs';
import path from 'path';

dotenv.config();

const { Client } = pg;

function normalizeProvider(value) {
  return String(value || '').trim().toLowerCase() === 'postgres' ? 'postgres' : 'supabase';
}

export function getDbProvider() {
  return normalizeProvider(process.env.ARUBOT_DB_PROVIDER || 'supabase');
}

export function looksLikeOfficialSupabaseDatabaseUrl(dbUrl) {
  try {
    const parsed = new URL(dbUrl);
    const host = parsed.hostname.toLowerCase();
    return host.includes('supabase.co') || host.includes('supabase.com');
  } catch {
    return false;
  }
}

export function validateDatabaseUrlForProvider(provider, dbUrl) {
  const normalized = normalizeProvider(provider);
  if (
    normalized === 'postgres' &&
    dbUrl &&
    looksLikeOfficialSupabaseDatabaseUrl(dbUrl) &&
    String(process.env.ARUBOT_ALLOW_SUPABASE_POSTGRES_URL || '').trim().toLowerCase() !== 'true'
  ) {
    throw new Error('POSTGRES_URL points to an official Supabase host. Use a local/self-hosted Postgres URL for ARUBOT_DB_PROVIDER=postgres, or set ARUBOT_ALLOW_SUPABASE_POSTGRES_URL=true only for an explicit one-off diagnostic shell.');
  }
  return dbUrl;
}

export function resolveDatabaseUrl(target = 'current') {
  const normalized = String(target || 'current').trim().toLowerCase();
  const provider = normalized === 'current' ? getDbProvider() : normalized;
  if (provider === 'postgres') return validateDatabaseUrlForProvider(provider, process.env.POSTGRES_URL || '');
  if (provider === 'supabase') return validateDatabaseUrlForProvider(provider, process.env.SUPABASE_DB_URL || '');
  throw new Error(`Unknown database target: ${target}`);
}

function providerSslEnv(provider) {
  return normalizeProvider(provider) === 'postgres'
    ? process.env.POSTGRES_SSL
    : process.env.SUPABASE_DB_SSL;
}

export function shouldUseSsl(dbUrl, target = 'current') {
  const provider = target === 'current' ? getDbProvider() : String(target || '').toLowerCase();
  const explicit = String(providerSslEnv(provider) || '').trim().toLowerCase();
  if (['false', '0', 'no', 'disable', 'disabled'].includes(explicit)) return false;
  if (['true', '1', 'yes', 'require', 'required'].includes(explicit)) return { rejectUnauthorized: false };
  try {
    const parsed = new URL(dbUrl);
    const sslMode = String(parsed.searchParams.get('sslmode') || '').toLowerCase();
    if (sslMode === 'disable') return false;
    if (['require', 'prefer', 'verify-ca', 'verify-full'].includes(sslMode)) return { rejectUnauthorized: false };
    if (['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(parsed.hostname.toLowerCase())) return false;
  } catch {
    // Use the provider default below.
  }
  return normalizeProvider(provider) === 'postgres' ? false : { rejectUnauthorized: false };
}

export function createPgClient(target = 'current') {
  const dbUrl = resolveDatabaseUrl(target);
  if (!dbUrl) {
    throw new Error(`Database URL is missing for target "${target}". Set POSTGRES_URL or SUPABASE_DB_URL.`);
  }
  const options = {
    connectionString: dbUrl,
    connectionTimeoutMillis: Math.max(1000, Number(process.env.POSTGRES_CONNECT_TIMEOUT_MS || process.env.SUPABASE_DB_CONNECT_TIMEOUT_MS || 5000)),
    statement_timeout: Math.max(1000, Number(process.env.POSTGRES_STATEMENT_TIMEOUT_MS || process.env.SUPABASE_DB_STATEMENT_TIMEOUT_MS || 15000)),
    query_timeout: Math.max(1000, Number(process.env.POSTGRES_STATEMENT_TIMEOUT_MS || process.env.SUPABASE_DB_STATEMENT_TIMEOUT_MS || 15000)),
  };
  const ssl = shouldUseSsl(dbUrl, target);
  if (ssl) options.ssl = ssl;
  return new Client(options);
}

export async function withPgClient(target, fn) {
  const client = createPgClient(target);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export const DEFAULT_COUNT_TABLES = [
  'tokens',
  'sessions',
  'bot_settings',
  'bot_stats',
  'bot_rules',
  'live_days',
  'attendance',
  'attendance_state',
  'live_sessions',
  'roulette_sessions',
  'migration_log',
  'channel_tokens',
  'channel_viewer_tokens',
  'channel_points_balances',
  'video_donation_queue',
  'viewer_playback_state',
  'macro_schedules',
  'app_users',
  'platform_accounts',
  'platform_tokens',
  'youtube_bot_profiles',
  'youtube_streamer_channels',
  'prediction_events',
  'prediction_bets',
  'automation_settings',
  'automation_connections',
  'automation_jobs',
  'automation_local_agents',
  'action_blueprints',
  'action_blueprint_versions',
  'action_blueprint_runs',
  'action_blueprint_run_steps',
  'bot_event_logs',
];

export async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `select exists (
       select 1
         from information_schema.tables
        where table_schema = 'public'
          and table_name = $1
     ) as exists`,
    [tableName]
  );
  return !!rows[0]?.exists;
}

export async function getTableCounts(client, tableNames = DEFAULT_COUNT_TABLES) {
  const result = {};
  for (const tableName of tableNames) {
    if (!(await tableExists(client, tableName))) {
      result[tableName] = { exists: false, count: null };
      continue;
    }
    const { rows } = await client.query(`select count(*)::bigint as count from public.${quoteIdent(tableName)}`);
    result[tableName] = { exists: true, count: Number(rows[0]?.count || 0) };
  }
  return result;
}

export async function getIdentitySequenceColumns(client) {
  const { rows } = await client.query(`
    select
      c.table_name,
      c.column_name,
      pg_get_serial_sequence(format('%I.%I', c.table_schema, c.table_name), c.column_name) as sequence_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and pg_get_serial_sequence(format('%I.%I', c.table_schema, c.table_name), c.column_name) is not null
    order by c.table_name, c.ordinal_position
  `);
  return (rows || []).filter((row) => row.sequence_name);
}

export async function repairIdentitySequences(client, { dryRun = false } = {}) {
  const columns = await getIdentitySequenceColumns(client);
  const repaired = [];
  for (const column of columns) {
    const tableName = String(column.table_name);
    const columnName = String(column.column_name);
    const sequenceName = String(column.sequence_name);
    const { rows } = await client.query(
      `select coalesce(max(${quoteIdent(columnName)}), 0)::bigint as max_value from public.${quoteIdent(tableName)}`
    );
    const maxValue = Number(rows[0]?.max_value || 0);
    const nextValue = maxValue + 1;
    if (!dryRun) {
      await client.query(`select setval($1::regclass, $2, false)`, [sequenceName, nextValue]);
    }
    repaired.push({
      table: tableName,
      column: columnName,
      sequence: sequenceName,
      maxValue,
      nextValue,
      dryRun,
    });
  }
  return repaired;
}

export function listMigrationFiles() {
  const migrationsDir = path.join(process.cwd(), 'server', 'migrations');
  return fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir)
      .filter((fileName) => /^\d+_.+\.sql$/i.test(fileName))
      .sort((a, b) => a.localeCompare(b, 'en'))
    : [];
}

export function migrationAliases(fileName) {
  const baseName = String(fileName || '').replace(/\.sql$/i, '');
  return [String(fileName || ''), baseName].filter(Boolean);
}

export async function ensureMigrationLog(client) {
  await client.query(`
    create table if not exists migration_log (
      id bigint generated always as identity primary key,
      migration_name text not null,
      executed_at timestamptz default now(),
      status text not null,
      details jsonb,
      execution_time_ms integer
    );
  `);
  await client.query(`create index if not exists idx_migration_log_name on migration_log(migration_name);`);
  await client.query(`create index if not exists idx_migration_log_status on migration_log(status);`);
  await client.query(`create index if not exists idx_migration_log_executed on migration_log(executed_at desc);`);
}

export async function getAppliedMigrationNames(client) {
  if (!(await tableExists(client, 'migration_log'))) return new Set();
  const { rows } = await client.query(
    `select distinct migration_name
       from migration_log
      where status = 'success'
        and migration_name is not null`
  );
  return new Set((rows || []).map((row) => String(row.migration_name || '').trim()).filter(Boolean));
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}
