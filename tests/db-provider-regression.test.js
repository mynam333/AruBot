const fs = require('fs');
const path = require('path');

describe('database provider regression', () => {
  const supabaseSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'supabase.js'), 'utf8');
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const envExample = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  const packageJson = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');
  const dbCommon = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'db-common.js'), 'utf8');
  const compareCounts = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'db-compare-counts.js'), 'utf8');
  const compareChecksums = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'db-compare-checksums.js'), 'utf8');
  const diffTable = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'db-diff-table.js'), 'utf8');
  const cutoverRehearsal = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'db-cutover-rehearsal.js'), 'utf8');
  const cutoverPreflight = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'db-cutover-preflight.js'), 'utf8');
  const switchToPostgres = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'db-switch-to-postgres.js'), 'utf8');

  test('exposes explicit Supabase/Postgres provider selection', () => {
    expect(supabaseSource).toContain('export function getDbProvider()');
    expect(supabaseSource).toContain("DB_PROVIDER_POSTGRES = 'postgres'");
    expect(envExample).toContain('ARUBOT_DB_PROVIDER=supabase');
    expect(envExample).toContain('POSTGRES_URL=');
  });

  test('postgres provider initializes without Supabase URL or service role key', () => {
    const initStart = supabaseSource.indexOf('export async function initDb()');
    const ensureStart = supabaseSource.indexOf('function ensure()', initStart);
    const initBody = supabaseSource.slice(initStart, ensureStart);

    expect(initBody).toContain('if (isPostgresProvider())');
    expect(initBody).toContain('supabase = createPostgresProviderClient();');
    expect(initBody).toContain('const dbUrl = getDbUrl();');
    expect(initBody).toContain('POSTGRES_URL missing');
    expect(initBody).toContain('return;');
  });

  test('postgres provider uses direct pg compatibility adapter for existing query calls', () => {
    expect(supabaseSource).toContain('class PgQueryBuilder');
    expect(supabaseSource).toContain('function createPostgresProviderClient()');
    expect(supabaseSource).toContain('return new PgQueryBuilder(table)');
    expect(supabaseSource).toContain('DEFAULT_UPSERT_CONFLICT_COLUMNS');
  });

  test('server skips PostgREST schema refresh when postgres provider is active', () => {
    expect(serverIndex).toContain('const USE_POSTGRES_PROVIDER = DB_PROVIDER ===');
    expect(serverIndex).toContain('function shouldRefreshPostgRESTSchema()');
    expect(serverIndex).toContain('return !USE_POSTGRES_PROVIDER');
    expect(serverIndex).toContain('if (!shouldRefreshPostgRESTSchema()) return;');
  });

  test('provides migration and verification commands for provider cutover', () => {
    expect(packageJson).toContain('"db:migrate": "node scripts/db-migrate.js"');
    expect(packageJson).toContain('"db:migration-status": "node scripts/db-migration-status.js"');
    expect(packageJson).toContain('"db:dump-public": "node scripts/db-dump-public.js"');
    expect(packageJson).toContain('"db:restore-public": "node scripts/db-restore-public.js"');
    expect(packageJson).toContain('"db:repair-sequences": "node scripts/db-repair-sequences.js"');
    expect(packageJson).toContain('"db:counts": "node scripts/db-row-counts.js"');
    expect(packageJson).toContain('"db:compare-counts": "node scripts/db-compare-counts.js"');
    expect(packageJson).toContain('"db:compare-checksums": "node scripts/db-compare-checksums.js"');
    expect(packageJson).toContain('"db:diff-table": "node scripts/db-diff-table.js"');
    expect(packageJson).toContain('"db:cutover-preflight": "node scripts/db-cutover-preflight.js"');
    expect(packageJson).toContain('"db:cutover-verify": "node scripts/db-cutover-verify.js"');
    expect(packageJson).toContain('"db:cutover-rehearsal": "node scripts/db-cutover-rehearsal.js"');
    expect(packageJson).toContain('"db:switch-to-postgres": "node scripts/db-switch-to-postgres.js"');
    expect(packageJson).toContain('"db:provider-smoke": "node scripts/db-provider-smoke.js"');
    expect(packageJson).toContain('"api:smoke": "node scripts/api-smoke.js"');
    expect(packageJson).toContain('"pm2:stop": "pm2 stop arubot-api"');
    expect(envExample).toContain('ARUBOT_ALLOW_SUPABASE_ENV_WITH_POSTGRES=false');
    expect(envExample).toContain('ARUBOT_ALLOW_SUPABASE_POSTGRES_URL=false');
  });

  test('migration runner skips already successful migration files', () => {
    const start = supabaseSource.indexOf('export async function runMigrations()');
    const end = supabaseSource.indexOf('// 채널 ID 데이터 마이그레이션 함수', start);
    const body = supabaseSource.slice(start, end);

    expect(supabaseSource).toContain('async function getSuccessfulMigrationNames');
    expect(supabaseSource).toContain('async function recordMigrationResult');
    expect(body).toContain('Skipping already successful');
    expect(body).toContain("recordMigrationResult(client, fileName, 'success'");
    expect(body).toContain("recordMigrationResult(client, fileName, 'failed'");
  });

  test('provides restore verification helpers for sequences and checksums', () => {
    expect(dbCommon).toContain('export async function repairIdentitySequences');
    expect(dbCommon).toContain('setval($1::regclass, $2, false)');
    expect(packageJson).toContain('"db:compare-checksums": "node scripts/db-compare-checksums.js"');
    expect(packageJson).toContain('"db:cutover-verify": "node scripts/db-cutover-verify.js"');
  });

  test('count comparison ignores migration_log metadata by default', () => {
    expect(compareCounts).toContain("const DEFAULT_IGNORED_TABLES = ['migration_log']");
    expect(compareCounts).toContain("parseListArg('ignore', DEFAULT_IGNORED_TABLES)");
    expect(compareCounts).toContain('ignoredTables');
  });

  test('checksum and table diff comparison normalize timestamp rendering', () => {
    expect(compareChecksums).toContain("set time zone 'UTC'");
    expect(compareChecksums).toContain('set datestyle to ISO, YMD');
    expect(compareChecksums).toContain('normalizeComparisonSession(client)');
    expect(diffTable).toContain("set time zone 'UTC'");
    expect(diffTable).toContain('show-values');
  });

  test('cutover rehearsal is dry-run by default and requires restore confirmation', () => {
    expect(cutoverRehearsal).toContain("hasFlag('execute')");
    expect(cutoverRehearsal).toContain('Dry run only');
    expect(cutoverRehearsal).toContain("confirm !== 'restore-public'");
    expect(cutoverRehearsal).toContain('scripts/db-cutover-preflight.js');
    expect(cutoverRehearsal).toContain('scripts/db-restore-public.js');
    expect(cutoverRehearsal).toContain('scripts/db-compare-checksums.js');
    expect(cutoverRehearsal).toContain('scripts/api-smoke.js');
  });

  test('cutover rehearsal compares checksums before postgres bootstrap can mutate runtime fields', () => {
    const restoreIndex = cutoverRehearsal.indexOf('Restore dump into Postgres public schema');
    const checksumIndex = cutoverRehearsal.indexOf('Compare restored core checksums');
    const migrateIndex = cutoverRehearsal.indexOf('Run Postgres migrations');

    expect(restoreIndex).toBeGreaterThan(-1);
    expect(checksumIndex).toBeGreaterThan(restoreIndex);
    expect(migrateIndex).toBeGreaterThan(checksumIndex);
  });

  test('postgres provider blocks official Supabase hosts and mixed runtime env by default', () => {
    expect(dbCommon).toContain('export function looksLikeOfficialSupabaseDatabaseUrl');
    expect(dbCommon).toContain('export function validateDatabaseUrlForProvider');
    expect(dbCommon).toContain('ARUBOT_ALLOW_SUPABASE_POSTGRES_URL');
    expect(dbCommon).toContain('function providerSslEnv');
    expect(serverIndex).toContain('function validateDatabaseProviderConfig()');
    expect(serverIndex).toContain('ARUBOT_ALLOW_SUPABASE_ENV_WITH_POSTGRES');
    expect(serverIndex).toContain('SUPABASE_DB_URL');
    expect(serverIndex).toContain('validateDatabaseProviderConfig();');
  });

  test('cutover preflight checks tools, urls, and both database connections before restore', () => {
    expect(cutoverPreflight).toContain("runVersion('pg_dump')");
    expect(cutoverPreflight).toContain("runVersion('pg_restore')");
    expect(cutoverPreflight).toContain("resolveDatabaseUrl('supabase')");
    expect(cutoverPreflight).toContain("resolveDatabaseUrl('postgres')");
    expect(cutoverPreflight).toContain("inspectDatabase(target)");
    expect(cutoverPreflight).toContain('SUPABASE_DB_URL and POSTGRES_URL must point to different databases');
  });

  test('one-click postgres switch is guarded and updates env only after rehearsal', () => {
    expect(switchToPostgres).toContain("hasFlag('execute')");
    expect(switchToPostgres).toContain("confirm !== 'switch-to-postgres'");
    expect(switchToPostgres).toContain('scripts/db-cutover-rehearsal.js');
    expect(switchToPostgres).toContain('--confirm=restore-public');
    expect(switchToPostgres).toContain("upsertEnvValue(lines, 'ARUBOT_DB_PROVIDER', 'postgres')");
    expect(switchToPostgres).toContain("blankEnvValue(lines, 'SUPABASE_DB_URL')");
    expect(switchToPostgres).toContain("blankEnvValue(lines, 'SUPABASE_URL')");
    expect(switchToPostgres).toContain("hasFlag('skip-runtime-stop')");
    expect(switchToPostgres).toContain("npmCommand(), ['run', 'pm2:stop']");
    expect(switchToPostgres).toContain('function npmCommand()');
    expect(switchToPostgres).toContain("npmCommand(), ['run', 'pm2:reload']");
    expect(switchToPostgres).toContain('scripts/api-smoke.js');
  });

  test('health endpoints expose active database provider for smoke checks', () => {
    const versionStart = serverIndex.indexOf("app.get('/api/version'");
    const healthStart = serverIndex.indexOf("app.get('/api/health'");
    const readyStart = serverIndex.indexOf("app.get(['/healthz', '/readyz']");
    const versionBody = serverIndex.slice(versionStart, serverIndex.indexOf('});', versionStart));
    const healthBody = serverIndex.slice(healthStart, serverIndex.indexOf('});', healthStart));
    const readyBody = serverIndex.slice(readyStart, serverIndex.indexOf('});', readyStart));

    expect(versionBody).toContain('dbProvider: DB_PROVIDER');
    expect(healthBody).toContain('dbProvider: DB_PROVIDER');
    expect(readyBody).toContain('dbProvider: DB_PROVIDER');
  });
});
