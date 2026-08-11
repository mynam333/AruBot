const PUBLIC_CHANNEL_PROVIDERS = new Set(['chzzk', 'cime', 'youtube']);

export function publicChannelUidForBalance(balance) {
  const provider = String(balance?.provider || '').trim().toLowerCase();
  const channelUid = String(balance?.channelUid || '').trim();
  if (
    PUBLIC_CHANNEL_PROVIDERS.has(provider)
    && !/^(chzzk|cime|youtube):/i.test(channelUid)
  ) {
    return `${provider}:${channelUid}`;
  }
  return channelUid;
}

function viewerDrawingStreamerMatchesUid(streamer, value, identity = null) {
  const uid = String(value || '').trim();
  const ownerUserId = String(identity?.ownerUserId || '').replace(/^user:/, '').trim();
  const canonicalOwner = String(streamer?.canonicalChannelUid || '').replace(/^user:/, '').trim();
  if (!uid) return false;
  if (ownerUserId) return canonicalOwner === ownerUserId;
  if (/^(chzzk|cime|youtube):/i.test(uid)) return false;
  return [
    streamer?.publicUid,
    streamer?.channelUid,
    streamer?.canonicalChannelUid,
  ].some((candidate) => String(candidate || '').trim() === uid);
}

export function findViewerDrawingStreamer(streamers, value, identity = null) {
  const matches = (Array.isArray(streamers) ? streamers : [])
    .filter((streamer) => viewerDrawingStreamerMatchesUid(streamer, value, identity));
  return matches.length === 1 ? matches[0] : null;
}

export function attachInternalPointSettingsSid(streamer, sid) {
  const value = String(sid || '').trim();
  if (!streamer || typeof streamer !== 'object' || !value.startsWith('user:')) return streamer;
  Object.defineProperty(streamer, 'pointSettingsSid', {
    value,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return streamer;
}

export function createBoundedOperationRunner({
  maxInFlight,
  timeoutMs,
  errorCode = 'temporarily_unavailable',
} = {}) {
  const concurrencyLimit = Math.max(1, Number(maxInFlight) || 1);
  const deadlineMs = Math.max(1, Number(timeoutMs) || 1);
  let activeOperations = 0;

  return async function runBoundedOperation(operation) {
    if (typeof operation !== 'function') throw new TypeError('operation must be a function');
    if (activeOperations >= concurrencyLimit) {
      const error = new Error(errorCode);
      error.code = errorCode;
      error.status = 503;
      throw error;
    }

    activeOperations += 1;
    const pending = Promise.resolve()
      .then(operation)
      .finally(() => {
        activeOperations = Math.max(0, activeOperations - 1);
      });
    let timeoutId = null;
    const timeout = new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => {
        const error = new Error(errorCode);
        error.code = errorCode;
        error.status = 503;
        reject(error);
      }, deadlineMs);
    });

    try {
      return await Promise.race([pending, timeout]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };
}
