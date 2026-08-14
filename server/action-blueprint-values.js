import safeRegex from 'safe-regex2';
import { Worker } from 'node:worker_threads';
import { substituteDdayVariables } from './dday-variables.js';

const BLUEPRINT_READ_TOKEN_RE = /(?<!\$)\{([\p{L}\p{N}_.-]+)\}/gu;
const BLUEPRINT_NUMERIC_TEXT_RE = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
const BLUEPRINT_REGEX_MAX_PATTERN_LENGTH = 256;
const BLUEPRINT_REGEX_MAX_INPUT_LENGTH = 4096;
const BLUEPRINT_REGEX_TIMEOUT_MS = 100;
const BLUEPRINT_REGEX_STARTUP_TIMEOUT_MS = 2000;
const BLUEPRINT_REGEX_MAX_PENDING = 32;

let blueprintRegexWorker = null;
let blueprintRegexWorkerReady = false;
let blueprintRegexActiveTask = null;
const blueprintRegexQueue = [];
let blueprintRegexTaskId = 0;

function rejectActiveRegexTask(worker, error) {
  if (blueprintRegexWorker !== worker) return;
  blueprintRegexWorker = null;
  blueprintRegexWorkerReady = false;
  const task = blueprintRegexActiveTask;
  blueprintRegexActiveTask = null;
  if (task) {
    clearTimeout(task.timer);
    clearTimeout(task.startupTimer);
    task.reject(error);
  }
  queueMicrotask(runNextBlueprintRegexTask);
}

function ensureBlueprintRegexWorker() {
  if (blueprintRegexWorker) return blueprintRegexWorker;
  const worker = new Worker(new URL('./action-blueprint-regex-worker.js', import.meta.url), {
    type: 'module',
    execArgv: process.execArgv.filter((argument) => !String(argument).startsWith('--input-type')),
    resourceLimits: { maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4, stackSizeMb: 2 },
  });
  worker.unref();
  worker.on('message', (message) => {
    if (blueprintRegexWorker !== worker) return;
    if (message?.type === 'ready') {
      blueprintRegexWorkerReady = true;
      const task = blueprintRegexActiveTask;
      if (task) {
        clearTimeout(task.startupTimer);
        dispatchBlueprintRegexTask(worker, task);
      }
      return;
    }
    const task = blueprintRegexActiveTask;
    if (!task || message?.id !== task.id) return;
    clearTimeout(task.timer);
    clearTimeout(task.startupTimer);
    blueprintRegexActiveTask = null;
    if (message?.ok === true) task.resolve(message.matched === true);
    else task.reject(createBlueprintValueError('blueprint_regex_invalid', '실행 액션의 정규식이 올바르지 않습니다.'));
    worker.unref();
    queueMicrotask(runNextBlueprintRegexTask);
  });
  worker.on('error', (error) => {
    rejectActiveRegexTask(
      worker,
      createBlueprintValueError('blueprint_regex_worker_failed', '실행 액션의 정규식 검사에 실패했습니다.', error)
    );
  });
  worker.on('exit', (code) => {
    if (blueprintRegexWorker !== worker) return;
    rejectActiveRegexTask(
      worker,
      createBlueprintValueError('blueprint_regex_worker_exited', `실행 액션의 정규식 검사기가 종료되었습니다. (${code})`)
    );
  });
  blueprintRegexWorker = worker;
  blueprintRegexWorkerReady = false;
  return worker;
}

function dispatchBlueprintRegexTask(worker, task) {
  if (
    task.dispatched
    || blueprintRegexWorker !== worker
    || blueprintRegexActiveTask !== task
    || !blueprintRegexWorkerReady
  ) return;
  task.dispatched = true;
  task.timer = setTimeout(() => {
    if (blueprintRegexWorker !== worker || blueprintRegexActiveTask !== task) return;
    blueprintRegexWorker = null;
    blueprintRegexWorkerReady = false;
    blueprintRegexActiveTask = null;
    task.reject(createBlueprintValueError('blueprint_regex_timeout', '실행 액션의 정규식 검사가 제한 시간을 초과했습니다.'));
    void worker.terminate();
    queueMicrotask(runNextBlueprintRegexTask);
  }, BLUEPRINT_REGEX_TIMEOUT_MS);
  try {
    worker.postMessage({ id: task.id, pattern: task.pattern, input: task.input });
  } catch (error) {
    rejectActiveRegexTask(
      worker,
      createBlueprintValueError('blueprint_regex_worker_failed', '실행 액션의 정규식 검사 요청에 실패했습니다.', error)
    );
  }
}

