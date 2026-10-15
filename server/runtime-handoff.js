import { types } from 'node:util';

export const RUNTIME_HANDOFF_VERSION = 1;
export const MAX_RUNTIME_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_NODES = 250_000;
const MAX_ENTRIES = 100_000;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function fail(reason) {
  // Never include snapshot keys or values: they can contain access tokens.
  const error = new Error(`runtime_handoff_${reason}`);
  error.code = error.message;
  throw error;
}

function plainEntries(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_object');
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_ENTRIES) fail('too_many_entries');
  return keys.map((key) => {
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) fail('unsafe_key');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('invalid_property');
    return [key, descriptor.value];
  });
}

function denseArray(value) {
  if (!Array.isArray(value) || types.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype) fail('invalid_array');
  if (value.length > MAX_ENTRIES) fail('too_many_entries');
  if (Reflect.ownKeys(value).length !== value.length + 1) fail('invalid_array');
  for (let i = 0; i < value.length; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail('invalid_array');
  }
  return value;
}

function collectionType(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype === Map.prototype && types.isMap(value)) return 'map';
  if (prototype === Set.prototype && types.isSet(value)) return 'set';
  return null;
}

function codec(input, decode) {
  let nodes = 0;
  let bytes = 0;
  const ancestors = new WeakSet();
  const spend = (amount) => {
    bytes += amount;
    if (bytes > MAX_RUNTIME_SNAPSHOT_BYTES) fail('too_large');
  };
  const stringBytes = (value) => {
    if (value.length > MAX_RUNTIME_SNAPSHOT_BYTES) fail('too_large');
    spend(Buffer.byteLength(JSON.stringify(value), 'utf8'));
  };
  function walk(value, depth) {
    if (++nodes > MAX_NODES) fail('too_many_nodes');
    if (depth > MAX_DEPTH) fail('too_deep');
    if (value === null || typeof value === 'boolean') {
      spend(value === null || value === true ? 4 : 5);
      return value;
    }
    if (typeof value === 'string') { stringBytes(value); return value; }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('non_finite_number');
      if (Object.is(value, -0)) {
        if (decode) fail('invalid_number');
        spend(15);
        return ['number', '-0'];
      }
      spend(String(value).length);
      return value;
    }
    if (!decode && value === undefined) { spend(18); return ['undefined', null]; }
    if (!value || typeof value !== 'object' || types.isProxy(value)) fail('unsupported_value');
    if (ancestors.has(value)) fail('cyclic_value');
    ancestors.add(value);
    try {
      let type, entries;
      if (decode) {
        const tuple = denseArray(value);
        if (tuple.length !== 2) fail('invalid_tag');
        [type, entries] = tuple;
        if (type === 'number' && entries === '-0') { spend(15); return -0; }
        if (type === 'undefined' && entries === null) { spend(18); return undefined; }
        if (!['map', 'set', 'object', 'array'].includes(type)) fail('invalid_tag');
        denseArray(entries);
      } else {
        type = collectionType(value);
        if (type) {
          if (Reflect.ownKeys(value).length) fail('invalid_property');
          if (value.size > MAX_ENTRIES) fail('too_many_entries');
          entries = type === 'map' ? Array.from(Map.prototype.entries.call(value))
            : Array.from(Set.prototype.values.call(value));
        } else if (Array.isArray(value)) {
          type = 'array'; entries = denseArray(value);
        } else {
          type = 'object'; entries = plainEntries(value);
        }
      }
      // Account for the exact JSON tuple overhead, separators and entry pairs.
      spend(type.length + 7 + Math.max(0, entries.length - 1));
      const output = type === 'map' ? new Map() : type === 'set' ? new Set()
        : type === 'object' ? {} : [];
      const encoded = [];
      const keys = new Set();
      for (const entry of entries) {
        if (type === 'map' || type === 'object') {
          if (decode && denseArray(entry).length !== 2) fail('invalid_entry');
          spend(3);
          const [key, item] = entry;
          let resultKey;
          if (type === 'object') {
            if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) fail('unsafe_key');
            stringBytes(key);
            resultKey = key;
          } else resultKey = walk(key, depth + 1);
          const result = walk(item, depth + 1);
          if (decode) {
            if (keys.has(resultKey)) fail('duplicate_key');
            keys.add(resultKey);
            if (type === 'map') output.set(resultKey, result);
            else Object.defineProperty(output, resultKey, { value: result, enumerable: true, writable: true, configurable: true });
          } else encoded.push([resultKey, result]);
        } else {
          const result = walk(entry, depth + 1);
          if (decode) {
            if (type === 'set') {
              if (output.has(result)) fail('duplicate_key');
              output.add(result);
            } else output.push(result);
          } else encoded.push(result);
        }
      }
      return decode ? output : [type, encoded];
    } finally { ancestors.delete(value); }
  }
  return walk(input, 0);
}

