const fs = require('fs');
const path = require('path');

describe('룰렛 뷰어 토큰 회귀 방지', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const supabase = fs.readFileSync(path.join(__dirname, '..', 'server', 'supabase.js'), 'utf8');
  const legacyViewers = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'viewer', 'legacy-viewers.tsx'), 'utf8');
  const rouletteViewer = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'RouletteViewer.tsx'), 'utf8');
  const roulettePage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'roulette-page.tsx'), 'utf8');
  const navigation = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'config', 'navigation.ts'), 'utf8');

  test('룰렛 실행은 매 스핀마다 새 토큰을 만들지 않고 고정 뷰어 토큰을 사용해야 함', () => {
    const start = serverIndex.indexOf('async function startRouletteSpin');
    const end = serverIndex.indexOf('async function executeRouletteResultCommand', start);
    const body = serverIndex.slice(start, end);

    expect(body).toContain('getOrCreateViewerTokenSupabase');
    expect(body).toContain('Using stable viewer token');
    expect(body).not.toContain('generateChannelRouletteToken(');
  });

  test('고정 토큰과 최근 룰렛 세션 토큰 모두 sid 복구 경로를 가져야 함', () => {
    const start = supabase.indexOf('export async function findSidByRouletteToken');
    const end = supabase.indexOf('// Stats', start);
    const body = supabase.slice(start, end);

    expect(body).toContain("findSidByChannelViewerTokenSupabase(token, 'roulette')");
    expect(body).toContain("from('bot_settings')");
    expect(body).toContain("from('roulette_sessions')");
  });

  test('룰렛 오버레이 라우트 토큰은 컴포넌트에 명시적으로 전달되어야 함', () => {
    expect(legacyViewers).toContain('<RouletteViewer viewerToken={token} />');
    expect(rouletteViewer).toContain('viewerToken?: string');
    expect(rouletteViewer).toContain('const propToken = String(viewerToken ||');
  });

  test('룰렛 WebSocket은 아직 결과 row가 없어도 고정 토큰 연결을 허용해야 함', () => {
    const start = serverIndex.indexOf('async function validateWebSocketTokenConnection');
    const end = serverIndex.indexOf('function registerPvdRoutes', start);
    const body = serverIndex.slice(start, end);

    expect(body).toContain('const rouletteSession = await getRouletteSessionByToken(token)');
    expect(body).toContain('if (rouletteSession && rouletteSession.sid !== sid)');
    expect(body).not.toContain("const error = new Error('Roulette session not found')");
  });

  test('룰렛 OBS 주소는 별도 페이지가 아니라 룰렛 관리 화면에 노출되어야 함', () => {
    const viewerPagePath = path.join(__dirname, '..', 'src', 'app', '(admin)', 'roulette', 'viewer', 'page.tsx');
    const tokenPanelIndex = roulettePage.indexOf('endpoint="/api/roulette/viewer-url"');
    const listTitleIndex = roulettePage.lastIndexOf('방송 이벤트로 실행할 룰렛');

    expect(fs.existsSync(viewerPagePath)).toBe(false);
    expect(tokenPanelIndex).toBeGreaterThan(-1);
    expect(listTitleIndex).toBeGreaterThan(-1);
    expect(tokenPanelIndex).toBeLessThan(listTitleIndex);
    expect(roulettePage).not.toContain('href="/roulette/viewer"');
    expect(navigation).not.toContain("href: '/roulette/viewer'");
  });

  test('룰렛 WebSocket effect는 debug 상태 변경으로 재연결 루프를 만들면 안 됨', () => {
    expect(rouletteViewer).toContain('const reconnectAttemptsRef = React.useRef(0)');
    expect(rouletteViewer).toContain('connectionAttempts: prev.connectionAttempts + 1');
    expect(rouletteViewer).toContain('messageCount: prev.messageCount + 1');
    expect(rouletteViewer).toContain('reconnectAttemptsRef.current += 1');
    expect(rouletteViewer).not.toContain('debugInfo.connectionAttempts');
    expect(rouletteViewer).not.toContain('debugInfo.messageCount');
    expect(rouletteViewer).not.toContain('debugInfo.reconnectAttempts');
  });
});
