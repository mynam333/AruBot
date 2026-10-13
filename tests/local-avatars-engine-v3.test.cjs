const test = require('node:test');
const assert = require('node:assert/strict');
const { Body } = require('matter-js');
const { AvatarEngine } = require('../local-program/avatars/engine.cjs');
const {
  defaultConfig,
  validateConfig,
  reactionTemplates,
  text,
  speechText,
} = require('../local-program/avatars/schema.cjs');
const { hasZalgoText } = require('../local-program/avatars/text-safety.cjs');
function world(patch = {}) {
  let now = 100000,
    serial = 0;
  const base = defaultConfig();
  const config = validateConfig({ ...base, enabled: true, ...patch }, base);
  const engine = new AvatarEngine(
    config,
    {},
    { now: () => now, random: () => 0.6 },
  );
  engine.setScope('test-channel');
  const event = (message, userId = 'a', extra = {}) => ({
    id: `e${++serial}`,
    at: now,
    userId,
    name: userId,
    role: 'everyone',
    kind: 'chat',
    text: message,
    ...extra,
  });
  const send = (...args) => engine.receive(event(...args));
  const advance = (ms) => {
    now += ms;
    engine.tick();
  };
  return {
    engine,
    config,
    event,
    send,
    advance,
    actor: () => engine.actors.get(engine.key('a')),
  };
}
const reaction = (steps, extra = {}) => ({
  id: 'custom',
  name: 'custom',
  aliases: ['!custom'],
  enabled: true,
  trigger: 'command',
  role: 'everyone',
  cooldown: 1,
  minimum: 0,
  steps,
  ...extra,
});
const step = (action, duration = 2, extra = {}) => ({
  action,
  duration,
  value: '',
  ...extra,
});

test('chat bubble defaults are enabled without overriding saved preferences and values are bounded', () => {
  const config = defaultConfig();
  assert.equal(config.bubbles, true);
  assert.equal(config.bubbleDuration, 6);
  assert.equal(config.bubbleMaxLength, 72);
  assert.equal(config.bubbleSize, 22);
  const saved = validateConfig({ ...config, bubbles: false, bubbleDuration: 90, bubbleMaxLength: 2, bubbleSize: 99 }, config);
  assert.equal(saved.bubbles, false);
  assert.equal(saved.bubbleDuration, 15);
  assert.equal(saved.bubbleMaxLength, 16);
  assert.equal(saved.bubbleSize, 36);
});

test('speech truncation counts whole graphemes, normalizes whitespace and visibly ellipsizes', () => {
  assert.equal(speechText('  hello\n world\t '), 'hello world');
  assert.equal(speechText('\u1100\u1161'), '\uac00');
  const emoji = '\u{1F44D}\u{1F3FD}';
  assert.equal(speechText(emoji.repeat(20), 16), emoji.repeat(13) + '...');
  assert.equal(speechText('a'.repeat(16), 16), 'a'.repeat(16));
  assert.equal(speechText('   '), '');
});

test('ordinary chat bubbles belong to their sender and renew until the configured expiry', () => {
  const w = world({ bubbleDuration: 3, bubbleMaxLength: 16, bubbleSize: 26 });
  w.send('a'.repeat(50));
  w.send('different viewer', 'b');
  assert.equal(w.actor().bubble, 'a'.repeat(13) + '...');
  assert.equal(w.engine.actors.get(w.engine.key('b')).bubble, 'different viewer');
  assert.equal(w.engine.snapshot().bubbleSize, 26);
  w.advance(2000);
  w.send('new message');
  assert.equal(w.actor().bubbleStartedAt, 102000);
  assert.equal(w.actor().bubbleUntil, 105000);
  w.advance(2999);
  assert.equal(w.engine.snapshot().actors.find((a) => a.id === w.actor().id).bubble, 'new message');
  w.advance(2);
  assert.equal(w.engine.snapshot().actors.find((a) => a.id === w.actor().id).bubble, '');
});

