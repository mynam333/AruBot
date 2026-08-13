const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
const serverIndex = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
const databaseSource = fs.readFileSync(path.join(root, 'server', 'supabase.js'), 'utf8');
const shortLinkSource = fs.readFileSync(path.join(root, 'server', 'public-short-links.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'server', 'migrations', '023_public_short_links.sql'), 'utf8');
const providerSmoke = fs.readFileSync(path.join(root, 'scripts', 'db-provider-smoke.js'), 'utf8');
const databaseRoles = fs.readFileSync(path.join(root, 'docs', 'DATABASE_ROLES.md'), 'utf8');
const shortLinkModuleUrl = pathToFileURL(path.join(root, 'server', 'public-short-links.js')).href;

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('permanent public short-link regression', () => {
  test('migration stores a bounded unpredictable code and one row per target', () => {
    expect(migration).toContain('create table if not exists public.public_short_links');
    expect(migration).toContain("code ~ '^[A-Za-z0-9_-]{10,16}$'");
    expect(migration).toContain('char_length(target_path) between 3 and 512');
    expect(migration).toContain('public_short_links_target_path_uniq');
    expect(migration).toContain('idx_public_short_links_created_by');
    expect(migration).toContain('revoke all on table public.public_short_links from public');
  });

  test('creation is idempotent by target and retries rare random-code collisions', () => {
    const create = sourceBetween(
      databaseSource,
      'export async function getOrCreatePublicShortLink',
      'export async function resolvePublicShortLink',
    );
    expect(create).toContain("crypto.randomBytes(8).toString('base64url').slice(0, 10)");
    expect(create).toContain('on conflict do nothing');
    expect(create).toContain('where target_path = $1');
    expect(create).toContain('generated code collided');
    expect(create).toContain('}, 0)');
  });

  test('anonymous creation is rate limited and only accepts explicit public viewer paths', () => {
    const createRoute = sourceBetween(
      serverIndex,
      "app.post('/api/short-links'",
      "app.get('/api/public/short-links/:code'",
    );

    expect(serverIndex).toContain("shortLinkCreate: createIpRateLimiter({ prefix: 'shortLinkCreate'");
    expect(createRoute).toContain('rateLimiters.shortLinkCreate');
    expect(createRoute).toContain('getCurrentSessionUserId(req).catch(() => null)');
    expect(createRoute).toContain('resolveVerifiedPublicChannelIdentity(channelUid)');
    expect(createRoute).toContain("status(404).json({ error: 'public_channel_not_found' })");
    expect(createRoute).toContain("targetPath.startsWith('/viewer/drawing/')");
    expect(createRoute).toContain("targetPath.startsWith('/viewer/login?')");
    expect(createRoute).toContain("status(401).json({ error: 'login_required_for_viewer_short_link' })");
    expect(shortLinkSource).toContain("segments[0] === 'c'");
    expect(shortLinkSource).toContain("segments[1] === 'drawing'");
    expect(shortLinkSource).not.toContain("segments[1] === 'prediction'");
  });

  test('target allowlist canonicalizes public paths and rejects tokens, queries, traversal, and external redirects', () => {
    const scenario = `
      const links = await import(${JSON.stringify(shortLinkModuleUrl)});
      const inputs = [
        '/c/YOUTUBE%3AUC123',
        '/c/UC123/commands',
        '/c/UC123/points',
        '/c/UC123/roulette',
        '/c/UC123/roulette/logs',
        '/c/UC123/live',
        '/viewer/drawing/UC123',
        '/viewer/login?returnTo=%2Fviewer%2Fdrawing%2FUC123',
        '/viewer/prediction/UC123',
        '/roulette/secret-token',
        '/pvd/secret-token',
        '/drawing-overlay/secret-token',
        '/c/UC123?token=secret',
        '//evil.example/c/UC123',
        '/c/UC123/%2e%2e/secret',
        '/c/UC123%2F..%2Fsecret',
        '/c/UC123%5Csecret',
        '/viewer/login?returnTo=https%3A%2F%2Fevil.example',
        '/viewer/login?returnTo=%2F%2Fevil.example',
        '/viewer/login?returnTo=%2Fviewer%2Fdrawing%2FUC123&token=secret'
      ];
      console.log(JSON.stringify(inputs.map((input) => links.normalizePublicShortLinkTarget(input))));
    `;
    const results = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', scenario], {
      cwd: root,
      encoding: 'utf8',
    }).trim());

    expect(results.slice(0, 8)).toEqual([
      '/c/youtube%3AUC123',
      '/c/UC123/commands',
      '/c/UC123/points',
      '/c/UC123/roulette',
      '/c/UC123/roulette/logs',
      '/c/UC123/live',
      '/viewer/drawing/UC123',
      '/viewer/login?returnTo=%2Fviewer%2Fdrawing%2FUC123',
    ]);
    expect(results.slice(8).every((value) => value === null)).toBe(true);
  });

  test('resolution fails closed and the API never redirects to a stored absolute URL', () => {
    const resolveRoute = sourceBetween(
      serverIndex,
      "app.get('/api/public/short-links/:code'",
      '// Compatibility fallback',
    );
    const redirectRoute = sourceBetween(
      serverIndex,
      "app.get('/s/:code'",
      "app.get('/api/health'",
    );
    expect(resolveRoute).toContain('normalizePublicShortLinkTarget(link?.targetPath)');
    expect(resolveRoute).toContain('resolveCachedPublicShortLink(code)');
    expect(resolveRoute).not.toContain('rateLimiters.shortLinkResolve');
    expect(resolveRoute).toContain("status(503).json({ error: 'short_link_temporarily_unavailable' })");
    expect(redirectRoute).toContain('rateLimiters.shortLinkResolve');
    expect(redirectRoute).toContain('buildPublicShortLinkRedirectUrl(targetPath, FRONTEND_ORIGIN)');
    expect(redirectRoute).toContain("status(503).send('Temporarily unavailable')");
    expect(redirectRoute).not.toContain('res.redirect(302, link.targetPath)');
    expect(databaseSource).not.toContain('access_count = access_count + 1');
  });

  test('public resolution uses bounded single-flight positive caching without caching misses', () => {
    const cache = sourceBetween(
      serverIndex,
      'const PUBLIC_SHORT_LINK_CACHE_TTL_MS',
      'function parsePublicPointPolicyUid',
    );
    expect(cache).toContain('const publicShortLinkPositiveCache = new Map()');
    expect(cache).toContain('PUBLIC_SHORT_LINK_CACHE_MAX_ENTRIES');
    expect(cache).toContain('runPublicShortLinkLookup = createBoundedOperationRunner');
    expect(cache).toContain("singleFlight(`public-short-link:${normalizedCode}`");
    expect(cache).toContain('Misses are deliberately not cached');
    expect(cache).toContain('publicShortLinkPositiveCache.delete(oldestCode)');
  });

  test('short URL returned to clients is always on the configured frontend origin', () => {
    expect(shortLinkSource).toContain('normalizePublicShortLinkFrontendOrigin(frontendOrigin)');
    expect(shortLinkSource).toContain("['http:', 'https:']");
    expect(shortLinkSource).toContain('/s/${encodeURIComponent(normalizedCode)}');
    expect(serverIndex).toContain('buildPublicShortLinkUrl(link.code, FRONTEND_ORIGIN)');
  });

  test('runtime-role smoke checks the new table permissions without retaining probe rows', () => {
    expect(providerSmoke).toContain('let shortLinkCrudAccess = false');
    expect(providerSmoke).toContain("insert into public.public_short_links");
    expect(providerSmoke).toContain("update public.public_short_links set created_by = null");
    expect(providerSmoke).toContain("delete from public.public_short_links");
    expect(providerSmoke).toContain("await client.query('rollback')");
    expect(providerSmoke).toContain('counterWriteAccess && shortLinkCrudAccess');
    expect(databaseRoles).toContain('public.public_short_links');
    expect(databaseRoles).toContain('npm run db:provider-smoke');
  });
});
