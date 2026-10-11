import { createHash, randomInt, randomUUID } from 'node:crypto';
import { assertSafeTextPayload } from '../shared/text-safety.js';

// Server-only: authorization and trusted provider event construction belong to routes/runtime.
export const PARTICIPATION_WHEEL_LIMITS = Object.freeze({
  slots: 1000, entries: 200, slotsPerRequest: 100, label: 60, history: 50,
  minDurationMs: 4000, maxDurationMs: 15000,
});
export const DEFAULT_PARTICIPATION_WHEEL_SETTINGS = Object.freeze({
  title: '\uC2DC\uCCAD\uC790 \uCC38\uC5EC \uB3CC\uB9BC\uD310',
  chat: Object.freeze({ enabled: true, command: '!\uB3CC\uB9BC\uD310', perUserLimit: 1 }),
  points: Object.freeze({ enabled: false, command: '!\uB3CC\uB9BC\uD310\uCD94\uAC00', costPerSlot: 100 }),
  donation: Object.freeze({ enabled: false, wonPerSlot: 1000 }),
  spinDurationMs: 8000, removal: 'keep', theme: 'festival',
});

const LIMIT = PARTICIPATION_WHEEL_LIMITS;
const MAX_POINT_AMOUNT = 2147483647;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const totalSlots = (entries) => entries.reduce((sum, entry) => sum + entry.slots, 0);
const failure = (code, status = 400) => ({ error: { code, status } });

export class ParticipationWheelError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'ParticipationWheelError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, status) { throw new ParticipationWheelError(code, status); }
function object(value, code = 'invalid_settings') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}
function integer(value, min, max, code) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(code);
  return value;
}
function text(value, max, code, optional = false) {
  if (optional && (value == null || value === '')) return '';
  if (typeof value !== 'string' || value.length > max * 4) fail(code);
  assertSafeTextPayload(value);
  const result = value.trim();
  if ((!optional && !result) || [...result].length > max || /[\u0000-\u001f\u007f]/u.test(result)) fail(code);
  return result;
}
function identity(value) { return text(value, 512, 'invalid_identity'); }
function requestId(value) { return text(value, 512, 'invalid_request_id'); }
function keys(value, allowed) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail('invalid_settings');
}

// Settings updates are partial, including their nested source settings.
export function parseParticipationWheelSettings(input, base = DEFAULT_PARTICIPATION_WHEEL_SETTINGS) {
  object(input);
  assertSafeTextPayload(input);
  keys(input, ['title', 'chat', 'points', 'donation', 'spinDurationMs', 'removal', 'theme']);
  const result = structuredClone(base);
  if (input.title !== undefined) result.title = text(input.title, 60, 'invalid_title');
  for (const [source, fields] of [
    ['chat', ['enabled', 'command', 'perUserLimit']],
    ['points', ['enabled', 'command', 'costPerSlot']],
    ['donation', ['enabled', 'wonPerSlot']],
  ]) {
    if (input[source] === undefined) continue;
    keys(object(input[source]), fields);
    const update = input[source];
    if (update.enabled !== undefined) {
      if (typeof update.enabled !== 'boolean') fail('invalid_settings');
      result[source].enabled = update.enabled;
    }
    if (update.command !== undefined) {
      const command = text(update.command, 60, 'invalid_command');
      if (!command.startsWith('!') || /\s/u.test(command)) fail('invalid_command');
      result[source].command = command;
    }
    if (update.perUserLimit !== undefined) result.chat.perUserLimit = integer(update.perUserLimit, 1, LIMIT.slots, 'invalid_chat_limit');
    if (update.costPerSlot !== undefined) result.points.costPerSlot = integer(update.costPerSlot, 1, MAX_POINT_AMOUNT, 'invalid_point_cost');
    if (update.wonPerSlot !== undefined) result.donation.wonPerSlot = integer(update.wonPerSlot, 1, Number.MAX_SAFE_INTEGER, 'invalid_donation_cost');
  }
  if (input.spinDurationMs !== undefined) result.spinDurationMs = integer(input.spinDurationMs, LIMIT.minDurationMs, LIMIT.maxDurationMs, 'invalid_duration');
  if (input.removal !== undefined) {
    if (!['one', 'keep', 'all'].includes(input.removal)) fail('invalid_removal');
    result.removal = input.removal;
  }
  if (input.theme !== undefined) {
    if (!['festival', 'studio', 'midnight'].includes(input.theme)) fail('invalid_theme');
    result.theme = input.theme;
  }
  if (result.chat.enabled && result.points.enabled && result.chat.command.toLowerCase() === result.points.command.toLowerCase()) fail('command_conflict', 409);
  return result;
}

