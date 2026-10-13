const load = require('./helpers/load-source.cjs');
const loadFunctions = require('./helpers/load-server-functions.cjs');
const safety = load('server/command-execution-safety.js');
const textSafety = load('shared/text-safety.js');
const counters = load('server/counter-variables.js');
const memos = load('server/memo-variables.js', { '../shared/text-safety.js': textSafety });
const commandKeywords = load('server/command-keyword.js', {
  '../shared/text-safety.js': textSafety, './rule-pattern.js': load('server/rule-pattern.js'),
});
const { renderRouletteResultTemplate } = load('server/roulette-result-template.js', {
  '../shared/text-safety.js': textSafety, './command-execution-safety.js': safety,
  './counter-variables.js': counters, './memo-variables.js': memos,
});
const { getRouletteWheelMetadata } = load('server/roulette-wheel-metadata.js');
const { withRouletteVariableContext } = load('server/roulette-variable-catalog.js');
const { createRouletteResultActionCoordinator } = load('server/roulette-result-action-coordinator.js');
const { createCommandAdmissionStore } = load('server/command-admission-store.js');
const sid = 'user:owner';
const baseContext = { sid, provider: 'chzzk', userId: 'viewer', username: 'Viewer',
  channelUid: 'channel', roulette: { id: 'a', name: 'Wheel A' },
  result: { label: 'Winner', value: 'original' }, chatPost: { provider: 'chzzk', counterUserId: 'raw-viewer' } };

function renderer(overrides = {}) {
  const increment = jest.fn(async () => 7);
  const read = jest.fn(async keys => new Map(keys.map(key => [key, '${roulette::injected}'])));
  const dependencies = {
    commandExecution: safety.createCommandExecutionSafety(),
    substituteAllPlaceholders: jest.fn(async text => text.replace('{user.points}', '100')),
    resolveCommandCounterVariables: async (plan, text, context) => (await counters.resolveCounterVariablePlan(plan, text, {
      ...context, incrementCounter: increment,
    })).text,
    resolveCommandMemoVariables: (plan, text, context) => memos.resolveMemoVariablePlan(plan, text, { ...context, readMemos: read }),
    enqueueRouletteSpin: jest.fn(async () => 1),
    executeAndStripActionVariableTokens: jest.fn(async () => ({ jobs: [{ ok: true }] })),
    executeMediaRequest: jest.fn(async () => 'media accepted'),
    executeSongbookRequest: jest.fn(async () => 'song accepted'),
    executeLiveChange: jest.fn(async () => ({ text: '', errors: [] })),
    ...overrides,
  };
  return { ...dependencies, increment, read,
    render: (template, context = {}) => renderRouletteResultTemplate(template, { ...baseContext, ...context }, dependencies) };
}

