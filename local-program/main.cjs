const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { WebSocket } = require('ws');

const APP_NAME = 'AruBot Local Program';
const DEFAULT_CONFIG = {
  backendUrl: 'http://127.0.0.1:3001',
  updateManifestUrl: 'https://arubot.vercel.app/downloads/local-program/latest.json',
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

function sendRendererTask(task) {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('GUI 창이 준비되지 않았습니다.');
  mainWindow.webContents.send('local-task', task);
  return { accepted: true, taskType: task.type, at: new Date().toISOString() };
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
  config = {
    ...DEFAULT_CONFIG,
    ...persisted,
    token: decryptText(vault.token),
    toonationAlertboxKey: decryptText(vault.toonationAlertboxKey),
  };
  return config;
}

function saveConfig(next) {
  config = {
    ...config,
    ...next,
    backendUrl: String(next.backendUrl ?? config.backendUrl ?? '').replace(/\/$/, ''),
    updateManifestUrl: String(next.updateManifestUrl ?? config.updateManifestUrl ?? DEFAULT_CONFIG.updateManifestUrl).trim(),
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
  if (type === 'tts.speak') {
    const text = String(payload.text || '').trim();
    if (!text) throw new Error('읽을 문구가 없습니다.');
    return sendRendererTask({
      type: 'tts.speak',
      text: text.slice(0, 500),
      voice: String(payload.voice || ''),
      rate: Math.max(0.5, Math.min(2, Number(payload.rate || 1))),
      pitch: Math.max(0.5, Math.min(2, Number(payload.pitch || 1))),
    });
  }
  if (type === 'sound.play') {
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
  const update = await fetchUpdateManifest();
  addLog(update.updateAvailable ? 'info' : 'success', update.updateAvailable ? `새 버전 ${update.latestVersion}을 찾았습니다.` : '최신 버전을 사용 중입니다.');
  return update;
});
ipcMain.handle('update:install', async () => {
  const update = await fetchUpdateManifest();
  if (!update.updateAvailable) return { ...update, opened: false };
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
