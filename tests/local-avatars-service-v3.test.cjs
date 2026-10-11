const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const zlib = require('zlib');
const sharp = require('sharp');
const vm = require('vm');
const { WebSocket } = require('ws');
const { AvatarStorage } = require('../local-program/avatars/storage.cjs');
const { AvatarService } = require('../local-program/avatars/service.cjs');
const { AvatarEngine } = require('../local-program/avatars/engine.cjs');
const {
  defaultConfig,
  validateConfig,
  reactionTemplates,
} = require('../local-program/avatars/schema.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aru-avatar-v3-'));
  const services = [],
    stores = [];
  t.after(async () => {
    for (const service of services) await service.stop();
    for (const storage of stores) await storage.ready;
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    storage(name = 'storage') {
      const s = new AvatarStorage(path.join(root, name));
      stores.push(s);
      return s;
    },
    service(options = {}) {
      const s = new AvatarService(
        path.join(root, `service-${services.length}`),
        options,
      );
      services.push(s);
      stores.push(s.storage);
      return s;
    },
  };
}
const listen = (server, port = 0) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
const close = (server) => new Promise((resolve) => server.close(resolve));
async function freePort() {
  const server = net.createServer();
  const port = await listen(server);
  await close(server);
  return port;
}
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const archive = (file) => JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
const png = (color = '#ff000080') =>
  sharp({ create: { width: 16, height: 8, channels: 4, background: color } })
    .png()
    .toBuffer();

test('port collision keeps saved config, old HTTP output and WebSocket alive', async (t) => {
  const service = fixture(t).service();
  await service.save({ ...service.storage.config, port: await freePort() });
  const oldUrl = service.url,
    oldConfig = fs.readFileSync(path.join(service.storage.root, 'config.json'));
  const occupied = net.createServer();
  const occupiedPort = await listen(occupied);
  t.after(() => close(occupied));
  await assert.rejects(
    service.save({ ...service.storage.config, port: occupiedPort, size: 130 }),
    /포트/,
  );
  assert.equal(service.url, oldUrl);
  assert.deepEqual(
    fs.readFileSync(path.join(service.storage.root, 'config.json')),
    oldConfig,
  );
  assert.equal((await fetch(oldUrl)).status, 200);
  assert.equal(service.listeners.size, 1);
  const snapshot = await socketFrame(oldUrl);
  assert.equal(snapshot.actors.length, 0);
});

test('disk save failure closes prepared port and preserves old output, config backup and draft', async (t) => {
  const service = fixture(t).service();
  await service.save({ ...service.storage.config, port: await freePort() });
  const oldUrl = service.url,
    config = service.storage.config;
  const backupFile = path.join(service.storage.root, 'config.json.bak');
  const backupBefore = fs.readFileSync(backupFile);
  service.draft('save', { config: { ...config, size: 99 }, undoAssets: [] });
  const save = service.storage.saveConfig.bind(service.storage);
  service.storage.saveConfig = () => {
    throw new Error('injected write failure');
  };
  const newPort = await freePort();
  await assert.rejects(service.save({ ...config, port: newPort }), /injected/);
  service.storage.saveConfig = save;
  assert.equal(service.url, oldUrl);
  assert.equal(service.storage.config, config);
  assert.equal((await fetch(oldUrl)).status, 200);
  assert.deepEqual(fs.readFileSync(backupFile), backupBefore);
  assert.equal(service.draft('load').config.size, 99);
  const probe = net.createServer();
  await listen(probe, newPort);
  await close(probe);
});

test('coexisting prepared listeners validate Host and Origin against their own port', async (t) => {
  const service = fixture(t).service();
  await service.save({ ...service.storage.config, port: await freePort() });
  const prepared = await service.prepareListener(await freePort());
  const candidate = `http://127.0.0.1:${prepared.port}/overlay?key=${service.storage.config.key}`;
  assert.equal((await fetch(service.url)).status, 200);
  assert.equal((await fetch(candidate)).status, 200);
  assert.equal(
    (
      await fetch(candidate, {
        headers: { Origin: new URL(service.url).origin },
      })
    ).status,
    403,
  );
  assert.equal(
    (await socketFrame(candidate, new URL(candidate).origin)).actors.length,
    0,
  );
  await assert.rejects(socketFrame(candidate, new URL(service.url).origin));
  await service.closeListener(prepared);
});

