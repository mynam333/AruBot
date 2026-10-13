import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderDonationResponse, dispatchDonationRuleDesktop } from '../server/donation-response.js';
import { CommandSafetyError, createCommandExecutionSafety, isCommandSafetyError } from '../server/command-execution-safety.js';
import { assertSafeTextPayload } from '../shared/text-safety.js';
import { resolveCounterVariablePlan } from '../server/counter-variables.js';

const providers = ['chzzk', 'youtube', 'cime'];
const sources = { chzzk: 'donation-rule', youtube: 'youtube-super-chat-rule', cime: 'cime-donation-rule' };

function fixture(provider = 'chzzk', overrides = {}) {
  const calls = { actions: [], roulettes: [], placeholders: [] };
  const counterCalls = [], memoCalls = [], urlCalls = [];
  const counts = new Map();
  const memos = new Map([['name:공지', '오늘 8시 방송']]);
  const commandExecution = createCommandExecutionSafety();
  const context = {
    sid: 'user:owner', provider, userId: 'donor-id', username: 'Donor', amount: 3000,
    message: 'hello', source: sources[provider], ruleId: 'rule-id', ruleName: 'Rule',
    channelUid: `${provider}-channel`,
    chatPost: {
      provider, ownerUserId: 'owner', sessionKey: 'session-key', accessToken: null,
      liveChatId: 'live-chat-id', channelUid: `${provider}-channel`, resolvedUsername: 'Donor',
    },
    ...overrides,
  };
  const dependencies = {
    commandExecution,
    resolveCommandCounterVariables: async (plan, text, context) => (await resolveCounterVariablePlan(plan, text, {
      ...context,
      incrementCounter: async (entry) => {
        counterCalls.push({ sid: context.sid, ...entry });
        const key = JSON.stringify([context.sid, entry.scope, entry.name, entry.subject]);
        counts.set(key, (counts.get(key) || 0) + 1);
        return counts.get(key);
      },
    })).text,
    readMemos: async (sid, keys) => { memoCalls.push({ sid, keys }); return new Map(keys.map((key) => [key, memos.get(key)])); },
    resolveSongbookPublicUrl: async (...args) => { urlCalls.push(args); return 'https://example.test/c/channel/songbook'; },
    substituteAllPlaceholders: async (text, ...args) => {
      calls.placeholders.push({ text, args });
      return text.replace('{live.title}', 'Live title').replace('{user.points}', '42');
    },
    executeAndStripActionVariableTokens: async (sid, text, actionContext) => {
      calls.actions.push({ sid, text, context: actionContext, chain: commandExecution.capture(sid) });
      return { used: true, text: '', jobs: [{ kind: 'blueprint', actionId: 'thanks', ok: true }] };
    },
    enqueueRouletteSpin: async (sid, item) => {
      commandExecution.consume('jobs');
      calls.roulettes.push({ sid, item, chain: commandExecution.capture(sid) });
    },
  };
  return { context, dependencies, calls, counterCalls, memoCalls, urlCalls, memos, render: (text) => renderDonationResponse(text, context, dependencies) };
}

