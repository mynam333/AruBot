const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const loadServerFunctions = require('./helpers/load-server-functions.cjs');
const { assertBotManagerEffects, mergeBotManagerSettings, filterBotManagerSettings } = require('./helpers/load-source.cjs')('shared/bot-management-policy.js');
const { normalizePointAward } = require('./helpers/load-source.cjs')('server/point-earning-policy.js');
const { normalizeChzzkVideoDonationSettings } = require('./helpers/load-source.cjs')('server/chzzk-video-donation.js');
const { getPvdBgmSettings } = require('./helpers/load-source.cjs')('server/pvd-bgm.js');

const source = ts.createSourceFile('supabase.js', fs.readFileSync(path.join(__dirname, '../server/supabase.js'), 'utf8'), ts.ScriptTarget.Latest, true);
const names = ['setBotSettings', 'patchBotSettings', 'updateBotSettingsAtomically'];
const declarations = names.map((name) => source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(source).replace(/^export /, '')).join('\n');
const clone = (value) => JSON.parse(JSON.stringify(value));
const sid = 'user:owner';

// Run only extracted production functions against a serialized in-memory SQL stub.
function harness(initial = {}, extra = {}) {
  let state = clone(initial);
  let tail = Promise.resolve();
  const queries = [];
  const withPgClient = jest.fn((callback) => {
    const run = tail.then(async () => {
      let pending = clone(state);
      return callback({ query: async (sql, params) => {
        queries.push({ sql, params });
        if (sql.startsWith('select settings')) return { rows: [{ settings: clone(state) }] };
        if (sql.startsWith('update bot_settings')) pending = JSON.parse(params[1]);
        if (sql === 'commit') state = pending;
        return { rows: [] };
      } });
    });
    tail = run.catch(() => undefined);
    return run;
  });
  const functions = new Function('ensure', 'withPgClient', `${declarations}; return {${names.join(',')}};`)(() => {}, withPgClient);
  const bindings = {
    ...functions,
    getPartitionId: async () => sid,
    getBotSettings: jest.fn(async () => clone(initial)),
    getBotSettingsStrict: jest.fn(async () => clone(state)),
    normalizeDrawingDonationSettings: (value) => value,
    normalizeDonationRuleForStorage: (value) => ({ ...value }),
    assertBotManagerEffects,
    mergeBotManagerSettings,
    filterBotManagerSettings,
    normalizePointAward,
    normalizeRouletteDefinition: (value) => value,
    normalizeBlockedBotUsers: (value) => value || [],
    buildBotUserBlockKeys: (value) => new Set([value.toLowerCase()]),
    normalizePvdVolume: Number,
    normalizeChzzkVideoDonationSettings,
    chzzkVideoRuntime: { configure: jest.fn() },
    getChzzkVideoDonationPublicSettings: (_sid, settings) => {
      const config = normalizeChzzkVideoDonationSettings(settings);
      return { pauseEnabled: config.pauseEnabled, queueEnabled: config.queueEnabled, configured: Boolean(config.overlayUrl) };
    },
    normalizePvdProviders: (value) => value || [],
    normalizePvdIdlePlaylist: (value) => value || {},
    getPvdIdlePlaylistForViewer: (value) => value,
    broadcastPvdControl: jest.fn(async () => ({})),
    broadcastPvdStart: jest.fn(async () => undefined),
    notifyDrawingSubscribers: jest.fn(async () => undefined),
    notifyDrawingAdminSubscribers: jest.fn(async () => undefined),
    invalidatePublicPointPolicyCache: jest.fn(),
    markRuntimeConfigurationChanged: () => 1,
    macroCache: new Map(),
    pvdPlaybackState: new Map(),
    pvdTokenToSid: new Map(),
    rouletteTokenToSid: new Map(),
    drawingTokenToSid: new Map(),
    drawingOverlaySockets: new Map(),
    drawingTokenFromSid: jest.fn(() => 'draw_created'),
    pvdRandomToken: () => 'random',
    rouletteRandomToken: () => 'roulette_random',
    ownerUserIdFromSid: () => null,
    resolveStreamerUidForSid: async () => 'channel',
    getOrCreateViewerTokenSupabase: async () => null,
    pvdDeterministicTokenFromUid: () => null,
    console: { error: jest.fn(), warn: jest.fn() },
    ...extra,
  };
  return {
    ...functions, bindings, queries, withPgClient,
    read: () => clone(state),
    async run(url, body = {}, method = 'post', params = {}, botManagement) {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
      await loadServerFunctions.route(url, bindings, method)({ body, params, query: {}, botManagement }, res);
      return res;
    },
  };
}

