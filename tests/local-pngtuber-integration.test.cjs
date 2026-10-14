const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const { WebSocket, WebSocketServer } = require('ws');

const source = fs.readFileSync(path.join(__dirname, '../local-program/main.cjs'), 'utf8');
const parsed = ts.createSourceFile('main.cjs', source, ts.ScriptTarget.Latest, true);
function functions(names, bindings = {}) {
  const body = names.map((name) => parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(parsed)).join('\n');
  return new Function(...Object.keys(bindings), `${body}\nreturn {${names.join(',')}};`)(...Object.values(bindings));
}

test('PNGtuber jobs use a stable delivery ID, preserve optional duration, and reject stale requests', async () => {
  const calls = [];
  const { processJob } = functions(['processJob'], {
    pngtuberService: { trigger: (...args) => { calls.push(args); return { accepted: true }; } },
    pngtuberStartupError: '', addLog() {},
  });
  const payload = { reactionId: 'happy' };
  assert.deepEqual(await processJob({ id: 'job-1', job_type: 'pngtuber.show', payload }), { accepted: true });
  assert.deepEqual(calls, [[payload, 'job-1']]);
  await processJob({ id: 'job-2', jobType: 'pngtuber.show', payload: { reactionId: 'happy', durationSec: 2.5 } });
  assert.equal(calls[1][0].durationSec, 2.5);
  for (const expiresAt of [Date.now() - 1, 'invalid']) {
    await assert.rejects(processJob({ id: 'late', job_type: 'pngtuber.show', payload: { ...payload, expiresAt } }), /만료/);
  }
  assert.equal(calls.length, 2);
});

test('local startup failures and trigger errors are not falsely acknowledged as success', async () => {
  const unavailable = functions(['processJob'], { pngtuberService: null, pngtuberStartupError: 'startup error', addLog() {} });
  await assert.rejects(unavailable.processJob({ job_type: 'pngtuber.show' }), /startup error/);
  const failed = functions(['processJob'], {
    pngtuberService: { trigger() { throw new Error('queue full'); } }, pngtuberStartupError: '', addLog() {},
  });
  await assert.rejects(failed.processJob({ job_type: 'pngtuber.show', payload: { reactionId: 'happy' } }), /queue full/);
  const rejected = functions(['processJob'], {
    pngtuberService: { trigger: () => ({ ok: false, reason: 'disabled' }) }, pngtuberStartupError: '', addLog() {},
  });
  await assert.rejects(rejected.processJob({ job_type: 'pngtuber.show', payload: { reactionId: 'happy' } }), /짚톡을 켜/);
});

function ipc() {
  const handlers = new Map(), writes = [], calls = [];
  const mainFrame = {}, webContents = { mainFrame };
  const state = { url: 'http://127.0.0.1:17842/overlay?key=fixture', config: { reactions: [{ id: 'happy', durationSec: 5 }] } };
  const service = { state: () => state };
  for (const name of ['save', 'discoverInputs', 'trigger', 'command', 'importAsset']) service[name] = (...args) => { calls.push([name, ...args]); return state; };
  const context = {
    mainWindow: { webContents }, pngtuberService: service, pngtuberStartupError: '',
    ipcMain: { handle: (key, fn) => handlers.set(key, fn) },
    clipboard: { writeText: (text) => writes.push(text) },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['D:/selected.png'] }) },
  };
  vm.runInNewContext(source.slice(source.indexOf('function requirePngTuberService(event)'), source.indexOf('function requireAvatarService(event)')), context);
  return { handlers, writes, calls, context, state, event: { sender: webContents, senderFrame: mainFrame } };
}

test('all PNGtuber IPC routes deny other windows and embedded browser frames', async () => {
  const h = ipc();
  assert.equal(h.handlers.size, 7);
  for (const [name, handler] of h.handlers) {
    await assert.rejects(async () => handler({ ...h.event, sender: {} }), /권한/, name);
    await assert.rejects(async () => handler({ ...h.event, senderFrame: {} }), /권한/, name);
  }
  assert.deepEqual(h.calls, []);
  assert.equal(h.handlers.get('pngtuber:state')(h.event), h.state);
});

