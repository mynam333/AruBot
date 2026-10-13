const load = require('./helpers/load-source.cjs');
const loadFunctions = require('./helpers/load-server-functions.cjs');
const { createCommandExecutionSafety } = load('server/command-execution-safety.js');
const { createRouletteResultActionCoordinator } = load('server/roulette-result-action-coordinator.js');
const { getRouletteWheelMetadata } = load('server/roulette-wheel-metadata.js');

const sid = 'user:owner';
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function blueprintRuntime(commandExecution, nodes, edges, overrides = {}) {
  const finish = jest.fn(async (_, id, update) => ({ id, ...update }));
  const steps = [];
  const { executeActionBlueprint } = loadFunctions(['executeActionBlueprint'], {
    commandExecution,
    getRuntimeActionBlueprint: async () => ({
      id: 'adversarial', enabled: true, version: { published: true, nodes, edges },
    }),
    normalizeBlueprintEdges: (value) => value,
    validateBlueprintGraph: () => [],
    insertActionBlueprintRun: async () => ({ id: 'run' }),
    finishActionBlueprintRun: finish,
    insertActionBlueprintRunStep: async (_, step) => { steps.push(step); },
    normalizeBlueprintReadContext: (context) => context,
    createActionBlueprintVariableResolvers: () => ({}),
    hydrateBlueprintReadContext: async ({ context }) => context,
    mergeBlueprintReadContexts: (a, b) => ({ ...a, ...b }),
    getKstDateString: () => '2026-10-12',
    buildBlueprintScope: () => ({}),
    evaluateBlueprintValue: (value) => value,
    renderBlueprintTemplate: (value) => value,
    blueprintOutputPorts: () => ['out'],
    ...overrides,
  });
  return { run: () => executeActionBlueprint('owner', 'adversarial'), finish, steps };
}

function rouletteRuntime(commandExecution, { onResult = async () => {}, claim = async () => true, overrides = {} } = {}) {
  const callbacks = [];
  const persisted = [];
  const rouletteQueues = new Map();
  const messages = [];
  const defs = ['a', 'b'].map((id) => ({ id, name: `Wheel ${id}`, items: [{ label: id, value: '!next' }] }));
  const choose = jest.fn((def) => def.items[0]);
  const runtime = loadFunctions([
    'startRouletteSpin', 'enqueueRouletteSpin', 'sanitizeRouletteJobItem', 'processRouletteQueue', 'sendChatByPost',
  ], {
    commandExecution,
    crypto: require('node:crypto'),
    getChannelContext: async () => ({ channelId: 'channel' }),
    validateChannelId: () => true,
    getBotSettings: async () => ({ rouletteDefs: defs, rouletteViewerToken: 'viewer-token' }),
    getRouletteDefsFromSettings: (settings) => settings.rouletteDefs,
    chooseRouletteItem: choose,
    getRouletteWheelMetadata,
    getOrCreateViewerTokenSupabase: async () => 'viewer-token',
    updateBotSettingsAtomically: async (_, update) => update({ rouletteViewerToken: 'viewer-token' }),
    registerTokenChannelMapping: () => {},
    rouletteTokenToSid: new Map(),
    insertRouletteSession: async () => {},
    recordBotEventLogSafe: async () => {},
    providerFromLogContext: () => 'chzzk',
    normalizeRouletteTestConnectionId: () => null,
    ROULETTE_SPIN_MS: 5200,
    ROULETTE_EMPHASIS_MS: 1000,
    ROULETTE_ACTION_SETTLE_FALLBACK_GRACE_MS: 1000,
    rouletteResultActionCoordinator: {
      register: (registration) => { callbacks.push(registration.execute); return true; },
    },
    executeRouletteResultActions: onResult,
    createRouletteBroadcastDelivery: () => async () => ({ success: 1, total: 1 }),
    broadcastRouletteResult: async () => ({ success: 0 }),
    reserveRouletteEnqueue: () => ({ accepted: true, position: 1 }),
    commandAdmissionStore: { claimChainJob: claim, claimRouletteExecution: async () => true },
    enqueueDurableRuntimeJob: async (job) => { persisted.push(JSON.parse(JSON.stringify(job))); },
    runDurableRuntimeWorker: async () => {},
    rouletteQueues,
    rouletteProcessing: new Set(),
    rouletteLastResultSent: new Map(),
    rouletteBatchAcc: new Map(),
    rouletteLastEnqueue: new Map(),
    settleDurableRuntimeItem: async () => {},
    refreshChzzkLiveStatusForSid: async () => ({ live: true }),
    sessionStore: new Map([[sid, { sessionKey: 'test-session' }]]),
    getValidAccessToken: async () => 'test-token',
    OPENAPI_BASE: 'https://chat.invalid',
    axios: { post: async (_, body) => { messages.push(body.message); return { data: {} }; } },
    rememberOutboundMessage: () => {},
    ...overrides,
  });
  return { ...runtime, callbacks, persisted, choose, rouletteQueues, messages };
}

