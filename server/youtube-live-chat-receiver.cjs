const axios = require('axios');
const youtubeChatParser = require('youtube-chat/dist/parser');
const youtubeChatRequests = require('youtube-chat/dist/requests');

const RECEIVER_PAGE_HEADERS = Object.freeze({
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
});
const RECEIVER_PAGE_TIMEOUT_MS = 15000;
const RECEIVER_CHAT_TIMEOUT_MS = 15000;
const RECEIVER_TRANSIENT_RETRY_ATTEMPTS = 3;
const RECEIVER_TRANSIENT_RETRY_BASE_MS = 750;
const RECEIVER_TRANSIENT_RETRY_MAX_MS = 5000;
const RECEIVER_TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RECEIVER_TRANSIENT_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
]);

function receiverErrorStatus(error) {
  return Number(error?.response?.status || error?.status || 0);
}

function isTransientReceiverRequestError(error) {
  const status = receiverErrorStatus(error);
  const code = String(error?.code || '').trim().toUpperCase();
  const message = String(error?.message || error || '');
  return RECEIVER_TRANSIENT_STATUSES.has(status)
    || RECEIVER_TRANSIENT_CODES.has(code)
    || /\bstatus code (?:408|425|429|500|502|503|504)\b/i.test(message);
}

function receiverRetryAfterMs(error) {
  const headers = error?.response?.headers;
  const value = headers?.get?.('retry-after') ?? headers?.['retry-after'] ?? headers?.['Retry-After'];
  const text = String(Array.isArray(value) ? value[0] : value ?? '').trim();
  if (!text) return null;
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null;
}

function receiverTransientRetryDelay(error, failedAttempt, options = {}) {
  const baseDelayMs = Math.max(0, Number(options.baseDelayMs ?? RECEIVER_TRANSIENT_RETRY_BASE_MS));
  const maxDelayMs = Math.max(baseDelayMs, Number(options.maxDelayMs ?? RECEIVER_TRANSIENT_RETRY_MAX_MS));
  const retryAfterMs = receiverRetryAfterMs(error);
  if (retryAfterMs != null) return retryAfterMs <= maxDelayMs ? retryAfterMs : null;
  return Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, failedAttempt - 1)));
}

function waitForReceiverRetry(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function requestWithTransientRetry(request, options = {}) {
  if (typeof request !== 'function') throw new TypeError('request must be a function');
  const maxAttempts = Math.max(
    1,
    Math.min(5, Math.floor(Number(options.maxAttempts ?? RECEIVER_TRANSIENT_RETRY_ATTEMPTS))),
  );
  const wait = typeof options.wait === 'function' ? options.wait : waitForReceiverRetry;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await request(attempt);
    } catch (error) {
      if (attempt >= maxAttempts || !isTransientReceiverRequestError(error)) throw error;
      const delayMs = receiverTransientRetryDelay(error, attempt, options);
      if (delayMs == null) throw error;
      await wait(delayMs);
    }
  }
  throw new Error('Transient request retry exhausted');
}

function youtubePageValue(data, pattern, errorMessage) {
  const match = String(data || '').match(pattern);
  if (!match?.[1]) throw new Error(errorMessage);
  return match[1];
}

function optionalYoutubePageValue(data, pattern) {
  return String(data || '').match(pattern)?.[1] || '';
}

function parseAssignedJsonObject(data, assignment) {
  const source = String(data || '');
  const assignmentIndex = source.indexOf(assignment);
  if (assignmentIndex < 0) throw new Error('Live chat page data was not found');
  const objectStart = source.indexOf('{', assignmentIndex + assignment.length);
  if (objectStart < 0) throw new Error('Live chat page data was not found');

  let depth = 0;
  let escaped = false;
  let inString = false;
  for (let index = objectStart; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') depth += 1;
    if (character !== '}') continue;
    depth -= 1;
    if (depth === 0) return JSON.parse(source.slice(objectStart, index + 1));
  }
  throw new Error('Live chat page data was incomplete');
}

