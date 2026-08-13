const fs = require('fs');
const path = require('path');

describe('YouTube live chat integration regression', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const serverDb = fs.readFileSync(path.join(__dirname, '..', 'server', 'supabase.js'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const termsPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', '(public)', 'terms', 'page.tsx'), 'utf8');
  const privacyPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', '(public)', 'privacy', 'page.tsx'), 'utf8');
  const blueprintPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'action-blueprint-page.tsx'), 'utf8');
  const connectionPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'connection-page.tsx'), 'utf8');
  const arubotAdminPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'arubot-admin-page.tsx'), 'utf8');
  const dashboardPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'dashboard-page.tsx'), 'utf8');
  const variablesPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'variables-page.tsx'), 'utf8');
  const navigation = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'config', 'navigation.ts'), 'utf8');
  const realtimeDiagnosticsPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', '(admin)', 'diagnostics', 'realtime', 'page.tsx'), 'utf8');

  test('receives live chat through the event client without Data API polling', () => {
    const receiverStart = serverIndex.indexOf('async function openYoutubeChatStream');
    const receiverEnd = serverIndex.indexOf('async function ensureYoutubeSession', receiverStart);
    const receiverBody = serverIndex.slice(receiverStart, receiverEnd);

    expect(packageJson.dependencies['youtube-chat']).toBe('^2.2.0');
    expect(serverIndex).toContain('openYoutubeChatStream(entry)');
    expect(serverIndex).toContain("import youtubeLiveChatReceiver from './youtube-live-chat-receiver.cjs'");
    expect(receiverBody).toContain('createYoutubeLiveChatReceiver({');
    expect(receiverBody).toContain("chatClient.on('chat'");
    expect(receiverBody).toContain('toYoutubeLiveChatItem(chatItem)');
    expect(receiverBody).toContain('scheduleYoutubeReconnect(entry.ownerUserId)');
    expect(receiverBody).not.toContain("youtubeApiGetWithAccessToken('liveChat/messages'");
    expect(receiverBody).not.toContain('pollingIntervalMillis');
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
    const itemEnd = serverIndex.indexOf('function makeYoutubeChatPost', itemStart);
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

  test('starts channel-based receiving before optional API metadata enrichment', () => {
    const reconnectStart = serverIndex.indexOf('function getYoutubeReconnectDelayForError');
    const reconnectEnd = serverIndex.indexOf('function closeYoutubeSession', reconnectStart);
    const reconnectBody = serverIndex.slice(reconnectStart, reconnectEnd);
    const ensureStart = serverIndex.indexOf('async function ensureYoutubeSession');
    const ensureEnd = serverIndex.indexOf('function firstNonEmptyText', ensureStart);
    const ensureBody = serverIndex.slice(ensureStart, ensureEnd);

    expect(serverIndex).toContain('const YOUTUBE_QUOTA_RETRY_MS =');
    expect(serverIndex).toContain('function isYoutubeQuotaExceededError');
    expect(reconnectBody).toContain('if (isYoutubeQuotaExceededError(error)) return YOUTUBE_QUOTA_RETRY_MS');
    expect(ensureBody).toContain('await openYoutubeChatStream(entry)');
    expect(ensureBody).toContain('await hydrateYoutubeReceiverApiMetadata(entry)');
    expect(ensureBody.indexOf('await openYoutubeChatStream(entry)')).toBeLessThan(ensureBody.indexOf('await hydrateYoutubeReceiverApiMetadata(entry)'));
    expect(ensureBody).not.toContain('await refreshYoutubeLiveStatus(ownerUserId, sid, { force: true })');
  });

  test('treats an active receiver as authoritative for command live checks', () => {
    const processStart = serverIndex.indexOf('async function processYoutubeChatAutomation');
    const processEnd = serverIndex.indexOf('function closeYoutubeSession', processStart);
    const processBody = serverIndex.slice(processStart, processEnd);

    expect(processBody).toContain('const liveState = entry.connected');
    expect(processBody).toContain('? { live: true, channelId: entry.channelId || null');
    expect(processBody).toContain(': await refreshYoutubeLiveStatus(ownerUserId, sid, { ttlMs: 30 * 1000 })');
  });

  test('resolves live-title placeholders only from the active YouTube broadcast', () => {
    const liveInfoStart = serverIndex.indexOf('async function fetchYoutubeLiveInfoForSid');
    const liveInfoEnd = serverIndex.indexOf('async function getChannelUidsForSid', liveInfoStart);
    const liveInfoBody = serverIndex.slice(liveInfoStart, liveInfoEnd);
    const refreshStart = serverIndex.indexOf('async function refreshYoutubeLiveStatus');
    const refreshEnd = serverIndex.indexOf('function normalizeYoutubeChatEvent', refreshStart);
    const refreshBody = serverIndex.slice(refreshStart, refreshEnd);

    expect(liveInfoBody).toContain('youtubeSessionStore.get(ownerUserId)');
    expect(liveInfoBody).toContain('buildYoutubeLiveLookupContext');
    expect(liveInfoBody).toContain('fetchYoutubeVideoLiveDetails(broadcastId)');
    expect(liveInfoBody).toContain('fetchYoutubeOwnedActiveLive(ownerUserId)');
    expect(liveInfoBody).toContain('confirmedOffline = !ownedLive');
    expect(liveInfoBody).toContain('buildYoutubeLiveInfoFallback(lookup)');
    expect(refreshBody).toContain('broadcastId: cached.broadcastId || null');
    expect(refreshBody).toContain("title: cached.title || ''");
    expect(refreshBody).toContain('allowSearch: options.allowSearch === true');
    expect(refreshBody).not.toContain('allowSearch: options.force === true || options.allowSearch === true');
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

  test('streamer YouTube OAuth can create the app session and register a resolved channel', () => {
    expect(serverIndex).toContain("const mode = requestedMode === 'central_bot'");
    expect(serverIndex).toContain("const preferredUserId = await getCurrentSessionUserId(req)");
    expect(serverIndex).toContain("const { userId } = await upsertPlatformIdentity('youtube', profile, preferredUserId)");
    expect(serverIndex).toContain("await upsertPlatformTokens('youtube', userId, profile.platformUserId, {");
    expect(serverIndex).toContain('await rotateAuthenticatedSession(req, res, userId)');
    expect(serverIndex).toContain("if (oauthMode !== 'viewer' && oauthProfile.channelResolved)");
    expect(serverIndex).toContain('upsertYoutubeStreamerChannelFromOAuthProfile(req, userId, profile)');
    expect(serverIndex).toContain("'youtube_channel_registration_required'");
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

  test('accepts managing moderators through an API moderation capability check', () => {
    const verifyStart = serverIndex.indexOf('async function verifyYoutubeBotModeratorRegistration');
    const verifyEnd = serverIndex.indexOf('async function sendYoutubeChat', verifyStart);
    const verifyBody = serverIndex.slice(verifyStart, verifyEnd);

    expect(serverIndex).toContain('async function youtubeBotApiDelete');
    expect(serverIndex).toContain("youtubeBotApiDelete('liveChat/messages', { id: messageId }");
    expect(serverIndex).toContain("reason === 'modificationNotAllowed'");
    expect(serverIndex).toContain('verified: protectedModeratorMessage');
    expect(verifyBody).toContain('authorRoleVerified || capabilityVerified');
    expect(verifyBody).toContain("reason = 'moderator_capability_verified'");
    expect(verifyBody).toContain("checkedBy: capabilityVerified ? 'liveChatMessages.delete' : 'liveChatMessages.list'");
    expect(verifyBody).toContain('verificationMessageDeleted: capability.deleted');
    expect(verifyBody).toContain('moderationCapabilityReason: capability.reason');
    expect(verifyBody).toContain('표준 또는 관리 운영자');
    expect(connectionPage).toContain('moderationCapabilityError?: string | null');
  });

  test('central YouTube bot deletion enforces server confirmation and records an admin audit result', () => {
    const helperStart = serverIndex.indexOf('async function recordYoutubeCentralBotAdminAudit');
    const routeStart = serverIndex.indexOf("app.delete('/api/youtube/bot'", helperStart);
    const routeEnd = serverIndex.indexOf("app.get('/api/youtube/me'", routeStart);
    const helperBody = serverIndex.slice(helperStart, routeStart);
    const routeBody = serverIndex.slice(routeStart, routeEnd);

    expect(helperStart).toBeGreaterThan(0);
    expect(helperBody).toContain("const action = 'youtube_central_bot_disconnect'");
    expect(helperBody).toContain('actor: {');
    expect(helperBody).toContain('result: normalizedResult');
    expect(helperBody).toContain("source: 'arubot_admin'");
    expect(routeBody).toContain("req.body?.confirmation !== '연결 해제'");
    expect(routeBody).toContain("error: 'confirmation_required'");
    expect(routeBody).toContain("result: 'confirmation_rejected'");
    expect(routeBody).toContain("result: 'failed'");
    expect(routeBody).toContain("status: 'success'");
    expect(routeBody).toContain('recordYoutubeCentralBotAdminAudit(admin');
  });

  test('separates viewer and central bot YouTube OAuth scopes', () => {
    expect(serverIndex).toContain('const YOUTUBE_BOT_AUTH_SCOPE = String(');
    expect(serverIndex).toContain('const YOUTUBE_CHANNEL_READ_AUTH_SCOPE = String(');
    expect(serverIndex).toContain('const YOUTUBE_VIEWER_AUTH_SCOPE = String(');
    expect(serverIndex).toContain('const YOUTUBE_STREAMER_AUTH_SCOPE = String(');
    expect(serverIndex).toContain("'https://www.googleapis.com/auth/youtube.readonly'");
    expect(serverIndex).toContain("'https://www.googleapis.com/auth/youtube.force-ssl'");
    expect(serverIndex).toContain('process.env.YOUTUBE_CHANNEL_READ_AUTH_SCOPE');
    expect(serverIndex).toMatch(/process\.env\.YOUTUBE_STREAMER_AUTH_SCOPE\s*\|\|\s*YOUTUBE_CHANNEL_READ_AUTH_SCOPE/);
    expect(serverIndex).toContain("requestedMode === 'viewer'");
    expect(serverIndex).toContain("mode === 'viewer'");
    expect(serverIndex).toContain('authUrl.searchParams.set(\'scope\', scope)');
    expect(serverIndex).toContain("if (mode === 'central_bot') authUrl.searchParams.set('include_granted_scopes', 'true')");
    expect(serverIndex).toContain("if (oauthMode !== 'viewer' && oauthProfile.channelResolved)");
    expect(serverIndex).toContain('normalizeGoogleTokenPayload(tokenPayload, {}, tokenFallbackScope)');
  });

  test('YouTube channel auto-detection uses WebSub plus bounded retries instead of polling', () => {
    expect(serverIndex).toContain('YOUTUBE_WEBSUB_HUB_URL');
    expect(serverIndex).toContain("app.get(YOUTUBE_WEBSUB_CALLBACK_PATH");
    expect(serverIndex).toContain("app.post(YOUTUBE_WEBSUB_CALLBACK_PATH");
    expect(serverIndex).toContain('extractYoutubeWebsubEntries');
    expect(serverIndex).toContain('YOUTUBE_WEBSUB_RETRY_DELAYS_MS');
    expect(serverIndex).toContain('scheduleYoutubeWebsubLiveRetry');
    expect(serverIndex).toContain('retryYoutubeTransientRequest(() => axios.post(YOUTUBE_WEBSUB_HUB_URL');
    expect(serverIndex).toContain("error.youtubeWebsubStatus = transient ? 'retry_pending' : 'subscribe_failed'");
    expect(connectionPage).toContain("if (status === 'retry_pending') return '자동 재시도 대기'");
  });

  test('operational status and health include YouTube sessions', () => {
    expect(serverIndex).toContain("app.get('/api/youtube/status'");
    expect(serverIndex).toContain("app.get('/api/platforms/status'");
    expect(serverIndex).toContain("mode: 'youtube-live-chat-api'");
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

  test('YouTube consent can be revoked and stale authorization is revalidated', () => {
    expect(serverIndex).toContain('async function revokeYoutubeOAuthGrant');
    expect(serverIndex).toContain("await deleteYoutubeAuthorizedData(ownerUserId, platformUserId, 'revoked')");
    expect(serverIndex).toContain('async function validateYoutubeAuthorizations');
    expect(serverIndex).toContain("await markPlatformTokenValidated('youtube', ownerUserId)");
    expect(serverDb).toContain('last_validated_at timestamptz not null default now()');
    expect(serverDb).toContain('consent_confirmed_at timestamptz not null default now()');
    expect(serverDb).toContain('last_used_at timestamptz not null default now()');
    expect(serverIndex).toContain("app.post('/api/auth/youtube/consent/confirm'");
    expect(serverIndex).toContain("app.post('/api/youtube/bot/consent/confirm'");
    expect(serverIndex).toContain('YOUTUBE_AUTH_INACTIVITY_MAX_AGE_MS');
    expect(serverIndex).toContain('async function validateYoutubeCentralBotAuthorization');
    expect(serverIndex).toContain("getValidYoutubeAccessToken(ownerUserId, { trackUse: false })");
    expect(serverIndex).toContain('const identity = await fetchGoogleYoutubeIdentityWithAccessToken(accessToken)');
    expect(serverIndex).toContain('assertGoogleYoutubeIdentityMatches(identity, user.platformUserId)');
    expect(connectionPage).toContain('YouTube 권한 보관');
    expect(connectionPage).toContain('OAuth 연결 해제');
    expect(arubotAdminPage).toContain('중앙 봇 OAuth 권한 보관');
    expect(blueprintPage).toContain('AruBot 초안 저장');
    expect(blueprintPage).toContain('YouTube OAuth 권한이나 YouTube API 데이터는 이 버튼으로 저장되지 않습니다.');
    expect(termsPage).toContain('YouTube 서비스 약관에 구속되는 것에 동의합니다.');
    expect(privacyPage).toContain('AruBot은 YouTube API Services를 사용합니다.');
    expect(privacyPage).toContain('https://myaccount.google.com/connections?filters=3,4');
    expect(privacyPage).toContain('광고가 포함되거나 노출될 수 있습니다.');
    expect(privacyPage).toContain('YouTube에 저장된 채널, 영상, 댓글, 라이브 채팅 원본을 삭제하거나 변경하지 않습니다.');
  });

  test('admin surfaces list YouTube consistently', () => {
    expect(dashboardPage).toContain("id: 'youtube'");
    expect(dashboardPage).toContain("apiUrl(`/api/auth/youtube/login?returnTo=${encodeURIComponent('/connection?platform=youtube')}`)");
    expect(dashboardPage).toContain("const href = provider.id === 'youtube' ? youtubeLoginHref : apiUrl(provider.loginPath)");
    expect(dashboardPage).toContain("{provider.label}{connected ? ' 다시 연결' : '로 로그인'}");
    expect(dashboardPage).not.toContain("loginPath: '/api/auth/youtube/login'");
    expect(dashboardPage).toContain("provider?.toLowerCase() === 'youtube'");
    expect(variablesPage).toContain("if (provider === 'youtube') return 'YouTube'");
    expect(serverIndex).toContain("const BOT_VARIABLE_PROVIDERS = ['chzzk', 'cime', 'youtube']");
    expect(navigation).toContain("endpoint: '/api/platforms/status'");
    expect(realtimeDiagnosticsPage).toContain("endpoint: '/api/platforms/status?refresh=true'");
  });
});
