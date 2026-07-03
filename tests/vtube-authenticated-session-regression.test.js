const fs = require('fs');
const path = require('path');

const root = process.cwd();

function getFunctionBody(source, name) {
  const start = source.indexOf(`async function ${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const nextFunction = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, nextFunction > start ? nextFunction : undefined);
}

describe('VTube Studio authenticated session handling', () => {
  test('protected discovery requests authenticate on the same websocket session', () => {
    const main = fs.readFileSync(path.join(root, 'local-program', 'main.cjs'), 'utf8');
    const discoverBody = getFunctionBody(main, 'discoverVtubeStudio');

    expect(main).toContain('async function sendAuthenticatedVtubeRequest');
    expect(main).toContain("sendVtubeSocketRequest(ws, 'AuthenticationRequest'");
    expect(discoverBody).toContain("sendVtubeSocketRequest(ws, 'AuthenticationRequest'");
    expect(discoverBody).toContain("sendVtubeSocketRequest(ws, 'CurrentModelRequest'");
    expect(discoverBody).toContain("sendVtubeSocketRequest(ws, 'AvailableModelsRequest'");
    expect(discoverBody).toContain("sendVtubeSocketRequest(ws, 'HotkeysInCurrentModelRequest'");
    expect(discoverBody).not.toContain("sendVtubeRequest('CurrentModelRequest'");
    expect(discoverBody).not.toContain("sendVtubeRequest('AvailableModelsRequest'");
    expect(discoverBody).not.toContain("sendVtubeRequest('HotkeysInCurrentModelRequest'");
  });

  test('protected action requests also use authenticated websocket sessions', () => {
    const main = fs.readFileSync(path.join(root, 'local-program', 'main.cjs'), 'utf8');
    const hotkeyBody = getFunctionBody(main, 'triggerVtubeHotkey');
    const parameterBody = getFunctionBody(main, 'injectVtubeParameter');

    expect(hotkeyBody).toContain("sendAuthenticatedVtubeRequest('HotkeyTriggerRequest'");
    expect(parameterBody).toContain("sendAuthenticatedVtubeRequest('InjectParameterDataRequest'");
    expect(hotkeyBody).not.toContain("sendVtubeRequest('HotkeyTriggerRequest'");
    expect(parameterBody).not.toContain("sendVtubeRequest('InjectParameterDataRequest'");
  });
});
