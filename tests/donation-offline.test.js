const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const load = require('./helpers/load-source.cjs');
const loadFunctions = require('./helpers/load-server-functions.cjs');

const source = ts.createSourceFile('index.js', fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8'), ts.ScriptTarget.Latest, true);
let donationCallback;
function findDonationCallback(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'socket.on' && node.arguments[0]?.text === 'DONATION') {
    donationCallback = node.arguments[1].getText(source);
  }
  ts.forEachChild(node, findDonationCallback);
}
findDonationCallback(source);

function harness(provider = 'chzzk') {
  const entry = { ownerUserId: 'owner', primarySid: 'user:owner', channelId: 'channel', sessionKey: 'session', connected: false, queue: [] };
  const rule = { id: 'rule', name: 'thanks', enabled: true, minAmount: 1000, response: '${blueprint::thanks} ${roulette::wheel}' };
  const settings = { onlyWhenLive: true, donation: { pointsPerK: 10 }, donationRules: [rule] };
  const bindings = {
    ...load('server/rule-pattern.js'),
    entry, sessionStore: new Map([['user:owner', entry]]),
    inspectTextPayload: jest.fn(() => null),
    pushEvent: jest.fn((target, event) => target.queue.push(event)), relayChzzkAvatarEvent: jest.fn(),
    getBotSettings: jest.fn(async () => settings),
    resolveChzzkChannelUidsForSid: jest.fn(async () => ['resolved-channel']),
    refreshChzzkLiveStatusForEvent: jest.fn(async () => { throw new Error('live status unavailable'); }),
    refreshYoutubeLiveStatus: jest.fn(async () => { throw new Error('live status unavailable'); }),
    refreshCimeLiveStatus: jest.fn(async () => { throw new Error('live status unavailable'); }),
    marbleRuntime: { donation: jest.fn(async () => {}) },
    participationWheelRuntime: { donation: jest.fn(async () => {}) },
    calculateDonationPointAward: load('server/point-earning-policy.js').calculateDonationPointAward,
    isChannelPointExcluded: jest.fn(async () => false), incrChannelPoints: jest.fn(async () => {}),
    ...loadFunctions(['normalizeDonationAmountOperator', 'normalizeDonationAmountNumber', 'normalizeDonationAmountConditions', 'donationRuleMatchesAmount', 'donationResponseTargetName', 'makeChzzkChatPost']),
    makeCimeChatPost: (_owner, _name, extra) => ({ provider: 'cime', ...extra }),
    makeYoutubeChatPost: (_owner, _chat, _name, extra) => ({ provider: 'youtube', ...extra }),
    broadcastToDesktop: jest.fn(),
    renderDonationRuleResponse: jest.fn(async () => ({ text: 'Thanks', features: ['action', 'roulette'] })),
    recordDonationRuleExecutionLog: jest.fn(async () => {}),
    getValidAccessToken: jest.fn(async () => 'token'), OPENAPI_BASE: 'https://example.test',
    axios: { post: jest.fn(async () => {}) }, sendCimeChat: jest.fn(async () => {}), sendYoutubeChat: jest.fn(async () => {}),
    setTimeout: (callback) => callback(), console: { error: jest.fn(), warn: jest.fn() },
  };
  const raw = { donatorChannelId: 'donor', donatorNickname: 'Viewer', payAmount: 3000, donationText: 'hello' };
  const event = { id: 'donation-1', userId: 'donor', user: 'Viewer', amount: 3000, message: 'hello', currency: 'KRW' };
  const callback = new Function(...Object.keys(bindings), `return (${donationCallback});`)(...Object.values(bindings));
  const others = loadFunctions(['processCimeDonationAutomation', 'processYoutubeDonationAutomation'], bindings);
  const run = provider === 'chzzk' ? () => callback(raw)
    : () => others[provider === 'cime' ? 'processCimeDonationAutomation' : 'processYoutubeDonationAutomation'](entry, event);
  return { entry, settings, rule, bindings, run };
}

