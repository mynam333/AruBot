const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const ts = require('typescript');
const { WebSocket } = require('ws');
const { createFxAssetServer, resolveFxAssetUrl, listFxAssetIds } = require('../local-program/fx-assets.cjs');

const origin = 'https://arubot.yuaru.com';
const bytes = Buffer.from('0123456789');
let root;
let folder;
let service;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'arubot-fx-test-'));
  folder = path.join(root, 'media');
  fs.mkdirSync(folder);
  for (const name of ['한글 # 그림.png', 'clip.webm', 'sound.mp3', 'secret.txt']) fs.writeFileSync(path.join(folder, name), bytes);
  service = createFxAssetServer({ getFolder: () => folder, getAllowedOrigins: () => [origin] });
});

afterEach(async () => {
  await service.close();
  jest.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

test('the very first and concurrent plays wait for a listening HTTP server, never file URLs', async () => {
  const urls = await Promise.all(Array.from({ length: 12 }, () => service.getAssetUrl('한글 # 그림.png')));
  expect(new Set(urls).size).toBe(1);
  const url = new URL(urls[0]);
  expect(url.protocol).toBe('http:');
  expect(url.hostname).toBe('127.0.0.1');
  expect(Number(url.port)).toBeGreaterThan(0);
  const response = await fetch(url);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/png');
  expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
});

test.each([['clip.webm', 'video/webm'], ['sound.mp3', 'audio/mpeg']])('serves %s with content type, length, HEAD and seekable ranges', async (name, mime) => {
  const url = await service.getAssetUrl(name);
  const head = await fetch(url, { method: 'HEAD', headers: { Origin: origin } });
  expect(head.status).toBe(200);
  expect(head.headers.get('content-type')).toBe(mime);
  expect(head.headers.get('content-length')).toBe('10');
  expect(head.headers.get('accept-ranges')).toBe('bytes');
  expect(head.headers.get('access-control-allow-origin')).toBe(origin);
  expect(await head.text()).toBe('');
  const range = await fetch(url, { headers: { Range: 'bytes=2-5' } });
  expect(range.status).toBe(206);
  expect(range.headers.get('content-range')).toBe('bytes 2-5/10');
  expect(range.headers.get('content-length')).toBe('4');
  expect(await range.text()).toBe('2345');
});

test.each([['bytes=7-', '789'], ['bytes=-3', '789'], ['bytes=8-9999', '89'], ['bytes=-9999', '0123456789']])('handles media range %s', async (range, expected) => {
  const response = await fetch(await service.getAssetUrl('clip.webm'), { headers: { Range: range } });
  expect(response.status).toBe(206);
  expect(await response.text()).toBe(expected);
});

test.each(['bytes=999-', 'bytes=9-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,5-6'])('rejects invalid range %s without sending the full file', async (range) => {
  const response = await fetch(await service.getAssetUrl('clip.webm'), { headers: { Range: range } });
  expect(response.status).toBe(416);
  expect(response.headers.get('content-range')).toBe('bytes */10');
  expect(await response.text()).toBe('');
});

test('supports authenticated CORS/private-network preflights without allowing arbitrary websites', async () => {
  const url = await service.getAssetUrl('clip.webm');
  const response = await fetch(url, { method: 'OPTIONS', headers: {
    Origin: origin, 'Access-Control-Request-Method': 'GET',
    'Access-Control-Request-Headers': 'Range', 'Access-Control-Request-Private-Network': 'true',
  } });
  expect(response.status).toBe(204);
  expect(response.headers.get('access-control-allow-origin')).toBe(origin);
  expect(response.headers.get('access-control-allow-private-network')).toBe('true');
  expect(response.headers.get('access-control-allow-headers')).toBe('Range');
  const blocked = await fetch(url, { headers: { Origin: 'https://unrelated.example' } });
  expect(blocked.status).toBe(403);
  expect(blocked.headers.get('access-control-allow-origin')).toBeNull();
});

test('binds capability tokens to one file and rejects absent credentials or DNS rebinding', async () => {
  const valid = new URL(await service.getAssetUrl('clip.webm'));
  const switched = new URL(valid);
  switched.searchParams.set('id', 'sound.mp3');
  expect((await fetch(switched)).status).toBe(404);
  switched.searchParams.delete('k');
  expect((await fetch(switched)).status).toBe(404);
  const status = await new Promise((resolve, reject) => {
    const request = http.get(valid, { headers: { Host: 'attacker.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
    request.on('error', reject);
  });
  expect(status).toBe(403);
  expect((await fetch(valid, { method: 'POST' })).status).toBe(405);
});

test.each(['../clip.webm', '..\\clip.webm', 'secret.txt', 'missing.png', 'C:\\private\\image.png', 'sound.mp3:secret'])('does not expose invalid or unregistered media: %s', async (id) => {
  await expect(service.getAssetUrl(id)).rejects.toThrow('FX 파일을 찾을 수 없습니다');
});

test('does not follow a directory junction outside the configured media folder', async () => {
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.png'), bytes);
  fs.symlinkSync(outside, path.join(folder, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(service.getAssetUrl('linked/secret.png')).rejects.toThrow();
  expect([...listFxAssetIds(folder)]).not.toContain('linked/secret.png');
});

test('recursive discovery and playback preserve duplicate filenames, Unicode paths, and nested ranges', async () => {
  fs.mkdirSync(path.join(folder, '효과 #1', '깊은 폴더'), { recursive: true });
  fs.writeFileSync(path.join(folder, '효과 #1', 'clip.webm'), 'nested');
  fs.writeFileSync(path.join(folder, '효과 #1', '깊은 폴더', 'sound.mp3'), bytes);
  const ids = [...listFxAssetIds(folder)];
  expect(ids).toEqual(expect.arrayContaining(['clip.webm', '효과 #1/clip.webm', '효과 #1/깊은 폴더/sound.mp3']));
  expect(ids).not.toContain('secret.txt');
  const nested = await service.getAssetUrl('효과 #1\\clip.webm');
  expect(new URL(nested).searchParams.get('id')).toBe('효과 #1/clip.webm');
  expect(await (await fetch(nested)).text()).toBe('nested');
  expect(await (await fetch(await service.getAssetUrl('clip.webm'))).text()).toBe('0123456789');
  const sound = await service.getAssetUrl('효과 #1/깊은 폴더/sound.mp3');
  expect(await (await fetch(sound, { headers: { Range: 'bytes=2-5' } })).text()).toBe('2345');
  for (const invalid of ['효과 #1/../clip.webm', '/clip.webm', '효과 #1//clip.webm'])
    await expect(service.getAssetUrl(invalid)).rejects.toThrow();
  const refreshed = await resolveFxAssetUrl({ assetUrl: nested }, service.getAssetUrl);
  expect(new URL(refreshed).searchParams.get('id')).toBe('효과 #1/clip.webm');
});

test('FX execution retains its relative path through the local job and cloud push', async () => {
  fs.mkdirSync(path.join(folder, 'nested'));
  fs.writeFileSync(path.join(folder, 'nested', 'clip.webm'), 'nested-content');
  const apiFetch = jest.fn(async (_url, options) => {
    const { payload } = JSON.parse(options.body);
    expect(payload.assetId).toBe('nested/clip.webm');
    expect(await (await fetch(payload.assetUrl)).text()).toBe('nested-content');
    return { sent: 1 };
  });
  await expect(loadProcessJob(apiFetch)({ job_type: 'fx.play', payload: { assetId: 'nested/clip.webm' } })).resolves.toMatchObject({ ok: true });
});

test('folder changes invalidate previous capabilities and deleted files return 404', async () => {
  const old = await service.getAssetUrl('clip.webm');
  folder = path.join(root, 'replacement');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'clip.webm'), bytes);
  expect((await fetch(old)).status).toBe(404);
  const fresh = await service.getAssetUrl('clip.webm');
  expect((await fetch(fresh)).status).toBe(200);
  fs.unlinkSync(path.join(folder, 'clip.webm'));
  expect((await fetch(fresh)).status).toBe(404);
});

test('recovers after a startup failure instead of caching a broken port', async () => {
  const create = http.createServer;
  jest.spyOn(http, 'createServer').mockImplementationOnce((handler) => {
    const listener = create(handler);
    jest.spyOn(listener, 'listen').mockImplementation(() => {
      queueMicrotask(() => listener.emit('error', new Error('listen failed')));
      return listener;
    });
    return listener;
  });
  await expect(service.getAssetUrl('clip.webm')).rejects.toThrow('listen failed');
  const response = await fetch(await service.getAssetUrl('clip.webm'));
  expect(response.status).toBe(200);
});

test('local URLs can be refreshed after shutdown, and old file URLs never reach the overlay', async () => {
  const first = await service.getAssetUrl('clip.webm');
  await service.close();
  const fresh = await resolveFxAssetUrl({ assetUrl: first }, service.getAssetUrl);
  expect((await fetch(fresh)).status).toBe(200);
  const fromFile = await resolveFxAssetUrl({ assetId: 'clip.webm', assetUrl: 'file:///C:/obsolete/clip.webm' }, service.getAssetUrl);
  expect(new URL(fromFile).protocol).toBe('http:');
  expect((await fetch(fromFile)).status).toBe(200);
});

test('preserves remote HTTP media and YouTube without accessing the local filesystem', async () => {
  const getAssetUrl = jest.fn();
  expect(await resolveFxAssetUrl({ assetUrl: 'https://media.example/video.mp4' }, getAssetUrl)).toBe('https://media.example/video.mp4');
  expect(await resolveFxAssetUrl({ youtubeUrl: 'https://youtube.com/watch?v=test' }, getAssetUrl)).toBe('');
  await expect(resolveFxAssetUrl({ assetUrl: 'javascript:alert(1)' }, getAssetUrl)).rejects.toThrow();
  expect(getAssetUrl).not.toHaveBeenCalled();
});

function loadProcessJob(apiFetch) {
  const filename = path.join(__dirname, '../local-program/main.cjs');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'processJob');
  return new Function('path', 'resolveFxAssetUrl', 'fxAssetServer', 'apiFetch', 'addLog', 'crypto', `return (${declaration.getText(source)});`)(
    path, resolveFxAssetUrl, service, apiFetch, () => {}, require('crypto'),
  );
}

test.each(['fx.play', 'blueprint.fx', 'sound.play', 'blueprint.sound'])('%s job delivers a usable HTTP file on its first execution', async (type) => {
  const apiFetch = jest.fn(async (endpoint, options) => {
    expect(endpoint).toBe('/api/automations/local-agent/fx/push');
    const { payload } = JSON.parse(options.body);
    expect(payload.positionMode).toBe('random');
    const response = await fetch(payload.assetUrl);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('0123456789');
    return { ok: true, sent: 1 };
  });
  await expect(loadProcessJob(apiFetch)({ job_type: type, payload: { assetId: 'clip.webm', positionMode: 'random' } })).resolves.toMatchObject({ ok: true, sent: 1 });
  expect(apiFetch).toHaveBeenCalledTimes(1);
});

test('jobs report a missing file or disconnected overlay instead of false success', async () => {
  const apiFetch = jest.fn(async () => ({ sent: 0 }));
  const execute = loadProcessJob(apiFetch);
  await expect(execute({ job_type: 'fx.play', payload: { assetId: 'gone.png' } })).rejects.toThrow('FX 파일을 찾을 수 없습니다');
  expect(apiFetch).not.toHaveBeenCalled();
  await expect(execute({ job_type: 'fx.play', payload: { assetId: 'clip.webm' } })).rejects.toThrow('연결된 FX 오버레이가 없습니다');
});

test('local viewer serves the shared renderer, protects its bootstrap, and keeps its URL after restart', async () => {
  const directory = path.join(root, 'viewer');
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'viewer.js'), '/* viewer */');
  fs.writeFileSync(path.join(directory, 'viewer.css'), 'body{margin:0}');
  let port = 0;
  const settings = {
    getFolder: () => folder, viewerDirectory: directory,
    getViewerKey: () => 'a'.repeat(64), getPort: () => port, onListening: (value) => { port = value; },
    getViewerConfig: async () => ({ token: 'fx_test', apiBase: 'https://api.example' }),
  };
  service = createFxAssetServer(settings);
  const url = await service.getViewerUrl();
  const page = await fetch(url);
  expect(await page.text()).toContain('AruBot Local FX');
  expect(page.headers.get('referrer-policy')).toBe('no-referrer');
  const config = new URL(url); config.pathname = '/fx-viewer/config';
  expect(await (await fetch(config)).json()).toEqual({ token: 'fx_test', apiBase: 'https://api.example' });
  expect((await fetch(config, { headers: { Origin: 'https://unrelated.example' } })).status).toBe(403);
  const bad = new URL(config); bad.search = '';
  expect((await fetch(bad)).status).toBe(403);
  const script = new URL(url); script.pathname = '/fx-viewer/script';
  expect(await (await fetch(script)).text()).toBe('/* viewer */');
  await service.close();
  service = createFxAssetServer(settings);
  expect(await service.getViewerUrl()).toBe(url);
});

test('local viewer bootstrap failures return a retryable error without leaking credentials', async () => {
  service = createFxAssetServer({
    getFolder: () => folder, viewerDirectory: root, getViewerKey: () => 'b'.repeat(64),
    getViewerConfig: async () => { throw new Error('secret backend token'); },
  });
  const port = await service.start();
  const response = await fetch(`http://127.0.0.1:${port}/fx-viewer/config?k=${'b'.repeat(64)}`);
  expect(response.status).toBe(503);
  expect(await response.text()).toBe('{}');
});

test('viewer token route only uses the authenticated local agent owner', async () => {
  const load = require('./helpers/load-server-functions.cjs');
  const getFxViewerToken = jest.fn(async () => 'fx_owned');
  const handler = load.route('/api/automations/local-agent/fx/viewer', { getFxViewerToken }, 'get');
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis() };
  await handler({ query: { ownerUserId: 'attacker' } }, res);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(getFxViewerToken).not.toHaveBeenCalled();
  await handler({ automationLocalAgent: { ownerUserId: 'owner' }, query: { ownerUserId: 'attacker' } }, res);
  expect(getFxViewerToken).toHaveBeenCalledWith('owner');
  expect(res.json).toHaveBeenLastCalledWith({ token: 'fx_owned' });
  const server = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  expect(server).toContain("app.get('/api/automations/local-agent/fx/viewer', requireAutomationLocalAgent");
});

test('versioned media is cached and editing a local file changes its cache key', async () => {
  const first = await service.getAssetUrl('clip.webm');
  expect((await fetch(first)).headers.get('cache-control')).toBe('private, max-age=3600');
  fs.writeFileSync(path.join(folder, 'clip.webm'), Buffer.from('replacement'));
  const next = await service.getAssetUrl('clip.webm');
  expect(next).not.toBe(first);
  expect(await (await fetch(next)).text()).toBe('replacement');
  expect((await fetch(first)).headers.get('cache-control')).toBe('no-store');
});

test('local viewer gets authenticated preloading, immediate FX and heartbeat replies', async () => {
  fs.mkdirSync(path.join(folder, 'nested'));
  fs.writeFileSync(path.join(folder, 'nested', 'sound.mp3'), bytes);
  service = createFxAssetServer({ getFolder: () => folder, getViewerKey: () => 'a'.repeat(64) });
  const port = await service.start();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/fx-viewer/ws?k=${'a'.repeat(64)}`, { origin: `http://127.0.0.1:${port}` });
  const messages = [];
  const preload = new Promise((resolve) => socket.on('message', (raw) => {
    const event = JSON.parse(String(raw)); messages.push(event);
    if (event.type === 'fx:preload') resolve(event);
  }));
  try {
    const manifest = await preload;
    expect(manifest.assets.map((asset) => asset.kind).sort()).toEqual(['image', 'sound', 'sound']);
    const nested = manifest.assets.find((asset) => new URL(asset.assetUrl).searchParams.get('id') === 'nested/sound.mp3');
    expect(nested).toBeDefined();
    expect(await (await fetch(nested.assetUrl)).text()).toBe('0123456789');
    expect(manifest.assets.every((asset) => asset.assetUrl.startsWith(`http://127.0.0.1:${port}/fx-asset`))).toBe(true);
    const received = new Promise((resolve) => socket.once('message', (raw) => resolve(JSON.parse(String(raw)))));
    expect(service.publish('fx:play', { deliveryId: 'one', positionMode: 'random' })).toBe(1);
    expect(await received).toEqual({ type: 'fx:play', payload: { deliveryId: 'one', positionMode: 'random' } });
    const pong = new Promise((resolve) => socket.once('message', (raw) => resolve(JSON.parse(String(raw)))));
    socket.send('{"type":"ping"}');
    expect(await pong).toEqual({ type: 'pong' });
  } finally { socket.terminate(); }
});

test.each(['bad-key', 'foreign-origin'])('local WebSocket rejects %s', async (reason) => {
  service = createFxAssetServer({ getFolder: () => folder, getViewerKey: () => 'a'.repeat(64) });
  const port = await service.start();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/fx-viewer/ws?k=${reason === 'bad-key' ? 'b'.repeat(64) : 'a'.repeat(64)}`, {
    origin: reason === 'foreign-origin' ? 'https://unrelated.example' : `http://127.0.0.1:${port}`,
  });
  await expect(new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); })).rejects.toThrow('403');
  socket.terminate();
});

test('local FX delivery does not wait for the cloud push and preserves the shared delivery ID', async () => {
  const publish = jest.spyOn(service, 'publish').mockReturnValue(1);
  let resolve;
  const remote = new Promise((done) => { resolve = done; });
  const apiFetch = jest.fn(() => remote);
  try {
    const result = await loadProcessJob(apiFetch)({ id: '123', job_type: 'fx.play', payload: { assetId: 'clip.webm', positionMode: 'random' } });
    expect(result).toMatchObject({ ok: true, delivery: 'local', sent: 1 });
    expect(publish).toHaveBeenCalledWith('fx:play', expect.objectContaining({ deliveryId: 'fx_job_123', positionMode: 'random' }));
    expect(JSON.parse(apiFetch.mock.calls[0][1].body).payload.deliveryId).toBe('fx_job_123');
  } finally { resolve({ sent: 1 }); }
});