test('concurrent save calls commit in order and a rejected save does not poison the queue', async (t) => {
  const service = fixture(t).service();
  const port = await freePort(),
    config = service.storage.config;
  const states = await Promise.all([
    service.save({ ...config, port, size: 85 }),
    service.save({ ...config, port, size: 95 }),
    service.save({ ...config, port, size: 105 }),
  ]);
  assert.deepEqual(
    states.map((s) => s.config.size),
    [85, 95, 105],
  );
  await assert.rejects(service.save({ ...config, avatars: [] }));
  await service.save({ ...service.storage.config, size: 110 });
  assert.equal(
    readJson(path.join(service.storage.root, 'config.json')).size,
    110,
  );
  assert.equal(service.listeners.size, 1);
});

test('v2 migration keeps an exact original and rejects newer versions without overwriting either copy', async (t) => {
  const f = fixture(t),
    root = path.join(f.root, 'legacy');
  fs.mkdirSync(root);
  const old = { ...defaultConfig(), version: 2 };
  for (const rule of old.rules) {
    delete rule.durationMode;
    delete rule.maxDuration;
    delete rule.interrupt;
  }
  old.rules[0].durationFromChat = true;
  const original = JSON.stringify(old, null, 2);
  fs.writeFileSync(path.join(root, 'config.json'), original);
  const storage = f.storage('legacy');
  await storage.ready;
  assert.equal(storage.config.version, 3);
  assert.equal(storage.config.rules[0].durationMode, 'legacyAllSteps');
  assert.equal(storage.config.rules[0].maxDuration, 960);
  assert.equal(
    fs.readFileSync(path.join(root, 'config.json.v3-original'), 'utf8'),
    original,
  );
  const future = JSON.stringify({ ...storage.config, version: 999 });
  const bak = fs.readFileSync(path.join(root, 'config.json.bak'));
  fs.writeFileSync(path.join(root, 'config.json'), future);
  assert.throws(() => new AvatarStorage(root), {
    code: 'FUTURE_CONFIG_VERSION',
  });
  assert.equal(fs.readFileSync(path.join(root, 'config.json'), 'utf8'), future);
  assert.deepEqual(fs.readFileSync(path.join(root, 'config.json.bak')), bak);
  assert.throws(() => storage.saveConfig({ ...storage.config, version: 999 }), {
    code: 'FUTURE_CONFIG_VERSION',
  });
});

test('broken config and draft recover independently and recovery survives another restart', async (t) => {
  const f = fixture(t),
    storage = f.storage();
  await storage.ready;
  storage.saveConfig({ ...storage.config, size: 88 });
  storage.saveDraft({ config: { ...storage.config, size: 90 } });
  storage.saveDraft({ config: { ...storage.config, size: 91 } });
  fs.writeFileSync(path.join(storage.root, 'config.json'), '{bad');
  fs.writeFileSync(path.join(storage.root, 'draft.json'), '{bad');
  const recovered = f.storage();
  assert.equal(recovered.config.size, 76);
  assert.equal(recovered.loadDraft().config.size, 90);
  assert.match(recovered.warning, /복구|손상/);
  assert.equal(f.storage().config.size, 76);
});

test('draft byte limit and undo references protect reusable assets across prune and restart', async (t) => {
  const f = fixture(t),
    storage = f.storage();
  await storage.ready;
  const image = await storage.importBuffer(await png());
  const spare = await storage.importBuffer(await png('#0000ff80'));
  const draft = { config: storage.config, undoAssets: [image.asset] };
  storage.saveDraft(draft);
  assert.throws(
    () =>
      storage.saveDraft({ config: storage.config, name: '한'.repeat(100000) }),
    /256KB/,
  );
  assert.deepEqual(storage.loadDraft(), draft);
  storage.pruneAssets();
  assert.equal(fs.existsSync(storage.assetPath(image.asset)), true);
  assert.equal(fs.existsSync(storage.assetPath(spare.asset)), false);
  const reopened = f.storage();
  await reopened.ready;
  reopened.pruneAssets();
  assert.equal(fs.existsSync(reopened.assetPath(image.asset)), true);
  reopened.discardDraft();
  reopened.pruneAssets();
  assert.equal(fs.existsSync(reopened.assetPath(image.asset)), false);
});

