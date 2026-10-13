import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createMarbleStore } from '../server/marble-store.js';
import { createMarbleState, DEFAULT_MARBLE_SETTINGS, DEFAULT_MARBLE_PARTICIPATION_SETTINGS } from '../shared/marble.js';

const legacyDefaults = JSON.parse(await readFile(new URL('./fixtures/marble-legacy-party-defaults.json', import.meta.url), 'utf8'));

const clone = value => structuredClone(value);
const owner = 'owner';
const member = 'member';
const actorOptions = { participant: true, actorUserId: member };

// Stateful PG double: clients contend on room locks, writes undo on rollback,
// and every mutation asserts the lock. The production module and engine run unchanged.
function fixture() {
  const db = {
    rooms: new Map(), invites: new Map(), receipts: new Map(), sourceReceipts: new Map(), participations: new Map(), balances: new Map([['viewer', 10000]]),
    users: new Map(['owner', 'member', 'other', ...Array.from({ length: 10 }, (_, i) => `user-${i}`)].map(id => [id, { id, display_name: `Name ${id}`, avatar_url: `https://images.example/${id}.png`, primary_provider: 'chzzk' }])),
    now: 1800000000000, calls: [], retries: [], deductions: [], identityCalls: 0, uuid: 0, request: 0,
  };
  const queues = new Map();
  async function acquire(key) {
    const previous = queues.get(key) || Promise.resolve();
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    queues.set(key, promise);
    await previous;
    return () => { release(); if (queues.get(key) === promise) queues.delete(key); };
  }
  const withPgClient = async (fn, retries) => {
    db.retries.push(retries);
    const locks = new Map(), undo = [];
    let active = false, savepoint = 0;
    const pg = {
      async lock(id) { if (!locks.has(id)) locks.set(id, await acquire(id)); },
      write(map, key, value) {
        assert.equal(active, true, 'Writes must be transactional');
        const prior = clone(map.get(key));
        undo.push(() => prior === undefined ? map.delete(key) : map.set(key, prior));
        map.set(key, clone(value));
      },
      async query(sql, values = []) {
        const s = sql.replace(/\s+/g, ' ').trim();
        db.calls.push({ sql: s, values: clone(values), pg });
        if (db.fail && db.fail.test(s)) { db.fail = null; throw new Error('injected database failure'); }
        const rows = list => ({ rows: clone(list) });
        const roomLock = id => assert.equal(locks.has(id), true, `Missing room lock for ${s}`);
        if (s === 'begin') { active = true; return rows([]); }
        if (s === 'savepoint marble_trigger') { savepoint = undo.length; return rows([]); }
        if (s === 'rollback to savepoint marble_trigger') { for (const restore of undo.splice(savepoint).reverse()) restore(); return rows([]); }
        if (s === 'release savepoint marble_trigger') return rows([]);
        if (s === 'commit' || s === 'rollback') {
          if (s === 'rollback' && active) for (const restore of undo.reverse()) restore();
          active = false;
          for (const release of locks.values()) release();
          locks.clear();
          if (s === 'commit' && db.failCommit) { db.failCommit = false; throw Object.assign(new Error('server closed the connection after COMMIT'), { code: 'XX000' }); }
          return rows([]);
        }
        if (s.startsWith('select pg_advisory_xact_lock')) {
          await pg.lock(values[0]);
          return rows([]);
        }
        if (s.startsWith('create table if not exists marble_rooms')) return rows([]);
        if (s === 'select * from marble_participation where source_user_id=$1') return rows(db.participations.has(values[0]) ? [db.participations.get(values[0])] : []);
        if (s.startsWith('insert into marble_participation(')) {
          if (s.startsWith('insert into marble_participation(source_user_id,settings,obs_owner_user_id')) {
            const [actor, settings, destination] = values;
            assert.ok(locks.has(`marble-source:${actor}`));
            const current = db.participations.get(actor) || { source_user_id: actor, revision: 0, settings: JSON.parse(settings), connected_owner_user_id: null, obs_revision: 0 };
            pg.write(db.participations, actor, { ...current, obs_owner_user_id: destination, obs_revision: current.obs_revision + 1 });
            return rows([]);
          }
          const [actor, revision, settings, destination, membership] = values;
          assert.ok(locks.has(`marble-source:${actor}`));
          pg.write(db.participations, actor, { obs_owner_user_id: null, obs_revision: 0, ...db.participations.get(actor), source_user_id: actor, revision, settings: JSON.parse(settings), connected_owner_user_id: destination, connected_invitation_id: membership });
          return rows([]);
        }
        if (s.startsWith('select p.obs_revision,r.owner_user_id,')) {
          const p = db.participations.get(values[0]);
          if (!p) return rows([]);
          const room = db.rooms.get(p.obs_owner_user_id);
          const accepted = room?.state.players.some(player => player.userId === values[0]) && [...db.invites.values()].some(i => i.owner_user_id === room.owner_user_id && i.member_user_id === values[0] && i.status === 'accepted');
          return rows([{ obs_revision: p.obs_revision, owner_user_id: accepted ? room.owner_user_id : null, title: accepted ? room.state.settings.title : null }]);
        }
        if (s.startsWith("select state->'settings'->>'title'")) {
          const room = db.rooms.get(values[0]);
          return rows(room ? [{ title: room.state.settings.title }] : []);
        }
        if (s.startsWith("select r.state->'settings'")) {
          const personal = db.participations.get(values[0]);
          const destination = personal?.connected_owner_user_id || values[0];
          const room = db.rooms.get(destination);
          const member = room?.state.players.some(player => player.userId === values[0]) && [...db.invites.values()].some(item => item.owner_user_id === destination && item.member_user_id === values[0] && item.status === 'accepted' && item.id === personal?.connected_invitation_id);
          return rows(db.users.has(values[0]) ? [{ settings: room?.state.settings, status: room?.state.status, phase: room?.state.phase,
            participation_settings: personal?.settings, connected_owner_user_id: personal?.connected_owner_user_id, member }] : []);
        }
        if (s.startsWith('select floor(extract(epoch')) return rows([{ now: String(db.now) }]);
        if (s === 'select * from marble_rooms where owner_user_id=$1 for update') {
          await pg.lock(values[0]);
          return rows(db.rooms.has(values[0]) ? [db.rooms.get(values[0])] : []);
        }
        if (s.startsWith('select target.owner_user_id,target.state,target.revision,')) {
          const source = [...db.rooms.values()].find(row => row.overlay_token === values[0]);
          if (!source) return rows([]);
          const personal = db.participations.get(source.owner_user_id);
          const target = db.rooms.get(personal?.obs_owner_user_id || source.owner_user_id);
          return rows([{ ...target, source_owner_user_id: source.owner_user_id, source_revision: source.revision,
            source_state: source.state, source_layouts: source.state.settings.layouts, obs_revision: personal?.obs_revision || 0,
            obs_owner_user_id: personal?.obs_owner_user_id,
            is_member: [...db.invites.values()].some(item => item.owner_user_id === target?.owner_user_id && item.member_user_id === source.owner_user_id && item.status === 'accepted') }]);
        }
        if (s.startsWith("select state->'settings'")) {
          const room = db.rooms.get(values[0]);
          return rows(room ? [{ settings: room.state.settings, status: room.state.status, phase: room.state.phase }] : []);
        }
        if (s.startsWith('insert into marble_rooms')) {
          const [id, state, revision, token] = values; roomLock(id);
          if (!db.rooms.has(id)) pg.write(db.rooms, id, { owner_user_id: id, state: JSON.parse(state), revision, overlay_token: token });
          return rows([]);
        }
        if (s.startsWith('update marble_rooms set')) {
          const [id, state, revision, token] = values; roomLock(id);
          pg.write(db.rooms, id, { ...db.rooms.get(id), state: JSON.parse(state), revision, overlay_token: token });
          return rows([]);
        }
        if (s === 'select id,display_name,avatar_url from app_users where id=$1') return rows(db.users.has(values[0]) ? [db.users.get(values[0])] : []);
        if (s === 'select id,display_name,avatar_url from app_users where id=any($1::text[])') return rows(values[0].flatMap(id => db.users.has(id) ? [db.users.get(id)] : []));
        if (s.startsWith('select id,display_name,avatar_url,primary_provider from app_users')) {
          const query = values[1].slice(1, -1).replace(/!([!%_])/g, '$1').toLowerCase();
          return rows([...db.users.values()].filter(row => row.id !== values[0] && `${row.id} ${row.display_name}`.toLowerCase().includes(query)).slice(0, 20));
        }
        if (s.startsWith('select fingerprint,result from marble_requests')) {
          roomLock(values[0]);
          const item = db.receipts.get(`${values[0]}|${values[1]}`);
          return rows(item ? [item] : []);
        }
        if (s.startsWith('select fingerprint,result from marble_source_requests')) {
          assert.ok(locks.has(`marble-source:${values[0]}`));
          const item = db.sourceReceipts.get(`${values[0]}|${values[1]}`);
          return rows(item ? [item] : []);
        }
        if (s.startsWith('insert into marble_source_requests')) {
          const [id, key, fingerprint, result] = values;
          assert.ok(locks.has(`marble-source:${id}`));
          assert.equal(db.sourceReceipts.has(`${id}|${key}`), false, 'Source receipt uniqueness');
          pg.write(db.sourceReceipts, `${id}|${key}`, { fingerprint, result: JSON.parse(result) });
          return rows([]);
        }
        if (s.startsWith('insert into marble_requests')) {
          const [id, key, fingerprint, result] = values; roomLock(id);
          assert.equal(db.receipts.has(`${id}|${key}`), false, 'Receipt uniqueness');
          pg.write(db.receipts, `${id}|${key}`, { fingerprint, result: JSON.parse(result) });
          return rows([]);
        }
        if (s.startsWith('select i.*,u.display_name,u.avatar_url from marble_invites')) {
          const host = s.includes('where i.owner_user_id=$1');
          return rows([...db.invites.values()].filter(item => item[host ? 'owner_user_id' : 'member_user_id'] === values[0]).flatMap(item => {
            const profile = db.users.get(item[host ? 'member_user_id' : 'owner_user_id']);
            return profile ? [{ ...item, display_name: profile.display_name, avatar_url: profile.avatar_url }] : [];
          }));
        }
        if (s.startsWith('select r.owner_user_id,r.state,u.display_name,u.avatar_url')) return rows([...db.rooms.values()].filter(room =>
          room.state.players.some(player => player.userId === values[0]) && [...db.invites.values()].some(item => item.owner_user_id === room.owner_user_id && item.member_user_id === values[0] && item.status === 'accepted')
        ).map(room => ({ ...room, ...Object.fromEntries(['display_name', 'avatar_url'].map(key => [key, db.users.get(room.owner_user_id)?.[key]])) })));
        if (s === "select id from marble_invites where owner_user_id=$1 and member_user_id=$2 and status='accepted'") {
          return rows([...db.invites.values()].filter(item => item.owner_user_id === values[0] && item.member_user_id === values[1] && item.status === 'accepted'));
        }
        if (s === 'select owner_user_id from marble_invites where id=$1 and member_user_id=$2') {
          const item = db.invites.get(values[0]);
          return rows(item?.member_user_id === values[1] ? [{ owner_user_id: item.owner_user_id }] : []);
        }
        if (s === 'select * from marble_invites where owner_user_id=$1 and id=$2 for update') {
          roomLock(values[0]);
          const item = db.invites.get(values[1]);
          return rows(item?.owner_user_id === values[0] ? [item] : []);
        }
        if (s.startsWith("select * from marble_invites where owner_user_id=$1 and member_user_id=$2 and status in")) return rows([...db.invites.values()].filter(item => item.owner_user_id === values[0] && item.member_user_id === values[1] && ['pending', 'accepted'].includes(item.status)));
        if (s.startsWith('insert into marble_invites')) {
          const [id, ownerId, memberId, now] = values; roomLock(ownerId);
          pg.write(db.invites, id, { id, owner_user_id: ownerId, member_user_id: memberId, status: 'pending', expires_at: new Date(now + 7 * 86400000), created_at: new Date(now) });
          return rows([]);
        }
        if (s.startsWith("update marble_invites set status='revoked'") && s.includes("and status='pending'")) {
          roomLock(values[0]);
          for (const [id, item] of db.invites) if (item.owner_user_id === values[0] && item.member_user_id === values[1] && item.status === 'pending' && +new Date(item.expires_at) <= values[2]) pg.write(db.invites, id, { ...item, status: 'revoked' });
          return rows([]);
        }
        if (s.startsWith("update marble_invites set status='revoked'") && s.includes('not (member_user_id=any')) {
          roomLock(values[0]);
          for (const [id, item] of db.invites) if (item.owner_user_id === values[0] && item.status === 'accepted' && !values[1].includes(item.member_user_id)) pg.write(db.invites, id, { ...item, status: 'revoked' });
          return rows([]);
        }
        if (s.startsWith('update marble_invites set') && s.endsWith('where id=$1')) {
          const item = db.invites.get(values[0]); roomLock(item.owner_user_id);
          pg.write(db.invites, item.id, { ...item, status: values[1] || 'revoked' });
          return rows([]);
        }
        throw new Error(`Unexpected query: ${s}`);
      },
    };
    return fn(pg);
  };
  function newStore() {
    return createMarbleStore({
      withPgClient,
      ensureIdentityTables: async () => { db.identityCalls++; if (db.failIdentity) { db.failIdentity = false; throw new Error('schema unavailable'); } },
      uuid: () => `00000000-0000-4000-8000-${String(++db.uuid).padStart(12, '0')}`,
      randomInt: () => 0,
      deductChannelPointsIfEnoughWithClient: async (pg, channel, user, username, cost) => {
        db.deductions.push({ pg, channel, user, username, cost });
        const balance = db.balances.get(user) || 0;
        if (balance < cost) return { deducted: false };
        pg.write(db.balances, user, balance - cost);
        return { deducted: true };
      },
    });
  }
  db.store = newStore(); db.newStore = newStore;
  db.key = () => `request-${++db.request}`;
  db.state = () => db.rooms.get(owner).state;
  db.action = async (action, extra = {}, options) => {
    const snapshot = await db.store.snapshot(owner);
    const targetId = options?.actorUserId ? snapshot.state.players.find(player => player.userId === options.actorUserId)?.id : extra.playerId || snapshot.state.currentPlayerId || snapshot.state.players[0]?.id;
    return db.store.act(owner, { action, revision: snapshot.state.revision, requestId: db.key(), ...(['roll', 'complete', 'pass'].includes(action) ? { expectedRollId: snapshot.state.playerStates[targetId]?.lastRoll?.id ?? null } : {}), ...extra }, options);
  };
  db.configure = async settings => {
    const snapshot = await db.store.snapshot(owner);
    return db.store.settings(owner, { requestId: db.key(), revision: snapshot.state.revision, settings });
  };
  db.active = async () => {
    await db.configure({ points: { enabled: true, command: '!marble', cost: 100 }, donation: { enabled: true, minimum: 1000 } });
    return db.action('start');
  };
  db.join = async (user = member) => {
    const result = await db.store.invite(owner, { memberUserId: user, requestId: db.key() });
    const item = result.invitations.find(inv => inv.memberUserId === user && inv.status === 'pending');
    await db.store.answerInvite(user, item.id, { action: 'accept', requestId: db.key() });
    return { invitationId: item.id, playerId: db.state().players.find(player => player.userId === user).id };
  };
  return db;
}
const points = extra => ({ source: 'points', eventId: 'point-event', provider: 'chzzk', command: '!marble', userId: 'viewer', username: 'Viewer', channelUid: 'channel', ...extra });
const donation = extra => ({ source: 'donation', eventId: 'donation-event', provider: 'youtube', username: 'Donor', amount: 1000, currency: 'KRW', ...extra });
const personalSettings = () => ({ points: { enabled: true, command: '!personal', cost: 250 }, donation: { enabled: true, minimum: 1500 } });
async function joinRoom(db, destination, actor = member) {
  const invited = await db.store.invite(destination, { requestId: db.key(), memberUserId: actor });
  const item = invited.invitations.find(invite => invite.memberUserId === actor && invite.status === 'pending');
  await db.store.answerInvite(actor, item.id, { action: 'accept', requestId: db.key() });
  return item;
}
async function startRoom(db, destination) {
  const snapshot = await db.store.snapshot(destination);
  return db.store.act(destination, { action: 'start', requestId: db.key(), revision: snapshot.state.revision });
}
async function connect(db, destination = owner, actor = member, settings = personalSettings()) {
  const current = await db.store.participantSnapshot(destination, actor);
  return db.store.participation(destination, actor, { requestId: db.key(), participationRevision: current.viewerParticipation.revision, connected: true, settings });
}
async function selectObs(db, destination = owner, actor = member) {
  const current = await db.store.participantSnapshot(destination, actor);
  return db.store.selectOverlayRoom(destination, actor, { requestId: db.key(), overlayRevision: current.viewerOverlay.revision });
}

