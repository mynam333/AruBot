import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export const EXECUTION_LIMITS = Object.freeze({
  depth: 16, nodes: 512, actions: 64, jobs: 100, messages: 40, rouletteRuns: 5,
  loop: 100, waitMs: 300000, durationMs: 600000,
  channelConcurrent: 16, globalConcurrent: 128,
});

export class CommandSafetyError extends Error {
  constructor(reason) {
    super(`command_safety_${reason}`);
    this.code = this.message;
    this.retryable = false;
  }
}

export function createCommandExecutionSafety({ now = Date.now, limits = {}, onBlocked = () => {} } = {}) {
  const config = { ...EXECUTION_LIMITS, ...limits };
  const storage = new AsyncLocalStorage();
  const channels = new Map();
  let active = 0;

  function stop(reason, state = storage.getStore()) {
    if (state?.budget && !state.budget.stopped) {
      state.budget.stopped = reason;
      onBlocked({ sid: state.sid, reason, rootId: state.rootId });
    }
    throw new CommandSafetyError(reason);
  }
  function current(sid) {
    const state = storage.getStore();
    return state && (!sid || state.sid === sid) ? state : null;
  }
  function check() {
    const state = current();
    if (!state) return;
    if (state.budget.stopped) throw new CommandSafetyError(state.budget.stopped);
    if (now() - state.startedAt >= config.durationMs) stop('deadline', state);
  }
  function consume(kind, amount = 1) {
    check();
    const state = current();
    if (!state) return;
    if (!Number.isSafeInteger(amount) || amount < 0 || !(kind in state.budget.remaining)) stop('invalid_budget');
    if (state.budget.remaining[kind] < amount) stop(`${kind}_limit`);
    state.budget.remaining[kind] -= amount;
  }
  function count(value, kind = 'loop') {
    check();
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > config[kind]) stop(`${kind}_limit`);
    return Math.floor(number);
  }
  async function wait(ms, dryRun = false) {
    const delay = count(ms, 'waitMs');
    const state = current();
    if (state && now() + delay - state.startedAt >= config.durationMs) stop('deadline');
    if (delay && !dryRun) await new Promise((resolve) => setTimeout(resolve, delay));
    check();
  }
  function capture(sid) {
    const state = current(sid);
    // Only pass this object through server-owned queues, never accept it from clients.
    return state ? { version: 1, sid: state.sid, rootId: state.rootId, createdAt: state.createdAt, path: [...state.path] }
      : { version: 1, sid, rootId: randomUUID(), createdAt: now(), path: [] };
  }
  async function withState(state, task) {
    // Nested and delayed callbacks share a lease while work is actually running.
    // Capturing a callback alone must not reserve a slot indefinitely.
    if (!state.lease.references) {
      if (active >= config.globalConcurrent || (channels.get(state.sid) || 0) >= config.channelConcurrent) stop('busy', null);
      active += 1;
      channels.set(state.sid, (channels.get(state.sid) || 0) + 1);
    }
    state.lease.references += 1;
    try {
      return await storage.run(state, () => { check(); return task(); });
    } finally {
      state.lease.references -= 1;
      if (!state.lease.references) {
        active -= 1;
        const remaining = (channels.get(state.sid) || 1) - 1;
        if (remaining) channels.set(state.sid, remaining);
        else channels.delete(state.sid);
      }
    }
  }
  async function scope(sid, task, continuation = null) {
    const parent = continuation ? null : current(sid);
    if (parent) return withState(parent, task);
    if (!sid) stop('invalid_chain', null);
    if (continuation && (continuation.version !== 1 || continuation.sid !== sid)) stop('invalid_chain', null);
    const path = continuation?.path || [];
    if (!Array.isArray(path) || path.length > config.depth || path.some((key) => typeof key !== 'string' || key.length > 512)) stop('invalid_chain', null);
    const createdAt = continuation?.createdAt ?? now();
    if (!Number.isFinite(createdAt) || now() - createdAt >= 86400000) stop('expired_chain', null);
    const state = {
      sid, rootId: continuation?.rootId || randomUUID(), createdAt, path: [...path], startedAt: now(),
      lease: { references: 0 },
      budget: { stopped: null, rouletteCounts: new Map(), remaining: { nodes: config.nodes, actions: config.actions, jobs: config.jobs, messages: config.messages } },
    };
    return withState(state, task);
  }
  async function run(sid, key, task, continuation = null) {
    return scope(sid, async () => {
      const parent = current(sid);
      const roulette = key.startsWith('roulette:');
      if (!roulette && parent.path.includes(key)) stop('cycle');
      if (parent.path.length >= config.depth) stop('depth');
      consume('actions');
      if (roulette) {
        const visits = Math.max(parent.budget.rouletteCounts.get(key) || 0, parent.path.filter(entry => entry === key).length);
        if (visits >= config.rouletteRuns) stop('roulette_limit');
        parent.budget.rouletteCounts.set(key, visits + 1);
      }
      return storage.run({ ...parent, path: [...parent.path, key] }, task);
    }, continuation);
  }
  // A callback invoked by another request must keep the originating execution,
  // not inherit the websocket request's unrelated async-local context.
  function bind(task) {
    const state = current();
    return (...args) => state
      ? withState(state, () => task(...args))
      : storage.run(undefined, () => task(...args));
  }
  const detached = (task) => storage.run(undefined, task);
  return { scope, run, consume, count, wait, check, capture, bind, detached, current, reject: stop, getActiveCount: () => active };
}

export const isCommandSafetyError = (error) => String(error?.code || '').startsWith('command_safety_');
