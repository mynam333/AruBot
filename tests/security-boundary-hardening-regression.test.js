const crypto = require('crypto');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('security boundary hardening regressions', () => {
  const root = path.join(__dirname, '..');
  const serverIndex = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
  const supabase = fs.readFileSync(path.join(root, 'server', 'supabase.js'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  function sliceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  test('OAuth success rotates the session and logout revokes the database session', () => {
    const rotation = sliceBetween(serverIndex, 'async function rotateAuthenticatedSession', 'function setOAuthStateCookie');
    expect(rotation).toContain("crypto.randomBytes(32).toString('hex')");
    expect(rotation).toContain('await revokeSession(previousSid)');
    expect(rotation).toContain('await upsertSession(nextSid, normalizedUserId, 30)');
    expect(rotation).toContain("clearManagedCookie(res, 'sid')");
    expect(rotation).toContain('setCookieSid(res, nextSid)');

    const youtubeCallback = sliceBetween(serverIndex, "app.get('/api/auth/youtube/callback'", "app.get('/api/auth/youtube/token'");
    const cimeCallback = sliceBetween(serverIndex, "app.get('/api/auth/cime/callback'", "app.get('/api/auth/cime/token'");
    const chzzkCallback = sliceBetween(serverIndex, "app.get('/api/auth/chzzk/callback'", "app.get('/api/auth/chzzk/token'");
    expect(youtubeCallback).toContain('await rotateAuthenticatedSession(req, res, userId)');
    expect(cimeCallback).toContain('await rotateAuthenticatedSession(req, res, userId)');
    expect(chzzkCallback).toContain('await rotateAuthenticatedSession(req, res, accountUserId)');
    expect(chzzkCallback).toContain('await rotateTemporaryOAuthSession(req, res)');
    expect(chzzkCallback).not.toContain('const tempExisting = getCookieSid(req)');

    const logout = sliceBetween(serverIndex, "app.post('/api/auth/chzzk/logout'", '// Current user\'s channel info');
    expect(logout).toContain('const cookieSid = getCookieSid(req)');
    expect(logout).toContain('await revokeSession(cookieSid)');
    expect(supabase).toContain('export async function revokeSession(sid)');
    expect(supabase).toContain('.update({ revoked: true, expires_at: now, last_seen: now })');
  });

  test('credentialed HTTP and browser-session WebSockets use exact origin matching', () => {
    const originPolicy = sliceBetween(serverIndex, 'function normalizeOrigin', 'const corsOptions');
    expect(originPolicy).toContain('const ALLOWED_ORIGINS = new Set');
    expect(originPolicy).toContain('ALLOWED_ORIGINS.has(normalized)');
    expect(originPolicy).not.toContain("endsWith('.yuaru.com')");
    expect(originPolicy).not.toContain("endsWith('.yuaru.kr')");
    expect(originPolicy).toContain("'/api/video-donation/admin/ws'");
    expect(originPolicy).toContain("'/api/drawing-donation/admin/ws'");
    const originHelpers = new Function('URL', 'process', 'PORT', 'FRONTEND_ORIGIN', 'BACKEND_ORIGIN', `${originPolicy}; return { isTrustedOrigin, isTrustedWebSocketUpgradeOrigin };`)(
      URL,
      { env: {} },
      3001,
      'https://arubot.yuaru.com',
      'https://arubotapi.yuaru.com'
    );
    expect(originHelpers.isTrustedOrigin('https://arubot.yuaru.com')).toBe(true);
    expect(originHelpers.isTrustedOrigin('https://evil.yuaru.com')).toBe(false);
    expect(originHelpers.isTrustedWebSocketUpgradeOrigin('/api/video-donation/admin/ws', 'https://evil.yuaru.com')).toBe(false);
    expect(originHelpers.isTrustedWebSocketUpgradeOrigin('/api/video-donation/admin/ws', '')).toBe(false);
    expect(originHelpers.isTrustedWebSocketUpgradeOrigin('/api/video-donation/admin/ws', 'https://arubot.yuaru.com')).toBe(true);

    const upgradeDispatcher = sliceBetween(serverIndex, '// Single upgrade dispatcher', "wss.on('connection'");
    const originCheck = upgradeDispatcher.indexOf('isTrustedWebSocketUpgradeOrigin(u.pathname, req.headers.origin)');
    const firstUpgrade = upgradeDispatcher.indexOf('.handleUpgrade(');
    expect(originCheck).toBeGreaterThanOrEqual(0);
    expect(firstUpgrade).toBeGreaterThan(originCheck);
    expect(upgradeDispatcher).toContain('rejectWebSocketUpgrade(socket)');
  });

  test('browser token status endpoints never return reusable OAuth bearer tokens', () => {
    const youtubeToken = sliceBetween(serverIndex, "app.get('/api/auth/youtube/token'", "app.post('/api/auth/youtube/revoke'");
    const cimeToken = sliceBetween(serverIndex, "app.get('/api/auth/cime/token'", "app.post('/api/auth/cime/revoke'");
    const chzzkToken = sliceBetween(serverIndex, "app.get('/api/auth/chzzk/token'", "app.post('/api/auth/chzzk/revoke'");
    for (const route of [youtubeToken, cimeToken, chzzkToken]) {
      expect(route).toContain('connected: true');
      expect(route).toContain("res.setHeader('Cache-Control', 'no-store')");
      expect(route).not.toMatch(/return res\.json\(\{\s*accessToken\b/);
      expect(route).not.toMatch(/return res\.json\(\{[^}]*refreshToken\b/);
    }
  });

  test('YouTube WebSub subscriptions send a secret and callbacks verify HMAC bytes', () => {
    const subscribe = sliceBetween(serverIndex, 'async function subscribeYoutubeChannelWebsub', 'function buildYoutubeStreamerChannelFromProfile');
    expect(subscribe).toContain("body.set('hub.secret', websubSecret)");

    const signatureFunction = sliceBetween(serverIndex, 'function verifyYoutubeWebsubSignature', 'function scheduleYoutubeWebsubLiveRetry');
    expect(signatureFunction).toContain('crypto.createHmac(algorithm, secretText).update(body)');
    expect(signatureFunction).toContain('constantTimeEqualText(received, expected)');
    const verify = new Function('crypto', 'Buffer', 'constantTimeEqualText', `${signatureFunction}; return verifyYoutubeWebsubSignature;`)(
      crypto,
      Buffer,
      (left, right) => {
        const a = Buffer.from(String(left || ''), 'utf8');
        const b = Buffer.from(String(right || ''), 'utf8');
        return a.length === b.length && crypto.timingSafeEqual(a, b);
      }
    );
    const rawBody = Buffer.from('<feed><entry>테스트</entry></feed>', 'utf8');
    const secret = 'ytws_test_secret_32_bytes_long';
    const sha1 = crypto.createHmac('sha1', secret).update(rawBody).digest('hex');
    const sha256 = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    expect(verify(rawBody, secret, `sha1=${sha1}`)).toBe(true);
    expect(verify(rawBody, secret, `sha256=${sha256}`)).toBe(true);
    expect(verify(rawBody, secret, `sha256=${'0'.repeat(64)}`)).toBe(false);
    expect(verify(rawBody, secret, '')).toBe(false);

    const callback = sliceBetween(serverIndex, 'app.post(YOUTUBE_WEBSUB_CALLBACK_PATH', "app.get('/api/youtube/status'");
    expect(callback).toContain('verifyYoutubeWebsubSignature(rawBody, streamerChannel.websubSecret, signatureHeader)');
    expect(callback).toContain("return res.status(403).send('invalid websub signature')");
    expect(serverIndex).toContain('req.youtubeWebsubRawBody = Buffer.from(buffer)');
    expect(serverIndex).toContain('await subscribeYoutubeChannelWebsub(null, streamerChannel)');
  });

  test('production rejects known placeholder secrets', () => {
    const validation = sliceBetween(supabase, 'const PLACEHOLDER_SECRET_VALUES', 'function protectSecret');
    expect(validation).toContain("'replace_with_stable_random_32_bytes'");
    expect(validation).toContain("process.env.NODE_ENV === 'production'");
    expect(validation).toContain('must not use a placeholder value in production');
    expect(validation).toContain('OAuth state signing must use a non-placeholder secret in production');

    const script = "import { validateSecretEncryptionConfig } from './server/supabase.js'; validateSecretEncryptionConfig();";
    const rejected = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        ARUBOT_REQUIRE_TOKEN_ENCRYPTION_KEY: 'true',
        ARUBOT_SECRET_ENCRYPTION_KEY: 'replace_with_stable_random_32_bytes',
        OAUTH_STATE_SECRET: 'a'.repeat(32),
      },
    });
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain('must not use a placeholder value in production');

    const accepted = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        ARUBOT_REQUIRE_TOKEN_ENCRYPTION_KEY: 'true',
        ARUBOT_SECRET_ENCRYPTION_KEY: 'b'.repeat(32),
        OAUTH_STATE_SECRET: 'c'.repeat(32),
      },
    });
    expect(accepted.status).toBe(0);
  });

  test('Socket.IO 2.x remains pinned', () => {
    expect(packageJson.dependencies['socket.io-client']).toBe('2.0.3');
  });
});