describe('roulette result special variables', () => {
  test('runs direct roulette and all action aliases through existing pipelines', async () => {
    const r = renderer();
    const result = await r.render('${roulette::Wheel B} ${action::fx} ${automation::fx2} ${blueprint::fx3} {user.name}');
    expect(r.enqueueRouletteSpin).toHaveBeenCalledWith(sid, expect.objectContaining({ name: 'Wheel B', userId: 'viewer', chatPost: baseContext.chatPost }));
    expect(r.executeAndStripActionVariableTokens.mock.calls.map(call => call[1])).toEqual(['${action::fx}', '${automation::fx2}', '${blueprint::fx3}']);
    expect(result.text).toBe('Viewer');
    expect(result.actionJobs).toHaveLength(3);
  });

  test('counter increments once using the original platform identity; memo remains literal and read-only', async () => {
    const r = renderer();
    const result = await r.render('${counter::user::wins}/${counter::user::wins} ${memo::notice} {user.name} {roulette.result.label}', {
      username: '${action::injected}', result: { label: '${roulette::injected}' }, argsText: 'must not overwrite',
    });
    expect(r.increment).toHaveBeenCalledTimes(1);
    expect(r.increment).toHaveBeenCalledWith({ scope: 'user', name: 'wins', subject: 'chzzk:raw-viewer' });
    expect(result.text).toBe('7/7 ${roulette::injected} ${action::injected} ${roulette::injected}');
    expect(r.enqueueRouletteSpin).not.toHaveBeenCalled();
    expect(r.executeAndStripActionVariableTokens).not.toHaveBeenCalled();
  });

  test.each(['{date.today}', '{user.points}', '{attendance.totalDays}'])('tracks actual generic placeholder changes for %s', async token => {
    const r = renderer({ substituteAllPlaceholders: async text => text.replace(token, '42') });
    expect(await r.render(token)).toMatchObject({ used: true, text: '42' });
    expect(await r.render('plain text')).toMatchObject({ used: false, text: 'plain text' });
  });

  test.each(['video_donation', 'bgm_request', 'songbook_request', 'live.title_change', 'live.game_change'])('passes direct %s arguments without interpreting them as a command', async kind => {
    const r = renderer();
    const result = await r.render('${' + kind + '} target 0:00 1:00');
    const handler = kind.startsWith('live.') ? r.executeLiveChange : kind.startsWith('songbook') ? r.executeSongbookRequest : r.executeMediaRequest;
    expect(handler).toHaveBeenCalledWith('${' + kind + '}', 'target 0:00 1:00', expect.objectContaining({ userId: 'viewer' }));
    expect(result.commandTemplate).toBe('');
    expect(result.text).not.toContain('target');
  });

  test('uses registered command arguments while keeping its authored response text', async () => {
    const r = renderer();
    const result = await r.render('Done ${songbook_request}', { argsText: 'Song title', command: { ruleId: 'song' } });
    expect(r.executeSongbookRequest).toHaveBeenCalledWith('${songbook_request}', 'Song title', expect.any(Object));
    expect(result.text).toBe('Done song accepted');
  });

  test('rejects oversized effects before any side effect', async () => {
    const r = renderer();
    await expect(r.render('${roulette::B}'.repeat(17))).rejects.toMatchObject({ code: 'command_safety_actions_limit' });
    expect(r.enqueueRouletteSpin).not.toHaveBeenCalled();
    expect(r.increment).not.toHaveBeenCalled();
  });

  test('stops sibling effects after a blueprint reports a safety rejection', async () => {
    const r = renderer({ executeAndStripActionVariableTokens: async () => ({ jobs: [{ ok: false, errorCode: 'command_safety_cycle' }] }) });
    await expect(r.render('${action::cycle} ${roulette::B}')).rejects.toMatchObject({ code: 'command_safety_cycle' });
    expect(r.enqueueRouletteSpin).not.toHaveBeenCalled();
  });

  test('does not mutate counters after placeholder resolution exceeds the deadline', async () => {
    let now = 0;
    const commandExecution = safety.createCommandExecutionSafety({ now: () => now, limits: { durationMs: 100 } });
    const r = renderer({ commandExecution, substituteAllPlaceholders: async text => { now = 101; return text; } });
    await expect(r.render('${counter::global::wins}')).rejects.toMatchObject({ code: 'command_safety_deadline' });
    expect(r.increment).not.toHaveBeenCalled();
  });
});

