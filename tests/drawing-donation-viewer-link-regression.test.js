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
    expect(routeBody).toContain('`/viewer/drawing/${encodeURIComponent(ownerUserId)}`');
    expect(routeBody).toContain('`/viewer/login?returnTo=${encodeURIComponent(drawingEditorPath)}`');
    expect(routeBody).toContain('ownerUserId');
    expect(routeBody).toContain('donationPath');
  });

  test('builds a backward-compatible viewer URL and renders a top-level copy button', () => {
    expect(adminPage).toContain('viewerDonationPath');
    expect(adminPage).toContain('viewerDonationUrl');
    expect(adminPage).toContain("readJson<{ userId?: string | null }>('/api/account/platforms')");
    expect(adminPage).toContain('buildViewerDonationPath(viewerPayload.ownerUserId || accountPayload.userId)');
    expect(adminPage).toContain('`/viewer/login?returnTo=${encodeURIComponent(drawingEditorPath)}`');
    expect(adminPage).not.toContain('setViewerPath');
    expect(adminPage).toContain('시청자 링크 복사');
    expect(adminPage.indexOf('시청자 링크 복사')).toBeLessThan(adminPage.indexOf('<CardTitle>접수 설정</CardTitle>'));
    expect(adminPage).not.toContain('<CardTitle>시청자 그림 후원 링크</CardTitle>');
    expect(adminPage).toContain('const copyViewerDonationLink = useCallback(async () =>');
    expect(adminPage).toContain("readJson<{ path?: string; donationPath?: string | null; ownerUserId?: string | null }>('/api/drawing-donation/viewer-url')");
    expect(adminPage).toContain('onClick={copyViewerDonationLink}');
    expect(adminPage).not.toContain('disabled={!viewerDonationUrl}');
    expect(adminPage).toContain('disabled={viewerLinkPending}');
    expect(adminPage).toContain("document.execCommand('copy')");
  });
});
