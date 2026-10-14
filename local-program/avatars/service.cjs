const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const {
  AvatarStorage,
  boundedJson,
  checkVersion,
  restoreFiles,
} = require('./storage.cjs');
const { AvatarEngine } = require('./engine.cjs');
const {
  assetId,
  validateConfig,
  text,
  reactionTemplates,
} = require('./schema.cjs');

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

function relayMetrics(value, depth = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 2)
    return {};
  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 32)) {
    if (!/^[a-z][a-zA-Z0-9]{0,39}$/.test(key) || key === 'constructor')
      continue;
    if (typeof item === 'boolean' || item === null) result[key] = item;
    else if (typeof item === 'number' && Number.isFinite(item))
      result[key] = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, item));
    else if (
      item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      depth < 2
    )
      result[key] = relayMetrics(item, depth + 1);
  }
  return result;
}

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
    this.options = options;
    this.rehearsal = this.createRehearsal(this.storage.config);
    this.rehearsalSource = 'saved';
    this.operations = Promise.resolve();
    this.listeners = new Set();
    this.lastError = this.storage.warning;
    this.connected = false;
    this.commandAliases = [];
    this.commandsKnown = false;
    this.relay = null;
    this.lastEventAt = 0;
    this.server = null;
    this.timer = null;
    this.onError = options.onError || (() => {});
    this.onOutputChanged = options.onOutputChanged || (() => {});
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
    return this.serialize(async () => {
      if (this.server?.listening) return;
      this.commitListener(await this.prepareListener(this.storage.config.port));
      this.startTimer();
    });
  }
  serialize(operation) {
    const result = this.operations.then(operation);
    this.operations = result.catch(() => {});
    return result;
  }
  async prepareListener(port) {
    const listener = { port };
    const server = (listener.server = http.createServer((req, res) =>
      this.handle(req, res, listener),
    ));
    server.requestTimeout = 10000;
    server.headersTimeout = 10000;
    server.maxConnections = 40;
    const wss = (listener.wss = new WebSocketServer({
      noServer: true,
      maxPayload: 1024,
      perMessageDeflate: false,
    }));
    server.on('upgrade', (req, socket, head) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        const expectedOrigin = `http://127.0.0.1:${listener.port}`;
        if (
          req.headers.host !== `127.0.0.1:${listener.port}` ||
          (req.headers.origin && req.headers.origin !== expectedOrigin) ||
          url.pathname !== '/ws' ||
          !this.auth(url) ||
          wss.clients.size >= 8
        ) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          ws.preview = url.searchParams.get('preview') === '1';
          ws.rehearsal = url.searchParams.get('rehearsal') === '1';
          ws.monitor = url.searchParams.get('monitor') === '1';
          ws.on('error', () => ws.terminate());
          ws.send(
            JSON.stringify(
              (ws.rehearsal
                ? this.rehearsal
                : ws.preview
                  ? this.preview
                  : this.engine
              ).snapshot(),
            ),
          );
        });
      } catch {
        socket.destroy();
      }
    });
    try {
      await new Promise((resolve, reject) => {
        const fail = (error) => {
          this.lastError =
            error.code === 'EADDRINUSE'
              ? '아바타 포트를 다른 프로그램이 사용 중입니다. 포트를 변경해 주세요.'
              : error.message;
          reject(new Error(this.lastError));
        };
        server.once('error', fail);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', fail);
          listener.port = server.address().port;
          resolve();
        });
      });
    } catch (error) {
      await this.closeListener(listener);
      throw error;
    }
    server.on('error', (error) => {
      this.lastError = error.message;
      this.onError(error);
    });
    this.listeners.add(listener);
    return listener;
  }
  commitListener(listener) {
    this.listener = listener;
    this.server = listener.server;
    this.wss = listener.wss;
    this.port = listener.port;
  }
  startTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.engine.tick();
        if (this.preview.actors.size || this.preview.game) this.preview.tick();
        this.rehearsal.tick();
        if (++this.frames % 3 === 0) {
          const frame = JSON.stringify(this.engine.snapshot());
          const previewFrame = JSON.stringify(this.preview.snapshot());
          const rehearsalFrame = JSON.stringify(this.rehearsal.snapshot());
          for (const listener of this.listeners)
            for (const ws of listener.wss.clients) {
              if (ws.bufferedAmount > 256 * 1024) ws.terminate();
              else if (ws.readyState === 1)
                ws.send(
                  ws.rehearsal
                    ? rehearsalFrame
                    : ws.preview
                      ? previewFrame
                      : frame,
                );
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
  handle(req, res, listener = this.listener) {
    const fail = (status) => {
      res.writeHead(status, { 'Cache-Control': 'no-store' });
      res.end();
    };
    try {
      if (
        req.method !== 'GET' ||
        req.headers.host !== `127.0.0.1:${listener.port}` ||
        (req.headers.origin &&
          req.headers.origin !== `http://127.0.0.1:${listener.port}`)
      )
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
  setConnection(connected, scopeOrMetadata, metadata) {
    const scope =
      typeof scopeOrMetadata === 'string' ? scopeOrMetadata : undefined;
    const status =
      metadata ||
      (scopeOrMetadata && typeof scopeOrMetadata === 'object'
        ? scopeOrMetadata
        : null);
    this.connected = connected === true;
    if (scope !== undefined) this.engine.setScope(scope);
    if (!this.connected || scope !== undefined || status) {
      this.commandsKnown = this.connected && status?.commandsKnown === true;
      this.commandAliases =
        this.commandsKnown && Array.isArray(status?.commandAliases)
          ? [
              ...new Set(
                status.commandAliases
                  .slice(0, 512)
                  .filter(
                    (alias) =>
                      typeof alias === 'string' &&
                      /^![^\s]{1,31}$/u.test(alias),
                  )
                  .map((alias) => text(alias, 32).toLowerCase()),
              ),
            ]
          : [];
      const diagnostics = relayMetrics(status?.diagnostics);
      this.relay =
        this.connected && status
          ? {
              ...diagnostics,
              ready: status.ready === true,
              deliveryReady:
                typeof status.deliveryReady === 'boolean'
                  ? status.deliveryReady
                  : null,
              diagnostics,
            }
          : null;
    }
  }
  state() {
    const scopeKey = this.engine.key('');
    return {
      config: this.storage.config,
      url: this.url,
      previewUrl: this.url ? `${this.url}&preview=1&monitor=1` : '',
      rehearsalUrl: this.url ? `${this.url}&rehearsal=1&monitor=1` : '',
      error: this.lastError,
      connected: this.connected,
      commandAliases: [...this.commandAliases],
      commandsKnown: this.commandsKnown,
      relay: this.relay,
      lastEventAt: this.lastEventAt,
      clients: [...(this.wss?.clients || [])].filter(
        (ws) => !ws.preview && !ws.rehearsal && !ws.monitor,
      ).length,
      snapshot: this.engine.snapshot(),
      viewers: Object.entries(this.engine.profiles)
        .filter(([id, p]) => this.engine.actors.has(id) || p.scopeKey === scopeKey)
        .map(([id, p]) => ({ id, name: p.name, avatar: p.avatarAssignment || p.avatar,
          avatarAssignment: p.avatarAssignment || '', wins: p.wins || 0,
          targeting: p.targeting !== false, allowTargeting: p.allowTargeting !== false,
          number: this.engine.actors.get(id)?.number || null,
          active: this.engine.actors.has(id), seen: p.seen || 0 })),
      stats: this.engine.stats,
      recent: this.engine.recent,
      diagnostics: this.engine.diagnostics || [],
      lastResult: this.engine.lastResult || null,
      templates: reactionTemplates(),
      job: this.storage.job ? { ...this.storage.job } : null,
      retention: {
        profilesDays: 90,
        avatarAssignments: 'until-cleared-or-forgotten',
        blocked: 'until-unblocked-or-forgotten',
        timeouts: 'until-expired',
      },
      preview: {
        snapshot: this.preview.snapshot(),
        recent: this.preview.recent,
        result: this.previewResult,
        diagnostics: this.preview.diagnostics || [],
        lastResult: this.preview.lastResult || null,
      },
      rehearsal: {
        snapshot: this.rehearsal.snapshot(),
        recent: this.rehearsal.recent,
        result: this.rehearsal.lastResult || null,
        diagnostics: this.rehearsal.diagnostics || [],
        stats: this.rehearsal.stats,
        source: this.rehearsalSource,
      },
      blocked: Object.entries(this.engine.profiles)
        .filter(
          ([, p]) =>
            p.blocked ||
            p.blockedUntil > (this.engine.wallNow?.() ?? Date.now()),
        )
        .map(([id, p]) => ({
          id,
          name: p.name,
          blocked: p.blocked === true,
          blockedUntil: p.blockedUntil || 0,
          minutes: Math.max(
            0,
            Math.ceil(
              ((p.blockedUntil || 0) -
                (this.engine.wallNow?.() ?? Date.now())) /
                60000,
            ),
          ),
        })),
      assets: this.storage.assets(),
      catalog: this.storage.assets(),
    };
  }
  async save(config) {
    boundedJson(config);
    const input = structuredClone(config);
    return this.serialize(async () => {
      checkVersion(input);
      const next = validateConfig(input, this.storage.config);
      this.storage.ensureAssets(next);
      const previous = this.storage.config,
        oldListener = this.listener;
      let prepared;
      const originals = ['config.json', 'config.json.bak'].map((name) => {
        const file = path.join(this.storage.root, name);
        return [file, fs.existsSync(file) ? fs.readFileSync(file) : null];
      });
      let saving = false;
      try {
        if (previous.port !== next.port || !this.server?.listening)
          prepared = await this.prepareListener(next.port);
        saving = true;
        this.storage.saveConfig(next);
        this.engine.setConfig(this.storage.config);
        if (prepared) this.commitListener(prepared);
        this.startTimer();
      } catch (error) {
        this.storage.config = previous;
        try {
          if (saving) restoreFiles(originals);
          if (this.engine.config !== previous) this.engine.setConfig(previous);
        } catch (rollbackError) {
          error.message += ` (설정 복구 실패: ${rollbackError.message})`;
        } finally {
          if (prepared) await this.closeListener(prepared);
        }
        this.lastError = error.message;
        throw error;
      }
      this.lastError = '';
      if (prepared) {
        try {
          this.onOutputChanged(this.url);
        } catch (error) {
          this.onError(error);
        }
        if (oldListener) await this.closeListener(oldListener);
      }
      return this.state();
    });
  }
  command(command, payload = {}) {
    if (!payload || typeof payload !== 'object')
      throw new Error('작업 입력이 올바르지 않습니다.');
    boundedJson(payload);
    if (command === 'backup-cancel' || command === 'cancel-backup') {
      this.storage.cancelBackup(payload.id);
      return this.state();
    }
    if (command === 'assign-avatar') {
      if (this.profileRestorePending) throw new Error('시청자 기록 복원이 끝난 뒤 다시 저장해 주세요.');
      const profile = this.engine.profiles[payload.id];
      const actor = this.engine.actors.get(payload.id);
      if (!profile || (!actor && profile.scopeKey !== this.engine.key(''))) throw new Error('현재 채널의 시청자를 찾을 수 없습니다.');
      const avatarId = payload.avatarId;
      if (typeof avatarId !== 'string' || (avatarId && !this.storage.config.avatars.some((v) => v.id === avatarId)))
        throw new Error('저장된 캐릭터를 선택해 주세요.');
      const previous = profile.avatarAssignment;
      profile.avatarAssignment = avatarId;
      try { this.storage.saveProfiles(this.engine.profiles); }
      catch (error) {
        if (previous === undefined) delete profile.avatarAssignment;
        else profile.avatarAssignment = previous;
        throw error;
      }
      this.engine.dirty = false;
      if (actor) actor.animationStartedAt = this.engine.now();
      return this.state();
    }
    if (command === 'prune')
      return this.serialize(() => {
        this.storage.pruneAssets([
          this.preview.config,
          this.rehearsal.config,
          payload.undoAssets || [],
        ]);
        return this.state();
      });
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
    else if (command === 'preview-step')
      this.preview.advance(
        Math.max(1, Math.min(5000, Number(payload.milliseconds ?? 100) || 100)),
      );
    else if (command === 'rehearsal-reset') {
      const config = this.validateTestConfig(
        payload.config || this.storage.config,
      );
      this.rehearsal = this.createRehearsal(config, payload.seed);
      this.rehearsalSource = payload.config ? 'draft' : 'saved';
    } else if (command === 'rehearsal-pause')
      this.rehearsal.setConfig({
        ...this.rehearsal.config,
        paused:
          typeof payload.paused === 'boolean'
            ? payload.paused
            : !this.rehearsal.config.paused,
      });
    else if (command === 'rehearsal') {
      if (payload.config || payload.source === 'saved') {
        const config = this.validateTestConfig(
          payload.config || this.storage.config,
        );
        if (JSON.stringify(config) !== JSON.stringify(this.rehearsal.config))
          this.rehearsal.setConfig(config);
        this.rehearsalSource = payload.config ? 'draft' : 'saved';
      }
      this.rehearsal.receive(this.testEvent(payload, this.rehearsal, false));
    } else if (command === 'preview-game') {
      this.applyPreview(payload.config);
      this.preview.startGame(
        payload.type,
        payload.duration,
        payload.options || {},
      );
    } else if (command === 'preview-stop-game')
      this.preview.finishGame('테스트 게임을 종료했습니다.');
    else if (command === 'moderate')
      this.engine.moderate(payload.action, payload.id, {
        minutes: payload.minutes,
        allowed: payload.allowed ?? payload.options?.allowed,
      });
    else if (command === 'game')
      this.engine.startGame(
        payload.type,
        payload.duration,
        payload.options || {},
      );
    else if (command === 'stop-game')
      this.engine.finishGame('관리자가 종료했습니다.');
    else if (command === 'forget-all') {
      this.engine.clear();
      this.engine.profiles = {};
      this.engine.dirty = true;
      this.flush();
    } else if (command === 'test') {
      this.applyPreview(payload.config);
      const event = this.testEvent(payload, this.preview, true);
      const userId = event.userId;
      const avatarId = this.preview.config.avatars.some(
        (a) => a.id === payload.avatarId,
      )
        ? payload.avatarId
        : this.preview.config.defaultAvatar;
      this.preview.resetTestActor(userId, avatarId);
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
        const targetActor = payload.targetId
          ? this.preview.actors.get(payload.targetId) ||
            this.preview.actors.get(this.preview.key(payload.targetId, true))
          : null;
        if (
          !this.preview.runRule(rule, actor, {
            ...event,
            role: 'owner',
            amount: rule.minimum,
            targetName: targetActor
              ? `#${targetActor.number}`
              : payload.targetName || '',
            targetId: payload.targetId || '',
            preview: true,
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
    const validated = this.validateTestConfig({
      ...config,
      enabled: true,
      paused: false,
      newJoins: true,
    });
    this.preview.setConfig(validated);
  }
  validateTestConfig(config) {
    boundedJson(config);
    checkVersion(config);
    const validated = validateConfig(config, this.storage.config);
    this.storage.ensureAssets(validated);
    return validated;
  }
  createRehearsal(config, seed = 1) {
    let state = (Number(seed) || 1) >>> 0;
    const random =
      this.options?.random ||
      (() => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
      });
    const engine = new AvatarEngine(
      structuredClone(config),
      {},
      { ...this.options, random },
    );
    engine.setScope('local-rehearsal');
    return engine;
  }
  testEvent(payload, engine, preview) {
    return {
      id: crypto.randomUUID(),
      kind: ['chat', 'donation', 'subscription'].includes(payload.kind)
        ? payload.kind
        : 'chat',
      userId:
        text(payload.actorId, 128) ||
        (preview ? text(payload.name, 32) || '테스트' : 'rehearsal-user-1'),
      name: text(payload.name, 32) || '시청자 1',
      text: payload.text ?? '!입장',
      amount: Number(payload.amount) || 0,
      role: ['everyone', 'moderator', 'owner'].includes(payload.role)
        ? payload.role
        : 'everyone',
      at: engine.wallNow ? engine.wallNow() : engine.now(),
      test: preview,
      preview,
    };
  }
  draft(action, payload) {
    if (action === 'load') return this.storage.loadDraft();
    if (action === 'save') return this.storage.saveDraft(payload);
    if (action === 'discard') return this.storage.discardDraft();
    throw new Error('지원하지 않는 초안 작업입니다.');
  }
  importImage(file) {
    return this.serialize(() => this.storage.importImage(file));
  }
  backup(file, options = {}) {
    options = { ...options };
    return this.serialize(async () => {
      this.flush();
      this.profileRestorePending =
        options.restore === true && options.kind === 'profiles';
      try {
        if (options.restore === true) {
          await this.storage.restoreBackupAsync(file, options);
          if (options.kind === 'profiles') {
            this.engine.clear();
            this.engine.profiles = structuredClone(this.storage.profiles);
            this.engine.dirty = false;
          } else this.engine.setConfig(this.storage.config);
        } else await this.storage.exportBackupAsync(file, options);
      } finally {
        this.profileRestorePending = false;
      }
      // Export and restore never implicitly discard the editor's recovery draft.
      return this.state();
    });
  }
  diagnostics() {
    const masked = (engine) =>
      (engine.diagnostics || []).slice(0, 200).map((entry) => {
        const result = {};
        // Whitelist only machine-readable decisions; free text can contain names, paths or keys.
        for (const key of [
          'at',
          'sequence',
          'configRevision',
          'simulationTime',
          'latency',
          'remainingMs',
          'duration',
        ])
          if (Number.isFinite(entry[key])) result[key] = entry[key];
        for (const key of ['code', 'phase', 'result', 'reason', 'cause'])
          if (
            typeof entry[key] === 'string' &&
            /^[A-Z_]{2,48}$/.test(entry[key])
          )
            result[key] = entry[key];
        return result;
      });
    return {
      version: 3,
      exportedAt: new Date().toISOString(),
      live: masked(this.engine),
      preview: masked(this.preview),
      rehearsal: masked(this.rehearsal),
      job: this.storage.job
        ? {
            action: this.storage.job.action,
            status: this.storage.job.status,
            progress: this.storage.job.progress,
          }
        : null,
    };
  }
  copy(kind, draft) {
    if (!['commands', 'commands-draft', 'draft-commands'].includes(kind))
      return this.url;
    const editing = draft !== undefined;
    const config = editing
      ? this.validateTestConfig(draft.config || draft)
      : this.storage.config;
    const lines = [
      `${editing ? '편집 중 명령 (미적용)' : '저장된 명령'} · v${config.version} · revision ${this.engine.configRevision || 0}`,
      '!입장 / !join; !퇴장 / !leave; !캐릭터 / !avatar <이름>; !색 / !color <#RRGGBB>; !크기 / !size <0.5~1.6> (기본 1); !응원 / !cheer; !도움말 / !help',
      '!상호작용 / !targeting <on|off>; !참가 / !participate; !부스트 / !boost',
    ];
    for (const rule of config.rules.filter(
      (r) => r.enabled && r.trigger === 'command',
    )) {
      const target = rule.steps.some((s) =>
        ['follow', 'highfive', 'push'].includes(s.action),
      );
      const durationMode =
        rule.durationMode ||
        (rule.durationFromChat ? 'legacyAllSteps' : 'fixed');
      const timed = durationMode !== 'fixed';
      const defaults =
        durationMode === 'step'
          ? rule.steps[rule.durationStep || 0]?.duration
          : rule.steps.map((s) => s.duration).join('/');
      lines.push(
        `${rule.name}: ${rule.aliases.join(' / ')}${target ? ' <@이름|#참여번호>' : ''}${timed ? ' [초]' : ''} · 권한 ${rule.role} · 대기 ${rule.cooldown}초 · 기본 ${defaults}초 · ${durationMode}${target ? ` · 대상 ${config.allowTargeting ? '허용' : '비활성'}` : ''}`,
      );
    }
    return lines.join('\n');
  }
  flush() {
    if (this.engine.dirty && !this.profileRestorePending) {
      this.storage.saveProfiles(this.engine.profiles);
      this.engine.dirty = false;
    }
  }
  async stop() {
    this.storage.cancelBackup();
    return this.serialize(async () => {
      clearInterval(this.timer);
      this.timer = null;
      for (const listener of [...this.listeners])
        await this.closeListener(listener);
      this.listener = null;
      this.wss = null;
      this.server = null;
      this.flush();
    });
  }
  async closeListener(listener) {
    this.listeners.delete(listener);
    for (const ws of listener.wss.clients) ws.terminate();
    listener.wss.close();
    if (listener.server.listening)
      await new Promise((resolve) => {
        listener.server.close(resolve);
        listener.server.closeAllConnections();
      });
  }
}
module.exports = { AvatarService };
