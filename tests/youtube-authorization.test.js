const loadSource = require('./helpers/load-source.cjs');
const { validateYoutubeGrant, isYoutubeGrantRevoked } = loadSource('server/youtube-authorization.js');

describe('YouTube authorization compatibility', () => {
  const legacy = { accessToken: 'legacy', scope: 'https://www.googleapis.com/auth/youtube.force-ssl', selectedChannelId: 'channel-a' };
  const dependencies = () => ({
    fetchIdentity: jest.fn().mockResolvedValue({ platformUserId: 'google:hash', googleSubjectHash: 'hash' }),
    fetchChannels: jest.fn().mockResolvedValue([{ channelId: 'channel-a' }]),
    assertIdentity: jest.fn(),
  });

  test('validates pre-OpenID bot tokens without requiring new permissions', async () => {
    const deps = dependencies();
    await expect(validateYoutubeGrant(legacy, deps)).resolves.toEqual({ googleSubjectHash: null });
    expect(deps.fetchIdentity).not.toHaveBeenCalled();
    expect(deps.fetchChannels).toHaveBeenCalledWith('legacy');
  });

  test('validates legacy streamer tokens against their original channel', async () => {
    await expect(validateYoutubeGrant({ accessToken: 'old', platformUserId: 'channel-a' }, dependencies())).resolves.toBeTruthy();
    await expect(validateYoutubeGrant({ ...legacy, selectedChannelId: 'channel-b' }, dependencies())).rejects.toMatchObject({ code: 'youtube_channel_mismatch' });
  });

  test('keeps OpenID validation independent of the Data API quota', async () => {
    const deps = dependencies();
    deps.fetchChannels.mockRejectedValue(new Error('quota exhausted'));
    await validateYoutubeGrant({ ...legacy, scope: `${legacy.scope} openid profile`, googleSubjectHash: 'hash' }, deps);
    expect(deps.assertIdentity).toHaveBeenCalledWith(expect.any(Object), '', 'hash');
    expect(deps.fetchChannels).not.toHaveBeenCalled();
  });

  test('does not downgrade a bound Google identity after an identity check fails', async () => {
    const deps = dependencies();
    deps.assertIdentity.mockImplementation(() => { throw new Error('identity mismatch'); });
    await expect(validateYoutubeGrant({ ...legacy, platformUserId: 'google:other' }, deps)).rejects.toThrow('identity mismatch');
    expect(deps.fetchChannels).not.toHaveBeenCalled();
  });

  test.each([403, 429, 500, 503])('does not revoke a connection on HTTP %s', async (status) => {
    const error = { response: { status, data: { error: { message: 'quota exceeded' } } } };
    const deps = dependencies();
    deps.fetchChannels.mockRejectedValue(error);
    await expect(validateYoutubeGrant(legacy, deps)).rejects.toBe(error);
    expect(isYoutubeGrantRevoked(error)).toBe(false);
  });

  test('recognizes a revoked grant and an invalid access token', () => {
    expect(isYoutubeGrantRevoked({ response: { status: 400, data: { error: 'invalid_grant' } } })).toBe(true);
    expect(isYoutubeGrantRevoked({ response: { status: 401 } })).toBe(true);
  });
});
