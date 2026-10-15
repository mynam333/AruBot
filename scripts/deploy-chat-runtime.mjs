import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const executeFile = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PROTOCOL_VERSION = 1;
const INGRESS_NAME = 'arubot-ingress';
const MAX_CHECKPOINT_BYTES = 16 * 1024 * 1024;
const slots = [{ name: 'arubot-runtime-blue', port: 3002 }, { name: 'arubot-runtime-green', port: 3003 }];

function loopbackUrl(value, label) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${label} must be a plain http://127.0.0.1:port URL`);
  }
  return url.origin;
}

function processEnv(entry) {
  return { ...entry?.pm2_env?.env, ...entry?.pm2_env };
}

function validateStatus(status) {
  if (status?.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error('Ingress protocol mismatch; the pinned ingress requires a separate maintenance upgrade');
  }
  if (status.healthy !== true || !Number.isSafeInteger(status.inflight) || status.inflight < 0 || !Number.isSafeInteger(status.backlog) || status.backlog < 0) {
    throw new Error('Ingress is not healthy or its status contract is incomplete');
  }
  if (Boolean(status.activeRuntimeId) !== Boolean(status.activeRuntimeUrl)) throw new Error('Ingress runtime identity is inconsistent');
  if (status.activeRuntimeUrl) loopbackUrl(status.activeRuntimeUrl, 'Active runtime URL');
  return status;
}

