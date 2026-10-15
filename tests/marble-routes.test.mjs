import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { registerMarbleRoutes } from '../server/marble-routes.js';
import { DEFAULT_MARBLE_PARTICIPATION_SETTINGS, DEFAULT_MARBLE_SETTINGS, parseMarbleSettings } from '../shared/marble.js';

async function fixture(t, options = {}) {
  const calls = [], errors = [], changes = [];
  let writes = 0;
  const methods = ['snapshot', 'act', 'settings', 'layout', 'rotateOverlay', 'overlay', 'searchUsers', 'invite', 'revoke', 'invitations', 'answerInvite', 'participantSnapshot', 'participation', 'disconnectParticipation', 'selectOverlayRoom', 'leave'];
  const store = Object.fromEntries(methods.map(method => [method, async (...args) => {
    calls.push([method, ...args]);
    if (options.error) throw options.error;
    if (options.results?.[method]) return options.results[method];
    return method === 'searchUsers' ? [{ userId: 'member' }] : { ownerUserId: 'room-owner', result: method,
      ...(method === 'snapshot' ? { state: { settings: structuredClone(DEFAULT_MARBLE_SETTINGS) } } : {}) };
  }]));
  const app = express();
  app.use(express.json());
  registerMarbleRoutes(app, {
    store,
    getAdminOwner: req => req.headers['x-owner'], getViewerUser: req => req.headers['x-actor'],
    writeLimiter: (_req, _res, next) => { writes++; next(); },
    validateCommands: options.validateCommands,
    onChange: options.onChange || (owner => changes.push(owner)),
    logger: { error: (...args) => errors.push(args) },
  });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return {
    calls, changes, errors, get writes() { return writes; },
    async request(path, method = 'GET', body, headers = {}) {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      // OS-assigned test ports can be blocked by fetch's browser unsafe-port list.
      return new Promise((resolve, reject) => {
        const request = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method,
          headers: { 'Content-Type': 'application/json', ...(payload === undefined ? {} : { 'Content-Length': Buffer.byteLength(payload) }), ...headers } }, response => {
          let data = '';
          response.setEncoding('utf8');
          response.on('data', chunk => { data += chunk; });
          response.on('error', reject);
          response.on('end', () => {
            try { resolve({ status: response.statusCode, headers: new Headers(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)])), body: JSON.parse(data) }); }
            catch (error) { reject(error); }
          });
        });
        request.on('error', reject);
        request.setTimeout(5000, () => request.destroy(new Error('Test HTTP request timed out')));
        request.end(payload);
      });
    },
  };
}
const host = { 'x-owner': 'selected-owner', 'x-actor': 'actual-actor' };
const viewer = { 'x-actor': 'actual-actor' };

test('all admin endpoints require selected owner, without treating a viewer identity as admin', async t => {
  const h = await fixture(t);
  for (const [path, method] of [
    ['', 'GET'], ['/action', 'POST'], ['/settings', 'PUT'], ['/layout', 'PUT'],
    ['/overlay/rotate', 'POST'], ['/users?q=member', 'GET'], ['/invites', 'POST'], ['/invites/invite-id', 'DELETE'], ['/participation/disconnect', 'POST'],
  ]) assert.equal((await h.request(`/api/marble${path}`, method, method === 'GET' ? undefined : {}, viewer)).status, 401);
  assert.equal(h.calls.length, 0);
  const result = await h.request('/api/marble', 'GET', undefined, host);
  assert.equal(result.status, 200);
  assert.deepEqual(h.calls[0], ['snapshot', 'selected-owner']);
  assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
  assert.match(result.headers.get('cache-control'), /no-store/);
});

test('writes pass only selected ownership, preserve request payload and invalidate after success', async t => {
  const h = await fixture(t);
  const body = { action: 'roll', playerId: 'player-2', revision: 4, requestId: 'request' };
  for (const [path, method, storeMethod] of [
    ['/action', 'POST', 'act'], ['/layout', 'PUT', 'layout'], ['/overlay/rotate', 'POST', 'rotateOverlay'], ['/invites', 'POST', 'invite'],
  ]) {
    assert.equal((await h.request(`/api/marble${path}`, method, body, host)).status, 200);
    assert.deepEqual(h.calls.at(-1), [storeMethod, 'selected-owner', body]);
  }
  await h.request('/api/marble/invites/invite-id', 'DELETE', {}, host);
  assert.deepEqual(h.calls.at(-1), ['revoke', 'selected-owner', 'invite-id']);
  assert.equal(h.writes, 5);
  assert.deepEqual(h.changes, Array(5).fill('selected-owner'));
});

