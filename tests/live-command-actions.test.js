const path = require('path');
const { execFileSync } = require('child_process');

describe('live command action variables', () => {
  let result;

  beforeAll(() => {
    const moduleUrl = new URL('../server/live-command-actions.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const permissionModuleUrl = new URL('../server/live-command-permissions.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const script = `
      const actions = await import(${JSON.stringify(moduleUrl)});
      const permissions = await import(${JSON.stringify(permissionModuleUrl)});
      const titleCalls = [];
      const gameCalls = [];
      const executed = await actions.executeAndStripLiveChangeTokens(
        '변경합니다 \${live.title_change} / \${ live.title_change } \${live.game_change} 완료',
        {
          provider: 'chzzk',
          argsText: '새 방송 제목',
          canManageLive: true,
          changeTitle: async (value) => titleCalls.push(value),
          changeGame: async (value) => gameCalls.push(value),
        }
      );
      let noArgsCalls = 0;
      const noArgs = await actions.executeAndStripLiveChangeTokens('\${live.title_change}', {
        provider: 'cime',
        argsText: '   ',
        canManageLive: true,
        changeTitle: async () => { noArgsCalls += 1; },
      });
      let youtubeCalls = 0;
      const youtube = await actions.executeAndStripLiveChangeTokens('안내 \${live.title_change}', {
        provider: 'youtube',
        argsText: '유튜브 제목',
        canManageLive: true,
        changeTitle: async () => { youtubeCalls += 1; },
      });
      const failed = await actions.executeAndStripLiveChangeTokens('시도 \${live.game_change} 계속', {
        provider: 'cime',
        argsText: '게임',
        canManageLive: true,
        changeGame: async () => { throw new Error('api failed'); },
      });
      let unauthorizedCalls = 0;
      const unauthorized = await actions.executeAndStripLiveChangeTokens(
        '권한 없음 \${live.title_change} / \${live.game_change} 안내 유지',
        {
          provider: 'cime',
          argsText: '변경하면 안 되는 값',
          canManageLive: false,
          changeTitle: async () => { unauthorizedCalls += 1; },
          changeGame: async () => { unauthorizedCalls += 1; },
        }
      );
      let missingPermissionCalls = 0;
      const missingPermission = await actions.executeAndStripLiveChangeTokens('\${live.title_change}', {
        provider: 'chzzk',
        argsText: '변경하면 안 되는 제목',
        changeTitle: async () => { missingPermissionCalls += 1; },
      });
      let asyncPermissionCalls = 0;
      const asyncPermission = await actions.executeAndStripLiveChangeTokens('\${live.game_change}', {
        provider: 'cime',
        argsText: '종합 게임',
        canManageLive: async () => true,
        changeGame: async () => { asyncPermissionCalls += 1; },
      });
      let managerLoads = 0;
      let clock = 10_000;
      const managerResolver = permissions.createLiveManagerRoleResolver({
        ttlMs: 1_000,
        now: () => clock,
        loadRoles: async () => {
          managerLoads += 1;
          return [
            { managerChannelId: 'channel-manager', userRole: 'STREAMING_CHANNEL_MANAGER' },
            { managerChannelId: 'chat-manager', userRole: 'STREAMING_CHAT_MANAGER' },
          ];
        },
      });
      const channelManagerLevel = await managerResolver.getRoleLevel('owner', 'channel-manager');
      const chatManagerLevel = await managerResolver.getRoleLevel('owner', 'chat-manager');
      const viewerLevel = await managerResolver.getRoleLevel('owner', 'viewer');
      const forcedChatManagerLevel = await managerResolver.getRoleLevel('owner', 'chat-manager', { force: true });
      clock += 1_001;
      await managerResolver.getRoleLevel('owner', 'viewer');
      let retryLoads = 0;
      const retryResolver = permissions.createLiveManagerRoleResolver({
        loadRoles: async () => {
          retryLoads += 1;
          if (retryLoads === 1) throw new Error('temporary failure');
          return [{ managerChannelId: 'manager', userRole: 'STREAMING_CHAT_MANAGER' }];
        },
      });
      let firstRetryFailed = false;
      try { await retryResolver.getRoleLevel('owner', 'manager'); } catch { firstRetryFailed = true; }
      const retryManagerLevel = await retryResolver.getRoleLevel('owner', 'manager');
      let partitionLoads = 0;
      const partitionResolver = permissions.createLiveManagerRoleResolver({
        getCacheKey: (context) => context.owner + ':' + context.channel,
        loadRoles: async (context) => {
          partitionLoads += 1;
          return [{ managerChannelId: context.channel + '-manager', userRole: 'STREAMING_CHANNEL_MANAGER' }];
        },
      });
      const firstChannelLevel = await partitionResolver.getRoleLevel({ owner: 'owner', channel: 'a' }, 'a-manager');
      const secondChannelLevel = await partitionResolver.getRoleLevel({ owner: 'owner', channel: 'b' }, 'b-manager');
      let revocableRoles = [{ managerChannelId: 'revoked-manager', userRole: 'STREAMING_CHAT_MANAGER' }];
      const revocationResolver = permissions.createLiveManagerRoleResolver({
        loadRoles: async () => revocableRoles,
      });
      const beforeRevocationLevel = await revocationResolver.getRoleLevel('owner', 'revoked-manager');
      revocableRoles = [];
      const afterRevocationLevel = await revocationResolver.getRoleLevel('owner', 'revoked-manager', { force: true });
      const categories = [
        { categoryId: 'first', categoryValue: '종합 게임' },
        { categoryId: 'exact', categoryValue: ' 리그   오브 레전드 ' },
      ];
      console.log(JSON.stringify({
        executed: { ...executed, errors: executed.errors.length },
        titleCalls,
        gameCalls,
        noArgs: { ...noArgs, errors: noArgs.errors.length },
        noArgsCalls,
        youtube: { ...youtube, errors: youtube.errors.length },
        youtubeCalls,
        failed: { ...failed, errors: failed.errors.length },
        unauthorized: { ...unauthorized, errors: unauthorized.errors.length },
        unauthorizedCalls,
        missingPermission: { ...missingPermission, errors: missingPermission.errors.length },
        missingPermissionCalls,
        asyncPermission: { ...asyncPermission, errors: asyncPermission.errors.length },
        asyncPermissionCalls,
        roles: {
          streamer: permissions.getLiveRoleLevel('streamer'),
          channelManager: permissions.getLiveRoleLevel('STREAMING_CHANNEL_MANAGER'),
          chatManager: permissions.getLiveRoleLevel('streaming_chat_manager'),
          ownerFallback: permissions.getLiveRoleLevel(null, { isOwner: true }),
          viewer: permissions.getLiveRoleLevel('common_user'),
          unknownNumeric: permissions.getLiveRoleLevel(999),
          channelManagerLevel,
          chatManagerLevel,
          viewerLevel,
          forcedChatManagerLevel,
          managerLoads,
          firstRetryFailed,
          retryLoads,
          retryManagerLevel,
          partitionLoads,
          firstChannelLevel,
          secondChannelLevel,
          beforeRevocationLevel,
          afterRevocationLevel,
        },
        exactCategory: actions.selectCategorySearchResult(categories, '리그 오브 레전드'),
        fallbackCategory: actions.selectCategorySearchResult(categories, '없는 게임'),
        emptyCategory: actions.selectCategorySearchResult([], '게임'),
        youtubeLiveInfo: actions.filterLiveInfoByProvider({ provider: 'youtube', title: '유튜브 제목' }, 'youtube'),
        rejectedCimeLiveInfo: actions.filterLiveInfoByProvider({ provider: 'cime', title: '씨미 제목' }, 'youtube'),
      }));
    `;
    result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    }).trim());
  });

  test('strips duplicate tokens, preserves surrounding response, and executes each action once', () => {
    expect(result.executed.text).toBe('변경합니다  /   완료');
    expect(result.titleCalls).toEqual(['새 방송 제목']);
    expect(result.gameCalls).toEqual(['새 방송 제목']);
    expect(result.executed.executed).toEqual(['title_change', 'game_change']);
  });

  test('treats a token without command arguments as absent and sends no empty response', () => {
    expect(result.noArgs.text).toBe('');
    expect(result.noArgs.executed).toEqual([]);
    expect(result.noArgsCalls).toBe(0);
  });

  test('never executes unsupported YouTube live changes but still hides the token', () => {
    expect(result.youtube.text).toBe('안내');
    expect(result.youtube.executed).toEqual([]);
    expect(result.youtubeCalls).toBe(0);
  });

  test('keeps the remaining response when a platform API call fails', () => {
    expect(result.failed.text).toBe('시도  계속');
    expect(result.failed.executed).toEqual([]);
    expect(result.failed.errors).toBe(1);
  });

  test('strips privileged tokens but never executes them for viewers or missing permission context', () => {
    expect(result.unauthorized.text).toBe('권한 없음  /  안내 유지');
    expect(result.unauthorized.requested).toEqual(['title_change', 'game_change']);
    expect(result.unauthorized.executed).toEqual([]);
    expect(result.unauthorized.permissionChecked).toBe(true);
    expect(result.unauthorized.authorized).toBe(false);
    expect(result.unauthorizedCalls).toBe(0);
    expect(result.missingPermission.text).toBe('');
    expect(result.missingPermission.executed).toEqual([]);
    expect(result.missingPermission.authorized).toBe(false);
    expect(result.missingPermissionCalls).toBe(0);
  });

  test('accepts an async server-side permission check', () => {
    expect(result.asyncPermission.authorized).toBe(true);
    expect(result.asyncPermission.executed).toEqual(['game_change']);
    expect(result.asyncPermissionCalls).toBe(1);
  });

  test('normalizes streamer and both manager roles and caches CIME role lists', () => {
    expect(result.roles).toEqual({
      streamer: 4,
      channelManager: 3,
      chatManager: 2,
      ownerFallback: 4,
      viewer: 1,
      unknownNumeric: 1,
      channelManagerLevel: 3,
      chatManagerLevel: 2,
      viewerLevel: 1,
      forcedChatManagerLevel: 2,
      managerLoads: 3,
      firstRetryFailed: true,
      retryLoads: 2,
      retryManagerLevel: 2,
      partitionLoads: 2,
      firstChannelLevel: 3,
      secondChannelLevel: 3,
      beforeRevocationLevel: 2,
      afterRevocationLevel: 1,
    });
  });

  test('prefers an exact normalized category name and otherwise uses the first result', () => {
    expect(result.exactCategory.categoryId).toBe('exact');
    expect(result.fallbackCategory.categoryId).toBe('first');
    expect(result.emptyCategory).toBeNull();
  });

  test('rejects cross-platform live information before placeholder substitution', () => {
    expect(result.youtubeLiveInfo.title).toBe('유튜브 제목');
    expect(result.rejectedCimeLiveInfo).toBeNull();
  });
});
