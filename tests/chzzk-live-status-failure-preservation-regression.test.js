const fs = require('fs');
const path = require('path');

describe('CHZZK live status failure preservation regression', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');

  test('does not turn a total live-detail request failure into an offline transition', () => {
    const refreshStart = server.indexOf('async function refreshChzzkLiveStatusForSid');
    const refreshEnd = server.indexOf('async function isLiveAllowedForSid', refreshStart);
    const refresh = server.slice(refreshStart, refreshEnd);
    const failureStart = refresh.indexOf('if (successfulLiveChecks === 0)');
    const cacheWriteStart = refresh.indexOf('liveStatusCache.set(sid, {', failureStart);
    const offlineCloseStart = refresh.indexOf('closeChzzkChatSessionForOfflineSid', failureStart);

    expect(refresh).toContain('successfulLiveChecks += 1');
    expect(refresh).toContain('if (successfulLiveChecks === 0)');
    expect(refresh).toContain('stale: true');
    expect(refresh).toContain('live: !!cached.live');
    expect(failureStart).toBeGreaterThan(-1);
    expect(cacheWriteStart).toBeGreaterThan(failureStart);
    expect(offlineCloseStart).toBeGreaterThan(cacheWriteStart);
  });

  test('surfaces the live lookup failure to the streamer status endpoint', () => {
    const statusStart = server.indexOf("app.get('/api/platforms/status'");
    const statusEnd = server.indexOf("app.post('/api/cime/reset'", statusStart);
    const status = server.slice(statusStart, statusEnd);

    expect(status).toContain('const chzzkDiagnostic = chzzkRuntimeErrors.get(sid) || null');
    expect(status).toContain('lastError: chzzkRefreshError || chzzkDiagnostic?.message || null');
  });
});
