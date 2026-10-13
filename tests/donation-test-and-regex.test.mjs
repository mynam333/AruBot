import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createDonationTestHandler } from '../server/donation-test.js';
import { renderDonationResponse, dispatchDonationRuleDesktop } from '../server/donation-response.js';
import { createCommandExecutionSafety } from '../server/command-execution-safety.js';
import { donationRuleMatchesMessage, validateRulePattern, validateCommandRuleRegex } from '../server/rule-pattern.js';
import { getCommandRuleMatches } from '../server/command-keyword.js';
import { parseCommandTriggers, formatCommandTriggers } from '../src/features/admin/command-triggers.js';

const rule = { id: 'r1', name: 'local-command', enabled: true, minAmount: 1000, regex: true,
  message: '(돌려|룰렛)', response: '${username}: ${message} ${roulette::wheel} ${blueprint::thanks}' };

function fixture(overrides = {}) {
  const calls = { desktop: [], roulette: [], blueprint: [], logs: [], chat: [] };
  const deps = {
    getPartitionId: async () => 'user:owner',
    getBotSettings: async () => ({ onlyWhenLive: true, donationRules: [rule] }),
    donationRuleMatchesAmount: (item, amount) => amount >= item.minAmount,
    resolveContext: async (_sid, provider) => ({ channelUid: `${provider}-offline`, chatPost: { provider, liveChatId: null } }),
    claimRuntimeLease: async () => ({ acquired: true }), releaseRuntimeLease: async () => true,
    renderDonationRuleResponse: async (item, context) => ({
      ...dispatchDonationRuleDesktop(item, context, { broadcastToDesktop: (...args) => { calls.desktop.push(args); return 1; } }),
      ...await renderDonationResponse(item.response, { ...context, ruleId: item.id, ruleName: item.name }, {
        commandExecution: createCommandExecutionSafety(), substituteAllPlaceholders: async text => text,
        executeAndStripActionVariableTokens: async (...args) => { calls.blueprint.push(args); return { used: true, text: '', jobs: [{ ok: true }] }; },
        enqueueRouletteSpin: async (...args) => { calls.roulette.push(args); },
      }),
    }),
    sendChatByPost: async (...args) => { calls.chat.push(args); return {}; },
    recordDonationRuleExecutionLog: async (...args) => { calls.logs.push(args); },
    ...overrides,
  };
  const handler = createDonationTestHandler(deps);
  const request = (body = {}, botManagement) => ({ body: { amount: 1000, username: '시청자 1', message: '룰렛 돌려',
    requestId: randomUUID(), confirmExecution: true, provider: 'chzzk', ...body }, botManagement });
  const run = async req => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler(req, res); return res;
  };
  return { calls, deps, request, run };
}

