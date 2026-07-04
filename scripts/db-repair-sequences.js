import { getDbProvider, repairIdentitySequences, withPgClient } from './db-common.js';

function parseTarget() {
  const arg = process.argv.find((item) => item.startsWith('--target='));
  return arg ? arg.slice('--target='.length) : 'current';
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const target = parseTarget();
  const dryRun = hasFlag('dry-run');
  const provider = target === 'current' ? getDbProvider() : target;
  const repaired = await withPgClient(target, (client) => repairIdentitySequences(client, { dryRun }));
  console.log(JSON.stringify({
    target,
    provider,
    dryRun,
    generatedAt: new Date().toISOString(),
    repaired,
  }, null, 2));
}

main().catch((error) => {
  console.error('[db:repair-sequences] Failed:', error?.message || error);
  process.exitCode = 1;
});