function runNextBlueprintRegexTask() {
  if (blueprintRegexActiveTask || blueprintRegexQueue.length === 0) return;
  const task = blueprintRegexQueue.shift();
  let worker;
  try {
    worker = ensureBlueprintRegexWorker();
  } catch (error) {
    task.reject(createBlueprintValueError('blueprint_regex_worker_failed', '실행 액션의 정규식 검사기를 시작하지 못했습니다.', error));
    queueMicrotask(runNextBlueprintRegexTask);
    return;
  }
  blueprintRegexActiveTask = task;
  worker.ref();
  if (blueprintRegexWorkerReady) {
    dispatchBlueprintRegexTask(worker, task);
    return;
  }
  task.startupTimer = setTimeout(() => {
    if (blueprintRegexWorker !== worker || blueprintRegexActiveTask !== task) return;
    rejectActiveRegexTask(
      worker,
      createBlueprintValueError('blueprint_regex_worker_failed', '실행 액션의 정규식 검사기를 시작하지 못했습니다.')
    );
    void worker.terminate();
  }, BLUEPRINT_REGEX_STARTUP_TIMEOUT_MS);
}

function matchBlueprintRegex(pattern, input) {
  const pendingCount = blueprintRegexQueue.length + (blueprintRegexActiveTask ? 1 : 0);
  if (pendingCount >= BLUEPRINT_REGEX_MAX_PENDING) {
    return Promise.reject(createBlueprintValueError('blueprint_regex_overloaded', '실행 액션의 정규식 검사 요청이 너무 많습니다.'));
  }
  return new Promise((resolve, reject) => {
    blueprintRegexQueue.push({
      id: ++blueprintRegexTaskId,
      pattern,
      input,
      resolve,
      reject,
      timer: null,
      startupTimer: null,
      dispatched: false,
    });
    runNextBlueprintRegexTask();
  });
}

const RESOLVER_PATHS = Object.freeze({
  points: new Set(['user.points', 'user.channelPoints']),
  attendance: new Set(['user.attendanceDays', 'attendance.streak', 'attendance.totalDays']),
  followedAt: new Set(['user.followedAt', 'user.followedDays']),
  subscription: new Set(['user.subscriptionMonths']),
  live: new Set([
    'live.title',
    'live.category',
    'live.viewers',
    'live.startedAt',
    'live.elapsed',
    'live.elapsed_ko',
    'live.channel',
  ]),
  followers: new Set(['channel.followers']),
});