export function parseParticipationWheelAction(input) {
  object(input, 'invalid_action');
  assertSafeTextPayload(input);
  const { action } = input;
  if (!['open', 'close', 'add', 'remove', 'clear', 'spin'].includes(action)) fail('invalid_action');
  const result = { action, requestId: requestId(input.requestId) };
  if (input.revision !== undefined) result.revision = integer(input.revision, 0, Number.MAX_SAFE_INTEGER, 'invalid_revision');
  if (action === 'add') {
    result.label = text(input.label, LIMIT.label, 'invalid_label');
    result.username = text(input.username, LIMIT.label, 'invalid_username', true);
    result.slots = integer(input.slots ?? 1, 1, LIMIT.slotsPerRequest, 'invalid_slots');
  }
  if (action === 'remove') result.entryId = text(input.entryId, 128, 'invalid_entry_id');
  return result;
}

export function parseParticipationWheelEntry(input) {
  object(input, 'invalid_entry');
  assertSafeTextPayload(input);
  if (!['chat', 'points', 'donation'].includes(input.source)) fail('invalid_source');
  const result = {
    source: input.source,
    eventId: requestId(input.eventId),
    userId: identity(input.userId),
    username: text(input.username, LIMIT.label, 'invalid_username', true),
    label: text(input.label ?? input.username, LIMIT.label, 'invalid_label'),
    channelUid: input.source === 'points' ? identity(input.channelUid) : text(input.channelUid, 512, 'invalid_identity', true),
  };
  if (input.command !== undefined) result.command = text(input.command, 60, 'invalid_command').toLowerCase();
  if (input.source !== 'donation') {
    if (['anonymous', 'unknown_user'].includes(result.userId)) fail('invalid_identity');
    result.slots = integer(input.slots ?? 1, 1, LIMIT.slotsPerRequest, 'invalid_slots');
  } else result.amount = integer(input.amount, 1, Number.MAX_SAFE_INTEGER, 'invalid_amount');
  return result;
}

export function createParticipationWheelState(id = randomUUID()) {
  return {
    schemaVersion: 1, roundId: id, revision: 0, collecting: false,
    settings: structuredClone(DEFAULT_PARTICIPATION_WHEEL_SETTINGS),
    entries: [], totalSlots: 0, latestSpin: null, history: [], chatUsage: {},
  };
}

function publicEntry(entry) {
  return { id: entry.id, label: entry.label, username: entry.username, source: entry.source,
    slots: entry.slots, colorIndex: entry.colorIndex, createdAt: entry.createdAt };
}
function spinSummary(spin) {
  return { id: spin.id, startedAt: spin.startedAt, durationMs: spin.durationMs,
    totalSlots: spin.totalSlots, selectedSlot: spin.selectedSlot, entryId: spin.entryId,
    label: spin.label, username: spin.username, turns: spin.turns };
}

// Explicit allowlists also protect historical snapshots and future private state fields.
export function toPublicParticipationWheel(state) {
  const settings = state.settings;
  return {
    roundId: state.roundId, revision: state.revision, collecting: state.collecting,
    settings: {
      title: settings.title,
      chat: { enabled: settings.chat.enabled, command: settings.chat.command, perUserLimit: settings.chat.perUserLimit },
      points: { enabled: settings.points.enabled, command: settings.points.command, costPerSlot: settings.points.costPerSlot },
      donation: { enabled: settings.donation.enabled, wonPerSlot: settings.donation.wonPerSlot },
      spinDurationMs: settings.spinDurationMs, removal: settings.removal, theme: settings.theme,
    },
    entries: state.entries.map(publicEntry), totalSlots: totalSlots(state.entries),
    latestSpin: state.latestSpin ? { ...spinSummary(state.latestSpin), entries: state.latestSpin.entries.map(publicEntry) } : null,
    history: state.history.map(spinSummary),
  };
}

