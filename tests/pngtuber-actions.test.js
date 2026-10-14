const load = require('./helpers/load-source.cjs');
const loadFunctions = require('./helpers/load-server-functions.cjs');
const safety = load('server/command-execution-safety.js');
const textSafety = load('shared/text-safety.js');
const counters = load('server/counter-variables.js');
const memos = load('server/memo-variables.js', { '../shared/text-safety.js': textSafety });
const imports = {
  '../shared/text-safety.js': textSafety, './command-execution-safety.js': safety,
  './counter-variables.js': counters, './memo-variables.js': memos,
};
const pngtuber = load('server/pngtuber-actions.js', imports);
const { renderDonationResponse } = load('server/donation-response.js', imports);
const { renderRouletteResultTemplate } = load('server/roulette-result-template.js', imports);
const { assertBotManagerEffects } = load('shared/bot-management-policy.js');
const sid = 'user:owner';

function runtime(overrides = {}) {
  const rule = { id: 'rule', enabled: true, responses: ['Done ${pngtuber::happy::5}'], pointsCost: 500 };
  const bindings = {
    ...pngtuber,
    commandExecution: safety.createCommandExecutionSafety(),
    ownerUserIdFromSid: () => 'owner',
    listAutomationLocalAgents: jest.fn(async () => [{ status: 'online', capabilities: { pngtuber: true } }]),
    enqueueAutomationJob: jest.fn(async (_owner, job) => ({ ...job, id: 'job-id' })),
    notifyAutomationLocalAgents: jest.fn(),
    commandAdmissionStore: { claimChainJob: jest.fn(async () => true) },
    getRuntimeActionBlueprint: jest.fn(async () => ({ id: 'blueprint', version: { published: true } })),
    executeActionBlueprint: jest.fn(async () => ({ ok: true })),
    BLUEPRINT_COMMAND_PLATFORMS: new Set(['chzzk', 'cime', 'youtube']),
    getRuntimeBotRulesWithDefaults: jest.fn(async () => [rule]),
    getCommandRuleMatches: jest.fn(() => [{ rule, match: { matchedText: '!react', argsText: '' } }]),
    prepareMemoVariablePlan: text => ({ text, entries: [] }),
    prepareCounterVariablePlan: text => ({ text, entries: [] }),
    resolveCommandMemoVariables: jest.fn(async (_plan, text) => text),
    resolveCommandCounterVariables: jest.fn(async (_plan, text) => text),
    broadcastToDesktop: jest.fn(() => 0), emitWarudoEvent: jest.fn(),
    getOwnerInfoForSid: jest.fn(async () => ({ channelId: 'channel' })),
    resolveBlueprintCommandChannelUid: jest.fn(async () => 'channel'),
    makeBlueprintCommandChatPost: jest.fn(() => ({ provider: 'chzzk' })),
    executeCommandLiveChangeTokens: jest.fn(async (_sid, text) => ({ text, executed: [] })),
    substituteAllPlaceholders: jest.fn(async text => text),
    executeSongbookCommand: jest.fn(async text => text), hasSongbookCommandToken: () => false,
    enqueueVideoDonationFromArgs: jest.fn(), enqueueRouletteSpin: jest.fn(),
    recordCommandExecutionLog: jest.fn(),
    ...overrides,
  };
  const functions = loadFunctions([
    'executeResponseActions', 'executeAndStripActionVariableTokens', 'executeActionVariableTokens',
    'stripActionVariableTokens', 'queueBlueprintAutomationJob', 'queueAutomationJob',
    'executeBlueprintCommandNode', 'emitBlueprintCommandEvent', 'summarizeBlueprintCommandActionJobs',
  ], bindings);
  return { ...bindings, ...functions, rule,
    run: (text, context = {}) => functions.executeAndStripActionVariableTokens(sid, text, { responseTemplate: text, ...context }),
    command: (context, platform = 'chzzk') => functions.executeBlueprintCommandNode({
      ownerUserId: 'owner', sid, platform, commandText: '!react', context,
      blueprint: { id: 'blueprint' }, node: { id: 'node' }, run: { id: 'run' },
    }),
  };
}

