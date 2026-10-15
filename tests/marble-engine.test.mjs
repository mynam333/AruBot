import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../shared/marble.js';

const { createMarbleState, parseMarbleSettings, applyMarbleAction, marbleTimerRemaining, marbleBoardPosition, marbleBlockGeometry, marbleBoardLayout,
  toPublicMarbleState, MarbleError, DEFAULT_MARBLE_SETTINGS: defaults, MARBLE_BLOCK_GEOMETRY: geometry, MARBLE_SIZES: sizes } = engine;
const clone = value => structuredClone(value);
const playerId = 'player-1';
function board(effects = {}, count = 24) {
  return Array.from({ length: count }, (_, i) => ({ id: `tile-${i}`, title: `Tile ${i}`, text: `Mission ${i}`, color: '#2c9c87', effects: effects[i] ?? [] }));
}
function card(id, effects = []) { return { id, title: id, text: `Card ${id}`, color: '#d4a52b', effects }; }
function harness({ effects = {}, cards = [card('card-a')], players = 1, diceCount = 1, start = true } = {}) {
  let serial = 0;
  const context = { now: 10000, randomInt: () => 0, uuid: () => `generated-${++serial}` };
  const h = { context, state: createMarbleState(),
    act(action, fields = {}, at = context.now) {
      context.now = at;
      this.state = applyMarbleAction(this.state, { action, ...fields }, context);
      return this.state;
    },
    finish(id = playerId, action = 'complete') {
      return this.act(action, { playerId: id }, this.state.playerStates[id].pending.readyAt);
    },
  };
  h.act('settings', { settings: { tiles: board(effects), cards, diceCount } });
  for (let i = 1; i < players; i++) h.act('add-player', { name: `Player ${i + 1}` });
  if (start) h.act('start');
  return h;
}
function frozen(value) {
  for (const item of Object.values(value)) if (item && typeof item === 'object') frozen(item);
  return Object.freeze(value);
}
function expectCode(action, code, status) {
  assert.throws(action, error => error instanceof MarbleError && error.code === code && (status === undefined || error.status === status));
}

test('exports match the shared declaration and defaults start with a single playable pawn', () => {
  for (const name of ['createMarbleState', 'parseMarbleSettings', 'applyMarbleAction', 'marbleErrorMessage', 'marbleBoardPosition', 'marbleBlockGeometry', 'marbleBoardLayout', 'marbleTimerRemaining', 'toPublicMarbleState', 'MarbleError', 'DEFAULT_MARBLE_SETTINGS', 'MARBLE_COLORS', 'MARBLE_EFFECT_LABELS', 'MARBLE_BLOCK_LABELS', 'MARBLE_SIZES', 'MARBLE_BLOCK_GEOMETRY']) assert.ok(engine[name], name);
  const a = createMarbleState(), b = createMarbleState();
  assert.equal(a.players.length, 1);
  assert.deepEqual(a.players[0], { id: playerId, name: '\ud50c\ub808\uc774\uc5b4', color: engine.MARBLE_COLORS[0], userId: null, avatarUrl: null, position: 0, laps: 0, skipTurns: 0, shields: 0 });
  assert.equal(a.currentPlayerId, playerId);
  assert.equal(a.gameId, null);
  assert.equal(a.settings.tiles.length, 24);
  assert.equal(a.settings.cards.length, 12);
  assert.equal(a.settings.triggerPlayerId, null);
  assert.equal(a.settings.points.command, '!\uc8fc\ub8e8\ub9c8\ube14');
  assert.equal(a.settings.points.enabled, false);
  assert.equal(a.settings.donation.enabled, false);
  assert.ok(a.settings.tiles[8].effects.some(effect => effect.type === 'timer'));
  assert.ok(!a.settings.tiles.some(tile => tile.effects.some(effect => effect.type === 'skip')));
  assert.deepEqual(a.settings, defaults);
  a.players[0].name = 'Changed'; a.settings.tiles[0].title = 'Changed'; a.playerStates[playerId].donationQueue.push({});
  assert.equal(b.players[0].name, '\ud50c\ub808\uc774\uc5b4');
  assert.notEqual(defaults.tiles[0].title, 'Changed');
  assert.deepEqual(b.donationQueue, []);
  assert.deepEqual(b.playerStates[playerId].donationQueue, []);
});

test('server-authorized leave removes the active pawn, its timer and queue without changing other runtimes', () => {
  const h = harness({ players: 2, effects: { 1: [{ type: 'timer', value: 120 }] } });
  const leavingId = h.state.players[1].id;
  h.act('roll', { playerId: leavingId });
  h.act('roll', { playerId });
  h.act('enqueue-donation', { playerId: leavingId, donation: { id: 'leaving-queue', username: 'Viewer', provider: 'chzzk' } });
  h.act('focus', { playerId: leavingId });
  const retained = clone(h.state.playerStates[playerId]);
  const oldState = clone(h.state);
  h.act('leave-player', { playerId: leavingId });
  assert.equal(h.state.players.length, 1);
  assert.equal(h.state.status, 'running');
  assert.equal(h.state.playerStates[leavingId], undefined);
  assert.deepEqual(h.state.playerStates[playerId], retained);
  assert.equal(h.state.currentPlayerId, playerId);
  assert.ok(oldState.playerStates[leavingId].timer);
  h.act('pause');
  h.act('leave-player', { playerId });
  assert.equal(h.state.status, 'finished');
  assert.equal(h.state.pausedAt, null);
  assert.equal(h.state.currentPlayerId, null);
  assert.equal(h.state.timer, null);
});

test('viewer participation settings share host validation without accepting room controls', () => {
  const parse = engine.parseMarbleParticipationSettings;
  const value = parse({ points: { enabled: true, command: '!내주사위', cost: 250 }, donation: { minimum: 2000 } });
  assert.deepEqual(value, { points: { enabled: true, command: '!내주사위', cost: 250 }, donation: { enabled: false, minimum: 2000 } });
  assert.deepEqual(parse({ donation: { enabled: true } }, value).points, value.points);
  assert.deepEqual(parse({}), engine.DEFAULT_MARBLE_PARTICIPATION_SETTINGS);
  for (const input of [
    { triggerPlayerId: 'someone-else' }, { tiles: [] }, { title: 'other room' },
    { points: { ownerUserId: 'other' } }, { points: { enabled: 'true' } },
    { points: { cost: 0 } }, { points: { cost: 1.2 } }, { points: { command: '!one !two' } },
    { donation: { minimum: -1 } }, { donation: { minimum: 1000000001 } },
  ]) assert.throws(() => parse(input), MarbleError);
  assert.equal(defaults.points.cost, 100);
});

test('Live2D defaults favor drinks, snacks and timed speech without physical performance missions', () => {
  const food = item => ['drink', 'snack', 'cheers'].includes(item.icon);
  assert.equal(defaults.tiles.filter(food).length, 10);
  for (const item of [...defaults.tiles, ...defaults.cards]) {
    assert.ok(Object.hasOwn(engine.MARBLE_ICON_LABELS, item.icon));
    assert.doesNotMatch(item.title, /손하트|포즈|즉석 광고|방송용 한마디|선택 음료|금지어 3분|20초 금지어|다나까|왕족|패스권/);
    if (item.icon === 'forbidden') {
      assert.ok(item.effects.some(effect => effect.type === 'timer' && effect.value === 180));
    }
  }
  assert.equal(defaults.tiles[10].title, '냥체/멍체 2분');
  assert.deepEqual(defaults.tiles[10].effects, [{ type: 'timer', value: 120 }]);
  assert.equal(defaults.tiles[19].title, '외국어 금지 3분');
  assert.match(defaults.tiles[19].text, /외래어/);
  assert.equal(defaults.tiles[18].title, '안주 쉬는 시간');
  assert.deepEqual(defaults.tiles[18].effects, [{ type: 'timer', value: 60 }]);
  assert.deepEqual(defaults.tiles[5].effects, [{ type: 'rollForward' }]);
  assert.deepEqual(defaults.tiles[14].effects, [{ type: 'rollBackward' }]);
});