function runtimeFixture(overrides = {}) {
  const commandExecution = safety.createCommandExecutionSafety();
  const persisted = [], messages = [], actions = [], sent = [];
  const rootRouletteCounts = new Map();
  let now = Date.now();
  const coordinator = createRouletteResultActionCoordinator({ now: () => now, earlyToleranceMs: 0,
    setTimeoutFn: () => ({ unref() {} }), clearTimeoutFn: () => {} });
  const defs = ['a', 'b'].map((id, index) => ({ id, name: 'Wheel ' + id, type: 'items', items: [
    { label: 'Winner', weight: 1, value: '${roulette::' + (index ? 'a' : 'b') + '}' },
    { label: 'Winner', weight: 2, value: '' }, { label: 'Other', weight: 7, value: '' },
  ] }));
  const r = renderer({ commandExecution });
  const bindings = {
    ...commandKeywords,
    commandExecution, renderRouletteResultTemplate, getRouletteWheelMetadata,
    substituteAllPlaceholders: r.substituteAllPlaceholders,
    resolveCommandCounterVariables: r.resolveCommandCounterVariables,
    resolveCommandMemoVariables: r.resolveCommandMemoVariables,
    executeAndStripActionVariableTokens: async (_, token, context) => { actions.push({ token, context }); return { jobs: [{ ok: true }] }; },
    ownerUserIdFromSid: () => 'owner', makeBlueprintCommandChatPost: () => ({ provider: 'chzzk' }),
    getRuntimeBotRulesWithDefaults: async () => [{ id: 'fx', keywords: ['!fx'], keyword: '!fx', enabled: true, responses: ['${action::local} {user.name}'], cooldown: 0 }],
    claimBotRuleCooldown: async () => ({ claimed: true }),
    resolveBlueprintCommandChannelUid: async () => 'channel', emitBlueprintCommandEvent: jest.fn(async () => {}),
    recordCommandExecutionLog: jest.fn(async () => {}), sendChatByPost: async (_, __, text) => sent.push(text),
    crypto: require('node:crypto'),
    getChannelContext: async () => ({ channelId: 'channel' }), validateChannelId: () => true,
    getBotSettings: async () => ({ rouletteDefs: defs, rouletteViewerToken: 'token' }),
    getOrCreateViewerTokenSupabase: async () => 'token',
    updateBotSettingsAtomically: async (_, update) => update({ rouletteViewerToken: 'token' }),
    registerTokenChannelMapping: () => {}, rouletteTokenToSid: new Map(), rouletteTokenLastBatch: new Map(),
    insertRouletteSession: jest.fn(async () => {}), recordBotEventLogSafe: async () => {}, providerFromLogContext: () => 'chzzk',
    normalizeRouletteTestConnectionId: () => null,
    ROULETTE_SPIN_MS: 5200, ROULETTE_ACTION_SETTLE_FALLBACK_GRACE_MS: 750,
    rouletteResultActionCoordinator: coordinator,
    createRouletteBroadcastDelivery: () => async ({ message }) => { messages.push(message); return { success: 1, total: 1 }; },
    reserveRouletteEnqueue: jest.fn(() => ({ accepted: true, position: 1 })),
    commandAdmissionStore: { claimChainJob: jest.fn(async () => true) },
    enqueueDurableRuntimeJob: async job => persisted.push(JSON.parse(JSON.stringify(job))),
    runDurableRuntimeWorker: async () => {}, rouletteQueues: new Map(), rouletteLastEnqueue: new Map(),
    ...overrides,
    commandAdmissionStore: {
      claimChainJob: jest.fn(async () => true),
      claimRouletteExecution: jest.fn(async (chain, roulette) => {
        const key = `${chain.sid}:${chain.rootId}:${roulette}`;
        const count = rootRouletteCounts.get(key) || 0;
        if (count >= 5) return false;
        rootRouletteCounts.set(key, count + 1);
        return true;
      }),
      ...overrides.commandAdmissionStore,
    },
  };
  const runtime = loadFunctions(['startRouletteSpin', 'chooseRouletteItem', 'getRouletteDefsFromSettings',
    'enqueueRouletteSpin', 'sanitizeRouletteJobItem', 'renderRouletteActionTemplate',
    'executeRouletteResultActions', 'executeRouletteResultCommand'], bindings);
  return { ...runtime, ...bindings, persisted, messages, actions, sent, coordinator, defs,
    settle: async spin => { now = Date.now() + 6000; return coordinator.settle({ token: 'token', spinId: spin.spinId, channelId: 'channel', label: 'Winner' }); } };
}

