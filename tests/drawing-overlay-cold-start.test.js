const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const loadServerFunctions = require('./helpers/load-server-functions.cjs');

const filename = path.join(__dirname, '../server/supabase.js');
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
const names = [
  'quoteIdent', 'normalizeColumnName', 'buildColumnExpression', 'parseSelectColumns',
  'PgQueryBuilder', 'createPostgresProviderClient', 'findSidByDrawingViewerToken',
];
const declarations = names.map((name) => source.statements.find((node) => node.name?.text === name).getText(source));
const code = ts.transpileModule(declarations.join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function coldServer() {
  const token = 'draw_saved_before_restart';
  const sid = 'user:streamer';
  const query = jest.fn(async (_sql, values) => ({
    rows: values[0] === 'drawingDonationViewerToken' && values[1] === token ? [{ sid }] : [],
  }));
  const bindings = {
    ensure: jest.fn(),
    withPgClient: (callback) => callback({ query }),
  };
  // Exercise the real PostgreSQL query builder, not a mocked token resolver.
  const db = new Function(...Object.keys(bindings), 'exports', `${code}
    const supabase = createPostgresProviderClient();
    return { findSidByDrawingViewerToken, buildColumnExpression, supabase };`)(...Object.values(bindings), {});
  const drawingTokenToSid = new Map();
  const getBotSettings = jest.fn(() => { throw new Error('No dashboard or bot runtime may initialize the token'); });
  const { getDrawingSidByToken } = loadServerFunctions(['getDrawingSidByToken'], {
    ...db, drawingTokenToSid, getBotSettings, activeSids: new Map(),
  });
  const getCurrentDrawingItemForSid = jest.fn().mockResolvedValue({ id: 'drawing-1', status: 'playing' });
  const route = loadServerFunctions.route('/api/drawing-donation/current', {
    getDrawingSidByToken, getCurrentDrawingItemForSid, RENDERER_VERSION: 'current-renderer',
  });
  const request = (value = token) => ({ query: { token: value, renderer: 'current-renderer' } });
  const response = () => ({ setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
  return { ...db, token, sid, query, getDrawingSidByToken, getCurrentDrawingItemForSid, drawingTokenToSid, getBotSettings, route, request, response };
}

test('OBS resolves its saved token and requests playback after a restart without opening the dashboard', async () => {
  const h = coldServer();
  const res = h.response();
  await h.route(h.request(), res);
  expect(res.status).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ item: { id: 'drawing-1', status: 'playing' } }));
  expect(h.query).toHaveBeenCalledWith(
    'select "sid" from "bot_settings" where "settings"->>$1 = $2 limit 1',
    ['drawingDonationViewerToken', h.token],
  );
  expect(h.getCurrentDrawingItemForSid).toHaveBeenCalledWith(h.sid, { knownItemId: undefined, allowMemoryFallback: false });
  expect(h.drawingTokenToSid.get(h.token)).toBe(h.sid);
  expect(h.getBotSettings).not.toHaveBeenCalled();
});

test('each API instance can independently recover the same OBS token with empty runtime caches', async () => {
  for (let i = 0; i < 3; i++) {
    const h = coldServer();
    expect(h.drawingTokenToSid.size).toBe(0);
    await expect(h.getDrawingSidByToken(h.token)).resolves.toBe(h.sid);
    expect(h.query).toHaveBeenCalledTimes(1);
  }
});

test('invalid tokens cannot start playback or prime the runtime cache', async () => {
  const h = coldServer();
  const res = h.response();
  await h.route(h.request("draw_' OR 1=1 --"), res);
  expect(res.status).toHaveBeenCalledWith(404);
  expect(h.getCurrentDrawingItemForSid).not.toHaveBeenCalled();
  expect(h.drawingTokenToSid.size).toBe(0);
  expect(h.query.mock.calls[0][0]).not.toContain('OR 1=1');
  expect(h.query.mock.calls[0][1][1]).toBe("draw_' OR 1=1 --");
});

test('temporary DB errors are not mistaken for missing tokens and recovery needs no dashboard visit', async () => {
  const h = coldServer();
  h.query.mockRejectedValueOnce(new Error('database restarting'));
  const failed = h.response();
  await h.route(h.request(), failed);
  expect(failed.status).toHaveBeenCalledWith(500);
  expect(h.drawingTokenToSid.size).toBe(0);
  expect(h.getCurrentDrawingItemForSid).not.toHaveBeenCalled();
  const recovered = h.response();
  await h.route(h.request(), recovered);
  expect(recovered.status).not.toHaveBeenCalled();
  expect(h.getCurrentDrawingItemForSid).toHaveBeenCalledTimes(1);
});

test.each(['drawingDonationViewerToken', 'videoDonationViewerToken', 'rouletteViewerToken'])(
  'quoted and PostgREST-style JSON keys both parameterize %s', (key) => {
    const h = coldServer();
    for (const column of [`settings->>${key}`, `settings->>'${key}'`]) {
      const values = ['existing'];
      expect(h.buildColumnExpression(column, values)).toBe('"settings"->>$2');
      expect(values).toEqual(['existing', key]);
    }
  },
);

test('JSON path support retains identifier validation and binds quoted keys as data', () => {
  const h = coldServer();
  for (const column of ['settings->>token OR true', 'settings->>token;drop table bot_settings', 'settings->>token--', 'settings->>token.extra']) {
    expect(() => h.buildColumnExpression(column, [])).toThrow('Unsafe column');
  }
  const values = [];
  expect(h.buildColumnExpression("settings->>'key; drop table bot_settings; --'", values)).toBe('"settings"->>$1');
  expect(values).toEqual(['key; drop table bot_settings; --']);
  expect(h.buildColumnExpression('sid', [])).toBe('"sid"');
  expect(h.buildColumnExpression('bot_settings.sid', [])).toBe('"bot_settings"."sid"');
});
