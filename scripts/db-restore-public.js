import { spawn } from 'child_process';
import fs from 'fs';
import { resolveDatabaseUrl, getDbProvider } from './db-common.js';

function parseArg(name, fallback = null) {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : fallback;
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
  const confirm = parseArg('confirm');
  if (confirm !== 'restore-public') {
    throw new Error('Refusing to restore without --confirm=restore-public. This command uses --clean --if-exists on the target public schema.');
  }

  const target = parseArg('target', 'current');
  const provider = target === 'current' ? getDbProvider() : target;
  const dbUrl = resolveDatabaseUrl(target);
  if (!dbUrl) throw new Error(`Missing database URL for target "${target}".`);

  const file = parseArg('file');
  if (!file) throw new Error('Missing --file=<dump path>.');
  if (!fs.existsSync(file)) throw new Error(`Dump file not found: ${file}`);

  console.log(`[db:restore-public] target=${target} provider=${provider} file=${file}`);
  await run('pg_restore', [
    '--dbname',
    dbUrl,
    '--schema=public',
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-acl',
    file,
  ], process.env);
  console.log('[db:restore-public] Completed.');
}

main().catch((error) => {
  console.error('[db:restore-public] Failed:', error?.message || error);
  process.exitCode = 1;
});
