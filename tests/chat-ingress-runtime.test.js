const loadServerFunctions = require('./helpers/load-server-functions.cjs');

test('buffered YouTube messages older than worker startup are processed and awaited', async () => {
  const entry = { acceptAfterTs: Date.now(), queue: [] };
  let finish;
  const command = new Promise(resolve => { finish = resolve; });
  const processYoutubeChatAutomation = jest.fn(() => command);
  const { dispatchIngressEvent } = loadServerFunctions(['dispatchIngressEvent'], {
    assertProviderRuntimeConnected: jest.fn(),
    ensureIngressProviderEntry: async () => entry,
    normalizeYoutubeLiveChatItem: payload => ({ eventName: 'CHAT', ev: payload }),
    pushEvent: (target, event) => target.queue.push(event),
    processYoutubeChatAutomation,
  });
  let acknowledged = false;
  const ev = { provider: 'youtube', ownerUserId: 'owner', eventName: 'CHAT_ITEM', payload: { message: '!hello', ts: Date.now() - 60000 } };
  const processing = dispatchIngressEvent(ev).then(() => { acknowledged = true; });
  await Promise.resolve();
  expect(processYoutubeChatAutomation).toHaveBeenCalledTimes(1);
  expect(acknowledged).toBe(false);
  finish();
  await processing;
  expect(acknowledged).toBe(true);
  expect(entry.queue).toEqual([ev.payload]);
});

test('CIME donation processing is awaited even when the stream is offline', async () => {
  const entry = { connected: false };
  const expected = new Error('ambiguous external side effect');
  const { dispatchIngressEvent } = loadServerFunctions(['dispatchIngressEvent'], {
    assertProviderRuntimeConnected: jest.fn(), ensureIngressProviderEntry: async () => entry,
    parseCimeEvent: () => ({ eventName: 'DONATION', ev: { message: 'donation', amount: 1000 } }),
    pushEvent: jest.fn(), processCimeDonationAutomation: async () => { throw expected; },
  });
  await expect(dispatchIngressEvent({ provider: 'cime', ownerUserId: 'owner', eventName: 'MESSAGE', payload: '{}' })).rejects.toBe(expected);
});

test('CHZZK ingress dispatch awaits the original socket handler rather than emitting fire-and-forget', async () => {
  const dispatch = jest.fn(async () => 'complete');
  const ensureSession = jest.fn(async () => ({ socket: { dispatch } }));
  const { dispatchIngressEvent } = loadServerFunctions(['dispatchIngressEvent'], {
    assertProviderRuntimeConnected: jest.fn(), ensureSession,
  });
  const payload = { content: '!command' };
  await dispatchIngressEvent({ provider: 'chzzk', ownerUserId: 'owner', sid: 'user:owner', channelId: 'channel', eventName: 'CHAT', payload });
  expect(ensureSession).toHaveBeenCalledWith('user:owner', 'channel');
  expect(dispatch).toHaveBeenCalledWith('CHAT', payload);
});

test('standby runtimes do not claim durable jobs or write live session transitions', async () => {
  const claimDurableRuntimeJobs = jest.fn();
  const getLiveSessionFromDB = jest.fn();
  const { runDurableRuntimeWorker, updateSessionStateLocked } = loadServerFunctions(['runDurableRuntimeWorker', 'updateSessionStateLocked'], {
    chatIngress: { enabled: true, canRun: () => false }, durableRuntimeWorkerRunning: false,
    claimDurableRuntimeJobs, getLiveSessionFromDB,
  });
  expect(await runDurableRuntimeWorker()).toBe(false);
  expect(await updateSessionStateLocked('user:owner', true, 123)).toEqual({ operation: 'ignore_observation', reason: 'runtime_standby' });
  expect(claimDurableRuntimeJobs).not.toHaveBeenCalled();
  expect(getLiveSessionFromDB).not.toHaveBeenCalled();
});

test('worker provider facade preserves reply dedupe and uses the ingress session metadata', async () => {
  const youtubeSessionStore = new Map();
  const saved = { sentReplies: new Set(['old-reply']) };
  const ensure = jest.fn(async () => ({ connected: true, subscribed: true, channelId: 'streamer', liveChatId: 'live', botChannelId: 'bot' }));
  const { ensureIngressProviderEntry } = loadServerFunctions(['ensureIngressProviderEntry'], {
    assertProviderRuntimeConnected: jest.fn(), chatIngress: { ensure }, youtubeSessionStore,
    cimeSessionStore: new Map(), activeSids: new Map(), ingressProviderState: new Map([['youtube:owner', saved]]),
  });
  const first = await ensureIngressProviderEntry('youtube', 'owner');
  const second = await ensureIngressProviderEntry('youtube', 'owner');
  expect(second).toBe(first);
  expect(first.liveChatId).toBe('live');
  expect(first.acceptAfterTs).toBe(0);
  expect(first.sentReplies.has('old-reply')).toBe(true);
});

