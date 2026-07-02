import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const localProgramVersion = process.env.ARUBOT_LOCAL_VERSION || packageJson.version;
const outputDir = path.join(root, 'public', 'downloads', 'local-program');
const installerDir = process.env.ARUBOT_LOCAL_INSTALLER_DIR
  ? path.resolve(root, process.env.ARUBOT_LOCAL_INSTALLER_DIR)
  : outputDir;
const extraOutputDirs = String(process.env.ARUBOT_LOCAL_MANIFEST_EXTRA_DIRS || '')
  .split(path.delimiter)
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => path.resolve(root, item));

function buildDownloadUrl(fileName) {
  const explicitUrl = String(process.env.ARUBOT_LOCAL_DOWNLOAD_URL || '').trim();
  if (explicitUrl) return explicitUrl;

  const baseUrl = String(process.env.ARUBOT_LOCAL_DOWNLOAD_BASE_URL || '').trim();
  if (baseUrl) return `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(fileName)}`;

  if (process.env.ARUBOT_LOCAL_REQUIRE_EXTERNAL_URL === 'true') {
    throw new Error('External release mode requires ARUBOT_LOCAL_DOWNLOAD_URL or ARUBOT_LOCAL_DOWNLOAD_BASE_URL.');
  }

  return `/downloads/local-program/${fileName}`;
}

function findInstaller() {
  if (!fs.existsSync(installerDir)) return null;
  const files = fs.readdirSync(installerDir)
    .filter((fileName) => /^AruBot-Local-Program-.+\.exe$/i.test(fileName))
    .map((fileName) => {
      const fullPath = path.join(installerDir, fileName);
      const stat = fs.statSync(fullPath);
      return { fileName, fullPath, stat };
    })
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  return files[0] || null;
}

const installer = findInstaller();

if (!installer) {
  throw new Error(`No AruBot local program installer found in ${installerDir}`);
}

const buffer = fs.readFileSync(installer.fullPath);
const manifest = {
  product: 'AruBot Local Program',
  version: localProgramVersion,
  platform: 'win32',
  arch: 'x64',
  fileName: installer.fileName,
  url: buildDownloadUrl(installer.fileName),
  sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  size: installer.stat.size,
  releasedAt: new Date(installer.stat.mtimeMs).toISOString(),
  notes: [
    '방송 PC 로컬 자동화 큐 처리',
    'T.I.T.S., Toonation, TTS, 사운드 재생 지원',
    '설치 마법사 없이 프로그램 안에서 업데이트 적용 지원',
  ],
};

fs.mkdirSync(outputDir, { recursive: true });
const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
const writtenPaths = new Set();

function writeManifest(targetDir) {
  const resolvedDir = path.resolve(targetDir);
  if (!resolvedDir.startsWith(root)) {
    throw new Error(`Refusing to write manifest outside workspace: ${resolvedDir}`);
  }
  fs.mkdirSync(resolvedDir, { recursive: true });
  const targetPath = path.join(resolvedDir, 'latest.json');
  fs.writeFileSync(targetPath, manifestJson, 'utf8');
  writtenPaths.add(targetPath);
}

writeManifest(outputDir);
for (const dir of extraOutputDirs) writeManifest(dir);

for (const targetPath of writtenPaths) {
  console.log(`Wrote ${path.relative(root, targetPath)}`);
}