function parseYoutubeInitialData(data) {
  const assignments = [
    'window["ytInitialData"]',
    'var ytInitialData =',
    'ytInitialData =',
  ];
  for (const assignment of assignments) {
    try {
      return parseAssignedJsonObject(data, assignment);
    } catch (error) {
      if (!String(error?.message || error).includes('was not found')) throw error;
    }
  }
  throw new Error('YouTube initial page data was not found');
}

function hasLiveBadge(value) {
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== 'object') continue;
    const style = String(
      current.style
      || current.badgeStyle
      || current.metadataBadgeRenderer?.style
      || current.thumbnailOverlayTimeStatusRenderer?.style
      || current.thumbnailBadgeViewModel?.badgeStyle
      || '',
    ).toUpperCase();
    if (style === 'LIVE' || style === 'BADGE_STYLE_TYPE_LIVE_NOW' || style === 'THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE') {
      return true;
    }
    for (const child of Object.values(current)) {
      if (child && typeof child === 'object') pending.push(child);
    }
  }
  return false;
}

function liveVideoIdFromRenderer(renderer) {
  if (!renderer || typeof renderer !== 'object') return '';
  const indicators = [renderer.badges, renderer.thumbnailOverlays];
  if (!indicators.some(hasLiveBadge)) return '';
  return String(renderer.videoId || '').trim();
}

function liveVideoIdFromLockup(model) {
  if (!model || typeof model !== 'object') return '';
  const overlays = model.contentImage?.thumbnailViewModel?.overlays;
  if (!hasLiveBadge(overlays)) return '';
  return String(
    model.contentId
    || model.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.videoId
    || '',
  ).trim();
}

