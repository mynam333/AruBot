const loadSource = require('./helpers/load-source.cjs');
const loadServerFunctions = require('./helpers/load-server-functions.cjs');
const chzzk = loadSource('server/chzzk-info.js');
const { createPlatformProfileService, normalizeChzzkPublicProfile } = loadSource('server/platform-profiles.js', { './chzzk-info.js': chzzk });
const { parseChzzkLivePlaybackUrl } = loadSource('server/drawing-live-playback.js');

function lookupHarness() {
  const bindings = {
    chzzkInfoClient: { getFollowerCount: jest.fn(), getFollowersPage: jest.fn(), getSubscribersPage: jest.fn() },
    chzzkChannelIdentityMatches: chzzk.chzzkChannelIdentityMatches,
    chzzkNonNegativeNumber: chzzk.chzzkNonNegativeNumber,
    followersCountCache: new Map(), userFollowedAtCache: new Map(), userSubMonthsCache: new Map(),
    getChannelUidsForSid: jest.fn().mockResolvedValue(['owner-channel']),
    getValidAccessToken: jest.fn().mockResolvedValue('owner-token'),
    DEFAULT_TIMEOUT: 8000,
    getKstCalendarDate: (ts) => new Date(ts + 9 * 60 * 60 * 1000).toISOString().slice(0, 10),
  };
  const functions = loadServerFunctions([
    'getChannelFollowersCountForSid', 'findUserFollowedAtForSid', 'getUserSubscriptionMonthsForSid',
    'lookupDeadlineExpired', 'lookupDeadlineReached', 'lookupRequestTimeout',
    'addFollowerLookupCandidate', 'collectFollowerLookupCandidates', 'getFollowerItemDate',
  ], bindings);
  return { ...bindings, ...functions };
}