test.each(['Youtube', 'Cime'])('%s donation point failures are not acknowledged as success in ingress mode', async provider => {
  const error = new Error('point transaction outcome unknown');
  const name = `process${provider}DonationAutomation`;
  const { [name]: processDonation } = loadServerFunctions([name], {
    getBotSettingsStrict: async () => ({ donation: { pointsPerK: 10 } }),
    marbleRuntime: { donation: async () => {} }, participationWheelRuntime: { donation: async () => {} },
    calculateDonationPointAward: () => 10, isChannelPointExcluded: async () => false,
    incrChannelPoints: async () => { throw error; }, console: { error() {}, warn() {} },
  });
  await expect(processDonation({ ownerUserId: 'owner', channelId: 'channel', remoteIngress: true }, {
    currency: 'KRW', amount: 1000, userId: 'viewer', user: 'Viewer', message: '',
  })).rejects.toBe(error);
});

test('CHZZK original donation listener propagates failed actions through the durable facade', async () => {
  const { EventEmitter } = require('node:events');
  const expected = new Error('blueprint failed');
  const { ensureChzzkSessionOwned } = loadServerFunctions(['ensureChzzkSessionOwned'], {
    ownerUserIdFromSid: sid => sid.replace('user:', ''), assertProviderRuntimeConnected() {},
    ensureProviderRuntimeLease: async () => {},
    chatIngress: { enabled: true, ensure: async () => ({ sessionKey: 'session', connected: true, subscribed: true }) },
    sessionStore: new Map(), channelSessionStore: new Map(), sessionCreatePromises: new Map(), ingressProviderState: new Map(),
    chzzkRuntimeErrors: new Map(), ensureSubscribed: async () => {},
    createIngressSocket: () => new EventEmitter(), pushEvent() {}, relayChzzkAvatarEvent() {},
    getBotSettingsStrict: async () => ({ donationRules: [{ id: 'rule', enabled: true }] }),
    marbleRuntime: { donation: async () => {} }, participationWheelRuntime: { donation: async () => {} },
    calculateDonationPointAward: () => 0, donationRuleMatchesAmount: () => true, donationRuleMatchesMessage: () => true,
    makeChzzkChatPost: () => ({}),
    renderDonationRuleResponse: async () => { throw expected; }, console: { error() {}, warn() {} },
  });
  const entry = await ensureChzzkSessionOwned('user:owner', 'channel');
  const listener = entry.socket.listeners('DONATION')[0];
  await expect(listener({ donatorChannelId: 'viewer', donatorNickname: 'Viewer', payAmount: 1000, donationText: '' })).rejects.toBe(expected);
});

test('rendered donation action failures are surfaced in ingress mode', async () => {
  const { renderDonationRuleResponse } = loadServerFunctions(['renderDonationRuleResponse'], {
    dispatchDonationRuleDesktop: () => ({ desktopSent: 1, repeatCount: 1, completion: Promise.resolve() }),
    broadcastToDesktop() {}, renderDonationResponse: async () => ({ text: '', errors: [{ error: new Error('effect failed') }] }),
    substituteAllPlaceholders() {}, executeAndStripActionVariableTokens() {}, enqueueRouletteSpin() {},
    resolveCommandCounterVariables() {}, memoVariableStore: { read() {} }, resolveSongbookPublicUrl() {},
    console: { warn() {}, error() {} },
  });
  await expect(renderDonationRuleResponse({ response: '' }, { ingressEvent: true, provider: 'chzzk' })).rejects.toThrow('ingress_donation_effect_incomplete');
});

test('manual donation test repeats are tracked for deployment even without an ingress event', async () => {
  let finish;
  const completion = new Promise(resolve => { finish = resolve; });
  const tracked = jest.spyOn(completion, 'catch');
  const { renderDonationRuleResponse } = loadServerFunctions(['renderDonationRuleResponse'], {
    chatIngress: { enabled: true },
    dispatchDonationRuleDesktop: () => ({ desktopSent: 1, repeatCount: 3, completion }),
    broadcastToDesktop() {}, renderDonationResponse: async () => ({ text: '', errors: [] }),
    substituteAllPlaceholders() {}, executeAndStripActionVariableTokens() {}, enqueueRouletteSpin() {},
    resolveCommandCounterVariables() {}, memoVariableStore: { read() {} }, resolveSongbookPublicUrl() {},
  });
  const result = await renderDonationRuleResponse({ response: '' }, { provider: 'chzzk', source: 'donation-test' });
  expect(result.repeatCount).toBe(3);
  expect(tracked).toHaveBeenCalledTimes(1);
  finish();
  await completion;
});
