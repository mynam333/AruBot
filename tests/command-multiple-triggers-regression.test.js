const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

describe('multiple chat command triggers', () => {
  const root = path.join(__dirname, '..');
  const createDialog = fs.readFileSync(path.join(root, 'src', 'features', 'admin', 'admin-action-dialogs.tsx'), 'utf8');
  const commandsPage = fs.readFileSync(path.join(root, 'src', 'features', 'admin', 'commands-page.tsx'), 'utf8');

  test('splits whitespace-separated triggers, removes duplicates, and preserves matching arguments', () => {
    const triggerModuleUrl = new URL('../src/features/admin/command-triggers.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const matcherModuleUrl = new URL('../server/command-keyword.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const script = `
      const { parseCommandTriggers, formatCommandTriggers } = await import(${JSON.stringify(triggerModuleUrl)});
      const { findCommandKeywordMatch } = await import(${JSON.stringify(matcherModuleUrl)});
      const keywords = parseCommandTriggers('  !투표   !예측  !VOTE !vote !  ');
      console.log(JSON.stringify({
        keywords,
        formatted: formatCommandTriggers(keywords),
        first: findCommandKeywordMatch('!투표 1', keywords),
        second: findCommandKeywordMatch('!예측 blue', keywords),
        english: findCommandKeywordMatch('!vote yes', keywords),
      }));
    `;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: root,
      encoding: 'utf8',
    }).trim());

    expect(result.keywords).toEqual(['!투표', '!예측', '!VOTE']);
    expect(result.formatted).toBe('!투표 !예측 !VOTE');
    expect(result.first.argsText).toBe('1');
    expect(result.second.argsText).toBe('blue');
    expect(result.english.argsText).toBe('yes');
  });

  test('create and edit forms save every parsed trigger', () => {
    expect(createDialog).toContain('const keywords = parseCommandTriggers(command)');
    expect(createDialog).toContain('name: name.trim() || primaryKeyword');
    expect(createDialog).toContain('keywords,');
    expect(commandsPage).toContain('command: formatCommandTriggers(rule.keywords)');
    expect(commandsPage).toContain('const keywords = parseCommandTriggers(form.command)');
    expect(commandsPage).toContain('name: form.name.trim() || primaryKeyword');
    expect(commandsPage).toContain('rule.keywords.map((keyword) =>');
  });
});
