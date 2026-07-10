const fs = require('fs');
const path = require('path');

describe('disconnected channel runtime regression', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');

  test('provider disconnects register a runtime guard and close active sessions', () => {
    expect(serverIndex).toContain('const disconnectedProviderRuntimeGuards = new Map()');
    expect(serverIndex).toContain('function markProviderRuntimeDisconnected');
    expect(serverIndex).toContain('function disconnectProviderRuntimeState');
    expect(serverIndex).toContain("disconnectProviderRuntimeState(ownerUserId, 'chzzk'");
    expect(serverIndex).toContain("disconnectProviderRuntimeState(ownerUserId, 'cime'");
    expect(serverIndex).toContain("disconnectProviderRuntimeState(ownerUserId, 'youtube'");
    expect(serverIndex).toContain("disconnectProviderRuntimeState(ownerUserId, 'youtube', null, 'streamer_channel_deleted')");
  });

  test('session and token entry points reject providers marked as disconnected', () => {
    expect(serverIndex).toContain("assertProviderRuntimeConnected(ownerUserIdFromSid(sid), 'chzzk')");
    expect(serverIndex).toContain("assertProviderRuntimeConnected(ownerUserId, 'cime')");
    expect(serverIndex).toContain("assertProviderRuntimeConnected(ownerUserId, 'youtube')");
    expect(serverIndex).toContain('async function ensureSession(sid, channelId)');
    expect(serverIndex).toContain('async function ensureCimeSession(ownerUserId)');
    expect(serverIndex).toContain('async function ensureYoutubeSession(ownerUserId)');
  });

  test('CIME close from a disconnect does not schedule a reconnect', () => {
    const closeStart = serverIndex.indexOf('function closeCimeSession');
    const closeEnd = serverIndex.indexOf('function closeChzzkProviderRuntimeSession', closeStart);
    const closeBody = serverIndex.slice(closeStart, closeEnd);
    const ensureStart = serverIndex.indexOf('async function ensureCimeSession');
    const ensureEnd = serverIndex.indexOf('// Optional: allow client to reset the session', ensureStart);
    const ensureBody = serverIndex.slice(ensureStart, ensureEnd);

    expect(closeBody).toContain('entry.closed = true');
    expect(ensureBody).toContain('closed: false');
    expect(ensureBody).toContain('if (entry.closed) return');
    expect(ensureBody).toContain('ensureCimeSession(ownerUserId).catch');
  });

  test('specific provider revokes remove matching stored tokens too', () => {
    const youtubeStart = serverIndex.indexOf("app.post('/api/auth/youtube/revoke'");
    const youtubeEnd = serverIndex.indexOf("app.get('/api/auth/cime/login'", youtubeStart);
    const youtubeBody = serverIndex.slice(youtubeStart, youtubeEnd);
    const youtubeDeleteStart = serverIndex.indexOf('async function deleteYoutubeAuthorizedData');
    const youtubeDeleteEnd = serverIndex.indexOf("app.post('/api/auth/youtube/revoke'", youtubeDeleteStart);
    const youtubeDeleteBody = serverIndex.slice(youtubeDeleteStart, youtubeDeleteEnd);
    const cimeStart = serverIndex.indexOf("app.post('/api/auth/cime/revoke'");
    const cimeEnd = serverIndex.indexOf("app.get('/api/cime/me'", cimeStart);
    const cimeBody = serverIndex.slice(cimeStart, cimeEnd);
    const chzzkStart = serverIndex.indexOf("app.post('/api/auth/chzzk/revoke'");
    const chzzkEnd = serverIndex.indexOf("app.get('/api/channel/cache-stats'", chzzkStart);
    const chzzkBody = serverIndex.slice(chzzkStart, chzzkEnd);

    expect(youtubeBody).toContain("await deleteYoutubeAuthorizedData(ownerUserId, platformUserId, 'revoked')");
    expect(youtubeDeleteBody).toContain('await deleteYoutubeStreamerChannel(owner)');
    expect(youtubeDeleteBody).toContain("await deletePlatformAccount('youtube', owner, platformUserId)");
    expect(cimeBody).toContain('await deletePlatformTokens(\'cime\', ownerUserId)');
    expect(chzzkBody).toContain('await updateTokens(sid, null)');
  });

  test('platform status closes orphan sessions for disconnected channels', () => {
    const statusStart = serverIndex.indexOf("app.get('/api/platforms/status'");
    const statusEnd = serverIndex.indexOf("app.post('/api/cime/reset'", statusStart);
    const statusBody = serverIndex.slice(statusStart, statusEnd);

    expect(statusBody).toContain("if (!chzzkAccount && sessionStore.get(sid)?.connected)");
    expect(statusBody).toContain("if (!cimeAccount && cimeEntry?.connected)");
    expect(statusBody).toContain("if (!(youtubeBotProfile?.selectedChannelId && youtubeStreamerChannel?.youtubeChannelId) && youtubeEntry?.connected)");
  });
});
