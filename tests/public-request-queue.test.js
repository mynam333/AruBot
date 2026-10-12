const loadSource = require('./helpers/load-source.cjs');
const loadServerFunctions = require('./helpers/load-server-functions.cjs');
const { createPvdQueueDisplay } = loadSource('server/pvd-queue-display.js');
const { normalizePublicChannelUid } = loadServerFunctions(['parsePublicPointPolicyUid', 'normalizePublicChannelUid'], {
  PUBLIC_POINT_POLICY_UID_MAX_LENGTH: 180,
  PUBLIC_POINT_POLICY_PROVIDERS: new Set(['chzzk', 'cime', 'youtube']),
  PUBLIC_POINT_POLICY_UID_PATTERN: /^[a-z0-9_-]{1,128}$/i,
});
const makeItem = (id, extra = {}) => ({ id, title: 'Requested video', username: 'Viewer', mediaProvider: 'youtube', mediaId: 'S7-Lw14P5sQ', durationSec: 83, startSec: 60, ...extra });
const snapshot = (items) => ({ currentItem: makeItem('current'), waitingItems: items, status: 'playing', elapsedSec: 10, serverNow: 12345 });

test('public detail contains canonical source link and requested duration, not original full length', () => {
  const raw = makeItem('current', { mediaDurationSec: 999, mediaUrl: 'https://youtube.com/watch?v=S7-Lw14P5sQ&secret=private', embedUrl: 'private', userId: 'private', cost: 999, token: 'private' });
  const result = createPvdQueueDisplay({ ...snapshot([]), currentItem: raw }, { includeDetails: true });
  expect(result.currentItem).toMatchObject({ watchUrl: 'https://www.youtube.com/watch?v=S7-Lw14P5sQ&t=60s', durationSec: 83, startSec: 60, provider: 'youtube', username: 'Viewer' });
  expect(JSON.stringify(result)).not.toContain('private');
  expect(result.currentItem).not.toHaveProperty('mediaDurationSec');
  expect(result.currentItem).not.toHaveProperty('cost');
});

test.each([
  [{ mediaProvider: 'chzzk_clip', mediaId: 'clip-1' }, 'https://chzzk.naver.com/clips/clip-1'],
  [{ mediaProvider: 'cime_clip', mediaId: '123' }, 'https://ci.me/clips/123'],
  [{ mediaProvider: 'tiktok', mediaId: '123', mediaUrl: 'https://www.tiktok.com/@creator/video/123?token=private#private' }, 'https://www.tiktok.com/@creator/video/123'],
  [{ mediaProvider: 'tiktok', mediaId: '123', mediaUrl: 'https://www.tiktok.com.evil.test/@creator/video/123' }, null],
  [{ mediaProvider: 'tiktok', mediaId: '123', mediaUrl: 'https://www.tiktok.com/@creator/video/456' }, null],
  [{ mediaProvider: 'youtube', mediaId: 'javascript:alert(1)', mediaUrl: 'javascript:alert(1)' }, null],
  [{ mediaProvider: 'cime_clip', mediaId: '../private' }, null],
])('watch links do not expose raw/untrusted playback URLs: %j', (extra, expected) => {
  const result = createPvdQueueDisplay({ currentItem: makeItem('x', extra) }, { includeDetails: true });
  expect(result.currentItem.watchUrl).toBe(expected);
});

test('public pagination covers the complete queue and clamps after removals', () => {
  const items = Array.from({ length: 125 }, (_, index) => makeItem(`item-${index}`));
  const tail = createPvdQueueDisplay(snapshot(items), { includeDetails: true, offset: 120, limit: 20 });
  expect(tail.waitingItems.map((item) => item.id)).toEqual(['item-120', 'item-121', 'item-122', 'item-123', 'item-124']);
  expect(tail).toMatchObject({ waitingCount: 125, offset: 120, limit: 20 });
  expect(createPvdQueueDisplay(snapshot(items.slice(0, 21)), { includeDetails: true, offset: 120, limit: 20 })).toMatchObject({ offset: 20, waitingCount: 21 });
  expect(createPvdQueueDisplay(snapshot([]), { includeDetails: true, offset: 120, limit: 20 })).toMatchObject({ offset: 0, waitingCount: 0 });
  expect(items).toHaveLength(125);
});

function harness({ identity = { ownerUserId: 'owner' }, error = null } = {}) {
  const resolveIdentity = jest.fn(async () => { if (error) throw error; return identity; });
  const getSnapshot = jest.fn(async () => snapshot(Array.from({ length: 21 }, (_, i) => makeItem(`item-${i}`))));
  const cached = jest.fn(async (_key, _options, loader) => loader());
  const route = loadServerFunctions.route('/api/public/:uid/requests', {
    normalizePublicChannelUid, resolveVerifiedPublicChannelIdentity: resolveIdentity,
    readRealtimeCached: cached, getPvdQueueSnapshot: getSnapshot,
    pvdPlaybackState: new Map(), createPvdQueueDisplay,
  });
  const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  return { route, res, resolveIdentity, getSnapshot, cached };
}

test.each(['chzzk:abc', 'chzzk%3Aabc', 'chzzk%253Aabc'])('public page resolves the streamer independently of the visitor: %s', async uid => {
  const h = harness();
  await h.route({ params: { uid }, query: { offset: '20' }, session: { userId: 'visitor' } }, h.res);
  expect(h.resolveIdentity).toHaveBeenCalledWith('chzzk:abc');
  expect(h.getSnapshot).toHaveBeenCalledWith('user:owner', 'public_sync');
  expect(h.res.code).toBe(200);
  expect(h.res.body.waitingItems[0].id).toBe('item-20');
  expect(h.res.headers['Cache-Control']).toBe('no-store');
  expect(h.cached.mock.calls[0][0]).toBe('public:requests:user:owner');
  expect(JSON.stringify(h.res.body)).not.toContain('user:owner');
});

test.each(['user:private', '../abc', 'chzzk%253Aabc%252Fprivate'])('invalid channel does not query the queue: %s', async uid => {
  const h = harness();
  await h.route({ params: { uid }, query: {} }, h.res);
  expect(h.res.code).toBe(400);
  expect(h.resolveIdentity).not.toHaveBeenCalled();
});

test.each(['-1', '1.5', 'Infinity', '100001', 'bad'])('invalid pagination is rejected: %s', async offset => {
  const h = harness();
  await h.route({ params: { uid: 'chzzk:abc' }, query: { offset } }, h.res);
  expect(h.res.code).toBe(400);
  expect(h.getSnapshot).not.toHaveBeenCalled();
});

test.each([[{ identity: null }, 404], [{ error: new Error('database unavailable') }, 503]])('unknown/failed identity never falls back to another queue', async (options, code) => {
  const h = harness(options);
  await h.route({ params: { uid: 'chzzk:abc' }, query: {} }, h.res);
  expect(h.res.code).toBe(code);
  expect(h.getSnapshot).not.toHaveBeenCalled();
});
