const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const root = path.join(__dirname, '..');
function load(file, context) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { ...context, exports, module: { exports } });
  return exports;
}
function tab(pathname = '/commands') {
  const data = new Map();
  const window = { location: { pathname, origin: 'https://arubot.test', hostname: 'arubot.test', protocol: 'https:', host: 'arubot.test' },
    sessionStorage: { getItem: (key) => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) } };
  const storage = load('src/shared/lib/bot-management-context.ts', { window });
  const http = load('src/shared/api/http.ts', { window, URL, process: { env: {} }, require: () => storage });
  return { window, storage, http };
}
test('target is isolated per tab and never changes another tab', () => {
  const a = tab(), b = tab();
  a.storage.setBotManagementOwner('target');
  expect(a.http.apiUrl('/api/bot/rules')).toBe('/api/bot/rules?botOwner=target');
  expect(b.http.apiUrl('/api/bot/rules')).toBe('/api/bot/rules');
  a.storage.setBotManagementOwner(null);
  expect(a.http.apiUrl('/api/bot/rules')).toBe('/api/bot/rules');
});
test('revocation or storage failure never retargets delayed writes to the actor', () => {
  const a = tab();
  a.storage.setBotManagementOwner('target');
  a.storage.retainBotManagementOwner('target');
  a.window.sessionStorage.getItem = () => { throw new Error('storage unavailable'); };
  expect(a.http.apiUrl('/api/bot/rules/upsert')).toBe('/api/bot/rules/upsert?botOwner=target');
  a.storage.clearBotManagementContext();
  expect(a.http.apiUrl('/api/bot/rules/upsert')).toBe('/api/bot/rules/upsert');
});
test('selected owner survives configured API origin and encoded existing query', () => {
  const a = tab(); a.storage.setBotManagementOwner('chzzk:target');
  const url = new URL(a.http.apiUrl('/api/channelpoints/list?q=a%26b', 'https://api.arubot.test'));
  expect(url.searchParams.get('q')).toBe('a&b');
  expect(url.searchParams.get('botOwner')).toBe('chzzk:target');
  expect(url.origin).toBe('https://api.arubot.test');
});
test.each(['/viewer/me', '/viewer/drawing/owner', '/c/channel/points', '/arubot-admin', '/drawing-lab'])('public or personal page %s never inherits selected owner', (pathname) => {
  const a = tab(pathname); a.storage.setBotManagementOwner('target');
  expect(a.http.apiUrl('/api/bot/settings')).toBe('/api/bot/settings');
});
test.each(['/api/auth/session', '/api/auth/logout', '/api/viewer/profile', '/api/public/channel/points', '/api/arubot-admin/console', '/api/youtube/bot/status', '/api/health'])('personal/system endpoint %s is never impersonated', (endpoint) => {
  const a = tab(); a.storage.setBotManagementOwner('target');
  expect(a.http.apiUrl(endpoint)).toBe(endpoint);
});
test('only channel admin WebSockets inherit target; viewer token and public prediction sockets do not', () => {
  const a = tab('/drawing-donations'); a.storage.setBotManagementOwner('target');
  expect(a.http.apiWsUrl('/api/drawing-donation/admin/ws')).toBe('wss://arubot.test/api/drawing-donation/admin/ws?botOwner=target');
  expect(a.http.apiWsUrl('/api/video-donation/admin/ws', 'https://api.arubot.test')).toBe('wss://api.arubot.test/api/video-donation/admin/ws?botOwner=target');
  expect(a.http.apiWsUrl('/api/prediction/ws?channelUid=channel')).not.toContain('botOwner');
  expect(a.http.apiWsUrl('/api/drawing-donation/ws?token=overlay')).not.toContain('botOwner');
});
