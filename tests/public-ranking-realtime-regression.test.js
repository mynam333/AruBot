const fs = require('fs');
const path = require('path');

describe('공개 포인트 랭킹 실시간 갱신 회귀 방지', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const viewerPointsPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'viewer', 'viewer-points-page.tsx'), 'utf8');
  const publicRealtimeView = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'public', 'public-realtime-data-view.tsx'), 'utf8');
  const publicApi = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'api', 'public.ts'), 'utf8');
  const serverApi = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'api', 'server.ts'), 'utf8');

  test('서버는 공개 포인트와 라이브 조회를 짧은 메모리 캐시로 합쳐야 함', () => {
    expect(serverIndex).toContain('const realtimeResponseCache = new Map()');
    expect(serverIndex).toContain('async function readRealtimeCached');
    expect(serverIndex).toContain('`public:points:${uid}:${limit}`');
    expect(serverIndex).toContain("`public:live:${uid}`");
    expect(serverIndex).toContain("`viewer:points:${ownerUserId}`");
    expect(serverIndex).toContain('getPublicChannelPointsSnapshot(');
    expect(serverIndex).toContain('resolveVerifiedPublicChannelIdentity(uid)');
    expect(serverIndex).not.toContain('listChannelPointsPage(uid, { offset: 0, limit })');
  });

  test('포인트 관리 작업은 공개 랭킹 캐시를 즉시 무효화해야 함', () => {
    expect(serverIndex).toContain('function invalidateRealtimePointCaches');
    expect(serverIndex.match(/invalidateRealtimePointCaches\(uid\);/g)?.length || 0).toBeGreaterThanOrEqual(5);
  });

  test('공개 포인트 페이지는 상위 랭킹만 가져오고 클라이언트에서 자동 갱신해야 함', () => {
    expect(publicApi).toContain("`${getPublicEndpoint(channelUid, kind)}?limit=100`");
    expect(publicRealtimeView).toContain('const refreshMsByKind');
    expect(publicRealtimeView).toContain('points: 7000');
    expect(publicRealtimeView).toContain('function PublicPointsRanking');
    expect(publicRealtimeView).toContain('실시간 포인트 랭킹');
    expect(publicRealtimeView).toContain('window.setInterval(tick, intervalMs)');
    expect(publicRealtimeView).toContain("document.addEventListener('visibilitychange', handleVisibility)");
    expect(serverApi).toContain('AbortSignal.timeout(SERVER_API_READ_TIMEOUT_MS)');
  });

  test('시청자 포인트 페이지는 잔액과 라이브 상태를 백그라운드 갱신해야 함', () => {
    expect(viewerPointsPage).toContain('const VIEWER_POINTS_REFRESH_MS = 9000');
    expect(viewerPointsPage).toContain('const VIEWER_LIVE_REFRESH_MS = 8000');
    expect(viewerPointsPage).toContain('const VIEWER_LIVE_FETCH_CONCURRENCY = 6');
    expect(viewerPointsPage).toContain('load({ silent: true })');
    expect(viewerPointsPage).toContain('refreshLiveStatuses');
    expect(viewerPointsPage).toContain('balances.flatMap(viewerBalanceLiveKeys)');
    expect(viewerPointsPage).toContain('liveByChannel[stationChannelPublicUid(balance, channel)]');
    expect(viewerPointsPage).toContain('viewerBalanceIsLive(balance, liveByChannel)');
    expect(viewerPointsPage).toContain('if (!response.ok)');
    expect(viewerPointsPage).toContain('setLoadError(true)');
    expect(viewerPointsPage).toContain('이전에 확인한 포인트를 표시하고 있습니다.');
    expect(viewerPointsPage).not.toContain('if (!silent) setData(null)');
    expect(viewerPointsPage).toContain('if (!response.ok) continue');
    expect(viewerPointsPage).toContain('Math.min(VIEWER_LIVE_FETCH_CONCURRENCY, channels.length)');
    expect(viewerPointsPage).toContain('if (liveRefreshInFlightRef.current) return');
    expect(viewerPointsPage).toContain('liveRefreshInFlightRef.current = false');
    expect(viewerPointsPage).toContain('freshStatuses.get(channelUid) || current[channelUid]');
    expect(viewerPointsPage).toContain("`${providerLabel(provider)} 상태 확인 불가`");
    expect(viewerPointsPage).toContain('liveByChannel: Record<string, LiveStatus>');
  });
});
