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
});
