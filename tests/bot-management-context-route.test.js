const loadSource = require('./helpers/load-source.cjs');
const policy = loadSource('shared/bot-management-policy.js');
const { createBotManagement } = loadSource('server/bot-management.js', {
  '../shared/bot-management-policy.js': policy,
});

function harness() {
  const current = { actorUserId: 'actor', isSiteAdmin: false,
    active: { ownerUserId: 'owner', displayName: 'Owner', role: 'manager', scopes: ['commands:read'] }, channels: [] };
  const store = {
    getContext: jest.fn(async () => current), getAccess: jest.fn(), listChannels: jest.fn(),
  };
  const getActorUserId = jest.fn(async () => 'actor');
  const getAdminStatus = jest.fn();
  const service = createBotManagement({ store, getActorUserId, getAdminStatus, logger: { error: jest.fn() } });
  const routes = {};
  const app = Object.fromEntries(['get', 'post', 'patch', 'delete'].map((method) => [method,
    (path, ...handlers) => { routes[`${method}:${path}`] = handlers.at(-1); }]));
  service.registerRoutes(app, () => {});
  const req = { url: '/api/bot-management/context?botOwner=owner', headers: {}, method: 'GET', query: {} };
  const res = { statusCode: 200, setHeader: jest.fn(), status(status) { this.statusCode = status; return this; },
    json(body) { this.body = body; return this; } };
  return { current, store, getActorUserId, getAdminStatus, service, req, res,
    run: () => routes['get:/api/bot-management/context'](req, res) };
}

test('context bootstrap uses one fresh store snapshot, not separate admin/access/list lookups', async () => {
  const h = harness(); await h.run();
  expect(h.store.getContext).toHaveBeenCalledWith('actor', 'owner', { includeChannels: true });
  expect(h.store.getContext).toHaveBeenCalledTimes(1);
  expect(h.getAdminStatus).not.toHaveBeenCalled();
  expect(h.store.getAccess).not.toHaveBeenCalled();
  expect(h.store.listChannels).not.toHaveBeenCalled();
  expect(h.res.statusCode).toBe(200);
  expect(h.res.body).toMatchObject(h.current);
  expect(h.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
});

test('ordinary delegated authorization does not load the channel switcher', async () => {
  const h = harness();
  await h.service.authorize({ ...h.req, url: '/api/bot/rules?botOwner=owner' });
  expect(h.store.getContext).toHaveBeenCalledWith('actor', 'owner', { includeChannels: false });
});

test.each([401, 403, 503])('failed authentication/authorization remains HTTP %i without fallback', async (status) => {
  const h = harness();
  if (status === 401) h.getActorUserId.mockResolvedValue(null);
  if (status === 403) h.store.getContext.mockResolvedValue(null);
  if (status === 503) h.store.getContext.mockRejectedValue(new Error('database unavailable'));
  await h.run();
  expect(h.res.statusCode).toBe(status);
  expect(h.res.body).not.toHaveProperty('active');
  expect(h.getAdminStatus).not.toHaveBeenCalled();
  expect(h.store.getAccess).not.toHaveBeenCalled();
  expect(h.store.listChannels).not.toHaveBeenCalled();
});

test('session lookup failures propagate as unavailable instead of granting cached access', async () => {
  const h = harness();
  h.getActorUserId.mockRejectedValue(new Error('session database unavailable'));
  await h.run();
  expect(h.res.statusCode).toBe(503);
  expect(h.store.getContext).not.toHaveBeenCalled();
});
