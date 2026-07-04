import { tableExists, withPgClient } from './db-common.js';

const DEFAULT_CHECKSUM_TABLES = [
  'tokens',
  'sessions',
  'bot_settings',
  'bot_rules',
  'channel_tokens',
  'channel_viewer_tokens',
  'channel_points_balances',
  'platform_accounts',
  'platform_tokens',
  'roulette_sessions',
  'prediction_events',
  'prediction_bets',
  'automation_settings',
  'automation_connections',
  'automation_jobs',
  'youtube_bot_profiles',
  'youtube_streamer_channels',
  'bot_event_logs',
];

function parseTables() {
  const arg = process.argv.find((item) => item.startsWith('--tables='));
  if (!arg) return DEFAULT_CHECKSUM_TABLES;
  return arg.slice('--tables='.length).split(',').map((item) => item.trim()).filter(Boolean);
}

function parseLimit() {
  const arg = process.argv.find((item) => item.startsWith('--limit='));
  return Math.max(1, Math.min(200000, Number(arg ? arg.slice('--limit='.length) : 50000)));
}

async function normalizeComparisonSession(client) {
  await client.query(`set time zone 'UTC'`);
  await client.query(`set datestyle to ISO, YMD`);
}

async function getPrimaryKeyColumns(client, tableName) {
  const { rows } = await client.query(
    `select kcu.column_name
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on tc.constraint_name = kcu.constraint_name
        and tc.table_schema = kcu.table_schema
        and tc.table_name = kcu.table_name
      where tc.table_schema = 'public'
        and tc.table_name = $1
        and tc.constraint_type = 'PRIMARY KEY'
      order by kcu.ordinal_position`,
    [tableName]
  );
  return rows.map((row) => String(row.column_name));
}

async function getTableColumns(client, tableName) {
  const { rows } = await client.query(
    `select column_name
       from information_schema.columns
      where table_schema = 'public'
        and table_name = $1
      order by ordinal_position`,
    [tableName]
  );
  return rows.map((row) => String(row.column_name));
}

async function checksumTable(client, tableName, limit) {
  if (!(await tableExists(client, tableName))) return { exists: false, count: null, checksum: null, sampled: 0 };
  const [keys, columns] = await Promise.all([
    getPrimaryKeyColumns(client, tableName),
    getTableColumns(client, tableName),
  ]);
  const orderSql = keys.length
    ? keys.map((key) => `r.${quoteIdent(key)}::text`).join(', ')
    : columns.map((column) => `r.${quoteIdent(column)}::text`).join(', ');
  const rowSql = columns.map((column) => `coalesce(r.${quoteIdent(column)}::text, '<NULL>')`).join(` || E'\\x1f' || `);
  const { rows } = await client.query(
    `with ordered as (
       select md5(${rowSql}) as row_hash
         from public.${quoteIdent(tableName)} r
        order by ${orderSql}
        limit $1
     ),
     counted as (
       select count(*)::bigint as total_count from public.${quoteIdent(tableName)}
     )
     select
       (select total_count from counted) as count,
       count(*)::bigint as sampled,
       md5(coalesce(string_agg(row_hash, E'\\n' order by row_hash), '')) as checksum
      from ordered`,
    [limit]
  );
  return {
    exists: true,
    count: Number(rows[0]?.count || 0),
    sampled: Number(rows[0]?.sampled || 0),
    checksum: rows[0]?.checksum || null,
    sampleLimit: limit,
  };
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function main() {
  const tables = parseTables();
  const limit = parseLimit();
  const [supabase, postgres] = await Promise.all([
    withPgClient('supabase', async (client) => {
      await normalizeComparisonSession(client);
      const result = {};
      for (const tableName of tables) result[tableName] = await checksumTable(client, tableName, limit);
      return result;
    }),
    withPgClient('postgres', async (client) => {
      await normalizeComparisonSession(client);
      const result = {};
      for (const tableName of tables) result[tableName] = await checksumTable(client, tableName, limit);
      return result;
    }),
  ]);

  const differences = [];
  for (const tableName of tables) {
    const left = supabase[tableName];
    const right = postgres[tableName];
    if (
      left.exists !== right.exists ||
      left.count !== right.count ||
      left.checksum !== right.checksum ||
      left.sampled !== right.sampled
    ) {
      differences.push({ table: tableName, supabase: left, postgres: right });
    }
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    sampleLimit: limit,
    ok: differences.length === 0,
    differences,
    supabase,
    postgres,
  }, null, 2));

  if (differences.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error('[db:compare-checksums] Failed:', error?.message || error);
  process.exitCode = 1;
});
