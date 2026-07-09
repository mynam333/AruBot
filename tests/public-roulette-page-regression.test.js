const fs = require('fs');
const path = require('path');

describe('public roulette page regression', () => {
  const publicRealtime = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'public', 'public-realtime-data-view.tsx'), 'utf8');
  const publicChannelPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'public', 'public-channel-page.tsx'), 'utf8');
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const supabase = fs.readFileSync(path.join(__dirname, '..', 'server', 'supabase.js'), 'utf8');

  test('roulette definitions are rendered by a dedicated public dashboard with probabilities', () => {
    expect(publicRealtime).toContain('function PublicRouletteDashboard');
    expect(publicRealtime).toContain("kind === 'roulette'");
    expect(publicRealtime).toContain('rouletteDefsFromData(data)');
    expect(publicRealtime).toContain('현재 열린 룰렛과 확률');
    expect(publicRealtime).toContain('formatPercent(item.probabilityPercent)');
    expect(publicRealtime).toContain("['items', 'rules', 'rows', 'data', 'points', 'logs', 'definitions', 'defs']");
    expect(publicChannelPage).toContain("['items', 'rules', 'rows', 'data', 'points', 'logs', 'definitions', 'defs']");
  });

  test('viewer roulette history is fetched as mine-only data with search and roulette filters', () => {
    expect(publicRealtime).toContain("mine: '1'");
    expect(publicRealtime).toContain("params.set('q', query)");
    expect(publicRealtime).toContain("params.set('roulette', rouletteFilter)");
    expect(publicRealtime).toContain('placeholder="결과, 룰렛명, 닉네임 검색"');
    expect(publicRealtime).toContain('<option value="">전체 룰렛</option>');
    expect(publicRealtime).toContain('내 룰렛 당첨 내역');
    expect(publicRealtime).toContain('viewerKnown');
  });

  test('roulette log API supports current viewer, roulette name, and query filtering', () => {
    expect(serverIndex).toContain('async function resolveCurrentViewerRouletteUserIds');
    expect(serverIndex).toContain('await getCurrentSessionUserId(req)');
    expect(serverIndex).toContain('await listPlatformAccounts(ownerUserId)');
    expect(serverIndex).toContain("const rouletteName = req.query?.roulette ? String(req.query.roulette) : ''");
    expect(serverIndex).toContain("['1', 'true', 'yes'].includes(String(req.query?.mine || '').toLowerCase())");
    expect(serverIndex).toContain('viewerKnown: mine ? viewerUserIds.length > 0 : null');
    expect(serverIndex).toContain('listRouletteSessionsByToken(token, { q, rouletteName, userIds: viewerUserIds, limit, offset })');
  });

  test('roulette session query applies token, roulette, and user identity filters', () => {
    expect(supabase).toContain("select('*').eq('token', token)");
    expect(supabase).toContain("query = query.eq('roulette_name', normalizedRouletteName)");
    expect(supabase).toContain("query = query.eq('user_id', identityFilters[0])");
    expect(supabase).toContain("query = query.in('user_id', identityFilters.slice(0, 50))");
    expect(supabase).toContain('username.ilike');
    expect(supabase).toContain('result_label.ilike');
  });

  test('public roulette definitions include both legacy and normalized list keys', () => {
    expect(serverIndex).toContain('defs: result, definitions: result, total: result.length');
  });
});
