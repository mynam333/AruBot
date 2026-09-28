import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalDrawingStorage } from '../server/drawing-local-storage.js';

async function temporaryStorage(run) {
  const base = path.resolve(os.tmpdir()), root = await fs.mkdtemp(path.join(base, 'arubot-drawing-test-'));
  try { await run(createLocalDrawingStorage(root), root); }
  finally {
    assert.equal(path.dirname(path.resolve(root)), base);
    assert.ok(path.basename(root).startsWith('arubot-drawing-test-'));
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('local original storage round-trips exact bytes and survives a new adapter', async () => {
  await temporaryStorage(async (storage, root) => {
    const bytes = Buffer.from([0, 255, 32, 128, 17]), key = 'drawing-donations/user:streamer/drawing-id/original.png';
    const stored = await storage.write(key, bytes); assert.equal(stored, `local:${key}`);
    assert.deepEqual(await createLocalDrawingStorage(root).read(stored), bytes);
    await storage.write(key, bytes); assert.deepEqual(await storage.read(stored), bytes);
    assert.equal((await storage.remove([stored])).deleted, 1);
    await assert.rejects(storage.read(stored), { code: 'ENOENT' });
  });
});

test('local storage rejects directory traversal and oversized uploads', async () => {
  await temporaryStorage(async (storage) => {
    for (const key of ['drawing-donations/../../secret', 'local:drawing-donations/%2e%2e/file', 'C:/outside/secret', 'drawing-donations/a\\..\\b/file']) {
      await assert.rejects(storage.write(key, Buffer.from('test')), /drawing_invalid_storage_key/);
      await assert.rejects(storage.read(key), /drawing_invalid_storage_key/);
    }
    await assert.rejects(storage.write('drawing-donations/owner/id/huge.png', Buffer.alloc(8 * 1024 * 1024 + 1)), /drawing_too_large/);
  });
});

test('temporary cleanup deletes only expired uploads, never accepted artwork', async () => {
  await temporaryStorage(async (storage) => {
    const now = 1760000000000, owner = 'a'.repeat(32), id = 'a'.repeat(36);
    const expired = await storage.write(`drawing-donations/uploads/${owner}/${now - 86400001}-${id}.png`, 'old');
    const fresh = await storage.write(`drawing-donations/uploads/${owner}/${now}-${id}.png`, 'fresh');
    const accepted = await storage.write(`drawing-donations/${owner}/accepted/original.png`, 'accepted');
    assert.equal((await storage.cleanupUploads(now)).deleted, 1);
    await assert.rejects(storage.read(expired), { code: 'ENOENT' });
    assert.equal((await storage.read(fresh)).toString(), 'fresh');
    assert.equal((await storage.read(accepted)).toString(), 'accepted');
  });
});