describe('PNGTuber token validation', () => {
  test.each([
    ['${pngtuber::happy}', { reactionId: 'happy' }],
    ['${pngtuber::happy::5}', { reactionId: 'happy', durationSec: 5 }],
    ['${PNGTUBER:: happy :: 0.1 }', { reactionId: 'happy', durationSec: 0.1 }],
    ['${pngtuber::reaction-id_1::300}', { reactionId: 'reaction-id_1', durationSec: 300 }],
    ['${짚톡::기쁜 표정::.5}', { reactionId: '기쁜 표정', durationSec: 0.5 }],
    ['${pngtuber::' + 'a'.repeat(80) + '}', { reactionId: 'a'.repeat(80) }],
  ])('accepts preset references and optional decimal duration: %s', (token, expected) => {
    expect(pngtuber.parsePngtuberAction(token)).toEqual(expected);
  });

  test.each(['', ' ', '0', '-1', '0.09', '300.01', 'NaN', 'Infinity', '1e2', '0x10', '5sec', '1,5', '1.2.3', '9'.repeat(400)])('rejects explicit duration %j without falling back or clamping', duration => {
    expect(() => pngtuber.parsePngtuberAction('${pngtuber::happy::' + duration + '}'))
      .toThrow('pngtuber_invalid_duration');
  });

  test.each(['', ' ', 'a'.repeat(81), '..', '.', '../happy', 'C:\\happy.png', '/tmp/happy',
    'https://example.test/happy.png', 'file:///tmp/happy', 'data:image/png;base64,x', 'bad\nname',
    '%2e%2e%2fhappy', 'bad?name', '${user.name}'])('rejects invalid/external reference %j', reference => {
    expect(() => pngtuber.parsePngtuberAction('${pngtuber::' + reference + '}')).toThrow();
  });

  test.each(['${pngtuber}', '${pngtuber::happy::5::extra}', '${pngtuber::happy::${user.points}}'])('rejects malformed token %s', token => {
    expect(() => pngtuber.parsePngtuberAction(token)).toThrow('pngtuber_invalid_token');
  });
});

