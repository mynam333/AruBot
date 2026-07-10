const fs = require('fs');
const path = require('path');

describe('commercial runtime hardening regression', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const supabase = fs.readFileSync(path.join(__dirname, '..', 'server', 'supabase.js'), 'utf8');
  const leaseMigration = fs.readFileSync(
    path.join(__dirname, '..', 'server', 'migrations', '014_api_key_scopes_and_runtime_leases.sql'),
    'utf8'
  );

  test('holds and renews one provider runtime lease per channel owner', () => {
    expect(supabase).toContain('export async function claimRuntimeLease');
    expect(supabase).toContain('runtime_leases.owner_id = excluded.owner_id or runtime_leases.expires_at <= now()');
    expect(leaseMigration).toContain('create table if not exists public.runtime_leases');
    expect(leaseMigration).toContain('fencing_token bigint not null default 1');
    expect(serverIndex).toContain("await ensureProviderRuntimeLease('chzzk', ownerUserId, { channelId })");
    expect(serverIndex).toContain("await ensureProviderRuntimeLease('youtube', ownerUserId)");
    expect(serverIndex).toContain("await ensureProviderRuntimeLease('cime', ownerUserId)");
    expect(serverIndex).toContain('renewProviderRuntimeLeases().catch');
    expect(serverIndex).toContain("closeYoutubeSession(state.ownerUserId, 'runtime_lease_lost')");
    expect(serverIndex).toContain("closeCimeSession(state.ownerUserId, 'runtime_lease_lost')");
    expect(serverIndex).toContain("closeChzzkProviderRuntimeSession(state.ownerUserId, 'runtime_lease_lost')");
  });

  test('revokes external OAuth grants before deleting local account data', () => {
    const helperStart = serverIndex.indexOf('async function revokeExternalAccountGrants');
    const routeStart = serverIndex.indexOf("app.delete('/api/account'", helperStart);
    const routeEnd = serverIndex.indexOf('function stationChannelUrl', routeStart);
    const helperBody = serverIndex.slice(helperStart, routeStart);
    const routeBody = serverIndex.slice(routeStart, routeEnd);

    expect(helperBody).toContain("getTokens(`user:${owner}`)");
    expect(helperBody).toContain("getPlatformTokens('youtube', owner)");
    expect(helperBody).toContain("getPlatformTokens('cime', owner)");
    expect(helperBody).toContain('YOUTUBE_REVOKE_URL');
    expect(helperBody).toContain("`${CIME_OPENAPI_BASE}/auth/v1/token/revoke`");
    expect(routeBody.indexOf('await revokeExternalAccountGrants(ownerUserId)')).toBeLessThan(routeBody.indexOf('await deleteAccountData(ownerUserId'));
    expect(routeBody).toContain("e?.code === 'external_oauth_revoke_failed'");
    expect(routeBody).toContain('return res.status(502)');
  });

  test('routes paid work through atomic charges and durable jobs', () => {
    expect(serverIndex).toContain('enqueuePaidDurableRuntimeJob({');
    expect(serverIndex).toContain("jobType: 'video-donation'");
    expect(serverIndex).toContain("jobType: 'roulette-spin'");
    expect(serverIndex).toContain("jobType: 'drawing-donation'");
    expect(serverIndex).toContain("jobTypes: ['video-donation', 'roulette-spin', 'drawing-donation']");
    expect(serverIndex).toContain('await deductChannelPointsIfEnough(');
    expect(serverIndex).toContain('await claimBotRuleCooldown(');
    expect(serverIndex).not.toMatch(/upsertBotRule\([^\n]+lastUsed/);
  });

  test('exposes separate liveness and dependency-aware readiness and drains cleanly', () => {
    expect(serverIndex).toContain("app.get('/healthz'");
    expect(serverIndex).toContain("app.get('/readyz'");
    expect(serverIndex).toContain('await checkDatabaseReady()');
    expect(serverIndex).toContain('runtimeReadinessState.shuttingDown = true');
    expect(serverIndex).toContain('await closeDatabaseConnections()');
    expect(serverIndex).toContain('await Promise.allSettled(leasesToRelease.map');
  });

  test('uses certificate verification for remote production Postgres connections', () => {
    expect(supabase).toContain('rejectUnauthorized: true');
    expect(supabase).toContain("process.env[`${prefix}_SSL_CA`]");
    expect(supabase).toContain("process.env[`${prefix}_SSL_CA_FILE`]");
    expect(supabase).toContain('Remote PostgreSQL connections must use verified TLS in production');
  });
});
