const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const dgram = require('dgram');
const { pathToFileURL } = require('url');
const { WebSocket } = require('ws');

const APP_NAME = 'AruBot Local Program';
const LEGACY_UPDATE_MANIFEST_URL = 'https://arubot.vercel.app/downloads/local-program/latest.json';
const DEFAULT_UPDATE_MANIFEST_URL = 'https://github.com/mynam333/AruBot/releases/latest/download/latest.json';
const LEGACY_DASHBOARD_URL = 'https://arubot.vercel.app';
const DEFAULT_BACKEND_URL = 'https://arubotapi.yuaru.com';
const DEFAULT_DASHBOARD_URL = 'https://arubot.yuaru.com';

function readBuildEnv() {
  try {
    return require('./runtime-env.cjs') || {};
  } catch {
    return {};
  }
}

const BUILD_ENV = readBuildEnv();

function cleanUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function getSafeExternalHttpUrl(rawUrl) {
  const url = new URL(String(rawUrl || ''));
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('외부 링크는 http/https URL만 열 수 있습니다.');
  }
  return url.toString();
}

function normalizeLocalProgramToken(value) {
  let text = String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
  const directMatch = text.match(/\balp_[A-Za-z0-9_-]{20,}\b/);
  if (directMatch) return directMatch[0];
  text = text
    .replace(/^bearer\s+/i, '')
    .replace(/^(토큰|token)\s*[:：]\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[\u0000-\u001F\u007F\s]+/g, '')
    .trim();
  const cleanedMatch = text.match(/\balp_[A-Za-z0-9_-]{20,}\b/);
  return cleanedMatch ? cleanedMatch[0] : text;
}

function resolveBuildValue(...keys) {
  for (const key of keys) {
    const value = process.env[key] || BUILD_ENV[key];
    if (String(value || '').trim()) return String(value).trim();
  }
  return '';
}

const DEFAULT_CONFIG = {
  backendUrl: cleanUrl(resolveBuildValue('ARUBOT_LOCAL_BACKEND_URL', 'BACKEND_ORIGIN', 'NEXT_PUBLIC_API_BASE', 'NEXT_PUBLIC_API_BASE_URL', 'NEXT_PUBLIC_BACKEND_URL')) || DEFAULT_BACKEND_URL,
  updateManifestUrl: cleanUrl(resolveBuildValue('ARUBOT_LOCAL_UPDATE_MANIFEST_URL')) || DEFAULT_UPDATE_MANIFEST_URL,
  dashboardUrl: cleanUrl(resolveBuildValue('ARUBOT_LOCAL_DASHBOARD_URL', 'FRONTEND_ORIGIN', 'NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SITE_URL')) || DEFAULT_DASHBOARD_URL,
  token: '',
  titsEndpoint: 'ws://localhost:42069',
  vtubeEndpoint: 'ws://localhost:8001',
  vtubeAuthToken: '',
  soundFolder: '',
  autoStart: false,
};

let mainWindow = null;
let running = false;
let agentSocket = null;
let agentSocketReconnectTimer = null;
let agentSocketHeartbeatTimer = null;
let agentPollingTimer = null;
let reconnectAttempt = 0;
let processingJobs = false;
let config = { ...DEFAULT_CONFIG };
let logs = [];
let updateState = {
  status: 'idle',
  checking: false,
  latestVersion: null,
  updateAvailable: false,
  downloaded: false,
  readyToApply: false,
  progress: null,
  error: null,
};
let pendingInstallerUpdate = null;
let stats = {
  claimed: 0,
  completed: 0,
  failed: 0,
  lastHeartbeatAt: null,
  lastJobAt: null,
};

function dataPath(fileName) {
  return path.join(app.getPath('userData'), fileName);
}

function tempUpdatePath(fileName) {
  return path.join(app.getPath('temp'), 'arubot-local-updates', fileName);
}

function emitState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('agent-state', getPublicState());
}

function setUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  emitState();
}

function sendRendererTask(task) {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('GUI 창이 준비되지 않았습니다.');
  mainWindow.webContents.send('local-task', task);
  return { accepted: true, taskType: task.type, at: new Date().toISOString() };
}

function isPrivateIpAddress(value) {
  const ipVersion = net.isIP(value);
  if (!ipVersion) return false;
  if (ipVersion === 4) {
    const parts = value.split('.').map((part) => Number(part));
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const normalized = value.toLowerCase();
  return normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.');
}

async function assertSafeExternalHttpUrl(rawUrl, options = {}) {
  const url = new URL(String(rawUrl || ''));
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('HTTP 노드는 http/https URL만 사용할 수 있습니다.');
  if (url.protocol === 'http:' && options.allowInsecureHttp !== true) throw new Error('HTTP 노드는 기본적으로 HTTPS만 허용합니다.');
  const hostname = url.hostname;
  const lowerHost = hostname.toLowerCase();
  if (!options.allowPrivateNetwork && (
    lowerHost === 'localhost' ||
    lowerHost.endsWith('.localhost') ||
    isPrivateIpAddress(hostname)
  )) {
    throw new Error('HTTP 노드는 localhost 또는 사설망 주소로 요청할 수 없습니다.');
  }
  if (!options.allowPrivateNetwork && !net.isIP(hostname)) {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!records.length || records.some((record) => isPrivateIpAddress(record.address))) {
      throw new Error('HTTP 노드 대상 도메인이 사설망 주소로 확인되어 차단했습니다.');
    }
  }
  return url;
}

function parseMaybeJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function addLog(level, message, details = null) {
  logs.push({
    id: crypto.randomBytes(6).toString('hex'),
    at: new Date().toISOString(),
    level,
    message,
    details,
  });
  logs = logs.slice(-120);
  emitState();
}

function encryptText(value) {
  const text = String(value || '');
  if (!text) return '';
  if (safeStorage.isEncryptionAvailable()) {
    return `safe:${safeStorage.encryptString(text).toString('base64')}`;
  }
  return `plain:${Buffer.from(text, 'utf8').toString('base64')}`;
}

function decryptText(value) {
  const raw = String(value || '');
  if (!raw) return '';
  try {
    if (raw.startsWith('safe:') && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(raw.slice(5), 'base64'));
    }
    if (raw.startsWith('plain:')) return Buffer.from(raw.slice(6), 'base64').toString('utf8');
  } catch {
    return '';
  }
  return raw;
}

