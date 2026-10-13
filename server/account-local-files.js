import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

function unsafe(code) {
  throw Object.assign(new Error(code), { code });
}

export function automationSoundOwnerKey(ownerUserId) {
  if (typeof ownerUserId !== 'string' || !ownerUserId.trim()) unsafe('INVALID_AUTOMATION_OWNER');
  // Preserve the exact owner bytes used by the upload path; do not strip user:.
  return createHash('sha256').update(ownerUserId).digest('hex').slice(0, 32);
}

function assertContained(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    unsafe('UNSAFE_AUTOMATION_SOUND_PATH');
  }
}

/** Remove only this owner's uploaded sounds. Missing directories are already clean. */
export function deleteAccountAutomationSoundFiles(ownerUserId, {
  root = process.env.AUTOMATION_USER_FILE_ROOT || path.join(process.cwd(), 'server', 'user-files', 'automation'),
} = {}) {
  const ownerKey = automationSoundOwnerKey(ownerUserId);
  if (typeof root !== 'string' || !root.trim()) unsafe('INVALID_AUTOMATION_FILE_ROOT');
  const absoluteRoot = path.resolve(root);
  if (absoluteRoot === path.parse(absoluteRoot).root) unsafe('UNSAFE_AUTOMATION_FILE_ROOT');
  assertContained(absoluteRoot, path.resolve(absoluteRoot, ownerKey, 'sounds'));
  try {
    // Resolve a configured storage-root symlink once, then refuse owner/sounds
    // symlinks or junctions so recursive removal cannot traverse another owner.
    const realRoot = fs.realpathSync(absoluteRoot);
    if (realRoot === path.parse(realRoot).root) unsafe('UNSAFE_AUTOMATION_FILE_ROOT');
    const ownerDirectory = path.resolve(realRoot, ownerKey);
    const target = path.resolve(ownerDirectory, 'sounds');
    assertContained(realRoot, ownerDirectory);
    assertContained(realRoot, target);
    for (const directory of [ownerDirectory, target]) {
      const stat = fs.lstatSync(directory);
      if (stat.isSymbolicLink() || !stat.isDirectory()) unsafe('UNSAFE_AUTOMATION_SOUND_PATH');
      assertContained(realRoot, fs.realpathSync(directory));
    }
    fs.rmSync(target, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
}
