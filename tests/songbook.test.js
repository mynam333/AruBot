const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { randomUUID } = require('crypto');
const root = path.join(__dirname, '..');
function load(file, names, extra = {}) {
  const context = { URL, console, ...extra, module: { exports: {} } };
  const source = fs.readFileSync(path.join(root, file), 'utf8').replace(/^import .*;$/gm, '').replaceAll('import.meta.url', JSON.stringify('file:///test/server/songbook-store.js')).replace(/^export /gm, '');
  vm.runInNewContext(`${source}\nmodule.exports={${names.join(',')}};`, context);
  return context.module.exports;
}
const shared = load('shared/songbook.js', ['songbookVideoId', 'normalizeSongbookSong', 'normalizeSongbookSettings', 'normalizeSongbookQuery', 'publicSongbookSong', 'songbookError']);
const commands = load('shared/songbook-commands.js', ['matchSongbookSongs']);
const { createSongbookStore } = load('server/songbook-store.js', ['createSongbookStore'], { ...shared, ...commands, randomUUID, readFile: async () => '-- schema' });
const { registerSongbookRoutes } = load('server/songbook-routes.js', ['registerSongbookRoutes']);
const { botManagementRoutePolicy, canUseBotManagementRoute } = load('shared/bot-management-policy.js', ['botManagementRoutePolicy', 'canUseBotManagementRoute']);
const songId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const input = { title: '노래', artist: '가수', youtubeUrl: 'https://youtu.be/abcdefghijk', keyShift: -2, difficulty: 4, tags: ['발라드', '한글'], privateNote: '비공개 연습 내용' };
const songRow = { id: songId, owner_user_id: 'owner', data: shared.normalizeSongbookSong(input), revision: 1 };
const requestRow = { id: requestId, owner_user_id: 'owner', viewer_user_id: 'viewer', song_id: songId, request_key: requestId, song: shared.publicSongbookSong({ ...songRow.data, id: songId }), username: '시청자', message: '', status: 'pending' };

function storeHarness(respond = () => undefined, config = { requests_enabled: true, per_user_limit: 2 }) {
  const calls = [];
  const pg = { query: jest.fn(async (sql, values = []) => {
    calls.push({ sql, values });
    const custom = await respond(sql, values);
    if (custom !== undefined) return custom;
    if (sql === 'select * from songbook_settings where owner_user_id=$1 for update') return { rows: [config] };
    if (sql === 'select * from songbook_settings where owner_user_id=$1') return { rows: [config] };
    if (sql === 'select * from songbook_songs where owner_user_id=$1 and id=$2') return { rows: [songRow] };
    if (sql === 'select display_name from app_users where id=$1') return { rows: [{ display_name: '실제 시청자' }] };
    if (sql.startsWith('insert into songbook_requests(')) return { rows: [{ ...requestRow, id: values[0], song: JSON.parse(values[5]), username: values[6], message: values[7] }] };
    if (sql.startsWith('select * from songbook_requests where owner_user_id=$1 and id=')) return { rows: [requestRow] };
    if (sql.startsWith('update songbook_requests set status=$3')) return { rows: [{ ...requestRow, status: values[2] }] };
    if (sql.startsWith('select count(*)')) return { rows: [{ total: '1' }] };
    if (sql.startsWith('select * from songbook_songs where')) return { rows: [songRow] };
    return { rows: [] };
  }) };
  const withPgClient = jest.fn(fn => fn(pg));
  const store = createSongbookStore({ withPgClient, ensureIdentityTables: async () => {} });
  return { store, calls, withPgClient };
}

