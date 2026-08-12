import { randomBytes } from 'node:crypto';

export const COUNTER_VARIABLE_ERROR_TEXT = '확인 불가';
export const COUNTER_VARIABLE_SCOPES = Object.freeze(['user', 'global']);
export const MAX_COUNTER_VARIABLES_PER_RENDER = 16;

const COUNTER_SCOPE_SET = new Set(COUNTER_VARIABLE_SCOPES);
// Broad enough to remove malformed nested-brace variants without ever executing
// them. The strict parser below remains the only path that can create a plan.
const RAW_COUNTER_TOKEN_RE = /\$\{\s*counter\b[\s\S]*?\}+/giu;
const COUNTER_TOKEN_RE = /^\$\{\s*counter\s*::\s*([^:{}\r\n]+?)\s*::\s*([^{}\r\n]*?)\s*\}$/iu;
const DEFAULT_SENTINEL_RE = /\uE000ARUBOT_COUNTER:[^\uE001]*\uE001/gu;
const SUPPORTED_PROVIDERS = new Set(['chzzk', 'youtube', 'cime']);
const UNKNOWN_USER_IDS = new Set([
  'anonymous',
  'guest',
  'n/a',
  'null',
  'undefined',
  'unknown',
  'unknown-user',
  'unknown_user',
]);

function normalizeScope(value) {
  const normalized = String(value ?? '').normalize('NFKC').trim().toLowerCase();
  return COUNTER_SCOPE_SET.has(normalized) ? normalized : null;
}

function entryKey(scope, name) {
  return `${scope}\u0000${name}`;
}

function createDefaultSentinel(index) {
  return `\uE000ARUBOT_COUNTER:${randomBytes(24).toString('base64url')}:${index}\uE001`;
}

function createUniqueSentinel({ entry, index, source, usedSentinels, createSentinel }) {
  if (typeof createSentinel === 'function') {
    const candidate = String(createSentinel({ ...entry, index }) ?? '');
    if (candidate && !source.includes(candidate) && !usedSentinels.has(candidate)) return candidate;
  }

  let sentinel = createDefaultSentinel(index);
  while (source.includes(sentinel) || usedSentinels.has(sentinel)) {
    sentinel = createDefaultSentinel(index);
  }
  return sentinel;
}

function normalizeIncrementedValue(value) {
  if (typeof value === 'bigint') return value >= 0n ? String(value) : null;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  const normalized = String(value ?? '').trim();
  return /^\d+$/.test(normalized) ? normalized.replace(/^0+(?=\d)/, '') : null;
}

/**
 * Counter names are stable user-authored identifiers. NFKC prevents visually
 * equivalent full-width forms from creating separate counters.
 */
export function normalizeCounterVariableName(value) {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ');
  const codePointLength = Array.from(normalized).length;
  if (codePointLength < 1 || codePointLength > 64) return null;
  return /^[\p{L}\p{N} _.-]+$/u.test(normalized) ? normalized : null;
}

/**
 * Builds a stable viewer key without ever producing values such as
 * `youtube:youtube:channel-id`.
 */
export function qualifyCounterUserSubject(provider, userId) {
  const normalizedProvider = String(provider ?? '').normalize('NFKC').trim().toLowerCase();
  if (!SUPPORTED_PROVIDERS.has(normalizedProvider)) {
    throw new TypeError('counter_user_provider_required');
  }

  let normalizedUserId = String(userId ?? '').normalize('NFKC').trim();
  normalizedUserId = normalizedUserId.replace(/^user:/iu, '').trim();

  const qualifiedMatch = normalizedUserId.match(/^([a-z][a-z0-9_-]{0,31}):(.*)$/iu);
  if (qualifiedMatch && qualifiedMatch[1].toLowerCase() !== normalizedProvider) {
    throw new TypeError('counter_user_provider_mismatch');
  }
  while (normalizedUserId.toLowerCase().startsWith(`${normalizedProvider}:`)) {
    normalizedUserId = normalizedUserId.slice(normalizedProvider.length + 1).trim();
  }

  if (!normalizedUserId || UNKNOWN_USER_IDS.has(normalizedUserId.toLowerCase())) {
    throw new TypeError('counter_user_identity_required');
  }
  if (normalizedProvider === 'cime' && normalizedUserId.toLowerCase().startsWith('nickname:')) {
    throw new TypeError('counter_user_identity_unstable');
  }
  const nestedProvider = normalizedUserId.match(/^(chzzk|youtube|cime):/iu)?.[1]?.toLowerCase();
  if (nestedProvider && nestedProvider !== normalizedProvider) {
    throw new TypeError('counter_user_provider_mismatch');
  }
  return `${normalizedProvider}:${normalizedUserId}`;
}

