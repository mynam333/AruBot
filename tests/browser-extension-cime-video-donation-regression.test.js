const fs = require('fs');
const path = require('path');

describe('browser extension CIME video donation regression', () => {
  const background = fs.readFileSync(path.join(__dirname, '..', 'browser-extension', 'background.js'), 'utf8');
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'browser-extension', 'manifest.json'), 'utf8');

  test('CIME connector can derive alertKey directly from the video donation overlay URL', () => {
    expect(background).toContain('function extractCimeVideoDonationAlertKey');
    expect(background).toContain('/\\/overlay\\/video-donation\\/video\\/[^/?#]+\\/([^/?#]+)/');
    expect(background).toContain('const alertKeyFromUrl = extractCimeVideoDonationAlertKey(overlayUrl)');
    expect(background).toContain('const alertKey = alertKeyFromUrl || matchFirst(html, /"alertKey":"([^"]+)"/)');
  });

  test('CIME connector builds the documented DONATION_VIDEO websocket URL', () => {
    expect(background).toContain('function buildCimeDonationSocketUrl');
    expect(background).toContain('return `wss://${host}/?type=ALERT_KEY&alertKey=${encodeURIComponent(alertKey)}&alertType=DONATION_VIDEO`');
    expect(background).toContain("'apigw.prod.ci.me'");
    expect(background).toContain("replace(/^wss?:\\/\\//i, '')");
  });

  test('CIME DONATION_VIDEO payload shape is recognized and duration is calculated from vStart/vEnd', () => {
    expect(background).toContain("if (payload.action === 'PONG') return");
    expect(background).toContain("if (payload.action !== 'DONATION_VIDEO' && !isLikelyVideoDonation(payload)) return");
    expect(background).toContain("pickNumber(object, ['vStart', 'startSecond', 'startSec', 'video_begin', 'begin', 'start'])");
    expect(background).toContain("pickNumber(object, ['vEnd', 'endSecond', 'endSec', 'video_end', 'end'])");
    expect(background).toContain('event?.id || event?.donationId || event?.nfId');
    expect(background).toContain('title: event?.title || event?.vTitle || event?.videoTitle || event?.video_info?.title || event?.content?.video_info?.title || event?.videoDescription || null');
  });

  test('manifest allows CIME overlay and websocket hosts', () => {
    expect(manifest).toContain('https://ci.me/*');
    expect(manifest).toContain('https://*.ci.me/*');
    expect(manifest).toContain('wss://*.ci.me/*');
  });
});
