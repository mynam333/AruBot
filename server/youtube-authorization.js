export function hasGoogleIdentityScope(scope) {
  const scopes = String(scope || '').split(/\s+/);
  return scopes.includes('openid') || scopes.includes('https://www.googleapis.com/auth/userinfo.profile');
}

// Grants issued before OpenID was requested can still authorize YouTube.
export async function validateYoutubeGrant(record, { fetchIdentity, fetchChannels, assertIdentity }) {
  const platformUserId = String(record.platformUserId || '');
  const identityBound = platformUserId.startsWith('google:') || !!record.googleSubjectHash;
  if (identityBound || hasGoogleIdentityScope(record.scope)) {
    const identity = await fetchIdentity(record.accessToken);
    assertIdentity(identity, platformUserId, record.googleSubjectHash);
    return identity;
  }

  const channels = await fetchChannels(record.accessToken);
  const expected = record.selectedChannelId || record.channelId || platformUserId;
  if (!expected || !channels.some((channel) => channel.channelId === expected)) {
    const error = new Error('YouTube 인증 계정과 등록된 채널이 다릅니다. 해당 채널의 계정으로 다시 연결해 주세요.');
    error.status = 409;
    error.code = 'youtube_channel_mismatch';
    throw error;
  }
  return { googleSubjectHash: null };
}

export function isYoutubeGrantRevoked(error) {
  if (error?.reauthRequired === true) return true;
  const status = Number(error?.status || error?.lastStatus || error?.response?.status || 0);
  const data = error?.response?.data?.error;
  const text = String(error?.lastError || error?.message || (typeof data === 'string' ? data : data?.message) || '').toLowerCase();
  return status === 401 || text.includes('invalid_grant') || text.includes('unauthorized') || text.includes('no youtube refresh token');
}
