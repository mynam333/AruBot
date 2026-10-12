import {
  BOT_MANAGER_SCOPE_GROUPS, normalizeBotOwner, normalizeBotManagerScopes,
  botManagementRoutePolicy, canUseBotManagementRoute, assertBotManagerEffects, redactBotManagerLogSecrets,
} from '../shared/bot-management-policy.js';

function failure(message, status = 403, code = 'bot_management_forbidden') {
  return Object.assign(new Error(message), { status, code });
}

export function requestedBotOwner(req) {
  const url = new URL(req.originalUrl || req.url || '/', 'http://localhost');
  const values = url.searchParams.getAll('botOwner');
  if (!values.length) return null;
  if (values.length !== 1) throw failure('관리 채널을 하나만 선택해 주세요.', 400, 'invalid_bot_owner');
  return normalizeBotOwner(values[0]);
}

function requestPath(req) {
  return new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
}

export function createBotManagement({ store, getActorUserId, getAdminStatus, getStoredSettings, logger = console }) {
  const sockets = new Set();

  async function context(req) {
    const actorUserId = await getActorUserId(req);
    if (!actorUserId) throw failure('로그인이 필요합니다.', 401, 'login_required');
    const ownerUserId = requestedBotOwner(req) || String(actorUserId);
    const isSiteAdmin = (await getAdminStatus(actorUserId))?.isAdmin === true;
    const active = await store.getAccess(String(actorUserId), ownerUserId, isSiteAdmin);
    if (!active) throw failure('이 채널의 봇 관리 권한이 없거나 회수되었습니다.');
    return { actorUserId: String(actorUserId), isSiteAdmin, active };
  }

  async function authorize(req) {
    if (!requestedBotOwner(req)) return null;
    const policy = botManagementRoutePolicy(req.method, requestPath(req));
    if (!policy || policy.personal) throw failure('이 요청은 다른 채널의 관리 화면에서 실행할 수 없습니다.');
    if (policy.management) return null;
    const access = await context(req);
    if (req.headers?.authorization || req.headers?.['x-api-key']) {
      throw failure('봇 관리자 요청은 로그인 세션으로만 사용할 수 있습니다.');
    }
    const resolved = Object.freeze({ ...access.active, actorUserId: access.actorUserId });
    if (policy.preview && resolved.role === 'manager') {
      return { access: resolved, policy, preview: true };
    }
    if (!canUseBotManagementRoute(resolved, policy)) {
      throw failure('해당 기능을 조회하거나 수정할 권한이 없습니다.', 403, 'bot_scope_required');
    }
    if (policy.mode === 'write' && resolved.role === 'manager') {
      const path = requestPath(req).toLowerCase().replace(/\/+$/, '');
      if (path !== '/api/bot/settings') {
        assertBotManagerEffects(req.body, resolved, { rouletteValues: path === '/api/roulette/definitions/upsert' });
      }
      if (path === '/api/donation/rules/upsert' && !resolved.scopes.includes('*')) {
        if (!getStoredSettings) throw failure('저장된 후원 규칙의 권한을 확인할 수 없습니다.', 503);
        const settings = await getStoredSettings(`user:${resolved.ownerUserId}`);
        const previous = (Array.isArray(settings.donationRules) ? settings.donationRules : [])
          .find((rule) => String(rule.id || '') === String(req.body?.rule?.id || ''));
        assertBotManagerEffects({ ...previous, ...req.body?.rule }, resolved);
      }
    }
    req.botManagement = resolved;
    return { access: resolved, policy };
  }

  function sendError(res, error) {
    const status = Number(error?.status) || 503;
    if (status >= 500) logger.error('[bot-management]', error?.message || error);
    return res.status(status).json({ error: status >= 500 ? '봇 관리 권한을 확인하지 못했습니다. 다시 시도해 주세요.' : error.message, code: error.code || 'bot_management_unavailable' });
  }

  async function middleware(req, res, next) {
    try {
      const authorized = await authorize(req);
      if (!authorized) return next();
      res.setHeader('Cache-Control', 'private, no-store');
      if (authorized.preview) return res.json({ token: null, path: null, ownerOnly: true });
      if (authorized.access.role === 'manager'
        && /^\/api\/(?:bot\/event-logs(?:\/|$)|roulette\/logs$|action-blueprints\/.*\/(?:runs|steps)(?:\/|$))/.test(requestPath(req))) {
        const json = res.json.bind(res);
        res.json = (body) => json(redactBotManagerLogSecrets(body));
      }
      if (authorized.policy.mode === 'write' && authorized.access.actorUserId !== authorized.access.ownerUserId) {
        res.once('finish', () => {
          if (res.statusCode >= 400) return;
          store.recordAction({ ownerUserId: authorized.access.ownerUserId, actorUserId: authorized.access.actorUserId,
            action: 'bot.request', method: req.method, path: typeof req.route?.path === 'string' ? req.route.path : requestPath(req), status: res.statusCode })
            .catch((error) => logger.error('[bot-management:audit]', error?.message || error));
        });
      }
      return next();
    } catch (error) { return sendError(res, error); }
  }

  function revokeSockets(ownerUserId, memberUserId) {
    for (const ws of sockets) {
      if (ws.botManagement?.ownerUserId === ownerUserId && ws.botManagement?.actorUserId === memberUserId) {
        ws.close(1008, 'Bot management permissions changed');
      }
    }
  }

  function watchSocket(ws, req) {
    if (!req.botManagement) return;
    ws.botManagement = req.botManagement;
    sockets.add(ws);
    let checking = false;
    const timer = setInterval(async () => {
      if (checking) return;
      checking = true;
      try { await authorize(req); }
      catch { ws.close(1008, 'Bot management permissions changed'); }
      finally { checking = false; }
    }, 5000);
    timer.unref?.();
    ws.once('close', () => { clearInterval(timer); sockets.delete(ws); });
  }

  function registerRoutes(app, writeMiddleware) {
    const route = (handler, ownerOnly = false) => async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      try {
        const auth = await context(req);
        if (ownerOnly && auth.active.role !== 'owner' && auth.active.role !== 'site_admin') {
          throw failure('봇 관리자 추가와 권한 변경은 채널 주인만 할 수 있습니다.');
        }
        return res.json(await handler(req, auth));
      } catch (error) { return sendError(res, error); }
    };
    app.get('/api/bot-management/context', route(async (_req, auth) => ({ ...auth,
      channels: await store.listChannels(auth.actorUserId, { isSiteAdmin: auth.isSiteAdmin }), scopeGroups: BOT_MANAGER_SCOPE_GROUPS })));
    app.get('/api/bot-management/channels', route(async (req, auth) => ({
      channels: await store.listChannels(auth.actorUserId, { isSiteAdmin: auth.isSiteAdmin, query: String(req.query.q || '').slice(0, 100), limit: 30 }),
    })));
    app.get('/api/bot-management/members', route(async (_req, auth) => ({
      members: await store.listMembers(auth.active.ownerUserId), scopeGroups: BOT_MANAGER_SCOPE_GROUPS, canManage: true,
    }), true));
    app.get('/api/bot-management/users', writeMiddleware, route(async (req) => {
      const query = String(req.query.q || '').trim().slice(0, 100);
      return { users: query.length < 2 ? [] : await store.searchUsers(query, 20) };
    }, true));
    app.post('/api/bot-management/members', writeMiddleware, route(async (req, auth) => ({
      member: await store.addMember(auth.active.ownerUserId, auth.actorUserId, {
        memberUserId: normalizeBotOwner(req.body?.memberUserId), scopes: normalizeBotManagerScopes(req.body?.scopes),
      }),
    }), true));
    app.patch('/api/bot-management/members/:id', writeMiddleware, route(async (req, auth) => {
      const member = await store.updateMember(auth.active.ownerUserId, auth.actorUserId, req.params.id, normalizeBotManagerScopes(req.body?.scopes ?? null));
      if (!member) throw failure('관리자를 찾을 수 없습니다.', 404, 'not_found');
      revokeSockets(auth.active.ownerUserId, member.memberUserId);
      return { member };
    }, true));
    app.delete('/api/bot-management/members/:id', writeMiddleware, route(async (req, auth) => {
      const member = await store.removeMember(auth.active.ownerUserId, auth.actorUserId, req.params.id);
      if (!member) throw failure('관리자를 찾을 수 없습니다.', 404, 'not_found');
      revokeSockets(auth.active.ownerUserId, member.memberUserId);
      return { ok: true };
    }, true));
    app.get('/api/bot-management/audit', route(async (_req, auth) => ({ items: await store.listAudit(auth.active.ownerUserId, 50) }), true));
  }

  return { middleware, authorize, watchSocket, registerRoutes, context, revokeSockets };
}