test('all twelve golden cards are editable voice-friendly missions with conditional outcomes', () => {
  const titles = new Set(defaults.tiles.map(tile => tile.title));
  for (const item of defaults.cards) {
    assert.ok(!titles.has(item.title));
    assert.ok(Object.hasOwn(engine.MARBLE_EVENT_LABELS, item.eventKind));
    assert.ok(item.challenge);
    assert.ok(item.challenge.success.text && item.challenge.failure.text);
    assert.ok(item.effects.every(effect => ['message', 'timer'].includes(effect.type)));
  }
  const types = new Set(defaults.cards.flatMap(item => [...item.challenge.success.effects, ...item.challenge.failure.effects].map(effect => effect.type)));
  for (const type of ['shield', 'shieldLoss', 'timer', 'extra']) assert.ok(types.has(type));
  assert.equal(defaults.cards.filter(item => item.challenge.rollDice).length, 2);
  const state = createMarbleState();
  assert.deepEqual(toPublicMarbleState(state).settings.cards, state.settings.cards);
  for (const eventKind of ['__proto__', 'unknown', null]) expectCode(() => parseMarbleSettings({ cards: [{ ...card('bad'), eventKind }] }), 'invalid_event_kind');
  const tiles = board(); tiles[1].eventKind = 'rule';
  expectCode(() => parseMarbleSettings({ tiles }), 'invalid_event_kind');
  const h = harness({ effects: { 1: [{ type: 'card' }] }, cards: [clone(defaults.cards[0])] });
  h.act('roll');
  assert.equal(h.state.players[0].shields, 0);
  expectCode(() => h.finish(), 'challenge_result_required');
  h.act('challenge-result', { outcome: 'success' }, h.state.pending.readyAt);
  assert.equal(h.state.players[0].shields, 1);
  h.finish();
  assert.equal(h.state.players[0].shields, 1);
});

test('mission die is independent of board dice, persisted, animation-gated and cannot reroll', () => {
  const h = harness({ effects: { 2: [{ type: 'card' }] }, cards: [clone(defaults.cards[2])], diceCount: 2 });
  h.act('roll');
  const boardRoll = clone(h.state.lastRoll), player = clone(h.state.players[0]);
  expectCode(() => h.act('challenge-roll'), 'animation_in_progress');
  expectCode(() => h.act('challenge-result', { outcome: 'success' }, h.state.pending.readyAt), 'challenge_roll_required');
  h.context.randomInt = () => 5;
  h.act('challenge-roll');
  const mission = h.state.pending.challenge.roll;
  assert.deepEqual(mission.dice, [6]);
  assert.deepEqual(mission.path, []);
  assert.deepEqual(h.state.lastRoll, boardRoll);
  assert.deepEqual(h.state.players[0], player);
  assert.equal(h.state.round, 1);
  assert.match(h.state.pending.text, /6눈/);
  assert.deepEqual(toPublicMarbleState(h.state).pending.challenge.roll, mission);
  expectCode(() => h.act('challenge-result', { outcome: 'success' }), 'animation_in_progress');
  expectCode(() => h.act('challenge-roll', {}, mission.endsAt), 'challenge_roll_unavailable');
  h.act('challenge-result', { outcome: 'success' });
  assert.equal(h.state.players[0].shields, 2);
  const resolved = clone(h.state);
  expectCode(() => h.act('challenge-result', { outcome: 'failure' }), 'challenge_already_resolved');
  assert.deepEqual(h.state, resolved);
});

test('mission die and timer pause/resume with the shared clock without moving the pawn', () => {
  const custom = clone(defaults.cards[2]); custom.effects = [{ type: 'timer', value: 30 }];
  const h = harness({ effects: { 1: [{ type: 'card' }] }, cards: [custom] });
  h.act('roll');
  assert.equal(h.state.timer.paused, true);
  h.act('challenge-roll', {}, h.state.pending.readyAt);
  const before = clone(h.state.pending.challenge.roll), deadline = h.state.timer.deadline;
  h.act('pause', {}, before.startedAt + 300);
  h.act('resume', {}, h.context.now + 10000);
  assert.equal(h.state.pending.challenge.roll.startedAt, before.startedAt + 10000);
  assert.equal(h.state.pending.challenge.roll.endsAt, before.endsAt + 10000);
  assert.equal(h.state.timer.deadline, deadline + 10000);
  assert.equal(h.state.players[0].position, 1);
  expectCode(() => h.act('challenge-result', { outcome: 'success' }), 'animation_in_progress');
  h.act('challenge-result', { outcome: 'success' }, h.state.pending.challenge.roll.endsAt);
});

test('failure applies only its branch once and replaces the mission timer with a penalty timer', () => {
  const h = harness({ effects: { 1: [{ type: 'card' }] }, cards: [clone(defaults.cards[5])] });
  h.act('roll');
  h.act('challenge-result', { outcome: 'failure' }, h.state.pending.readyAt + 60000);
  assert.equal(h.state.players[0].shields, 0);
  assert.equal(h.state.pending.challenge.outcome, 'failure');
  assert.equal(h.state.timer.durationMs, 30000);
  assert.equal(h.state.timer.deadline, h.context.now + 30000);
  assert.match(h.state.pending.text, /멍/);
});

test('mission pass cancels outcomes; confirmed bonuses wait for result acknowledgement before rolling', () => {
  const h = harness({ effects: { 1: [{ type: 'card' }] }, cards: [clone(defaults.cards[11])] });
  h.act('roll');
  h.state.players[0].shields = 1;
  h.finish(playerId, 'pass');
  assert.equal(h.state.players[0].shields, 0);
  assert.equal(h.state.phase, 'ready');
  const other = harness({ effects: { 1: [{ type: 'card' }] }, cards: [clone(defaults.cards[11])] });
  other.act('roll');
  other.act('enqueue-donation', { donation: { id: 'queued', username: 'Viewer 1', provider: 'chzzk' } });
  other.act('challenge-result', { outcome: 'success' }, other.state.pending.readyAt);
  assert.equal(other.state.round, 1);
  assert.equal(other.state.donationQueue.length, 1);
  other.finish();
  assert.equal(other.state.lastRoll.source, 'bonus');
  assert.equal(other.state.donationQueue.length, 1);
});

test('challenge validation rejects injected fields, premature effects, invalid branches and conflicting cards', () => {
  const value = clone(defaults.cards[0]);
  for (const challenge of [
    { ...value.challenge, outcome: 'success' }, { ...value.challenge, rollDice: 'yes' },
    { ...value.challenge, failure: { text: '', effects: [] } },
    { ...value.challenge, success: { text: 'bad', effects: [{ type: 'card' }] } },
    { ...value.challenge, success: { text: 'bad', effects: [{ type: 'goto', value: 0 }] } },
    { ...value.challenge, success: { text: 'bad', effects: [{ type: 'extra' }, { type: 'rollForward' }] } },
  ]) assert.throws(() => parseMarbleSettings({ cards: [{ ...value, challenge }] }), MarbleError);
  expectCode(() => parseMarbleSettings({ cards: [{ ...value, effects: [{ type: 'shield' }] }] }), 'invalid_challenge_effect');
  expectCode(() => parseMarbleSettings({ tiles: board({ 1: [{ type: 'card' }, { type: 'card' }] }) }), 'conflicting_challenge_effects');
  expectCode(() => parseMarbleSettings({ tiles: board().map((tile, i) => i === 1 ? { ...tile, challenge: value.challenge } : tile) }), 'invalid_challenge_effect');
});

test('explicit artwork survives parsing and public snapshots while legacy content stays unchanged', () => {
  const settings = parseMarbleSettings({});
  assert.deepEqual(settings, defaults);
  const state = createMarbleState();
  state.settings.tiles[1].icon = 'talk';
  assert.equal(toPublicMarbleState(state).settings.tiles[1].icon, 'talk');
  for (const icon of Object.keys(engine.MARBLE_ICON_LABELS)) {
    const tiles = board(); tiles[2].icon = icon;
    assert.equal(parseMarbleSettings({ tiles }).tiles[2].icon, icon);
  }
  for (const icon of ['unknown', '__proto__', 'constructor', null, 3]) {
    const tiles = board(); tiles[2].icon = icon;
    expectCode(() => parseMarbleSettings({ tiles }), 'invalid_icon');
  }
  const legacy = parseMarbleSettings({ tiles: board(), cards: [card('legacy')] });
  assert.deepEqual(parseMarbleSettings({ title: 'Custom' }, legacy).tiles, legacy.tiles);
  assert.equal(Object.hasOwn(legacy.tiles[1], 'icon'), false);
  const guess = (title, effects = []) => engine.marbleContentIcon({ title, effects });
  assert.equal(guess('금지어 3분', [{ type: 'timer', value: 180 }]), 'forbidden');
  assert.equal(guess('TMI 하나'), 'talk');
  assert.equal(guess('안주 한 입'), 'snack');
  assert.equal(guess('Custom', [{ type: 'move', value: -1 }]), 'backward');
  assert.equal(guess('Custom', [{ type: 'move', value: 2 }]), 'forward');
  assert.equal(guess('Custom'), 'mission');
});