for (const provider of providers) {
  for (const alias of ['blueprint', 'action', 'automation']) {
    test(`${provider}: ${alias} executes only the trusted token with donation and platform context`, async () => {
      const f = fixture(provider);
      const token = '${' + alias + '::thanks}';
      const result = await f.render('Thanks ${username}! ' + token);
      assert.equal(result.text, 'Thanks Donor!');
      assert.deepEqual(result.features, ['action']);
      assert.equal(f.calls.actions.length, 1);
      assert.equal(f.calls.actions[0].text, token);
      assert.equal(f.calls.actions[0].sid, f.context.sid);
      assert.deepEqual(f.calls.actions[0].context, {
        source: sources[provider], platform: provider, requirePublishedBlueprint: true,
        trigger: { message: 'hello', keyword: 'Rule', platform: provider },
        donation: { amount: 3000, message: 'hello', username: 'Donor', currency: 'KRW' },
        user: { userId: 'donor-id', username: 'Donor' },
        chatPost: f.context.chatPost, channelUid: `${provider}-channel`,
        channel: { channelUid: `${provider}-channel` },
      });
      assert.deepEqual(result.actionJobs, [{ kind: 'blueprint', actionId: 'thanks', ok: true }]);
      assert.deepEqual(result.errors, []);
    });
  }

  test(`${provider}: roulette remains one free deferred spin with the same guarded chain as actions`, async () => {
    const f = fixture(provider);
    const result = await f.render('${roulette::Wheel} ${action::thanks} ${roulette::Ignored}');
    assert.equal(result.text, '');
    assert.deepEqual(result.features, ['roulette', 'action']);
    assert.equal(f.calls.roulettes.length, 1);
    assert.deepEqual(f.calls.roulettes[0].item, {
      name: 'Wheel', userId: 'donor-id', username: 'Donor', chatPost: f.context.chatPost,
      instant: false, eventContext: { source: sources[provider], triggerName: 'Rule' },
    });
    assert.deepEqual(f.calls.roulettes[0].chain, f.calls.actions[0].chain);
    assert.deepEqual(f.calls.actions[0].chain.path, [`donation:${provider}:rule-id`]);
    assert.equal(f.dependencies.commandExecution.current(), null);
  });

  test(`${provider}: donor nickname and message stay literal, including special tokens and memo/command content`, async () => {
    const username = '$& ${blueprint::nickname} {user.points}';
    const message = '!write ${memo::secret} ${roulette::Injected} ${action::injected} ${automation::injected} ${username} {donation.amount}';
    const f = fixture(provider, { username, message });
    const result = await f.render('${username}|{user.name}|{user.username}|{user.nickname}|${message}|{donation.message}|${blueprint::thanks}');
    assert.equal(result.text, [username, username, username, username, message, message, ''].join('|'));
    assert.equal(f.calls.actions.length, 1);
    assert.equal(f.calls.actions[0].text, '${blueprint::thanks}');
    assert.equal(f.calls.actions[0].context.trigger.message, message);
    assert.equal(f.calls.actions[0].context.donation.message, message);
    assert.equal(f.calls.actions[0].context.command, undefined);
    assert.equal(f.calls.actions[0].context.args, undefined);
    assert.equal(f.calls.actions[0].context.argsText, undefined);
    assert.equal(f.calls.roulettes.length, 0);
    assert.ok(!f.calls.placeholders[0].text.includes(message));
    assert.ok(!f.calls.placeholders[0].text.includes(username));
  });
}

test('legacy donation values, donation aliases, and normal read-only variables still render', async () => {
  const f = fixture();
  const result = await f.render(' ${ username }/${ amount }/${ message } | {donation.username}/{donation.amount}/{donation.message} | {user.id} | {live.title} | {user.points} ');
  assert.equal(result.text, 'Donor/3000/hello | Donor/3000/hello | donor-id | Live title | 42');
  assert.deepEqual(f.calls.placeholders[0].args, ['user:owner', 'donor-id', 'Donor', { provider: 'chzzk' }]);
  assert.deepEqual(result.features, []);
  assert.equal(f.calls.actions.length, 0);
  assert.equal(f.calls.roulettes.length, 0);
});

for (const provider of providers) {
  test(`${provider}: counters, named memo, songbook URL and effects work in one trusted donation response`, async () => {
    const f = fixture(provider);
    const template = '${username}: ${counter::user::후원}/${counter::user::후원}/${counter::global::전체} ${memo::공지} ${songbook_url} ${blueprint::thanks} ${roulette::Wheel}';
    const result = await f.render(template);
    assert.equal(result.text, 'Donor: 1/1/1 오늘 8시 방송 https://example.test/c/channel/songbook');
    assert.deepEqual(result.features, ['counter', 'roulette', 'action']);
    assert.deepEqual(f.counterCalls, [
      { sid: 'user:owner', scope: 'user', name: '후원', subject: `${provider}:donor-id` },
      { sid: 'user:owner', scope: 'global', name: '전체', subject: null },
    ]);
    assert.deepEqual(f.memoCalls, [{ sid: 'user:owner', keys: ['name:공지'] }]);
    assert.deepEqual(f.urlCalls, [['user:owner', provider]]);
    assert.match((await f.render(template)).text, /^Donor: 2\/2\/2 /);
  });
}

