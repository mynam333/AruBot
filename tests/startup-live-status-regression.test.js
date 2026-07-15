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
    const monitorStart = serverIndex.indexOf('async function runRegisteredRuntimeMonitor');
    const monitorEnd = serverIndex.indexOf('setTimeout(() =>', monitorStart);
    const monitorBody = serverIndex.slice(monitorStart, monitorEnd);

    expect(bootstrapBody).toContain('await bootstrapEnsureSessions()');
    expect(bootstrapBody).toContain('await bootstrapEnsureCimeSessions()');
    expect(bootstrapBody).toContain('await bootstrapEnsureYoutubeSessions()');
    expect(bootstrapBody.indexOf('await bootstrapEnsureSessions()')).toBeLessThan(bootstrapBody.indexOf('await bootstrapEnsureCimeSessions()'));
    expect(bootstrapBody.indexOf('await bootstrapEnsureCimeSessions()')).toBeLessThan(bootstrapBody.indexOf('await bootstrapEnsureYoutubeSessions()'));
    expect(serverIndex).toContain('async function runRegisteredRuntimeMonitor');
    expect(serverIndex).toContain('if (registeredRuntimeMonitorRunning) return false');
    expect(startupBody).toContain("runRegisteredRuntimeMonitor('startup')");
    expect(monitorBody).toContain('runtimeReadinessState.initialBootstrapCompleted = true');
    expect(startupBody).toContain('.catch((e) =>');
    expect(startupBody).toContain("runRegisteredRuntimeMonitor('scheduled').catch");
    expect(startupBody).toContain('REGISTERED_RUNTIME_MONITOR_INTERVAL_MS');
    expect(monitorBody).toContain("reason === 'startup'");
    expect(monitorBody).toContain('REGISTERED_PROVIDER_RECOVERY_INTERVAL_MS');
    expect(monitorBody).toContain('await bootstrapRegisteredChannelLiveStatuses(reason)');
    expect(serverIndex).toContain('await bootstrapEnsureSessions()');
    expect(startupBody).not.toContain('bootstrapEnsureSessions().catch');
    expect(startupBody).not.toContain('bootstrapEnsureCimeSessions().catch');
    expect(startupBody).not.toContain('bootstrapEnsureYoutubeSessions().catch');
  });

  test('CIME and YouTube bootstraps acquire ownership before external work and retry takeover', () => {
    const cimeStart = serverIndex.indexOf('async function bootstrapEnsureCimeSessions');
    const cimeEnd = serverIndex.indexOf('async function bootstrapEnsureYoutubeSessions', cimeStart);
    const cimeBody = serverIndex.slice(cimeStart, cimeEnd);
    const youtubeStart = cimeEnd;
    const youtubeEnd = serverIndex.indexOf('async function bootstrapRegisteredChannelLiveStatuses', youtubeStart);
    const youtubeBody = serverIndex.slice(youtubeStart, youtubeEnd);

    expect(cimeBody).toContain("listPlatformTokenUsers('cime')");
    expect(cimeBody).toContain("await ensureProviderRuntimeLease('cime', ownerUserId)");
    expect(cimeBody).toContain('await refreshCimeLiveStatus(ownerUserId, sid, channelId)');
    expect(cimeBody).toContain('await ensureCimeSession(ownerUserId)');
    expect(cimeBody.indexOf("await ensureProviderRuntimeLease('cime', ownerUserId)")).toBeLessThan(cimeBody.indexOf('await refreshCimeLiveStatus(ownerUserId, sid, channelId)'));
    expect(cimeBody).toContain("scheduleProviderRuntimeBootstrapRetry('cime')");
    expect(youtubeBody).toContain("listPlatformTokenUsers('youtube')");
    expect(youtubeBody).toContain("await ensureProviderRuntimeLease('youtube', ownerUserId)");
    expect(youtubeBody).toContain('await ensureYoutubeSession(ownerUserId)');
    expect(youtubeBody.indexOf("await ensureProviderRuntimeLease('youtube', ownerUserId)")).toBeLessThan(youtubeBody.indexOf('await ensureYoutubeSession(ownerUserId)'));
    expect(youtubeBody).not.toContain('allowSearch: true');
    expect(youtubeBody).toContain("scheduleProviderRuntimeBootstrapRetry('youtube')");
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