test('accepting binds only OBS automatically, preserves own token/layout/settings, and retries never switch back', async () => {
  const db = fixture(); const local = await db.store.snapshot(member);
  const invited = await db.store.invite(owner, { requestId: db.key(), memberUserId: member });
  const id = invited.invitations[0].id;
  const input = { requestId: db.key(), action: 'accept' };
  await db.store.answerInvite(member, id, input);
  const participant = await db.store.participantSnapshot(owner, member);
  assert.equal(participant.actorInvitationId, id);
  assert.equal(participant.viewerOverlay.connected, true);
  assert.equal(participant.viewerParticipation.connectedOwnerUserId, null);
  assert.equal(participant.viewerParticipation.revision, 0);
  assert.deepEqual(participant.viewerParticipation.settings, DEFAULT_MARBLE_PARTICIPATION_SETTINGS);
  const obs = await db.store.overlay(local.overlayToken);
  assert.equal(obs.state.players.length, 2);
  assert.deepEqual(obs.state.settings.layouts, local.state.settings.layouts);
  assert.equal((await db.store.snapshot(member)).overlayToken, local.overlayToken);
  const other = await joinRoom(db, 'other');
  const beforeRetry = await db.store.overlay(local.overlayToken);
  assert.equal((await db.store.participantSnapshot('other', member)).viewerOverlay.connected, true);
  await db.store.answerInvite(member, id, input);
  await db.store.answerInvite(member, id, { ...input, requestId: db.key() });
  assert.deepEqual((await db.store.overlay(local.overlayToken)).state, beforeRetry.state);
  assert.equal((await db.store.participantSnapshot('other', member)).viewerOverlay.revision, 2);
  assert.notEqual(other.id, id);
});

test('leaving during play removes only own runtime, restores OBS, keeps paid settings blocked and is idempotent', async () => {
  const db = fixture(); const joined = await db.join(); const local = await db.store.snapshot(member);
  await db.active(); await connect(db); await db.configure({ participantControl: false });
  await db.action('pause');
  await db.store.trigger(member, donation({ amount: 1500 }));
  const hostRuntime = clone(db.state().playerStates['player-1']);
  const saved = clone((await db.store.participantSnapshot(owner, member)).viewerParticipation);
  const input = { requestId: db.key(), invitationId: joined.invitationId };
  const result = await db.store.leave(owner, member, input);
  assert.equal(result.rooms.length, 0);
  assert.equal(result.viewerOverlay.ownerUserId, null);
  assert.equal(db.state().status, 'paused');
  assert.deepEqual(db.state().playerStates['player-1'], hostRuntime);
  assert.equal(db.state().playerStates[joined.playerId], undefined);
  assert.equal((await db.store.overlay(local.overlayToken)).state.players.length, 1);
  assert.deepEqual((await db.store.snapshot(member)).viewerParticipation, { ...saved, connected: false, suspended: true });
  assert.equal((await db.store.configuration(member)).status, 'unavailable');
  assert.equal((await db.store.trigger(member, points({ command: '!personal' }))).reason, 'not_a_participant');
  await assert.rejects(db.store.participantSnapshot(owner, member), { code: 'not_a_participant' });
  const obsRevision = db.participations.get(member).obs_revision;
  await db.store.leave(owner, member, input);
  assert.equal(db.participations.get(member).obs_revision, obsRevision);
  await db.action('end');
  const rejoined = await db.join();
  await db.store.leave(owner, member, input);
  await db.store.leave(owner, member, { ...input, requestId: db.key() });
  assert.equal((await db.store.participantSnapshot(owner, member)).actorInvitationId, rejoined.invitationId);
  assert.equal((await db.store.participantSnapshot(owner, member)).viewerOverlay.connected, true);
  assert.equal((await db.store.configuration(member)).status, 'unavailable');
  assert.equal((await db.store.participantSnapshot(owner, member)).viewerParticipation.connected, false);
  assert.equal((await db.store.trigger(member, points({ command: '!personal', eventId: 'reaccepted-paid' }))).reason, 'viewer_participation_reconnect_required');
  await connect(db);
  assert.equal((await db.store.configuration(member)).status, 'finished');
});

test('ending a game keeps its results and OBS membership; leaving a non-selected room preserves the selected room', async () => {
  const db = fixture(); const first = await db.join(); await joinRoom(db, 'other');
  const local = await db.store.snapshot(member);
  await db.active(); await db.action('end');
  await selectObs(db, owner);
  const ended = await db.store.overlay(local.overlayToken);
  assert.equal(ended.state.status, 'finished');
  assert.equal(ended.state.players.length, 2);
  await selectObs(db, 'other');
  const selected = await db.store.overlay(local.overlayToken);
  await db.store.leave(owner, member, { requestId: db.key(), invitationId: first.invitationId });
  assert.deepEqual((await db.store.overlay(local.overlayToken)).state, selected.state);
  assert.equal((await db.store.participantSnapshot('other', member)).viewerOverlay.connected, true);
});

