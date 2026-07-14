const PLATFORM_USER_ID_PREFIX = /^(?:cime|chzzk|youtube):/i;

export function getChannelIdFromUserId(userId) {
  const ownerUserId = String(userId || '').trim().replace(/^user:/i, '');
  const channelId = ownerUserId.replace(PLATFORM_USER_ID_PREFIX, '').trim();
  return validateChannelId(channelId) ? channelId : null;
}

export function validateChannelId(channelId) {
  if (typeof channelId !== 'string') return false;
  const trimmed = channelId.trim();
  if (trimmed.length < 3 || trimmed.length > 100) return false;
  return /^[a-zA-Z0-9_-]+$/.test(trimmed);
}

function platformAccountChannelId(account) {
  return String(
    account?.channel_id ||
    account?.channelId ||
    account?.platform_user_id ||
    account?.platformUserId ||
    ''
  ).trim();
}

export function selectPlatformChannelId(accounts, providerHint = '') {
  const rows = Array.isArray(accounts) ? accounts : [];
  const provider = String(providerHint || '').trim().toLowerCase();
  const candidates = provider
    ? rows.filter((account) => String(account?.provider || '').trim().toLowerCase() === provider)
    : [
        ...rows.filter((account) => String(account?.provider || '').trim().toLowerCase() === 'chzzk'),
        ...rows.filter((account) => String(account?.provider || '').trim().toLowerCase() !== 'chzzk'),
      ];
  const match = candidates.find((account) => validateChannelId(platformAccountChannelId(account)));
  return match ? platformAccountChannelId(match) : null;
}
