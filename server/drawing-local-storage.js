import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MAX_ORIGINAL_BYTES } from '../shared/drawing/limits.js';

export function drawingStorageDirectory() {
  if (process.env.DRAWING_DONATION_STORAGE_DIR) return path.resolve(process.env.DRAWING_DONATION_STORAGE_DIR);
  let base = process.cwd();
  // Release deployments share a symlinked .env; keep artwork beside its real target.
  try { base = path.dirname(realpathSync(path.join(base, '.env'))); } catch { /* Local development without .env. */ }
  return path.join(base, '.drawing-donations');
}

export function createLocalDrawingStorage(directory = drawingStorageDirectory()) {
  const root = path.resolve(directory);
  function location(key) {
    const raw = String(key).replace(/^local:/, '');
    const parts = raw.split('/');
    if (raw.length > 500 || parts[0] !== 'drawing-donations' || parts.length < 3 || parts.some((part) => !/^[a-zA-Z0-9_:.-]+$/.test(part) || part === '.' || part === '..')) throw new Error('drawing_invalid_storage_key');
    const target = path.resolve(root, ...parts.map(encodeURIComponent));
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('drawing_invalid_storage_key');
    return { raw, target };
  }
  async function ensureParents(target, create) {
    if (create) await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const relative = path.relative(root, path.dirname(target));
    let current = root;
    for (const part of relative.split(path.sep)) {
      current = path.join(current, part);
      if (create) await fs.mkdir(current, { mode: 0o700 }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('drawing_invalid_storage_key');
    }
  }
  return {
    async write(key, payload) {
      const { raw, target } = location(key);
      if (Buffer.byteLength(payload) > MAX_ORIGINAL_BYTES) throw new Error('drawing_too_large');
      await ensureParents(target, true);
      const temporary = `${target}.${crypto.randomUUID()}.tmp`;
      let handle;
      try {
        handle = await fs.open(temporary, 'wx', 0o600);
        await handle.writeFile(payload); await handle.sync(); await handle.close(); handle = null;
        await fs.rename(temporary, target);
      } finally {
        await handle?.close().catch(() => undefined);
        await fs.unlink(temporary).catch(() => undefined);
      }
      return `local:${raw}`;
    },
    async read(key) {
      const { target } = location(key);
      await ensureParents(target, false);
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ORIGINAL_BYTES) throw new Error('drawing_original_unavailable');
      return fs.readFile(target);
    },
    async remove(keys) {
      let deleted = 0;
      for (const key of keys) {
        const { target } = location(key);
        try { await ensureParents(target, false); await fs.unlink(target); deleted++; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      return { deleted, skipped: 0 };
    },
    async cleanupUploads(now = Date.now()) {
      const base = path.join(root, 'drawing-donations', 'uploads');
      const owners = await fs.readdir(base, { withFileTypes: true }).catch((error) => { if (error.code === 'ENOENT') return []; throw error; });
      let deleted = 0;
      for (const owner of owners) {
        if (!owner.isDirectory() || !/^[a-f0-9]{32}$/.test(owner.name)) continue;
        const files = await fs.readdir(path.join(base, owner.name), { withFileTypes: true });
        const keys = files.filter((file) => file.isFile() && /^[0-9]{13}-[a-f0-9-]{36}\.png$/.test(file.name) && Number(file.name.slice(0, 13)) < now - 86400000)
          .map((file) => `local:drawing-donations/uploads/${owner.name}/${file.name}`);
        deleted += (await this.remove(keys)).deleted;
      }
      return { deleted };
    },
  };
}
