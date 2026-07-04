import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { resolveDatabaseUrl, getDbProvider } from './db-common.js';

function parseArg(name, fallback = null) {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : fallback;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
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
  const target = parseArg('target', 'current');
  const provider = target === 'current' ? getDbProvider() : target;
  const dbUrl = resolveDatabaseUrl(target);
  if (!dbUrl) throw new Error(`Missing database URL for target "${target}".`);

  const output = parseArg('out', path.join('backups', `${provider}-public-${timestamp()}.dump`));
  fs.mkdirSync(path.dirname(output), { recursive: true });

  console.log(`[db:dump-public] target=${target} provider=${provider} out=${output}`);
  await run('pg_dump', [
    dbUrl,
    '--schema=public',
    '--format=custom',
    '--blobs',
    '--no-owner',
    '--no-acl',
    '--file',
    output,
  ], process.env);
  console.log('[db:dump-public] Completed.');
}

main().catch((error) => {
  console.error('[db:dump-public] Failed:', error?.message || error);
  process.exitCode = 1;
});
