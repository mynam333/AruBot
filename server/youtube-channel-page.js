const YOUTUBE_CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{20,}$/;

function decodeHtmlEntities(value) {
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (match, entity) => {
    const normalized = String(entity || '').toLowerCase();
    if (normalized.startsWith('#')) {
      const radix = normalized.startsWith('#x') ? 16 : 10;
      const offset = radix === 16 ? 2 : 1;
      const codePoint = Number.parseInt(normalized.slice(offset), radix);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' })[normalized] || match;
  });
}

function normalizeChannelId(value) {
  const channelId = String(value || '').trim();
  return YOUTUBE_CHANNEL_ID_RE.test(channelId) ? channelId : null;
}

function normalizeHandle(value) {
  const handle = decodeHtmlEntities(value).trim().replace(/^@/, '');
  return handle && !/[/?#\s]/.test(handle) ? handle : null;
}

function normalizeTitle(value) {
  const title = decodeHtmlEntities(value).replace(/\s*-\s*YouTube\s*$/i, '').trim();
  return title && !/^youtube$/i.test(title) ? title : null;
}

function parseTagAttributes(tag) {
  const attributes = {};
  const pattern = /([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
  let match;
  while ((match = pattern.exec(String(tag || '')))) {
    attributes[String(match[1] || '').toLowerCase()] = decodeHtmlEntities(match[3]);
  }
  return attributes;
}

function findMetaContent(source, keys) {
  const accepted = new Set(keys.map((key) => String(key).toLowerCase()));
  for (const tag of source.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = parseTagAttributes(tag);
    const key = String(attributes.property || attributes.name || attributes.itemprop || '').toLowerCase();
    if (accepted.has(key) && attributes.content) return attributes.content;
  }
  return null;
}

function findCanonicalUrl(source) {
  for (const tag of source.match(/<link\b[^>]*>/gi) || []) {
    const attributes = parseTagAttributes(tag);
    if (String(attributes.rel || '').toLowerCase() === 'canonical' && attributes.href) return attributes.href;
  }
  return null;
}

function parseBoundedJsonObject(source, startIndex, maxLength = 100_000) {
  if (source[startIndex] !== '{') return null;
  const limit = Math.min(source.length, startIndex + maxLength);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = startIndex; index < limit; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(startIndex, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function findChannelMetadataRenderer(source) {
  const key = '"channelMetadataRenderer"';
  let searchFrom = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const keyIndex = source.indexOf(key, searchFrom);
    if (keyIndex < 0) break;
    searchFrom = keyIndex + key.length;
    let valueIndex = searchFrom;
    while (/\s/.test(source[valueIndex] || '')) valueIndex += 1;
    if (source[valueIndex] !== ':') continue;
    valueIndex += 1;
    while (/\s/.test(source[valueIndex] || '')) valueIndex += 1;
    const renderer = parseBoundedJsonObject(source, valueIndex);
    if (renderer) return renderer;
  }
  return null;
}

function channelIdFromUrl(value) {
  try {
    const url = new URL(decodeHtmlEntities(value));
    if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return null;
    return normalizeChannelId(url.pathname.match(/\/channel\/(UC[A-Za-z0-9_-]{20,})/i)?.[1]);
  } catch {
    return null;
  }
}

function handleFromUrl(value) {
  try {
    const url = new URL(decodeHtmlEntities(value));
    if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return null;
    return normalizeHandle(url.pathname.match(/\/@([^/?#]+)/)?.[1]);
  } catch {
    return null;
  }
}

export function extractYoutubeChannelPageMetadata(html, options = {}) {
  const source = String(html || '');
  const renderer = findChannelMetadataRenderer(source) || {};
  const canonicalUrl = findCanonicalUrl(source);
  const channelId = normalizeChannelId(findMetaContent(source, ['channelId']))
    || normalizeChannelId(renderer.externalId)
    || channelIdFromUrl(canonicalUrl)
    || null;
  const vanityUrl = renderer.vanityChannelUrl || renderer.channelUrl || canonicalUrl;
  const handle = handleFromUrl(vanityUrl) || normalizeHandle(options.fallbackHandle) || null;
  const title = normalizeTitle(findMetaContent(source, ['og:title', 'title']))
    || normalizeTitle(renderer.title)
    || normalizeTitle(source.match(/<title>([\s\S]*?)<\/title>/i)?.[1]);
  const thumbnailUrl = findMetaContent(source, ['og:image']) || null;
  return { channelId, handle, title, thumbnailUrl, canonicalUrl };
}

export function isYoutubeChannelId(value) {
  return normalizeChannelId(value) != null;
}
