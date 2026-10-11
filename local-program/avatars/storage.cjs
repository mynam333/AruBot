const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const sharp = require('sharp');
const { Worker } = require('worker_threads');
const {
  LIMITS,
  text,
  assetId,
  defaultConfig,
  validateConfig,
  migrateConfig,
} = require('./schema.cjs');
const { files: bundledFiles, migrateLegacyAvatars } = require('./bundled.cjs');

const DRAFT_BYTES = 256 * 1024;
const CONFIG_VERSION = 3;
function checkVersion(config) {
  if (Number(config?.version) > CONFIG_VERSION) {
    const error = new Error(
      '더 최신 버전의 아바타 설정입니다. 앱을 업데이트해 주세요.',
    );
    error.code = 'FUTURE_CONFIG_VERSION';
    throw error;
  }
}
function references(value, result = new Set()) {
  if (typeof value === 'string' && assetId(value)) result.add(value);
  else if (Array.isArray(value)) value.forEach((v) => references(v, result));
  else if (value && typeof value === 'object')
    Object.values(value).forEach((v) => references(v, result));
  return result;
}
function boundedJson(value, limit = DRAFT_BYTES) {
  const json = JSON.stringify(value);
  if (!json || Buffer.byteLength(json, 'utf8') > limit)
    throw new Error('아바타 설정은 256KB 이하여야 합니다.');
  return json;
}

function atomicWrite(file, value, backup = true) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, value, { mode: 0o600 });
    if (backup && fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function restoreFiles(originals) {
  for (const [file, bytes] of originals) {
    if (bytes) {
      if (!fs.existsSync(file) || !fs.readFileSync(file).equals(bytes))
        atomicWrite(file, bytes, false);
    } else fs.rmSync(file, { force: true });
  }
}

async function validateImage(buffer) {
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length > LIMITS.fileBytes ||
    buffer.length < 12
  )
    throw new Error('이미지는 8MB 이하여야 합니다.');
  const meta = await sharp(buffer, {
    limitInputPixels: 32 * 1024 * 1024,
    animated: true,
  }).metadata();
  const extension = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp' }[
    meta.format
  ];
  const height = meta.pageHeight || meta.height;
  if (
    !extension ||
    !(meta.width > 0 && height > 0) ||
    meta.width > 2048 ||
    height > 2048 ||
    (meta.pages || 1) > 240 ||
    meta.width * height * (meta.pages || 1) > 32 * 1024 * 1024
  ) {
    throw new Error(
      'PNG/JPEG/GIF/WebP만 지원합니다. 최대 2048px, 240프레임, 전체 32메가픽셀입니다.',
    );
  }
  return {
    asset: `${crypto.createHash('sha256').update(buffer).digest('hex')}.${extension}`,
    width: meta.width,
    height,
    frames: meta.pages || 1,
    frameCount: meta.pages || 1,
    estimatedDecodeBytes: meta.width * height * (meta.pages || 1) * 4,
    bytes: buffer.length,
  };
}