test('blocked and timed-out profiles survive ordinary retention with targeting preferences intact', async (t) => {
  const f = fixture(t),
    storage = f.storage();
  const stale = Date.now() - 200 * 86400000,
    until = Date.now() + 600000;
  const blocked = 'a'.repeat(64),
    timeout = 'b'.repeat(64),
    old = 'c'.repeat(64),
    expired = 'd'.repeat(64);
  storage.saveProfiles({
    [blocked]: {
      seen: stale,
      blocked: true,
      targeting: false,
      name: 'blocked',
    },
    [timeout]: { seen: stale, blockedUntil: until, targeting: false },
    [old]: { seen: stale },
    [expired]: { seen: stale, blockedUntil: Date.now() - 1 },
  });
  const reopened = f.storage();
  assert.equal(reopened.profiles[blocked].blocked, true);
  assert.equal(reopened.profiles[blocked].targeting, false);
  assert.equal(reopened.profiles[timeout].blockedUntil, until);
  assert.equal(reopened.profiles[old], undefined);
  assert.equal(reopened.profiles[expired], undefined);
  reopened.profiles[blocked].blocked = false;
  reopened.saveProfiles(reopened.profiles);
  assert.equal(reopened.profiles[blocked], undefined);
});

test('rehearsal enforces role, cooldown, donation, manual entry and stable identities exactly like a live engine', async (t) => {
  let now = 100000;
  const service = fixture(t).service({ now: () => now, random: () => 0.5 });
  const config = structuredClone(service.storage.config);
  config.enabled = true;
  config.autoJoin = false;
  config.rules = [{ ...config.rules[0], role: 'moderator', cooldown: 30 }];
  service.command('rehearsal-reset', { config });
  const reference = new AvatarEngine(
    validateConfig(config, service.storage.config),
    {},
    { now: () => now, random: () => 0.5 },
  );
  reference.setScope('local-rehearsal');
  let eventNumber = 0;
  const send = (payload) => {
    const event = {
      id: `reference-${++eventNumber}`,
      at: now,
      kind: payload.kind || 'chat',
      userId: payload.actorId || 'rehearsal-user-1',
      name: payload.name || '테스트',
      text: payload.text,
      amount: payload.amount || 0,
      role: payload.role || 'everyone',
      test: false,
    };
    reference.receive(event);
    service.command('rehearsal', payload);
    assert.equal(
      service.rehearsal.lastResult?.code,
      reference.lastResult?.code,
    );
    assert.equal(service.rehearsal.actors.size, reference.actors.size);
  };
  send({ text: '!jump' });
  assert.equal(service.rehearsal.actors.size, 0);
  send({ text: '!join', name: 'old' });
  send({ text: '!jump' });
  assert.equal(service.rehearsal.lastResult.code, 'ROLE_DENIED');
  send({ text: '!jump', role: 'moderator', name: 'new' });
  assert.equal(service.rehearsal.lastResult.code, 'QUEUED');
  send({ text: '!jump', role: 'moderator', name: 'renamed' });
  assert.equal(service.rehearsal.lastResult.code, 'COOLDOWN');
  assert.equal(service.rehearsal.actors.size, 1);
  assert.equal(service.rehearsal.snapshot().actors[0].name, 'renamed');
  assert.equal(service.engine.actors.size, 0);
  assert.deepEqual(service.engine.profiles, {});
  assert.deepEqual(service.storage.profiles, {});
  config.rules = [
    {
      ...config.rules[0],
      trigger: 'donation',
      role: 'everyone',
      minimum: 5000,
    },
  ];
  service.command('rehearsal-reset', { config });
  service.command('rehearsal', { text: '!join' });
  service.command('rehearsal', { kind: 'donation', amount: 4999 });
  assert.equal(service.rehearsal.lastResult.code, 'MINIMUM_AMOUNT');
  service.command('rehearsal', { kind: 'donation', amount: 5000 });
  assert.equal(service.rehearsal.lastResult.code, 'QUEUED');
  now += 1;
});

