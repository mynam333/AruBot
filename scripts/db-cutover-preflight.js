import { spawn } from 'child_process';
import {
  getDbProvider,
  resolveDatabaseUrl,
  tableExists,
  withPgClient,
} from './db-common.js';

function runVersion(command) {
  return new Promise((resolve) => {
    const child = spawn(command, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('error', (error) => {
      resolve({ ok: false, command, error: error.message });
    });
    child.on('exit', (code) => {
      resolve({
        ok: code === 0,
        command,
        version: output.trim(),
        exitCode: code,
      });
    });
  });
}

function envIsSet(name) {
  return !!String(process.env[name] || '').trim();
}

function maskedUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.password) parsed.password = '***';
    if (parsed.username) parsed.username = parsed.username ? '***' : '';
    return parsed.toString();
  } catch {
    return value ? '[invalid-url]' : '';
  }
}

async function inspectDatabase(target) {
  return withPgClient(target, async (client) => {
    const current = await client.query('select current_database() as database, current_user as user, version() as version');
    const publicTables = await client.query(`
      select count(*)::int as count
        from information_schema.tables
       where table_schema = 'public'
         and table_type = 'BASE TABLE'
    `);
    return {
      ok: true,
      database: current.rows[0]?.database,
      user: current.rows[0]?.user,
      version: current.rows[0]?.version,
      publicTableCount: Number(publicTables.rows[0]?.count || 0),
      hasMigrationLog: await tableExists(client, 'migration_log'),
    };
  });
}

async function main() {
  const provider = getDbProvider();
  const supabaseUrl = resolveDatabaseUrl('supabase');
  const postgresUrl = resolveDatabaseUrl('postgres');
  const issues = [];

  if (!supabaseUrl) issues.push('SUPABASE_DB_URL is required to dump the current Supabase database.');
  if (!postgresUrl) issues.push('POSTGRES_URL is required to restore into local/self-hosted Postgres.');
  if (supabaseUrl && postgresUrl && supabaseUrl === postgresUrl) {
    issues.push('SUPABASE_DB_URL and POSTGRES_URL must point to different databases.');
  }

  const forbiddenSupabaseRuntimeEnv = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_ANON_KEY',
    'SUPABASE_DB_URL',
  ].filter(envIsSet);
  const postgresRuntimeEnvOk = provider !== 'postgres' ||
    forbiddenSupabaseRuntimeEnv.length === 0 ||
    envIsSet('ARUBOT_ALLOW_SUPABASE_ENV_WITH_POSTGRES');
  if (!postgresRuntimeEnvOk) {
    issues.push(`ARUBOT_DB_PROVIDER=postgres runtime still has Supabase env: ${forbiddenSupabaseRuntimeEnv.join(', ')}`);
  }

  const tools = await Promise.all([runVersion('pg_dump'), runVersion('pg_restore')]);
  for (const tool of tools) {
    if (!tool.ok) issues.push(`${tool.command} is not available on PATH.`);
  }

  const databases = {};
  for (const target of ['supabase', 'postgres']) {
    try {
      databases[target] = target === 'supabase' && !supabaseUrl
        ? { ok: false, error: 'SUPABASE_DB_URL is missing' }
        : target === 'postgres' && !postgresUrl
          ? { ok: false, error: 'POSTGRES_URL is missing' }
          : await inspectDatabase(target);
      if (!databases[target].ok) issues.push(`${target} database check failed: ${databases[target].error}`);
    } catch (error) {
      databases[target] = { ok: false, error: error?.message || String(error) };
      issues.push(`${target} database check failed: ${databases[target].error}`);
    }
  }

  const result = {
    ok: issues.length === 0,
    provider,
    urls: {
      supabase: maskedUrl(supabaseUrl),
      postgres: maskedUrl(postgresUrl),
    },
    tools,
    databases,
    postgresRuntimeEnvOk,
    forbiddenSupabaseRuntimeEnv,
    issues,
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}

main().catch((error) => {
  console.error('[db:cutover-preflight] Failed:', error?.message || error);
  process.exitCode = 1;
});
