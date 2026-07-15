const fs = require('fs');
const path = require('path');

describe('running bot configuration refresh regression', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');

  test('command and action writes advance runtime revisions and wake connected providers', () => {
    expect(serverIndex).toContain('function markRuntimeConfigurationChanged');
    expect(serverIndex).toContain('runtimeConfigurationRevisions.set(normalizedSid, revision)');
    expect(serverIndex).toContain('wakeConnectedProviderRuntimes(normalizedSid, reason)');
    expect(serverIndex).toContain("markRuntimeConfigurationChanged(sid, 'bot_rule_upserted')");
    expect(serverIndex).toContain("markRuntimeConfigurationChanged(sid, 'bot_rule_deleted')");
    expect(serverIndex).toContain("markRuntimeConfigurationChanged(`user:${ownerUserId}`, 'action_blueprint_saved')");
    expect(serverIndex).toContain("markRuntimeConfigurationChanged(`user:${ownerUserId}`, 'action_blueprint_published')");
  });

  test('all provider chat processors read rules through the revision-aware runtime loader', () => {
    const chzzkStart = serverIndex.indexOf("socket.on('CHAT'");
    const chzzkEnd = serverIndex.indexOf("socket.on('DONATION'", chzzkStart);
    const youtubeStart = serverIndex.indexOf('async function processYoutubeChatAutomation');
    const youtubeEnd = serverIndex.indexOf('function closeYoutubeSession', youtubeStart);
    const cimeStart = serverIndex.indexOf('async function processCimeChatAutomation');
    const cimeEnd = serverIndex.indexOf('async function processCimeDonationAutomation', cimeStart);

    expect(serverIndex.slice(chzzkStart, chzzkEnd)).toContain('getRuntimeBotRulesWithDefaults(sid)');
    expect(serverIndex.slice(youtubeStart, youtubeEnd)).toContain('getRuntimeBotRulesWithDefaults(sid)');
    expect(serverIndex.slice(cimeStart, cimeEnd)).toContain('getRuntimeBotRulesWithDefaults(sid)');
    expect(serverIndex).toContain('if (getRuntimeConfigurationRevision(normalizedSid) !== revisionBeforeRead)');
    expect(serverIndex).toContain('const blueprint = await getRuntimeActionBlueprint(ownerUserId, idOrSlug)');
    expect(serverIndex).toContain('const publishedVersion = versions.find((version) => version?.published === true)');
    expect(serverIndex).toContain('version: publishedVersion');
  });

  test('admin runtime refresh reports remote ownership, missing sessions and provider failures', () => {
    const wakeStart = serverIndex.indexOf('async function wakeConnectedProviderRuntimes');
    const wakeEnd = serverIndex.indexOf('function markRuntimeConfigurationChanged', wakeStart);
    const wakeBody = serverIndex.slice(wakeStart, wakeEnd);
    const routeStart = serverIndex.indexOf("app.post('/api/arubot-admin/streamers/runtime-refresh'");
    const routeEnd = serverIndex.indexOf("app.get('/api/youtube/bot/status'", routeStart);
    const routeBody = serverIndex.slice(routeStart, routeEnd);

    expect(wakeBody).toContain('options.requireConnected === true');
    expect(wakeBody).toContain('const settled = await Promise.allSettled');
    expect(wakeBody).toContain('failedProviders.push');
    expect(wakeBody).toContain('const lostProviders = requireConnected');
    expect(wakeBody).toContain('connectedProvidersAfter');
    expect(routeBody).toContain('getArubotAdminRuntimeOwnership(ownerUserId)');
    expect(routeBody).toContain("error: 'managed_elsewhere'");
    expect(routeBody).toContain("state: 'no_local_session'");
    expect(routeBody).toContain("error: 'runtime_refresh_failed'");
    expect(routeBody).toContain("state: 'session_lost'");
    expect(routeBody).toContain('res.status(409)');
    expect(routeBody).toContain('res.status(502)');
    expect(routeBody).toContain('refreshedProviders: refresh.refreshedProviders');
  });
});
