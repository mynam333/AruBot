function firstText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function parseTimestamp(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildYoutubeLiveLookupContext(input = {}) {
  const entry = input.entry || null;
  const streamerChannel = input.streamerChannel || null;
  const account = input.account || null;
  const cachedState = String(input.cachedState?.provider || '').toLowerCase() === 'youtube'
    ? input.cachedState
    : null;
  const broadcastIds = Array.from(new Set([
    entry?.broadcastId,
    cachedState?.broadcastId,
    streamerChannel?.lastDetectedVideoId,
  ].map((value) => String(value || '').trim()).filter(Boolean)));
  const channelId = firstText(
    entry?.channelId,
    streamerChannel?.youtubeChannelId,
    account?.channel_id,
    account?.platform_user_id
  );
  const liveChatId = firstText(entry?.liveChatId, cachedState?.liveChatId);
  const live = Boolean(liveChatId || cachedState?.live === true);

  return {
    provider: 'youtube',
    ownerUserId: firstText(input.ownerUserId),
    channelId,
    channel: firstText(
      streamerChannel?.title,
      streamerChannel?.youtubeHandle,
      account?.channel_name,
      account?.channel_handle,
      channelId
    ),
    liveChatId,
    broadcastIds,
    title: firstText(entry?.title, cachedState?.title, streamerChannel?.lastLiveTitle),
    startTs: parseTimestamp(cachedState?.startTs ?? streamerChannel?.lastLiveStartedAt),
    live,
    hasIdentity: Boolean(channelId || entry || streamerChannel || account),
  };
}

export function buildYoutubeLiveInfoFallback(context = {}) {
  if (!context.live) return null;
  const startedAtTs = parseTimestamp(context.startTs);
  return {
    provider: 'youtube',
    status: 'live',
    title: firstText(context.title),
    category: '',
    viewers: null,
    startedAt: startedAtTs ? new Date(startedAtTs).toISOString() : '',
    startedAtTs,
    channel: firstText(context.channel, context.channelId),
    live: true,
    raw: { source: 'youtube_provider_cache' },
  };
}
