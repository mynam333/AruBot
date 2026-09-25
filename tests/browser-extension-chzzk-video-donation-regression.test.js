const fs = require('fs');
const path = require('path');

describe('browser extension CHZZK video donation regression', () => {
  const background = fs.readFileSync(path.join(__dirname, '..', 'browser-extension', 'background.js'), 'utf8');
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'browser-extension', 'manifest.json'), 'utf8');
  const buildScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-browser-extension.js'), 'utf8');

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
    expect(background).toContain('return enqueueChzzkDonation(service, body)');
  });

  test('missing packet duration is resolved from current CHZZK and media metadata endpoints', () => {
    expect(background).toContain('function resolveChzzkDonationDuration');
    expect(background).toContain("new URL('https://www.youtube.com/watch')");
    expect(background).toContain('https://api.chzzk.naver.com/service/v1/clips/${encodeURIComponent(id)}/detail');
    expect(background).toContain("new URL('https://api.chzzk.naver.com/service/v2/donation/videos')");
    expect(background).toContain("new URL('https://creatorhub-api.naver.com/api/v5.0/clipviewer/card')");
    expect(background).toContain("card?.body?.card?.content?.contentId");
    expect(background).toContain('durationForPlaybackRange(payload, mediaDurationSec)');
    expect(background).toContain('chzzkDonationSequence');
  });

  test('manifest and packages include all CHZZK metadata hosts and parser script', () => {
    expect(manifest).toContain('https://api.chzzk.naver.com/*');
    expect(manifest).toContain('https://creatorhub-api.naver.com/*');
    expect(manifest).toContain('https://*.nchat.naver.com/*');
    expect(manifest).toContain('wss://*.nchat.naver.com/*');
    expect(buildScript).toContain("'chzzk-video-metadata.js'");
    expect(buildScript).toContain("scripts: ['chzzk-video-metadata.js', 'background.js']");
  });
});
