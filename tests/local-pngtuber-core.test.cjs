const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaultConfig, validateConfig, publicConfig, LIMITS } = require('../local-program/pngtuber/schema.cjs');
const { PngTuberEngine } = require('../local-program/pngtuber/engine.cjs');
const { validateImage } = require('../local-program/pngtuber/storage.cjs');
const sharp = require('sharp');

const closed = `${'a'.repeat(64)}.png`, open = `${'b'.repeat(64)}.png`, reaction = `${'c'.repeat(64)}.gif`;
function engine(extra = {}) {
  let time = 1000;
  const config = validateConfig({ enabled: true, closedAsset: closed, openAsset: open,
    reactions: [{ id: 'wave', name: 'Wave', asset: reaction, durationSec: 1 }], ...extra });
  const e = new PngTuberEngine(config, () => time);
  e.setConnected(true);
  e.setSource(true, false);
  return { e, advance(ms) { time += ms; e.tick(); } };
}
const meter = (e, db, held = 1) => e.meter([[0, 10 ** (db / 20), held]]);

test('config normalizes bounds and source fields while keeping the private key stable', () => {
  const base = defaultConfig();
  const config = validateConfig({ inputName: '  Mic\n ', inputUuid: ' abc ', thresholdDb: -999,
    holdMs: 99999, key: 'replacement', reactions: [{ id: 'r', name: 'R', asset: reaction, durationSec: 999 }] }, base);
  assert.equal(config.inputName, 'Mic');
  assert.equal(config.inputUuid, 'abc');
  assert.equal(config.thresholdDb, -100);
  assert.equal(config.holdMs, 2000);
  assert.equal(config.reactions[0].durationSec, 300);
  assert.equal(config.key, base.key);
  assert.equal(publicConfig(config).key, undefined);
  assert.throws(() => validateConfig({ version: 2 }));
  assert.throws(() => validateConfig({ reactions: Array(33).fill({}) }));
  assert.throws(() => validateConfig({ thresholdDb: NaN }));
});

test('uses channel peak, hysteresis and hold; stale or disconnected meters close immediately', () => {
  const { e, advance } = engine();
  meter(e, -80, 1);
  assert.equal(e.snapshot().mouthOpen, false, 'held peak is not speech');
  e.meter([[0, 0.001, 0], [0, 0.1, 0]]);
  assert.equal(e.snapshot().asset, open);
  meter(e, -40);
  advance(200);
  assert.equal(e.snapshot().mouthOpen, true);
  meter(e, -60);
  advance(159);
  assert.equal(e.snapshot().mouthOpen, true);
  advance(1);
  assert.equal(e.snapshot().asset, closed);
  meter(e, -20);
  advance(LIMITS.staleMeterMs);
  assert.equal(e.snapshot().mouthOpen, false);
  meter(e, -20);
  e.setConnected(false);
  meter(e, -10);
  assert.equal(e.snapshot().asset, closed);
  assert.equal(e.snapshot().levelDb, -100);
});

test('mute fallback and disabled preview never produce false speech', () => {
  const { e } = engine();
  meter(e, -20);
  e.setMuted(true);
  meter(e, -10);
  assert.equal(e.snapshot().mode, 'muted');
  assert.equal(e.snapshot().asset, closed);
  e.setConfig({ ...e.config, enabled: false });
  assert.equal(e.snapshot().asset, '');
  assert.equal(e.snapshot(true).asset, closed);
  assert.equal(e.snapshot().mouthOpen, false);
});

test('reaction defaults, queue duplicates, capacity and wall-clock expiry survive disconnect', () => {
  const { e, advance } = engine();
  assert.equal(e.trigger({ reactionId: 'Wave' }, 'first').durationSec, 1);
  e.trigger({ reactionId: 'wave', durationSec: 0.2 }, 'queued');
  assert.equal(e.trigger({ reactionId: 'wave' }, 'queued').duplicate, true);
  assert.equal(e.queue.length, 1);
  e.setConnected(false);
  assert.equal(e.snapshot().mode, 'reaction');
  advance(1100);
  assert.equal(e.snapshot().remainingMs, 100);
  advance(100);
  assert.equal(e.snapshot().mode, 'closed');
  e.trigger({ reactionId: 'wave', durationSec: 300 });
  for (let i = 0; i < 20; i++) assert.equal(e.trigger({ reactionId: 'wave' }, `q${i}`).ok, true);
  assert.equal(e.trigger({ reactionId: 'wave' }, 'overflow').reason, 'queue-full');
  assert.equal(e.queue.length, 20);
  for (let i = 0; i < 1100; i++) e.trigger({ reactionId: 'missing' }, `bad${i}`);
  assert.equal(e.deliveries.size, LIMITS.deliveries);
  assert.equal(e.trigger({ reactionId: 'wave' }, 'q0').duplicate, true, 'active queue IDs remain idempotent after cache eviction');
});

test('replace, clear, ambiguous names and invalid durations are bounded', () => {
  const { e, advance } = engine({ reactionMode: 'replace' });
  e.trigger({ reactionId: 'wave' }, 'one');
  e.trigger({ reactionId: 'wave', durationSec: 0.01 }, 'two');
  assert.equal(e.snapshot().remainingMs, 100);
  assert.equal(e.queue.length, 0);
  advance(100);
  assert.equal(e.snapshot().mode, 'closed');
  e.trigger({ reactionId: 'wave' }, 'three');
  e.clear();
  assert.equal(e.trigger({ reactionId: 'wave' }, 'three').duplicate, true);
  assert.equal(e.snapshot().mode, 'closed');
  assert.equal(e.trigger({ reactionId: 'wave', durationSec: Infinity }).reason, 'invalid-duration');
  assert.equal(e.trigger({ reactionId: 'wave', expiresAt: 1 }).reason, 'expired');
  e.setConfig({ ...e.config, reactions: [...e.config.reactions, { id: 'other', name: 'Wave', asset: reaction, durationSec: 2 }] });
  assert.equal(e.trigger({ reactionId: 'Wave' }).reason, 'ambiguous-reaction');
  assert.equal(e.trigger({ reactionId: 'other' }).ok, true);
});

test('image validation rejects SVG, excessive bytes/pixels and malformed data; retains formats', async () => {
  const source = sharp({ create: { width: 8, height: 8, channels: 4, background: '#ff008080' } });
  for (const format of ['png', 'gif', 'webp']) {
    const bytes = await source.clone().toFormat(format).toBuffer();
    assert.match(await validateImage(bytes), new RegExp(`^[a-f0-9]{64}\\.${format}$`));
  }
  await assert.rejects(validateImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>')));
  await assert.rejects(validateImage(Buffer.alloc(LIMITS.fileBytes + 1)));
  await assert.rejects(validateImage(Buffer.from('not a real image at all')));
  const huge = await sharp({ create: { width: 4001, height: 4000, channels: 3, background: 'black' } }).png().toBuffer();
  await assert.rejects(validateImage(huge));
});
