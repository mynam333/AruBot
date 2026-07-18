const LIVE_START_TOLERANCE_MS = 60 * 1000;
const PROVIDER_OBSERVATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function positiveTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function summarizeProviderStates({ observations, sid, provider = null, currentIsLive = null, now = Date.now() }) {
  const normalizedSid = String(sid || '').trim();
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const observedAt = positiveTimestamp(now) || Date.now();
  const providerStates = observations.get(normalizedSid) || new Map();
  const activeStates = [];
  const unknownStates = [];

  for (const [providerName, state] of providerStates.entries()) {
    const ageMs = observedAt - Number(state?.observedAt || 0);
    if (ageMs < 0 || ageMs > PROVIDER_OBSERVATION_MAX_AGE_MS) {
      providerStates.delete(providerName);
      continue;
    }
    if (state?.live === true) activeStates.push({ provider: providerName, ...state });
    else if (state?.live == null) unknownStates.push({ provider: providerName, ...state });
  }

  if (providerStates.size > 0) observations.set(normalizedSid, providerStates);
  else observations.delete(normalizedSid);

  const activeStartTimes = activeStates
    .map((state) => positiveTimestamp(state.startTimestamp))
    .filter((value) => value != null);
  const hasUnknownProvider = unknownStates.length > 0;
  return {
    isLive: activeStates.length > 0,
    startTimestamp: activeStartTimes.length ? Math.max(...activeStartTimes) : null,
    protectedByOtherProvider: currentIsLive === false
      && activeStates.some((state) => state.provider !== normalizedProvider),
    hasUnknownProvider,
    deferOffline: activeStates.length === 0 && hasUnknownProvider,
  };
}

export function normalizeLiveSession(session = null) {
  if (!session || typeof session !== 'object') {
    return {
      live: false,
      startDate: null,
      sessionStartTime: null,
      lastUpdate: null,
    };
  }

  return {
    live: session.live === true,
    startDate: session.start_date || session.startDate || null,
    sessionStartTime: positiveTimestamp(session.session_start_time ?? session.sessionStartTime),
    lastUpdate: positiveTimestamp(session.last_update ?? session.lastUpdate),
  };
}

export function reconcileProviderLiveObservation({
  observations,
  sid,
  provider = null,
  isLive,
  startTimestamp = null,
  now = Date.now(),
} = {}) {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  if (!normalizedProvider) {
    return {
      isLive: isLive === true,
      startTimestamp: positiveTimestamp(startTimestamp),
      protectedByOtherProvider: false,
    };
  }
  if (!(observations instanceof Map)) {
    throw new TypeError('Provider live observations must be stored in a Map');
  }

  const normalizedSid = String(sid || '').trim();
  const observedAt = positiveTimestamp(now) || Date.now();
  const providerStates = observations.get(normalizedSid) || new Map();
  providerStates.set(normalizedProvider, {
    live: isLive === true ? true : (isLive === false ? false : null),
    startTimestamp: positiveTimestamp(startTimestamp),
    observedAt,
  });
  observations.set(normalizedSid, providerStates);
  return summarizeProviderStates({
    observations,
    sid: normalizedSid,
    provider: normalizedProvider,
    currentIsLive: isLive,
    now: observedAt,
  });
}

export function primeProviderLiveObservations({ observations, targets, now = Date.now() } = {}) {
  if (!(observations instanceof Map)) {
    throw new TypeError('Provider live observations must be stored in a Map');
  }
  const observedAt = positiveTimestamp(now) || Date.now();
  const grouped = new Map();
  for (const target of Array.isArray(targets) ? targets : []) {
    const sid = String(target?.sid || '').trim();
    const provider = String(target?.provider || '').trim().toLowerCase();
    if (!sid || !provider) continue;
    const providerStates = grouped.get(sid) || new Map();
    providerStates.set(provider, {
      live: null,
      startTimestamp: null,
      observedAt,
    });
    grouped.set(sid, providerStates);
  }

  observations.clear();
  for (const [sid, providerStates] of grouped.entries()) {
    observations.set(sid, providerStates);
  }
  return {
    sidCount: grouped.size,
    providerCount: Array.from(grouped.values()).reduce((total, states) => total + states.size, 0),
  };
}

export function summarizeProviderLiveObservations({ observations, sid, now = Date.now() } = {}) {
  if (!(observations instanceof Map)) {
    throw new TypeError('Provider live observations must be stored in a Map');
  }
  return summarizeProviderStates({ observations, sid, now });
}

export function removeProviderLiveObservation({ observations, sid, provider, now = Date.now() } = {}) {
  if (!(observations instanceof Map)) {
    throw new TypeError('Provider live observations must be stored in a Map');
  }
  const normalizedSid = String(sid || '').trim();
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const providerStates = observations.get(normalizedSid);
  providerStates?.delete(normalizedProvider);
  if (providerStates?.size) observations.set(normalizedSid, providerStates);
  else observations.delete(normalizedSid);
  return summarizeProviderStates({
    observations,
    sid: normalizedSid,
    provider: normalizedProvider,
    currentIsLive: false,
    now,
  });
}

export function planLiveSessionTransition({
  currentSession = null,
  isLive,
  incomingStartTimestamp = null,
  now = Date.now(),
  getDate,
} = {}) {
  if (typeof getDate !== 'function') {
    throw new TypeError('planLiveSessionTransition requires a getDate function');
  }

  const current = normalizeLiveSession(currentSession);
  const observedAt = positiveTimestamp(now) || Date.now();
  const incomingStart = positiveTimestamp(incomingStartTimestamp);

  if (!isLive) {
    return {
      operation: 'end_session',
      reason: 'platform_offline',
      startDate: null,
      sessionStartTime: null,
      lastUpdate: observedAt,
    };
  }

  const hasUsableCurrentSession = current.live
    && /^\d{4}-\d{2}-\d{2}$/.test(String(current.startDate || ''));
  const incomingStartDate = incomingStart == null ? null : getDate(incomingStart);
  const incomingIsNewer = incomingStart != null && (
    incomingStartDate > String(current.startDate || '')
    || (
      incomingStartDate === String(current.startDate || '')
      && current.sessionStartTime != null
      && incomingStart > current.sessionStartTime + LIVE_START_TOLERANCE_MS
    )
  );

  if (!hasUsableCurrentSession || incomingIsNewer) {
    const sessionStartTime = incomingStart || observedAt;
    return {
      operation: 'start_session',
      reason: hasUsableCurrentSession ? 'newer_platform_start' : 'missing_active_session',
      startDate: getDate(sessionStartTime),
      sessionStartTime,
      lastUpdate: observedAt,
    };
  }

  return {
    operation: 'heartbeat',
    reason: incomingStart == null ? 'start_time_unavailable' : 'same_active_session',
    startDate: current.startDate,
    sessionStartTime: current.sessionStartTime,
    lastUpdate: observedAt,
  };
}
