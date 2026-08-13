const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const component = fs.readFileSync(path.join(root, 'src', 'components', 'ui', 'share-link-actions.tsx'), 'utf8');
const shareLibrary = fs.readFileSync(path.join(root, 'src', 'shared', 'lib', 'share-links.ts'), 'utf8');
const publicChannel = fs.readFileSync(path.join(root, 'src', 'features', 'public', 'public-channel-page.tsx'), 'utf8');
const viewerPoints = fs.readFileSync(path.join(root, 'src', 'features', 'viewer', 'viewer-points-page.tsx'), 'utf8');
const drawingAdmin = fs.readFileSync(path.join(root, 'src', 'features', 'admin', 'drawing-donation-page.tsx'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'src', 'features', 'admin', 'dashboard-page.tsx'), 'utf8');
const shortRoute = fs.readFileSync(path.join(root, 'src', 'app', '(public)', 's', '[code]', 'route.ts'), 'utf8');
const viewerTokenPanel = fs.readFileSync(path.join(root, 'src', 'features', 'admin', 'viewer-token-panel.tsx'), 'utf8');
const automations = fs.readFileSync(path.join(root, 'src', 'features', 'admin', 'automations-page.tsx'), 'utf8');

describe('short-link sharing UI regression', () => {
  test('shared actions create links lazily and support native share plus clipboard fallback', () => {
    expect(shareLibrary).toContain("fetch(apiUrl('/api/short-links')");
    expect(component).toContain("typeof navigator.share === 'function'");
    expect(component).toContain("error.name === 'AbortError'");
    expect(shareLibrary).toContain("document.execCommand('copy')");
    expect(shareLibrary).toContain('SHORT_LINK_CACHE_LIMIT = 64');
    expect(component).not.toContain('useEffect(');
  });

  test('all public channel surfaces and viewer point cards expose the shared action', () => {
    expect(publicChannel).toContain('<ShareLinkActions');
    expect(publicChannel).toContain('sharePath={pagePath}');
    expect(publicChannel).toContain('sharePath={`/c/${encodedChannelUid}`}');
    expect(viewerPoints.match(/<ShareLinkActions/g)?.length).toBeGreaterThanOrEqual(2);
    expect(dashboard).toContain('<ShareLinkActions');
  });

  test('the longest drawing donation link is shortened from its owner-only admin surface', () => {
    expect(drawingAdmin).toContain('copyLabel="짧은 시청자 링크 복사"');
    expect(drawingAdmin).toContain('path={viewerDonationPath}');
  });

  test('the frontend short route validates both code and a relative target before redirecting', () => {
    expect(shortRoute).toContain('SHORT_CODE_PATTERN');
    expect(shortRoute).toContain("path.startsWith('//')");
    expect(shortRoute).toContain("path.includes('\\\\')");
    expect(shortRoute).toContain('status: 307');
    expect(shortRoute).toContain('Location: path');
    expect(shortRoute).toContain("'X-Robots-Tag': 'noindex, follow'");
    expect(shortRoute).toContain("response.status === 404");
    expect(shortRoute).toContain("503");
  });

  test('secret OBS and control URL surfaces are not wired to the short-link component', () => {
    expect(viewerTokenPanel).not.toContain('ShareLinkActions');
    expect(automations).not.toContain('ShareLinkActions');
  });
});
