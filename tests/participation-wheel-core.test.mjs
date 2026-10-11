import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PARTICIPATION_WHEEL_SETTINGS as defaults, PARTICIPATION_WHEEL_LIMITS as limits,
  createParticipationWheelState, parseParticipationWheelSettings, parseParticipationWheelAction,
  parseParticipationWheelEntry, toPublicParticipationWheel, selectParticipationWheelSlot,
} from '../server/participation-wheel.js';

const input = (source = 'chat', changes = {}) => ({ source, userId: 'viewer', username: 'Viewer',
  label: 'Entry', channelUid: 'channel', eventId: 'chzzk:chat:hash', ...changes });

test('defaults and fresh state are independent and initially closed', () => {
  const a = createParticipationWheelState('round-a'), b = createParticipationWheelState('round-b');
  assert.equal(a.collecting, false);
  assert.equal(a.revision, 0);
  assert.equal(a.latestSpin, null);
  assert.equal(a.settings.chat.command, '!\uB3CC\uB9BC\uD310');
  assert.equal(a.settings.points.command, '!\uB3CC\uB9BC\uD310\uCD94\uAC00');
  assert.equal(a.settings.chat.perUserLimit, 1);
  assert.equal(a.settings.points.costPerSlot, 100);
  assert.equal(a.settings.donation.wonPerSlot, 1000);
  assert.equal(a.settings.points.enabled, false);
  assert.equal(a.settings.donation.enabled, false);
  assert.equal(a.settings.spinDurationMs, 8000);
  assert.equal(a.settings.removal, 'keep');
  assert.equal(a.settings.theme, 'festival');
  a.settings.chat.enabled = false;
  a.chatUsage.secret = 1;
  assert.equal(b.settings.chat.enabled, true);
  assert.equal(defaults.chat.enabled, true);
  assert.deepEqual(b.chatUsage, {});
});

test('partial settings preserve unrelated and nested values', () => {
  const base = parseParticipationWheelSettings({ chat: { command: '!join', perUserLimit: 5 }, points: { costPerSlot: 250 } });
  const merged = parseParticipationWheelSettings({ chat: { enabled: false }, theme: 'midnight' }, base);
  assert.equal(merged.chat.command, '!join');
  assert.equal(merged.chat.perUserLimit, 5);
  assert.equal(merged.points.costPerSlot, 250);
  assert.equal(base.chat.enabled, true);
  assert.equal(merged.theme, 'midnight');
});

test('settings reject invalid numbers, enums, flags, command collisions and unknown properties', () => {
  for (const patch of [
    { points: { costPerSlot: 0 } }, { points: { costPerSlot: '100' } },
    { donation: { wonPerSlot: -1 } }, { chat: { perUserLimit: 1.5 } },
    { chat: { enabled: 1 } }, { chat: { command: '!two words' } },
    { removal: 'random' }, { theme: 'pink' }, { points: { extra: true } },
    { chatUsage: {} }, { revision: 0 }, { title: 'x'.repeat(61) },
    { chat: { command: '!SAME' }, points: { enabled: true, command: '!same' } },
  ]) assert.throws(() => parseParticipationWheelSettings(patch));
  assert.equal(parseParticipationWheelSettings({ spinDurationMs: 4000 }).spinDurationMs, 4000);
  assert.equal(parseParticipationWheelSettings({ spinDurationMs: 15000 }).spinDurationMs, 15000);
  for (const value of [3999, 15001, NaN, Infinity]) assert.throws(() => parseParticipationWheelSettings({ spinDurationMs: value }));
  assert.equal(limits.maxDurationMs, 15000);
});

