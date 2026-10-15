import { readFile } from 'node:fs/promises';
import { createHash, randomBytes, randomInt as cryptoRandomInt, randomUUID } from 'node:crypto';
import { applyMarbleAction, createMarbleState, DEFAULT_MARBLE_SETTINGS, DEFAULT_MARBLE_PARTICIPATION_SETTINGS, parseMarbleParticipationSettings, parseMarbleSettings, MarbleError, MARBLE_COLORS, toPublicMarbleState } from '../shared/marble.js';

const MIGRATION = new URL('./migrations/032_marble.sql', import.meta.url);
const PARTICIPATION_MIGRATION = new URL('./migrations/033_marble_participation.sql', import.meta.url);
const OBS_MIGRATION = new URL('./migrations/034_marble_obs_membership.sql', import.meta.url);
const HOST_ACTIONS = new Set(['add-player', 'remove-player', 'update-player', 'start', 'end', 'reset', 'pause', 'resume', 'roll', 'complete', 'pass', 'challenge-roll', 'challenge-result', 'focus', 'timer-pause', 'timer-resume', 'timer-add', 'timer-finish']);
const PARTICIPANT_ACTIONS = new Set(['roll', 'complete', 'pass', 'challenge-roll', 'challenge-result']);
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const makeToken = () => `marble_${randomBytes(32).toString('base64url')}`;
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };
const copy = value => structuredClone(value);

