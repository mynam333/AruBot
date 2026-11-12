const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const load = require('./helpers/load-source.cjs');
const shared = load('shared/command-permissions.js');
const { canExecuteCommand, getCommandPermission } = shared;
const { createCommandPermissionChecker, isCimeChatSubscriber, validateCommandPermission } = load('server/command-permissions.js', { '../shared/command-permissions.js': shared });
const server = require('./helpers/load-server-functions.cjs');

describe('command execution permissions', () => {
  const actors = [
    { roleLevel: 1 },
    { roleLevel: 1, isSubscriber: true },
    { roleLevel: 2, isManager: true },
    { roleLevel: 3, isManager: true },
    { roleLevel: 4, isOwner: true },
  ];
  test.each([
    ['everyone', [true, true, true, true, true]],
    ['subscriber', [false, true, true, true, true]],
    ['manager', [false, false, true, true, true]],
    ['streamer', [false, false, false, false, true]],
  ])('%s honors the role hierarchy before legacy levels', (executionPermission, expected) => {
    expect(actors.map(actor => canExecuteCommand({ executionPermission, adminOnly: true, requiredRoleLevel: 4 }, actor))).toEqual(expected);
  });
  test('YouTube members are not managers despite legacy level 2', () => {
    expect(canExecuteCommand({ executionPermission: 'manager' }, { roleLevel: 2, isSubscriber: true })).toBe(false);
  });
  test('old rules remain public by default and keep their existing thresholds', () => {
    expect(getCommandPermission({})).toBe('everyone');
    for (let level = 1; level <= 4; level++) {
      for (const actor of actors) expect(canExecuteCommand({ requiredRoleLevel: level }, actor)).toBe(actor.roleLevel >= level);
    }
    expect(canExecuteCommand({ adminOnly: true }, { roleLevel: 2 })).toBe(false);
    expect(canExecuteCommand({ executionPermission: null }, {})).toBe(true);
  });
  test.each(['owner', '', {}, 2, false])('invalid permission %j fails closed', executionPermission => {
    expect(() => validateCommandPermission({ executionPermission })).toThrow();
    expect(canExecuteCommand({ executionPermission }, { isOwner: true })).toBe(false);
  });
  test('CIME only trusts documented subscription badge IDs', () => {
    expect(isCimeChatSubscriber({ raw: { profile: { badges: [{ id: 'subscribe_tier1' }] } } })).toBe(true);
    expect(isCimeChatSubscriber({ raw: { profile: { badges: [{ id: 'subscribe_tier2' }] } } })).toBe(true);
    expect(isCimeChatSubscriber({ raw: { profile: { badges: [{ id: 'other', name: '구독자' }] } } })).toBe(false);
    expect(isCimeChatSubscriber({ raw: { profile: { badges: [] } }, text: 'subscribe_tier1' })).toBe(false);
  });
  test('CHZZK subscriber lookups coalesce, isolate channels, expire, and deny on failure', async () => {
    let now = 0;
    const loadSubscribers = jest.fn(async sid => sid === 'one' ? ['member'] : []);
    const check = createCommandPermissionChecker({ loadSubscribers, now: () => now });
    const rule = { executionPermission: 'subscriber' };
    const actor = { provider: 'chzzk', sid: 'one', userId: 'member' };
    expect(await Promise.all([check(rule, actor), check(rule, actor)])).toEqual([true, true]);
    expect(loadSubscribers).toHaveBeenCalledTimes(1);
    expect(await check(rule, { ...actor, userId: 'chzzk:member' })).toBe(true);
    expect(await check(rule, { ...actor, sid: 'two' })).toBe(false);
    now = 60001;
    loadSubscribers.mockRejectedValue(new Error('scope missing'));
    expect(await check(rule, actor)).toBe(false);
    expect(await check(rule, actor)).toBe(false);
    expect(loadSubscribers).toHaveBeenCalledTimes(3);
    now += 5001;
    loadSubscribers.mockResolvedValue(['member']);
    expect(await check(rule, actor)).toBe(true);
  });
  test('ordinary commands and elevated roles never incur subscription requests', async () => {
    const loadSubscribers = jest.fn();
    const check = createCommandPermissionChecker({ loadSubscribers });
    expect(await check({}, { provider: 'chzzk', sid: 'a', userId: 'a' })).toBe(true);
    expect(await check({ executionPermission: 'subscriber' }, { isManager: true })).toBe(true);
    expect(await check({ executionPermission: 'subscriber' }, { provider: 'youtube', isSubscriber: true })).toBe(true);
    expect(await check({ executionPermission: 'streamer' }, { provider: 'chzzk', sid: 'a', userId: 'a' })).toBe(false);
    expect(loadSubscribers).not.toHaveBeenCalled();
  });
  test('invalid API values are rejected before reads or writes', async () => {
    const getBotRules = jest.fn(), upsertBotRule = jest.fn();
    const handler = server.route('/api/bot/rules/upsert', { getBotRulesOwnerSid: async () => 'owner', getBotRules, upsertBotRule }, 'post');
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await handler({ body: { rule: { id: 'a', executionPermission: 'invalid' } } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(getBotRules).not.toHaveBeenCalled();
    expect(upsertBotRule).not.toHaveBeenCalled();
  });
  test.each(['youtube', 'cime'])('%s real handler admits only the selected audience', async provider => {
    let permission = 'streamer';
    let managerLevel = 1;
    const admitChatCommand = jest.fn(async () => false);
    const claimBotRuleCooldown = jest.fn(), deductChannelPointsIfEnough = jest.fn();
    const functionName = provider === 'youtube' ? 'processYoutubeChatAutomation' : 'processCimeChatAutomation';
    const handler = server([functionName], {
      getBotSettings: async () => ({ botEnabled: true, attendanceCommandOnly: false }),
      refreshYoutubeLiveStatus: async () => ({ live: false }), refreshCimeLiveStatus: async () => false,
      isLikelyYoutubeSelfEcho: () => false, isLikelyCimeBotSelfEcho: async () => false,
      participationWheelRuntime: { chat: async () => ({ handled: false }) }, marbleRuntime: { chat: async () => ({ handled: false }) }, handlePredictionBetCommand: async () => null,
      getRuntimeBotRulesWithDefaults: async () => [{ id: 'paid', keywords: ['!paid'], enabled: true, pointsCost: 100, executionPermission: permission }],
      ...load('server/command-keyword.js', { '../shared/text-safety.js': load('shared/text-safety.js'), './rule-pattern.js': load('server/rule-pattern.js') }),
      getCimeLiveActorRoleLevel: async () => managerLevel,
      admitChatCommand, claimBotRuleCooldown, deductChannelPointsIfEnough,
    })[functionName];
    const entry = { ownerUserId: 'owner', primarySid: 'user:owner', channelId: 'channel', connected: false };
    const event = { message: '!paid', userId: 'viewer', user: 'Viewer', role: {} };
    await handler(entry, event);
    expect(admitChatCommand).not.toHaveBeenCalled();
    permission = 'subscriber';
    await handler(entry, event);
    expect(admitChatCommand).not.toHaveBeenCalled();
    await handler(entry, { ...event, role: { sponsor: true }, raw: { profile: { badges: [{ id: 'subscribe_tier1' }] } } });
    expect(admitChatCommand).toHaveBeenCalledTimes(1);
    permission = 'manager';
    managerLevel = 2;
    await handler(entry, { ...event, role: { moderator: true } });
    expect(admitChatCommand).toHaveBeenCalledTimes(2);
    permission = 'streamer';
    await handler(entry, { ...event, userId: 'channel', role: { owner: true } });
    expect(admitChatCommand).toHaveBeenCalledTimes(3);
    expect(claimBotRuleCooldown).not.toHaveBeenCalled();
    expect(deductChannelPointsIfEnough).not.toHaveBeenCalled();
  });
  test('each platform gates commands before admission, cooldown and point spending', () => {
    const source = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
    for (const provider of ['chzzk', 'youtube', 'cime']) {
      const start = source.indexOf(`if (!await canRunChatCommand(r, { provider: '${provider}'`);
      expect(start).toBeGreaterThan(0);
      const block = source.slice(start, start + 1800);
      expect(block.indexOf('continue;')).toBeLessThan(block.indexOf('admitChatCommand'));
      expect(block.indexOf('admitChatCommand')).toBeLessThan(block.indexOf('const cooldown'));
    }
  });
});

describe('command permission persistence', () => {
  function storage({ hasColumn = true, postgres = true } = {}) {
    const filename = path.join(__dirname, '../server/supabase.js');
    const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const names = ['normalizeBotRuleStringArray', 'normalizeBotRuleRow', 'getBotRules', 'upsertBotRule'];
    const declarations = names.map(name => source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(source).replace(/^export /, ''));
    const query = jest.fn(async () => ({ rows: [{ id: 'rule', execution_permission: 'manager' }] }));
    const upsert = jest.fn(async () => ({ error: null }));
    const bindings = {
      ensure: () => {}, validateCommandPermission, validateCommandRuleRegex: () => {},
      tableHasColumn: async (_, column) => column !== 'execution_permission' || hasColumn,
      getDbUrl: () => postgres ? 'postgres' : '', withPgClient: fn => fn({ query }),
      quoteIdent: value => `"${value}"`, normalizePgJsonColumnValue: (_, column, value) => ['keywords', 'responses'].includes(column) ? JSON.stringify(value) : value,
      isPgJsonColumn: (_, column) => ['keywords', 'responses'].includes(column), safeJsonParse: JSON.parse,
      supabase: { from: () => ({ upsert }) },
    };
    return { ...new Function(...Object.keys(bindings), `${declarations.join('\n')}\nreturn {getBotRules,upsertBotRule};`)(...Object.values(bindings)), query, upsert };
  }
  test.each([true, false])('stores explicit permissions and preserves them in older clients (postgres=%s)', async postgres => {
    const db = storage({ postgres });
    await db.upsertBotRule('sid', { id: 'rule', executionPermission: 'subscriber', keywords: ['!a'], responses: ['ok'], enabled: true });
    if (postgres) {
      expect(db.query.mock.calls[0][0]).toContain('"execution_permission" = excluded."execution_permission"');
      expect(db.query.mock.calls[0][1]).toContain('subscriber');
      expect(db.query.mock.calls[0][1]).toContain(4);
    } else expect(db.upsert.mock.calls[0][0]).toMatchObject({ execution_permission: 'subscriber', required_role_level: 4, admin_only: false });
    await db.upsertBotRule('sid', { id: 'rule', keywords: ['!b'], enabled: true });
    if (postgres) expect(db.query.mock.calls[1][0]).not.toContain('execution_permission');
    else expect(db.upsert.mock.calls[1][0]).not.toHaveProperty('execution_permission');
  });
  test('reads explicit policy and refuses to drop it before migration', async () => {
    expect((await storage().getBotRules('sid'))[0].executionPermission).toBe('manager');
    const db = storage({ hasColumn: false });
    await expect(db.upsertBotRule('sid', { id: 'a', executionPermission: 'streamer' })).rejects.toMatchObject({ status: 503 });
    expect(db.query).not.toHaveBeenCalled();
    expect((await db.getBotRules('sid'))[0].executionPermission).toBeNull();
  });
});