describe('existing response action integration', () => {
  test('queues timed and default reactions without leaking tokens or duplicating price logic', async () => {
    const r = runtime();
    const before = Date.now();
    const context = { source: 'chat-command', platform: 'chzzk', command: { ruleId: 'rule' }, user: { userId: 'viewer' } };
    const result = await r.run('Hello ${pngtuber::happy::5} ${짚톡::default}', context);
    expect(result).toMatchObject({ text: 'Hello', used: true, jobs: [{ ok: true, reactionId: 'happy', durationSec: 5 }, { ok: true, reactionId: 'default' }] });
    const [owner, job] = r.enqueueAutomationJob.mock.calls[0];
    expect(owner).toBe('owner');
    expect(job).toMatchObject({ connectionId: null, jobType: 'pngtuber.show', payload: { reactionId: 'happy', durationSec: 5, ...context } });
    expect(job.payload.expiresAt).toBeGreaterThanOrEqual(before + 60_000);
    expect(job.payload.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(typeof job.payload.expiresAt).toBe('number');
    expect(job.payload).not.toHaveProperty('pointsCost');
    expect(r.enqueueAutomationJob.mock.calls[1][1].payload).not.toHaveProperty('durationSec');
    expect(r.commandAdmissionStore.claimChainJob).toHaveBeenCalledTimes(2);
    expect(r.notifyAutomationLocalAgents).toHaveBeenCalledWith('owner', 'job_queued');
    expect(result.jobs[0].delivery).toEqual({ status: 'queued', confirmed: false });
  });

  test('plain text does not contact the local agent or queue', async () => {
    const r = runtime();
    expect(await r.run('Hello')).toEqual({ text: 'Hello', used: false, jobs: [] });
    expect(r.listAutomationLocalAgents).not.toHaveBeenCalled();
    expect(r.enqueueAutomationJob).not.toHaveBeenCalled();
  });

  test.each(['${pngtuber}', '${pngtuber::}', '${pngtuber::happy::}', '${pngtuber::happy::NaN}',
    '${pngtuber::happy::301}', '${짚톡::../image::5}', '${pngtuber::happy::5::extra}',
    '${pngtuber::${user.name}::5}'])('strips invalid authored tokens and reports visible failure: %s', async token => {
    const r = runtime();
    const result = await r.run('Hello ' + token);
    expect(result.used).toBe(true);
    expect(result.text).not.toMatch(/\$\{\s*(?:pngtuber|짚톡)/i);
    expect(result.text).toContain('PNGTuber: pngtuber_invalid_');
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({ ok: false, delivery: { status: 'not_sent', confirmed: false } });
    expect(r.enqueueAutomationJob).not.toHaveBeenCalled();
  });

  test.each([
    [{ listAutomationLocalAgents: async () => [] }, 'pngtuber_local_agent_offline'],
    [{ listAutomationLocalAgents: async () => [{ status: 'offline' }] }, 'pngtuber_local_agent_offline'],
    [{ listAutomationLocalAgents: async () => [{ status: 'online', revokedAt: 'revoked' }] }, 'pngtuber_local_agent_offline'],
    [{ listAutomationLocalAgents: async () => [{ status: 'online' }] }, 'pngtuber_local_agent_upgrade_required'],
    [{ listAutomationLocalAgents: async () => [{ status: 'online', capabilities: { pngtuber: 'true' } }] }, 'pngtuber_local_agent_upgrade_required'],
    [{ listAutomationLocalAgents: async () => [{ status: 'online', capabilities: { pngtuber: false } }, { status: 'offline', capabilities: { pngtuber: true } }] }, 'pngtuber_local_agent_upgrade_required'],
    [{ listAutomationLocalAgents: async () => { throw new Error('lookup failed'); } }, 'lookup failed'],
    [{ enqueueAutomationJob: async () => null }, 'pngtuber_job_not_queued'],
    [{ enqueueAutomationJob: async () => { throw new Error('database failed'); } }, 'database failed'],
    [{ ownerUserIdFromSid: () => null }, 'pngtuber_owner_unavailable'],
  ])('does not acknowledge unavailable local delivery: %s', async (overrides, error) => {
    const r = runtime(overrides);
    expect(await r.run('${pngtuber::happy}')).toMatchObject({ used: true, jobs: [{ ok: false, error }] });
    expect(r.notifyAutomationLocalAgents).not.toHaveBeenCalled();
  });

  test.each(['actions', 'jobs'])('retains execution budget %s and does not swallow safety rejection', async limit => {
    const r = runtime({ commandExecution: safety.createCommandExecutionSafety({ limits: { [limit]: 0 } }) });
    await expect(r.run('${pngtuber::happy}')).rejects.toMatchObject({ code: `command_safety_${limit}_limit` });
    expect(r.enqueueAutomationJob).not.toHaveBeenCalled();
  });

  test('retains durable root job admission', async () => {
    const r = runtime({ commandAdmissionStore: { claimChainJob: jest.fn(async () => false) } });
    await expect(r.run('${pngtuber::happy}')).rejects.toMatchObject({ code: 'command_safety_jobs_limit' });
    expect(r.enqueueAutomationJob).not.toHaveBeenCalled();
  });

  test.each([
    ['${pngtuber::injected}', 'Hello {user.name}'],
    ['${pngtuber::injected}', '${memo::notice}'],
    ['${pngtuber::injected}', '{args}'],
    ['${pngtuber::happy::5}', '${pngtuber::{user.name}::5}'],
    ['${pngtuber::happy::5}', '${pngtuber::happy::{user.points}}'],
    ['${pngtuber::happy}', undefined],
  ])('rendered viewer data cannot authorize %s from %s', async (rendered, template) => {
    const r = runtime();
    expect(await r.run(rendered, { responseTemplate: template })).toMatchObject({ jobs: [{ ok: false, error: 'pngtuber_untrusted_token' }] });
    expect(r.enqueueAutomationJob).not.toHaveBeenCalled();
    expect(r.listAutomationLocalAgents).not.toHaveBeenCalled();
  });

  test('a viewer cannot multiply a reaction already present in the saved template', async () => {
    const r = runtime();
    const token = '${pngtuber::happy::5}';
    const result = await r.run(`${token} ${token} ${token}`, { responseTemplate: `${token} {user.name} {args}` });
    expect(r.enqueueAutomationJob).toHaveBeenCalledTimes(1);
    expect(result.jobs.map(job => job.ok)).toEqual([true, false, false]);
    expect(result.text).not.toContain(token);
  });

  test('separate intentionally saved occurrences still execute', async () => {
    const r = runtime();
    expect((await r.run('${pngtuber::happy} ${pngtuber::happy}')).jobs.map(job => job.ok)).toEqual([true, true]);
    expect(r.enqueueAutomationJob).toHaveBeenCalledTimes(2);
  });

  test('composes with existing blueprint tokens', async () => {
    const calls = [];
    const r = runtime({
      executeActionBlueprint: jest.fn(async () => { calls.push('blueprint'); return { ok: true }; }),
      enqueueAutomationJob: jest.fn(async () => { calls.push('pngtuber'); return { id: 'job-id' }; }),
    });
    expect(await r.run('${action::combo} ${pngtuber::happy} Thanks')).toMatchObject({ text: 'Thanks', jobs: [{ kind: 'blueprint' }, { kind: 'pngtuber' }] });
    expect(calls).toEqual(['blueprint', 'pngtuber']);
    expect(r.executeActionBlueprint).toHaveBeenCalledTimes(1);
    expect(r.enqueueAutomationJob).toHaveBeenCalledTimes(1);
  });

  test.each([{ dryRun: true }, { source: 'manual_test' }, { testMode: 'simulation' }])('simulation has no local effects: %j', async context => {
    const r = runtime();
    expect(await r.run('${pngtuber::happy}', context)).toMatchObject({ text: '', jobs: [{ ok: true, dryRun: true }] });
    expect(r.listAutomationLocalAgents).not.toHaveBeenCalled();
    expect(r.enqueueAutomationJob).not.toHaveBeenCalled();
  });

  test.each(['chzzk', 'cime', 'youtube'])('connected blueprint command works without legacy desktop socket: %s', async platform => {
    const r = runtime();
    const result = await r.command({ source: 'manual_test', testMode: 'connected' }, platform);
    expect(result).toMatchObject({ executed: true, ok: true, commandCostDeducted: false, desktopSent: 0, response: 'Done', actions: [{ kind: 'pngtuber', jobId: 'job-id', ok: true }] });
    expect(r.enqueueAutomationJob).toHaveBeenCalledWith('owner', expect.objectContaining({ jobType: 'pngtuber.show', maxAttempts: 1,
      payload: expect.objectContaining({ testMode: 'connected', platform, noPointCost: true }) }));
    expect(r.listAutomationLocalAgents).toHaveBeenCalledTimes(1);
    expect(r.enqueueVideoDonationFromArgs).not.toHaveBeenCalled();
    expect(r.enqueueRouletteSpin).not.toHaveBeenCalled();
    expect(r.resolveCommandCounterVariables).not.toHaveBeenCalled();
  });

  test('connected command exposes local offline failure', async () => {
    const r = runtime({ listAutomationLocalAgents: async () => [] });
    expect(await r.command({ source: 'manual_test', testMode: 'connected' })).toMatchObject({
      executed: false, ok: false, commandCostDeducted: false, error: 'pngtuber_local_agent_offline',
    });
    expect(r.enqueueAutomationJob).not.toHaveBeenCalled();
  });

  test('a no-cost blueprint replay carries its provenance without a new charge or waiting for 300 seconds', async () => {
    const r = runtime();
    r.rule.responses = ['${pngtuber::happy::300}'];
    const result = await r.command({ source: 'event_log_replay', replayNoCost: true, noPointCost: true });
    expect(result).toMatchObject({ executed: true, commandCostDeducted: false, response: '' });
    expect(r.enqueueAutomationJob).toHaveBeenCalledWith('owner', expect.objectContaining({ payload: expect.objectContaining({
      reactionId: 'happy', durationSec: 300, source: 'blueprint-command', replayNoCost: true, noPointCost: true,
    }) }));
  });

  test('failed PNGTuber jobs are logged as failures, not blueprint IDs or success', async () => {
    const recordBotEventLogSafe = jest.fn();
    const { recordCommandExecutionLog } = loadFunctions(['recordCommandExecutionLog'], {
      recordBotEventLogSafe, updateBotStats: async () => {}, providerFromLogContext: () => 'chzzk',
    });
    await recordCommandExecutionLog(sid, { executed: true, actionJobs: [{ kind: 'pngtuber', jobType: 'pngtuber.show',
      reactionId: 'happy', ok: false, error: 'pngtuber_local_agent_offline' }] });
    expect(recordBotEventLogSafe).toHaveBeenCalledWith(sid, expect.objectContaining({ status: 'failed', metadata: expect.objectContaining({
      actionIds: [], actionJobs: [expect.objectContaining({ reactionId: 'happy', jobType: 'pngtuber.show', ok: false })],
    }) }));
  });
});

function renderer(r) {
  return { commandExecution: r.commandExecution, executeAndStripActionVariableTokens: r.executeAndStripActionVariableTokens,
    substituteAllPlaceholders: async text => text,
    resolveCommandCounterVariables: async (_plan, text) => text,
    resolveCommandMemoVariables: async (_plan, text) => text,
    enqueueRouletteSpin: jest.fn(), readMemos: async () => new Map(),
  };
}

describe('donation, roulette, and shared catalog', () => {
  test.each(['chzzk', 'cime', 'youtube'])('donation response uses saved tokens only: %s', async provider => {
    const r = runtime();
    const injected = '${pngtuber::injected::5}';
    const result = await renderDonationResponse('${pngtuber::happy::5} ${username} ${message}', {
      sid, provider, username: injected, userId: 'donor', amount: 1000, message: injected, source: 'donation-rule',
    }, renderer(r));
    expect(result).toMatchObject({ text: `${injected} ${injected}`, features: ['action'], errors: [], actionJobs: [{ reactionId: 'happy', ok: true }] });
    expect(r.enqueueAutomationJob).toHaveBeenCalledTimes(1);
    expect(r.enqueueAutomationJob.mock.calls[0][1].payload).toMatchObject({ source: 'donation-rule', platform: provider,
      donation: { amount: 1000, message: injected, username: injected }, user: { userId: 'donor', username: injected } });
  });

  test.each(['${pngtuber}', '${pngtuber::happy::}', '${짚톡::happy::NaN}'])('donation tests expose malformed actions instead of silently succeeding: %s', async token => {
    const r = runtime();
    const result = await renderDonationResponse('Thanks ' + token, { sid, provider: 'chzzk', source: 'donation-test' }, renderer(r));
    expect(result.text).toBe('Thanks');
    expect(result.errors).toHaveLength(1);
    expect(result.actionJobs[0].ok).toBe(false);
    expect(r.enqueueAutomationJob).not.toHaveBeenCalled();
  });

  test('donation test reports an offline agent', async () => {
    const r = runtime({ listAutomationLocalAgents: async () => [] });
    const result = await renderDonationResponse('${pngtuber::happy}', { sid, provider: 'chzzk', source: 'donation-test' }, renderer(r));
    expect(result.errors[0].error.code).toBe('pngtuber_local_agent_offline');
    expect(r.enqueueAutomationJob).not.toHaveBeenCalled();
  });

  test('roulette result classifies reactions as actions and preserves no-cost context', async () => {
    const r = runtime();
    const injected = '${pngtuber::injected}';
    const result = await renderRouletteResultTemplate('${pngtuber::happy::5} ${짚톡::default} {user.name}', {
      sid, provider: 'cime', username: injected, userId: 'viewer', noPointCost: true,
      source: 'roulette-result', roulette: { name: 'Wheel' }, result: { label: 'Winner' },
    }, renderer(r));
    expect(result).toMatchObject({ text: injected, commandTemplate: '{user.name}', errors: [],
      features: ['pngtuber', '짚톡'], actionJobs: [{ ok: true }, { ok: true }] });
    expect(r.enqueueAutomationJob).toHaveBeenCalledTimes(2);
    expect(r.enqueueAutomationJob.mock.calls[0][1].payload).toMatchObject({ noPointCost: true, roulette: { name: 'Wheel' }, result: { label: 'Winner' } });
  });

  test.each(['${pngtuber}', '${pngtuber::happy::Infinity}'])('roulette strips and reports invalid reactions: %s', async token => {
    const r = runtime();
    const result = await renderRouletteResultTemplate('Winner ' + token, { sid }, renderer(r));
    expect(result.text).toBe('Winner');
    expect(result.errors).toHaveLength(1);
    expect(result.actionJobs[0].ok).toBe(false);
    expect(r.enqueueAutomationJob).not.toHaveBeenCalled();
  });

  test('command/donation/roulette help exposes example and local-default form without TSX changes', () => {
    const variable = require('./helpers/load-bot-variable-catalog.cjs')().find(entry => entry.key === '${pngtuber::happy::5}');
    expect(variable.contexts).toEqual(['command', 'donation', 'roulette']);
    expect(variable.label).toBe('짚톡 이미지 반응');
    expect(variable.caveat).toContain('${pngtuber::happy}');
    expect(variable.caveat).toContain('0.1~300');
  });

  test.each(['${pngtuber::happy::5}', '${짚톡::happy}'])('binding %s requires actions permission', token => {
    expect(() => assertBotManagerEffects(token, { role: 'manager', scopes: ['commands:write', 'donations:write'] })).toThrow();
    expect(() => assertBotManagerEffects(token, { role: 'manager', scopes: ['actions:write'] })).not.toThrow();
  });
});

describe('actual command handlers keep template authorization and existing points', () => {
  test.each(['youtube', 'cime'])('%s charges only its existing command cost and blocks data-injected reactions', async provider => {
    const r = runtime();
    const functionName = provider === 'youtube' ? 'processYoutubeChatAutomation' : 'processCimeChatAutomation';
    const template = 'Hello {user.name} {args} ${memo::notice} ${pngtuber::saved::5}';
    const sent = [];
    const deductChannelPointsIfEnough = jest.fn(async () => ({ deducted: true, balanceBefore: 1000, balanceAfter: 500 }));
    const bindings = {
      ...r, ...memos, ...counters,
      ...load('server/command-keyword.js', { '../shared/text-safety.js': textSafety, './rule-pattern.js': load('server/rule-pattern.js') }),
      getBotSettings: async () => ({ botEnabled: true, attendanceCommandOnly: false }),
      refreshYoutubeLiveStatus: async () => ({ live: false }), refreshCimeLiveStatus: async () => false,
      isLikelyYoutubeSelfEcho: () => false, isLikelyCimeBotSelfEcho: async () => false,
      participationWheelRuntime: { chat: async () => ({ handled: false }) }, marbleRuntime: { chat: async () => ({ handled: false }) },
      handlePredictionBetCommand: async () => null,
      getRuntimeBotRulesWithDefaults: async () => [{ id: 'rule', keywords: ['!react'], enabled: true, pointsCost: 500, responses: [template] }],
      admitChatCommand: async () => true, claimBotRuleCooldown: async () => ({ claimed: true }),
      deductChannelPointsIfEnough,
      substituteAllPlaceholders: async text => text.replace('{user.name}', '${pngtuber::viewer}').replace('{args}', '${pngtuber::arg}'),
      resolveCommandMemoVariables: (plan, text) => memos.resolveMemoVariablePlan(plan, text, { readMemos: async keys => new Map(keys.map(key => [key, '${pngtuber::memo}'])) }),
      makeYoutubeChatPost: () => ({}), makeCimeChatPost: () => ({}),
      makeCommandReplyKey: ev => ev.id,
      sendYoutubeChat: async (_owner, _chat, text) => sent.push(text), sendCimeChat: async (_owner, text) => sent.push(text),
      getCimeLiveActorRoleLevel: async () => 1,
    };
    const handler = loadFunctions([functionName], bindings)[functionName];
    const entry = { ownerUserId: 'owner', primarySid: sid, channelId: 'channel', connected: false, sentReplies: new Set() };
    await handler(entry, { id: 'paid', userId: 'viewer', user: '${pngtuber::viewer}', role: {}, message: '!react ${pngtuber::arg}' });
    expect(deductChannelPointsIfEnough).toHaveBeenCalledTimes(1);
    expect(deductChannelPointsIfEnough).toHaveBeenCalledWith('channel', 'viewer', '${pngtuber::viewer}', 500);
    expect(r.enqueueAutomationJob).toHaveBeenCalledTimes(1);
    expect(r.enqueueAutomationJob.mock.calls[0][1].payload.reactionId).toBe('saved');
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain('${pngtuber::saved::5}');
    expect(sent[0]).not.toContain('${pngtuber::viewer}');
    expect(sent[0]).not.toContain('${pngtuber::arg}');
    expect(sent[0]).toContain('${pngtuber::memo}'); // Read-only memo data is restored after action execution.

    deductChannelPointsIfEnough.mockResolvedValue({ deducted: false, balanceBefore: 0 });
    await handler(entry, { id: 'unpaid', userId: 'viewer', user: 'Viewer', role: {}, message: '!react' });
    expect(r.enqueueAutomationJob).toHaveBeenCalledTimes(1);
    expect(sent.at(-1)).toContain('포인트가 부족합니다.');
  });
});

describe('shared claim queue does not hand reactions to older local programs', () => {
  test.each([undefined, false, 'true', true])('checks current advertised capability %s', async capability => {
    const jobs = [{ id: 'reaction', job_type: 'pngtuber.show' }, { id: 'obs', job_type: 'obs.discover' }];
    const completeAutomationJobForAgent = jest.fn();
    const touchAutomationLocalAgent = jest.fn();
    const handler = loadFunctions.route('/api/automations/local-agent/jobs/claim', {
      touchAutomationLocalAgent, claimAutomationJobsForAgent: async () => jobs, completeAutomationJobForAgent,
    }, 'post');
    const agent = { id: 'agent', ownerUserId: 'owner', capabilities: { pngtuber: true } };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    await handler({ automationLocalAgent: agent, body: { capabilities: { pngtuber: capability } } }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ jobs: capability === true ? jobs : [jobs[1]] });
    if (capability === true) expect(completeAutomationJobForAgent).not.toHaveBeenCalled();
    else expect(completeAutomationJobForAgent).toHaveBeenCalledWith(agent, 'reaction', {
      status: 'failed', errorMessage: 'pngtuber_local_agent_upgrade_required',
    });
  });
});
