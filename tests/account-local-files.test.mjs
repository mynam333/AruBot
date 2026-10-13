import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { automationSoundOwnerKey, deleteAccountAutomationSoundFiles } from '../server/account-local-files.js';
import { cleanupUnlinkedAccountBatch } from '../server/unlinked-account-cleanup.js';

function fixture(t) {
  const parent = path.resolve(os.tmpdir());
  const base = fs.mkdtempSync(path.join(parent, 'arubot-account-local-files-'));
  assert.equal(path.dirname(base), parent);
  assert.ok(path.basename(base).startsWith('arubot-account-local-files-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(base)), parent);
    assert.ok(path.basename(base).startsWith('arubot-account-local-files-'));
    fs.rmSync(base, { recursive: true, force: true });
  });
  const root = path.join(base, 'automation');
  const sounds = owner => path.join(root, automationSoundOwnerKey(owner), 'sounds');
  const write = (file, value = 'test') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  const link = (target, destination) => {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.symlinkSync(target, destination, process.platform === 'win32' ? 'junction' : 'dir');
  };
  return { base, root, sounds, write, link };
}

test('exact upload hash, contained recursive deletion, sibling preservation and absent paths are idempotent', t => {
  const f = fixture(t);
  const owner = 'user:owner-a';
  assert.equal(automationSoundOwnerKey(owner), createHash('sha256').update(owner).digest('hex').slice(0, 32));
  assert.notEqual(automationSoundOwnerKey(owner), automationSoundOwnerKey('owner-a'));
  f.write(path.join(f.sounds(owner), 'nested', 'sound.mp3'));
  const sibling = path.join(path.dirname(f.sounds(owner)), 'images', 'keep.webp');
  const other = path.join(f.sounds('other-owner'), 'keep.wav');
  f.write(sibling); f.write(other);
  assert.equal(deleteAccountAutomationSoundFiles(owner, { root: path.relative(process.cwd(), f.root) }), true);
  assert.equal(fs.existsSync(f.sounds(owner)), false);
  assert.equal(fs.readFileSync(sibling, 'utf8'), 'test');
  assert.equal(fs.readFileSync(other, 'utf8'), 'test');
  assert.equal(deleteAccountAutomationSoundFiles(owner, { root: f.root }), true);
  assert.equal(deleteAccountAutomationSoundFiles(owner, { root: path.join(f.base, 'missing') }), true);
  const traversal = '../../other-owner';
  f.write(path.join(f.sounds(traversal), 'sound.mp3'));
  deleteAccountAutomationSoundFiles(traversal, { root: f.root });
  assert.equal(fs.existsSync(other), true, 'Owner text is hashed, never used as a path');
});

test('invalid owners/roots and a non-directory sound target fail without removing data', t => {
  const f = fixture(t);
  for (const owner of ['', '   ', null, undefined, 123, {}]) {
    assert.throws(() => deleteAccountAutomationSoundFiles(owner, { root: f.root }), { code: 'INVALID_AUTOMATION_OWNER' });
  }
  for (const root of ['', ' ', null, 123]) {
    assert.throws(() => deleteAccountAutomationSoundFiles('owner', { root }), { code: 'INVALID_AUTOMATION_FILE_ROOT' });
  }
  assert.throws(() => deleteAccountAutomationSoundFiles('owner', { root: path.parse(f.base).root }), { code: 'UNSAFE_AUTOMATION_FILE_ROOT' });
  f.write(f.sounds('owner'), 'not-a-directory');
  assert.throws(() => deleteAccountAutomationSoundFiles('owner', { root: f.root }), { code: 'UNSAFE_AUTOMATION_SOUND_PATH' });
  assert.equal(fs.readFileSync(f.sounds('owner'), 'utf8'), 'not-a-directory');
});

for (const level of ['owner', 'sounds']) test(`refuses ${level} symlinks/junctions outside the storage root`, t => {
  const f = fixture(t);
  const outside = path.join(f.base, 'outside');
  const keep = path.join(outside, 'sounds', 'keep.wav'); f.write(keep);
  f.link(outside, level === 'owner' ? path.dirname(f.sounds('owner')) : f.sounds('owner'));
  assert.throws(() => deleteAccountAutomationSoundFiles('owner', { root: f.root }), { code: 'UNSAFE_AUTOMATION_SOUND_PATH' });
  assert.equal(fs.readFileSync(keep, 'utf8'), 'test');
});

test('configured storage-root link works while nested sound links never delete their destination', t => {
  const f = fixture(t);
  f.write(path.join(f.sounds('owner'), 'sound.mp3'));
  const outside = path.join(f.base, 'outside'); const keep = path.join(outside, 'keep.mp3'); f.write(keep);
  f.link(outside, path.join(f.sounds('owner'), 'nested-link'));
  const rootLink = path.join(f.base, 'configured-root'); f.link(f.root, rootLink);
  const previousRoot = process.env.AUTOMATION_USER_FILE_ROOT;
  try {
    process.env.AUTOMATION_USER_FILE_ROOT = rootLink;
    assert.equal(deleteAccountAutomationSoundFiles('owner'), true);
  } finally {
    if (previousRoot === undefined) delete process.env.AUTOMATION_USER_FILE_ROOT;
    else process.env.AUTOMATION_USER_FILE_ROOT = previousRoot;
  }
  assert.equal(fs.existsSync(f.sounds('owner')), false);
  assert.equal(fs.readFileSync(keep, 'utf8'), 'test');
});

