import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { cleanupChatReleases, deployChatRuntime } from '../scripts/deploy-chat-runtime.mjs';

const secret = 'deployment-test-secret-not-production-0123456789';
const publicUrl = 'http://127.0.0.1:3001';
const controlUrl = 'http://127.0.0.1:3701';
const blueUrl = 'http://127.0.0.1:3002';
const greenUrl = 'http://127.0.0.1:3003';

async function fixture(t, flags = {}) {
  const appDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arubot-deploy-'));
  t.after(() => fs.rm(appDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(appDir, 'shared'), { recursive: true });
  const releases = {};
  for (const name of ['pinned-ingress', 'old', 'candidate']) {
    const directory = path.join(appDir, 'releases', name);
    await fs.mkdir(path.join(directory, 'server'), { recursive: true });
    await fs.writeFile(path.join(directory, 'ecosystem.config.cjs'), 'module.exports = {};');
    await fs.writeFile(path.join(directory, 'server/index.js'), '');
    await fs.writeFile(path.join(directory, 'server/chat-ingress-service.mjs'), '');
    releases[name] = directory;
  }
  const link = (name, target) => fs.symlink(target, path.join(appDir, name), process.platform === 'win32' ? 'junction' : 'dir');
  await link('current', releases.old);
  if (!flags.first) await link('ingress-current', releases['pinned-ingress']);
  const entry = (name, cwd, env = {}) => ({ name, pm2_env: { status: 'online', pm_cwd: cwd, pm_exec_path: path.join(cwd, 'server/index.js'), ...env } });
  let processes = flags.first ? [entry('arubot-api', releases.old, { PORT: '3001' })] : [
    entry('arubot-ingress', releases['pinned-ingress'], { PORT: '3001' }),
    entry('arubot-runtime-blue', releases.old, { ARUBOT_RUNTIME_ID: 'old', ARUBOT_RELEASE_SHA: 'old-sha', PORT: '3002' }),
  ];
  const state = {
    protocolVersion: flags.protocolVersion ?? 1, activeRuntimeId: flags.first ? null : 'old',
    activeRuntimeUrl: flags.first ? null : blueUrl, draining: false, inflight: 0, backlog: 0, healthy: true,
  };
  const calls = [];
  const importsSent = [];
  let candidateImports = 0;
  const drained = new Set();
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, publicUrl).pathname;
    const target = req.headers['x-test-target'];
    calls.push({ type: 'http', target, pathname, method: req.method });
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== `Bearer ${secret}`) return send(401, { error: 'unauthorized' });
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    if (target === controlUrl) {
      if (pathname === '/status') return send(200, state);
      if (pathname === '/runtime/drain') {
        if (body.runtimeId !== state.activeRuntimeId) return send(409, {});
        state.draining = true;
        state.inflight = 1;
        state.backlog += 2; // New chats continue to enter the journal during a worker drain.
        return send(200, { ok: true });
      }
      if (pathname === '/runtime/resume') {
        if (body.runtimeId !== state.activeRuntimeId) return send(409, {});
        state.draining = false;
        state.inflight = 0;
        return send(200, { ok: true });
      }
      if (pathname === '/runtime/activate') {
        if (state.activeRuntimeId !== body.expectedRuntimeId || state.inflight !== 0) return send(409, {});
        state.activeRuntimeId = body.runtimeId;
        state.activeRuntimeUrl = body.url;
        state.draining = false;
        return send(200, { ok: true });
      }
    }
    if (pathname === '/api/runtime/drain') {
      if (flags.failDrain && target === blueUrl) return send(503, { ok: false });
      drained.add(target);
      if (!flags.stuckInflight) state.inflight = 0;
      return send(200, { ok: true });
    }
    if (pathname === '/api/runtime/resume') {
      drained.delete(target);
      return send(200, { ok: true });
    }
    if (pathname === '/api/runtime/checkpoint') {
      if (flags.failCheckpoint && target === blueUrl) return send(503, {});
      assert.ok(drained.has(target));
      return send(200, { version: 1, pvd: { currentAt: 73, paused: false }, durableJobs: ['lease-id'], from: target });
    }
    if (pathname === '/api/runtime/import') {
      assert.equal(body.pvd.currentAt, 73);
      assert.deepEqual(body.durableJobs, ['lease-id']);
      if (target === greenUrl) candidateImports += 1;
      if (flags.rejectImport && target === greenUrl) return send(409, { ok: false });
      if (flags.failImportOnce && target === greenUrl && candidateImports === 1) return send(503, { ok: false });
      if (flags.failImport && target === greenUrl) return send(503, { ok: false });
      return send(200, { ok: true });
    }
    if (pathname === '/api/readiness') {
      const workerUrl = target === publicUrl ? state.activeRuntimeUrl : target;
      const worker = processes.find((item) => `http://127.0.0.1:${item.pm2_env.PORT}` === workerUrl);
      const fail = !worker || (flags.failCandidate && worker.pm2_env.ARUBOT_RUNTIME_ID === 'candidate')
        || (flags.failRoute && target === publicUrl && state.activeRuntimeId === 'candidate');
      return send(fail ? 503 : 200, {
        ok: !fail, check: 'readiness', releaseSha: worker?.pm2_env.ARUBOT_RELEASE_SHA,
        readiness: { initialBootstrapCompleted: true }, db: { ok: true },
      });
    }
    send(404, {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const address = `http://127.0.0.1:${server.address().port}`;
  let lostActivation = false;
  let lostImport = false;
  const dependencies = {
    log: () => {},
    exec: async (command, args, options) => {
      assert.equal(command, 'pm2');
      calls.push({ type: 'pm2', args: [...args] });
      if (args[0] === 'jlist') return { stdout: JSON.stringify(processes) };
      if (args[0] === 'start') {
        const env = options.env;
        const name = args[args.indexOf('--only') + 1];
        assert.equal(env.ARUBOT_APP_CWD, releases.candidate);
        assert.equal(env.ARUBOT_CHAT_INGRESS_SECRET, secret);
        assert.equal(env.ARUBOT_CHAT_INGRESS_DATA_DIR, path.join(appDir, 'shared/chat-ingress'));
        processes.push(entry(name, env.ARUBOT_APP_CWD, env));
      }
      if (args[0] === 'stop') processes.find((item) => item.name === args[1]).pm2_env.status = 'stopped';
      if (args[0] === 'delete') {
        assert.notEqual(args[1], 'arubot-ingress', 'ingress must never be deleted');
        const victim = processes.find((item) => item.name === args[1]);
        assert.notEqual(victim?.pm2_env.ARUBOT_RUNTIME_ID, state.activeRuntimeId, 'active worker must never be deleted');
        if (victim?.pm2_env.ARUBOT_RUNTIME_ID === 'old') assert.ok(drained.has(blueUrl), 'old worker must be fully drained before deletion');
        processes = processes.filter((item) => item.name !== args[1]);
      }
      return { stdout: '' };
    },
    fetch: async (url, init) => {
      const parsed = new URL(url);
      const candidateImport = parsed.pathname === '/api/runtime/import' && parsed.origin === greenUrl;
      if (candidateImport) {
        importsSent.push(init.body);
        if (flags.failImportNetworkOnce && importsSent.length === 1) throw new TypeError('Network unavailable');
      }
      const response = await fetch(`${address}${parsed.pathname}`, { ...init, headers: { ...init.headers, 'x-test-target': parsed.origin } });
      if (flags.loseImportResponse && !lostImport && candidateImport) {
        lostImport = true;
        await response.text();
        if (flags.activateAfterLostImport) {
          state.activeRuntimeId = 'candidate';
          state.activeRuntimeUrl = greenUrl;
          state.draining = false;
        }
        throw new TypeError('Import acknowledgment was lost');
      }
      if (flags.loseActivationResponse && !lostActivation && parsed.pathname === '/runtime/activate') {
        lostActivation = true;
        await response.text();
        throw new Error('Activation response was lost');
      }
      return response;
    },
  };
  const options = {
    appDir, releaseDir: releases.candidate, releaseSha: 'candidate-sha', runtimeId: 'candidate', secret,
    timeoutMs: 150, drainTimeoutMs: 100, requestTimeoutMs: 1000, pollMs: 5,
  };
  return { options, dependencies, calls, state, releases, processes: () => processes, drained, importsSent };
}

test('blue/green deploy proves the candidate, drains old work, routes, then deletes old without restarting ingress', async (t) => {
  const f = await fixture(t);
  const result = await deployChatRuntime(f.options, f.dependencies);
  assert.equal(result.runtimeId, 'candidate');
  assert.equal(result.url, greenUrl);
  assert.equal(f.state.backlog, 2);
  const index = (fn) => f.calls.findIndex(fn);
  const ready = index((c) => c.type === 'http' && c.target === greenUrl && c.pathname === '/api/readiness');
  const ingressDrain = index((c) => c.pathname === '/runtime/drain');
  const workerDrain = index((c) => c.pathname === '/api/runtime/drain');
  const activation = index((c) => c.pathname === '/runtime/activate');
  const checkpoint = index((c) => c.pathname === '/api/runtime/checkpoint');
  const imported = index((c) => c.pathname === '/api/runtime/import');
  const routed = index((c) => c.target === publicUrl && c.pathname === '/api/readiness');
  const deletion = index((c) => c.type === 'pm2' && c.args[0] === 'delete');
  assert.ok(ready < ingressDrain && ingressDrain < workerDrain && workerDrain < activation && activation < routed && routed < deletion);
  assert.ok(workerDrain < checkpoint && checkpoint < imported && imported < activation);
  assert.ok(!f.calls.some((c) => c.type === 'pm2' && c.args.some((arg) => ['restart', 'reload', 'startOrReload', 'arubot-api', 'arubot-ingress'].includes(arg))));
  assert.equal(await fs.realpath(path.join(f.options.appDir, 'current')), await fs.realpath(f.releases.candidate));
  assert.equal(await fs.realpath(path.join(f.options.appDir, 'ingress-current')), await fs.realpath(f.releases['pinned-ingress']));
  assert.ok(await fs.stat(f.releases.old));
});

test('candidate readiness failure never drains or stops the existing worker', async (t) => {
  const f = await fixture(t, { failCandidate: true });
  await assert.rejects(deployChatRuntime(f.options, f.dependencies), /Candidate readiness timed out/);
  assert.equal(f.state.activeRuntimeId, 'old');
  assert.ok(!f.calls.some((c) => c.pathname === '/runtime/drain'));
  assert.ok(f.processes().some((entry) => entry.name === 'arubot-runtime-blue'));
  assert.ok(!f.processes().some((entry) => entry.name === 'arubot-runtime-green'));
});

for (const flag of ['failDrain', 'stuckInflight', 'failCheckpoint']) {
  test(`${flag} aborts activation, resumes the old worker and preserves ingress`, async (t) => {
    const f = await fixture(t, { [flag]: true });
    await assert.rejects(deployChatRuntime(f.options, f.dependencies));
    assert.ok(!f.calls.some((c) => c.pathname === '/runtime/activate'));
    assert.equal(f.state.activeRuntimeId, 'old');
    assert.equal(f.state.draining, false);
    assert.ok(f.calls.some((c) => c.pathname === '/api/runtime/resume'));
    assert.ok(f.calls.some((c) => c.pathname === '/runtime/resume'));
  });
}

test('unconfirmed import never overwrites old state with an empty candidate or deletes either worker', async (t) => {
  const f = await fixture(t, { failImport: true });
  await assert.rejects(deployChatRuntime(f.options, f.dependencies), /Checkpoint import outcome is unconfirmed/);
  assert.equal(f.state.activeRuntimeId, 'old');
  assert.equal(f.state.draining, true);
  assert.ok(!f.calls.some((c) => c.pathname === '/runtime/activate' || c.pathname === '/api/runtime/resume'));
  assert.equal(f.calls.filter((c) => c.pathname === '/api/runtime/import').length, 3);
  assert.ok(f.processes().some((item) => item.name === 'arubot-runtime-blue'));
  assert.ok(f.processes().some((item) => item.name === 'arubot-runtime-green'));
});

for (const flag of ['loseImportResponse', 'failImportOnce', 'failImportNetworkOnce']) {
  test(`${flag}: exact checkpoint import retry confirms standby state before activation`, async (t) => {
    const f = await fixture(t, { [flag]: true });
    await deployChatRuntime(f.options, f.dependencies);
    assert.equal(f.state.activeRuntimeId, 'candidate');
    assert.equal(f.importsSent.length, 2);
    assert.equal(new Set(f.importsSent).size, 1, 'retries must be byte-identical');
    assert.equal(f.calls.filter((c) => c.pathname === '/api/runtime/checkpoint').length, 1, 'never recapture state for retries');
    const activation = f.calls.findIndex((c) => c.pathname === '/runtime/activate');
    assert.ok(activation > f.calls.findLastIndex((c) => c.pathname === '/api/runtime/import'));
    assert.ok(!f.processes().some((entry) => entry.name === 'arubot-runtime-blue'));
  });
}

test('import is never retried after the candidate becomes active, even when its acknowledgment was lost', async (t) => {
  const f = await fixture(t, { loseImportResponse: true, activateAfterLostImport: true });
  await assert.rejects(deployChatRuntime(f.options, f.dependencies), /Import reconciliation refused/);
  assert.equal(f.importsSent.length, 1);
  assert.equal(f.state.activeRuntimeId, 'candidate');
  assert.ok(f.processes().some((entry) => entry.name === 'arubot-runtime-blue'));
  assert.ok(f.processes().some((entry) => entry.name === 'arubot-runtime-green'));
});

test('a deterministic import rejection is not retried', async (t) => {
  const f = await fixture(t, { rejectImport: true });
  await assert.rejects(deployChatRuntime(f.options, f.dependencies), /HTTP 409/);
  assert.equal(f.importsSent.length, 1);
  assert.equal(f.state.activeRuntimeId, 'old');
});

for (const flag of ['failRoute', 'loseActivationResponse']) {
  test(`${flag} drains candidate before CAS rollback and resumes the original worker`, async (t) => {
    const f = await fixture(t, { [flag]: true });
    await assert.rejects(deployChatRuntime(f.options, f.dependencies));
    assert.equal(f.state.activeRuntimeId, 'old');
    assert.equal(f.state.draining, false);
    assert.ok(f.drained.has(greenUrl));
    assert.ok(!f.drained.has(blueUrl));
    assert.equal(f.calls.filter((c) => c.pathname === '/runtime/activate').length, 2);
    assert.ok(f.calls.some((c) => c.pathname === '/api/runtime/import' && c.target === blueUrl));
    assert.equal(await fs.realpath(path.join(f.options.appDir, 'current')), await fs.realpath(f.releases.old));
    assert.ok(f.processes().some((item) => item.name === 'arubot-runtime-blue'));
    assert.ok(!f.processes().some((item) => item.name === 'arubot-runtime-green'));
  });
}

test('protocol incompatibility aborts before starting, stopping or draining any process', async (t) => {
  const f = await fixture(t, { protocolVersion: 2 });
  await assert.rejects(deployChatRuntime(f.options, f.dependencies), /protocol mismatch/);
  assert.ok(f.calls.filter((c) => c.type === 'pm2').every((c) => c.args[0] === 'jlist'));
});

test('first migration refuses a live legacy process unless maintenance was explicitly authorized', async (t) => {
  const f = await fixture(t, { first: true });
  await assert.rejects(deployChatRuntime(f.options, f.dependencies), /First migration is disruptive/);
  assert.ok(!f.calls.some((c) => c.type === 'pm2' && c.args[0] !== 'jlist'));
  const result = await deployChatRuntime({ ...f.options, allowLegacyMigration: true }, f.dependencies);
  assert.equal(result.url, blueUrl);
  assert.ok(!f.processes().some((item) => item.name === 'arubot-api'));
  assert.ok(f.processes().some((item) => item.name === 'arubot-ingress'));
  const legacyDeletion = f.calls.findIndex((c) => c.type === 'pm2' && c.args[0] === 'delete' && c.args[1] === 'arubot-api');
  const routedReady = f.calls.findIndex((c) => c.target === publicUrl && c.pathname === '/api/readiness');
  assert.ok(legacyDeletion > routedReady && routedReady > 0);
});

test('failed first migration retains the stopped legacy PM2 entry for recovery', async (t) => {
  const f = await fixture(t, { first: true, failCandidate: true });
  await assert.rejects(deployChatRuntime({ ...f.options, allowLegacyMigration: true }, f.dependencies), /Candidate readiness timed out/);
  assert.equal(f.processes().find((item) => item.name === 'arubot-api').pm2_env.status, 'stopped');
  assert.ok(!f.calls.some((c) => c.type === 'pm2' && c.args[0] === 'delete' && c.args[1] === 'arubot-api'));
});

test('preflight does not mutate PM2 or either release link', async (t) => {
  const f = await fixture(t);
  assert.equal((await deployChatRuntime({ ...f.options, preflightOnly: true }, f.dependencies)).preflight, true);
  assert.ok(f.calls.filter((c) => c.type === 'pm2').every((c) => c.args[0] === 'jlist'));
  assert.equal(await fs.realpath(path.join(f.options.appDir, 'current')), await fs.realpath(f.releases.old));
});

test('concurrent deployment lock rejects a second deployment without removing the first lock', async (t) => {
  const f = await fixture(t);
  const lock = path.join(f.options.appDir, 'shared/chat-runtime-deploy.lock');
  await fs.mkdir(lock);
  await assert.rejects(deployChatRuntime(f.options, f.dependencies), /Another deployment holds/);
  assert.ok((await fs.stat(lock)).isDirectory());
});

test('cleanup protects all PM2 paths, pinned ingress, rollback and at least two newest releases', async (t) => {
  const f = await fixture(t);
  const root = path.join(f.options.appDir, 'releases');
  for (const [index, name] of ['unused-old', 'newer-a', 'newer-b', 'other-pm2'].entries()) {
    await fs.mkdir(path.join(root, name));
    const time = new Date(Date.now() + (index - 2) * 10000);
    await fs.utimes(path.join(root, name), time, time);
  }
  const removed = await cleanupChatReleases({
    appDir: f.options.appDir, keep: 0, processes: [...f.processes(), { name: 'other-service', pm2_env: { pm_cwd: path.join(root, 'other-pm2') } }],
    protectedPaths: [f.releases.candidate, f.releases.old], log: () => {},
  });
  assert.deepEqual(removed.map((item) => path.basename(item)).sort(), ['newer-a', 'unused-old']);
  for (const name of ['pinned-ingress', 'old', 'candidate', 'newer-b', 'other-pm2']) assert.ok(await fs.stat(path.join(root, name)));
});

test('bad credentials, off-host control URL and occupied candidate slot fail closed', async (t) => {
  const f = await fixture(t);
  await assert.rejects(deployChatRuntime({ ...f.options, secret: 'short' }, f.dependencies), /32-4096/);
  await assert.rejects(deployChatRuntime({ ...f.options, controlUrl: 'https://example.com' }, f.dependencies), /127.0.0.1/);
  f.processes().push({ name: 'arubot-runtime-green', pm2_env: { status: 'stopped' } });
  await assert.rejects(deployChatRuntime(f.options, f.dependencies), /occupied/);
});

test('PM2 modes isolate ports, shared ingress storage and immutable release cwd, while legacy remains the default', async () => {
  const source = await fs.readFile(new URL('../ecosystem.config.cjs', import.meta.url), 'utf8');
  const release = path.resolve(os.tmpdir(), 'arubot-config/releases/new');
  const dataDir = path.resolve(os.tmpdir(), 'arubot-config/shared/chat-ingress');
  const config = (extra = {}) => {
    const sandbox = {
      module: { exports: {} }, process: { env: { ARUBOT_APP_CWD: release, ...extra } },
      require: (name) => {
        if (name === 'path') return path;
        if (name === 'fs') return { mkdirSync: () => {} };
        if (name === 'dotenv') return { config: () => {} };
        throw new Error(`Unexpected require ${name}`);
      },
    };
    vm.runInNewContext(source, sandbox);
    return sandbox.module.exports.apps[0];
  };
  assert.equal(config().name, 'arubot-api');
  const env = { ARUBOT_ENABLE_CHAT_INGRESS: 'true', ARUBOT_CHAT_INGRESS_SECRET: secret, ARUBOT_CHAT_INGRESS_DATA_DIR: dataDir };
  assert.throws(() => config(env), /legacy PM2 reload/);
  const ingress = config({ ...env, ARUBOT_PM2_MODE: 'ingress' });
  assert.equal(ingress.name, 'arubot-ingress');
  assert.equal(ingress.cwd, release);
  assert.equal(ingress.script, 'server/chat-ingress-service.mjs');
  assert.equal(ingress.env.ARUBOT_CHAT_INGRESS_DATA_DIR, dataDir);
  assert.equal(ingress.wait_ready, true);
  const runtime = config({ ...env, ARUBOT_PM2_MODE: 'runtime', ARUBOT_RUNTIME_ID: 'release-unique', ARUBOT_RUNTIME_NAME: 'arubot-runtime-green', PORT: '3003' });
  assert.equal(runtime.name, 'arubot-runtime-green');
  assert.equal(runtime.env.SERVER_HOST, '127.0.0.1');
  assert.equal(runtime.env.PORT, '3003');
  assert.throws(() => config({ ...env, ARUBOT_PM2_MODE: 'ingress', ARUBOT_CHAT_INGRESS_DATA_DIR: path.join(release, 'data') }), /outside the release/);
  assert.throws(() => config({ ...env, ARUBOT_PM2_MODE: 'runtime', ARUBOT_RUNTIME_ID: 'release-unique' }), /3002\/3003/);
});

test('artifact verification follows the independent ingress entrypoint and deployment imports', async (t) => {
  const f = await fixture(t);
  const require = createRequire(import.meta.url);
  const { verifyBackendArtifact } = require('../scripts/verify-backend-artifact.cjs');
  await fs.writeFile(path.join(f.releases.candidate, 'server/chat-ingress-service.mjs'), "import './missing-ingress-store.js';");
  assert.throws(() => verifyBackendArtifact(f.releases.candidate, ['server/index.js', 'server/chat-ingress-service.mjs']), /missing-ingress-store/);
});

test('workflow keeps legacy opt-in, serializes releases, checks deploy tests and verifies before switching', async () => {
  const workflow = (await fs.readFile(new URL('../.github/workflows/deploy-backend.yml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /flock -w 900 9/);
  assert.match(workflow, /run: npm run verify:backend/);
  const { STEPS } = await import('../scripts/verify-backend-safety.cjs');
  assert.ok(STEPS.some(({ args }) => args.join(' ') === 'run test:chat-runtime'));
  const manifest = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.scripts['test:chat-runtime'], 'node --test tests/chat-ingress*.test.mjs tests/chat-runtime*.test.mjs tests/runtime-handoff*.test.mjs');
  assert.ok(workflow.indexOf('node scripts/deploy-chat-runtime.mjs --preflight') < workflow.lastIndexOf('npm run db:migrate'));
  assert.ok(workflow.lastIndexOf('npm run db:provider-smoke') < workflow.lastIndexOf('node scripts/deploy-chat-runtime.mjs\n'));
  assert.ok(workflow.lastIndexOf('exit 0') < workflow.lastIndexOf('switch_current_release'));
});
