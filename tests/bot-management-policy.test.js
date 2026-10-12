const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');

const root = path.join(__dirname, '..');
const policyCode = fs.readFileSync(path.join(root, 'shared/bot-management-policy.js'), 'utf8');
const serviceCode = fs.readFileSync(path.join(root, 'server/bot-management.js'), 'utf8');
const sandbox = { URL, console, setInterval, clearInterval, module: { exports: {} } };
vm.runInNewContext(`${policyCode.replace(/^export /gm, '')}
${serviceCode.replace(/^import[\s\S]*?from '[^']+';\s*/, '').replace(/^export /gm, '')}
module.exports = { normalizeBotManagerScopes, normalizeBotOwner, hasBotManagerScope,
botManagementRoutePolicy, canUseBotManagementRoute, filterBotManagerSettings,
mergeBotManagerSettings, assertBotManagerEffects, redactBotManagerLogSecrets, requestedBotOwner, createBotManagement };`, sandbox);
const policy = sandbox.module.exports;
const manager = (scopes = ['*']) => ({ ownerUserId: 'owner', role: 'manager', displayName: 'Channel', scopes });
const req = (url = '/api/bot/rules?botOwner=owner', method = 'GET') => ({ url, method, headers: {}, query: {}, body: {} });
function harness(access = manager()) {
  const store = {
    getAccess: jest.fn(async () => access), listChannels: jest.fn(async () => []),
    listMembers: jest.fn(async () => []), recordAction: jest.fn(async () => {}),
    searchUsers: jest.fn(async () => []), addMember: jest.fn(async () => ({ id: 'grant' })),
    updateMember: jest.fn(async () => ({ memberUserId: 'actor' })), removeMember: jest.fn(async () => ({ memberUserId: 'actor' })),
  };
  const actor = jest.fn(async () => 'actor');
  const admin = jest.fn(async () => ({ isAdmin: false }));
  const service = policy.createBotManagement({ store, getActorUserId: actor, getAdminStatus: admin, logger: { error: jest.fn() } });
  return { store, actor, admin, service };
}
function response() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.setHeader = jest.fn();
  res.status = jest.fn((status) => { res.statusCode = status; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

describe('strict bot delegation policy', () => {
  test('defaults to operational access and write always includes read', () => {
    expect(policy.normalizeBotManagerScopes()).toEqual(['*']);
    expect(policy.normalizeBotManagerScopes(['points:write', 'points:write'])).toEqual(['points:read', 'points:write']);
    expect(policy.hasBotManagerScope(manager(['points:write']), 'points')).toBe(true);
  });
  test.each([[], null, {}, [''], ['*', 'points:read'], ['account:write'], ['__proto__:write']])('rejects invalid scope input %p', (value) => {
    expect(() => policy.normalizeBotManagerScopes(value)).toThrow();
  });
  test.each(['', 'user:', '../owner', 'owner?other', 'owner%3Aother', ' owner'])('rejects invalid owner %p', (value) => {
    expect(() => policy.normalizeBotOwner(value)).toThrow();
  });
  test('rejects duplicate selectors, accepts normalized legacy user prefix', () => {
    expect(() => policy.requestedBotOwner(req('/?botOwner=one&botOwner=two'))).toThrow();
    expect(policy.requestedBotOwner(req('/?botOwner=user%3Aowner'))).toBe('owner');
  });
  test.each([
    ['GET', '/api/bot/rules', 'commands', true], ['POST', '/api/bot/rules/upsert', 'commands', false],
    ['GET', '/api/channelpoints/list', 'points', true], ['POST', '/api/channelpoints/incr', 'points', false],
    ['GET', '/api/drawing-donation/admin/ws', 'drawing', true], ['POST', '/api/drawing-donation/approve', 'drawing', false],
    ['GET', '/api/video-donation/queue', 'video', true], ['POST', '/api/video-donation/control', 'video', false],
    ['PUT', '/api/wheel/settings', 'wheel', false], ['POST', '/api/automations/run', 'automations', false],
    ['GET', '/api/action-blueprints/id/versions', 'actions', true], ['POST', '/api/action-blueprints/id/publish', 'actions', false],
  ])('%s %s respects %s read/write', (method, url, feature, readable) => {
    const route = policy.botManagementRoutePolicy(method, url);
    expect(route).not.toBeNull();
    expect(policy.canUseBotManagementRoute(manager([`${feature}:read`]), route)).toBe(readable);
    expect(policy.canUseBotManagementRoute(manager([`${feature}:write`]), route)).toBe(true);
    expect(policy.canUseBotManagementRoute(manager(['logs:write']), route)).toBe(false);
  });
  test.each(['/api/apikey', '/api/auth/session', '/api/account', '/api/not-yet-reviewed', '/api/arubot-admin/console', '/api/video-donation/current'])('never delegates personal or unknown route %s', (url) => {
    expect(policy.canUseBotManagementRoute(manager(), policy.botManagementRoutePolicy('POST', url))).toBe(false);
  });
  test.each(['/api/drawing-donation/viewer-url', '/api/video-donation/rotate-viewer-token', '/api/automations/local-agents/pair', '/api/automations/control-links', '/api/youtube/streamer-channel'])('full managers cannot issue credentials or link identity: %s', (url) => {
    const route = policy.botManagementRoutePolicy('POST', url);
    expect(policy.canUseBotManagementRoute(manager(), route)).toBe(false);
    expect(policy.canUseBotManagementRoute({ role: 'site_admin' }, route)).toBe(true);
  });
  test('filters all hidden settings and rejects cross-feature modifications', () => {
    const current = { channelPointsPerChat: 3, attendanceMessage: 'hi', botEnabled: true, drawingDonationViewerToken: 'secret', videoDonation: { enabled: true } };
    const access = manager(['points:read', 'points:write']);
    expect(policy.filterBotManagerSettings(current, access)).toEqual({ channelPointsPerChat: 3 });
    expect(policy.mergeBotManagerSettings(current, { channelPointsPerChat: 4 }, access)).toEqual({ ...current, channelPointsPerChat: 4 });
    expect(() => policy.mergeBotManagerSettings(current, { attendanceMessage: 'changed' }, access)).toThrow();
    expect(() => policy.mergeBotManagerSettings(current, { drawingDonationViewerToken: 'stolen' }, manager())).toThrow();
    expect(() => policy.mergeBotManagerSettings(current, { futureSetting: true }, manager())).toThrow();
    expect(() => policy.mergeBotManagerSettings(current, { channelPointsPerChat: 4 }, manager(['points:read']))).toThrow();
    expect(current.channelPointsPerChat).toBe(3);
  });
  test.each([
    ['${action::scene}', 'actions'], ['${ Automation::effect}', 'actions'], ['${blueprint::effect}', 'actions'],
    ['${roulette::game}', 'roulette'], ['${video_donation}', 'video'], ['${bgm_request}', 'video'],
    ['${live.title_change}', 'connection'],
  ])('execution binding %s requires its own %s write scope', (value, feature) => {
    expect(() => policy.assertBotManagerEffects({ rule: { responses: [value] } }, manager(['commands:write']))).toThrow();
    expect(() => policy.assertBotManagerEffects(value, manager(['commands:write', `${feature}:write`, 'actions:write']))).not.toThrow();
    expect(() => policy.assertBotManagerEffects(value, manager())).not.toThrow();
  });
  test('roulette chaining and result commands cannot bypass action authorization', () => {
    expect(() => policy.assertBotManagerEffects('${roulette::game}', manager(['roulette:write']))).toThrow();
    expect(() => policy.assertBotManagerEffects({ items: [{ value: '!privileged-command' }] }, manager(['roulette:write']), { rouletteValues: true })).toThrow();
    expect(() => policy.assertBotManagerEffects({ items: [{ label: 'plain prize', value: null }] }, manager(['roulette:write']), { rouletteValues: true })).not.toThrow();
  });
  test('attendance activation checks persisted effect text but unchanged unrelated fields do not require extra privileges', () => {
    const current = { attendanceEnabled: false, attendanceMessage: '${action::scene}', channelPointsPerChat: 2 };
    expect(() => policy.mergeBotManagerSettings(current, { attendanceEnabled: true }, manager(['commands:write']))).toThrow();
    expect(policy.mergeBotManagerSettings(current, { channelPointsPerChat: 3 }, manager(['points:write']))).toEqual({ ...current, channelPointsPerChat: 3 });
  });
});

describe('session-bound delegated request authorization', () => {
  test('does not change personal requests without an explicit target', async () => {
    const h = harness();
    expect(await h.service.authorize(req('/api/bot/rules'))).toBeNull();
    expect(h.actor).not.toHaveBeenCalled();
  });
  test('uses true actor for admin lookup and attaches only a verified target', async () => {
    const h = harness(manager(['commands:read']));
    const request = req();
    await h.service.authorize(request);
    expect(h.admin).toHaveBeenCalledWith('actor');
    expect(h.store.getAccess).toHaveBeenCalledWith('actor', 'owner', false);
    expect(request.botManagement).toMatchObject({ actorUserId: 'actor', ownerUserId: 'owner' });
    expect(Object.isFrozen(request.botManagement)).toBe(true);
  });
  test('missing, revoked, forged and service-failed access fail closed', async () => {
    const h = harness(null);
    await expect(h.service.authorize(req())).rejects.toMatchObject({ status: 403 });
    h.actor.mockResolvedValue(null);
    await expect(h.service.authorize(req())).rejects.toMatchObject({ status: 401 });
    h.actor.mockResolvedValue('actor');
    h.store.getAccess.mockRejectedValue(new Error('database down'));
    const res = response(), next = jest.fn();
    await h.service.middleware(req(), res, next);
    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });
  test('write denied before endpoint execution; API keys cannot mix with session delegation', async () => {
    const h = harness(manager(['commands:read']));
    await expect(h.service.authorize(req('/api/bot/rules/upsert?botOwner=owner', 'POST'))).rejects.toMatchObject({ status: 403 });
    const request = req(); request.headers['x-api-key'] = 'key';
    await expect(h.service.authorize(request)).rejects.toMatchObject({ status: 403 });
    expect(request.botManagement).toBeUndefined();
  });
  test('effect injection is denied before a command or donation rule is saved', async () => {
    const h = harness(manager(['commands:write']));
    const request = req('/api/bot/rules/upsert?botOwner=owner', 'POST');
    request.body = { rule: { id: 'rule', responses: ['${action::effect}'] } };
    await expect(h.service.authorize(request)).rejects.toMatchObject({ status: 403, code: 'bot_effect_scope_required' });
    expect(request.botManagement).toBeUndefined();
    const service = policy.createBotManagement({ store: { ...h.store, getAccess: async () => manager(['donations:write']) },
      getActorUserId: h.actor, getAdminStatus: h.admin,
      getStoredSettings: async () => ({ donationRules: [{ id: 'old', enabled: false, responses: ['${action::effect}'] }] }),
    });
    const partial = req('/api/donation/rules/upsert?botOwner=owner', 'POST');
    partial.body = { rule: { id: 'old', enabled: true } };
    await expect(service.authorize(partial)).rejects.toMatchObject({ status: 403, code: 'bot_effect_scope_required' });
  });
  test('overlay credential previews return no token and never reach token issuing handler', async () => {
    const h = harness();
    const res = response(), next = jest.fn(), request = req('/api/drawing-donation/viewer-url?botOwner=owner');
    await h.service.middleware(request, res, next);
    expect(res.body).toEqual({ token: null, path: null, ownerOnly: true });
    expect(next).not.toHaveBeenCalled();
    expect(request.botManagement).toBeUndefined();
  });
  test('audit records true actor, selected owner and route template without query', async () => {
    const h = harness();
    const request = req('/api/action-blueprints/123?botOwner=owner&token=private', 'PUT');
    request.route = { path: '/api/action-blueprints/:id' };
    const res = response();
    await h.service.middleware(request, res, jest.fn());
    res.emit('finish');
    expect(h.store.recordAction).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'actor', ownerUserId: 'owner', path: '/api/action-blueprints/:id' }));
  });
  test('logs do not hand managers reusable credentials hidden inside metadata or replay results', async () => {
    const h = harness(manager(['logs:read'])), res = response();
    await h.service.middleware(req('/api/bot/event-logs?botOwner=owner'), res, jest.fn());
    res.json({ logs: [{ id: 'event', metadata: { token: 'permanent', viewerToken: 'drawing', nested: { apiKey: 'secret', result: 'ok' } }, url: '/drawing-overlay/secret', details: 'https://example.test?token=secret' }] });
    expect(res.body.logs[0]).toEqual({ id: 'event', metadata: { nested: { result: 'ok' } }, url: '/drawing-overlay/[redacted]', details: 'https://example.test?token=[redacted]' });
  });
  test('site admins still cannot impersonate personal account authentication', async () => {
    const h = harness({ ownerUserId: 'owner', role: 'site_admin', scopes: ['*'] });
    h.admin.mockResolvedValue({ isAdmin: true });
    await h.service.authorize(req());
    expect(h.store.getAccess).toHaveBeenCalledWith('actor', 'owner', true);
    await expect(h.service.authorize(req('/api/auth/session?botOwner=owner'))).rejects.toMatchObject({ status: 403 });
  });
  test('manager cannot enumerate or grant channel managers', async () => {
    const h = harness(), handlers = {};
    const app = Object.fromEntries(['get', 'post', 'patch', 'delete'].map((verb) => [verb, (url, ...middleware) => { handlers[`${verb}:${url}`] = middleware.at(-1); }]));
    h.service.registerRoutes(app, (_req, _res, next) => next());
    for (const key of ['get:/api/bot-management/members', 'post:/api/bot-management/members', 'get:/api/bot-management/users']) {
      const res = response();
      await handlers[key](req('/api/bot-management/members?botOwner=owner'), res);
      expect(res.statusCode).toBe(403);
    }
    expect(h.store.listMembers).not.toHaveBeenCalled();
    expect(h.store.addMember).not.toHaveBeenCalled();
    expect(h.store.searchUsers).not.toHaveBeenCalled();
  });
  test('a missing scopes field on edit never silently grants full access', async () => {
    const h = harness({ ...manager(), role: 'owner' }), handlers = {};
    const app = Object.fromEntries(['get', 'post', 'patch', 'delete'].map((verb) => [verb, (url, ...middleware) => { handlers[`${verb}:${url}`] = middleware.at(-1); }]));
    h.service.registerRoutes(app, (_req, _res, next) => next());
    const request = req('/api/bot-management/members/grant?botOwner=owner', 'PATCH');
    request.params = { id: 'grant' };
    const res = response();
    await handlers['patch:/api/bot-management/members/:id'](request, res);
    expect(res.statusCode).toBe(400);
    expect(h.store.updateMember).not.toHaveBeenCalled();
  });
  test('revoked queue sockets close immediately and on cross-instance revalidation', async () => {
    let tick;
    sandbox.setInterval = jest.fn((callback) => { tick = callback; return { unref: jest.fn() }; });
    sandbox.clearInterval = jest.fn();
    const h = harness(manager(['drawing:read']));
    const request = req('/api/drawing-donation/admin/ws?botOwner=owner');
    await h.service.authorize(request);
    const ws = new EventEmitter(); ws.close = jest.fn();
    h.service.watchSocket(ws, request);
    h.service.revokeSockets('unrelated', 'actor');
    expect(ws.close).not.toHaveBeenCalled();
    h.service.revokeSockets('owner', 'actor');
    expect(ws.close).toHaveBeenCalledWith(1008, expect.any(String));
    ws.close.mockClear();
    h.store.getAccess.mockResolvedValue(null);
    await tick();
    expect(ws.close).toHaveBeenCalledWith(1008, expect.any(String));
    ws.emit('close');
    expect(sandbox.clearInterval).toHaveBeenCalled();
  });
});

