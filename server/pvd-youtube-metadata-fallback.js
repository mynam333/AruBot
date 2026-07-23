const DEFAULT_METADATA_WAIT_MS = 8_500;

function normalizeDurationSec(value) {
  const durationSec = Number(value);
  return Number.isFinite(durationSec) && durationSec > 0 ? Math.ceil(durationSec) : null;
}

function normalizeMetadata(value) {
  return {
    title: String(value?.title || '').trim() || null,
    durationSec: normalizeDurationSec(value?.durationSec),
  };
}

export async function resolvePvdYouTubeMetadata(options = {}) {
  const fetchServerMetadata = options.fetchServerMetadata;
  const fetchViewerDuration = options.fetchViewerDuration;
  if (typeof fetchServerMetadata !== 'function') return { title: null, durationSec: null };
  if (typeof fetchViewerDuration !== 'function') {
    return normalizeMetadata(await Promise.resolve().then(fetchServerMetadata).catch(() => null));
  }

  const timeoutMs = Math.max(500, Number(options.timeoutMs || DEFAULT_METADATA_WAIT_MS));
  const scheduleTimeout = typeof options.scheduleTimeout === 'function' ? options.scheduleTimeout : setTimeout;
  const cancelTimeout = typeof options.cancelTimeout === 'function' ? options.cancelTimeout : clearTimeout;
  let timeoutHandle = null;
  let latestServerMetadata = { title: null, durationSec: null };

  const serverMetadataPromise = Promise.resolve()
    .then(fetchServerMetadata)
    .then((value) => {
      latestServerMetadata = normalizeMetadata(value);
      return latestServerMetadata;
    })
    .catch(() => latestServerMetadata);
  const boundedServerMetadataPromise = Promise.race([
    serverMetadataPromise,
    new Promise((resolve) => {
      timeoutHandle = scheduleTimeout(() => resolve(latestServerMetadata), timeoutMs);
      timeoutHandle?.unref?.();
    }),
  ]);
  const viewerDurationPromise = Promise.resolve()
    .then(fetchViewerDuration)
    .then(normalizeDurationSec)
    .catch(() => null);

  try {
    return await Promise.race([
      boundedServerMetadataPromise.then((metadata) => {
        if (metadata.durationSec != null) return metadata;
        return viewerDurationPromise.then((durationSec) => ({ ...metadata, durationSec }));
      }),
      viewerDurationPromise.then((durationSec) => {
        if (durationSec != null) return { ...latestServerMetadata, durationSec };
        return boundedServerMetadataPromise;
      }),
    ]);
  } finally {
    if (timeoutHandle) cancelTimeout(timeoutHandle);
  }
}
