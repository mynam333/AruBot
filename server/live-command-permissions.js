const ROLE_LEVELS = new Map([
  ['streamer', 4],
  ['streaming_channel_owner', 4],
  ['streaming_channel_manager', 3],
  ['streaming_chat_manager', 2],
]);

export function getLiveRoleLevel(role, options = {}) {
  if (options.isOwner === true || options.isStreamer === true) return 4;
  if (Number.isFinite(role)) return [1, 2, 3, 4].includes(Number(role)) ? Number(role) : 1;

  const normalized = String(role ?? '').trim().toLowerCase();
  if (/^[1-4]$/.test(normalized)) return Number(normalized);
  return ROLE_LEVELS.get(normalized) || 1;
}

export function canManageLiveSettings(options = {}) {
  return getLiveRoleLevel(options.role ?? options.roleLevel, options) >= 2;
}

export function createLiveManagerRoleResolver(options = {}) {
  if (typeof options.loadRoles !== 'function') throw new TypeError('loadRoles must be a function');

  const ttlMs = Math.max(1_000, Number(options.ttlMs || 60_000));
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const getCacheKey = typeof options.getCacheKey === 'function'
    ? options.getCacheKey
    : (ownerContext) => String(ownerContext || '').trim();
  const cache = new Map();
  const inFlight = new Map();

  const load = async (ownerContext, force = false) => {
    const key = String(getCacheKey(ownerContext) || '').trim();
    if (!key) return [];

    const cached = cache.get(key);
    if (!force && cached && cached.expiresAt > now()) return cached.roles;
    if (inFlight.has(key)) return inFlight.get(key);

    const pending = Promise.resolve(options.loadRoles(ownerContext))
      .then((roles) => {
        const normalizedRoles = Array.isArray(roles) ? roles.filter(Boolean) : [];
        cache.set(key, { roles: normalizedRoles, expiresAt: now() + ttlMs });
        return normalizedRoles;
      })
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, pending);
    return pending;
  };

  return {
    async getRoleLevel(ownerContext, actorChannelId, resolveOptions = {}) {
      const actorId = String(actorChannelId || '').trim();
      if (!actorId) return 1;
      const roles = await load(ownerContext, resolveOptions.force === true);
      let roleLevel = 1;
      for (const role of roles) {
        if (String(role?.managerChannelId || '').trim() !== actorId) continue;
        roleLevel = Math.max(roleLevel, getLiveRoleLevel(role?.userRole));
      }
      return roleLevel;
    },
    invalidate(ownerContext) {
      cache.delete(String(getCacheKey(ownerContext) || '').trim());
    },
    clear() {
      cache.clear();
    },
  };
}
