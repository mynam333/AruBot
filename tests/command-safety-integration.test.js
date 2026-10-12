const fs = require('fs');
const path = require('path');
const loadFunctions = require('./helpers/load-server-functions.cjs');
const load = require('./helpers/load-source.cjs');
const { createCommandExecutionSafety } = load('server/command-execution-safety.js');
const { createCommandAdmission } = load('server/command-admission.js');
const { createParticipationWheelRuntime } = load('server/participation-wheel-runtime.js', {
  '../shared/text-safety.js': load('shared/text-safety.js'),
  './request-protection.js': load('server/request-protection.js', {
    '../shared/text-safety.js': load('shared/text-safety.js'),
    '../shared/drawing/limits.js': load('shared/drawing/limits.js'),
  }),
  './participation-wheel.js': { parseParticipationWheelSettings: () => ({}) },
});

test('a blocked prediction never reads or charges a balance and emits no spam reply', async () => {
  const placePredictionBet = jest.fn();
  const getActivePredictionForChannel = jest.fn();
  const { handlePredictionBetCommand } = loadFunctions(['handlePredictionBetCommand'], {
    parsePredictionBetCommand: () => ({ option: '1', amount: 100 }),
    admitChatCommand: async () => false, placePredictionBet, getActivePredictionForChannel,
  });
  expect(await handlePredictionBetCommand({ sid: 'owner', channelUid: 'channel', userId: 'viewer', provider: 'chzzk', text: '!예측 1 100' })).toBe('');
  expect(placePredictionBet).not.toHaveBeenCalled();
  expect(getActivePredictionForChannel).not.toHaveBeenCalled();
});

test('a blocked attendance command cannot mutate attendance or points', async () => {
  const recordAttendanceAndGetStreak = jest.fn();
  const { recordAttendanceFromCommand } = loadFunctions(['recordAttendanceFromCommand'], {
    attendanceFeatureEnabled: () => true, admitChatCommand: async () => false, recordAttendanceAndGetStreak,
  });
  expect(await recordAttendanceFromCommand({ sid: 'owner', settings: {}, provider: 'youtube', userId: 'viewer' })).toBeNull();
  expect(recordAttendanceAndGetStreak).not.toHaveBeenCalled();
});

test('wheel commands share the admission budget and do not deduct when blocked', async () => {
  const guard = createCommandAdmission({ limits: { burst: 1 } });
  const input = { sid: 'user:owner', provider: 'cime', userId: 'viewer', username: 'Viewer', text: '!참여 hello' };
  await guard.admit(input);
  const enterWheel = jest.fn();
  const runtime = createParticipationWheelRuntime({
    getWheel: async () => ({ collecting: true, settings: { chat: { enabled: true, command: '!참여' } } }),
    enterWheel, admitCommand: async (actor) => (await guard.admit(actor)).allowed,
  });
  expect(await runtime.chat(input)).toEqual({ handled: true, reply: '' });
  expect(enterWheel).not.toHaveBeenCalled();
  expect(await runtime.chat({ ...input, text: 'normal chat' })).toEqual({ handled: false });
});

function blueprintRuntime(count) {
  const blueprint = { id: 'loop-test', enabled: true, version: { published: true, nodes: [
    { id: 'start', type: 'start' }, { id: 'loop', type: 'loop', config: { count } },
    { id: 'log', type: 'log', config: { message: 'test' } }, { id: 'end', type: 'end' },
  ], edges: [ { source: 'start', target: 'loop' }, { source: 'loop', sourcePort: 'true', target: 'log' }, { source: 'loop', sourcePort: 'false', target: 'end' } ] } };
  const steps = [];
  const { executeActionBlueprint } = loadFunctions(['executeActionBlueprint'], {
    getRuntimeActionBlueprint: async () => blueprint,
    normalizeBlueprintEdges: (edges) => edges, validateBlueprintGraph: () => [],
    insertActionBlueprintRun: async () => ({ id: 'run' }),
    finishActionBlueprintRun: async (_, id, update) => ({ id, ...update }),
    insertActionBlueprintRunStep: async (_, step) => { steps.push(step); },
    normalizeBlueprintReadContext: (context) => context,
    createActionBlueprintVariableResolvers: () => ({}),
    hydrateBlueprintReadContext: async ({ context }) => context,
    mergeBlueprintReadContexts: (a, b) => ({ ...a, ...b }),
    getKstDateString: () => '2026-10-12', buildBlueprintScope: () => ({}),
    evaluateBlueprintValue: (value) => value, renderBlueprintTemplate: (text) => text,
    blueprintOutputPorts: (node) => node.type === 'loop' ? ['true', 'false'] : ['out'],
  });
  return { run: () => executeActionBlueprint('owner', 'loop-test', { dryRun: true }), steps };
}

