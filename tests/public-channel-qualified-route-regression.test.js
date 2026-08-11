const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const serverIndex = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
const databaseSource = fs.readFileSync(path.join(root, 'server', 'supabase.js'), 'utf8');
const publicPage = fs.readFileSync(path.join(root, 'src', 'features', 'public', 'public-channel-page.tsx'), 'utf8');
const drawingPage = fs.readFileSync(path.join(root, 'src', 'features', 'viewer', 'drawing-donation-page.tsx'), 'utf8');
const publicRealtimeView = fs.readFileSync(path.join(root, 'src', 'features', 'public', 'public-realtime-data-view.tsx'), 'utf8');

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('qualified public channel route regression', () => {
  test('roulette definitions, tokens, and logs all resolve the verified owner', () => {
    const definitions = sourceBetween(serverIndex, "app.get('/api/public/:uid/roulette-defs'", "app.post('/api/chzzk/send'");
    const token = sourceBetween(serverIndex, "app.get('/api/roulette/resolve-token'", 'async function resolveCurrentViewerRouletteUserIds');
    const logs = sourceBetween(serverIndex, "app.get('/api/roulette/logs'", 'function getPathValue');

    for (const route of [definitions, token, logs]) {
      expect(route).toContain('resolveVerifiedPublicChannelIdentity(uid)');
      expect(route).toContain('`user:${identity.ownerUserId}`');
      expect(route).not.toContain('`user:${uid}`');
    }
    expect(definitions).toContain('`public:roulette-defs:${uid}`');
    expect(definitions).not.toContain('rateLimiters.externalLookup');
    expect(definitions).toContain('getPublicBotSettingsStrict(sid)');
    expect(logs).not.toContain('rateLimiters.externalLookup');
    expect(logs).toContain('getPublicBotSettingsStrict(sid)');
    expect(serverIndex).toContain('PUBLIC_ROULETTE_LOGS_MAX_INFLIGHT');
    expect(serverIndex).toContain('PUBLIC_ROULETTE_LOGS_TIMEOUT_MS');
    expect(logs.indexOf('runPublicRouletteLogsOperation')).toBeLessThan(logs.indexOf('resolveVerifiedPublicChannelIdentity(uid)'));
    expect(logs).toContain("status === 503 ? 'temporarily_unavailable'");
  });

  test('public command reads are cached and never seed default rules', () => {
    const rules = sourceBetween(serverIndex, "app.get('/api/public/:uid/rules'", "app.get('/api/public/:uid/points'");
    expect(rules).toContain('`public:rules:${uid}`');
    expect(rules).toContain('await getBotRules(sid)');
    expect(rules).not.toContain('getBotRulesWithDefaults');
    expect(rules).not.toContain('rateLimiters.externalLookup');
  });

  test('identity overload and timeout fail the caller instead of caching a false offline result', () => {
    const resolver = sourceBetween(serverIndex, 'async function resolveVerifiedPublicChannelIdentity', 'async function loadVerifiedPublicLiveInfo');
    const liveRoute = sourceBetween(serverIndex, "app.get('/api/public/:uid/live'", "app.use('/api/chzzk/events'");
    expect(resolver).toContain("new Error('public_channel_identity_overloaded')");
    expect(resolver).toContain("new Error('public_channel_identity_timeout')");
    expect(resolver).toContain('reject(error)');
    expect(resolver).not.toContain('.catch(() => ({ identity: null }))');
    expect(resolver).toContain('publicChannelIdentityActiveCacheKeys');
    expect(liveRoute).toContain("return res.status(503).json({ error: 'Live status temporarily unavailable' })");
    expect(liveRoute).toContain("const error = new Error('public_live_lookup_unavailable')");
    expect(liveRoute).not.toContain('if (!info) return { live: false');
    expect(serverIndex).toContain('confirmedOffline = !ownedLive');
    expect(serverIndex).toContain('if (confirmedOffline) return buildYoutubeOfflineLiveInfo(lookup)');
    expect(serverIndex).not.toContain('info = await fetchYoutubeActiveLiveForChannel(lookup.channelId)');
  });

  test('drawing entry and submit keep the qualified UID and authoritative settings owner', () => {
    const drawingResolver = sourceBetween(serverIndex, 'async function resolveDrawingDonationSettingsForBalance', 'async function collectViewerDrawingDonationStreamers');
    const drawingRoutes = sourceBetween(serverIndex, "app.get('/api/viewer/drawing-donation/streamers/:channelUid'", "function getPathValue");
    expect(drawingResolver).toContain("const sid = String(balance?.pointSettingsSid || '').trim()");
    expect(drawingResolver).not.toContain('balance?.channelUid');
    expect(drawingRoutes.match(/findViewerDrawingStreamer\(data\.streamers, channelUid, identity\)/g)).toHaveLength(2);
    expect(serverIndex).toContain('entries.push(attachInternalPointSettingsSid(entry, resolved.sid))');
    expect(drawingPage).toContain('loadStreamer(channelUid)');
    expect(drawingPage).toContain('channelUid: streamer.publicUid || streamer.channelUid');
    expect(publicPage).toContain('const drawingPath = `/viewer/drawing/${encodeURIComponent(channelUid)}`');
  });

  test('configuration writes invalidate only the resolved owner public caches', () => {
    expect(serverIndex).toContain('function invalidatePublicChannelConfigurationCaches(ownerUserId)');
    expect(serverIndex).toContain('realtimeResponseCache.delete(`public:rules:${uid}`)');
    expect(serverIndex).toContain('realtimeResponseCache.delete(`public:roulette-defs:${uid}`)');
    expect(serverIndex).toContain('invalidatePublicChannelConfigurationCaches(normalizedSid)');
  });

  test('public ranking is bounded and never exposes stable viewer identifiers', () => {
    const points = sourceBetween(serverIndex, "app.get('/api/public/:uid/points'", "app.post('/api/chzzk/chat/send'");
    expect(points).toContain('Math.min(100, requestedLimit > 0 ? requestedLimit : 100)');
    expect(points).toContain("username: String(row?.username || '익명 시청자')");
    expect(points).not.toContain('user_id:');
    expect(points).not.toContain('userId:');
    expect(publicRealtimeView).not.toContain('function pointUserId');
  });

  test('viewer balances reject ambiguous table ownership and batch legacy reads', () => {
    const loader = sourceBetween(
      databaseSource,
      'export async function listViewerPointBalancesForUserIds',
      'function uniqueNonEmpty',
    );
    expect(loader).toContain('const tableLookupCandidates = new Map()');
    expect(loader).toContain('owners?.size !== 1 || candidates.size !== 1');
    expect(loader).toContain('owners.size === 1 && tableUidLookup.has(table)');
    expect(loader).toContain('queryViewerPointTablesForUserIds(pg, readableTables, ids)');
    expect(loader).not.toContain('for (const tableRow of tableRows || [])');
  });
});
