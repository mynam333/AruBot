const fs = require('fs');
const path = require('path');

const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');

describe('action variable command regression', () => {
  test('command responses execute action variables before chat delivery', () => {
    expect(serverIndex).toContain('async function executeAndStripActionVariableTokens');
    expect(serverIndex).toContain("source: 'chat-command'");
    expect(serverIndex).toContain("source: 'youtube-live-chat-command'");
    expect(serverIndex).toContain("source: 'cime-chat-command'");
    expect(serverIndex).toContain("source: 'roulette-command'");
  });

  test('action variable tokens are stripped from command response text', () => {
    expect(serverIndex).toContain('function stripActionVariableTokens');
    expect(serverIndex).toContain('replace(/\\$\\{\\s*(?:action|automation|blueprint)::([^}]+)\\s*\\}/ig,');
  });

  test('action variables resolve a published blueprint by id, slug, or display name', () => {
    expect(serverIndex).toContain('let blueprint = await getActionBlueprint(owner, keyPart);');
    expect(serverIndex).toContain('const blueprints = await listActionBlueprints(owner).catch(() => []);');
    expect(serverIndex).toContain("String(candidate?.name || '').trim().toLocaleLowerCase('ko-KR') === normalizedReference");
  });
});