test('partial settings are copied and preserve nested configuration', () => {
  const base = parseMarbleSettings({ points: { cost: 250 }, title: 'Party', layouts: { portrait: { dice: { visible: false } } } });
  const result = parseMarbleSettings({ points: { enabled: true } }, frozen(base));
  assert.equal(result.points.cost, 250);
  assert.equal(result.points.enabled, true);
  assert.equal(result.title, 'Party');
  assert.equal(result.layouts.portrait.dice.visible, false);
  result.cards[0].effects.length = 0;
  assert.equal(base.cards[0].effects.length, defaults.cards[0].effects.length);
});

for (const [label, patch] of [
  ['unknown settings', { javascript: 'alert(1)' }], ['array input', []], ['null input', null],
  ['unknown nested setting', { points: { script: true } }], ['invalid dice', { diceCount: 3 }], ['numeric string', { diceCount: '1' }],
  ['invalid bool', { participantControl: 1 }], ['fractional cost', { points: { cost: 1.5 } }], ['zero cost', { points: { cost: 0 } }],
  ['negative donation', { donation: { minimum: -1 } }], ['huge donation', { donation: { minimum: 1000000001 } }],
  ['NaN', { points: { cost: NaN } }], ['Infinity', { points: { cost: Infinity } }],
  ['empty title', { title: ' ' }], ['long title', { title: 'a'.repeat(61) }], ['multiline name', { title: 'a\nb' }],
  ['bad command', { points: { command: '!two words' } }], ['no prefix', { points: { command: 'roll' } }],
  ['unknown orientation', { layouts: { square: {} } }], ['unknown block', { layouts: { portrait: { pawn: {} } } }],
  ['out of bounds layout', { layouts: { portrait: { board: { x: -1 } } } }], ['invalid visibility', { layouts: { portrait: { board: { visible: 'yes' } } } }],
  ['reserved identifier', { triggerPlayerId: '__proto__' }], ['array object', { points: [] }],
]) test(`strict settings reject ${label}`, () => assert.throws(() => parseMarbleSettings(patch), MarbleError));

test('boards, cards, text, colors and effect counts are bounded', () => {
  for (const count of [0, 8, 13, 41, 44]) assert.throws(() => parseMarbleSettings({ tiles: board({}, count) }), MarbleError);
  for (const count of [12, 16, 20, 24, 28, 32, 36, 40]) assert.equal(parseMarbleSettings({ tiles: board({}, count), cards: [card('c')] }).tiles.length, count);
  assert.throws(() => parseMarbleSettings({ cards: [] }), MarbleError);
  assert.throws(() => parseMarbleSettings({ cards: Array.from({ length: 61 }, (_, i) => card(`c${i}`)) }), MarbleError);
  assert.equal(parseMarbleSettings({ cards: Array.from({ length: 60 }, (_, i) => card(`c${i}`)) }).cards.length, 60);
  for (const patch of [
    { cards: [card('same'), card('same')] }, { tiles: board().fill(board()[0]) },
    { cards: [{ ...card('c'), text: 'a'.repeat(1001) }] }, { cards: [{ ...card('c'), color: 'url(javascript:alert(1))' }] },
    { cards: [{ ...card('c'), url: 'https://example.com' }] }, { cards: [card('c', Array(7).fill({ type: 'message' }))] },
    { cards: [card('c', [{ type: 'message', text: 'a'.repeat(501) }])] },
  ]) assert.throws(() => parseMarbleSettings(patch), MarbleError);
  const sparse = board(); delete sparse[2];
  assert.throws(() => parseMarbleSettings({ tiles: sparse }), MarbleError);
});

test('all effect boundaries validate and unknown or nested card effects reject', () => {
  for (const [type, min, max] of [['timer', 5, 600], ['move', -12, 12], ['goto', 0, 23], ['skip', 1, 3], ['shield', 1, 99], ['shieldLoss', 1, 99]]) {
    for (const value of [min, max]) assert.equal(parseMarbleSettings({ tiles: board({ 1: [{ type, value }] }) }).tiles[1].effects[0].value, value);
    for (const value of [min - 1, max + 1, '1', 1.5, Infinity, NaN, null, undefined]) assert.throws(() => parseMarbleSettings({ tiles: board({ 1: [{ type, value }] }) }), MarbleError);
  }
  for (const effect of [{ type: 'execute' }, { type: 'constructor' }, { type: 'card', value: 1 }, { type: 'shield', value: 100 }, { type: 'extra', value: 0 }, { type: 'message', html: '<script />' }]) assert.throws(() => parseMarbleSettings({ tiles: board({ 1: [effect] }) }), MarbleError);
  expectCode(() => parseMarbleSettings({ cards: [card('c', [{ type: 'card' }])] }), 'nested_card');
  assert.throws(() => parseMarbleSettings({ tiles: board({}, 12), cards: [card('c', [{ type: 'goto', value: 12 }])] }), MarbleError);
});

test('shield rewards, losses, clearing and doubling clamp and expose actual changes exactly once', () => {
  for (const [before, effects, after] of [
    [0, [{ type: 'shield' }], 1], [2, [{ type: 'shield', value: 3 }], 5],
    [98, [{ type: 'shield', value: 3 }], 99], [99, [{ type: 'shield' }], 99],
    [3, [{ type: 'shieldLoss', value: 2 }], 1], [1, [{ type: 'shieldLoss', value: 2 }], 0],
    [0, [{ type: 'shieldLoss', value: 99 }], 0], [12, [{ type: 'shieldClear' }], 0],
    [3, [{ type: 'shieldDouble' }], 6], [0, [{ type: 'shieldDouble' }], 0],
    [60, [{ type: 'shieldDouble' }], 99],
    [2, [{ type: 'shield', value: 2 }, { type: 'shieldLoss', value: 1 }, { type: 'shieldDouble' }], 6],
  ]) {
    const h = harness({ effects: { 1: [{ type: 'card' }] }, cards: [card('event', effects)] });
    h.state.players[0].shields = before;
    h.act('roll');
    assert.equal(h.state.players[0].shields, after);
    assert.equal(h.state.pending.shieldDelta, after - before);
    assert.equal(toPublicMarbleState(h.state).pending.shieldDelta, after - before);
    assert.match(h.state.history.at(-1).text, new RegExp(`${before} → ${after}`));
    h.finish();
    assert.equal(h.state.players[0].shields, after);
  }
  for (const type of ['shieldClear', 'shieldDouble']) expectCode(() => parseMarbleSettings({ cards: [card('bad', [{ type, value: 2 }])] }), 'invalid_effect');
});

test('Zalgo is rejected everywhere text can enter while ordinary Unicode remains intact', () => {
  const zalgo = 'a\u0300\u0300\u0300\u0300';
  for (const patch of [{ title: zalgo }, { points: { command: `!${zalgo}` } }, { cards: [{ ...card('c'), title: zalgo }] }, { cards: [{ ...card('c'), text: zalgo }] }, { cards: [card('c', [{ type: 'message', text: zalgo }])] }]) expectCode(() => parseMarbleSettings(patch), 'zalgo_text_not_allowed');
  const h = harness({ start: false });
  expectCode(() => h.act('add-player', { name: zalgo }), 'zalgo_text_not_allowed');
  expectCode(() => h.act('update-player', { name: zalgo }), 'zalgo_text_not_allowed');
  h.act('start');
  expectCode(() => h.act('roll', { username: zalgo }), 'zalgo_text_not_allowed');
  expectCode(() => h.act('enqueue-donation', { donation: { id: 'd', username: zalgo, provider: 'test' } }), 'zalgo_text_not_allowed');
  assert.equal(parseMarbleSettings({ title: '\ud55c\uae00 \ud83d\ude03 caf\u00e9' }).title, '\ud55c\uae00 \ud83d\ude03 caf\u00e9');
});

function overlaps(a, b) {
  const epsilon = 1e-8;
  return a.x + a.width > b.x + epsilon && b.x + b.width > a.x + epsilon &&
    a.y + a.height > b.y + epsilon && b.y + b.height > a.y + epsilon;
}