// Container tuples avoid collisions with user JSON fields; non-finite numbers,
// callbacks, timers and class instances are deliberately unsupported. Undefined
// has an explicit tag so optional in-memory fields survive JSON transport.
export const encodeRuntimeValue = (value) => codec(value, false);
export const decodeRuntimeValue = (value) => codec(value, true);

/**
 * In-memory only. The caller must fence ingress/workers before capture/restore,
 * and transport snapshots ONLY over authenticated loopback. Never persist/log
 * a snapshot: provider tokens are intentionally preserved. Rebuild actual
 * timers/sockets in the caller; pass timestamp/dedupe maps, not live sessions.
 * state = { getInFlight: () => number, getActiveCount: () => number,
 *           rouletteProcessing: Set }. All three drain guards are required.
 */
export function createRuntimeHandoff({ maps, state, now = Date.now } = {}) {
  const targets = plainEntries(maps);
  const references = new Set();
  for (const [name, target] of targets) {
    if (!name || !collectionType(target) || Reflect.ownKeys(target).length
      || references.has(target)) fail('invalid_target');
    references.add(target);
  }
  if (typeof state?.getInFlight !== 'function' || typeof state?.getActiveCount !== 'function'
    || collectionType(state?.rouletteProcessing) !== 'set' || typeof now !== 'function') fail('invalid_state');

  function assertDrained() {
    if (state.getInFlight() !== 0 || state.getActiveCount() !== 0) fail('not_drained');
    if (state.rouletteProcessing.size !== 0) fail('not_drained');
  }
  function checkedEnvelope(snapshot) {
    if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > MAX_RUNTIME_SNAPSHOT_BYTES) fail('too_large');
    return snapshot;
  }
  function capture() {
    assertDrained();
    const capturedAt = now();
    if (!Number.isSafeInteger(capturedAt) || capturedAt < 0) fail('invalid_timestamp');
    const values = Object.fromEntries(targets);
    return checkedEnvelope({ version: RUNTIME_HANDOFF_VERSION, capturedAt, maps: encodeRuntimeValue(values) });
  }
  function validate(snapshot) {
    if (typeof snapshot === 'string') {
      if (Buffer.byteLength(snapshot, 'utf8') > MAX_RUNTIME_SNAPSHOT_BYTES) fail('too_large');
      try { snapshot = JSON.parse(snapshot); } catch { fail('invalid_json'); }
    }
    const fields = new Map(plainEntries(snapshot));
    if (fields.size !== 3 || !fields.has('version') || !fields.has('capturedAt') || !fields.has('maps')) fail('invalid_snapshot');
    if (fields.get('version') !== RUNTIME_HANDOFF_VERSION) fail('unsupported_version');
    const capturedAt = fields.get('capturedAt');
    if (!Number.isSafeInteger(capturedAt) || capturedAt < 0) fail('invalid_timestamp');
    const decoded = decodeRuntimeValue(fields.get('maps'));
    const entries = new Map(plainEntries(decoded));
    if (entries.size !== targets.length) fail('target_mismatch');
    for (const [name, target] of targets) {
      if (!entries.has(name) || collectionType(entries.get(name)) !== collectionType(target)) fail('target_mismatch');
    }
    checkedEnvelope({ version: RUNTIME_HANDOFF_VERSION, capturedAt, maps: encodeRuntimeValue(decoded) });
    return { version: RUNTIME_HANDOFF_VERSION, capturedAt, maps: decoded };
  }
  function restore(snapshot) {
    assertDrained();
    const validated = validate(snapshot);
    assertDrained();
    // No awaits or user callbacks after validation: all replacements happen in
    // one JS turn, retaining the Map/Set references closed over by the caller.
    for (const [name, target] of targets) {
      const source = validated.maps[name];
      if (collectionType(target) === 'map') {
        Map.prototype.clear.call(target);
        for (const [key, value] of source) Map.prototype.set.call(target, key, value);
      } else {
        Set.prototype.clear.call(target);
        for (const value of source) Set.prototype.add.call(target, value);
      }
    }
    return { version: RUNTIME_HANDOFF_VERSION, capturedAt: validated.capturedAt, collections: targets.length };
  }
  return Object.freeze({ capture, validate, restore });
}