test('settings validates command conflict before the mutation and never invalidates rejected writes', async t => {
  const validations = [];
  const h = await fixture(t, { validateCommands: (owner, settings) => { validations.push([owner, settings]); return settings.points.command !== '!conflict'; } });
  const body = { settings: { points: { command: '!conflict' } }, requestId: 'settings', revision: 1 };
  assert.equal((await h.request('/api/marble/settings', 'PUT', body, host)).status, 409);
  assert.deepEqual(validations[0], ['selected-owner', parseMarbleSettings(body.settings)]);
  assert.deepEqual(h.calls, [['snapshot', 'selected-owner']]);
  assert.equal(h.changes.length, 0);
  body.settings.points.command = '!marble';
  assert.equal((await h.request('/api/marble/settings', 'PUT', body, host)).status, 200);
  assert.deepEqual(h.calls.at(-1), ['settings', 'selected-owner', { ...body, settings: parseMarbleSettings(body.settings) }]);
  assert.deepEqual(h.changes, ['selected-owner']);
});

test('thrown command validation preserves its public conflict code', async t => {
  const h = await fixture(t, { validateCommands: () => { throw Object.assign(new Error('existing_command'), { status: 409, code: 'command_conflict' }); } });
  const result = await h.request('/api/marble/settings', 'PUT', { settings: {} }, host);
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'command_conflict');
  assert.deepEqual(h.calls, [['snapshot', 'selected-owner']]);
});

test('host enable-only patch validates the effective saved command and retains revision/request identity', async t => {
  const saved = parseMarbleSettings({ points: { enabled: false, command: '!occupied', cost: 725 } });
  const validations = [];
  let conflict = true;
  const h = await fixture(t, { results: { snapshot: { state: { settings: saved } } },
    validateCommands: (actor, settings) => { validations.push([actor, settings]); return !(conflict && settings.points.enabled && settings.points.command === '!occupied'); } });
  const body = { requestId: 'enable-only', revision: 17, settings: { points: { enabled: true } } };
  const result = await h.request('/api/marble/settings', 'PUT', body, host);
  assert.equal(result.status, 409); assert.equal(result.body.code, 'command_conflict');
  assert.deepEqual(validations[0][1].points, { enabled: true, command: '!occupied', cost: 725 });
  assert.equal(h.calls.some(call => call[0] === 'settings'), false);
  conflict = false;
  assert.equal((await h.request('/api/marble/settings', 'PUT', body, host)).status, 200);
  assert.deepEqual(h.calls.at(-1), ['settings', 'selected-owner', { ...body, settings: parseMarbleSettings(body.settings, saved) }]);
});

test('participant APIs use actual actor, never selected owner or body identity', async t => {
  const h = await fixture(t);
  const body = { action: 'roll', participant: false, actorUserId: 'selected-owner', playerId: 'another-player', requestId: 'roll', revision: 2 };
  assert.equal((await h.request('/api/viewer/marble/rooms/room-owner/action', 'POST', body, { 'x-owner': 'selected-owner' })).status, 401);
  assert.equal((await h.request('/api/viewer/marble/rooms/room-owner', 'GET', undefined, host)).status, 200);
  assert.deepEqual(h.calls.at(-1), ['participantSnapshot', 'room-owner', 'actual-actor']);
  await h.request('/api/viewer/marble/rooms/room-owner/action', 'POST', body, host);
  assert.deepEqual(h.calls.at(-1), ['act', 'room-owner', body, { participant: true, actorUserId: 'actual-actor' }]);
  assert.deepEqual(h.changes, ['room-owner']);
});

test('mission dice and judgement routes retain roll guards and outcome while selecting the authenticated actor', async t => {
  const h = await fixture(t);
  for (const action of ['challenge-roll', 'challenge-result']) {
    const body = { action, requestId: `mission-${action}`, expectedRollId: 'board-roll', revision: 4,
      ...(action === 'challenge-result' ? { outcome: 'failure' } : {}) };
    assert.equal((await h.request('/api/marble/action', 'POST', body, host)).status, 200);
    assert.deepEqual(h.calls.at(-1), ['act', 'selected-owner', body]);
    assert.equal((await h.request('/api/viewer/marble/rooms/room-owner/action', 'POST', body, viewer)).status, 200);
    assert.deepEqual(h.calls.at(-1), ['act', 'room-owner', body, { participant: true, actorUserId: 'actual-actor' }]);
  }
});