for (const provider of ['chzzk', 'cime', 'youtube']) {
  test(`${provider}: offline tests execute shared roulette, blueprint and desktop paths without donation points`, async () => {
    const f = fixture(), res = await f.run(f.request({ provider, message: '룰렛 ${blueprint::injected}' }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.pointsAwarded, 0);
    assert.equal(res.body.results[0].status, 'executed');
    assert.equal(res.body.results[0].desktopSent, 1);
    assert.equal(f.calls.desktop[0][1].source, 'donation-test');
    assert.equal(f.calls.roulette.length, 1);
    assert.equal(f.calls.roulette[0][1].chatPost.suppressResultChat, true);
    assert.equal(f.calls.blueprint.length, 1);
    assert.equal(f.calls.blueprint[0][1], '${blueprint::thanks}');
    assert.equal(f.calls.blueprint[0][2].requirePublishedBlueprint, true);
    assert.equal(f.calls.blueprint[0][2].channelUid, `${provider}-offline`);
    assert.equal(f.calls.chat.length, 0);
    assert.equal(f.calls.logs[0][1].source, 'donation-test');
  });
}

test('conditions and disabled rules are honored', async () => {
  for (const body of [{ amount: 999 }, { message: '안녕하세요' }]) {
    const f = fixture(), res = await f.run(f.request(body));
    assert.equal(res.body.matchedCount, 0); assert.equal(f.calls.desktop.length, 0);
  }
  const f = fixture({ getBotSettings: async () => ({ donationRules: [{ ...rule, enabled: false }] }) });
  assert.equal((await f.run(f.request())).body.matchedCount, 0);
});

test('duplicate and rapid requests cannot execute twice', async () => {
  const f = fixture(), req = f.request();
  assert.equal((await f.run(req)).statusCode, 200);
  assert.equal((await f.run(req)).statusCode, 409);
  assert.equal((await f.run(f.request())).statusCode, 429);
  assert.equal(f.calls.desktop.length, 1);
});

test('cross-instance lease rejection prevents execution', async () => {
  const f = fixture({ claimRuntimeLease: async key => ({ acquired: !key.startsWith('donation-test:') }) });
  assert.equal((await f.run(f.request())).statusCode, 409);
  assert.equal(f.calls.desktop.length, 0);
});

test('all matched effects are authorized before any execution', async () => {
  const f = fixture({ getBotSettings: async () => ({ donationRules: [{ ...rule, response: 'plain' }, rule] }) });
  const access = { role: 'manager', scopes: ['donations:write', 'automations:write'] };
  assert.equal((await f.run(f.request({}, access))).statusCode, 403);
  assert.equal(f.calls.desktop.length, 0);
});

test('confirmation, login, bounds and read-only scopes are enforced', async () => {
  for (const body of [{ confirmExecution: false }, { amount: 0 }, { amount: 1.5 }, { message: {} }, { username: '' }, { provider: 'other' }, { requestId: 'short' }]) {
    const f = fixture(); assert.equal((await f.run(f.request(body))).statusCode, 400); assert.equal(f.calls.desktop.length, 0);
  }
  const f = fixture();
  assert.equal((await f.run(f.request({}, { role: 'manager', scopes: ['donations:read'] }))).statusCode, 403);
  const unauthenticated = fixture({ getPartitionId: async () => null });
  assert.equal((await unauthenticated.run(unauthenticated.request())).statusCode, 401);
});

test('chat failure does not undo or suppress offline effects', async () => {
  const f = fixture({ sendChatByPost: async () => null });
  const res = await f.run(f.request({ sendChat: true }));
  assert.equal(res.body.results[0].status, 'partial');
  assert.equal(f.calls.blueprint.length, 1);
  assert.equal(f.calls.roulette[0][1].chatPost.suppressResultChat, false);
});

test('one failing rule does not suppress later reactions', async () => {
  const f = fixture({ getBotSettings: async () => ({ donationRules: [rule, { ...rule, id: 'r2' }] }) });
  const original = f.deps.renderDonationRuleResponse;
  f.deps.renderDonationRuleResponse = (item, context) => { if (item.id === 'r1') throw new Error('failed blueprint'); return original(item, context); };
  const res = await f.run(f.request());
  assert.deepEqual(res.body.results.map(item => item.status), ['failed', 'executed']);
});

test('regex matching preserves literal command behavior and extracts the unmatched arguments', () => {
  assert.equal(getCommandRuleMatches('!hello there', [{ keywords: ['!hello'] }])[0].match.argsText, 'there');
  assert.equal(getCommandRuleMatches('!helloworld', [{ keywords: ['!hello'] }]).length, 0);
  const rules = [{ keywords: ['!(노래|신청)\\s+'], regex: true }];
  assert.equal(getCommandRuleMatches('!신청 곡 이름', rules)[0].match.argsText, '곡 이름');
  assert.equal(getCommandRuleMatches('앞에 !신청 곡', rules).length, 0);
  assert.equal(getCommandRuleMatches('!😀 곡', [{ keywords: ['!😀'], regex: true }])[0].match.argsText, '곡');
});

test('donation regex searches the message while legacy prefix/substring remain distinct', () => {
  assert.equal(donationRuleMatchesMessage({ regex: true, message: '(룰렛|spin)' }, 'please SPIN'), true);
  assert.equal(donationRuleMatchesMessage({ message: 'spin' }, 'please spin'), false);
  assert.equal(donationRuleMatchesMessage({ message: 'spin', wildcard: true }, 'please spin'), true);
  assert.equal(donationRuleMatchesMessage({ regex: true, message: '^spin$' }, 'please spin'), false);
  assert.equal(donationRuleMatchesMessage({}, 'anything'), true);
});

test('invalid, unsupported, empty and oversized patterns are rejected safely', () => {
  for (const pattern of ['', '[', '(?=x)x', '(x)\\1', 'a'.repeat(257)]) assert.throws(() => validateRulePattern(pattern), { status: 400 });
  assert.throws(() => validateCommandRuleRegex({ regex: true, keywords: ['a*'] }), { status: 400 });
  assert.throws(() => validateCommandRuleRegex({ regex: true, keywords: Array(21).fill('a') }), { status: 400 });
  assert.equal(donationRuleMatchesMessage({ regex: true, message: '[' }, 'a'), false);
  assert.equal(donationRuleMatchesMessage({ regex: true, message: '^(a+)+$' }, `${'a'.repeat(4000)}!`), false);
  assert.equal(donationRuleMatchesMessage({ regex: true, message: 'a' }, 'a'.repeat(4097)), false);
});

test('regex editing keeps spaces, newlines and case-sensitive escape classes intact', () => {
  const expressions = ['!hello world', '!\\d+', '!\\D+'];
  assert.deepEqual(parseCommandTriggers(formatCommandTriggers(expressions, { regex: true }), { regex: true }), expressions);
  assert.deepEqual(parseCommandTriggers('!hello !HELLO !world'), ['!hello', '!world']);
});
