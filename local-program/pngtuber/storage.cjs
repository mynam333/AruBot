const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { atomicWrite } = require('../avatars/storage.cjs');
const { LIMITS, assetId, text, defaultConfig, validateConfig, referencedAssets } = require('./schema.cjs');

async function validateImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > LIMITS.fileBytes)
    throw new Error('Images must be at most 20 MiB');
  const decoder = sharp(buffer, { animated: true, limitInputPixels: LIMITS.pixels, failOn: 'warning' });
  const meta = await decoder.metadata();
  const ext = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp' }[meta.format];
  const pixels = meta.width * (meta.pageHeight || meta.height) * (meta.pages || 1);
  if (!ext || !(pixels > 0) || pixels > LIMITS.pixels || (meta.pages || 1) > 240)
    throw new Error('Use PNG/JPEG/GIF/WebP, at most 16 million decoded pixels and 240 frames');
  // Decode for validation, but store the original bytes so GIF/WebP animation survives.
  await decoder.raw().toBuffer();
  return `${crypto.createHash('sha256').update(buffer).digest('hex')}.${ext}`;
}
class PngTuberStorage {
  constructor(root) {
    this.root = root;
    this.assetRoot = path.join(root, 'assets');
    this.file = path.join(root, 'config.json');
    this.catalogFile = path.join(root, 'assets.json');
    this.warning = '';
    fs.mkdirSync(this.assetRoot, { recursive: true });
    this.config = this.load();
    this.names = {};
    try {
      if (fs.statSync(this.catalogFile).size < 128 * 1024) {
        const names = JSON.parse(fs.readFileSync(this.catalogFile, 'utf8'));
        for (const [id, name] of Object.entries(names).slice(0, LIMITS.assets))
          if (assetId(id)) this.names[id] = text(path.basename(String(name)), 128);
      }
    } catch { /* Asset names are optional; content-addressed files remain usable. */ }
  }
  load() {
    let found = false;
    for (const suffix of ['', '.bak']) {
      const file = this.file + suffix;
      if (!fs.existsSync(file)) continue;
      found = true;
      try {
        if (fs.statSync(file).size > 128 * 1024) throw new Error('Oversized config');
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        const base = defaultConfig();
        if (/^[a-f0-9]{48}$/.test(raw.key)) base.key = raw.key;
        const config = validateConfig(raw, base);
        this.ensureAssets(config);
        if (suffix) {
          this.warning = 'Recovered PNGTuber settings from backup';
          atomicWrite(this.file, JSON.stringify(config), false);
        } else if (raw.key !== config.key) atomicWrite(this.file, JSON.stringify(config));
        return config;
      } catch (error) {
        if (error.code === 'FUTURE_CONFIG_VERSION') throw error;
      }
    }
    if (found) throw new Error('PNGTuber settings could not be recovered; original files were preserved');
    const config = defaultConfig();
    atomicWrite(this.file, JSON.stringify(config));
    return config;
  }
  assetPath(id) {
    if (!assetId(id)) throw new Error('Invalid image asset');
    return path.join(this.assetRoot, id);
  }
  hasAsset(id) {
    try {
      const stat = fs.lstatSync(this.assetPath(id));
      return stat.isFile() && !stat.isSymbolicLink() && stat.size <= LIMITS.fileBytes;
    } catch { return false; }
  }
  ensureAssets(config) {
    for (const id of referencedAssets(config))
      if (!this.hasAsset(id)) throw new Error('Image asset is missing; import it again');
  }
  saveConfig(next) {
    const config = validateConfig(next, this.config);
    this.ensureAssets(config);
    atomicWrite(this.file, JSON.stringify(config));
    this.config = config;
    return config;
  }
  assets() {
    return fs.readdirSync(this.assetRoot).filter((id) => assetId(id) && this.hasAsset(id))
      .slice(0, LIMITS.assets).map((id) => ({ id, name: this.names[id] || id }));
  }
  async importAsset(filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Choose a local image file');
    const stat = await fs.promises.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS.fileBytes) throw new Error('Choose an image of at most 20 MiB');
    const file = await fs.promises.open(filePath, 'r');
    let buffer;
    try {
      const bytes = Buffer.alloc(Math.min(stat.size + 1, LIMITS.fileBytes + 1));
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset !== stat.size) throw new Error('Image changed during import');
      buffer = bytes.subarray(0, offset);
    } finally { await file.close(); }
    const id = await validateImage(buffer);
    if (!this.hasAsset(id)) {
      if (this.assets().length >= LIMITS.assets) throw new Error('Image library is full (256 images)');
      atomicWrite(this.assetPath(id), buffer, false);
    }
    const names = { ...this.names, [id]: text(path.basename(filePath), 128) };
    atomicWrite(this.catalogFile, JSON.stringify(names));
    this.names = names;
    return id;
  }
}
module.exports = { PngTuberStorage, validateImage };
