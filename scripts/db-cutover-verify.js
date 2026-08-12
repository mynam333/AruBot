import {
  getDbProvider,
  getTableCounts,
  listMigrationFiles,
  migrationAliases,
  getAppliedMigrationNames,
  repairIdentitySequences,
  tableExists,
  withPgClient,
} from './db-common.js';

const REQUIRED_TABLES = [
  'tokens',
  'sessions',
  'bot_settings',
  'bot_rules',
  'bot_counter_values',
  'roulette_sessions',
  'migration_log',
  'channel_tokens',
];

async function main() {
  const provider = getDbProvider();
  const result = await withPgClient('current', async (client) => {
    const now = await client.query('select current_database() as database, now() as now');
    const applied = await getAppliedMigrationNames(client);
    const migrations = listMigrationFiles().map((fileName) => ({
      fileName,
      applied: migrationAliases(fileName).some((name) => applied.has(name)),
    }));
    const pendingMigrations = migrations.filter((item) => !item.applied).map((item) => item.fileName);

    const requiredTables = {};
    for (const tableName of REQUIRED_TABLES) {
      requiredTables[tableName] = await tableExists(client, tableName);
    }

    const sequenceDryRun = await repairIdentitySequences(client, { dryRun: true });
    const counts = await getTableCounts(client);
    const ok = pendingMigrations.length === 0 && Object.values(requiredTables).every(Boolean);

    return {
      provider,
      database: now.rows[0]?.database,
      now: now.rows[0]?.now,
      ok,
      requiredTables,
      pendingMigrations,
      migrationStatus: migrations,
      sequenceDryRun,
      counts,
    };
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}

main().catch((error) => {
  console.error('[db:cutover-verify] Failed:', error?.message || error);
  process.exitCode = 1;
});