test('rehearsal preserves disabled/paused/new-entry/capacity/blocked/targeting policies', async (t) => {
  const service = fixture(t).service();
  const config = { ...service.storage.config, enabled: false };
  service.command('rehearsal-reset', { config });
  service.command('rehearsal', { text: '!join' });
  assert.equal(service.rehearsal.lastResult.code, 'DISABLED');
  service.command('rehearsal-reset', {
    config: { ...config, enabled: true, paused: true },
  });
  service.command('rehearsal', { text: '!join' });
  assert.equal(service.rehearsal.lastResult.code, 'PAUSED');
  service.command('rehearsal-reset', {
    config: { ...config, enabled: true, newJoins: false },
  });
  service.command('rehearsal', { text: '!join' });
  assert.equal(service.rehearsal.lastResult.code, 'JOINS_CLOSED');
  service.command('rehearsal-reset', {
    config: { ...config, enabled: true, maxActors: 1 },
  });
  service.command('rehearsal', { text: '!join', actorId: 'one' });
  service.command('rehearsal', { text: '!join', actorId: 'two' });
  assert.equal(service.rehearsal.lastResult.code, 'ACTOR_LIMIT');
  const id = service.rehearsal.key('one');
  service.rehearsal.moderate('block', id);
  service.command('rehearsal', { text: '!join', actorId: 'one' });
  assert.equal(service.rehearsal.lastResult.code, 'BLOCKED');
  service.command('rehearsal-reset', {
    config: { ...config, enabled: true, allowTargeting: true },
  });
  for (const actorId of ['a', 'b', 'c'])
    service.command('rehearsal', { actorId, name: 'same', text: '!join' });
  service.command('rehearsal', { actorId: 'a', text: '!follow @same' });
  assert.equal(service.rehearsal.lastResult.code, 'TARGET_AMBIGUOUS');
  assert.equal(service.engine.actors.size, 0);
});

test('direct preview is immediate, repeatable and separate from rehearsal', async (t) => {
  const service = fixture(t).service();
  const config = structuredClone(service.storage.config);
  config.rules[0].role = 'owner';
  config.newJoins = false;
  const payload = {
    config,
    ruleId: config.rules[0].id,
    actorId: 'stable-id',
    name: 'old',
  };
  service.command('test', payload);
  service.command('test', { ...payload, name: 'new' });
  assert.equal(service.preview.actors.size, 1);
  assert.equal(service.preview.lastResult.code, 'QUEUED');
  assert.equal(service.preview.snapshot().actors[0].name, 'new');
  assert.equal(service.rehearsal.actors.size, 0);
  assert.equal(service.engine.actors.size, 0);
  assert.deepEqual(service.state().templates, reactionTemplates());
  service.command('test', { name: 'legacy-one', text: '!join' });
  service.command('test', { name: 'legacy-two', text: '!join' });
  assert.equal(service.preview.actors.size, 3);
});

test('preview stepping advances the isolated simulation while paused; rehearsal uses wall timestamps', async (t) => {
  const service = fixture(t).service();
  service.command('test', { text: '!run' });
  service.command('preview-pause');
  const before = service.preview.now(),
    liveBefore = service.engine.now();
  service.command('preview-step', { milliseconds: 500 });
  assert.ok(Math.abs(service.preview.now() - before - 500) < 2);
  assert.equal(service.preview.config.paused, true);
  assert.equal(service.engine.now(), liveBefore);
  service.command('rehearsal-reset', {
    config: { ...service.storage.config, enabled: true },
  });
  service.rehearsal.clock = 1;
  service.command('rehearsal', { text: '!join' });
  assert.equal(service.rehearsal.actors.size, 1);
  assert.notEqual(service.rehearsal.lastResult.code, 'STALE_EVENT');
});

test('relay metadata is bounded, rejects arbitrary strings and clears on disconnect or scope change', async (t) => {
  const service = fixture(t).service();
  service.setConnection(true, {
    ready: true,
    commandsKnown: true,
    deliveryReady: false,
    commandAliases: [
      '!JUMP',
      '!jump',
      'not-a-command',
      ...Array.from({ length: 700 }, (_, i) => `!cmd${i}`),
    ],
    diagnostics: {
      dropped: 4,
      localQueue: { depth: 2, oldestAgeMs: 30 },
      token: 'private',
      unsafe: ['arbitrary'],
      tooDeep: { child: { child: { name: 'private' } } },
    },
  });
  const state = service.state();
  assert.equal(state.commandsKnown, true);
  assert.ok(state.commandAliases.length <= 512);
  assert.equal(state.commandAliases.filter((v) => v === '!jump').length, 1);
  assert.equal(state.relay.deliveryReady, false);
  assert.equal(state.relay.diagnostics.localQueue.depth, 2);
  assert.equal(JSON.stringify(state.relay).includes('private'), false);
  service.setConnection(false);
  assert.equal(service.state().commandsKnown, false);
  assert.deepEqual(service.state().commandAliases, []);
  assert.equal(service.state().relay, null);
  service.setConnection(true, 'new-scope');
  assert.equal(service.engine.scope, 'new-scope');
  assert.equal(service.state().commandsKnown, false);
});