// Run the actual CLI body with in-memory DB dependencies, without importing the
// production DB module, credentials or dotenv. No real account data is touched.
const cliFile = new URL('../scripts/cleanup-unlinked-accounts.js', import.meta.url);
const source = fs.readFileSync(cliFile, 'utf8').replace(/^import .+;\r?\n/gm, '');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runBody = new AsyncFunction('cleanupUnlinkedAccounts', 'closeDatabaseConnections', 'automationSoundOwnerKey', 'deleteAccountAutomationSoundFiles', 'process', 'console', source);
async function cli(args, dependencies = {}) {
  const logs = [], errors = [], process = { argv: ['node', 'cleanup-unlinked-accounts.js', ...args], exitCode: 0 };
  let closes = 0;
  await runBody(dependencies.cleanup, async () => { closes++; await dependencies.close?.(); }, automationSoundOwnerKey,
    dependencies.remove || (() => { throw new Error('unexpected deletion'); }), process,
    { log: value => logs.push(value), error: (...values) => errors.push(values.join(' ')) });
  return { summaries: logs.map(line => JSON.parse(line)), errors, exitCode: process.exitCode, closes };
}

test('CLI defaults to dry-run and supplies no file-deletion callback', async () => {
  let called = 0;
  const result = await cli([], { cleanup: async options => {
    called++; assert.equal(options.dryRun, true); assert.equal(options.onDeleted, undefined);
    return { scanned: 1, eligible: 1, deleted: 0, failed: [], skipped: {}, hasMore: false, after: 'owner' };
  } });
  assert.equal(called, 1); assert.equal(result.exitCode, 0); assert.equal(result.closes, 1);
  assert.equal(result.summaries.at(-1).soundDirectoriesCleaned, 0);
});

test('CLI removes sounds after DB deletion, continues after file failures, and reports failures separately without secrets', async t => {
  const f = fixture(t); const deleted = [];
  for (const owner of ['a', 'c']) f.write(path.join(f.sounds(owner), 'sound.mp3'));
  const keep = path.join(f.base, 'external-private-path', 'keep.wav'); f.write(keep);
  f.link(path.dirname(keep), path.dirname(f.sounds('b')));
  const dependencies = {
    withPgClient: fn => fn({ query: async () => ({ rows: ['a', 'b', 'c', 'd'].map(id => ({ id })) }) }),
    deleteAccountData: async (owner, options) => {
      assert.equal(options.dryRun, false);
      if (owner === 'd') throw Object.assign(new Error('postgres://credential@private-database'), { code: 'db_secret_value' });
      deleted.push(owner); return { ok: true, accountDeleted: true };
    },
  };
  const result = await cli(['--apply'], {
    cleanup: options => cleanupUnlinkedAccountBatch(dependencies, options),
    remove: owner => { assert.ok(deleted.includes(owner)); return deleteAccountAutomationSoundFiles(owner, { root: f.root }); },
  });
  const total = result.summaries.at(-1);
  assert.equal(total.deleted, 3); assert.equal(total.databaseFailed, 1);
  assert.equal(total.soundDirectoriesCleaned, 2); assert.equal(total.soundDirectoriesFailed, 1);
  assert.equal(total.failed, 2); assert.equal(total.soundFailureCodes.UNSAFE_AUTOMATION_SOUND_PATH, 1);
  assert.deepEqual(result.summaries[0].soundFailures, [{ ownerKey: automationSoundOwnerKey('b'), code: 'UNSAFE_AUTOMATION_SOUND_PATH' }]);
  assert.equal(result.exitCode, 1); assert.equal(result.closes, 1);
  assert.equal(fs.existsSync(f.sounds('a')), false); assert.equal(fs.existsSync(f.sounds('c')), false);
  assert.equal(fs.readFileSync(keep, 'utf8'), 'test');
  assert.doesNotMatch(JSON.stringify(result), /credential|private-database|db_secret_value|external-private-path/);
});

test('CLI sanitizes file/query/close exceptions, preserves final totals and always closes DB connections', async () => {
  let page = 0;
  const secret = Object.assign(new Error('password=private'), { code: 'postgres://credential@host' });
  const result = await cli(['--apply'], {
    cleanup: async options => {
      if (page++) throw secret;
      await options.onDeleted('owner');
      return { scanned: 1, eligible: 1, deleted: 1, failed: [], skipped: {}, hasMore: true, after: 'owner' };
    },
    remove: () => { throw secret; }, close: () => { throw secret; },
  });
  assert.equal(result.exitCode, 1); assert.equal(result.closes, 1);
  const total = result.summaries.at(-1);
  assert.equal(total.deleted, 1); assert.equal(total.soundDirectoriesFailed, 1); assert.equal(total.failed, 3);
  assert.equal(result.errors.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /password|private|credential|postgres:/);
});