describe('actual server roulette result integration', () => {
  beforeEach(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(Math, 'random').mockReturnValue(0); });
  afterEach(() => jest.restoreAllMocks());

  test('settled callbacks preserve ancestry and allow A -> B -> A up to five visits each', async () => {
    const r = runtimeFixture();
    const a = await r.startRouletteSpin(sid, 'a', 'viewer', 'Viewer', { chatPost: baseContext.chatPost });
    expect(r.persisted).toHaveLength(0);
    expect(await r.coordinator.settle({ token: 'token', spinId: a.spinId, channelId: 'channel', label: 'Winner' })).toMatchObject({ status: 'too-early' });
    expect(await r.settle(a)).toMatchObject({ status: 'executed' });
    expect(await r.settle(a)).toMatchObject({ status: 'missing' });
    const bJob = r.persisted[0].payload.item;
    expect(bJob.executionChain.path).toEqual(['roulette:a']);
    expect(bJob.chatPost.counterUserId).toBe('raw-viewer');
    const b = await r.startRouletteSpin(sid, bJob.name, bJob.userId, bJob.username, bJob);
    await r.settle(b);
    const aJob = r.persisted[1].payload.item;
    expect(aJob.executionChain.rootId).toBe(bJob.executionChain.rootId);
    expect(aJob.executionChain.path).toEqual(['roulette:a', 'roulette:b']);
    let next = aJob;
    for (let index = 2; index < 10; index++) {
      const spin = await r.startRouletteSpin(sid, next.name, next.userId, next.username, next);
      await r.settle(spin);
      next = r.persisted.at(-1).payload.item;
    }
    await expect(r.startRouletteSpin(sid, next.name, next.userId, next.username, next)).rejects.toMatchObject({ code: 'command_safety_roulette_limit' });
    expect(r.messages).toHaveLength(10);
    expect(r.reserveRouletteEnqueue).toHaveBeenCalledTimes(10);
    expect(r.commandAdmissionStore.claimChainJob).toHaveBeenCalledTimes(10);
  });

  test('direct blueprint -> roulette -> blueprint keeps the immediate blueprint cycle block', async () => {
    const r = runtimeFixture({ executeAndStripActionVariableTokens: () => r.commandExecution.run(sid, 'blueprint:fx', async () => ({ jobs: [] })) });
    r.defs[0].items[0].value = '${action::fx}';
    const spin = await r.commandExecution.run(sid, 'blueprint:fx', () => r.startRouletteSpin(sid, 'a', 'viewer', 'Viewer'));
    expect(await r.settle(spin)).toMatchObject({ status: 'failed', error: { code: 'command_safety_cycle' } });
    expect(r.messages).toHaveLength(1);
  });

  test('the same roulette replays exactly five times including the first spin', async () => {
    const r = runtimeFixture();
    r.defs[0].items[0].value = '${roulette::a}';
    let options = {};
    for (let index = 0; index < 5; index++) {
      const spin = await r.startRouletteSpin(sid, 'a', 'viewer', 'Viewer', options);
      await r.settle(spin);
      options = r.persisted.at(-1).payload.item;
    }
    await expect(r.startRouletteSpin(sid, 'a', 'viewer', 'Viewer', options)).rejects.toMatchObject({ code: 'command_safety_roulette_limit' });
    expect(r.messages).toHaveLength(5);
  });

  test('independent queued sibling branches share a root-wide five-spin allowance', async () => {
    const r = runtimeFixture();
    const chain = r.commandExecution.capture(sid);
    for (let i = 0; i < 5; i++) await r.startRouletteSpin(sid, 'a', 'viewer', 'Viewer', { executionChain: chain, executeResultActions: false });
    await expect(r.startRouletteSpin(sid, 'a', 'viewer', 'Viewer', { executionChain: chain })).rejects.toMatchObject({ code: 'command_safety_roulette_limit' });
    expect(r.messages).toHaveLength(5);
    await expect(r.startRouletteSpin(sid, 'a', 'viewer', 'Viewer', { executeResultActions: false })).resolves.toHaveProperty('spinId');
  });

  test('a rejected durable visit cannot choose, save, register, or broadcast a spin', async () => {
    const r = runtimeFixture({ commandAdmissionStore: { claimRouletteExecution: async () => false } });
    await expect(r.startRouletteSpin(sid, 'a', 'viewer', 'Viewer')).rejects.toMatchObject({ code: 'command_safety_roulette_limit' });
    expect(Math.random).not.toHaveBeenCalled();
    expect(r.insertRouletteSession).not.toHaveBeenCalled();
    expect(r.coordinator.pendingCount()).toBe(0);
    expect(r.messages).toHaveLength(0);
  });

  test('waiting on durable admission cannot revive a root stopped by a sibling', async () => {
    let entered, release;
    const enteredPromise = new Promise(resolve => { entered = resolve; });
    const admission = new Promise(resolve => { release = resolve; });
    const r = runtimeFixture({ commandAdmissionStore: { claimRouletteExecution: () => { entered(); return admission; } } });
    await r.commandExecution.scope(sid, async () => {
      const pending = r.startRouletteSpin(sid, 'a', 'viewer', 'Viewer');
      await enteredPromise;
      expect(() => r.commandExecution.consume('nodes', 513)).toThrow('command_safety_nodes_limit');
      release(true);
      await expect(pending).rejects.toMatchObject({ code: 'command_safety_nodes_limit' });
    });
    expect(Math.random).not.toHaveBeenCalled();
    expect(r.messages).toHaveLength(0);
  });

  test('in-memory sibling actions cannot each reserve a separate five-spin allowance', async () => {
    const execution = safety.createCommandExecutionSafety();
    let count = 0;
    await expect(execution.scope(sid, async () => {
      for (let i = 0; i < 6; i++) await execution.run(sid, 'roulette:a', async () => count++);
    })).rejects.toMatchObject({ code: 'command_safety_roulette_limit' });
    expect(count).toBe(5);
    await expect(execution.run(sid, 'command:one', () => execution.run(sid, 'command:one', async () => {}))).rejects.toMatchObject({ code: 'command_safety_cycle' });
  });

  test('durable root job limit stops descendants before persistence', async () => {
    const r = runtimeFixture({ commandAdmissionStore: { claimChainJob: async () => false } });
    const spin = await r.startRouletteSpin(sid, 'a', 'viewer', 'Viewer');
    expect(await r.settle(spin)).toMatchObject({ status: 'failed', error: { code: 'command_safety_jobs_limit' } });
    expect(r.persisted).toHaveLength(0);
  });

  test.each([{ instant: false }, { instant: true }, { testMode: true }])('broadcast metadata and preview isolation %j', async options => {
    const r = runtimeFixture();
    const spin = await r.startRouletteSpin(sid, 'a', 'viewer', 'Viewer', options);
    expect(r.messages[0]).toMatchObject({ items: ['Winner', 'Winner', 'Other'], itemWeights: [1, 2, 7], selectedItemIndex: 0 });
    if (options.testMode) {
      expect(r.coordinator.pendingCount()).toBe(0);
      expect(r.insertRouletteSession).not.toHaveBeenCalled();
    } else {
      expect(r.coordinator.pendingCount()).toBe(1);
      await r.settle(spin);
      expect(r.persisted).toHaveLength(1);
    }
  });

  test('registered command dispatch works without a live session and uses local pipeline', async () => {
    const r = runtimeFixture();
    const result = await r.executeRouletteResultActions(sid, r.defs[0], { label: 'Winner', value: '!fx' }, 'viewer', 'Viewer', 'channel');
    expect(result.command).toMatchObject({ executed: true, pointsDeducted: false });
    expect(r.actions[0]).toMatchObject({ token: '${action::local}', context: { command: { ruleId: 'fx' }, userId: 'viewer' } });
    expect(r.emitBlueprintCommandEvent).toHaveBeenCalledWith(sid, 'chzzk', expect.objectContaining({ source: 'arubot-roulette', cmd: '!fx' }));
    expect(r.sent).toEqual(['[룰렛 결과] Viewer']);
  });

  test('rendered viewer names cannot inject command dispatch', async () => {
    const r = runtimeFixture();
    const result = await r.executeRouletteResultActions(sid, r.defs[0], { label: 'Winner', value: '{user.name}' }, 'viewer', '!fx', 'channel');
    expect(result.command.executed).toBe(false);
    expect(r.actions).toHaveLength(0);
    expect(r.sent).toEqual(['[룰렛 결과] !fx']);
  });
});