describe('CHZZK relationship consumers', () => {
  test('reads and caches the first follower page, including a prefixed viewer ID', async () => {
    const h = lookupHarness();
    h.chzzkInfoClient.getFollowersPage.mockResolvedValue([{ channelId: 'viewer', createdDate: '2026-09-28T15:30:00Z' }]);
    expect(await h.findUserFollowedAtForSid('sid', 'chzzk:viewer', 'Name', 'chzzk')).toBe('2026-09-29');
    expect(await h.findUserFollowedAtForSid('sid', 'chzzk:viewer', 'Name', 'chzzk')).toBe('2026-09-29');
    expect(h.chzzkInfoClient.getFollowersPage).toHaveBeenCalledTimes(1);
    expect(h.chzzkInfoClient.getFollowersPage.mock.calls[0][1]).toBe(0);
  });

  test('continues to page one after fifty entries and ignores duplicate display names', async () => {
    const h = lookupHarness();
    h.chzzkInfoClient.getFollowersPage
      .mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({ channelId: `other-${i}`, channelName: 'Name', createdDate: '2020-01-01' })))
      .mockResolvedValueOnce([{ channelId: 'viewer', channelName: 'Name', createdDate: '2026-09-29 12:00:00' }]);
    expect(await h.findUserFollowedAtForSid('sid', 'viewer', 'Name', 'chzzk')).toBe('2026-09-29');
    expect(h.chzzkInfoClient.getFollowersPage.mock.calls.map((args) => args[1])).toEqual([0, 1]);
  });

  test('does not cache follower authentication failures as a negative result', async () => {
    const h = lookupHarness();
    h.chzzkInfoClient.getFollowersPage.mockRejectedValueOnce(new Error('403')).mockResolvedValueOnce([{ channelId: 'viewer', createdDate: '2026-09-29' }]);
    expect(await h.findUserFollowedAtForSid('sid', 'viewer', '', 'chzzk')).toBeNull();
    expect(h.userFollowedAtCache.size).toBe(0);
    expect(await h.findUserFollowedAtForSid('sid', 'viewer', '', 'chzzk')).toBe('2026-09-29');
  });

  test('caches a negative follower result only after a complete scan', async () => {
    const h = lookupHarness();
    h.chzzkInfoClient.getFollowersPage.mockResolvedValue([]);
    expect(await h.findUserFollowedAtForSid('sid', 'viewer', '', 'chzzk')).toBeNull();
    expect(h.userFollowedAtCache.get('sid:chzzk:viewer:')).toMatchObject({ date: '' });
  });

  test('does not cache partial scans or invalid follow dates', async () => {
    const saved = process.env.CHZZK_FOLLOWER_SCAN_PAGES;
    process.env.CHZZK_FOLLOWER_SCAN_PAGES = '1';
    try {
      const h = lookupHarness();
      h.chzzkInfoClient.getFollowersPage.mockResolvedValue(Array.from({ length: 50 }, (_, i) => ({ channelId: `other-${i}` })));
      expect(await h.findUserFollowedAtForSid('sid', 'viewer', '', 'chzzk')).toBeNull();
      expect(h.userFollowedAtCache.size).toBe(0);
      await expect(h.findUserFollowedAtForSid('sid', 'viewer', '', 'chzzk', { strict: true })).rejects.toThrow('scan limit');
      h.chzzkInfoClient.getFollowersPage.mockResolvedValue([{ channelId: 'viewer', createdDate: null }]);
      expect(await h.findUserFollowedAtForSid('sid', 'viewer', '', 'chzzk')).toBeNull();
      expect(h.userFollowedAtCache.size).toBe(0);
    } finally {
      if (saved == null) delete process.env.CHZZK_FOLLOWER_SCAN_PAGES;
      else process.env.CHZZK_FOLLOWER_SCAN_PAGES = saved;
    }
  });

  test('uses official subscriber channelId/month fields on the first page', async () => {
    const h = lookupHarness();
    h.chzzkInfoClient.getSubscribersPage.mockResolvedValue([{ channelId: 'viewer', month: 12 }]);
    expect(await h.getUserSubscriptionMonthsForSid('sid', 'chzzk:viewer', 'chzzk')).toBe(12);
    expect(h.chzzkInfoClient.getSubscribersPage.mock.calls[0][1]).toBe(0);
    expect(await h.getUserSubscriptionMonthsForSid('sid', 'chzzk:viewer', 'chzzk')).toBe(12);
    expect(h.chzzkInfoClient.getSubscribersPage).toHaveBeenCalledTimes(1);
  });

  test('paginates subscribers with fifty-entry pages', async () => {
    const h = lookupHarness();
    h.chzzkInfoClient.getSubscribersPage
      .mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({ channelId: `other-${i}`, month: 1 })))
      .mockResolvedValueOnce([{ channelId: 'viewer', month: 0, totalMonth: 100 }]);
    expect(await h.getUserSubscriptionMonthsForSid('sid', 'viewer', 'chzzk')).toBe(0);
    expect(h.chzzkInfoClient.getSubscribersPage.mock.calls.map((args) => args[1])).toEqual([0, 1]);
  });

  test('does not cache failed or incomplete subscriber lookups', async () => {
    const h = lookupHarness();
    h.chzzkInfoClient.getSubscribersPage.mockRejectedValueOnce(new Error('expired'))
      .mockResolvedValueOnce([{ channelId: 'viewer', month: null }]).mockResolvedValueOnce([{ channelId: 'viewer', month: 5 }]);
    expect(await h.getUserSubscriptionMonthsForSid('sid', 'viewer', 'chzzk')).toBeNull();
    expect(await h.getUserSubscriptionMonthsForSid('sid', 'viewer', 'chzzk')).toBeNull();
    expect(h.userSubMonthsCache.size).toBe(0);
    expect(await h.getUserSubscriptionMonthsForSid('sid', 'viewer', 'chzzk')).toBe(5);
  });

  test('preserves strict errors and avoids work after deadline', async () => {
    const h = lookupHarness();
    h.chzzkInfoClient.getSubscribersPage.mockRejectedValue(new Error('403'));
    await expect(h.getUserSubscriptionMonthsForSid('sid', 'viewer', 'chzzk', { strict: true })).rejects.toThrow('403');
    expect(await h.findUserFollowedAtForSid('sid', 'viewer', '', 'chzzk', { deadlineAt: Date.now() - 1 })).toBeNull();
    expect(h.chzzkInfoClient.getFollowersPage).not.toHaveBeenCalled();
  });

  test('does not require owner OAuth to read the public follower count', async () => {
    const h = lookupHarness();
    h.chzzkInfoClient.getFollowerCount.mockResolvedValue(0);
    expect(await h.getChannelFollowersCountForSid('sid', 'chzzk')).toBe(0);
    expect(await h.getChannelFollowersCountForSid('sid', 'chzzk')).toBe(0);
    expect(h.getValidAccessToken).not.toHaveBeenCalled();
    expect(h.chzzkInfoClient.getFollowerCount).toHaveBeenCalledTimes(1);
  });
});

