const fs = require('fs');
const path = require('path');

function requiredSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end <= start) {
    throw new Error(`Unable to locate source slice: ${startMarker} -> ${endMarker}`);
  }
  return source.slice(start, end);
}

function extractFollowingBlock(source, statementIndex) {
  const openBrace = source.indexOf('{', statementIndex);
  if (openBrace < 0) return '';
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openBrace + 1, index);
    }
  }
  return '';
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('AruBot service admin console regression', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const serverDb = fs.readFileSync(path.join(__dirname, '..', 'server', 'supabase.js'), 'utf8');
  const adminPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'arubot-admin-page.tsx'), 'utf8');
  const streamerPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'arubot-admin-streamers.tsx'), 'utf8');
  const systemPage = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'arubot-admin-system-panel.tsx'), 'utf8');
  const adminShell = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'app-shell', 'admin-shell.tsx'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

  test('protects every browser admin API with the session admin boundary', () => {
    const overviewStart = serverIndex.indexOf("app.get('/api/arubot-admin/overview'");
    const overviewEnd = serverIndex.indexOf("app.post('/api/arubot-admin/streamers/runtime-refresh'", overviewStart);
    const runtimeEnd = serverIndex.indexOf("app.get('/api/youtube/bot/status'", overviewEnd);
    const overviewRoute = serverIndex.slice(overviewStart, overviewEnd);
    const runtimeRoute = serverIndex.slice(overviewEnd, runtimeEnd);

    expect(overviewStart).toBeGreaterThan(0);
    expect(overviewRoute).toContain('requireCurrentAdminUser(req, res)');
    expect(runtimeRoute).toContain('requireCurrentAdminUser(req, res)');
    expect(overviewRoute).toContain("res.set('Cache-Control', 'private, no-store, max-age=0')");
    expect(runtimeRoute).toContain('rateLimiters.userWrite');
    expect(overviewRoute).not.toContain('requireOpsAuth');
    expect(runtimeRoute).not.toContain('requireOpsAuth');
  });

  test('uses one parameterized PostgreSQL aggregate over authoritative feature sources', () => {
    const helperStart = serverDb.indexOf('export async function getArubotAdminConsoleSnapshot');
    const helperEnd = serverDb.indexOf('function normalizeProvider', helperStart);
    const helper = serverDb.slice(helperStart, helperEnd);

    expect(helper).toContain('with account_source as');
    expect(helper).toContain("bs.settings->'macros'");
    expect(helper).toContain("bs.settings->'rouletteDefs'");
    expect(helper).toContain('from action_blueprints ab');
    expect(helper).toContain('from bot_rules');
    expect(helper).toContain('from app_users u');
    expect(helper).toContain('end as authorization_status');
    expect(helper).toContain("'authorization', authorization_status");
    expect(helper).not.toMatch(/\bend as authorization\s*,/);
    expect(helper).not.toMatch(/'authorization'\s*,\s*authorization\s*,/);
    expect(helper).toContain('limit ${pageLimitSlot}');
    expect(helper).toContain('(p.created_at, p.user_id) <');
    expect(helper).not.toContain('macro_schedules');
    expect(helper).not.toContain('roulette_sessions');
    expect(helper).not.toContain("'accessToken'");
    expect(helper).not.toContain("'refreshToken'");
    expect(helper).not.toContain("'websubSecret'");
    expect(helper).not.toContain("'metadata'");
  });

  test('merges in-memory runtime state without calling every streamer status API', () => {
    const runtimeStart = serverIndex.indexOf('function enrichArubotAdminStreamerRuntime');
    const runtimeEnd = serverIndex.indexOf('function getArubotAdminSystemSnapshot', runtimeStart);
    const runtime = serverIndex.slice(runtimeStart, runtimeEnd);

    expect(runtime).toContain('sessionStore.get(sid)');
    expect(runtime).toContain('cimeSessionStore.get(ownerUserId)');
    expect(runtime).toContain('youtubeSessionStore.get(ownerUserId)');
    expect(runtime).toContain('getConnectedLocalProviderRuntimeNames(sid)');
    expect(runtime).toContain('remoteManagedProviders');
    expect(runtime).not.toContain('/api/platforms/status');
    expect(runtime).not.toContain('refreshYoutubeLiveStatus');
    expect(runtime).not.toContain('refreshCimeLiveStatus');
  });

  test('separates loading, access, stale data, empty data and filtered-empty states', () => {
    expect(adminPage).toContain('readJsonResult<AdminStatus>');
    expect(adminPage).toContain('readJsonResult<AdminConsoleSnapshot>');
    expect(adminPage).toContain('마지막으로 확인한 동일 조건의 데이터를 유지합니다.');
    expect(adminPage).toContain('관리자 페이지를 열 수 없습니다');
    expect(streamerPage).toContain('등록된 스트리머가 없습니다');
    expect(streamerPage).toContain('조건에 맞는 스트리머가 없습니다');
    expect(streamerPage).toContain('필터 초기화');
    expect(adminShell).toContain('readJsonResult<AdminAccess>');
    expect(adminShell).toContain('if (!result.ok) return false;');
  });

  test('offers accessible tabs, server filters, CSV export and safe runtime refresh', () => {
    for (const label of ['운영 개요', '스트리머', '기능 현황', '최근 활동', '시스템']) {
      expect(adminPage).toContain(label);
    }
    expect(adminPage).toContain('role="tablist"');
    expect(adminPage).toContain('role="tabpanel"');
    expect(adminPage).toContain("event.key === 'ArrowRight'");
    expect(adminPage).toContain('new Blob([csv]');
    expect(adminPage).toContain("apiUrl('/api/arubot-admin/streamers/runtime-refresh')");
    expect(streamerPage).toContain('현재 목록 CSV');
    expect(streamerPage).toContain('봇 설정 즉시 반영');
    expect(systemPage).toContain('window.prompt');
    expect(systemPage).toContain("confirmation !== '연결 해제'");
  });

  test('neutralizes spreadsheet formulas before quoting exported CSV cells', () => {
    const helperSource = requiredSlice(adminPage, 'function quoteCsvCell', 'function eventCategoryLabel')
      .trim()
      .replace('value: unknown', 'value');
    const quoteCsvCell = Function(`"use strict"; return (${helperSource});`)();

    for (const dangerousValue of ['=1+1', '+cmd', '-2+3', '@SUM(A1:A2)', '\t=1', '\r=1', '  =1']) {
      expect(quoteCsvCell(dangerousValue).startsWith('"\'')).toBe(true);
    }
    expect(quoteCsvCell('ordinary streamer name')).toBe('"ordinary streamer name"');
    expect(quoteCsvCell('a"b')).toBe('"a""b"');
  });

  test('clears privileged snapshot state when admin access is rejected', () => {
    const accessBlock = requiredSlice(adminPage, 'const loadAccess = useCallback', 'const loadYoutubeStatus = useCallback');
    const failureBlock = requiredSlice(accessBlock, '} else {', 'setAccessError(');
    const inlineGuard = failureBlock.match(/if\s*\(\s*(?:adminResult\.status\s*===\s*401\s*\|\|\s*adminResult\.status\s*===\s*403|adminResult\.status\s*===\s*403\s*\|\|\s*adminResult\.status\s*===\s*401|\[\s*401\s*,\s*403\s*\]\.includes\(adminResult\.status\))\s*\)/);
    const namedGuard = failureBlock.match(/const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:adminResult\.status\s*===\s*401\s*\|\|\s*adminResult\.status\s*===\s*403|adminResult\.status\s*===\s*403\s*\|\|\s*adminResult\.status\s*===\s*401|\[\s*401\s*,\s*403\s*\]\.includes\(adminResult\.status\))\s*;/);
    const guardIndex = inlineGuard?.index
      ?? (namedGuard ? failureBlock.search(new RegExp(`if\\s*\\(\\s*${escapeRegExp(namedGuard[1])}\\s*\\)`)) : -1);
    const guardedBody = guardIndex >= 0 ? extractFollowingBlock(failureBlock, guardIndex) : '';

    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(guardedBody).toContain('setAdminStatus(null)');
    expect(guardedBody).toContain('setSnapshot(null)');
    expect(guardedBody).toContain('setSnapshotQueryKey(null)');
    expect(guardedBody).toContain('snapshotQueryKeyRef.current = null');
  });

  test('requires the same JSON confirmation contract on both sides of YouTube bot deletion', () => {
    const deleteRoute = requiredSlice(serverIndex, "app.delete('/api/youtube/bot'", "app.get('/api/youtube/me'");
    const deleteAction = requiredSlice(systemPage, 'const deleteYoutubeBot', 'const runtimeTotal');
    const bodyField = deleteRoute.match(/req\.body\?\.([A-Za-z_$][\w$]*)/)?.[1];

    expect(bodyField).toBeTruthy();
    const validationIndex = deleteRoute.search(/if\s*\([^\n]*(?:confirmation|confirm)[^\n]*!==\s*'연결 해제'[^\n]*\)/);
    const destructiveIndex = deleteRoute.indexOf('getYoutubeBotProfile');
    expect(validationIndex).toBeGreaterThanOrEqual(0);
    expect(destructiveIndex).toBeGreaterThan(validationIndex);
    expect(deleteRoute.slice(validationIndex, destructiveIndex)).toMatch(/res\.status\((?:400|403)\)/);
    expect(deleteAction).toContain("'Content-Type': 'application/json'");
    expect(deleteAction).toMatch(new RegExp(`body:\\s*JSON\\.stringify\\(\\{\\s*${escapeRegExp(bodyField)}\\s*(?::\\s*(?:confirmation|'연결 해제'))?\\s*\\}\\)`));
  });

  test('does not report a runtime refresh as successful unless the runtime confirms it', () => {
    const runtimeRoute = requiredSlice(serverIndex, "app.post('/api/arubot-admin/streamers/runtime-refresh'", "app.get('/api/youtube/bot/status'");
    const runtimeAction = requiredSlice(adminPage, 'const refreshStreamerRuntime = useCallback', 'const exportCurrentCsv = useCallback');
    const refreshIndex = runtimeRoute.indexOf('refreshRuntimeConfigurationNow');
    const firstConflictIndex = runtimeRoute.indexOf('res.status(409)');
    const finalConflictIndex = runtimeRoute.lastIndexOf('res.status(409)');
    const successIndex = runtimeRoute.search(/return\s+res\.json\(\{\s*ok:\s*true/);
    const clientConfirmationIndex = runtimeAction.search(/data(?:\?\.)?ok\s*!==\s*true/);
    const successToastIndex = runtimeAction.indexOf('toast.success');

    expect(refreshIndex).toBeGreaterThanOrEqual(0);
    expect(firstConflictIndex).toBeGreaterThanOrEqual(0);
    expect(finalConflictIndex).toBeGreaterThan(refreshIndex);
    expect(finalConflictIndex).toBeLessThan(successIndex);
    expect(runtimeRoute).toContain('{ requireConnected: true }');
    expect(runtimeRoute.slice(refreshIndex, successIndex)).toContain('connectedProvidersAfter');
    expect(runtimeRoute.slice(firstConflictIndex, successIndex)).toContain('ok: false');
    expect(runtimeAction).toContain('if (!response.ok');
    expect(clientConfirmationIndex).toBeGreaterThanOrEqual(0);
    expect(successToastIndex).toBeGreaterThan(clientConfirmationIndex);
  });

  test('consumes OAuth notices without leaving sensitive callback parameters in the URL', () => {
    const oauthEffect = requiredSlice(adminPage, "const auth = searchParams.get('auth');", 'if (adminStatus?.isAdmin !== true)');

    expect(oauthEffect).toContain("delete('auth')");
    expect(oauthEffect).toContain("delete('reason')");
    expect(oauthEffect).toContain("delete('platform')");
    expect(oauthEffect).toContain('router.replace(');
    expect(oauthEffect).toContain('{ scroll: false }');
  });

  test('applies inspector filters before restoring the selected streamer', () => {
    const inspector = requiredSlice(adminPage, 'const inspectEventOwner = useCallback', 'const refreshStreamerRuntime = useCallback');
    const filterIndex = inspector.indexOf('updateFilters(');
    const selectionIndex = inspector.indexOf('setSelectedUserId(userId)');
    const tabIndex = inspector.indexOf("changeTab('streamers')");

    expect(filterIndex).toBeGreaterThanOrEqual(0);
    expect(selectionIndex).toBeGreaterThan(filterIndex);
    expect(tabIndex).toBeGreaterThan(selectionIndex);
  });

  test('rejects expired sessions inside PostgreSQL and keeps the CHZZK Socket.IO version fixed', () => {
    const sessionStart = serverDb.indexOf('export async function getSessionUserId');
    const sessionEnd = serverDb.indexOf('export async function initDb', sessionStart);
    const sessionHelper = serverDb.slice(sessionStart, sessionEnd);

    expect(sessionHelper).toContain('revoked is not true');
    expect(sessionHelper).toContain('(expires_at is null or expires_at > now())');
    expect(sessionHelper).not.toContain('row.expires_at < nowIso');
    expect(packageJson.dependencies['socket.io-client']).toBe('2.0.3');
    expect(systemPage).toContain('Socket.IO 2.x');
    expect(systemPage).toContain('클라이언트 2.0.3은 업그레이드 대상에서 제외하고 고정합니다.');
  });
});