describe('songbook inputs and privacy', () => {
  test.each(['abcdefghijk', 'https://youtu.be/abcdefghijk?t=1', 'https://www.youtube.com/watch?v=abcdefghijk&list=RD', 'https://music.youtube.com/watch?v=abcdefghijk', 'https://youtube.com/shorts/abcdefghijk'])('accepts video %s', value => expect(shared.songbookVideoId(value)).toBe('abcdefghijk'));
  test.each(['https://youtube.com.evil.test/watch?v=abcdefghijk', 'javascript:alert(1)', 'https://evil.test/watch?v=abcdefghijk', 'https://user@youtube.com/watch?v=abcdefghijk', 'https://youtube.com/playlist?list=123'])('rejects unsafe/non-video URL %s', value => expect(shared.songbookVideoId(value)).toBeNull());
  test('normalizes defaults, tags and public whitelist', () => {
    const data = shared.normalizeSongbookSong({ ...input, tags: ['Pop', 'pop'] });
    expect(data.tags).toEqual(['pop']);
    expect(data.visible).toBe(true);
    const publicData = shared.publicSongbookSong({ ...data, id: songId, ownerUserId: 'private-owner' });
    expect(publicData).not.toHaveProperty('privateNote');
    expect(publicData).not.toHaveProperty('ownerUserId');
    expect(publicData.youtubeUrl).toBe('https://www.youtube.com/watch?v=abcdefghijk');
    expect(publicData.thumbnailUrl).toContain('i.ytimg.com/vi/abcdefghijk');
  });
  test.each([{ title: '' }, { artist: '' }, { keyShift: 13 }, { keyShift: 1.5 }, { difficulty: 0 }, { difficulty: 6 }, { tags: ['a'.repeat(25)] }, { tags: Array(13).fill('x') }, { visible: 'false' }, { youtubeUrl: 'https://evil.test' }, { privateNote: 'x'.repeat(2001) }])('rejects malformed song %p', patch => expect(() => shared.normalizeSongbookSong({ ...input, ...patch })).toThrow());
  test('validates settings and bounded pagination', () => {
    expect(() => shared.normalizeSongbookSettings(null)).toThrow();
    expect(() => shared.normalizeSongbookSettings({ requestsEnabled: true, perUserLimit: 11 })).toThrow();
    expect(shared.normalizeSongbookQuery({ limit: 10000, page: 2 })).toMatchObject({ limit: 24, page: 2 });
    expect(() => shared.normalizeSongbookQuery({ search: ['bad'] })).toThrow();
  });
  test('songbook scope distinguishes read and write', () => {
    const manager = scopes => ({ role: 'manager', scopes });
    for (const [method, route] of [['POST', '/api/songbook/songs'], ['PATCH', '/api/songbook/settings'], ['DELETE', `/api/songbook/songs/${songId}`], ['PATCH', `/api/songbook/requests/${requestId}`]]) {
      const policy = botManagementRoutePolicy(method, route);
      expect(canUseBotManagementRoute(manager(['songbook:read']), policy)).toBe(false);
      expect(canUseBotManagementRoute(manager(['songbook:write']), policy)).toBe(true);
      expect(canUseBotManagementRoute(manager(['video:write']), policy)).toBe(false);
    }
    expect(canUseBotManagementRoute(manager(['songbook:read']), botManagementRoutePolicy('GET', '/api/songbook'))).toBe(true);
  });
});

