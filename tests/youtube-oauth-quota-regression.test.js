const fs = require('fs');
const path = require('path');

describe('YouTube OAuth without Data API quota', () => {
  const root = path.join(__dirname, '..');
  const serverIndex = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
  const connectionPage = fs.readFileSync(path.join(root, 'src', 'features', 'admin', 'connection-page.tsx'), 'utf8');
  const adminPage = fs.readFileSync(path.join(root, 'src', 'features', 'admin', 'arubot-admin-page.tsx'), 'utf8');
  const adminSystemPanel = fs.readFileSync(path.join(root, 'src', 'features', 'admin', 'arubot-admin-system-panel.tsx'), 'utf8');
  const callbackStart = serverIndex.indexOf("app.get('/api/auth/youtube/callback'");
  const callbackEnd = serverIndex.indexOf("app.get('/api/auth/youtube/token'", callbackStart);
  const callback = serverIndex.slice(callbackStart, callbackEnd);

  test('requests OpenID identity scopes together with the least-privilege YouTube scope', () => {
    expect(serverIndex).toContain("const YOUTUBE_IDENTITY_AUTH_SCOPE = 'openid profile'");
    expect(serverIndex).toContain('const scope = mergeOAuthScopes(YOUTUBE_IDENTITY_AUTH_SCOPE, youtubeScope)');
    expect(serverIndex).toContain("const YOUTUBE_USERINFO_URL = process.env.YOUTUBE_USERINFO_URL || 'https://openidconnect.googleapis.com/v1/userinfo'");
  });

  test('keeps authentication successful when channel lookup quota is unavailable', () => {
    expect(callback).toContain('const oauthProfile = await resolveYoutubeOAuthProfile');
    expect(serverIndex).toContain('continuing with Google OAuth identity');
    expect(callback).toContain("'youtube_channel_registration_required'");
    expect(callback).not.toContain("reason: 'quota_exceeded'");
    expect(callback).toContain('await rotateAuthenticatedSession(req, res, userId)');
    expect(serverIndex).toContain('platformUserId: identity.platformUserId');
    expect(serverIndex).toContain('const preferredUserId = currentSessionUserId || existingChannelUserId');
  });

  test('allows a central bot channel to be registered manually after OAuth', () => {
    expect(callback).toContain("'central_bot_register_channel'");
    expect(serverIndex).toContain('manualChannelRequired: channels.length === 0');
    expect(serverIndex).toContain('const requestedChannelInput = String(req.body?.channel');
    expect(adminSystemPanel).toContain('youtubeBotStatus?.pending?.manualChannelRequired');
    expect(adminSystemPanel).toContain('봇 채널 직접 등록');
  });

  test('validates retained OAuth grants through UserInfo instead of channels.list', () => {
    const validationStart = serverIndex.indexOf('async function validateYoutubeCentralBotAuthorization');
    const validationEnd = serverIndex.indexOf("setTimeout(() => { validateYoutubeAuthorizations", validationStart);
    const validation = serverIndex.slice(validationStart, validationEnd);
    expect(validation).toContain('fetchGoogleYoutubeIdentityWithAccessToken');
    expect(validation).toContain('assertGoogleYoutubeIdentityMatches');
    expect(validation).not.toContain('fetchYoutubeMyChannelWithAccessToken');
    expect(validation).not.toContain('fetchYoutubeMyChannelsWithAccessToken');
  });

  test('shows direct-registration guidance instead of waiting for quota recovery', () => {
    expect(connectionPage).toContain("reason === 'youtube_channel_registration_required'");
    expect(connectionPage).toContain('사용할 YouTube 채널을 등록해 주세요.');
    expect(adminPage).toContain("reason === 'central_bot_register_channel'");
    expect(adminPage).toContain('YouTube 봇 채널 URL을 직접 등록해 주세요.');
  });
});
