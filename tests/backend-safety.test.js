const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { STEPS, runBackendSafety } = require('../scripts/verify-backend-safety.cjs');

const root = path.resolve(__dirname, '..');
const readYaml = (file) => yaml.load(fs.readFileSync(path.join(root, file), 'utf8'));
const logger = () => ({ log: jest.fn(), warn: jest.fn(), error: jest.fn() });
const env = { npm_execpath: 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js' };

test('one manifest retains every original deployment check in order', () => {
  expect(STEPS.map(({ args }) => args.join(' '))).toEqual([
    'run audit:production', 'run lint', 'run typecheck', 'test -- --runInBand',
    'run test:drawing', 'run test:avatars', 'run test:wheel', 'run test:emotes',
    'run test:marble', 'run test:accounts', 'run test:donations',
    'run test:chat-runtime', 'run build',
  ]);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const { args } of STEPS) expect(manifest.scripts[args[0] === 'run' ? args[1] : args[0]]).toBeTruthy();
  expect(manifest.scripts['verify:backend']).toBe('node scripts/verify-backend-safety.cjs');
  expect(manifest.scripts.typecheck).toBe('tsc --noEmit --pretty false --incremental false');
});

test('runs installed npm without a shell, preserving argument boundaries and local DB warning', () => {
  const spawn = jest.fn(() => ({ status: 0 }));
  const output = logger();
  expect(runBackendSafety({ env, spawn, logger: output })).toBe(0);
  expect(spawn).toHaveBeenCalledTimes(STEPS.length);
  expect(spawn).toHaveBeenNthCalledWith(4, process.execPath,
    [env.npm_execpath, 'test', '--', '--runInBand'],
    expect.objectContaining({ shell: false, stdio: 'inherit', cwd: root, env }));
  expect(output.warn).toHaveBeenCalledWith(expect.stringContaining('PostgreSQL integration tests will be skipped locally'));
});

test.each(STEPS.map((step, index) => [step.name, index]))('stops and names the failed check: %s', (name, index) => {
  let call = 0;
  const spawn = jest.fn(() => ({ status: call++ === index ? 2 : 0 }));
  const output = logger();
  expect(runBackendSafety({ env, spawn, logger: output })).toBe(2);
  expect(spawn).toHaveBeenCalledTimes(index + 1);
  expect(output.error).toHaveBeenCalledWith(expect.stringContaining(`FAILED: ${name}`));
});

test.each([{ error: new Error('spawn failed') }, { status: null, signal: 'SIGTERM' }])('fails closed on process errors or signals', (result) => {
  const spawn = jest.fn(() => result);
  expect(runBackendSafety({ env, spawn, logger: logger() })).toBe(1);
  expect(spawn).toHaveBeenCalledTimes(1);
});

test('CI refuses silently skipped database integration tests', () => {
  const spawn = jest.fn();
  expect(runBackendSafety({ env: { ...env, CI: 'true' }, spawn, logger: logger() })).toBe(1);
  expect(spawn).not.toHaveBeenCalled();
});

test('GitHub logs identify the failed step and a reproducible command', () => {
  const output = logger();
  expect(runBackendSafety({
    env: { ...env, GITHUB_ACTIONS: 'true', ARUBOT_TEST_POSTGRES_URL: 'postgresql://localhost/arubot_test' },
    spawn: () => ({ status: 1 }), logger: output,
  })).toBe(1);
  expect(output.log).toHaveBeenCalledWith('::group::Production security audit');
  expect(output.log).toHaveBeenCalledWith('::endgroup::');
  expect(output.error).toHaveBeenCalledWith(expect.stringContaining('::error title=Backend safety failed::Production security audit failed. Reproduce with: npm run audit:production'));
});

test('PR and deployment use the same gate, while daily audits cannot deploy', () => {
  const deploy = readYaml('.github/workflows/deploy-backend.yml');
  const safety = readYaml('.github/workflows/backend-safety.yml');
  for (const job of [deploy.jobs.deploy, safety.jobs.verify]) {
    expect(job.steps.find(({ name }) => name === 'Verify backend build safety').run).toBe('npm run verify:backend');
    expect(job.env.ARUBOT_TEST_POSTGRES_URL).toContain('/arubot_test');
    expect(job.services.postgres).toBeDefined();
  }
  expect(safety.on.pull_request.branches).toContain('main');
  expect(safety.on.schedule).toHaveLength(1);
  expect(safety.permissions).toEqual({ contents: 'read' });
  expect(safety.jobs['dependency-audit'].steps.at(-1).run).toBe('npm run audit:production');
  expect(JSON.stringify(safety)).not.toMatch(/secrets\.|ssh |scp |pm2 |pull_request_target/);
  const dependabot = readYaml('.github/dependabot.yml');
  expect(dependabot.updates[0]['versioning-strategy']).toBe('increase-if-necessary');
  expect(dependabot.updates[0].allow).toContainEqual({ 'dependency-type': 'all' });
  expect(dependabot.updates[0].ignore).toContainEqual({ 'dependency-name': '*', 'update-types': ['version-update:semver-major'] });
  expect(dependabot.updates[0].ignore).toContainEqual({ 'dependency-name': 'socket.io-client' });
  expect(dependabot.updates[0].ignore).toContainEqual({ 'dependency-name': 'ws', versions: ['>=3.0.0 <4.0.0'] });
});