describe('server ownership integration', () => {
  const server = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');
  test('middleware runs before business routes, site-admin authority uses actor identity', () => {
    expect(server.indexOf('app.use(botManagement.middleware)')).toBeLessThan(server.indexOf("app.get('/api/automations/overview'"));
    const admin = server.slice(server.indexOf('async function requireCurrentAdminUser'), server.indexOf('async function getCurrentAdminUserForCallback'));
    expect(admin).toContain('getSessionActorUserId(req)');
    expect(server).toContain("hasBotManagerScope(req.botManagement, replayFeature, 'write')");
    expect(server).toContain('botManagement.watchSocket(ws, req)');
    expect(server).toContain('updateBotSettingsAtomically(sid, (current) => mergeBotManagerSettings(current, settings, req.botManagement))');
  });
  test('delegated setting writes hold a lock and roll back on forbidden changes', async () => {
    const source = fs.readFileSync(path.join(root, 'server/supabase.js'), 'utf8');
    const start = source.indexOf('export async function updateBotSettingsAtomically');
    const code = source.slice(start, source.indexOf('// Find sid by viewer token', start)).replace('export ', '');
    const query = jest.fn(async (sql) => ({ rows: sql.startsWith('select') ? [{ settings: { token: 'keep', channelPointsPerChat: 1 } }] : [] }));
    const context = { ensure: jest.fn(), withPgClient: async (fn) => fn({ query }), module: { exports: {} } };
    vm.runInNewContext(`${code}; module.exports = updateBotSettingsAtomically`, context);
    const update = context.module.exports;
    await update('user:owner', (current) => ({ ...current, channelPointsPerChat: 2 }));
    expect(query).toHaveBeenCalledWith('select settings from bot_settings where sid = $1 for update', ['user:owner']);
    expect(query).toHaveBeenCalledWith('update bot_settings set settings = $2::jsonb where sid = $1', ['user:owner', '{"token":"keep","channelPointsPerChat":2}']);
    query.mockClear();
    await expect(update('user:owner', () => { throw new Error('forbidden'); })).rejects.toThrow('forbidden');
    expect(query).toHaveBeenCalledWith('rollback');
    expect(query.mock.calls.some(([sql]) => sql.startsWith('update'))).toBe(false);
  });
});
