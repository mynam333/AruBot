const loadSource = require('./helpers/load-source.cjs');
const {
  createChzzkInfoClient, unwrapChzzkContent, chzzkNonNegativeNumber,
  normalizeChzzkLiveStatus, chzzkChannelIdentityMatches,
} = loadSource('server/chzzk-info.js');

const envelope = (content) => ({ code: 200, message: null, content });
const channel = { channelId: 'channel-a', channelName: 'Test channel', followerCount: 42, verifiedMark: true, openLive: true };

describe('current CHZZK read contracts', () => {
  test.each([null, {}, { code: 200, content: null }, { code: 403, content: {} }])('rejects missing/error live status: %j', (payload) => {
    expect(() => normalizeChzzkLiveStatus(payload)).toThrow();
  });

  test('rejects application errors even when HTTP succeeds', () => {
    expect(() => unwrapChzzkContent({ code: 401, message: 'expired', content: null })).toThrow('401');
  });

  test.each([null, undefined, '', ' ', true, false, -1, Infinity, NaN])('does not convert unavailable counts to zero: %p', (value) => {
    expect(chzzkNonNegativeNumber(value)).toBeNull();
  });

  test('accepts zero and numeric strings', () => {
    expect(chzzkNonNegativeNumber(null, '0')).toBe(0);
    expect(chzzkNonNegativeNumber('42')).toBe(42);
  });

  test('reads followerCount from the current public count response without a user token', async () => {
    const httpGet = jest.fn().mockResolvedValue(envelope({ followerCount: 42 }));
    const client = createChzzkInfoClient({ apiBase: 'https://public.example/', httpGet });
    expect(await client.getFollowerCount('channel-a')).toBe(42);
    expect(httpGet).toHaveBeenCalledWith('https://public.example/service/v1/channels/channel-a/followers/count', expect.objectContaining({ headers: { Accept: 'application/json' } }));
  });

  test('uses official channel lookup with client authentication if public metadata is unavailable', async () => {
    const httpGet = jest.fn().mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce(envelope({ data: [channel] }));
    const client = createChzzkInfoClient({ openApiBase: 'https://official.example/', clientId: 'client', clientSecret: 'secret', httpGet });
    expect(await client.getChannel('channel-a')).toEqual(channel);
    expect(httpGet.mock.calls[1]).toEqual(['https://official.example/open/v1/channels', expect.objectContaining({
      params: { channelIds: 'channel-a' },
      headers: { Accept: 'application/json', 'Client-Id': 'client', 'Client-Secret': 'secret' },
    })]);
  });

  test('rejects a different channel returned by the public endpoint', async () => {
    const client = createChzzkInfoClient({ httpGet: async () => envelope(channel) });
    await expect(client.getChannel('other-channel')).rejects.toThrow('identity');
  });

  test('rejects missing official channel results', async () => {
    const httpGet = jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(envelope({ data: [channel] }));
    await expect(createChzzkInfoClient({ clientId: 'c', clientSecret: 's', httpGet }).getChannel('other')).rejects.toThrow();
  });

  test.each([['getFollowersPage', 'followers'], ['getSubscribersPage', 'subscribers']])('uses the official zero-based %s endpoint', async (method, resource) => {
    const rows = [{ channelId: 'viewer-a', channelName: 'Viewer', month: 12, createdDate: '2026-09-01T12:00:00+09:00' }];
    const httpGet = jest.fn().mockResolvedValue(envelope({ data: rows }));
    const client = createChzzkInfoClient({ httpGet });
    expect(await client[method]('owner-token', 0)).toEqual(rows);
    expect(httpGet).toHaveBeenCalledWith(`https://openapi.chzzk.naver.com/open/v1/channels/${resource}`, expect.objectContaining({
      params: { page: 0, size: 50 }, headers: { Accept: 'application/json', Authorization: 'Bearer owner-token' },
    }));
  });

  test.each([401, 403, 429, 500])('does not fall back to unauthenticated follower endpoints on %s', async (code) => {
    const httpGet = jest.fn().mockResolvedValue({ code, content: null });
    await expect(createChzzkInfoClient({ httpGet }).getFollowersPage('owner-token', 0)).rejects.toThrow(String(code));
    expect(httpGet).toHaveBeenCalledTimes(1);
  });

  test.each([{}, { data: null }, { data: [{}] }])('rejects malformed list responses: %j', async (content) => {
    const client = createChzzkInfoClient({ httpGet: async () => envelope(content) });
    await expect(client.getSubscribersPage('owner-token', 0)).rejects.toThrow();
  });

  test('matches stable channel IDs, including provider-prefixed IDs, not nicknames', () => {
    expect(chzzkChannelIdentityMatches({ channelId: 'abc' }, 'user:chzzk:abc')).toBe(true);
    expect(chzzkChannelIdentityMatches({ channelId: 'other', channelName: 'abc' }, 'abc')).toBe(false);
    expect(chzzkChannelIdentityMatches({ channelId: 'abc' }, 'cime:abc')).toBe(false);
  });

  test('uses current polling status and channel home metadata instead of retired live-detail', async () => {
    const httpGet = jest.fn()
      .mockResolvedValueOnce(envelope({ status: 'OPEN', concurrentUserCount: 45 }))
      .mockResolvedValueOnce(envelope({ topExposedVideos: { openLive: {
        liveTitle: 'Live now', openDate: '2026-09-29 12:00:00', channelId: 'channel-a', concurrentUserCount: 40,
      } } }));
    const result = await createChzzkInfoClient({ httpGet }).getLiveDetail('channel-a');
    expect(result).toMatchObject({ status: 'OPEN', liveTitle: 'Live now', concurrentUserCount: 45, openDate: '2026-09-29 12:00:00' });
    expect(httpGet.mock.calls[0][0]).toContain('/polling/v3.1/channels/channel-a/live-status');
    expect(httpGet.mock.calls[1]).toEqual(['https://api.chzzk.naver.com/service/v1/channels/channel-a/data', expect.objectContaining({ params: { fields: 'topExposedVideos' } })]);
  });

  test('uses explicit public openLive when polling is unavailable', async () => {
    const httpGet = jest.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce(envelope(channel));
    expect(await createChzzkInfoClient({ httpGet }).getLiveStatus('channel-a')).toMatchObject({ status: 'OPEN', channel });
  });

  test('does not treat a profile missing openLive as offline', async () => {
    const httpGet = jest.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce(envelope({ ...channel, openLive: undefined }));
    await expect(createChzzkInfoClient({ httpGet }).getLiveStatus('channel-a')).rejects.toThrow('status');
  });

  test('does not let empty metadata override confirmed live state', async () => {
    const httpGet = jest.fn().mockResolvedValueOnce(envelope({ status: 'OPEN' }))
      .mockResolvedValueOnce(envelope({ topExposedVideos: { openLive: null } }));
    expect(await createChzzkInfoClient({ httpGet }).getLiveDetail('channel-a')).toMatchObject({ status: 'OPEN', metadataPartial: true });
  });

  test.each([{}, { channelId: 'other', liveTitle: 'Wrong channel' }, { channelId: 'channel-a' }])('rejects incomplete or mismatched channel home metadata: %j', async (live) => {
    const httpGet = jest.fn().mockResolvedValueOnce(envelope({ status: 'OPEN' }))
      .mockResolvedValueOnce(envelope({ topExposedVideos: { openLive: live } }));
    expect(await createChzzkInfoClient({ httpGet }).getLiveDetail('channel-a')).toEqual({ status: 'OPEN', metadataPartial: true });
  });

  test('does not load home feed for an offline stream', async () => {
    const httpGet = jest.fn().mockResolvedValue(envelope({ status: 'CLOSE' }));
    expect(await createChzzkInfoClient({ httpGet }).getLiveDetail('channel-a')).toMatchObject({ status: 'CLOSE' });
    expect(httpGet).toHaveBeenCalledTimes(1);
  });

  test('bounds fallback requests by the remaining lookup deadline', async () => {
    let now = 100;
    const httpGet = jest.fn().mockImplementationOnce(async () => { now = 5100; throw new Error('timeout'); });
    const client = createChzzkInfoClient({ httpGet, now: () => now });
    await expect(client.getLiveStatus('channel-a', { deadlineAt: 5100 })).rejects.toMatchObject({ code: 'blueprint_variable_lookup_timeout' });
    expect(httpGet).toHaveBeenCalledTimes(1);
    expect(httpGet.mock.calls[0][1].timeout).toBe(5000);
  });
});
