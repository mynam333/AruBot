const loadFunctions = require('./helpers/load-server-functions.cjs');
const loadSource = require('./helpers/load-source.cjs');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { pathToFileURL } = require('url');

function loadBlueprintValues() {
  const filename = path.join(__dirname, '../server/action-blueprint-values.js');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    transformers: { before: [(context) => {
      const visit = (node) => ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.name.text === 'url'
        ? ts.factory.createStringLiteral(pathToFileURL(filename).href)
        : ts.visitEachChild(node, visit, context);
      return (node) => ts.visitNode(node, visit);
    }] },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (name) => name === './dday-variables.js' ? loadSource('server/dday-variables.js', {
    './attendance-calendar.js': loadSource('server/attendance-calendar.js'),
  }) : require(name);
  new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
  return module.exports;
}

const values = loadBlueprintValues();

function graph(id, types, published = false) {
  const nodes = [{ id: 'start', type: 'start', config: {} }, ...types.map((entry, index) => (
    typeof entry === 'string' ? { id: `n${index}`, type: entry, config: {} } : { id: `n${index}`, ...entry }
  ))];
  return {
    id, slug: id, enabled: true,
    version: { id: `${id}-draft`, published, nodes, edges: nodes.slice(1).map((node, index) => ({ source: nodes[index].id, target: node.id, sourcePort: 'out' })) },
  };
}

function runtime(blueprints, overrides = {}) {
  const bindings = {
    ...values,
    getRuntimeActionBlueprint: jest.fn(async (_owner, id) => blueprints.find((item) => item.id === id)),
    validateBlueprintGraph: () => [],
    normalizeBlueprintEdges: (edges) => edges,
    blueprintOutputPorts: () => ['out'],
    insertActionBlueprintRun: jest.fn(async (_owner, run) => ({ id: `run-${run.blueprintId}`, ...run })),
    insertActionBlueprintRunStep: jest.fn(async () => ({})),
    finishActionBlueprintRun: jest.fn(async (_owner, id, update) => ({ id, ...update })),
    createActionBlueprintVariableResolvers: () => ({ loadUserPoints: jest.fn(() => { throw new Error('No viewer DB reads in tests'); }) }),
    getKstDateString: () => '2026-10-12',
    getChannelPoints: jest.fn(), incrChannelPoints: jest.fn(),
    sendChatByPost: jest.fn(), sendCimeChat: jest.fn(),
    liveStatusCache: new Map(),
    listAutomationLocalAgents: jest.fn(async () => [{ id: 'agent', status: 'online' }]),
    listAutomationConnections: jest.fn(async () => [{ id: 'obs-connection', enabled: true, endpoint: 'ws://127.0.0.1:4455' }]),
    queueAutomationJob: jest.fn(async (_owner, job) => ({ id: `job-${job.jobType}`, status: 'queued' })),
    broadcastFxToSid: jest.fn(() => 1), broadcastFxEventToSid: jest.fn(() => 1),
    normalizeFxPayload: (payload) => payload,
    ...overrides,
  };
  const functions = loadFunctions([
    'executeActionBlueprint', 'executeBlueprintChatNode', 'resolveBlueprintChannelUid', 'queueBlueprintAutomationJob',
  ], bindings);
  return { ...functions, bindings };
}

const connected = {
  source: 'manual_test', testMode: 'connected', dryRun: false,
  user: { userId: 'real-viewer-id', username: 'Viewer', points: 3000 },
  channelUid: 'simulator-channel', platform: 'chzzk',
};

