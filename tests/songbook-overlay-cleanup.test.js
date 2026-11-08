const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const load = require('./helpers/load-source.cjs');
const songbook = load('shared/songbook.js');
const overlay = load('shared/songbook-overlay.js', { './songbook.js': songbook });
const { startSongbookOverlayCleanup } = load('server/songbook-overlay-cleanup.js');
const source = fs.readFileSync(path.join(__dirname, '../server/songbook-store.js'), 'utf8')
  .replace(/^import .*;$/gm, '').replaceAll('import.meta.url', JSON.stringify('file:///test/server/songbook-store.js')).replace(/^export /gm, '');
const context = { URL, randomUUID, ...songbook, ...overlay, readFile: async () => '-- schema', module: { exports: {} } };
vm.runInNewContext(`${source}\nmodule.exports={createSongbookStore};`, context);
const { createSongbookStore } = context.module.exports;

function harness() {
  let now = 0;
  const token = 'a'.repeat(64);
  const settings = { owner_user_id: 'owner', requests_enabled: true, overlay_config: {}, overlay_token: token, completed_cleanup_after: null };
  const requests = ['done', 'pending', 'singing', 'rejected', 'cancelled'].map(status => ({
    id: randomUUID(), owner_user_id: 'owner', status, song: { title: status },
  }));
  requests.push({ id: randomUUID(), owner_user_id: 'other', status: 'done', song: { title: 'Other channel' } });
  const query = jest.fn(async (sql, args = []) => {
    if (sql === 'select * from songbook_settings where owner_user_id=$1 for update') return { rows: [settings] };
    if (sql.startsWith('update songbook_settings set requests_enabled=')) {
      settings.requests_enabled = args[1];
      settings.completed_cleanup_after = args[1] ? null : settings.completed_cleanup_after ?? now + 120000;
    } else if (sql.startsWith('update songbook_settings set completed_cleanup_after=now()')) {
      if (args[0] === token && !settings.requests_enabled && (settings.completed_cleanup_after === null || settings.completed_cleanup_after < now + 110000)) {
        settings.completed_cleanup_after = now + 120000;
      }
    } else if (sql.startsWith('update songbook_settings set completed_cleanup_after=coalesce')) {
      if (!settings.requests_enabled) settings.completed_cleanup_after ??= now + 120000;
    } else if (sql.startsWith('update songbook_settings set completed_cleanup_after=null')) {
      settings.completed_cleanup_after = null;
    } else if (sql.startsWith('select s.overlay_config')) {
      return { rows: args[0] === token ? [{ ...settings, requests: requests.filter(r => r.owner_user_id === 'owner') }] : [] };
    } else if (sql.startsWith('select owner_user_id from songbook_settings')) {
      return { rows: !settings.requests_enabled && settings.completed_cleanup_after !== null && settings.completed_cleanup_after <= now ? [settings] : [] };
    } else if (sql.startsWith('delete from songbook_requests')) {
      let rowCount = 0;
      for (let i = requests.length - 1; i >= 0; i--) {
        if (args[0].includes(requests[i].owner_user_id) && requests[i].status === 'done') { requests.splice(i, 1); rowCount++; }
      }
      return { rows: [], rowCount };
    } else if (sql.startsWith('select * from songbook_requests where owner_user_id=$1 and id=')) {
      return { rows: requests.filter(row => row.owner_user_id === args[0] && row.id === args[1]) };
    } else if (sql.startsWith('update songbook_requests set status=$3')) {
      const row = requests.find(r => r.id === args[1]); row.status = args[2]; return { rows: [row] };
    }
    return { rows: [] };
  });
  const store = createSongbookStore({ withPgClient: fn => fn({ query }), ensureIdentityTables: async () => {} });
  return { store, settings, requests, query, token, advance: ms => { now += ms; }, close: () => store.updateSettings('owner', { requestsEnabled: false, perUserLimit: 1 }) };
}

