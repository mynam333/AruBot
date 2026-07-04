const fs = require('fs');
const path = require('path');

describe('viewer YouTube account connection regression', () => {
  const viewerConnectPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'viewer', 'viewer-connect-page.tsx'), 'utf8');

  test('viewer connection page exposes YouTube as a normal viewer platform', () => {
    expect(viewerConnectPage).toContain("type ProviderId = 'chzzk' | 'cime' | 'youtube'");
    expect(viewerConnectPage).toContain("id: 'youtube'");
    expect(viewerConnectPage).toContain("loginPath: '/api/auth/youtube/login'");
    expect(viewerConnectPage).toContain("revokePath: '/api/auth/youtube/revoke'");
    expect(viewerConnectPage).toContain("provider === 'chzzk' || provider === 'cime' || provider === 'youtube'");
    expect(viewerConnectPage).toContain('{ chzzk: [], cime: [], youtube: [] }');
    expect(viewerConnectPage).toContain('CHZZK, CIME, YouTube');
  });
});
