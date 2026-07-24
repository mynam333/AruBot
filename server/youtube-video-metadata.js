import axios from 'axios';
import { extractYouTubeWatchDurationSec } from './video-donation-timing.js';

const YOUTUBE_VIDEO_METADATA_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const YOUTUBE_VIDEO_METADATA_FAILURE_CACHE_TTL_MS = 60 * 1000;
const YOUTUBE_VIDEO_METADATA_CACHE_MAX_ENTRIES = 1000;
const YOUTUBE_VIDEO_METADATA_TIMEOUT_MS = 5 * 1000;
const YOUTUBE_PLAYER_CONTEXT_LIMIT = 3;
const YOUTUBE_WEB_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const YOUTUBE_MOBILE_USER_AGENT = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const YOUTUBE_PAGE_HEADERS = Object.freeze({
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
  'User-Agent': YOUTUBE_WEB_USER_AGENT,
});

const metadataCache = new Map();
const metadataInFlight = new Map();

function normalizeVideoId(value) {
  const videoId = String(value || '').trim();
  return /^[A-Za-z0-9_-]{6,64}$/.test(videoId) ? videoId : null;
}

function normalizeDurationSec(value) {
  const durationSec = Number(value);
  return Number.isFinite(durationSec) && durationSec > 0 ? Math.ceil(durationSec) : null;
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

function decodePageValue(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function mergeMetadata(current, candidate) {
  return {
    title: current.title || normalizeTitle(candidate?.title),
    durationSec: current.durationSec ?? normalizeDurationSec(candidate?.durationSec),
  };
}

export function extractYouTubeWebPlayerContext(html) {
  const source = String(html || '');
  const apiKey = source.match(/["']INNERTUBE_API_KEY["']\s*:\s*["']([^"']+)["']/)?.[1] || '';
  const clientVersion = source.match(/["']INNERTUBE_CLIENT_VERSION["']\s*:\s*["']([^"']+)["']/)?.[1]
    || source.match(/["']clientVersion["']\s*:\s*["']([\d.]+)["']/)?.[1]
    || '';
  const visitorData = source.match(/["']VISITOR_DATA["']\s*:\s*["']([^"']+)["']/)?.[1]
    || source.match(/["']visitorData["']\s*:\s*["']([^"']+)["']/)?.[1]
    || '';
  return apiKey && clientVersion
    ? { apiKey, clientVersion, visitorData: decodePageValue(visitorData) }
    : null;
}

export function extractYouTubePlayerMetadata(data) {
  const source = data && typeof data === 'object' ? data : {};
  const rawDuration = source.videoDetails?.lengthSeconds
    ?? source.microformat?.playerMicroformatRenderer?.lengthSeconds;
  return {
    title: normalizeTitle(source.videoDetails?.title),
    durationSec: normalizeDurationSec(rawDuration),
    playabilityStatus: String(source.playabilityStatus?.status || '').trim() || null,
    playabilityReason: String(source.playabilityStatus?.reason || '').trim() || null,
  };
}

export function extractYouTubeVideoInfoMetadata(data) {
  if (data && typeof data === 'object') return extractYouTubePlayerMetadata(data);
  const params = new URLSearchParams(String(data || ''));
  let playerMetadata = { title: null, durationSec: null, playabilityStatus: null, playabilityReason: null };
  const playerResponse = params.get('player_response') || params.get('playerResponse');
  if (playerResponse) {
    try {
      playerMetadata = extractYouTubePlayerMetadata(JSON.parse(playerResponse));
    } catch { }
  }
  return {
    ...playerMetadata,
    title: playerMetadata.title || normalizeTitle(params.get('title')),
    durationSec: playerMetadata.durationSec ?? normalizeDurationSec(params.get('length_seconds')),
  };
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

function describeLookupError(source, error) {
  return {
    source,
    status: Number(error?.response?.status) || null,
    code: String(error?.code || '').trim() || null,
    message: String(error?.message || error || 'request_failed').slice(0, 300),
  };
}

function pageMetadata(html) {
  return {
    title: extractYouTubeWatchTitle(html),
    durationSec: extractYouTubeWatchDurationSec(html),
  };
}

function contextKey(context) {
  return `${context?.apiKey || ''}:${context?.clientVersion || ''}:${context?.visitorData || ''}`;
}

function collectContext(contexts, context, referer) {
  if (!context?.apiKey || !context?.clientVersion || contexts.length >= YOUTUBE_PLAYER_CONTEXT_LIMIT) return;
  const key = contextKey(context);
  if (contexts.some((entry) => entry.key === key)) return;
  contexts.push({ key, context, referer });
}

async function fetchYoutubePage(url, source, httpGet, attempts, headers = {}) {
  try {
    const response = await httpGet(url, {
      timeout: YOUTUBE_VIDEO_METADATA_TIMEOUT_MS,
      responseType: 'text',
      headers: { ...YOUTUBE_PAGE_HEADERS, ...headers },
    });
    const html = String(response?.data || '');
    attempts.push({
      source,
      status: Number(response?.status) || 200,
      responseBytes: html.length,
      hasPlayerContext: !!extractYouTubeWebPlayerContext(html),
      durationFound: extractYouTubeWatchDurationSec(html) != null,
    });
    return html;
  } catch (error) {
    attempts.push(describeLookupError(source, error));
    return '';
  }
}

function getPlayerProfiles(context, referer, videoId) {
  const embedUrl = /\/embed\//i.test(referer)
    ? referer
    : `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
  return [
    {
      source: 'player_web',
      clientName: 'WEB',
      clientId: '1',
      clientVersion: context.clientVersion,
      context: {},
    },
    {
      source: 'player_embedded',
      clientName: 'WEB_EMBEDDED_PLAYER',
      clientId: '56',
      clientVersion: context.clientVersion,
      context: {
        thirdParty: { embedUrl },
      },
      clientScreen: 'EMBED',
    },
  ];
}

async function fetchYoutubePlayerMetadata(videoId, context, referer, profile, httpPost, attempts) {
  if (!context?.apiKey || !profile?.clientVersion) return { title: null, durationSec: null };
  try {
    const client = {
      clientName: profile.clientName,
      clientVersion: profile.clientVersion,
      hl: 'ko',
      gl: 'KR',
      ...(profile.clientScreen ? { clientScreen: profile.clientScreen } : {}),
      ...(context.visitorData ? { visitorData: context.visitorData } : {}),
    };
    const response = await httpPost(
      `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(context.apiKey)}&prettyPrint=false`,
      {
        context: {
          client,
          ...profile.context,
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      },
      {
        timeout: YOUTUBE_VIDEO_METADATA_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://www.youtube.com',
          Referer: referer,
          'User-Agent': YOUTUBE_WEB_USER_AGENT,
          'X-YouTube-Client-Name': profile.clientId,
          'X-YouTube-Client-Version': profile.clientVersion,
          ...(context.visitorData ? { 'X-Goog-Visitor-Id': context.visitorData } : {}),
        },
      },
    );
    const metadata = extractYouTubePlayerMetadata(response?.data);
    attempts.push({
      source: profile.source,
      status: Number(response?.status) || 200,
      durationFound: metadata.durationSec != null,
      playabilityStatus: metadata.playabilityStatus,
      playabilityReason: metadata.playabilityReason,
    });
    return metadata;
  } catch (error) {
    attempts.push(describeLookupError(profile.source, error));
    return { title: null, durationSec: null };
  }
}

async function fetchPlayerMetadataWithProfiles(videoId, contextEntry, httpPost, attempts) {
  const profiles = getPlayerProfiles(contextEntry.context, contextEntry.referer, videoId);
  let metadata = { title: null, durationSec: null };
  for (const profile of profiles) {
    metadata = mergeMetadata(
      metadata,
      await fetchYoutubePlayerMetadata(
        videoId,
        contextEntry.context,
        contextEntry.referer,
        profile,
        httpPost,
        attempts,
      ),
    );
    if (metadata.durationSec != null) break;
  }
  return metadata;
}

async function fetchLegacyVideoInfo(videoId, httpGet, attempts) {
  const url = `https://www.youtube.com/get_video_info?video_id=${encodeURIComponent(videoId)}&el=embedded&hl=ko`;
  try {
    const response = await httpGet(url, {
      timeout: YOUTUBE_VIDEO_METADATA_TIMEOUT_MS,
      responseType: 'text',
      headers: YOUTUBE_PAGE_HEADERS,
    });
    const metadata = extractYouTubeVideoInfoMetadata(response?.data);
    attempts.push({
      source: 'video_info',
      status: Number(response?.status) || 200,
      durationFound: metadata.durationSec != null,
      playabilityStatus: metadata.playabilityStatus,
      playabilityReason: metadata.playabilityReason,
    });
    return metadata;
  } catch (error) {
    attempts.push(describeLookupError('video_info', error));
    return { title: null, durationSec: null };
  }
}

async function fetchOembedTitle(watchUrl, httpGet, attempts) {
  try {
    const response = await httpGet(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`, {
      timeout: YOUTUBE_VIDEO_METADATA_TIMEOUT_MS,
      headers: { 'Accept-Language': 'ko-KR,ko;q=0.9' },
    });
    const title = normalizeTitle(response?.data?.title);
    attempts.push({ source: 'oembed', status: Number(response?.status) || 200, titleFound: !!title });
    return title;
  } catch (error) {
    attempts.push(describeLookupError('oembed', error));
    return null;
  }
}

async function fetchUncachedYouTubeVideoMetadata(videoId, httpGet, httpPost, logger) {
  const encodedVideoId = encodeURIComponent(videoId);
  const watchUrl = `https://www.youtube.com/watch?v=${encodedVideoId}&hl=ko&gl=KR`;
  const embedUrl = `https://www.youtube.com/embed/${encodedVideoId}?hl=ko`;
  const noCookieEmbedUrl = `https://www.youtube-nocookie.com/embed/${encodedVideoId}?hl=ko`;
  const mobileWatchUrl = `https://m.youtube.com/watch?v=${encodedVideoId}&hl=ko&gl=KR`;
  const attempts = [];
  const contexts = [];
  const attemptedContextKeys = new Set();
  let metadata = { title: null, durationSec: null };

  const watchHtml = await fetchYoutubePage(watchUrl, 'watch', httpGet, attempts);
  metadata = mergeMetadata(metadata, pageMetadata(watchHtml));
  collectContext(contexts, extractYouTubeWebPlayerContext(watchHtml), watchUrl);

  if (metadata.durationSec == null && contexts[0]) {
    attemptedContextKeys.add(contexts[0].key);
    metadata = mergeMetadata(metadata, await fetchPlayerMetadataWithProfiles(videoId, contexts[0], httpPost, attempts));
  }

  if (metadata.durationSec == null) {
    const [embedHtml, noCookieHtml, mobileHtml, legacyMetadata] = await Promise.all([
      fetchYoutubePage(embedUrl, 'embed', httpGet, attempts),
      fetchYoutubePage(noCookieEmbedUrl, 'embed_nocookie', httpGet, attempts),
      fetchYoutubePage(mobileWatchUrl, 'watch_mobile', httpGet, attempts, { 'User-Agent': YOUTUBE_MOBILE_USER_AGENT }),
      fetchLegacyVideoInfo(videoId, httpGet, attempts),
    ]);

    for (const [html, referer] of [
      [embedHtml, embedUrl],
      [noCookieHtml, noCookieEmbedUrl],
      [mobileHtml, mobileWatchUrl],
    ]) {
      metadata = mergeMetadata(metadata, pageMetadata(html));
      collectContext(contexts, extractYouTubeWebPlayerContext(html), referer);
    }
    metadata = mergeMetadata(metadata, legacyMetadata);
  }

  if (metadata.durationSec == null) {
    for (const contextEntry of contexts) {
      if (attemptedContextKeys.has(contextEntry.key)) continue;
      attemptedContextKeys.add(contextEntry.key);
      metadata = mergeMetadata(
        metadata,
        await fetchPlayerMetadataWithProfiles(videoId, contextEntry, httpPost, attempts),
      );
      if (metadata.durationSec != null) break;
    }
  }

  if (!metadata.title) {
    metadata.title = await fetchOembedTitle(watchUrl, httpGet, attempts);
  }

  if (metadata.durationSec == null) {
    logger('[YouTube video metadata] Duration lookup failed', { videoId, attempts });
  }

  return {
    title: metadata.title || null,
    durationSec: normalizeDurationSec(metadata.durationSec),
  };
}

export async function fetchYouTubeVideoMetadata(videoId, options = {}) {
  const id = normalizeVideoId(videoId);
  if (!id) return { title: null, durationSec: null };

  const httpGet = typeof options.httpGet === 'function' ? options.httpGet : axios.get;
  const httpPost = typeof options.httpPost === 'function' ? options.httpPost : axios.post;
  const logger = typeof options.logger === 'function' ? options.logger : console.warn;
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

  const pending = fetchUncachedYouTubeVideoMetadata(id, httpGet, httpPost, logger)
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
