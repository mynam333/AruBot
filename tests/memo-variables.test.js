const fs = require('fs');
const path = require('path');
const load = require('./helpers/load-source.cjs');
const loadFunctions = require('./helpers/load-server-functions.cjs');
const safety = load('shared/text-safety.js');
const memo = load('server/memo-variables.js', { '../shared/text-safety.js': safety });
const { createMemoVariableStore } = load('server/memo-variable-store.js', { './memo-variables.js': memo });

function memoryStore() {
  const data = new Map();
  const read = jest.fn(async (sid, keys) => new Map(keys.filter((key) => data.has(`${sid}:${key}`)).map((key) => [key, data.get(`${sid}:${key}`)])));
  const write = jest.fn(async (sid, keys, value) => {
    keys.forEach((key) => data.set(`${sid}:${key}`, value));
    return new Map(keys.map((key) => [key, value]));
  });
  const store = { read, write };
  const { resolveCommandMemoVariables: render } = loadFunctions(['resolveCommandMemoVariables'], { ...memo, memoVariableStore: store });
  return { store, render };
}

test('admin arguments round-trip literally; no second pass evaluates stored variables', async () => {
  const { store, render } = memoryStore();
  const plan = memo.prepareMemoVariablePlan('공지: ${memo::공지}', { ruleId: 'rule' });
  const text = '내일  8시! ${blueprint::실행금지} {user.name} $&\n끝  ';
  expect(await render(plan, plan.text, { sid: 'user:a', argsText: text, canWrite: true })).toBe(`공지: ${text}`);
  expect(await render(plan, plan.text, { sid: 'user:a' })).toBe(`공지: ${text}`);
  expect(store.write).toHaveBeenCalledTimes(1);
  expect(await render(plan, plan.text, { sid: 'user:b' })).toBe(`공지: ${memo.MEMO_EMPTY_TEXT}`);
});

test.each([false, undefined, 1, 'true', async () => { throw new Error('role unavailable'); }])('unverified permission %p never writes', async (canWrite) => {
  const { store, render } = memoryStore();
  const plan = memo.prepareMemoVariablePlan('${memo}', { ruleId: 'rule-1' });
  await render(plan, plan.text, { sid: 'user:a', argsText: 'not allowed', canWrite });
  expect(store.write).not.toHaveBeenCalled();
  expect(store.read).toHaveBeenCalledWith('user:a', ['rule:rule-1']);
});

test('no arguments only reads and does not perform a manager lookup', async () => {
  const { store, render } = memoryStore();
  const canWrite = jest.fn(async () => true);
  const plan = memo.prepareMemoVariablePlan('${memo}', { ruleId: 'rule' });
  await render(plan, plan.text, { sid: 'user:a', argsText: ' \t ', canWrite });
  expect(canWrite).not.toHaveBeenCalled();
  expect(store.write).not.toHaveBeenCalled();
});

test('duplicates share one value and default memos are stable per rule', async () => {
  const { store, render } = memoryStore();
  const plan = memo.prepareMemoVariablePlan('${memo}/${memo}/${memo:: Ａ 공지 }/${memo::A 공지}', { ruleId: 'rule-1' });
  expect(plan.entries.map((entry) => entry.key)).toEqual(['rule:rule-1', 'name:A 공지']);
  expect(await render(plan, plan.text, { sid: 'user:a', argsText: '원문', canWrite: true })).toBe('원문/원문/원문/원문');
  expect(store.write).toHaveBeenCalledWith('user:a', ['rule:rule-1', 'name:A 공지'], '원문');
  const another = memo.prepareMemoVariablePlan('${memo}', { ruleId: 'rule-2' });
  expect(await render(another, another.text, { sid: 'user:a' })).toBe(memo.MEMO_EMPTY_TEXT);
});