test('invitation search and membership routes keep host and target actor separate', async t => {
  const h = await fixture(t);
  const users = await h.request('/api/marble/users?q=person', 'GET', undefined, host);
  assert.deepEqual(users.body, { users: [{ userId: 'member' }] });
  assert.deepEqual(h.calls.at(-1), ['searchUsers', 'selected-owner', 'person']);
  await h.request('/api/viewer/marble/invitations', 'GET', undefined, host);
  assert.deepEqual(h.calls.at(-1), ['invitations', 'actual-actor']);
  const body = { action: 'accept', requestId: 'answer' };
  await h.request('/api/viewer/marble/invitations/invite-id', 'POST', body, host);
  assert.deepEqual(h.calls.at(-1), ['answerInvite', 'actual-actor', 'invite-id', body]);
  assert.deepEqual(h.changes, ['room-owner']);
});

test('overlay endpoint uses only token and never needs a login', async t => {
  const h = await fixture(t);
  const result = await h.request('/api/overlays/marble?token=read-only');
  assert.equal(result.status, 200);
  assert.deepEqual(h.calls, [['overlay', 'read-only']]);
  assert.equal(h.writes, 0);
  assert.equal(h.changes.length, 0);
  assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
});

test('personal OBS selection and leave require the viewer identity; only leaving invalidates paid ingress', async t => {
  const h = await fixture(t, { validateCommands: () => { throw new Error('OBS/leave cannot enable paid commands'); } });
  for (const action of ['overlay', 'leave']) {
    assert.equal((await h.request(`/api/viewer/marble/rooms/room-owner/${action}`, 'POST', {}, { 'x-owner': 'selected-owner' })).status, 401);
  }
  const obs = { requestId: 'select', overlayRevision: 2, actorUserId: 'forged' };
  assert.equal((await h.request('/api/viewer/marble/rooms/room-owner/overlay', 'POST', obs, host)).status, 200);
  assert.deepEqual(h.calls.at(-1), ['selectOverlayRoom', 'room-owner', 'actual-actor', obs]);
  assert.deepEqual(h.changes, []);
  const leave = { requestId: 'leave', invitationId: 'membership-id', actorUserId: 'forged' };
  assert.equal((await h.request('/api/viewer/marble/rooms/room-owner/leave', 'POST', leave, host)).status, 200);
  assert.deepEqual(h.calls.at(-1), ['leave', 'room-owner', 'actual-actor', leave]);
  assert.deepEqual(h.changes, ['actual-actor', 'room-owner']);
});

test('database failures do not expose internal messages or report cache invalidation success', async t => {
  const h = await fixture(t, { error: new Error('postgres://secret:password@database') });
  const result = await h.request('/api/marble/action', 'POST', {}, host);
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'marble_unavailable');
  assert.match(result.body.error, /[\uac00-\ud7a3]/);
  assert.doesNotMatch(result.body.error, /secret|password/);
  assert.equal(h.changes.length, 0);
  assert.equal(h.errors.length, 1);
});

test('failed invalidation cannot turn a committed write into a false failed write', async t => {
  const h = await fixture(t, { onChange: () => { throw new Error('cache failure'); } });
  assert.equal((await h.request('/api/marble/action', 'POST', {}, host)).status, 200);
  assert.equal(h.calls.length, 1);
  assert.equal(h.errors.length, 1);
});

const participationBody = () => ({ requestId: 'personal-settings', participationRevision: 0, connected: true,
  settings: { points: { enabled: true, command: '!personal', cost: 250 }, donation: { enabled: true, minimum: 1500 } } });
const participationPath = '/api/viewer/marble/rooms/room-owner/participation';

test('personal participation validates the authenticated source channel and invalidates that channel only', async t => {
  const validations = [];
  const h = await fixture(t, { validateCommands: (...args) => { validations.push(args); } });
  const body = participationBody();
  assert.equal((await h.request(participationPath, 'PUT', body, { 'x-owner': 'selected-owner' })).status, 401);
  assert.equal((await h.request(participationPath, 'PUT', body, host)).status, 200);
  assert.deepEqual(validations, [['actual-actor', body.settings]]);
  assert.deepEqual(h.calls, [['participation', 'room-owner', 'actual-actor', body]]);
  assert.deepEqual(h.changes, ['actual-actor']);
  assert.equal(h.writes, 2);
});