test('copy only exposes the read-only URL or a saved reaction variable with validated duration', () => {
  const h = ipc(), copy = h.handlers.get('pngtuber:copy');
  copy(h.event, 'url');
  copy(h.event, 'variable', { reactionId: 'happy' });
  copy(h.event, 'variable', { reactionId: 'happy', durationSec: 1.5 });
  assert.deepEqual(h.writes, [h.state.url, '${pngtuber::happy}', '${pngtuber::happy::1.5}']);
  assert.throws(() => copy(h.event, 'variable', { reactionId: 'missing' }), /저장/);
  assert.throws(() => copy(h.event, 'variable', { reactionId: 'happy', durationSec: Infinity }), /300/);
  assert.throws(() => copy(h.event, 'file', {}), /지원하지/);
});

test('image import uses only native file selection and rechecks the IPC sender after the dialog', async () => {
  const h = ipc(), handler = h.handlers.get('pngtuber:import');
  await handler(h.event, 'D:/untrusted.png');
  assert.deepEqual(h.calls, [['importAsset', 'D:/selected.png']]);
  h.context.dialog.showOpenDialog = async () => ({ canceled: true });
  assert.equal(await handler(h.event), null);
  h.context.dialog.showOpenDialog = async () => {
    h.context.mainWindow = { webContents: {} };
    return { canceled: false, filePaths: ['D:/selected.png'] };
  };
  await assert.rejects(handler(h.event), /권한/);
  assert.equal(h.calls.length, 1);
});

test('preload has only scoped PNGtuber methods and startup is independent of cloud login', () => {
  let exposed;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../local-program/preload.cjs'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (_key, api) => { exposed = api; } }, ipcRenderer: { invoke: (...args) => calls.push(args) } }),
  });
  exposed.pngtuberTrigger({ reactionId: 'happy' });
  exposed.pngtuberState();
  assert.equal(calls[0][0], 'pngtuber:trigger');
  assert.equal(calls[1][0], 'pngtuber:state');
  const startup = source.slice(source.indexOf('app.whenReady().then'));
  assert.ok(startup.indexOf("new PngTuberService(dataPath('pngtuber')") < startup.indexOf('if (config.autoStart && config.token)'));
  assert.match(startup, /eventSubscriptions: \(1 << 16\) \| \(1 << 3\) \| \(1 << 1\)/);
});

test('OBS handshake explicitly subscribes meter events and closes failed authentication sockets', async (t) => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => server.once('listening', resolve));
  const endpoint = `ws://127.0.0.1:${server.address().port}`, identities = [], sockets = [];
  t.after(async () => { for (const ws of server.clients) ws.terminate(); await new Promise((resolve) => server.close(resolve)); });
  const { openObsSocket, sendObsRequest } = functions(['getObsEndpoint', 'makeObsAuth', 'openObsSocket', 'openWs', 'waitObsMessage', 'sendObsRequest'], {
    WebSocket, crypto, DEFAULT_CONFIG: { obsEndpoint: endpoint }, config: { obsEndpoint: endpoint, obsPassword: 'password' },
  });
  server.on('connection', (ws) => {
    sockets.push(ws);
    ws.send(JSON.stringify({ op: 0, d: { authentication: { salt: 'salt', challenge: 'challenge' } } }));
    ws.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      if (message.op === 1) {
        identities.push(message.d);
        if (identities.length === 2) { ws.close(4005, 'Auth failed'); return; }
        ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
      }
      if (message.op === 6) ws.send(JSON.stringify({ op: 7, d: { requestId: message.d.requestId, requestStatus: { result: true }, responseData: { inputMuted: false } } }));
    });
  });
  const connected = await openObsSocket({ eventSubscriptions: 65546 });
  t.after(() => connected.ws.terminate());
  assert.equal(identities[0].eventSubscriptions, 65546);
  assert.ok(identities[0].authentication);
  assert.deepEqual(await sendObsRequest(connected.ws, 'GetInputMute', { inputName: 'Mic' }), { inputMuted: false });
  await assert.rejects(openObsSocket(), /비밀번호/);
  assert.equal(identities[1].eventSubscriptions, undefined);
});
