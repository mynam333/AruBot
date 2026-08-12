import { getDbProvider, resolveDatabaseUrl, tableExists, withPgClient } from './db-common.js';

const REQUIRED_TABLES = [
  'tokens',
  'sessions',
  'bot_settings',
  'bot_rules',
  'bot_counter_values',
  'roulette_sessions',
  'migration_log',
];

async function main() {
  const provider = getDbProvider();
  const dbUrl = resolveDatabaseUrl('current');
  if (!dbUrl) {
    throw new Error(`Missing direct database URL for ${provider}. Set ${provider === 'postgres' ? 'POSTGRES_URL' : 'SUPABASE_DB_URL'}.`);
  }

  if (provider === 'postgres') {
    const hasSupabaseRest = !!String(process.env.SUPABASE_URL || '').trim() || !!String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (hasSupabaseRest && process.env.ARUBOT_ALLOW_SUPABASE_ENV_WITH_POSTGRES !== 'true') {
      throw new Error('ARUBOT_DB_PROVIDER=postgres must not depend on SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Remove them or set ARUBOT_ALLOW_SUPABASE_ENV_WITH_POSTGRES=true for a one-off migration shell.');
    }
  }

  const result = await withPgClient('current', async (client) => {
    const now = await client.query('select now() as now, current_database() as database');
    const tables = {};
    for (const tableName of REQUIRED_TABLES) {
      tables[tableName] = await tableExists(client, tableName);
    }
    let counterWriteAccess = false;
    if (tables.bot_counter_values) {
      const smokeSid = `__arubot_provider_smoke__:${process.pid}:${Date.now()}`;
      await client.query('begin');
      try {
        await client.query(
          `insert into public.bot_counter_values as stored (
             sid, counter_name, counter_scope, subject_key, value
           ) values ($1, 'runtime permission check', 'global', '', 1)
           on conflict (sid, counter_name, counter_scope, subject_key)
           do update set value = stored.value + 1
           returning value`,
          [smokeSid]
        );
        await client.query(
          `update public.bot_counter_values
              set updated_at = now()
            where sid = $1`,
          [smokeSid]
        );
        await client.query('delete from public.bot_counter_values where sid = $1', [smokeSid]);
        counterWriteAccess = true;
      } finally {
        await client.query('rollback').catch(() => undefined);
      }
    }
    return {
      provider,
      database: now.rows[0]?.database,
      now: now.rows[0]?.now,
      tables,
      counterWriteAccess,
      ok: Object.values(tables).every(Boolean) && counterWriteAccess,
    };
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}

main().catch((error) => {
  console.error('[db:provider-smoke] Failed:', error?.message || error);
  process.exitCode = 1;
});
