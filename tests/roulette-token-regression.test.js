const fs = require('fs');
const path = require('path');

describe('룰렛 뷰어 토큰 회귀 방지', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const supabase = fs.readFileSync(path.join(__dirname, '..', 'server', 'supabase.js'), 'utf8');

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
});