test('donor and memo data cannot increment counters, read another memo or execute nested effects', async () => {
  const injected = '${counter::global::injected} ${memo::private} ${songbook_url} ${blueprint::bad}';
  const f = fixture('chzzk', { message: injected, username: injected });
  f.memos.set('name:공지', injected);
  const result = await f.render('${message}|${username}|${memo::공지}|${counter::global::trusted}');
  assert.equal(result.text, `${injected}|${injected}|${injected}|1`);
  assert.deepEqual(f.counterCalls.map((entry) => entry.name), ['trusted']);
  assert.deepEqual(f.memoCalls, [{ sid: 'user:owner', keys: ['name:공지'] }]);
  assert.deepEqual(f.urlCalls, []);
  assert.equal(f.calls.actions.length, 0);
  assert.equal(f.calls.roulettes.length, 0);
});

test('donation input never writes named memos and cannot read command-scoped memos', async () => {
  const f = fixture('chzzk', { message: '!공지 덮어쓰기', ruleId: 'command-id' });
  const result = await f.render('${memo} ${memo::공지} ${memo::공지}');
  assert.equal(result.text, '오늘 8시 방송 오늘 8시 방송');
  assert.deepEqual(f.memoCalls, [{ sid: 'user:owner', keys: ['name:공지'] }]);
  assert.equal(f.memos.get('name:공지'), '오늘 8시 방송');
});

test('anonymous donor cannot mutate a shared user counter but global counter remains available', async () => {
  const f = fixture('chzzk', { userId: null });
  const result = await f.render('${counter::user::후원}/${counter::global::전체}');
  assert.equal(result.text, '확인 불가/1');
  assert.deepEqual(f.counterCalls.map((entry) => entry.scope), ['global']);
});

test('counter and memo lookups fail without leaking sentinels or blocking trusted actions', async () => {
  const f = fixture();
  f.dependencies.resolveCommandCounterVariables = async () => { throw new Error('counter unavailable'); };
  f.dependencies.readMemos = async () => { throw new Error('memo unavailable'); };
  const result = await f.render('${counter::global::후원} ${memo::공지} ${action::thanks}');
  assert.equal(result.text, '확인 불가 메모를 불러오지 못했습니다.');
  assert.equal(f.calls.actions.length, 1);
  assert.equal(result.errors[0].phase, 'counter');
});

test('lookup data cannot choose a counter name or memo key', async () => {
  const f = fixture();
  await f.render('${counter::global::${message}} ${memo::${message}}');
  assert.equal(f.counterCalls.length, 0);
  assert.equal(f.memoCalls.length, 0);
});

test('donor-only injected special tokens never schedule any effects', async () => {
  const f = fixture('youtube', { username: '${action::bad}', message: '${roulette::bad} ${blueprint::bad} ${automation::bad}' });
  const result = await f.render('${username} ${message}');
  assert.equal(result.text, `${f.context.username} ${f.context.message}`);
  assert.deepEqual(result.features, []);
  assert.equal(f.calls.actions.length, 0);
  assert.equal(f.calls.roulettes.length, 0);
});

test('tokens returned by global placeholder lookups are not executable', async () => {
  const f = fixture();
  f.dependencies.substituteAllPlaceholders = async () => '${action::injected} ${roulette::Injected} ${memo::key}';
  const result = await f.render('{live.title} ${automation::trusted}');
  assert.equal(result.text, '${action::injected} ${roulette::Injected} ${memo::key}');
  assert.equal(f.calls.actions[0].text, '${automation::trusted}');
  assert.equal(f.calls.roulettes.length, 0);
});

test('donor fields cannot supply executable action or roulette targets', async () => {
  const f = fixture('cime', { message: 'dangerous', username: 'Wheel' });
  await f.render('${action::${message}} ${blueprint::{donation.message}} ${roulette::${username}}');
  assert.equal(f.calls.actions.length, 0);
  assert.equal(f.calls.roulettes.length, 0);
});

test('mixed-case aliases and duplicate trusted action tokens keep their order', async () => {
  const f = fixture();
  const tokens = ['${ Blueprint:: One }', '${ACTION::two}', '${automation::One}', '${action::two}'];
  const result = await f.render(tokens.join(' '));
  assert.equal(f.calls.actions[0].text, tokens.join('\n'));
  assert.equal(result.text, '');
  assert.deepEqual(result.features, ['action']);
});

