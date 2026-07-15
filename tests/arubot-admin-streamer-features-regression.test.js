const fs = require('fs');
const path = require('path');

function requiredSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end <= start) throw new Error(`Missing source slice: ${startMarker} -> ${endMarker}`);
  return source.slice(start, end);
}

describe('AruBot admin streamer feature details', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const serverDb = fs.readFileSync(path.join(__dirname, '..', 'server', 'supabase.js'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const helper = requiredSlice(
    serverDb,
    'const ARUBOT_ADMIN_FEATURE_DETAIL_LIMIT',
    'export async function upsertPlatformIdentity'
  );
  const route = requiredSlice(
    serverIndex,
    "app.get('/api/arubot-admin/streamers/:userId/features'",
    "app.post('/api/arubot-admin/streamers/runtime-refresh'"
  );

  test('protects the lazy detail endpoint and returns 404 for an unknown streamer', () => {
    expect(serverIndex).toContain('getArubotAdminStreamerFeatureDetails');
    expect(route).toContain("res.set('Cache-Control', 'private, no-store, max-age=0')");
    expect(route).toContain('requireCurrentAdminUser(req, res)');
    expect(route).toContain('getArubotAdminStreamerFeatureDetails(ownerUserId)');
    expect(route).toContain("res.status(404).json({ error: 'Streamer not found' })");
    expect(route.indexOf('requireCurrentAdminUser')).toBeLessThan(route.indexOf('getArubotAdminStreamerFeatureDetails'));
  });

  test('uses one parameterized PostgreSQL read and caps every category at 100 rows', () => {
    expect(helper).toContain('where id = $1');
    expect(helper).toContain("br.sid = 'user:' || t.id");
    expect(helper).toContain('[owner]');
    expect((helper.match(/limit 101/g) || [])).toHaveLength(6);
    expect(helper).toContain('rows.slice(0, ARUBOT_ADMIN_FEATURE_DETAIL_LIMIT)');
    for (const key of ['commands', 'macros', 'roulettes', 'actions', 'donations', 'automations']) {
      expect(helper).toContain(`${key}: ${key}.truncated`);
    }
  });

  test('projects only operational metadata and never returns credentials or executable action graphs', () => {
    for (const field of [
      "'responsePreview'",
      "'messagePreview'",
      "'itemCount'",
      "'published'",
      "'amountConditions'",
      "'executionMode'",
      "'lastStatus'",
    ]) {
      expect(helper).toContain(field);
    }
    expect(helper).toContain("bs.settings->'macros'");
    expect(helper).toContain("bs.settings->'rouletteDefs'");
    expect(helper).toContain("bs.settings->'donationRules'");
    expect(helper).toContain('normalizeArubotAdminDetailPreview(item?.description)');
    expect(helper).not.toContain('select *');
    for (const forbidden of [
      "'accessToken'",
      "'refreshToken'",
      "'tokenHash'",
      "'controlToken'",
      "'controlUrl'",
      "'endpoint'",
      "'config'",
      "'capabilities'",
      "'nodes'",
      "'edges'",
    ]) {
      expect(helper).not.toContain(forbidden);
    }
  });

  test('returns the agreed stable response shape with 240-character previews', () => {
    expect(helper).toContain('generatedAt: new Date().toISOString()');
    expect(helper).toContain("replace(/\\s+/g, ' ')");
    expect(helper).toContain('text.slice(0, 240)');
    for (const field of [
      'commands: commands.rows.map',
      'macros: macros.rows.map',
      'roulettes: roulettes.rows.map',
      'actions: actions.rows.map',
      'donations: donations.rows.map',
      'automations: automations.rows.map',
      'truncated: {',
    ]) {
      expect(helper).toContain(field);
    }
  });

  test('keeps CHZZK Socket.IO client pinned to the required 2.x release', () => {
    expect(packageJson.dependencies['socket.io-client']).toBe('2.0.3');
  });
});