test('OBS selection requires membership and revision; receipt retry cannot restore an older selection', async () => {
  const db = fixture(); await db.join(); await joinRoom(db, 'other');
  const before = await db.store.participantSnapshot(owner, member);
  const input = { requestId: db.key(), overlayRevision: before.viewerOverlay.revision };
  await db.store.selectOverlayRoom(owner, member, input);
  await selectObs(db, 'other');
  await db.store.selectOverlayRoom(owner, member, input);
  assert.equal((await db.store.participantSnapshot('other', member)).viewerOverlay.connected, true);
  await assert.rejects(db.store.selectOverlayRoom(owner, member, { ...input, requestId: db.key() }), { code: 'stale_overlay_revision' });
  await assert.rejects(db.store.selectOverlayRoom(owner, 'user-1', { requestId: db.key(), overlayRevision: 0 }), { code: 'not_a_participant' });
  await assert.rejects(db.store.selectOverlayRoom(owner, owner, input), { code: 'host_participation_forbidden' });
  await assert.rejects(db.store.selectOverlayRoom(owner, member, { ...input, connected: true }), { code: 'invalid_request' });
});

test('accept/leave rollback includes OBS binding and unauthorized or internal actions cannot remove others', async () => {
  const db = fixture(); const invited = await db.store.invite(owner, { memberUserId: member, requestId: db.key() });
  const id = invited.invitations[0].id;
  db.fail = /^insert into marble_requests/;
  await assert.rejects(db.store.answerInvite(member, id, { action: 'accept', requestId: db.key() }), /injected database failure/);
  assert.equal(db.invites.get(id).status, 'pending');
  assert.equal(db.participations.has(member), false);
  await db.store.answerInvite(member, id, { action: 'accept', requestId: db.key() });
  const before = clone(db.state()); const p = clone(db.participations.get(member));
  db.fail = /^insert into marble_source_requests/;
  await assert.rejects(db.store.leave(owner, member, { invitationId: id, requestId: db.key() }), /injected database failure/);
  assert.deepEqual(db.state(), before); assert.deepEqual(db.participations.get(member), p);
  assert.equal(db.invites.get(id).status, 'accepted');
  await assert.rejects(db.store.leave(owner, 'other', { invitationId: id, requestId: db.key() }), { code: 'invitation_not_found' });
  await assert.rejects(db.store.leave(owner, owner, { invitationId: id, requestId: db.key() }), { code: 'host_participation_forbidden' });
  await assert.rejects(db.action('leave-player', { playerId: before.players[1].id }), { code: 'invalid_action' });
  await assert.rejects(db.action('leave-player', {}, actorOptions), { code: 'participant_control_forbidden' });
});

test('personal defaults are private and independent of host game state, control permission, and own settings', async () => {
  const db = fixture(); await db.join(); await db.join('other');
  const local = await db.store.snapshot(member);
  const initial = await db.store.participantSnapshot(owner, member);
  assert.deepEqual(initial.viewerParticipation, { revision: 0, connected: false, settings: DEFAULT_MARBLE_PARTICIPATION_SETTINGS, connectedOwnerUserId: null, connectedRoomTitle: null });
  assert.equal(initial.viewerDonationQueueCount, 0);
  await db.active(); await db.configure({ participantControl: false });
  const revision = db.state().revision;
  const saved = await connect(db);
  assert.equal(saved.state.revision, revision);
  assert.equal(saved.viewerParticipation.revision, 1);
  assert.equal(saved.viewerParticipation.connected, true);
  assert.equal(saved.viewerParticipation.connectedRoomTitle, db.state().settings.title);
  assert.deepEqual(saved.viewerParticipation.settings, personalSettings());
  const own = await db.store.snapshot(member);
  assert.deepEqual(own.state, local.state);
  assert.equal(own.viewerParticipation.connected, false);
  assert.equal(own.viewerParticipation.connectedOwnerUserId, owner);
  assert.equal((await db.store.snapshot(owner)).viewerParticipation.connectedOwnerUserId, null);
  assert.deepEqual((await db.store.participantSnapshot(owner, 'other')).viewerParticipation.settings, DEFAULT_MARBLE_PARTICIPATION_SETTINGS);
  assert.equal((await db.store.overlay((await db.store.snapshot(owner)).overlayToken)).viewerParticipation, undefined);
  assert.equal((await db.store.trigger(member, points({ command: '!personal', channelUid: 'member-channel' }))).accepted, true);
  await assert.rejects(db.action('roll', {}, actorOptions), { code: 'participant_control_forbidden' });
  await assert.rejects(connect(db, owner, owner), { code: 'host_participation_forbidden' });
  await assert.rejects(db.store.participation(owner, 'user-1', { requestId: db.key(), participationRevision: 0, connected: true, settings: personalSettings() }), { code: 'not_a_participant' });
});

test('cross-destination saves serialize on the actor revision and retries cannot restore old routing', async () => {
  const db = fixture(); await db.join(); await joinRoom(db, 'other');
  const input = { requestId: db.key(), participationRevision: 0, connected: true, settings: personalSettings() };
  const outcomes = await Promise.allSettled([
    db.store.participation(owner, member, input),
    db.newStore().participation('other', member, { ...input, requestId: db.key() }),
  ]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(result => result.status === 'rejected').reason.code, 'stale_participation_revision');
  assert.equal(db.participations.get(member).revision, 1);
  const selected = db.participations.get(member).connected_owner_user_id;
  const next = selected === owner ? 'other' : owner;
  await connect(db, next);
  const old = await db.store.participantSnapshot(selected, member);
  assert.equal(old.viewerParticipation.connected, false);
  assert.equal(old.viewerParticipation.connectedOwnerUserId, next);
  assert.deepEqual(old.viewerParticipation.settings, personalSettings());
  if (selected === owner) {
    const replay = await db.store.participation(owner, member, input);
    assert.equal(replay.viewerParticipation.connectedOwnerUserId, next);
    assert.equal(replay.viewerParticipation.revision, 2);
    await assert.rejects(db.store.participation(next, member, input), { code: 'request_id_conflict' });
  }
  await db.store.participation(selected, member, { requestId: db.key(), participationRevision: 2, connected: false, settings: personalSettings() });
  assert.equal(db.participations.get(member).connected_owner_user_id, next, 'Saving another room while disconnected must not disconnect the selected room');
  await startRoom(db, next);
  assert.equal((await connect(db, next)).viewerParticipation.revision, 4, 'Game revisions do not participate in settings concurrency');
});

test('remote ingress targets only the source actor pawn and deducts source points, ignoring host paid target and focus', async () => {
  const db = fixture(); const joined = await db.join(); await db.join('other');
  await db.active(); await db.configure({ triggerPlayerId: 'player-1', participantControl: false });
  const local = await db.store.snapshot(member);
  await connect(db);
  const config = await db.store.configuration(member);
  assert.deepEqual(config.settings, personalSettings()); assert.equal(config.status, 'running');
  const result = await db.store.trigger(member, points({ command: '!personal', channelUid: 'member-channel', playerId: 'player-1' }));
  assert.equal(result.accepted, true); assert.equal(result.cost, 250);
  assert.equal(db.deductions[0].channel, 'member-channel');
  assert.equal(db.state().playerStates[joined.playerId].phase, 'effect');
  assert.equal(db.state().playerStates['player-1'].phase, 'ready');
  assert.deepEqual((await db.store.snapshot(member)).state, local.state);
  assert.equal(result.snapshot.access, 'participant');
  assert.equal(result.snapshot.overlayToken, undefined);
  const writes = db.calls.filter(call => call.pg === db.deductions[0].pg);
  const sourceLock = writes.findIndex(call => call.values[0] === `marble-source:${member}`);
  const roomLock = writes.findIndex(call => call.sql === 'select * from marble_rooms where owner_user_id=$1 for update');
  assert.ok(sourceLock >= 0 && roomLock > sourceLock);
  assert.equal(writes[roomLock].values[0], owner);
});

test('event receipts stay with source across room switches, reject replays, and re-resolve stale configuration', async () => {
  const db = fixture(); const first = await db.join(); await joinRoom(db, 'other');
  await db.active(); await startRoom(db, 'other'); await connect(db);
  assert.equal((await db.store.trigger(member, points({ command: '!personal' }))).accepted, true);
  const old = await db.store.configuration(member);
  assert.equal(old.connectedOwnerUserId, owner);
  await connect(db, 'other');
  const secondPawn = db.rooms.get('other').state.players.find(player => player.userId === member).id;
  const replay = await db.newStore().trigger(member, points({ command: '!personal' }));
  assert.equal(replay.duplicate, true); assert.equal(replay.snapshot, undefined);
  assert.equal(db.rooms.get('other').state.playerStates[secondPawn].phase, 'ready');
  assert.equal(db.deductions.length, 1);
  assert.equal((await db.store.trigger(member, points({ command: '!personal', eventId: 'fresh-event' }))).accepted, true);
  assert.equal(db.rooms.get('other').state.playerStates[secondPawn].phase, 'effect');
  assert.equal(db.state().playerStates[first.playerId].phase, 'effect');
  assert.equal((await db.store.trigger(owner, points())).accepted, true, 'The same event ID on a different source is independent');
  assert.equal(db.deductions.length, 3);
});

test('ended, revoked and missing destinations never fall back; own host disconnect recovers without membership', async () => {
  const db = fixture(); const joined = await db.join(); await db.active();
  let own = await db.store.snapshot(member);
  own = await db.store.settings(member, { requestId: db.key(), revision: own.state.revision, settings: { points: { enabled: true, command: '!marble', cost: 50 } } });
  await startRoom(db, member); await connect(db);
  await db.action('end');
  assert.equal((await db.store.configuration(member)).status, 'finished');
  assert.equal((await db.store.trigger(member, points({ command: '!personal', eventId: 'ended' }))).reason, 'inactive');
  await db.store.revoke(owner, joined.invitationId);
  assert.equal((await db.store.configuration(member)).status, 'unavailable');
  assert.equal((await db.store.trigger(member, points({ command: '!personal', eventId: 'revoked' }))).reason, 'not_a_participant');
  db.rooms.delete(owner);
  assert.equal((await db.store.configuration(member)).status, 'unavailable');
  assert.equal((await db.store.trigger(member, points({ command: '!personal', eventId: 'missing' }))).reason, 'room_not_found');
  assert.equal(db.deductions.length, 0);
  const banner = (await db.store.snapshot(member)).viewerParticipation;
  assert.equal(banner.connectedOwnerUserId, owner); assert.equal(banner.connectedRoomTitle, null);
  const input = { requestId: db.key(), participationRevision: banner.revision };
  const restored = await db.store.disconnectParticipation(member, input);
  assert.equal(restored.viewerParticipation.connectedOwnerUserId, null);
  assert.deepEqual(restored.viewerParticipation.settings, personalSettings());
  assert.equal(restored.viewerParticipation.revision, banner.revision + 1);
  assert.equal((await db.store.disconnectParticipation(member, input)).viewerParticipation.revision, banner.revision + 1);
  assert.equal((await db.store.configuration(member)).settings.points.cost, 50);
  assert.equal((await db.store.trigger(member, points())).accepted, true);
  assert.equal(db.deductions[0].cost, 50);
  assert.equal((await db.store.trigger(member, points({ eventId: 'revoked' }))).reason, 'not_a_participant');
});