async function realpathOrNull(filename) {
  try { return await fs.realpath(filename); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function replaceLink(link, target) {
  const current = await fs.lstat(link).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
  if (current && !current.isSymbolicLink()) throw new Error(`Refusing to replace a non-symlink path: ${link}`);
  const temporary = `${link}.next-${process.pid}-${Date.now()}`;
  try {
    await fs.symlink(target, temporary, process.platform === 'win32' ? 'junction' : 'dir');
    if (process.platform === 'win32' && current) {
      // Windows cannot replace a directory junction with rename; production Linux uses the atomic branch.
      const backup = `${temporary}.previous`;
      await fs.rename(link, backup);
      try { await fs.rename(temporary, link); } catch (error) { await fs.rename(backup, link); throw error; }
      await fs.rm(backup, { force: true });
    } else {
      await fs.rename(temporary, link);
    }
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function within(directory, target) {
  const relative = path.relative(directory, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Protect every PM2 cwd/script, symlink target and explicit rollback release, not only current. */
export async function cleanupChatReleases({ appDir, keep = 2, processes, protectedPaths = [], log = console.log }) {
  const root = await fs.realpath(path.join(appDir, 'releases'));
  const protectedTargets = [];
  for (const target of [path.join(appDir, 'current'), path.join(appDir, 'ingress-current'), ...protectedPaths]) {
    const real = await realpathOrNull(target);
    if (real) protectedTargets.push(real);
  }
  for (const entry of processes) {
    const env = processEnv(entry);
    for (const target of [env.pm_cwd, env.pm_exec_path, env.ARUBOT_APP_CWD]) {
      if (!target) continue;
      // An unreadable referenced path is not grounds to delete a possibly-live release.
      const real = await fs.realpath(target);
      protectedTargets.push(real);
    }
  }
  const releases = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const filename = path.join(root, entry.name);
    const real = await fs.realpath(filename);
    if (!within(root, real) || path.dirname(real) !== root) throw new Error('Release cleanup target escapes the release directory');
    releases.push({ filename, real, mtime: (await fs.stat(filename)).mtimeMs });
  }
  releases.sort((a, b) => b.mtime - a.mtime);
  const count = Math.max(2, Number.isSafeInteger(Number(keep)) ? Number(keep) : 2);
  const retained = new Set(releases.slice(0, count).map((release) => release.real));
  for (const release of releases) {
    if (protectedTargets.some((target) => target === release.real || within(release.real, target))) retained.add(release.real);
  }
  const removed = [];
  for (const release of releases) {
    if (retained.has(release.real)) continue;
    log(`Removing unused release: ${release.filename}`);
    await fs.rm(release.filename, { recursive: true, force: false });
    removed.push(release.filename);
  }
  return removed;
}

/** All process starts use immutable release paths; ingress is created once and never reloaded here. */
export async function deployChatRuntime(options, dependencies = {}) {
  const exec = dependencies.exec || executeFile;
  const fetch = dependencies.fetch || globalThis.fetch;
  const wait = dependencies.sleep || sleep;
  const now = dependencies.now || Date.now;
  const log = dependencies.log || console.log;
  const appDir = path.resolve(options.appDir);
  const releaseDir = await fs.realpath(options.releaseDir);
  const releaseSha = String(options.releaseSha || '');
  const runtimeId = String(options.runtimeId || path.basename(releaseDir));
  const secret = String(options.secret || '');
  if (secret.length < 32 || secret.length > 4096 || /[\r\n]/.test(secret)) throw new Error('ARUBOT_CHAT_INGRESS_SECRET must contain 32-4096 characters and no newlines');
  if (!/^[a-zA-Z0-9_.-]{1,160}$/.test(runtimeId) || !releaseSha) throw new Error('Unique runtime ID and release SHA are required');
  const controlUrl = loopbackUrl(options.controlUrl || 'http://127.0.0.1:3701', 'Ingress control URL');
  const publicUrl = loopbackUrl(options.publicUrl || 'http://127.0.0.1:3001', 'Public gateway URL');
  if (controlUrl === publicUrl || [controlUrl, publicUrl].some((url) => slots.some((slot) => url === `http://127.0.0.1:${slot.port}`))) {
    throw new Error('Ingress public/control ports must be distinct from each other and worker ports');
  }
  const timeoutMs = options.timeoutMs ?? 120000;
  const drainTimeoutMs = options.drainTimeoutMs ?? 60000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 5000;
  const pollMs = options.pollMs ?? 500;
  const sharedDir = path.join(appDir, 'shared');
  const lockDir = path.join(sharedDir, 'chat-runtime-deploy.lock');
  await fs.mkdir(sharedDir, { recursive: true });
  try { await fs.mkdir(lockDir); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another deployment holds chat-runtime-deploy.lock; do not overlap deployments');
    throw error;
  }
  const pm2 = async (args, env = {}) => exec(options.pm2Binary || 'pm2', args, {
    cwd: releaseDir, env: { ...process.env, ...env }, timeout: timeoutMs + 30000, maxBuffer: 16 * 1024 * 1024,
  });
  const listProcesses = async () => {
    const { stdout } = await pm2(['jlist']);
    const entries = JSON.parse(stdout);
    if (!Array.isArray(entries)) throw new Error('Invalid PM2 process list');
    return entries;
  };
  const request = async (base, pathname, body, allowedMs = requestTimeoutMs, encodedBody) => {
    const serialized = encodedBody ?? (body === undefined ? undefined : JSON.stringify(body));
    if (serialized && Buffer.byteLength(serialized) > MAX_CHECKPOINT_BYTES) throw new Error('Runtime checkpoint exceeds 16 MiB');
    let response;
    try {
      response = await fetch(`${base}${pathname}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${secret}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: serialized }),
        redirect: 'error', signal: AbortSignal.timeout(allowedMs),
      });
    } catch {
      const error = new Error(`Request failed at ${pathname}`);
      error.retryable = true;
      throw error;
    }
    if (!response.ok) {
      await response.body?.cancel();
      const error = new Error(`HTTP ${response.status} at ${pathname}`);
      error.retryable = response.status >= 500;
      throw error;
    }
    if (Number(response.headers.get('content-length')) > MAX_CHECKPOINT_BYTES) {
      await response.body?.cancel();
      throw new Error('Runtime response exceeds 16 MiB');
    }
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_CHECKPOINT_BYTES) throw new Error('Runtime response exceeds 16 MiB');
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      const error = new Error(size > MAX_CHECKPOINT_BYTES ? 'Runtime response exceeds 16 MiB' : `Invalid or interrupted JSON response at ${pathname}`);
      error.retryable = size <= MAX_CHECKPOINT_BYTES;
      throw error;
    }
  };
  const status = async () => validateStatus(await request(controlUrl, '/status'));
  const until = async (probe, label, duration = timeoutMs) => {
    const deadline = now() + duration;
    let cause;
    do {
      try { const result = await probe(); if (result) return result; } catch (error) { cause = error; }
      await wait(pollMs);
    } while (now() < deadline);
    throw new Error(`${label} timed out${cause ? `: ${cause.message}` : ''}`);
  };
  const ready = async (url, sha = releaseSha) => {
    const body = await request(url, '/api/readiness');
    return body.ok === true && body.check === 'readiness' && body.releaseSha === sha
      && body.readiness?.initialBootstrapCompleted === true && body.db?.ok === true;
  };
  const drainWorker = async (runtime) => {
    const result = await request(runtime.url, '/api/runtime/drain', { timeoutMs: drainTimeoutMs }, drainTimeoutMs + requestTimeoutMs);
    if (result.ok !== true) throw new Error('Worker did not confirm its drain');
  };
  const drain = async (runtime) => {
    await request(controlUrl, '/runtime/drain', { runtimeId: runtime.id });
    await drainWorker(runtime);
    await until(async () => {
      const state = await status();
      if (state.activeRuntimeId !== runtime.id) throw new Error('Runtime changed during drain');
      return state.draining === true && state.inflight === 0;
    }, 'Runtime drain', drainTimeoutMs);
  };
  const resume = async (runtime) => {
    const result = await request(runtime.url, '/api/runtime/resume', {});
    if (result.ok !== true) throw new Error('Worker did not confirm resume');
    await request(controlUrl, '/runtime/resume', { runtimeId: runtime.id });
  };
  const transfer = async (from, to, beforeImport = () => {}, retryWhileInactive = false) => {
    const checkpoint = await request(from.url, '/api/runtime/checkpoint');
    const encoded = JSON.stringify(checkpoint);
    for (let attempt = 1; ; attempt += 1) {
      if (retryWhileInactive) {
        const active = await status();
        if (active.activeRuntimeId !== from.id || active.activeRuntimeUrl !== from.url || !active.draining || active.inflight !== 0) {
          throw new Error('Import reconciliation refused: source is no longer drained and active; never replay a checkpoint after candidate activation');
        }
      }
      beforeImport();
      try {
        const imported = await request(to.url, '/api/runtime/import', checkpoint, requestTimeoutMs, encoded);
        if (imported.ok !== true) throw new Error('Worker did not confirm checkpoint import');
        return;
      } catch (error) {
        if (!retryWhileInactive || error.retryable !== true || attempt >= 3) throw error;
        // Reuse the exact original body, not a fresh checkpoint; import is idempotent only while standby.
        await wait(pollMs * attempt);
      }
    }
  };
  let old = null;
  let candidate = null;
  let candidateStarted = false;
  let attemptedDrain = false;
  let attemptedActivation = false;
  let attemptedImport = false;
  let confirmedImport = false;
  let committed = false;
  let previousCurrent = null;
  try {
    await fs.writeFile(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, runtimeId, startedAt: new Date().toISOString() }), { mode: 0o600 });
    const releasesDir = await fs.realpath(path.join(appDir, 'releases'));
    if (!within(releasesDir, releaseDir) || path.dirname(releaseDir) !== releasesDir) throw new Error('Candidate must be an immutable direct child of releases/');
    for (const filename of ['ecosystem.config.cjs', 'server/index.js', 'server/chat-ingress-service.mjs']) await fs.access(path.join(releaseDir, filename));
    previousCurrent = await realpathOrNull(path.join(appDir, 'current'));
    const currentInfo = await fs.lstat(path.join(appDir, 'current')).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
    if (currentInfo && !currentInfo.isSymbolicLink()) throw new Error('Convert current to a release symlink during maintenance before enabling chat ingress');
    let entries = await listProcesses();
    const ingress = entries.find((entry) => entry.name === INGRESS_NAME);
    const legacyEntry = entries.find((entry) => entry.name === 'arubot-api');
    const legacy = legacyEntry && !['stopped', 'errored'].includes(legacyEntry.pm2_env?.status) ? legacyEntry : null;
    if (!ingress && legacy && options.allowLegacyMigration !== true) {
      throw new Error('Legacy arubot-api owns the public port. First migration is disruptive: explicitly set ARUBOT_ALLOW_CHAT_INGRESS_MIGRATION=true during maintenance');
    }
    if (ingress) {
      if (ingress.pm2_env?.status !== 'online') throw new Error('Pinned arubot-ingress is not online; normal deployment never restarts it');
      const pinned = await fs.realpath(processEnv(ingress).pm_cwd);
      const link = await realpathOrNull(path.join(appDir, 'ingress-current'));
      if (link !== pinned) throw new Error('ingress-current does not match the pinned PM2 cwd');
    }
    let state = ingress ? await status() : null;
    if (state?.draining) throw new Error('Ingress is already draining; recover the previous deployment before retrying');
    if (state?.activeRuntimeId === runtimeId) throw new Error('Runtime ID is already active; use a new unique release directory');
    if (state?.activeRuntimeId) {
      const entry = entries.find((item) => processEnv(item).ARUBOT_RUNTIME_ID === state.activeRuntimeId);
      if (!entry || !processEnv(entry).ARUBOT_RELEASE_SHA || !slots.some((slot) => slot.name === entry.name && state.activeRuntimeUrl === `http://127.0.0.1:${slot.port}`)) {
        throw new Error('Active ingress runtime does not match a managed blue/green PM2 worker');
      }
      old = { id: state.activeRuntimeId, url: state.activeRuntimeUrl, name: entry.name, cwd: await fs.realpath(processEnv(entry).pm_cwd), sha: processEnv(entry).ARUBOT_RELEASE_SHA };
    }
    const slot = slots.find((item) => old?.url !== `http://127.0.0.1:${item.port}`);
    if (entries.some((item) => item.name === slot.name || (Number(processEnv(item).PORT) === slot.port && item.pm2_env?.status === 'online'))) {
      throw new Error(`Candidate slot ${slot.name} is occupied; refuse to kill an unverified runtime`);
    }
    candidate = { id: runtimeId, url: `http://127.0.0.1:${slot.port}`, name: slot.name };
    if (options.preflightOnly) return { preflight: true, migrationRequired: !ingress && !!legacy };
    const commonEnv = {
      ARUBOT_APP_CWD: releaseDir, ARUBOT_RELEASE_SHA: releaseSha,
      ARUBOT_ENABLE_CHAT_INGRESS: 'true', ARUBOT_CHAT_INGRESS_SECRET: secret,
      ARUBOT_CHAT_INGRESS_URL: controlUrl, ARUBOT_CHAT_INGRESS_PORT: new URL(controlUrl).port || '80',
      ARUBOT_CHAT_INGRESS_DATA_DIR: path.join(sharedDir, 'chat-ingress'),
    };
    if (!ingress) {
      if (legacy) {
        log('First migration: stopping legacy API with explicit maintenance authorization');
        await pm2(['stop', 'arubot-api']);
      }
      await fs.mkdir(commonEnv.ARUBOT_CHAT_INGRESS_DATA_DIR, { recursive: true, mode: 0o700 });
      await replaceLink(path.join(appDir, 'ingress-current'), releaseDir);
      await pm2(['start', path.join(releaseDir, 'ecosystem.config.cjs'), '--only', INGRESS_NAME, '--env', 'production', '--update-env'], {
        ...commonEnv, ARUBOT_PM2_MODE: 'ingress', PORT: new URL(publicUrl).port || '80', SERVER_PORT: new URL(publicUrl).port || '80',
      });
      // Persist the stable ingress even if the first candidate subsequently fails readiness.
      await pm2(['save']);
      state = await until(status, 'Ingress startup');
      if (state.activeRuntimeId) throw new Error('New ingress unexpectedly recovered an active runtime; inspect it before deployment');
    }
    log(`Preparing ${candidate.name} (${runtimeId}) while ingress remains online`);
    candidateStarted = true;
    await pm2(['start', path.join(releaseDir, 'ecosystem.config.cjs'), '--only', slot.name, '--env', 'production', '--update-env'], {
      ...commonEnv, ARUBOT_PM2_MODE: 'runtime', ARUBOT_RUNTIME_ID: runtimeId, ARUBOT_RUNTIME_NAME: slot.name,
      PORT: String(slot.port), SERVER_PORT: String(slot.port), SERVER_HOST: '127.0.0.1',
    });
    await until(() => ready(candidate.url), 'Candidate readiness');
    if (old) {
      attemptedDrain = true;
      await drain(old);
      // Even a lost import response can mean that durable job ownership already moved.
      await transfer(old, candidate, () => { attemptedImport = true; }, true);
      confirmedImport = true;
    }
    const beforeActivation = await status();
    if (beforeActivation.activeRuntimeId !== (old?.id || null) || beforeActivation.inflight !== 0) throw new Error('Ingress changed before activation');
    attemptedActivation = true;
    await request(controlUrl, '/runtime/activate', { runtimeId, url: candidate.url, expectedRuntimeId: old?.id || null });
    const resumed = await request(candidate.url, '/api/runtime/resume', {});
    if (resumed.ok !== true) throw new Error('Candidate did not confirm activation');
    await until(async () => {
      const active = await status();
      return active.activeRuntimeId === runtimeId && active.activeRuntimeUrl === candidate.url && !active.draining
        && await ready(candidate.url) && await ready(publicUrl);
    }, 'Routed candidate readiness');
    await replaceLink(path.join(appDir, 'current'), releaseDir);
    // Keep the drained old process in PM2's saved state until the candidate is proven and routed.
    await pm2(['save']);
    committed = true;
    if (old) {
      await pm2(['delete', old.name]);
      await pm2(['save']);
    }
    entries = await listProcesses();
    const retiredLegacy = entries.find((entry) => entry.name === 'arubot-api');
    if (legacyEntry && retiredLegacy?.pm2_env?.status === 'stopped'
        && retiredLegacy.pm_id === legacyEntry.pm_id
        && processEnv(retiredLegacy).pm_cwd === processEnv(legacyEntry).pm_cwd
        && processEnv(retiredLegacy).pm_exec_path === processEnv(legacyEntry).pm_exec_path) {
      await pm2(['delete', 'arubot-api']);
      await pm2(['save']);
      entries = await listProcesses();
    }
    await cleanupChatReleases({ appDir, keep: options.keep, processes: entries, protectedPaths: [releaseDir, old?.cwd, previousCurrent].filter(Boolean), log });
    log(`Activated ${runtimeId}; ingress was not restarted`);
    return { runtimeId, url: candidate.url, previousRuntimeId: old?.id || null };
  } catch (error) {
    // An ambiguous control response must be reconciled before terminating either runtime.
    if (!committed && candidateStarted) {
      try {
        if (attemptedImport && !confirmedImport) {
          // An empty candidate checkpoint could overwrite the old state after a rejected import.
          // Bounded idempotent retries could not confirm import; do not guess from an empty candidate.
          throw new Error('Checkpoint import outcome is unconfirmed; preserve both drained workers and reconcile transferred job ownership before resuming');
        }
        let active = await status();
        if (active.activeRuntimeId === candidate.id) {
          if (!old) throw new Error('First candidate is active; preserve it and ingress for operator recovery');
          await drain(candidate);
          if (attemptedImport) await transfer(candidate, old);
          await request(controlUrl, '/runtime/activate', { runtimeId: old.id, url: old.url, expectedRuntimeId: candidate.id });
          await resume(old);
          await until(async () => (await status()).activeRuntimeId === old.id && await ready(publicUrl, old.sha), 'Rollback readiness');
          if (previousCurrent) await replaceLink(path.join(appDir, 'current'), previousCurrent);
          active = await status();
        } else if (active.activeRuntimeId === (old?.id || null)) {
          if (old && attemptedImport) {
            await drainWorker(candidate);
            await transfer(candidate, old);
          }
          if (old && (attemptedDrain || attemptedActivation)) await resume(old);
        } else {
          throw new Error('Active runtime changed externally; preserve both workers');
        }
        if (active.activeRuntimeId !== candidate.id) {
          await pm2(['delete', candidate.name]);
          await pm2(['save']);
        }
      } catch (recoveryError) {
        throw new AggregateError([error, recoveryError], `Deployment failed; automatic recovery is incomplete. Both workers/ingress were preserved where possible: ${error.message}; ${recoveryError.message}`);
      }
    }
    throw error;
  } finally {
    await fs.rm(lockDir, { recursive: true, force: true });
  }
}

async function main() {
  const appDir = path.resolve(process.env.APP_DIR || '/home/ubuntu/AruBot');
  const { config } = await import('dotenv');
  config({ path: path.join(appDir, 'shared', '.env') });
  const enabled = process.env.ARUBOT_ENABLE_CHAT_INGRESS === 'true';
  if (process.argv.includes('--mode')) {
    if (!enabled) {
      const { stdout } = await executeFile('pm2', ['jlist'], { maxBuffer: 16 * 1024 * 1024 });
      if (JSON.parse(stdout).some((entry) => entry.name === INGRESS_NAME)) {
        throw new Error('Pinned ingress exists; refusing to fall back to legacy deployment. Restore ARUBOT_ENABLE_CHAT_INGRESS=true');
      }
    }
    console.log(enabled ? 'ingress' : 'legacy');
    return;
  }
  if (!enabled && !process.argv.includes('--cleanup')) throw new Error('ARUBOT_ENABLE_CHAT_INGRESS=true is required');
  if (process.argv.includes('--cleanup')) {
    const { stdout } = await executeFile('pm2', ['jlist'], { maxBuffer: 16 * 1024 * 1024 });
    await cleanupChatReleases({ appDir, keep: Number(process.env.RELEASES_TO_KEEP || 2), processes: JSON.parse(stdout), protectedPaths: [process.env.RELEASE_DIR, process.env.PREVIOUS_CURRENT_REAL].filter(Boolean) });
    return;
  }
  await deployChatRuntime({
    appDir, releaseDir: process.env.RELEASE_DIR || process.cwd(), releaseSha: process.env.RELEASE_SHA,
    secret: process.env.ARUBOT_CHAT_INGRESS_SECRET,
    controlUrl: process.env.ARUBOT_CHAT_INGRESS_URL, publicUrl: `http://127.0.0.1:${process.env.PORT || process.env.SERVER_PORT || 3001}`,
    keep: Number(process.env.RELEASES_TO_KEEP || 2), allowLegacyMigration: process.env.ARUBOT_ALLOW_CHAT_INGRESS_MIGRATION === 'true',
    preflightOnly: process.argv.includes('--preflight'),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`[chat runtime deploy] ${error.message}`); process.exitCode = 1; });
}
