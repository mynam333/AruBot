const fs = require('fs');
const path = require('path');

describe('browser extension Toonation video donation regression', () => {
  const background = fs.readFileSync(path.join(__dirname, '..', 'browser-extension', 'background.js'), 'utf8');
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'browser-extension', 'manifest.json'), 'utf8');
  const readme = fs.readFileSync(path.join(__dirname, '..', 'browser-extension', 'README.md'), 'utf8');

  test('Toonation alertbox HTML parser supports escaped payload markup', () => {
    expect(background).toContain('function extractToonationPayload');
    expect(background).toContain('/\\\\u0022payload\\\\u0022:\\\\u0022(.*?[^\\\\])\\\\u0022/');
    expect(background).toContain('const payload = extractToonationPayload(html)');
  });

  test('Toonation connector uses ws.toon.at payload websocket URL', () => {
    expect(background).toContain('function buildToonationSocketUrl');
    expect(background).toContain('return `wss://ws.toon.at/${payload}`');
    expect(background).toContain('url: buildToonationSocketUrl(payload)');
    expect(background).not.toContain('wss://toon.at:8071/${payload}');
    expect(readme).toContain('wss://ws.toon.at/{payload}');
  });

  test('Toonation video donation payload shape is recognized and queued', () => {
    expect(background).toContain('text.includes(\'video_info\')');
    expect(background).toContain('text.includes(\'video://\')');
    expect(background).toContain("'video_length'");
    expect(background).toContain('event?.content?.video_info?.title');
    expect(background).toContain("if (duration) enqueuePause('toonation', duration, payload?.content || payload)");
  });

  test('websocket connector has heartbeat support and Toonation sends heartbeat pings', () => {
    expect(background).toContain('heartbeatIntervalMs = 0');
    expect(background).toContain('function handleCommonHeartbeatMessage');
    expect(background).toContain("if (text === 'PING')");
    expect(background).toContain("heartbeatIntervalMs: 30 * 1000");
    expect(background).toContain("heartbeatMessage: 'PING'");
  });

  test('manifest allows Toonation alertbox and ws.toon.at websocket hosts', () => {
    expect(manifest).toContain('https://toon.at/*');
    expect(manifest).toContain('wss://ws.toon.at/*');
    expect(manifest).toContain('wss://*.toon.at/*');
  });
});
