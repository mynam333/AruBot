import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { resolveDatabaseUrl } from './db-common.js';

dotenv.config();

function parseArg(name, fallback = null) {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
}

function commandText(command, args) {
  return [command, ...args].map((part) => String(part).includes(' ') ? `"${part}"` : String(part)).join(' ');
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function maskUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.username) parsed.username = '***';
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return value ? '[invalid-url]' : '';
  }
}

function parseEnvLines(text) {
  return text.split(/\r?\n/);
}

function upsertEnvValue(lines, key, value) {
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=`);
  const index = lines.findIndex((line) => pattern.test(line));
  const nextLine = `${key}=${value}`;
  if (index >= 0) {
    lines[index] = nextLine;
  } else {
    lines.push(nextLine);
  }
}

function blankEnvValue(lines, key) {
  upsertEnvValue(lines, key, '');
}

function writePostgresEnv(envFile) {
  if (!fs.existsSync(envFile)) throw new Error(`Env file not found: ${envFile}`);
  const original = fs.readFileSync(envFile, 'utf8');
  const backupFile = `${envFile}.pre-postgres-${timestamp()}.bak`;
  fs.copyFileSync(envFile, backupFile);

  const lines = parseEnvLines(original);
  upsertEnvValue(lines, 'ARUBOT_DB_PROVIDER', 'postgres');
  upsertEnvValue(lines, 'ARUBOT_ALLOW_SUPABASE_ENV_WITH_POSTGRES', 'false');
  upsertEnvValue(lines, 'ARUBOT_ALLOW_SUPABASE_POSTGRES_URL', 'false');
  upsertEnvValue(lines, 'ARUBOT_SUPABASE_PERF_MONITORING', 'false');

  blankEnvValue(lines, 'SUPABASE_URL');
  blankEnvValue(lines, 'SUPABASE_SERVICE_ROLE_KEY');
  blankEnvValue(lines, 'SUPABASE_ANON_KEY');
  blankEnvValue(lines, 'SUPABASE_DB_URL');

  fs.writeFileSync(envFile, `${lines.join('\n').replace(/\n+$/, '')}\n`);
  return backupFile;
}

async function main() {
  const execute = hasFlag('execute');
  const confirm = parseArg('confirm');
  const skipApiSmoke = hasFlag('skip-api-smoke');
  const skipPm2Reload = hasFlag('skip-pm2-reload');
  const skipRuntimeStop = hasFlag('skip-runtime-stop') || skipPm2Reload;
  const stopRuntimeBeforeDump = !skipRuntimeStop;
  const envFile = path.resolve(parseArg('env-file', '.env'));
  const dumpFile = parseArg('dump', path.join('backups', `supabase-to-postgres-${timestamp()}.dump`));
  const baseUrl = parseArg('base') || process.env.API_SMOKE_BASE_URL || `http://localhost:${process.env.SERVER_PORT || process.env.PORT || 3001}`;

  const supabaseUrl = resolveDatabaseUrl('supabase');
  const postgresUrl = resolveDatabaseUrl('postgres');
  if (!supabaseUrl) throw new Error('SUPABASE_DB_URL is required before switching to Postgres.');
  if (!postgresUrl) throw new Error('POSTGRES_URL is required before switching to Postgres.');
  if (supabaseUrl === postgresUrl) throw new Error('SUPABASE_DB_URL and POSTGRES_URL must point to different databases.');

  const rehearsalArgs = [
    'scripts/db-cutover-rehearsal.js',
    `--dump=${dumpFile}`,
    '--skip-api-smoke',
  ];
  if (execute) rehearsalArgs.push('--execute', '--confirm=restore-public');

  const plan = {
    execute,
    envFile,
    dumpFile,
    baseUrl,
    skipApiSmoke,
    skipPm2Reload,
    stopRuntimeBeforeDump,
    supabase: maskUrl(supabaseUrl),
    postgres: maskUrl(postgresUrl),
    steps: [
      stopRuntimeBeforeDump ? commandText(npmCommand(), ['run', 'pm2:stop']) : 'skip runtime stop before dump',
      commandText('node', rehearsalArgs),
      `update ${envFile} to ARUBOT_DB_PROVIDER=postgres and blank Supabase REST keys`,
      skipPm2Reload ? 'skip pm2 reload' : commandText(npmCommand(), ['run', 'pm2:reload']),
      skipApiSmoke ? 'skip api smoke' : commandText('node', ['scripts/api-smoke.js', `--base=${baseUrl}`, '--expect-provider=postgres']),
    ],
  };
  console.log(JSON.stringify(plan, null, 2));

  if (!execute) {
    console.log('[db:switch-to-postgres] Dry run only. Add --execute --confirm=switch-to-postgres to migrate data and update .env.');
    return;
  }
  if (confirm !== 'switch-to-postgres') {
    throw new Error('Refusing to switch without --confirm=switch-to-postgres.');
  }

  let runtimeStopped = false;
  let envSwitched = false;
  try {
    if (stopRuntimeBeforeDump) {
      await run(npmCommand(), ['run', 'pm2:stop'], process.env);
      runtimeStopped = true;
    }

    await run('node', rehearsalArgs, {
      ...process.env,
      ARUBOT_ALLOW_SUPABASE_ENV_WITH_POSTGRES: 'true',
    });

    const backupFile = writePostgresEnv(envFile);
    envSwitched = true;
    console.log(`[db:switch-to-postgres] Updated ${envFile}. Backup: ${backupFile}`);

    if (!skipPm2Reload) {
      await run(npmCommand(), ['run', 'pm2:reload'], process.env);
    }

    if (!skipApiSmoke) {
      await run('node', ['scripts/api-smoke.js', `--base=${baseUrl}`, '--expect-provider=postgres'], {
        ...process.env,
        ARUBOT_DB_PROVIDER: 'postgres',
      });
    }
  } catch (error) {
    if (runtimeStopped && !envSwitched && !skipPm2Reload) {
      console.warn('[db:switch-to-postgres] Switch failed before .env update. Restarting original PM2 runtime.');
      try {
        await run(npmCommand(), ['run', 'pm2:reload'], process.env);
      } catch (restartError) {
        console.error('[db:switch-to-postgres] Failed to restart original PM2 runtime:', restartError?.message || restartError);
      }
    }
    throw error;
  }

  console.log('[db:switch-to-postgres] Supabase to Postgres switch completed.');
}

main().catch((error) => {
  console.error('[db:switch-to-postgres] Failed:', error?.message || error);
  process.exitCode = 1;
});