function liveIdsFromChannelPage(data) {
  let initialData = null;
  try {
    initialData = parseYoutubeInitialData(data);
  } catch {
    return [];
  }

  const liveIds = [];
  const seen = new Set();
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    const candidate = liveVideoIdFromRenderer(value.videoRenderer)
      || liveVideoIdFromLockup(value.lockupViewModel);
    if (candidate && !seen.has(candidate)) {
      seen.add(candidate);
      liveIds.push(candidate);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(initialData);
  return liveIds;
}

function continuationFromRenderer(renderer) {
  for (const item of Array.isArray(renderer?.continuations) ? renderer.continuations : []) {
    const continuation = item?.invalidationContinuationData?.continuation
      || item?.timedContinuationData?.continuation
      || item?.reloadContinuationData?.continuation;
    if (continuation) return continuation;
  }
  return '';
}

function liveChatPageMessage(initialData) {
  const runs = initialData?.contents?.messageRenderer?.text?.runs;
  return (Array.isArray(runs) ? runs : []).map((run) => String(run?.text || '')).join('').trim();
}

function liveIdFromPage(data) {
  const source = String(data || '');
  const canonical = source.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([^"&]+)[^"]*">/);
  return canonical?.[1] || '';
}

function getOptionsFromLivePageCompat(data, knownLiveId = '') {
  const source = String(data || '');
  if (/["']isReplay["']:\s*true/.test(source)) throw new Error('Live stream is already finished');

  const initialData = parseYoutubeInitialData(source);
  const renderer = initialData?.contents?.liveChatRenderer;
  if (!renderer) {
    const message = liveChatPageMessage(initialData);
    throw new Error(message || 'Live chat is not available');
  }

  const liveId = String(knownLiveId || liveIdFromPage(source)).trim();
  if (!liveId) throw new Error('Live Stream was not found');
  const apiKey = youtubePageValue(
    source,
    /["']INNERTUBE_API_KEY["']:\s*["']([^"']+)["']/,
    'API Key was not found',
  );
  const clientVersion = youtubePageValue(
    source,
    /["']clientVersion["']:\s*["']([\d.]+)["']/,
    'Client Version was not found',
  );
  const continuation = continuationFromRenderer(renderer);
  if (!continuation) throw new Error('Live chat continuation was not found');
  const visitorData = optionalYoutubePageValue(source, /["']visitorData["']:\s*["']([^"']+)["']/)
    || optionalYoutubePageValue(source, /["']VISITOR_DATA["']:\s*["']([^"']+)["']/);
  return {
    liveId,
    apiKey,
    clientVersion,
    continuation,
    ...(visitorData ? { visitorData } : {}),
  };
}

function receiverLookupUrl(id) {
  if (id && typeof id === 'object' && id.channelId) {
    return `https://www.youtube.com/channel/${encodeURIComponent(String(id.channelId))}/live`;
  }
  if (id && typeof id === 'object' && id.handle) {
    const handle = String(id.handle).replace(/^@/, '');
    return `https://www.youtube.com/@${encodeURIComponent(handle)}/live`;
  }
  return '';
}

async function resolveReceiverLiveId(id) {
  const liveId = id && typeof id === 'object' ? String(id.liveId || '').trim() : '';
  if (liveId) return liveId;

  const lookupUrl = receiverLookupUrl(id);
  if (!lookupUrl) throw new TypeError('Required channelId or liveId or handle.');
  const response = await requestWithTransientRetry(() => axios.get(lookupUrl, {
    headers: RECEIVER_PAGE_HEADERS,
    timeout: RECEIVER_PAGE_TIMEOUT_MS,
  }));
  const resolvedUrl = String(response?.request?.res?.responseUrl || '');
  const redirectedLiveId = resolvedUrl ? new URL(resolvedUrl).searchParams.get('v') : '';
  const channelPageLiveIds = liveIdsFromChannelPage(response.data);
  const resolvedLiveId = redirectedLiveId || liveIdFromPage(response.data) || channelPageLiveIds[0];
  if (!resolvedLiveId) throw new Error('Live Stream was not found');
  return resolvedLiveId;
}

async function fetchLivePageCompat(id) {
  const liveId = await resolveReceiverLiveId(id);
  const response = await requestWithTransientRetry(() => axios.get('https://www.youtube.com/live_chat', {
    headers: RECEIVER_PAGE_HEADERS,
    params: { v: liveId, is_popout: '1', hl: 'en', gl: 'US' },
    timeout: RECEIVER_PAGE_TIMEOUT_MS,
  }));
  return getOptionsFromLivePageCompat(response.data, liveId);
}

function buildYoutubeChatRequest(options = {}) {
  const clientVersion = String(options.clientVersion || '').trim();
  const visitorData = String(options.visitorData || '').trim();
  const liveId = String(options.liveId || '').trim();
  return {
    body: {
      context: {
        client: {
          clientName: 'WEB',
          clientVersion,
          hl: 'en',
          gl: 'US',
          userAgent: RECEIVER_PAGE_HEADERS['User-Agent'],
          ...(visitorData ? { visitorData } : {}),
        },
      },
      continuation: options.continuation,
    },
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://www.youtube.com',
      Referer: `https://www.youtube.com/live_chat?v=${encodeURIComponent(liveId)}&is_popout=1`,
      'User-Agent': RECEIVER_PAGE_HEADERS['User-Agent'],
      'X-Youtube-Bootstrap-Logged-In': 'false',
      'X-Youtube-Client-Name': '1',
      'X-Youtube-Client-Version': clientVersion,
      ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
    },
  };
}

async function fetchChatCompat(options = {}) {
  let retriedWithFreshPage = false;
  while (true) {
    const request = buildYoutubeChatRequest(options);
    try {
      const response = await requestWithTransientRetry(() => axios.post(
        `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${encodeURIComponent(String(options.apiKey || ''))}&prettyPrint=false`,
        request.body,
        { headers: request.headers, timeout: RECEIVER_CHAT_TIMEOUT_MS },
      ));
      return youtubeChatParser.parseChatData(response.data);
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      if (status !== 403 || retriedWithFreshPage || !options.liveId) throw error;
      retriedWithFreshPage = true;
      Object.assign(options, await fetchLivePageCompat({ liveId: options.liveId }));
    }
  }
}

youtubeChatParser.getOptionsFromLivePage = getOptionsFromLivePageCompat;
youtubeChatRequests.fetchLivePage = fetchLivePageCompat;
youtubeChatRequests.fetchChat = fetchChatCompat;

const { LiveChat } = require('youtube-chat');

function normalizeReceiverInterval(intervalMs) {
  const value = Number(intervalMs);
  return Number.isFinite(value) ? Math.max(1000, Math.floor(value)) : 5000;
}

function createYoutubeLiveChatReceiver({ broadcastId, channelId, intervalMs } = {}) {
  const liveId = String(broadcastId || '').trim();
  const ownerChannelId = String(channelId || '').trim();
  if (!liveId && !ownerChannelId) throw new Error('broadcastId or channelId is required');
  return new LiveChat(liveId ? { liveId } : { channelId: ownerChannelId }, normalizeReceiverInterval(intervalMs));
}

function receiverMessageText(messageItems) {
  return (Array.isArray(messageItems) ? messageItems : [])
    .map((item) => {
      if (typeof item?.text === 'string') return item.text;
      if (typeof item?.emojiText === 'string') return item.emojiText;
      if (typeof item?.alt === 'string') return item.alt;
      return '';
    })
    .join('');
}

function receiverCurrency(amountText) {
  const value = String(amountText || '').trim();
  if (/(?:KRW|\u20a9|\uc6d0)/i.test(value)) return 'KRW';
  if (/(?:USD|US\$|\$)/i.test(value)) return 'USD';
  if (/(?:EUR|\u20ac)/i.test(value)) return 'EUR';
  if (/(?:JPY|JP\u00a5|\u00a5|\u5186)/i.test(value)) return 'JPY';
  return 'UNKNOWN';
}

function receiverAmountMicros(amountText, currency) {
  if (currency !== 'KRW') return 0;
  const won = Number(String(amountText || '').replace(/[^0-9]/g, ''));
  return Number.isFinite(won) && won > 0 ? Math.floor(won * 1000000) : 0;
}

function toYoutubeLiveChatItem(chatItem = {}) {
  const publishedAt = new Date(chatItem.timestamp || Date.now());
  const safePublishedAt = Number.isFinite(publishedAt.getTime()) ? publishedAt.toISOString() : new Date().toISOString();
  const displayMessage = receiverMessageText(chatItem.message);
  const authorDetails = {
    channelId: String(chatItem.author?.channelId || ''),
    displayName: String(chatItem.author?.name || 'Unknown'),
    profileImageUrl: chatItem.author?.thumbnail?.url || null,
    isVerified: chatItem.isVerified === true,
    isChatOwner: chatItem.isOwner === true,
    isChatSponsor: chatItem.isMembership === true,
    isChatModerator: chatItem.isModerator === true,
  };
  const snippet = {
    type: 'textMessageEvent',
    publishedAt: safePublishedAt,
    displayMessage,
    authorChannelId: authorDetails.channelId,
    textMessageDetails: { messageText: displayMessage },
  };

  if (chatItem.superchat?.sticker) {
    snippet.type = 'superStickerEvent';
    snippet.superStickerDetails = {
      amountDisplayString: String(chatItem.superchat.amount || ''),
      superStickerMetadata: {
        altText: String(chatItem.superchat.sticker.alt || ''),
        stickerId: String(chatItem.superchat.sticker.url || ''),
      },
    };
  } else if (chatItem.superchat) {
    const amountDisplayString = String(chatItem.superchat.amount || '');
    const currency = receiverCurrency(amountDisplayString);
    snippet.type = 'superChatEvent';
    snippet.superChatDetails = {
      amountDisplayString,
      amountMicros: receiverAmountMicros(amountDisplayString, currency),
      currency,
      userComment: displayMessage,
    };
  }

  return {
    id: String(chatItem.id || `${authorDetails.channelId || 'chat'}:${safePublishedAt}:${displayMessage.slice(0, 80)}`),
    snippet,
    authorDetails,
    receiverRaw: chatItem,
  };
}

module.exports = {
  buildYoutubeChatRequest,
  createYoutubeLiveChatReceiver,
  fetchChatCompat,
  fetchLivePageCompat,
  getOptionsFromLivePageCompat,
  liveIdsFromChannelPage,
  isTransientReceiverRequestError,
  requestWithTransientRetry,
  receiverMessageText,
  toYoutubeLiveChatItem,
};
