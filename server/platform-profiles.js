export function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value != null && typeof value !== 'object') {
      const stringValue = String(value).trim();
      if (stringValue) return stringValue;
    }
  }
  return null;
}

export function firstNumber(...values) {
  for (const value of values) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return null;
}

export function unwrapAnyContent(payload) {
  if (!payload || typeof payload !== 'object') return payload || {};
  return payload.content || payload.data || payload.channel || payload.profile || payload.result || payload;
}

export function buildTemplateUrl(template, params) {
  if (!template) return null;
  return template.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(params[key] || ''));
}

export function parseOpenGraphProfile(html) {
  if (typeof html !== 'string' || !html.trim()) return {};
  const getMeta = (property) => {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["']`, 'i')
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return match[1].replace(/&amp;/g, '&').trim();
    }
    return null;
  };
  return {
    title: getMeta('og:title') || getMeta('twitter:title'),
    description: getMeta('og:description') || getMeta('description') || getMeta('twitter:description'),
    imageUrl: getMeta('og:image') || getMeta('twitter:image'),
    url: getMeta('og:url')
  };
}

export function normalizeChzzkPublicProfile(payload) {
  const content = unwrapAnyContent(payload);
  return {
    channelId: firstString(content.channelId, content.channelUid, content.id),
    channelName: firstString(content.channelName, content.name, content.nickname),
    channelHandle: firstString(content.channelHandle, content.channelUrl, content.handle),
    channelImageUrl: firstString(content.channelImageUrl, content.profileImageUrl, content.profileImage, content.imageUrl, content.avatarUrl),
    description: firstString(content.channelDescription, content.description, content.bio),
    followerCount: firstNumber(content.followerCount, content.followers, content.followCount),
    verified: Boolean(content.verified || content.isVerified || content.official),
    openLive: Boolean(content.openLive || content.isLive || content.live),
    channelType: firstString(content.channelType, content.type),
    raw: content || {}
  };
}

export function normalizeCimePublicProfile(payload) {
  const content = unwrapAnyContent(payload);
  const og = parseOpenGraphProfile(typeof payload === 'string' ? payload : '');
  return {
    channelId: firstString(content.id, content.channelId, content.channelUid, content.userId),
    channelName: firstString(content.channelName, content.name, content.nickname, content.displayName, og.title),
    channelHandle: firstString(content.slug, content.channelHandle, content.handle, content.username),
    channelImageUrl: firstString(content.imageUrl, content.channelImageUrl, content.profileImageUrl, content.profileImage, content.avatarUrl, og.imageUrl),
    videoBannerImageUrl: firstString(content.videoBannerImageUrl, content.bannerImageUrl),
    description: firstString(content.channelDescription, content.description, content.bio, og.description),
    followerCount: firstNumber(content.followerCount, content.followers, content.followCount),
    subscriberCount: firstNumber(content.subscriberCount, content.subscribers),
    level: firstNumber(content.level),
    isLive: Boolean(content.isLive || content.live),
    canSubscription: Boolean(content.canSubscription),
    canChatDonation: Boolean(content.canChatDonation),
    canVideoDonation: Boolean(content.canVideoDonation),
    canMissionDonation: Boolean(content.canMissionDonation),
    raw: content || {}
  };
}

