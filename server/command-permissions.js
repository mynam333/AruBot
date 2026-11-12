import { canExecuteCommand, isCommandPermission } from '../shared/command-permissions.js';

export function validateCommandPermission(rule) {
  if (rule.executionPermission !== undefined && rule.executionPermission !== null && !isCommandPermission(rule.executionPermission)) {
    throw Object.assign(new Error('올바른 명령어 실행 권한을 선택해 주세요.'), { status: 400, code: 'invalid_command_permission' });
  }
}

export function isCimeChatSubscriber(event) {
  const badges = event?.raw?.profile?.badges;
  return Array.isArray(badges) && badges.some(badge => /^subscribe_tier[1-9]\d*$/.test(String(badge?.id || '')));
}

// Only restricted CHZZK commands need a lookup. Share the channel snapshot and in-flight work.
export function createCommandPermissionChecker({ loadSubscribers, now = Date.now, ttlMs = 60_000, maxEntries = 250 }) {
  const cache = new Map();
  const inFlight = new Map();
  const subscribersFor = async sid => {
    const cached = cache.get(sid);
    if (cached && cached.expiresAt > now()) return cached.ids;
    if (inFlight.has(sid)) return inFlight.get(sid);
    if (inFlight.size >= maxEntries) return new Set();
    const pending = Promise.resolve().then(() => loadSubscribers(sid)).then(ids => {
      const members = new Set(ids);
      cache.delete(sid);
      cache.set(sid, { ids: members, expiresAt: now() + ttlMs });
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      return members;
    }).catch(() => {
      cache.delete(sid);
      cache.set(sid, { ids: new Set(), expiresAt: now() + 5000 });
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      return new Set();
    }).finally(() => inFlight.delete(sid));
    inFlight.set(sid, pending);
    return pending;
  };
  return async (rule, actor) => {
    if (canExecuteCommand(rule, actor)) return true;
    if (rule.executionPermission !== 'subscriber' || actor.provider !== 'chzzk' || !actor.sid || !actor.userId) return false;
    return (await subscribersFor(actor.sid)).has(String(actor.userId).replace(/^(?:(?:user|chzzk):)+/, '').trim());
  };
}
