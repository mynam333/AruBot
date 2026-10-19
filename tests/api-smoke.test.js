const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { execFile } = require('node:child_process');

const script = path.join(__dirname, '..', 'scripts', 'api-smoke.js');
const settingsPath = '/api/bot/settings';
const releaseSha = 'smoke-test-release';
let cwd;
let server;
let baseUrl;
let responses;
let requests;

beforeAll(() => {
  // The real CLI loads dotenv from cwd. Never read the checkout's .env or use
  // inherited API/database credentials when running these loopback fixtures.
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'arubot-api-smoke-'));
});

afterAll(() => fs.rmSync(cwd, { recursive: true, force: true }));

beforeEach(async () => {
  responses = {
    '/api/health': { status: 200, body: { ok: true, dbProvider: 'postgres' } },
    '/api/readiness': { status: 200, body: {
      ok: true, check: 'readiness', dbProvider: 'postgres',
      readiness: { initialBootstrapCompleted: true, shuttingDown: false },
      db: { ok: true },
    } },
    '/api/version': { status: 200, body: { ok: true, releaseSha, dbProvider: 'postgres' } },
    [settingsPath]: { status: 401, body: { error: 'Login required' } },
  };
  requests = [];
  server = http.createServer((req, res) => {
    requests.push({ path: req.url, method: req.method, headers: req.headers });
    const response = responses[req.url] || { status: 404, body: { error: 'not_found' } };
    if (response.hang) return;
    if (response.disconnect) return req.socket.destroy();
    res.writeHead(response.status, { 'Content-Type': 'application/json', ...response.headers });
    res.end(Object.hasOwn(response, 'raw') ? response.raw : JSON.stringify(response.body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function smoke() {
  return new Promise((resolve) => {
    execFile(process.execPath, [script, `--base=${baseUrl}`, '--expect-provider=postgres',
      `--expect-release=${releaseSha}`, '--timeout-ms=1000'], {
      cwd, env: { SystemRoot: process.env.SystemRoot, NODE_ENV: 'test' },
      encoding: 'utf8', timeout: 8000, windowsHide: true,
    }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}

function expectFailure(result, message) {
  expect(result.code).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('[api:smoke] Failed:');
  if (message) expect(result.stderr).toContain(message);
}

test('the CLI accepts the anonymous 401 contract and checks every endpoint without credentials', async () => {
  const result = await smoke();
  expect(result.code).toBe(0);
  expect(result.stderr).toBe('');
  const output = JSON.parse(result.stdout);
  expect(output).toMatchObject({ ok: true, baseUrl, expectedProvider: 'postgres', expectedRelease: releaseSha });
  expect(output.checks).toEqual([
    { path: '/api/health', status: 200, ok: true, passed: true, dbProvider: 'postgres' },
    { path: '/api/readiness', status: 200, ok: true, passed: true, dbProvider: 'postgres' },
    { path: '/api/version', status: 200, ok: true, passed: true, dbProvider: 'postgres' },
    { path: settingsPath, status: 401, ok: false, passed: true, dbProvider: null },
  ]);
  expect(requests.map((request) => request.path)).toEqual(Object.keys(responses));
  for (const request of requests) {
    expect(request.method).toBe('GET');
    expect(request.headers.accept).toBe('application/json');
    expect(request.headers.authorization).toBeUndefined();
    expect(request.headers.cookie).toBeUndefined();
  }
});

test.each([200, 204, 403, 404, 500, 503])('settings HTTP %s fails instead of being treated as an authentication success', async (status) => {
  responses[settingsPath] = { status, body: { error: 'Login required' } };
  expectFailure(await smoke(), `HTTP ${status}`);
});

test.each([
  ['empty JSON object', {}],
  ['missing body', null],
  ['array', []],
  ['string', 'Login required'],
  ['wrong error', { error: 'unauthorized' }],
  ['settings disclosure', { error: 'Login required', settings: { privateValue: 'must-not-be-logged' } }],
  ['null settings field', { error: 'Login required', settings: null }],
])('settings 401 with %s fails without logging the response body', async (_name, body) => {
  responses[settingsPath].body = body;
  const result = await smoke();
  expectFailure(result, 'expected Login required without settings');
  expect(result.stderr).not.toContain('must-not-be-logged');
});

test.each(['', '<html>Login required</html>', '{broken'])('settings 401 with invalid/empty JSON %j fails', async (raw) => {
  responses[settingsPath].raw = raw;
  expectFailure(await smoke(), 'expected Login required without settings');
});

test('anonymous 200 settings disclosure fails without logging private settings', async () => {
  responses[settingsPath] = { status: 200, body: { settings: { privateValue: 'must-not-be-logged' } } };
  const result = await smoke();
  expectFailure(result, 'HTTP 200');
  expect(result.stderr).not.toContain('must-not-be-logged');
});

test('a redirect to a different 401 endpoint cannot satisfy the settings contract', async () => {
  responses[settingsPath] = { status: 302, headers: { Location: '/login' } };
  responses['/login'] = { status: 401, body: { error: 'Login required' } };
  expectFailure(await smoke());
  expect(requests.some((request) => request.path === '/login')).toBe(false);
});

test.each(['/api/health', '/api/readiness', '/api/version'])('%s must still return HTTP success', async (endpoint) => {
  responses[endpoint].status = 503;
  expectFailure(await smoke(), `${endpoint} returned HTTP 503`);
});

test.each(['/api/health', '/api/version'])('%s must still report ok', async (endpoint) => {
  responses[endpoint].body.ok = false;
  expectFailure(await smoke(), endpoint);
});

test.each([
  ['not ok', { ok: false }],
  ['wrong check', { check: 'liveness' }],
  ['bootstrap incomplete', { readiness: { initialBootstrapCompleted: false, shuttingDown: false } }],
  ['shutting down', { readiness: { initialBootstrapCompleted: true, shuttingDown: true } }],
  ['database unavailable', { db: { ok: false } }],
])('readiness still rejects %s', async (_name, patch) => {
  Object.assign(responses['/api/readiness'].body, patch);
  expectFailure(await smoke(), '/api/readiness returned unexpected body');
});

test.each(['older-release', undefined])('a mismatched or missing release (%s) fails', async (release) => {
  responses['/api/version'].body.releaseSha = release;
  expectFailure(await smoke(), `Expected releaseSha=${releaseSha}`);
});

test.each(['supabase', undefined])('a mismatched or missing provider (%s) fails', async (provider) => {
  for (const response of Object.values(responses)) response.body.dbProvider = provider;
  expectFailure(await smoke(), 'Expected dbProvider=postgres');
});

test.each(['hang', 'disconnect'])('a settings request that encounters %s fails', async (failure) => {
  responses[settingsPath][failure] = true;
  expectFailure(await smoke());
});
