const fs = require('fs');
const path = require('path');

describe('streamer home runtime status regression', () => {
  const root = path.join(__dirname, '..');
  const dashboard = fs.readFileSync(path.join(root, 'src', 'features', 'admin', 'dashboard-page.tsx'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
  const database = fs.readFileSync(path.join(root, 'server', 'supabase.js'), 'utf8');
  const smoke = fs.readFileSync(path.join(root, 'scripts', 'api-smoke.js'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  test('unwraps settings and stats envelopes using the production API contract', () => {
    expect(dashboard).toContain('settingsResult.data.settings ?? {}');
    expect(dashboard).toContain('statsResult.data.stats ?? {}');
    expect(dashboard).toContain("dashboardData?.stats?.commandsHandled");
    expect(dashboard).toContain('dashboardData.settings.botEnabled !== false');
    expect(dashboard).not.toContain('확인 불가');
  });

  test('uses live provider runtime state instead of configuration alone', () => {
    expect(dashboard).toContain("'/api/platforms/status?refresh=true'");
    expect(dashboard).toContain('item.streamConnected');
    expect(dashboard).toContain("value: '작동 중'");
    expect(dashboard).toContain("value: '방송 대기'");
    expect(dashboard).toContain('platformRuntimeError(runtime)');
  });

  test('refresh status is read-only while background recovery exposes diagnostics', () => {
    const statusStart = server.indexOf("app.get('/api/platforms/status'");
    const statusEnd = server.indexOf("app.post('/api/cime/reset'", statusStart);
    const status = server.slice(statusStart, statusEnd);

    expect(status).not.toContain('await ensureChzzkChatSessionForLiveSid');
    expect(status).not.toContain('await ensureCimeSession(ownerUserId)');
    expect(status).not.toContain('await ensureYoutubeSession(ownerUserId)');
    expect(status).not.toContain('disconnectProviderRuntimeState(');
    expect(status).toContain('lastError: chzzkRefreshError || chzzkDiagnostic?.message || null');
    expect(status).toContain('recovering: !!cimeRecovery');
    expect(status).toContain('recovering: !!youtubeRecovery');
    expect(status).toContain('persistSession: false');
    expect(status).toContain("transportVersion: '2.x'");
    expect(packageJson.dependencies['socket.io-client']).toBe('2.0.3');
  });

  test('increments command statistics through an atomic PostgreSQL upsert', () => {
    const logStart = server.indexOf('async function recordCommandExecutionLog');
    const logEnd = server.indexOf('async function recordDonationRuleExecutionLog', logStart);
    const logBody = server.slice(logStart, logEnd);
    const statsStart = database.indexOf('export async function updateBotStats');
    const statsEnd = database.indexOf('// Rules', statsStart);
    const statsBody = database.slice(statsStart, statsEnd);

    expect(logBody).toContain('commandsHandled: 1');
    expect(logBody).toContain('await statsUpdate');
    expect(statsBody).toContain('insert into bot_stats');
    expect(statsBody).toContain('on conflict (sid) do update set');
    expect(statsBody).toContain('commands_handled = coalesce(bot_stats.commands_handled, 0) + excluded.commands_handled');
  });

  test('uses a proxy-safe readiness route with a strict smoke contract', () => {
    expect(server).toContain("check: 'liveness'");
    expect(server).toContain("check: 'readiness'");
    expect(server).toContain("app.get('/api/readiness', handleReadiness)");
    expect(smoke).toContain("'/api/readiness'");
    expect(smoke).toContain("body?.check === 'readiness'");
    expect(smoke).toContain('body?.readiness?.initialBootstrapCompleted === true');
    expect(smoke).toContain('body?.db?.ok === true');
  });
});
