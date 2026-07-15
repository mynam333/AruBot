const fs = require('fs');
const path = require('path');

describe('session bootstrap security', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');

  test('getPartitionId must not attach arbitrary stored tokens to an unmapped cookie', () => {
    const start = serverIndex.indexOf('async function getPartitionId');
    const end = serverIndex.indexOf('// Helper to compute expiry timestamp', start);
    const body = serverIndex.slice(start, end);

    expect(body).toContain('const tempPid = `sid:${sidToken}`');
    expect(body).toContain('await getTokens(tempPid)');
    expect(body).not.toContain('getAnyTokens');
    expect(body).not.toContain('Fallback context cached');
  });

  test('manual CHZZK session attach only uses temporary tokens bound to the current cookie', () => {
    const start = serverIndex.indexOf("app.post('/api/auth/chzzk/session/attach'");
    const end = serverIndex.indexOf('// Helper to get a valid access token', start);
    const body = serverIndex.slice(start, end);

    expect(body).toContain('const originSid = `sid:${cookieSid}`');
    expect(body).toContain('const tempTokens = await getTokens(originSid)');
    expect(body).toContain('No temporary tokens for current session');
    expect(body).not.toContain('getAnyTokens');
  });

  test('OAuth state validation requires a signed browser-bound cookie and rejects replay', () => {
    const start = serverIndex.indexOf('function consumeOAuthState');
    const end = serverIndex.indexOf('// --- API Key management endpoints', start);
    const body = serverIndex.slice(start, end);

    expect(body).toContain('const signedCookieMatches = signedMatches && cookieMatches');
    expect(body).toContain('const legacyContextAvailable = signedState.version !== 1 || storeMatches');
    expect(body).toContain('const ok = signedCookieMatches && !alreadyConsumed && legacyContextAvailable');
    expect(body).toContain('extra: ok ? { ...signedExtra, ...storedExtra } : {}');
    expect(body).not.toContain('ok: storeMatches || signedCookieMatches');
    expect(body).not.toContain('ok: cookieMatches || storeMatches || signedMatches');
  });

  test('OAuth starts canonicalize before state creation and disable caching', () => {
    const start = serverIndex.indexOf("app.get('/api/auth/youtube/login'");
    const end = serverIndex.indexOf("app.get('/api/youtube/bot/login'", start);
    const body = serverIndex.slice(start, end);

    expect(body).toContain('setOAuthNoStoreHeaders(res)');
    expect(body).toContain('redirectOAuthStartToCanonicalOrigin(req, res, YOUTUBE_REDIRECT_URI)');
    expect(serverIndex).toContain("forwardedHost: req.get('x-forwarded-host')");
    expect(body.indexOf('redirectOAuthStartToCanonicalOrigin')).toBeLessThan(body.indexOf("createOAuthState('youtube'"));
  });
});