test('timeout commands forward minutes, persist fields and expose timed exclusions for unblocking', async (t) => {
  const now = Date.now(),
    service = fixture(t).service({ now: () => now });
  service.engine.setConfig({ ...service.storage.config, enabled: true });
  service.engine.setScope('scope');
  service.receive({
    id: 'entry',
    userId: 'user',
    name: 'viewer',
    at: now,
    kind: 'chat',
    text: '!join',
    role: 'everyone',
  });
  const id = service.engine.key('user');
  service.command('moderate', { action: 'timeout', id, minutes: 7 });
  const entry = service.state().blocked.find((p) => p.id === id);
  assert.equal(entry.blockedUntil, now + 7 * 60000);
  assert.equal(entry.minutes, 7);
  service.flush();
  assert.equal(
    readJson(path.join(service.storage.root, 'profiles.json'))[id].blockedUntil,
    entry.blockedUntil,
  );
  service.command('moderate', { action: 'unblock', id });
  assert.equal(service.state().blocked.length, 0);
});

test('catalog exposes dimensions, frame counts and decoded bytes for reusable imported artwork', async (t) => {
  const storage = fixture(t).storage();
  const buffer = await png(),
    meta = await storage.importBuffer(buffer);
  await storage.importBuffer(buffer);
  const entries = storage.assets().filter((a) => a.name === meta.asset);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].width, 16);
  assert.equal(entries[0].height, 8);
  assert.equal(entries[0].frameCount, 1);
  assert.equal(entries[0].estimatedDecodeBytes, 16 * 8 * 4);
});

test('worker artwork export leaves drafts intact, reports completion and excludes personal records', async (t) => {
  const f = fixture(t),
    service = f.service();
  const draft = {
    config: { ...service.storage.config, size: 99 },
    undoAssets: [],
  };
  service.draft('save', draft);
  service.storage.saveProfiles({
    ['a'.repeat(64)]: {
      seen: Date.now(),
      name: 'private viewer',
      blocked: true,
    },
  });
  const file = path.join(f.root, 'art.aruavatars');
  const promise = service.backup(file);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.state().job.status, 'running');
  await promise;
  assert.equal(service.state().job.status, 'completed');
  assert.equal(service.state().job.progress, 100);
  assert.deepEqual(service.draft('load'), draft);
  const packed = archive(file);
  assert.equal(packed.format, 'aruavatars');
  assert.equal(packed.profiles, undefined);
  assert.equal(packed.config.key, undefined);
  assert.notEqual(packed.config.size, 99);
});

test('worker cancellation preserves an existing export and cleans only owned staging files', async (t) => {
  const f = fixture(t),
    storage = f.storage();
  const file = path.join(f.root, 'existing.aruavatars');
  fs.writeFileSync(file, 'original');
  const pending = storage.exportBackupAsync(file);
  assert.equal(storage.cancelBackup(storage.job.id), true);
  await assert.rejects(pending, { code: 'ABORT_ERR' });
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  assert.equal(storage.job.status, 'cancelled');
  assert.equal(
    fs.readdirSync(f.root).some((p) => p.startsWith('.avatar-backup-')),
    false,
  );
});

test('cancelling an active restore worker leaves config, assets and draft untouched', async (t) => {
  const f = fixture(t),
    storage = f.storage();
  const file = path.join(f.root, 'restore.aruavatars');
  storage.exportBackup(file);
  storage.saveDraft({ config: { ...storage.config, size: 101 } });
  const config = fs.readFileSync(path.join(storage.root, 'config.json'));
  const assets = storage.assets().map((a) => a.name);
  const pending = storage.restoreBackupAsync(file);
  while (!storage.worker) await new Promise((resolve) => setImmediate(resolve));
  storage.worker.once('online', () => storage.cancelBackup());
  await assert.rejects(pending, { code: 'ABORT_ERR' });
  assert.deepEqual(
    fs.readFileSync(path.join(storage.root, 'config.json')),
    config,
  );
  assert.deepEqual(
    storage.assets().map((a) => a.name),
    assets,
  );
  assert.equal(storage.loadDraft().config.size, 101);
  assert.equal(
    fs.readdirSync(storage.root).some((p) => p.startsWith('.avatar-backup-')),
    false,
  );
});

