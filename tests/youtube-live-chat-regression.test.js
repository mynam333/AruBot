const fs = require('fs');
const path = require('path');

describe('YouTube live chat integration regression', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const connectionPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'connection-page.tsx'), 'utf8');
  const arubotAdminPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'arubot-admin-page.tsx'), 'utf8');
  const dashboardPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'dashboard-page.tsx'), 'utf8');
  const variablesPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'variables-page.tsx'), 'utf8');
  const navigation = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'config', 'navigation.ts'), 'utf8');
  const realtimeDiagnosticsPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', '(admin)', 'diagnostics', 'realtime', 'page.tsx'), 'utf8');

  test('uses youtube-chat for receiving live chat', () => {
    expect(serverIndex).toContain("import youtubeChatPackage from 'youtube-chat'");
    expect(serverIndex).toContain('const { LiveChat: YoutubeLiveChat } = youtubeChatPackage');
    expect(serverIndex).toContain('new YoutubeLiveChat(youtubeId, intervalMs)');
    expect(serverIndex).toContain('handleYoutubeChatLibraryItem(entry, chatItem)');
    expect(serverIndex).toContain('openYoutubeChatStream(entry)');
    expect(serverIndex).toContain('scheduleYoutubeReconnect(entry.ownerUserId,');
    expect(serverIndex).not.toContain('pollingIntervalMillis');
    expect(serverIndex).not.toContain("youtubeApiGet('liveChat/messages'");
    expect(serverIndex).not.toContain("'/liveChat/messages/stream'");
  });

  test('only KRW Super Chat becomes a donation event', () => {
    const normalizeStart = serverIndex.indexOf('function normalizeYoutubeSuperChatEvent');
    const normalizeEnd = serverIndex.indexOf('function normalizeYoutubeLiveChatItem', normalizeStart);
    const normalizeBody = serverIndex.slice(normalizeStart, normalizeEnd);

    expect(normalizeBody).toContain("currency !== 'KRW'");
    expect(normalizeBody).toContain("ignoredReason: 'non_krw_super_chat'");
    expect(normalizeBody).toContain("type: 'donation'");
    expect(normalizeBody).toContain("donationType: 'youtube_super_chat'");
    expect(normalizeBody).toContain('Math.floor(amountMicros / 1000000)');
  });

  test('Super Stickers are not routed through donation rules', () => {
    const itemStart = serverIndex.indexOf('function normalizeYoutubeLiveChatItem');
    const itemEnd = serverIndex.indexOf('function getYoutubeChatLibraryMessageText', itemStart);
    const itemBody = serverIndex.slice(itemStart, itemEnd);

    expect(itemBody).toContain("type === 'superStickerEvent'");
    expect(itemBody).toContain("eventName: 'DONATION_IGNORED'");
    expect(itemBody).toContain("ignoredReason: 'super_sticker_not_supported'");
  });

  test('sendChatByPost supports YouTube chat posts', () => {
    const sendStart = serverIndex.indexOf('async function sendChatByPost');
    const sendEnd = serverIndex.indexOf('async function processRouletteQueue', sendStart);
    const sendBody = serverIndex.slice(sendStart, sendEnd);

    expect(sendBody).toContain("provider === 'youtube'");
    expect(sendBody).toContain('return sendYoutubeChat(ownerUserId, chatPost?.liveChatId || null, text)');
  });

  test('normalizes non-local YouTube OAuth callback URLs to HTTPS', () => {
    expect(serverIndex).toContain('function normalizeYoutubeRedirectUri');
    expect(serverIndex).toContain("url.protocol === 'http:' && !isLocal");
    expect(serverIndex).toContain("url.protocol = 'https:'");
    expect(serverIndex).toContain('BACKEND_ORIGIN ? `${String(BACKEND_ORIGIN).replace(/\\/$/, \'\')}/api/auth/youtube/callback`');
  });

  test('connection page exposes YouTube as a platform provider', () => {
    expect(connectionPage).toContain("type ProviderId = 'chzzk' | 'cime' | 'youtube'");
    expect(connectionPage).toContain("id: 'youtube'");
    expect(connectionPage).toContain("loginPath: '/api/auth/youtube/login'");
    expect(connectionPage).toContain("revokePath: '/api/auth/youtube/revoke'");
    expect(connectionPage).toContain("apiUrl(`/api/auth/youtube/login?returnTo=${encodeURIComponent('/connection?platform=youtube')}`)");
    expect(connectionPage).toContain('YouTube로 시작');
    expect(connectionPage).toContain("window.open('about:blank', '_blank')");
    expect(connectionPage).toContain("apiUrl('/api/youtube/streamer-channel')");
    expect(connectionPage).not.toContain("apiUrl('/api/youtube/bot/login')");
  });

  test('streamer YouTube OAuth can create the app session and streamer channel', () => {
    expect(serverIndex).toContain("const mode = requestedMode === 'central_bot'");
    expect(serverIndex).toContain("const preferredUserId = await getCurrentSessionUserId(req)");
    expect(serverIndex).toContain("const { userId } = await upsertPlatformIdentity('youtube', profile, preferredUserId)");
    expect(serverIndex).toContain("await upsertPlatformTokens('youtube', userId, profile.platformUserId, tokens)");
    expect(serverIndex).toContain('await upsertSession(sidToken, userId, 30)');
    expect(serverIndex).toContain('upsertYoutubeStreamerChannelFromOAuthProfile(req, userId, profile)');
    expect(serverIndex).toContain("reason: oauthMode === 'viewer' ? null : 'youtube_streamer_registered'");
    expect(serverIndex).toContain("const allowedPaths = ['/viewer/', '/c/', '/connection']");
  });

  test('central YouTube bot mode is configured from admin UI without channel-id env pinning', () => {
    expect(arubotAdminPage).toContain("apiUrl('/api/youtube/bot/login')");
    expect(arubotAdminPage).toContain("apiUrl('/api/youtube/bot/select-channel')");
    expect(arubotAdminPage).toContain("apiUrl('/api/youtube/bot/verify')");
    expect(serverIndex).toContain("const YOUTUBE_BOT_PROFILE_ID = process.env.YOUTUBE_BOT_PROFILE_ID || 'default'");
    expect(serverIndex).not.toContain('YOUTUBE_BOT_CHANNEL_ID');
    expect(serverIndex).toContain("app.get('/api/arubot-admin/me'");
    expect(serverIndex).toContain('requireCurrentAdminUser(req, res)');
    expect(serverIndex).toContain("app.get('/api/youtube/bot/status'");
    expect(serverIndex).toContain("app.post('/api/youtube/bot/select-channel'");
    expect(serverIndex).toContain("app.post('/api/youtube/streamer-channel'");
    expect(serverIndex).toContain("app.post('/api/youtube/streamer-channel/moderator-confirmed'");
    expect(serverIndex).toContain("error.code = 'youtube_bot_not_configured'");
    expect(serverIndex).toContain("lastError: 'youtube_bot_moderator_not_confirmed'");
    expect(serverIndex).toContain('async function verifyYoutubeBotModeratorRegistration');
    expect(serverIndex).toContain('author.isChatModerator === true');
    expect(serverIndex).toContain("'bot_is_not_moderator'");
    expect(serverIndex).toContain("reason: 'active_live_chat_required'");
    expect(serverIndex).toContain('const botProfile = await getValidYoutubeBotProfile()');
    expect(serverIndex).toContain('const streamerChannel = await getYoutubeStreamerChannel(ownerUserId)');
    expect(serverIndex).toContain("const isExpectedCentralBotModeMiss = message === 'No YouTube tokens stored'");
    expect(connectionPage).toContain('운영자 실제 확인');
    expect(connectionPage).toContain("searchParams.get('platform') !== 'youtube'");
  });

  test('separates viewer and central bot YouTube OAuth scopes', () => {
    expect(serverIndex).toContain('const YOUTUBE_BOT_AUTH_SCOPE = String(');
    expect(serverIndex).toContain('const YOUTUBE_CHANNEL_READ_AUTH_SCOPE = String(');
    expect(serverIndex).toContain('const YOUTUBE_VIEWER_AUTH_SCOPE = String(');
    expect(serverIndex).toContain('const YOUTUBE_STREAMER_AUTH_SCOPE = String(');
    expect(serverIndex).toContain("'https://www.googleapis.com/auth/youtube.readonly'");
    expect(serverIndex).toContain("'https://www.googleapis.com/auth/youtube.force-ssl'");
    expect(serverIndex).toContain('process.env.YOUTUBE_CHANNEL_READ_AUTH_SCOPE');
    expect(serverIndex).toContain('YOUTUBE_STREAMER_AUTH_SCOPE ||\n  YOUTUBE_CHANNEL_READ_AUTH_SCOPE');
    expect(serverIndex).toContain("requestedMode === 'viewer'");
    expect(serverIndex).toContain("mode === 'viewer'");
    expect(serverIndex).toContain('authUrl.searchParams.set(\'scope\', scope)');
    expect(serverIndex).toContain("if (mode === 'central_bot') authUrl.searchParams.set('include_granted_scopes', 'true')");
    expect(serverIndex).toContain("if (oauthMode !== 'viewer')");
    expect(serverIndex).toContain('normalizeGoogleTokenPayload(tokenPayload, {}, tokenFallbackScope)');
  });

  test('YouTube channel auto-detection uses WebSub plus bounded retries instead of polling', () => {
    expect(serverIndex).toContain('YOUTUBE_WEBSUB_HUB_URL');
    expect(serverIndex).toContain("app.get(YOUTUBE_WEBSUB_CALLBACK_PATH");
    expect(serverIndex).toContain("app.post(YOUTUBE_WEBSUB_CALLBACK_PATH");
    expect(serverIndex).toContain('extractYoutubeWebsubEntries');
    expect(serverIndex).toContain('YOUTUBE_WEBSUB_RETRY_DELAYS_MS');
    expect(serverIndex).toContain('scheduleYoutubeWebsubLiveRetry');
  });

  test('operational status and health include YouTube sessions', () => {
    expect(serverIndex).toContain("app.get('/api/youtube/status'");
    expect(serverIndex).toContain("app.get('/api/platforms/status'");
    expect(serverIndex).toContain("mode: 'youtube-chat'");
    expect(serverIndex).toContain('reauthRequired: isYoutubeReauthRequired');
    expect(serverIndex).toContain('ignoredDonations: getYoutubeIgnoredDonationSummary');
    expect(serverIndex).toContain('youtube: typeof youtubeSessionStore');
    expect(serverIndex).toContain("provider: 'youtube'");
    expect(serverIndex).toContain("mode: 'websocket'");
    expect(serverIndex).toContain("mode: 'socket'");
  });

  test('YouTube token refresh failures surface reauthentication status', () => {
    expect(serverIndex).toContain('error.reauthRequired = true');
    expect(serverIndex).toContain('function isYoutubeReauthRequired');
    expect(serverIndex).toContain("text.includes('invalid_grant')");
    expect(serverIndex).toContain('lastStatus: entry?.lastStatus || null');
  });

  test('admin surfaces list YouTube consistently', () => {
    expect(dashboardPage).toContain("id: 'youtube'");
    expect(dashboardPage).toContain("connectionPath: '/connection?platform=youtube'");
    expect(dashboardPage).toContain("apiUrl(`/api/auth/youtube/login?returnTo=${encodeURIComponent('/connection?platform=youtube')}`)");
    expect(dashboardPage).toContain('YouTube로 로그인');
    expect(dashboardPage).toContain('YouTube 다시 연결');
    expect(dashboardPage).not.toContain("loginPath: '/api/auth/youtube/login'");
    expect(dashboardPage).toContain("if (value === 'youtube') return 'YouTube'");
    expect(variablesPage).toContain("if (provider === 'youtube') return 'YouTube'");
    expect(serverIndex).toContain("const BOT_VARIABLE_PROVIDERS = ['chzzk', 'cime', 'youtube']");
    expect(navigation).toContain("endpoint: '/api/platforms/status'");
    expect(realtimeDiagnosticsPage).toContain("endpoint: '/api/platforms/status?refresh=true'");
  });
});
