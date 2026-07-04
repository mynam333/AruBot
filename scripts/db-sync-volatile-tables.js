import { tableExists, withPgClient } from './db-common.js';

const DEFAULT_VOLATILE_TABLES = ['platform_tokens'];
const BATCH_SIZE = 200;

function parseListArg(name, fallback = []) {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.slice(name.length + 3).split(',').map((item) => item.trim()).filter(Boolean);
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function getColumns(client, tableName) {
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

async function normalizeSession(client) {
  await client.query(`set time zone 'UTC'`);
  await client.query(`set datestyle to ISO, YMD`);
}

async function readSourceRows(client, tableName, columns) {
  const orderSql = columns.map((column) => quoteIdent(column)).join(', ');
  const { rows } = await client.query(
    `select ${columns.map((column) => `${quoteIdent(column)}::text as ${quoteIdent(column)}`).join(', ')}
       from public.${quoteIdent(tableName)}
      order by ${orderSql}`
  );
  return rows;
}

async function replaceTargetRows(client, tableName, columns, rows) {
  await client.query('begin');
  try {
    await client.query(`delete from public.${quoteIdent(tableName)}`);
    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
      const batch = rows.slice(offset, offset + BATCH_SIZE);
      const values = [];
      const tuples = batch.map((row, rowIndex) => {
        const placeholders = columns.map((column, columnIndex) => {
          values.push(row[column] ?? null);
          return `$${rowIndex * columns.length + columnIndex + 1}`;
        });
        return `(${placeholders.join(', ')})`;
      });
      if (tuples.length) {
        await client.query(
          `insert into public.${quoteIdent(tableName)} (${columns.map((column) => quoteIdent(column)).join(', ')})
           values ${tuples.join(', ')}`,
          values
        );
      }
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function syncTable(tableName) {
  return Promise.all([
    withPgClient('supabase', async (client) => {
      await normalizeSession(client);
      if (!(await tableExists(client, tableName))) return { exists: false, columns: [], rows: [] };
      const columns = await getColumns(client, tableName);
      return { exists: true, columns, rows: await readSourceRows(client, tableName, columns) };
    }),
    withPgClient('postgres', async (client) => {
      if (!(await tableExists(client, tableName))) return { exists: false, columns: [] };
      return { exists: true, columns: await getColumns(client, tableName), client };
    }),
  ]).then(async ([source, target]) => {
    if (!source.exists || !target.exists) {
      return { table: tableName, skipped: true, reason: 'missing_table', sourceExists: source.exists, targetExists: target.exists };
    }
    const sourceColumns = source.columns.join(',');
    const targetColumns = target.columns.join(',');
    if (sourceColumns !== targetColumns) {
      return { table: tableName, skipped: true, reason: 'column_mismatch', sourceColumns: source.columns, targetColumns: target.columns };
    }
    await withPgClient('postgres', (client) => replaceTargetRows(client, tableName, source.columns, source.rows));
    return { table: tableName, skipped: false, rows: source.rows.length };
  });
}

async function main() {
  const tables = parseListArg('tables', DEFAULT_VOLATILE_TABLES);
  const synced = [];
  for (const tableName of tables) {
    synced.push(await syncTable(tableName));
  }
  const ok = synced.every((item) => !item.skipped);
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode: 'text-cast-preserve-db-precision',
    ok,
    synced,
  }, null, 2));
  if (!ok) process.exitCode = 2;
}

main().catch((error) => {
  console.error('[db:sync-volatile-tables] Failed:', error?.message || error);
  process.exitCode = 1;
});
