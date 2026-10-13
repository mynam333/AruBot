const load = require('./helpers/load-server-functions.cjs');

describe('offline donation test platform context', () => {
  const bindings = {
    ownerUserIdFromSid: sid => sid.replace(/^user:/, ''),
    listPlatformAccounts: async () => [{ provider: 'chzzk', channel_id: 'chzzk-channel' }, { provider: 'cime', channel_id: 'cime-channel' }, { provider: 'youtube', channel_id: 'login-channel' }],
    sessionStore: new Map(), cimeSessionStore: new Map(), youtubeSessionStore: new Map(),
    getYoutubeStreamerChannel: async () => ({ youtubeChannelId: 'registered-broadcast-channel' }),
    makeChzzkChatPost: (sessionKey, accessToken, username, extra) => ({ provider: 'chzzk', sessionKey, accessToken, username, ...extra }),
    makeCimeChatPost: (owner, username, extra) => ({ provider: 'cime', owner, username, ...extra }),
    makeYoutubeChatPost: (owner, liveChatId, username, extra) => ({ provider: 'youtube', owner, liveChatId, username, ...extra }),
  };
  test.each(['chzzk', 'cime', 'youtube'])('%s resolves without a live runtime or live API lookup', async provider => {
    const { resolveDonationTestContext } = load(['resolveDonationTestContext'], bindings);
    const result = await resolveDonationTestContext('user:owner', provider, '시청자 1');
    expect(result.channelUid).toBe(provider === 'youtube' ? 'registered-broadcast-channel' : `${provider}-channel`);
    expect(result.chatPost.provider).toBe(provider);
    expect(result.chatPost.username).toBe('시청자 1');
  });
  test('unlinked platforms cannot execute another channel test', async () => {
    const { resolveDonationTestContext } = load(['resolveDonationTestContext'], { ...bindings, listPlatformAccounts: async () => [] });
    await expect(resolveDonationTestContext('user:owner', 'chzzk', '시청자 1')).rejects.toMatchObject({ status: 400 });
  });
  test('invalid command regex is rejected before writes', async () => {
    const getBotRules = jest.fn(), upsertBotRule = jest.fn();
    const handler = load.route('/api/bot/rules/upsert', { getBotRulesOwnerSid: async () => 'user:owner', getBotRules, upsertBotRule }, 'post');
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await handler({ body: { rule: { id: 'rule', regex: true, keywords: ['['] } } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(getBotRules).not.toHaveBeenCalled();
    expect(upsertBotRule).not.toHaveBeenCalled();
  });
});
