const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { randomUUID } = require('crypto');
const load = require('./helpers/load-source.cjs');
const songbook = load('shared/songbook.js');
const overlay = load('shared/songbook-overlay.js', { './songbook.js': songbook });
const { normalizeSongbookOverlay: normalize, songbookOverlayRect: rect, songbookOverlaySnapshot: snapshot } = overlay;
function loadServer(file, names) {
  const context = { URL, console, randomUUID, ...songbook, ...overlay, readFile: async () => '-- schema', module: { exports: {} } };
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/^import .*;$/gm, '').replaceAll('import.meta.url', JSON.stringify('file:///test/server/songbook-store.js')).replace(/^export /gm, '');
  vm.runInNewContext(`${source}\nmodule.exports={${names.join(',')}};`, context);
  return context.module.exports;
}

describe('songbook overlay layout and privacy', () => {
  test('defaults are independent and normalization is idempotent', () => {
    const a = normalize(); const b = normalize();
    a.layouts.portrait.current.x = 22;
    expect(b.layouts.portrait.current.x).toBe(6);
    expect(a.layouts.landscape.current.x).toBe(3);
    expect(normalize(normalize({ scale: 1.43, layouts: { landscape: { current: { x: 99, y: 99 } } } })))
      .toEqual(normalize({ scale: 1.43, layouts: { landscape: { current: { x: 99, y: 99 } } } }));
  });
  test.each([null, [], { opacity: NaN }, { scale: Infinity }, { artwork: 'true' }, { accent: 'url(https://evil.test)' }, { text: '#fff' }, { layouts: { landscape: { current: [] } } }])('rejects malformed configuration %p', input => expect(() => normalize(input)).toThrow());
  test.each(['landscape', 'portrait'])('all blocks remain within %s at maximum size', orientation => {
    const config = normalize({ scale: 1.5, maxRows: 8, layouts: { [orientation]: { current: { x: 100, y: 100, width: 100 }, queue: { x: 100, y: 100, width: 95 } } } });
    for (const block of ['current', 'queue']) {
      const r = rect(config, orientation, block);
      const size = overlay.SONGBOOK_OVERLAY_SIZES[orientation];
      expect(r.x).toBeGreaterThanOrEqual(0); expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(size.width);
      expect(r.y + r.height).toBeLessThanOrEqual(size.height);
    }
  });
  test('large typography reduces visible rows instead of clipping and narrow blocks retain readable space', () => {
    const config = normalize({ scale: 1.5, maxRows: 8, layouts: { landscape: { current: { width: 18 } } } });
    expect(overlay.songbookOverlayCapacity(config, 'landscape')).toBe(7);
    expect(overlay.songbookOverlayCapacity(config, 'portrait')).toBe(8);
    expect(rect(config, 'landscape', 'current').width).toBeGreaterThanOrEqual(599);
  });
  test('snapshot allows only broadcast metadata and limits transmitted queue while retaining the count', () => {
    const item = { id: 'request', status: 'pending', username: 'Viewer', viewer_user_id: 'secret-viewer', message: 'private message', song: { title: 'Song', artist: 'Artist', privateNote: 'secret note', videoId: 'abcdefghijk', keyShift: -1 } };
    const data = snapshot({ overlay_config: { maxRows: 2 }, requests_enabled: true, overlay_token: 'secret-token' }, [{ ...item, id: 'now', status: 'singing' }, ...Array.from({ length: 10 }, (_, i) => ({ ...item, id: String(i) })), { ...item, status: 'done' }]);
    expect(data.current.id).toBe('now'); expect(data.queueCount).toBe(10); expect(data.queue.map(i => i.id)).toEqual(['0', '1']);
    expect(JSON.stringify(data)).not.toMatch(/secret|private/);
    expect(Object.keys(data.current).sort()).toEqual(['artist', 'id', 'keyShift', 'title', 'username', 'videoId']);
    expect(snapshot({}, [{ ...item, song: { videoId: 'https://evil.test' } }]).queue[0].videoId).toBeNull();
  });
});

