import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDir = join(root, 'browser-extension');
const outRoot = join(root, 'dist', 'browser-extension');
const versionFile = join(sourceDir, 'version.json');
const buildVersion = nextBuildVersion();

const files = [
  'background.js',
  'content-youtube.js',
  'popup.html',
  'popup.css',
  'popup.js',
  'options.html',
  'options.css',
  'options.js',
  'README.md',
  'icons'
];

const localHostPermissions = new Set([
  'http://localhost/*',
  'http://127.0.0.1/*',
  'ws://localhost/*',
  'ws://127.0.0.1/*'
]);

function cleanDir(path) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

function copySource(targetDir) {
  for (const file of files) {
    const src = join(sourceDir, file);
    if (!existsSync(src)) continue;
    cpSync(src, join(targetDir, file), { recursive: true });
  }
}

function buildManifest(browser) {
  const manifest = JSON.parse(readFileSync(join(sourceDir, 'manifest.json'), 'utf8'));
  manifest.version = buildVersion;
  manifest.host_permissions = (manifest.host_permissions || []).filter((pattern) => !localHostPermissions.has(pattern));

  if (browser === 'chrome') {
    delete manifest.browser_specific_settings;
  } else if (browser === 'firefox') {
    manifest.browser_specific_settings = {
      gecko: {
        id: 'aru-pause@yuaru.com',
        strict_min_version: '121.0'
      }
    };
  }

  return manifest;
}

function nextBuildVersion() {
  const state = readVersionState();
  state.build += 1;
  if (state.build > 65535) {
    const parts = parseBaseVersion(state.base);
    parts[2] += 1;
    state.base = parts.join('.');
    state.build = 1;
  }
  writeFileSync(versionFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return `${state.base}.${state.build}`;
}

function readVersionState() {
  let state = null;
  if (existsSync(versionFile)) {
    state = JSON.parse(readFileSync(versionFile, 'utf8'));
  }
  const base = typeof state?.base === 'string' ? state.base : '0.1.0';
  const build = Number.isInteger(state?.build) ? state.build : 0;
  parseBaseVersion(base);
  return { base, build: Math.max(0, build) };
}

function parseBaseVersion(base) {
  const parts = String(base).split('.').map((value) => Number(value));
  if (parts.length !== 3 || parts.some((value) => !Number.isInteger(value) || value < 0 || value > 65535)) {
    throw new Error('browser-extension/version.json base must be three integers between 0 and 65535');
  }
  return parts;
}

function writeManifest(targetDir, browser) {
  writeFileSync(
    join(targetDir, 'manifest.json'),
    `${JSON.stringify(buildManifest(browser), null, 2)}\n`,
    'utf8'
  );
}

function zipDirectory(source, targetZip) {
  rmSync(targetZip, { force: true });
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const filePath of listFiles(source)) {
    const name = relative(source, filePath).replace(/\\/g, '/');
    const nameBuffer = Buffer.from(name, 'utf8');
    const data = readFileSync(filePath);
    const crc = crc32(data);
    const { time, date } = dosDateTime(statSync(filePath).mtime);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(centralParts.length / 2, 8);
  end.writeUInt16LE(centralParts.length / 2, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  writeFileSync(targetZip, Buffer.concat([...localParts, ...centralParts, end]));
}

function listFiles(dir) {
  const result = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      result.push(...listFiles(path));
    } else if (stat.isFile()) {
      result.push(path);
    }
  }
  return result.sort((a, b) => a.localeCompare(b));
}

function dosDateTime(value) {
  const date = new Date(value);
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function build(browser) {
  const targetDir = join(outRoot, browser);
  cleanDir(targetDir);
  copySource(targetDir);
  writeManifest(targetDir, browser);

  const zipPath = join(outRoot, `aru-pause-${browser}-v${buildVersion}.zip`);
  zipDirectory(targetDir, zipPath);
  return { targetDir, zipPath };
}

cleanDir(outRoot);
const chrome = build('chrome');
const firefox = build('firefox');

console.log('Built browser extension packages:');
console.log(`- Chrome: ${chrome.zipPath}`);
console.log(`- Firefox: ${firefox.zipPath}`);
console.log(`Version: ${buildVersion}`);