test('block geometry fills the oriented canvas for boards and preserves other native dimensions', () => {
  assert.deepEqual(geometry.timer, { width: 440, height: 170 });
  for (const orientation of ['landscape', 'portrait']) {
    assert.deepEqual(marbleBlockGeometry('board', orientation), sizes[orientation]);
    for (const block of ['dice', 'timer', 'card', 'roster']) assert.deepEqual(marbleBlockGeometry(block, orientation), geometry[block]);
    const boardGeometry = marbleBlockGeometry('board', orientation);
    boardGeometry.width = 1;
    assert.equal(marbleBlockGeometry('board', orientation).width, sizes[orientation].width);
  }
  expectCode(() => marbleBlockGeometry('pawn', 'landscape'), 'invalid_block');
  expectCode(() => marbleBlockGeometry('constructor', 'landscape'), 'invalid_block');
  expectCode(() => marbleBlockGeometry('board', 'square'), 'invalid_orientation');
  expectCode(() => marbleBlockGeometry('timer', null), 'invalid_orientation');
});

test('perimeter boards cover every edge once and leave a tile-free interior on every supported canvas', () => {
  for (const orientation of ['landscape', 'portrait']) for (const count of [12, 16, 20, 24, 28, 32, 36, 40]) {
    const layout = marbleBoardLayout(count, orientation);
    const { width, height, columns, rows, cellWidth, cellHeight, slots, interior } = layout;
    assert.equal(width, sizes[orientation].width);
    assert.equal(height, sizes[orientation].height);
    assert.equal(columns + rows, count / 2 + 2);
    assert.equal(columns, Math.max(3, Math.min(count / 2 - 1, Math.round((count / 2 + 2) * width / (width + height)))));
    assert.ok(columns >= 3 && rows >= 3);
    assert.equal(cellWidth, (width - 24) / columns);
    assert.equal(cellHeight, (height - 24) / rows);
    assert.equal(slots.length, count);
    assert.equal(new Set(slots.map(slot => `${slot.x},${slot.y}`)).size, count);
    const cells = slots.map(slot => ({ column: Math.round((slot.x - 12) / cellWidth), row: Math.round((slot.y - 12) / cellHeight) }));
    assert.deepEqual(cells[0], { column: columns - 1, row: rows - 1 });
    assert.deepEqual(cells[1], { column: columns - 2, row: rows - 1 });
    assert.deepEqual(cells[columns - 1], { column: 0, row: rows - 1 });
    assert.deepEqual(cells[columns + rows - 2], { column: 0, row: 0 });
    assert.deepEqual(cells[2 * columns + rows - 3], { column: columns - 1, row: 0 });
    assert.deepEqual(cells.at(-1), { column: columns - 1, row: rows - 2 });
    assert.deepEqual(interior, { x: 12 + cellWidth, y: 12 + cellHeight, width: (columns - 2) * cellWidth, height: (rows - 2) * cellHeight });
    assert.ok(interior.width > 0 && interior.height > 0);
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i], cell = cells[i], next = cells[(i + 1) % count];
      assert.equal(slot.width, cellWidth);
      assert.equal(slot.height, cellHeight);
      assert.ok(slot.x >= 12 && slot.y >= 12 && slot.x + slot.width <= width - 12 + 1e-8 && slot.y + slot.height <= height - 12 + 1e-8);
      assert.ok(cell.column === 0 || cell.column === columns - 1 || cell.row === 0 || cell.row === rows - 1);
      assert.equal(Math.abs(cell.column - next.column) + Math.abs(cell.row - next.row), 1);
      assert.equal(overlaps(slot, interior), false);
      for (let j = i + 1; j < slots.length; j++) assert.equal(overlaps(slot, slots[j]), false);
    }
    const tiledArea = slots.reduce((sum, slot) => sum + slot.width * slot.height, 0);
    assert.ok(Math.abs(tiledArea + interior.width * interior.height - (width - 24) * (height - 24)) < 1e-6);
    assert.deepEqual(layout, marbleBoardLayout(count, orientation));
  }
  assert.equal(marbleBoardLayout(24, 'landscape').columns, 9);
  assert.equal(marbleBoardLayout(24, 'landscape').rows, 5);
  assert.equal(marbleBoardLayout(24, 'portrait').columns, 5);
  assert.equal(marbleBoardLayout(24, 'portrait').rows, 9);
  for (const count of [0, 8, 13, 41, 44, 24.5, '24', NaN, Infinity, null]) assert.throws(() => marbleBoardLayout(count, 'landscape'), MarbleError);
  expectCode(() => marbleBoardLayout(24, 'square'), 'invalid_orientation');
  const changed = marbleBoardLayout(24, 'landscape');
  changed.slots[0].x = 0; changed.interior.width = 0;
  assert.notEqual(marbleBoardLayout(24, 'landscape').slots[0].x, 0);
  assert.notEqual(marbleBoardLayout(24, 'landscape').interior.width, 0);
});

test('full-screen defaults keep visible controls off perimeter tiles and reserve the center for the VTuber', () => {
  for (const orientation of ['landscape', 'portrait']) {
    const layout = marbleBoardLayout(defaults.tiles.length, orientation);
    const canvas = sizes[orientation];
    assert.deepEqual(defaults.layouts[orientation].board, { x: 0, y: 0, width: 100, visible: true });
    const rectangles = Object.entries(defaults.layouts[orientation]).filter(([block, value]) => block !== 'board' && value.visible).map(([block, value]) => {
      const native = marbleBlockGeometry(block, orientation);
      const width = value.width * canvas.width / 100;
      const height = width * native.height / native.width;
      const rect = { x: value.x * canvas.width / 100, y: value.y * canvas.height / 100, width, height, block };
      assert.ok(rect.x >= layout.interior.x && rect.y >= layout.interior.y &&
        rect.x + width <= layout.interior.x + layout.interior.width && rect.y + height <= layout.interior.y + layout.interior.height, `${orientation}/${block}`);
      for (const slot of layout.slots) assert.equal(overlaps(rect, slot), false, `${orientation}/${block}/tile`);
      assert.equal(overlaps(rect, { x: canvas.width / 2 - 1, y: canvas.height / 2 - 1, width: 2, height: 2 }), false, `${orientation}/${block}/VTuber-center`);
      return rect;
    });
    for (let i = 0; i < rectangles.length; i++) for (let j = i + 1; j < rectangles.length; j++) {
      const a = rectangles[i], b = rectangles[j];
      assert.equal(overlaps(a, b), false, `${orientation}/${a.block}/${b.block}`);
    }
    const board = parseMarbleSettings({ layouts: { [orientation]: { board: { x: 0, y: 0, width: 100 } } } }).layouts[orientation].board;
    assert.deepEqual(board, { x: 0, y: 0, width: 100, visible: true });
    const parsed = parseMarbleSettings({ layouts: { [orientation]: { board: { x: 100, y: 100, width: 100 } } } }).layouts[orientation].board;
    assert.deepEqual(parsed, board);
  }
  assert.equal(defaults.layouts.portrait.roster.visible, false);
});

test('custom saved layouts retain their coordinates instead of being replaced by new defaults', () => {
  const saved = clone(defaults);
  saved.layouts.landscape.board = { x: 3, y: 5, width: 49, visible: false };
  saved.layouts.portrait.board = { x: 4, y: 3, width: 92, visible: true };
  saved.layouts.landscape.dice = { x: 60, y: 7, width: 22, visible: true };
  saved.layouts.portrait.roster = { x: 64, y: 73, width: 32, visible: true };
  const before = clone(saved);
  assert.deepEqual(parseMarbleSettings({}, frozen(saved)).layouts, before.layouts);
  assert.deepEqual(parseMarbleSettings({ title: 'Custom' }, saved).layouts, before.layouts);
  const h = harness();
  h.state.settings = clone(saved);
  h.act('settings', { settings: { points: { cost: 200 } } });
  assert.deepEqual(h.state.settings.layouts, before.layouts);
  h.act('layout', { layouts: { landscape: { timer: { visible: false } } } });
  const expected = clone(before.layouts); expected.landscape.timer.visible = false;
  assert.deepEqual(h.state.settings.layouts, expected);
});