test('malformed or excess variables cannot create keys', () => {
  const plan = memo.prepareMemoVariablePlan('${memo}${memo::../x}${memo::bad::key}' + Array.from({ length: 20 }, (_, i) => `\${memo::n${i}}`).join(' '));
  expect(plan.entries).toHaveLength(16);
  expect(plan.entries[0].key).toBe('name:n0');
});

test('removed or injected variables do not read or write the store', async () => {
  const { store, render } = memoryStore();
  const plan = memo.prepareMemoVariablePlan('${memo::safe}');
  expect(await render(plan, '${memo::injected}', { sid: 'user:a', argsText: 'x', canWrite: true })).toBe('');
  expect(store.read).not.toHaveBeenCalled();
  expect(store.write).not.toHaveBeenCalled();
});

test.each(['x'.repeat(4001), 'x\0x', 'a\u0301\u0301\u0301\u0301'])('invalid input fails without partial/truncated storage', async (argsText) => {
  const { store, render } = memoryStore();
  const plan = memo.prepareMemoVariablePlan('${memo::safe}');
  expect(await render(plan, plan.text, { sid: 'user:a', argsText, canWrite: true })).toBe('메모를 저장하지 못했습니다.');
  expect(store.write).not.toHaveBeenCalled();
});

test('database failure is visible and never echoes an unsaved value as success', async () => {
  const plan = memo.prepareMemoVariablePlan('${memo::safe}');
  const fail = async () => { throw new Error('offline'); };
  expect(await memo.resolveMemoVariablePlan(plan, plan.text, { canWrite: true, argsText: 'new', writeMemos: fail })).toBe('메모를 저장하지 못했습니다.');
  expect(await memo.resolveMemoVariablePlan(plan, plan.text, { readMemos: fail })).toBe('메모를 불러오지 못했습니다.');
});

test('argument extraction removes only the command separator and preserves internal/trailing whitespace', () => {
  expect(memo.memoCommandArguments(' !공지  오늘  8시\n생방송!  ', '!공지')).toBe('오늘  8시\n생방송!  ');
  expect(memo.memoCommandArguments('!공지사항', '!공지')).toBe('');
  expect(memo.memoCommandArguments('!NOTICE text', '!notice')).toBe('text');
});

test('store uses parameterized, atomic multi-key upsert without automatic retry', async () => {
  const query = jest.fn(async (_sql, params) => ({ rows: params[1].map((key) => ({ memo_key: key, value: params[2] })) }));
  const withPgClient = jest.fn((fn) => fn({ query }));
  const store = createMemoVariableStore({ withPgClient });
  await store.write('user:a', ['name:공지', 'rule:id'], "'quoted'  literal");
  expect(query.mock.calls[0][0]).toContain('on conflict (sid, memo_key)');
  expect(query.mock.calls[0][0]).not.toContain("'quoted'");
  expect(query.mock.calls[0][1]).toEqual(['user:a', ['name:공지', 'rule:id'], "'quoted'  literal"]);
  expect(withPgClient.mock.calls[0][1]).toBe(0);
  await store.read('user:b', ['name:공지']);
  expect(query.mock.calls[1][0]).toContain('where sid = $1');
  expect(query.mock.calls[1][1]).toEqual(['user:b', ['name:공지']]);
  await expect(store.write('', ['name:공지'], 'x')).rejects.toThrow();
  await expect(store.write('user:a', ['bad-key'], 'x')).rejects.toThrow();
});

test('schema and account lifecycle isolate private memo state', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../server/migrations/029_bot_memo_values.sql'), 'utf8');
  const database = fs.readFileSync(path.join(__dirname, '../server/supabase.js'), 'utf8');
  expect(migration).toContain('primary key (sid, memo_key)');
  expect(migration).toContain('enable row level security');
  expect(migration).toContain('revoke all on public.bot_memo_values from authenticated');
  expect(database).toContain('await memoVariableStore.migrate(oldPidCandidates, newPid)');
  expect(database).toContain("deleteRowsByColumnValues(pg, summary, 'public.bot_memo_values'");
});