test('participant donations use personal thresholds and reveal only their own queue count', async () => {
  const db = fixture(); const joined = await db.join(); const other = await db.join('other');
  const host = await db.active(); await connect(db); await connect(db, owner, 'other'); await db.action('pause');
  assert.equal((await db.store.trigger(member, donation({ eventId: 'small' }))).reason, 'below_minimum');
  assert.equal((await db.store.trigger(member, donation({ amount: 1500, username: 'member-private' }))).queued, true);
  assert.equal((await db.store.trigger('other', donation({ amount: 1500, username: 'other-private' }))).queued, true);
  assert.equal((await db.store.trigger(owner, donation({ username: 'host-private' }))).queued, true);
  const snapshot = await db.store.participantSnapshot(owner, member);
  assert.equal(snapshot.viewerDonationQueueCount, 1);
  assert.equal(db.state().playerStates[joined.playerId].donationQueue.length, 1);
  assert.equal(db.state().playerStates[other.playerId].donationQueue.length, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /member-private|other-private|host-private|"provider"/);
  assert.equal((await db.store.overlay(host.overlayToken)).viewerDonationQueueCount, undefined);
  await db.action('resume');
  assert.equal((await db.store.participantSnapshot(owner, member)).viewerDonationQueueCount, 0);
});

test('personal settings and remote paid transactions roll back together with failed source receipts', async () => {
  const db = fixture(); await db.join(); await db.active();
  const original = clone(db.participations.get(member));
  db.fail = /^insert into marble_source_requests/;
  await assert.rejects(connect(db), /injected database failure/);
  assert.deepEqual(db.participations.get(member), original);
  await connect(db);
  const before = clone(db.state());
  db.fail = /^insert into marble_source_requests/;
  await assert.rejects(db.store.trigger(member, points({ command: '!personal' })), /injected database failure/);
  assert.deepEqual(db.state(), before); assert.equal(db.balances.get('viewer'), 10000);
  assert.equal((await db.store.trigger(member, points({ command: '!personal' }))).accepted, true);
  db.fail = /^insert into marble_source_requests/;
  await assert.rejects(db.store.disconnectParticipation(member, { requestId: db.key(), participationRevision: 1 }), /injected database failure/);
  assert.equal(db.participations.get(member).connected_owner_user_id, owner);
  assert.equal(db.participations.get(member).revision, 1);
});

test('reciprocal room connections and concurrent triggers follow source-before-room order without deadlocks', async () => {
  const db = fixture(); await joinRoom(db, owner, member); await joinRoom(db, member, owner);
  await Promise.all([connect(db, owner, member), connect(db, member, owner)]);
  await startRoom(db, owner); await startRoom(db, member);
  const results = await Promise.all([
    db.store.trigger(member, points({ command: '!personal', channelUid: 'member-channel' })),
    db.newStore().trigger(owner, points({ command: '!personal', channelUid: 'owner-channel' })),
  ]);
  assert.ok(results.every(result => result.accepted));
  assert.equal(db.deductions.length, 2);
});

test('schema coalesces, failed setup retries, transactional clients disable COMMIT replay', async () => {
  const db = fixture(); db.failIdentity = true;
  await assert.rejects(db.store.ensureSchema(), /schema unavailable/);
  await Promise.all([db.store.ensureSchema(), db.store.ensureSchema(), db.store.ensureSchema()]);
  assert.equal(db.identityCalls, 2);
  assert.equal(db.calls.filter(call => call.sql.startsWith('create table')).length, 1);
  assert.ok(db.retries.every(retries => retries === 0));
});

test('configuration reads settings only, never initializes a room or takes a room lock', async () => {
  const db = fixture(); await db.store.ensureSchema(); db.calls.length = 0;
  assert.equal(await db.store.configuration(owner), null);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /^select r.state->'settings'/);
  assert.equal(db.rooms.size, 0);
  await db.active(); db.calls.length = 0;
  const config = await db.store.configuration(owner);
  assert.equal(config.settings.points.cost, 100);
  assert.equal(config.status, 'running');
  assert.deepEqual(Object.keys(config).sort(), ['phase', 'settings', 'status']);
  assert.equal(db.calls.length, 1);
});

test('single-player initialization uses owner representative profile, refreshed in one batch', async () => {
  const db = fixture();
  const initial = await db.store.snapshot(owner);
  assert.equal(initial.state.players.length, 1);
  assert.deepEqual(initial.state.players[0], { ...initial.state.players[0], id: 'player-1', name: 'Name owner', userId: owner, avatarUrl: 'https://images.example/owner.png' });
  assert.equal(initial.serverNow, db.now);
  assert.match(initial.overlayToken, /^marble_[\w-]{43}$/);
  db.users.get(owner).display_name = 'Updated owner';
  db.users.get(owner).avatar_url = 'javascript:alert(1)';
  db.calls.length = 0;
  const refreshed = await db.store.snapshot(owner);
  assert.equal(refreshed.state.players[0].name, 'Updated owner');
  assert.equal(refreshed.state.players[0].avatarUrl, null);
  assert.equal(db.calls.filter(call => call.sql.includes('where id=any')).length, 1);
});

function installLegacyDefaults(state) {
  state.settings.cards = clone(legacyDefaults.cards);
  for (const tile of legacyDefaults.tiles) state.settings.tiles[state.settings.tiles.findIndex(item => item.id === tile.id)] = clone(tile);
}

test('unchanged retired defaults upgrade once under the room lock without changing layouts or custom tiles', async () => {
  const db = fixture();
  await db.store.snapshot(owner);
  installLegacyDefaults(db.state());
  db.state().settings.tiles[2].title = 'Custom snack';
  db.state().settings.layouts.landscape.dice.x = 50;
  db.state().settings.points.cost = 345;
  db.state().deck = ['card-8'];
  const previous = db.state().revision;
  const upgraded = await db.store.snapshot(owner);
  assert.equal(upgraded.state.revision, previous + 1);
  assert.equal(upgraded.state.settings.tiles[18].title, '안주 쉬는 시간');
  assert.deepEqual(upgraded.state.settings.cards, DEFAULT_MARBLE_SETTINGS.cards);
  assert.equal(upgraded.state.settings.tiles[2].title, 'Custom snack');
  assert.equal(upgraded.state.settings.layouts.landscape.dice.x, 50);
  assert.equal(upgraded.state.settings.points.cost, 345);
  assert.deepEqual(db.state().deck, []);
  assert.equal((await db.store.snapshot(owner)).state.revision, upgraded.state.revision);
});

test('customized legacy decks and tiles are never overwritten and active games defer upgrades', async () => {
  const db = fixture();
  await db.store.snapshot(owner);
  installLegacyDefaults(db.state());
  db.state().settings.cards[0].text += ' custom';
  db.state().settings.tiles[18].text += ' custom';
  const custom = clone(db.state().settings);
  await db.store.snapshot(owner);
  assert.deepEqual(db.state().settings.cards, custom.cards);
  assert.deepEqual(db.state().settings.tiles[18], custom.tiles[18]);
  await db.action('start');
  installLegacyDefaults(db.state());
  assert.equal((await db.store.snapshot(owner)).state.settings.tiles[18].title, '금지어 3분');
  await db.action('pause');
  assert.deepEqual((await db.store.snapshot(owner)).state.settings.cards, legacyDefaults.cards);
  await db.action('end');
  assert.equal((await db.store.snapshot(owner)).state.settings.tiles[18].title, '안주 쉬는 시간');
});

test('content upgrade persistence failures do not return fictitious success', async () => {
  const db = fixture();
  await db.store.snapshot(owner);
  installLegacyDefaults(db.state());
  db.fail = /^update marble_rooms set/;
  await assert.rejects(db.store.snapshot(owner), /injected database failure/);
  assert.deepEqual(db.state().settings.cards, legacyDefaults.cards);
  assert.equal((await db.store.snapshot(owner)).state.settings.cards.length, 12);
});

test('shield losses are idempotent and overlays retain actual deltas and event travel direction', async () => {
  const db = fixture();
  await db.store.snapshot(owner);
  const tiles = clone(DEFAULT_MARBLE_SETTINGS.tiles);
  tiles[1].effects = [{ type: 'shieldLoss', value: 2 }, { type: 'rollBackward' }];
  await db.configure({ tiles });
  const started = await db.action('start');
  db.state().players[0].shields = 3;
  const input = { action: 'roll', requestId: db.key(), revision: started.state.revision, expectedRollId: null };
  await db.store.act(owner, input);
  const replay = await db.store.act(owner, input);
  assert.equal(replay.state.players[0].shields, 1);
  const overlay = await db.store.overlay(started.overlayToken);
  assert.equal(overlay.state.pending.shieldDelta, -2);
  db.now = db.state().pending.readyAt;
  await db.action('complete');
  const moved = await db.store.overlay(started.overlayToken);
  assert.equal(moved.state.lastRoll.direction, -1);
  assert.equal(moved.state.lastRoll.source, '');
  assert.deepEqual(moved.state.lastRoll.path, [0]);
  assert.equal(moved.state.players[0].shields, 1);
});

test('host snapshot retains paid settings and per-player queues but never deck order', async () => {
  const db = fixture(); await db.active();
  await db.store.trigger(owner, donation());
  await db.store.trigger(owner, donation({ eventId: 'second' }));
  db.state().deck = ['secret-next-card'];
  const snapshot = await db.store.snapshot(owner);
  assert.equal(snapshot.state.settings.points.enabled, true);
  assert.equal(snapshot.state.settings.points.cost, 100);
  assert.equal(snapshot.state.settings.donation.minimum, 1000);
  assert.equal(snapshot.state.playerStates['player-1'].donationQueue.length, 1);
  assert.equal(snapshot.state.donationQueue.length, 1);
  assert.deepEqual(snapshot.state.deck, []);
  assert.deepEqual(db.state().deck, ['secret-next-card']);
});