test('blank special targets have no side effects and an empty response stays empty', async () => {
  const f = fixture();
  const result = await f.render('${roulette:: } ${action:: }');
  assert.equal(result.text, '');
  assert.deepEqual(result.features, []);
  assert.equal(f.calls.actions.length, 0);
  assert.equal(f.calls.roulettes.length, 0);
  assert.equal((await f.render(null)).text, '');
});

test('global lookup failures preserve the ordinary donor response and still run trusted actions', async () => {
  const f = fixture();
  f.dependencies.substituteAllPlaceholders = async () => { throw new Error('lookup unavailable'); };
  const result = await f.render('${username}: ${message} {live.title} ${action::thanks}');
  assert.equal(result.text, 'Donor: hello {live.title}');
  assert.equal(result.errors[0].phase, 'placeholders');
  assert.equal(f.calls.actions.length, 1);
});

test('ordinary roulette and action failures do not suppress response text', async () => {
  const f = fixture();
  f.dependencies.enqueueRouletteSpin = async () => { throw new Error('roulette unavailable'); };
  f.dependencies.executeAndStripActionVariableTokens = async () => { throw new Error('action unavailable'); };
  const result = await f.render('Thanks ${username} ${roulette::Wheel} ${blueprint::thanks}');
  assert.equal(result.text, 'Thanks Donor');
  assert.deepEqual(result.errors.map((failure) => failure.phase), ['roulette', 'action']);
  assert.deepEqual(result.features, ['action']);
});

test('returned failed action jobs are reported with action IDs while ordinary response text survives', async () => {
  const f = fixture();
  const jobs = [
    { actionId: 'missing', ok: false, error: 'blueprint_not_found' },
    { actionId: 'broken', result: { ok: false, error: 'node_failed', errorCode: 'node_error' } },
    { actionId: 'working', ok: true },
  ];
  f.dependencies.executeAndStripActionVariableTokens = async () => ({ used: true, jobs });
  const result = await f.render('Thanks ${blueprint::missing} ${action::broken} ${automation::working}');
  assert.equal(result.text, 'Thanks');
  assert.deepEqual(result.actionJobs, jobs);
  assert.deepEqual(result.errors.map(({ phase, error }) => [phase, error.message, error.code]), [
    ['action', 'missing: blueprint_not_found', 'blueprint_not_found'],
    ['action', 'broken: node_failed', 'node_error'],
  ]);
});

test('a returned command-safety failure propagates even without a stopped local budget', async () => {
  const f = fixture();
  f.dependencies.executeAndStripActionVariableTokens = async () => ({
    used: true, jobs: [{ actionId: 'blocked', ok: false, error: 'command_safety_actions_limit' }],
  });
  await assert.rejects(f.render('Thanks ${action::blocked}'), { code: 'command_safety_actions_limit' });
});

for (const phase of ['substituteAllPlaceholders', 'enqueueRouletteSpin', 'executeAndStripActionVariableTokens']) {
  test(`command safety failures in ${phase} propagate rather than continuing with a fresh budget`, async () => {
    const f = fixture();
    f.dependencies[phase] = async () => { throw new CommandSafetyError('jobs_limit'); };
    await assert.rejects(f.render('${roulette::Wheel} ${action::thanks}'), { code: 'command_safety_jobs_limit' });
    assert.equal(f.calls.actions.length, 0);
    assert.equal(f.dependencies.commandExecution.current(), null);
  });
}

test('shared guard catches a swallowed execution stop before returning chat text', async () => {
  const f = fixture();
  f.dependencies.executeAndStripActionVariableTokens = async () => {
    try { f.dependencies.commandExecution.reject('actions_limit'); } catch { /* Simulate a nested executor result. */ }
    return { used: true, jobs: [{ ok: false, error: 'command_safety_actions_limit' }] };
  };
  await assert.rejects(f.render('Thanks ${action::thanks}'), { code: 'command_safety_actions_limit' });
});

test('unsafe donor text is rejected before lookups or side effects', async () => {
  const f = fixture('chzzk', { message: 'x\u0301\u0301' });
  await assert.rejects(f.render('${message} ${roulette::Wheel} ${action::thanks}'), { code: 'zalgo_text_not_allowed' });
  assert.deepEqual(f.calls, { actions: [], roulettes: [], placeholders: [] });
});