describe('CHZZK public profile consumers', () => {
  test('uses current verifiedMark and distinguishes unavailable counts/state from zero/offline', () => {
    expect(normalizeChzzkPublicProfile({ content: { channelId: 'a', verifiedMark: true, followerCount: null } })).toMatchObject({ verified: true, followerCount: null, openLive: null });
    expect(normalizeChzzkPublicProfile({ content: { channelId: 'a', verifiedMark: false, verified: true, openLive: false, isLive: true, followerCount: 0 } })).toMatchObject({ verified: false, followerCount: 0, openLive: false });
  });

  test.each([{ code: 403, content: null }, { code: 200, content: {} }, { content: { channelId: 'other' } }])('preserves existing profile on invalid responses: %j', async (payload) => {
    const service = createPlatformProfileService({ httpGet: async () => payload });
    const profile = { channelId: 'a', channelName: 'Original', metadata: { publicProfile: { followerCount: 42 } } };
    const result = await service.enrichChzzkProfile(profile);
    expect(result.channelName).toBe('Original');
    expect(result.metadata.publicProfile).toMatchObject({ status: 'failed', followerCount: 42 });
  });

  test('retries a failed profile instead of caching the error for ten minutes', async () => {
    const httpGet = jest.fn().mockResolvedValue({ content: { channelId: 'a', channelName: 'Recovered' } });
    const service = createPlatformProfileService({ httpGet });
    const result = await service.enrichChzzkProfile({ channelId: 'a', metadata: { publicProfile: { status: 'failed', fetchedAt: new Date().toISOString() } } });
    expect(result.channelName).toBe('Recovered');
    expect(httpGet).toHaveBeenCalledTimes(1);
  });
});

