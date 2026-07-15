const fs = require('fs');
const path = require('path');

describe('룰렛 실제 회전 테스트 회귀 방지', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const rouletteViewer = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'RouletteViewer.tsx'), 'utf8');
  const roulettePage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'roulette-page.tsx'), 'utf8');

  test('관리자와 로컬 리모컨 테스트는 즉시 결과가 아닌 실제 회전 이벤트를 전송해야 함', () => {
    const adminStart = serverIndex.indexOf("app.post('/api/roulette/test'");
    const adminEnd = serverIndex.indexOf('// Public: list roulette definitions', adminStart);
    const adminRoute = serverIndex.slice(adminStart, adminEnd);
    const localStart = serverIndex.indexOf("app.post('/api/local-remote/roulette/test'");
    const localEnd = serverIndex.indexOf("app.post('/api/local-remote/video-donation/pop'", localStart);
    const localRoute = serverIndex.slice(localStart, localEnd);

    for (const route of [adminRoute, localRoute]) {
      expect(route).toContain('instant: false');
      expect(route).toContain('executeResultActions: false');
      expect(route).toContain('testMode: true');
      expect(route).not.toContain('instant: true');
    }
    expect(adminRoute).toContain('targetConnectionId: testConnectionId');
    expect(adminRoute).toContain("req.body?.testConnectionId");
  });

  test('관리자 테스트 연결은 실제 OBS 연결·과거 결과·운영 이력과 격리되어야 함', () => {
    expect(serverIndex).toContain('const rouletteTestConnections = new Map()');
    expect(serverIndex).toContain('const rouletteTestAuthorizations = new Map()');
    expect(serverIndex).toContain('MAX_ROULETTE_TEST_CONNECTIONS_PER_TOKEN = 4');
    expect(serverIndex).toContain("deliveredConnection.ws.close(1000, 'Test event delivered')");
    expect(serverIndex).toContain('broadcastToRouletteTestConnection(targetConnectionId');
    expect(serverIndex).toContain("if (!testConnectionId) {");
    expect(serverIndex).toContain("type: 'roulette:test-ready'");
    expect(serverIndex).toContain('if (opts?.testMode !== true) {');
    expect(serverIndex).toContain("opts?.testMode !== true && opts?.executeResultActions !== false");
    expect(roulettePage).toContain("url.searchParams.set('testConnectionId', testConnectionId)");
    expect(rouletteViewer).toContain("url.searchParams.set('testConnectionId', testConnectionId)");
    expect(rouletteViewer).toContain("data?.type === 'roulette:test-ready'");
  });

  test('서버와 오버레이는 동일한 회전 시간과 추적 ID를 사용해야 함', () => {
    expect(serverIndex).toContain('const ROULETTE_SPIN_MS = 5200');
    expect(serverIndex).toContain('const spinId = String(opts?.spinId || crypto.randomUUID())');
    expect(serverIndex).toContain('spinDurationMs,');
    expect(serverIndex).toContain('spinStartedAt,');
    expect(rouletteViewer).toContain('const DEFAULT_ROULETTE_SPIN_DURATION_MS = 5200');
    expect(rouletteViewer).toContain('normalizeRouletteSpinDuration(meta?.spinDurationMs)');
  });

  test('오버레이는 전체 항목으로 실제 회전한 뒤 포인터 위치의 항목을 완료 값으로 알려야 함', () => {
    expect(rouletteViewer).toContain('const nextWheelItems = buildWheelItemsForResult(pool, finalLabel, wheelTargetIndex)');
    expect(rouletteViewer).toContain('const wheelResolvedIndex = wheelIndexAtPointer(wheelFinalRotation, nextWheelItems.length)');
    expect(rouletteViewer).toContain('const wheelResolvedLabel = nextWheelItems[wheelResolvedIndex] || finalLabel');
    expect(rouletteViewer).toContain("type: 'arubot:roulette-ready'");
    expect(rouletteViewer).toContain("type: 'arubot:roulette-settled'");
    expect(rouletteViewer).toContain('label: wheelResolvedLabel');
    expect(rouletteViewer).toContain('itemCount: nextWheelItems.length');
    expect(rouletteViewer).toContain('barrier.wheelDone = true');
    expect(rouletteViewer).toContain('barrier.reelDone = true');
    expect(rouletteViewer).toContain('tryFinishSpinBarrier(barrier)');
    expect(rouletteViewer).toContain("wheel.addEventListener('transitionend', onTransitionEnd)");
    expect(rouletteViewer).toContain('startSpinAnimation(final, Array.isArray(payload.items) ? payload.items : null, payload)');
    expect(rouletteViewer).toContain("q.get('embeddedTest') === '1'");
    expect(rouletteViewer).toContain('if (embeddedTestMode)');
  });

  test('관리 페이지는 실제 오버레이 정지 신호 전까지 테스트 결과를 공개하지 않아야 함', () => {
    expect(roulettePage).toContain('<iframe');
    expect(roulettePage).toContain("message.type === 'arubot:roulette-ready'");
    expect(roulettePage).toContain("message.type !== 'arubot:roulette-settled'");
    expect(roulettePage).toContain('event.source !== iframeRef.current?.contentWindow');
    expect(roulettePage).toContain('message.spinId !== expected.spinId');
    expect(roulettePage).toContain('Number(message.itemCount) !== itemCount');
    expect(roulettePage).toContain('포인터가 멈출 때까지 결과를 공개하지 않습니다.');
    expect(roulettePage).toContain('setResultLabel(stoppedLabel)');
    expect(roulettePage).toContain('onSettled(definition, stoppedLabel)');
    expect(roulettePage).toContain('pendingSettledRef.current.set(spinId, message)');
    expect(roulettePage).toContain('settleFromMessage(pending)');
    expect(roulettePage).toContain('const requestController = new AbortController()');
  });

  test('자동재생이 막혀도 처리되지 않은 오디오 Promise 오류를 남기면 안 됨', () => {
    expect(rouletteViewer).toContain("startAudioRef.current.play().catch(() => playBeep(880, 120, 'square', 0.015))");
    expect(rouletteViewer).toContain('endAudioRef.current.play().catch(() => {');
  });
});
