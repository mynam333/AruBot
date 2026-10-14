const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { once } = require('node:events');
const { WebSocket, WebSocketServer } = require('ws');
const sharp = require('sharp');
const { PngTuberService } = require('../local-program/pngtuber/service.cjs');
const { PngTuberStorage } = require('../local-program/pngtuber/storage.cjs');

const listen = (server, port = 0) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => resolve(server.address().port));
});
const close = (server) => new Promise((resolve) => server.close(resolve));
async function freePort() { const server = net.createServer(); const port = await listen(server); await close(server); return port; }
async function until(check, timeout = 4000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('Timed out waiting for state');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function fixture(t, enabled = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aru-pngtuber-'));
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const obs = { opens: 0, fail: false, inputs: [{ inputName: 'Mic', inputUuid: 'mic' }, { inputName: 'Camera', inputUuid: 'video' }], muted: false, requests: [] };
  server.on('connection', (ws) => ws.on('message', (raw) => {
    const message = JSON.parse(String(raw));
    const { requestType, requestData, requestId } = message.d;
    obs.requests.push({ requestType, requestData });
    const item = obs.inputs.find((i) => requestData.inputUuid ? i.inputUuid === requestData.inputUuid : i.inputName === requestData.inputName);
    const valid = requestType === 'GetInputList' || item && item.inputName !== 'Camera';
    ws.send(JSON.stringify({ op: 7, d: { requestId, requestStatus: { result: !!valid }, responseData:
      requestType === 'GetInputList' ? { inputs: obs.inputs } : { inputMuted: obs.muted } } }));
  }));
  let id = 0;
  const options = {
    async openObs() {
      obs.opens++;
      if (obs.fail) throw new Error('private OBS password or local path');
      const endpoint = `ws://127.0.0.1:${server.address().port}`;
      const ws = new WebSocket(endpoint);
      await once(ws, 'open');
      return { ws, endpoint };
    },
    requestObs(ws, type, data = {}) {
      assert.equal(ws.readyState, WebSocket.OPEN);
      const requestId = String(++id);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { ws.off('message', receive); reject(new Error('timeout')); }, 1000);
        const receive = (raw) => {
          const message = JSON.parse(String(raw));
          if (message.op !== 7 || message.d.requestId !== requestId) return;
          clearTimeout(timer);
          ws.off('message', receive);
          if (!message.d.requestStatus.result) reject(new Error('Not an audio input'));
          else resolve(message.d.responseData);
        };
        ws.on('message', receive);
        ws.send(JSON.stringify({ op: 6, d: { requestId, requestType: type, requestData: data } }));
      });
    },
  };
  const service = new PngTuberService(path.join(root, 'storage'), options);
  t.after(async () => {
    await service.stop();
    for (const client of server.clients) client.terminate();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  await service.save({ port: await freePort(), enabled, inputName: 'Mic', inputUuid: 'mic' });
  const event = (eventType, eventData) => {
    for (const client of server.clients) client.send(JSON.stringify({ op: 5, d: { eventType, eventData } }));
  };
  async function image(name = 'closed.png', color = '#00ff0080') {
    const file = path.join(root, name);
    fs.writeFileSync(file, await sharp({ create: { width: 8, height: 8, channels: 4, background: color } }).png().toBuffer());
    return service.importAsset(file);
  }
  return { service, root, options, obs, server, event, image };
}
async function socket(url) {
  const parsed = new URL(url); parsed.protocol = 'ws:'; parsed.pathname = '/ws';
  const ws = new WebSocket(parsed);
  const frame = once(ws, 'message');
  await once(ws, 'open');
  return { ws, frame: JSON.parse(String((await frame)[0])) };
}

test('disabled discovery uses a temporary socket and filters by actual audio capability', async (t) => {
  const { service, obs, server } = await fixture(t, false);
  await service.start();
  assert.equal(obs.opens, 0);
  const state = await service.discoverInputs();
  assert.deepEqual(state.inputs, [{ name: 'Mic', uuid: 'mic' }]);
  await until(() => server.clients.size === 0);
  assert.equal(state.runtime.connected, false);
  obs.fail = true;
  await assert.rejects(service.discoverInputs(), /Could not discover OBS inputs/);
  assert.doesNotMatch(service.state().runtime.error, /private|password/);
});

test('real OBS event socket initializes mute, matches UUID, closes stale meters and reconnects', async (t) => {
  const { service, obs, event, server } = await fixture(t);
  obs.muted = true;
  await service.start();
  await until(() => service.state().runtime.sourceAvailable);
  assert.equal(service.state().runtime.muted, true);
  event('InputMuteStateChanged', { inputUuid: 'mic', inputName: 'Mic', inputMuted: false });
  await until(() => !service.state().runtime.muted);
  event('InputVolumeMeters', { inputs: [{ inputUuid: 'wrong', inputName: 'Mic', inputLevelsMul: [[0, 1, 1]] }] });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(service.state().runtime.mouthOpen, false);
  event('InputVolumeMeters', { inputs: [{ inputUuid: 'mic', inputName: 'Renamed', inputLevelsMul: [[0, 0.1, 1]] }] });
  await until(() => service.state().runtime.mouthOpen);
  await until(() => !service.state().runtime.mouthOpen, 1500);
  for (const client of server.clients) client.terminate();
  await until(() => !service.state().runtime.connected);
  await until(() => service.state().runtime.sourceAvailable && obs.opens >= 2);
  assert.equal(service.state().runtime.mouthOpen, false);
});

test('legacy OBS names, rename, removal and collection switching reset and recover safely', async (t) => {
  const { service, obs, event } = await fixture(t);
  obs.inputs = [{ inputName: 'Mic' }];
  await service.start();
  await until(() => service.state().runtime.sourceAvailable);
  assert.ok(obs.requests.some((r) => r.requestType === 'GetInputMute' && r.requestData.inputName === 'Mic'));
  obs.inputs = [{ inputName: 'New Mic' }];
  event('InputNameChanged', { oldInputName: 'Mic', inputName: 'New Mic' });
  await until(() => service.state().config.inputName === 'New Mic');
  event('CurrentSceneCollectionChanging', {});
  await until(() => !service.state().runtime.sourceAvailable);
  const count = obs.requests.length;
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(obs.requests.length, count);
  event('CurrentSceneCollectionChanged', {});
  await until(() => service.state().runtime.sourceAvailable);
  obs.inputs = [];
  event('InputRemoved', { inputName: 'New Mic' });
  await until(() => !service.state().runtime.sourceAvailable);
  obs.inputs = [{ inputName: 'New Mic' }];
  event('InputCreated', { inputName: 'New Mic' });
  await until(() => service.state().runtime.sourceAvailable);
});

test('saved images, private stable key, read-only HTTP/WS and disabled preview', async (t) => {
  const { service, image, root } = await fixture(t, false);
  const imported = await image();
  assert.ok(imported.assets.some((a) => a.id === imported.importedAssetId && a.name === 'closed.png'));
  await service.save({ closedAsset: imported.importedAssetId, key: 'replace' });
  await service.start();
  const state = service.state();
  assert.equal(state.config.key, undefined);
  assert.equal(new PngTuberStorage(service.storage.root).config.key, service.storage.config.key);
  assert.equal((await fetch(state.url)).status, 200);
  assert.equal((await fetch(state.url, { method: 'POST' })).status, 403);
  assert.equal((await fetch(state.url, { headers: { Origin: 'https://evil.test' } })).status, 403);
  const foreignHost = await new Promise((resolve, reject) => {
    http.get(state.url, { headers: { Host: 'evil.test' } }, (response) => {
      response.resume(); resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(foreignHost, 403);
  assert.equal((await fetch(state.url.replace(/key=.*/, 'key=invalid'))).status, 403);
  const url = new URL(state.previewUrl); url.pathname = '/state';
  const frame = await (await fetch(url)).json();
  assert.equal(frame.runtime.asset, imported.importedAssetId);
  assert.equal(frame.config.key, undefined);
  assert.equal(JSON.stringify(frame).includes(root), false);
  assert.equal((await fetch(state.assets[0].url)).headers.get('content-type'), 'image/png');
  const { ws, frame: initial } = await socket(state.previewUrl);
  assert.equal(initial.runtime.asset, imported.importedAssetId);
  const closed = once(ws, 'close');
  ws.send(JSON.stringify({ enabled: true }));
  assert.equal((await closed)[0], 1008);
  assert.equal(service.state().config.enabled, false);
});

test('port conflict and failed disk save preserve existing listener and saved config', async (t) => {
  const { service } = await fixture(t);
  await service.start();
  const before = fs.readFileSync(service.storage.file), oldUrl = service.url;
  const occupied = net.createServer(); const port = await listen(occupied);
  t.after(() => close(occupied));
  await assert.rejects(service.save({ port }), /port/);
  assert.deepEqual(fs.readFileSync(service.storage.file), before);
  assert.equal(service.url, oldUrl);
  const save = service.storage.saveConfig;
  service.storage.saveConfig = () => { throw new Error('injected write failure'); };
  const candidate = await freePort();
  await assert.rejects(service.save({ port: candidate }), /injected/);
  service.storage.saveConfig = save;
  assert.equal((await fetch(oldUrl)).status, 200);
  assert.deepEqual(fs.readFileSync(service.storage.file), before);
  const probe = net.createServer(); await listen(probe, candidate); await close(probe);
});

test('initial bind conflict recovers fully when saving a new port', async (t) => {
  const { service } = await fixture(t);
  await service.stop();
  const occupied = net.createServer(); const port = await listen(occupied);
  t.after(() => close(occupied));
  service.storage.saveConfig({ port });
  service.engine.setConfig(service.storage.config);
  await assert.rejects(service.start(), /port/);
  assert.equal(service.running, false);
  await service.save({ port: await freePort() });
  await until(() => service.state().runtime.sourceAvailable);
  assert.equal(service.running, true);
  assert.ok(service.timer);
  const { ws } = await socket(service.url);
  const frame = once(ws, 'message');
  assert.ok(JSON.parse(String((await frame)[0])).runtime.connected);
  ws.terminate();
});

test('reaction delivery is idempotent while queued and expires during OBS disconnect', async (t) => {
  const { service, image, server } = await fixture(t);
  const { importedAssetId } = await image();
  await service.save({ closedAsset: importedAssetId, reactions: [{ id: 'r', name: 'Reaction', asset: importedAssetId, durationSec: 0.1 }] });
  await service.start();
  await until(() => service.state().runtime.sourceAvailable);
  assert.equal(service.trigger({ reactionId: 'r' }, 'a').ok, true);
  service.trigger({ reactionId: 'r' }, 'b');
  assert.equal(service.trigger({ reactionId: 'r' }, 'b').duplicate, true);
  assert.equal(service.state().runtime.queued, 1);
  for (const client of server.clients) client.terminate();
  await until(() => !service.state().runtime.connected);
  assert.equal(service.state().runtime.mode, 'reaction');
  await until(() => service.state().runtime.mode === 'closed');
  assert.equal(service.state().runtime.mouthOpen, false);
  assert.equal(service.command('clear').runtime.queued, 0);
});
