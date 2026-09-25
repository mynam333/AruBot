(function attachChzzkVideoMetadata(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.AruChzzkVideoMetadata = api;
})(typeof self !== 'undefined' ? self : this, function createChzzkVideoMetadata() {
  'use strict';

  const START_FIELDS = [
    'vStart',
    'startSecond',
    'startSec',
    'videoStartSecond',
    'playStartSecond',
    'beginSecond',
    'video_begin',
    'begin',
    'start'
  ];
  const END_FIELDS = [
    'vEnd',
    'endSecond',
    'endSec',
    'videoEndSecond',
    'playEndSecond',
    'finishSecond',
    'video_end',
    'end'
  ];
  const SECOND_DURATION_FIELDS = [
    'durationSec',
    'mediaDurationSec',
    'videoDurationSec',
    'playDurationSec',
    'playSec',
    'video_length',
    'videoLength',
    'vLength',
    'duration',
    'videoDuration',
    'playTime',
    'playDuration',
    'length',
    'seconds'
  ];
  const MILLISECOND_DURATION_FIELDS = [
    'durationMs',
    'durationMillis',
    'videoDurationMs',
    'playDurationMs',
    'approxDurationMs'
  ];

  function parseJson(raw) {
    if (typeof raw !== 'string') return raw;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function collectObjects(value, depth = 0, out = [], seen = new Set()) {
    if (!value || typeof value !== 'object' || depth > 7 || seen.has(value)) return out;
    seen.add(value);
    out.push(value);
    const values = Array.isArray(value) ? value : Object.values(value);
    for (const item of values) {
      if (typeof item === 'string' && /^[{[]/.test(item.trim())) {
        const parsed = parseJson(item);
        if (parsed) collectObjects(parsed, depth + 1, out, seen);
      } else {
        collectObjects(item, depth + 1, out, seen);
      }
    }
    return out;
  }

  function finiteNumber(value) {
    if (value == null || value === '' || typeof value === 'boolean') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function findNumber(object, fields) {
    for (const field of fields) {
      if (!object || !Object.prototype.hasOwnProperty.call(object, field)) continue;
      const value = finiteNumber(object[field]);
      if (value != null) return { field, value };
    }
    return null;
  }

  function extractPlaybackRange(payload) {
    for (const object of collectObjects(payload)) {
      const start = findNumber(object, START_FIELDS);
      const end = findNumber(object, END_FIELDS);
      if (!start && !end) continue;
      return {
        startSec: Math.max(0, start?.value || 0),
        endSec: end && end.value > 0 ? end.value : null
      };
    }
    return { startSec: 0, endSec: null };
  }

  function normalizeDurationValue(value, milliseconds = false) {
    const number = finiteNumber(value);
    if (number == null || number <= 0) return null;
    if (milliseconds) return Math.ceil(number / 1000);
    return Math.ceil(number);
  }

  function extractDurationSeconds(payload) {
    for (const object of collectObjects(payload)) {
      const milliseconds = findNumber(object, MILLISECOND_DURATION_FIELDS);
      if (milliseconds) return normalizeDurationValue(milliseconds.value, true);
      const seconds = findNumber(object, SECOND_DURATION_FIELDS);
      if (seconds) return normalizeDurationValue(seconds.value, false);
    }
    return null;
  }

  function durationForPlaybackRange(payload, mediaDurationSec) {
    const total = normalizeDurationValue(mediaDurationSec, false);
    if (!total) return null;
    const range = extractPlaybackRange(payload);
    const end = range.endSec != null ? Math.min(total, range.endSec) : total;
    const duration = end - range.startSec;
    return duration > 0 ? Math.ceil(duration) : null;
  }

  function parseIsoDuration(value) {
    const match = String(value || '').match(/^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
    if (!match) return null;
    const seconds = Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
    return seconds > 0 ? Math.ceil(seconds) : null;
  }

  function parseYouTubeDurationHtml(html) {
    const normalized = String(html || '').replace(/\\"/g, '"');
    if (!normalized) return null;
    const detailsAt = normalized.indexOf('"videoDetails"');
    const scopes = detailsAt >= 0
      ? [normalized.slice(detailsAt, detailsAt + 12000), normalized]
      : [normalized];
    for (const scope of scopes) {
      const lengthSeconds = scope.match(/"lengthSeconds"\s*:\s*"?(\d+(?:\.\d+)?)"?/i);
      if (lengthSeconds) return normalizeDurationValue(lengthSeconds[1], false);
      const approximate = scope.match(/"approxDurationMs"\s*:\s*"?(\d+(?:\.\d+)?)"?/i);
      if (approximate) return normalizeDurationValue(approximate[1], true);
    }
    const iso = normalized.match(/(?:itemprop=["']duration["'][^>]*content=|"duration"\s*:\s*)["'](PT[^"']+)["']/i);
    return iso ? parseIsoDuration(iso[1]) : null;
  }

  function parseYouTubeVideoId(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
    try {
      const url = new URL(text);
      if (/(^|\.)youtu\.be$/i.test(url.hostname)) {
        return url.pathname.split('/').filter(Boolean)[0] || '';
      }
      if (/(^|\.)youtube(?:-nocookie)?\.com$/i.test(url.hostname)) {
        if (url.pathname === '/watch') return url.searchParams.get('v') || '';
        const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{6,})/i);
        return match ? match[1] : '';
      }
    } catch {}
    return '';
  }

  function parseChzzkClipId(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const match = text.match(/chzzk\.naver\.com\/(?:embed\/clip|clips)\/([A-Za-z0-9_-]+)/i);
    return match ? match[1] : '';
  }

  function firstString(object, fields) {
    for (const field of fields) {
      const value = object?.[field];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }

  function extractDonationMedia(payload) {
    const candidates = collectObjects(payload);
    let type = '';
    let genericId = '';
    let clipId = '';
    let youtubeId = '';
    let sourceUrl = '';

    for (const object of candidates) {
      type ||= firstString(object, ['videoType', 'vType', 'mediaType', 'provider', 'videoProvider']).toUpperCase();
      clipId ||= firstString(object, ['clipUID', 'clipUid', 'clipId']);
      genericId ||= firstString(object, ['videoId', 'vId', 'mediaId']);
      const possibleUrl = firstString(object, ['donationVideoUrl', 'videoURL', 'videoUrl', 'mediaUrl', 'clipUrl', 'url']);
      if (!possibleUrl) continue;
      const parsedYoutubeId = parseYouTubeVideoId(possibleUrl);
      const parsedClipId = parseChzzkClipId(possibleUrl);
      if (parsedYoutubeId) {
        youtubeId ||= parsedYoutubeId;
        sourceUrl ||= possibleUrl;
      } else if (parsedClipId) {
        clipId ||= parsedClipId;
        sourceUrl ||= possibleUrl;
      }
    }

    const isYoutube = type.includes('YOUTUBE') || Boolean(youtubeId);
    const isChzzkClip = type.includes('CHZZK') || type.includes('NAVER') || type.includes('CLIP') || Boolean(clipId);
    if (isYoutube) {
      const id = youtubeId || parseYouTubeVideoId(genericId);
      if (!id) return null;
      return {
        kind: 'youtube',
        id,
        url: sourceUrl || `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`
      };
    }
    if (isChzzkClip) {
      const id = clipId || genericId;
      if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
      return {
        kind: 'chzzk_clip',
        id,
        url: sourceUrl || `https://chzzk.naver.com/clips/${encodeURIComponent(id)}`
      };
    }
    return null;
  }

  function extractChannelId(payload) {
    const value = payload?.channelId || payload?.channel?.channelId || payload?.live?.channelId;
    return typeof value === 'string' ? value.trim() : '';
  }

  return {
    durationForPlaybackRange,
    extractChannelId,
    extractDonationMedia,
    extractDurationSeconds,
    extractPlaybackRange,
    parseChzzkClipId,
    parseIsoDuration,
    parseYouTubeDurationHtml,
    parseYouTubeVideoId
  };
});