function createBlueprintValueError(code, message, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function firstPresent(...values) {
  return values.find((value) => value != null && String(value).trim() !== '');
}

function normalizeFiniteNumber(value) {
  if (value == null || typeof value === 'boolean' || typeof value === 'object') return null;
  if (typeof value === 'bigint') {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!BLUEPRINT_NUMERIC_TEXT_RE.test(text)) return null;
    value = text.replace(/,/g, '');
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasAnyReference(paths, expected) {
  for (const path of expected) {
    if (paths.has(path)) return true;
  }
  return false;
}

function collectPaths(value, paths, seen) {
  if (typeof value === 'string') {
    BLUEPRINT_READ_TOKEN_RE.lastIndex = 0;
    for (const match of value.matchAll(BLUEPRINT_READ_TOKEN_RE)) paths.add(match[1]);
    return;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectPaths(item, paths, seen);
    return;
  }
  for (const item of Object.values(value)) collectPaths(item, paths, seen);
}

async function memoizedResolve(memo, key, resolver, args) {
  if (memo.has(key)) return memo.get(key);
  const promise = Promise.resolve().then(() => resolver(args));
  memo.set(key, promise);
  try {
    return await promise;
  } catch (error) {
    memo.delete(key);
    throw error;
  }
}

export function getBlueprintResolverMemoKey(family, context = {}, explicitUserId = '') {
  const normalized = normalizeBlueprintReadContext(context);
  const provider = String(normalized.trigger?.platform || normalized.platform || '').trim().toLowerCase();
  const userId = String(explicitUserId || normalized.user?.userId || '').trim();
  return `${family}:${provider}:${userId}`;
}

function resolverError(family, error) {
  if (String(error?.code || '').startsWith('blueprint_')) return error;
  return createBlueprintValueError(
    `blueprint_${family}_unavailable`,
    `The ${family} blueprint variable could not be loaded`,
    error
  );
}

export function collectBlueprintReadPaths(value) {
  const paths = new Set();
  collectPaths(value, paths, new Set());
  return paths;
}

export function normalizeBlueprintReadContext(context = {}) {
  const source = context && typeof context === 'object' ? context : {};
  const sourceUser = source.user && typeof source.user === 'object' ? source.user : {};
  const sourceCommand = source.command && typeof source.command === 'object' ? source.command : {};
  const sourceTrigger = source.trigger && typeof source.trigger === 'object' ? source.trigger : {};
  const sourceChannel = source.channel && typeof source.channel === 'object' ? source.channel : {};
  const sourceRoulette = source.roulette && typeof source.roulette === 'object' ? source.roulette : {};
  const sourceResult = source.result && typeof source.result === 'object' ? source.result : null;
  const chatPlatform = source.chatPost?.provider || source.chatPost?.platform;

  const userId = firstPresent(sourceUser.userId, sourceUser.id);
  const username = firstPresent(sourceUser.username, sourceUser.name, sourceUser.nickname);
  const platform = firstPresent(sourceTrigger.platform, source.platform, chatPlatform);
  const channelUid = firstPresent(sourceChannel.channelUid, source.channelUid, sourceChannel.id, sourceRoulette.channelUid);
  const rouletteResult = sourceRoulette.result && typeof sourceRoulette.result === 'object'
    ? sourceRoulette.result
    : sourceResult;

  return {
    ...source,
    ...(platform ? { platform: String(platform).toLowerCase() } : {}),
    ...(channelUid ? { channelUid: String(channelUid) } : {}),
    user: {
      ...sourceUser,
      ...(userId ? { userId: String(userId), id: String(userId) } : {}),
      ...(username ? {
        username: String(username),
        name: String(username),
        nickname: String(username),
      } : {}),
    },
    channel: {
      ...sourceChannel,
      ...(channelUid ? { channelUid: String(channelUid) } : {}),
    },
    trigger: {
      ...sourceTrigger,
      message: sourceTrigger.message ?? sourceCommand.text ?? '',
      keyword: sourceTrigger.keyword ?? sourceCommand.keyword ?? '',
      ...(platform ? { platform: String(platform).toLowerCase() } : {}),
    },
    roulette: {
      ...sourceRoulette,
      ...(rouletteResult ? { result: { ...rouletteResult } } : {}),
    },
    donation: source.donation && typeof source.donation === 'object' ? { ...source.donation } : {},
    attendance: source.attendance && typeof source.attendance === 'object' ? { ...source.attendance } : {},
    live: source.live && typeof source.live === 'object' ? { ...source.live } : {},
  };
}

export function mergeBlueprintReadContexts(current = {}, next = {}) {
  return {
    ...(current || {}),
    ...(next || {}),
    user: { ...(current.user || {}), ...(next.user || {}) },
    channel: { ...(current.channel || {}), ...(next.channel || {}) },
    trigger: { ...(current.trigger || {}), ...(next.trigger || {}) },
    roulette: {
      ...(current.roulette || {}),
      ...(next.roulette || {}),
      ...((current.roulette?.result || next.roulette?.result) ? {
        result: { ...(current.roulette?.result || {}), ...(next.roulette?.result || {}) },
      } : {}),
    },
    donation: { ...(current.donation || {}), ...(next.donation || {}) },
    attendance: { ...(current.attendance || {}), ...(next.attendance || {}) },
    live: { ...(current.live || {}), ...(next.live || {}) },
  };
}

export async function hydrateBlueprintReadContext({
  context = {},
  value,
  dryRun = false,
  resolvers = {},
  memo = new Map(),
  currentDate = '',
} = {}) {
  const normalized = normalizeBlueprintReadContext(context);
  const paths = collectBlueprintReadPaths(value);
  if (!paths.size) return normalized;

  if (normalized.user.attendanceDays == null && normalized.attendance.totalDays != null) {
    normalized.user.attendanceDays = normalized.attendance.totalDays;
  }
  if (normalized.attendance.totalDays == null && normalized.user.attendanceDays != null) {
    normalized.attendance.totalDays = normalized.user.attendanceDays;
  }

  const userId = String(normalized.user?.userId || '').trim();
  const provider = String(normalized.trigger?.platform || normalized.platform || '').trim().toLowerCase();
  const needs = Object.fromEntries(
    Object.entries(RESOLVER_PATHS).map(([family, expected]) => [family, hasAnyReference(paths, expected)])
  );
  needs.attendance = (
    (paths.has('user.attendanceDays') && normalized.user.attendanceDays == null)
    || (paths.has('attendance.streak') && normalized.attendance.streak == null)
    || (paths.has('attendance.totalDays') && normalized.attendance.totalDays == null)
  );

  if (dryRun) {
    const simulated = normalized.user?.points ?? normalized.user?.channelPoints;
    if (needs.points) {
      const points = normalizeFiniteNumber(simulated);
      if (points == null) {
        throw createBlueprintValueError(
          'blueprint_user_points_invalid',
          'The action test requires a valid simulated user point balance'
        );
      }
      normalized.user.points = points;
      normalized.user.channelPoints = points;
    }
    if (normalized.user.attendanceDays == null && normalized.attendance.totalDays != null) {
      normalized.user.attendanceDays = normalized.attendance.totalDays;
    }
    if (normalized.attendance.totalDays == null && normalized.user.attendanceDays != null) {
      normalized.attendance.totalDays = normalized.user.attendanceDays;
    }
    if (paths.has('attendance.points') && normalized.attendance.points == null) normalized.attendance.points = 0;
    if (paths.has('attendance.date') && normalized.attendance.date == null) normalized.attendance.date = currentDate;
    return normalized;
  }

  const requireUser = (family) => {
    if (userId) return;
    throw createBlueprintValueError(
      `blueprint_${family}_identity_required`,
      `A viewer identity is required to resolve the ${family} blueprint variable`
    );
  };
  const requireResolver = (family, resolver) => {
    if (typeof resolver === 'function') return;
    throw createBlueprintValueError(
      `blueprint_${family}_resolver_unavailable`,
      `The ${family} blueprint variable resolver is unavailable`
    );
  };

  const tasks = [];
  const resolved = {};
  const addTask = (family, resolver, args = {}) => {
    requireResolver(family, resolver);
    tasks.push(
      memoizedResolve(memo, getBlueprintResolverMemoKey(family, normalized, userId), resolver, {
        context: normalized,
        provider,
        userId,
        ...args,
      }).then((result) => { resolved[family] = result; }).catch((error) => { throw resolverError(family, error); })
    );
  };

  if (needs.points) {
    requireUser('user_points');
    addTask('user_points', resolvers.loadUserPoints);
  }
  if (needs.attendance) {
    requireUser('attendance');
    addTask('attendance', resolvers.loadAttendanceSummary);
  }
  if (needs.followedAt) {
    requireUser('follow');
    addTask('follow', resolvers.loadFollowedAt);
  }
  if (needs.subscription) {
    requireUser('subscription');
    addTask('subscription', resolvers.loadSubscriptionMonths);
  }
  if (needs.live) addTask('live', resolvers.loadLiveInfo);
  if (needs.followers) addTask('followers', resolvers.loadFollowerCount);

  await Promise.all(tasks);

  if (needs.points) {
    const points = normalizeFiniteNumber(resolved.user_points);
    if (points == null) {
      throw createBlueprintValueError('blueprint_user_points_invalid', 'The stored user point balance is invalid');
    }
    normalized.user.points = points;
    normalized.user.channelPoints = points;
  }
  if (needs.attendance) {
    const summary = resolved.attendance && typeof resolved.attendance === 'object' ? resolved.attendance : {};
    const streak = normalizeFiniteNumber(summary.streak);
    const totalDays = normalizeFiniteNumber(summary.totalDays);
    if (streak == null || totalDays == null) {
      throw createBlueprintValueError('blueprint_attendance_invalid', 'The stored attendance summary is invalid');
    }
    normalized.user.attendanceDays = totalDays;
    if (normalized.attendance.streak == null) normalized.attendance.streak = streak;
    if (normalized.attendance.totalDays == null) normalized.attendance.totalDays = totalDays;
  }
  if (needs.followedAt) {
    const follow = resolved.follow && typeof resolved.follow === 'object'
      ? resolved.follow
      : { followedAt: resolved.follow };
    normalized.user.followedAt = follow.followedAt || '확인할 수 없음';
    normalized.user.followedDays = normalizeFiniteNumber(follow.followedDays) ?? 0;
  }
  if (needs.subscription) {
    normalized.user.subscriptionMonths = normalizeFiniteNumber(resolved.subscription) ?? '';
  }
  if (needs.live) {
    normalized.live = {
      ...normalized.live,
      ...(resolved.live && typeof resolved.live === 'object' ? resolved.live : {}),
    };
  }
  if (needs.followers) {
    normalized.channel.followers = normalizeFiniteNumber(resolved.followers) ?? '';
  }
  if (paths.has('attendance.points') && normalized.attendance.points == null) normalized.attendance.points = 0;
  if (paths.has('attendance.date') && normalized.attendance.date == null) normalized.attendance.date = currentDate;
  return normalized;
}

export function getBlueprintPathValue(source, pathExpression) {
  const path = String(pathExpression || '').replace(/^\{|\}$/g, '').trim();
  if (!path) return undefined;
  return path.split('.').reduce((value, key) => {
    if (value == null) return undefined;
    if (!Object.prototype.hasOwnProperty.call(Object(value), key)) return undefined;
    return value[key];
  }, source);
}

export function buildBlueprintScope(context = {}, flow = {}, nodeOutputs = {}) {
  return {
    ...(context || {}),
    flow,
    node: nodeOutputs,
    user: context.user || {},
    channel: context.channel || {},
    trigger: context.trigger || {},
    roulette: context.roulette || {},
    donation: context.donation || {},
    attendance: context.attendance || {},
    live: context.live || {},
  };
}

export function renderBlueprintTemplate(value, scope = {}) {
  if (value == null) return '';
  return substituteDdayVariables(value).replace(BLUEPRINT_READ_TOKEN_RE, (match, pathExpression) => {
    const resolved = getBlueprintPathValue(scope, pathExpression);
    if (resolved == null) return '';
    if (typeof resolved === 'object') {
      try { return JSON.stringify(resolved); } catch { return ''; }
    }
    return String(resolved);
  });
}

export function renderBlueprintValueDeep(value, scope = {}) {
  if (typeof value === 'string') return renderBlueprintTemplate(value, scope);
  if (Array.isArray(value)) return value.map((item) => renderBlueprintValueDeep(item, scope));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderBlueprintValueDeep(item, scope)]));
  }
  return value;
}