test('board positions are unique clockwise perimeter cells on every supported board size', () => {
  for (const count of [12, 16, 20, 24, 28, 32, 36, 40]) {
    const positions = Array.from({ length: count }, (_, i) => marbleBoardPosition(i, count));
    assert.equal(new Set(positions.map(p => `${p.x},${p.y}`)).size, count);
    assert.deepEqual(positions[0], { x: count / 4, y: count / 4 });
    positions.forEach((p, i) => {
      const next = positions[(i + 1) % count];
      assert.equal(Math.abs(p.x - next.x) + Math.abs(p.y - next.y), 1);
      assert.ok(p.x === 0 || p.x === count / 4 || p.y === 0 || p.y === count / 4);
    });
  }
  for (const [index, count] of [[-1, 24], [24, 24], [0.5, 24], [0, 13], [0, 44]]) assert.throws(() => marbleBoardPosition(index, count), MarbleError);
});

test('reducers return independent copies even for focus and reject failures without mutation', () => {
  const h = harness();
  const original = frozen(clone(h.state));
  const result = applyMarbleAction(original, { action: 'roll' }, h.context);
  assert.equal(original.players[0].position, 0);
  assert.equal(result.players[0].position, 1);
  assert.notEqual(result.settings, original.settings);
  assert.notEqual(result.pending, result.playerStates[playerId].pending);
  assert.equal(result.revision, original.revision + 1);
  const snapshot = clone(result);
  expectCode(() => applyMarbleAction(result, { action: 'roll' }, h.context), 'player_busy', 409);
  assert.deepEqual(result, snapshot);
});

test('start/reset generate new game IDs while preserving configured profiles and history', () => {
  const h = harness({ start: false });
  h.act('update-player', { name: 'Streamer', userId: 'owner', avatarUrl: 'https://example.com/avatar.png' });
  h.act('start');
  const first = h.state.gameId;
  h.act('roll'); h.finish(); h.act('end');
  const history = h.state.history.length;
  h.act('start');
  assert.notEqual(h.state.gameId, first);
  assert.equal(h.state.players[0].position, 0);
  assert.equal(h.state.players[0].name, 'Streamer');
  assert.equal(h.state.players[0].avatarUrl, 'https://example.com/avatar.png');
  assert.equal(h.state.history.length, history + 1);
  const second = h.state.gameId;
  h.act('reset');
  assert.notEqual(h.state.gameId, second);
  assert.equal(h.state.status, 'lobby');
  assert.equal(h.state.round, 0);
  assert.equal(h.state.lastRoll, null);
  assert.deepEqual(h.state.donationQueue, []);
  assert.deepEqual(h.state.deck, []);
});

test('roster is bounded, duplicate linked identities reject, and avatar schemes are restricted', () => {
  const h = harness({ players: 8, start: false });
  expectCode(() => h.act('add-player', { name: 'Ninth' }), 'player_limit');
  h.act('update-player', { userId: 'owner', avatarUrl: 'https://example.com/a.png' });
  const second = h.state.players[1].id;
  expectCode(() => h.act('update-player', { playerId: second, userId: 'owner' }), 'duplicate_player');
  for (const value of ['javascript:alert(1)', 'data:image/svg+xml,x', 'http://example.com/a', 'https://user:pass@example.com/a', 'not a URL']) expectCode(() => h.act('update-player', { avatarUrl: value }), 'invalid_avatar');
  h.act('update-player', { avatarUrl: null });
  assert.equal(h.state.players[0].avatarUrl, null);
  h.act('settings', { settings: { triggerPlayerId: second } });
  h.act('remove-player', { playerId: second });
  assert.equal(h.state.settings.triggerPlayerId, null);
  assert.equal(h.state.playerStates[second], undefined);
  h.act('start');
  for (const action of ['add-player', 'remove-player', 'update-player']) expectCode(() => h.act(action, action === 'add-player' ? { name: 'Extra' } : {}), 'invalid_status');
});

test('an empty roster cannot start and removed focus falls back to the first remaining player', () => {
  const h = harness({ players: 2, start: false });
  const second = h.state.players[1].id;
  h.act('remove-player', { playerId });
  assert.equal(h.state.currentPlayerId, second);
  h.act('remove-player', { playerId: second });
  assert.equal(h.state.currentPlayerId, null);
  expectCode(() => h.act('start'), 'no_players');
});

test('two players can roll simultaneously; completion does not advance or finish another player', () => {
  const h = harness({ players: 2 });
  const second = h.state.players[1].id;
  h.act('roll', { playerId });
  const firstMission = clone(h.state.playerStates[playerId]);
  h.act('roll', { playerId: second });
  assert.deepEqual(h.state.playerStates[playerId], firstMission);
  assert.equal(h.state.currentPlayerId, second);
  assert.equal(h.state.playerStates[second].phase, 'effect');
  const secondMission = clone(h.state.playerStates[second]);
  h.finish(playerId);
  assert.equal(h.state.currentPlayerId, playerId);
  assert.equal(h.state.playerStates[playerId].phase, 'ready');
  assert.deepEqual(h.state.playerStates[second], secondMission);
  h.act('roll', { playerId });
  assert.equal(h.state.players[0].position, 2);
  assert.equal(h.state.players[1].position, 1);
});

test('focus changes only stage mirrors, not gameplay or external target', () => {
  const h = harness({ players: 2 });
  const second = h.state.players[1].id;
  h.act('roll', { playerId: second });
  const states = clone(h.state.playerStates), round = h.state.round;
  h.act('focus', { playerId });
  assert.deepEqual(h.state.playerStates, states);
  assert.equal(h.state.round, round);
  assert.equal(h.state.lastRoll, null);
  h.act('focus', { playerId: second });
  assert.deepEqual(h.state.lastRoll, states[second].lastRoll);
  expectCode(() => h.act('focus', { playerId: 'missing' }), 'player_not_found');
});

test('manual default roll follows focus, external default rolls always target the first pawn', () => {
  for (const source of ['points', 'donation', 'chat']) {
    const h = harness({ players: 2 });
    const second = h.state.players[1].id;
    h.act('focus', { playerId: second });
    h.act('roll', { source });
    assert.equal(h.state.lastRoll.playerId, playerId);
    assert.equal(h.state.players[1].position, 0);
  }
  const h = harness({ players: 2 });
  const second = h.state.players[1].id;
  h.act('settings', { settings: { triggerPlayerId: second } });
  h.act('roll', { source: 'points' });
  assert.equal(h.state.lastRoll.playerId, second);
  h.finish(second);
  h.act('roll');
  assert.equal(h.state.lastRoll.playerId, second);
  expectCode(() => h.act('settings', { settings: { triggerPlayerId: 'missing' } }), 'player_not_found');
});

test('movement updates authoritative position and complete/pass/timer actions are gated by readyAt', () => {
  const h = harness({ effects: { 1: [{ type: 'timer', value: 20 }] } });
  h.act('roll');
  assert.equal(h.state.players[0].position, 1);
  assert.deepEqual(h.state.lastRoll.path, [1]);
  assert.equal(h.state.pending.readyAt, 11400);
  for (const action of ['complete', 'pass', 'timer-pause', 'timer-resume', 'timer-add', 'timer-finish']) expectCode(() => h.act(action, action === 'timer-add' ? { seconds: 30 } : {}, 11399), 'animation_in_progress');
  h.act('complete', {}, 11400);
  assert.equal(h.state.phase, 'ready');
});

test('injected randomness supplies both dice and invalid random output rejects atomically', () => {
  const h = harness({ diceCount: 2 });
  const calls = [];
  h.context.randomInt = max => { calls.push(max); return calls.length === 1 ? 5 : 2; };
  h.act('roll');
  assert.deepEqual(h.state.lastRoll.dice, [6, 3]);
  assert.deepEqual(calls, [6, 6]);
  assert.equal(h.state.players[0].position, 9);
  for (const invalid of [-1, 6, 0.5, NaN, '0']) {
    const g = harness(); const before = clone(g.state);
    g.context.randomInt = () => invalid;
    expectCode(() => g.act('roll'), 'invalid_random', 500);
    assert.deepEqual(g.state, before);
  }
});