describe('songbook overlay persistence and capability', () => {
  function harness() {
    const row = { owner_user_id: 'owner', requests_enabled: true, overlay_revision: 1, overlay_config: {} };
    const query = jest.fn(async (sql, args = []) => {
      if (sql.includes('for update')) return { rows: [row] };
      if (sql.startsWith('update songbook_settings set overlay_')) {
        if (args[0] !== row.owner_user_id) return { rows: [] };
        if (sql.includes('overlay_config=$2')) {
          if (args[2] !== row.overlay_revision) return { rows: [] };
          row.overlay_config = JSON.parse(args[1]); row.overlay_revision++;
        } else if (sql.includes('coalesce')) row.overlay_token ||= args[1];
        else { row.overlay_token = args[1]; row.overlay_revision++; }
        return { rows: [{ ...row }] };
      }
      if (sql.startsWith('select s.overlay_config')) return { rows: args[0] === row.overlay_token ? [{ ...row, requests: [] }] : [] };
      return { rows: [] };
    });
    const { createSongbookStore } = loadServer('server/songbook-store.js', ['createSongbookStore']);
    return { row, query, store: createSongbookStore({ withPgClient: fn => fn({ query }), ensureIdentityTables: async () => {} }) };
  }
  test('stable token, both orientation layouts and revision survive reload; saves use owner lock', async () => {
    const h = harness();
    const initial = await h.store.getOverlay('owner');
    expect(initial.viewerPath).toMatch(/\/viewer\/songbook\/[a-f0-9]{64}$/);
    expect((await h.store.getOverlay('owner')).viewerPath).toBe(initial.viewerPath);
    const config = normalize({ layouts: { portrait: { queue: { x: 9, y: 40, width: 72 } } }, artwork: false });
    await h.store.saveOverlay('owner', { config, revision: initial.revision });
    expect(await h.store.getOverlay('owner')).toMatchObject({ config, revision: 2 });
    const save = h.query.mock.calls.findIndex(([sql]) => sql.includes('overlay_config=$2'));
    expect(h.query.mock.calls.slice(0, save).some(([sql]) => sql.includes('for update'))).toBe(true);
    expect(h.row.requests_enabled).toBe(true);
  });
  test('conflicts, invalid revisions and another owner cannot overwrite the layout', async () => {
    const h = harness(); await h.store.getOverlay('owner');
    await expect(h.store.saveOverlay('owner', { config: {}, revision: 9 })).rejects.toMatchObject({ status: 409 });
    await expect(h.store.saveOverlay('owner', { config: {}, revision: 0 })).rejects.toMatchObject({ status: 400 });
    await expect(h.store.saveOverlay('other', { config: {}, revision: 1 })).rejects.toMatchObject({ status: 409 });
    expect(h.row.overlay_revision).toBe(1);
    expect(h.query.mock.calls.at(-1)[0]).toBe('rollback');
  });
  test('rotation immediately invalidates old capability and new token reads DB without identity leakage', async () => {
    const h = harness(); const initial = await h.store.getOverlay('owner'); const old = initial.viewerPath.split('/').at(-1);
    expect((await h.store.getOverlaySnapshot(old)).queue).toEqual([]);
    const next = await h.store.rotateOverlay('owner'); const token = next.viewerPath.split('/').at(-1);
    expect(token).not.toBe(old);
    await expect(h.store.getOverlaySnapshot(old)).rejects.toMatchObject({ status: 404 });
    expect(await h.store.getOverlaySnapshot(token)).not.toHaveProperty('owner_user_id');
    const query = h.query.mock.calls.find(([sql]) => sql.startsWith('select s.overlay_config'));
    expect(query[0]).toContain("status in ('pending','singing')"); expect(query[0]).toContain('order by created_at,id');
    expect(query[1]).toEqual([old]);
  });
  test.each(['', [], 'abc', 'a'.repeat(65), "' or 1=1 --"])('invalid capability %p never queries database', async token => {
    const h = harness(); await expect(h.store.getOverlaySnapshot(token)).rejects.toMatchObject({ status: 404 }); expect(h.query).not.toHaveBeenCalled();
  });
});

