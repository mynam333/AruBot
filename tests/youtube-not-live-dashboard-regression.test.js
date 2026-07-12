const fs = require('fs');
const path = require('path');

describe('YouTube not_live dashboard regression', () => {
  const root = path.join(__dirname, '..');
  const dashboard = fs.readFileSync(path.join(root, 'src', 'features', 'admin', 'dashboard-page.tsx'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');

  test('treats not_live as a normal waiting state even before live resolves to false', () => {
    const helperStart = dashboard.indexOf('function platformRuntimeError');
    const helperEnd = dashboard.indexOf('function platformRuntimeLabel', helperStart);
    const helper = dashboard.slice(helperStart, helperEnd);

    expect(helper).toContain("if (normalizedError === 'not_live') return null");
    expect(helper.indexOf("normalizedError === 'not_live'")).toBeLessThan(helper.indexOf("item?.live === false"));
  });

  test('does not store or expose not_live as a YouTube runtime error', () => {
    const ensureStart = server.indexOf('async function ensureYoutubeSession');
    const ensureEnd = server.indexOf('function firstNonEmptyText', ensureStart);
    const ensure = server.slice(ensureStart, ensureEnd);
    const statusStart = server.indexOf("app.get('/api/platforms/status'");
    const statusEnd = server.indexOf("app.post('/api/cime/reset'", statusStart);
    const status = server.slice(statusStart, statusEnd);

    expect(ensure).toContain("entry.lastError = liveState.live ? 'live_chat_unavailable' : null");
    expect(status).toContain("String(youtubeLastError || '').trim().toLowerCase() === 'not_live'");
    expect(status).toContain('lastError: visibleYoutubeLastError');
  });
});