test('forward events roll exactly one die, activate the arrival tile and retain the public timeline', () => {
  const h = harness({ diceCount: 2, effects: { 2: [{ type: 'rollForward' }], 5: [{ type: 'shield' }] } });
  h.act('roll');
  assert.equal(engine.marbleNextRoll(h.state.pending), 'forward');
  assert.equal(h.state.players[0].position, 2);
  const previousId = h.state.lastRoll.id;
  expectCode(() => h.act('complete'), 'animation_in_progress');
  h.context.randomInt = () => 2;
  h.finish();
  assert.deepEqual(h.state.lastRoll.dice, [3]);
  assert.deepEqual(h.state.lastRoll.path, [3, 4, 5]);
  assert.equal(h.state.lastRoll.direction, 1);
  assert.equal(h.state.lastRoll.source, 'event');
  assert.equal(h.state.lastRoll.endsAt - h.state.lastRoll.startedAt, 1800);
  assert.equal(h.state.players[0].shields, 1);
  assert.equal(h.state.pending.tileId, 'tile-5');
  assert.deepEqual(toPublicMarbleState(h.state).lastRoll, h.state.lastRoll);
  expectCode(() => h.act('complete', { expectedRollId: previousId }, h.state.pending.readyAt), 'stale_roll');
});

test('backward event wraps without laps and starts the destination timer after motion', () => {
  const h = harness({ diceCount: 2, effects: { 2: [{ type: 'rollBackward' }], 22: [{ type: 'timer', value: 120 }] } });
  h.act('roll');
  h.context.randomInt = () => 3;
  h.finish();
  assert.deepEqual(h.state.lastRoll.dice, [4]);
  assert.deepEqual(h.state.lastRoll.path, [1, 0, 23, 22]);
  assert.equal(h.state.lastRoll.direction, -1);
  assert.equal(h.state.players[0].laps, 0);
  assert.equal(h.state.timer.deadline, h.state.lastRoll.endsAt + 120000);
  assert.match(h.state.history.at(-1).text, /후진 4/);
});

test('movement chains require a fresh deliberate action and can be cancelled', () => {
  const h = harness({ effects: { 1: [{ type: 'rollForward' }], 2: [{ type: 'rollBackward' }] } });
  h.act('roll');
  h.finish();
  assert.equal(h.state.players[0].position, 2);
  assert.equal(h.state.round, 2);
  assert.equal(engine.marbleNextRoll(h.state.pending), 'backward');
  h.finish();
  assert.equal(h.state.players[0].position, 1);
  assert.equal(h.state.round, 3);
  h.state.players[0].shields = 1;
  h.finish(playerId, 'pass');
  assert.equal(h.state.round, 3);
  assert.equal(h.state.phase, 'ready');
});

test('custom golden movement works, and queued donations wait for its destination mission', () => {
  const h = harness({ effects: { 1: [{ type: 'card' }] }, cards: [card('move', [{ type: 'rollForward' }])] });
  h.act('roll');
  h.state.playerStates[playerId].donationQueue.push({ id: 'queued', provider: 'test', username: 'Viewer' });
  h.finish();
  assert.equal(h.state.lastRoll.source, 'event');
  assert.equal(h.state.playerStates[playerId].donationQueue.length, 1);
  h.finish();
  assert.equal(h.state.lastRoll.source, 'donation');
  assert.equal(h.state.playerStates[playerId].donationQueue.length, 0);
});

test('conflicting direction or bonus effects reject before saving, including card expansion', () => {
  for (const effects of [[{ type: 'rollForward' }, { type: 'rollBackward' }], [{ type: 'rollForward' }, { type: 'extra' }], [{ type: 'rollBackward' }, { type: 'rollBackward' }]]) {
    expectCode(() => parseMarbleSettings({ tiles: board({ 1: effects }) }), 'conflicting_roll_effects');
  }
  expectCode(() => parseMarbleSettings({ tiles: board({ 1: [{ type: 'extra' }, { type: 'card' }] }), cards: [card('c', [{ type: 'rollForward' }])] }), 'conflicting_roll_effects');
  for (const type of ['rollForward', 'rollBackward']) expectCode(() => parseMarbleSettings({ cards: [card('c', [{ type, value: 3 }])] }), 'invalid_effect');
});

test('move/goto effects extend the animation path and never activate destination tiles', () => {
  const h = harness({ effects: { 1: [{ type: 'move', value: -2 }, { type: 'goto', value: 2 }], 2: [{ type: 'shield' }], 23: [{ type: 'card' }] } });
  h.act('roll');
  assert.deepEqual(h.state.lastRoll.path, [1, 0, 23, 0, 1, 2]);
  assert.equal(h.state.lastRoll.to, 2);
  assert.equal(h.state.players[0].laps, 1);
  assert.equal(h.state.players[0].shields, 0);
  assert.equal(h.state.pending.tileId, 'tile-1');
  assert.equal(h.state.pending.cardId, undefined);
  assert.equal(h.state.lastRoll.endsAt, 10000 + 1200 + 6 * 200);
});

test('backward wrap never creates laps and goto current position adds no steps', () => {
  const h = harness({ effects: { 1: [{ type: 'move', value: -2 }, { type: 'goto', value: 23 }] } });
  h.act('roll');
  assert.deepEqual(h.state.lastRoll.path, [1, 0, 23]);
  assert.equal(h.state.players[0].laps, 0);
});

test('cards exhaust without repeats across all players and reshuffle on the following draw', () => {
  const effects = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [i, [{ type: 'card' }]]));
  const h = harness({ effects, cards: [card('a'), card('b'), card('c')], players: 2 });
  const second = h.state.players[1].id;
  const drawn = [];
  for (let i = 0; i < 6; i++) {
    const who = i % 2 ? second : playerId;
    h.act('roll', { playerId: who });
    drawn.push(h.state.pending.cardId);
    assert.ok(h.state.pending.effects.every(effect => effect.type !== 'card'));
    h.finish(who);
  }
  assert.equal(new Set(drawn.slice(0, 3)).size, 3);
  assert.equal(new Set(drawn.slice(3)).size, 3);
  assert.equal(h.state.deck.length, 0);
});

test('resolved card effects preserve order and all motion/timer/bonus outcomes', () => {
  const h = harness({ effects: { 1: [{ type: 'move', value: 1 }, { type: 'card' }, { type: 'timer', value: 5 }], 4: [{ type: 'shield' }] },
    cards: [card('c', [{ type: 'move', value: 2 }, { type: 'timer', value: 10 }, { type: 'shield' }, { type: 'extra' }, { type: 'message', text: 'Resolved message' }])] });
  h.act('roll');
  assert.deepEqual(h.state.lastRoll.path, [1, 2, 3, 4]);
  assert.deepEqual(h.state.pending.effects.map(effect => effect.type), ['move', 'move', 'timer', 'shield', 'extra', 'message', 'timer']);
  assert.equal(h.state.pending.cardId, 'c');
  assert.match(h.state.pending.text, /Resolved message/);
  assert.equal(h.state.players[0].shields, 1);
  assert.equal(h.state.pending.extraTurn, true);
  assert.equal(h.state.timer.durationMs, 15000);
  assert.equal(h.state.timer.deadline, h.state.lastRoll.endsAt + 15000);
});

test('up to six card effects expand once, including a single-card deck, with bounded runtime', () => {
  const h = harness({ effects: { 1: Array.from({ length: 6 }, () => ({ type: 'card' })) }, cards: [card('c', Array.from({ length: 6 }, () => ({ type: 'timer', value: 600 })))] });
  h.act('roll');
  assert.equal(h.state.pending.effects.length, 36);
  assert.equal(h.state.timer.durationMs, 21600000);
  expectCode(() => h.act('timer-add', { seconds: 1 }, h.state.pending.readyAt), 'timer_limit');
});

test('bonus awards exactly one roll on complete, never an automatic completion loop', () => {
  const h = harness({ effects: { 1: [{ type: 'extra' }, { type: 'extra' }], 2: [{ type: 'extra' }] } });
  h.act('roll');
  h.finish();
  assert.equal(h.state.players[0].position, 2);
  assert.equal(h.state.lastRoll.source, 'bonus');
  assert.equal(h.state.phase, 'effect');
  assert.equal(h.state.round, 2);
  expectCode(() => h.act('complete'), 'animation_in_progress');
  h.finish();
  assert.equal(h.state.players[0].position, 3);
  assert.equal(h.state.round, 3);
});

