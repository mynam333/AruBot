const test = require('node:test');
const assert = require('node:assert/strict');
const { Body } = require('matter-js');
const { AvatarEngine } = require('../local-program/avatars/engine.cjs');
const {
  defaultConfig,
  validateConfig,
  migrateConfig,
} = require('../local-program/avatars/schema.cjs');

function reaction(id, steps, extra = {}) {
  return {
    id,
    name: id,
    aliases: [`!${id}`],
    enabled: true,
    trigger: 'command',
    role: 'everyone',
    cooldown: 1,
    minimum: 0,
    steps,
    ...extra,
  };
}

function step(action, duration, extra = {}) {
  return { action, duration, value: '', ...extra };
}

function world(rules, options = {}) {
  let now = 100000;
  let serial = 0;
  const base = defaultConfig();
  const config = validateConfig(
    { ...base, enabled: true, allowTargeting: true, rules },
    base,
  );
  const engine = new AvatarEngine(
    config,
    {},
    {
      ...(options.realClock ? {} : { now: () => now }),
      random: () => 0.6,
    },
  );
  engine.setScope('engine-review');
  const send = (message, userId = 'a') =>
    engine.receive({
      id: `review-${++serial}`,
      at: engine.wallNow(),
      userId,
      name: userId,
      role: 'everyone',
      kind: 'chat',
      text: message,
    });
  const advance = (ms) => {
    now += ms;
    engine.tick();
  };
  const actor = (userId = 'a') => engine.actors.get(engine.key(userId));
  return { config, engine, send, advance, actor };
}

test('review: early landing moves the complete following withPrevious group', () => {
  const w = world([
    reaction('land', [
      step('jump', 10, { completion: 'landing' }),
      step('size', 2, { value: '1.4', sizeMode: 'temporary' }),
      step('say', 2, { value: 'landed', start: 'withPrevious' }),
    ]),
  ]);
  assert.equal(w.send('!land'), true);
  w.engine.tick();
  for (let i = 0; i < 90 && w.engine.stats.actions < 2; i++)
    w.advance(1000 / 30);
  assert.equal(w.engine.stats.actions >= 2, true, 'jump has landed');
  assert.equal(w.engine.snapshot().actors[0].bubble, 'landed');
});

test('review: queued reaction starts when arrival predecessor actually completes', () => {
  const w = world([
    reaction('approach', [step('follow', 10, { completion: 'arrival' })]),
    reaction('reply', [step('say', 2, { value: 'queued' })], {
      interrupt: 'queue',
    }),
  ]);
  w.send('hello', 'b');
  w.send('hello');
  Body.setPosition(w.actor().body, { x: 900, y: w.engine.ground - 16 });
  Body.setPosition(w.actor('b').body, { x: 970, y: w.engine.ground - 16 });
  assert.equal(w.send('!approach b'), true);
  w.engine.tick();
  assert.equal(w.send('!reply'), true);
  w.advance(33);
  assert.equal(
    [...w.engine.sequences.values()].some((s) => s.rule.id === 'approach'),
    false,
    'arrival predecessor has finished',
  );
  assert.equal(
    w.engine.snapshot().actors.find((a) => a.name === 'a').bubble,
    'queued',
  );
});

test('review: withPrevious wave must not overwrite the same sequence run lane', () => {
  const w = world([
    reaction('runwave', [
      step('run', 5, { value: '3' }),
      step('wave', 5, { start: 'withPrevious' }),
    ]),
  ]);
  assert.equal(w.send('!runwave'), true);
  w.engine.tick();
  assert.equal(w.engine.stats.actions, 2);
  assert.equal(w.actor().motion, 'run');
  assert.ok(Math.abs(w.actor().body.velocity.x) > 0);
});

test('review: skipping a missing arrival target must preserve the next speech step', () => {
  const w = world([
    reaction(
      'approach',
      [
        step('follow', 10, { completion: 'arrival' }),
        step('say', 2, { value: 'skipped' }),
      ],
      { failure: 'skip' },
    ),
  ]);
  w.send('hello', 'b');
  w.send('hello');
  assert.equal(w.send('!approach b'), true);
  w.engine.tick();
  w.engine.remove(w.actor('b').id);
  w.advance(33);
  assert.equal(w.engine.snapshot().actors[0].bubble, 'skipped');
  assert.equal(w.engine.sequences.size, 1);
});

test('review: advancing a paused real-clock engine must exclude elapsed pause time', () => {
  const w = world(
    [reaction('speak', [step('say', 5, { value: 'still speaking' })])],
    { realClock: true },
  );
  assert.equal(w.send('!speak'), true);
  w.engine.tick(0);
  w.engine.setConfig({ ...w.config, paused: true });
  for (let i = 0; i < 60; i++) w.engine.tick(100);
  assert.equal(w.engine.snapshot().actors[0].bubble, 'still speaking');
  w.engine.advance(1000 / 30);
  assert.equal(w.engine.snapshot().actors[0].bubble, 'still speaking');
  assert.equal(w.engine.sequences.size, 1);
});

test('review: previously valid v2 aliases must not invalidate the entire migrated config', () => {
  const legacy = defaultConfig();
  legacy.version = 2;
  legacy.rules = [reaction('boost', [step('wave', 2)])];
  assert.doesNotThrow(() => validateConfig(migrateConfig(legacy), legacy));
  const normalized = validateConfig(migrateConfig(legacy), legacy);
  normalized.enabled = true;
  const engine = new AvatarEngine(normalized);
  engine.setScope('legacy');
  assert.equal(engine.receive({id:'legacy-boost',at:engine.wallNow(),userId:'one',name:'one',kind:'chat',text:'!boost'}),true);
  engine.tick(0);
  assert.equal(engine.snapshot().actors[0].state,'wave');
});