export function evaluateBlueprintValue(value, scope = {}) {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value == null) return '';
  const rendered = renderBlueprintTemplate(value, scope).trim();
  if (/^(true|false)$/i.test(rendered)) return rendered.toLowerCase() === 'true';
  if (BLUEPRINT_NUMERIC_TEXT_RE.test(rendered)) return Number(rendered.replace(/,/g, ''));
  if (/^[\d\s+\-*/().%]+$/.test(rendered) && /[+\-*/%]/.test(rendered)) {
    try {
      const result = Function(`"use strict"; return (${rendered});`)();
      return Number.isFinite(Number(result)) ? Number(result) : rendered;
    } catch { }
  }
  return rendered;
}

export async function compareBlueprintValues(left, operator, right) {
  const op = String(operator || 'eq');
  if (op === 'exists') return left != null && left !== '';
  if (op === 'empty') return left == null || left === '';
  if (op === 'contains') return String(left ?? '').includes(String(right ?? ''));
  if (op === 'regex') {
    const pattern = String(right || '');
    const input = String(left ?? '');
    if (pattern.length > BLUEPRINT_REGEX_MAX_PATTERN_LENGTH) {
      throw createBlueprintValueError('blueprint_regex_pattern_too_long', '실행 액션의 정규식은 256자까지 사용할 수 있습니다.');
    }
    if (input.length > BLUEPRINT_REGEX_MAX_INPUT_LENGTH) {
      throw createBlueprintValueError('blueprint_regex_input_too_long', '정규식으로 비교할 값이 너무 깁니다.');
    }
    try {
      new RegExp(pattern);
    } catch (error) {
      throw createBlueprintValueError('blueprint_regex_invalid', '실행 액션의 정규식이 올바르지 않습니다.', error);
    }
    if (!safeRegex(pattern)) {
      throw createBlueprintValueError('blueprint_regex_unsafe', '실행 액션에서 안전하지 않은 정규식은 사용할 수 없습니다.');
    }
    return matchBlueprintRegex(pattern, input);
  }

  const relational = ['gt', 'gte', 'lt', 'lte'].includes(op);
  const leftBlank = left == null || (typeof left === 'string' && left.trim() === '');
  const rightBlank = right == null || (typeof right === 'string' && right.trim() === '');
  if (relational && (leftBlank || rightBlank)) return false;

  const ln = normalizeFiniteNumber(left);
  const rn = normalizeFiniteNumber(right);
  if (relational && ((ln == null) !== (rn == null))) return false;
  const bothNumbers = ln != null && rn != null;
  if (op === 'gt') return bothNumbers ? ln > rn : String(left) > String(right);
  if (op === 'gte') return bothNumbers ? ln >= rn : String(left) >= String(right);
  if (op === 'lt') return bothNumbers ? ln < rn : String(left) < String(right);
  if (op === 'lte') return bothNumbers ? ln <= rn : String(left) <= String(right);
  if (op === 'neq') return String(left) !== String(right);
  return String(left) === String(right);
}