describe('real blueprint parallel settlement', () => {
  test.each(['operational', 'safety'])('%s rejection keeps both concurrency slots until the sibling settles', async (failure) => {
    const commandExecution = createCommandExecutionSafety({ limits: { channelConcurrent: 1, globalConcurrent: 1 } });
    const entered = deferred();
    const slow = deferred();
    const fail = deferred();
    let enteredCount = 0;
    let slowSettled = false;
    let rootSettled = false;
    const runtime = blueprintRuntime(commandExecution, [
      { id: 'start', type: 'start' }, { id: 'parallel', type: 'parallel' },
      { id: 'fail', type: 'chat' }, { id: 'slow', type: 'chat' },
    ], [
      { source: 'start', target: 'parallel' },
      { source: 'parallel', target: 'fail' }, { source: 'parallel', target: 'slow' },
    ], {
      executeBlueprintChatNode: async (_, __, node) => {
        if (++enteredCount === 2) entered.resolve();
        if (node.id === 'fail') {
          await fail.promise;
          if (failure === 'safety') commandExecution.consume('messages', 41);
          throw new Error('upstream_failed');
        }
        await slow.promise;
        slowSettled = true;
        return { sent: true };
      },
    });
    const running = runtime.run().then((result) => { rootSettled = true; return result; });
    try {
      await entered.promise;
      fail.resolve();
      await flush();
      expect(runtime.steps.some((step) => step.nodeId === 'fail' && step.status === 'failed')).toBe(true);
      expect(rootSettled).toBe(false);
      expect(slowSettled).toBe(false);
      expect(runtime.finish).not.toHaveBeenCalled();
      await expect(commandExecution.run(sid, 'next-command', jest.fn()))
        .rejects.toMatchObject({ code: 'command_safety_busy' });
      await expect(commandExecution.run('user:other', 'next-command', jest.fn()))
        .rejects.toMatchObject({ code: 'command_safety_busy' });
    } finally {
      fail.resolve();
      slow.resolve();
      await running;
    }
    expect(await running).toMatchObject({
      ok: false, run: { status: 'failed' },
      error: failure === 'safety' ? 'command_safety_messages_limit' : 'upstream_failed',
    });
    expect(slowSettled).toBe(true);
    await expect(commandExecution.run(sid, 'ordinary-command', async () => 'ok')).resolves.toBe('ok');
  });

  test('parallel hydration resumes under the same stop signal before starting new effects', async () => {
    const commandExecution = createCommandExecutionSafety({ limits: { nodes: 3 } });
    const hydrate = deferred();
    const entered = deferred();
    const effect = jest.fn();
    const runtime = blueprintRuntime(commandExecution, [
      { id: 'start', type: 'start' }, { id: 'parallel', type: 'parallel' },
      { id: 'slow', type: 'chat', config: { gate: true } }, { id: 'over-budget', type: 'chat' },
    ], [
      { source: 'start', target: 'parallel' },
      { source: 'parallel', target: 'slow' }, { source: 'parallel', target: 'over-budget' },
    ], {
      hydrateBlueprintReadContext: async ({ context, value }) => {
        if (value.gate) { entered.resolve(); await hydrate.promise; }
        return context;
      },
      executeBlueprintChatNode: effect,
    });
    const running = runtime.run();
    await entered.promise;
    hydrate.resolve();
    expect(await running).toMatchObject({ ok: false, errorCode: 'command_safety_nodes_limit' });
    expect(effect).not.toHaveBeenCalled();
  });
});

