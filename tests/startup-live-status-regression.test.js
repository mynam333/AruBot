const fs = require('fs');
const path = require('path');

describe('startup live status refresh regression', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');

  test('startup and recurring monitor check registered channel live statuses sequentially without overlap', () => {
    const bootstrapStart = serverIndex.indexOf('async function bootstrapRegisteredChannelLiveStatuses');
    const bootstrapEnd = serverIndex.indexOf('setTimeout(() =>', bootstrapStart);
    const bootstrapBody = serverIndex.slice(bootstrapStart, bootstrapEnd);
    const startupStart = serverIndex.indexOf('setTimeout(() =>', bootstrapEnd);
    const startupEnd = serverIndex.indexOf('// =============================', startupStart);
    const startupBody = serverIndex.slice(startupStart, startupEnd);

    expect(bootstrapBody).toContain('await bootstrapEnsureSessions()');
    expect(bootstrapBody).toContain('await bootstrapEnsureCimeSessions()');
    expect(bootstrapBody).toContain('await bootstrapEnsureYoutubeSessions()');
    expect(bootstrapBody.indexOf('await bootstrapEnsureSessions()')).toBeLessThan(bootstrapBody.indexOf('await bootstrapEnsureCimeSessions()'));
    expect(bootstrapBody.indexOf('await bootstrapEnsureCimeSessions()')).toBeLessThan(bootstrapBody.indexOf('await bootstrapEnsureYoutubeSessions()'));
    expect(serverIndex).toContain('async function runRegisteredRuntimeMonitor');
    expect(serverIndex).toContain('if (registeredRuntimeMonitorRunning) return false');
    expect(startupBody).toContain("runRegisteredRuntimeMonitor('startup')");
    expect(startupBody).toContain('runtimeReadinessState.initialBootstrapCompleted = true');
    expect(startupBody).toContain('.catch((e) =>');
    expect(startupBody).toContain("runRegisteredRuntimeMonitor('scheduled').catch");
    expect(startupBody).toContain('REGISTERED_RUNTIME_MONITOR_INTERVAL_MS');
    expect(serverIndex).toContain("if (reason === 'startup')");
    expect(serverIndex).toContain('await bootstrapEnsureSessions()');
    expect(startupBody).not.toContain('bootstrapEnsureSessions().catch');
    expect(startupBody).not.toContain('bootstrapEnsureCimeSessions().catch');
    expect(startupBody).not.toContain('bootstrapEnsureYoutubeSessions().catch');
  });

  test('CIME and YouTube startup bootstraps force one live status refresh per registered account', () => {
    const cimeStart = serverIndex.indexOf('async function bootstrapEnsureCimeSessions');
    const cimeEnd = serverIndex.indexOf('async function bootstrapEnsureYoutubeSessions', cimeStart);
    const cimeBody = serverIndex.slice(cimeStart, cimeEnd);
    const youtubeStart = cimeEnd;
    const youtubeEnd = serverIndex.indexOf('async function bootstrapRegisteredChannelLiveStatuses', youtubeStart);
    const youtubeBody = serverIndex.slice(youtubeStart, youtubeEnd);

    expect(cimeBody).toContain("listPlatformTokenUsers('cime')");
    expect(cimeBody).toContain('await refreshCimeLiveStatus(ownerUserId, sid, channelId)');
    expect(cimeBody).toContain('await ensureCimeSession(ownerUserId)');
    expect(youtubeBody).toContain("listPlatformTokenUsers('youtube')");
    expect(youtubeBody).toContain('await refreshYoutubeLiveStatus(ownerUserId, sid, { force: true, allowSearch: true })');
    expect(youtubeBody).toContain('await ensureYoutubeSession(ownerUserId)');
  });

  test('CHZZK monitor resolves registered channels without depending on an open dashboard session', () => {
    const chzzkStart = serverIndex.indexOf('async function bootstrapEnsureSessions');
    const chzzkEnd = serverIndex.indexOf('async function bootstrapEnsureCimeSessions', chzzkStart);
    const chzzkBody = serverIndex.slice(chzzkStart, chzzkEnd);

    expect(chzzkBody).toContain('listAllSidsWithTokens()');
    expect(chzzkBody).toContain('resolveChzzkChannelUidsForSid(sid, settings)');
    expect(chzzkBody).toContain('refreshChzzkLiveStatusForSid(sid, { settings, channelUids, force: true })');
  });
});