function readJson(fileName, fallback) {
  try {
    const fullPath = dataPath(fileName);
    if (!fs.existsSync(fullPath)) return fallback;
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(fileName, value) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(dataPath(fileName), JSON.stringify(value, null, 2), 'utf8');
}

function deleteJson(fileName) {
  try {
    fs.rmSync(dataPath(fileName), { force: true });
  } catch {}
}

function loadPendingUpdate() {
  const pending = readJson('pending-update.json', null);
  if (!pending?.installerPath || !pending?.latestVersion) return null;
  if (!fs.existsSync(pending.installerPath)) {
    deleteJson('pending-update.json');
    return null;
  }
  if (compareVersions(pending.latestVersion, app.getVersion()) <= 0) {
    deleteJson('pending-update.json');
    return null;
  }
  pendingInstallerUpdate = pending;
  setUpdateState({
    status: 'ready',
    latestVersion: pending.latestVersion,
    updateAvailable: true,
    downloaded: true,
    readyToApply: true,
    error: null,
    progress: null,
  });
  return pending;
}

function persistPendingInstallerUpdate(update, installerPath) {
  const pending = {
    latestVersion: update.latestVersion,
    installerPath,
    sha256: update.sha256 || '',
    downloadedAt: new Date().toISOString(),
  };
  pendingInstallerUpdate = pending;
  writeJson('pending-update.json', pending);
  return pending;
}

function clearPendingInstallerUpdate() {
  pendingInstallerUpdate = null;
  deleteJson('pending-update.json');
}

function loadConfig() {
  const persisted = readJson('config.json', {});
  const vault = readJson('vault.json', {});
  if (!persisted.updateManifestUrl || persisted.updateManifestUrl === LEGACY_UPDATE_MANIFEST_URL) {
    persisted.updateManifestUrl = DEFAULT_UPDATE_MANIFEST_URL;
  }
  if (!persisted.dashboardUrl || persisted.dashboardUrl === LEGACY_DASHBOARD_URL) {
    persisted.dashboardUrl = DEFAULT_DASHBOARD_URL;
  }
  const backendUrl = DEFAULT_CONFIG.backendUrl || cleanUrl(persisted.backendUrl) || DEFAULT_BACKEND_URL;
  const updateManifestUrl = DEFAULT_CONFIG.updateManifestUrl || cleanUrl(persisted.updateManifestUrl) || DEFAULT_UPDATE_MANIFEST_URL;
  const dashboardUrl = DEFAULT_CONFIG.dashboardUrl || cleanUrl(persisted.dashboardUrl) || DEFAULT_DASHBOARD_URL;
  config = {
    ...DEFAULT_CONFIG,
    ...persisted,
    backendUrl,
    updateManifestUrl,
    dashboardUrl,
    token: normalizeLocalProgramToken(decryptText(vault.token)),
    vtubeAuthToken: decryptText(vault.vtubeAuthToken),
  };
  return config;
}

function saveConfig(next) {
  config = {
    ...config,
    ...next,
    backendUrl: DEFAULT_CONFIG.backendUrl || cleanUrl(config.backendUrl) || DEFAULT_BACKEND_URL,
    updateManifestUrl: DEFAULT_CONFIG.updateManifestUrl || cleanUrl(config.updateManifestUrl) || DEFAULT_UPDATE_MANIFEST_URL,
    dashboardUrl: DEFAULT_CONFIG.dashboardUrl || cleanUrl(config.dashboardUrl) || DEFAULT_DASHBOARD_URL,
    token: normalizeLocalProgramToken(next.token ?? config.token ?? ''),
    titsEndpoint: String(next.titsEndpoint ?? config.titsEndpoint ?? '').trim() || DEFAULT_CONFIG.titsEndpoint,
    vtubeEndpoint: String(next.vtubeEndpoint ?? config.vtubeEndpoint ?? '').trim() || DEFAULT_CONFIG.vtubeEndpoint,
    vtubeAuthToken: String(next.vtubeAuthToken ?? config.vtubeAuthToken ?? '').trim(),
    soundFolder: String(next.soundFolder ?? config.soundFolder ?? '').trim(),
    autoStart: !!(next.autoStart ?? config.autoStart),
  };
  writeJson('config.json', {
    titsEndpoint: config.titsEndpoint,
    vtubeEndpoint: config.vtubeEndpoint,
    soundFolder: config.soundFolder,
    autoStart: config.autoStart,
  });
  writeJson('vault.json', {
    token: encryptText(config.token),
    vtubeAuthToken: encryptText(config.vtubeAuthToken),
  });
  emitState();
  return getPublicState();
}

function getPublicState() {
  return {
    version: app.getVersion(),
    running,
    config: {
      token: config.token ? `${config.token.slice(0, 8)}...${config.token.slice(-4)}` : '',
      hasToken: !!config.token,
      titsEndpoint: config.titsEndpoint,
      vtubeEndpoint: config.vtubeEndpoint,
      vtubeAuthToken: config.vtubeAuthToken ? `${config.vtubeAuthToken.slice(0, 8)}...` : '',
      hasVtubeAuthToken: !!config.vtubeAuthToken,
      soundFolder: config.soundFolder,
      autoStart: config.autoStart,
      connectionMode: 'websocket',
    },
    stats,
    logs,
    update: updateState,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
  };
}

function normalizeBackendUrl() {
  return String(config.backendUrl || '').replace(/\/$/, '');
}

function normalizeVersion(version) {
  return String(version || '')
    .replace(/^v/i, '')
    .split(/[+-]/)[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(left, right) {
  const a = normalizeVersion(left);
  const b = normalizeVersion(right);
  const length = Math.max(a.length, b.length, 3);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function resolveManifestUrl() {
  const url = String(config.updateManifestUrl || '').trim();
  if (!url) throw new Error('업데이트 manifest 주소가 설정되어 있지 않습니다.');
  return url;
}

function resolveDownloadUrl(manifest, manifestUrl) {
  const raw = String(manifest?.url || manifest?.downloadUrl || '').trim();
  if (!raw) throw new Error('업데이트 파일 주소가 manifest에 없습니다.');
  return new URL(raw, manifestUrl).toString();
}

function getUpdaterFeedUrl() {
  const manifestUrl = resolveManifestUrl();
  const url = new URL(manifestUrl);
  url.pathname = url.pathname.replace(/\/[^/]*$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.setFeedURL({ provider: 'generic', url: getUpdaterFeedUrl() });
}

function checkForUpdatesWithElectronUpdater() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      autoUpdater.off('update-available', onAvailable);
      autoUpdater.off('update-not-available', onNotAvailable);
      autoUpdater.off('error', onError);
    };
    const finish = (value, error = null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const onAvailable = (info) => finish({
      currentVersion: app.getVersion(),
      latestVersion: String(info?.version || ''),
      updateAvailable: true,
      electronUpdater: true,
      info,
    });
    const onNotAvailable = (info) => finish({
      currentVersion: app.getVersion(),
      latestVersion: String(info?.version || app.getVersion()),
      updateAvailable: false,
      electronUpdater: true,
      info,
    });
    const onError = (error) => finish(null, error);
    autoUpdater.once('update-available', onAvailable);
    autoUpdater.once('update-not-available', onNotAvailable);
    autoUpdater.once('error', onError);
    configureAutoUpdater();
    autoUpdater.checkForUpdates().catch((error) => finish(null, error));
  });
}

function downloadUpdateWithElectronUpdater() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      autoUpdater.off('update-downloaded', onDownloaded);
      autoUpdater.off('download-progress', onProgress);
      autoUpdater.off('error', onError);
    };
    const finish = (value, error = null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const onProgress = (progress) => {
      setUpdateState({
        status: 'downloading',
        progress: {
          percent: Number(progress?.percent || 0),
          transferred: Number(progress?.transferred || 0),
          total: Number(progress?.total || 0),
        },
      });
    };
    const onDownloaded = (info) => finish(info || {});
    const onError = (error) => finish(null, error);
    autoUpdater.on('download-progress', onProgress);
    autoUpdater.once('update-downloaded', onDownloaded);
    autoUpdater.once('error', onError);
    autoUpdater.downloadUpdate().catch((error) => finish(null, error));
  });
}

