import { marbleErrorMessage, parseMarbleSettings } from '../shared/marble.js';
import { parseMarbleParticipationInput } from './marble-store.js';

const MESSAGES = {
  stale_overlay_revision: '\ub2e4\ub978 \ud654\uba74\uc5d0\uc11c OBS \ubc29\uc774 \ubcc0\uacbd\ub418\uc5c8\uc2b5\ub2c8\ub2e4. \uc0c8\ub85c\uace0\uce68 \ud6c4 \ub2e4\uc2dc \ud655\uc778\ud574 \uc8fc\uc138\uc694.',
  invalid_participation_revision: '\ucc38\uc5ec \uc124\uc815 \ubc84\uc804\uc744 \ud655\uc778\ud574 \uc8fc\uc138\uc694.',
  stale_participation_revision: '\ucc38\uc5ec \uc124\uc815\uc774 \ubcc0\uacbd\ub418\uc5c8\uc2b5\ub2c8\ub2e4. \uc0c8\ub85c\uace0\uce68 \ud6c4 \ub2e4\uc2dc \uc2dc\ub3c4\ud574 \uc8fc\uc138\uc694.',
  host_participation_forbidden: '\ubcf8\uc778 \ubc29\uc740 \ubc29\uc7a5 \uc124\uc815\uc5d0\uc11c \ubcc0\uacbd\ud574 \uc8fc\uc138\uc694.',
  authentication_required: '\ub85c\uadf8\uc778\uc774 \ud544\uc694\ud569\ub2c8\ub2e4.',
  invalid_user_id: '\uc0ac\uc6a9\uc790 \uc815\ubcf4\ub97c \ud655\uc778\ud574 \uc8fc\uc138\uc694.',
  invalid_request: '\uc694\uccad \ub0b4\uc6a9\uc744 \ud655\uc778\ud574 \uc8fc\uc138\uc694.',
  invalid_request_id: '\uc694\uccad ID\ub97c \ud655\uc778\ud574 \uc8fc\uc138\uc694.',
  invalid_revision: '\uac8c\uc784 \ubc84\uc804\uc744 \ud655\uc778\ud574 \uc8fc\uc138\uc694.',
  stale_revision: '\ub2e4\ub978 \ud654\uba74\uc5d0\uc11c \uac8c\uc784\uc774 \ubcc0\uacbd\ub418\uc5c8\uc2b5\ub2c8\ub2e4. \uc0c8\ub85c\uace0\uce68 \ud6c4 \ub2e4\uc2dc \uc2dc\ub3c4\ud574 \uc8fc\uc138\uc694.',
  stale_player_state: '\uc774 \ub9d0\uc758 \uc9c4\ud589 \uc0c1\ud0dc\uac00 \ubcc0\uacbd\ub418\uc5c8\uc2b5\ub2c8\ub2e4. \ud654\uba74\uc744 \uac31\uc2e0\ud574 \uc8fc\uc138\uc694.',
  expected_roll_id_required: '\uc774 \ub9d0\uc758 \ud604\uc7ac \uc0c1\ud0dc\ub97c \ud655\uc778\ud574 \uc8fc\uc138\uc694.',
  request_id_conflict: '\uac19\uc740 \uc694\uccad ID\ub97c \ub2e4\ub978 \uc791\uc5c5\uc5d0 \uc0ac\uc6a9\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.',
  room_not_found: '\uac8c\uc784\uc744 \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.',
  owner_not_found: '\ubc29\uc7a5 \uacc4\uc815\uc744 \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.',
  user_not_found: '\uc0ac\uc6a9\uc790\ub97c \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.',
  player_not_found: '\ub9d0\uc744 \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.',
  not_a_participant: '\uc774 \uac8c\uc784\uc758 \ucc38\uac00\uc790\uac00 \uc544\ub2d9\ub2c8\ub2e4.',
  participant_control_forbidden: '\uc9c0\uae08\uc740 \ucc38\uac00\uc790\uac00 \uc9c1\uc811 \uc870\uc791\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.',
  game_not_running: '\uac8c\uc784\uc744 \uc2dc\uc791\ud558\uac70\ub098 \uc7ac\uac1c\ud574 \uc8fc\uc138\uc694.',
  roster_locked: '\ucc38\uac00\uc790 \ubcc0\uacbd\uc740 \uc2dc\uc791 \uc804\uc774\ub098 \uc885\ub8cc \ud6c4\uc5d0 \uac00\ub2a5\ud569\ub2c8\ub2e4.',
  linked_identity_is_managed: '\uc5f0\uacb0\ub41c \uacc4\uc815\uc758 \uc774\ub984\uacfc \uc0ac\uc9c4\uc740 \ub300\ud45c \ud504\ub85c\ud544\uc5d0\uc11c \uad00\ub9ac\ud569\ub2c8\ub2e4.',
  room_full: '\ucc38\uac00\uc790\ub294 \ucd5c\ub300 8\uba85\uae4c\uc9c0 \ucd94\uac00\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.',
  invalid_overlay_token: '\uc624\ubc84\ub808\uc774 \uc8fc\uc18c\uac00 \uc798\ubabb\ub418\uc5c8\uac70\ub098 \ubcc0\uacbd\ub418\uc5c8\uc2b5\ub2c8\ub2e4.',
  invalid_query: '\uac80\uc0c9\uc5b4\ub97c \ud655\uc778\ud574 \uc8fc\uc138\uc694.',
  cannot_invite_self: '\ubcf8\uc778\uc740 \ucd08\ub300\ud560 \ud544\uc694\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.',
  invalid_invitation_id: '\ucd08\ub300 \uc815\ubcf4\ub97c \ud655\uc778\ud574 \uc8fc\uc138\uc694.',
  invitation_not_found: '\ucd08\ub300\ub97c \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.',
  invitation_revoked: '\ucca0\ud68c\ub41c \ucd08\ub300\uc785\ub2c8\ub2e4.',
  invitation_expired: '\ucd08\ub300 \uae30\uac04\uc774 \ub9cc\ub8cc\ub418\uc5c8\uc2b5\ub2c8\ub2e4.',
  invitation_already_answered: '\uc774\ubbf8 \uc751\ub2f5\ud55c \ucd08\ub300\uc785\ub2c8\ub2e4.',
  invalid_invitation_action: '\ucd08\ub300 \uc751\ub2f5\uc744 \ud655\uc778\ud574 \uc8fc\uc138\uc694.',
  command_conflict: '\ub2e4\ub978 \uae30\ub2a5\uc5d0\uc11c \uc0ac\uc6a9 \uc911\uc778 \uba85\ub839\uc5b4\uc785\ub2c8\ub2e4.',
  invalid_action: '\uc0ac\uc6a9\ud560 \uc218 \uc5c6\ub294 \ub3d9\uc791\uc785\ub2c8\ub2e4.',
};
export function registerMarbleRoutes(app, { store, getAdminOwner, getViewerUser, writeLimiter, validateCommands, onChange, logger = console }) {
  const fail = (code, status) => { throw Object.assign(new Error(code), { code, status }); };
  const owner = async req => await getAdminOwner(req) || fail('authentication_required', 401);
  const viewer = async req => await getViewerUser(req) || fail('authentication_required', 401);
  const wrap = fn => async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try { return res.json(await fn(req)); }
    catch (error) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 503;
      if (status === 503) logger.error('[marble] Request failed:', error);
      const message = status === 503 ? '\uac8c\uc784\uc744 \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4. \uc7a0\uc2dc \ud6c4 \ub2e4\uc2dc \uc2dc\ub3c4\ud574 \uc8fc\uc138\uc694.' : MESSAGES[error.code] || marbleErrorMessage(error);
      return res.status(status).json({ error: message, code: status === 503 ? 'marble_unavailable' : error.code || 'invalid_request' });
    }
  };
  const changed = async (id, result) => {
    try { await onChange?.(id); } catch (error) { logger.error('[marble] Cache invalidation failed:', error); }
    return result;
  };
  const hostWrite = fn => wrap(async req => {
    const id = await owner(req);
    return changed(id, await fn(id, req));
  });
  app.get('/api/marble', wrap(async req => store.snapshot(await owner(req))));
  app.post('/api/marble/action', writeLimiter, hostWrite((id, req) => store.act(id, req.body)));
  app.post('/api/marble/participation/disconnect', writeLimiter, hostWrite(async (id, req) => {
    const input = parseMarbleParticipationInput(req.body, true);
    if (validateCommands && await validateCommands(id, (await store.snapshot(id)).state.settings) === false) fail('command_conflict', 409);
    return store.disconnectParticipation(id, input);
  }));
  app.put('/api/marble/settings', writeLimiter, hostWrite(async (id, req) => {
    const settings = parseMarbleSettings(req.body?.settings, (await store.snapshot(id)).state.settings);
    if (validateCommands && await validateCommands(id, settings) === false) fail('command_conflict', 409);
    return store.settings(id, { ...req.body, settings });
  }));
  app.put('/api/marble/layout', writeLimiter, hostWrite((id, req) => store.layout(id, req.body)));
  app.post('/api/marble/overlay/rotate', writeLimiter, hostWrite((id, req) => store.rotateOverlay(id, req.body)));
  app.get('/api/marble/users', wrap(async req => ({ users: await store.searchUsers(await owner(req), req.query.q) })));
  app.post('/api/marble/invites', writeLimiter, hostWrite((id, req) => store.invite(id, req.body)));
  app.delete('/api/marble/invites/:id', writeLimiter, hostWrite((id, req) => store.revoke(id, req.params.id)));
  app.get('/api/viewer/marble/invitations', wrap(async req => store.invitations(await viewer(req))));
  app.post('/api/viewer/marble/invitations/:id', writeLimiter, wrap(async req => {
    const result = await store.answerInvite(await viewer(req), req.params.id, req.body);
    return changed(result.ownerUserId, result);
  }));
  app.get('/api/viewer/marble/rooms/:ownerId', wrap(async req => store.participantSnapshot(req.params.ownerId, await viewer(req))));
  app.post('/api/viewer/marble/rooms/:ownerId/overlay', writeLimiter, wrap(async req => store.selectOverlayRoom(req.params.ownerId, await viewer(req), req.body)));
  app.post('/api/viewer/marble/rooms/:ownerId/leave', writeLimiter, wrap(async req => {
    const actor = await viewer(req);
    const result = await store.leave(req.params.ownerId, actor, req.body);
    await changed(actor, result);
    return changed(req.params.ownerId, result);
  }));
  app.put('/api/viewer/marble/rooms/:ownerId/participation', writeLimiter, wrap(async req => {
    const actor = await viewer(req);
    if (actor === req.params.ownerId) fail('host_participation_forbidden', 403);
    const input = parseMarbleParticipationInput(req.body);
    if (validateCommands && await validateCommands(actor, input.settings) === false) fail('command_conflict', 409);
    if (!input.connected && validateCommands && (await store.participantSnapshot(req.params.ownerId, actor)).viewerParticipation.connected) {
      if (await validateCommands(actor, (await store.snapshot(actor)).state.settings) === false) fail('command_conflict', 409);
    }
    return changed(actor, await store.participation(req.params.ownerId, actor, input));
  }));
  app.post('/api/viewer/marble/rooms/:ownerId/action', writeLimiter, wrap(async req => {
    const actor = await viewer(req);
    const result = await store.act(req.params.ownerId, req.body, { participant: true, actorUserId: actor });
    return changed(req.params.ownerId, result);
  }));
  app.get('/api/overlays/marble', wrap(async req => store.overlay(req.query.token)));
}