test.each(['youtube', 'cime'])('%s real command handler saves only verified manager input, after action rendering', async (provider) => {
  const { store, render } = memoryStore();
  let role = 3;
  let paid = false;
  const actionInputs = [];
  const sent = [];
  const functionName = provider === 'youtube' ? 'processYoutubeChatAutomation' : 'processCimeChatAutomation';
  const bindings = {
    getBotSettings: async () => ({ botEnabled: true, attendanceCommandOnly: false }),
    refreshYoutubeLiveStatus: async () => ({ live: false }), refreshCimeLiveStatus: async () => false,
    isLikelyYoutubeSelfEcho: () => false, isLikelyCimeBotSelfEcho: async () => false,
    participationWheelRuntime: { chat: async () => ({ handled: false }) }, marbleRuntime: { chat: async () => ({ handled: false }) }, handlePredictionBetCommand: async () => null,
    getRuntimeBotRulesWithDefaults: async () => [{ id: 'memo-rule', keywords: ['!공지'], enabled: true, pointsCost: paid ? 100 : 0, responses: ['공지: ${memo}'] }],
    ...load('server/command-keyword.js', { '../shared/text-safety.js': safety, './rule-pattern.js': load('server/rule-pattern.js') }),
    ...load('server/counter-variables.js'), ...memo,
    admitChatCommand: async () => true, claimBotRuleCooldown: async () => ({ claimed: true }),
    deductChannelPointsIfEnough: async () => ({ deducted: false, balanceBefore: 0 }),
    executeCommandLiveChangeTokens: async (_sid, text) => ({ text, executed: [] }),
    substituteAllPlaceholders: async (text) => text,
    resolveCommandCounterVariables: async (_plan, text) => text,
    ...load('shared/songbook-commands.js'),
    executeSongbookCommand: jest.fn(async text => text),
    resolveCommandMemoVariables: render,
    makeYoutubeChatPost: () => ({}), makeCimeChatPost: () => ({}),
    executeAndStripActionVariableTokens: async (_sid, text) => { actionInputs.push(text); return { used: false, text }; },
    makeCommandReplyKey: (ev) => ev.id,
    sendYoutubeChat: async (_owner, _chat, text) => { sent.push(text); },
    sendCimeChat: async (_owner, text) => { sent.push(text); },
    recordCommandExecutionLog: async () => {},
    getCimeLiveActorRoleLevel: jest.fn(async () => role),
  };
  const handler = loadFunctions([functionName], bindings)[functionName];
  const entry = { ownerUserId: 'owner', primarySid: 'user:owner', channelId: 'channel', connected: false, sentReplies: new Set() };
  await handler(entry, { id: '1', userId: 'manager', user: 'Manager', role: { moderator: true }, message: '!공지 원문  ${blueprint::no}  ' });
  expect(store.write).toHaveBeenCalledWith('user:owner', ['rule:memo-rule'], '원문  ${blueprint::no}  ');
  expect(sent.at(-1)).toBe('공지: 원문  ${blueprint::no}  ');
  expect(actionInputs.every((text) => !text.includes('${blueprint::no}'))).toBe(true);
  role = 1;
  await handler(entry, { id: '2', userId: 'viewer', user: 'Viewer', role: {}, message: '!공지 덮어쓰기 금지' });
  expect(store.write).toHaveBeenCalledTimes(1);
  expect(sent.at(-1)).toBe('공지: 원문  ${blueprint::no}  ');
  if (provider === 'cime') expect(bindings.getCimeLiveActorRoleLevel).toHaveBeenCalled();
  role = 3;
  paid = true;
  await handler(entry, { id: '3', userId: 'manager', user: 'Manager', role: { moderator: true }, message: '!공지 비용 실패' });
  expect(store.write).toHaveBeenCalledTimes(1);
  expect(sent.at(-1)).toContain('포인트가 부족합니다.');
});