test('user receipts survive new store instances, return latest state, and reject changed payload', async () => {
  const db = fixture(); const snapshot = await db.store.snapshot(owner);
  const input = { action: 'start', requestId: 'durable', revision: snapshot.state.revision };
  await db.store.act(owner, input);
  await db.action('pause');
  const restarted = db.newStore();
  const replay = await restarted.act(owner, { revision: input.revision, requestId: input.requestId, action: 'start' });
  assert.equal(replay.state.status, 'paused');
  assert.equal(replay.state.revision, db.state().revision);
  await assert.rejects(restarted.act(owner, { ...input, action: 'end' }), { code: 'request_id_conflict', status: 409 });
});

test('host configuration requires strict global revision and cannot bypass route validation via action', async () => {
  const db = fixture(); const initial = await db.store.snapshot(owner);
  await db.action('start');
  await assert.rejects(db.store.settings(owner, { requestId: db.key(), revision: initial.state.revision, settings: { title: 'stale' } }), { code: 'stale_revision' });
  await assert.rejects(db.action('settings', { settings: { points: { command: '!bypass' } } }), { code: 'invalid_action' });
  await assert.rejects(db.action('enqueue-donation', { donation: {} }), { code: 'invalid_action' });
});

test('same-player concurrent rolls serialize and mutate once; distinct players share an old global revision', async () => {
  const db = fixture(); const joined = await db.join();
  const snapshot = await db.active();
  const input = { action: 'roll', revision: snapshot.state.revision, expectedRollId: null, playerId: 'player-1' };
  const results = await Promise.allSettled([
    db.store.act(owner, { ...input, requestId: db.key() }),
    db.store.act(owner, { ...input, requestId: db.key() }),
    db.store.act(owner, { ...input, playerId: joined.playerId, requestId: db.key() }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'stale_player_state');
  assert.equal(db.state().playerStates['player-1'].phase, 'effect');
  assert.equal(db.state().playerStates[joined.playerId].phase, 'effect');
  assert.equal(db.state().revision, snapshot.state.revision + 2);
});

test('roll identity guards apply even when global revision is fresh; missing guard rejected', async () => {
  const db = fixture(); await db.active(); await db.action('roll'); db.now += 100000;
  await assert.rejects(db.action('complete', { expectedRollId: null }), { code: 'stale_player_state' });
  await assert.rejects(db.store.act(owner, { action: 'complete', requestId: db.key(), revision: db.state().revision }), { code: 'expected_roll_id_required' });
});

test('participant authorization forces own pawn regardless of focus and ignores forged authority', async () => {
  const db = fixture(); const joined = await db.join(); await db.active();
  const result = await db.action('roll', { playerId: 'player-1', source: 'host', useShield: false }, actorOptions);
  assert.equal(result.actorPlayerId, joined.playerId);
  assert.equal(result.state.playerStates[joined.playerId].phase, 'effect');
  assert.equal(result.state.playerStates['player-1'].phase, 'ready');
  assert.equal(result.overlayToken, undefined);
  assert.equal(result.state.players.some(player => Object.hasOwn(player, 'userId')), false);
  await assert.rejects(db.action('end', {}, actorOptions), { code: 'participant_control_forbidden' });
  await assert.rejects(db.store.participantSnapshot(owner, 'other'), { code: 'not_a_participant' });
  await assert.rejects(db.action('roll', {}, { participant: true, actorUserId: 'other' }), { code: 'not_a_participant' });
});

test('participant pass consumes a shield, rejects free pass, and paused/control-off actions are forbidden', async () => {
  const db = fixture(); const joined = await db.join(); await db.active(); await db.action('roll', {}, actorOptions); db.now += 100000;
  await assert.rejects(db.action('pass', { useShield: false }, actorOptions), { code: 'no_shield' });
  db.state().players.find(player => player.id === joined.playerId).shields = 1;
  await db.action('pass', { useShield: false }, actorOptions);
  assert.equal(db.state().players.find(player => player.id === joined.playerId).shields, 0);
  await db.configure({ participantControl: false });
  await assert.rejects(db.action('roll', {}, actorOptions), { code: 'participant_control_forbidden' });
  await db.configure({ participantControl: true }); await db.action('pause');
  await assert.rejects(db.action('roll', {}, actorOptions), { code: 'game_not_running' });
});

test('linked account names/photos/identity cannot be forged or detached through admin player edits', async () => {
  const db = fixture(); await db.store.snapshot(owner);
  for (const extra of [{ userId: member }, { userId: null }, { name: 'Fake owner' }, { avatarUrl: 'https://fake.example/face.png' }]) {
    await assert.rejects(db.action('update-player', { playerId: 'player-1', ...extra }), { code: 'linked_identity_is_managed' });
  }
  await assert.rejects(db.action('add-player', { name: 'Fake', userId: member }), { code: 'linked_identity_is_managed' });
  await db.action('add-player', { name: 'Offline', color: '#123456' });
  assert.equal(db.state().players.length, 2);
});

test('points deduct once on transaction client, current approved price, and first pawn not focus', async () => {
  const db = fixture(); const joined = await db.join(); await db.active();
  await db.action('roll', { playerId: joined.playerId });
  assert.equal(db.state().currentPlayerId, joined.playerId);
  await db.configure({ points: { cost: 250 } });
  const results = await Promise.all([db.store.trigger(owner, points()), db.newStore().trigger(owner, points({ amount: 1, username: 'Altered duplicate' }))]);
  assert.equal(results.filter(result => result.duplicate).length, 1);
  assert.ok(results.every(result => result.accepted && result.cost === 250));
  assert.equal(db.balances.get('viewer'), 9750);
  assert.equal(db.deductions.length, 1);
  assert.equal(db.state().playerStates['player-1'].phase, 'effect');
  const deduction = db.deductions[0];
  assert.equal(deduction.channel, 'channel');
  assert.ok(db.calls.some(call => call.pg === deduction.pg && call.sql.startsWith('update marble_rooms')));
  assert.ok(db.calls.some(call => call.pg === deduction.pg && call.sql.startsWith('insert into marble_source_requests')));
});

test('configured target is captured independently of another pending pawn', async () => {
  const db = fixture(); const joined = await db.join(); await db.active(); await db.action('roll', { playerId: 'player-1' });
  await db.configure({ triggerPlayerId: joined.playerId });
  assert.equal((await db.store.trigger(owner, points())).accepted, true);
  assert.equal(db.state().playerStates[joined.playerId].phase, 'effect');
});

test('host focus changes display only, without redirecting default paid target or accepting participant focus', async () => {
  const db = fixture(); const joined = await db.join(); await db.active();
  await db.action('focus', { playerId: joined.playerId });
  assert.equal(db.state().currentPlayerId, joined.playerId);
  assert.equal(db.state().playerStates[joined.playerId].phase, 'ready');
  await assert.rejects(db.action('focus', { playerId: 'player-1' }, actorOptions), { code: 'participant_control_forbidden' });
  assert.equal((await db.store.trigger(owner, points())).accepted, true);
  assert.equal(db.state().playerStates['player-1'].phase, 'effect');
  assert.equal(db.state().playerStates[joined.playerId].phase, 'ready');
});

test('point rejection is durable after new balance/state/settings, and never queues or charges', async () => {
  const db = fixture(); await db.active(); db.balances.set('viewer', 0);
  const rejected = await db.store.trigger(owner, points());
  assert.equal(rejected.reason, 'insufficient_points');
  db.balances.set('viewer', 10000);
  const duplicate = await db.store.trigger(owner, points({ userId: 'other', command: '!different' }));
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.reason, 'insufficient_points');
  assert.equal(db.deductions.length, 1);
  await db.action('roll');
  assert.equal((await db.store.trigger(owner, points({ eventId: 'busy' }))).reason, 'busy');
  assert.equal(db.state().playerStates['player-1'].donationQueue.length, 0);
  assert.equal(db.balances.get('viewer'), 10000);
});

test('state/receipt failure rolls back point deduction and never returns stale cached success', async () => {
  const db = fixture(); await db.active(); const revision = db.state().revision;
  db.fail = /^insert into marble_source_requests/;
  await assert.rejects(db.store.trigger(owner, points()), /injected database failure/);
  assert.equal(db.balances.get('viewer'), 10000);
  assert.equal(db.state().revision, revision);
  assert.equal(db.state().playerStates['player-1'].phase, 'ready');
  assert.equal((await db.store.trigger(owner, points())).accepted, true);
  assert.equal(db.balances.get('viewer'), 9900);
});

test('malformed provider payload rejection is durable, even after corrected retry', async () => {
  const db = fixture(); await db.active();
  const rejected = await db.store.trigger(owner, points({ username: '\u0001' }));
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, 'invalid_text');
  assert.equal((await db.store.trigger(owner, points())).duplicate, true);
  assert.equal((await db.store.trigger(owner, points())).accepted, false);
  assert.equal(db.deductions.length, 0);
  assert.equal(db.state().playerStates['player-1'].phase, 'ready');
});

test('ambiguous COMMIT is not replayed; explicit retry recovers durable receipt', async () => {
  const db = fixture(); await db.active(); db.failCommit = true;
  await assert.rejects(db.store.trigger(owner, points()), /after COMMIT/);
  assert.equal(db.deductions.length, 1);
  assert.equal(db.balances.get('viewer'), 9900);
  assert.equal((await db.store.trigger(owner, points())).duplicate, true);
  assert.equal(db.deductions.length, 1);
  assert.ok(db.retries.every(retries => retries === 0));
});

test('donation gating persists rejected events and accepts only KRW minimum while active', async () => {
  const db = fixture();
  assert.equal((await db.store.trigger(owner, donation())).reason, 'inactive');
  await db.active();
  assert.equal((await db.store.trigger(owner, donation())).reason, 'inactive');
  assert.equal((await db.store.trigger(owner, donation({ eventId: 'usd', currency: 'USD' }))).reason, 'unsupported_currency');
  assert.equal((await db.store.trigger(owner, donation({ eventId: 'small', amount: 999 }))).reason, 'below_minimum');
  const accepted = await db.store.trigger(owner, donation({ eventId: 'large', amount: 100000 }));
  assert.equal(accepted.accepted, true); assert.equal(accepted.queued, false);
  assert.equal(db.state().playerStates['player-1'].donationQueue.length, 0);
  await db.action('end'); await db.action('start');
  const replay = await db.newStore().trigger(owner, donation({ eventId: 'large', amount: 1 }));
  assert.equal(replay.duplicate, true); assert.equal(replay.accepted, true);
  assert.equal(db.state().playerStates['player-1'].phase, 'ready');
});

