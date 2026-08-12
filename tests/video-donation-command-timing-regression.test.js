const fs = require('fs');
const path = require('path');

describe('video donation command timing integration regression', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const youtubeMetadata = fs.readFileSync(path.join(__dirname, '..', 'server', 'youtube-video-metadata.js'), 'utf8');
  const viewer = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'PvdViewer.tsx'), 'utf8');

  test('all three chat platforms and the blueprint command node use the shared video donation command path', () => {
    expect(serverIndex.match(/await enqueueVideoDonationFromArgs\(\{/g)).toHaveLength(4);
    expect(serverIndex).toContain("source: 'chat-command'");
    expect(serverIndex).toContain("source: 'youtube-live-chat-command'");
    expect(serverIndex).toContain("source: 'cime-chat-command'");
    expect(serverIndex).toContain("source: 'blueprint-command'");
  });

  test('successful receipts end with the active queue total including the accepted request', () => {
    const helperStart = serverIndex.indexOf('async function enqueueVideoDonationFromArgs');
    const helperEnd = serverIndex.indexOf('async function processCimeChatAutomation', helperStart);
    const helper = serverIndex.slice(helperStart, helperEnd);

    expect(helper).toContain('getVideoDonationReceiptQueueSize(sid, acceptedItem, durable.job?.status)');
    expect(helper.indexOf('getVideoDonationReceiptQueueSize')).toBeLessThan(helper.indexOf('runDurableRuntimeWorker'));
    expect(helper).toContain('appendVideoDonationQueueCount(receipt, queueSize)');
  });

  test('command argument three is parsed as endSec and preserved in queue metadata', () => {
    const helperStart = serverIndex.indexOf('async function enqueueVideoDonationFromArgs');
    const helperEnd = serverIndex.indexOf('async function processCimeChatAutomation', helperStart);
    const helper = serverIndex.slice(helperStart, helperEnd);

    expect(helper).toContain('const endArgRaw = looksLikeUrl ? commandArgs[2] : undefined');
    expect(helper).toContain('endSec: endArgRaw');
    expect(helper).toContain('requestedEndSec');
    expect(helper).toContain("return '영상 후원 길이를 확인할 수 없습니다. 시작초와 종료초를 입력해 주세요.'");
    expect(helper).not.toContain('playArgRaw');
  });

  test('REST accepts endSec while retaining legacy playSec compatibility', () => {
    const routeStart = serverIndex.indexOf("app.post('/api/video-donation/request'");
    const routeEnd = serverIndex.indexOf('// GET queue list', routeStart);
    const route = serverIndex.slice(routeStart, routeEnd);

    expect(route).toContain('startSec, endSec, playSec');
    expect(route).toContain('endSec,');
    expect(route).toContain('legacyPlaySec: playSec');
    expect(route).toContain('requestedEndSec');
    expect(route).toContain("message: '영상 후원 길이를 확인할 수 없습니다. 시작초와 종료초를 입력해 주세요.'");
  });

  test('duration resync respects explicit end, media end, and max duration for short ranges', () => {
    const updateStart = serverIndex.indexOf('function updateCurrentPvdDurationFromPlayer');
    const updateEnd = serverIndex.indexOf('async function refreshChzzkClipPlaybackForItem', updateStart);
    const update = serverIndex.slice(updateStart, updateEnd);

    expect(update).toContain('resolveVideoDonationTiming({');
    expect(update).toContain('endSec: item.requestedEndSec');
    expect(update).toContain('maxDurationSec: item.maxDurationSec || 600');
    expect(update).not.toContain('currentDuration > 2');
  });

  test('YouTube metadata and viewer duration sync cover omitted end values', () => {
    expect(serverIndex).toContain("new Set(['youtube', 'tiktok', 'chzzk_clip', 'cime_clip'])");
    expect(serverIndex).toContain('return id ? fetchYouTubeVideoMetadata(id)');
    expect(youtubeMetadata).toContain('extractYouTubeWatchDurationSec(html)');
    expect(youtubeMetadata).not.toContain('googleapis.com/youtube/v3');
    expect(viewer).toContain('getDuration?: () => number');
    expect(viewer).toContain('const reportYouTubeDuration = useCallback');
    expect(viewer).toContain("emitControl('duration', undefined, undefined, durationSec)");
  });

  test('variable help documents the exact start/end contract', () => {
    expect(serverIndex).toContain('사용법: <주소> [<시작초>] [<종료초>]');
    expect(serverIndex).toContain('분:초(예: 1:23 = 83초)');
    expect(serverIndex).toContain('시작초 기본값은 0초');
    expect(serverIndex).toContain('종료초를 생략하면 영상 마지막까지 재생합니다.');
  });
});