test('worker restores validated artwork without changing key, port, draft or private profiles', async (t) => {
  const f = fixture(t),
    source = f.storage('source'),
    target = f.storage('target');
  const meta = await source.importBuffer(await png());
  const config = structuredClone(source.config);
  config.avatars[0].states.idle.asset = meta.asset;
  source.saveConfig(config);
  const file = path.join(f.root, 'restore.aruavatars');
  await source.exportBackupAsync(file);
  const before = target.config;
  target.saveDraft({ config: { ...before, size: 99 } });
  target.saveProfiles({
    ['a'.repeat(64)]: { seen: Date.now(), blocked: true },
  });
  const profiles = structuredClone(target.profiles);
  await target.restoreBackupAsync(file);
  assert.equal(target.config.avatars[0].states.idle.asset, meta.asset);
  assert.equal(target.config.key, before.key);
  assert.equal(target.config.port, before.port);
  assert.equal(target.config.enabled, false);
  assert.equal(target.loadDraft().config.size, 99);
  assert.deepEqual(target.profiles, profiles);
  assert.deepEqual(fs.readFileSync(target.assetPath(meta.asset)), await png());
});

test('invalid/future backup and failed restore commit leave original settings and assets untouched', async (t) => {
  const f = fixture(t),
    source = f.storage('source'),
    target = f.storage('target');
  await target.ready;
  const meta = await source.importBuffer(await png());
  const config = structuredClone(source.config);
  config.avatars[0].states.idle.asset = meta.asset;
  source.saveConfig(config);
  const file = path.join(f.root, 'restore.aruavatars');
  source.exportBackup(file);
  const packed = archive(file),
    original = fs.readFileSync(path.join(target.root, 'config.json'));
  const save = target.saveConfig.bind(target);
  target.saveConfig = () => {
    throw new Error('commit failed');
  };
  await assert.rejects(target.restoreBackupAsync(file), /commit failed/);
  target.saveConfig = save;
  assert.deepEqual(
    fs.readFileSync(path.join(target.root, 'config.json')),
    original,
  );
  assert.equal(fs.existsSync(target.assetPath(meta.asset)), false);
  packed.config.version = 999;
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(packed)));
  await assert.rejects(target.restoreBackupAsync(file), {
    code: 'FUTURE_CONFIG_VERSION',
  });
  assert.deepEqual(
    fs.readFileSync(path.join(target.root, 'config.json')),
    original,
  );
  packed.config.version = 3;
  packed.assets[0].data = Buffer.from('corrupt').toString('base64');
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(packed)));
  await assert.rejects(target.restoreBackupAsync(file));
  assert.deepEqual(
    fs.readFileSync(path.join(target.root, 'config.json')),
    original,
  );
});

test('separate profile backups require explicit restore consent and do not replace artwork', async (t) => {
  const f = fixture(t),
    source = f.storage('source'),
    target = f.storage('target');
  source.saveProfiles({
    ['a'.repeat(64)]: {
      seen: 1,
      blocked: true,
      targeting: false,
      name: 'private',
    },
  });
  const file = path.join(f.root, 'profiles.aruavatars');
  await source.exportBackupAsync(file, { kind: 'profiles' });
  assert.equal(archive(file).config, undefined);
  assert.equal(archive(file).format, 'aruavatars-profiles');
  const original = structuredClone(target.config);
  await assert.rejects(target.restoreBackupAsync(file), /동의/);
  await target.restoreBackupAsync(file, {
    kind: 'profiles',
    restoreProfiles: true,
  });
  assert.deepEqual(target.config, original);
  assert.equal(target.profiles['a'.repeat(64)].blocked, true);
  assert.equal(target.profiles['a'.repeat(64)].targeting, false);
});

test('restore repairs corrupt existing artwork but rolls original bytes back on commit failure', async (t) => {
  const f = fixture(t),
    storage = f.storage();
  await storage.ready;
  const file = path.join(f.root, 'repair.aruavatars');
  storage.exportBackup(file);
  const asset = storage.config.avatars[0].states.idle.asset;
  const valid = fs.readFileSync(storage.assetPath(asset));
  fs.writeFileSync(storage.assetPath(asset), 'damaged');
  const save = storage.saveConfig.bind(storage);
  storage.saveConfig = () => {
    throw new Error('commit failed');
  };
  await assert.rejects(storage.restoreBackupAsync(file), /commit failed/);
  assert.equal(fs.readFileSync(storage.assetPath(asset), 'utf8'), 'damaged');
  storage.saveConfig = save;
  await storage.restoreBackupAsync(file);
  assert.deepEqual(fs.readFileSync(storage.assetPath(asset)), valid);
});

