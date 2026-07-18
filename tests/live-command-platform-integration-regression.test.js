const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
const liveActions = fs.readFileSync(path.join(root, 'server', 'live-command-actions.js'), 'utf8');
const livePermissions = fs.readFileSync(path.join(root, 'server', 'live-command-permissions.js'), 'utf8');
const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');

describe('platform-specific live command integration regression', () => {
  test('uses the documented CHZZK live setting and category contracts', () => {
    expect(server).toContain("`${OPENAPI_BASE}/open/v1/lives/setting`");
    expect(server).toContain("`${OPENAPI_BASE}/open/v1/categories/search`");
    expect(server).toContain("`${OPENAPI_BASE}/open/v1/channels/streaming-roles`");
    expect(server).toContain("params: { query: keyword, size: 50 }");
    expect(server).toContain("'Client-Id': CHZZK_CLIENT_ID");
    expect(server).toContain("'Client-Secret': CHZZK_CLIENT_SECRET");
    expect(server).toContain('categoryType: category.categoryType');
    expect(server).toContain('categoryId: category.categoryId');
    expect(server).toContain('{ defaultLiveTitle }');
  });

  test('uses the documented CIME live setting and category contracts with mandatory scopes', () => {
    expect(server).toContain("`${CIME_OPENAPI_BASE}/open/v1/lives/setting`");
    expect(server).toContain("`${CIME_OPENAPI_BASE}/open/v1/categories/search`");
    expect(server).toContain("`${CIME_OPENAPI_BASE}/open/v1/channels/streaming-roles`");
    expect(server).toContain("params: { keyword: keyword.slice(0, 100), size: 50 }");
    expect(server).toContain("'READ:LIVE_STREAM_SETTINGS'");
    expect(server).toContain("'WRITE:LIVE_STREAM_SETTINGS'");
    expect(server).toContain("'READ:USER'");
    expect(server).toContain('getMissingOAuthScopes(cimeTokenStatus.tokens.scope, CIME_REQUIRED_AUTH_SCOPES)');
    expect(server).toContain('reauthRequired: cimeReauthRequired');
    expect(envExample).toContain('READ:USER READ:CHANNEL');
    expect(envExample).toContain('READ:LIVE_STREAM_SETTINGS WRITE:LIVE_STREAM_SETTINGS');
    expect(livePermissions).toContain('managerChannelId');
    expect(livePermissions).toContain('userRole');
    expect(livePermissions).toContain("'streaming_channel_manager', 3");
    expect(livePermissions).toContain("'streaming_chat_manager', 2");
  });

  test('executes or strips live action tokens in every command ingress path', () => {
    expect(server).toContain('async function executeCommandLiveChangeTokens');
    expect(server).toContain('canManageLive: context.canManageLive');
    expect(server).toContain("provider: chatPostProvider || 'chzzk'");
    expect(server).toMatch(/provider:\s*'chzzk',\s*argsText:\s*restForVd,\s*canManageLive/);
    expect(server).toMatch(/provider:\s*'cime',\s*argsText,\s*canManageLive/);
    expect(server).toMatch(/provider:\s*'youtube',\s*argsText,\s*canManageLive:\s*false/);
    expect(server).toContain('canManageLive: () => resolveQueuedLiveManagePermission(sid, chatPost)');
    expect(server).toContain('liveManageActorId: resolvedUserId');
    expect(server).toContain('getCimeLiveActorRoleLevel(ownerUserId, entry.channelId, resolvedUserId, { force: true })');
    expect(server).not.toContain('chatPost?.canManageLive');
    expect(server).toContain('const canManageLive = canManageLiveSettings({ roleLevel, isOwner })');
    expect(liveActions).toContain('options.canManageLive');
    expect(livePermissions).toContain('resolveOptions.force === true');
    expect(server).toContain("'live_title_change'");
    expect(server).toContain("'live_game_change'");
  });

  test('loads placeholders and action chat replies from the triggering provider', () => {
    expect(server).toContain("getLiveInfoForSid(sid, { provider })");
    expect(server).toContain("substituteAllPlaceholders(responseToSend, sid, resolvedUserId, resolvedUsername, { provider: 'chzzk' })");
    expect(server).toContain("substituteAllPlaceholders(cleaned, sid, resolvedUserId, resolvedUsername, { provider: 'cime' })");
    expect(server).toContain("substituteAllPlaceholders(cleaned, sid, resolvedUserId, resolvedUsername, { provider: 'youtube' })");
    expect(server).toContain("const chatPostPlatform = String(chatPost?.provider || chatPost?.platform || '').toLowerCase()");
    expect(server).toMatch(/if \(!uids\.length\) \{\s*if \(normalizedProvider === 'chzzk'\) return null;/);
    expect(server).toMatch(/if \(normalizedProvider === 'chzzk'\) return null;\s*const cimeCached = userSubMonthsCache/);
    expect(server).toContain("entry.channelId || await resolveStreamerUidForSid(sid, 'cime')");
    expect(server).toContain('const cachedMatchesProvider = !supportedProvider || cachedProvider === supportedProvider');
    expect(server).toContain('filterLiveInfoByProvider(liveInfo, provider)');
    expect(server).toContain('Ignored cross-provider live info');
  });

  test('publishes both special variables in the command variable catalog', () => {
    expect(server).toContain("key: '${live.title_change}'");
    expect(server).toContain("key: '${live.game_change}'");
    expect(server).toContain("providers: ['chzzk', 'cime']");
    expect(server).toContain('스트리머 또는 매니저만 실행할 수 있으며');
  });
});