class AvatarStorage {
  constructor(root) {
    this.root = root;
    this.assetRoot = path.join(root, 'assets');
    this.warning = '';
    this.job = null;
    this.worker = null;
    this.catalog = new Map();
    fs.mkdirSync(this.assetRoot, { recursive: true });
    // Never fall back over a newer primary config, even when a usable .bak exists.
    this.config = this.read('config.json', defaultConfig(), (v) => {
      checkVersion(v);
      const config = validateConfig(migrateConfig(migrateLegacyAvatars(v)), {
        ...defaultConfig(),
        key: /^[a-f0-9]{48}$/.test(v.key) ? v.key : defaultConfig().key,
      });
      this.ensureAssets(config);
      return config;
    });
    this.profiles = this.read('profiles.json', {}, (v) =>
      this.cleanProfiles(v),
    );
    const recoveredConfig = this.recoveredConfig;
    if (
      this.loadedConfigFile &&
      Number(this.loadedConfigVersion || 1) < 3 &&
      this.config.version === 3
    ) {
      const original = path.join(root, 'config.json.v3-original');
      if (!fs.existsSync(original))
        fs.copyFileSync(
          this.loadedConfigFile,
          original,
          fs.constants.COPYFILE_EXCL,
        );
    }
    this.saveConfig(this.config);
    if (recoveredConfig)
      fs.copyFileSync(
        path.join(root, 'config.json'),
        path.join(root, 'config.json.bak'),
      );
    this.ready = this.refreshCatalog().catch((error) => {
      this.warning = this.warning || error.message;
    });
  }
  read(name, fallback, validate) {
    for (const suffix of ['', '.bak']) {
      const file = path.join(this.root, name + suffix);
      if (!fs.existsSync(file)) continue;
      try {
        if (fs.statSync(file).size > 4 * 1024 * 1024)
          throw new Error('Oversized settings');
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        const data = validate(raw);
        if (name === 'config.json') {
          this.loadedConfigFile = file;
          this.loadedConfigVersion = raw.version;
          this.recoveredConfig = !!suffix;
        }
        if (suffix) this.warning = `${name}: 이전 정상 백업으로 복구했습니다.`;
        return data;
      } catch (error) {
        if (error.code === 'FUTURE_CONFIG_VERSION') throw error;
        this.warning = `${name}: 손상된 저장 파일을 발견했습니다. 백업을 확인해 주세요.`;
      }
    }
    return fallback;
  }
  cleanProfiles(value) {
    const profiles = {};
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return profiles;
    const normal = [],
      restricted = [];
    for (const [key, p] of Object.entries(value)) {
      if (!/^[a-f0-9]{64}$/.test(key) || !p || typeof p !== 'object') continue;
      const timeoutUntil = Math.max(
        0,
        Number(p.blockedUntil ?? p.timeoutUntil) || 0,
      );
      const protectedProfile = p.blocked === true || timeoutUntil > Date.now();
      if (!protectedProfile && Date.now() - Number(p.seen || 0) > 90 * 86400000)
        continue;
      const cleaned = {
        name: text(p.name, 48),
        avatar: String(p.avatar || '').slice(0, 64),
        color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#ffffff',
        scale: Math.min(1.6, Math.max(0.5, Number(p.scale) || 1)),
        hidden: p.hidden === true,
        blocked: p.blocked === true,
        timeoutUntil: Number.isFinite(timeoutUntil) ? timeoutUntil : 0,
        blockedUntil: Number.isFinite(timeoutUntil) ? timeoutUntil : 0,
        allowTargeting: p.allowTargeting !== false,
        targeting: p.targeting !== false,
        seen: Number(p.seen) || 0,
        wins: Math.min(1e6, Math.max(0, Number(p.wins) || 0)),
      };
      (protectedProfile ? restricted : normal).push([key, cleaned]);
    }
    // Moderation retention is independent of the ordinary 90-day/profile-count budget.
    for (const [key, p] of [
      ...normal.sort((a, b) => a[1].seen - b[1].seen).slice(-LIMITS.profiles),
      ...restricted,
    ])
      profiles[key] = p;
    return profiles;
  }
  saveConfig(config) {
    checkVersion(config);
    const validated = validateConfig(
      migrateConfig(config),
      this.config || config,
    );
    this.ensureAssets(validated);
    atomicWrite(path.join(this.root, 'config.json'), JSON.stringify(validated));
    this.config = validated;
    return validated;
  }
  ensureAssets(config) {
    for (const avatar of config.avatars)
      for (const image of Object.values(avatar.states)) {
        const file = this.assetPath(image.asset);
        if (!fs.existsSync(file) && bundledFiles.has(image.asset))
          fs.copyFileSync(bundledFiles.get(image.asset), file);
        if (!fs.existsSync(file))
          throw new Error('이미지 파일이 없습니다. 다시 등록해 주세요.');
      }
  }
  saveProfiles(profiles) {
    const cleaned = this.cleanProfiles(profiles);
    const json = JSON.stringify(cleaned);
    if (Buffer.byteLength(json) > 4 * 1024 * 1024)
      throw new Error(
        '개인 기록 보관 한도를 초과했습니다. 차단 기록을 검토한 뒤 명시적으로 삭제해 주세요.',
      );
    atomicWrite(path.join(this.root, 'profiles.json'), json);
    this.profiles = cleaned;
  }
  assetPath(name) {
    if (!assetId(name)) throw new Error('Invalid asset');
    return path.join(this.assetRoot, name);
  }
  assets() {
    return fs
      .readdirSync(this.assetRoot)
      .filter(assetId)
      .map((name) => ({
        name,
        asset: name,
        width: 0,
        height: 0,
        frames: 0,
        frameCount: 0,
        estimatedDecodeBytes: 0,
        ...this.catalog.get(name),
        bytes: fs.statSync(this.assetPath(name)).size,
      }));
  }
  async refreshCatalog() {
    for (const { name } of this.assets()) {
      if (this.catalog.has(name)) continue;
      try {
        const meta = await validateImage(
          await fs.promises.readFile(this.assetPath(name)),
        );
        if (meta.asset !== name) throw new Error('이미지 무결성 오류');
        if (fs.existsSync(this.assetPath(name))) this.catalog.set(name, meta);
      } catch (error) {
        if (fs.existsSync(this.assetPath(name)))
          this.catalog.set(name, { error: 'INVALID_IMAGE' });
      }
    }
    return this.assets();
  }
  saveDraft(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new Error('초안 형식이 올바르지 않습니다.');
    const json = boundedJson(payload);
    checkVersion(payload.config || payload);
    atomicWrite(path.join(this.root, 'draft.json'), json);
    return JSON.parse(json);
  }
  loadDraft() {
    for (const suffix of ['', '.bak']) {
      const file = path.join(this.root, `draft.json${suffix}`);
      if (!fs.existsSync(file)) continue;
      try {
        if (fs.statSync(file).size > DRAFT_BYTES)
          throw new Error('Oversized draft');
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        checkVersion(value.config || value);
        return value;
      } catch (error) {
        if (error.code === 'FUTURE_CONFIG_VERSION') throw error;
        this.warning =
          '손상된 초안 파일을 발견했습니다. 복구 백업을 확인해 주세요.';
      }
    }
    return null;
  }
  discardDraft() {
    for (const suffix of ['', '.bak'])
      fs.rmSync(path.join(this.root, `draft.json${suffix}`), { force: true });
    return null;
  }
  async importImage(file) {
    if (
      !fs.statSync(file).isFile() ||
      fs.statSync(file).size > LIMITS.fileBytes
    )
      throw new Error('이미지 파일 크기를 확인해 주세요.');
    return this.importBuffer(await fs.promises.readFile(file));
  }
  async importBuffer(buffer) {
    const meta = await validateImage(buffer);
    const assets = this.assets();
    if (!fs.existsSync(this.assetPath(meta.asset))) {
      if (
        assets.length >= LIMITS.assets ||
        assets.reduce((sum, a) => sum + a.bytes, 0) + buffer.length >
          LIMITS.totalBytes
      )
        throw new Error(
          '이미지 보관 한도를 초과했습니다. 미사용 파일을 정리해 주세요.',
        );
      fs.writeFileSync(this.assetPath(meta.asset), buffer, {
        flag: 'wx',
        mode: 0o600,
      });
    }
    this.catalog.set(meta.asset, meta);
    return meta;
  }
  pruneAssets(extraReferences = []) {
    // Keep the recovery config consistent with the files retained by cleanup.
    this.saveConfig(this.config);
    const used = references([this.config, extraReferences]);
    for (const name of [
      'draft.json',
      'draft.json.bak',
      'config.json.v3-original',
    ]) {
      const file = path.join(this.root, name);
      if (!fs.existsSync(file)) continue;
      // A broken recovery file must not cause its only recoverable artwork to be deleted.
      try {
        references(JSON.parse(fs.readFileSync(file, 'utf8')), used);
      } catch {
        throw new Error('복구 파일을 읽을 수 없어 이미지 정리를 중단했습니다.');
      }
    }
    let removed = 0;
    for (const asset of this.assets())
      if (!used.has(asset.name)) {
        fs.unlinkSync(this.assetPath(asset.name));
        this.catalog.delete(asset.name);
        removed++;
      }
    return removed;
  }
  exportBackup(file, options = {}) {
    const used = references(this.config);
    const assets = this.assets()
      .filter((a) => used.has(a.name))
      .map((a) => ({
        name: a.name,
        data: fs.readFileSync(this.assetPath(a.name)).toString('base64'),
      }));
    const config = {
      ...this.config,
      key: undefined,
      enabled: false,
      paused: false,
    };
    atomicWrite(
      file,
      zlib.gzipSync(
        JSON.stringify(
          options.kind === 'profiles'
            ? {
                format: 'aruavatars-profiles',
                version: 1,
                profiles: this.cleanProfiles(this.profiles),
              }
            : { format: 'aruavatars', version: 1, config, assets },
        ),
        { level: 9 },
      ),
    );
  }
  exportBackupAsync(file, options = {}) {
    return this.backupJob('export', file, options);
  }
  restoreBackup(file, options = {}) {
    return this.restoreBackupAsync(file, options);
  }
  restoreBackupAsync(file, options = {}) {
    return this.backupJob('restore', file, options);
  }
  cancelBackup(id) {
    if (
      !this.job ||
      (id && id !== this.job.id) ||
      this.job.status !== 'running'
    )
      return false;
    this.job.status = 'cancelling';
    if (this.worker) this.worker.terminate().catch(() => {});
    return true;
  }
  async backupJob(action, file, options) {
    if (
      this.job &&
      ['running', 'cancelling', 'committing'].includes(this.job.status)
    )
      throw new Error('이미 백업 작업이 진행 중입니다.');
    const destination = path.resolve(file);
    if (
      action === 'export' &&
      (path.dirname(destination) === path.resolve(this.assetRoot) ||
        [
          'config.json',
          'config.json.bak',
          'config.json.v3-original',
          'profiles.json',
          'profiles.json.bak',
          'draft.json',
          'draft.json.bak',
        ].some(
          (name) =>
            destination.toLowerCase() ===
            path.resolve(this.root, name).toLowerCase(),
        ))
    )
      throw new Error('아바타 저장 파일에 백업을 덮어쓸 수 없습니다.');
    const job = (this.job = {
      id: crypto.randomUUID(),
      action,
      status: 'running',
      progress: 0,
      phase: 'preparing',
      kind: options.kind === 'profiles' ? 'profiles' : 'artwork',
    });
    const cancelled = () => {
      if (job.status === 'cancelling') {
        const error = new Error('백업 작업을 취소했습니다.');
        error.code = 'ABORT_ERR';
        throw error;
      }
    };
    const parent =
      action === 'export' ? path.dirname(destination) : path.resolve(this.root);
    let stage;
    const added = [],
      replaced = [];
    let keepStage = false;
    try {
      // Workers only write into this owned staging directory, never into live files.
      stage = await fs.promises.mkdtemp(path.join(parent, '.avatar-backup-'));
      cancelled();
      const result = await new Promise((resolve, reject) => {
        let value, failure;
        const worker = (this.worker = new Worker(
          path.join(__dirname, 'backup-worker.cjs'),
          {
            workerData: {
              action,
              file: destination,
              stage,
              assetRoot: this.assetRoot,
              config: this.config,
              profiles:
                job.kind === 'profiles'
                  ? this.cleanProfiles(this.profiles)
                  : undefined,
              kind: job.kind,
              restoreProfiles: options.restoreProfiles === true,
            },
          },
        ));
        worker.on('message', (message) => {
          if (message.type === 'progress') {
            job.progress = message.progress;
            job.phase = message.phase;
          } else if (message.type === 'result') value = message.value;
          else if (message.type === 'error')
            failure = Object.assign(new Error(message.message), {
              code: message.code,
            });
        });
        worker.on('error', (error) => {
          failure = error;
        });
        worker.once('exit', (code) => {
          this.worker = null;
          if (job.status === 'cancelling')
            reject(
              Object.assign(new Error('백업 작업을 취소했습니다.'), {
                code: 'ABORT_ERR',
              }),
            );
          else if (failure) reject(failure);
          else if (code || !value)
            reject(new Error('백업 작업이 완료되지 않았습니다.'));
          else resolve(value);
        });
      });
      cancelled();
      if (action === 'export') {
        job.status = 'committing';
        job.phase = 'committing';
        await fs.promises.rename(path.join(stage, 'backup'), destination);
      } else {
        const metas = result.assets || [];
        const existing = this.assets();
        const missing = metas.filter(
          (meta) => !fs.existsSync(this.assetPath(meta.asset)),
        );
        if (
          existing.length + missing.length > LIMITS.assets ||
          existing.reduce((n, a) => n + a.bytes, 0) +
            missing.reduce((n, a) => n + a.bytes, 0) >
            LIMITS.totalBytes
        )
          throw new Error(
            '복원 이미지를 보존할 공간이 부족합니다. 미사용 이미지를 먼저 정리해 주세요.',
          );
        for (const meta of metas.filter(
          (meta) => meta.replace || missing.includes(meta),
        )) {
          cancelled();
          const destinationAsset = this.assetPath(meta.asset);
          if (meta.replace) {
            await fs.promises.rename(
              path.join(stage, meta.asset),
              destinationAsset,
            );
            replaced.push([
              destinationAsset,
              path.join(stage, `original-${meta.asset}`),
            ]);
          } else {
            await fs.promises.copyFile(
              path.join(stage, meta.asset),
              destinationAsset,
              fs.constants.COPYFILE_EXCL,
            );
            added.push(destinationAsset);
            await fs.promises.chmod(destinationAsset, 0o600);
          }
        }
        cancelled();
        job.status = 'committing';
        job.phase = 'committing';
        const names = [
          'config.json',
          'profiles.json',
          'config.json.bak',
          'profiles.json.bak',
        ];
        const originals = names.map((name) => {
          const target = path.join(this.root, name);
          return [
            target,
            fs.existsSync(target) ? fs.readFileSync(target) : null,
          ];
        });
        const previousConfig = this.config,
          previousProfiles = this.profiles;
        try {
          if (result.config)
            this.saveConfig({
              ...result.config,
              key: this.config.key,
              port: this.config.port,
            });
          if (result.profiles && options.restoreProfiles === true)
            this.saveProfiles(result.profiles);
        } catch (error) {
          this.config = previousConfig;
          this.profiles = previousProfiles;
          restoreFiles(originals);
          throw error;
        }
        for (const { replace, ...meta } of metas)
          this.catalog.set(meta.asset, meta);
      }
      job.status = 'completed';
      job.progress = 100;
      job.phase = 'completed';
      return this.config;
    } catch (error) {
      job.status = error.code === 'ABORT_ERR' ? 'cancelled' : 'failed';
      job.error = error.message;
      for (const [target, original] of replaced) {
        try {
          await fs.promises.rename(original, target);
        } catch (rollbackError) {
          keepStage = true;
          job.error += ` (이미지 복구 파일: ${original}; ${rollbackError.message})`;
        }
      }
      for (const target of added) await fs.promises.rm(target, { force: true });
      throw error;
    } finally {
      if (
        !keepStage &&
        stage &&
        path.dirname(path.resolve(stage)) === parent &&
        path.basename(stage).startsWith('.avatar-backup-')
      )
        await fs.promises.rm(stage, { recursive: true, force: true });
    }
  }
}
module.exports = {
  AvatarStorage,
  validateImage,
  atomicWrite,
  restoreFiles,
  checkVersion,
  references,
  boundedJson,
};
