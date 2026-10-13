const loadFunctions = require('./helpers/load-server-functions.cjs');

function commandRuntime(overrides = {}) {
  const rule = { id: 'rule', name: 'Local command', enabled: true, responses: ['response'], pointsCost: 500 };
  const bindings = {
    BLUEPRINT_COMMAND_PLATFORMS: new Set(['chzzk', 'cime', 'youtube']),
    getRuntimeBotRulesWithDefaults: jest.fn(async () => [rule]),
    getCommandRuleMatches: jest.fn(() => [{ rule, match: { matchedText: '!local', argsText: 'argument' } }]),
    prepareMemoVariablePlan: jest.fn((text) => ({ text, entries: [] })),
    prepareCounterVariablePlan: jest.fn((text) => ({ text, entries: [] })),
    resolveCommandMemoVariables: jest.fn(async (_plan, text) => text),
    resolveCommandCounterVariables: jest.fn(async (_plan, text) => text),
    hasSongbookCommandToken: text => /\$\{\s*songbook_(?:request|url)\s*\}/i.test(text),
    executeSongbookCommand: jest.fn(async text => text),
    resolveBlueprintCommandChannelUid: jest.fn(async () => 'channel'),
    makeBlueprintCommandChatPost: jest.fn(() => ({ suppressResultChat: true })),
    executeAndStripActionVariableTokens: jest.fn(async (_sid, text) => ({ text, used: false, jobs: [] })),
    broadcastToDesktop: jest.fn(() => 1),
    getOwnerInfoForSid: jest.fn(async () => ({ channelId: 'real-channel' })),
    emitWarudoEvent: jest.fn(),
    getLiveInfoForSid: jest.fn(async () => ({ live: true })),
    executeCommandLiveChangeTokens: jest.fn(async (_sid, text) => ({ text, executed: [] })),
    substituteAllPlaceholders: jest.fn(async (text) => text),
    enqueueVideoDonationFromArgs: jest.fn(), enqueueRouletteSpin: jest.fn(),
    recordCommandExecutionLog: jest.fn(),
    ...overrides,
  };
  const { executeBlueprintCommandNode } = loadFunctions([
    'executeBlueprintCommandNode', 'emitBlueprintCommandEvent', 'summarizeBlueprintCommandActionJobs',
  ], bindings);
  const run = (context = {}, extra = {}) => executeBlueprintCommandNode({
    ownerUserId: 'owner', sid: 'user:owner', platform: 'chzzk', commandText: '!local argument',
    context, blueprint: { id: 'draft' }, node: { id: 'command-node' }, run: { id: 'run' }, ...extra,
  });
  return { run, bindings, rule };
}

const connected = {
  source: 'manual_test', testMode: 'connected',
  channelUid: 'forged-simulator-channel', user: { userId: 'viewer', username: 'Viewer', isOwner: true, canWrite: true },
};

