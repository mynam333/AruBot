const fs = require('fs');
const path = require('path');

const root = process.cwd();

describe('server local agent network hardening', () => {
  const serverIndex = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');

  test('production server binds to loopback unless an explicit host is configured', () => {
    expect(serverIndex).toContain("const SERVER_HOST = String(process.env.SERVER_HOST || process.env.ARUBOT_SERVER_HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '')).trim()");
    expect(serverIndex).toContain('app.listen(PORT, SERVER_HOST');
  });

  test('local agent websocket authentication does not accept query string tokens', () => {
    const start = serverIndex.indexOf("if (u.pathname === '/api/automations/local-agent/ws')");
    const routeStart = serverIndex.indexOf("console.log('[automation local ws] initializing", 0);
    const routeEnd = serverIndex.indexOf('// --- WebSocket for WARUDO direct push ---', routeStart);
    const routeBody = serverIndex.slice(routeStart, routeEnd);

    expect(start).toBeGreaterThan(-1);
    expect(routeBody).toContain("req.headers['x-local-agent-token']");
    expect(routeBody).not.toContain("url.searchParams.get('token')");
  });
});