test('avatar IPC routes reject other web contents and subframes; preload exposes additive APIs', async () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../local-program/main.cjs'),
    'utf8',
  );
  const routes = new Map(),
    mainFrame = {},
    webContents = { mainFrame };
  const api = {
    state: () => ({ ok: true }),
    draft: (action) => action,
    diagnostics: () => ({ version: 3 }),
    copy: () => 'commands',
  };
  vm.runInNewContext(
    source.slice(
      source.indexOf('function requireAvatarService(event)'),
      source.indexOf("ipcMain.handle('config:save'"),
    ),
    {
      mainWindow: { webContents },
      avatarService: api,
      avatarStartupError: '',
      ipcMain: { handle: (name, fn) => routes.set(name, fn) },
      clipboard: { writeText() {} },
    },
  );
  for (const [name, handler] of routes) {
    await assert.rejects(
      async () => handler({ sender: {}, senderFrame: mainFrame }),
      /권한/,
      name,
    );
    await assert.rejects(
      async () => handler({ sender: webContents, senderFrame: {} }),
      /권한/,
      name,
    );
  }
  assert.equal(
    routes.get('avatars:draft')(
      { sender: webContents, senderFrame: mainFrame },
      'load',
    ),
    'load',
  );
  let exposed;
  const calls = [];
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, '../local-program/preload.cjs'),
      'utf8',
    ),
    {
      require: () => ({
        contextBridge: {
          exposeInMainWorld: (_name, value) => {
            exposed = value;
          },
        },
        ipcRenderer: { invoke: (...args) => calls.push(args) },
      }),
    },
  );
  exposed.avatarDraft('load');
  exposed.avatarDiagnostics();
  exposed.avatarCopy('commands', { version: 3 });
  exposed.avatarBackup(false, { kind: 'profiles' });
  assert.deepEqual(
    calls.map((args) => args[0]),
    ['avatars:draft', 'avatars:diagnostics', 'avatars:copy', 'avatars:backup'],
  );
});

test('masked diagnostics omit names, keys, paths and identifiers; command copy labels draft/default arguments', async (t) => {
  const service = fixture(t).service();
  service.engine.diagnostics = [
    {
      at: 10,
      code: 'COOLDOWN',
      detail: 'private-name C:\\secret token=secret',
      eventId: 'private-name',
      userId: 'private-id',
      key: service.storage.config.key,
      configRevision: 3,
    },
  ];
  const masked = JSON.stringify(service.diagnostics());
  assert.match(masked, /COOLDOWN/);
  assert.doesNotMatch(masked, /private|secret/);
  assert.equal(masked.includes(service.storage.config.key), false);
  const draft = structuredClone(service.storage.config);
  draft.rules.find((r) => r.steps[0].action === 'run').steps[0].duration = 7;
  assert.match(service.copy('commands'), /저장된 명령.*v3/);
  const copied = service.copy('commands', draft);
  assert.match(copied, /편집 중 명령 \(미적용\).*v3/);
  assert.match(copied, /\[초\].*기본 7초/);
  assert.match(copied, /@이름\|#참여번호/);
  for (const command of ['!상호작용', '!참가', '!부스트'])
    assert.ok(copied.includes(command));
});

test('rehearsal websocket is isolated from preview and live output counts', async (t) => {
  const service = fixture(t).service();
  await service.save({ ...service.storage.config, port: await freePort() });
  service.command('rehearsal-reset', {
    config: { ...service.storage.config, enabled: true },
  });
  service.command('rehearsal', { text: '!join' });
  const state = service.state();
  assert.equal((await socketFrame(state.rehearsalUrl)).actors.length, 1);
  assert.equal((await socketFrame(state.previewUrl)).actors.length, 0);
  assert.equal((await socketFrame(state.url)).actors.length, 0);
});

function socketFrame(url, origin) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      url.replace('http:', 'ws:').replace('/overlay?', '/ws?'),
      origin ? { origin } : {},
    );
    ws.once('message', (data) => {
      resolve(JSON.parse(data));
      ws.terminate();
    });
    ws.once('error', reject);
  });
}
