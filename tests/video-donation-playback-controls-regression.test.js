const fs = require('fs');
const path = require('path');

describe('영상 후원 재생 제어 회귀 방지', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const queuePage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'video-donation-queue-page.tsx'), 'utf8');
  const localHtml = fs.readFileSync(path.join(__dirname, '..', 'local-program', 'renderer', 'index.html'), 'utf8');
  const localRenderer = fs.readFileSync(path.join(__dirname, '..', 'local-program', 'renderer', 'renderer.js'), 'utf8');

  test('모든 재생 제어 API는 같은 상태 전환 함수를 사용해야 함', () => {
    expect(serverIndex.match(/controlPvdPlaybackForSid\(sid, op, req\.body\?\.atSec\)/g)).toHaveLength(3);
    expect(serverIndex).toContain('async function controlPvdPlaybackForSid(sid, op, requestedAtSec)');
    expect(serverIndex).toContain("if (op === 'play' && state.idleDeferred === true)");
    expect(serverIndex).toContain('await activateDeferredPvdPlayback(sid, getPvdQueueItemKey(item))');
    expect(serverIndex).toContain('const message = await broadcastPvdControl(sid, {');
  });

  test('관리 화면과 로컬 리모컨이 현재 재생 상태를 조회할 수 있어야 함', () => {
    expect(serverIndex).toContain("return res.json(await getPvdQueueSnapshot(sid, 'http_sync'))");
    expect(serverIndex).toContain('idleDeferred: current ? state?.idleDeferred === true : false');
    expect(serverIndex).toContain('videoPlayback: {');
    expect(serverIndex).toContain('paused: videoQueue[0] ? videoPlaybackState?.paused === true : null');
  });

  test('홈페이지 영상 후원 큐에서 재생과 일시정지를 제어해야 함', () => {
    expect(queuePage).toContain("const controlPlayback = async (op: 'pause' | 'play')");
    expect(queuePage).toContain("postJson<VideoDonationQueueResponse>('/api/video-donation/control', { op })");
    expect(queuePage).toContain('aria-label="영상 후원 재생"');
    expect(queuePage).toContain('aria-label="영상 후원 일시정지"');
    expect(queuePage).toContain("'대기 음악 종료 대기'");
  });

  test('로컬 프로그램 리모컨에서 상태에 맞는 재생 버튼만 활성화해야 함', () => {
    expect(localHtml).toContain('id="remotePvdPlaybackStatus"');
    expect(localHtml).toContain('id="remotePvdPlayButton"');
    expect(localHtml).toContain('id="remotePvdPauseButton"');
    expect(localRenderer).toContain("remoteControlVideoDonation({ op: 'play' })");
    expect(localRenderer).toContain("remoteControlVideoDonation({ op: 'pause' })");
    expect(localRenderer).toContain("$('#remotePvdPlayButton').disabled = !current || !paused");
    expect(localRenderer).toContain("$('#remotePvdPauseButton').disabled = !current || paused");
  });
});
