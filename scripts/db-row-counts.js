import { DEFAULT_COUNT_TABLES, getTableCounts, getDbProvider, withPgClient } from './db-common.js';

function parseTables() {
  const arg = process.argv.find((item) => item.startsWith('--tables='));
  if (!arg) return DEFAULT_COUNT_TABLES;
  return arg.slice('--tables='.length).split(',').map((item) => item.trim()).filter(Boolean);
}

function parseTarget() {
  const arg = process.argv.find((item) => item.startsWith('--target='));
  return arg ? arg.slice('--target='.length) : 'current';
}

async function main() {
  const target = parseTarget();
  const provider = target === 'current' ? getDbProvider() : target;
  const counts = await withPgClient(target, (client) => getTableCounts(client, parseTables()));
  console.log(JSON.stringify({
    target,
    provider,
    generatedAt: new Date().toISOString(),
    counts,
  }, null, 2));
}

main().catch((error) => {
  console.error('[db:counts] Failed:', error?.message || error);
  process.exitCode = 1;
});