test('every pass consumes exactly one shield even when useShield is omitted or false', () => {
  for (const fields of [{}, { useShield: false }, { useShield: true }]) {
    const h = harness({ effects: { 1: [{ type: 'extra' }, { type: 'timer', value: 20 }] } });
    h.act('roll');
    h.state.players[0].shields = 2;
    h.act('pass', fields, h.state.pending.readyAt);
    assert.equal(h.state.phase, 'ready');
    assert.equal(h.state.round, 1);
    assert.equal(h.state.players[0].shields, 1);
    assert.equal(h.state.timer, null);
    assert.match(h.state.history.at(-1).text, /방어권 1장 사용/);
  }
});

test('no-shield passes cannot bypass the cost or change missions, timers, queues or history', () => {
  const h = harness({ effects: { 1: [{ type: 'timer', value: 20 }] } });
  h.act('roll');
  h.act('enqueue-donation', { donation: { id: 'queued', username: 'Viewer', provider: 'chzzk' } });
  const before = clone(h.state);
  for (const fields of [{}, { useShield: false }, { useShield: true }]) {
    expectCode(() => h.act('pass', fields, h.state.pending.readyAt), 'no_shield', 409);
    assert.deepEqual(h.state, before);
  }
});

test('pass validates the legacy useShield field without allowing it to control the cost', () => {
  const h = harness({ effects: { 1: [{ type: 'shield' }, { type: 'shield' }, { type: 'extra' }] } });
  h.act('roll');
  for (const value of [1, 'true', null, {}]) assert.throws(() => h.act('pass', { useShield: value }, h.state.pending.readyAt), MarbleError);
  h.act('pass', { useShield: true }, h.state.pending.readyAt);
  assert.equal(h.state.players[0].shields, 1);
  assert.equal(h.state.phase, 'ready');
  const missing = harness(); missing.act('roll');
  expectCode(() => missing.act('pass', { useShield: true }, missing.state.pending.readyAt), 'no_shield');
});

test('legacy skip is voluntary rest cleared by complete/pass, never a failed-roll counter', () => {
  for (const action of ['complete', 'pass']) {
    const h = harness({ effects: { 1: [{ type: 'skip', value: 3 }] } });
    h.act('roll');
    assert.equal(h.state.players[0].skipTurns, 3);
    if (action === 'pass') h.state.players[0].shields = 1;
    h.finish(playerId, action);
    assert.equal(h.state.players[0].skipTurns, 0);
    h.act('roll', { source: 'points' });
    assert.equal(h.state.players[0].position, 2);
  }
});

test('timer starts after movement, expires without advancing, can be paused/extended/finished', () => {
  const h = harness({ effects: { 1: [{ type: 'timer', value: 20 }, { type: 'move', value: 3 }] } });
  h.act('roll');
  const start = h.state.pending.readyAt;
  assert.equal(marbleTimerRemaining(h.state, 10000), 20000);
  assert.equal(marbleTimerRemaining(h.state, start + 4000), 16000);
  h.act('timer-pause', {}, start + 4000);
  assert.equal(marbleTimerRemaining(h.state, start + 1000000), 16000);
  h.act('timer-add', { seconds: 30 }, start + 5000);
  assert.equal(h.state.timer.remainingMs, 46000);
  assert.equal(h.state.timer.deadline, null);
  h.act('timer-resume', {}, start + 6000);
  assert.equal(h.state.timer.deadline, start + 52000);
  assert.equal(marbleTimerRemaining(h.state, start + 100000), 0);
  assert.equal(h.state.phase, 'effect');
  h.act('timer-add', { seconds: 10 }, start + 100000);
  assert.equal(h.state.timer.deadline, start + 110000);
  h.act('timer-finish', {}, start + 101000);
  assert.equal(marbleTimerRemaining(h.state, start + 101000), 0);
  assert.equal(h.state.phase, 'effect');
  h.act('complete', {}, start + 101000);
  assert.equal(h.state.timer, null);
  assert.equal(h.state.phase, 'ready');
});

test('global pause freezes every moving pawn and timer and resume shifts all clocks equally', () => {
  const h = harness({ effects: { 1: [{ type: 'timer', value: 20 }] }, players: 2 });
  const second = h.state.players[1].id;
  h.act('roll', { playerId }); h.act('roll', { playerId: second }, 10300);
  const before = clone(h.state.playerStates);
  h.act('pause', {}, 10500);
  assert.equal(marbleTimerRemaining(h.state, 999999, playerId), 20000);
  assert.equal(marbleTimerRemaining(h.state, 999999, second), 20000);
  for (const action of ['roll', 'complete', 'pass', 'timer-pause']) expectCode(() => h.act(action), 'invalid_status');
  h.act('resume', {}, 20500);
  for (const who of [playerId, second]) {
    const after = h.state.playerStates[who];
    assert.equal(after.lastRoll.startedAt, before[who].lastRoll.startedAt + 10000);
    assert.equal(after.lastRoll.endsAt, before[who].lastRoll.endsAt + 10000);
    assert.equal(after.pending.readyAt, before[who].pending.readyAt + 10000);
    assert.equal(after.timer.deadline, before[who].timer.deadline + 10000);
  }
});

test('manually paused timers stay paused after global resume and remain independent', () => {
  const h = harness({ effects: { 1: [{ type: 'timer', value: 20 }] }, players: 2 });
  const second = h.state.players[1].id;
  h.act('roll', { playerId }); h.act('roll', { playerId: second });
  h.act('timer-pause', { playerId }, 15400);
  h.act('pause', {}, 16400); h.act('resume', {}, 26400);
  assert.equal(h.state.playerStates[playerId].timer.paused, true);
  assert.equal(h.state.playerStates[playerId].timer.deadline, null);
  assert.equal(marbleTimerRemaining(h.state, 30000, playerId), 16000);
  assert.equal(marbleTimerRemaining(h.state, 26400, second), 15000);
  h.act('timer-finish', { playerId: second });
  assert.equal(marbleTimerRemaining(h.state, 26400, playerId), 16000);
});

test('donations queue FIFO per player, cap at twenty, and complete auto-rolls only their own queue', () => {
  const h = harness({ players: 2 });
  const second = h.state.players[1].id;
  h.act('roll', { playerId }); h.act('roll', { playerId: second });
  for (let i = 0; i < 20; i++) h.act('enqueue-donation', { playerId, donation: { id: `d-${i}`, username: `Donor ${i}`, provider: 'chzzk' } });
  expectCode(() => h.act('enqueue-donation', { playerId, donation: { id: 'overflow', username: 'Extra', provider: 'chzzk' } }), 'donation_queue_full');
  expectCode(() => h.act('enqueue-donation', { playerId: second, donation: { id: 'd-0', username: 'Repeat', provider: 'chzzk' } }), 'duplicate_donation');
  h.act('enqueue-donation', { playerId: second, donation: { id: 'second-d', username: 'Second', provider: 'youtube' } });
  h.finish(playerId);
  assert.equal(h.state.playerStates[playerId].donationQueue.length, 19);
  assert.equal(h.state.lastRoll.username, 'Donor 0');
  assert.equal(h.state.lastRoll.source, 'donation');
  assert.equal(h.state.lastRoll.playerId, playerId);
  assert.equal(h.state.playerStates[second].donationQueue.length, 1);
  h.finish(playerId);
  assert.equal(h.state.lastRoll.username, 'Donor 1');
  h.finish(second);
  assert.equal(h.state.lastRoll.username, 'Second');
});

test('ready donations roll immediately; paused queues wait and all ready players consume on resume', () => {
  const h = harness({ players: 2 });
  const second = h.state.players[1].id;
  h.act('focus', { playerId: second });
  h.act('enqueue-donation', { donation: { id: 'first', username: 'First', provider: 'chzzk' } });
  assert.equal(h.state.lastRoll.playerId, playerId);
  assert.equal(h.state.playerStates[playerId].donationQueue.length, 0);
  h.finish(); h.act('pause');
  for (const who of [playerId, second]) h.act('enqueue-donation', { playerId: who, donation: { id: `d-${who}`, username: who, provider: 'cime' } });
  assert.equal(h.state.playerStates[playerId].phase, 'ready');
  assert.equal(h.state.playerStates[second].phase, 'ready');
  h.act('resume', {}, 20000);
  for (const who of [playerId, second]) {
    assert.equal(h.state.playerStates[who].phase, 'effect');
    assert.equal(h.state.playerStates[who].lastRoll.source, 'donation');
    assert.equal(h.state.playerStates[who].donationQueue.length, 0);
  }
});

