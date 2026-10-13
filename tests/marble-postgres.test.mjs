import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createMarbleStore } from '../server/marble-store.js';

const url = process.env.ARUBOT_TEST_POSTGRES_URL;

test('PostgreSQL: concurrent free play, atomic points, membership and durable receipts', { skip: !url }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 6, connectionTimeoutMillis: 5000 });
  const schema = `marble_test_${randomUUID().replaceAll('-', '')}`;
  const owner = 'marble-test-host', guest = 'marble-test-guest';
  const client = await pool.connect();
  try {
    await client.query(`create schema ${schema}`);
    const withPgClient = async fn => {
      const connection = await pool.connect();
      try { await connection.query(`set search_path to ${schema},public`); return await fn(connection); }
      finally { connection.release(); }
    };
    await withPgClient(async db => {
      await db.query('create table app_users(id text primary key,display_name text,avatar_url text,primary_provider text)');
      await db.query('insert into app_users values ($1,$2,null,$3),($4,$5,null,$3)', [owner, '방장', 'chzzk', guest, '참가자']);
      await db.query('create table point_fixture(user_id text primary key,balance integer not null)');
      await db.query("insert into point_fixture values('viewer',5000)");
    });
    const store = createMarbleStore({ withPgClient, ensureIdentityTables: async () => {}, randomInt: () => 0,
      deductChannelPointsIfEnoughWithClient: async (db, _channel, userId, _name, amount) => {
        const result = await db.query('update point_fixture set balance=balance-$2 where user_id=$1 and balance>=$2 returning balance', [userId, amount]);
        return { deducted: result.rowCount === 1 };
      } });
    let snapshot = await store.snapshot(owner);
    assert.equal(snapshot.state.players[0].name, '방장');
    const settings = structuredClone(snapshot.state.settings);
    settings.tiles = settings.tiles.map(tile => ({ ...tile, effects: [] }));
    settings.points = { enabled: true, command: '!주루마블', cost: 100 };
    snapshot = await store.settings(owner, { settings, revision: snapshot.state.revision, requestId: randomUUID() });
    const invitation = await store.invite(owner, { memberUserId: guest, requestId: randomUUID() });
    await store.answerInvite(guest, invitation.invitations[0].id, { action: 'accept', requestId: randomUUID() });
    snapshot = await store.snapshot(owner);
    snapshot = await store.act(owner, { action: 'start', revision: snapshot.state.revision, requestId: randomUUID() });
    const ownerPlayer = snapshot.state.players.find(player => player.userId === owner);
    const guestPlayer = snapshot.state.players.find(player => player.userId === guest);
    const revision = snapshot.state.revision;
    const requests = await Promise.allSettled([
      store.act(owner, { action: 'roll', playerId: ownerPlayer.id, expectedRollId: null, revision, requestId: randomUUID() }),
      store.act(owner, { action: 'roll', playerId: guestPlayer.id, expectedRollId: null, revision, requestId: randomUUID() }, { participant: true, actorUserId: guest }),
    ]);
    assert.equal(requests.filter(result => result.status === 'fulfilled').length, 2);
    snapshot = await store.snapshot(owner);
    assert.equal(snapshot.state.playerStates[ownerPlayer.id].phase, 'effect');
    assert.equal(snapshot.state.playerStates[guestPlayer.id].phase, 'effect');
    const trigger = { source: 'points', provider: 'chzzk', eventId: 'busy-event', command: '!주루마블', userId: 'viewer', username: '시청자', channelUid: 'channel' };
    assert.equal((await store.trigger(owner, trigger)).accepted, false);
    snapshot = await store.act(owner, { action: 'end', revision: snapshot.state.revision, requestId: randomUUID() });
    snapshot = await store.act(owner, { action: 'start', revision: snapshot.state.revision, requestId: randomUUID() });
    assert.equal((await store.trigger(owner, trigger)).duplicate, true);
    const paid = { ...trigger, eventId: 'paid-event' };
    const pair = await Promise.all([store.trigger(owner, paid), store.trigger(owner, paid)]);
    assert.equal(pair.filter(result => result.accepted && !result.duplicate).length, 1);
    const balance = await withPgClient(db => db.query("select balance from point_fixture where user_id='viewer'"));
    assert.equal(balance.rows[0].balance, 4900);
    const token = snapshot.overlayToken;
    const overlay = await store.overlay(token);
    assert.equal(overlay.overlayToken, undefined);
    assert.equal(overlay.state.players.some(player => player.userId), false);
    assert.equal(overlay.state.deck.length, 0);
    const rotation = { requestId: randomUUID() };
    const rotated = await store.rotateOverlay(owner, rotation);
    assert.equal((await store.rotateOverlay(owner, rotation)).overlayToken, rotated.overlayToken);
    await assert.rejects(store.overlay(token));
  } finally {
    await client.query(`drop schema if exists ${schema} cascade`);
    client.release(); await pool.end();
  }
});