describe('songbook overlay HTTP and delegated scope', () => {
  test('reads and mutations use effective owner, not supplied owner; viewer is read-only', async () => {
    const { registerSongbookRoutes } = loadServer('server/songbook-routes.js', ['registerSongbookRoutes']);
    const routes = new Map(); const app = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [method, (route, ...handlers) => routes.set(`${method} ${route}`, handlers)]));
    const store = Object.fromEntries(['getOverlay', 'saveOverlay', 'rotateOverlay', 'getOverlaySnapshot'].map(name => [name, jest.fn(async () => ({}))]));
    const limiter = jest.fn();
    registerSongbookRoutes(app, { store, getAdminOwner: req => req.owner, writeLimiter: limiter });
    const invoke = async (route, req) => { const res = { setHeader: jest.fn(), json: jest.fn(), status: jest.fn().mockReturnThis() }; await routes.get(route).at(-1)(req, res); return res; };
    await invoke('patch /api/songbook/overlay', { owner: 'managed-owner', body: { owner: 'forged', config: {} } });
    expect(store.saveOverlay).toHaveBeenCalledWith('managed-owner', { owner: 'forged', config: {} });
    expect(routes.get('patch /api/songbook/overlay')[0]).toBe(limiter);
    expect(routes.get('post /api/songbook/overlay/rotate')[0]).toBe(limiter);
    const denied = await invoke('get /api/songbook/overlay', {}); expect(denied.status).toHaveBeenCalledWith(401);
    await invoke('get /api/overlays/songbook', { query: { token: 'token' } }); expect(store.getOverlaySnapshot).toHaveBeenCalledWith('token');
    expect([...routes.keys()].filter(key => key.includes('/api/overlays/'))).toEqual(['get /api/overlays/songbook']);
    const { botManagementRoutePolicy, canUseBotManagementRoute } = load('shared/bot-management-policy.js');
    for (const method of ['GET', 'PATCH']) {
      const policy = botManagementRoutePolicy(method, '/api/songbook/overlay');
      expect(canUseBotManagementRoute({ role: 'manager', scopes: ['songbook:read'] }, policy)).toBe(method === 'GET');
      expect(canUseBotManagementRoute({ role: 'manager', scopes: ['songbook:write'] }, policy)).toBe(true);
    }
    expect(canUseBotManagementRoute({ role: 'manager', scopes: ['songbook:read'] }, botManagementRoutePolicy('POST', '/api/songbook/overlay/rotate'))).toBe(false);
  });
});

describe('songbook overlay recovery', () => {
  const { connectSongbookOverlay } = load('src/shared/api/songbook-overlay-connection.ts');
  const data = { config: normalize(), current: null, queue: [], queueCount: 0, requestsEnabled: false };
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  test('polls serially, retains data on outage, retries indefinitely and recovers after restart', async () => {
    const fetcher = jest.fn().mockResolvedValue({ ok: true, json: async () => data }); const onData = jest.fn();
    const stop = connectSongbookOverlay({ url: '/snapshot', fetcher, onData });
    await jest.advanceTimersByTimeAsync(0); expect(onData).toHaveBeenLastCalledWith(data);
    fetcher.mockRejectedValue(new Error('offline')); await jest.advanceTimersByTimeAsync(100000);
    expect(onData).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls.length).toBeGreaterThan(5);
    fetcher.mockResolvedValue({ ok: true, json: async () => data }); await jest.advanceTimersByTimeAsync(30000);
    expect(onData.mock.calls.length).toBeGreaterThan(1); stop(); const calls = fetcher.mock.calls.length;
    await jest.advanceTimersByTimeAsync(100000); expect(fetcher).toHaveBeenCalledTimes(calls);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', cache: 'no-store' });
  });
  test('revoked tokens clear stale broadcast content and disposed requests never update state', async () => {
    const onData = jest.fn(); const fetcher = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    const stop = connectSongbookOverlay({ url: '/snapshot', fetcher, onData }); await jest.advanceTimersByTimeAsync(0);
    expect(onData).toHaveBeenCalledWith(null); stop();
    let resolve; const slow = jest.fn(() => new Promise(r => { resolve = r; }));
    const done = connectSongbookOverlay({ url: '/snapshot', fetcher: slow, onData }); done();
    resolve({ ok: true, json: async () => data }); await jest.advanceTimersByTimeAsync(0);
    expect(onData).toHaveBeenCalledTimes(1); expect(slow.mock.calls[0][1].signal.aborted).toBe(true);
  });
  test('a hung fetch times out before another request is scheduled', async () => {
    const fetcher = jest.fn((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))));
    const stop = connectSongbookOverlay({ url: '/snapshot', fetcher, onData: jest.fn() });
    await jest.advanceTimersByTimeAsync(7999); expect(fetcher).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(4001); expect(fetcher).toHaveBeenCalledTimes(2); stop();
  });
});