describe('songbook transactional requests', () => {
  test('snapshots public fields, derives requester from account and locks owner', async () => {
    const h = storeHarness();
    const result = await h.store.requestSong('owner', 'viewer', { songId, requestKey: requestId, username: 'forged', message: '  부탁해요  ' });
    expect(result.username).toBe('실제 시청자');
    expect(result.message).toBe('부탁해요');
    expect(result.song).not.toHaveProperty('privateNote');
    expect(result).not.toHaveProperty('viewer_user_id');
    const lock = h.calls.findIndex(call => call.sql.endsWith('for update'));
    const insert = h.calls.findIndex(call => call.sql.startsWith('insert into songbook_requests('));
    expect(lock).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(lock);
    expect(h.withPgClient.mock.calls.every(args => args[1] === 0)).toBe(true);
    expect(h.calls.at(-1).sql).toBe('commit');
  });
  test('retries use original request even after closing applications', async () => {
    const h = storeHarness(sql => sql.includes('and request_key=$3') ? { rows: [requestRow] } : undefined, { requests_enabled: false, per_user_limit: 1 });
    expect((await h.store.requestSong('owner', 'viewer', { songId, requestKey: requestId })).id).toBe(requestId);
    expect(h.calls.some(call => call.sql.startsWith('insert into songbook_requests('))).toBe(false);
  });
  test.each([
    ['closed', () => undefined, { requests_enabled: false, per_user_limit: 1 }],
    ['hidden', sql => sql === 'select * from songbook_songs where owner_user_id=$1 and id=$2' ? { rows: [{ ...songRow, data: { ...songRow.data, visible: false } }] } : undefined, undefined],
    ['limit', sql => sql === "select * from songbook_requests where owner_user_id=$1 and status in ('pending','singing')" ? { rows: [{ ...requestRow, song_id: 'other' }, { ...requestRow, song_id: 'another' }] } : undefined, undefined],
    ['rate', sql => sql.includes("interval '10 seconds'") ? { rows: [{}] } : undefined, undefined],
  ])('rejects %s without partial insert', async (_label, responder, config) => {
    const h = storeHarness(responder, config);
    await expect(h.store.requestSong('owner', 'viewer', { songId, requestKey: requestId })).rejects.toHaveProperty('status');
    expect(h.calls.some(call => call.sql.startsWith('insert into songbook_requests('))).toBe(false);
    expect(h.calls.at(-1).sql).toBe('rollback');
  });
  test('active duplicates are idempotent', async () => {
    const h = storeHarness(sql => sql === "select * from songbook_requests where owner_user_id=$1 and status in ('pending','singing')" ? { rows: [requestRow] } : undefined);
    expect((await h.store.requestSong('owner', 'viewer', { songId, requestKey: randomUUID() })).id).toBe(requestId);
  });
  test('viewer cannot cancel someone else or start singing', async () => {
    const h = storeHarness();
    await expect(h.store.changeRequest('owner', requestId, 'cancelled', { viewerUserId: 'other' })).rejects.toMatchObject({ status: 404 });
    await expect(h.store.changeRequest('owner', requestId, 'singing', { viewerUserId: 'viewer' })).rejects.toMatchObject({ status: 409 });
    expect((await h.store.changeRequest('owner', requestId, 'cancelled', { viewerUserId: 'viewer' })).status).toBe('cancelled');
  });
  test('cannot start two singing requests or overwrite stale status', async () => {
    const h = storeHarness(sql => sql === "select 1 from songbook_requests where owner_user_id=$1 and status='singing'" ? { rows: [{}] } : undefined);
    await expect(h.store.changeRequest('owner', requestId, 'singing')).rejects.toMatchObject({ status: 409 });
    await expect(h.store.changeRequest('owner', requestId, 'cancelled', { expectedStatus: 'singing' })).rejects.toMatchObject({ status: 409 });
  });
  test('optimistic song updates refuse revision conflicts', async () => {
    const h = storeHarness();
    await expect(h.store.upsertSong('other', { ...input, id: songId, revision: 1 })).rejects.toMatchObject({ status: 409 });
    expect(h.calls.find(call => call.sql.startsWith('update songbook_songs')).values.slice(0, 2)).toEqual(['other', songId]);
  });
  test('deleting cancels pending requests and stays scoped to owner and revision', async () => {
    const h = storeHarness(sql => sql.startsWith('select id from songbook_songs') ? { rows: [{ id: songId }] } : undefined);
    await h.store.deleteSong('owner', songId, 1);
    expect(h.calls.find(call => call.sql.startsWith('select id from songbook_songs')).values).toEqual(['owner', songId, 1]);
    expect(h.calls.find(call => call.sql.startsWith('update songbook_requests')).sql).toContain("status='pending'");
    expect(h.calls.at(-1).sql).toBe('commit');
  });
  test('public catalog excludes hidden fields and escapes search wildcards', async () => {
    const h = storeHarness();
    const catalog = await h.store.listSongs('owner', { search: 'a%_!' }, { publicOnly: true });
    expect(catalog.songs[0]).not.toHaveProperty('privateNote');
    expect(catalog.songs[0]).not.toHaveProperty('revision');
    const select = h.calls.find(call => call.sql.startsWith('select * from songbook_songs where'));
    expect(select.sql).toContain("data->>'visible'");
    expect(select.values.slice(0, 2)).toEqual(['owner', '%a!%!_!!%']);
  });
});

