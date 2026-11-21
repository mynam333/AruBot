const { EventEmitter } = require('node:events');
const load = require('./helpers/load-source.cjs');
const loadFunctions = require('./helpers/load-server-functions.cjs');
const commands = load('server/command-keyword.js', {
  '../shared/text-safety.js': load('shared/text-safety.js'), './rule-pattern.js': load('server/rule-pattern.js'),
});
const sid = 'user:owner';

async function chat(provider, options = {}) {
  const { template = 'plain', alternatives = [], args = '3', userId = 'viewer', cost = 20, channel = 'channel' } = options;
  const settings = { botEnabled: true, channelPointsPerChat: 0 };
  const sent = [];
  const debit = jest.fn(options.debit || (async () => ({ deducted: true, balanceBefore: 100, balanceAfter: 40 })));
  const spin = jest.fn(), desktop = jest.fn(), warudo = jest.fn(), action = jest.fn(async () => ({ used: false }));
  const media = jest.fn(options.enqueueMedia || (async () => 'accepted'));
  const liveChange = jest.fn(async (_sid, text) => ({ text, executed: [] }));
  const wheel = jest.fn(async () => ({ handled: !!options.wheel }));
  const bindings = {
    ...commands, ...load('server/counter-variables.js'), ...load('shared/songbook-commands.js'),
    crypto: require('node:crypto'), ownerUserIdFromSid: () => 'owner', assertProviderRuntimeConnected() {},
    ensureProviderRuntimeLease: async () => {}, ensureSubscribed: async () => {},
    chatIngress: { enabled: true, ensure: async () => ({ sessionKey: 'session', connected: true, subscribed: true }) },
    sessionStore: new Map(), channelSessionStore: new Map(), sessionCreatePromises: new Map(), ingressProviderState: new Map(),
    chzzkRuntimeErrors: new Map(), createIngressSocket: () => new EventEmitter(), pushEvent() {}, relayChzzkAvatarEvent() {},
    globalProcessedChat: new Map(), globalSentReplies: new Map(), rememberOutboundMessage() {},
    getBotSettings: async () => settings, getOwnerInfoForSid: async () => ({ channelId: 'owner' }),
    refreshChzzkLiveStatusForEvent: async () => ({ live: true, channelId: channel }),
    refreshYoutubeLiveStatus: async () => ({ live: false }), refreshCimeLiveStatus: async () => false,
    resolveChzzkChannelUidsForSid: async () => channel ? [channel] : [], resolveStreamerUidForSid: async () => channel,
    shouldRecordAttendanceAutomatically: () => false, normalizePointAward: () => 0,
    isLikelyYoutubeSelfEcho: () => false, isLikelyCimeBotSelfEcho: async () => false, isLikelyChzzkBotSelfEcho: async () => false,
    marbleRuntime: { chat: async () => ({ handled: false }) }, participationWheelRuntime: { chat: wheel }, handlePredictionBetCommand: async () => null,
    getRuntimeBotRulesWithDefaults: async () => [{ id: 'rule', keywords: ['!buy'], enabled: true, pointsCost: cost, responses: [template, ...alternatives] }],
    claimBotRuleCooldown: async () => ({ claimed: true }), deductChannelPointsIfEnough: debit,
    makeYoutubeChatPost: () => ({}), makeCimeChatPost: () => ({}), makeChzzkChatPost: () => ({}),
    executeCommandLiveChangeTokens: liveChange, substituteAllPlaceholders: async text => text.replace('{user.name}', options.nickname || 'Viewer'),
    resolveCommandCounterVariables: async (_plan, text) => text, executeSongbookCommand: async text => text,
    executeAndStripActionVariableTokens: action, enqueueRouletteSpin: spin, enqueueVideoDonationFromArgs: media,
    broadcastToDesktop: desktop, emitWarudoEvent: warudo, makeCommandReplyKey: () => 'event',
    recordCommandExecutionLog: jest.fn(), getValidAccessToken: async () => 'token', OPENAPI_BASE: 'mock',
    sendYoutubeChat: async (_owner, _chat, text) => sent.push(text), sendCimeChat: async (_owner, text) => sent.push(text),
    axios: { post: async (_url, body) => sent.push(body.message) },
    updateBotSettingsAtomically: async () => ({ rouletteViewerToken: 'token' }), rouletteTokenToSid: new Map(),
    console: { log() {}, warn() {}, error() {} },
  };
  const msg = `!buy ${args}`, nickname = options.nickname || 'Viewer';
  const random = jest.spyOn(Math, 'random').mockReturnValue(0);
  try {
    if (provider === 'chzzk') {
      const h = loadFunctions(['ensureChzzkSessionOwned', 'spendChatCommandPoints', 'firstNonEmptyText'], bindings);
      const entry = await h.ensureChzzkSessionOwned(sid, channel);
      await entry.socket.listeners('CHAT')[0]({ senderChannelId: userId, profile: { nickname }, content: msg });
    } else {
      const name = provider === 'cime' ? 'processCimeChatAutomation' : 'processYoutubeChatAutomation';
      const h = loadFunctions([name, 'spendChatCommandPoints'], bindings);
      await h[name]({ primarySid: sid, ownerUserId: 'owner', channelId: channel, remoteIngress: true, sentReplies: new Set() },
        { message: msg, userId, user: nickname, role: {} });
    }
  } finally { random.mockRestore(); }
  return { debit, spin, liveChange, action, media, desktop, warudo, wheel, sent, log: bindings.recordCommandExecutionLog };
}