async function fetchUpdateManifest() {
  const manifestUrl = resolveManifestUrl();
  const response = await fetch(manifestUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`업데이트 정보를 불러오지 못했습니다. HTTP ${response.status}`);
  const manifest = await response.json();
  const currentVersion = app.getVersion();
  const latestVersion = String(manifest.version || '').trim();
  if (!latestVersion) throw new Error('업데이트 manifest에 버전 정보가 없습니다.');
  const downloadUrl = resolveDownloadUrl(manifest, manifestUrl);
  return {
    currentVersion,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    downloadUrl,
    fileName: String(manifest.fileName || path.basename(new URL(downloadUrl).pathname) || 'AruBot-Local-Program.exe'),
    sha256: String(manifest.sha256 || ''),
    size: Number(manifest.size || 0),
    releasedAt: manifest.releasedAt || null,
    notes: Array.isArray(manifest.notes) ? manifest.notes : [],
  };
}

async function downloadInstaller(update) {
  const response = await fetch(update.downloadUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`설치 파일 다운로드 실패: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (update.sha256) {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (hash !== update.sha256) throw new Error('다운로드한 설치 파일의 무결성 확인에 실패했습니다.');
  }
  const updateDir = tempUpdatePath('');
  fs.mkdirSync(updateDir, { recursive: true });
  for (const fileName of fs.readdirSync(updateDir)) {
    if (/^AruBot-Local-Program-.+\.exe$/i.test(fileName) || /^apply-arubot-update-.+\.(ps1|cmd)$/i.test(fileName)) {
      fs.rmSync(path.join(updateDir, fileName), { force: true });
    }
  }
  const fileName = path.basename(update.fileName || 'AruBot-Local-Program.exe');
  const installerPath = path.join(updateDir, fileName);
  fs.writeFileSync(installerPath, buffer);
  return installerPath;
}

function quotePowerShellString(value) {
  return `'${String(value || '').replaceAll("'", "''")}'`;
}

function scheduleSilentInstallerOnQuit() {
  const pending = pendingInstallerUpdate;
  if (!pending?.installerPath || process.platform !== 'win32') return false;
  if (!fs.existsSync(pending.installerPath)) {
    clearPendingInstallerUpdate();
    return false;
  }

  const helperPath = tempUpdatePath(`apply-arubot-update-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.ps1`);
  fs.mkdirSync(path.dirname(helperPath), { recursive: true });
  const script = [
    '$ErrorActionPreference = "SilentlyContinue"',
    `$pidToWait = ${process.pid}`,
    `$installer = ${quotePowerShellString(pending.installerPath)}`,
    'while (Get-Process -Id $pidToWait) { Start-Sleep -Milliseconds 500 }',
    'if (Test-Path -LiteralPath $installer) {',
    '  $process = Start-Process -FilePath $installer -ArgumentList "/S" -WindowStyle Hidden -Wait -PassThru',
    '  if ($process.ExitCode -eq 0) { Remove-Item -LiteralPath $installer -Force }',
    '}',
    'Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force',
    '',
  ].join('\r\n');
  fs.writeFileSync(helperPath, script, 'utf8');
  const child = spawn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    helperPath,
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  clearPendingInstallerUpdate();
  return true;
}

async function apiFetch(pathname, options = {}) {
  const token = normalizeLocalProgramToken(config.token);
  if (!token) throw new Error('로컬 프로그램 토큰이 없습니다.');
  config.token = token;
  const response = await fetch(`${normalizeBackendUrl()}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Local-Agent-Token': token,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
  return data;
}

async function apiFetchBuffer(pathname) {
  const token = normalizeLocalProgramToken(config.token);
  if (!token) throw new Error('로컬 프로그램 토큰이 없습니다.');
  config.token = token;
  const response = await fetch(`${normalizeBackendUrl()}${pathname}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Local-Agent-Token': token },
  });
  if (!response.ok) throw new Error(`파일 다운로드 실패: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function getTitsEndpoint(endpoint, kind = 'data') {
  const raw = String(endpoint || config.titsEndpoint || DEFAULT_CONFIG.titsEndpoint).trim();
  const base = raw.endsWith('/websocket') || raw.endsWith('/events') ? raw.replace(/\/(websocket|events)$/, '') : raw.replace(/\/$/, '');
  return `${base}/${kind === 'events' ? 'events' : 'websocket'}`;
}

function makeTitsMessage(messageType, data = {}) {
  return {
    apiName: 'TITSPublicApi',
    apiVersion: '1.0',
    requestID: `arubot_local_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    messageType,
    ...(Object.keys(data || {}).length ? { data } : {}),
  };
}