describe('ordinary longer workflows', () => {
  afterEach(() => jest.useRealTimers());
  test.each([
    [[300000, 299999], null],
    [[300001], 'command_safety_waitMs_limit'],
    [[300000, 300000], 'command_safety_deadline'],
  ])('wait sequence %j has expected boundary %s', async (delays, errorCode) => {
    jest.useFakeTimers({ now: 1000000 });
    const commandExecution = createCommandExecutionSafety({ now: () => Date.now() });
    const nodes = [{ id: 'start', type: 'start' }, ...delays.map((ms, index) => ({
      id: `wait-${index}`, type: 'wait', config: { ms },
    })), { id: 'end', type: 'end' }];
    const edges = nodes.slice(1).map((node, index) => ({ source: nodes[index].id, target: node.id }));
    const runtime = blueprintRuntime(commandExecution, nodes, edges);
    const running = runtime.run();
    await jest.runAllTimersAsync();
    const result = await running;
    expect(result).toMatchObject(errorCode ? { ok: false, errorCode } : { ok: true, run: { status: 'done' } });
  });
});

describe('delayed roulette continuation integration', () => {
  test('delayed results survive JSON and another worker without inheriting that worker ancestry', async () => {
    let time = 1000000;
    const firstSafety = createCommandExecutionSafety({ now: () => time });
    const first = rouletteRuntime(firstSafety, {
      onResult: async () => first.enqueueRouletteSpin(sid, { name: 'b', userId: 'viewer' }),
    });
    await first.startRouletteSpin(sid, 'a', 'viewer', 'Viewer');
    time += 6200;
    await first.callbacks[0]();
    const saved = JSON.parse(JSON.stringify(first.persisted[0].payload.item));
    expect(saved.executionChain.path).toEqual(['roulette:a']);

    const secondSafety = createCommandExecutionSafety({ now: () => time });
    const second = rouletteRuntime(secondSafety, {
      onResult: async () => second.enqueueRouletteSpin(sid, { name: 'a', userId: 'viewer' }),
    });
    await secondSafety.run(sid, 'roulette:b', () => second.startRouletteSpin(sid, saved.name, 'viewer', 'Viewer', {
      executionChain: saved.executionChain,
    }));
    time += 6200;
    await second.callbacks[0]();
    const returned = JSON.parse(JSON.stringify(second.persisted[0].payload.item));
    expect(returned.executionChain).toMatchObject({
      rootId: saved.executionChain.rootId, path: ['roulette:a', 'roulette:b'],
    });
    let continuation = returned.executionChain;
    // Four further A spins are allowed; process changes cannot reset path visits.
    for (let visit = 2; visit <= 5; visit++) {
      const worker = rouletteRuntime(createCommandExecutionSafety({ now: () => time }), {
        onResult: async () => worker.enqueueRouletteSpin(sid, { name: 'a', userId: 'viewer' }),
      });
      await worker.startRouletteSpin(sid, 'a', 'viewer', 'Viewer', { executionChain: continuation });
      time += 6200;
      await worker.callbacks[0]();
      continuation = JSON.parse(JSON.stringify(worker.persisted[0].payload.item.executionChain));
      expect(continuation.rootId).toBe(saved.executionChain.rootId);
    }
    const finalWorker = rouletteRuntime(createCommandExecutionSafety({ now: () => time }));
    await expect(finalWorker.startRouletteSpin(sid, 'a', 'viewer', 'Viewer', {
      executionChain: continuation,
    })).rejects.toMatchObject({ code: 'command_safety_roulette_limit' });
    expect(finalWorker.choose).not.toHaveBeenCalled();
    expect(firstSafety.current()).toBeNull();
    expect(secondSafety.current()).toBeNull();
  });

  test('an overlay-unavailable fallback at normal channel capacity does not lose its result action', async () => {
    const commandExecution = createCommandExecutionSafety();
    const hold = deferred();
    const occupied = Array.from({ length: 15 }, (_, index) => commandExecution.run(sid, `other:${index}`, () => hold.promise));
    const effect = jest.fn();
    const failures = [];
    const coordinator = createRouletteResultActionCoordinator({
      setTimeoutFn: () => ({}), clearTimeoutFn: () => {},
      onError: (error) => failures.push(error.code),
    });
    const runtime = rouletteRuntime(commandExecution, {
      onResult: effect,
      overrides: {
        rouletteResultActionCoordinator: coordinator,
        createRouletteBroadcastDelivery: () => async () => ({ success: 0, total: 0 }),
      },
    });
    try {
      await runtime.startRouletteSpin(sid, 'a', 'viewer', 'Viewer');
      expect({ failures, executed: effect.mock.calls.length, pending: coordinator.pendingCount() })
        .toEqual({ failures: [], executed: 1, pending: 0 });
    } finally {
      hold.resolve();
      await Promise.all(occupied);
    }
  });

  test('later unrelated queued spins do not spend the completed producer message budget', async () => {
    jest.useFakeTimers({ now: 1000000 });
    const commandExecution = createCommandExecutionSafety({ now: () => Date.now(), limits: { messages: 1 } });
    const unrelated = commandExecution.capture(sid);
    const runtime = rouletteRuntime(commandExecution);
    let processing;
    try {
      await commandExecution.run(sid, 'producer', async () => {
        runtime.rouletteQueues.set(sid, [
          { name: 'a', username: 'First', executionChain: commandExecution.capture(sid) },
          { name: 'b', username: 'Second', executionChain: unrelated },
        ]);
        processing = runtime.processRouletteQueue(sid);
      });
      expect(commandExecution.current()).toBeNull();
      await jest.runAllTimersAsync();
      await processing;
      expect(runtime.choose).toHaveBeenCalledTimes(2);
      expect(runtime.messages).toHaveLength(2);
    } finally {
      await jest.runAllTimersAsync();
      await processing;
      jest.useRealTimers();
    }
  });
});

