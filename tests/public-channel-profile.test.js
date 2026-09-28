const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const loadServerFunctions = require('./helpers/load-server-functions.cjs');

const uid = 'chzzk:87b05833a7894176a9184afc5ba2af06';
const encoded = encodeURIComponent(uid);
const { parsePublicPointPolicyUid, normalizePublicChannelUid } = loadServerFunctions(
  ['parsePublicPointPolicyUid', 'normalizePublicChannelUid'],
  { PUBLIC_POINT_POLICY_UID_MAX_LENGTH: 160, PUBLIC_POINT_POLICY_UID_PATTERN: /^[A-Za-z0-9_-]{1,128}$/, PUBLIC_POINT_POLICY_PROVIDERS: new Set(['chzzk', 'cime', 'youtube']) },
);

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, setHeader: jest.fn() };
}
function harness() {
  const identity = { ownerUserId: 'private-owner-id', provider: 'chzzk', channelUid: uid.split(':')[1], displayName: '대표 닉네임', secret: 'never public' };
  const bindings = {
    parsePublicPointPolicyUid, normalizePublicChannelUid,
    resolveVerifiedPublicChannelIdentity: jest.fn().mockResolvedValue(identity),
    readRealtimeCached: jest.fn(async (_key, _options, load) => load()),
    loadVerifiedPublicLiveInfo: jest.fn().mockResolvedValue({ live: true, channel: '', title: '오늘의 방송 제목' }),
    getBotRules: jest.fn().mockResolvedValue([]), toPublicCommandRule: jest.fn(),
    getPublicBotSettingsStrict: jest.fn().mockResolvedValue({ rouletteDefs: [] }),
    loadVerifiedPublicPointsSnapshot: jest.fn().mockResolvedValue({ rows: [], total: 0, totalPoints: 0, ownerUserId: 'private-owner-id' }),
    loadPublicPointEarningPolicy: jest.fn().mockResolvedValue(null),
  };
  return { ...bindings, identity, route: (name) => loadServerFunctions.route(`/api/public/:uid/${name}`, bindings) };
}

describe('public channel identity and nickname', () => {
  test.each([uid, encoded, encodeURIComponent(encoded)])('normalizes %s before shared cache and ownership lookup', async (input) => {
    const h = harness();
    expect(normalizePublicChannelUid(input)).toBe(uid);
    for (const kind of ['live', 'rules', 'points', 'roulette-defs']) {
      const res = response(); await h.route(kind)({ params: { uid: input }, query: {} }, res);
      expect(res.statusCode).toBe(200);
      expect(h.resolveVerifiedPublicChannelIdentity).toHaveBeenLastCalledWith(uid);
    }
    expect(h.readRealtimeCached.mock.calls.every(([key]) => key.includes(uid) && !key.includes('%'))).toBe(true);
  });

  test.each(['%', 'chzzk%ZZtest', 'chzzk%253Atest%252Fpoints', 'user%253Aprivate-owner', 'unknown%3Aid', 'a'.repeat(161)])('rejects invalid or private identifiers before database access: %s', async (input) => {
    const h = harness();
    for (const kind of ['profile', 'live', 'rules', 'points', 'roulette-defs']) {
      const res = response(); await h.route(kind)({ params: { uid: input }, query: {} }, res);
      expect(res.statusCode).toBe(400);
    }
    expect(h.resolveVerifiedPublicChannelIdentity).not.toHaveBeenCalled();
    expect(h.readRealtimeCached).not.toHaveBeenCalled();
  });

  test('profile exposes only the nickname and public identity without any upstream live lookup', async () => {
    const h = harness(), res = response();
    await h.route('profile')({ params: { uid: encoded } }, res);
    expect(res.body).toEqual({ uid, provider: 'chzzk', displayName: '대표 닉네임' });
    expect(h.loadVerifiedPublicLiveInfo).not.toHaveBeenCalled();
  });

  test('live metadata includes the representative name while retaining the broadcast title separately', async () => {
    const h = harness(), res = response();
    await h.route('live')({ params: { uid: encoded } }, res);
    expect(res.body).toMatchObject({ live: true, channelName: '대표 닉네임', title: '오늘의 방송 제목' });
    expect(res.body.ownerUserId).toBeUndefined(); expect(res.body.secret).toBeUndefined();
  });

  test('missing and unavailable identities are not replaced with an unrelated streamer', async () => {
    const h = harness(); h.resolveVerifiedPublicChannelIdentity.mockResolvedValue(null);
    const missing = response(); await h.route('profile')({ params: { uid } }, missing); expect(missing.statusCode).toBe(404);
    h.resolveVerifiedPublicChannelIdentity.mockRejectedValue(new Error('unavailable'));
    const unavailable = response(); await h.route('profile')({ params: { uid } }, unavailable); expect(unavailable.statusCode).toBe(503);
  });

  test('stored representative name wins, falling back only to the verified platform channel name', async () => {
    const file = path.join(__dirname, '../server/supabase.js');
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'readPublicChannelDisplayNameWithClient');
    const readName = new Function(`${declaration.getText(source)}; return readPublicChannelDisplayNameWithClient;`)();
    const pg = { query: jest.fn().mockResolvedValue({ rows: [{ display_name: ' 대표 닉네임 ', channel_name: '플랫폼 이름' }] }) };
    const identity = { ownerUserId: 'owner', provider: 'chzzk', channelUid: 'public-channel' };
    expect(await readName(pg, identity)).toBe('대표 닉네임');
    expect(pg.query.mock.calls[0][1]).toEqual(['owner', 'chzzk', 'public-channel']);
    expect(pg.query.mock.calls[0][0]).toContain('pa.user_id = u.id and pa.provider = $2');
    pg.query.mockResolvedValue({ rows: [{ display_name: ' ', channel_name: '플랫폼 이름' }] });
    expect(await readName(pg, identity)).toBe('플랫폼 이름');
    pg.query.mockResolvedValue({ rows: [] }); expect(await readName(pg, identity)).toBeNull();
  });
});