test('bonus precedes queued donation; passing bonus forfeits it and consumes the donation instead', () => {
  for (const action of ['complete', 'pass']) {
    const h = harness({ effects: { 1: [{ type: 'extra' }] } });
    h.act('roll');
    h.act('enqueue-donation', { donation: { id: 'd', username: 'Donor', provider: 'chzzk' } });
    if (action === 'pass') h.state.players[0].shields = 1;
    h.finish(playerId, action);
    assert.equal(h.state.lastRoll.source, action === 'complete' ? 'bonus' : 'donation');
    assert.equal(h.state.donationQueue.length, action === 'complete' ? 1 : 0);
    if (action === 'complete') { h.finish(); assert.equal(h.state.lastRoll.source, 'donation'); }
  }
});

test('end discards every queue and pending mission but retains history and final positions', () => {
  const h = harness({ players: 2 });
  for (const player of h.state.players) {
    h.act('roll', { playerId: player.id });
    h.act('enqueue-donation', { playerId: player.id, donation: { id: `d-${player.id}`, username: 'Donor', provider: 'test' } });
  }
  h.act('pause'); h.act('end');
  assert.equal(h.state.status, 'finished');
  assert.equal(h.state.pausedAt, null);
  assert.match(h.state.history.at(-1).text, /2/);
  for (const player of h.state.players) {
    assert.equal(player.position, 1);
    assert.equal(h.state.playerStates[player.id].pending, null);
    assert.equal(h.state.playerStates[player.id].timer, null);
    assert.equal(h.state.playerStates[player.id].donationQueue.length, 0);
  }
  expectCode(() => h.act('roll'), 'invalid_status');
  expectCode(() => h.act('enqueue-donation', { donation: { id: 'late', username: 'Late', provider: 'test' } }), 'invalid_status');
});

test('board/cards are locked while running or paused; layout and trigger settings remain editable', () => {
  const h = harness();
  for (const status of ['running', 'paused']) {
    if (status === 'paused') h.act('pause');
    for (const settings of [{ tiles: board() }, { cards: [card('new')] }]) expectCode(() => h.act('settings', { settings }), 'invalid_status');
    h.act('layout', { layouts: { portrait: { roster: { visible: false } } } });
    h.act('settings', { settings: { participantControl: false, points: { cost: 200 } } });
    assert.equal(h.state.settings.layouts.portrait.roster.visible, false);
  }
  h.act('end');
  h.act('settings', { settings: { tiles: board({}, 12), cards: [card('new')] } });
  assert.equal(h.state.settings.tiles.length, 12);
});

test('stale revisions and per-player roll identities reject, including stale completions after bonus', () => {
  const h = harness({ effects: { 1: [{ type: 'extra' }] } });
  expectCode(() => h.act('roll', { revision: h.state.revision - 1 }), 'revision_conflict', 409);
  h.act('roll', { expectedRollId: null });
  const first = h.state.lastRoll.id;
  h.act('complete', { expectedRollId: first }, h.state.pending.readyAt);
  expectCode(() => h.act('complete', { expectedRollId: first }, h.state.pending.readyAt), 'stale_roll', 409);
  expectCode(() => h.act('pass', { expectedRollId: null }), 'stale_roll');
  h.act('complete', { expectedRollId: h.state.lastRoll.id }, h.state.pending.readyAt);
  expectCode(() => h.act('roll', { expectedRollId: first }), 'stale_roll');
});

test('unknown action payloads and malformed timer controls reject', () => {
  const h = harness({ effects: { 1: [{ type: 'timer', value: 5 }] } });
  for (const action of [{ action: 'eval' }, { action: 'roll', dice: [6] }, { action: 'start', status: 'running' }, { action: 'roll', playerId: null }, { action: 'roll', revision: '1' }]) assert.throws(() => applyMarbleAction(h.state, action, h.context), MarbleError);
  h.act('roll');
  for (const seconds of [-1, 0, 601, 1.5, '30', NaN]) assert.throws(() => h.act('timer-add', { seconds }, h.state.pending.readyAt), MarbleError);
  expectCode(() => h.act('timer-resume'), 'timer_not_paused');
  h.act('timer-pause');
  expectCode(() => h.act('timer-pause'), 'timer_already_paused');
});

test('public state whitelists data and removes identity, points, donation metadata and future deck order', () => {
  const secret = 'private-secret';
  const h = harness({ effects: { 1: [{ type: 'card' }] }, cards: [card('c'), card('d')] });
  h.act('roll', { source: 'points', username: secret });
  h.act('enqueue-donation', { donation: { id: secret, username: secret, provider: secret } });
  h.state.players[0].userId = secret;
  h.state.players[0].privateData = secret;
  h.state.overlayToken = secret;
  h.state.settings.points.secret = secret;
  h.state.settings.tiles[0].secret = secret;
  h.state.playerStates[playerId].lastRoll.secret = secret;
  const before = clone(h.state);
  const result = toPublicMarbleState(h.state);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(result.deck, []);
  assert.deepEqual(result.donationQueue, []);
  assert.equal(result.settings.points.cost, 0);
  assert.equal(result.players[0].userId, undefined);
  assert.equal(result.lastRoll.username, undefined);
  assert.equal(result.pending.cardId, h.state.pending.cardId);
  assert.deepEqual(h.state, before);
  result.players[0].name = 'Public edit';
  assert.notEqual(h.state.players[0].name, result.players[0].name);
});

test('long sessions keep history bounded and remain deterministic for injected clocks and randomness', () => {
  const a = harness(), b = harness();
  for (let i = 0; i < 65; i++) { a.act('roll'); a.finish(); b.act('roll'); b.finish(); }
  assert.equal(a.state.history.length, 100);
  assert.equal(a.state.players[0].laps, 2);
  assert.deepEqual(a.state, b.state);
  assert.equal(engine.marbleErrorMessage(new MarbleError('bad', 'Useful message')), 'Useful message');
  assert.ok(!engine.marbleErrorMessage(new Error('database password secret')).includes('secret'));
});

test('trigger rejection strings and error codes explain why participation failed in Korean', () => {
  const pointCodes = ['busy', 'player_busy', 'inactive', 'disabled', 'target_unavailable', 'insufficient_points',
    'command_mismatch', 'invalid_point_identity', 'invalid_channel_uid', 'invalid_trigger'];
  const donationCodes = ['unsupported_currency', 'below_minimum', 'queue_full', 'donation_queue_full', 'duplicate_donation'];
  const generic = engine.marbleErrorMessage(undefined);
  const noPoints = '\ud3ec\uc778\ud2b8\ub294 \ucc28\uac10\ub418\uc9c0 \uc54a\uc558\uc5b4\uc694.';
  for (const code of [...pointCodes, ...donationCodes]) {
    const message = engine.marbleErrorMessage(code);
    assert.notEqual(message, generic, code);
    assert.match(message, /[\uac00-\ud7a3]/u, code);
    assert.equal(message.includes(code), false, code);
    assert.equal(engine.marbleErrorMessage({ code, message: 'database password secret' }), message);
    assert.equal(engine.marbleErrorMessage(Object.assign(new Error('database password secret'), { code })), message);
    assert.equal(engine.marbleErrorMessage(new MarbleError(code)), message);
    assert.equal(message.includes(noPoints), pointCodes.includes(code), code);
  }
  assert.match(engine.marbleErrorMessage('busy'), /\ubbf8\uc158.*\uc77c\uc2dc\uc815\uc9c0/u);
  assert.match(engine.marbleErrorMessage('insufficient_points'), /\ud3ec\uc778\ud2b8\uac00 \ubd80\uc871/u);
  assert.match(engine.marbleErrorMessage('queue_full'), /20/);
});

test('arbitrary database errors and inherited property names remain generic without charge assurances', () => {
  const generic = engine.marbleErrorMessage(undefined);
  for (const error of [null, 0, false, 'database password secret', '42P01', 'constructor', '__proto__', 'toString',
    new Error('busy'), new Error('database password secret'), { message: 'database password secret' },
    { code: '42P01', message: 'database password secret' }, { code: 'ECONNRESET', detail: 'database password secret' },
    { code: 'toString' }, { code: { toString: () => 'busy' } },
  ]) assert.equal(engine.marbleErrorMessage(error), generic);
  assert.ok(!generic.includes('\ud3ec\uc778\ud2b8'));
  assert.equal(engine.marbleErrorMessage(new MarbleError('custom_domain_error', 'Safe domain message')), 'Safe domain message');
});