describe('bound callback budget ownership', () => {
  test('independent callbacks captured by one root share its remaining budget after completion', async () => {
    const commandExecution = createCommandExecutionSafety({ limits: { messages: 1 } });
    const effects = [];
    let callbacks;
    await commandExecution.run(sid, 'roulette:a', async () => {
      callbacks = ['first', 'second'].map((label) => commandExecution.bind(async () => {
        commandExecution.consume('messages');
        effects.push(label);
      }));
    });
    const results = await Promise.allSettled(callbacks.map((callback) => callback()));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(effects).toEqual(['first']);
  });

  test('a callback captured before a root safety failure cannot revive that stopped execution', async () => {
    const commandExecution = createCommandExecutionSafety({ limits: { nodes: 1 } });
    const effect = jest.fn();
    let callback;
    await expect(commandExecution.run(sid, 'roulette:a', async () => {
      callback = commandExecution.bind(async () => { commandExecution.consume('nodes'); effect(); });
      commandExecution.consume('nodes', 2);
    })).rejects.toMatchObject({ code: 'command_safety_nodes_limit' });
    await expect(callback()).rejects.toMatchObject({ code: 'command_safety_nodes_limit' });
    expect(effect).not.toHaveBeenCalled();
  });

  test('an inline bound callback reuses its still-live root slot instead of rejecting ordinary work', async () => {
    const commandExecution = createCommandExecutionSafety({ limits: { channelConcurrent: 1 } });
    await expect(commandExecution.run(sid, 'roulette:a', async () => {
      const callback = commandExecution.bind(async () => 'settled');
      return callback();
    })).resolves.toBe('settled');
  });
});

