const fs = require('fs');
const path = require('path');

describe('영상 후원 재생 안정성 회귀 방지', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const pvdViewer = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'PvdViewer.tsx'), 'utf8');

  test('오버레이 종료 보고는 현재 항목 ID를 포함하고 같은 항목 중복 보고를 막아야 함', () => {
    expect(pvdViewer).toContain('currentItemIdRef');
    expect(pvdViewer).toContain('lastReportRef');
    expect(pvdViewer).toContain('body: JSON.stringify({ token, cause, itemId })');
    expect(pvdViewer).toContain('now - lastReport.at < 5000');
  });

  test('서버는 기대한 항목이 현재 head일 때만 영상 후원 pop을 수행해야 함', () => {
    expect(serverIndex).toContain('async function popCurrentVideoDonationItem');
    expect(serverIndex).toContain('expectedItemId');
    expect(serverIndex).toContain('String(head.id || \'\') !== expectedItemId');
    expect(serverIndex).toContain('mismatch: true');
    expect(serverIndex.match(/popCurrentVideoDonationItem\(sid/g)?.length || 0).toBeGreaterThanOrEqual(4);
  });

  test('자동 동기화는 작은 유튜브 시간차로 강제 seek하지 않아야 함', () => {
    expect(pvdViewer).toContain('PVD_FORWARD_SYNC_THRESHOLD_SEC');
    expect(pvdViewer).toContain('PVD_BACKWARD_SYNC_THRESHOLD_SEC');
    expect(pvdViewer).toContain('PVD_FORCE_SYNC_THRESHOLD_SEC');
    expect(pvdViewer).toContain('startedAt');
    expect(pvdViewer).toContain('referenceNow - startedAt');
    expect(pvdViewer).toContain('strict === true');
  });
});
