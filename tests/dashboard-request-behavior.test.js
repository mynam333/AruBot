const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/features/admin/dashboard-page.tsx'), 'utf8');
const ast = ts.createSourceFile('dashboard.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'loadDashboard') callback = node.initializer.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
const compiled = ts.transpileModule(`return (${callback});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const ok = (data) => ({ ok: true, status: 200, data });
const fail = (status, message) => ({ ok: false, status, data: null, message });
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function harness() {
  const state = { dashboardData: null, loading: true, refreshing: false, pendingDetails: new Set(), error: null };
  const dispatchEvent = jest.fn();
  const loadRequest = { current: null };
  const readJsonResult = jest.fn(async (url) => {
    if (url === '/api/account/platforms') return ok({ platforms: [{ provider: 'chzzk', channel_id: 'channel' }] });
    if (url === '/api/youtube/streamer-channel') return ok({ configured: false });
    if (url === '/api/bot/settings') return ok({ settings: { botEnabled: true } });
    if (url === '/api/bot/stats') return ok({ stats: { commandsHandled: 12 } });
    if (url === '/api/video-donation/queue') return ok({ items: [{ id: 'item' }] });
    return ok({ items: [{ provider: 'chzzk', connected: true }] });
  });
  const deps = {
    connectionReadable: true, settingsReadable: true, commandsReadable: true, videoReadable: true,
    loadRequest, hasLoadedRef: { current: false }, readJsonResult,
    AbortController, Event, window: { dispatchEvent },
    ...Object.fromEntries(Object.keys(state).map((key) => [`set${key[0].toUpperCase()}${key.slice(1)}`,
      (next) => { state[key] = typeof next === 'function' ? next(state[key]) : next; }])),
  };
  return { state, loadRequest, readJsonResult, dispatchEvent,
    load: new Function(...Object.keys(deps), compiled)(...Object.values(deps)) };
}

test('initial dashboard loads runtime state without forcing platform API refreshes', async () => {
  const h = harness(); await h.load();
  expect(h.readJsonResult.mock.calls.map(([url]) => url)).toContain('/api/platforms/status');
  expect(h.readJsonResult.mock.calls.map(([url]) => url)).not.toContain('/api/platforms/status?refresh=true');
  await h.load(undefined, true);
  expect(h.readJsonResult.mock.calls.map(([url]) => url)).toContain('/api/platforms/status?refresh=true');
});

test('a slow runtime request does not withhold completed settings, stats or queue results', async () => {
  const h = harness(), slow = deferred();
  const read = h.readJsonResult.getMockImplementation();
  h.readJsonResult.mockImplementation((url) => url === '/api/platforms/status' ? slow.promise : read(url));
  const pending = h.load(); await flush();
  expect(h.state.dashboardData.settings).toEqual({ botEnabled: true });
  expect(h.state.dashboardData.stats).toEqual({ commandsHandled: 12 });
  expect(h.state.dashboardData.queue).toEqual({ items: [{ id: 'item' }] });
  expect([...h.state.pendingDetails]).toEqual(['platformStatus']);
  expect(h.state.loading).toBe(false);
  slow.resolve(ok({ items: [] })); await pending;
  expect(h.state.pendingDetails.size).toBe(0);
  expect(h.state.refreshing).toBe(false);
});

test('repeated refresh actions do not duplicate an in-flight load', async () => {
  const h = harness(), slow = deferred();
  h.readJsonResult.mockImplementationOnce(() => slow.promise);
  const pending = h.load(); await flush();
  const controller = h.loadRequest.current;
  await h.load(); await h.load();
  expect(h.readJsonResult).toHaveBeenCalledTimes(2);
  expect(controller.signal.aborted).toBe(false);
  slow.resolve(ok({ platforms: [] })); await pending;
  expect(h.loadRequest.current).toBeNull();
});

test.each([403, 408, 503])('HTTP %i on a detail stays visible, not an empty successful queue', async (status) => {
  const h = harness();
  const read = h.readJsonResult.getMockImplementation();
  h.readJsonResult.mockImplementation((url) => url === '/api/video-donation/queue'
    ? Promise.resolve(fail(status, 'queue unavailable')) : read(url));
  await h.load();
  expect(h.state.error).toContain('queue unavailable');
  expect(h.state.dashboardData.queue).toBeNull();
  expect(h.state.dashboardData.stats.commandsHandled).toBe(12);
  expect(h.state.pendingDetails.size).toBe(0);
});

test('a partial base failure remains visible even if the other base request succeeds', async () => {
  const h = harness();
  h.readJsonResult.mockResolvedValueOnce(fail(403, 'profile forbidden'));
  await h.load();
  expect(h.state.error).toBe('profile forbidden');
});

test('401 triggers session expiry rather than showing stale statistics as success', async () => {
  const h = harness(); h.readJsonResult.mockResolvedValueOnce(fail(401, 'login required'));
  await h.load();
  expect(h.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'arubot:session-expired' }));
  expect(h.state.dashboardData).toBeNull();
});

test('cancelled manual requests cannot update state after unmount', async () => {
  const h = harness(), slow = deferred();
  h.readJsonResult.mockImplementationOnce(() => slow.promise);
  const pending = h.load(); await flush();
  h.loadRequest.current.abort();
  slow.resolve(ok({ platforms: [{ provider: 'cime' }] })); await pending;
  expect(h.state.dashboardData).toBeNull();
  expect(h.state.error).toBeNull();
});

test('an unrequested transport abort is visible and never leaks its raw DOMException text', async () => {
  const h = harness();
  h.readJsonResult.mockRejectedValueOnce(new DOMException('signal is aborted without reason', 'AbortError'));
  await h.load();
  expect(h.state.error).toBeTruthy();
  expect(h.state.error).not.toContain('signal is aborted');
  expect(h.state.refreshing).toBe(false);
});
