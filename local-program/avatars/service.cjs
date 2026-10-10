const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { AvatarStorage } = require('./storage.cjs');
const { AvatarEngine } = require('./engine.cjs');
const { assetId, validateConfig, text } = require('./schema.cjs');

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
    this.preview = new AvatarEngine(
      { ...structuredClone(this.storage.config), enabled: true, paused: false },
      {},
      options,
    );
    this.previewResult = '';
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
          ws.preview = url.searchParams.get('preview') === '1';
          ws.monitor = url.searchParams.get('monitor') === '1';
          ws.on('error', () => ws.terminate());
          ws.send(
            JSON.stringify(
              (ws.preview ? this.preview : this.engine).snapshot(),
            ),
          );
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
        if (this.preview.actors.size || this.preview.game) this.preview.tick();
        if (++this.frames % 3 === 0 && this.wss.clients.size) {
          const frame = JSON.stringify(this.engine.snapshot());
          const previewFrame = JSON.stringify(this.preview.snapshot());
          for (const ws of this.wss.clients) {
            if (ws.bufferedAmount > 256 * 1024) ws.terminate();
            else if (ws.readyState === 1)
              ws.send(ws.preview ? previewFrame : frame);
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
      previewUrl: this.url ? `${this.url}&preview=1&monitor=1` : '',
      error: this.lastError,
      connected: this.connected,
      lastEventAt: this.lastEventAt,
      clients: [...(this.wss?.clients || [])].filter(
        (ws) => !ws.preview && !ws.monitor,
      ).length,
      snapshot: this.engine.snapshot(),
      stats: this.engine.stats,
      recent: this.engine.recent,
      preview: {
        snapshot: this.preview.snapshot(),
        recent: this.preview.recent,
        result: this.previewResult,
      },
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
    if (!payload || typeof payload !== 'object')
      throw new Error('작업 입력이 올바르지 않습니다.');
    if (command === 'clear') this.engine.clear();
    else if (command === 'clear-tests') {
      this.preview.clear();
      this.preview.recent = [];
      this.previewResult = '';
    } else if (command === 'preview-pause')
      this.preview.setConfig({
        ...this.preview.config,
        paused: !this.preview.config.paused,
      });
    else if (command === 'preview-game') {
      this.applyPreview(payload.config);
      this.preview.startGame(payload.type, payload.duration);
    } else if (command === 'preview-stop-game')
      this.preview.finishGame('테스트 게임을 종료했습니다.');
    else if (command === 'moderate')
      this.engine.moderate(payload.action, payload.id);
    else if (command === 'game')
      this.engine.startGame(payload.type, payload.duration);
    else if (command === 'stop-game')
      this.engine.finishGame('관리자가 종료했습니다.');
    else if (command === 'prune') {
      this.preview.clear();
      this.storage.pruneAssets();
    } else if (command === 'forget-all') {
      this.engine.clear();
      this.engine.profiles = {};
      this.engine.dirty = true;
      this.flush();
    } else if (command === 'test') {
      this.applyPreview(payload.config);
      const userId = text(payload.name, 32) || '테스트';
      const avatarId = this.preview.config.avatars.some(
        (a) => a.id === payload.avatarId,
      )
        ? payload.avatarId
        : this.preview.config.defaultAvatar;
      this.preview.resetTestActor(userId, avatarId);
      const event = {
        id: crypto.randomUUID(),
        kind: ['chat', 'donation', 'subscription'].includes(payload.kind)
          ? payload.kind
          : 'chat',
        userId,
        name: userId,
        text: payload.text ?? '!입장',
        amount: Number(payload.amount) || 0,
        role: ['everyone', 'moderator', 'owner'].includes(payload.role)
          ? payload.role
          : 'everyone',
        at: this.preview.now(),
        test: true,
      };
      const before = this.preview.recent[0];
      const actor = this.preview.join(event, true, !payload.ruleId);
      if (!actor)
        throw new Error(
          '테스트 참여자 한도에 도달했습니다. 테스트 화면을 비워 주세요.',
        );
      actor.profile.avatar = avatarId;
      actor.lastChat = this.preview.now();
      if (payload.ruleId) {
        const rule = this.preview.config.rules.find(
          (r) => r.id === payload.ruleId,
        );
        if (!rule) throw new Error('테스트할 반응이 없습니다.');
        if (
          !this.preview.runRule(rule, actor, {
            ...event,
            role: 'owner',
            amount: rule.minimum,
            targetName: payload.targetName || '',
          })
        )
          throw new Error('반응이 꺼져 있거나 테스트를 실행할 수 없습니다.');
      } else this.preview.receive(event);
      this.previewResult =
        this.preview.recent[0] !== before
          ? this.preview.recent[0].message
          : '테스트 입력 처리됨 · 실행된 반응 없음';
    } else throw new Error('지원하지 않는 작업입니다.');
    return this.state();
  }
  applyPreview(config = this.storage.config) {
    if (JSON.stringify(config).length > 256 * 1024)
      throw new Error('아바타 설정이 너무 큽니다.');
    const validated = validateConfig(
      { ...config, enabled: true, paused: false },
      this.storage.config,
    );
    this.storage.ensureAssets(validated);
    this.preview.setConfig(validated);
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