describe('roulette media rewards use existing admission without charging again', () => {
  test.each([
    ['${video_donation}', { source: 'roulette-result', noPointCost: true }, 0],
    ['${bgm_request}', { source: 'roulette-result', noPointCost: true }, 0],
    ['${video_donation}', { source: 'chat', noPointCost: true }, 20],
    ['${bgm_request}', { source: 'roulette-result' }, 30],
  ])('%s %j costs %s', async (response, context, expectedCost) => {
    const enqueue = jest.fn(async job => ({ job }));
    const { enqueueVideoDonationFromArgs } = loadFunctions(['enqueueVideoDonationFromArgs'], {
      crypto: require('node:crypto'),
      getBotSettings: async () => ({ videoDonationAcceptEnabled: true, videoDonationPointsPerSecond: 2, videoDonationMaxDurationSec: 60 }),
      getPvdBgmSettings: () => ({ enabled: true, acceptEnabled: true, pointsPerSecond: 3 }),
      resolvePvdMedia: async () => ({ provider: 'youtube', mediaId: 'abcdefghijk', title: 'Song', durationSec: 100 }),
      resolveVideoDonationTiming: () => ({ ok: true, startSec: 0, requestedEndSec: 10, durationSec: 10 }),
      shouldAwaitPvdDurationSync: () => false, findBlockedBotUser: () => false,
      providerFromLogContext: () => 'chzzk', enqueuePaidDurableRuntimeJob: enqueue,
      getVideoDonationReceiptQueueSize: async () => 1, runDurableRuntimeWorker: async () => {},
      recordBotEventLogSafe: async () => {}, appendVideoDonationQueueCount: text => text,
    });
    await enqueueVideoDonationFromArgs({ sid, channelUid: 'channel', userId: 'viewer', username: 'Viewer',
      response, args: ['https://youtu.be/abcdefghijk', '0', '10'], vdReAll: /\$\{[^}]+\}/g, context });
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ pointsCost: expectedCost,
      payload: { item: expect.objectContaining({ cost: expectedCost, durationSec: 10 }) } }));
  });
});