test('donations queue independently, cap at twenty, survive pause, consume FIFO, and clear on end', async () => {
  const db = fixture(); await db.active(); await db.action('pause');
  for (let i = 0; i < 20; i++) assert.equal((await db.store.trigger(owner, donation({ eventId: `queue-${i}`, username: `Donor ${i}` }))).queued, true);
  assert.equal((await db.store.trigger(owner, donation({ eventId: 'overflow' }))).reason, 'queue_full');
  assert.equal(db.state().playerStates['player-1'].donationQueue.length, 20);
  await db.action('resume');
  assert.equal(db.state().playerStates['player-1'].lastRoll.username, 'Donor 0');
  assert.equal(db.state().playerStates['player-1'].donationQueue.length, 19);
  db.now += 100000;
  await db.action('complete');
  assert.equal(db.state().playerStates['player-1'].lastRoll.username, 'Donor 1');
  await db.action('end');
  assert.equal(db.state().playerStates['player-1'].donationQueue.length, 0);
  await db.action('start');
  assert.equal((await db.store.trigger(owner, donation({ eventId: 'overflow' }))).reason, 'queue_full');
});

test('targeted invitations and answers are idempotent, use account profiles, and expose membership UI data', async () => {
  const db = fixture(); const input = { memberUserId: member, requestId: db.key() };
  const result = await db.store.invite(owner, input);
  assert.equal(result.invitations.length, 1);
  const item = result.invitations[0];
  assert.equal(Date.parse(item.expiresAt) - db.now, 7 * 86400000);
  await db.store.invite(owner, input);
  assert.equal(db.invites.size, 1);
  await assert.rejects(db.store.invite(owner, { ...input, memberUserId: 'other' }), { code: 'request_id_conflict' });
  await assert.rejects(db.store.answerInvite('other', item.id, { action: 'accept', requestId: db.key() }), { code: 'invitation_not_found' });
  const answer = { action: 'accept', requestId: db.key() };
  const accepted = await db.store.answerInvite(member, item.id, answer);
  await db.store.answerInvite(member, item.id, answer);
  assert.equal(db.state().players.length, 2);
  assert.equal(accepted.rooms.length, 1);
  assert.equal(accepted.invitations[0].status, 'accepted');
  const player = db.state().players.find(player => player.userId === member);
  assert.equal(player.name, 'Name member'); assert.equal(player.avatarUrl, 'https://images.example/member.png');
  await assert.rejects(db.store.answerInvite(member, item.id, { ...answer, action: 'decline' }), { code: 'request_id_conflict' });
});

test('expired, declined and revoked invitations cannot be reaccepted; running membership cannot be removed', async () => {
  const db = fixture();
  const pending = await db.store.invite(owner, { memberUserId: 'other', requestId: db.key() });
  const expiredId = pending.invitations[0].id;
  db.now += 7 * 86400000;
  assert.equal((await db.store.invitations('other')).invitations[0].status, 'expired');
  await assert.rejects(db.store.answerInvite('other', expiredId, { action: 'accept', requestId: db.key() }), { code: 'invitation_expired' });
  const joined = await db.join(); await db.active();
  await assert.rejects(db.store.revoke(owner, joined.invitationId), { code: 'roster_locked' });
  await db.action('end'); await db.store.revoke(owner, joined.invitationId);
  assert.equal(db.state().players.some(player => player.userId === member), false);
  assert.equal((await db.store.invitations(member)).rooms.length, 0);
  await assert.rejects(db.store.answerInvite(member, joined.invitationId, { action: 'accept', requestId: db.key() }), { code: 'invitation_revoked' });
  await assert.rejects(db.store.participantSnapshot(owner, member), { code: 'not_a_participant' });
});

test('accept requires lobby/finished and concurrent accept never exceeds eight players', async () => {
  const db = fixture(); const ids = [];
  for (let i = 0; i < 8; i++) {
    const result = await db.store.invite(owner, { memberUserId: `user-${i}`, requestId: db.key() });
    ids.push(result.invitations.find(item => item.memberUserId === `user-${i}`).id);
  }
  await db.active();
  await assert.rejects(db.store.answerInvite('user-0', ids[0], { action: 'accept', requestId: db.key() }), { code: 'roster_locked' });
  await db.action('end');
  const results = await Promise.allSettled(ids.map((id, index) => db.newStore().answerInvite(`user-${index}`, id, { action: 'accept', requestId: db.key() })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 7);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'room_full');
  assert.equal(db.state().players.length, 8);
});

test('accepted membership is required even for a forged linked pawn or a receipt replay', async () => {
  const db = fixture(); const joined = await db.join(); const snapshot = await db.active();
  const input = { action: 'roll', revision: snapshot.state.revision, expectedRollId: null, requestId: db.key() };
  await db.store.act(owner, input, actorOptions);
  db.invites.get(joined.invitationId).status = 'revoked';
  await assert.rejects(db.store.participantSnapshot(owner, member), { code: 'not_a_participant' });
  await assert.rejects(db.store.act(owner, input, actorOptions), { code: 'not_a_participant' });
});

test('decline is idempotent, cannot be changed to acceptance, and expired invitations can be replaced only by new IDs', async () => {
  const db = fixture();
  const invite = await db.store.invite(owner, { memberUserId: member, requestId: db.key() });
  const id = invite.invitations[0].id;
  const answer = { action: 'decline', requestId: db.key() };
  await db.store.answerInvite(member, id, answer);
  assert.equal((await db.store.answerInvite(member, id, answer)).invitations[0].status, 'declined');
  await assert.rejects(db.store.answerInvite(member, id, { action: 'accept', requestId: db.key() }), { code: 'invitation_already_answered' });
  const second = await db.store.invite(owner, { memberUserId: member, requestId: db.key() });
  const pendingId = second.invitations.find(item => item.status === 'pending').id;
  db.now += 7 * 86400000 + 1;
  const third = await db.store.invite(owner, { memberUserId: member, requestId: db.key() });
  assert.notEqual(third.invitations.find(item => item.status === 'pending').id, pendingId);
  assert.equal(db.invites.get(pendingId).status, 'revoked');
});

test('personal OBS shares the board and all pawn motion, projects own effects and preserves own layouts without changing host focus', async () => {
  const db = fixture(); const joined = await db.join();
  const local = await db.store.snapshot(member);
  const layouts = clone(local.state.settings.layouts); layouts.landscape.dice.x = 40;
  await db.store.layout(member, { requestId: db.key(), revision: local.state.revision, layouts });
  const tiles = clone(DEFAULT_MARBLE_SETTINGS.tiles);
  tiles[1].effects = [{ type: 'timer', value: 120 }];
  await db.configure({ tiles });
  await db.active(); await connect(db);
  await db.action('roll', { playerId: 'player-1' });
  db.now += 500;
  await db.action('roll', {}, actorOptions);
  await db.action('focus', { playerId: joined.playerId });
  const hostBefore = await db.store.snapshot(owner);
  const host = await db.store.overlay(hostBefore.overlayToken);
  const guest = await db.store.overlay(local.overlayToken);
  assert.equal(host.state.currentPlayerId, 'player-1');
  assert.equal(guest.state.currentPlayerId, joined.playerId);
  assert.deepEqual(host.state.settings.tiles, guest.state.settings.tiles);
  assert.deepEqual(host.state.players, guest.state.players);
  assert.deepEqual(host.state.playerStates, guest.state.playerStates);
  for (const key of ['lastRoll', 'pending', 'timer', 'phase']) {
    assert.deepEqual(host.state[key], host.state.playerStates['player-1'][key]);
    assert.deepEqual(guest.state[key], guest.state.playerStates[joined.playerId][key]);
  }
  assert.notEqual(host.state.lastRoll.id, guest.state.lastRoll.id);
  assert.notEqual(host.state.timer.deadline, guest.state.timer.deadline);
  assert.deepEqual(guest.state.settings.layouts, layouts);
  assert.deepEqual(host.state.settings.layouts, hostBefore.state.settings.layouts);
  assert.deepEqual((await db.store.snapshot(owner)).state, hostBefore.state, 'Overlay reads never mutate shared focus/state');
  const json = JSON.stringify(guest);
  assert.doesNotMatch(json, /userId|ownerUserId|source_owner|overlayToken|invitations|viewerParticipation|is_member/);
  assert.equal(guest.overlayRevision.connection, 2);
  await db.store.rotateOverlay(owner, { requestId: db.key() });
  assert.equal((await db.store.overlay(local.overlayToken)).state.currentPlayerId, joined.playerId, 'Host rotation does not invalidate guest token');
  await db.store.rotateOverlay(member, { requestId: db.key() });
  await assert.rejects(db.store.overlay(local.overlayToken), { code: 'invalid_overlay_token' });
});

test('personal OBS does not borrow another player mission; revoked/missing rooms restore own board without enabling paid routing', async () => {
  const db = fixture(); const joined = await db.join();
  const local = await db.store.snapshot(member);
  await db.active(); await connect(db);
  await db.action('roll', { playerId: 'player-1' });
  const guest = await db.store.overlay(local.overlayToken);
  assert.equal(guest.state.currentPlayerId, joined.playerId);
  assert.equal(guest.state.lastRoll, null); assert.equal(guest.state.pending, null); assert.equal(guest.state.timer, null);
  assert.equal(guest.state.phase, 'ready');
  await db.action('end'); await db.store.revoke(owner, joined.invitationId);
  const revoked = await db.store.overlay(local.overlayToken);
  assert.equal(revoked.state.players.length, 1);
  assert.equal(revoked.overlayRevision.connection, guest.overlayRevision.connection + 1);
  db.rooms.delete(owner);
  assert.deepEqual((await db.store.overlay(local.overlayToken)).state, revoked.state);
  await db.store.disconnectParticipation(member, { requestId: db.key(), participationRevision: 1 });
  const restored = await db.store.overlay(local.overlayToken);
  assert.equal(restored.state.status, 'lobby');
  assert.equal(restored.state.players.length, 1);
  assert.equal(restored.overlayRevision.connection, 3);
  assert.ok(restored.state.revision < guest.state.revision);
});

test('personal OBS can switch to another accepted room without reusing its token or changing personal layout', async () => {
  const db = fixture(); await db.join(); await joinRoom(db, 'other');
  const local = await db.store.snapshot(member);
  await db.active(); await connect(db);
  await selectObs(db, owner);
  const previous = await db.store.overlay(local.overlayToken);
  await connect(db, 'other');
  assert.deepEqual((await db.store.overlay(local.overlayToken)).state, previous.state, 'Paid routing cannot change OBS');
  await selectObs(db, 'other');
  const next = await db.store.overlay(local.overlayToken);
  assert.ok(next.state.revision < previous.state.revision);
  assert.ok(next.overlayRevision.connection > previous.overlayRevision.connection);
  assert.ok(next.state.players.some(player => player.name === 'Name other'));
  assert.deepEqual(next.state.settings.layouts, local.state.settings.layouts);
  assert.equal(next.state.players.find(player => player.id === next.state.currentPlayerId).name, 'Name member');
});