/**
 * Extracts executable counter tokens from a trusted template. Valid duplicate
 * tokens share one unpredictable sentinel so they are incremented once per
 * render and display the same returned value everywhere.
 */
export function prepareCounterVariablePlan(template, options = {}) {
  const source = String(template ?? '');
  const entries = [];
  const entriesByKey = new Map();
  const usedSentinels = new Set();

  const text = source.replace(RAW_COUNTER_TOKEN_RE, (token) => {
    const match = token.match(COUNTER_TOKEN_RE);
    if (!match) return '';

    const scope = normalizeScope(match[1]);
    const name = normalizeCounterVariableName(match[2]);
    if (!scope || !name) return '';

    const key = entryKey(scope, name);
    const existing = entriesByKey.get(key);
    if (existing) return existing.sentinel;
    if (entries.length >= MAX_COUNTER_VARIABLES_PER_RENDER) return '';

    const baseEntry = { scope, name };
    const sentinel = createUniqueSentinel({
      entry: baseEntry,
      index: entries.length,
      source,
      usedSentinels,
      createSentinel: options.createSentinel,
    });
    const entry = Object.freeze({ ...baseEntry, sentinel });
    entries.push(entry);
    entriesByKey.set(key, entry);
    usedSentinels.add(sentinel);
    return sentinel;
  });

  return Object.freeze({
    text,
    used: entries.length > 0,
    entries: Object.freeze(entries),
  });
}

/** Removes counter-shaped text that was not extracted from the trusted template. */
export function stripUnplannedCounterVariables(text) {
  return String(text ?? '')
    .replace(RAW_COUNTER_TOKEN_RE, '')
    .replace(DEFAULT_SENTINEL_RE, '');
}

/**
 * Resolves only sentinels that survived the intervening placeholder render.
 * The increment callback must atomically increment the persisted counter and
 * return its new value. Every entry is failure-isolated so chat processing can
 * continue during a transient database error.
 */
export async function resolveCounterVariablePlan(plan, renderedText, options = {}) {
  const source = String(renderedText ?? '');
  const plannedEntries = Array.isArray(plan?.entries) ? plan.entries : [];
  const activeEntries = plannedEntries.filter((entry) => (
    entry
    && COUNTER_SCOPE_SET.has(entry.scope)
    && typeof entry.name === 'string'
    && typeof entry.sentinel === 'string'
    && entry.sentinel.length > 0
    && source.includes(entry.sentinel)
  ));
  const incrementCounter = options.incrementCounter;

  const outcomes = await Promise.all(activeEntries.map(async (entry) => {
    let subject = null;
    try {
      if (entry.scope === 'user') {
        subject = qualifyCounterUserSubject(options.provider, options.userId);
      }
      if (typeof incrementCounter !== 'function') {
        throw new TypeError('counter_increment_handler_required');
      }
      const rawValue = await incrementCounter({
        scope: entry.scope,
        name: entry.name,
        subject,
      });
      const value = normalizeIncrementedValue(rawValue);
      if (value == null) throw new TypeError('counter_increment_result_invalid');
      return { entry, subject, value, error: null };
    } catch (error) {
      return { entry, subject, value: COUNTER_VARIABLE_ERROR_TEXT, error };
    }
  }));

  let text = source;
  const resolved = [];
  const errors = [];
  for (const outcome of outcomes) {
    text = text.split(outcome.entry.sentinel).join(outcome.value);
    if (outcome.error) {
      errors.push({
        scope: outcome.entry.scope,
        name: outcome.entry.name,
        subject: outcome.subject,
        error: outcome.error,
      });
    } else {
      resolved.push({
        scope: outcome.entry.scope,
        name: outcome.entry.name,
        subject: outcome.subject,
        value: outcome.value,
      });
    }
  }

  return {
    text: stripUnplannedCounterVariables(text),
    used: activeEntries.length > 0,
    attempted: activeEntries.length,
    resolved,
    errors,
  };
}
