import axios from 'axios';
import { extractYouTubeWatchDurationSec } from './video-donation-timing.js';

const YOUTUBE_VIDEO_METADATA_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const YOUTUBE_VIDEO_METADATA_FAILURE_CACHE_TTL_MS = 30 * 1000;
const YOUTUBE_VIDEO_METADATA_CACHE_MAX_ENTRIES = 1000;
const YOUTUBE_WEB_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const metadataCache = new Map();
const metadataInFlight = new Map();

function normalizeVideoId(value) {
  const videoId = String(value || '').trim();
  return /^[A-Za-z0-9_-]{6,64}$/.test(videoId) ? videoId : null;
}

function decodeHtmlEntities(value) {
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (match, entity) => {
    const normalized = String(entity || '').toLowerCase();
    if (normalized.startsWith('#')) {
      const codePoint = Number.parseInt(normalized.slice(normalized.startsWith('#x') ? 2 : 1), normalized.startsWith('#x') ? 16 : 10);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' })[normalized] || match;
  });
}

function normalizeTitle(value) {
  const title = decodeHtmlEntities(value).replace(/\s*-\s*YouTube\s*$/i, '').trim();
  return title && !/^youtube$/i.test(title) ? title : null;
}

export function extractYouTubeWatchTitle(html) {
  const source = String(html || '');
  const metaTags = source.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const key = tag.match(/\b(?:name|property)=["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (key !== 'og:title' && key !== 'title') continue;
    const content = tag.match(/\bcontent=["']([^"']*)["']/i)?.[1];
    const title = normalizeTitle(content);
    if (title) return title;
  }

  const documentTitle = source.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
  return normalizeTitle(documentTitle);
}

function readCachedMetadata(videoId, now) {
  const entry = metadataCache.get(videoId);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    metadataCache.delete(videoId);
    return null;
  }
  metadataCache.delete(videoId);
  metadataCache.set(videoId, entry);
  return entry.value;
}

function cacheMetadata(videoId, value, ttlMs, now) {
  while (metadataCache.size >= YOUTUBE_VIDEO_METADATA_CACHE_MAX_ENTRIES) {
    const oldestKey = metadataCache.keys().next().value;
    if (oldestKey === undefined) break;
    metadataCache.delete(oldestKey);
  }
  metadataCache.set(videoId, { value, expiresAt: now + ttlMs });
}

async function fetchUncachedYouTubeVideoMetadata(videoId, httpGet) {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=ko&gl=KR`;
  let title = null;
  let durationSec = null;

  try {
    const response = await httpGet(watchUrl, {
      timeout: 7000,
      responseType: 'text',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'User-Agent': YOUTUBE_WEB_USER_AGENT,
      },
    });
    const html = String(response?.data || '');
    title = extractYouTubeWatchTitle(html);
    durationSec = extractYouTubeWatchDurationSec(html);
  } catch { }

  if (!title) {
    try {
      const response = await httpGet(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`, {
        timeout: 7000,
        headers: { 'Accept-Language': 'ko-KR,ko;q=0.9' },
      });
      title = String(response?.data?.title || '').trim() || null;
    } catch { }
  }

  return {
    title: title || null,
    durationSec: Number.isFinite(Number(durationSec)) && Number(durationSec) > 0 ? Number(durationSec) : null,
  };
}

export async function fetchYouTubeVideoMetadata(videoId, options = {}) {
  const id = normalizeVideoId(videoId);
  if (!id) return { title: null, durationSec: null };

  const httpGet = typeof options.httpGet === 'function' ? options.httpGet : axios.get;
  const cacheTtlMs = Math.max(0, Number(options.cacheTtlMs ?? YOUTUBE_VIDEO_METADATA_CACHE_TTL_MS));
  const failureCacheTtlMs = Math.max(0, Number(options.failureCacheTtlMs ?? YOUTUBE_VIDEO_METADATA_FAILURE_CACHE_TTL_MS));
  const useCache = cacheTtlMs > 0 || failureCacheTtlMs > 0;
  const now = Date.now();

  if (useCache) {
    const cached = readCachedMetadata(id, now);
    if (cached) return cached;
    const pending = metadataInFlight.get(id);
    if (pending) return pending;
  }

  const pending = fetchUncachedYouTubeVideoMetadata(id, httpGet)
    .then((value) => {
      const ttlMs = value.durationSec != null ? cacheTtlMs : failureCacheTtlMs;
      if (ttlMs > 0) cacheMetadata(id, value, ttlMs, Date.now());
      return value;
    })
    .finally(() => {
      if (metadataInFlight.get(id) === pending) metadataInFlight.delete(id);
    });

  if (useCache) metadataInFlight.set(id, pending);
  return pending;
}
