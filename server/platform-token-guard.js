export function platformTokenSnapshotMatches(row, expected, revealSecret) {
  if (!row || !expected?.accessToken) return false;
  if (revealSecret(row.access_token) !== expected.accessToken) return false;
  if ((revealSecret(row.refresh_token) || null) !== (expected.refreshToken || null)) return false;
  if (expected.platformUserId && String(row.platform_user_id) !== String(expected.platformUserId)) return false;
  if (expected.consentGrantedAt && new Date(row.consent_granted_at).getTime() !== new Date(expected.consentGrantedAt).getTime()) return false;
  if (expected.identityUpdatedAt && new Date(row.identity_updated_at).getTime() !== new Date(expected.identityUpdatedAt).getTime()) return false;
  // OAuth persists identity before its new token. Do not remove/refresh the old
  // grant while that reconnect is between these two writes.
  if (row.identity_updated_at && new Date(row.identity_updated_at).getTime() > new Date(row.updated_at).getTime()) return false;
  return true;
}
