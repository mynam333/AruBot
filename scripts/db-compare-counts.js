import { DEFAULT_COUNT_TABLES, getTableCounts, resolveDatabaseUrl, withPgClient } from './db-common.js';

const DEFAULT_IGNORED_TABLES = ['migration_log'];

function parseListArg(name, fallback = []) {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.slice(name.length + 3).split(',').map((item) => item.trim()).filter(Boolean);
}

function parseTables() {
  return parseListArg('tables', DEFAULT_COUNT_TABLES);
}

async function main() {
  const supabaseUrl = resolveDatabaseUrl('supabase');
  const postgresUrl = resolveDatabaseUrl('postgres');
  if (!supabaseUrl) throw new Error('SUPABASE_DB_URL is required for count comparison.');
  if (!postgresUrl) throw new Error('POSTGRES_URL is required for count comparison.');

  const ignoredTables = new Set(parseListArg('ignore', DEFAULT_IGNORED_TABLES));
  const tables = parseTables().filter((tableName) => !ignoredTables.has(tableName));
  const [supabaseCounts, postgresCounts] = await Promise.all([
    withPgClient('supabase', (client) => getTableCounts(client, tables)),
    withPgClient('postgres', (client) => getTableCounts(client, tables)),
  ]);

  const differences = [];
  for (const tableName of tables) {
    const left = supabaseCounts[tableName] || { exists: false, count: null };
    const right = postgresCounts[tableName] || { exists: false, count: null };
    if (left.exists !== right.exists || left.count !== right.count) {
      differences.push({
        table: tableName,
        supabase: left,
        postgres: right,
      });
    }
  }

  const result = {
    generatedAt: new Date().toISOString(),
    ok: differences.length === 0,
    ignoredTables: [...ignoredTables],
    differences,
    supabase: supabaseCounts,
    postgres: postgresCounts,
  };
  console.log(JSON.stringify(result, null, 2));
  if (differences.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error('[db:compare-counts] Failed:', error?.message || error);
  process.exitCode = 1;
});