describe('blueprint simulation and connected-device runtime', () => {
  test.each([{ source: 'manual_test' }, { ...connected, testMode: 'simulation' }, { ...connected, dryRun: true }])('keeps simulation free of device and viewer effects: %j', async (context) => {
    const blueprint = graph('draft', [
      { type: 'chat', config: { message: 'Never send this' } },
      { type: 'pointsAdjust', config: { delta: 20 } },
      { type: 'obs', config: { action: 'scene.switch', sceneName: 'Test' } },
      { type: 'overlay', config: { text: 'Test' } },
      { type: 'tts', config: { text: 'Test' } }, 'sound',
    ]);
    const { executeActionBlueprint, bindings } = runtime([blueprint]);
    const result = await executeActionBlueprint('owner', 'draft', { ...connected, ...context, testMode: context.testMode });
    expect(result).toMatchObject({ ok: true, testMode: 'simulation' });
    expect(result.nodeOutputs.n1).toMatchObject({ points: 3020, dryRun: true });
    for (const name of ['queueAutomationJob', 'listAutomationLocalAgents', 'broadcastFxToSid', 'sendChatByPost', 'sendCimeChat', 'incrChannelPoints', 'getChannelPoints']) {
      expect(bindings[name]).not.toHaveBeenCalled();
    }
  });

  test('queues rendered OBS jobs using the owner identity, while viewer data and chat remain simulated', async () => {
    const blueprint = graph('draft', [
      { type: 'pointsAdjust', config: { delta: -100 } },
      { type: 'chat', config: { message: 'Hello' } },
      { type: 'obs', config: { connectionId: 'obs-connection', action: 'scene.switch', sceneName: '{user.username}' } },
      { type: 'overlay', config: { text: '{user.points}' } },
    ]);
    const { executeActionBlueprint, bindings } = runtime([blueprint]);
    const result = await executeActionBlueprint('owner', 'draft', connected);
    expect(result).toMatchObject({ ok: true, testMode: 'connected', deliveryConfirmed: false });
    expect(result.nodeOutputs.n0).toMatchObject({ points: 2900, dryRun: true, noPointCost: true });
    expect(result.nodeOutputs.n1).toMatchObject({ sent: false, suppressed: true });
    expect(result.nodeOutputs.n2).toMatchObject({ queued: true, jobId: 'job-blueprint.obs', delivery: { status: 'queued', confirmed: false } });
    expect(bindings.queueAutomationJob).toHaveBeenCalledWith('owner', expect.objectContaining({
      jobType: 'blueprint.obs', connectionId: 'obs-connection', maxAttempts: 1,
      payload: expect.objectContaining({ action: 'scene.switch', sceneName: 'Viewer', endpoint: 'ws://127.0.0.1:4455', testMode: 'connected' }),
    }));
    expect(bindings.broadcastFxToSid).toHaveBeenCalledWith('user:owner', expect.objectContaining({ text: '2900' }));
    expect(bindings.incrChannelPoints).not.toHaveBeenCalled();
    expect(bindings.getChannelPoints).not.toHaveBeenCalled();
    expect(bindings.sendChatByPost).not.toHaveBeenCalled();
    expect(bindings.getRuntimeActionBlueprint).toHaveBeenCalledWith('owner', 'draft', { currentDraft: true });
  });

  test.each([
    ['obs', { action: 'scene.switch', sceneName: 'Test' }, 'blueprint.obs'],
    ['http', { url: 'https://example.test' }, 'blueprint.http'],
    ['websocket', { url: 'wss://example.test' }, 'blueprint.websocket'],
    ['udp', { host: '127.0.0.1', port: 9000 }, 'blueprint.udp'],
    ['tits', { triggerId: 'throw' }, 'blueprint.tits'],
    ['vtube', { hotkeyId: 'wave' }, 'blueprint.vtube'],
    ['sound', { assetId: 'sound.wav' }, 'fx.play'],
    ['fx', { assetId: 'image.png' }, 'fx.play'],
    ['tts', { text: 'Test' }, 'tts.speak'],
  ])('uses the desktop job protocol for %s', async (type, config, jobType) => {
    const { executeActionBlueprint, bindings } = runtime([graph('draft', [{ type, config }])], { broadcastFxToSid: jest.fn(() => 0) });
    const result = await executeActionBlueprint('owner', 'draft', connected);
    expect(result.ok).toBe(true);
    expect(bindings.queueAutomationJob).toHaveBeenCalledWith('owner', expect.objectContaining({ jobType }));
    expect(result.nodeOutputs.n0.delivery).toEqual({ status: 'queued', confirmed: false });
  });

  test.each(['overlay', 'overlayUpdate', 'overlayHide', 'rouletteDisplay'])('fails visibly when no overlay receives %s', async (type) => {
    const { executeActionBlueprint, bindings } = runtime([graph('draft', [type])], {
      broadcastFxToSid: jest.fn(() => 0), broadcastFxEventToSid: jest.fn(() => 0),
    });
    const result = await executeActionBlueprint('owner', 'draft', connected);
    expect(result).toMatchObject({ ok: false, failedNodeId: 'n0', error: 'blueprint_overlay_unavailable' });
    expect(result.nodeOutputs.n0.delivery).toEqual({ status: 'not_sent', confirmed: false });
    expect(bindings.insertActionBlueprintRunStep).toHaveBeenLastCalledWith('owner', expect.objectContaining({ status: 'failed', nodeId: 'n0' }));
  });

  test.each([
    [{ listAutomationLocalAgents: async () => [] }, 'blueprint_local_agent_offline'],
    [{ listAutomationLocalAgents: async () => [{ status: 'online', revokedAt: 'revoked' }] }, 'blueprint_local_agent_offline'],
    [{ queueAutomationJob: async () => null }, 'blueprint_job_not_queued'],
    [{ queueAutomationJob: async () => { throw new Error('database unavailable'); } }, 'database unavailable'],
    [{ listAutomationLocalAgents: async () => { throw new Error('agent lookup unavailable'); } }, 'agent lookup unavailable'],
  ])('does not claim success when device enqueue fails', async (overrides, error) => {
    const { executeActionBlueprint } = runtime([graph('draft', ['obs'])], overrides);
    expect(await executeActionBlueprint('owner', 'draft', connected)).toMatchObject({ ok: false, failedNodeId: 'n0', error });
  });

  test('does not queue a job for an offline desktop or invalid connection', async () => {
    for (const overrides of [{ listAutomationLocalAgents: async () => [] }, { listAutomationConnections: async () => [] }]) {
      const { executeActionBlueprint, bindings } = runtime([graph('draft', [{ type: 'obs', config: { connectionId: 'missing', endpoint: 'ws://127.0.0.1:4455' } }])], overrides);
      expect((await executeActionBlueprint('owner', 'draft', connected)).ok).toBe(false);
      expect(bindings.queueAutomationJob).not.toHaveBeenCalled();
    }
  });

  test.each(['approval', 'timer', 'chatVote'])('rejects unsupported desktop job %s instead of silently skipping it', async (type) => {
    const { executeActionBlueprint, bindings } = runtime([graph('draft', [type])]);
    expect(await executeActionBlueprint('owner', 'draft', connected)).toMatchObject({ ok: false, error: `blueprint_test_unsupported_node:${type}` });
    expect(bindings.queueAutomationJob).not.toHaveBeenCalled();
  });

  test('propagates connected-test safety to nested published actions and surfaces child failure', async () => {
    const { executeActionBlueprint, bindings } = runtime([
      graph('parent', [{ type: 'action', config: { actionId: 'child' } }]),
      graph('child', [{ type: 'pointsAdjust', config: { delta: 30 } }, { type: 'chat', config: { message: 'Blocked' } }, 'obs'], true),
    ], { listAutomationLocalAgents: async () => [] });
    const result = await executeActionBlueprint('owner', 'parent', connected);
    expect(result).toMatchObject({ ok: false, error: 'blueprint_local_agent_offline' });
    expect(bindings.incrChannelPoints).not.toHaveBeenCalled();
    expect(bindings.sendChatByPost).not.toHaveBeenCalled();
    expect(bindings.getRuntimeActionBlueprint).toHaveBeenCalledWith('owner', 'child', { currentDraft: false });
    expect(bindings.insertActionBlueprintRun.mock.calls[1][1].context).toMatchObject({ source: 'manual_test', testMode: 'connected', dryRun: false, noPointCost: true });
  });

  test('does not execute unpublished nested actions during a connected test', async () => {
    const { executeActionBlueprint, bindings } = runtime([
      graph('parent', [{ type: 'action', config: { actionId: 'child' } }]), graph('child', ['obs']),
    ]);
    expect(await executeActionBlueprint('owner', 'parent', connected)).toMatchObject({ ok: false, error: 'blueprint_not_published' });
    expect(bindings.queueAutomationJob).not.toHaveBeenCalled();
  });

  test('rejects stale saved versions before executing any node', async () => {
    const { executeActionBlueprint, bindings } = runtime([graph('draft', ['obs'])]);
    expect(await executeActionBlueprint('owner', 'draft', connected, { expectedVersionId: 'old-version' })).toEqual({ ok: false, error: 'blueprint_test_version_changed' });
    expect(bindings.insertActionBlueprintRun).not.toHaveBeenCalled();
    expect(bindings.queueAutomationJob).not.toHaveBeenCalled();
  });

  test('ordinary runtime still writes points and queues device jobs without test preflight', async () => {
    const { executeActionBlueprint, bindings } = runtime([graph('published', [{ type: 'pointsAdjust', config: { delta: 30 } }, 'obs'], true)], { getChannelPoints: jest.fn(async () => 100) });
    const result = await executeActionBlueprint('owner', 'published', { source: 'chat-command', user: { userId: 'viewer' }, channelUid: 'channel' });
    expect(result.ok).toBe(true);
    expect(bindings.incrChannelPoints).toHaveBeenCalledWith('channel', 'viewer', 'viewer', 30);
    expect(bindings.queueAutomationJob).toHaveBeenCalled();
    expect(bindings.listAutomationLocalAgents).not.toHaveBeenCalled();
  });

  test('ordinary nested actions still mutate real points with the original viewer context', async () => {
    let points = 100;
    const { executeActionBlueprint, bindings } = runtime([
      graph('parent', [{ type: 'action', config: { actionId: 'child' } }], true),
      graph('child', [{ type: 'pointsAdjust', config: { delta: 30 } }], true),
    ], {
      getChannelPoints: jest.fn(async () => points),
      incrChannelPoints: jest.fn(async (_channel, _user, _name, delta) => { points += delta; }),
    });
    const result = await executeActionBlueprint('owner', 'parent', { source: 'chat-command', user: { userId: 'viewer', username: 'Viewer' }, channelUid: 'channel' });
    expect(result.ok).toBe(true);
    expect(result.nodeOutputs.n0.nodeOutputs.n0).toMatchObject({ previous: 100, points: 130, dryRun: false, noPointCost: false });
    expect(bindings.incrChannelPoints).toHaveBeenCalledWith('channel', 'viewer', 'Viewer', 30);
    expect(bindings.insertActionBlueprintRun.mock.calls[1][1].context).toMatchObject({ source: 'blueprint_nested', user: { userId: 'viewer' }, channelUid: 'channel' });
    expect(bindings.insertActionBlueprintRun.mock.calls[1][1].context).not.toHaveProperty('testMode');
  });
});

