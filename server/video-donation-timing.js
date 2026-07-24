function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function parseNonNegativeSecond(value) {
  const normalized = String(value ?? '').trim();
  const minuteSecond = normalized.match(/^(\d+):([0-5]?\d)$/);
  if (minuteSecond) {
    const minutes = Number(minuteSecond[1]);
    const seconds = Number(minuteSecond[2]);
    const parsed = minutes * 60 + seconds;
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function parseIso8601Duration(value) {
  const match = String(value || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return null;
  const seconds = Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
  return seconds > 0 ? seconds : null;
}

export function resolveVideoDonationTiming({
  startSec,
  endSec,
  legacyPlaySec,
  mediaDurationSec,
  maxDurationSec = 600,
} = {}) {
  const startProvided = hasValue(startSec);
  const parsedStart = startProvided ? parseNonNegativeSecond(startSec) : 0;
  if (parsedStart == null) {
    return {
      ok: false,
      code: 'invalid_start_sec',
      message: '시작초는 0 이상의 숫자 또는 분:초 형식이어야 합니다.',
    };
  }

  const endProvided = hasValue(endSec);
  const parsedEnd = endProvided ? parseNonNegativeSecond(endSec) : null;
  if (endProvided && parsedEnd == null) {
    return {
      ok: false,
      code: 'invalid_end_sec',
      message: '종료초는 0 이상의 숫자 또는 분:초 형식이어야 합니다.',
    };
  }
  if (parsedEnd != null && parsedEnd <= parsedStart) {
    return {
      ok: false,
      code: 'end_not_after_start',
      message: '종료초는 시작초보다 커야 합니다.',
    };
  }

  const rawMediaDuration = Number(mediaDurationSec);
  const mediaEndSec = Number.isFinite(rawMediaDuration) && rawMediaDuration > 0
    ? Math.ceil(rawMediaDuration)
    : null;
  if (mediaEndSec != null && parsedStart >= mediaEndSec) {
    return {
      ok: false,
      code: 'start_after_media_end',
      message: '시작초는 영상의 마지막 초보다 작아야 합니다.',
    };
  }

  const rawLegacyPlay = Number(legacyPlaySec);
  const requestedPlaySec = !endProvided && Number.isFinite(rawLegacyPlay) && rawLegacyPlay > 0
    ? Math.max(1, Math.floor(rawLegacyPlay))
    : null;
  const requestedEndSec = parsedEnd;
  const requestedDurationSec = requestedEndSec != null
    ? requestedEndSec - parsedStart
    : requestedPlaySec != null
      ? requestedPlaySec
      : mediaEndSec != null
        ? mediaEndSec - parsedStart
        : null;
  const maxDuration = Math.max(1, Math.floor(Number(maxDurationSec) || 600));

  if (requestedDurationSec == null) {
    return {
      ok: true,
      startSec: parsedStart,
      requestedEndSec: null,
      requestedPlaySec: null,
      durationSec: null,
      actualEndSec: null,
      mediaEndSec,
      needsMediaDuration: true,
    };
  }

  const remainingMediaSec = mediaEndSec != null ? mediaEndSec - parsedStart : Number.POSITIVE_INFINITY;
  const durationSec = Math.max(1, Math.min(maxDuration, requestedDurationSec, remainingMediaSec));
  return {
    ok: true,
    startSec: parsedStart,
    requestedEndSec,
    requestedPlaySec,
    durationSec,
    actualEndSec: parsedStart + durationSec,
    mediaEndSec,
    needsMediaDuration: false,
  };
}

export function extractYouTubeWatchDurationSec(html) {
  const normalized = String(html || '')
    .replace(/&quot;/gi, '"')
    .replace(/\\"/g, '"');
  const videoDetails = normalized.match(/"videoDetails"\s*:\s*\{[\s\S]{0,8000}?"lengthSeconds"\s*:\s*"?(\d+)"?/i);
  if (videoDetails?.[1]) return Number(videoDetails[1]);

  const lengthSeconds = normalized.match(/"lengthSeconds"\s*:\s*"?(\d+)"?/i);
  if (lengthSeconds?.[1]) return Number(lengthSeconds[1]);

  const approximateMs = normalized.match(/"approxDurationMs"\s*:\s*"?(\d+)"?/i);
  if (approximateMs?.[1]) return Math.max(1, Math.ceil(Number(approximateMs[1]) / 1000));

  const durationSeconds = normalized.match(/"(?:durationSeconds|duration_seconds)"\s*:\s*"?(\d+)"?/i);
  if (durationSeconds?.[1]) return Number(durationSeconds[1]);

  const durationMs = normalized.match(/"(?:durationMs|duration_ms)"\s*:\s*"?(\d+)"?/i);
  if (durationMs?.[1]) return Math.max(1, Math.ceil(Number(durationMs[1]) / 1000));

  const metaDurationSeconds = normalized.match(/(?:property|name)=["'](?:og:video:duration|video:duration)["'][^>]*content=["'](\d+)["']/i)
    || normalized.match(/content=["'](\d+)["'][^>]*(?:property|name)=["'](?:og:video:duration|video:duration)["']/i);
  if (metaDurationSeconds?.[1]) return Number(metaDurationSeconds[1]);

  const isoDuration = normalized.match(/itemprop=["']duration["'][^>]*content=["'](PT[^"']+)["']/i)
    || normalized.match(/content=["'](PT[^"']+)["'][^>]*itemprop=["']duration["']/i)
    || normalized.match(/["']duration["']\s*:\s*["'](PT[^"']+)["']/i);
  return isoDuration?.[1] ? parseIso8601Duration(isoDuration[1]) : null;
}
