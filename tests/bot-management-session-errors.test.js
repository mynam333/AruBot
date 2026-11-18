const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const loadSource = require('./helpers/load-source.cjs');

function parse(relativePath) {
  return ts.createSourceFile(relativePath, fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}
const database = parse('server/supabase.js');
const server = parse('server/index.js');
function loadFunction(ast, name, dependencies) {
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!declaration) throw new Error(`Missing function: ${name}`);
  return new Function(...Object.keys(dependencies), `${declaration.getText(ast).replace(/^export\s+/, '')}; return ${name};`)
    (...Object.values(dependencies));
}
function managementActor(getSessionActorUserId) {
  const declaration = server.statements.filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((node) => node.name.getText(server) === 'botManagement');
  const property = declaration.initializer.arguments[0].properties
    .find((node) => node.name?.getText(server) === 'getActorUserId');
  return new Function('getSessionActorUserId', `return (${property.initializer.getText(server)});`)(getSessionActorUserId);
}

function harness() {
  const query = jest.fn(async () => ({ rows: [{ user_id: 'actor' }] }));
  const ensure = jest.fn();
  const withPgClient = jest.fn(async (callback) => callback({ query }));
  const getSessionUserId = loadFunction(database, 'getSessionUserId', {
    ensure, withPgClient, console: { error: jest.fn() },
  });
  const getCookieSid = jest.fn((req) => req.sid);
  const lookup = jest.fn(getSessionUserId);
  const getSessionActorUserId = loadFunction(server, 'getSessionActorUserId', { getCookieSid, getSessionUserId: lookup });
  return { query, ensure, withPgClient, getSessionUserId, getSessionActorUserId, lookup };
}

test.each([undefined, { strict: false }])('legacy database lookups still return null on DB failure: %j', async (options) => {
  const h = harness(); h.query.mockRejectedValue(new Error('database unavailable'));
  await expect(h.getSessionUserId('session', options)).resolves.toBeNull();
});

test('strict database lookup rethrows the original failure', async () => {
  const h = harness(), error = Object.assign(new Error('database unavailable'), { code: '08006' });
  h.query.mockRejectedValue(error);
  await expect(h.getSessionUserId('session', { strict: true })).rejects.toBe(error);
});

test.each([false, true])('session validity predicates remain enforced with strict=%s', async (strict) => {
  const h = harness();
  await expect(h.getSessionUserId('session', { strict })).resolves.toBe('actor');
  const [sql, values] = h.query.mock.calls[0];
  expect(sql).toContain('where sid = $1');
  expect(sql).toContain('revoked is not true');
  expect(sql).toContain('(expires_at is null or expires_at > now())');
  expect(values).toEqual(['session']);
  h.query.mockResolvedValueOnce({ rows: [] });
  await expect(h.getSessionUserId('expired-or-revoked', { strict })).resolves.toBeNull();
});

test.each([false, true])('actor helper forwards strict=%s while preserving legacy failure handling', async (strict) => {
  const h = harness(), error = new Error('database unavailable');
  h.query.mockRejectedValue(error);
  const pending = h.getSessionActorUserId({ sid: 'session' }, { strict });
  if (strict) await expect(pending).rejects.toBe(error);
  else await expect(pending).resolves.toBeNull();
  expect(h.lookup).toHaveBeenCalledWith('session', { strict });
});

test('legacy actor callers still suppress lookup initialization failures', async () => {
  const h = harness(), error = new Error('database not initialized');
  h.ensure.mockImplementation(() => { throw error; });
  await expect(h.getSessionActorUserId({ sid: 'session' })).resolves.toBeNull();
  await expect(h.getSessionActorUserId({ sid: 'session' }, { strict: true })).rejects.toBe(error);
});

test.each([false, true])('missing cookies do not access the database with strict=%s', async (strict) => {
  const h = harness();
  await expect(h.getSessionActorUserId({}, { strict })).resolves.toBeNull();
  expect(h.lookup).not.toHaveBeenCalled();
  expect(h.withPgClient).not.toHaveBeenCalled();
});

function contextRoute(h) {
  const { createBotManagement } = loadSource('server/bot-management.js', {
    '../shared/bot-management-policy.js': loadSource('shared/bot-management-policy.js'),
  });
  const store = { getContext: jest.fn(async () => ({ actorUserId: 'actor', isSiteAdmin: false,
    active: { ownerUserId: 'actor', role: 'owner', displayName: 'Actor', scopes: ['*'] }, channels: [] })) };
  const service = createBotManagement({ store, getActorUserId: managementActor(h.getSessionActorUserId),
    logger: { error: jest.fn() } });
  let route;
  service.registerRoutes({
    get: (url, ...handlers) => { if (url === '/api/bot-management/context') route = handlers.at(-1); },
    post: () => {}, patch: () => {}, delete: () => {},
  }, () => {});
  return { store, run: async (sid = 'session') => {
    const res = { statusCode: 200, setHeader: jest.fn(), status(status) { this.statusCode = status; return this; },
      json(body) { this.body = body; return this; } };
    await route({ sid, url: '/api/bot-management/context', method: 'GET', headers: {}, query: {} }, res);
    return res;
  } };
}

test('actual bot-management wiring returns 503 for a session DB failure and recovers on the next request', async () => {
  const h = harness(), route = contextRoute(h);
  h.query.mockRejectedValueOnce(new Error('database unavailable'));
  const failed = await route.run();
  expect(failed.statusCode).toBe(503);
  expect(failed.body.code).toBe('bot_management_unavailable');
  expect(failed.body).not.toHaveProperty('active');
  expect(route.store.getContext).not.toHaveBeenCalled();
  const recovered = await route.run();
  expect(recovered.statusCode).toBe(200);
  expect(recovered.body.actorUserId).toBe('actor');
  expect(h.lookup).toHaveBeenCalledWith('session', { strict: true });
  expect(route.store.getContext).toHaveBeenCalledTimes(1);
});

test.each(['missing-cookie', 'missing-session'])('actual bot-management wiring retains 401 for %s', async (kind) => {
  const h = harness(), route = contextRoute(h);
  h.query.mockResolvedValue({ rows: [] });
  const res = await route.run(kind === 'missing-cookie' ? null : 'session');
  expect(res.statusCode).toBe(401);
  expect(res.body.code).toBe('login_required');
  expect(route.store.getContext).not.toHaveBeenCalled();
});