describe('CHZZK live state consumers', () => {
  function liveHarness() {
    const bindings = {
      chzzkInfoClient: { getLiveDetail: jest.fn() },
      DEFAULT_TIMEOUT: 8000, CHZZK_LIVE_STATUS_TTL_MS: 15000,
      singleFlightRequests: new Map(),
      liveStatusCache: new Map(), liveSession: new Map(), chzzkRuntimeErrors: new Map(),
      compactLogText: (value) => String(value),
      ensureChzzkChatSessionForLiveSid: jest.fn().mockResolvedValue(null),
      closeChzzkChatSessionForOfflineSid: jest.fn(), updateSessionState: jest.fn(),
      providerObservationBootstrapPending: false, console: { warn: jest.fn(), error: jest.fn() },
    };
    return { ...bindings, ...loadServerFunctions(['singleFlight', 'refreshChzzkLiveStatusForSid', 'loadChzzkLiveStatusForSid', 'isChzzkLiveDetailOpen', 'parseChzzkLiveTimestamp'], bindings) };
  }
  const options = { settings: {}, force: true, channelUids: ['a'] };

  test('parses timezone-less CHZZK dates as Korea time, independent of server timezone', () => {
    const { parseChzzkLiveTimestamp } = liveHarness();
    const timestamp = Date.parse('2026-09-29T12:00:00+09:00');
    expect(parseChzzkLiveTimestamp('2026-09-29 12:00:00')).toBe(timestamp);
    expect(parseChzzkLiveTimestamp('2026-09-29T03:00:00Z')).toBe(timestamp);
    expect(parseChzzkLiveTimestamp(timestamp / 1000)).toBe(timestamp);
    expect(parseChzzkLiveTimestamp(null, null)).toBeNull();
  });

  test('preserves live/chat state on total failure and does not write an offline cache', async () => {
    const h = liveHarness();
    const cached = { provider: 'chzzk', live: true, channelId: 'a', startTs: 123, ts: 1 };
    h.liveStatusCache.set('sid', cached);
    h.chzzkInfoClient.getLiveDetail.mockRejectedValue(new Error('503'));
    expect(await h.refreshChzzkLiveStatusForSid('sid', options)).toMatchObject({ live: true, stale: true, startTs: 123 });
    expect(h.liveStatusCache.get('sid')).toBe(cached);
    expect(h.closeChzzkChatSessionForOfflineSid).not.toHaveBeenCalled();
    expect(h.updateSessionState).not.toHaveBeenCalled();
  });

  test('does not mark all channels offline if one channel lookup fails', async () => {
    const h = liveHarness();
    h.liveStatusCache.set('sid', { provider: 'chzzk', live: true, channelId: 'b', ts: 1 });
    h.chzzkInfoClient.getLiveDetail.mockResolvedValueOnce({ status: 'CLOSE' }).mockRejectedValueOnce(new Error('503'));
    expect(await h.refreshChzzkLiveStatusForSid('sid', { ...options, channelUids: ['a', 'b'] })).toMatchObject({ live: true, stale: true });
    expect(h.closeChzzkChatSessionForOfflineSid).not.toHaveBeenCalled();
  });

  test('preserves a known start time when public status lacks detailed metadata', async () => {
    const h = liveHarness();
    h.liveStatusCache.set('sid', { provider: 'chzzk', live: true, channelId: 'a', startTs: 123, ts: 1 });
    h.chzzkInfoClient.getLiveDetail.mockResolvedValue({ status: 'OPEN', metadataPartial: true });
    expect(await h.refreshChzzkLiveStatusForSid('sid', options)).toMatchObject({ live: true, startTs: 123 });
  });

  test('keeps chat subscribed across a confirmed broadcast end', async () => {
    const h = liveHarness();
    h.liveStatusCache.set('sid', { provider: 'chzzk', live: true, channelId: 'a', ts: 1 });
    h.chzzkInfoClient.getLiveDetail.mockResolvedValue({ status: 'CLOSE' });
    expect(await h.refreshChzzkLiveStatusForSid('sid', options)).toMatchObject({ live: false });
    expect(h.closeChzzkChatSessionForOfflineSid).not.toHaveBeenCalled();
    expect(h.ensureChzzkChatSessionForLiveSid).toHaveBeenCalledWith('sid', 'a');
    expect(h.updateSessionState).toHaveBeenCalledWith('sid', false, null, 'chzzk');
  });

  test('cached offline state still prepares chat before broadcast start', async () => {
    const h = liveHarness();
    h.liveStatusCache.set('sid', { provider: 'chzzk', live: false, channelId: 'a', ts: Date.now() });
    expect(await h.refreshChzzkLiveStatusForSid('sid')).toMatchObject({ live: false, cached: true });
    expect(h.ensureChzzkChatSessionForLiveSid).toHaveBeenCalledWith('sid', 'a');
    expect(h.chzzkInfoClient.getLiveDetail).not.toHaveBeenCalled();
  });

  test('coalesces simultaneous live checks from chat bursts and background polling', async () => {
    const h = liveHarness();
    h.chzzkInfoClient.getLiveDetail.mockResolvedValue({ status: 'OPEN' });
    const results = await Promise.all([
      h.refreshChzzkLiveStatusForSid('sid', options),
      h.refreshChzzkLiveStatusForSid('sid', options),
    ]);
    expect(results.every((result) => result.live)).toBe(true);
    expect(h.chzzkInfoClient.getLiveDetail).toHaveBeenCalledTimes(1);
  });

  test('an explicit closed status takes precedence over stale live flags', () => {
    const h = liveHarness();
    expect(h.isChzzkLiveDetailOpen({ status: 'CLOSE', openLive: true })).toBe(false);
  });

  test('uses current channel home playback metadata for drawing donation live previews', async () => {
    const content = { status: 'OPEN', livePlaybackJson: JSON.stringify({ media: [{ mediaId: 'HLS', path: 'https://media.example/live.m3u8' }] }) };
    const chzzkInfoClient = { getLiveDetail: jest.fn().mockResolvedValue(content) };
    const { resolveDrawingLivePlaybackUrl } = loadServerFunctions(['resolveDrawingLivePlaybackUrl', 'isChzzkLiveDetailOpen'], {
      chzzkInfoClient, parseChzzkLivePlaybackUrl,
      drawingLivePlaybackCache: new Map(),
      getDrawingLivePlaybackCacheKey: (provider, id) => `${provider}:${id}`,
      singleFlight: (key, task) => task(), runDrawingLivePlaybackLookup: (task) => task(),
    });
    expect(await resolveDrawingLivePlaybackUrl('chzzk', 'channel-a')).toMatchObject({ playbackUrl: 'https://media.example/live.m3u8' });
    expect(chzzkInfoClient.getLiveDetail).toHaveBeenCalledWith('channel-a', expect.objectContaining({ deadlineAt: expect.any(Number) }));
  });
});