function identifier(value, code = 'invalid_user_id', max = 512) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail(code);
  return value.trim();
}
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_request');
  return value;
}
export function parseMarbleParticipationInput(input, disconnect = false) {
  object(input);
  const keys = disconnect ? ['requestId', 'participationRevision'] : ['requestId', 'participationRevision', 'connected', 'settings'];
  if (Object.keys(input).some(key => !keys.includes(key))) fail('invalid_request');
  const requestId = identifier(input.requestId, 'invalid_request_id', 160);
  if (!Number.isSafeInteger(input.participationRevision) || input.participationRevision < 0) fail('invalid_participation_revision');
  if (disconnect) return { requestId, participationRevision: input.participationRevision };
  if (typeof input.connected !== 'boolean') fail('invalid_request');
  return { requestId, participationRevision: input.participationRevision, connected: input.connected,
    settings: parseMarbleParticipationSettings(input.settings) };
}
function inviteId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) fail('invalid_invitation_id');
  return value.toLowerCase();
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
}
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
// Exact released-content fingerprints avoid overwriting edited boards or decks.
const PREVIOUS_DEFAULT_DECKS = new Set(['12b2f3f089d9cfd788badddf7616e32c43ec09bb42f2a0c8c345c2a0c152bb15', '5f2d58109ccb46ac25d472dbe95a4344e5172756095b6688e2df2a5ef78982b0']);
const PREVIOUS_DEFAULT_TILES = {
  'tile-9': '686607ff5153a9e06700195b5b89a4c5ae179a47c8911b0eb524b7e7cfa4d3b1',
  'tile-18': 'fce2ad406501deaed49cf40be5b1eec0d2f645c34d5683a510569fc29a1de81b',
  'tile-21': 'c742a4a13b5e85c9f6016bb88313b82cc5211ae131366d205f6bf15231a02602',
};
function upgradeDefaultContent(state) {
  if (!['lobby', 'finished'].includes(state.status)) return false;
  let changed = false;
  state.settings.tiles = state.settings.tiles.map(tile => {
    if (!Object.hasOwn(PREVIOUS_DEFAULT_TILES, tile.id) || digest(tile) !== PREVIOUS_DEFAULT_TILES[tile.id]) return tile;
    changed = true;
    return copy(DEFAULT_MARBLE_SETTINGS.tiles.find(item => item.id === tile.id));
  });
  if (PREVIOUS_DEFAULT_DECKS.has(digest(state.settings.cards))) {
    // An edited tile may draw several legacy cards or combine immediate rewards.
    try { parseMarbleSettings({ cards: DEFAULT_MARBLE_SETTINGS.cards }, state.settings); }
    catch (error) { if (error instanceof MarbleError) return changed; throw error; }
    state.settings.cards = copy(DEFAULT_MARBLE_SETTINGS.cards);
    state.deck = [];
    changed = true;
  }
  return changed;
}
function avatar(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
const profileName = row => String(row?.display_name || '\ud50c\ub808\uc774\uc5b4').slice(0, 40);
function invitation(row, now, member = true) {
  return {
    id: row.id, ownerUserId: row.owner_user_id,
    ...(member ? { memberUserId: row.member_user_id } : {}),
    displayName: row.display_name || '\ud50c\ub808\uc774\uc5b4', avatarUrl: avatar(row.avatar_url),
    status: row.status === 'pending' && new Date(row.expires_at).getTime() <= now ? 'expired' : row.status,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

// Owners are canonical app_users IDs. Authentication and manager scopes belong to
// the router's parent; viewer actions additionally authorize membership here.
export function createMarbleStore({ withPgClient, ensureIdentityTables, deductChannelPointsIfEnoughWithClient, randomInt = cryptoRandomInt, uuid = randomUUID } = {}) {
  if (typeof withPgClient !== 'function' || typeof ensureIdentityTables !== 'function') throw new TypeError('Marble requires PG and identity initialization');
  let schema;
  async function transaction(fn) {
    return withPgClient(async pg => {
      await pg.query('begin');
      try {
        const result = await fn(pg);
        await pg.query('commit');
        return result;
      } catch (error) {
        await pg.query('rollback').catch(() => {});
        throw error;
      }
    }, 0);
  }
  function ensureSchema() {
    if (!schema) schema = (async () => {
      await ensureIdentityTables();
      const sql = `${await readFile(MIGRATION, 'utf8')}\n${await readFile(PARTICIPATION_MIGRATION, 'utf8')}\n${await readFile(OBS_MIGRATION, 'utf8')}`;
      await transaction(async pg => {
        await pg.query('select pg_advisory_xact_lock(hashtext($1))', ['marble-schema:032']);
        await pg.query(sql);
      });
    })().catch(error => { schema = null; throw error; });
    return schema;
  }
  async function dbNow(pg) {
    const value = Number((await pg.query('select floor(extract(epoch from clock_timestamp()) * 1000)::bigint as now')).rows[0]?.now);
    if (!Number.isSafeInteger(value)) throw new Error('Database clock unavailable');
    return value;
  }
  // Never acquire a source lock while holding a room lock. Room-only operations
  // may read participation without locking it, but never mutate it.
  async function lockSource(pg, actor) {
    await pg.query('select pg_advisory_xact_lock(hashtext($1))', [`marble-source:${actor}`]);
  }
  async function participationRow(pg, actor) {
    return (await pg.query('select * from marble_participation where source_user_id=$1', [actor])).rows[0]
      || { revision: 0, settings: copy(DEFAULT_MARBLE_PARTICIPATION_SETTINGS), connected_owner_user_id: null, obs_owner_user_id: null, obs_revision: 0 };
  }
  async function participationPacket(pg, owner, actor) {
    const row = await participationRow(pg, actor);
    const destination = row.connected_owner_user_id;
    const title = destination ? (await pg.query("select state->'settings'->>'title' as title from marble_rooms where owner_user_id=$1", [destination])).rows[0]?.title : null;
    const activeInvite = destination ? (await pg.query("select id from marble_invites where owner_user_id=$1 and member_user_id=$2 and status='accepted'", [destination, actor])).rows[0]?.id : null;
    const suspended = !!destination && (!activeInvite || activeInvite !== row.connected_invitation_id);
    return { revision: Number(row.revision), connected: destination === owner && !suspended, settings: copy(row.settings), ...(suspended ? { suspended: true } : {}),
      connectedOwnerUserId: destination, connectedRoomTitle: title ?? null };
  }
  async function saveParticipation(pg, actor, revision, settings, destination, membership = null) {
    await pg.query(`insert into marble_participation(source_user_id,revision,settings,connected_owner_user_id,connected_invitation_id)
      values($1,$2,$3,$4,$5) on conflict(source_user_id) do update set revision=excluded.revision,
      settings=excluded.settings,connected_owner_user_id=excluded.connected_owner_user_id,
      connected_invitation_id=excluded.connected_invitation_id,updated_at=clock_timestamp()`,
    [actor, revision + 1, JSON.stringify(settings), destination, membership]);
  }
  async function saveObsConnection(pg, actor, destination) {
    await pg.query(`insert into marble_participation(source_user_id,settings,obs_owner_user_id,obs_revision)
      values($1,$2,$3,1) on conflict(source_user_id) do update
      set obs_owner_user_id=excluded.obs_owner_user_id,obs_revision=marble_participation.obs_revision+1,updated_at=clock_timestamp()`,
    [actor, JSON.stringify(DEFAULT_MARBLE_PARTICIPATION_SETTINGS), destination]);
  }
  async function obsConnectionPacket(pg, owner, actor) {
    const row = (await pg.query(`select p.obs_revision,r.owner_user_id,r.state->'settings'->>'title' as title
      from marble_participation p left join marble_rooms r on r.owner_user_id=p.obs_owner_user_id
        and exists(select 1 from marble_invites i where i.owner_user_id=r.owner_user_id and i.member_user_id=p.source_user_id and i.status='accepted')
        and exists(select 1 from jsonb_array_elements(r.state->'players') player where player->>'userId'=p.source_user_id)
      where p.source_user_id=$1`, [actor])).rows[0];
    return { revision: Number(row?.obs_revision || 0), connected: row?.owner_user_id === owner,
      ownerUserId: row?.owner_user_id ?? null, roomTitle: row?.title ?? null };
  }
  async function lockRoom(pg, owner, create) {
    let row = (await pg.query('select * from marble_rooms where owner_user_id=$1 for update', [owner])).rows[0];
    if (!row && create) {
      const profile = (await pg.query('select id,display_name,avatar_url from app_users where id=$1', [owner])).rows[0];
      if (!profile) fail('owner_not_found', 404);
      const state = createMarbleState();
      if (state.players[0]) Object.assign(state.players[0], { userId: owner, name: profileName(profile), avatarUrl: avatar(profile.avatar_url) });
      await pg.query('insert into marble_rooms(owner_user_id,state,revision,overlay_token) values($1,$2,$3,$4) on conflict(owner_user_id) do nothing', [owner, JSON.stringify(state), state.revision, makeToken()]);
      row = (await pg.query('select * from marble_rooms where owner_user_id=$1 for update', [owner])).rows[0];
    }
    if (!row) fail('room_not_found', 404);
    row.state = copy(row.state);
    row.state.revision = Number(row.revision);
    if (upgradeDefaultContent(row.state)) await save(pg, row, row.state);
    return row;
  }
  async function locked(owner, fn, create = true) {
    owner = identifier(owner);
    await ensureSchema();
    return transaction(async pg => {
      const row = await lockRoom(pg, owner, create);
      // Read the wall clock after waiting for the room lock, not at BEGIN.
      return fn(pg, row, await dbNow(pg));
    });
  }
  async function save(pg, row, state) {
    state.revision = Number(row.revision) + 1;
    await pg.query('update marble_rooms set state=$2,revision=$3,overlay_token=$4,updated_at=clock_timestamp() where owner_user_id=$1', [row.owner_user_id, JSON.stringify(state), state.revision, row.overlay_token]);
    row.state = state;
    row.revision = state.revision;
  }
  const apply = (state, input, now) => {
    const { requestId: _requestId, revision: _revision, expectedRollId: _expectedRollId, ...action } = input;
    return applyMarbleAction(state, action, { now, randomInt, uuid });
  };
  async function profiles(pg, state) {
    const ids = [...new Set(state.players.map(player => player.userId).filter(Boolean))];
    if (!ids.length) return;
    const rows = (await pg.query('select id,display_name,avatar_url from app_users where id=any($1::text[])', [ids])).rows;
    const byId = new Map(rows.map(row => [row.id, row]));
    for (const player of state.players) {
      if (!player.userId) { player.avatarUrl = avatar(player.avatarUrl); continue; }
      const profile = byId.get(player.userId);
      player.name = profile ? profileName(profile) : '\ud0c8\ud1f4\ud55c \uc0ac\uc6a9\uc790';
      player.avatarUrl = profile ? avatar(profile.avatar_url) : null;
      if (!profile) for (const entry of state.history) {
        if (entry.playerId === player.id) entry.text = '\ud0c8\ud1f4\ud55c \uc0ac\uc6a9\uc790\uc758 \uae30\ub85d';
      }
    }
  }
  async function hostInvites(pg, owner, now) {
    return (await pg.query(`select i.*,u.display_name,u.avatar_url from marble_invites i
      join app_users u on u.id=i.member_user_id where i.owner_user_id=$1 order by i.created_at desc,i.id limit 100`, [owner])).rows.map(row => invitation(row, now));
  }
  function removeOrigins(state) {
    const cleanRuntime = runtime => {
      if (runtime.lastRoll) {
        const { id, playerId, dice, from, to, path, startedAt, diceDurationMs, stepDurationMs, endsAt, direction } = runtime.lastRoll;
        runtime.lastRoll = { id, playerId, dice, from, to, path, startedAt, diceDurationMs, stepDurationMs, endsAt, source: '', ...(direction ? { direction } : {}) };
      }
      runtime.donationQueue = [];
    };
    cleanRuntime(state);
    for (const runtime of Object.values(state.playerStates || {})) cleanRuntime(runtime);
    state.settings.points = { enabled: false, command: '', cost: 0 };
    state.settings.donation = { enabled: false, minimum: 0 };
  }
  async function packet(pg, row, now, access = 'host', playerId = null) {
    const source = copy(row.state);
    await profiles(pg, source);
    const state = access === 'host' ? source : toPublicMarbleState(source);
    state.deck = [];
    // The public engine projection may remove identities; hosts need them to
    // distinguish linked accounts from offline players in the roster editor.
    state.players = source.players.map(player => {
      if (access === 'host') return player;
      const { userId: _userId, ...visible } = player;
      return visible;
    });
    if (access !== 'host') removeOrigins(state);
    const result = { state, serverNow: now, access };
    if (access !== 'overlay') result.ownerUserId = row.owner_user_id;
    if (access === 'host') {
      result.overlayToken = row.overlay_token;
      result.invitations = await hostInvites(pg, row.owner_user_id, now);
      result.viewerParticipation = await participationPacket(pg, row.owner_user_id, row.owner_user_id);
      result.viewerOverlay = await obsConnectionPacket(pg, row.owner_user_id, row.owner_user_id);
    }
    if (access === 'participant') {
      result.actorPlayerId = playerId;
      const actor = source.players.find(player => player.id === playerId)?.userId;
      result.viewerParticipation = await participationPacket(pg, row.owner_user_id, actor);
      result.viewerOverlay = await obsConnectionPacket(pg, row.owner_user_id, actor);
      result.actorInvitationId = (await pg.query("select id from marble_invites where owner_user_id=$1 and member_user_id=$2 and status='accepted'", [row.owner_user_id, actor])).rows[0]?.id ?? null;
      result.viewerDonationQueueCount = source.playerStates?.[playerId]?.donationQueue?.length || 0;
    }
    return result;
  }
  async function membershipPlayer(pg, row, actor) {
    const player = row.state.players.find(item => item.userId === actor);
    if (!player) fail('not_a_participant', 403);
    if (actor !== row.owner_user_id) {
      const membership = await pg.query("select id from marble_invites where owner_user_id=$1 and member_user_id=$2 and status='accepted'", [row.owner_user_id, actor]);
      if (!membership.rows.length) fail('not_a_participant', 403);
    }
    return player;
  }
  function request(input, operation, actor) {
    object(input);
    const id = identifier(input.requestId, 'invalid_request_id', 160);
    const { requestId: _requestId, ...payload } = input;
    return { key: `action:${id}`, fingerprint: digest({ operation, actor, payload }) };
  }
  async function receipt(pg, owner, req, firstWins = false, source = false) {
    const table = source ? 'marble_source_requests' : 'marble_requests';
    const row = (await pg.query(`select fingerprint,result from ${table} where owner_user_id=$1 and request_id=$2`, [owner, req.key])).rows[0];
    if (row && !firstWins && row.fingerprint !== req.fingerprint) fail('request_id_conflict', 409);
    return row?.result;
  }
  async function record(pg, owner, req, result = { ok: true }, source = false) {
    const table = source ? 'marble_source_requests' : 'marble_requests';
    await pg.query(`insert into ${table}(owner_user_id,request_id,fingerprint,result) values($1,$2,$3,$4)`, [owner, req.key, req.fingerprint, JSON.stringify(result)]);
  }
  function revision(row, input, playerId, targeted = false) {
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) fail('invalid_revision');
    if (targeted) {
      if (!Object.hasOwn(input, 'expectedRollId')) fail('expected_roll_id_required');
      const runtime = row.state.playerStates?.[playerId];
      if (!runtime) fail('player_not_found', 404);
      if (input.expectedRollId !== (runtime.lastRoll?.id ?? null)) fail('stale_player_state', 409);
      if (input.revision > Number(row.revision)) fail('stale_revision', 409);
      return;
    }
    if (input.revision !== Number(row.revision)) fail('stale_revision', 409);
  }
  function editable(row) {
    if (!['lobby', 'finished'].includes(row.state.status)) fail('roster_locked', 409);
  }
  async function configuration(owner) {
    owner = identifier(owner);
    await ensureSchema();
    const row = (await withPgClient(pg => pg.query(`select r.state->'settings' as settings,r.state->>'status' as status,r.state->>'phase' as phase,
      p.settings as participation_settings,p.connected_owner_user_id,
      exists(select 1 from jsonb_array_elements(r.state->'players') player where player->>'userId'=u.id)
        and exists(select 1 from marble_invites i where i.owner_user_id=r.owner_user_id and i.member_user_id=u.id and i.status='accepted' and i.id=p.connected_invitation_id) as member
      from app_users u left join marble_participation p on p.source_user_id=u.id
      left join marble_rooms r on r.owner_user_id=coalesce(p.connected_owner_user_id,u.id) where u.id=$1`, [owner]))).rows[0];
    if (row?.connected_owner_user_id) return { settings: copy(row.participation_settings),
      status: row.member && row.status ? row.status : 'unavailable', phase: row.member ? row.phase : null,
      connectedOwnerUserId: row.connected_owner_user_id };
    return row?.settings ? copy({ settings: row.settings, status: row.status, phase: row.phase }) : null;
  }
  async function snapshot(owner) { return locked(owner, (pg, row, now) => packet(pg, row, now)); }
  async function participantSnapshot(owner, actor) {
    actor = identifier(actor);
    return locked(owner, async (pg, row, now) => packet(pg, row, now, 'participant', (await membershipPlayer(pg, row, actor)).id), false);
  }
  async function participation(owner, actor, input) {
    owner = identifier(owner); actor = identifier(actor);
    if (owner === actor) fail('host_participation_forbidden', 403);
    input = parseMarbleParticipationInput(input);
    const req = request(input, `participation:${owner}`, actor);
    req.key = `participation:${input.requestId}`;
    await ensureSchema();
    return transaction(async pg => {
      await lockSource(pg, actor);
      const current = await participationRow(pg, actor);
      const row = await lockRoom(pg, owner, false);
      const player = await membershipPlayer(pg, row, actor);
      if (!await receipt(pg, actor, req, false, true)) {
        if (Number(current.revision) !== input.participationRevision) fail('stale_participation_revision', 409);
        const destination = input.connected ? owner : current.connected_owner_user_id === owner ? null : current.connected_owner_user_id;
        const membership = input.connected ? (await pg.query("select id from marble_invites where owner_user_id=$1 and member_user_id=$2 and status='accepted'", [owner, actor])).rows[0]?.id : destination ? current.connected_invitation_id : null;
        await saveParticipation(pg, actor, Number(current.revision), input.settings, destination, membership);
        await record(pg, actor, req, { ok: true }, true);
      }
      return packet(pg, row, await dbNow(pg), 'participant', player.id);
    });
  }
  async function disconnectParticipation(owner, input) {
    owner = identifier(owner);
    input = parseMarbleParticipationInput(input, true);
    const req = request(input, 'participation-disconnect', owner);
    req.key = `participation:${input.requestId}`;
    await ensureSchema();
    return transaction(async pg => {
      await lockSource(pg, owner);
      const current = await participationRow(pg, owner);
      const row = await lockRoom(pg, owner, true);
      if (!await receipt(pg, owner, req, false, true)) {
        if (Number(current.revision) !== input.participationRevision) fail('stale_participation_revision', 409);
        await saveParticipation(pg, owner, Number(current.revision), current.settings, null);
        await record(pg, owner, req, { ok: true }, true);
      }
      return packet(pg, row, await dbNow(pg));
    });
  }
  async function mutate(owner, input, operation, actorOptions = {}) {
    owner = identifier(owner);
    const participant = actorOptions.participant === true || actorOptions.access === 'participant' || actorOptions.actorUserId != null;
    const actor = participant ? identifier(actorOptions.actorUserId) : owner;
    const req = request(input, operation, actor);
    return locked(owner, async (pg, row, now) => {
      const player = participant ? await membershipPlayer(pg, row, actor) : null;
      const access = participant ? 'participant' : 'host';
      if (await receipt(pg, owner, req)) return packet(pg, row, now, access, player?.id);
      let action = { ...input, action: operation === 'act' ? input.action : operation };
      if (participant) {
        if (operation !== 'act' || !PARTICIPANT_ACTIONS.has(action.action) || !row.state.settings.participantControl) fail('participant_control_forbidden', 403);
        if (row.state.status !== 'running') fail('game_not_running', 409);
        // A supplied playerId or focused pawn never grants control of another account.
        action = { action: action.action, playerId: player.id, ...(action.action === 'pass' ? { useShield: true } : {}),
          ...(action.action === 'challenge-result' ? { outcome: input.outcome } : {}) };
      } else if (operation === 'act') {
        if (!HOST_ACTIONS.has(action.action)) fail('invalid_action');
        if (['add-player', 'remove-player', 'update-player'].includes(action.action)) {
          editable(row);
          if (Object.hasOwn(action, 'userId')) fail('linked_identity_is_managed', 403);
          const target = row.state.players.find(item => item.id === action.playerId);
          if (target?.userId && (action.name !== undefined || action.avatarUrl !== undefined)) fail('linked_identity_is_managed', 403);
          if (action.action === 'add-player' && row.state.players.length >= 8) fail('room_full', 409);
        }
      }
      const targetId = player?.id || action.playerId || row.state.currentPlayerId || row.state.players[0]?.id;
      revision(row, input, targetId, operation === 'act' && PARTICIPANT_ACTIONS.has(action.action));
      const state = apply(row.state, action, now);
      await save(pg, row, state);
      if (action.action === 'remove-player') {
        await pg.query(`update marble_invites set status='revoked',updated_at=clock_timestamp()
          where owner_user_id=$1 and status='accepted' and not (member_user_id=any($2::text[]))`, [owner, state.players.map(item => item.userId).filter(Boolean)]);
      }
      await record(pg, owner, req);
      return packet(pg, row, now, access, player?.id);
    }, !participant);
  }
  const act = (owner, input, actorOptions) => mutate(owner, input, 'act', actorOptions);
  const settings = (owner, input) => mutate(owner, input, 'settings');
  const layout = (owner, input) => mutate(owner, input, 'layout');
  async function rotateOverlay(owner, input) {
    owner = identifier(owner);
    const req = request(input, 'rotate-overlay', owner);
    return locked(owner, async (pg, row, now) => {
      if (!await receipt(pg, owner, req)) {
        row.overlay_token = makeToken();
        await save(pg, row, row.state);
        await record(pg, owner, req);
      }
      return packet(pg, row, now);
    });
  }
  async function overlay(token) {
    if (typeof token !== 'string' || !/^marble_[A-Za-z0-9_-]{43}$/.test(token)) fail('invalid_overlay_token', 401);
    await ensureSchema();
    return transaction(async pg => {
      // Resolve the token, connection and room from one MVCC snapshot. Do not
      // lock two rooms: channels can be connected to each other's games.
      const row = (await pg.query(`select target.owner_user_id,target.state,target.revision,
        source.owner_user_id as source_owner_user_id,source.revision as source_revision,
        source.state as source_state,
        source.state->'settings'->'layouts' as source_layouts,
        coalesce(p.obs_revision,0) as obs_revision,p.obs_owner_user_id,
        exists(select 1 from marble_invites i where i.owner_user_id=target.owner_user_id
          and i.member_user_id=source.owner_user_id and i.status='accepted') as is_member
        from marble_rooms source
        left join marble_participation p on p.source_user_id=source.owner_user_id
        left join marble_rooms target on target.owner_user_id=coalesce(p.obs_owner_user_id,source.owner_user_id)
        where source.overlay_token=$1`, [token])).rows[0];
      if (!row) fail('invalid_overlay_token', 401);
      const invalidMembership = !!row.obs_owner_user_id && (!row.is_member || !row.state?.players.some(player => player.userId === row.source_owner_user_id));
      // Revocation/deletion restores the token owner's board, never a different
      // accepted room. Paid routing remains untouched and fails closed separately.
      if (invalidMembership) Object.assign(row, { owner_user_id: row.source_owner_user_id, state: row.source_state, revision: row.source_revision });
      const ownPlayer = row.state.players.find(player => player.userId === row.source_owner_user_id);
      row.state.revision = Number(row.revision);
      const result = await packet(pg, row, await dbNow(pg), 'overlay');
      const online = (!invalidMembership && row.obs_owner_user_id) || row.state.players.some(player => player.userId && player.userId !== row.source_owner_user_id);
      if (online && ownPlayer) {
        Object.assign(result.state, result.state.playerStates[ownPlayer.id], { currentPlayerId: ownPlayer.id });
      }
      result.state.settings.layouts = copy(row.source_layouts);
      // Room revisions are independent. Connection changes must outrank them,
      // including a return to the channel's lower-revision personal room.
      // The fallback bit is monotonic until a new explicit selection/acceptance
      // advances obs_revision. It outranks both independent room revisions.
      result.overlayRevision = { connection: Number(row.obs_revision) * 2 + Number(invalidMembership), source: Number(row.source_revision) };
      return result;
    });
  }
  async function searchUsers(owner, q = '') {
    owner = identifier(owner);
    if (typeof q !== 'string' || q.length > 100 || /[\u0000-\u001f\u007f]/.test(q)) fail('invalid_query');
    if (!q.trim()) return [];
    await ensureSchema();
    const pattern = `%${q.trim().replace(/[!%_]/g, '!$&')}%`;
    const rows = (await withPgClient(pg => pg.query(`select id,display_name,avatar_url,primary_provider from app_users
      where id<>$1 and (display_name ilike $2 escape '!' or id ilike $2 escape '!')
      order by coalesce(display_name,id),id limit 20`, [owner, pattern]))).rows;
    return rows.map(row => ({ userId: row.id, displayName: profileName(row), avatarUrl: avatar(row.avatar_url), provider: row.primary_provider }));
  }
  async function invite(owner, input) {
    owner = identifier(owner);
    const req = request(input, 'invite', owner);
    const member = identifier(input.memberUserId);
    if (member === owner) fail('cannot_invite_self');
    return locked(owner, async (pg, row, now) => {
      if (await receipt(pg, owner, req)) return packet(pg, row, now);
      editable(row);
      if (!(await pg.query('select id,display_name,avatar_url from app_users where id=$1', [member])).rows.length) fail('user_not_found', 404);
      if (row.state.players.length >= 8) fail('room_full', 409);
      await pg.query("update marble_invites set status='revoked',updated_at=clock_timestamp() where owner_user_id=$1 and member_user_id=$2 and status='pending' and expires_at<=to_timestamp($3 / 1000.0)", [owner, member, now]);
      const existing = (await pg.query("select * from marble_invites where owner_user_id=$1 and member_user_id=$2 and status in ('pending','accepted')", [owner, member])).rows[0];
      if (!existing) await pg.query("insert into marble_invites(id,owner_user_id,member_user_id,expires_at) values($1,$2,$3,to_timestamp($4 / 1000.0)+interval '7 days')", [uuid(), owner, member, now]);
      await record(pg, owner, req);
      return packet(pg, row, now);
    });
  }
  async function revoke(owner, id) {
    owner = identifier(owner); id = inviteId(id);
    return locked(owner, async (pg, row, now) => {
      const item = (await pg.query('select * from marble_invites where owner_user_id=$1 and id=$2 for update', [owner, id])).rows[0];
      if (!item) fail('invitation_not_found', 404);
      if (item.status !== 'revoked') {
        editable(row);
        const player = row.state.players.find(entry => entry.userId === item.member_user_id);
        if (player) await save(pg, row, apply(row.state, { action: 'remove-player', playerId: player.id }, now));
        await pg.query("update marble_invites set status='revoked',updated_at=clock_timestamp() where id=$1", [id]);
      }
      return packet(pg, row, now);
    }, false);
  }
  async function listMembership(pg, actor, now) {
    const rows = (await pg.query(`select i.*,u.display_name,u.avatar_url from marble_invites i
      join app_users u on u.id=i.owner_user_id where i.member_user_id=$1 order by i.created_at desc,i.id limit 100`, [actor])).rows;
    const rooms = (await pg.query(`select r.owner_user_id,r.state,u.display_name,u.avatar_url from marble_rooms r
      join app_users u on u.id=r.owner_user_id where exists(select 1 from marble_invites i
        where i.owner_user_id=r.owner_user_id and i.member_user_id=$1 and i.status='accepted')
      and exists(select 1 from jsonb_array_elements(r.state->'players') p where p->>'userId'=$1)
      order by r.updated_at desc limit 100`, [actor])).rows;
    return {
      invitations: rows.map(row => invitation(row, now, false)),
      viewerOverlay: await obsConnectionPacket(pg, null, actor),
      rooms: rooms.map(row => ({ ownerUserId: row.owner_user_id, displayName: profileName(row), avatarUrl: avatar(row.avatar_url), title: row.state.settings.title, status: row.state.status, playerId: row.state.players.find(player => player.userId === actor)?.id })),
    };
  }
  async function invitations(actor) {
    actor = identifier(actor);
    await ensureSchema();
    return transaction(async pg => listMembership(pg, actor, await dbNow(pg)));
  }
  async function answerInvite(actor, id, input) {
    actor = identifier(actor); id = inviteId(id);
    const req = request(input, `answer:${id}`, actor);
    if (!['accept', 'decline'].includes(input.action)) fail('invalid_invitation_action');
    await ensureSchema();
    return transaction(async pg => {
      await lockSource(pg, actor);
      const initial = (await pg.query('select owner_user_id from marble_invites where id=$1 and member_user_id=$2', [id, actor])).rows[0];
      if (!initial) fail('invitation_not_found', 404);
      // Every invitation mutation locks room before invite, including accept/revoke.
      const row = await lockRoom(pg, initial.owner_user_id, false);
      const now = await dbNow(pg);
      const item = (await pg.query('select * from marble_invites where owner_user_id=$1 and id=$2 for update', [row.owner_user_id, id])).rows[0];
      if (!item || item.member_user_id !== actor) fail('invitation_not_found', 404);
      if (item.status === 'revoked') fail('invitation_revoked', 409);
      if (!await receipt(pg, row.owner_user_id, req)) {
        const desired = input.action === 'accept' ? 'accepted' : 'declined';
        if (item.status !== desired) {
          if (item.status !== 'pending') fail('invitation_already_answered', 409);
          if (new Date(item.expires_at).getTime() <= now) fail('invitation_expired', 409);
          if (input.action === 'accept') {
            editable(row);
            const profile = (await pg.query('select id,display_name,avatar_url from app_users where id=$1', [actor])).rows[0];
            if (!profile) fail('user_not_found', 404);
            if (!row.state.players.some(player => player.userId === actor)) {
              if (row.state.players.length >= 8) fail('room_full', 409);
              await save(pg, row, apply(row.state, { action: 'add-player', name: profileName(profile), avatarUrl: avatar(profile.avatar_url), color: MARBLE_COLORS[row.state.players.length % MARBLE_COLORS.length], userId: actor }, now));
            }
          }
          await pg.query('update marble_invites set status=$2,updated_at=clock_timestamp() where id=$1', [id, desired]);
          if (desired === 'accepted') await saveObsConnection(pg, actor, row.owner_user_id);
        }
        if (desired === 'accepted') await membershipPlayer(pg, row, actor);
        await record(pg, row.owner_user_id, req);
      } else if (input.action === 'accept') await membershipPlayer(pg, row, actor);
      return { ...await listMembership(pg, actor, now), ownerUserId: row.owner_user_id };
    });
  }
  async function selectOverlayRoom(owner, actor, input) {
    owner = identifier(owner); actor = identifier(actor); object(input);
    if (owner === actor) fail('host_participation_forbidden', 403);
    if (Object.keys(input).some(key => !['requestId', 'overlayRevision'].includes(key))
      || !Number.isSafeInteger(input.overlayRevision) || input.overlayRevision < 0) fail('invalid_request');
    const req = request(input, `obs:${owner}`, actor); req.key = `obs:${input.requestId}`;
    await ensureSchema();
    return transaction(async pg => {
      await lockSource(pg, actor);
      const row = await lockRoom(pg, owner, false);
      const player = await membershipPlayer(pg, row, actor);
      if (!await receipt(pg, actor, req, false, true)) {
        const current = await participationRow(pg, actor);
        if (Number(current.obs_revision) !== input.overlayRevision) fail('stale_overlay_revision', 409);
        if (current.obs_owner_user_id !== owner) await saveObsConnection(pg, actor, owner);
        await record(pg, actor, req, { ok: true }, true);
      }
      return packet(pg, row, await dbNow(pg), 'participant', player.id);
    });
  }
  async function leave(owner, actor, input) {
    owner = identifier(owner); actor = identifier(actor); object(input);
    if (owner === actor) fail('host_participation_forbidden', 403);
    if (Object.keys(input).some(key => !['requestId', 'invitationId'].includes(key))) fail('invalid_request');
    const id = inviteId(input.invitationId);
    const req = request(input, `leave:${owner}`, actor); req.key = `leave:${input.requestId}`;
    await ensureSchema();
    return transaction(async pg => {
      await lockSource(pg, actor);
      if (await receipt(pg, actor, req, false, true)) return listMembership(pg, actor, await dbNow(pg));
      const row = await lockRoom(pg, owner, false);
      const now = await dbNow(pg);
      const item = (await pg.query('select * from marble_invites where owner_user_id=$1 and id=$2 for update', [owner, id])).rows[0];
      if (!item || item.member_user_id !== actor) fail('invitation_not_found', 404);
      if (!['accepted', 'revoked'].includes(item.status)) fail('not_a_participant', 403);
      if (item.status === 'accepted') {
        const player = row.state.players.find(entry => entry.userId === actor);
        if (player) await save(pg, row, apply(row.state, { action: 'leave-player', playerId: player.id }, now));
        await pg.query("update marble_invites set status='revoked',updated_at=clock_timestamp() where id=$1", [id]);
        const current = await participationRow(pg, actor);
        if (current.obs_owner_user_id === owner) await saveObsConnection(pg, actor, null);
      }
      await record(pg, actor, req, { ok: true }, true);
      return listMembership(pg, actor, now);
    });
  }
  async function trigger(owner, input) {
    owner = identifier(owner); object(input);
    if (!['points', 'donation'].includes(input.source)) fail('invalid_trigger_source');
    const eventId = identifier(input.eventId, 'invalid_event_id', 512);
    const provider = identifier(input.provider, 'invalid_provider', 32);
    const req = { key: `event:${digest([provider, input.source, eventId])}`, fingerprint: digest(input) };
    await ensureSchema();
    return transaction(async pg => {
      await lockSource(pg, owner);
      const previous = await receipt(pg, owner, req, true, true);
      if (previous) return { ...previous, duplicate: true };
      const personal = await participationRow(pg, owner);
      const destination = personal.connected_owner_user_id;
      let row, participant;
      try {
        row = await lockRoom(pg, destination || owner, !destination);
        if (destination) {
          participant = await membershipPlayer(pg, row, owner);
          const membership = (await pg.query("select id from marble_invites where owner_user_id=$1 and member_user_id=$2 and status='accepted'", [destination, owner])).rows[0]?.id;
          if (membership !== personal.connected_invitation_id) fail('viewer_participation_reconnect_required', 403);
        }
      } catch (error) {
        if (!destination || !['room_not_found', 'not_a_participant', 'viewer_participation_reconnect_required'].includes(error.code)) throw error;
        const result = { accepted: false, reason: error.code };
        await record(pg, owner, req, result, true);
        return result;
      }
      const now = await dbNow(pg);
      let result;
      const state = row.state;
      const triggerSettings = destination ? personal.settings : state.settings;
      const previousRevision = row.revision;
      await pg.query('savepoint marble_trigger');
      try {
        // A connected source owns exactly one pawn, regardless of host focus/target.
        const playerId = participant?.id || state.settings.triggerPlayerId || state.players[0]?.id;
        const player = state.players.find(entry => entry.id === playerId);
        const runtime = state.playerStates?.[playerId];
        const ready = state.status === 'running' && runtime?.phase === 'ready';
        if (!['running', 'paused'].includes(state.status)) result = { accepted: false, reason: 'inactive' };
        else if (!player || !runtime) result = { accepted: false, reason: 'target_unavailable' };
        else if (input.source === 'points') {
          const config = triggerSettings.points;
          const command = typeof input.command === 'string' ? input.command.normalize('NFKC').trim().toLowerCase() : '';
          if (!config.enabled) result = { accepted: false, reason: 'disabled' };
          else if (command !== config.command.normalize('NFKC').trim().toLowerCase()) result = { accepted: false, reason: 'command_mismatch' };
          else if (!ready || runtime.donationQueue?.length) result = { accepted: false, reason: 'busy' };
          else {
            const userId = identifier(input.userId);
            const channelUid = identifier(input.channelUid, 'invalid_channel_uid');
            if (typeof deductChannelPointsIfEnoughWithClient !== 'function') throw new Error('Atomic point deduction is unavailable');
            const username = String(input.username || '\uc2dc\uccad\uc790').slice(0, 80);
            const next = apply(state, { action: 'roll', playerId, source: 'points', username }, now);
            const deduction = await deductChannelPointsIfEnoughWithClient(pg, channelUid, userId, username, config.cost);
            if (deduction?.deducted !== true) result = { accepted: false, reason: 'insufficient_points', cost: config.cost };
            else { await save(pg, row, next); result = { accepted: true, cost: config.cost }; }
          }
        } else {
          const config = triggerSettings.donation;
          if (!config.enabled) result = { accepted: false, reason: 'disabled' };
          else if (input.currency !== 'KRW') result = { accepted: false, reason: 'unsupported_currency' };
          else if (!Number.isFinite(input.amount) || input.amount < config.minimum) result = { accepted: false, reason: 'below_minimum' };
          else if ((runtime.donationQueue?.length || 0) >= 20) result = { accepted: false, reason: 'queue_full' };
          else {
            const donation = { id: uuid(), username: String(input.username || '\ud6c4\uc6d0\uc790').slice(0, 80), provider };
            const action = ready && !runtime.donationQueue?.length
              ? { action: 'roll', playerId, source: 'donation', username: donation.username }
              : { action: 'enqueue-donation', playerId, donation };
            await save(pg, row, apply(state, action, now));
            result = { accepted: true, queued: action.action === 'enqueue-donation' };
          }
        }
      } catch (error) {
        if (!(error.status >= 400 && error.status < 500) && error.code !== 'invalid_point_identity') throw error;
        // Persist domain rejections too, but never retain partial point/state writes.
        await pg.query('rollback to savepoint marble_trigger');
        row.state = state;
        row.revision = previousRevision;
        result = { accepted: false, reason: error.code || 'invalid_trigger' };
      }
      await pg.query('release savepoint marble_trigger');
      await record(pg, owner, req, result, true);
      return { ...result, snapshot: await packet(pg, row, now, destination ? 'participant' : 'host', participant?.id) };
    });
  }
  return { ensureSchema, configuration, snapshot, act, settings, layout, rotateOverlay, overlay, searchUsers, invite, revoke, invitations, answerInvite, participantSnapshot, participation, disconnectParticipation, selectOverlayRoom, leave, trigger };
}