test.each([false, true])('saving BGM settings preserves idle wait unless its playlist is disabled (%s)', async disableIdle => {
  const activate = jest.fn(async () => ({}));
  const h = harness({ videoDonationIdlePlaylist: { enabled: false }, bgmEnabled: true, bgmIdlePlaylist: { enabled: true } }, {
    pvdPlaybackState: new Map([[sid, { idleDeferred: true }]]),
    getVideoQueue: () => [{ id: 'bgm-1', kind: 'bgm' }],
    getPvdBgmViewerSettings: settings => ({ ...getPvdBgmSettings(settings), idlePlaylist: { ...settings.bgmIdlePlaylist, enabled: getPvdBgmSettings(settings).enabled && settings.bgmIdlePlaylist?.enabled === true } }),
    activateDeferredPvdPlayback: activate,
  });
  const body = disableIdle ? { bgm: { idlePlaylist: { enabled: false } } } : { volume: 20 };
  expect((await h.run('/api/video-donation/settings', body)).statusCode).toBe(200);
  expect(activate).toHaveBeenCalledTimes(disableIdle ? 1 : 0);
});

test('partial patches merge the latest locked row and do not retry transactions', async () => {
  const h = harness({ botEnabled: true, drawingDonationViewerToken: 'old' });
  await Promise.all([
    h.patchBotSettings(sid, { botEnabled: false, drawingDonationViewerToken: 'rotated' }),
    h.patchBotSettings(sid, { videoDonationVolume: 2 }),
  ]);
  expect(h.read()).toEqual({ botEnabled: false, drawingDonationViewerToken: 'rotated', videoDonationVolume: 2 });
  expect(h.queries.map(({ sql }) => sql)).toEqual([
    'begin', expect.stringContaining('on conflict'), expect.stringContaining('for update'), expect.stringContaining('update bot_settings'), 'commit',
    'begin', expect.stringContaining('on conflict'), expect.stringContaining('for update'), expect.stringContaining('update bot_settings'), 'commit',
  ]);
  expect(h.withPgClient).toHaveBeenCalledWith(expect.any(Function), 0);
});

test('drawing settings cannot restore stale owner-only settings or rotated credentials', async () => {
  const h = harness({ botEnabled: true, drawingDonationViewerToken: 'old' });
  await h.patchBotSettings(sid, { botEnabled: false, drawingDonationViewerToken: 'rotated' });
  expect((await h.run('/api/drawing-donation/settings', { enabled: true })).statusCode).toBe(200);
  expect(h.read()).toEqual({ botEnabled: false, drawingDonationViewerToken: 'rotated', drawingDonation: { enabled: true } });
  expect(h.bindings.getBotSettings).not.toHaveBeenCalled();
});

test.each([
  ['macros', '/api/macros/upsert', (id) => ({ macro: { id, message: id, intervalSec: 5 } })],
  ['donationRules', '/api/donation/rules/upsert', (id) => ({ rule: { id, enabled: true } })],
  ['rouletteDefs', '/api/roulette/definitions/upsert', (id) => ({ definition: { id, name: id, items: [{}, {}] } })],
  ['blockedBotUsers', '/api/bot/blocked-users', (id) => ({ userId: id })],
])('%s inserts retain concurrent entries and unrelated owner settings', async (key, url, body) => {
  const h = harness({ botEnabled: false, drawingDonationViewerToken: 'rotated', [key]: [] });
  const results = await Promise.all([h.run(url, body('first')), h.run(url, body('second'))]);
  expect(results.map((res) => res.statusCode)).toEqual([200, 200]);
  expect(h.read()[key]).toHaveLength(2);
  expect(h.read()).toMatchObject({ botEnabled: false, drawingDonationViewerToken: 'rotated' });
  expect(h.bindings.getBotSettings).not.toHaveBeenCalled();
});

