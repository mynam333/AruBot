const path = require('path');
const { execFileSync } = require('child_process');

describe('OAuth state tokens', () => {
  let result;

  beforeAll(() => {
    const moduleUrl = new URL('../server/oauth-state.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const script = `
      const crypto = await import('node:crypto');
      const oauth = await import(${JSON.stringify(moduleUrl)});
      const secret = 'test-oauth-state-secret-that-is-long-enough';
      const now = 1_750_000_000_000;
      const state = oauth.createOAuthStateToken({
        provider: 'youtube',
        secret,
        now,
        nonce: '0123456789abcdef0123456789abcdef',
        extra: { mode: 'viewer', returnTo: '/viewer/connect?platform=youtube' },
      });
      const legacyNonce = 'fedcba9876543210fedcba9876543210';
      const legacyTs = now.toString(16).padStart(12, '0');
      const legacySignature = crypto.createHmac('sha256', secret)
        .update('youtube:' + legacyNonce + ':' + legacyTs)
        .digest('hex')
        .slice(0, 32);
      const legacyState = legacyNonce + legacyTs + legacySignature;
      console.log(JSON.stringify({
        state,
        valid: oauth.verifyOAuthStateToken({ provider: 'youtube', state, secret, now }),
        tampered: oauth.verifyOAuthStateToken({ provider: 'youtube', state: state.slice(0, -1) + (state.endsWith('a') ? 'b' : 'a'), secret, now }),
        wrongProvider: oauth.verifyOAuthStateToken({ provider: 'cime', state, secret, now }),
        expired: oauth.verifyOAuthStateToken({ provider: 'youtube', state, secret, now: now + 11 * 60 * 1000 }),
        unsigned: oauth.verifyOAuthStateToken({ provider: 'youtube', state: '0123456789abcdef0123456789abcdef', secret, now }),
        legacy: oauth.verifyOAuthStateToken({ provider: 'youtube', state: legacyState, secret, now }),
        forwardedOrigin: oauth.resolveOAuthRequestOrigin({
          protocol: 'http',
          host: 'arubotapi.yuaru.com',
          forwardedProto: 'https, http',
          forwardedHost: 'arubot.yuaru.com, arubotapi.yuaru.com',
        }),
        canonical: oauth.buildCanonicalOAuthStartUrl({
          requestOrigin: 'https://arubot.yuaru.com',
          originalUrl: '/api/auth/youtube/login?mode=viewer&returnTo=%2Fviewer%2Fconnect',
          redirectUri: 'https://arubotapi.yuaru.com/api/auth/youtube/callback',
        }),
        alreadyCanonical: oauth.buildCanonicalOAuthStartUrl({
          requestOrigin: 'https://arubotapi.yuaru.com',
          originalUrl: '/api/auth/youtube/login?mode=viewer',
          redirectUri: 'https://arubotapi.yuaru.com/api/auth/youtube/callback',
        }),
        schemeRelative: oauth.buildCanonicalOAuthStartUrl({
          requestOrigin: 'https://arubot.yuaru.com',
          originalUrl: '//evil.example/oauth?mode=viewer',
          redirectUri: 'https://arubotapi.yuaru.com/api/auth/youtube/callback',
        }),
      }));
    `;
    result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    }).trim());
  });

  test('preserves mode and return path in a signed restart-safe payload', () => {
    expect(result.state).toMatch(/^v2\./);
    expect(result.valid).toMatchObject({
      ok: true,
      version: 2,
      extra: { mode: 'viewer', returnTo: '/viewer/connect?platform=youtube' },
    });
  });

  test('rejects tampered, cross-provider, expired, and unsigned states', () => {
    expect(result.tampered).toMatchObject({ ok: false, reason: 'signature' });
    expect(result.wrongProvider).toMatchObject({ ok: false, reason: 'provider' });
    expect(result.expired).toMatchObject({ ok: false, reason: 'expired' });
    expect(result.unsigned).toMatchObject({ ok: false, reason: 'format' });
  });

  test('accepts still-valid signed v1 states during a rolling deployment', () => {
    expect(result.legacy).toMatchObject({ ok: true, version: 1 });
  });

  test('moves proxied starts to the callback origin without losing query parameters', () => {
    expect(result.forwardedOrigin).toBe('https://arubot.yuaru.com');
    expect(result.canonical).toBe('https://arubotapi.yuaru.com/api/auth/youtube/login?mode=viewer&returnTo=%2Fviewer%2Fconnect');
    expect(result.alreadyCanonical).toBeNull();
    expect(result.schemeRelative).toBe('https://arubotapi.yuaru.com/evil.example/oauth?mode=viewer');
  });
});
