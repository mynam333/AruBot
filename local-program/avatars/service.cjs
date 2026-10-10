const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { AvatarStorage } = require('./storage.cjs');
const { AvatarEngine } = require('./engine.cjs');
const { assetId } = require('./schema.cjs');

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

class AvatarService {
  constructor(root, options = {}) {
    this.storage = new AvatarStorage(root);
    this.engine = new AvatarEngine(
      this.storage.config,
      this.storage.profiles,
      options,
    );
    this.lastError = this.storage.warning;
    this.connected = false;
    this.lastEventAt = 0;
    this.server = null;
    this.timer = null;
    this.onError = options.onError || (() => {});
    this.frames = 0;
  }
  get url() {
    return this.server?.listening
      ? `http://127.0.0.1:${this.port}/overlay?key=${this.storage.config.key}`
      : '';
  }
  auth(url) {
    const key = Buffer.from(url.searchParams.get('key') || '');
    const expected = Buffer.from(this.storage.config.key);
    return (
      key.length === expected.length && crypto.timingSafeEqual(key, expected)
    );
  }
  async start() {
    if (this.server?.listening) return;
    const server = http.createServer((req, res) => this.handle(req, res));
    this.server = server;
    server.requestTimeout = 10000;
    server.headersTimeout = 10000;
    server.maxConnections = 40;
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: 1024,
      perMessageDeflate: false,
    });
    server.on('upgrade', (req, socket, head) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        const expectedOrigin = `http://127.0.0.1:${this.port}`;
        if (
          req.headers.host !== `127.0.0.1:${this.port}` ||
          (req.headers.origin && req.headers.origin !== expectedOrigin) ||
          url.pathname !== '/ws' ||
          !this.auth(url) ||
          this.wss.clients.size >= 8
        ) {
          socket.destroy();
          return;
        }
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          ws.on('error', () => ws.terminate());
          ws.send(JSON.stringify(this.engine.snapshot()));
        });
      } catch {
        socket.destroy();
      }
    });
    await new Promise((resolve, reject) => {
      const fail = (error) => {
        this.lastError =
          error.code === 'EADDRINUSE'
            ? '아바타 포트를 다른 프로그램이 사용 중입니다. 포트를 변경해 주세요.'
            : error.message;
        reject(new Error(this.lastError));
      };
      server.once('error', fail);
      server.listen(this.storage.config.port, '127.0.0.1', () => {
        server.off('error', fail);
        this.port = server.address().port;
        resolve();
      });
    });
    server.on('error', (error) => {
      this.lastError = error.message;
      this.onError(error);
    });
    this.timer = setInterval(() => {
      try {
        this.engine.tick();
        if (++this.frames % 3 === 0 && this.wss.clients.size) {
          const frame = JSON.stringify(this.engine.snapshot());
          for (const ws of this.wss.clients) {
            if (ws.bufferedAmount > 256 * 1024) ws.terminate();
            else if (ws.readyState === 1) ws.send(frame);
          }
        }
        if (this.frames % 150 === 0) this.flush();
      } catch (error) {
        this.lastError = error.message;
        this.onError(error);
      }
    }, 1000 / 30);
    this.timer.unref?.();
  }
  handle(req, res) {
    const fail = (status) => {
      res.writeHead(status, { 'Cache-Control': 'no-store' });
      res.end();
    };
    try {
      if (req.method !== 'GET' || req.headers.host !== `127.0.0.1:${this.port}`)
        return fail(403);
      const url = new URL(req.url, 'http://127.0.0.1');
      if (!this.auth(url)) return fail(403);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'",
      );
      const files = {
        '/overlay': ['overlay.html', 'text/html; charset=utf-8'],
        '/overlay.js': ['overlay.js', 'text/javascript; charset=utf-8'],
        '/overlay.css': ['overlay.css', 'text/css; charset=utf-8'],
      };
      if (files[url.pathname]) {
        const [file, mime] = files[url.pathname];
        let body = fs.readFileSync(path.join(__dirname, file));
        if (file === 'overlay.html')
          body = Buffer.from(
            body.toString().replaceAll('__KEY__', this.storage.config.key),
          );
        res.setHeader('Content-Type', mime);
        res.end(body);
        return;
      }
      const name = url.pathname.slice('/assets/'.length);
      if (url.pathname.startsWith('/assets/') && assetId(name)) {
        const file = this.storage.assetPath(name);
        if (!fs.existsSync(file)) return fail(404);
        res.setHeader('Content-Type', MIME[name.split('.').pop()]);
        const stream = fs.createReadStream(file);
        stream.on('error', () => res.destroy());
        stream.pipe(res);
        return;
      }
      return fail(404);
    } catch {
      return fail(400);
    }
  }
  receive(event) {
    if (this.engine.receive(event)) this.lastEventAt = Date.now();
  }
  setConnection(connected, scope) {
    this.connected = connected;
    if (scope !== undefined) this.engine.setScope(scope);
  }
  state() {
    return {
      config: this.storage.config,
      url: this.url,
      error: this.lastError,
      connected: this.connected,
      lastEventAt: this.lastEventAt,
      clients: this.wss?.clients.size || 0,
      snapshot: this.engine.snapshot(),
      stats: this.engine.stats,
      recent: this.engine.recent,
      blocked: Object.entries(this.engine.profiles)
        .filter(([, p]) => p.blocked)
        .map(([id, p]) => ({ id, name: p.name })),
      assets: this.storage.assets(),
    };
  }
  async save(config) {
    const oldPort = this.storage.config.port;
    this.storage.saveConfig(config);
    this.engine.setConfig(this.storage.config);
    if (oldPort !== this.storage.config.port || !this.server?.listening) {
      await this.stop();
      await this.start();
    }
    this.lastError = '';
    return this.state();
  }
  command(command, payload = {}) {
    if (command === 'clear') this.engine.clear();
    else if (command === 'clear-tests') this.engine.clear(true);
    else if (command === 'moderate')
      this.engine.moderate(payload.action, payload.id);
    else if (command === 'game')
      this.engine.startGame(payload.type, payload.duration);
    else if (command === 'stop-game')
      this.engine.finishGame('관리자가 종료했습니다.');
    else if (command === 'prune') this.storage.pruneAssets();
    else if (command === 'forget-all') {
      this.engine.clear();
      this.engine.profiles = {};
      this.engine.dirty = true;
      this.flush();
    } else if (command === 'test') {
      this.engine.receive({
        id: crypto.randomUUID(),
        kind: ['chat', 'donation', 'subscription'].includes(payload.kind)
          ? payload.kind
          : 'chat',
        userId: String(payload.name || '테스트'),
        name: payload.name || '테스트',
        text: payload.text || '!입장',
        amount: Number(payload.amount) || 0,
        role: ['everyone', 'moderator', 'owner'].includes(payload.role)
          ? payload.role
          : 'everyone',
        at: Date.now(),
        test: true,
      });
    } else throw new Error('지원하지 않는 작업입니다.');
    return this.state();
  }
  flush() {
    if (this.engine.dirty) {
      this.storage.saveProfiles(this.engine.profiles);
      this.engine.dirty = false;
    }
  }
  async stop() {
    clearInterval(this.timer);
    this.timer = null;
    for (const ws of this.wss?.clients || []) ws.terminate();
    this.wss?.close();
    if (this.server?.listening)
      await new Promise((resolve) => {
        this.server.close(resolve);
        this.server.closeAllConnections();
      });
    this.server = null;
    this.flush();
  }
}
module.exports = { AvatarService };
