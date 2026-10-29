const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const STEPS = [
  { name: 'Production security audit', args: ['run', 'audit:production'] },
  { name: 'Lint', args: ['run', 'lint'] },
  { name: 'TypeScript', args: ['run', 'typecheck'] },
  { name: 'Backend regression tests', args: ['test', '--', '--runInBand'] },
  { name: 'Drawing tests', args: ['run', 'test:drawing'] },
  { name: 'Avatar tests', args: ['run', 'test:avatars'] },
  { name: 'Wheel tests', args: ['run', 'test:wheel'] },
  { name: 'Emote tests', args: ['run', 'test:emotes'] },
  { name: 'Marble tests', args: ['run', 'test:marble'] },
  { name: 'Account tests', args: ['run', 'test:accounts'] },
  { name: 'Donation tests', args: ['run', 'test:donations'] },
  { name: 'Chat runtime and deployment tests', args: ['run', 'test:chat-runtime'] },
  { name: 'Production build', args: ['run', 'build'] },
];

function runBackendSafety({ env = process.env, spawn = spawnSync, logger = console } = {}) {
  logger.log(`[backend safety] Node ${process.version}`);
  if (!env.ARUBOT_TEST_POSTGRES_URL) {
    if (env.CI === 'true' || env.GITHUB_ACTIONS === 'true') {
      logger.error('[backend safety] CI requires ARUBOT_TEST_POSTGRES_URL; database tests must not be skipped.');
      return 1;
    }
    logger.warn('[backend safety] ARUBOT_TEST_POSTGRES_URL is unset; PostgreSQL integration tests will be skipped locally.');
  }

  // Use npm's current CLI with Node so Windows paths with spaces need no shell quoting.
  const npmExecPath = env.npm_execpath;
  for (const step of STEPS) {
    const command = `npm ${step.args.join(' ')}`;
    if (env.GITHUB_ACTIONS === 'true') logger.log(`::group::${step.name}`);
    logger.log(`[backend safety] ${step.name}: ${command}`);
    let result;
    try {
      result = spawn(npmExecPath ? process.execPath : 'npm', npmExecPath ? [npmExecPath, ...step.args] : step.args, {
        cwd: ROOT,
        env,
        stdio: 'inherit',
        shell: !npmExecPath && process.platform === 'win32',
      });
    } catch (error) {
      result = { error };
    }
    if (env.GITHUB_ACTIONS === 'true') logger.log('::endgroup::');
    if (result.error || result.status !== 0) {
      const reason = String(result.error?.message || result.signal || `exit ${result.status}`).replace(/[\r\n]/g, ' ');
      logger.error(`[backend safety] FAILED: ${step.name} (${reason}). Reproduce with: ${command}`);
      if (env.GITHUB_ACTIONS === 'true') {
        logger.error(`::error title=Backend safety failed::${step.name} failed. Reproduce with: ${command}`);
      }
      return Number.isInteger(result.status) && result.status > 0 ? result.status : 1;
    }
    logger.log(`[backend safety] PASSED: ${step.name}`);
  }
  logger.log(`[backend safety] All ${STEPS.length} checks passed.`);
  return 0;
}

module.exports = { STEPS, runBackendSafety };

if (require.main === module) process.exitCode = runBackendSafety();
