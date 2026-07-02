const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const { autoUpdater } = require('electron-updater');
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
const DEFAULT_CONFIG = {
  backendUrl: 'http://127.0.0.1:3001',
  updateManifestUrl: DEFAULT_UPDATE_MANIFEST_URL,
  token: '',
  titsEndpoint: 'ws://localhost:42069',
  toonationAlertboxKey: '',
  soundFolder: '',
  pollIntervalMs: 1800,
  autoStart: false,
};

let mainWindow = null;
let running = false;
let pollTimer = null;
let config = { ...DEFAULT_CONFIG };
let logs = [];
let updateState = {
  status: 'idle',
  checking: false,
  latestVersion: null,
  updateAvailable: false,
  downloaded: false,
  progress: null,
  error: null,
};
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
  logs.unshift({
    id: crypto.randomBytes(6).toString('hex'),
    at: new Date().toISOString(),
    level,
    message,
    details,
  });
  logs = logs.slice(0, 120);
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

function loadConfig() {
  const persisted = readJson('config.json', {});
  const vault = readJson('vault.json', {});
  if (!persisted.updateManifestUrl || persisted.updateManifestUrl === LEGACY_UPDATE_MANIFEST_URL) {
    persisted.updateManifestUrl = DEFAULT_UPDATE_MANIFEST_URL;
  }
  config = {
    ...DEFAULT_CONFIG,
    ...persisted,
    token: decryptText(vault.token),
    toonationAlertboxKey: decryptText(vault.toonationAlertboxKey),
  };
  return config;
}

function saveConfig(next) {
  const nextUpdateManifestUrl = String(next.updateManifestUrl ?? config.updateManifestUrl ?? DEFAULT_CONFIG.updateManifestUrl).trim();
  config = {
    ...config,
    ...next,
    backendUrl: String(next.backendUrl ?? config.backendUrl ?? '').replace(/\/$/, ''),
    updateManifestUrl: nextUpdateManifestUrl === LEGACY_UPDATE_MANIFEST_URL ? DEFAULT_UPDATE_MANIFEST_URL : nextUpdateManifestUrl,
    token: String(next.token ?? config.token ?? '').trim(),
    titsEndpoint: String(next.titsEndpoint ?? config.titsEndpoint ?? '').trim() || DEFAULT_CONFIG.titsEndpoint,
    toonationAlertboxKey: String(next.toonationAlertboxKey ?? config.toonationAlertboxKey ?? '').trim(),
    soundFolder: String(next.soundFolder ?? config.soundFolder ?? '').trim(),
    pollIntervalMs: Math.max(800, Math.min(10000, Number(next.pollIntervalMs ?? config.pollIntervalMs ?? 1800))),
    autoStart: !!(next.autoStart ?? config.autoStart),
  };
  writeJson('config.json', {
    backendUrl: config.backendUrl,
    updateManifestUrl: config.updateManifestUrl,
    titsEndpoint: config.titsEndpoint,
    soundFolder: config.soundFolder,
    pollIntervalMs: config.pollIntervalMs,
    autoStart: config.autoStart,
  });
  writeJson('vault.json', {
    token: encryptText(config.token),
    toonationAlertboxKey: encryptText(config.toonationAlertboxKey),
  });
  emitState();
  return getPublicState();
}

