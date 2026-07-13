const path = require('path');
const { execFileSync } = require('child_process');

describe('live command action variables', () => {
  let result;

  beforeAll(() => {
    const moduleUrl = new URL('../server/live-command-actions.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const script = `
      const actions = await import(${JSON.stringify(moduleUrl)});
      const titleCalls = [];
      const gameCalls = [];
      const executed = await actions.executeAndStripLiveChangeTokens(
        '변경합니다 \${live.title_change} / \${ live.title_change } \${live.game_change} 완료',
        {
          provider: 'chzzk',
          argsText: '새 방송 제목',
          changeTitle: async (value) => titleCalls.push(value),
          changeGame: async (value) => gameCalls.push(value),
        }
      );
      let noArgsCalls = 0;
      const noArgs = await actions.executeAndStripLiveChangeTokens('\${live.title_change}', {
        provider: 'cime',
        argsText: '   ',
        changeTitle: async () => { noArgsCalls += 1; },
      });
      let youtubeCalls = 0;
      const youtube = await actions.executeAndStripLiveChangeTokens('안내 \${live.title_change}', {
        provider: 'youtube',
        argsText: '유튜브 제목',
        changeTitle: async () => { youtubeCalls += 1; },
      });
      const failed = await actions.executeAndStripLiveChangeTokens('시도 \${live.game_change} 계속', {
        provider: 'cime',
        argsText: '게임',
        changeGame: async () => { throw new Error('api failed'); },
      });
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
