const fs = require('fs');
const path = require('path');

describe('영상 후원 자동 길이 조회 회귀 방지', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const viewer = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'PvdViewer.tsx'), 'utf8');
  const probeRunner = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'youtubeDurationProbe.ts'), 'utf8');

  test('서버 조회 실패 시 오버레이 응답을 기다린 뒤 포인트 계산을 진행해야 함', () => {
    expect(serverIndex).toContain('createPvdDurationProbeCoordinator');
    expect(serverIndex).toContain('durationProbeSid');
    expect(serverIndex).toContain('fetchViewerDuration: () => requestPvdViewerDurationProbe(durationProbeSid, parsed.provider, parsed.mediaId)');
    expect(serverIndex).toContain("message?.type === 'duration_probe_result'");
    expect(serverIndex).toContain('durationProbes: pvdDurationProbeCoordinator.listPending(sid)');
    expect(serverIndex).toContain('pvdDurationProbeCoordinator.dispatchPendingToSocket(sid, ws)');
    expect(serverIndex).toContain('durationProbeSid: sid');
    expect(viewer).toContain('if (isUnknownRecord(probe)) handleDurationProbe(probe)');

    const probeAwait = serverIndex.indexOf('fetchViewerDuration: () => requestPvdViewerDurationProbe(durationProbeSid, parsed.provider, parsed.mediaId)');
    const pointCost = serverIndex.indexOf('const cost = Math.ceil(pps * dur)', probeAwait);
    expect(probeAwait).toBeGreaterThan(-1);
    expect(pointCost).toBeGreaterThan(probeAwait);
  });

  test('오버레이는 현재 재생기와 분리된 숨은 플레이어로 길이만 조회해야 함', () => {
    expect(viewer).toContain("data?.type === 'duration_probe'");
    expect(viewer).toContain('createYouTubeDurationProbeRunner(getYouTubeApi)');
    expect(probeRunner).toContain("host.style.cssText = 'position:fixed;left:-10000px");
    expect(probeRunner).toContain("width: '200'");
    expect(probeRunner).toContain("height: '200'");
    expect(probeRunner).not.toContain("width: '2'");
    expect(probeRunner).toContain('autoplay: 0');
    expect(probeRunner).toContain('player?.getDuration?.()');
    expect(probeRunner).not.toContain('playerRef');
  });

  test('조회 작업은 제한 시간 내 정리되고 성공 또는 진단 결과를 서버로 보내야 함', () => {
    expect(probeRunner).toContain('const deadline = Date.now() + timeoutMs');
    expect(probeRunner).toContain("failBeforePlayer('iframe_api_timeout')");
    expect(probeRunner).toContain("errorCode: 'player_duration_timeout'");
    expect(probeRunner).toContain('player?.cueVideoById?.(mediaId)');
    expect(probeRunner).toContain("type: 'duration_probe_result'");
    expect(probeRunner).toContain('jobs.delete(probeId)');
  });
});
