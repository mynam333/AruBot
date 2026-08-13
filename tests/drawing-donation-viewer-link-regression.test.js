const fs = require('fs');
const path = require('path');

describe('drawing donation viewer link regression', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const adminPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'drawing-donation-page.tsx'), 'utf8');

  test('returns a login-wrapped viewer drawing URL for the current streamer', () => {
    const routeStart = serverIndex.indexOf("app.get('/api/drawing-donation/viewer-url'");
    const routeEnd = serverIndex.indexOf("app.get('/api/drawing-donation/live-playback'", routeStart);
    const routeBody = serverIndex.slice(routeStart, routeEnd);

    expect(routeBody).toContain('const ownerUserId = ownerUserIdFromSid(sid)');
    expect(routeBody).toContain('const publicUid = publicAccount');
    expect(routeBody).toContain('`youtube:${channelId}`');
    expect(routeBody).toContain('`/viewer/drawing/${encodeURIComponent(publicUid)}`');
    expect(routeBody).toContain('`/viewer/login?returnTo=${encodeURIComponent(drawingEditorPath)}`');
    expect(routeBody).toContain('ownerUserId');
    expect(routeBody).toContain('publicUid');
    expect(routeBody).toContain('donationPath');
  });

  test('uses the verified viewer URL and renders top-level short copy and share actions', () => {
    expect(adminPage).toContain('viewerDonationPath');
    expect(adminPage).toContain('setViewerDonationPath(viewerPayload.donationPath || \'\')');
    expect(adminPage).not.toContain("readJson<{ userId?: string | null }>('/api/account/platforms')");
    expect(adminPage).not.toContain('buildViewerDonationPath');
    expect(adminPage).not.toContain('setViewerPath');
    expect(adminPage).toContain('짧은 시청자 링크 복사');
    expect(adminPage.indexOf('짧은 시청자 링크 복사')).toBeLessThan(adminPage.indexOf('<CardTitle>접수 설정</CardTitle>'));
    expect(adminPage).not.toContain('<CardTitle>시청자 그림 후원 링크</CardTitle>');
    expect(adminPage).toContain('<ShareLinkActions');
    expect(adminPage).toContain('path={viewerDonationPath}');
    expect(adminPage).toContain('showCopy');
    expect(adminPage).toContain('disabled={!viewerDonationPath}');
  });
});
