import dotenv from 'dotenv';
import {
  initDb,
  migrateChannelIdData,
  runMigrations,
  verifyChannelIdIntegrity,
} from '../server/supabase.js';
import { getDbProvider, resolveDatabaseUrl } from './db-common.js';

dotenv.config();

async function main() {
  const provider = getDbProvider();
  const dbUrl = resolveDatabaseUrl('migration');
  if (!dbUrl) {
    throw new Error(`Missing migration database URL for ${provider}. Set ${provider === 'postgres' ? 'POSTGRES_MIGRATION_URL or POSTGRES_URL' : 'SUPABASE_DB_MIGRATION_URL or SUPABASE_DB_URL'}.`);
  }

  if (provider === 'postgres') process.env.POSTGRES_RUNTIME_URL = dbUrl;
  else process.env.SUPABASE_DB_URL = dbUrl;

  console.log(`[db:migrate] provider=${provider}`);
  console.log('[db:migrate] Initializing database bootstrap...');
  await initDb();

  console.log('[db:migrate] Running migration files...');
  await runMigrations();

  console.log('[db:migrate] Running channel id backfill...');
  await migrateChannelIdData();

  console.log('[db:migrate] Verifying channel id integrity...');
  const integrity = await verifyChannelIdIntegrity();
  console.log(JSON.stringify({ provider, integrity }, null, 2));
  console.log('[db:migrate] Completed.');
}

main().catch((error) => {
  console.error('[db:migrate] Failed:', error?.message || error);
  process.exitCode = 1;
});
