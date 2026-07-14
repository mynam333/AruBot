const fs = require('fs');
const path = require('path');

const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
const pvdViewer = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'PvdViewer.tsx'), 'utf8');

describe('CHZZK clip video donation regression', () => {
  test('server resolves CHZZK clips to mp4 instead of creating an embed fallback', () => {
    expect(serverIndex).toContain('function findFirstChzzkClipMp4Url');
    expect(serverIndex).toContain('visit(cardPayload)');
    expect(serverIndex).toContain("error.code = 'clip_playback_unavailable'");
    expect(serverIndex).not.toContain('embedUrl: `https://chzzk.naver.com/embed/clip/${chzzkClipId}`');
  });

  test('viewer does not synthesize CHZZK clip iframe URLs', () => {
    expect(pvdViewer).toContain("if (provider === 'chzzk_clip') return ''");
    expect(pvdViewer).toContain("blockedReason: provider === 'chzzk_clip' && !isDirectVideoUrl(viewerSrc)");
    expect(pvdViewer).not.toContain('https://chzzk.naver.com/embed/clip/${encodeURIComponent(String(item.mediaId))}');
  });

  test('server uses CHZZK clip titles instead of ID fallback labels', () => {
    const chzzkBranchStart = serverIndex.indexOf("if (parsed.provider === 'chzzk_clip')");
    const cimeBranchStart = serverIndex.indexOf("} else if (parsed.provider === 'cime_clip')", chzzkBranchStart);
    const chzzkBranch = serverIndex.slice(chzzkBranchStart, cimeBranchStart);

    expect(serverIndex).toContain('function extractChzzkClipTitle');
    expect(serverIndex).toContain('payload?.clipTitle');
    expect(serverIndex).toContain("payload?.body?.card?.content?.title");
    expect(serverIndex).toContain('isChzzkClipFallbackTitle(item.title, item.mediaId)');
    expect(serverIndex).toContain("'User-Agent': 'Mozilla/5.0");
    expect(chzzkBranch).toContain("title = clip?.title || '제목을 불러오지 못한 치지직 클립'");
    expect(chzzkBranch).not.toContain('`${getPvdProviderLabel(parsed.provider)} ${parsed.mediaId}`');
  });

  test('auto-pop timer cannot shift a newer queue head', () => {
    expect(serverIndex).toContain('function getPvdQueueItemKey');
    expect(serverIndex).toContain('const scheduledItemKey = getPvdQueueItemKey(item)');
    expect(serverIndex).toContain('if (getPvdQueueItemKey(head) !== scheduledItemKey)');
    expect(serverIndex).toContain('await broadcastPvdStart(sid)');
  });

  test('enqueue starts or idle-defers playback based on pre-push queue emptiness', () => {
    const dispatchStart = serverIndex.indexOf('async function dispatchDurableRuntimeJob');
    const workerStart = serverIndex.indexOf('async function runDurableRuntimeWorker', dispatchStart);
    const dispatchBody = serverIndex.slice(dispatchStart, workerStart);
    expect(dispatchBody).toContain('const shouldStartPlayback = queue.length === 0');
    expect(dispatchBody).toContain('queue.push(runtimeItem)');
    expect(dispatchBody).toContain('if (shouldStartPlayback) await broadcastPvdStart(job.sid, { deferForIdle: true })');

    const replayStart = serverIndex.indexOf('async function replayVideoDonationLog');
    const replayEnd = serverIndex.indexOf('async function replayDrawingDonationLog', replayStart);
    const replayBody = serverIndex.slice(replayStart, replayEnd);
    expect(replayBody).toContain('const shouldStartPlayback = q.length === 0');
    expect(replayBody).toMatch(/if \(shouldStartPlayback\) \{\s+await broadcastPvdStart\(sid, \{ deferForIdle: true \}\);/);
  });
});