describe('songbook chat requests share the website queue', () => {
  const chat = { provider: 'chzzk', userId: 'chat-user', username: '채팅 시청자' };
  test('unregistered chat viewer can request without creating an app account', async () => {
    const h = storeHarness(sql => sql.startsWith('select id,data from songbook_songs') ? { rows: [songRow] } : undefined);
    const result = await h.store.requestSongFromChat('owner', chat, '노래', requestId);
    expect(result.username).toBe(chat.username);
    const inserted = h.calls.find(call => call.sql.startsWith('insert into songbook_requests('));
    expect(inserted.values[2]).toBeNull();
    expect(inserted.values.slice(8)).toEqual(['chzzk', 'chat-user']);
    expect(result.song).not.toHaveProperty('privateNote');
    expect(h.calls.some(call => /(?:insert|update).*platform_accounts|insert into app_users/.test(call.sql))).toBe(false);
    expect(h.calls.at(-1).sql).toBe('commit');
  });
  test('linked chat user shares website per-user limit', async () => {
    const h = storeHarness(sql => {
      if (sql.startsWith('select id,data from songbook_songs')) return { rows: [songRow] };
      if (sql.startsWith('select distinct user_id from platform_accounts')) return { rows: [{ user_id: 'viewer' }] };
      if (sql === "select * from songbook_requests where owner_user_id=$1 and status in ('pending','singing')") return { rows: [{ ...requestRow, song_id: 'other' }] };
    }, { requests_enabled: true, per_user_limit: 1 });
    await expect(h.store.requestSongFromChat('owner', chat, '노래', requestId)).rejects.toMatchObject({ status: 409 });
    expect(h.calls.some(call => call.sql.startsWith('insert into songbook_requests('))).toBe(false);
  });
  test('redelivered chat event returns original receipt even after closing requests', async () => {
    const h = storeHarness(sql => sql.includes('and chat_user_id=$3 and request_key=$4') ? { rows: [requestRow] } : undefined, { requests_enabled: false, per_user_limit: 1 });
    await expect(h.store.requestSongFromChat('owner', chat, '노래', requestId)).resolves.toHaveProperty('id', requestId);
    expect(h.calls.some(call => call.sql.startsWith('insert into songbook_requests('))).toBe(false);
  });
  test('website limit counts earlier unlinked chat requests after account linking', async () => {
    const h = storeHarness(sql => {
      if (sql.startsWith('select provider,platform_user_id')) return { rows: [{ provider: 'chzzk', platform_user_id: 'chat-user' }] };
      if (sql === "select * from songbook_requests where owner_user_id=$1 and status in ('pending','singing')") return { rows: [{ ...requestRow, viewer_user_id: null, chat_provider: 'chzzk', chat_user_id: 'chat-user', song_id: 'other' }] };
    }, { requests_enabled: true, per_user_limit: 1 });
    await expect(h.store.requestSong('owner', 'viewer', { songId, requestKey: requestId })).rejects.toMatchObject({ status: 409 });
  });
  test.each(['', 'unknown_user', 'nickname:fake', 'bad id'])('rejects unstable chat identity %s', async userId => {
    const h = storeHarness();
    await expect(h.store.requestSongFromChat('owner', { ...chat, userId }, '노래', requestId)).rejects.toMatchObject({ status: 400 });
    expect(h.calls).toHaveLength(0);
  });
  test('same nickname from another provider is not the same viewer', async () => {
    const h = storeHarness(sql => {
      if (sql.startsWith('select id,data from songbook_songs')) return { rows: [songRow] };
      if (sql === "select * from songbook_requests where owner_user_id=$1 and status in ('pending','singing')") return { rows: [{ ...requestRow, viewer_user_id: null, chat_provider: 'youtube', chat_user_id: 'chat-user' }] };
    }, { requests_enabled: true, per_user_limit: 1 });
    await expect(h.store.requestSongFromChat('owner', chat, '노래', requestId)).resolves.toHaveProperty('id');
  });
  test('ambiguous matches never enqueue an arbitrary song', async () => {
    const h = storeHarness(sql => sql.startsWith('select id,data from songbook_songs') ? { rows: [songRow, { ...songRow, id: 'other', data: { ...songRow.data, artist: '다른 가수' } }] } : undefined);
    await expect(h.store.requestSongFromChat('owner', chat, '노래', requestId)).rejects.toMatchObject({ status: 409 });
    expect(h.calls.some(call => call.sql.startsWith('insert into songbook_requests('))).toBe(false);
  });
  test('website viewer can cancel linked earlier chat request, but not unrelated chats', async () => {
    const h = storeHarness(sql => {
      if (sql.startsWith('select * from songbook_requests where owner_user_id=$1 and id=')) return { rows: [{ ...requestRow, viewer_user_id: null }] };
      if (sql.startsWith('select id from songbook_requests')) return { rows: [{ id: requestId }] };
    });
    await expect(h.store.changeRequest('owner', requestId, 'cancelled', { viewerUserId: 'viewer' })).resolves.toHaveProperty('status', 'cancelled');
    expect(h.calls.find(call => call.sql.startsWith('select id from songbook_requests')).sql).toContain('a.user_id=$2');
  });
});

