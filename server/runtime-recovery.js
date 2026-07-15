const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 60_000;
const DEFAULT_JITTER_RATIO = 0.2;

function finiteNonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeKey(key) {
  const normalized = String(key ?? '').trim();
  if (!normalized) throw new TypeError('Recovery key is required');
  return normalized;
}

function errorMessage(error) {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Calculate a capped exponential-backoff delay with symmetric jitter.
 * Attempt numbers are one-based: attempt 1 uses the base delay.
 */
export function calculateRecoveryDelay({
  attempt,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  jitterRatio = DEFAULT_JITTER_RATIO,
  random = Math.random,
} = {}) {
  const normalizedAttempt = Math.max(1, Math.floor(finiteNonNegativeNumber(attempt, 1)));
  const normalizedBase = finiteNonNegativeNumber(baseDelayMs, DEFAULT_BASE_DELAY_MS);
  const normalizedMax = Math.max(normalizedBase, finiteNonNegativeNumber(maxDelayMs, DEFAULT_MAX_DELAY_MS));
  const normalizedJitter = Math.min(1, finiteNonNegativeNumber(jitterRatio, DEFAULT_JITTER_RATIO));
  const cappedExponential = Math.min(normalizedMax, normalizedBase * (2 ** Math.min(30, normalizedAttempt - 1)));
  const sampled = Math.min(1, Math.max(0, finiteNonNegativeNumber(random(), 0.5)));
  const jitterMultiplier = 1 - normalizedJitter + (2 * normalizedJitter * sampled);
  return Math.min(normalizedMax, Math.max(0, Math.round(cappedExponential * jitterMultiplier)));
}

/**
 * Keyed recovery scheduler for provider/runtime self-healing.
 *
 * A key can have at most one scheduled or running task. A failed task is
 * rescheduled automatically until it succeeds, is cancelled, or shouldRetry
 * returns false. Cancelling a running task prevents its completion from
 * scheduling more work, but intentionally does not attempt to abort user code.
 */
export function createRuntimeRecoverySupervisor(options = {}) {
  const baseDelayMs = finiteNonNegativeNumber(options.baseDelayMs, DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = Math.max(baseDelayMs, finiteNonNegativeNumber(options.maxDelayMs, DEFAULT_MAX_DELAY_MS));
  const jitterRatio = Math.min(1, finiteNonNegativeNumber(options.jitterRatio, DEFAULT_JITTER_RATIO));
  const setTimer = typeof options.setTimer === 'function' ? options.setTimer : setTimeout;
  const clearTimer = typeof options.clearTimer === 'function' ? options.clearTimer : clearTimeout;
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const states = new Map();

  function snapshot(state) {
    if (!state) return null;
    return {
      key: state.key,
      status: state.status,
      attempt: state.attempt,
      nextAttempt: state.attempt + 1,
      nextDelayMs: state.nextDelayMs,
      nextRetryAt: state.nextRetryAt,
      lastError: state.lastError,
      scheduled: state.timer != null,
      running: state.status === 'running',
    };
  }

  function retryIsAllowed(state, error) {
    if (error && typeof error === 'object' && error.shouldRetry === false) return false;
    if (state.shouldRetry === false) return false;
    if (typeof state.shouldRetry !== 'function') return true;
    try {
      return state.shouldRetry(error, snapshot(state)) !== false;
    } catch (predicateError) {
      state.lastError = errorMessage(predicateError);
      return false;
    }
  }

  function arm(state, requestedDelayMs = null) {
    if (states.get(state.key) !== state) return;
    const nextAttempt = state.attempt + 1;
    const delay = requestedDelayMs == null
      ? calculateRecoveryDelay({
          attempt: nextAttempt,
          baseDelayMs,
          maxDelayMs,
          jitterRatio,
          random,
        })
      : finiteNonNegativeNumber(requestedDelayMs, baseDelayMs);
    state.status = 'scheduled';
    state.nextDelayMs = delay;
    state.nextRetryAt = Date.now() + delay;
    state.timer = setTimer(() => {
      void execute(state);
    }, delay);
    state.timer?.unref?.();
  }

  async function execute(state) {
    if (states.get(state.key) !== state) return;
    state.timer = null;
    state.status = 'running';
    state.nextDelayMs = null;
    state.nextRetryAt = null;
    state.attempt += 1;

    try {
      await state.task({ key: state.key, attempt: state.attempt });
    } catch (error) {
      if (states.get(state.key) !== state) return;
      state.lastError = errorMessage(error);
      if (!retryIsAllowed(state, error)) {
        states.delete(state.key);
        return;
      }
      arm(state, error?.retryAfterMs);
      return;
    }

    if (states.get(state.key) === state) states.delete(state.key);
  }

  function schedule(key, task, scheduleOptions = {}) {
    const normalizedKey = normalizeKey(key);
    if (typeof task !== 'function') throw new TypeError('Recovery task must be a function');
    const existing = states.get(normalizedKey);
    if (existing) return snapshot(existing);

    const state = {
      key: normalizedKey,
      task,
      shouldRetry: scheduleOptions.shouldRetry,
      status: 'scheduled',
      attempt: 0,
      nextDelayMs: null,
      nextRetryAt: null,
      lastError: null,
      timer: null,
    };
    states.set(normalizedKey, state);
    arm(state, scheduleOptions.initialDelayMs);
    return snapshot(state);
  }

  function cancel(key) {
    const normalizedKey = normalizeKey(key);
    const state = states.get(normalizedKey);
    if (!state) return false;
    states.delete(normalizedKey);
    if (state.timer != null) clearTimer(state.timer);
    state.timer = null;
    state.status = 'cancelled';
    return true;
  }

  function cancelAll() {
    const keys = Array.from(states.keys());
    for (const key of keys) cancel(key);
    return keys.length;
  }

  function getState(key) {
    return snapshot(states.get(normalizeKey(key)));
  }

  function listStates() {
    return Array.from(states.values(), snapshot);
  }

  return {
    schedule,
    cancel,
    cancelAll,
    getState,
    listStates,
  };
}