// Read and compile only owned, dependency-injected blocks. Never import the server entrypoint.
const serverSource = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const wrapperStart = serverSource.indexOf('async function renderDonationRuleResponse(');
const wrapperEnd = serverSource.indexOf('async function processYoutubeDonationAutomation(', wrapperStart);
assert.ok(wrapperStart >= 0 && wrapperEnd > wrapperStart);
const wrapperSource = serverSource.slice(wrapperStart, wrapperEnd);

function bindExistingActionExecutor(f, overrides = {}) {
  const start = serverSource.indexOf('async function executeActionVariableTokens(');
  const end = serverSource.indexOf('function openApiList(', start);
  assert.ok(start >= 0 && end > start);
  const bindings = {
    commandExecution: f.dependencies.commandExecution, assertSafeTextPayload, isCommandSafetyError,
    ownerUserIdFromSid: (sid) => sid.replace(/^user:/, ''),
    getRuntimeActionBlueprint: async (_owner, actionId) => ({ id: actionId, name: actionId, version: { published: true } }),
    executeActionBlueprint: async () => ({ ok: true, run: { id: 'run-id' } }),
    queueAutomationJob: async () => { assert.fail('unexpected legacy automation fallback'); },
    ...overrides,
  };
  f.dependencies.executeAndStripActionVariableTokens = new Function(
    ...Object.keys(bindings),
    `${serverSource.slice(start, end)}; return executeAndStripActionVariableTokens;`,
  )(...Object.values(bindings));
}

for (const provider of providers) {
  test(`${provider}: existing executor reaches published blueprints for all three aliases without donor token execution`, async () => {
    const f = fixture(provider, { username: '${action::injected-name}', message: '!memo ${automation::injected-message}' });
    const runs = [];
    bindExistingActionExecutor(f, {
      executeActionBlueprint: async (owner, actionId, context) => {
        runs.push({ owner, actionId, context });
        assert.deepEqual(f.dependencies.commandExecution.current().path, [`donation:${provider}:rule-id`]);
        return { ok: true, run: { id: `run-${actionId}` } };
      },
    });
    const result = await f.render('${username} ${message} ${blueprint::first} ${action::second} ${automation::third}');
    assert.deepEqual(runs.map((run) => run.actionId), ['first', 'second', 'third']);
    assert.deepEqual(result.actionJobs.map((job) => job.runId), ['run-first', 'run-second', 'run-third']);
    for (const run of runs) {
      assert.equal(run.owner, 'owner');
      assert.equal(run.context.noPointCost, undefined);
      assert.equal(run.context.requirePublishedBlueprint, true);
      assert.equal(run.context.donation.message, f.context.message);
      assert.equal(run.context.user.username, f.context.username);
      assert.equal(run.context.chatPost, f.context.chatPost);
    }
    assert.equal(result.text, `${f.context.username} ${f.context.message}`);
  });
}

for (const alias of ['blueprint', 'action', 'automation']) {
  for (const publishedState of ['missing', 'unpublished']) {
    test(`${alias}: existing executor reports ${publishedState} blueprint without legacy queue fallback`, async () => {
      const f = fixture('cime', { message: '${automation::injected}' });
      const queued = [];
      bindExistingActionExecutor(f, {
        getRuntimeActionBlueprint: async () => publishedState === 'missing' ? null : { id: 'draft', version: { published: false } },
        queueAutomationJob: async (owner, job) => { queued.push({ owner, job }); return { id: 'legacy-job' }; },
      });
      const result = await f.render('${message} ${' + alias + '::device-action}');
      const expectedError = publishedState === 'missing' ? 'blueprint_not_found' : 'blueprint_not_published';
      assert.equal(queued.length, 0);
      assert.equal(result.actionJobs[0].ok, false);
      assert.equal(result.actionJobs[0].error, expectedError);
      assert.equal(result.errors[0].phase, 'action');
      assert.equal(result.errors[0].error.message, `device-action: ${expectedError}`);
      assert.equal(result.text, '${automation::injected}');
    });
  }
}

test('existing executor shares the donation action budget across tokens', async () => {
  const f = fixture();
  f.dependencies.commandExecution = createCommandExecutionSafety({ limits: { actions: 2 } });
  const runs = [];
  bindExistingActionExecutor(f, {
    executeActionBlueprint: async (_owner, actionId) => { runs.push(actionId); return { ok: true }; },
  });
  await assert.rejects(f.render('${action::first} ${action::second}'), { code: 'command_safety_actions_limit' });
  assert.deepEqual(runs, ['first']);
});

