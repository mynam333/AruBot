const axios = require('axios');
const youtubeChatParser = require('youtube-chat/dist/parser');
const youtubeChatRequests = require('youtube-chat/dist/requests');

const RECEIVER_PAGE_HEADERS = Object.freeze({
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
});
const RECEIVER_PAGE_TIMEOUT_MS = 15000;

function youtubePageValue(data, pattern, errorMessage) {
  const match = String(data || '').match(pattern);
  if (!match?.[1]) throw new Error(errorMessage);
  return match[1];
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

  const initialData = parseAssignedJsonObject(source, 'window["ytInitialData"]');
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
  return { liveId, apiKey, clientVersion, continuation };
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
  const response = await axios.get(lookupUrl, {
    headers: RECEIVER_PAGE_HEADERS,
    timeout: RECEIVER_PAGE_TIMEOUT_MS,
  });
  const resolvedUrl = String(response?.request?.res?.responseUrl || '');
  const redirectedLiveId = resolvedUrl ? new URL(resolvedUrl).searchParams.get('v') : '';
  const resolvedLiveId = redirectedLiveId || liveIdFromPage(response.data);
  if (!resolvedLiveId) throw new Error('Live Stream was not found');
  return resolvedLiveId;
}

async function fetchLivePageCompat(id) {
  const liveId = await resolveReceiverLiveId(id);
  const response = await axios.get('https://www.youtube.com/live_chat', {
    headers: RECEIVER_PAGE_HEADERS,
    params: { v: liveId, is_popout: '1', hl: 'en', gl: 'US' },
    timeout: RECEIVER_PAGE_TIMEOUT_MS,
  });
  return getOptionsFromLivePageCompat(response.data, liveId);
}

youtubeChatParser.getOptionsFromLivePage = getOptionsFromLivePageCompat;
youtubeChatRequests.fetchLivePage = fetchLivePageCompat;

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
  createYoutubeLiveChatReceiver,
  fetchLivePageCompat,
  getOptionsFromLivePageCompat,
  receiverMessageText,
  toYoutubeLiveChatItem,
};