test.each([
  ['macros', '/api/macros/delete', 'post', { id: 'remove' }, {}],
  ['donationRules', '/api/donation/rules/delete', 'post', { id: 'remove' }, {}],
  ['rouletteDefs', '/api/roulette/definitions/delete', 'post', { id: 'remove' }, {}],
  ['blockedBotUsers', '/api/bot/blocked-users/:userId', 'delete', {}, { userId: 'remove' }],
])('%s deletes operate on the latest array', async (key, url, method, body, params) => {
  const removed = { id: 'remove', userId: 'remove', name: 'remove' };
  const kept = { id: 'keep', userId: 'keep', name: 'keep' };
  const h = harness({ [key]: [removed] });
  await h.patchBotSettings(sid, { [key]: [removed, kept], botEnabled: false });
  expect((await h.run(url, body, method, params)).statusCode).toBe(200);
  expect(h.read()).toEqual({ [key]: [kept], botEnabled: false });
});

test('donation rule partial changes merge the latest item, not an earlier snapshot', async () => {
  const h = harness({ donationRules: [{ id: 'rule', response: 'stale' }] });
  await h.patchBotSettings(sid, { donationRules: [{ id: 'rule', response: 'latest' }] });
  const res = await h.run('/api/donation/rules/upsert', { rule: { id: 'rule', enabled: true } });
  expect(res.body.rule).toEqual({ id: 'rule', response: 'latest', enabled: true });
});

test('donation settings preserve other properties of the latest nested object', async () => {
  const h = harness({ donation: { mode: 'old' } });
  await h.patchBotSettings(sid, { donation: { mode: 'latest' } });
  expect((await h.run('/api/donation/settings', { settings: { pointsPerK: 30 } })).body.settings).toEqual({ mode: 'latest', pointsPerK: 30 });
});

test('donation rule effect authorization rechecks the locked merged row after a concurrent edit', async () => {
  const access = { role: 'manager', scopes: ['donations:write'] };
  const original = { id: 'rule', enabled: false, responses: ['safe'] };
  const incoming = { id: 'rule', enabled: true };
  const h = harness({ donationRules: [original] });
  expect(() => assertBotManagerEffects({ ...original, ...incoming }, access)).not.toThrow();
  const latest = { ...original, responses: ['${action::owner-blueprint}'] };
  await h.patchBotSettings(sid, { donationRules: [latest] });
  const res = await h.run('/api/donation/rules/upsert', { rule: incoming }, 'post', {}, access);
  expect(res.statusCode).toBe(403);
  expect(res.body).toEqual({ error: expect.any(String), code: 'bot_effect_scope_required' });
  expect(h.read().donationRules).toEqual([latest]);
  expect(h.queries.at(-1).sql).toBe('rollback');
});

test.each([
  { role: 'manager', scopes: ['donations:write', 'actions:write'] },
  { role: 'manager', scopes: ['*'] },
  { role: 'owner', scopes: ['*'] },
])('authorized donation effect updates remain supported: %j', async (access) => {
  const original = { id: 'rule', enabled: false, responses: ['${action::owner-blueprint}'] };
  const h = harness({ donationRules: [original] });
  const res = await h.run('/api/donation/rules/upsert', { rule: { id: 'rule', enabled: true } }, 'post', {}, access);
  expect(res.statusCode).toBe(200);
  expect(h.read().donationRules).toEqual([{ ...original, enabled: true }]);
});

test('unexpected donation save failures keep their generic 500 response', async () => {
  const h = harness({}, { updateBotSettingsAtomically: async () => { throw new Error('private database detail'); } });
  const res = await h.run('/api/donation/rules/upsert', { rule: { id: 'rule' } });
  expect(res.statusCode).toBe(500);
  expect(res.body).toEqual({ error: 'failed' });
});

test('omitted video settings and BGM fields use the locked settings', async () => {
  const h = harness({ bgmPointsPerSecond: 1 });
  await h.patchBotSettings(sid, { botEnabled: false, bgmPointsPerSecond: 12, videoDonationProviders: ['youtube'] });
  expect((await h.run('/api/video-donation/settings', { volume: 4 })).statusCode).toBe(200);
  expect(h.read()).toMatchObject({ botEnabled: false, bgmPointsPerSecond: 12, videoDonationProviders: ['youtube'], videoDonationVolume: 4 });
});

test('invalid settings roll back without overwriting current settings', async () => {
  const h = harness({ bgmEnabled: false });
  await h.patchBotSettings(sid, { bgmEnabled: true });
  const before = h.read();
  const res = await h.run('/api/video-donation/settings', { idlePlaylist: { enabled: true } });
  expect(res.statusCode).toBe(400);
  expect(h.read()).toEqual(before);
  expect(h.queries.at(-1).sql).toBe('rollback');
});

