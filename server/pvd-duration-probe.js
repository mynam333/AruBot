import crypto from 'crypto';

const DEFAULT_TIMEOUT_MS = 14_000;
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CACHE_MAX_ENTRIES = 1_000;
const MAX_REPORTED_DURATION_SEC = 365 * 24 * 60 * 60;
const MAX_FAILURE_REPORTS = 8;

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
  const logger = typeof options.logger === 'function' ? options.logger : console.warn;

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

  function payloadFor(waiter) {
    return {
      type: 'duration_probe',
      probeId: waiter.probeId,
      mediaProvider: waiter.provider,
      mediaId: waiter.mediaId,
      timeoutMs: Math.max(500, waiter.expiresAt - now()),
    };
  }

  function dispatchWaiter(waiter, sockets) {
    const readySockets = getReadySockets(sockets);
    if (!readySockets.length) return 0;
    const payload = JSON.stringify(payloadFor(waiter));
    let sentCount = 0;
    for (const socket of readySockets) {
      if (waiter.sentSockets.has(socket)) continue;
      try {
        socket.send(payload, { compress: false });
        waiter.sentSockets.add(socket);
        waiter.sendCount += 1;
        sentCount += 1;
      } catch { }
    }
    return sentCount;
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

    const probeId = normalizeText(createId());
    if (!probeId) return Promise.resolve(null);

    let timer = null;
    let settled = false;
    let promise = null;
    const waiter = {
      probeId,
      sid: normalizedSid,
      provider: normalizedProvider,
      mediaId: normalizedMediaId,
      expiresAt: now() + timeoutMs,
      sentSockets: new WeakSet(),
      sendCount: 0,
      failureReports: [],
      finish: null,
    };

    promise = new Promise((resolve) => {
      waiter.finish = (durationSec) => {
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
    waiters.set(probeId, waiter);

    timer = scheduleTimeout(() => {
      logger('[PVD duration probe] Timed out', {
        sid: normalizedSid,
        provider: normalizedProvider,
        mediaId: normalizedMediaId,
        probeId,
        sendCount: waiter.sendCount,
        failureReports: waiter.failureReports,
      });
      waiter.finish(null);
    }, timeoutMs);
    timer?.unref?.();

    dispatchWaiter(waiter, sockets);
    return promise;
  }

  function getMatchingWaiter({ sid, probeId, provider = 'youtube', mediaId } = {}) {
    const normalizedProbeId = normalizeText(probeId);
    const waiter = waiters.get(normalizedProbeId);
    if (!waiter) return { waiter: null, error: { accepted: false, reason: 'probe_not_found' } };

    const normalizedSid = normalizeText(sid);
    const normalizedProvider = normalizeText(provider).toLowerCase();
    const normalizedMediaId = normalizeText(mediaId);
    if (
      waiter.sid !== normalizedSid
      || waiter.provider !== normalizedProvider
      || waiter.mediaId !== normalizedMediaId
    ) {
      return { waiter: null, error: { accepted: false, reason: 'probe_mismatch' } };
    }
    return { waiter, error: null };
  }

  function settle({ sid, probeId, provider = 'youtube', mediaId, durationSec, errorCode } = {}) {
    const match = getMatchingWaiter({ sid, probeId, provider, mediaId });
    if (!match.waiter) return match.error;

    const normalizedDuration = normalizeDurationSec(durationSec);
    if (normalizedDuration == null) {
      const failureCode = normalizeText(errorCode).slice(0, 80);
      if (!failureCode) return { accepted: false, reason: 'invalid_duration' };
      if (match.waiter.failureReports.length < MAX_FAILURE_REPORTS) {
        match.waiter.failureReports.push(failureCode);
      }
      return { accepted: true, pending: true, reason: 'probe_failed' };
    }

    match.waiter.finish(normalizedDuration);
    return { accepted: true, durationSec: normalizedDuration };
  }

  function dispatchPendingToSocket(sid, socket) {
    const normalizedSid = normalizeText(sid);
    if (!normalizedSid || !socket) return 0;
    let sentCount = 0;
    for (const waiter of waiters.values()) {
      if (waiter.sid === normalizedSid) sentCount += dispatchWaiter(waiter, [socket]);
    }
    return sentCount;
  }

  function listPending(sid) {
    const normalizedSid = normalizeText(sid);
    if (!normalizedSid) return [];
    return Array.from(waiters.values())
      .filter((waiter) => waiter.sid === normalizedSid && waiter.expiresAt > now())
      .map(payloadFor);
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
    dispatchPendingToSocket,
    listPending,
    clearSid,
    getPendingCount: () => waiters.size,
  };
}