test('strict personal parser rejects malformed/foreign settings before command validation', async t => {
  let validations = 0;
  const h = await fixture(t, { validateCommands: () => { validations++; } });
  for (const body of [
    null, [], {}, { ...participationBody(), actorUserId: 'forged' },
    { ...participationBody(), connected: 'true' }, { ...participationBody(), participationRevision: -1 },
    { ...participationBody(), participationRevision: '0' },
    { ...participationBody(), settings: { ...participationBody().settings, title: 'host setting' } },
    { ...participationBody(), settings: { points: { enabled: 'true' } } },
    { ...participationBody(), settings: { donation: { minimum: -1 } } },
    { ...participationBody(), settings: { points: { command: '!one two' } } },
    { ...participationBody(), settings: { points: { enabled: true, cost: 0, userId: 'forged' } } },
  ]) {
    // express.json itself rejects scalar/null bodies before the route.
    if (body === null) continue;
    assert.equal((await h.request(participationPath, 'PUT', body, viewer)).status, 400);
  }
  assert.equal(validations, 0); assert.equal(h.calls.length, 0); assert.equal(h.changes.length, 0);
  const defaultBody = { ...participationBody(), settings: {} };
  assert.equal((await h.request(participationPath, 'PUT', defaultBody, viewer)).status, 200);
  assert.deepEqual(h.calls[0][3].settings, DEFAULT_MARBLE_PARTICIPATION_SETTINGS);
});

test('personal route rejects host self-edit and command conflicts; domain and DB failures never invalidate', async t => {
  const h = await fixture(t, { validateCommands: () => false });
  assert.equal((await h.request('/api/viewer/marble/rooms/actual-actor/participation', 'PUT', participationBody(), viewer)).status, 403);
  const conflict = await h.request(participationPath, 'PUT', participationBody(), viewer);
  assert.equal(conflict.status, 409); assert.equal(conflict.body.code, 'command_conflict');
  assert.equal(h.calls.length, 0); assert.equal(h.changes.length, 0);
  for (const [code, status] of [['not_a_participant', 403], ['stale_participation_revision', 409], ['request_id_conflict', 409], ['database_down', 503]]) {
    const f = await fixture(t, { error: Object.assign(new Error(code), { code, status }) });
    const result = await f.request(participationPath, 'PUT', participationBody(), viewer);
    assert.equal(result.status, status); assert.equal(f.changes.length, 0);
  }
});

test('host disconnect uses selected admin owner and only independent participation revision', async t => {
  const h = await fixture(t);
  const body = { requestId: 'disconnect', participationRevision: 7 };
  assert.equal((await h.request('/api/marble/participation/disconnect', 'POST', body, host)).status, 200);
  assert.deepEqual(h.calls, [['disconnectParticipation', 'selected-owner', body]]);
  assert.deepEqual(h.changes, ['selected-owner']);
  assert.equal((await h.request('/api/marble/participation/disconnect', 'POST', { ...body, actorUserId: 'forged' }, host)).status, 400);
  assert.equal(h.calls.length, 1);
});

test('both disconnect paths validate the restored own game command before changing routing', async t => {
  for (const guest of [false, true]) {
    const validations = [];
    const local = { points: { enabled: true, command: '!occupied', cost: 700 } };
    const h = await fixture(t, { results: { snapshot: { state: { settings: local } }, participantSnapshot: { viewerParticipation: { connected: true } } },
      validateCommands: (actor, settings) => { validations.push([actor, settings]); return settings.points.command !== '!occupied'; } });
    const path = guest ? participationPath : '/api/marble/participation/disconnect';
    const body = guest ? { ...participationBody(), connected: false } : { requestId: 'disconnect', participationRevision: 0 };
    const result = await h.request(path, guest ? 'PUT' : 'POST', body, host);
    assert.equal(result.status, 409); assert.equal(result.body.code, 'command_conflict');
    assert.deepEqual(validations.at(-1), [guest ? 'actual-actor' : 'selected-owner', local]);
    assert.deepEqual(h.calls.at(-1), ['snapshot', guest ? 'actual-actor' : 'selected-owner']);
    assert.equal(h.changes.length, 0);
  }
});

test('disconnected guest settings do not revalidate an unrelated own game', async t => {
  const h = await fixture(t, { results: { participantSnapshot: { viewerParticipation: { connected: false } } }, validateCommands: () => true });
  assert.equal((await h.request(participationPath, 'PUT', { ...participationBody(), connected: false }, viewer)).status, 200);
  assert.deepEqual(h.calls.map(call => call[0]), ['participantSnapshot', 'participation']);
  assert.deepEqual(h.changes, ['actual-actor']);
});