test('CHZZK video toggles share atomic settings and omit the stored secret from the response', async () => {
  const url = 'https://chzzk.naver.com/video-donation/video@private-alert-key';
  const h = harness({ videoDonationChzzkOverlaySecret: url, videoDonationChzzkPauseEnabled: true, videoDonationChzzkQueueEnabled: false });
  const res = await h.run('/api/video-donation/settings', { chzzkVideoDonation: { queueEnabled: true } });
  expect(res.statusCode).toBe(200);
  expect(h.read()).toMatchObject({ videoDonationChzzkOverlaySecret: url, videoDonationChzzkPauseEnabled: true, videoDonationChzzkQueueEnabled: true });
  expect(res.body.chzzkVideoDonation).toEqual({ configured: true, pauseEnabled: true, queueEnabled: true });
  expect(JSON.stringify(res.body)).not.toContain('private-alert-key');
  expect(h.bindings.chzzkVideoRuntime.configure).toHaveBeenCalledWith(sid, h.read());
});

test.each([
  { pauseEnabled: true },
  { queueEnabled: true, overlayUrl: 'https://example.com/video-donation/video@secret' },
  { overlayUrl: 'http://127.0.0.1/private' },
])('invalid CHZZK configuration is rejected before saving: %j', async (config) => {
  const h = harness({ botEnabled: true });
  const res = await h.run('/api/video-donation/settings', { chzzkVideoDonation: config });
  expect(res.statusCode).toBe(400);
  expect(h.read()).toEqual({ botEnabled: true });
  expect(h.bindings.chzzkVideoRuntime.configure).not.toHaveBeenCalled();
});

test('explicit CHZZK URL deletion disables both options without touching other settings', async () => {
  const h = harness({ videoDonationChzzkOverlaySecret: 'https://chzzk.naver.com/video-donation/video@secret', videoDonationChzzkPauseEnabled: true, songbook: { enabled: true } });
  const res = await h.run('/api/video-donation/settings', { chzzkVideoDonation: { overlayUrl: '', pauseEnabled: false, queueEnabled: false } });
  expect(res.statusCode).toBe(200);
  expect(h.read()).toMatchObject({ videoDonationChzzkOverlaySecret: '', videoDonationChzzkPauseEnabled: false, videoDonationChzzkQueueEnabled: false, songbook: { enabled: true } });
});

test('settings lookup failure cannot disable an active CHZZK connection', async () => {
  const h = harness({}, { getBotSettingsStrict: jest.fn(async () => { throw new Error('database unavailable'); }) });
  const res = await h.run('/api/video-donation/settings', {}, 'get');
  expect(res.statusCode).toBe(500);
  const { getPvdViewerSettingsForSid } = loadServerFunctions(['getPvdViewerSettingsForSid'], h.bindings);
  await expect(getPvdViewerSettingsForSid(sid)).rejects.toThrow('database unavailable');
  const nowPlaying = loadServerFunctions.route('/api/video-donation/now-playing', {
    ...h.bindings, pvdTokenToSid: new Map([['viewer-token', sid]]),
  }, 'get');
  await nowPlaying({ query: { token: 'viewer-token' } }, {
    status(code) { expect(code).toBe(500); return this; }, json() {},
  });
  expect(h.bindings.chzzkVideoRuntime.configure).not.toHaveBeenCalled();
  expect(h.bindings.getBotSettings).not.toHaveBeenCalled();
});

test.each([
  ['/api/video-donation/viewer-url', 'videoDonationViewerToken'],
  ['/api/roulette/viewer-url', 'rouletteViewerToken'],
])('%s does not restore a token rotated after the initial read', async (url, key) => {
  const h = harness({ [key]: 'old' });
  h.bindings.getOrCreateViewerTokenSupabase = async () => {
    await h.patchBotSettings(sid, { [key]: 'rotated', botEnabled: false });
    return 'old';
  };
  const res = await h.run(url, {}, 'get');
  expect(res.statusCode).toBe(200);
  expect(res.body.token).toBe('rotated');
  expect(h.read()).toEqual({ [key]: 'rotated', botEnabled: false });
});

