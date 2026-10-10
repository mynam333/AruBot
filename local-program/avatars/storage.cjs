const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const sharp = require('sharp');
const {
  LIMITS,
  assetId,
  defaultConfig,
  validateConfig,
  migrateConfig,
} = require('./schema.cjs');
const { files: bundledFiles, migrateLegacyAvatars } = require('./bundled.cjs');

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, value, { mode: 0o600 });
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
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
    bytes: buffer.length,
  };
}

class AvatarStorage {
  constructor(root) {
    this.root = root;
    this.assetRoot = path.join(root, 'assets');
    this.warning = '';
    fs.mkdirSync(this.assetRoot, { recursive: true });
    this.config = this.read('config.json', defaultConfig(), (v) => {
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
    this.saveConfig(this.config);
    if (this.warning)
      fs.copyFileSync(
        path.join(root, 'config.json'),
        path.join(root, 'config.json.bak'),
      );
  }
  read(name, fallback, validate) {
    for (const suffix of ['', '.bak']) {
      const file = path.join(this.root, name + suffix);
      if (!fs.existsSync(file)) continue;
      try {
        if (fs.statSync(file).size > 4 * 1024 * 1024)
          throw new Error('Oversized settings');
        const data = validate(JSON.parse(fs.readFileSync(file, 'utf8')));
        if (suffix) this.warning = `${name}: 이전 정상 백업으로 복구했습니다.`;
        return data;
      } catch {
        this.warning = `${name}: 손상된 저장 파일을 발견했습니다. 백업을 확인해 주세요.`;
      }
    }
    return fallback;
  }
  cleanProfiles(value) {
    const profiles = {};
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return profiles;
    for (const [key, p] of Object.entries(value).slice(-LIMITS.profiles)) {
      if (
        !/^[a-f0-9]{64}$/.test(key) ||
        !p ||
        typeof p !== 'object' ||
        Date.now() - Number(p.seen || 0) > 90 * 86400000
      )
        continue;
      profiles[key] = {
        name: String(p.name || '').slice(0, 48),
        avatar: String(p.avatar || '').slice(0, 64),
        color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#ffffff',
        scale: Math.min(1.6, Math.max(0.5, Number(p.scale) || 1)),
        hidden: p.hidden === true,
        blocked: p.blocked === true,
        seen: Number(p.seen),
        wins: Math.min(1e6, Math.max(0, Number(p.wins) || 0)),
      };
    }
    return profiles;
  }
  saveConfig(config) {
    const validated = validateConfig(config, this.config || config);
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
    atomicWrite(path.join(this.root, 'profiles.json'), JSON.stringify(cleaned));
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
      .map((name) => ({ name, bytes: fs.statSync(this.assetPath(name)).size }));
  }
  async importImage(file) {
    if (
      !fs.statSync(file).isFile() ||
      fs.statSync(file).size > LIMITS.fileBytes
    )
      throw new Error('이미지 파일 크기를 확인해 주세요.');
    return this.importBuffer(fs.readFileSync(file));
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
          '이미지 보관 한도(64개/48MB)를 초과했습니다. 미사용 파일을 정리해 주세요.',
        );
      fs.writeFileSync(this.assetPath(meta.asset), buffer, {
        flag: 'wx',
        mode: 0o600,
      });
    }
    return meta;
  }
  pruneAssets() {
    // Keep the recovery config consistent with the files retained by cleanup.
    this.saveConfig(this.config);
    const used = new Set(
      this.config.avatars.flatMap((a) =>
        Object.values(a.states).map((s) => s.asset),
      ),
    );
    let removed = 0;
    for (const asset of this.assets())
      if (!used.has(asset.name)) {
        fs.unlinkSync(this.assetPath(asset.name));
        removed++;
      }
    return removed;
  }
  exportBackup(file) {
    const assets = this.assets().map((a) => ({
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
        JSON.stringify({ format: 'aruavatars', version: 1, config, assets }),
        { level: 9 },
      ),
    );
  }
  async restoreBackup(file) {
    if (fs.statSync(file).size > 64 * 1024 * 1024)
      throw new Error('백업 파일이 너무 큽니다.');
    const data = JSON.parse(
      zlib
        .gunzipSync(fs.readFileSync(file), {
          maxOutputLength: 72 * 1024 * 1024,
        })
        .toString('utf8'),
    );
    if (
      data.format !== 'aruavatars' ||
      data.version !== 1 ||
      !Array.isArray(data.assets) ||
      data.assets.length > LIMITS.assets
    )
      throw new Error('지원하지 않는 백업입니다.');
    const config = validateConfig(
      {
        ...migrateConfig(data.config),
        enabled: false,
        paused: false,
        port: this.config.port,
      },
      this.config,
    );
    const buffers = new Map();
    let total = 0;
    for (const a of data.assets) {
      if (
        !assetId(a.name) ||
        typeof a.data !== 'string' ||
        a.data.length > LIMITS.fileBytes * 1.4 ||
        buffers.has(a.name)
      )
        throw new Error('백업 이미지가 올바르지 않습니다.');
      const buffer = Buffer.from(a.data, 'base64');
      total += buffer.length;
      if (total > LIMITS.totalBytes)
        throw new Error('백업 이미지 용량을 초과했습니다.');
      const meta = await validateImage(buffer);
      if (meta.asset !== a.name)
        throw new Error('백업 이미지 무결성 오류입니다.');
      buffers.set(a.name, buffer);
    }
    for (const a of config.avatars)
      for (const s of Object.values(a.states))
        if (!buffers.has(s.asset))
          throw new Error('백업에 필요한 이미지가 없습니다.');
    // Validate everything before changing live configuration; retain old files until commit.
    for (const [name, buffer] of buffers)
      if (!fs.existsSync(this.assetPath(name)))
        fs.writeFileSync(this.assetPath(name), buffer, {
          flag: 'wx',
          mode: 0o600,
        });
    this.saveConfig(config);
    this.pruneAssets();
    return this.config;
  }
}
module.exports = { AvatarStorage, validateImage, atomicWrite };
