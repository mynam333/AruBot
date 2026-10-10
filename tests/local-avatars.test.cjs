const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const sharp = require('sharp');
const zlib = require('zlib');
const { WebSocket } = require('ws');
const {
  defaultConfig,
  validateConfig,
} = require('../local-program/avatars/schema.cjs');
const { AvatarEngine } = require('../local-program/avatars/engine.cjs');
const {
  AvatarStorage,
  validateImage,
} = require('../local-program/avatars/storage.cjs');
const { AvatarService } = require('../local-program/avatars/service.cjs');
const { files: bundledFiles } = require('../local-program/avatars/bundled.cjs');

test('bundled CC0 characters have intact transparent idle and movement sheets', async (t) => {
  const storage = new AvatarStorage(temporary(t));
  assert.equal(storage.config.avatars.length, 4);
  for (const avatar of storage.config.avatars) {
    assert.equal(avatar.builtin, undefined);
    assert.equal(avatar.pixelated, true);
    for (const [state, clip] of Object.entries(avatar.states)) {
      const buffer = fs.readFileSync(bundledFiles.get(clip.asset));
      assert.deepEqual(fs.readFileSync(storage.assetPath(clip.asset)), buffer);
      assert.equal((await validateImage(buffer)).asset, clip.asset);
      const meta = await sharp(buffer).metadata();
      assert.equal(meta.hasAlpha, true);
      assert.equal(meta.width, clip.columns * 32);
      assert.equal(meta.height, clip.rows * 32);
      assert.equal(clip.fps, 20);
      if (state === 'idle' || state === 'walk') assert.ok(clip.frames >= 10);
      const stats = await sharp(buffer).stats();
      assert.ok(stats.channels[3].min === 0 && stats.channels[3].max === 255);
    }
  }
  assert.match(fs.readFileSync(path.join(__dirname, '../local-program/avatars/bundled/CC0-1.0.txt'), 'utf8'), /CC0 1.0 Universal/);
});

test('legacy robot defaults migrate without losing custom avatars, rules or output key', (t) => {
  const root = temporary(t);
  const config = defaultConfig();
  const custom = { ...config.avatars[2], id: 'my-custom', name: '나의 캐릭터' };
  const key = config.key;
  config.defaultAvatar = 'rose';
  config.avatars = ['mint', 'rose', 'gold'].map((builtin) => ({ id: builtin, name: builtin, builtin, states: {} }));
  config.avatars.push(custom);
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(config));
  const storage = new AvatarStorage(root);
  assert.equal(storage.config.key, key);
  assert.equal(storage.config.avatars.length, 5);
  assert.equal(storage.config.defaultAvatar, 'pixel-mask-dude');
  assert.ok(storage.config.avatars.some((a) => a.id === custom.id));
  assert.ok(storage.config.avatars.every((a) => !a.builtin));
  assert.deepEqual(storage.config.rules, validateConfig(defaultConfig()).rules.map((r, i) => ({ ...r, id: config.rules[i].id })));
});

test('asset cleanup keeps a usable recovery config and deleted defaults stay deleted', (t) => {
  const root = temporary(t), storage = new AvatarStorage(root);
  storage.saveConfig({ ...storage.config, avatars: [storage.config.avatars[1]], defaultAvatar: storage.config.avatars[1].id });
  assert.ok(storage.pruneAssets() > 0);
  fs.writeFileSync(path.join(root, 'config.json'), '{bad');
  const recovered = new AvatarStorage(root);
  assert.equal(recovered.config.avatars.length, 1);
  assert.equal(recovered.config.defaultAvatar, 'pixel-ninja-frog');
  assert.equal(recovered.assets().length, 4);
  assert.equal(new AvatarStorage(root).config.avatars.length, 1);
});

test('explicit commands take precedence over general chat reactions', () => {
  const w = world();
  w.config.rules.unshift({ ...w.config.rules[1], id: 'chat', trigger: 'chat' });
  w.engine.receive(w.event('!jump'));
  w.engine.tick();
  assert.equal(w.engine.snapshot().actors[0].state, 'jump');
  assert.equal(w.engine.stats.actions, 1);
});

const temporary = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arubot-avatars-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
function world(patch = {}) {
  let now = 100000;
  const config = { ...defaultConfig(), enabled: true, ...patch };
  const engine = new AvatarEngine(
    config,
    {},
    { now: () => now, random: () => 0.5 },
  );
  engine.setScope('owner-a');
  let sequence = 0;
  return {
    engine,
    config,
    advance: (ms) => {
      now += ms;
      engine.tick();
    },
    event: (text = 'hello', userId = 'u1', extra = {}) => ({
      id: `event-${++sequence}`,
      at: now,
      kind: 'chat',
      userId,
      name: userId,
      text,
      role: 'everyone',
      ...extra,
    }),
  };
}
const freePort = () =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });

