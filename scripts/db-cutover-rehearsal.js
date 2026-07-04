import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDbProvider, resolveDatabaseUrl } from './db-common.js';

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

function nodeScript(script, args = []) {
  return ['node', [script, ...args]];
}

function commandText(command, args) {
  return [command, ...args].map((part) => String(part).includes(' ') ? `"${part}"` : String(part)).join(' ');
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function main() {
  const execute = hasFlag('execute');
  const confirm = parseArg('confirm');
  const skipApiSmoke = hasFlag('skip-api-smoke');
  const baseUrl = parseArg('base') || process.env.API_SMOKE_BASE_URL || `http://localhost:${process.env.SERVER_PORT || process.env.PORT || 3001}`;
  const dumpFile = parseArg('dump', path.join('backups', `supabase-public-${timestamp()}.dump`));

  if (!resolveDatabaseUrl('supabase')) throw new Error('SUPABASE_DB_URL is required for cutover rehearsal.');
  if (!resolveDatabaseUrl('postgres')) throw new Error('POSTGRES_URL is required for cutover rehearsal.');

  const provider = getDbProvider();
  const env = {
    ...process.env,
    ARUBOT_ALLOW_SUPABASE_ENV_WITH_POSTGRES: 'true',
  };

  const steps = [
    {
      name: 'Cutover preflight checks',
      command: nodeScript('scripts/db-cutover-preflight.js'),
      env,
      destructive: false,
    },
    {
      name: 'Dump Supabase public schema',
      command: nodeScript('scripts/db-dump-public.js', ['--target=supabase', `--out=${dumpFile}`]),
      destructive: false,
    },
    {
      name: 'Restore dump into Postgres public schema',
      command: nodeScript('scripts/db-restore-public.js', ['--target=postgres', `--file=${dumpFile}`, '--confirm=restore-public']),
      destructive: true,
    },
    {
      name: 'Sync volatile tables from Supabase',
      command: nodeScript('scripts/db-sync-volatile-tables.js'),
      destructive: false,
    },
    {
      name: 'Compare restored row counts',
      command: nodeScript('scripts/db-compare-counts.js'),
      destructive: false,
    },
    {
      name: 'Compare restored core checksums',
      command: nodeScript('scripts/db-compare-checksums.js'),
      destructive: false,
    },
    {
      name: 'Run Postgres migrations',
      command: ['node', ['scripts/db-migrate.js']],
      env: { ...env, ARUBOT_DB_PROVIDER: 'postgres' },
      destructive: false,
    },
    {
      name: 'Repair Postgres sequences',
      command: nodeScript('scripts/db-repair-sequences.js', ['--target=postgres']),
      destructive: false,
    },
    {
      name: 'Postgres provider smoke',
      command: ['node', ['scripts/db-provider-smoke.js']],
      env: { ...env, ARUBOT_DB_PROVIDER: 'postgres' },
      destructive: false,
    },
    {
      name: 'Cutover verification',
      command: ['node', ['scripts/db-cutover-verify.js']],
      env: { ...env, ARUBOT_DB_PROVIDER: 'postgres' },
      destructive: false,
    },
  ];

  if (!skipApiSmoke) {
    steps.push({
      name: 'Backend API smoke',
      command: nodeScript('scripts/api-smoke.js', [`--base=${baseUrl}`, '--expect-provider=postgres']),
      env: { ...env, ARUBOT_DB_PROVIDER: 'postgres' },
      destructive: false,
    });
  }

  console.log(JSON.stringify({
    execute,
    provider,
    dumpFile,
    baseUrl,
    skipApiSmoke,
    steps: steps.map((step) => ({
      name: step.name,
      destructive: step.destructive,
      command: commandText(step.command[0], step.command[1]),
    })),
  }, null, 2));

  if (!execute) {
    console.log('[db:cutover-rehearsal] Dry run only. Add --execute to run these steps.');
    return;
  }
  if (confirm !== 'restore-public') {
    throw new Error('Refusing to execute cutover rehearsal without --confirm=restore-public.');
  }

  fs.mkdirSync(path.dirname(dumpFile), { recursive: true });
  for (const step of steps) {
    console.log(`[db:cutover-rehearsal] ${step.name}`);
    await run(step.command[0], step.command[1], step.env || env);
  }
  console.log('[db:cutover-rehearsal] Completed.');
}

main().catch((error) => {
  console.error('[db:cutover-rehearsal] Failed:', error?.message || error);
  process.exitCode = 1;
});