describe('completed song cleanup lifecycle', () => {
  test('closing requests alone retains songs while any overlay is still polling', async () => {
    const h = harness(); await h.close();
    expect(await h.store.cleanupCompletedRequests()).toEqual({ deleted: 0 });
    h.advance(100000); await h.store.getOverlaySnapshot(h.token); // First window.
    h.advance(100000); await h.store.getOverlaySnapshot(h.token); // Another window remains open.
    expect(await h.store.cleanupCompletedRequests()).toEqual({ deleted: 0 });
    h.advance(119999); expect(await h.store.cleanupCompletedRequests()).toEqual({ deleted: 0 });
    h.advance(1); expect(await h.store.cleanupCompletedRequests()).toEqual({ deleted: 1 });
    expect(h.requests.filter(r => r.owner_user_id === 'owner').map(r => r.status)).toEqual(['pending', 'singing', 'rejected', 'cancelled']);
    expect(h.requests.find(r => r.owner_user_id === 'other').status).toBe('done');
    expect(h.settings.completed_cleanup_after).toBeNull();
    expect(await h.store.cleanupCompletedRequests()).toEqual({ deleted: 0 });
  });
  test('closed overlays never clear history while requests are open; reopening cancels cleanup', async () => {
    const h = harness(); await h.store.getOverlaySnapshot(h.token);
    h.advance(500000); expect(await h.store.cleanupCompletedRequests()).toEqual({ deleted: 0 });
    await h.close(); h.advance(130000);
    await h.store.updateSettings('owner', { requestsEnabled: true, perUserLimit: 1 });
    expect(h.settings.completed_cleanup_after).toBeNull();
    expect(await h.store.cleanupCompletedRequests()).toEqual({ deleted: 0 });
    await h.close();
    expect(await h.store.cleanupCompletedRequests()).toEqual({ deleted: 0 });
  });
  test('reloads and brief outages renew the grace period without deleting anything', async () => {
    const h = harness(); await h.close(); h.advance(110000);
    await h.store.getOverlaySnapshot(h.token); h.advance(20000);
    expect(await h.store.cleanupCompletedRequests()).toEqual({ deleted: 0 });
    const heartbeat = h.query.mock.calls.find(([sql]) => sql.startsWith('update songbook_settings set completed_cleanup_after=now()'));
    expect(heartbeat[0]).toContain('where overlay_token=$1 and requests_enabled=false');
    expect(heartbeat[0]).toContain("interval '110 seconds'");
    expect(heartbeat[1]).toEqual([h.token]);
  });
  test('new completions after cleanup are armed again without removing other request statuses', async () => {
    const h = harness(); await h.close(); h.advance(120000); await h.store.cleanupCompletedRequests();
    const singing = h.requests.find(r => r.status === 'singing');
    await h.store.changeRequest('owner', singing.id, 'done');
    expect(await h.store.cleanupCompletedRequests()).toEqual({ deleted: 0 });
    h.advance(120000); expect(await h.store.cleanupCompletedRequests()).toEqual({ deleted: 1 });
  });
  test('expired tokens cannot postpone cleanup and deletion is restricted to locked channel rows', async () => {
    const h = harness(); await h.close(); h.advance(120000);
    await expect(h.store.getOverlaySnapshot('b'.repeat(64))).rejects.toMatchObject({ status: 404 });
    await h.store.cleanupCompletedRequests();
    const select = h.query.mock.calls.findIndex(([sql]) => sql.startsWith('select owner_user_id from songbook_settings'));
    expect(h.query.mock.calls[select][0]).toContain('requests_enabled=false and completed_cleanup_after<=now()');
    expect(h.query.mock.calls[select][0]).toContain('limit 100 for update skip locked');
    expect(h.query.mock.calls[select - 1][0]).toBe('begin');
    expect(h.query.mock.calls[select + 1]).toEqual(["delete from songbook_requests where owner_user_id=any($1::text[]) and status='done'", [['owner']]]);
    expect(h.query.mock.calls.at(-1)[0]).toBe('commit');
  });
  test('failed deletes roll back instead of disarming the pending cleanup', async () => {
    const h = harness(); await h.close(); h.advance(120000);
    const original = h.query.getMockImplementation();
    h.query.mockImplementation((sql, args) => sql.startsWith('delete from songbook_requests') ? Promise.reject(new Error('database unavailable')) : original(sql, args));
    await expect(h.store.cleanupCompletedRequests()).rejects.toThrow('database unavailable');
    expect(h.query.mock.calls.at(-1)[0]).toBe('rollback');
    expect(h.settings.completed_cleanup_after).not.toBeNull();
  });
  test('migration only adds a nullable lease and partial index; does not clear existing history', () => {
    const migration = fs.readFileSync(path.join(__dirname, '../server/migrations/036_songbook_overlay_cleanup.sql'), 'utf8');
    expect(migration).toContain('add column if not exists completed_cleanup_after timestamptz');
    expect(migration).toContain('requests_enabled=false');
    expect(migration).not.toMatch(/\b(delete|truncate|drop|update)\b/i);
  });
});

describe('songbook cleanup scheduling', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  test('waits for OBS reconnection after restart, retries failures, and stops cleanly', async () => {
    const store = { cleanupCompletedRequests: jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ deleted: 0 }) };
    const logger = { error: jest.fn() };
    const stop = startSongbookOverlayCleanup({ store, logger });
    await jest.advanceTimersByTimeAsync(119999); expect(store.cleanupCompletedRequests).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1); expect(logger.error).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(30000); expect(store.cleanupCompletedRequests).toHaveBeenCalledTimes(2);
    await stop(); await jest.advanceTimersByTimeAsync(300000);
    expect(store.cleanupCompletedRequests).toHaveBeenCalledTimes(2);
  });
  test('does not overlap slow cleanup and shutdown waits for the running transaction', async () => {
    let finish;
    const store = { cleanupCompletedRequests: jest.fn(() => new Promise(resolve => { finish = resolve; })) };
    const stop = startSongbookOverlayCleanup({ store });
    await jest.advanceTimersByTimeAsync(300000); expect(store.cleanupCompletedRequests).toHaveBeenCalledTimes(1);
    let stopped = false; const stopping = stop().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false);
    finish({ deleted: 0 }); await stopping;
    await jest.advanceTimersByTimeAsync(300000); expect(store.cleanupCompletedRequests).toHaveBeenCalledTimes(1);
  });
});