function sendTitsRequest(messageType, data = {}, endpoint = config.titsEndpoint, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const payload = makeTitsMessage(messageType, data);
    const ws = new WebSocket(getTitsEndpoint(endpoint, 'data'));
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('T.I.T.S. 응답 시간이 초과되었습니다.'));
    }, timeoutMs);

    ws.once('open', () => ws.send(JSON.stringify(payload)));
    ws.on('message', (raw) => {
      try {
        const parsed = JSON.parse(String(raw));
        if (parsed?.requestID && parsed.requestID !== payload.requestID) return;
        clearTimeout(timer);
        try { ws.close(); } catch {}
        resolve(parsed);
      } catch (error) {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        reject(error);
      }
    });
    ws.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function normalizeTitsDiscovery(itemsResponse, triggersResponse) {
  const items = Array.isArray(itemsResponse?.data?.items)
    ? itemsResponse.data.items.map((item) => ({
      id: String(item.ID || item.id || ''),
      name: String(item.name || item.ID || ''),
      encodedImage: item.encodedImage || null,
    })).filter((item) => item.id)
    : [];
  const triggers = Array.isArray(triggersResponse?.data?.triggers)
    ? triggersResponse.data.triggers.map((trigger) => ({
      id: String(trigger.ID || trigger.id || ''),
      name: String(trigger.name || trigger.ID || ''),
    })).filter((trigger) => trigger.id || trigger.name)
    : [];
  return { items, triggers, fetchedAt: new Date().toISOString() };
}

async function discoverTits() {
  const [items, triggers] = await Promise.all([
    sendTitsRequest('TITSItemListRequest', { sendImage: true }),
    sendTitsRequest('TITSTriggerListRequest'),
  ]);
  return normalizeTitsDiscovery(items, triggers);
}

function getVtubeEndpoint(endpoint = config.vtubeEndpoint) {
  const raw = String(endpoint || DEFAULT_CONFIG.vtubeEndpoint).trim();
  return raw || DEFAULT_CONFIG.vtubeEndpoint;
}