function getPublicState() {
  return {
    version: app.getVersion(),
    running,
    config: {
      ...config,
      token: config.token ? `${config.token.slice(0, 8)}...${config.token.slice(-4)}` : '',
      updateManifestUrl: config.updateManifestUrl,
      hasToken: !!config.token,
      toonationAlertboxKey: config.toonationAlertboxKey ? `${config.toonationAlertboxKey.slice(0, 5)}...` : '',
      hasToonationKey: !!config.toonationAlertboxKey,
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
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableWebInstaller = false;
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
  const updateDir = path.join(app.getPath('temp'), 'arubot-local-updates');
  fs.mkdirSync(updateDir, { recursive: true });
  const fileName = path.basename(update.fileName || 'AruBot-Local-Program.exe');
  const installerPath = path.join(updateDir, fileName);
  fs.writeFileSync(installerPath, buffer);
  return installerPath;
}

async function apiFetch(pathname, options = {}) {
  const token = String(config.token || '').trim();
  if (!token) throw new Error('로컬 프로그램 토큰이 없습니다.');
  const response = await fetch(`${normalizeBackendUrl()}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
  return data;
}

async function apiFetchBuffer(pathname) {
  const token = String(config.token || '').trim();
  if (!token) throw new Error('로컬 프로그램 토큰이 없습니다.');
  const response = await fetch(`${normalizeBackendUrl()}${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
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
  if (type === 'toonation.alertbox.test') {
    if (!config.toonationAlertboxKey) throw new Error('투네이션 Alertbox 키가 저장되어 있지 않습니다.');
    return {
      ok: true,
      provider: 'toonation',
      keyStoredLocally: true,
      message: '투네이션 키가 로컬 vault에 저장되어 있습니다.',
    };
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
      allowPrivateNetwork: false,
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
      allowPrivateNetwork: false,
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
  try {
    const claim = await apiFetch('/api/automations/local-agent/jobs/claim', {
      method: 'POST',
      body: JSON.stringify({
        limit: 5,
        capabilities: {
          tits: true,
          toonation: !!config.toonationAlertboxKey,
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
    addLog('error', '백엔드 큐 확인 실패', error.message || String(error));
  } finally {
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
        toonation: !!config.toonationAlertboxKey,
        soundFolder: !!config.soundFolder,
        tts: true,
        version: app.getVersion(),
      },
    }),
  });
  stats.lastHeartbeatAt = new Date().toISOString();
}

function startAgent() {
  if (running) return getPublicState();
  if (!config.backendUrl || !config.token) throw new Error('백엔드 주소와 로컬 프로그램 토큰이 필요합니다.');
  running = true;
  addLog('success', '로컬 프로그램을 시작했습니다.');
  heartbeat().catch((error) => addLog('error', 'heartbeat 실패', error.message || String(error)));
  claimAndProcessJobs();
  pollTimer = setInterval(() => {
    heartbeat().catch(() => undefined);
    claimAndProcessJobs();
  }, config.pollIntervalMs);
  emitState();
  return getPublicState();
}

function stopAgent() {
  running = false;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
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
  addLog('success', `T.I.T.S. 목록 동기화 완료: 아이템 ${discovery.items.length}개, 트리거 ${discovery.triggers.length}개`);
  return discovery;
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
ipcMain.handle('external:open', async (_event, url) => {
  await shell.openExternal(String(url || ''));
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
    setUpdateState({ status: 'downloading', checking: false, updateAvailable: true, latestVersion: update.latestVersion, error: null, progress: null });
    try {
      await checkForUpdatesWithElectronUpdater();
      const info = await downloadUpdateWithElectronUpdater();
      setUpdateState({ status: 'installing', downloaded: true, progress: null });
      addLog('success', '업데이트 다운로드가 끝났습니다. 프로그램을 재시작하며 설치합니다.');
      setTimeout(() => {
        autoUpdater.quitAndInstall(false, true);
      }, 700);
      return { ...update, electronUpdater: true, opened: false, installing: true, info };
    } catch (error) {
      setUpdateState({ status: 'error', error: error.message || String(error), progress: null });
      addLog('error', '인앱 업데이트 설치 준비 실패. 설치 파일 실행 방식으로 전환합니다.', error.message || String(error));
    }
  }
  addLog('info', `업데이트 ${update.latestVersion} 다운로드를 시작합니다.`);
  const installerPath = await downloadInstaller(update);
  const openResult = await shell.openPath(installerPath);
  if (openResult) throw new Error(openResult);
  addLog('success', '업데이트 설치 파일을 실행했습니다. 설치가 끝나면 프로그램을 다시 열어주세요.');
  return { ...update, opened: true, installerPath };
});

app.whenReady().then(() => {
  loadConfig();
  createWindow();
  if (config.autoStart && config.token) {
    setTimeout(() => {
      try { startAgent(); } catch (error) { addLog('error', '자동 시작 실패', error.message || String(error)); }
    }, 800);
  }
});

app.on('before-quit', () => stopAgent());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