test('default configuration validates and reserves built-in commands', () => {
  const config = defaultConfig();
  assert.equal(validateConfig(config, config).rules.length, 10);
  config.rules[0].aliases = ['!응원'];
  assert.throws(() => validateConfig(config, config), /중복/);
});
test('configuration rejects arbitrary scripts, bad paths and duplicate aliases', () => {
  for (const mutate of [
    (c) => {
      c.rules[0].steps[0].action = 'eval';
    },
    (c) => {
      c.rules[1].aliases = c.rules[0].aliases;
    },
    (c) => {
      c.avatars[0].states.idle = { asset: '../../token.json' };
    },
    (c) => {
      c.avatars[1].name = c.avatars[0].name;
    },
    (c) => {
      c.rules[0].steps = Array(9).fill({ action: 'jump' });
    },
  ]) {
    const c = defaultConfig();
    mutate(c);
    assert.throws(() => validateConfig(c));
  }
});
test('configuration clamps resource limits and preserves secret', () => {
  const c = defaultConfig();
  const v = validateConfig(
    { ...c, maxActors: 100000, key: 'attacker', size: -1 },
    c,
  );
  assert.equal(v.maxActors, 150);
  assert.equal(v.key, c.key);
  assert.equal(v.size, 24);
});
test('events spawn once, retain identity on nickname change, reject duplicates and stale input', () => {
  const w = world(),
    e = w.event();
  assert.equal(w.engine.receive(e), true);
  assert.equal(w.engine.receive(e), false);
  w.engine.receive(w.event('hello', 'u1', { name: 'new name' }));
  assert.equal(w.engine.snapshot().actors[0].name, 'new name');
  assert.equal(w.engine.actors.size, 1);
  assert.equal(w.engine.receive({ ...w.event(), at: 1 }), false);
});
test('manual entry, voluntary exit, re-entry and blocking are enforced', () => {
  const w = world({ autoJoin: false });
  assert.equal(w.engine.receive(w.event('hi')), false);
  w.engine.receive(w.event('!join'));
  assert.equal(w.engine.actors.size, 1);
  w.engine.receive(w.event('!leave'));
  assert.equal(w.engine.actors.size, 0);
  w.engine.receive(w.event('hello'));
  assert.equal(w.engine.actors.size, 0);
  w.engine.receive(w.event('!입장'));
  const key = w.engine.snapshot().actors[0].id;
  w.engine.moderate('block', key);
  w.engine.receive(w.event('!join'));
  assert.equal(w.engine.actors.size, 0);
  w.engine.moderate('unblock', key);
  w.engine.receive(w.event('!join'));
  assert.equal(w.engine.actors.size, 1);
});
test('aliases invoke rules and cooldown stops replay', () => {
  const w = world();
  w.engine.receive(w.event('!jump'));
  w.engine.tick();
  assert.ok(w.engine.snapshot().actors[0].y < w.engine.ground);
  assert.equal(w.engine.stats.actions, 1);
  w.engine.receive(w.event('!점프'));
  w.engine.tick();
  assert.equal(w.engine.stats.actions, 1);
  w.advance(4000);
  w.engine.receive(w.event('!점프'));
  w.engine.tick();
  assert.equal(w.engine.stats.actions, 2);
});
test('role and minimum donation amount protect custom reactions', () => {
  const w = world();
  w.config.rules[0].role = 'owner';
  w.engine.receive(w.event('!jump'));
  w.engine.tick();
  assert.equal(w.engine.stats.actions, 0);
  w.engine.receive(w.event('!jump', 'owner', { role: 'owner' }));
  w.engine.tick();
  assert.equal(w.engine.stats.actions, 1);
  w.config.rules = [
    { ...w.config.rules[1], trigger: 'donation', minimum: 5000 },
  ];
  w.engine.receive(w.event('', 'donor', { kind: 'donation', amount: 1000 }));
  w.engine.tick();
  assert.equal(w.engine.stats.actions, 1);
  w.engine.receive(w.event('', 'donor', { kind: 'donation', amount: 5000 }));
  w.engine.tick();
  assert.equal(w.engine.stats.actions, 2);
});
test('sequences preserve timing across pause and do not accept paused events', () => {
  const w = world();
  w.config.rules[0].steps = [
    { action: 'wave', value: '', duration: 2 },
    { action: 'dance', value: '', duration: 2 },
  ];
  w.engine.receive(w.event('!점프'));
  w.engine.tick();
  assert.equal(w.engine.snapshot().actors[0].state, 'wave');
  w.advance(500);
  w.engine.setConfig({ ...w.config, paused: true });
  w.advance(10000);
  assert.equal(w.engine.receive(w.event('!입장', 'u2')), false);
  w.engine.setConfig({ ...w.config, paused: false });
  w.engine.tick();
  assert.equal(w.engine.snapshot().actors[0].state, 'wave');
  w.advance(1600);
  assert.equal(w.engine.snapshot().actors[0].state, 'dance');
});
test('target interactions default to off and duplicate target names are ambiguous', () => {
  const w = world();
  w.engine.receive(w.event('hi'));
  w.engine.receive(w.event('hi', 'u2', { name: 'target' }));
  const a = w.engine.actors.get(w.engine.key('u1'));
  assert.equal(w.engine.target(a, 'target'), null);
  w.engine.setConfig({ ...w.config, allowTargeting: true });
  assert.ok(w.engine.target(a, 'target'));
  w.engine.receive(w.event('hi', 'u3', { name: 'target' }));
  assert.equal(w.engine.target(a, 'target'), null);
});
test('character choice, color and size persist without changing user identity', () => {
  const w = world();
  w.engine.receive(w.event('!캐릭터 닌자 프로그'));
  w.advance(1100);
  w.engine.receive(w.event('!색 #00ffaa'));
  w.advance(1100);
  w.engine.receive(w.event('!크기 1.5'));
  const a = w.engine.snapshot().actors[0];
  assert.equal(a.avatar, 'pixel-ninja-frog');
  assert.equal(a.color, '#00ffaa');
  assert.equal(a.size, 114);
  assert.ok(w.engine.dirty);
});
test('maximum actors, profile limit, idle expiry and scope isolation', () => {
  const w = world({ maxActors: 2, idleMinutes: 1 });
  for (let i = 0; i < 10; i++) w.engine.receive(w.event('hi', `u${i}`));
  assert.equal(w.engine.actors.size, 2);
  w.advance(61000);
  assert.equal(w.engine.actors.size, 0);
  w.engine.receive(w.event('hi'));
  const key = w.engine.key('u1');
  w.engine.setScope('owner-b');
  assert.equal(w.engine.actors.size, 0);
  assert.notEqual(w.engine.key('u1'), key);
});
test('test viewers are not persisted and can be cleared separately', () => {
  const w = world();
  w.engine.receive(w.event('hi', 'test', { test: true }));
  w.engine.receive(w.event('hi', 'real'));
  assert.equal(Object.keys(w.engine.profiles).length, 1);
  w.engine.clear(true);
  assert.equal(w.engine.actors.size, 1);
});
test('race finishes and records one winner; abandoned game terminates', () => {
  const w = world();
  for (let i = 0; i < 4; i++) w.engine.receive(w.event('hi', `u${i}`));
  w.engine.startGame('race', 10);
  assert.throws(() => w.engine.startGame('cheer'), /진행/);
  w.advance(11000);
  assert.match(w.engine.game.result, /1위/);
  assert.equal(
    Object.values(w.engine.profiles).reduce((sum, p) => sum + p.wins, 0),
    1,
  );
  w.advance(11000);
  w.engine.startGame('race');
  for (const id of [...w.engine.actors.keys()]) w.engine.remove(id);
  w.engine.tick();
  assert.match(w.engine.game.result, /참여자/);
});
test('cooperative cheer uses per-person cooldown and ends at goal', () => {
  const w = world();
  w.engine.receive(w.event('hi'));
  w.engine.startGame('cheer', 60);
  for (let i = 0; i < 5; i++) {
    w.engine.receive(w.event('!응원'));
    w.advance(3100);
  }
  assert.match(w.engine.game.result, /성공/);
});
test('burst traffic, text and pending tasks stay bounded', () => {
  const w = world();
  for (let i = 0; i < 1000; i++) w.engine.receive(w.event('!jump', `u${i}`));
  assert.ok(w.engine.stats.ignored > 0);
  assert.ok(w.engine.actors.size <= 60);
  assert.ok(w.engine.tasks.length <= 512);
  assert.ok(w.engine.seen.size <= 4096);
});
test('physics stress: 150 actors remain finite and inside the scene', () => {
  const w = world({ maxActors: 150, idleMinutes: 120 });
  for (let i = 0; i < 150; i++) {
    if (i === 100) w.advance(1001);
    w.engine.receive(w.event('!jump', `u${i}`));
  }
  for (let frame = 0; frame < 600; frame++) w.advance(33.33);
  assert.equal(w.engine.actors.size, 150);
  for (const a of w.engine.snapshot().actors) {
    assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y));
    assert.ok(a.x >= 0 && a.x <= 1920);
    assert.ok(a.y < 1100);
  }
});
test('image validation preserves transparency and rejects SVG, oversized and invalid input', async () => {
  const png = await sharp({
    create: { width: 4, height: 4, channels: 4, background: '#0000' },
  })
    .png()
    .toBuffer();
  const meta = await validateImage(png);
  assert.match(meta.asset, /\.png$/);
  await assert.rejects(
    validateImage(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
      ),
    ),
  );
  await assert.rejects(validateImage(Buffer.alloc(9 * 1024 * 1024)));
  const tooWide = await sharp({
    create: { width: 2049, height: 1, channels: 4, background: '#0000' },
  })
    .png()
    .toBuffer();
  await assert.rejects(validateImage(tooWide));
});
test('storage roundtrip, backup, asset integrity, and profiles privacy', async (t) => {
  const root = temporary(t),
    storage = new AvatarStorage(root);
  const buffer = await sharp({
    create: { width: 16, height: 16, channels: 4, background: '#ff000080' },
  })
    .webp()
    .toBuffer();
  const image = await storage.importBuffer(buffer);
  const config = structuredClone(storage.config);
  config.avatars[0].states.idle = {
    asset: image.asset,
    columns: 1,
    rows: 1,
    frames: 1,
    fps: 12,
  };
  storage.saveConfig(config);
  assert.deepEqual(fs.readFileSync(storage.assetPath(image.asset)), buffer);
  const backup = path.join(root, 'test.aruavatars');
  storage.exportBackup(backup);
  const packed = JSON.parse(zlib.gunzipSync(fs.readFileSync(backup)));
  assert.equal(packed.profiles, undefined);
  assert.equal(packed.config.key, undefined);
  const restored = new AvatarStorage(path.join(root, 'restored'));
  const key = restored.config.key;
  await restored.restoreBackup(backup);
  assert.equal(restored.config.key, key);
  assert.equal(restored.config.enabled, false);
  assert.equal(restored.config.avatars[0].states.idle.asset, image.asset);
  assert.equal(new AvatarStorage(path.join(root, 'restored')).config.key, key);
  packed.assets[0].data = buffer.subarray(2).toString('base64');
  fs.writeFileSync(backup, zlib.gzipSync(JSON.stringify(packed)));
  await assert.rejects(restored.restoreBackup(backup));
  assert.equal(restored.config.key, key);
});
test('storage rejects traversal and recovers previous valid settings', (t) => {
  const root = temporary(t),
    storage = new AvatarStorage(root);
  assert.throws(() => storage.assetPath('../config.json'));
  storage.saveConfig({ ...storage.config, size: 80 });
  fs.writeFileSync(path.join(root, 'config.json'), '{broken');
  const recovered = new AvatarStorage(root);
  assert.ok(recovered.warning);
  assert.equal(recovered.config.size, 76);
});
test('loopback server authenticates read-only output, isolates websocket origin, and reconnects', async (t) => {
  const root = temporary(t),
    service = new AvatarService(root);
  service.storage.config.port = await freePort();
  await service.start();
  t.after(() => service.stop());
  const response = await fetch(service.url);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /overlay.js/);
  const unauthorized = new URL(service.url);
  unauthorized.search = '';
  assert.equal((await fetch(unauthorized)).status, 403);
  assert.equal((await fetch(service.url, { method: 'POST' })).status, 403);
  const wsUrl = service.url
    .replace('http:', 'ws:')
    .replace('/overlay?', '/ws?');
  const frame = await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on('message', (data) => {
      resolve(JSON.parse(data));
      ws.close();
    });
    ws.on('error', reject);
  });
  assert.deepEqual(frame.actors, []);
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { origin: 'https://evil.example' });
    ws.on('open', () => {
      ws.close();
      reject(new Error('Accepted cross-origin websocket'));
    });
    ws.on('error', resolve);
  });
  const oldUrl = service.url;
  await service.stop();
  await service.start();
  assert.equal(service.url, oldUrl);
});
test('port conflicts produce actionable failure without changing the saved URL', async (t) => {
  const root = temporary(t),
    port = await freePort();
  const one = new AvatarService(path.join(root, 'one')),
    two = new AvatarService(path.join(root, 'two'));
  one.storage.config.port = port;
  two.storage.config.port = port;
  await one.start();
  t.after(() => one.stop());
  t.after(() => two.stop());
  await assert.rejects(two.start(), /포트/);
  assert.equal(two.url, '');
});