describe('CHZZK early event live gate', () => {
  function harness() {
    const bindings = {
      singleFlightRequests: new Map(), liveStatusCache: new Map(),
      refreshChzzkLiveStatusForSid: jest.fn(), sleep: jest.fn().mockResolvedValue(undefined),
    };
    return { ...bindings, ...loadServerFunctions(['singleFlight', 'refreshChzzkLiveStatusForEvent'], bindings) };
  }

  test('holds the first chat during a brief offline-to-live metadata delay', async () => {
    const h = harness();
    h.refreshChzzkLiveStatusForSid.mockResolvedValueOnce({ live: false }).mockResolvedValue({ live: true });
    expect(await h.refreshChzzkLiveStatusForEvent('sid')).toEqual({ live: true });
    expect(h.sleep).toHaveBeenCalledWith(1000);
    expect(h.refreshChzzkLiveStatusForSid).toHaveBeenCalledWith('sid', { ttlMs: 5000, force: true });
  });

  test('offline events stay rejected after bounded retries', async () => {
    const h = harness();
    h.refreshChzzkLiveStatusForSid.mockResolvedValue({ live: false });
    expect(await h.refreshChzzkLiveStatusForEvent('sid')).toEqual({ live: false });
    expect(h.refreshChzzkLiveStatusForSid).toHaveBeenCalledTimes(3);
    expect(h.sleep).toHaveBeenCalledTimes(2);
  });

  test('already-live events do not wait or force a fresh request for every chat', async () => {
    const h = harness();
    h.liveStatusCache.set('sid', { live: true });
    h.refreshChzzkLiveStatusForSid.mockResolvedValue({ live: true });
    expect(await h.refreshChzzkLiveStatusForEvent('sid')).toEqual({ live: true });
    expect(h.sleep).not.toHaveBeenCalled();
    expect(h.refreshChzzkLiveStatusForSid).toHaveBeenCalledWith('sid', { ttlMs: 5000, force: false });
  });

  test('each offline chat bypasses even a fresh offline cache', async () => {
    const h = harness();
    h.liveStatusCache.set('sid', { live: false, ts: Date.now() });
    h.refreshChzzkLiveStatusForSid.mockResolvedValue({ live: false });
    await h.refreshChzzkLiveStatusForEvent('sid');
    await h.refreshChzzkLiveStatusForEvent('sid');
    expect(h.refreshChzzkLiveStatusForSid).toHaveBeenCalledTimes(6);
    for (const [, options] of h.refreshChzzkLiveStatusForSid.mock.calls) {
      expect(options.force).toBe(true);
    }
  });

  test('a new chat checks immediately while the previous chat is waiting to retry', async () => {
    const h = harness();
    let releaseRetry;
    h.sleep.mockImplementationOnce(() => new Promise((resolve) => { releaseRetry = resolve; }));
    h.refreshChzzkLiveStatusForSid.mockResolvedValueOnce({ live: false }).mockResolvedValue({ live: true });
    const previousChat = h.refreshChzzkLiveStatusForEvent('sid');
    await Promise.resolve();
    expect(h.sleep).toHaveBeenCalledTimes(1);
    expect(await h.refreshChzzkLiveStatusForEvent('sid')).toEqual({ live: true });
    expect(h.refreshChzzkLiveStatusForSid).toHaveBeenCalledTimes(2);
    releaseRetry();
    expect(await previousChat).toEqual({ live: true });
  });
});
