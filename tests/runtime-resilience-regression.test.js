const fs = require('fs');
const path = require('path');

describe('runtime resilience regression', () => {
  const projectRoot = path.join(__dirname, '..');
  const serverIndex = fs.readFileSync(path.join(projectRoot, 'server', 'index.js'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'));

  function sliceBetween(startMarker, endMarker, source = serverIndex) {
    const start = source.indexOf(startMarker);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = source.indexOf(endMarker, start + startMarker.length);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  function topLevelFunctionSource(functionName) {
    const signatures = [`function ${functionName}(`, `async function ${functionName}(`];
    const starts = signatures
      .map((signature) => serverIndex.indexOf(signature))
      .filter((index) => index >= 0);
    expect(starts.length).toBeGreaterThan(0);
    const start = Math.min(...starts);
    const nextFunctionCandidates = [
      serverIndex.indexOf('\nfunction ', start + 1),
      serverIndex.indexOf('\nasync function ', start + 1),
    ].filter((index) => index > start);
    const end = nextFunctionCandidates.length ? Math.min(...nextFunctionCandidates) : serverIndex.length;
    return serverIndex.slice(start, end);
  }

  function intervalGuard(segment, label) {
    const guardMatch = segment.match(/if\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*(?:\{\s*)?return\b/);
    expect(guardMatch).not.toBeNull();
    const guard = guardMatch[1];
    expect(segment).toMatch(new RegExp(`\\b${guard}\\s*=\\s*true\\b`));
    expect(segment).toMatch(new RegExp(`finally\\s*\\{[\\s\\S]*?\\b${guard}\\s*=\\s*false\\b`));
    expect(label).toBeTruthy();
    return guard;
  }

  test('platform status GET is observational and never disconnects provider runtimes', () => {
    const statusRoute = sliceBetween(
      "app.get('/api/platforms/status'",
      "app.post('/api/cime/reset'",
    );

    expect(statusRoute).not.toContain('disconnectProviderRuntimeState(');
  });

  test('session validation never ends a live DB session from an unknown or cached offline status', () => {
    const validation = topLevelFunctionSource('validateAndRecoverSessionState');

    expect(validation).toMatch(/updateSessionState\s*\(\s*sid\s*,\s*true\b/);
    expect(validation).not.toMatch(/updateSessionState\s*\(\s*sid\s*,\s*false\b/);
    expect(validation).not.toContain('liveStatus?.live || false');
  });

  test('CIME and YouTube reconnect paths delegate to the shared recovery supervisor', () => {
    const recoveryScheduler = topLevelFunctionSource('scheduleProviderSessionRecovery');
    const youtubeReconnect = topLevelFunctionSource('scheduleYoutubeReconnect');
    const cimeSessionStart = serverIndex.indexOf('async function ensureCimeSession');
    expect(cimeSessionStart).toBeGreaterThanOrEqual(0);
    const cimeCloseStart = serverIndex.indexOf("ws.on('close'", cimeSessionStart);
    expect(cimeCloseStart).toBeGreaterThan(cimeSessionStart);
    const cimeCloseEnd = serverIndex.indexOf("ws.on('error'", cimeCloseStart);
    expect(cimeCloseEnd).toBeGreaterThan(cimeCloseStart);
    const cimeClose = serverIndex.slice(cimeCloseStart, cimeCloseEnd);

    expect(recoveryScheduler).toMatch(/providerRuntimeRecoverySupervisor\s*\.\s*schedule\s*\(/);
    expect(youtubeReconnect).toContain('scheduleProviderSessionRecovery(');
    expect(youtubeReconnect).toMatch(/youtube/i);
    expect(cimeClose).toContain('scheduleProviderSessionRecovery(');
    expect(cimeClose).toMatch(/cime/i);
  });

  test('treats a YouTube 503 as recoverable without surfacing a permanent attention error', () => {
    const transientClassifier = topLevelFunctionSource('isYoutubeTransientError');
    const reconnectDelay = topLevelFunctionSource('getYoutubeReconnectDelayForError');
    const visibleError = topLevelFunctionSource('visibleYoutubeRuntimeError');
    const adminRuntime = topLevelFunctionSource('enrichArubotAdminStreamerRuntime');
    const statusRoute = sliceBetween(
      "app.get('/api/platforms/status'",
      "app.post('/api/cime/reset'",
    );

    expect(transientClassifier).toContain('503');
    expect(reconnectDelay).toContain('15 * 1000');
    expect(visibleError).toContain('options.recovering === true');
    expect(visibleError).toContain('options.streamConnected === true');
    expect(visibleError).toContain('isYoutubeTransientError(error)');
    expect(adminRuntime).toContain("getProviderSessionRecoveryStatus(provider, ownerUserId)");
    expect(adminRuntime).toContain("else if (recovering) status = 'checking'");
    expect(statusRoute).toContain('recovering: !!youtubeRecovery');
    expect(statusRoute).toContain('visibleYoutubeRuntimeError(youtubeRuntimeError');
  });

  test('session validation and macro delivery have separate non-overlapping guards', () => {
    const sessionMarker = serverIndex.indexOf('[Session-Validation] Starting');
    expect(sessionMarker).toBeGreaterThanOrEqual(0);
    const sessionStart = serverIndex.lastIndexOf('setInterval(', sessionMarker);
    const sessionEndMarker = '}, 10 * 60 * 1000);';
    const sessionEnd = serverIndex.indexOf(sessionEndMarker, sessionMarker);
    expect(sessionStart).toBeGreaterThanOrEqual(0);
    expect(sessionEnd).toBeGreaterThan(sessionMarker);
    const sessionCycle = serverIndex.slice(sessionStart, sessionEnd + sessionEndMarker.length);

    const macroMarker = serverIndex.indexOf('Macro runner error:');
    expect(macroMarker).toBeGreaterThanOrEqual(0);
    const macroStart = serverIndex.lastIndexOf('setInterval(', macroMarker);
    const macroEndMarker = '}, 1000);';
    const macroEnd = serverIndex.indexOf(macroEndMarker, macroMarker);
    expect(macroStart).toBeGreaterThanOrEqual(0);
    expect(macroEnd).toBeGreaterThan(macroMarker);
    const macroCycle = serverIndex.slice(macroStart, macroEnd + macroEndMarker.length);

    const sessionGuard = intervalGuard(sessionCycle, 'session validation');
    const macroGuard = intervalGuard(macroCycle, 'macro delivery');
    expect(sessionGuard).not.toBe(macroGuard);
    expect(sessionCycle).not.toMatch(new RegExp(`\\b${macroGuard}\\b`));
    expect(macroCycle).not.toMatch(new RegExp(`\\b${sessionGuard}\\b`));
  });

  test('shutdown cancels recovery and snapshots leases before closing provider sessions', () => {
    const shutdown = sliceBetween(
      'async function gracefulShutdown(',
      "process.on('SIGTERM'",
    );
    const cancelAllIndex = shutdown.search(/providerRuntimeRecoverySupervisor\s*\.\s*cancelAll\s*\(/);
    const leaseSnapshotIndex = shutdown.indexOf('const leasesToRelease = Array.from(providerRuntimeLeases.values())');
    const firstYoutubeCloseIndex = shutdown.indexOf('closeYoutubeSession(');
    const firstCimeCloseIndex = shutdown.indexOf('closeCimeSession(');

    expect(cancelAllIndex).toBeGreaterThanOrEqual(0);
    expect(leaseSnapshotIndex).toBeGreaterThanOrEqual(0);
    expect(firstYoutubeCloseIndex).toBeGreaterThanOrEqual(0);
    expect(firstCimeCloseIndex).toBeGreaterThanOrEqual(0);
    expect(cancelAllIndex).toBeLessThan(firstYoutubeCloseIndex);
    expect(cancelAllIndex).toBeLessThan(firstCimeCloseIndex);
    expect(leaseSnapshotIndex).toBeLessThan(firstYoutubeCloseIndex);
    expect(leaseSnapshotIndex).toBeLessThan(firstCimeCloseIndex);
    expect(shutdown).toMatch(/Promise\.allSettled\s*\(\s*leasesToRelease\.map/);
  });

  test('Socket.IO client remains pinned to the CHZZK-compatible exact version', () => {
    expect(packageJson.dependencies?.['socket.io-client']).toBe('2.0.3');
    expect(packageLock.packages?.['']?.dependencies?.['socket.io-client']).toBe('2.0.3');
    expect(packageLock.packages?.['node_modules/socket.io-client']?.version).toBe('2.0.3');
  });
});
