import crypto from 'crypto';

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CACHE_MAX_ENTRIES = 1_000;
const MAX_REPORTED_DURATION_SEC = 365 * 24 * 60 * 60;

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeDurationSec(value) {
  const durationSec = Number(value);
  if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > MAX_REPORTED_DURATION_SEC) return null;
  return Math.ceil(durationSec);
}

function getReadySockets(sockets) {
  if (!sockets || typeof sockets[Symbol.iterator] !== 'function') return [];
  return Array.from(sockets).filter((socket) => socket?.readyState === 1 && typeof socket.send === 'function');
}

export function createPvdDurationProbeCoordinator(options = {}) {
  const timeoutMs = Math.max(500, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  const cacheTtlMs = Math.max(0, Number(options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS));
  const cacheMaxEntries = Math.max(1, Number(options.cacheMaxEntries || DEFAULT_CACHE_MAX_ENTRIES));
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const createId = typeof options.createId === 'function' ? options.createId : crypto.randomUUID;
  const scheduleTimeout = typeof options.scheduleTimeout === 'function' ? options.scheduleTimeout : setTimeout;
  const cancelTimeout = typeof options.cancelTimeout === 'function' ? options.cancelTimeout : clearTimeout;

  const cache = new Map();
  const inFlight = new Map();
  const waiters = new Map();

  function cacheKey(provider, mediaId) {
    return `${provider}:${mediaId}`;
  }

  function requestKey(sid, provider, mediaId) {
    return `${sid}:${provider}:${mediaId}`;
  }

  function readCache(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      cache.delete(key);
      return null;
    }
    cache.delete(key);
    cache.set(key, entry);
    return entry.durationSec;
  }

  function writeCache(key, durationSec) {
    if (cacheTtlMs <= 0) return;
    while (cache.size >= cacheMaxEntries) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      cache.delete(oldestKey);
    }
    cache.set(key, { durationSec, expiresAt: now() + cacheTtlMs });
  }

  function request({ sid, provider = 'youtube', mediaId, sockets } = {}) {
    const normalizedSid = normalizeText(sid);
    const normalizedProvider = normalizeText(provider).toLowerCase();
    const normalizedMediaId = normalizeText(mediaId);
    if (!normalizedSid || !normalizedProvider || !normalizedMediaId) return Promise.resolve(null);

    const mediaCacheKey = cacheKey(normalizedProvider, normalizedMediaId);
    const cachedDuration = readCache(mediaCacheKey);
    if (cachedDuration != null) return Promise.resolve(cachedDuration);

    const pendingKey = requestKey(normalizedSid, normalizedProvider, normalizedMediaId);
    const pending = inFlight.get(pendingKey);
    if (pending) return pending;

    const readySockets = getReadySockets(sockets);
    if (!readySockets.length) return Promise.resolve(null);

    const probeId = normalizeText(createId());
    if (!probeId) return Promise.resolve(null);

    let timer = null;
    let settled = false;
    let finish = null;
    const promise = new Promise((resolve) => {
      finish = (durationSec) => {
        if (settled) return;
        settled = true;
        if (timer) cancelTimeout(timer);
        waiters.delete(probeId);
        if (inFlight.get(pendingKey) === promise) inFlight.delete(pendingKey);
        if (durationSec != null) writeCache(mediaCacheKey, durationSec);
        resolve(durationSec);
      };
    });

    inFlight.set(pendingKey, promise);
    waiters.set(probeId, {
      sid: normalizedSid,
      provider: normalizedProvider,
      mediaId: normalizedMediaId,
      finish,
    });

    timer = scheduleTimeout(() => finish(null), timeoutMs);
    timer?.unref?.();

    const payload = JSON.stringify({
      type: 'duration_probe',
      probeId,
      mediaProvider: normalizedProvider,
      mediaId: normalizedMediaId,
      timeoutMs,
    });
    let sentCount = 0;
    for (const socket of readySockets) {
      try {
        socket.send(payload, { compress: false });
        sentCount += 1;
      } catch { }
    }
    if (!sentCount) finish(null);

    return promise;
  }

  function settle({ sid, probeId, provider = 'youtube', mediaId, durationSec } = {}) {
    const normalizedProbeId = normalizeText(probeId);
    const waiter = waiters.get(normalizedProbeId);
    if (!waiter) return { accepted: false, reason: 'probe_not_found' };

    const normalizedSid = normalizeText(sid);
    const normalizedProvider = normalizeText(provider).toLowerCase();
    const normalizedMediaId = normalizeText(mediaId);
    if (
      waiter.sid !== normalizedSid
      || waiter.provider !== normalizedProvider
      || waiter.mediaId !== normalizedMediaId
    ) {
      return { accepted: false, reason: 'probe_mismatch' };
    }

    const normalizedDuration = normalizeDurationSec(durationSec);
    if (normalizedDuration == null) return { accepted: false, reason: 'invalid_duration' };
    waiter.finish(normalizedDuration);
    return { accepted: true, durationSec: normalizedDuration };
  }

  function clearSid(sid) {
    const normalizedSid = normalizeText(sid);
    if (!normalizedSid) return;
    for (const waiter of Array.from(waiters.values())) {
      if (waiter.sid === normalizedSid) waiter.finish(null);
    }
  }

  return {
    request,
    settle,
    clearSid,
    getPendingCount: () => waiters.size,
  };
}
