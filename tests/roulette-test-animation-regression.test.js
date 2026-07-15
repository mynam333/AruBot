const fs = require('fs');
const path = require('path');

describe('룰렛 실제 회전 테스트 회귀 방지', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const rouletteViewer = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'RouletteViewer.tsx'), 'utf8');
  const roulettePage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'roulette-page.tsx'), 'utf8');
  const popupControllerStart = roulettePage.indexOf('function RouletteTestPopupController');
  const popupControllerEnd = roulettePage.indexOf('export function RoulettePage', popupControllerStart);
  const popupController = roulettePage.slice(popupControllerStart, popupControllerEnd);

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
    expect(roulettePage).toContain("viewerUrl.searchParams.set('testConnectionId', testConnectionId)");
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
  });

  test('테스트 회전은 홈페이지 iframe이 아니라 실제 오버레이 팝업에서 실행되어야 함', () => {
    expect(roulettePage).toContain("'about:blank'");
    expect(roulettePage).toContain('const popupWindow = openRouletteTestPopup(definition, testConnectionId)');
    expect(roulettePage).toContain('if (!popupWindow)');
    expect(roulettePage).toContain('popupWindow.location.replace(viewerUrl.toString())');
    expect(roulettePage).not.toContain('<iframe');
    expect(roulettePage).not.toContain('iframeRef');
    expect(roulettePage).not.toContain('embeddedTest');
    expect(rouletteViewer).toContain('if (window.opener && !window.opener.closed)');
    expect(rouletteViewer).toContain('window.opener.postMessage(message, window.location.origin)');
  });

  test('관리 페이지는 검증된 팝업의 실제 정지 신호 전까지 테스트 결과를 공개하지 않아야 함', () => {
    expect(popupController).toContain("message.type === 'arubot:roulette-ready'");
    expect(popupController).toContain("message.type !== 'arubot:roulette-settled'");
    expect(popupController).toContain('event.origin !== window.location.origin');
    expect(popupController).toContain('event.source !== popupWindow');
    expect(popupController).toContain('message.token !== viewerRef.current?.token');
    expect(popupController).toContain('message.testConnectionId !== testConnectionId');
    expect(popupController).toContain('message.spinId !== expected.spinId');
    expect(popupController).toContain('Number(message.itemCount) !== itemCount');
    expect(popupController).toContain('callbacksRef.current.onSettled(definition, stoppedLabel)');
    expect(popupController).toContain('pendingSettledRef.current.set(spinId, message)');
    expect(popupController).toContain('settleFromMessage(pending)');
    expect(popupController).toContain('const requestController = new AbortController()');
  });

  test('팝업 수명주기와 준비 순서는 차단·조기 종료·고아 창을 안전하게 처리해야 함', () => {
    expect(roulettePage.indexOf('openRouletteTestPopup(definition, testConnectionId)'))
      .toBeLessThan(roulettePage.indexOf('setActiveTest({ key, definition, testConnectionId, popupWindow })'));
    expect(popupController.indexOf("window.addEventListener('message', onMessage)"))
      .toBeLessThan(popupController.indexOf('/api/roulette/viewer-url?testConnectionId='));
    expect(popupController).toContain('popupWindow.closed');
    expect(popupController).toContain('룰렛 테스트 오버레이 창이 회전 완료 전에 닫혔습니다.');
    expect(popupController).toContain('viewerController.abort()');
    expect(popupController).toContain("window.removeEventListener('message', onMessage)");
    expect(popupController).toContain('window.clearInterval(closePoll)');
    expect(popupController).toContain('popupWindow.close()');
    expect(popupController).toContain('ROULETTE_TEST_POPUP_CLOSE_DELAY_MS');
  });

  test('자동재생이 막혀도 처리되지 않은 오디오 Promise 오류를 남기면 안 됨', () => {
    expect(rouletteViewer).toContain("startAudioRef.current.play().catch(() => playBeep(880, 120, 'square', 0.015))");
    expect(rouletteViewer).toContain('endAudioRef.current.play().catch(() => {');
  });
});
