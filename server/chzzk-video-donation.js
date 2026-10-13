import WebSocket from 'ws';

const API_BASE = 'https://api.chzzk.naver.com/manage/v1';
const MAX_PAYLOAD = 64 * 1024;
const MAX_SECONDS = 6 * 60 * 60;
const REQUEST_TIMEOUT = 10_000;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const own = (value, key) => Object.hasOwn(value, key);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Verified against the first-party A5 overlay on 2026-10-12:
// https://ssl.pstatic.net/static/nng/glive/resource/p/static/js/index-VdvK-ysl.js
// Ib: GET /video-session/{key}/alert-setting; _R: GET /alerts/{key}/session-url.
// xR/SR: PUT /video-session/{key}/donations/{id}/play|end. AUTO_PLAY waits 3s.
// delayMs/durationSec describe requested timing, not observed playback or buffering.

function badSettings(message) {
  return Object.assign(new Error(message), { status: 400, statusCode: 400 });
}

function normalizeOverlayUrl(value) {
  if (value === '') return '';
  const invalid = () => badSettings('\uCE58\uC9C0\uC9C1 \uC601\uC0C1 \uD6C4\uC6D0 \uC624\uBC84\uB808\uC774 URL\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.');
  if (typeof value !== 'string' || value.length > 4096) throw invalid();
  // Match the raw input too: URL parsing alone silently normalizes slashes/dot segments.
  if (!/^https:\/\/chzzk\.naver\.com\/video-donation\/video@[a-zA-Z0-9_-]{1,256}(?:\?[^#\s\\]*)?$/.test(value)) throw invalid();
  const url = new URL(value);
  url.search = '';
  return url.href;
}

/** Read persisted flat keys, or merge a partial flat/normalized patch without clearing omitted keys. */
export function normalizeChzzkVideoDonationSettings(settings = {}, patch) {
  const previous = isObject(settings) ? settings : {};
  const next = isObject(patch) ? patch : {};
  function field(flat, short, fallback) {
    for (const source of [next, previous]) {
      for (const key of [flat, short]) {
        if (own(source, key) && source[key] !== undefined) return source[key];
      }
    }
    return fallback;
  }
  function boolean(flat, short) {
    const value = field(flat, short, false);
    if (typeof value !== 'boolean') {
      throw badSettings('\uCE58\uC9C0\uC9C1 \uC601\uC0C1 \uD6C4\uC6D0 \uC124\uC815\uC740 \uCC38 \uB610\uB294 \uAC70\uC9D3\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4.');
    }
    return value;
  }
  return {
    pauseEnabled: boolean('videoDonationChzzkPauseEnabled', 'pauseEnabled'),
    queueEnabled: boolean('videoDonationChzzkQueueEnabled', 'queueEnabled'),
    overlayUrl: normalizeOverlayUrl(field('videoDonationChzzkOverlaySecret', 'overlayUrl', '')),
  };
}

/** Never send the private normalizer's overlayUrl to public config consumers. */
export function publicChzzkVideoDonationSettings(settings) {
  const { pauseEnabled, queueEnabled, overlayUrl } = normalizeChzzkVideoDonationSettings(settings);
  return { pauseEnabled, queueEnabled, configured: Boolean(overlayUrl) };
}

function parseObject(payload) {
  try {
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > MAX_PAYLOAD) return null;
    const value = typeof payload === 'string' ? JSON.parse(payload) : payload;
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

function identifier(value) {
  if (Number.isSafeInteger(value) && value >= 0) value = String(value);
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : null;
}

function number(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value))) return NaN;
  return Number(value);
}

function text(value, limit) {
  return typeof value === 'string' ? value.replace(/\p{Cc}/gu, '').trim().slice(0, limit) : '';
}

/** Invalid/non-media events return null. Missing endSecond stays unknown, never guessed. */
export function extractChzzkVideoDonation(payload) {
  const data = parseObject(payload);
  if (!data || !['AUTO_PLAY', 'VIDEO_PLAY'].includes(data.playMode)) return null;
  const donationId = identifier(data.donationId);
  const mediaId = identifier(data.videoId);
  if (!donationId || !mediaId) return null;
  const provider = data.videoType === 'YOUTUBE' ? 'youtube' : data.videoType === 'CHZZK_CLIP' ? 'chzzk_clip' : null;
  if (!provider || (provider === 'youtube' && !/^[a-zA-Z0-9_-]{11}$/.test(mediaId))) return null;
  for (const key of ['titleExpose', 'isAnonymous']) {
    if (data[key] != null && typeof data[key] !== 'boolean') return null;
  }
  const startSec = data.startSecond == null ? 0 : number(data.startSecond);
  const endSec = data.endSecond == null ? null : number(data.endSecond);
  if (!Number.isFinite(startSec) || startSec < 0 || startSec >= MAX_SECONDS) return null;
  if (endSec !== null && (!Number.isFinite(endSec) || endSec <= startSec || endSec > MAX_SECONDS)) return null;
  const amount = data.payAmount == null ? 0 : number(data.payAmount);
  if (!Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER) return null;
  const profile = data.isAnonymous === true ? null : parseObject(data.profile);
  return {
    donationId,
    provider,
    mediaId,
    url: provider === 'youtube' ? `https://www.youtube.com/watch?v=${mediaId}` : `https://chzzk.naver.com/clips/${mediaId}`,
    // donationText is the upstream title; videoDescription is separate donor commentary.
    title: data.titleExpose === true ? text(data.donationText, 500) : '',
    username: text(profile?.nickname, 100) || '\uC775\uBA85\uC758 \uD6C4\uC6D0\uC790',
    userId: identifier(profile?.userIdHash) || '',
    startSec,
    durationSec: endSec === null ? null : endSec - startSec,
    endSec,
    playMode: data.playMode,
    amount,
    delayMs: data.playMode === 'AUTO_PLAY' ? 3000 : 0,
  };
}

function sessionSocketUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\s\\#]/.test(value)) throw new Error('session');
  const url = new URL(value);
  const hostPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+nchat\.naver\.com$/;
  if (!['https:', 'wss:'].includes(url.protocol) || !hostPattern.test(url.hostname)
    || url.username || url.password || url.port || !['/', '/socket.io', '/socket.io/'].includes(url.pathname)) {
    throw new Error('session');
  }
  // Reject encoded or normalized paths even if the URL parser would accept them.
  if (!/^(?:https|wss):\/\/[^/?#]+(?:\/(?:socket\.io\/?)?)?(?:\?[^#]*)?$/.test(value)) throw new Error('session');
  url.protocol = 'wss:';
  url.pathname = '/socket.io/';
  url.searchParams.delete('sid');
  url.searchParams.set('EIO', '3');
  url.searchParams.set('transport', 'websocket');
  return url.href;
}

async function responseJson(response) {
  const length = Number(response.headers?.get('content-length'));
  if (length > MAX_PAYLOAD) {
    await response.body?.cancel();
    throw new Error('payload');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('body');
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PAYLOAD) throw new Error('payload');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/**
 * onStatus(status, error?) receives only fixed, secret-free strings.
 * onSettings receives raw VIDEO alert settings, including the initial HTTP snapshot.
 * No playback acknowledgements are generated from arrival/timers; the runtime calls notifyPlayback.
 */
export function createChzzkVideoDonationConnector({
  overlayUrl = '', onDonation, onControl, onSettings, onStatus,
  fetchImpl = globalThis.fetch, WebSocketImpl = WebSocket,
} = {}) {
  const normalizedUrl = normalizeOverlayUrl(overlayUrl);
  const key = normalizedUrl ? new URL(normalizedUrl).pathname.split('/').at(-1) : '';
  let closed = false;
  let current = null;
  let retryTimer = null;
  let failures = 0;
  const requests = new Set();
  const playbackRequests = new Map();

  function status(state, error) {
    try {
      Promise.resolve(onStatus?.(state, error)).catch(() => {});
    } catch { /* Status consumers must not break cleanup/recovery. */ }
  }

  function deliver(callback, value) {
    if (closed) return;
    try {
      Promise.resolve(callback?.(value)).catch(() => {
        if (!closed) status('error', 'CHZZK callback failed.');
      });
    } catch {
      status('error', 'CHZZK callback failed.');
    }
  }

  async function request(path, { method = 'GET', signal, json = true } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    requests.add(controller);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted || closed) abort();
    const timer = setTimeout(abort, REQUEST_TIMEOUT);
    timer.unref?.();
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(new Error('aborted'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
    const url = `${API_BASE}${path}`;
    try {
      return await Promise.race([aborted, (async () => {
        if (controller.signal.aborted) throw new Error('aborted');
        const response = await fetchImpl(url, {
          method, redirect: 'error', credentials: 'omit', cache: 'no-store',
          headers: { Accept: 'application/json' }, signal: controller.signal,
        });
        if (controller.signal.aborted || !response.ok || response.redirected || (response.url && response.url !== url)) {
          await response.body?.cancel();
          throw new Error('response');
        }
        if (!json && response.status === 204) {
          await response.body?.cancel();
          return true;
        }
        const result = await responseJson(response);
        if (!isObject(result) || (result.code != null && result.code !== 200)) throw new Error('response');
        return json ? result.content : true;
      })()]);
    } catch {
      throw new Error('CHZZK request failed.');
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
      signal?.removeEventListener('abort', abort);
      requests.delete(controller);
    }
  }

  function dispose(attempt) {
    attempt.abort.abort();
    for (const timer of attempt.timers) clearTimeout(timer);
    attempt.timers.clear();
    try {
      if (attempt.socket?.terminate) attempt.socket.terminate();
      else attempt.socket?.close();
    } catch { /* A failed handshake may already have destroyed the transport. */ }
  }

  function fail(attempt) {
    if (closed || current !== attempt) return;
    current = null;
    dispose(attempt);
    status('error', 'CHZZK connection failed.');
    if (closed) return;
    status('retrying');
    if (closed) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5));
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay);
    retryTimer.unref?.();
  }

  function schedule(attempt, callback, delay) {
    const timer = setTimeout(() => {
      attempt.timers.delete(timer);
      if (!closed && current === attempt) callback();
    }, delay);
    timer.unref?.();
    attempt.timers.add(timer);
    return timer;
  }

  function cancel(attempt, timer) {
    clearTimeout(timer);
    attempt.timers.delete(timer);
  }

  function settings(payload, initial = false) {
    const value = parseObject(payload);
    if (!value || (!initial && value.donationType !== 'VIDEO')
      || (own(value, 'alertPauseActive') && typeof value.alertPauseActive !== 'boolean')) return null;
    if (initial && typeof value.alertPauseActive !== 'boolean') return null;
    return value;
  }

  async function connect() {
    if (closed || current || !key) return;
    const attempt = { abort: new AbortController(), timers: new Set(), socket: null };
    current = attempt;
    status('connecting');
    try {
      const session = await request(`/alerts/${key}/session-url`, { signal: attempt.abort.signal });
      if (closed || current !== attempt) return;
      const socketUrl = sessionSocketUrl(session?.sessionUrl);
      const initial = settings(await request(`/video-session/${key}/alert-setting`, { signal: attempt.abort.signal }), true);
      if (closed || current !== attempt) return;
      if (!initial) throw new Error('settings');
      deliver(onSettings, initial);
      if (closed || current !== attempt) return;
      const socket = new WebSocketImpl(socketUrl, {
        maxPayload: MAX_PAYLOAD, perMessageDeflate: false,
        followRedirects: false, handshakeTimeout: REQUEST_TIMEOUT,
      });
      attempt.socket = socket;
      let handshake = null;
      let connected = false;
      let pingTimer = null;
      let pongTimer = null;
      const connectTimer = schedule(attempt, () => fail(attempt), REQUEST_TIMEOUT);
      const send = message => {
        try { socket.send(message); } catch { fail(attempt); }
      };
      const ping = () => {
        // EIO3 is CLIENT ping -> SERVER pong, unlike EIO4.
        pongTimer = schedule(attempt, () => fail(attempt), handshake.pingTimeout);
        send('2');
      };
      socket.on('error', () => fail(attempt));
      socket.on('close', () => fail(attempt));
      socket.on('unexpected-response', (_request, response) => {
        response.destroy();
        fail(attempt);
      });
      socket.on('message', (raw, isBinary) => {
        if (closed || current !== attempt) return;
        if (isBinary || (!Buffer.isBuffer(raw) && typeof raw !== 'string') || Buffer.byteLength(raw) > MAX_PAYLOAD) {
          fail(attempt);
          return;
        }
        const packet = raw.toString();
        if (packet.startsWith('0')) {
          const value = parseObject(packet.slice(1));
          if (handshake || !value || typeof value.sid !== 'string' || !value.sid || value.sid.length > 256
            || !Number.isInteger(value.pingInterval) || value.pingInterval < 1 || value.pingInterval > 120_000
            || !Number.isInteger(value.pingTimeout) || value.pingTimeout < 1 || value.pingTimeout > 120_000) {
            fail(attempt);
            return;
          }
          handshake = value;
          pingTimer = schedule(attempt, ping, handshake.pingInterval);
        } else if (packet === '40' && handshake && !connected) {
          connected = true;
          cancel(attempt, connectTimer);
          status('connected');
        } else if (packet === '3' && handshake && pongTimer !== null) {
          cancel(attempt, pongTimer);
          pongTimer = null;
          if (connected) failures = 0;
          cancel(attempt, pingTimer);
          pingTimer = schedule(attempt, ping, handshake.pingInterval);
        } else if (packet === '1' || packet === '41' || packet.startsWith('44') || /^4[56]/.test(packet)) {
          fail(attempt);
        } else if (packet.startsWith('42') && connected) {
          let event;
          try { event = JSON.parse(packet.slice(2)); } catch { return; }
          if (!Array.isArray(event) || event.length !== 2) return;
          if (event[0] === 'donation') {
            const donation = extractChzzkVideoDonation(event[1]);
            if (donation) deliver(onDonation, donation);
          } else if (event[0] === 'donationControl') {
            const control = parseObject(event[1]);
            const donationId = identifier(control?.donationId);
            if (donationId && control.stopVideo === true) deliver(onControl, { donationId, stopVideo: true });
          } else if (event[0] === 'donationSetting') {
            const value = settings(event[1]);
            if (value) deliver(onSettings, value);
          }
        }
      });
    } catch {
      fail(attempt);
    }
  }

  function notifyPlayback(donationId, action) {
    const id = identifier(donationId);
    if (closed || !key || id === 'TEST') return Promise.resolve(false);
    if (!id || !['play', 'end'].includes(action)) return Promise.reject(badSettings('\uC601\uC0C1 \uD6C4\uC6D0 \uC7AC\uC0DD \uC54C\uB9BC \uC694\uCCAD\uC774 \uC62C\uBC14\uB974\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.'));
    const requestKey = `${id}/${action}`;
    if (playbackRequests.has(requestKey)) return playbackRequests.get(requestKey);
    if (playbackRequests.size >= 32) return Promise.reject(new Error('CHZZK playback notification busy.'));
    const pending = request(`/video-session/${key}/donations/${id}/${action}`, { method: 'PUT', json: false })
      .catch(() => {
        if (!closed) status('error', 'CHZZK playback notification failed.');
        throw new Error('CHZZK playback notification failed.');
      }).finally(() => playbackRequests.delete(requestKey));
    playbackRequests.set(requestKey, pending);
    return pending;
  }

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(retryTimer);
    retryTimer = null;
    const attempt = current;
    current = null;
    if (attempt) dispose(attempt);
    for (const controller of requests) controller.abort();
    status('disabled');
  }

  // Start after returning the handle, so even an initial callback can call close().
  queueMicrotask(() => {
    if (closed) return;
    if (key) void connect();
    else status('disabled');
  });
  return { close, notifyPlayback };
}
