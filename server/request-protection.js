import proxyaddr from 'proxy-addr';
import ipaddr from 'ipaddr.js';
import { hasZalgoText, inspectTextPayload, createSafeJsonReplacer } from '../shared/text-safety.js';
import { MAX_ORIGINAL_BYTES } from '../shared/drawing/limits.js';

const DEFAULT_LIMITS = Object.freeze({
  buckets: 20000,
  httpPerMinute: 1200,
  httpPerSecondGlobal: 1000,
  httpConcurrent: 96,
  httpConcurrentPerIp: 24,
  bodyBytesPerTenSecondsGlobal: 128 * 1024 * 1024,
  bodyBytesPerMinutePerIp: 64 * 1024 * 1024,
  upgradesPerMinute: 120,
  sockets: 2048,
  socketsPerIp: 32,
  messagesPerTenSeconds: 120,
  framesPerSecondGlobal: 1000,
  messageBytesPerTenSecondsGlobal: 32 * 1024 * 1024,
  messageBytesPerTenSecondsPerIp: 4 * 1024 * 1024,
  bufferedBytes: 8 * 1024 * 1024,
  socketSetupTimeoutMs: 15000,
});

export function getClientNetworkKey(req, trustProxy) {
  try {
    const raw = proxyaddr(req, trustProxy);
    const address = ipaddr.process(raw);
    if (address.kind() === 'ipv4') return address.toString();
    // Group IPv6 privacy addresses so rotating within one /64 cannot reset the budget.
    return address.parts.slice(0, 4).map((part) => part.toString(16)).join(':') + '::/64';
  } catch {
    return String(req.socket?.remoteAddress || 'unknown');
  }
}

export function createBoundedRateStore({ maxEntries = DEFAULT_LIMITS.buckets, now = Date.now } = {}) {
  const buckets = new Map();
  let nextSweepAt = 0;
  return {
    get size() { return buckets.size; },
    take(key, max, windowMs, cost = 1) {
      const time = now();
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= time) {
        if (time >= nextSweepAt) {
          for (const [id, entry] of buckets) if (entry.resetAt <= time) buckets.delete(id);
          nextSweepAt = time + 1000;
        }
        if (!buckets.has(key) && buckets.size >= maxEntries) return 1;
        bucket = { count: 0, resetAt: time + windowMs };
        buckets.set(key, bucket);
      }
      if (bucket.count + cost > max) return Math.max(1, Math.ceil((bucket.resetAt - time) / 1000));
      bucket.count += cost;
      return 0;
    },
  };
}

function rejectHttp(res, status, code, retryAfter = 1) {
  res.setHeader('Cache-Control', 'no-store');
  if (status === 429 || status === 503) res.setHeader('Retry-After', String(retryAfter));
  return res.status(status).json({ error: code });
}

export function rejectUnsafeTextInput(req, res, next) {
  let pathname;
  try { pathname = decodeURIComponent(String(req.path || '')); } catch { return rejectHttp(res, 400, 'invalid_request_path'); }
  const error = inspectTextPayload([pathname, req.query, req.body]);
  if (error) return rejectHttp(res, error === 'payload_too_complex' ? 413 : 400, error);
  return next();
}

