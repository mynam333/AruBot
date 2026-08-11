const fs = require('fs');
const path = require('path');

const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
const databaseSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'supabase.js'), 'utf8');

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('공개 포인트 적립 정책 백엔드', () => {
  const parserSource = sourceBetween(
    serverIndex,
    'function parsePublicPointPolicyUid(value)',
    'function prunePublicPointPolicyCache',
  );
  const loaderSource = sourceBetween(
    serverIndex,
    'function loadPublicPointEarningPolicy(ownerUserId)',
    'function cloneRealtimePayload',
  );
  const pointsSnapshotLoader = sourceBetween(
    serverIndex,
    'async function loadVerifiedPublicPointsSnapshot',
    'function rememberPublicChannelCacheAlias',
  );
  const publicRoute = sourceBetween(
    serverIndex,
    "app.get('/api/public/:uid/points'",
    "app.post('/api/chzzk/chat/send'",
  );
  const viewerRoute = sourceBetween(
    serverIndex,
    "app.get('/api/viewer/points'",
    "app.post('/api/account/platforms/refresh'",
  );
  const ownershipLookup = sourceBetween(
    databaseSource,
    'async function findExactPublicChannelIdentityWithClient',
    'export async function findExactPublicChannelIdentity',
  );
  const existingTableLookup = sourceBetween(
    databaseSource,
    'async function listOwnedExistingPointTablesForAliases',
    'export async function getPublicChannelPointsSnapshot',
  );
  const publicSnapshot = sourceBetween(
    databaseSource,
    'export async function getPublicChannelPointsSnapshot',
    'function makeArubotViewerUuid',
  );
  const strictSettingsLookup = sourceBetween(
    databaseSource,
    'export async function getBotSettingsStrict',
    'export async function setBotSettings',
  );

  test('UID를 DB와 캐시에 접근하기 전에 제한하고 user SID는 공개 입력으로 받지 않는다', () => {
    expect(parserSource).toContain('PUBLIC_POINT_POLICY_UID_MAX_LENGTH');
    expect(parserSource).toContain('/^user:/i.test(raw)');
    expect(parserSource).toContain('PUBLIC_POINT_POLICY_UID_PATTERN.test(channelUid)');
    expect(parserSource).toContain("const provider = qualified ? qualified[1].toLowerCase() : null");
    expect(parserSource).toContain('const channelUid = qualified ? qualified[2] : raw');
    expect(publicRoute.indexOf('parsePublicPointPolicyUid(uid)')).toBeLessThan(
      publicRoute.indexOf('readRealtimeCached('),
    );
    expect(publicRoute).toContain("return res.status(400).json({ error: 'invalid uid' })");
  });

  test('provider-qualified 및 raw UID를 exact equality로 검증하고 모호한 소유자는 거부한다', () => {
    expect(ownershipLookup).toContain('select distinct user_id, provider');
    expect(ownershipLookup).toContain('where provider = $1');
    expect(ownershipLookup).toContain('where provider = any($1::text[])');
    expect(ownershipLookup.match(/channel_id = \$2 or platform_user_id = \$2/g)).toHaveLength(2);
    expect(ownershipLookup).toContain('select distinct owner_user_id');
    expect(ownershipLookup).toContain('where youtube_channel_id = $1');
    expect(ownershipLookup.match(/limit 2/g)?.length || 0).toBeGreaterThanOrEqual(3);
    expect(ownershipLookup).toContain('addExactPublicChannelIdentityCandidate');
    expect(ownershipLookup).toContain("return matches.length === 1 ? { ...matches[0], channelUid: exactChannelUid } : null");
    expect(ownershipLookup).not.toContain('channel_handle');
    expect(ownershipLookup).not.toContain('findAppUserIdByChannelUid');
  });

  test('검증된 동일 소유자의 기존 테이블만 읽어 랭킹과 whitelist 정책을 결합한다', () => {
    expect(publicRoute).toContain('loadVerifiedPublicPointsSnapshot(publicIdentity, verifiedIdentity, limit)');
    expect(pointsSnapshotLoader).toContain('getPublicChannelPointsSnapshot(');
    expect(publicRoute).toContain('const verifiedIdentity = await resolveVerifiedPublicChannelIdentity(uid)');
    expect(publicRoute).toContain('loadPublicPointEarningPolicy(rankingPayload.pointSettingsOwnerUserId)');
    expect(publicRoute.match(/pointEarning/g)).toHaveLength(2);
    expect(publicRoute).toContain('points: rows');
    expect(publicRoute).toContain('total: Number(snapshot?.total || 0)');
    expect(publicRoute).toContain('totalPoints: Number(snapshot?.totalPoints || 0)');
    expect(publicRoute).not.toContain('resolvePublicChannelSid');
    expect(publicRoute).not.toContain('findAppUserIdByChannelUid');
    expect(publicRoute).not.toContain('listChannelPointsPage');
    expect(publicRoute).not.toContain('listChannelPoints(uid)');
    expect(publicRoute).toContain('delete payload.pointSettingsOwnerUserId');
    expect(publicRoute.indexOf('loadPublicPointEarningPolicy(')).toBeGreaterThan(
      publicRoute.indexOf('});\n    const pointEarning'),
    );

    expect(loaderSource.match(/getBotSettingsStrict\(/g)).toHaveLength(1);
    expect(loaderSource).toContain('buildPointEarningPolicy(await getBotSettingsStrict(sid))');
    expect(loaderSource).not.toContain('...settings');
    expect(strictSettingsLookup).toContain('if (error) throw error');
    expect(strictSettingsLookup).toContain(".select('settings')");
    expect(existingTableLookup).toContain('loadPublicPointTableOwnerIndex(pg)');
    expect(existingTableLookup).toContain('tableOwners?.size === 1 && tableOwners.has(owner)');
    expect(existingTableLookup).toContain('from information_schema.tables');
    expect(existingTableLookup).toContain('table_name = any($1::text[])');
    expect(existingTableLookup).not.toContain('ensureChannelPointsTable');
    expect(existingTableLookup).not.toContain('create table');
    expect(publicSnapshot).toContain('findExactPublicChannelIdentityWithClient(');
    expect(publicSnapshot).toContain('listOwnedExistingPointTablesForAliases(aliases, ownerUserId, pg)');
    expect(publicSnapshot).not.toContain('ensureChannelPointsTable');
    expect(publicSnapshot).not.toContain('create table');
  });

  test('공개 홈의 라이브·명령어·룰렛·포인트가 같은 검증된 플랫폼 소유자를 사용한다', () => {
    expect(serverIndex.match(/resolveVerifiedPublicChannelIdentity\(uid\)/g)?.length || 0).toBeGreaterThanOrEqual(4);
    expect(serverIndex).not.toContain('async function resolvePublicChannelSid');
    expect(serverIndex).toContain('loadVerifiedPublicLiveInfo(identity)');
    expect(serverIndex).toContain("{ provider: identity.provider }");
    expect(serverIndex).toContain("const sid = `user:${identity.ownerUserId}`");
  });

  test('정책 실패와 timeout은 랭킹 요청을 실패시키지 않고 실제 작업은 single-flight로 유지한다', () => {
    expect(serverIndex).toContain('const publicPointPolicyCache = new Map()');
    expect(serverIndex).toContain('const publicPointPolicyInflight = new Map()');
    expect(serverIndex).toContain('PUBLIC_POINT_POLICY_POSITIVE_CACHE_MS');
    expect(serverIndex).toContain('PUBLIC_POINT_POLICY_NEGATIVE_CACHE_MS');
    expect(serverIndex).toContain('PUBLIC_POINT_POLICY_CACHE_MAX_ENTRIES');
    expect(serverIndex).toContain('PUBLIC_POINT_POLICY_MAX_INFLIGHT');
    expect(serverIndex).toContain('REALTIME_RESPONSE_CACHE_MAX_ENTRIES');
    expect(serverIndex).toContain('PUBLIC_CHANNEL_IDENTITY_MAX_INFLIGHT');
    expect(serverIndex).toContain("new Error('public_channel_identity_overloaded')");
    expect(databaseSource).toContain('PUBLIC_POINT_TABLE_OWNER_INDEX_MAX_ENTRIES');
    expect(databaseSource).toContain('publicPointTableOwnerIndexPromise');
    expect(databaseSource).toContain('tableOwners?.size === 1 && tableOwners.has(owner)');
    expect(serverIndex).toContain('function setRealtimeResponseCacheEntry(key, entry)');
    expect(serverIndex).toContain('async function waitForPublicPointPolicy(promise)');
    expect(loaderSource).toContain('return waitForPublicPointPolicy(existing.promise)');
    expect(loaderSource).toContain('const entry = { promise: operation, generation }');
    expect(loaderSource).toContain('publicPointPolicyInflight.set(cacheKey, entry)');
    expect(loaderSource).toContain('return waitForPublicPointPolicy(operation)');
    expect(loaderSource).toContain('.catch(() => null)');
  });

  test('설정 저장과 진행 중 캐시 작업 사이의 stale 재삽입을 막는다', () => {
    expect(serverIndex.match(/invalidatePublicPointPolicyCache\(sid\);/g)?.length || 0).toBeGreaterThanOrEqual(3);
    expect(serverIndex).toContain('const publicPointPolicyCacheGenerations = new Map()');
    expect(serverIndex).toContain('publicPointPolicyGlobalGeneration === generation.global');
    expect(loaderSource).toContain('publicPointPolicyGlobalGeneration === generation.global');
    expect(loaderSource).toContain('publicPointPolicyCacheGenerations.get(cacheKey)');
    expect(loaderSource).toContain('publicPointPolicyInflight.get(cacheKey) === entry');
    expect(serverIndex).toContain('realtimeResponseCache.get(key) === refreshEntry');
    expect(serverIndex).toContain('realtimeResponseCache.get(key) === requestEntry');
    expect(serverIndex).toContain("(!uid && key.startsWith('public:points:'))");
    expect(serverIndex).toContain("app.post('/api/bot/settings', rateLimiters.userWrite");
    expect(serverIndex).toContain("app.post('/api/donation/settings', rateLimiters.userWrite");
    expect(serverIndex).toContain("app.post('/api/account/platforms/refresh', rateLimiters.userWrite");
  });

  test('개인 포인트 폴링은 설정을 다시 읽지 않고 기존 잔액 응답만 유지한다', () => {
    expect(viewerRoute).not.toContain('pointEarning');
    expect(viewerRoute).not.toContain('getBotSettings');
    expect(viewerRoute).not.toContain('loadPublicPointEarningPolicy');
    expect(viewerRoute).toContain('delete publicBalance.pointSettingsSid');
    expect(viewerRoute).toContain('stationChannels');
    expect(viewerRoute).toContain('listPlatformAccountsForUserIds(settingsOwnerIds)');
    expect(viewerRoute).not.toContain('await listStationChannelsForViewerBalance(balance)');
    expect(viewerRoute).toContain('publicLinks');
    expect(viewerRoute).toContain('totalPoints: normalizedBalances.reduce');
    expect(serverIndex).not.toContain('live: liveState?.live ?? channel.live ?? false');
  });
});