test('drawing token initialization is single-winner and respects rotation', async () => {
  const h = harness({ botEnabled: false });
  const results = await Promise.all([h.run('/api/drawing-donation/viewer-url', {}, 'get'), h.run('/api/drawing-donation/viewer-url', {}, 'get')]);
  expect(results.map((res) => res.body.token)).toEqual(['draw_created', 'draw_created']);
  expect(h.bindings.drawingTokenFromSid).toHaveBeenCalledTimes(1);
  expect((await h.run('/api/drawing-donation/rotate-viewer-token')).body.token).toBe('draw_random');
  expect((await h.run('/api/drawing-donation/viewer-url', {}, 'get')).body.token).toBe('draw_random');
  expect(h.read()).toEqual({ botEnabled: false, drawingDonationViewerToken: 'draw_random' });
  expect(h.bindings.drawingTokenToSid.has('draw_created')).toBe(false);
});

test('all feature handlers including owner settings avoid whole-settings replacement', () => {
  const server = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  expect(server).not.toMatch(/\bsetBotSettings\(/);
});

const savedSettings = {
  botEnabled: true,
  rouletteDefs: [{ id: 'roulette', name: 'Saved wheel', items: [{ label: 'Keep' }, { label: 'Both' }] }],
  donationRules: [{ id: 'donation', responses: ['Saved response'] }],
  donation: { pointsPerK: 25 },
  videoDonationEnabled: true,
  videoDonationVolume: 4,
  videoDonationViewerToken: 'keep-overlay-token',
  bgmEnabled: true,
  bgmPointsPerSecond: 5,
  drawingDonation: { enabled: true, pointsCost: 100 },
  macros: [{ id: 'macro', message: 'Saved announcement' }],
};

test.each([undefined, { role: 'owner' }, { role: 'site_admin' }, { role: 'manager', scopes: ['commands:write', 'points:write'] }])(
  'attendance and point saves preserve every unrelated setting for %j', async (access) => {
    const h = harness(savedSettings);
    const attendance = { attendanceEnabled: false, attendanceMessage: 'Custom attendance', channelPointsPerAttendance: 20 };
    const points = { channelPointsPerChat: 7, channelPointsExcludeUserIdsText: 'excluded-viewer' };
    expect((await h.run('/api/bot/settings', { settings: attendance }, 'post', {}, access)).statusCode).toBe(200);
    expect((await h.run('/api/bot/settings', { settings: points }, 'post', {}, access)).statusCode).toBe(200);
    expect(h.read()).toEqual({ ...savedSettings, ...attendance, ...points });
    expect(h.bindings.getBotSettings).not.toHaveBeenCalled();
  },
);

test('concurrent attendance, point, roulette, and video saves all survive', async () => {
  const h = harness(savedSettings);
  const responses = await Promise.all([
    h.run('/api/bot/settings', { settings: { attendanceEnabled: false } }),
    h.run('/api/roulette/definitions/upsert', { definition: { id: 'second', name: 'Second', items: [{}, {}] } }),
    h.run('/api/bot/settings', { settings: { channelPointsPerChat: 3 } }),
    h.run('/api/video-donation/settings', { volume: 2 }),
  ]);
  expect(responses.map((res) => res.statusCode)).toEqual([200, 200, 200, 200]);
  expect(h.read()).toMatchObject({
    ...savedSettings, attendanceEnabled: false, channelPointsPerChat: 3, videoDonationVolume: 2,
    rouletteDefs: [...savedSettings.rouletteDefs, expect.objectContaining({ id: 'second' })],
  });
});

test('empty patches are harmless, while explicit false, zero, and array clearing still work', async () => {
  const h = harness(savedSettings);
  expect((await h.run('/api/bot/settings', { settings: {} })).statusCode).toBe(200);
  expect(h.read()).toEqual(savedSettings);
  const patch = { botEnabled: false, channelPointsPerChat: 0, rouletteDefs: [] };
  expect((await h.run('/api/bot/settings', { settings: patch })).statusCode).toBe(200);
  expect(h.read()).toEqual({ ...savedSettings, ...patch });
});

test('legacy setting writes also merge rather than replace the stored configuration', async () => {
  const h = harness(savedSettings);
  await h.setBotSettings(sid, { channelPointsPerChat: 10 });
  expect(h.read()).toEqual({ ...savedSettings, channelPointsPerChat: 10 });
});

test.each([null, undefined, [], 'invalid', false])('invalid settings patches cannot wipe storage: %j', async (settings) => {
  const h = harness(savedSettings);
  expect((await h.run('/api/bot/settings', { settings })).statusCode).toBe(400);
  await expect(h.patchBotSettings(sid, settings)).rejects.toThrow('Invalid bot settings patch');
  expect(h.read()).toEqual(savedSettings);
  expect(h.queries).toEqual([]);
});

test.each([null, undefined, [], 'invalid', false])('invalid updater results roll back: %j', async (next) => {
  const h = harness(savedSettings);
  await expect(h.updateBotSettingsAtomically(sid, () => next)).rejects.toThrow('Invalid bot settings update');
  expect(h.read()).toEqual(savedSettings);
  expect(h.queries.at(-1).sql).toBe('rollback');
  expect(h.queries.some(({ sql }) => sql.startsWith('update bot_settings'))).toBe(false);
});

test.each([[], 'corrupt', false])('malformed existing settings are not replaced with defaults: %j', async (stored) => {
  const h = harness(stored);
  await expect(h.patchBotSettings(sid, { botEnabled: true })).rejects.toThrow('Invalid stored bot settings');
  expect(h.read()).toEqual(stored);
  expect(h.queries.at(-1).sql).toBe('rollback');
});

test('failed DB writes never announce success or invalidate runtime settings', async () => {
  const h = harness(savedSettings);
  h.withPgClient.mockRejectedValueOnce(new Error('database unavailable'));
  const res = await h.run('/api/bot/settings', { settings: { attendanceEnabled: false } });
  expect(res.statusCode).toBe(500);
  expect(h.read()).toEqual(savedSettings);
  expect(h.bindings.invalidatePublicPointPolicyCache).not.toHaveBeenCalled();
});

test('restricted managers still cannot change another feature through generic settings', async () => {
  const h = harness(savedSettings);
  const res = await h.run('/api/bot/settings', { settings: { attendanceEnabled: false, rouletteDefs: [] } }, 'post', {}, { role: 'manager', scopes: ['commands:write'] });
  expect(res.statusCode).toBe(403);
  expect(res.body.code).toBe('bot_scope_required');
  expect(h.read()).toEqual(savedSettings);
});

test.each([
  '/api/bot/settings', '/api/donation/settings', '/api/donation/rules', '/api/roulette/definitions',
  '/api/video-donation/settings', '/api/drawing-donation/settings', '/api/macros', '/api/channelpoints/list',
])('%s does not report empty/default settings during a DB outage', async (url) => {
  const h = harness(savedSettings, { getBotSettingsStrict: jest.fn(async () => { throw new Error('database unavailable'); }) });
  const res = await h.run(url, {}, 'get');
  expect(res.statusCode).toBeGreaterThanOrEqual(500);
  expect(res.body).toEqual({ error: expect.any(String) });
  expect(h.bindings.getBotSettingsStrict).toHaveBeenCalledWith(sid);
  expect(h.bindings.getBotSettings).not.toHaveBeenCalled();
  expect(h.read()).toEqual(savedSettings);
});

test('authenticated owners read persisted settings through the strict loader', async () => {
  const h = harness(savedSettings);
  const res = await h.run('/api/bot/settings', {}, 'get', {}, { role: 'owner' });
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ settings: savedSettings });
  expect(h.bindings.getBotSettingsStrict).toHaveBeenCalledTimes(1);
  expect(h.bindings.getBotSettingsStrict).toHaveBeenCalledWith(sid);
  expect(h.bindings.getBotSettings).not.toHaveBeenCalled();
});

test('anonymous settings reads return the authentication error without reading storage', async () => {
  const h = harness(savedSettings, { getPartitionId: async () => null });
  const res = await h.run('/api/bot/settings', {}, 'get');
  expect(res.statusCode).toBe(401);
  expect(res.body).toEqual({ error: 'Login required' });
  expect(h.bindings.getBotSettingsStrict).not.toHaveBeenCalled();
  expect(h.bindings.getBotSettings).not.toHaveBeenCalled();
});

test('failed settings reads return 503 without exposing saved settings or defaults', async () => {
  const h = harness(savedSettings, { getBotSettingsStrict: jest.fn(async () => { throw new Error('database unavailable'); }) });
  const res = await h.run('/api/bot/settings', {}, 'get', {}, { role: 'owner' });
  expect(res.statusCode).toBe(503);
  expect(res.body).toEqual({ error: 'Failed to load bot settings' });
  expect(h.bindings.getBotSettingsStrict).toHaveBeenCalledWith(sid);
  expect(h.bindings.getBotSettings).not.toHaveBeenCalled();
  expect(h.read()).toEqual(savedSettings);
});