export function createRequestProtection({ trustProxy = proxyaddr.compile('loopback'), limits = {}, now = Date.now } = {}) {
  const config = { ...DEFAULT_LIMITS, ...limits };
  const rates = createBoundedRateStore({ maxEntries: config.buckets, now });
  const requests = new Map();
  const sockets = new Map();
  let activeRequests = 0;
  let activeSockets = 0;
  const clientKey = (req) => getClientNetworkKey(req, trustProxy);

  const rateLimiter = ({ prefix, max, windowMs }) => (req, res, next) => {
    const retryAfter = rates.take(`${prefix}:${clientKey(req)}`, max, windowMs);
    return retryAfter ? rejectHttp(res, 429, 'Too many requests', retryAfter) : next();
  };

  const http = (req, res, next) => {
    if (String(req.url || '').length > 8192) return rejectHttp(res, 414, 'request_url_too_long');
    const key = clientKey(req);
    const retryAfter = rates.take('http:global', config.httpPerSecondGlobal, 1000)
      || rates.take(`http:${key}`, config.httpPerMinute, 60000)
      || (/^\/api\/(auth|apikey)(\/|$)/i.test(req.path || '') ? rates.take(`auth:${key}`, 60, 60000) : 0);
    if (retryAfter) return rejectHttp(res, 429, 'Too many requests', retryAfter);
    const bodyLength = Number(req.headers?.['content-length']);
    const hasBody = bodyLength > 0 || !!req.headers?.['transfer-encoding'] || !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (bodyLength > MAX_ORIGINAL_BYTES) return rejectHttp(res, 413, 'request_body_too_large');
    if (hasBody) {
      // Reserve the parser's maximum for chunked bodies before consuming any bytes.
      const budget = Number.isFinite(bodyLength) ? bodyLength : MAX_ORIGINAL_BYTES;
      const bodyRetry = rates.take('http-body:global', config.bodyBytesPerTenSecondsGlobal, 10000, budget)
        || rates.take(`http-body:${key}`, config.bodyBytesPerMinutePerIp, 60000, budget);
      if (bodyRetry) return rejectHttp(res, 429, 'request_body_rate_exceeded', bodyRetry);
    }
    const expensive = hasBody && (!Number.isFinite(bodyLength) || bodyLength > 256 * 1024
      || /^\/api\/(drawing-donation\/(originals|submit)|automations\/assets\/sounds)\/?$/i.test(req.path || ''));
    const weight = expensive ? 12 : 1;
    const count = requests.get(key) || 0;
    if (activeRequests + weight > config.httpConcurrent) return rejectHttp(res, 503, 'server_busy');
    if (count + weight > config.httpConcurrentPerIp) return rejectHttp(res, 429, 'too_many_concurrent_requests');
    activeRequests += weight;
    requests.set(key, count + weight);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeRequests -= weight;
      const remaining = (requests.get(key) || weight) - weight;
      if (remaining > 0) requests.set(key, remaining);
      else requests.delete(key);
    };
    res.once('finish', release);
    res.once('close', release);
    res.setTimeout?.(60000, () => res.destroy());
    return next();
  };

  const upgrade = (req, socket) => {
    const key = clientKey(req);
    const retryAfter = rates.take('upgrade:global', 200, 1000)
      || rates.take(`upgrade:${key}`, config.upgradesPerMinute, 60000);
    const count = sockets.get(key) || 0;
    if (String(req.url || '').length > 8192 || retryAfter || count >= config.socketsPerIp || activeSockets >= config.sockets) {
      socket.end(`HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nRetry-After: ${retryAfter || 1}\r\nContent-Length: 0\r\n\r\n`);
      const timer = setTimeout(() => socket.destroy(), 1000);
      timer.unref?.();
      socket.once('close', () => clearTimeout(timer));
      return false;
    }
    activeSockets += 1;
    sockets.set(key, count + 1);
    socket.once('close', () => {
      activeSockets -= 1;
      const remaining = (sockets.get(key) || 1) - 1;
      if (remaining > 0) sockets.set(key, remaining);
      else sockets.delete(key);
    });
    return true;
  };

  const protectSocket = (ws, req) => {
    const key = clientKey(req);
    const localRates = createBoundedRateStore({ maxEntries: 1, now });
    const emit = ws.emit;
    const send = ws.send;
    let blocked = false;
    let terminationTimer;
    let setupTimer;
    const block = (code, reason) => {
      if (blocked) return;
      blocked = true;
      terminationTimer = setTimeout(() => ws.terminate(), 1000);
      terminationTimer.unref?.();
      try { ws.close(code, reason); } catch { ws.terminate(); }
    };
    const setupComplete = () => clearTimeout(setupTimer);
    ws.__arubotSetupComplete = setupComplete;
    setupTimer = setTimeout(() => block(1013, 'Connection setup timed out'), config.socketSetupTimeoutMs);
    setupTimer.unref?.();
    ws.on('newListener', (event) => { if (event === 'message') setupComplete(); });
    ws.once('close', () => { clearTimeout(terminationTimer); setupComplete(); });
    ws.on('error', () => block(1011, 'Connection error'));
    // EventEmitter listeners cannot cancel later listeners; gate delivery before application handlers.
    ws.emit = function guardedSocketEvent(event, ...args) {
      if (event === 'message' || event === 'ping' || event === 'pong') {
        if (blocked) return false;
        const bytes = typeof args[0] === 'string' ? Buffer.byteLength(args[0]) : Number(args[0]?.byteLength || 0);
        if (localRates.take('frames', config.messagesPerTenSeconds, 10000)
          || (event === 'message'
            ? rates.take('ws-frames:global', config.framesPerSecondGlobal, 1000)
            : rates.take('ws-control:global', Math.max(config.framesPerSecondGlobal, config.sockets * 4), 1000))
          || rates.take('ws-bytes:global', config.messageBytesPerTenSecondsGlobal, 10000, bytes)
          || rates.take(`ws-bytes:${key}`, config.messageBytesPerTenSecondsPerIp, 10000, bytes)) {
          block(1008, 'Message rate limit exceeded');
          return false;
        }
        if (event === 'message') {
          try {
            const payload = JSON.parse(String(args[0]));
            if (inspectTextPayload(payload)) { block(1008, 'Unsafe text or payload'); return false; }
          } catch { block(1007, 'Invalid JSON'); return false; }
        }
      }
      return emit.call(this, event, ...args);
    };
    ws.send = function guardedSocketSend(data, ...args) {
      if (blocked) return;
      setupComplete();
      const bytes = typeof data === 'string' ? Buffer.byteLength(data) : Number(data?.byteLength || 0);
      if (this.bufferedAmount + bytes > config.bufferedBytes) { block(1013, 'Slow consumer'); return; }
      if (typeof data === 'string' && hasZalgoText(data)) {
        try { data = JSON.stringify(JSON.parse(data), createSafeJsonReplacer()); }
        catch { block(1008, 'Unsafe text'); return; }
      }
      return send.call(this, data, ...args);
    };
  };

  return { http, rateLimiter, upgrade, protectSocket, clientKey };
}