test('chat commands stay out of bubbles and disabled ordinary speech preserves explicit say actions', () => {
  const w = world({ bubbles: false });
  w.send('hello');
  assert.equal(w.engine.snapshot().actors[0].bubble, '');
  w.engine.action(w.actor(), step('say', 2, { value: 'scripted speech' }));
  assert.equal(w.actor().bubble, 'scripted speech');
  const enabled = world();
  enabled.send('!not-a-command');
  assert.equal(enabled.engine.snapshot().actors[0].bubble, '');
});

test('new chat survives cancellation of old scripted speech and pause preserves its timestamps', () => {
  const w = world({ rules: [reaction([step('say', 10, { value: 'scripted' })])] });
  w.send('!custom');
  w.advance(1);
  const sequence = w.actor().speechOwner;
  assert.ok(sequence);
  w.advance(1100);
  w.send('new chat');
  w.engine.cancelSequence(sequence);
  assert.equal(w.actor().bubble, 'new chat');
  assert.ok(w.actor().bubbleUntil > 0);
  const started = w.actor().bubbleStartedAt;
  const until = w.actor().bubbleUntil;
  w.engine.setConfig({ ...w.config, paused: true });
  w.advance(5000);
  w.engine.setConfig({ ...w.config, paused: false });
  assert.equal(w.actor().bubbleStartedAt, started + 5000);
  assert.equal(w.actor().bubbleUntil, until + 5000);
});

