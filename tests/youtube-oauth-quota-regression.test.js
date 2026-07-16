const fs = require('fs');
const path = require('path');

describe('YouTube OAuth quota exhaustion', () => {
  const root = path.join(__dirname, '..');
  const serverIndex = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
  const connectionPage = fs.readFileSync(path.join(root, 'src', 'features', 'admin', 'connection-page.tsx'), 'utf8');
  const adminPage = fs.readFileSync(path.join(root, 'src', 'features', 'admin', 'arubot-admin-page.tsx'), 'utf8');
  const callbackStart = serverIndex.indexOf("app.get('/api/auth/youtube/callback'");
  const callbackEnd = serverIndex.indexOf("app.get('/api/auth/youtube/token'", callbackStart);
  const callback = serverIndex.slice(callbackStart, callbackEnd);

  test('returns a specific retryable reason without treating quota exhaustion as invalid authorization', () => {
    expect(callback).toContain('if (isYoutubeQuotaExceededError(e))');
    expect(callback).toContain("reason: 'quota_exceeded'");
    expect(callback).toContain("callbackOauthMode === 'central_bot'");
    expect(callback).toContain('getAuthRedirectUrlWithState(req, callbackStateValidation, params)');
    expect(callback.indexOf('if (isYoutubeQuotaExceededError(e))')).toBeLessThan(callback.indexOf("console.error('[YouTube] Callback error'"));
  });

  test('shows an actionable quota message on streamer and central-bot connection screens', () => {
    expect(connectionPage).toContain("reason === 'quota_exceeded'");
    expect(connectionPage).toContain('YouTube API 할당량이 소진되어 채널 확인을 완료하지 못했습니다.');
    expect(adminPage).toContain("reason === 'quota_exceeded'");
    expect(adminPage).toContain('YouTube API 할당량이 소진되어 봇 채널 확인을 완료하지 못했습니다.');
  });
});