test('overlay strips every player identity, origin, invitations, points, tokens and deck; rotation revokes old token', async () => {
  const db = fixture(); await db.join(); const snapshot = await db.active();
  await db.store.trigger(owner, donation({ username: 'private-donor' }));
  await db.store.trigger(owner, donation({ eventId: 'queued-secret', username: 'private-queued' }));
  db.state().deck = ['secret-next-card'];
  const overlay = await db.store.overlay(snapshot.overlayToken);
  const json = JSON.stringify(overlay);
  assert.doesNotMatch(json, /userId|ownerUserId|overlayToken|invitations|private-donor|private-queued|secret-next-card|queued-secret/);
  assert.equal(overlay.state.settings.points.cost, 0);
  assert.equal(overlay.state.playerStates['player-1'].lastRoll.source, '');
  assert.deepEqual(overlay.state.playerStates['player-1'].donationQueue, []);
  const input = { requestId: db.key() };
  const rotated = await db.store.rotateOverlay(owner, input);
  assert.notEqual(rotated.overlayToken, snapshot.overlayToken);
  await assert.rejects(db.store.overlay(snapshot.overlayToken), { code: 'invalid_overlay_token' });
  assert.equal((await db.store.rotateOverlay(owner, input)).overlayToken, rotated.overlayToken);
  assert.equal((await db.store.overlay(rotated.overlayToken)).access, 'overlay');
});

test('deleted linked profiles are redacted in host and overlay without rewriting custom offline names', async () => {
  const db = fixture(); await db.join(); await db.action('add-player', { name: 'Local friend', color: '#123456' });
  await db.active(); await db.action('roll', {}, actorOptions);
  const before = await db.store.snapshot(owner);
  db.users.delete(member);
  const host = await db.store.snapshot(owner);
  assert.equal(host.state.players.find(player => player.userId === member).name, '\ud0c8\ud1f4\ud55c \uc0ac\uc6a9\uc790');
  assert.equal(host.state.players.find(player => player.userId === member).avatarUrl, null);
  assert.equal(host.state.players.at(-1).name, 'Local friend');
  assert.doesNotMatch(JSON.stringify(await db.store.overlay(before.overlayToken)), /Name member|images\.example\/member/);
});

test('search is bounded, parameterized, literal wildcard escaped, and IDs are plain ownership strings', async () => {
  const db = fixture(); db.users.set('literal_%!', { id: 'literal_%!', display_name: 'Literal', avatar_url: 'http://unsafe.example/a' });
  assert.deepEqual(await db.store.searchUsers(owner, ''), []);
  const results = await db.store.searchUsers(owner, '_%!');
  assert.equal(results.length, 1); assert.equal(results[0].userId, 'literal_%!'); assert.equal(results[0].avatarUrl, null);
  const query = db.calls.at(-1);
  assert.deepEqual(query.values, [owner, '%!_!%!!%']);
  assert.match(query.sql, /limit 20$/);
  assert.ok(db.calls.filter(call => call.values[0] === owner).every(call => call.values[0] !== 'user:owner'));
});