for (const provider of providers) {
  test(`${provider}: actual handler block wires context, features log, and chat suppression`, async () => {
    const f = fixture(provider);
    const desktop = [];
    const deps = { renderDonationResponse, dispatchDonationRuleDesktop, assertSafeTextPayload,
      broadcastToDesktop: (...args) => { desktop.push(args); return 1; },
      ...f.dependencies, memoVariableStore: { read: f.dependencies.readMemos } };
    const wrappers = new Function(...Object.keys(deps), `${wrapperSource}; return { renderDonationRuleResponse, donationResponseTargetName };`)(...Object.values(deps));
    const marker = "const { text: built, features: donationFeatures } = await renderDonationRuleResponse(r, {";
    const blocks = [...serverSource.matchAll(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))];
    const blockStart = blocks.find((match) => serverSource.slice(match.index, match.index + 200).includes(`provider: '${provider}'`))?.index;
    assert.ok(Number.isInteger(blockStart));
    const sendMarker = 'responsesToSend.push(built);';
    const blockEnd = serverSource.indexOf(sendMarker, blockStart) + sendMarker.length;
    const block = serverSource.slice(blockStart, blockEnd);
    assert.ok(!/deductChannelPoints|resolveCommandMemoVariables|executeBlueprintCommandNode/.test(block));
    const logs = [];
    const responsesToSend = [];
    const input = {
      ...wrappers, sid: 'user:owner', ownerUserId: 'owner',
      donorId: 'donor-id', donorName: 'Donor', donorMessage: '!memo ${action::injected}', amount: 3000,
      entry: { sessionKey: 'session-key', channelId: `${provider}-channel`, liveChatId: 'live-chat-id' },
      channelUid: `${provider}-channel`, responsesToSend,
      recordDonationRuleExecutionLog: async (_sid, log) => logs.push(log),
      makeChzzkChatPost: (sessionKey, accessToken, resolvedUsername, extra) => ({ provider: 'chzzk', sessionKey, accessToken, resolvedUsername, ...extra }),
      makeYoutubeChatPost: (ownerUserId, liveChatId, resolvedUsername, extra) => ({ provider: 'youtube', ownerUserId, liveChatId, resolvedUsername, ...extra }),
      makeCimeChatPost: (ownerUserId, resolvedUsername, extra) => ({ provider: 'cime', ownerUserId, resolvedUsername, ...extra }),
    };
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const runBlock = new AsyncFunction('r', ...Object.keys(input), block);
    await runBlock({ id: 'rule-id', name: 'Rule', response: '${roulette::Wheel} ${blueprint::thanks}' }, ...Object.values(input));
    assert.deepEqual(responsesToSend, []);
    assert.equal(desktop.length, 1);
    assert.equal(desktop[0][1].cmd, 'Rule');
    assert.deepEqual(logs[0].features, ['roulette', 'action']);
    assert.equal(logs[0].targetName, '\ub8f0\ub81b/\uc561\uc158 \uc2e4\ud589');
    assert.equal(logs[0].source, sources[provider]);
    const actionContext = f.calls.actions[0].context;
    assert.equal(actionContext.platform, provider);
    assert.equal(actionContext.channelUid, `${provider}-channel`);
    assert.equal(actionContext.chatPost.provider, provider);
    assert.equal(actionContext.chatPost.channelUid, `${provider}-channel`);
    assert.equal(actionContext.noPointCost, undefined);
    assert.equal(actionContext.requirePublishedBlueprint, true);
    if (provider === 'chzzk') assert.equal(actionContext.chatPost.sessionKey, 'session-key');
    if (provider === 'youtube') assert.equal(actionContext.chatPost.liveChatId, 'live-chat-id');
    await runBlock({ id: 'plain', response: '${message}' }, ...Object.values(input));
    assert.deepEqual(responsesToSend, ['!memo ${action::injected}']);
    assert.equal(f.calls.actions.length, 1);
    assert.equal(f.calls.roulettes.length, 1);
    assert.deepEqual(logs[1].features, []);
  });
}
