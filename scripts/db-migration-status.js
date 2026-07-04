import {
  ensureMigrationLog,
  getAppliedMigrationNames,
  listMigrationFiles,
  migrationAliases,
  tableExists,
  withPgClient,
  getDbProvider,
} from './db-common.js';

function parseTarget() {
  const arg = process.argv.find((item) => item.startsWith('--target='));
  return arg ? arg.slice('--target='.length) : 'current';
}

async function main() {
  const target = parseTarget();
  const provider = target === 'current' ? getDbProvider() : target;
  const files = listMigrationFiles();

  const result = await withPgClient(target, async (client) => {
    await ensureMigrationLog(client);
    const applied = await getAppliedMigrationNames(client);
    const hasLog = await tableExists(client, 'migration_log');
    const status = files.map((fileName) => ({
      fileName,
      applied: migrationAliases(fileName).some((name) => applied.has(name)),
    }));
    const pending = status.filter((item) => !item.applied).map((item) => item.fileName);
    return {
      target,
      provider,
      migrationLogExists: hasLog,
      total: status.length,
      applied: status.length - pending.length,
      pending,
      status,
    };
  });

  console.log(JSON.stringify(result, null, 2));
  if (result.pending.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error('[db:migration-status] Failed:', error?.message || error);
  process.exitCode = 1;
});