function makeVtubeMessage(messageType, data = {}) {
  return {
    apiName: 'VTubeStudioPublicAPI',
    apiVersion: '1.0',
    requestID: `arubot_vts_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    messageType,
    data: data && typeof data === 'object' ? data : {},
  };
}

function getVtubePluginInfo() {
  return {
    pluginName: 'AruBot',
    pluginDeveloper: 'AruBot',
  };
}

function sendVtubeRequest(messageType, data = {}, options = {}) {
  return new Promise((resolve, reject) => {
    const endpoint = getVtubeEndpoint(options.endpoint);
    const payload = makeVtubeMessage(messageType, data);
    const ws = new WebSocket(endpoint);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('VTube Studio 응답 시간이 초과되었습니다.'));
    }, Math.max(1500, Math.min(30000, Number(options.timeoutMs || 7000))));

    ws.once('open', () => ws.send(JSON.stringify(payload)));
    ws.on('message', (raw) => {
      try {
        const parsed = JSON.parse(String(raw));
        if (parsed?.requestID && parsed.requestID !== payload.requestID) return;
        clearTimeout(timer);
        try { ws.close(); } catch {}
        if (parsed?.messageType === 'APIError') {
          reject(new Error(parsed?.data?.message || 'VTube Studio API 오류가 발생했습니다.'));
          return;
        }
        resolve(parsed);
      } catch (error) {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        reject(error);
      }
    });
    ws.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function openVtubeSocket(endpoint, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(endpoint);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('VTube Studio 연결 시간이 초과되었습니다.'));
    }, Math.max(1500, Math.min(30000, Number(timeoutMs || 7000))));
    ws.once('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function sendVtubeSocketRequest(ws, messageType, data = {}, options = {}) {
  return new Promise((resolve, reject) => {
    const payload = makeVtubeMessage(messageType, data);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('VTube Studio 응답 시간이 초과되었습니다.'));
    }, Math.max(1500, Math.min(30000, Number(options.timeoutMs || 7000))));

    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };
    const onMessage = (raw) => {
      try {
        const parsed = JSON.parse(String(raw));
        if (parsed?.requestID && parsed.requestID !== payload.requestID) return;
        cleanup();
        if (parsed?.messageType === 'APIError') {
          reject(new Error(parsed?.data?.message || 'VTube Studio API 오류가 발생했습니다.'));
          return;
        }
        resolve(parsed);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };

    ws.on('message', onMessage);
    ws.once('error', onError);
    ws.send(JSON.stringify(payload));
  });
}

async function sendAuthenticatedVtubeRequest(messageType, data = {}, options = {}) {
  const endpoint = getVtubeEndpoint(options.endpoint);
  const { pluginName, pluginDeveloper } = getVtubePluginInfo();
  let authToken = String(options.authToken || config.vtubeAuthToken || '').trim();
  if (!authToken) {
    const auth = await authenticateVtubeStudio({ endpoint, timeoutMs: options.timeoutMs });
    authToken = auth.authToken;
  }

  const ws = await openVtubeSocket(endpoint, options.timeoutMs || 7000);
  try {
    const authResponse = await sendVtubeSocketRequest(ws, 'AuthenticationRequest', {
      pluginName,
      pluginDeveloper,
      authenticationToken: authToken,
    }, { timeoutMs: options.timeoutMs || 7000 });
    if (authResponse?.data?.authenticated !== true) {
      throw new Error('VTube Studio 인증에 실패했습니다.');
    }
    return await sendVtubeSocketRequest(ws, messageType, data, options);
  } finally {
    try { ws.close(); } catch {}
  }
}

async function authenticateVtubeStudio(options = {}) {
  const endpoint = getVtubeEndpoint(options.endpoint);
  const { pluginName, pluginDeveloper } = getVtubePluginInfo();
  let authToken = String(options.authToken || config.vtubeAuthToken || '').trim();

  const authenticateWithToken = async (token) => {
    const response = await sendVtubeRequest('AuthenticationRequest', {
      pluginName,
      pluginDeveloper,
      authenticationToken: token,
    }, { endpoint, timeoutMs: options.timeoutMs || 7000 });
    return response?.data?.authenticated === true;
  };

  if (authToken) {
    const authenticated = await authenticateWithToken(authToken).catch(() => false);
    if (authenticated) return { authenticated: true, endpoint, authToken, reused: true };
  }

  const tokenResponse = await sendVtubeRequest('AuthenticationTokenRequest', {
    pluginName,
    pluginDeveloper,
  }, { endpoint, timeoutMs: Math.max(15000, Number(options.timeoutMs || 20000)) });
  authToken = String(tokenResponse?.data?.authenticationToken || '').trim();
  if (!authToken) throw new Error('VTube Studio 인증 토큰을 받지 못했습니다.');
  const authenticated = await authenticateWithToken(authToken);
  if (!authenticated) throw new Error('VTube Studio 인증에 실패했습니다.');
  saveConfig({ vtubeEndpoint: endpoint, vtubeAuthToken: authToken });
  return { authenticated: true, endpoint, authToken, reused: false };
}

function normalizeVtubeDiscovery(responses = {}, endpoint = config.vtubeEndpoint) {
  const current = responses.current?.data || {};
  const models = Array.isArray(responses.models?.data?.availableModels)
    ? responses.models.data.availableModels.map((model) => ({
      id: String(model.modelID || ''),
      name: String(model.modelName || model.vtsModelName || model.modelID || ''),
      loaded: model.modelLoaded === true,
      fileName: String(model.vtsModelName || ''),
      iconName: String(model.vtsModelIconName || ''),
    })).filter((model) => model.id)
    : [];
  const hotkeys = Array.isArray(responses.hotkeys?.data?.availableHotkeys)
    ? responses.hotkeys.data.availableHotkeys.map((hotkey) => ({
      id: String(hotkey.hotkeyID || ''),
      name: String(hotkey.name || hotkey.hotkeyID || ''),
      type: String(hotkey.type || ''),
      description: String(hotkey.description || ''),
      file: String(hotkey.file || ''),
    })).filter((hotkey) => hotkey.id || hotkey.name)
    : [];
  const expressions = Array.isArray(responses.expressions?.data?.expressions)
    ? responses.expressions.data.expressions.map((expression) => ({
      name: String(expression.name || expression.file || ''),
      file: String(expression.file || ''),
      active: expression.active === true,
    })).filter((expression) => expression.file || expression.name)
    : [];
  const itemData = responses.items?.data || {};
  const items = [
    ...(Array.isArray(itemData.itemsInScene) ? itemData.itemsInScene : []),
    ...(Array.isArray(itemData.availableItems) ? itemData.availableItems : []),
  ].map((item) => ({
    id: String(item.itemInstanceID || item.fileName || item.itemFileName || item.name || ''),
    name: String(item.name || item.fileName || item.itemFileName || item.itemInstanceID || ''),
    fileName: String(item.fileName || item.itemFileName || ''),
    instanceId: String(item.itemInstanceID || ''),
    loaded: !!item.itemInstanceID,
  })).filter((item) => item.id || item.fileName);
  return {
    source: 'vtube_studio',
    endpoint,
    currentModel: {
      loaded: current.modelLoaded === true,
      id: String(current.modelID || ''),
      name: String(current.modelName || ''),
    },
    models,
    hotkeys,
    expressions,
    items,
    fetchedAt: new Date().toISOString(),
  };
}

async function discoverVtubeStudio(options = {}) {
  const auth = await authenticateVtubeStudio(options);
  const endpoint = auth.endpoint;
  const { pluginName, pluginDeveloper } = getVtubePluginInfo();
  const ws = await openVtubeSocket(endpoint, options.timeoutMs || 7000);
  try {
    const authResponse = await sendVtubeSocketRequest(ws, 'AuthenticationRequest', {
      pluginName,
      pluginDeveloper,
      authenticationToken: auth.authToken,
    }, { timeoutMs: options.timeoutMs || 7000 });
    if (authResponse?.data?.authenticated !== true) {
      throw new Error('VTube Studio 인증에 실패했습니다.');
    }
    const [current, models, hotkeys, expressions, items] = await Promise.all([
      sendVtubeSocketRequest(ws, 'CurrentModelRequest', {}),
      sendVtubeSocketRequest(ws, 'AvailableModelsRequest', {}),
      sendVtubeSocketRequest(ws, 'HotkeysInCurrentModelRequest', {}),
      sendVtubeSocketRequest(ws, 'ExpressionStateRequest', { details: false }),
      sendVtubeSocketRequest(ws, 'ItemListRequest', {
        includeAvailableSpots: false,
        includeItemInstancesInScene: true,
        includeAvailableItemFiles: true,
      }).catch(() => null),
    ]);
    return normalizeVtubeDiscovery({ current, models, hotkeys, expressions, items }, endpoint);
  } finally {
    try { ws.close(); } catch {}
  }
}

async function triggerVtubeHotkey(payload = {}) {
  const auth = await authenticateVtubeStudio({ endpoint: payload.endpoint });
  const hotkeyID = String(payload.hotkeyID || payload.hotkeyId || payload.hotkeyName || '').trim();
  if (!hotkeyID) throw new Error('실행할 VTube Studio 핫키가 없습니다.');
  return await sendAuthenticatedVtubeRequest('HotkeyTriggerRequest', {
    hotkeyID,
    itemInstanceID: String(payload.itemInstanceID || payload.itemInstanceId || ''),
  }, { endpoint: auth.endpoint, authToken: auth.authToken });
}

async function injectVtubeParameter(payload = {}) {
  const auth = await authenticateVtubeStudio({ endpoint: payload.endpoint });
  const parameter = String(payload.parameter || payload.parameterName || payload.id || '').trim();
  if (!parameter) throw new Error('변경할 VTube Studio 파라미터가 없습니다.');
  return await sendAuthenticatedVtubeRequest('InjectParameterDataRequest', {
    faceFound: payload.faceFound !== false,
    parameterValues: [{
      id: parameter,
      value: Number(payload.value || 0),
      weight: Number(payload.weight || 1),
    }],
  }, { endpoint: auth.endpoint, authToken: auth.authToken });
}

async function processJob(job) {
  const type = String(job.job_type || job.jobType || '');
  const payload = job.payload || {};
  addLog('info', `작업 실행: ${type}`);

  if (type === 'tits.discover') {
    return { discovery: await discoverTits() };
  }
  if (type === 'tits.throw') {
    return await sendTitsRequest('TITSThrowItemsRequest', {
      items: Array.isArray(payload.items) ? payload.items : [],
      delayTime: Number(payload.delayTime || 0.05),
      amountOfThrows: Number(payload.amountOfThrows || 1),
      errorOnMissingID: !!payload.errorOnMissingID,
    });
  }
  if (type === 'tits.trigger') {
    return await sendTitsRequest('TITSTriggerActivateRequest', {
      triggerID: payload.triggerID || payload.triggerId || '',
      triggerName: payload.triggerName || '',
    });
  }
  if (type === 'vtube.discover') {
    return { discovery: await discoverVtubeStudio({ endpoint: payload.endpoint }) };
  }
  if (type === 'vtube.hotkey') {
    return await triggerVtubeHotkey(payload);
  }
  if (type === 'blueprint.vtube') {
    if (payload.hotkeyId || payload.hotkeyID || payload.hotkeyName) return await triggerVtubeHotkey(payload);
    if (payload.parameter || payload.parameterName) return await injectVtubeParameter(payload);
    throw new Error('VTube Studio 노드에 핫키 또는 파라미터 설정이 없습니다.');
  }
  if (type === 'tts.speak' || type === 'blueprint.tts') {
    const text = String(payload.text || '').trim();
    if (!text) throw new Error('읽을 문구가 없습니다.');
    return sendRendererTask({
      type: 'tts.speak',
      text: text.slice(0, 1000),
      voice: String(payload.voice || ''),
      rate: Math.max(0.5, Math.min(2, Number(payload.rate || 1))),
      pitch: Math.max(0.5, Math.min(2, Number(payload.pitch || 1))),
    });
  }
  if (type === 'sound.play' || type === 'blueprint.sound') {
    const fileId = path.basename(String(payload.fileId || payload.name || ''));
    if (!fileId) throw new Error('재생할 사운드 파일이 없습니다.');
    let fullPath = '';
    if (config.soundFolder) {
      const soundDir = path.resolve(config.soundFolder);
      const candidate = path.resolve(soundDir, fileId);
      if (candidate.startsWith(soundDir) && fs.existsSync(candidate)) fullPath = candidate;
    }
    if (!fullPath) {
      const cacheDir = path.join(app.getPath('temp'), 'arubot-local-sounds');
      fs.mkdirSync(cacheDir, { recursive: true });
      fullPath = path.join(cacheDir, fileId);
      const data = await apiFetchBuffer(`/api/automations/local-agent/assets/sounds/${encodeURIComponent(fileId)}`);
      fs.writeFileSync(fullPath, data);
    }
    return sendRendererTask({
      type: 'sound.play',
      fileUrl: pathToFileURL(fullPath).href,
      fileName: fileId,
      volume: Math.max(0, Math.min(1, Number(payload.volume ?? 1))),
    });
  }
  if (type === 'blueprint.tits') {
    const triggerId = String(payload.triggerId || payload.triggerID || '').trim();
    const triggerName = String(payload.triggerName || '').trim();
    if (!triggerId && !triggerName) throw new Error('실행할 T.I.T.S 트리거가 없습니다.');
    return await sendTitsRequest('TITSTriggerActivateRequest', {
      triggerID: triggerId,
      triggerName,
    });
  }
  if (type === 'blueprint.http') {
    const url = await assertSafeExternalHttpUrl(payload.url, {
      allowInsecureHttp: payload.allowInsecureHttp === true,
      allowPrivateNetwork: payload.allowPrivateNetwork === true,
    });
    const method = String(payload.method || 'POST').toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error('지원하지 않는 HTTP 메서드입니다.');
    const headers = parseMaybeJsonObject(payload.headers, {});
    const bodyText = typeof payload.body === 'string' ? payload.body : payload.body == null ? '' : JSON.stringify(payload.body);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, Math.min(30000, Number(payload.timeoutMs || 10000))));
    try {
      const response = await fetch(url.href, {
        method,
        headers: {
          'user-agent': `${APP_NAME}/${app.getVersion()}`,
          ...Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)])),
        },
        body: ['GET', 'HEAD'].includes(method) ? undefined : bodyText,
        signal: controller.signal,
      });
      const text = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        bodyPreview: text.slice(0, 2000),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
  if (type === 'blueprint.websocket') {
    const target = payload.url || payload.connectionUrl || payload.endpoint;
    const message = typeof payload.message === 'string' ? payload.message : JSON.stringify(payload.message || {});
    const url = new URL(String(target || ''));
    if (!['wss:', 'ws:'].includes(url.protocol)) throw new Error('WebSocket 노드는 ws/wss URL만 사용할 수 있습니다.');
    if (url.protocol === 'ws:' && payload.allowInsecureWebSocket !== true) throw new Error('WebSocket 노드는 기본적으로 WSS만 허용합니다.');
    await assertSafeExternalHttpUrl(`${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`, {
      allowInsecureHttp: payload.allowInsecureWebSocket === true,
      allowPrivateNetwork: payload.allowPrivateNetwork === true,
    });
    return await new Promise((resolve, reject) => {
      const ws = new WebSocket(url.href);
      const timeout = setTimeout(() => {
        try { ws.close(); } catch { }
        reject(new Error('WebSocket 전송 시간이 초과되었습니다.'));
      }, Math.max(1000, Math.min(30000, Number(payload.timeoutMs || 8000))));
      ws.once('open', () => {
        ws.send(message, (error) => {
          clearTimeout(timeout);
          try { ws.close(); } catch { }
          if (error) reject(error);
          else resolve({ ok: true, sentBytes: Buffer.byteLength(message) });
        });
      });
      ws.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }
  if (type === 'blueprint.udp') {
    const host = String(payload.host || '127.0.0.1').trim();
    const port = Number(payload.port || 0);
    const message = typeof payload.message === 'string' ? payload.message : JSON.stringify(payload.message || {});
    if (!host) throw new Error('UDP 호스트가 필요합니다.');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('UDP 포트가 올바르지 않습니다.');
    const family = net.isIP(host) === 6 ? 'udp6' : 'udp4';
    const buffer = Buffer.from(message);
    return await new Promise((resolve, reject) => {
      const socket = dgram.createSocket(family);
      const timeout = setTimeout(() => {
        try { socket.close(); } catch { }
        reject(new Error('UDP 전송 시간이 초과되었습니다.'));
      }, Math.max(1000, Math.min(10000, Number(payload.timeoutMs || 3000))));
      socket.once('error', (error) => {
        clearTimeout(timeout);
        try { socket.close(); } catch { }
        reject(error);
      });
      socket.send(buffer, port, host, (error) => {
        clearTimeout(timeout);
        try { socket.close(); } catch { }
        if (error) reject(error);
        else resolve({ ok: true, host, port, bytes: buffer.length });
      });
    });
  }
  if (type === 'control.trigger') {
    return {
      ok: true,
      source: payload.source || 'control',
      receivedAt: new Date().toISOString(),
    };
  }

  return { skipped: true, reason: `지원하지 않는 작업 타입: ${type}` };
}

async function claimAndProcessJobs() {
  if (!running) return;
  if (processingJobs) return;
  processingJobs = true;
  try {
    const claim = await apiFetch('/api/automations/local-agent/jobs/claim', {
      method: 'POST',
      body: JSON.stringify({
        limit: 5,
        capabilities: {
          tits: true,
          vtubeStudio: true,
          vtubeStudioAuthenticated: !!config.vtubeAuthToken,
          soundFolder: !!config.soundFolder,
          tts: true,
          version: app.getVersion(),
        },
      }),
    });
    const jobs = Array.isArray(claim?.jobs) ? claim.jobs : [];
    if (jobs.length) {
      stats.claimed += jobs.length;
      stats.lastJobAt = new Date().toISOString();
    }
    for (const job of jobs) {
      try {
        const result = await processJob(job);
        await apiFetch(`/api/automations/local-agent/jobs/${encodeURIComponent(job.id)}/complete`, {
          method: 'POST',
          body: JSON.stringify({ status: 'done', result }),
        });
        stats.completed += 1;
        addLog('success', `작업 완료: ${job.job_type || job.jobType}`);
      } catch (error) {
        stats.failed += 1;
        await apiFetch(`/api/automations/local-agent/jobs/${encodeURIComponent(job.id)}/complete`, {
          method: 'POST',
          body: JSON.stringify({ status: 'failed', errorMessage: error.message || String(error), result: {} }),
        }).catch(() => undefined);
        addLog('error', '작업 실행 실패', error.message || String(error));
      }
    }
  } catch (error) {
    addLog('error', '작업 확인 실패', error.message || String(error));
  } finally {
    processingJobs = false;
    emitState();
  }
}

async function heartbeat() {
  if (!running) return;
  await apiFetch('/api/automations/local-agent/heartbeat', {
    method: 'POST',
    body: JSON.stringify({
      capabilities: {
        tits: true,
        vtubeStudio: true,
        vtubeStudioAuthenticated: !!config.vtubeAuthToken,
        soundFolder: !!config.soundFolder,
        tts: true,
        version: app.getVersion(),
      },
    }),
  });
  stats.lastHeartbeatAt = new Date().toISOString();
}

function getAgentWebSocketUrl() {
  const base = new URL(normalizeBackendUrl());
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = '/api/automations/local-agent/ws';
  base.search = '';
  const token = normalizeLocalProgramToken(config.token);
  if (token) base.searchParams.set('token', token);
  base.hash = '';
  return base.toString();
}

function sendAgentSocketMessage(message) {
  if (!agentSocket || agentSocket.readyState !== WebSocket.OPEN) return false;
  try {
    agentSocket.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function scheduleAgentReconnect() {
  if (!running || agentSocketReconnectTimer) return;
  const delay = Math.min(30000, 1000 * (2 ** Math.min(5, reconnectAttempt)));
  reconnectAttempt += 1;
  agentSocketReconnectTimer = setTimeout(() => {
    agentSocketReconnectTimer = null;
    connectAgentSocket();
  }, delay);
}

function stopAgentSocket() {
  if (agentSocketReconnectTimer) clearTimeout(agentSocketReconnectTimer);
  if (agentSocketHeartbeatTimer) clearInterval(agentSocketHeartbeatTimer);
  agentSocketReconnectTimer = null;
  agentSocketHeartbeatTimer = null;
  const socket = agentSocket;
  agentSocket = null;
  if (socket) {
    try { socket.close(1000, 'stopped'); } catch { }
  }
}

function startAgentPolling() {
  if (agentPollingTimer) return;
  agentPollingTimer = setInterval(() => {
    heartbeat().catch((error) => addLog('error', '연결 확인 실패', error.message || String(error)));
    claimAndProcessJobs().catch((error) => addLog('error', '작업 확인 실패', error.message || String(error)));
  }, 15000);
}

function stopAgentPolling() {
  if (agentPollingTimer) clearInterval(agentPollingTimer);
  agentPollingTimer = null;
}

function sendSocketHeartbeat() {
  const sent = sendAgentSocketMessage({
    type: 'heartbeat',
    capabilities: {
      tits: true,
      vtubeStudio: true,
      vtubeStudioAuthenticated: !!config.vtubeAuthToken,
      soundFolder: !!config.soundFolder,
      tts: true,
      version: app.getVersion(),
    },
    at: new Date().toISOString(),
  });
  if (!sent) heartbeat().catch(() => undefined);
}

function connectAgentSocket() {
  const token = normalizeLocalProgramToken(config.token);
  if (!running || !token) return;
  config.token = token;
  stopAgentSocket();
  const url = getAgentWebSocketUrl();
  const socket = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Local-Agent-Token': token,
      'X-AruBot-Local-Version': app.getVersion(),
    },
  });
  agentSocket = socket;

  socket.once('open', () => {
    reconnectAttempt = 0;
    addLog('success', '아루봇과 실시간 연결이 열렸습니다.');
    sendSocketHeartbeat();
    claimAndProcessJobs();
    agentSocketHeartbeatTimer = setInterval(sendSocketHeartbeat, 55000);
    emitState();
  });

  socket.on('message', (raw) => {
    let message = null;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (message?.type === 'hello' || message?.type === 'heartbeat.ack') {
      stats.lastHeartbeatAt = message.at || new Date().toISOString();
      emitState();
      return;
    }
    if (message?.type === 'jobs.available') {
      claimAndProcessJobs();
    }
  });

  socket.once('close', () => {
    if (agentSocket === socket) agentSocket = null;
    if (agentSocketHeartbeatTimer) clearInterval(agentSocketHeartbeatTimer);
    agentSocketHeartbeatTimer = null;
    if (running) {
      addLog('info', '실시간 연결이 끊어져 재연결을 준비합니다.');
      scheduleAgentReconnect();
    }
    emitState();
  });

  socket.once('error', (error) => {
    addLog('error', '실시간 연결 오류', error.message || String(error));
  });
}

async function startAgent() {
  if (running) return getPublicState();
  config.token = normalizeLocalProgramToken(config.token);
  if (!config.backendUrl || !config.token) throw new Error('로컬 프로그램 토큰이 필요합니다.');
  running = true;
  try {
    await heartbeat();
    addLog('success', '아루봇 백엔드 인증을 확인했습니다.');
    startAgentPolling();
    connectAgentSocket();
    claimAndProcessJobs().catch((error) => addLog('error', '작업 확인 실패', error.message || String(error)));
    emitState();
    return getPublicState();
  } catch (error) {
    running = false;
    stopAgentSocket();
    stopAgentPolling();
    addLog('error', '아루봇 백엔드 연결 실패', error.message || String(error));
    throw error;
  }
}

function stopAgent() {
  running = false;
  stopAgentSocket();
  stopAgentPolling();
  addLog('info', '로컬 프로그램을 중지했습니다.');
  emitState();
  return getPublicState();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 980,
    minHeight: 680,
    title: APP_NAME,
    backgroundColor: '#f7fbfb',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('state:get', () => getPublicState());
ipcMain.handle('config:save', (_event, next) => {
  const state = saveConfig(next || {});
  addLog('success', '설정을 저장했습니다.');
  return state;
});
ipcMain.handle('agent:start', () => startAgent());
ipcMain.handle('agent:stop', () => stopAgent());
ipcMain.handle('tits:discover', async () => {
  const discovery = await discoverTits();
  addLog('success', `T.I.T.S. 목록 불러오기 완료: 아이템 ${discovery.items.length}개, 트리거 ${discovery.triggers.length}개`);
  return discovery;
});
ipcMain.handle('vtube:authenticate', async () => {
  const auth = await authenticateVtubeStudio();
  addLog('success', auth.reused ? 'VTube Studio 인증을 확인했습니다.' : 'VTube Studio 인증을 완료했습니다.');
  return { authenticated: auth.authenticated, reused: auth.reused, endpoint: auth.endpoint };
});
ipcMain.handle('vtube:discover', async () => {
  const discovery = await discoverVtubeStudio();
  addLog('success', `VTube Studio 목록 불러오기 완료: 모델 ${discovery.models.length}개, 핫키 ${discovery.hotkeys.length}개`);
  return discovery;
});
ipcMain.handle('vtube:hotkey', async (_event, payload) => {
  const result = await triggerVtubeHotkey(payload || {});
  addLog('success', 'VTube Studio 핫키를 실행했습니다.');
  return result;
});
ipcMain.handle('remote:overview', async () => apiFetch('/api/local-remote/overview'));
ipcMain.handle('remote:command:save', async (_event, rule) => {
  const result = await apiFetch('/api/local-remote/commands/upsert', {
    method: 'POST',
    body: JSON.stringify({ rule }),
  });
  addLog('success', `리모컨에서 명령어를 저장했습니다: ${result?.rule?.name || ''}`);
  return result;
});
ipcMain.handle('remote:command:delete', async (_event, id) => {
  const result = await apiFetch('/api/local-remote/commands/delete', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
  addLog('success', '리모컨에서 명령어를 삭제했습니다.');
  return result;
});
ipcMain.handle('remote:roulette:test', async (_event, roulette) => {
  const result = await apiFetch('/api/local-remote/roulette/test', {
    method: 'POST',
    body: JSON.stringify(roulette || {}),
  });
  addLog('success', `리모컨에서 룰렛 테스트를 실행했습니다: ${result?.result?.result?.label || ''}`);
  return result;
});
ipcMain.handle('remote:pvd:pop', async () => {
  const result = await apiFetch('/api/local-remote/video-donation/pop', {
    method: 'POST',
    body: JSON.stringify({ cause: 'local_remote' }),
  });
  addLog('success', '리모컨에서 영상후원 다음 항목으로 넘겼습니다.');
  return result;
});
ipcMain.handle('remote:pvd:control', async (_event, control) => apiFetch('/api/local-remote/video-donation/control', {
  method: 'POST',
  body: JSON.stringify(control || {}),
}));
ipcMain.handle('folder:chooseSound', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths?.[0]) return null;
  saveConfig({ soundFolder: result.filePaths[0] });
  return result.filePaths[0];
});
ipcMain.handle('folder:openSound', async () => {
  if (!config.soundFolder) return false;
  await shell.openPath(config.soundFolder);
  return true;
});
ipcMain.handle('dashboard:open', async () => {
  await shell.openExternal(getSafeExternalHttpUrl(config.dashboardUrl || DEFAULT_DASHBOARD_URL));
  return true;
});
ipcMain.handle('update:check', async () => {
  setUpdateState({ status: 'checking', checking: true, error: null, progress: null });
  try {
    const manifestUpdate = await fetchUpdateManifest();
    if (app.isPackaged) {
      try {
        const updaterResult = await checkForUpdatesWithElectronUpdater();
        const latestVersion = updaterResult.latestVersion || manifestUpdate.latestVersion;
        const result = { ...manifestUpdate, ...updaterResult, latestVersion };
        setUpdateState({
          status: result.updateAvailable ? 'available' : 'idle',
          checking: false,
          latestVersion,
          updateAvailable: result.updateAvailable,
          downloaded: false,
          readyToApply: false,
          error: null,
        });
        addLog(result.updateAvailable ? 'info' : 'success', result.updateAvailable ? `새 버전 ${latestVersion}을 찾았습니다.` : '최신 버전을 사용 중입니다.');
        return result;
      } catch (error) {
        addLog('error', '인앱 업데이트 확인 실패. manifest 방식으로 확인합니다.', error.message || String(error));
      }
    }
    setUpdateState({
      status: manifestUpdate.updateAvailable ? 'available' : 'idle',
      checking: false,
      latestVersion: manifestUpdate.latestVersion,
      updateAvailable: manifestUpdate.updateAvailable,
      downloaded: false,
      readyToApply: false,
      error: null,
    });
    addLog(manifestUpdate.updateAvailable ? 'info' : 'success', manifestUpdate.updateAvailable ? `새 버전 ${manifestUpdate.latestVersion}을 찾았습니다.` : '최신 버전을 사용 중입니다.');
    return manifestUpdate;
  } catch (error) {
    setUpdateState({ status: 'error', checking: false, error: error.message || String(error) });
    throw error;
  }
});
ipcMain.handle('update:install', async () => {
  const update = await fetchUpdateManifest();
  if (!update.updateAvailable) return { ...update, opened: false };
  if (app.isPackaged) {
    setUpdateState({ status: 'downloading', checking: false, updateAvailable: true, latestVersion: update.latestVersion, downloaded: false, readyToApply: false, error: null, progress: null });
    try {
      await checkForUpdatesWithElectronUpdater();
      const info = await downloadUpdateWithElectronUpdater();
      setUpdateState({ status: 'ready', downloaded: true, readyToApply: true, progress: null, error: null });
      addLog('success', '업데이트 다운로드가 끝났습니다. 프로그램을 종료하면 조용히 적용됩니다.');
      return { ...update, electronUpdater: true, opened: false, downloaded: true, readyToApply: true, info };
    } catch (error) {
      setUpdateState({ status: 'error', error: error.message || String(error), progress: null });
      addLog('error', '인앱 업데이트 준비 실패. 숨김 설치 예약 방식으로 전환합니다.', error.message || String(error));
    }
  }
  addLog('info', `업데이트 ${update.latestVersion} 다운로드를 시작합니다.`);
  const installerPath = await downloadInstaller(update);
  persistPendingInstallerUpdate(update, installerPath);
  setUpdateState({ status: 'ready', checking: false, latestVersion: update.latestVersion, updateAvailable: true, downloaded: true, readyToApply: true, progress: null, error: null });
  addLog('success', '업데이트 파일을 내려받았습니다. 프로그램을 종료하면 설치 화면 없이 적용됩니다.');
  return { ...update, opened: false, downloaded: true, readyToApply: true, manualInstaller: true };
});

app.whenReady().then(() => {
  loadConfig();
  loadPendingUpdate();
  createWindow();
  if (config.autoStart && config.token) {
    setTimeout(() => {
      try { startAgent(); } catch (error) { addLog('error', '자동 시작 실패', error.message || String(error)); }
    }, 800);
  }
});

app.on('before-quit', () => {
  scheduleSilentInstallerOnQuit();
  stopAgent();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
