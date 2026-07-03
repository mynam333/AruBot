const fs = require('fs');
const path = require('path');

describe('operational hardening regression', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const supabase = fs.readFileSync(path.join(__dirname, '..', 'server', 'supabase.js'), 'utf8');
  const envExample = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  const resourceDashboard = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'admin', 'resource-dashboard.tsx'), 'utf8');

  test('keeps direct PG access pooled and bounded by timeouts', () => {
    expect(supabase).toContain('const { Client, Pool } = pkg');
    expect(supabase).toContain('function getPgPool()');
    expect(supabase).toContain('connectionTimeoutMillis: PG_CONNECT_TIMEOUT_MS');
    expect(supabase).toContain('statement_timeout: PG_STATEMENT_TIMEOUT_MS');
    expect(supabase).toContain('client = await pool.connect()');
    expect(supabase).toContain('client.release()');
  });

  test('runs all numbered migration files instead of a stale hard-coded subset', () => {
    expect(supabase).toContain("fs.readdirSync(migrationsDir)");
    expect(supabase).toContain(".filter((fileName) => /^\\d+_.+\\.sql$/i.test(fileName))");
    expect(supabase).toContain(".sort((a, b) => a.localeCompare(b, 'en'))");
    expect(supabase).not.toContain("'005_multi_platform_accounts.sql'\\n    ]");
  });

  test('requires a dedicated token encryption key for production operation', () => {
    expect(supabase).toContain('export function validateSecretEncryptionConfig()');
    expect(supabase).toContain('ARUBOT_SECRET_ENCRYPTION_KEY');
    expect(supabase).toContain('TOKEN_ENCRYPTION_SECRET');
    expect(supabase).toContain("process.env.NODE_ENV === 'production'");
    expect(serverIndex).toContain('validateSecretEncryptionConfig();');
    expect(envExample).toContain('ARUBOT_SECRET_ENCRYPTION_KEY=');
    expect(envExample).toContain('ARUBOT_REQUIRE_TOKEN_ENCRYPTION_KEY=true');
  });

  test('platform diagnostics render operational status before raw JSON', () => {
    expect(resourceDashboard).toContain('function getPlatformStatusItems');
    expect(resourceDashboard).toContain('무시된 YouTube 후원');
    expect(resourceDashboard).toContain('재인증 필요');
    expect(resourceDashboard).toContain('lastStatus');
  });
});