test('the real blueprint executor keeps normal timing/loop behavior and accepts zero', async () => {
  for (const count of [0, 1, 10]) {
    const runtime = blueprintRuntime(count);
    expect((await runtime.run()).ok).toBe(true);
    expect(runtime.steps.filter((step) => step.nodeId === 'log')).toHaveLength(count);
  }
});

test('the real blueprint executor reports excessive dynamic loops as failed runs', async () => {
  const runtime = blueprintRuntime(1000000000);
  const result = await runtime.run();
  expect(result).toMatchObject({ ok: false, errorCode: 'command_safety_loop_limit', run: { status: 'failed' } });
  expect(runtime.steps.filter((step) => step.nodeId === 'log')).toHaveLength(0);
});

test('a durable roulette captures server-owned ancestry instead of trusting the input item', async () => {
  const commandExecution = createCommandExecutionSafety();
  const persisted = [];
  const { enqueueRouletteSpin } = loadFunctions(['enqueueRouletteSpin', 'sanitizeRouletteJobItem'], {
    commandExecution, crypto: require('node:crypto'), reserveRouletteEnqueue: () => ({ accepted: true, position: 1 }),
    commandAdmissionStore: { claimChainJob: async () => true },
    enqueueDurableRuntimeJob: async (job) => { persisted.push(job); }, runDurableRuntimeWorker: async () => {},
    rouletteQueues: new Map(), rouletteLastEnqueue: new Map(),
  });
  await commandExecution.run('user:owner', 'roulette:parent', () => enqueueRouletteSpin('user:owner', {
    name: 'child', userId: 'viewer', executionChain: { path: [] }, chatPost: { accessToken: 'secret' },
  }));
  expect(persisted[0].payload.item.executionChain.path).toEqual(['roulette:parent']);
  expect(persisted[0].payload.item.chatPost).not.toHaveProperty('accessToken');
});

test('all platform custom commands check admission before cooldown claims and point deduction', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  for (const provider of ['chzzk', 'youtube', 'cime']) {
    const start = source.indexOf(`if (!await admitChatCommand(sid, '${provider}', resolvedUserId)) return;`);
    expect(start).toBeGreaterThan(0);
    const next = source.slice(start, start + 10000);
    expect(next.indexOf('claimBotRuleCooldown')).toBeGreaterThan(0);
    expect(next.indexOf('deductChannelPointsIfEnough')).toBeGreaterThan(next.indexOf('claimBotRuleCooldown'));
  }
});

test.each(['youtube', 'cime'])('%s rejects a real matched paid command before cooldown and deduction', async (provider) => {
  const functionName = provider === 'youtube' ? 'processYoutubeChatAutomation' : 'processCimeChatAutomation';
  const admitChatCommand = jest.fn(async () => false);
  const claimBotRuleCooldown = jest.fn();
  const deductChannelPointsIfEnough = jest.fn();
  const bindings = {
    getBotSettings: async () => ({ botEnabled: true, attendanceCommandOnly: false }),
    refreshYoutubeLiveStatus: async () => ({ live: false }), refreshCimeLiveStatus: async () => false,
    isLikelyYoutubeSelfEcho: () => false, isLikelyCimeBotSelfEcho: async () => false,
    participationWheelRuntime: { chat: async () => ({ handled: false }) }, handlePredictionBetCommand: async () => null,
    getRuntimeBotRulesWithDefaults: async () => [{ id: 'paid', keywords: ['!paid'], enabled: true, pointsCost: 100 }],
    ...load('server/command-keyword.js', { '../shared/text-safety.js': load('shared/text-safety.js') }),
    admitChatCommand, claimBotRuleCooldown, deductChannelPointsIfEnough,
  };
  const functions = loadFunctions([functionName], bindings);
  await functions[functionName]({ ownerUserId: 'owner', primarySid: 'user:owner', channelId: 'channel', connected: false },
    { message: '!paid', userId: 'viewer', user: 'Viewer', role: {} });
  expect(admitChatCommand).toHaveBeenCalledWith('user:owner', provider, 'viewer');
  expect(claimBotRuleCooldown).not.toHaveBeenCalled();
  expect(deductChannelPointsIfEnough).not.toHaveBeenCalled();
});