test('entry parser preserves optional command and accepts runtime metadata without trusting it', () => {
  const parsed = parseParticipationWheelEntry(input('points', { command: '!JOIN', provider: 'chzzk', cost: 0 }));
  assert.equal(parsed.command, '!join');
  assert.equal(parsed.slots, 1);
  assert.equal(parsed.cost, undefined);
  assert.equal(parsed.provider, undefined);
  assert.equal(parseParticipationWheelEntry(input('donation', { userId: 'anonymous', amount: 1000000 })).amount, 1000000);
  for (const source of ['chat', 'points']) assert.throws(() => parseParticipationWheelEntry(input(source, { userId: 'anonymous' })));
  assert.throws(() => parseParticipationWheelEntry(input('points', { slots: 101 })));
  assert.throws(() => parseParticipationWheelEntry(input('points', { slots: '2' })));
  assert.throws(() => parseParticipationWheelEntry(input('donation', { amount: 1.5 })));
  assert.throws(() => parseParticipationWheelEntry(input('points', { channelUid: '' })));
  assert.throws(() => parseParticipationWheelEntry(input('chat', { eventId: '' })), { code: 'invalid_request_id' });
});

test('all input paths reject zalgo using shared text safety and preserve Unicode labels', () => {
  const zalgo = 'a\u0300\u0300\u0300\u0300';
  for (const attempt of [
    () => parseParticipationWheelEntry(input('chat', { label: zalgo })),
    () => parseParticipationWheelEntry(input('points', { username: zalgo })),
    () => parseParticipationWheelAction({ action: 'add', requestId: 'r', label: zalgo }),
    () => parseParticipationWheelSettings({ title: zalgo }),
  ]) assert.throws(attempt, { code: 'zalgo_text_not_allowed' });
  assert.equal(parseParticipationWheelEntry(input('chat', { label: '\uAC00'.repeat(60) })).label.length, 60);
  assert.throws(() => parseParticipationWheelEntry(input('chat', { label: '\uAC00'.repeat(61) })), { code: 'invalid_label' });
  assert.throws(() => parseParticipationWheelAction({ action: 'reset', requestId: 'r' }));
  assert.equal(parseParticipationWheelAction({ action: 'add', label: 'Manual', requestId: 'r' }).slots, 1);
});

test('every slot maps to exactly one entry with its integer weight', () => {
  const entries = [{ id: 'a', slots: 1 }, { id: 'b', slots: 3 }, { id: 'c', slots: 2 }];
  assert.deepEqual(Array.from({ length: 6 }, (_, slot) => selectParticipationWheelSlot(entries, slot).id), ['a', 'b', 'b', 'b', 'c', 'c']);
  for (const invalid of [-1, 6, 0.1]) assert.throws(() => selectParticipationWheelSlot(entries, invalid));
  assert.throws(() => selectParticipationWheelSlot([], 0));
});

test('public projection whitelists entries, latest snapshot, history and settings', () => {
  const state = createParticipationWheelState('round');
  const secret = 'private-identity-never-public';
  const entry = { id: 'entry', label: 'Visible', username: 'Name', source: 'points', slots: 2,
    colorIndex: 0, createdAt: 1234, userId: secret, paid: { userId: secret, channelUid: secret, costPerSlot: 100, refundableSlots: 2 } };
  const spin = { id: 'spin', startedAt: 1234, durationMs: 8000, entries: [entry],
    totalSlots: 2, selectedSlot: 0, entryId: 'entry', label: 'Visible', username: 'Name', turns: 6, userId: secret };
  state.entries = [entry];
  state.latestSpin = spin;
  state.history = [spin];
  state.chatUsage = { [secret]: 1 };
  state.settings.chat.userId = secret;
  const result = toPublicParticipationWheel(state);
  assert.equal(result.totalSlots, 2);
  assert.equal(result.entries[0].createdAt, 1234);
  assert.equal(result.latestSpin.startedAt, 1234);
  assert.doesNotMatch(JSON.stringify(result), /private-identity|userId|channelUid|paid|refundableSlots|chatUsage|schemaVersion/);
  result.entries[0].slots = 99;
  result.latestSpin.entries[0].label = 'Mutated';
  result.settings.chat.enabled = false;
  assert.equal(state.entries[0].slots, 2);
  assert.equal(state.latestSpin.entries[0].label, 'Visible');
  assert.equal(state.settings.chat.enabled, true);
});