export function selectParticipationWheelSlot(entries, selectedSlot) {
  integer(selectedSlot, 0, totalSlots(entries) - 1, 'invalid_selected_slot');
  let end = 0;
  return entries.find((entry) => { end += entry.slots; return selectedSlot < end; });
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/**
 * Each operation owns one PG transaction. Points callbacks must use its client,
 * never open a second connection. No DDL, timers, caches or DB access at import.
 * Receipts outlive clear/round changes. Duplicates return the current wheel, not
 * stale snapshots; an event's first outcome wins even if replay metadata changes.
 */
export function createParticipationWheelStore({
  withPgClient, deductChannelPointsIfEnoughWithClient, resolvePointChannelIdentity,
  resolvePointUserIdentity, upsertCanonicalPointDelta,
  randomInt: draw = randomInt, randomUUID: uuid = randomUUID,
}) {
  if (typeof withPgClient !== 'function') throw new TypeError('withPgClient is required');

  async function transaction(sid, request, apply) {
    const owner = text(sid, 512, 'invalid_sid');
    const answer = await withPgClient(async (pg) => {
      await pg.query('begin');
      try {
        await pg.query(
          `insert into public.participation_wheels (sid, state) values ($1, $2::jsonb)
           on conflict (sid) do nothing`, [owner, JSON.stringify(createParticipationWheelState(uuid()))],
        );
        const locked = await pg.query('select state from public.participation_wheels where sid = $1 for update', [owner]);
        const state = structuredClone(locked.rows[0]?.state);
        if (state?.schemaVersion !== 1) fail('unsupported_wheel_version', 503);
        let outcome = {}, duplicate = false;
        if (request) {
          const previous = await pg.query(
            'select operation, fingerprint, outcome from public.participation_wheel_requests where sid = $1 and request_id = $2',
            [owner, request.id],
          );
          const receipt = previous.rows[0];
          if (receipt) {
            if (receipt.operation !== request.operation || (!request.event && receipt.fingerprint !== request.fingerprint)) {
              fail('request_id_conflict', 409);
            }
            duplicate = true;
            outcome = receipt.outcome;
          } else {
            // Read the DB clock after obtaining the row lock, including after a wait.
            const clock = await pg.query('select floor(extract(epoch from clock_timestamp()) * 1000)::bigint as now_ms');
            const now = Number(clock.rows[0].now_ms);
            const result = await apply(pg, state, now);
            outcome = result.outcome || {};
            if (result.changed) {
              state.revision++;
              state.totalSlots = totalSlots(state.entries);
              await pg.query(
                'update public.participation_wheels set state = $2::jsonb, updated_at = now() where sid = $1',
                [owner, JSON.stringify(state)],
              );
            }
            await pg.query(
              `insert into public.participation_wheel_requests (sid, request_id, operation, fingerprint, outcome)
               values ($1, $2, $3, $4, $5::jsonb)`,
              [owner, request.id, request.operation, request.fingerprint, JSON.stringify(outcome)],
            );
          }
        }
        const result = { wheel: toPublicParticipationWheel(state), outcome, duplicate };
        await pg.query('commit');
        return result;
      } catch (error) {
        try { await pg.query('rollback'); } catch { /* Preserve the operation/commit error. */ }
        throw error;
      }
    });
    // Business rejections are committed receipts, so a retry cannot become a new mutation.
    if (answer.outcome.error) fail(answer.outcome.error.code, answer.outcome.error.status);
    return answer;
  }

  function mutationRequest(operation, id, payload, event = false) {
    return { id: `${event ? 'event' : 'request'}:${requestId(id)}`, operation, event, fingerprint: hash(stableJson(payload)) };
  }
  function isSpinning(state, now) {
    return state.latestSpin && state.latestSpin.startedAt + state.latestSpin.durationMs > now;
  }
  function full(state, slots) {
    return state.entries.length >= LIMIT.entries || totalSlots(state.entries) + slots > LIMIT.slots;
  }
  function addEntry(state, input, now, privateFields = {}) {
    const usedColors = new Set(state.entries.map((entry) => entry.colorIndex));
    let colorIndex = 0;
    while (usedColors.has(colorIndex)) colorIndex++;
    state.entries.push({ id: uuid(), label: input.label, username: input.username || '', source: input.source,
      slots: input.slots, colorIndex, createdAt: now, ...privateFields });
  }

  async function refundEntries(pg, entries) {
    const refunds = new Map();
    for (const entry of entries) {
      if (entry.source !== 'points') continue;
      const paid = entry.paid;
      if (!paid?.userId || !paid.channelUid || !Number.isSafeInteger(paid.costPerSlot) || paid.costPerSlot <= 0) fail('invalid_refund_state', 503);
      if (!Number.isSafeInteger(paid.refundableSlots) || paid.refundableSlots < 0 || paid.refundableSlots > entry.slots) fail('invalid_refund_state', 503);
      const amount = paid.costPerSlot * paid.refundableSlots;
      if (!Number.isSafeInteger(amount) || amount < 0) fail('invalid_refund_state', 503);
      if (!amount) continue;
      const channel = await resolvePointChannelIdentity(pg, paid.channelUid);
      const user = await resolvePointUserIdentity(pg, paid.userId);
      if (!channel.canonicalChannelUid || !user.canonicalUserId) fail('invalid_identity');
      const key = JSON.stringify([channel.canonicalChannelUid, user.canonicalUserId]);
      const previous = refunds.get(key);
      refunds.set(key, { channelUid: channel.canonicalChannelUid, userId: user.canonicalUserId,
        lockKey: `${channel.canonicalChannelUid}:${user.canonicalUserId}`,
        username: entry.username, amount: (previous?.amount || 0) + amount });
    }
    // All refund paths acquire canonical identity locks in the same order.
    for (const refund of [...refunds.values()].sort((a, b) => a.lockKey < b.lockKey ? -1 : a.lockKey > b.lockKey ? 1 : 0)) {
      if (!Number.isSafeInteger(refund.amount)) fail('invalid_refund_state', 503);
      await pg.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [refund.lockKey]);
      await upsertCanonicalPointDelta(pg, refund.channelUid, refund.userId, refund.username, refund.amount);
    }
  }

  async function getParticipationWheel(sid) {
    return (await transaction(sid)).wheel;
  }

  async function updateParticipationWheel(sid, settings, id) {
    object(settings);
    assertSafeTextPayload(settings);
    return (await transaction(sid, mutationRequest('settings', id, settings), async (_pg, state) => {
      let next;
      try { next = parseParticipationWheelSettings(settings, state.settings); }
      catch (error) {
        if (error instanceof ParticipationWheelError) return { outcome: failure(error.code, error.status) };
        throw error;
      }
      const changed = stableJson(next) !== stableJson(state.settings);
      state.settings = next;
      return { changed };
    })).wheel;
  }

  async function actParticipationWheel(sid, input) {
    const action = parseParticipationWheelAction(input);
    return (await transaction(sid, mutationRequest('action', action.requestId, action), async (pg, state, now) => {
      if (action.revision !== undefined && action.revision !== state.revision) return { outcome: failure('revision_conflict', 409) };
      switch (action.action) {
        case 'open':
        case 'close': {
          const collecting = action.action === 'open';
          const changed = state.collecting !== collecting;
          state.collecting = collecting;
          return { changed };
        }
        case 'add':
          if (full(state, action.slots)) return { outcome: failure('capacity', 409) };
          addEntry(state, { ...action, source: 'manual' }, now);
          return { changed: true };
        case 'remove': {
          const entry = state.entries.find((item) => item.id === action.entryId);
          if (!entry) return { outcome: failure('entry_not_found', 404) };
          await refundEntries(pg, [entry]);
          state.entries = state.entries.filter((item) => item.id !== entry.id);
          return { changed: true };
        }
        case 'clear':
          if (isSpinning(state, now)) return { outcome: failure('spinning', 409) };
          await refundEntries(pg, state.entries);
          state.entries = [];
          state.chatUsage = {};
          state.roundId = uuid();
          state.latestSpin = null;
          return { changed: true };
        case 'spin': {
          if (isSpinning(state, now)) return { outcome: failure('spinning', 409) };
          const count = totalSlots(state.entries);
          if (!count) return { outcome: failure('empty', 409) };
          const selectedSlot = draw(count);
          const winner = selectParticipationWheelSlot(state.entries, selectedSlot);
          const spin = { id: uuid(), startedAt: now, durationMs: state.settings.spinDurationMs,
            entries: state.entries.map(publicEntry), totalSlots: count, selectedSlot,
            entryId: winner.id, label: winner.label, username: winner.username, turns: 6 };
          state.latestSpin = spin;
          state.history.unshift(spinSummary(spin));
          state.history = state.history.slice(0, LIMIT.history);
          // Winning removal consumes paid slots; only explicit remove/clear refund.
          if (winner.paid) winner.paid.refundableSlots = Math.max(0, winner.paid.refundableSlots - 1);
          if (state.settings.removal === 'one') winner.slots--;
          const winningLabel = winner.label.normalize('NFC');
          state.entries = state.entries.filter((entry) => entry.slots > 0
            && (state.settings.removal !== 'all' || entry.label.normalize('NFC') !== winningLabel));
          return { changed: true };
        }
      }
    })).wheel;
  }

  async function enterParticipationWheel(sid, input) {
    const entry = parseParticipationWheelEntry(input);
    const answer = await transaction(sid, mutationRequest('entry', entry.eventId, entry, true), async (pg, state, now) => {
      const reject = (reason) => ({ outcome: { accepted: false, reason } });
      if (!state.collecting) return reject('closed');
      if (!state.settings[entry.source].enabled) return reject('disabled');
      if (entry.source !== 'donation' && entry.command !== undefined
        && entry.command !== state.settings[entry.source].command.toLowerCase()) return reject('disabled');
      const slots = entry.source === 'donation' ? Math.floor(entry.amount / state.settings.donation.wonPerSlot) : entry.slots;
      if (!slots) return reject('below_minimum');
      if (full(state, slots)) return reject('capacity');
      let usageKey, used = 0;
      if (entry.source === 'chat') {
        const user = await resolvePointUserIdentity(pg, entry.userId);
        if (!user.canonicalUserId) fail('invalid_identity');
        usageKey = hash(user.canonicalUserId);
        used = state.chatUsage[usageKey] || 0;
        if (used + slots > state.settings.chat.perUserLimit) return reject('chat_limit');
      }
      const cost = entry.source === 'points' ? slots * state.settings.points.costPerSlot : 0;
      let paid;
      if (cost) {
        if (!Number.isSafeInteger(cost) || cost > MAX_POINT_AMOUNT) return reject('insufficient_points');
        const deduction = await deductChannelPointsIfEnoughWithClient(pg, entry.channelUid, entry.userId, entry.username, cost);
        if (!deduction.deducted) return reject('insufficient_points');
        paid = { channelUid: identity(deduction.streamerUid), userId: identity(deduction.userId),
          costPerSlot: state.settings.points.costPerSlot, refundableSlots: slots };
      }
      addEntry(state, { ...entry, slots }, now, paid ? { paid } : {});
      if (usageKey) state.chatUsage[usageKey] = used + slots;
      return { changed: true, outcome: { accepted: true, slots, cost } };
    });
    return { ...answer.outcome, ...(answer.duplicate ? { duplicate: true } : {}), wheel: answer.wheel };
  }

  return { getParticipationWheel, updateParticipationWheel, actParticipationWheel, enterParticipationWheel };
}
