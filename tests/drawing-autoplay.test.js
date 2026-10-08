const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const loadServerFunctions = require('./helpers/load-server-functions.cjs');

const filename = path.join(__dirname, '../server/supabase.js');
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
const declarations = ['getCurrentDrawingDonationItem', 'normalizeDrawingDonationRow'].map((name) =>
  source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(source));
const code = ts.transpileModule(declarations.join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function databaseHarness(row = { id: 'drawing-1', status: 'playing', canvas: {}, strokes: [{ id: 'stroke-1' }] }) {
  const query = jest.fn(async (sql) => ({ rows: sql.startsWith('with existing') && row ? [row] : [] }));
  const bindings = {
    ensureDrawingDonationTables: jest.fn().mockResolvedValue(undefined),
    withPgClient: jest.fn((callback) => callback({ query })),
    hydrateDrawingDonationStrokes: jest.fn(async (item) => item),
    cutoffIsoForDays: jest.fn(() => '2026-09-01T00:00:00.000Z'),
    drawingRetentionDays: jest.fn(() => 30),
  };
  const current = new Function(...Object.keys(bindings), 'exports', `${code}; return getCurrentDrawingDonationItem;`)(...Object.values(bindings), {});
  return { ...bindings, query, current };
}

test('serializes next-item selection per streamer and releases the transaction before downloading recordings', async () => {
  const h = databaseHarness();
  await expect(h.current('user:streamer')).resolves.toMatchObject({ id: 'drawing-1', strokes: [{ id: 'stroke-1' }] });
  expect(h.query.mock.calls[0]).toEqual(['begin']);
  expect(h.query.mock.calls[1]).toEqual(['select pg_advisory_xact_lock(hashtextextended($1, 0))', ['drawing-playback:user:streamer']]);
  expect(h.query.mock.calls[2][1]).toEqual(['user:streamer', '2026-09-01T00:00:00.000Z']);
  expect(h.query.mock.calls[3]).toEqual(['commit']);
  expect(h.hydrateDrawingDonationStrokes.mock.invocationCallOrder[0]).toBeGreaterThan(h.query.mock.invocationCallOrder[3]);
});

test('only enabled automatic approval admits queued items, retaining ordering, expiry and refund guards', async () => {
  const h = databaseHarness();
  await h.current('user:streamer');
  const sql = h.query.mock.calls[2][0].replace(/\s+/g, ' ');
  expect(sql).toContain("status = 'approved' or (status = 'queued' and exists (");
  expect(sql).toContain("from public.bot_settings where sid = $1 and settings->'drawingDonation'->>'enabled' = 'true' and settings->'drawingDonation'->>'approvalMode' = 'auto'");
  expect(sql).toContain('and point_refunded is not true and created_at >= $2::timestamptz and not exists (select 1 from existing) order by position asc, created_at asc');
  expect(sql).toContain("where sid = $1 and status = 'playing'");
  expect(sql).toContain('approved_at = coalesce(approved_at, now())');
});

test('repeated current-item polls skip recording hydration but a changed item includes it', async () => {
  const h = databaseHarness();
  await expect(h.current('user:streamer', { knownItemId: 'drawing-1' })).resolves.not.toHaveProperty('strokes');
  expect(h.hydrateDrawingDonationStrokes).not.toHaveBeenCalled();
  await expect(h.current('user:streamer', { knownItemId: 'previous' })).resolves.toHaveProperty('strokes');
  expect(h.hydrateDrawingDonationStrokes).toHaveBeenCalledTimes(1);
});

test('metadata-only current-item lookups do not download recordings', async () => {
  const h = databaseHarness();
  await expect(h.current('user:streamer', { includeStrokes: false })).resolves.not.toHaveProperty('strokes');
  expect(h.hydrateDrawingDonationStrokes).not.toHaveBeenCalled();
});

test('rolls back failed selection and propagates the failure instead of reporting an empty queue', async () => {
  const h = databaseHarness();
  h.query.mockImplementation(async (sql) => {
    if (sql.startsWith('with existing')) throw new Error('database restarting');
    return { rows: [] };
  });
  await expect(h.current('user:streamer')).rejects.toThrow('database restarting');
  expect(h.query).toHaveBeenLastCalledWith('rollback');
  expect(h.hydrateDrawingDonationStrokes).not.toHaveBeenCalled();
});

function currentRoute(item) {
  const getCurrentDrawingItemForSid = jest.fn().mockResolvedValue(item);
  const route = loadServerFunctions.route('/api/drawing-donation/current', {
    getDrawingSidByToken: jest.fn().mockResolvedValue('user:streamer'),
    getCurrentDrawingItemForSid, RENDERER_VERSION: 'current-renderer',
  });
  const response = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  return { getCurrentDrawingItemForSid, response, run: (query = {}) => route({ query: { token: 'draw_test', renderer: 'current-renderer', ...query } }, response) };
}

test('current endpoint distinguishes initial empty state, unchanged state and the next drawing', async () => {
  const h = currentRoute(null);
  await h.run();
  expect(h.response.json).toHaveBeenLastCalledWith(expect.objectContaining({ item: null }));
  await h.run({ knownItemId: '' });
  expect(h.response.json).toHaveBeenLastCalledWith(expect.objectContaining({ unchanged: true, itemId: null }));
  h.getCurrentDrawingItemForSid.mockResolvedValue({ id: 'drawing-1' });
  await h.run({ knownItemId: '' });
  expect(h.response.json).toHaveBeenLastCalledWith(expect.objectContaining({ item: { id: 'drawing-1' } }));
  await h.run({ knownItemId: 'drawing-1' });
  expect(h.response.json).toHaveBeenLastCalledWith(expect.objectContaining({ unchanged: true, itemId: 'drawing-1' }));
  expect(h.getCurrentDrawingItemForSid).toHaveBeenLastCalledWith('user:streamer', { knownItemId: 'drawing-1', allowMemoryFallback: false });
  expect(h.response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
});

test('an unchanged drawing still requires renderer compatibility and transient lookup failures return errors', async () => {
  const h = currentRoute({ id: 'drawing-1', canvas: { document: { version: 2 } } });
  await h.run({ knownItemId: 'drawing-1', renderer: 'old' });
  expect(h.response.status).toHaveBeenLastCalledWith(426);
  h.getCurrentDrawingItemForSid.mockRejectedValue(new Error('database restarting'));
  await h.run();
  expect(h.response.status).toHaveBeenLastCalledWith(500);
});

test('persistent polling does not substitute a stale process-local queue during database failure', async () => {
  const getCurrentDrawingDonationItem = jest.fn().mockRejectedValue(new Error('database restarting'));
  const getCurrentDrawingItem = jest.fn();
  const { getCurrentDrawingItemForSid } = loadServerFunctions(['getCurrentDrawingItemForSid'], { getCurrentDrawingDonationItem, getCurrentDrawingItem });
  await expect(getCurrentDrawingItemForSid('user:streamer', { allowMemoryFallback: false })).rejects.toThrow('database restarting');
  await expect(getCurrentDrawingItemForSid('user:streamer')).rejects.toThrow('database restarting');
  expect(getCurrentDrawingItem).not.toHaveBeenCalled();
});

test('saving automatic approval wakes connected overlays after the settings are persisted', async () => {
  const settings = { enabled: true, approvalMode: 'auto' };
  const bindings = {
    getPartitionId: jest.fn().mockResolvedValue('user:streamer'),
    getBotSettings: jest.fn().mockResolvedValue({ otherSetting: 1 }),
    normalizeDrawingDonationSettings: jest.fn((value) => value),
    setBotSettings: jest.fn().mockResolvedValue(undefined),
    notifyDrawingSubscribers: jest.fn().mockResolvedValue(undefined),
    notifyDrawingAdminSubscribers: jest.fn().mockResolvedValue(undefined),
  };
  const route = loadServerFunctions.route('/api/drawing-donation/settings', bindings, 'post');
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  await route({ body: settings }, response);
  expect(bindings.setBotSettings).toHaveBeenCalledWith('user:streamer', { otherSetting: 1, drawingDonation: settings });
  expect(bindings.notifyDrawingSubscribers).toHaveBeenCalledWith('user:streamer', 'settings_updated');
  expect(bindings.notifyDrawingSubscribers.mock.invocationCallOrder[0]).toBeGreaterThan(bindings.setBotSettings.mock.invocationCallOrder[0]);
  expect(response.json).toHaveBeenCalledWith({ ok: true, settings });
});
