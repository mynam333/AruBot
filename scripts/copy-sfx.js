// Copies roulette SFX files from server/files to public/files so the frontend can serve them as /files/*
// Run before dev/build so the assets are present in the frontend output

import fs from 'fs';
import path from 'path';

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch {}
}

function copyIfExists(src, dest) {
  try {
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`[copy-sfx] Copied ${path.basename(src)} -> ${dest}`);
      return true;
    } else {
      console.warn(`[copy-sfx] Source not found: ${src}`);
      return false;
    }
  } catch (e) {
    console.warn(`[copy-sfx] Failed to copy ${src} -> ${dest}:`, e?.message || e);
    return false;
  }
}

(function main(){
  const root = process.cwd();
  const srcDir = path.join(root, 'server', 'files');
  const dstDir = path.join(root, 'public', 'files');
  ensureDir(dstDir);

  const files = [
    'roulette_start.weba',
    'roulette_end.mp3',
    'logo.png',
  ];

  let okAny = false;
  for (const f of files) {
    const src = path.join(srcDir, f);
    const dest = path.join(dstDir, f);
    const ok = copyIfExists(src, dest);
    okAny = okAny || ok;
  }

  if (!okAny) {
    console.warn('[copy-sfx] No SFX files copied. Ensure server/files/* exist.');
  }
})();