describe('songbook HTTP identity boundaries', () => {
  function routes() {
    const map = new Map();
    const app = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [method, (path, ...handlers) => map.set(`${method} ${path}`, handlers)]));
    const store = Object.fromEntries(['listSongs', 'upsertSong', 'deleteSong', 'updateSettings', 'listRequests', 'requestSong', 'changeRequest'].map(name => [name, jest.fn(async () => ({ items: [] }))]));
    const limiter = jest.fn();
    registerSongbookRoutes(app, { store, getAdminOwner: req => req.owner, getViewerUser: req => req.actor, normalizeUid: value => value === 'bad' ? null : value, resolveChannel: async () => ({ ownerUserId: 'channel-owner' }), getPublicPath: async () => '/c/chzzk%3Aid/songbook', writeLimiter: limiter, logger: { error: jest.fn() } });
    async function invoke(key, req = {}) {
      const res = { statusCode: 200, setHeader: jest.fn(), status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
      await map.get(key).at(-1)({ params: { uid: 'chzzk:id', id: requestId }, query: {}, ...req }, res);
      return res;
    }
    return { map, store, invoke, limiter };
  }
  test('admin owner and actual requesting viewer cannot be substituted by body', async () => {
    const h = routes();
    await h.invoke('post /api/songbook/songs', { owner: 'delegated-owner', actor: 'manager', body: input });
    expect(h.store.upsertSong).toHaveBeenCalledWith('delegated-owner', input);
    await h.invoke('post /api/viewer/songbook/:uid/requests', { actor: 'actual-viewer', owner: 'delegated-owner', body: { ownerUserId: 'attacker', viewerUserId: 'attacker' } });
    expect(h.store.requestSong.mock.calls[0].slice(0, 2)).toEqual(['channel-owner', 'actual-viewer']);
  });
  test('public browsing allows guests; submissions require login', async () => {
    const h = routes();
    expect((await h.invoke('get /api/public/:uid/songbook')).statusCode).toBe(200);
    expect(h.store.listSongs).toHaveBeenCalledWith('channel-owner', {}, { publicOnly: true });
    expect((await h.invoke('post /api/viewer/songbook/:uid/requests')).statusCode).toBe(401);
    expect((await h.invoke('get /api/songbook')).statusCode).toBe(401);
    expect((await h.invoke('get /api/public/:uid/songbook', { params: { uid: 'bad' } })).statusCode).toBe(400);
  });
  test('mutations all use write limiter; storage errors are not exposed', async () => {
    const h = routes();
    for (const [key, handlers] of h.map) if (!key.startsWith('get ')) expect(handlers[0]).toBe(h.limiter);
    h.store.listSongs.mockRejectedValue(new Error('private SQL details'));
    const res = await h.invoke('get /api/public/:uid/songbook');
    expect(res.statusCode).toBe(503);
    expect(res.body.error).not.toContain('SQL');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });
});
