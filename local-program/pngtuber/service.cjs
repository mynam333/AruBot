const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');
const { PngTuberStorage } = require('./storage.cjs');
const { PngTuberEngine } = require('./engine.cjs');
const { ObsMonitor } = require('./obs.cjs');
const { assetId, validateConfig, publicConfig, referencedAssets } = require('./schema.cjs');

const MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
class PngTuberService {
  constructor(root, options = {}) {
    this.storage = new PngTuberStorage(root);
    this.engine = new PngTuberEngine(this.storage.config);
    this.engine.error = this.storage.warning;
    this.options = options;
    this.operations = Promise.resolve();
    this.running = false;
    this.requestedRunning = false;
    this.listeners = new Set();
    this.monitor = new ObsMonitor(this.engine, options, () => this.broadcast(), (selected, previous) => {
      void this.serialize(async () => {
        const config = this.storage.config;
        if (config.inputUuid !== previous.uuid || config.inputName !== previous.name) return;
        const saved = this.storage.saveConfig({ inputName: selected.name, inputUuid: selected.uuid });
        this.engine.config = saved;
        this.broadcast();
      }).catch(() => this.monitor.report('Could not save renamed OBS input'));
    });
  }
  serialize(operation) {
    const result = this.operations.then(operation);
    this.operations = result.catch(() => {});
    return result;
  }
  get url() {
    return this.listener?.server.listening ? `${this.origin}/overlay?key=${this.storage.config.key}` : '';
  }
  get origin() { return `http://127.0.0.1:${this.listener?.port || this.storage.config.port}`; }
  get previewUrl() { return this.url ? `${this.url}&preview=1` : ''; }
  assetUrl(id, origin = this.origin) { return `${origin}/assets/${id}?key=${this.storage.config.key}`; }
  state() {
    return {
      config: publicConfig(this.storage.config), runtime: this.engine.snapshot(),
      url: this.url, previewUrl: this.previewUrl,
      assets: this.storage.assets().map((asset) => ({ ...asset, url: this.assetUrl(asset.id) })),
      inputs: structuredClone(this.monitor.inputs),
    };
  }
  frame(preview = false, listener = this.listener) {
    const config = this.storage.config;
    const origin = `http://127.0.0.1:${listener?.port || config.port}`;
    const ids = referencedAssets(config);
    if (this.engine.active) ids.add(this.engine.active.asset);
    return {
      now: Date.now(), config: publicConfig(config), runtime: this.engine.snapshot(preview),
      assets: [...ids].map((id) => ({ id, url: this.assetUrl(id, origin) })),
    };
  }
  async start() {
    return this.serialize(async () => {
      this.requestedRunning = true;
      if (!this.listener) this.listener = await this.prepareListener(this.storage.config.port);
      this.startRuntime();
      return this.state();
    });
  }
  startRuntime() {
    this.running = true;
    if (!this.timer) {
      this.timer = setInterval(() => this.broadcast(), 50);
      this.timer.unref?.();
    }
    if (this.storage.config.enabled) void this.monitor.start();
  }
  async stop() {
    return this.serialize(async () => {
      this.requestedRunning = false;
      this.running = false;
      clearInterval(this.timer);
      this.timer = null;
      this.monitor.stop();
      this.engine.clear();
      for (const listener of [...this.listeners]) await this.closeListener(listener);
      this.listener = null;
      return this.state();
    });
  }
  async save(next) {
    return this.serialize(async () => {
      const previous = this.storage.config;
      const config = validateConfig(next, previous);
      this.storage.ensureAssets(config);
      let prepared;
      if (!this.listener || config.port !== this.listener.port) prepared = await this.prepareListener(config.port);
      try { this.storage.saveConfig(config); }
      catch (error) { if (prepared) await this.closeListener(prepared); throw error; }
      const old = this.listener;
      if (prepared) this.listener = prepared;
      this.engine.setConfig(this.storage.config);
      if (this.requestedRunning && !this.running) this.startRuntime();
      else if (this.running && (previous.enabled !== config.enabled || previous.inputName !== config.inputName || previous.inputUuid !== config.inputUuid))
        void this.monitor.restart();
      if (prepared && old) await this.closeListener(old);
      this.broadcast();
      return this.state();
    });
  }
  async importAsset(filePath) {
    return this.serialize(async () => {
      const importedAssetId = await this.storage.importAsset(filePath);
      this.broadcast();
      return { ...this.state(), importedAssetId };
    });
  }
  async discoverInputs() {
    try { await this.monitor.discover(); }
    catch {
      const message = 'Could not discover OBS inputs; check OBS connection settings';
      this.monitor.report(message);
      throw new Error(message);
    }
    return this.state();
  }
  trigger(payload, deliveryId) {
    const result = this.engine.trigger(payload, deliveryId);
    this.broadcast();
    return result;
  }
  command(command) {
    if (command !== 'clear') throw new Error('Unknown PNGTuber command');
    this.engine.clear();
    this.broadcast();
    return this.state();
  }
  async reconnect() {
    this.monitor.stop();
    if (this.running && this.storage.config.enabled) await this.monitor.start();
    return this.state();
  }
  authorized(req, url, listener) {
    const expectedHost = `127.0.0.1:${listener.port}`;
    const supplied = Buffer.from(url.searchParams.get('key') || '');
    const expected = Buffer.from(this.storage.config.key);
    return req.method === 'GET' && req.headers.host === expectedHost &&
      (!req.headers.origin || req.headers.origin === `http://${expectedHost}`) &&
      supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  }
  async prepareListener(port) {
    const listener = { port };
    const server = listener.server = http.createServer((req, res) => this.handle(req, res, listener));
    server.requestTimeout = server.headersTimeout = 10000;
    server.keepAliveTimeout = 1000;
    server.maxConnections = 40;
    const wss = listener.wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
    server.on('upgrade', (req, socket, head) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (!this.authorized(req, url, listener) || url.pathname !== '/ws' || wss.clients.size >= 8) return socket.destroy();
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
          ws.preview = url.searchParams.get('preview') === '1';
          ws.on('error', () => ws.terminate());
          ws.on('message', () => ws.close(1008, 'Read-only overlay'));
          ws.send(JSON.stringify(this.frame(ws.preview, listener)));
        });
      } catch { socket.destroy(); }
    });
    try {
      await new Promise((resolve, reject) => {
        const fail = () => reject(new Error('PNGTuber port is unavailable; choose another port'));
        server.once('error', fail);
        server.listen(port, '127.0.0.1', () => { server.off('error', fail); resolve(); });
      });
    } catch (error) { await this.closeListener(listener); throw error; }
    server.on('error', () => this.monitor.report('PNGTuber output server failed'));
    this.listeners.add(listener);
    return listener;
  }
  async closeListener(listener) {
    for (const ws of listener.wss.clients) ws.terminate();
    listener.wss.close();
    if (listener.server.listening) {
      await new Promise((resolve) => { listener.server.close(resolve); listener.server.closeAllConnections?.(); });
    }
    this.listeners.delete(listener);
  }
  broadcast() {
    this.engine.tick();
    for (const listener of this.listeners) {
      if (!listener.wss.clients.size) continue;
      const frames = new Map();
      for (const ws of listener.wss.clients) {
        if (ws.bufferedAmount > 256 * 1024) ws.terminate();
        else if (ws.readyState === 1) {
          if (!frames.has(ws.preview)) frames.set(ws.preview, JSON.stringify(this.frame(ws.preview, listener)));
          ws.send(frames.get(ws.preview));
        }
      }
    }
  }
  handle(req, res, listener) {
    const fail = (status) => { res.writeHead(status, { 'Cache-Control': 'no-store' }); res.end(); };
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (!this.authorized(req, url, listener)) return fail(403);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'");
      const files = {
        '/overlay': ['overlay.html', 'text/html; charset=utf-8'],
        '/overlay.js': ['overlay.js', 'text/javascript; charset=utf-8'],
        '/overlay.css': ['overlay.css', 'text/css; charset=utf-8'],
      };
      if (Object.hasOwn(files, url.pathname)) {
        const [file, mime] = files[url.pathname];
        let body = fs.readFileSync(path.join(__dirname, file));
        if (file === 'overlay.html') body = Buffer.from(body.toString().replaceAll('__KEY__', this.storage.config.key));
        res.setHeader('Content-Type', mime);
        return res.end(body);
      }
      if (url.pathname === '/state') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(JSON.stringify(this.frame(url.searchParams.get('preview') === '1', listener)));
      }
      const id = url.pathname.slice('/assets/'.length);
      if (url.pathname.startsWith('/assets/') && assetId(id) && this.storage.hasAsset(id)) {
        res.setHeader('Content-Type', MIME[id.split('.').pop()]);
        const stream = fs.createReadStream(this.storage.assetPath(id));
        stream.on('error', () => res.destroy());
        return stream.pipe(res);
      }
      return fail(404);
    } catch { return fail(400); }
  }
}
module.exports = { PngTuberService };