describe('received donations do not depend on broadcast state', () => {
  test.each(['chzzk', 'cime', 'youtube'])('%s awards points and runs all matching reactions after broadcast end', async provider => {
    const h = harness(provider);
    h.settings.donationRules.push({ ...h.rule, id: 'second', name: 'second' }, { ...h.rule, id: 'disabled', enabled: false }, { ...h.rule, id: 'expensive', minAmount: 10000 });
    await h.run();
    expect(h.bindings.incrChannelPoints.mock.calls).toEqual([['channel', 'donor', 'Viewer', 30]]);
    expect(h.bindings.marbleRuntime.donation).toHaveBeenCalledTimes(1);
    expect(h.bindings.participationWheelRuntime.donation).toHaveBeenCalledTimes(1);
    expect(h.bindings.renderDonationRuleResponse).toHaveBeenCalledTimes(2);
    expect(h.bindings.renderDonationRuleResponse).toHaveBeenCalledWith(h.rule, expect.objectContaining({ sid: 'user:owner', provider, channelUid: 'channel', amount: 3000 }));
    expect(h.bindings.recordDonationRuleExecutionLog).toHaveBeenCalledTimes(2);
    for (const refresh of ['refreshChzzkLiveStatusForEvent', 'refreshCimeLiveStatus', 'refreshYoutubeLiveStatus']) expect(h.bindings[refresh]).not.toHaveBeenCalled();
    expect(h.bindings.console.error).not.toHaveBeenCalled();
  });

  test.each(['chzzk', 'cime', 'youtube'])('%s chat being unavailable does not cancel effects or point awards', async provider => {
    const h = harness(provider);
    const send = provider === 'chzzk' ? h.bindings.axios.post : h.bindings[provider === 'cime' ? 'sendCimeChat' : 'sendYoutubeChat'];
    send.mockRejectedValue(new Error('chat closed'));
    await h.run();
    expect(send).toHaveBeenCalledTimes(1);
    expect(h.bindings.incrChannelPoints).toHaveBeenCalledTimes(1);
    expect(h.bindings.renderDonationRuleResponse).toHaveBeenCalledTimes(1);
    expect(h.bindings.recordDonationRuleExecutionLog).toHaveBeenCalledTimes(1);
  });

  test('CHZZK in-flight donation retains its owner after session-map cleanup', async () => {
    const h = harness();
    h.bindings.sessionStore.clear();
    h.entry.sessionKey = null;
    await h.run();
    expect(h.bindings.renderDonationRuleResponse).toHaveBeenCalledTimes(1);
    expect(h.bindings.axios.post).not.toHaveBeenCalled();
    expect(h.bindings.incrChannelPoints.mock.calls).toEqual([['channel', 'donor', 'Viewer', 30]]);
  });

  test('CHZZK resolves a missing channel without consulting live state', async () => {
    const h = harness();
    h.entry.channelId = null;
    await h.run();
    expect(h.bindings.incrChannelPoints.mock.calls).toEqual([['resolved-channel', 'donor', 'Viewer', 30]]);
    expect(h.bindings.renderDonationRuleResponse).toHaveBeenCalledWith(h.rule, expect.objectContaining({ channelUid: 'resolved-channel', chatPost: expect.objectContaining({ channelUid: 'resolved-channel' }) }));
  });

  test('CHZZK preserves point exclusions and message matching while offline', async () => {
    const h = harness();
    h.bindings.isChannelPointExcluded.mockResolvedValue(true);
    h.rule.message = '!different';
    await h.run();
    expect(h.bindings.incrChannelPoints).not.toHaveBeenCalled();
    expect(h.bindings.renderDonationRuleResponse).not.toHaveBeenCalled();
    expect(h.bindings.broadcastToDesktop).not.toHaveBeenCalled();
  });
});

describe('offline CHZZK event polling', () => {
  test.each([false, true])('returns queued donations with accurate live=%s and connection state', async live => {
    const donation = { type: 'donation', id: 'donation', ts: 200 };
    const entry = { connected: true, queue: [donation, { type: 'donation', id: 'old', ts: 100 }] };
    const ensureSession = jest.fn(async () => entry);
    const handler = loadFunctions.route('/api/chzzk/events', {
      getPartitionId: async () => 'user:owner', activeSids: new Map(),
      refreshChzzkLiveStatusForSid: async () => ({ live }), ensureSession,
    }, 'get');
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const req = { query: { channelId: 'channel', since: '150' } };
    await handler(req, res);
    expect(ensureSession).toHaveBeenCalledWith('user:owner', 'channel');
    expect(res.json).toHaveBeenCalledWith({ events: [donation], connected: true, live, channelId: 'channel' });
    await handler({ query: { channelId: 'channel', since: '200' } }, res);
    expect(res.json).toHaveBeenLastCalledWith({ events: [], connected: true, live, channelId: 'channel' });
  });
});