export function createPlatformProfileService({
  chzzkApiBase = 'https://api.chzzk.naver.com',
  cimeAppApiBase = 'https://ci.me/api/app',
  cimeProfileUrlTemplate = '',
  timeoutMs = 2500,
  httpGet,
  now = () => new Date().toISOString(),
  nowMs = () => Date.now(),
} = {}) {
  async function readProfileCandidate(url, headers = {}) {
    if (!url || typeof httpGet !== 'function') return { ok: false, url, error: 'http_get_unavailable' };
    try {
      const payload = await httpGet(url, {
        headers: {
          Accept: 'application/json,text/html;q=0.8,*/*;q=0.5',
          'User-Agent': 'AruBot/1.0 profile-enrichment',
          ...headers
        },
        timeout: timeoutMs
      });
      return { ok: true, url, payload };
    } catch (error) {
      return { ok: false, url, error: error?.message || 'request_failed' };
    }
  }

  function hasFreshPublicProfile(profile, forceRefresh) {
    if (forceRefresh) return false;
    const fetchedAt = profile?.metadata?.publicProfile?.fetchedAt;
    if (!fetchedAt) return false;
    const fetchedAtMs = Date.parse(fetchedAt);
    if (!Number.isFinite(fetchedAtMs)) return false;
    return nowMs() - fetchedAtMs < 10 * 60 * 1000;
  }

  function withPublicProfileStatus(profile, provider, status, extra = {}) {
    return {
      ...profile,
      metadata: {
        ...(profile.metadata || {}),
        publicProfile: {
          ...(profile.metadata?.publicProfile || {}),
          provider,
          status,
          fetchedAt: now(),
          ...extra
        }
      }
    };
  }

  async function enrichChzzkProfile(profile, { forceRefresh = false } = {}) {
    const channelId = firstString(profile?.channelId, profile?.platformUserId);
    if (!channelId) return withPublicProfileStatus(profile, 'chzzk', 'skipped', { error: 'missing_channel_id' });
    if (hasFreshPublicProfile(profile, forceRefresh)) return profile;

    const url = `${chzzkApiBase}/service/v1/channels/${encodeURIComponent(channelId)}`;
    const result = await readProfileCandidate(url);
    if (!result.ok) {
      return withPublicProfileStatus(profile, 'chzzk', 'failed', {
        source: url,
        error: result.error || 'request_failed'
      });
    }

    const extra = normalizeChzzkPublicProfile(result.payload);
    return {
      ...profile,
      channelName: extra.channelName || profile.channelName,
      channelHandle: extra.channelHandle || profile.channelHandle,
      channelImageUrl: extra.channelImageUrl || profile.channelImageUrl,
      metadata: {
        ...(profile.metadata || {}),
        publicProfile: {
          provider: 'chzzk',
          status: 'ok',
          source: url,
          channelId: extra.channelId || channelId,
          description: extra.description || null,
          followerCount: extra.followerCount,
          verified: extra.verified,
          openLive: extra.openLive,
          channelType: extra.channelType,
          fetchedAt: now(),
          raw: extra.raw
        }
      }
    };
  }

  async function enrichCimeProfile(profile, accessToken = null, { forceRefresh = false } = {}) {
    const channelId = firstString(profile?.channelId, profile?.platformUserId);
    const handle = firstString(profile?.channelHandle);
    if (!channelId && !handle) return withPublicProfileStatus(profile, 'cime', 'skipped', { error: 'missing_channel_id' });
    if (hasFreshPublicProfile(profile, forceRefresh)) return profile;

    const templateUrl = buildTemplateUrl(cimeProfileUrlTemplate, { channelId, handle });
    const candidates = Array.from(new Set([
      templateUrl,
      channelId ? `${cimeAppApiBase}/channels/id/${encodeURIComponent(channelId)}` : null,
      handle ? `${cimeAppApiBase}/channels/${encodeURIComponent(handle)}` : null
    ].filter(Boolean)));
    const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
    let lastError = null;

    for (const url of candidates) {
      const result = await readProfileCandidate(url, headers);
      if (!result.ok) {
        lastError = result.error || 'request_failed';
        continue;
      }
      const extra = normalizeCimePublicProfile(result.payload);
      if (!extra.channelName && !extra.channelImageUrl && !extra.description) {
        lastError = 'empty_profile_payload';
        continue;
      }
      return {
        ...profile,
        channelName: extra.channelName || profile.channelName,
        channelHandle: extra.channelHandle || profile.channelHandle,
        channelImageUrl: extra.channelImageUrl || profile.channelImageUrl,
        metadata: {
          ...(profile.metadata || {}),
          publicProfile: {
            provider: 'cime',
            status: 'ok',
            source: url,
            channelId: extra.channelId || channelId,
            description: extra.description || null,
            followerCount: extra.followerCount,
            subscriberCount: extra.subscriberCount,
            level: extra.level,
            isLive: extra.isLive,
            videoBannerImageUrl: extra.videoBannerImageUrl,
            canSubscription: extra.canSubscription,
            canChatDonation: extra.canChatDonation,
            canVideoDonation: extra.canVideoDonation,
            canMissionDonation: extra.canMissionDonation,
            fetchedAt: now(),
            raw: extra.raw
          }
        }
      };
    }

    return withPublicProfileStatus(profile, 'cime', 'failed', {
      source: candidates[0] || null,
      error: lastError || 'request_failed'
    });
  }

  return {
    enrichChzzkProfile,
    enrichCimeProfile,
  };
}