describe('weighted server results and catalog', () => {
  const { chooseRouletteItem } = loadFunctions(['chooseRouletteItem']);
  afterEach(() => jest.restoreAllMocks());
  test('exact winner index distinguishes duplicate labels and zero weight never wins', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const def = { items: [{ label: 'Same', weight: 0 }, { label: 'Same', weight: 2, value: 'B' }] };
    const picked = chooseRouletteItem(def, { includeIndex: true });
    expect(picked).toEqual({ label: 'Same', value: 'B', selectedItemIndex: 1 });
    expect(getRouletteWheelMetadata(def, picked)).toEqual({ items: ['Same', 'Same'], itemWeights: [0, 2], selectedItemIndex: 1 });
    expect(chooseRouletteItem(def)).toEqual({ label: 'Same', value: 'B' });
  });
  test('probability payload uses percentages in identical order', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const def = { type: 'probability', items: [10, 20, 70].map((probability, i) => ({ label: String(i), probability })) };
    expect(getRouletteWheelMetadata(def, chooseRouletteItem(def, { includeIndex: true }))).toEqual({ items: ['0', '1', '2'], itemWeights: [10, 20, 70], selectedItemIndex: 2 });
  });
  test('finite weight overflow keeps ratios and selection rather than always choosing the last item', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    const def = { items: [1e308, 1e308, 1e308].map((weight, i) => ({ label: String(i), weight })) };
    expect(chooseRouletteItem(def, { includeIndex: true }).selectedItemIndex).toBe(0);
    expect(getRouletteWheelMetadata(def).itemWeights).toEqual([1, 1, 1]);
  });
  test('legacy snapshots only recover unambiguous indices', () => {
    const def = { items: [{ label: 'Same', value: 'A', weight: 1 }, { label: 'Same', value: 'B', weight: 2 }] };
    expect(getRouletteWheelMetadata(def, { label: 'Same', value: 'B' }).selectedItemIndex).toBe(1);
    def.items[0].value = 'B';
    expect(getRouletteWheelMetadata(def, { label: 'Same', value: 'B' }).selectedItemIndex).toBeNull();
  });
  test('catalog includes implemented contexts but excludes event-only and unbound memo variables', () => {
    for (const key of ['${roulette::B}', '${blueprint::B}', '${video_donation}', '${bgm_request}', '${songbook_request}', '${songbook_url}', '${memo::name}', '${counter::user::wins}', '{user.points}', '{user.attendanceDays}', '{roulette.result.label}']) {
      expect(withRouletteVariableContext({ key, contexts: ['command'] }).contexts).toContain('roulette');
    }
    for (const key of ['${memo}', '{donation.amount}', '{attendance.totalDays}', '{node.overlay.overlayId}', '{flow.x}', '{user.userId}']) {
      expect(withRouletteVariableContext({ key, contexts: ['command'] }).contexts).not.toContain('roulette');
    }
  });
});

describe('durable roulette visit admission', () => {
  test('uses one conditional upsert without refill or retry and keeps the jobs budget untouched', async () => {
    const query = jest.fn(async () => ({ rows: [{ root_id: 'ok' }] }));
    const withPgClient = jest.fn(async task => task({ query }));
    const store = createCommandAdmissionStore({ withPgClient, now: () => 0 });
    const rootId = require('node:crypto').randomUUID();
    expect(await store.claimRouletteExecution({ rootId, sid }, 'roulette:a')).toBe(true);
    const calls = query.mock.calls.filter(([sql]) => sql.includes('jsonb_set'));
    expect(calls).toHaveLength(1);
    const [sql, args] = calls[0];
    expect(args).toEqual([rootId, sid, 'roulette:a']);
    expect(sql).toContain('values ($1,$2,0,jsonb_build_object($3::text,1))');
    expect(sql).toContain('budget.sid = excluded.sid');
    expect(sql).toContain("coalesce((budget.roulette_counts ->> $3::text)::integer,0) < 5");
    expect(sql).toContain("budget.created_at > clock_timestamp() - interval '1 day'");
    expect(sql).not.toContain('set jobs');
    expect(withPgClient.mock.calls.every(call => call[1] === 0)).toBe(true);
    query.mockImplementation(async sql => ({ rows: sql.includes('jsonb_set') ? [] : [{ root_id: 'ok' }] }));
    expect(await store.claimRouletteExecution({ rootId, sid }, 'roulette:a')).toBe(false);
    await expect(store.claimRouletteExecution({ rootId: 'untrusted', sid }, 'roulette:a')).rejects.toThrow('invalid_roulette_chain');
  });
});