// Optional PostgreSQL-WASM syntax/constraint smoke, without a dependency or live DB.
// Set ARUBOT_TEST_PGLITE_MODULE to an installed @electric-sql/pglite/dist/index.js.
test('isolated real SQL migration, RLS, identities, receipts, points rollback, and invitation flow', { skip: !process.env.ARUBOT_TEST_PGLITE_MODULE }, async t => {
  const { PGlite } = await import(pathToFileURL(process.env.ARUBOT_TEST_PGLITE_MODULE).href);
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create table app_users(id text primary key,display_name text,avatar_url text,primary_provider text);
    insert into app_users values('owner','SQL Owner','https://images.example/owner.png','chzzk'),('member','SQL Member',null,'youtube');
    create table test_points(user_id text primary key,balance integer not null);
    insert into test_points values('viewer',1000);
    create role anon; create role authenticated;`);
  let tail = Promise.resolve(), failReceipt = false, deductions = 0;
  const pg = { async query(sql, values) {
    if (sql.startsWith('create table if not exists marble_rooms')) { await db.exec(sql); return { rows: [] }; }
    if (failReceipt && sql.startsWith('insert into marble_source_requests')) { failReceipt = false; throw new Error('receipt write failed'); }
    return db.query(sql, values);
  } };
  const options = {
    withPgClient(fn, retries) {
      if (retries !== undefined) assert.equal(retries, 0);
      const result = tail.then(() => fn(pg)); tail = result.catch(() => {}); return result;
    },
    ensureIdentityTables: async () => {}, randomInt: () => 0,
    async deductChannelPointsIfEnoughWithClient(client, _channel, user, _username, amount) {
      assert.equal(client, pg); deductions++;
      const rows = (await client.query('update test_points set balance=balance-$2 where user_id=$1 and balance >= $2 returning balance', [user, amount])).rows;
      return { deducted: rows.length > 0 };
    },
  };
  const store = createMarbleStore(options);
  await store.ensureSchema(); await createMarbleStore(options).ensureSchema();
  assert.equal(await store.configuration(owner), null);
  const flags = await db.query("select relname,relrowsecurity from pg_class where relname in ('marble_rooms','marble_requests','marble_invites')");
  assert.equal(flags.rows.length, 3); assert.ok(flags.rows.every(row => row.relrowsecurity));
  assert.equal((await db.query("select has_table_privilege('anon','marble_invites','SELECT') as allowed")).rows[0].allowed, false);
  const invited = await store.invite(owner, { memberUserId: member, requestId: 'sql-invite' });
  assert.equal(invited.state.players[0].name, 'SQL Owner');
  const accepted = await store.answerInvite(member, invited.invitations[0].id, { action: 'accept', requestId: 'sql-accept' });
  assert.equal(accepted.rooms.length, 1);
  assert.equal((await store.participantSnapshot(owner, member)).access, 'participant');
  let snapshot = await store.snapshot(owner);
  snapshot = await store.settings(owner, { requestId: 'sql-settings', revision: snapshot.state.revision, settings: { points: { enabled: true, command: '!marble', cost: 100 }, donation: { enabled: true, minimum: 1000 } } });
  snapshot = await store.act(owner, { action: 'start', requestId: 'sql-start', revision: snapshot.state.revision });
  failReceipt = true;
  await assert.rejects(store.trigger(owner, points()), /receipt write failed/);
  assert.equal((await db.query("select balance from test_points where user_id='viewer'")).rows[0].balance, 1000);
  assert.equal((await store.snapshot(owner)).state.phase, 'ready');
  assert.equal((await store.trigger(owner, points())).accepted, true);
  assert.equal((await createMarbleStore(options).trigger(owner, points({ command: '!changed' }))).duplicate, true);
  assert.equal(deductions, 2);
  assert.equal((await db.query("select balance from test_points where user_id='viewer'")).rows[0].balance, 900);
  assert.equal((await store.trigger(owner, donation())).queued, true);
  const oldToken = snapshot.overlayToken;
  const rotated = await store.rotateOverlay(owner, { requestId: 'sql-token' });
  await assert.rejects(store.overlay(oldToken), { code: 'invalid_overlay_token' });
  assert.equal((await store.overlay(rotated.overlayToken)).access, 'overlay');
  snapshot = await store.snapshot(owner);
  await store.act(owner, { action: 'end', requestId: 'sql-end', revision: snapshot.state.revision });
  await store.revoke(owner, invited.invitations[0].id);
  assert.equal((await store.invitations(member)).rooms.length, 0);
  await assert.rejects(store.answerInvite(member, invited.invitations[0].id, { action: 'accept', requestId: 'sql-reaccept' }), { code: 'invitation_revoked' });
});

test('PGlite personal routing, migration receipts, RLS, channel balances, revision conflicts and stale-binding recovery', { skip: !process.env.ARUBOT_TEST_PGLITE_MODULE }, async t => {
  const { PGlite } = await import(pathToFileURL(process.env.ARUBOT_TEST_PGLITE_MODULE).href);
  const sql = new PGlite(); t.after(() => sql.close());
  await sql.exec(`create table app_users(id text primary key,display_name text,avatar_url text,primary_provider text);
    insert into app_users(id,display_name) values('owner','SQL Host'),('member','SQL Actor'),('other','SQL Other');
    create table test_points(channel text,user_id text,balance integer not null,primary key(channel,user_id));
    insert into test_points values('member-channel','viewer',1000),('owner-channel','viewer',1000);
    create role anon; create role authenticated; create role service_role;`);
  await sql.exec(await readFile(new URL('../server/migrations/032_marble.sql', import.meta.url), 'utf8'));
  await sql.query('insert into marble_rooms(owner_user_id,state,overlay_token) values($1,$2,$3)', [owner, '{}', 'legacy-token']);
  await sql.query('insert into marble_requests(owner_user_id,request_id,fingerprint,result) values($1,$2,$3,$4)', [owner, 'event:legacy', 'legacy-fingerprint', JSON.stringify({ accepted: true, cost: 10 })]);
  let tail = Promise.resolve(), failure = null;
  const pg = { async query(query, values) {
    if (failure?.test(query)) { failure = null; throw new Error('injected SQL failure'); }
    if (query.startsWith('create table if not exists marble_rooms')) { await sql.exec(query); return { rows: [] }; }
    return sql.query(query, values);
  } };
  const options = { ensureIdentityTables: async () => {}, randomInt: () => 0,
    withPgClient(fn, retries) {
      if (retries !== undefined) assert.equal(retries, 0);
      const result = tail.then(() => fn(pg)); tail = result.catch(() => {}); return result;
    },
    async deductChannelPointsIfEnoughWithClient(client, channel, user, _name, amount) {
      assert.equal(client, pg);
      const result = await client.query('update test_points set balance=balance-$3 where channel=$1 and user_id=$2 and balance >= $3 returning balance', [channel, user, amount]);
      return { deducted: result.rows.length > 0 };
    },
  };
  let requestId = 0;
  const db = { store: createMarbleStore(options), key: () => `sql-personal-${++requestId}` };
  await db.store.ensureSchema(); await createMarbleStore(options).ensureSchema();
  const migrated = await sql.query("select * from marble_source_requests where owner_user_id='owner' and request_id='event:legacy'");
  assert.equal(migrated.rows.length, 1); assert.equal(migrated.rows[0].result.cost, 10);
  const flags = await sql.query("select relname,relrowsecurity from pg_class where relname in ('marble_participation','marble_source_requests')");
  assert.equal(flags.rows.length, 2); assert.ok(flags.rows.every(row => row.relrowsecurity));
  for (const table of ['marble_participation', 'marble_source_requests']) {
    for (const role of ['anon', 'authenticated']) assert.equal((await sql.query('select has_table_privilege($1,$2,\'SELECT\') as allowed', [role, table])).rows[0].allowed, false);
    assert.equal((await sql.query('select has_table_privilege(\'service_role\',$1,\'UPDATE\') as allowed', [table])).rows[0].allowed, true);
  }
  await sql.query("delete from marble_rooms where owner_user_id='owner'");
  assert.equal((await sql.query("select count(*)::int as count from marble_source_requests where request_id='event:legacy'")).rows[0].count, 1);
  const invite = await joinRoom(db, owner); await joinRoom(db, 'other');
  await startRoom(db, owner); await startRoom(db, 'other');
  assert.equal((await db.store.participantSnapshot(owner, member)).viewerParticipation.connected, false);
  await connect(db);
  assert.equal((await sql.query("select count(*)::int as count from marble_rooms where owner_user_id='member'")).rows[0].count, 0, 'Connecting does not initialize the source game');
  assert.deepEqual((await db.store.configuration(member)).settings, personalSettings());
  assert.equal((await db.store.configuration(member)).status, 'running');
  failure = /^insert into marble_source_requests/;
  await assert.rejects(db.store.trigger(member, points({ command: '!personal', channelUid: 'member-channel' })), /injected SQL failure/);
  assert.equal((await sql.query("select balance from test_points where channel='member-channel'")).rows[0].balance, 1000);
  assert.equal((await db.store.trigger(member, points({ command: '!personal', channelUid: 'member-channel' }))).accepted, true);
  assert.equal((await sql.query("select balance from test_points where channel='member-channel'")).rows[0].balance, 750);
  assert.equal((await sql.query("select balance from test_points where channel='owner-channel'")).rows[0].balance, 1000);
  assert.equal((await db.store.trigger(member, donation({ amount: 1500, username: 'sql-private-donor' }))).queued, true);
  const snapshot = await db.store.participantSnapshot(owner, member);
  assert.equal(snapshot.viewerDonationQueueCount, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /sql-private-donor/);
  const personal = await db.store.snapshot(member);
  await selectObs(db, owner);
  const personalOverlay = await db.store.overlay(personal.overlayToken);
  assert.equal(personalOverlay.state.currentPlayerId, snapshot.actorPlayerId);
  assert.deepEqual(personalOverlay.state.players, snapshot.state.players);
  assert.equal(personalOverlay.state.lastRoll.id, snapshot.state.playerStates[snapshot.actorPlayerId].lastRoll.id);
  assert.doesNotMatch(JSON.stringify(personalOverlay), /sql-private-donor|userId|overlayToken|viewerParticipation/);
  const input = { participationRevision: snapshot.viewerParticipation.revision, connected: true, settings: personalSettings() };
  const outcomes = await Promise.allSettled([
    db.store.participation(owner, member, { ...input, requestId: db.key() }),
    createMarbleStore(options).participation('other', member, { ...input, requestId: db.key() }),
  ]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(result => result.status === 'rejected').reason.code, 'stale_participation_revision');
  await connect(db, 'other');
  assert.equal((await createMarbleStore(options).trigger(member, points({ command: '!personal', channelUid: 'member-channel' }))).duplicate, true);
  assert.equal((await sql.query("select balance from test_points where channel='member-channel'")).rows[0].balance, 750);
  await connect(db, owner);
  const host = await db.store.snapshot(owner);
  await db.store.act(owner, { action: 'end', requestId: db.key(), revision: host.state.revision });
  await db.store.revoke(owner, invite.id);
  assert.equal((await db.store.overlay(personal.overlayToken)).state.players.length, 1);
  assert.equal((await db.store.configuration(member)).status, 'unavailable');
  assert.equal((await db.store.trigger(member, points({ eventId: 'revoked', command: '!personal', channelUid: 'member-channel' }))).reason, 'not_a_participant');
  const before = (await db.store.snapshot(member)).viewerParticipation;
  await sql.query("delete from marble_rooms where owner_user_id='owner'");
  const deleted = (await db.store.snapshot(member)).viewerParticipation;
  assert.equal(deleted.connectedOwnerUserId, owner); assert.equal(deleted.connectedRoomTitle, null);
  assert.equal((await db.store.configuration(member)).status, 'unavailable');
  const disconnected = await db.store.disconnectParticipation(member, { requestId: db.key(), participationRevision: before.revision });
  assert.equal(disconnected.viewerParticipation.connectedOwnerUserId, null);
  assert.deepEqual(disconnected.viewerParticipation.settings, personalSettings());
  assert.equal((await db.store.configuration(member)).status, 'lobby');
  assert.equal((await db.store.configuration(member)).settings.points.enabled, false);
  await assert.rejects(sql.query('insert into marble_participation(source_user_id,settings,connected_owner_user_id) values($1,$2,$1)', ['other', '{}']), /check constraint/);
  await sql.query("delete from app_users where id='member'");
  assert.equal((await sql.query("select count(*)::int as count from marble_participation where source_user_id='member'")).rows[0].count, 0);
  assert.equal((await sql.query("select count(*)::int as count from marble_source_requests where owner_user_id='member'")).rows[0].count, 0);
});

test('PGlite OBS migration backfills once, preserves paid consent, and supports automatic accept/leave during play', { skip: !process.env.ARUBOT_TEST_PGLITE_MODULE }, async t => {
  const { PGlite } = await import(pathToFileURL(process.env.ARUBOT_TEST_PGLITE_MODULE).href);
  const sql = new PGlite(); t.after(() => sql.close());
  await sql.exec(`create table app_users(id text primary key,display_name text,avatar_url text,primary_provider text);
    insert into app_users(id,display_name) values('owner','Host'),('member','Guest'),('other','Other'),('new-member','New guest');`);
  await sql.exec(await readFile(new URL('../server/migrations/032_marble.sql', import.meta.url), 'utf8'));
  await sql.exec(await readFile(new URL('../server/migrations/033_marble_participation.sql', import.meta.url), 'utf8'));
  for (const [index, who] of ['owner', 'other', 'member'].entries()) {
    const state = createMarbleState(); state.players[0].userId = who;
    if (who !== 'member') for (const guest of who === owner ? ['member', 'new-member'] : ['member']) {
      const player = { ...state.players[0], id: `pawn-${guest}`, userId: guest, name: guest };
      state.players.push(player); state.playerStates[player.id] = clone(state.playerStates['player-1']);
    }
    await sql.query('insert into marble_rooms(owner_user_id,state,overlay_token) values($1,$2,$3)', [who, JSON.stringify(state), `marble_${String(index).repeat(43)}`]);
  }
  const firstId = '11111111-1111-4111-8111-111111111111';
  const secondId = '22222222-2222-4222-8222-222222222222';
  const thirdId = '33333333-3333-4333-8333-333333333333';
  for (const [id, host, guest] of [[firstId, owner, member], [secondId, 'other', member], [thirdId, owner, 'new-member']]) {
    await sql.query("insert into marble_invites(id,owner_user_id,member_user_id,status,expires_at) values($1,$2,$3,'accepted',clock_timestamp()+interval '7 days')", [id, host, guest]);
  }
  await sql.query('insert into marble_participation(source_user_id,revision,settings,connected_owner_user_id) values($1,7,$2,$3)', [member, JSON.stringify(personalSettings()), owner]);
  let tail = Promise.resolve();
  const pg = { query: async (query, values) => {
    if (query.startsWith('create table if not exists marble_rooms')) { await sql.exec(query); return { rows: [] }; }
    return sql.query(query, values);
  } };
  const options = { ensureIdentityTables: async () => {}, randomInt: () => 0, withPgClient(fn) {
    const result = tail.then(() => fn(pg)); tail = result.catch(() => {}); return result;
  } };
  let serial = 0;
  const db = { store: createMarbleStore(options), key: () => `obs-sql-${++serial}` };
  await db.store.ensureSchema();
  const before = await db.store.snapshot(member);
  assert.equal(before.viewerOverlay.ownerUserId, owner, 'Existing explicit room wins over more recent invitations');
  assert.equal(before.viewerParticipation.revision, 7);
  assert.deepEqual(before.viewerParticipation.settings, personalSettings());
  assert.equal((await sql.query('select connected_invitation_id from marble_participation where source_user_id=$1', [member])).rows[0].connected_invitation_id, firstId);
  const newcomer = await db.store.snapshot('new-member');
  assert.equal(newcomer.viewerOverlay.ownerUserId, owner);
  assert.deepEqual(newcomer.viewerParticipation.settings, DEFAULT_MARBLE_PARTICIPATION_SETTINGS);
  assert.equal(newcomer.viewerParticipation.connectedOwnerUserId, null);
  await selectObs(db, 'other');
  await createMarbleStore(options).ensureSchema();
  assert.equal((await db.store.snapshot(member)).viewerOverlay.ownerUserId, 'other', 'Startup must not overwrite later selection');
  assert.equal((await db.store.snapshot(member)).viewerParticipation.revision, 7);
  await db.store.leave(owner, member, { invitationId: firstId, requestId: db.key() });
  assert.equal((await db.store.snapshot(member)).viewerOverlay.ownerUserId, 'other');
  await db.store.leave('other', member, { invitationId: secondId, requestId: db.key() });
  await createMarbleStore(options).ensureSchema();
  assert.equal((await db.store.snapshot(member)).viewerOverlay.ownerUserId, null);
  assert.equal((await db.store.overlay(before.overlayToken)).state.players.length, 1);
  const joined = await joinRoom(db, owner);
  const participant = await db.store.participantSnapshot(owner, member);
  assert.equal(participant.viewerOverlay.connected, true);
  assert.equal(participant.viewerParticipation.suspended, true);
  assert.equal((await db.store.configuration(member)).status, 'unavailable');
  assert.deepEqual((await db.store.overlay(before.overlayToken)).state.players, participant.state.players);
  await connect(db);
  await startRoom(db, owner);
  assert.equal((await db.store.trigger(member, donation({ amount: 1500 }))).accepted, true);
  assert.equal((await db.store.trigger(member, donation({ amount: 1500, eventId: 'queued-before-leave' }))).queued, true);
  const leaving = { invitationId: joined.id, requestId: db.key() };
  await db.store.leave(owner, member, leaving);
  await db.store.leave(owner, member, leaving);
  assert.equal((await db.store.overlay(before.overlayToken)).state.players.length, 1);
  const host = await db.store.snapshot(owner);
  assert.equal(host.state.status, 'running');
  assert.equal(host.state.playerStates[participant.actorPlayerId], undefined);
  assert.deepEqual((await db.store.snapshot(member)).viewerParticipation.settings, personalSettings());
  assert.equal((await db.store.configuration(member)).status, 'unavailable');
  await assert.rejects(sql.query('update marble_participation set obs_owner_user_id=source_user_id where source_user_id=$1', [member]), /check constraint/);
});