function queueRuntime(commandExecution, claimChainJob) {
  const persist = jest.fn(async () => ({ id: 'job' }));
  const functions = loadFunctions(['queueAutomationJob', 'enqueueRouletteSpin', 'sanitizeRouletteJobItem'], {
    commandExecution,
    commandAdmissionStore: { claimChainJob },
    enqueueAutomationJob: persist,
    notifyAutomationLocalAgents: jest.fn(),
    crypto: require('node:crypto'),
    reserveRouletteEnqueue: () => ({ accepted: true, position: 1 }),
    enqueueDurableRuntimeJob: persist,
    runDurableRuntimeWorker: async () => {},
    rouletteQueues: new Map(),
    rouletteLastEnqueue: new Map(),
  });
  return {
    persist,
    automation: () => functions.queueAutomationJob('owner', { jobType: 'action.variable', payload: {} }),
    roulette: () => functions.enqueueRouletteSpin(sid, { name: 'child' }),
  };
}

describe('queued child work budgets', () => {
  test('parallel child reservations cannot exceed the local jobs budget', async () => {
    const commandExecution = createCommandExecutionSafety({ limits: { jobs: 1 } });
    const claim = jest.fn(async () => true);
    const runtime = queueRuntime(commandExecution, claim);
    await commandExecution.run(sid, 'parent', async () => {
      const results = await Promise.allSettled([runtime.automation(), runtime.roulette()]);
      expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'command_safety_jobs_limit' } });
    });
    expect(claim).toHaveBeenCalledTimes(1);
    expect(runtime.persist.mock.calls.length).toBeLessThanOrEqual(1);
  });

  test('JSON continuations in separate workers charge the same durable root budget', async () => {
    const origin = createCommandExecutionSafety();
    const counts = new Map();
    const claim = jest.fn(async ({ rootId }) => {
      const count = counts.get(rootId) || 0;
      if (count >= 3) return false;
      counts.set(rootId, count + 1);
      return true;
    });
    let saved;
    await origin.run(sid, 'command:parent', async () => { saved = JSON.parse(JSON.stringify(origin.capture(sid))); });
    let persisted = 0;
    for (let index = 0; index < 2; index += 1) {
      const worker = createCommandExecutionSafety();
      const runtime = queueRuntime(worker, claim);
      const work = worker.run(sid, `child:${index}`, async () => {
        await runtime.automation();
        await runtime.roulette();
      }, JSON.parse(JSON.stringify(saved)));
      if (index === 0) await work;
      else await expect(work).rejects.toMatchObject({ code: 'command_safety_jobs_limit' });
      persisted += runtime.persist.mock.calls.length;
    }
    expect(persisted).toBe(3);
    expect(claim.mock.calls.every(([chain]) => chain.rootId === saved.rootId && chain.sid === sid)).toBe(true);
  });

  test.each(['automation', 'roulette'])('%s does not start a queue write after a sibling stops the root during admission', async (kind) => {
    const commandExecution = createCommandExecutionSafety();
    const admission = deferred();
    const entered = deferred();
    const runtime = queueRuntime(commandExecution, async () => { entered.resolve(); return admission.promise; });
    await commandExecution.run(sid, 'parent', async () => {
      const pending = runtime[kind]();
      await entered.promise;
      expect(() => commandExecution.consume('nodes', 513)).toThrow('command_safety_nodes_limit');
      admission.resolve(true);
      await expect(pending).rejects.toMatchObject({ code: 'command_safety_nodes_limit' });
    });
    expect(runtime.persist).not.toHaveBeenCalled();
  });
});
