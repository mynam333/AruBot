const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

describe('저장값 그대로 사용하는 명령어 느낌표 접두사 회귀 방지', () => {
  const root = path.join(__dirname, '..');
  const serverIndex = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
  const commandsPage = fs.readFileSync(path.join(root, 'src', 'features', 'admin', 'commands-page.tsx'), 'utf8');
  const actionDialogs = fs.readFileSync(path.join(root, 'src', 'features', 'admin', 'admin-action-dialogs.tsx'), 'utf8');
  const localRenderer = fs.readFileSync(path.join(root, 'local-program', 'renderer', 'renderer.js'), 'utf8');

  function runMatcherCases() {
    const moduleUrl = new URL('../server/command-keyword.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const script = `
      const { findCommandKeywordMatch, getCommandRuleMatches } = await import(${JSON.stringify(moduleUrl)});
      const summarize = (match) => match ? {
        configuredKeyword: match.configuredKeyword,
        matchedText: match.matchedText,
        argsText: match.argsText,
        exactConfigured: match.exactConfigured,
      } : null;
      const rules = [
        { id: 'short', keywords: ['foo'] },
        { id: 'long', keywords: ['foo bar'] },
      ];
      const collisionRules = [
        { id: 'bang', keywords: ['!help'] },
        { id: 'bare', keywords: ['help'] },
      ];
      console.log(JSON.stringify({
        bare: summarize(findCommandKeywordMatch('출석', ['출석'])),
        bareArgs: summarize(findCommandKeywordMatch('출석 홍길동', ['출석'])),
        bareTabArgs: summarize(findCommandKeywordMatch('출석\\t홍길동', ['출석'])),
        legacyAsBare: summarize(findCommandKeywordMatch('출석 홍길동', ['!출석'])),
        newAsBang: summarize(findCommandKeywordMatch('!출석 홍길동', ['출석'])),
        legacyBang: summarize(findCommandKeywordMatch('!출석 홍길동', ['!출석'])),
        englishCase: summarize(findCommandKeywordMatch('HELP Me', ['help'])),
        sentence: summarize(findCommandKeywordMatch('출석했어요', ['출석'])),
        compound: summarize(findCommandKeywordMatch('출석부', ['출석'])),
        leadingText: summarize(findCommandKeywordMatch('재출석', ['출석'])),
        empty: summarize(findCommandKeywordMatch('', ['출석'])),
        bangOnly: summarize(findCommandKeywordMatch('! anything', ['!'])),
        videoArgs: summarize(findCommandKeywordMatch('영상 https://example.com/watch 10 30', ['영상'])),
        rouletteArgs: summarize(findCommandKeywordMatch('!룰렛 2', ['!룰렛'])),
        longestRule: getCommandRuleMatches('foo bar baz', rules).map(({ rule }) => rule.id),
        bareExactRule: getCommandRuleMatches('help me', collisionRules).map(({ rule }) => rule.id),
        bangExactRule: getCommandRuleMatches('!help me', collisionRules).map(({ rule }) => rule.id),
      }));
    `;
    return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: root,
      encoding: 'utf8',
    }).trim());
  }

  test('저장된 접두사 표기를 정확히 지키면서 단어 경계와 인자를 보존한다', () => {
    const result = runMatcherCases();
    expect(result.bare.matchedText).toBe('출석');
    expect(result.bareArgs.argsText).toBe('홍길동');
    expect(result.bareTabArgs.argsText).toBe('홍길동');
    expect(result.legacyAsBare).toBeNull();
    expect(result.newAsBang).toBeNull();
    expect(result.legacyBang.argsText).toBe('홍길동');
    expect(result.englishCase.argsText).toBe('Me');
    expect(result.sentence).toBeNull();
    expect(result.compound).toBeNull();
    expect(result.leadingText).toBeNull();
    expect(result.empty).toBeNull();
    expect(result.bangOnly).toBeNull();
    expect(result.videoArgs.argsText).toBe('https://example.com/watch 10 30');
    expect(result.rouletteArgs.argsText).toBe('2');
  });

  test('겹치는 규칙은 입력 표기와 정확히 일치하고 더 긴 명령어를 우선한다', () => {
    const result = runMatcherCases();
    expect(result.longestRule[0]).toBe('long');
    expect(result.bareExactRule[0]).toBe('bare');
    expect(result.bangExactRule[0]).toBe('bang');
  });

  test('CHZZK·YouTube·CIME·룰렛 결과 명령이 동일한 공통 매처를 사용한다', () => {
    expect(serverIndex.match(/getCommandRuleMatches\(text, rules\)/g)?.length || 0).toBe(4);
    expect(serverIndex).not.toContain('lower.startsWith(String(kw).toLowerCase())');
    expect(serverIndex).toContain("findCommandKeywordMatch(text, [normalizeAttendanceCommandKeyword(settings)])");
  });

  test('웹과 로컬 프로그램은 입력한 명령어에 느낌표를 자동 부착하지 않는다', () => {
    for (const source of [commandsPage, actionDialogs, localRenderer]) {
      expect(source).not.toContain("startsWith('!') ?");
    }
    expect(commandsPage).toContain('return value.trim()');
    expect(actionDialogs).toContain('return value.trim()');
    expect(localRenderer).toContain('keywords: [keyword]');
  });
});
