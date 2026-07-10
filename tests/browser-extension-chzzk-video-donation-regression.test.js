const fs = require('fs');
const path = require('path');

describe('browser extension CHZZK video donation regression', () => {
  const background = fs.readFileSync(path.join(__dirname, '..', 'browser-extension', 'background.js'), 'utf8');
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'browser-extension', 'manifest.json'), 'utf8');

  test('CHZZK video donation alert id keeps the video@ prefix for session-url API', () => {
    expect(background).toContain('function extractChzzkVideoDonationAlertId');
    expect(background).toContain("const prefixed = matchFirst(text, /(video@[A-Za-z0-9_-]+)/)");
    expect(background).toContain("return pathValue.startsWith('video@') ? pathValue : `video@${pathValue}`");
    expect(background).toContain('function encodeChzzkAlertPathId');
    expect(background).toContain(".replace(/^video%40/i, 'video@')");
    expect(background).toContain('https://api.chzzk.naver.com/manage/v1/alerts/${encodeChzzkAlertPathId(alertId)}/session-url');
  });

  test('CHZZK sessionUrl is converted to Socket.IO websocket with EIO 3', () => {
    expect(background).toContain('function buildChzzkDonationSocketUrl');
    expect(background).toContain("parsed.searchParams.set('EIO', '3')");
    expect(background).toContain("parsed.searchParams.set('transport', 'websocket')");
    expect(background).toContain('return `wss://${parsed.host}/socket.io/?${parsed.searchParams.toString()}`');
    expect(background).not.toContain("parsed.searchParams.set('EIO', '4')");
    expect(background).not.toContain('&EIO=4&transport=websocket');
  });

  test('Socket.IO donation packets parse both raw arrays and 42 event frames', () => {
    expect(background).toContain('function extractSocketIoEventPayload');
    expect(background).toContain("if (text.startsWith('42'))");
    expect(background).toContain("if (text.startsWith('[')) return text");
    expect(background).toContain("const [eventName, raw] = payload");
    expect(background).toContain("if (eventName !== 'donation' || !body || !isLikelyVideoDonation(body)) return");
    expect(background).toContain('const duration = normalizeDurationFromPayload(body)');
    expect(background).toContain('if (duration) enqueuePause(service, duration, body)');
  });

  test('manifest allows CHZZK session metadata and nchat websocket hosts', () => {
    expect(manifest).toContain('https://api.chzzk.naver.com/*');
    expect(manifest).toContain('https://*.nchat.naver.com/*');
    expect(manifest).toContain('wss://*.nchat.naver.com/*');
  });
});