test('v2 semantics survive normalization and unknown future versions reject', () => {
  const old = defaultConfig();
  old.version = 2;
  old.rules = [
    reaction([step('run'), step('say')], { durationFromChat: true }),
  ];
  const next = validateConfig(old, old);
  assert.equal(next.version, 3);
  assert.equal(next.rules[0].durationMode, 'legacyAllSteps');
  assert.equal(next.rules[0].interrupt, 'replace');
  assert.equal(next.rules[0].maxDuration, 960);
  assert.equal(next.avatars[0].states.idle.preserveAspect, false);
  assert.throws(() => validateConfig({ ...old, version: 4 }), {
    code: 'FUTURE_CONFIG_VERSION',
  });
});
test('new duration changes only bound step, invalid input rejects and limit is enforced', () => {
  const w = world({
    rules: [
      reaction(
        [step('run', 5, { value: '3' }), step('say', 2, { value: 'done' })],
        {
          durationFromChat: true,
          durationMode: 'step',
          durationStep: 0,
          maxDuration: 20,
        },
      ),
    ],
  });
  w.send('!custom 10');
  assert.deepEqual(
    w.engine.tasks.map((t) => t.step.duration),
    [10, 2],
  );
  w.engine.tick();
  w.advance(1100);
  assert.equal(w.send('!custom nope'), false);
  assert.equal(w.engine.lastResult.code, 'INVALID_ARGUMENT');
  assert.equal(w.send('!custom 30'), false);
  assert.equal(w.engine.lastResult.code, 'DURATION_LIMIT');
  assert.equal(w.actor().motion, 'run');
});
test('saved rule edits do not erase running sequence or cooldown', () => {
  const w = world({
    rules: [reaction([step('run', 2), step('say', 2, { value: 'original' })])],
  });
  w.send('!custom');
  w.engine.tick();
  const changed = structuredClone(w.config);
  changed.rules[0].steps[1].value = 'edited';
  w.engine.setConfig(changed);
  assert.equal(w.send('!custom'), false);
  w.advance(2100);
  assert.equal(w.engine.snapshot().actors[0].bubble, 'original');
});
test('parallel speech and pose preserve motion; replacement cancels temporary effects', () => {
  const w = world({
    rules: [
      reaction([step('run', 8)], { aliases: ['!go'] }),
      reaction(
        [
          step('wave', 2),
          step('say', 2, { start: 'withPrevious', value: 'hello' }),
        ],
        { id: 'chat', trigger: 'chat', aliases: [], interrupt: 'parallel' },
      ),
      reaction([step('size', 3, { value: '1.5', sizeMode: 'temporary' })], {
        id: 'size',
        aliases: ['!grow'],
        interrupt: 'parallel',
      }),
    ],
  });
  w.send('!go');
  w.engine.tick();
  w.send('hello');
  w.engine.tick();
  assert.equal(w.actor().motion, 'run');
  assert.equal(w.engine.snapshot().actors[0].state, 'wave');
  w.send('!grow');
  w.engine.tick();
  assert.equal(w.actor().profile.scale, 1);
  assert.equal(w.engine.snapshot().actors[0].size, w.config.size * 1.5);
  w.advance(3100);
  assert.equal(w.engine.snapshot().actors[0].size, w.config.size);
});
test('queued reactions remain bounded and execute after active sequence', () => {
  const w = world({
    rules: [
      reaction([step('say', 3, { value: 'queued' })], { interrupt: 'queue' }),
    ],
  });
  w.send('!custom');
  w.engine.tick();
  w.advance(1001);
  w.send('!custom');
  w.advance(1001);
  w.send('!custom');
  assert.equal(w.engine.sequences.size, 3);
  w.advance(1001);
  w.send('!custom');
  assert.ok(w.engine.sequences.size <= 3);
  w.advance(10000);
  assert.ok(w.engine.tasks.length <= 2);
});
test('landing completion waits for physical contact and then advances without original duration delay', () => {
  const w = world({
    rules: [
      reaction([
        step('jump', 10, { completion: 'landing' }),
        step('say', 2, { value: 'landed' }),
      ]),
    ],
  });
  w.send('!custom');
  w.engine.tick();
  for (let i = 0; i < 90; i++) w.advance(1000 / 30);
  assert.ok(w.engine.stats.actions >= 2);
  assert.ok(w.engine.diagnostics.some((d) => d.code === 'EXECUTED'));
});
test('target selectors support quoted names and numbers; opt-out and departures stop interaction', () => {
  const w = world({
    allowTargeting: true,
    rules: [
      reaction(
        [
          step('follow', 8, { completion: 'arrival' }),
          step('say', 2, { value: 'arrived' }),
        ],
        { durationFromChat: true, durationMode: 'step' },
      ),
    ],
  });
  w.send('hi', 'b', { name: 'two words' });
  w.send('hi');
  assert.equal(w.send('!custom "two words" 5'), true);
  w.engine.tick();
  assert.equal(w.actor().follow, w.engine.key('b'));
  w.engine.remove(w.engine.key('b'));
  w.advance(33);
  assert.equal(w.engine.sequences.size, 0);
  assert.ok(w.engine.diagnostics.some((d) => d.code === 'TARGET_MISSING'));
  w.advance(1100);
  w.send('hi', 'c', { name: 'same' });
  w.send('hi', 'd', { name: 'same' });
  assert.equal(w.send('!custom same'), false);
  assert.equal(w.engine.lastResult.code, 'TARGET_AMBIGUOUS');
  const other = w.engine.actors.get(w.engine.key('c'));
  assert.equal(w.send(`!custom #${other.number}`), true);
  w.send('!상호작용 off', 'c');
  w.advance(33);
  assert.equal(w.actor().follow, null);
});
test('highfive contact requires same height and tracks a moving target', () => {
  const w = world({ allowTargeting: true });
  w.send('hi');
  w.send('hi', 'b');
  const b = w.engine.actors.get(w.engine.key('b'));
  Body.setPosition(w.actor().body, { x: 900, y: w.engine.ground - 16 });
  Body.setPosition(b.body, { x: 960, y: w.engine.ground - 300 });
  w.send('!하이파이브 b');
  w.engine.tick();
  assert.equal(b.effect, '');
});
test('separate budgets preserve voluntary exit under general chat floods', () => {
  const w = world();
  w.send('hi');
  for (let i = 0; i < 300; i++) w.send('hello', `noise-${i}`);
  assert.equal(w.send('!leave'), true);
  assert.equal(w.actor(), undefined);
  assert.ok(w.engine.diagnostics.length <= 200);
});
test('timeout, admission queue and closed new joins have independent behavior', () => {
  const w = world({ maxActors: 1, admission: 'queue' });
  w.send('hi');
  w.send('hi', 'b');
  assert.equal(w.engine.waiting.size, 1);
  w.engine.moderate('timeout', w.actor().id, { minutes: 1 });
  w.engine.tick();
  assert.equal(w.engine.actors.size, 1);
  assert.equal(w.send('!join'), false);
  w.advance(61000);
  w.engine.setConfig({ ...w.config, newJoins: false });
  assert.equal(w.send('!join'), false);
  assert.equal(w.engine.lastResult.code, 'JOINS_CLOSED');
});
test('firstJoin triggers once per channel session', () => {
  const w = world({
    rules: [reaction([step('wave')], { trigger: 'firstJoin', aliases: [] })],
  });
  w.send('hi');
  w.engine.tick();
  assert.equal(w.engine.stats.actions, 1);
  w.send('!leave');
  w.advance(1500);
  w.send('!join');
  w.engine.tick();
  assert.equal(w.engine.stats.actions, 1);
  w.engine.setScope('another');
  w.send('!join');
  w.engine.tick();
  assert.equal(w.engine.stats.actions, 2);
});
test('games recruit explicitly, count down, bound boosts and finalize only once', () => {
  const w = world();
  w.send('hi');
  w.send('hi', 'b');
  w.engine.startGame('race', 10, {
    recruitSeconds: 2,
    countdownSeconds: 1,
    boosts: 1,
  });
  assert.equal(w.engine.game.phase, 'recruit');
  assert.equal(w.engine.game.players.length, 0);
  w.send('!참가');
  w.advance(2100);
  assert.equal(w.engine.game.phase, 'countdown');
  w.advance(1100);
  assert.equal(w.engine.game.phase, 'running');
  assert.equal(w.engine.boost(w.actor()), true);
  assert.equal(w.engine.boost(w.actor()), false);
  w.engine.finishGame('winner', w.actor());
  w.engine.finishGame('duplicate', w.actor());
  assert.equal(w.actor().profile.wins, 1);
  assert.equal(w.engine.game.result, 'winner');
  assert.throws(() => w.engine.startGame('cheer', 10, { goal: 1000 }), /목표/);
});
test('templates validate without alias collisions and snapshot advertises consistent clock', () => {
  const base = defaultConfig();
  const normalized = validateConfig(
    { ...base, rules: reactionTemplates() },
    base,
  );
  assert.equal(normalized.rules.length, 6);
  const w = world();
  w.send('!run');
  w.engine.tick();
  const first = w.engine.snapshot();
  w.advance(30);
  const second = w.engine.snapshot();
  assert.equal(first.sessionId, second.sessionId);
  assert.ok(second.sequence > first.sequence);
  assert.equal(second.simulationTime - second.at, 0);
  assert.ok(second.actors[0].travelDistance > 0);
});
test('standalone text safety matches shared policy without damaging normal languages', async () => {
  const shared = await import('../shared/text-safety.js');
  for (const value of [
    '안녕하세요',
    'हिन्दी',
    'cafe\u0301',
    'a\u0301\u0301',
    'x\u200b'.repeat(10),
    'a' + '\u0301'.repeat(20),
  ])
    assert.equal(hasZalgoText(value), shared.hasZalgoText(value));
  assert.equal(text('हिन्दी'), 'हिन्दी');
  const w = world();
  assert.equal(w.send('!ru' + '\u0301'.repeat(5) + 'n'), false);
  assert.equal(w.engine.lastResult.code, 'UNSAFE_TEXT');
});
test('real simulation time bounds long suspension without replaying overdue actions', () => {
  const config = { ...defaultConfig(), enabled: true };
  const engine = new AvatarEngine(config);
  engine.setScope('channel');
  engine.join({ userId: 'one', name: 'one' });
  engine.startGame('race');
  const before = engine.now();
  engine.tick(60000);
  assert.equal(engine.now(), before);
  assert.match(engine.game.result, /중단/);
  assert.equal(engine.lastResult.code, 'SUSPEND_GAP');
});
