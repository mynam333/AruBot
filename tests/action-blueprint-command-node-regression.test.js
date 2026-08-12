const fs = require('fs');
const path = require('path');

describe('action blueprint direct command node regressions', () => {
  const root = path.join(__dirname, '..');
  const blueprintPage = fs.readFileSync(path.join(root, 'src', 'features', 'admin', 'action-blueprint-page.tsx'), 'utf8');
  const serverIndex = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');

  test('offers a platform dropdown and a free-form chat command field', () => {
    expect(blueprintPage).toContain("| 'commandExecute'");
    expect(blueprintPage).toContain("type: 'commandExecute', title: '명령어 직접 실행'");
    expect(blueprintPage).toContain("{ value: 'chzzk', label: '치지직' }");
    expect(blueprintPage).toContain("{ value: 'cime', label: '씨미' }");
    expect(blueprintPage).toContain("{ value: 'youtube', label: 'YouTube' }");

    const editorStart = blueprintPage.indexOf("if (node.type === 'commandExecute')", blueprintPage.indexOf('function ConfigFields'));
    const editorEnd = blueprintPage.indexOf("if (node.type === 'tts')", editorStart);
    const editor = blueprintPage.slice(editorStart, editorEnd);
    expect(editor).toContain('label="실행 플랫폼"');
    expect(editor).toContain('options={COMMAND_PLATFORM_OPTIONS.map');
    expect(editor).toContain('label="채팅 명령어"');
    expect(editor).toContain("onChange={(value) => onChange('command', value)}");
  });

  test('validates the platform and command in both the editor and server', () => {
    for (const source of [blueprintPage, serverIndex]) {
      expect(source).toContain("node.type === 'commandExecute'");
      expect(source).toContain("need('platform', '실행 플랫폼')");
      expect(source).toContain("need('command', '채팅 명령어')");
      expect(source).toContain('지원하지 않는 실행 플랫폼입니다.');
    }
  });

  test('executes command result features internally without posting the command or residual response', () => {
    const runtimeStart = serverIndex.indexOf('async function executeBlueprintCommandNode');
    const runtimeEnd = serverIndex.indexOf('async function executeActionBlueprint', runtimeStart);
    const runtime = serverIndex.slice(runtimeStart, runtimeEnd);

    expect(runtime).toContain('getCommandRuleMatches(command, rules)');
    expect(runtime).toContain('executeCommandLiveChangeTokens');
    expect(runtime).toContain('enqueueVideoDonationFromArgs');
    expect(runtime).toContain('enqueueRouletteSpin');
    expect(runtime).toContain('executeAndStripActionVariableTokens');
    expect(runtime).toContain('resolveCommandCounterVariables');
    expect(runtime).toContain("source: 'blueprint-command'");
    expect(runtime).toContain('platform: selectedPlatform,');
    expect(runtime).toContain('message: command,');
    expect(runtime).toContain('keyword: commandMatch.matchedText,');
    expect(runtime).toContain('response,');
    expect(runtime).not.toContain('sendChatByPost(');
    expect(runtime).not.toContain('sendCimeChat(');
    expect(runtime).not.toContain('sendYoutubeChat(');
    expect(runtime).not.toContain('claimBotRuleCooldown(');
    expect(runtime).not.toContain('deductChannelPointsIfEnough(');
  });

  test('routes the node through the direct executor and exposes reusable outputs', () => {
    expect(serverIndex).toContain("} else if (node.type === 'commandExecute') {");
    expect(serverIndex).toContain('output = await executeBlueprintCommandNode({');
    expect(blueprintPage).toContain("commandExecute: ['executed}', 'platform}', 'matchedKeyword}', 'ruleName}', 'response}']");
    expect(serverIndex).toContain("error: 'recursive_action_blocked'");
  });
});