describe('connected blueprint command delivery', () => {
  test.each(['chzzk', 'cime', 'youtube'])('sends %s commands to the authenticated owner desktop and reports unconfirmed delivery', async (platform) => {
    const { run, bindings, rule } = commandRuntime();
    rule.liveOnly = true;
    const result = await run(connected, { platform });
    expect(result).toMatchObject({ executed: true, commandCostDeducted: false, desktopSent: 1, delivery: { status: 'sent', confirmed: false } });
    expect(bindings.broadcastToDesktop).toHaveBeenCalledWith('user:owner', expect.objectContaining({
      type: 'command', cmd: '!local', args: ['argument'], source: 'blueprint-command',
      metadata: expect.objectContaining({ testMode: 'connected', platform, shouldDeductPoints: false }),
    }));
    for (const name of ['emitWarudoEvent', 'getOwnerInfoForSid', 'resolveBlueprintCommandChannelUid', 'makeBlueprintCommandChatPost', 'getLiveInfoForSid', 'executeCommandLiveChangeTokens', 'substituteAllPlaceholders', 'resolveCommandCounterVariables', 'enqueueVideoDonationFromArgs', 'enqueueRouletteSpin', 'recordCommandExecutionLog']) {
      expect(bindings[name]).not.toHaveBeenCalled();
    }
  });

  test.each([{ source: 'manual_test' }, { ...connected, dryRun: true }])('never sends legacy simulation commands: %j', async (context) => {
    const { run, bindings } = commandRuntime();
    expect(await run(context)).toMatchObject({ executed: false, planned: true, dryRun: true, response: 'response' });
    expect(bindings.broadcastToDesktop).not.toHaveBeenCalled();
    expect(bindings.executeAndStripActionVariableTokens).not.toHaveBeenCalled();
    expect(bindings.resolveCommandMemoVariables).not.toHaveBeenCalled();
  });

  test('reports an unavailable desktop, without silently queuing a later command', async () => {
    const { run, bindings } = commandRuntime({ broadcastToDesktop: jest.fn(() => 0) });
    expect(await run(connected)).toMatchObject({ executed: false, ok: false, error: 'blueprint_desktop_unavailable', desktopSent: 0, delivery: { status: 'not_sent', confirmed: false } });
    expect(bindings.emitWarudoEvent).not.toHaveBeenCalled();
  });

  test('allows blueprint-only command actions through the device-job path with published-only safety', async () => {
    const executeAndStripActionVariableTokens = jest.fn(async () => ({ text: '', used: true, jobs: [{ kind: 'blueprint', ok: true, runId: 'nested-run' }] }));
    const { run } = commandRuntime({ broadcastToDesktop: () => 0, executeAndStripActionVariableTokens });
    expect(await run(connected)).toMatchObject({ executed: true, desktopSent: 0, actions: [{ ok: true, runId: 'nested-run' }] });
    expect(executeAndStripActionVariableTokens).toHaveBeenCalledWith('user:owner', 'response', expect.objectContaining({
      source: 'manual_test', testMode: 'connected', requirePublishedBlueprint: true, noPointCost: true,
    }));
  });

  test('surfaces nested action failures even if desktop command delivery succeeded', async () => {
    const { run } = commandRuntime({ executeAndStripActionVariableTokens: async () => ({ text: '', used: true, jobs: [{ ok: false, error: 'blueprint_local_agent_offline' }] }) });
    expect(await run(connected)).toMatchObject({ executed: false, ok: false, error: 'blueprint_local_agent_offline', desktopSent: 1 });
  });

  test('does not execute special command effects during a connected test', async () => {
    const { run, bindings, rule } = commandRuntime();
    rule.responses = ['${video_donation} ${bgm_request} ${roulette::paid} ${live.title_change} ${counter::user::count} ${songbook_request}'];
    const result = await run(connected);
    expect(result.executed).toBe(true);
    for (const name of ['enqueueVideoDonationFromArgs', 'enqueueRouletteSpin', 'executeCommandLiveChangeTokens', 'resolveCommandCounterVariables', 'executeSongbookCommand']) expect(bindings[name]).not.toHaveBeenCalled();
    expect(result.suppressedEffects).toEqual(expect.arrayContaining(['points', 'audience_chat', 'donations', 'counters']));
  });

  test('reports unknown command rules as unexecuted', async () => {
    const { run, bindings } = commandRuntime({ getCommandRuleMatches: () => [] });
    expect(await run(connected)).toMatchObject({ executed: false, reason: 'command_not_found' });
    expect(bindings.broadcastToDesktop).not.toHaveBeenCalled();
  });
});

describe('blueprint command memo ordering and read-only authority', () => {
  test.each([connected, { source: 'chat-command', user: { isOwner: true, canWrite: true }, canWrite: true }])('resolves memo contents last without synthetic write authority', async (context) => {
    const calls = [];
    const memoPlan = { text: 'MEMO_SENTINEL ${action::safe}', entries: [{ name: 'note' }] };
    const { run, bindings, rule } = commandRuntime({
      prepareMemoVariablePlan: jest.fn((text, options) => { calls.push(['memo-plan', text, options]); return memoPlan; }),
      prepareCounterVariablePlan: jest.fn((text) => { calls.push(['counter-plan', text]); return { text, entries: [] }; }),
      executeAndStripActionVariableTokens: jest.fn(async (_sid, text) => { calls.push(['actions', text]); return { text: 'MEMO_SENTINEL', used: true, jobs: [{ ok: true }] }; }),
      resolveCommandCounterVariables: jest.fn(async (_plan, text) => { calls.push(['counters', text]); return text; }),
      resolveCommandMemoVariables: jest.fn(async (_plan, text, options) => { calls.push(['memo-read', text, options]); return '${action::must-not-execute}'; }),
    });
    rule.responses = ['${memo} ${action::safe}'];
    expect((await run(context)).response).toBe('${action::must-not-execute}');
    expect(calls[0]).toEqual(['memo-plan', rule.responses[0], { ruleId: 'rule' }]);
    expect(calls[1]).toEqual(['counter-plan', memoPlan.text]);
    expect(calls.at(-1)).toEqual(['memo-read', 'MEMO_SENTINEL', { sid: 'user:owner' }]);
    if (context.source !== 'manual_test') expect(calls.at(-2)[0]).toBe('counters');
    expect(bindings.executeAndStripActionVariableTokens).toHaveBeenCalledTimes(1);
    expect(bindings.executeAndStripActionVariableTokens.mock.calls[0][1]).not.toContain('must-not-execute');
    expect(bindings.resolveCommandMemoVariables).toHaveBeenCalledWith(memoPlan, 'MEMO_SENTINEL', { sid: 'user:owner' });
  });
});