describe.each(['chzzk', 'cime', 'youtube'])('%s chat purchases', provider => {
  test('only the chosen response selects the pool; rendered tokens are not purchases', async () => {
    const r = await chat(provider, { template: '{user.name}', alternatives: ['${roulette::ignored}'], nickname: '${roulette::fake} ${bgm_request}' });
    expect(r.debit.mock.calls).toEqual([['channel', 'viewer', '${roulette::fake} ${bgm_request}', 20, { sid, category: 'command' }]]);
    expect(r.spin).not.toHaveBeenCalled();
    expect(r.media).not.toHaveBeenCalled();
    expect(r.desktop).toHaveBeenCalledTimes(1);
  });

  test('a bonus-only batch is charged once, then enqueued with the same clamped count', async () => {
    const debit = async (_channel, _id, _name, amount, context) => ({
      deducted: context?.sid === sid && context.category === 'roulette' && amount === 200,
      balanceBefore: 200, balanceAfter: 0, ordinarySpent: 0, bonusSpent: 200,
    });
    const r = await chat(provider, { template: '${roulette::Wheel}', args: '99', debit });
    expect(r.debit.mock.calls).toEqual([['channel', 'viewer', 'Viewer', 200, { sid, category: 'roulette' }]]);
    expect(r.spin).toHaveBeenCalledTimes(10);
    expect(r.spin.mock.calls[0][1]).toMatchObject({ name: 'Wheel', instant: false, eventContext: { pointDelta: -200, pointBefore: 200, pointAfter: 0 } });
    expect(r.spin.mock.calls.slice(1).every(([, item]) => item.instant)).toBe(true);
  });

  test.each(['denied', 'error', 'no viewer', 'no channel'])('%s cannot trigger any command effects', async failure => {
    const r = await chat(provider, { template: '${live.title_change} ${roulette::Wheel} ${video_donation} ${blueprint::action}',
      userId: failure === 'no viewer' ? '' : 'viewer', channel: failure === 'no channel' ? '' : 'channel',
      debit: async () => { if (failure === 'error') throw Error('unavailable'); return { deducted: false, balanceBefore: 5 }; } });
    expect(r.debit).toHaveBeenCalledTimes(failure.startsWith('no ') ? 0 : 1);
    for (const effect of [r.spin, r.liveChange, r.action, r.media, r.warudo, r.desktop]) expect(effect).not.toHaveBeenCalled();
    expect(r.sent).toHaveLength(1);
    if (failure === 'denied') expect(r.sent[0]).toContain('60 필요, 5 보유');
    expect(r.log.mock.calls[0][1]).toMatchObject({ executed: false, pointDelta: 0 });
  });

  test.each(['${video_donation}', '${bgm_request}'])('%s charges the command fee without letting rendered data change media kind', async token => {
    const r = await chat(provider, { template: token + ' {user.name}', nickname: '${bgm_request}', args: 'example' });
    expect(r.debit.mock.calls).toEqual([['channel', 'viewer', '${bgm_request}', 20, { sid, category: 'command' }]]);
    expect(r.media.mock.calls[0][0].response.trim()).toBe(token);
  });

  test('a media command without a configured fee only invokes the feature purchase', async () => {
    const r = await chat(provider, { template: '${video_donation}', cost: 0 });
    expect(r.debit).not.toHaveBeenCalled();
    expect(r.media).toHaveBeenCalledTimes(1);
  });

  test('an empty roulette target is not charged as a plain command', async () => {
    const r = await chat(provider, { template: '${roulette:: }' });
    expect(r.debit).not.toHaveBeenCalled();
    expect(r.spin).not.toHaveBeenCalled();
    expect(r.desktop).not.toHaveBeenCalled();
    expect(r.sent).toEqual(['룰렛 이름이 필요합니다.']);
  });

  test('wheel-owned purchases do not fall through to a paid chat rule', async () => {
    const r = await chat(provider, { wheel: true, template: '${roulette::Wheel}' });
    expect(r.wheel.mock.calls[0][0]).toMatchObject({ sid, userId: 'viewer' });
    expect(r.debit).not.toHaveBeenCalled();
    expect(r.spin).not.toHaveBeenCalled();
  });
});
