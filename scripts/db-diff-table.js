import { tableExists, withPgClient } from './db-common.js';

function parseArg(name, fallback = null) {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function normalizeSession(client) {
  await client.query(`set time zone 'UTC'`);
  await client.query(`set datestyle to ISO, YMD`);
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

async function readRows(client, tableName, limit) {
  if (!(await tableExists(client, tableName))) return { exists: false, rows: [], columns: [], keys: [] };
  const [columns, keys] = await Promise.all([
    getColumns(client, tableName),
    getPrimaryKeyColumns(client, tableName),
  ]);
  const orderSql = keys.length
    ? keys.map((key) => `${quoteIdent(key)}::text`).join(', ')
    : columns.map((column) => `${quoteIdent(column)}::text`).join(', ');
  const { rows } = await client.query(
    `select to_jsonb(r) as row_json
       from public.${quoteIdent(tableName)} r
      order by ${orderSql}
      limit $1`,
    [limit]
  );
  return {
    exists: true,
    columns,
    keys,
    rows: rows.map((row) => row.row_json || {}),
  };
}

function keyForRow(row, keys, fallbackIndex) {
  if (!keys.length) return `#${fallbackIndex}`;
  return keys.map((key) => `${key}=${JSON.stringify(row[key] ?? null)}`).join('|');
}

function diffRows(leftRows, rightRows, keys, showValues) {
  const rightByKey = new Map();
  rightRows.forEach((row, index) => rightByKey.set(keyForRow(row, keys, index), row));

  const differences = [];
  leftRows.forEach((left, index) => {
    const rowKey = keyForRow(left, keys, index);
    const right = rightByKey.get(rowKey);
    if (!right) {
      differences.push({ key: rowKey, status: 'missing_in_postgres' });
      return;
    }
    const columns = [...new Set([...Object.keys(left), ...Object.keys(right)])]
      .filter((column) => JSON.stringify(left[column] ?? null) !== JSON.stringify(right[column] ?? null));
    if (columns.length) {
      const item = { key: rowKey, status: 'different', columns };
      if (showValues) {
        item.values = Object.fromEntries(columns.map((column) => [
          column,
          { supabase: left[column] ?? null, postgres: right[column] ?? null },
        ]));
      }
      differences.push(item);
    }
  });

  const leftKeys = new Set(leftRows.map((row, index) => keyForRow(row, keys, index)));
  rightRows.forEach((right, index) => {
    const rowKey = keyForRow(right, keys, index);
    if (!leftKeys.has(rowKey)) differences.push({ key: rowKey, status: 'missing_in_supabase' });
  });
  return differences;
}

async function main() {
  const tableName = parseArg('table');
  if (!tableName) throw new Error('Missing --table=<table_name>.');
  const limit = Math.max(1, Math.min(5000, Number(parseArg('limit', '100'))));
  const showValues = hasFlag('show-values');

  const [supabase, postgres] = await Promise.all([
    withPgClient('supabase', async (client) => {
      await normalizeSession(client);
      return readRows(client, tableName, limit);
    }),
    withPgClient('postgres', async (client) => {
      await normalizeSession(client);
      return readRows(client, tableName, limit);
    }),
  ]);

  const keys = supabase.keys.length ? supabase.keys : postgres.keys;
  const differences = diffRows(supabase.rows, postgres.rows, keys, showValues);
  console.log(JSON.stringify({
    table: tableName,
    limit,
    showValues,
    keys,
    ok: differences.length === 0,
    differences,
  }, null, 2));
  if (differences.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error('[db:diff-table] Failed:', error?.message || error);
  process.exitCode = 1;
});