describe('blueprint current draft selection', () => {
  test('test loading bypasses published fallback; ordinary execution preserves it', async () => {
    const draft = graph('draft', ['log']);
    const published = { ...draft.version, id: 'published-version', published: true };
    const listActionBlueprintVersions = jest.fn(async () => [draft.version, published]);
    const { getRuntimeActionBlueprint } = loadFunctions(['getRuntimeActionBlueprint'], {
      getActionBlueprint: async () => draft, listActionBlueprintVersions,
      getRuntimeConfigurationRevision: () => 1,
    });
    expect((await getRuntimeActionBlueprint('owner', 'draft', { currentDraft: true })).version.id).toBe('draft-draft');
    expect(listActionBlueprintVersions).not.toHaveBeenCalled();
    expect((await getRuntimeActionBlueprint('owner', 'draft')).version.id).toBe('published-version');
  });
});

describe('blueprint test HTTP boundary', () => {
  const invoke = async (body, overrides = {}) => {
    const executeActionBlueprint = jest.fn(async () => ({ ok: true }));
    const handler = loadFunctions.route('/api/action-blueprints/:id/test', {
      getCurrentSessionUserId: async () => 'owner', executeActionBlueprint, ...overrides,
    }, 'post');
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, set: jest.fn() };
    await handler({ params: { id: 'draft' }, body }, response);
    return { response, executeActionBlueprint };
  };

  test('defaults to simulation and ignores client overrides of safety context', async () => {
    const { response, executeActionBlueprint } = await invoke({ context: { source: 'chat-command', testMode: 'connected', dryRun: false, noPointCost: false, chatPost: { provider: 'cime' } } });
    expect(response.body).toMatchObject({ ok: true, testMode: 'simulation', deliveryConfirmed: false });
    expect(executeActionBlueprint.mock.calls[0][2]).toMatchObject({ source: 'manual_test', testMode: 'simulation', dryRun: true, noPointCost: true });
    expect(executeActionBlueprint.mock.calls[0][2]).not.toHaveProperty('chatPost');
  });

  test.each([{ mode: 'invalid' }, { mode: 'connected' }, { mode: 'connected', confirmConnected: 'true' }])('rejects invalid or unconfirmed connected execution', async (body) => {
    const { response, executeActionBlueprint } = await invoke(body);
    expect(response.statusCode).toBe(400);
    expect(executeActionBlueprint).not.toHaveBeenCalled();
  });

  test('allows explicit connected testing and passes the saved version guard', async () => {
    const { executeActionBlueprint } = await invoke({ mode: 'connected', confirmConnected: true, versionId: 'saved-version' });
    expect(executeActionBlueprint).toHaveBeenCalledWith('owner', 'draft', expect.objectContaining({ source: 'manual_test', testMode: 'connected', dryRun: false, noPointCost: true }), { expectedVersionId: 'saved-version' });
  });

  test.each([
    [{ getCurrentSessionUserId: async () => null }, 401],
    [{ admitChatCommand: async () => false }, 429],
  ])('preserves authentication and command admission', async (overrides, statusCode) => {
    const { response, executeActionBlueprint } = await invoke({ mode: 'connected', confirmConnected: true }, overrides);
    expect(response.statusCode).toBe(statusCode);
    expect(executeActionBlueprint).not.toHaveBeenCalled();
  });
});
