function invalidResponse(message = 'CHZZK returned an incomplete response') {
  const error = new Error(message);
  error.code = 'chzzk_invalid_response';
  return error;
}

export function unwrapChzzkContent(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalidResponse();
  if (payload.code != null && Number(payload.code) !== 200) {
    const error = new Error(`CHZZK API request failed (${String(payload.code)})`);
    error.code = 'chzzk_api_error';
    error.status = Number(payload.code) || null;
    throw error;
  }
  const content = Object.hasOwn(payload, 'content') ? payload.content : payload;
  if (!content || typeof content !== 'object' || Array.isArray(content)) throw invalidResponse();
  return content;
}

export function chzzkNonNegativeNumber(...values) {
  for (const value of values) {
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

export function validateChzzkChannel(payload, channelId) {
  const channel = unwrapChzzkContent(payload);
  if (typeof channel.channelId !== 'string' || !channel.channelId.trim()
    || (channelId && channel.channelId !== String(channelId))) throw invalidResponse('CHZZK channel identity mismatch');
  return channel;
}

export function chzzkChannelIdentityMatches(item, userId) {
  const expected = String(userId || '').replace(/^(?:(?:user|chzzk):)+/, '').trim();
  return !!expected && String(item?.channelId || '') === expected;
}

export function normalizeChzzkLiveStatus(payload) {
  const content = unwrapChzzkContent(payload);
  const status = String(content.status || content.liveStatus || '').toUpperCase();
  if (['OPEN', 'LIVE', 'ONAIR', 'ON_AIR'].includes(status)) return { ...content, status: 'OPEN' };
  if (['CLOSE', 'CLOSED', 'OFFLINE'].includes(status)) return { ...content, status: 'CLOSE' };
  if (typeof content.openLive === 'boolean') return { ...content, status: content.openLive ? 'OPEN' : 'CLOSE' };
  throw invalidResponse('CHZZK live status is unavailable');
}

export function createChzzkInfoClient({
  apiBase = 'https://api.chzzk.naver.com',
  openApiBase = 'https://openapi.chzzk.naver.com',
  clientId = '',
  clientSecret = '',
  httpGet,
  timeoutMs = 8000,
  now = () => Date.now(),
} = {}) {
  const publicBase = apiBase.replace(/\/$/, '');
  const officialBase = openApiBase.replace(/\/$/, '');

  async function request(url, options = {}, extra = {}) {
    const remaining = options.deadlineAt ? Number(options.deadlineAt) - now() : Infinity;
    if (remaining <= 0) {
      const error = new Error('Variable lookup deadline exceeded');
      error.code = 'blueprint_variable_lookup_timeout';
      throw error;
    }
    return unwrapChzzkContent(await httpGet(url, {
      timeout: Math.max(1, Math.min(Number(options.timeout) || timeoutMs, remaining)),
      headers: { Accept: 'application/json', ...extra.headers },
      ...(extra.params ? { params: extra.params } : {}),
    }));
  }

  async function getOfficialChannel(channelId, options) {
    const content = await request(`${officialBase}/open/v1/channels`, options, {
      // A single channelIds value also avoids Axios's channelIds[] encoding.
      params: { channelIds: String(channelId) },
      headers: { 'Client-Id': clientId, 'Client-Secret': clientSecret },
    });
    const channel = content.data?.find?.((item) => item?.channelId === String(channelId));
    return validateChzzkChannel(channel, channelId);
  }

  async function getChannel(channelId, options = {}) {
    try {
      return validateChzzkChannel(await request(`${publicBase}/service/v1/channels/${encodeURIComponent(channelId)}`, options), channelId);
    } catch (error) {
      if (!clientId || !clientSecret) throw error;
      return getOfficialChannel(channelId, options);
    }
  }

  async function getFollowerCount(channelId, options = {}) {
    try {
      const content = await request(`${publicBase}/service/v1/channels/${encodeURIComponent(channelId)}/followers/count`, options);
      const count = chzzkNonNegativeNumber(content.followerCount, content.totalCount, content.count);
      if (count == null) throw invalidResponse('CHZZK follower count is unavailable');
      return count;
    } catch {
      const channel = await getChannel(channelId, options);
      const count = chzzkNonNegativeNumber(channel.followerCount);
      if (count == null) throw invalidResponse('CHZZK follower count is unavailable');
      return count;
    }
  }

  async function getChannelListPage(kind, accessToken, page, options) {
    if (!accessToken) throw invalidResponse('CHZZK account authorization is required');
    if (!Number.isInteger(page) || page < 0) throw new RangeError('CHZZK page must be zero-based');
    const content = await request(`${officialBase}/open/v1/channels/${kind}`, options, {
      params: { page, size: 50 },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!Array.isArray(content.data) || content.data.some((item) => !item || typeof item.channelId !== 'string' || !item.channelId)) {
      throw invalidResponse(`CHZZK ${kind} list is unavailable`);
    }
    return content.data;
  }

  async function getLiveStatus(channelId, options = {}) {
    try {
      return normalizeChzzkLiveStatus(await request(`${publicBase}/polling/v3.1/channels/${encodeURIComponent(channelId)}/live-status`, options));
    } catch {
      // Public channel metadata has an explicit openLive flag. Missing is not offline.
      const channel = await getChannel(channelId, options);
      return { ...normalizeChzzkLiveStatus(channel), channel, metadataPartial: true };
    }
  }

  async function getLiveDetail(channelId, options = {}) {
    const status = await getLiveStatus(channelId, options);
    if (status.status !== 'OPEN') return status;
    try {
      const content = await request(`${publicBase}/service/v1/channels/${encodeURIComponent(channelId)}/data`, options, {
        params: { fields: 'topExposedVideos' },
      });
      const live = content.topExposedVideos?.openLive;
      if (!live || typeof live !== 'object' || Array.isArray(live)
        || live.channelId !== String(channelId)
        || typeof live.liveTitle !== 'string'
        || (live.channel?.channelId && live.channel.channelId !== String(channelId))) throw invalidResponse();
      // The dedicated status response is authoritative if the home feed lags behind.
      return { ...live, ...status, metadataPartial: false };
    } catch {
      return { ...status, metadataPartial: true };
    }
  }

  return {
    getChannel,
    getFollowerCount,
    getLiveStatus,
    getLiveDetail,
    getFollowersPage: (token, page, options = {}) => getChannelListPage('followers', token, page, options),
    getSubscribersPage: (token, page, options = {}) => getChannelListPage('subscribers', token, page, options),
  };
}
