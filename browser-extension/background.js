const api = typeof browser !== 'undefined' ? browser : chrome;

const SERVICES = ['chzzk', 'cime', 'toonation', 'arubot'];
const SERVICE_LABELS = {
  chzzk: 'CHZZK',
  cime: 'CIME',
  toonation: 'Toonation',
  arubot: 'AruBot'
};

const DEFAULT_SETTINGS = {
  monitoring: false,
  extraDelaySec: 1,
  arubotApiBaseUrl: '',
  resumeFocusedOnly: false,
  services: {
    chzzk: { enabled: true, overlayUrl: '' },
    cime: { enabled: true, overlayUrl: '' },
    toonation: { enabled: true, overlayUrl: '' },
    arubot: { enabled: true, overlayUrl: '' }
  }
};

const runtime = {
  settings: structuredClone(DEFAULT_SETTINGS),
  serviceState: Object.fromEntries(SERVICES.map((id) => [id, {
    status: 'idle',
    message: 'Not configured',
    connectedAt: null,
    reconnectAt: null,
    endAt: 0,
    queue: [],
    lastEventAt: null,
    lastDurationSec: null
  }])),
  connectors: new Map(),
  reconnectTimers: new Map(),
  resumeTimer: null,
  dedupe: new Map(),
  pauseUntil: 0,
  lastBroadcast: 0
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeSettings(base, next) {
  const merged = clone(base);
  if (!next || typeof next !== 'object') return merged;
  merged.monitoring = Boolean(next.monitoring);
  merged.extraDelaySec = normalizeSeconds(next.extraDelaySec, DEFAULT_SETTINGS.extraDelaySec);
  merged.arubotApiBaseUrl = String(next.arubotApiBaseUrl || '').trim().replace(/\/+$/, '');
  merged.resumeFocusedOnly = Boolean(next.resumeFocusedOnly);
  for (const service of SERVICES) {
    merged.services[service] = {
      ...merged.services[service],
      ...(next.services?.[service] || {})
    };
    merged.services[service].enabled = merged.services[service].enabled !== false;
    merged.services[service].overlayUrl = String(merged.services[service].overlayUrl || '').trim();
  }
  return merged;
}

function storageGet(keys) {
  return api.storage.local.get(keys);
}

function storageSet(value) {
  return api.storage.local.set(value);
}

async function loadSettings() {
  const stored = await storageGet(['settings']);
  runtime.settings = mergeSettings(DEFAULT_SETTINGS, stored.settings);
  await storageSet({ settings: runtime.settings });
}

async function saveSettings(nextSettings) {
  runtime.settings = mergeSettings(DEFAULT_SETTINGS, nextSettings);
  await storageSet({ settings: runtime.settings });
  restartConnectors();
  broadcastState();
}

function setServiceState(service, patch) {
  runtime.serviceState[service] = {
    ...runtime.serviceState[service],
    ...patch
  };
  broadcastState();
}

function getPublicState() {
  return {
    settings: clone(runtime.settings),
    services: clone(runtime.serviceState),
    pauseUntil: runtime.pauseUntil,
    now: Date.now(),
    effectiveRemainingSec: Math.max(0, Math.ceil((runtime.pauseUntil - Date.now()) / 1000))
  };
}

function broadcastState() {
  const now = Date.now();
  if (now - runtime.lastBroadcast < 120) return;
  runtime.lastBroadcast = now;
  api.runtime.sendMessage({ type: 'state', state: getPublicState() }).catch?.(() => {});
}

function normalizeSeconds(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

function serviceEndAt(service) {
  return runtime.serviceState[service]?.endAt || 0;
}

function effectivePauseUntil() {
  return Math.max(0, ...SERVICES.map(serviceEndAt));
}

function compactQueues() {
  const now = Date.now();
  for (const service of SERVICES) {
    const state = runtime.serviceState[service];
    state.queue = (state.queue || []).filter((item) => item.endAt > now);
    if (state.endAt <= now) state.endAt = 0;
  }
}

function eventFingerprint(service, event, durationSec) {
  const id = event?.id || event?.donationId || event?.nfId || event?.newsFeedId || event?.requestId || event?.nonce;
  if (id) return `${service}:${id}`;
  const raw = JSON.stringify(event || {}).slice(0, 500);
  return `${service}:${durationSec}:${hashText(raw)}`;
}

function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function seenRecently(key) {
  const now = Date.now();
  for (const [dedupeKey, at] of runtime.dedupe.entries()) {
    if (now - at > 10 * 60 * 1000) runtime.dedupe.delete(dedupeKey);
  }
  if (runtime.dedupe.has(key)) return true;
  runtime.dedupe.set(key, now);
  return false;
}

async function enqueuePause(service, durationSec, event = {}) {
  const baseDuration = normalizeSeconds(durationSec);
  if (baseDuration <= 0) return false;

  const totalDuration = baseDuration + normalizeSeconds(runtime.settings.extraDelaySec, 1);
  const fingerprint = eventFingerprint(service, event, totalDuration);
  if (seenRecently(fingerprint)) return false;

  const now = Date.now();
  const state = runtime.serviceState[service];
  const startAt = Math.max(now, state.endAt || 0);
  const endAt = startAt + totalDuration * 1000;
  const item = {
    id: fingerprint,
    service,
    label: SERVICE_LABELS[service],
    durationSec: totalDuration,
    rawDurationSec: baseDuration,
    startAt,
    endAt,
    title: event?.title || event?.vTitle || event?.videoDescription || null
  };

  state.endAt = endAt;
  state.queue = [...(state.queue || []).filter((queued) => queued.endAt > now), item].slice(-20);
  state.lastEventAt = now;
  state.lastDurationSec = totalDuration;
  state.status = 'connected';
  state.message = `${totalDuration}s queued`;

  runtime.pauseUntil = effectivePauseUntil();
  await pauseYouTube(runtime.pauseUntil);
  scheduleResume();
  broadcastState();
  return true;
}

function scheduleResume() {
  if (runtime.resumeTimer) clearTimeout(runtime.resumeTimer);
  compactQueues();
  runtime.pauseUntil = effectivePauseUntil();
  const delay = runtime.pauseUntil - Date.now();
  if (delay <= 0) {
    runtime.resumeTimer = null;
    resumeYouTube();
    return;
  }
  runtime.resumeTimer = setTimeout(() => {
    compactQueues();
    runtime.pauseUntil = effectivePauseUntil();
    if (runtime.pauseUntil <= Date.now()) {
      resumeYouTube();
    } else {
      scheduleResume();
      pauseYouTube(runtime.pauseUntil);
    }
    broadcastState();
  }, Math.min(delay + 80, 2147483647));
}

async function queryYouTubeTabs() {
  const tabs = await api.tabs.query({});
  return tabs.filter((tab) => {
    try {
      const url = new URL(tab.url || '');
      return /(^|\.)youtube\.com$/i.test(url.hostname) || /(^|\.)youtube-nocookie\.com$/i.test(url.hostname);
    } catch {
      return false;
    }
  });
}

async function sendToYouTubeTabs(message) {
  const tabs = await queryYouTubeTabs();
  const focusedWindow = runtime.settings.resumeFocusedOnly
    ? await api.windows.getLastFocused().catch(() => null)
    : null;

  for (const tab of tabs) {
    if (focusedWindow && tab.windowId !== focusedWindow.id) continue;
    try {
      await api.tabs.sendMessage(tab.id, message);
    } catch {
      try {
        await api.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-youtube.js'] });
        await api.tabs.sendMessage(tab.id, message);
      } catch {
        // The tab may be a restricted browser page or still loading.
      }
    }
  }
}

function pauseYouTube(until) {
  return sendToYouTubeTabs({ type: 'aru-pause:pause', until, reason: 'video-donation' });
}

function resumeYouTube() {
  runtime.pauseUntil = 0;
  for (const service of SERVICES) {
    runtime.serviceState[service].endAt = 0;
    runtime.serviceState[service].queue = [];
  }
  return sendToYouTubeTabs({ type: 'aru-pause:resume' });
}

function restartConnectors() {
  stopConnectors();
  if (!runtime.settings.monitoring) {
    for (const service of SERVICES) {
      setServiceState(service, { status: 'idle', message: 'Monitoring off', connectedAt: null, reconnectAt: null });
    }
    return;
  }

  for (const service of SERVICES) {
    const config = runtime.settings.services[service];
    if (!config?.enabled) {
      setServiceState(service, { status: 'disabled', message: 'Disabled', connectedAt: null, reconnectAt: null });
      continue;
    }
    if (!config.overlayUrl) {
      setServiceState(service, { status: 'idle', message: 'Overlay URL required', connectedAt: null, reconnectAt: null });
      continue;
    }
    startConnector(service, config.overlayUrl);
  }
}

function stopConnectors() {
  for (const timer of runtime.reconnectTimers.values()) clearTimeout(timer);
  runtime.reconnectTimers.clear();
  for (const connector of runtime.connectors.values()) {
    try { connector.close(); } catch {}
  }
  runtime.connectors.clear();
}

function scheduleReconnect(service, overlayUrl, reason, attempt = 0) {
  const delay = Math.min(60000, 1000 * Math.pow(2, attempt));
  const reconnectAt = Date.now() + delay;
  setServiceState(service, { status: 'reconnecting', message: reason || 'Reconnecting', reconnectAt });
  if (runtime.reconnectTimers.has(service)) clearTimeout(runtime.reconnectTimers.get(service));
  runtime.reconnectTimers.set(service, setTimeout(() => {
    runtime.reconnectTimers.delete(service);
    startConnector(service, overlayUrl, attempt + 1);
  }, delay));
}

async function startConnector(service, overlayUrl, attempt = 0) {
  try {
    if (runtime.connectors.has(service)) {
      try { runtime.connectors.get(service).close(); } catch {}
      runtime.connectors.delete(service);
    }
    setServiceState(service, { status: 'connecting', message: 'Connecting', reconnectAt: null });
    const connector = await createConnector(service, overlayUrl, attempt);
    runtime.connectors.set(service, connector);
  } catch (error) {
    scheduleReconnect(service, overlayUrl, error?.message || 'Connect failed', attempt);
  }
}

async function createConnector(service, overlayUrl, attempt) {
  if (service === 'cime') return createCimeConnector(overlayUrl, attempt);
  if (service === 'toonation') return createToonationConnector(overlayUrl, attempt);
  if (service === 'chzzk') return createChzzkConnector(overlayUrl, attempt);
  if (service === 'arubot') return createAruBotConnector(overlayUrl, attempt);
  throw new Error(`Unknown service: ${service}`);
}

async function fetchText(url) {
  const response = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'accept': 'text/html,application/json;q=0.9,*/*;q=0.8'
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function parseJsonMessage(raw) {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

async function fetchJson(url) {
  const text = await fetchText(url);
  return parseJsonMessage(text);
}

function getNestedCandidates(value, depth = 0, out = []) {
  if (!value || depth > 6) return out;
  if (typeof value !== 'object') return out;
  out.push(value);
  if (Array.isArray(value)) {
    for (const item of value) getNestedCandidates(item, depth + 1, out);
  } else {
    for (const item of Object.values(value)) {
      if (typeof item === 'string' && /^[{[]/.test(item.trim())) {
        const parsed = parseJsonMessage(item);
        if (parsed) getNestedCandidates(parsed, depth + 1, out);
      } else {
        getNestedCandidates(item, depth + 1, out);
      }
    }
  }
  return out;
}

function pickNumber(object, names) {
  for (const name of names) {
    if (object && Object.prototype.hasOwnProperty.call(object, name)) {
      const value = Number(object[name]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

function normalizeDurationFromPayload(payload) {
  const candidates = getNestedCandidates(payload);
  for (const object of candidates) {
    const start = pickNumber(object, ['vStart', 'startSecond', 'startSec', 'video_begin', 'begin', 'start']);
    const end = pickNumber(object, ['vEnd', 'endSecond', 'endSec', 'video_end', 'end']);
    if (start != null && end != null && end > start) return Math.ceil(end - start);
  }

  const durationFields = [
    'durationSec',
    'playDurationSec',
    'maxDurationSec',
    'playSec',
    'video_length',
    'videoLength',
    'vLength',
    'duration',
    'playTime',
    'playDuration',
    'length',
    'seconds'
  ];
  for (const object of candidates) {
    const value = pickNumber(object, durationFields);
    if (value != null && value > 0) {
      if (/ms$/i.test(String(Object.keys(object).find((key) => Number(object[key]) === value) || ''))) {
        return Math.ceil(value / 1000);
      }
      return Math.ceil(value > 10000 ? value / 1000 : value);
    }
  }
  return null;
}

function extractCimeClipIdFromValue(value) {
  const text = String(value || '');
  const urlMatch = text.match(/ci\.me\/clips\/([A-Za-z0-9_-]+)/i);
  if (urlMatch) return urlMatch[1];
  const pathMatch = text.match(/(?:^|[/"'])clips\/([A-Za-z0-9_-]+)(?:$|[/"'?&#])/i);
  return pathMatch ? pathMatch[1] : null;
}

function findCimeClipId(payload) {
  const candidates = getNestedCandidates(payload);
  for (const object of candidates) {
    for (const value of Object.values(object || {})) {
      const id = extractCimeClipIdFromValue(value);
      if (id) return id;
    }
  }
  return extractCimeClipIdFromValue(JSON.stringify(payload || ''));
}

async function enrichCimeClipPayload(payload) {
  const clipId = findCimeClipId(payload);
  if (!clipId) return payload;
  try {
    const data = await fetchJson(`https://ci.me/json/clips/${encodeURIComponent(clipId)}`);
    const clips = data?.bodyData?.clips;
    const clip = Array.isArray(clips) ? (clips.find((item) => String(item?.id || '') === String(clipId)) || clips[0]) : null;
    if (!clip) return payload;
    const rawDuration = Number(clip.duration ?? clip.playback?.duration);
    const durationSec = Number.isFinite(rawDuration) && rawDuration > 0
      ? Math.ceil(rawDuration > 10000 ? rawDuration / 1000 : rawDuration)
      : null;
    return {
      ...payload,
      durationSec: normalizeDurationFromPayload(payload) || durationSec,
      title: payload?.title || clip.title || null,
      playbackUrl: payload?.playbackUrl || clip.playback?.url || null,
      cimeClip: {
        id: clip.id || clipId,
        title: clip.title || null,
        durationSec,
        playbackUrl: clip.playback?.url || null,
        thumbnailUrl: clip.coverImageUrl || clip.imageUrl || null,
        raw: clip
      }
    };
  } catch {
    return payload;
  }
}

function isLikelyVideoDonation(payload) {
  const text = JSON.stringify(payload || '').toLowerCase();
  return text.includes('donation_video') ||
    text.includes('"donationtype":"video"') ||
    text.includes('"type":"video"') ||
    text.includes('video_info') ||
    text.includes('videoinfo') ||
    text.includes('videoid') ||
    text.includes('vtype') ||
    text.includes('donationvideourl') ||
    text.includes('video://') ||
    text.includes('ci.me/clips/') ||
    text.includes('"playback"') ||
    text.includes('youtube.com') ||
    text.includes('youtu.be');
}

function createWebSocketConnector({ service, url, protocols, onOpen, onMessage, onClose }) {
  const ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
  let closedByUser = false;
  ws.addEventListener('open', () => {
    setServiceState(service, { status: 'connected', message: 'Connected', connectedAt: Date.now(), reconnectAt: null });
    onOpen?.(ws);
  });
  ws.addEventListener('message', (event) => {
    try {
      const result = onMessage?.(event, ws);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {}
  });
  ws.addEventListener('error', () => {
    setServiceState(service, { status: 'error', message: 'Socket error' });
  });
  ws.addEventListener('close', () => {
    if (!closedByUser && runtime.settings.monitoring) {
      onClose?.();
    }
  });
  return {
    close() {
      closedByUser = true;
      try { ws.close(1000, 'stopped'); } catch {}
    }
  };
}

async function createCimeConnector(overlayUrl, attempt) {
  const html = await fetchText(overlayUrl);
  const alertKey = matchFirst(html, /"alertKey":"([^"]+)"/) || matchFirst(overlayUrl, /\/video\/[^/]+\/([^/?#]+)/);
  const socketUrl = matchFirst(html, /"socketUrl":"([^"]+)"/) || 'apigw.prod.ci.me';
  if (!alertKey) throw new Error('CIME alert key not found');

  const url = `wss://${socketUrl}/?type=ALERT_KEY&alertKey=${encodeURIComponent(alertKey)}&alertType=DONATION_VIDEO`;
  return createWebSocketConnector({
    service: 'cime',
    url,
    onOpen: (ws) => ws.send(JSON.stringify({ type: 'DONATION_VIDEO' })),
    onMessage: async (event) => {
      const payload = parseJsonMessage(String(event.data));
      if (!payload) return;
      if (payload.action === 'PONG') return;
      if (payload.action !== 'DONATION_VIDEO' && !isLikelyVideoDonation(payload)) return;
      const enriched = await enrichCimeClipPayload(payload);
      const duration = normalizeDurationFromPayload(enriched);
      if (duration) enqueuePause('cime', duration, enriched);
    },
    onClose: () => scheduleReconnect('cime', overlayUrl, 'Socket closed', attempt)
  });
}

async function createToonationConnector(overlayUrl, attempt) {
  const html = await fetchText(overlayUrl);
  const payload = matchFirst(html, /"payload"\s*:\s*"([^"]+)"/) ||
    matchFirst(html, /\\"payload\\"\s*:\s*\\"([^"\\]+)\\"/) ||
    matchFirst(html, /\\u0022payload\\u0022\s*:\s*\\u0022([^\\]+?)\\u0022/);
  if (!payload) throw new Error('Toonation payload not found');
  return createWebSocketConnector({
    service: 'toonation',
    url: `wss://toon.at:8071/${payload}`,
    onMessage: (event) => {
      const payload = parseJsonMessage(String(event.data));
      if (!payload || !isLikelyVideoDonation(payload)) return;
      const duration = normalizeDurationFromPayload(payload);
      if (duration) enqueuePause('toonation', duration, payload?.content || payload);
    },
    onClose: () => scheduleReconnect('toonation', overlayUrl, 'Socket closed', attempt)
  });
}

async function createChzzkConnector(overlayUrl, attempt) {
  const sessionId = matchFirst(overlayUrl, /video@([^/?#]+)/) || matchFirst(overlayUrl, /\/video-donation\/([^/?#]+)/);
  if (!sessionId) throw new Error('CHZZK video session id not found');
  const response = await fetch(`https://api.chzzk.naver.com/manage/v1/alerts/${encodeURIComponent(sessionId)}/session-url`, {
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'accept': 'application/json'
    }
  });
  if (!response.ok) throw new Error(`CHZZK session HTTP ${response.status}`);
  const data = await response.json();
  const sessionUrl = data?.content?.sessionUrl;
  if (!sessionUrl) throw new Error('CHZZK session URL not found');
  const parsed = new URL(sessionUrl);
  const socketUrl = `wss://${parsed.host}/socket.io/?${parsed.searchParams.toString()}&EIO=4&transport=websocket`;

  return createWebSocketConnector({
    service: 'chzzk',
    url: socketUrl,
    onOpen: () => {},
    onMessage: (event, ws) => handleSocketIoMessage('chzzk', String(event.data), ws),
    onClose: () => scheduleReconnect('chzzk', overlayUrl, 'Socket closed', attempt)
  });
}

function handleSocketIoMessage(service, packet, ws) {
  if (packet === '2') {
    ws.send('3');
    return;
  }
  if (packet.startsWith('0')) {
    ws.send('40');
    return;
  }
  if (packet.startsWith('40')) {
    setServiceState(service, { status: 'connected', message: 'Connected', connectedAt: Date.now(), reconnectAt: null });
    return;
  }
  if (packet.startsWith('42')) {
    const payload = parseJsonMessage(packet.slice(2));
    if (!Array.isArray(payload)) return;
    const [eventName, raw] = payload;
    const body = typeof raw === 'string' ? parseJsonMessage(raw) : raw;
    if (eventName === 'error') {
      setServiceState(service, { status: 'error', message: String(raw || 'Socket auth error') });
      return;
    }
    if (eventName !== 'donation' || !body || !isLikelyVideoDonation(body)) return;
    const duration = normalizeDurationFromPayload(body);
    if (duration) enqueuePause(service, duration, body);
  }
}

async function createAruBotConnector(overlayUrl, attempt) {
  const { parsed, token } = parseAruBotViewerUrl(overlayUrl);
  if (!token) throw new Error('AruBot PVD token not found');
  const apiBase = inferAruBotApiBase(parsed);
  const wsUrl = buildAruBotWsUrl(apiBase, token);

  async function handleAruBotStart(payload) {
    if (!payload || payload.type === 'pong') return;
    const item = payload.item || null;
    if (!item) {
      setServiceState('arubot', { status: 'connected', message: 'Connected, waiting' });
      return;
    }
    const duration = normalizeAruBotRemainingDuration(payload);
    if (duration) {
      await enqueuePause('arubot', duration, {
        ...item,
        id: getAruBotItemId(payload),
        title: item.title || item.videoTitle || item.mediaTitle || 'AruBot video donation'
      });
    }
  }

  return createWebSocketConnector({
    service: 'arubot',
    url: wsUrl,
    onOpen: () => {
      setServiceState('arubot', { status: 'connected', message: `Connected: ${new URL(apiBase).host}` });
      fetchAruBotNowPlaying(apiBase, token)
        .then((payload) => handleAruBotStart({ type: 'start', ...payload }))
        .catch(() => {});
    },
    onMessage: (event) => {
      const payload = parseJsonMessage(String(event.data));
      if (!payload) return;
      if (payload.type === 'start') return handleAruBotStart(payload);
      if (payload.type === 'control') {
        setServiceState('arubot', { status: 'connected', message: `Control: ${payload.op || 'sync'}` });
      }
    },
    onClose: () => scheduleReconnect('arubot', overlayUrl, 'Socket closed', attempt)
  });
}

function parseAruBotViewerUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('AruBot PVD URL required');

  let parsed = null;
  if (/^https?:\/\//i.test(raw)) {
    parsed = new URL(raw);
  } else if (/^\/?viewer\/pvd\//i.test(raw) || /^\/?pvd\//i.test(raw)) {
    parsed = new URL(raw.replace(/^\/?/, '/'), 'https://arubot.yuaru.com');
  } else if (/^[A-Za-z0-9_-]{8,}$/.test(raw)) {
    parsed = new URL(`/pvd/${encodeURIComponent(raw)}`, 'https://arubot.yuaru.com');
  } else {
    parsed = new URL(raw);
  }

  const token = parsed.searchParams.get('token') ||
    parsed.searchParams.get('viewerToken') ||
    parsed.searchParams.get('pvdToken') ||
    matchFirst(parsed.pathname, /\/viewer\/pvd\/([^/?#]+)/) ||
    matchFirst(parsed.pathname, /\/pvd\/([^/?#]+)/);
  return { parsed, token };
}

function inferAruBotApiBase(parsed) {
  const configured = runtime.settings.arubotApiBaseUrl;
  if (configured) return configured.replace(/\/+$/, '');

  const explicit = parsed.searchParams.get('apiBase') ||
    parsed.searchParams.get('apiBaseUrl') ||
    parsed.searchParams.get('backend') ||
    parsed.searchParams.get('backendUrl');
  if (explicit && /^https?:\/\//i.test(explicit)) return explicit.replace(/\/+$/, '');

  const host = parsed.hostname.toLowerCase();
  if (host === 'arubot.yuaru.com') return 'https://arubotapi.yuaru.com';
  if (host === 'arubotapi.yuaru.com') return parsed.origin;

  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (isLocal && parsed.port !== '3001') return `${parsed.protocol}//127.0.0.1:3001`;
  return parsed.origin;
}

function buildAruBotWsUrl(apiBase, token) {
  const apiUrl = new URL(apiBase);
  const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${apiUrl.host}/api/pvd/ws?token=${encodeURIComponent(token)}`;
}

async function fetchAruBotNowPlaying(apiBase, token) {
  const response = await fetch(`${apiBase}/api/video-donation/now-playing?token=${encodeURIComponent(token)}`, {
    credentials: 'include',
    cache: 'no-store',
    headers: { accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`AruBot now-playing HTTP ${response.status}`);
  return response.json();
}

function getAruBotItemId(payload) {
  const item = payload?.item || {};
  return item.id ||
    item.queueId ||
    item.donationId ||
    item.videoDonationId ||
    `${item.mediaProvider || 'youtube'}:${item.mediaId || item.videoId || item.embedUrl || item.mediaUrl || 'unknown'}:${payload.startedAt || item.createdAt || item.startSec || 0}`;
}

function normalizeAruBotRemainingDuration(payload) {
  const item = payload?.item || payload;
  const total = normalizeDurationFromPayload(item) || normalizeDurationFromPayload(payload);
  if (!total) return null;

  const startSec = pickNumber(item, ['startSec', 'startSecond', 'vStart', 'video_begin']) || 0;
  let elapsed = pickNumber(payload, ['elapsedSec', 'elapsedSecond']);
  if (elapsed == null) {
    const atSec = pickNumber(payload, ['atSec', 'currentSec', 'currentSecond']);
    if (atSec != null) elapsed = Math.max(0, atSec - startSec);
  }
  if (elapsed == null && payload?.startedAt) {
    const referenceNow = Number(payload.serverNow || Date.now());
    const startedAt = Number(payload.startedAt);
    if (Number.isFinite(referenceNow) && Number.isFinite(startedAt) && referenceNow > startedAt) {
      elapsed = Math.floor((referenceNow - startedAt) / 1000);
    }
  }
  const remaining = total - Math.max(0, Number(elapsed || 0));
  return remaining > 0 ? Math.ceil(remaining) : null;
}

function matchFirst(text, regex) {
  const match = String(text || '').match(regex);
  return match ? match[1] : '';
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'get-state') {
      sendResponse(getPublicState());
      return;
    }
    if (message?.type === 'save-settings') {
      await saveSettings(message.settings);
      sendResponse({ ok: true, state: getPublicState() });
      return;
    }
    if (message?.type === 'toggle-monitoring') {
      await saveSettings({ ...runtime.settings, monitoring: Boolean(message.monitoring) });
      sendResponse({ ok: true, state: getPublicState() });
      return;
    }
    if (message?.type === 'test-pause') {
      await enqueuePause('arubot', normalizeSeconds(message.durationSec, 10), { id: `test-${Date.now()}`, title: 'Manual test' });
      sendResponse({ ok: true, state: getPublicState() });
      return;
    }
    if (message?.type === 'clear-pause') {
      await resumeYouTube();
      broadcastState();
      sendResponse({ ok: true, state: getPublicState() });
      return;
    }
  })().catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});

api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  runtime.settings = mergeSettings(DEFAULT_SETTINGS, changes.settings.newValue);
});

api.runtime.onInstalled.addListener(async () => {
  await loadSettings();
  restartConnectors();
});

api.runtime.onStartup.addListener(async () => {
  await loadSettings();
  restartConnectors();
});

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'aru-pause-tick') {
    compactQueues();
    runtime.pauseUntil = effectivePauseUntil();
    if (runtime.pauseUntil > Date.now()) pauseYouTube(runtime.pauseUntil);
    else if (runtime.pauseUntil > 0) resumeYouTube();
    broadcastState();
  }
});

(async function init() {
  await loadSettings();
  restartConnectors();
  api.alarms.create('aru-pause-tick', { periodInMinutes: 0.5 });
  setInterval(() => {
    compactQueues();
    broadcastState();
  }, 1000);
})();
