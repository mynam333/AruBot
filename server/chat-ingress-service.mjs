import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import proxyaddr from 'proxy-addr';
import { ChatIngressError, createChatIngressJournal } from './chat-ingress-journal.mjs';

const PROVIDERS = new Set(['chzzk', 'cime', 'youtube']);
const CONTROL_PREFIXES = ['/session', '/sessions', '/events', '/runtime', '/status', '/api/runtime'];
const HASH = (value) => createHash('sha256').update(value).digest();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function validateSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 4096 || /[\r\n]/.test(secret)) {
    throw new Error('ARUBOT_CHAT_INGRESS_SECRET must contain at least 32 characters');
  }
  return secret;
}

export async function loadChatIngressSecret(env = process.env) {
  if (env.ARUBOT_CHAT_INGRESS_SECRET) return validateSecret(env.ARUBOT_CHAT_INGRESS_SECRET);
  if (!env.ARUBOT_CHAT_INGRESS_SECRET_FILE) throw new Error('Chat ingress secret or secret file is required');
  const filename = path.resolve(env.ARUBOT_CHAT_INGRESS_SECRET_FILE);
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.size > 8192 || (process.platform !== 'win32' && (stat.mode & 0o077))) {
    throw new Error('Chat ingress secret file must be a private regular file (0600)');
  }
  return validateSecret((await fs.readFile(filename, 'utf8')).trim());
}

function text(value, name, max = 512) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new ChatIngressError('invalid_request', `Invalid ${name}`, 400);
  }
  return value;
}

function sessionIdentity(body, full = true) {
  const provider = text(body.provider, 'provider', 32);
  if (!PROVIDERS.has(provider)) throw new ChatIngressError('invalid_provider', 'Unknown provider', 400);
  const result = { provider, ownerUserId: text(body.ownerUserId, 'ownerUserId') };
  if (full) Object.assign(result, {
    sid: text(body.sid, 'sid'),
    channelId: body.channelId == null || body.channelId === '' ? null : text(body.channelId, 'channelId'),
  });
  return result;
}

function targetUrl(value, forbiddenPorts) {
  let url;
  try { url = new URL(value); } catch { throw new ChatIngressError('invalid_target', 'Invalid runtime URL', 400); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !url.port
      || forbiddenPorts.has(Number(url.port))) {
    throw new ChatIngressError('invalid_target', 'Runtime target must be an independent loopback HTTP port', 400);
  }
  return url.origin;
}

function json(response, status, body) {
  if (response.headersSent || response.destroyed) return;
  const data = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(data);
}

function isControlPath(requestUrl) {
  try {
    const decoded = decodeURIComponent(new URL(requestUrl, 'http://ingress.invalid').pathname).replace(/\\/g, '/').replace(/\/+/g, '/');
    const pathname = new URL(decoded, 'http://ingress.invalid').pathname.toLowerCase();
    return CONTROL_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));
  } catch { return true; }
}

async function readJson(request, limit) {
  const length = Number(request.headers['content-length']);
  if (Number.isFinite(length) && length > limit) throw new ChatIngressError('request_too_large', 'Request is too large', 413);
  if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') {
    throw new ChatIngressError('unsupported_encoding', 'Compressed control requests are not supported', 415);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new ChatIngressError('request_too_large', 'Request is too large', 413);
    chunks.push(chunk);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new ChatIngressError('invalid_json', 'Expected a JSON object', 400); }
}

function safeMetadata(identity, value) {
  const credentials = /^(?:access_?token|refresh_?token|id_?token|token|authorization|password|secret|client_?secret|cookie|set-cookie|credentials|oauth)$/i;
  const clean = (item, depth = 0) => {
    if (depth > 8 || item == null) return null;
    if (Array.isArray(item)) return item.map((child) => clean(child, depth + 1));
    if (typeof item !== 'object') return item;
    return Object.fromEntries(Object.entries(item).filter(([key]) => !credentials.test(key)).map(([key, child]) => [key, clean(child, depth + 1)]));
  };
  return { ...identity, ...(value && typeof value === 'object' ? clean(value) : {}), provider: identity.provider, ownerUserId: identity.ownerUserId, sid: identity.sid };
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onListen); reject(error); };
    const onListen = () => { server.off('error', onError); resolve(server.address()); };
    server.once('error', onError);
    server.once('listening', onListen);
    server.listen(port, host);
  });
}

export function createChatIngressService({
  journal,
  providers,
  secret,
  controlPort = 3701,
  publicPort = 3001,
  publicHost = '0.0.0.0',
  maxRequestBytes = 64 * 1024,
  requestTimeoutMs = 10_000,
  runtimeProbeIntervalMs = 5000,
  runtimeProbeTimeoutMs = 3000,
  compactionIntervalMs = 60 * 60 * 1000,
  compactionThresholdBytes = 64 * 1024 * 1024,
  trustedProxies = ['loopback'],
  maxPendingRequests = 128,
  maxPendingBytes = 8 * 1024 * 1024,
  drainWaitTimeoutMs = 20_000,
  logger = console,
} = {}) {
  if (!journal || !providers) throw new Error('journal and providers are required');
  const secretHash = HASH('Bearer ' + validateSecret(secret));
  const trustProxy = proxyaddr.compile(trustedProxies);
  const sessions = new Map();
  const sessionTails = new Map();
  const sockets = new Set();
  const proxyRequests = new Set();
  const webSockets = new Set();
  const pendingRequests = new Set();
  let pendingBytes = 0;
  const forbiddenPorts = new Set([Number(controlPort), Number(publicPort)]);
  let fatal = null;
  let stopping = false;
  let started = false;
  let providerShutdown = null;
  let monitorTimer;
  let compactTimer;
  let probeRunning = false;
  let stopPromise;
  let compactionPromise;
  let lastCompactionBytes = 0;

  function authenticated(request) {
    const value = request.headers.authorization;
    return typeof value === 'string' && value.length <= 4200 && timingSafeEqual(HASH(value), secretHash);
  }

  async function stopProviders() {
    providerShutdown ||= Promise.resolve().then(() => providers.shutdown());
    await providerShutdown;
  }

  async function failClosed(error) {
    if (!fatal) {
      fatal = error;
      logger.error?.('[chat-ingress] persistence unavailable; provider intake stopped');
    }
    // Do not await shutdown from an event callback: providers may drain that same callback.
    void stopProviders().catch(() => {});
  }

  function compactJournal() {
    if (compactionPromise || stopping || fatal) return compactionPromise;
    compactionPromise = journal.compact().then(() => {
      lastCompactionBytes = journal.status().journalBytes;
    }).catch(failClosed).finally(() => { compactionPromise = null; });
    return compactionPromise;
  }

  function status() {
    const state = journal.status();
    const providerHealth = providers.health?.();
    return {
      ...state,
      healthy: state.healthy && !fatal && !stopping && providerHealth?.healthy !== false,
      ...(providerHealth ? { providerHealth } : {}),
      memoryRssBytes: process.memoryUsage().rss,
      memoryHeapUsedBytes: process.memoryUsage().heapUsed,
      capability: {
        protocolVersion: 1,
        durableJournal: true,
        channelFifo: true,
        activeGenerationOnly: true,
        gracefulHandoff: true,
        crashPolicy: 'uncertain_no_replay',
      },
      pendingHttpRequests: pendingRequests.size,
    };
  }

  function requireHealthy() {
    if (!status().healthy) throw new ChatIngressError('ingress_unavailable', 'Chat ingress is unhealthy', 503);
  }

  function serialSession(identity, action) {
    const key = JSON.stringify([identity.provider, identity.ownerUserId]);
    const previous = sessionTails.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => action(key));
    sessionTails.set(key, next);
    void next.finally(() => { if (sessionTails.get(key) === next) sessionTails.delete(key); }).catch(() => {});
    return next;
  }

  const controlServer = http.createServer(async (request, response) => {
    try {
      if (!authenticated(request)) {
        request.resume();
        return json(response, 401, { error: 'unauthorized' });
      }
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/status') return json(response, 200, status());
      if (request.method === 'GET' && url.pathname === '/events/uncertain') {
        return json(response, 200, { events: journal.listUncertain() });
      }
      if (request.method === 'GET' && url.pathname === '/sessions') {
        const listed = await providers.list();
        const list = Array.isArray(listed) ? listed : listed?.sessions || [];
        return json(response, 200, { sessions: list.map((item) => safeMetadata(sessionIdentity(item), item)) });
      }
      if (request.method !== 'POST') return json(response, 404, { error: 'not_found' });
      requireHealthy();
      const body = await readJson(request, maxRequestBytes);
      let result;
      switch (url.pathname) {
        case '/session/ensure': {
          const identity = sessionIdentity(body);
          result = await serialSession(identity, async (key) => {
            requireHealthy();
            const existing = sessions.get(key);
            if (existing && ((identity.channelId && existing.channelId && existing.channelId !== identity.channelId) || existing.sid !== identity.sid)) {
              throw new ChatIngressError('session_identity_conflict', 'Close the previous owner session before changing its identity');
            }
            const ensuredIdentity = { ...identity, channelId: identity.channelId || existing?.channelId || null };
            sessions.set(key, ensuredIdentity);
            try {
              const metadata = await providers.ensure(identity);
              if (!status().healthy) {
                await providers.close(identity);
                requireHealthy();
              }
              const resolved = safeMetadata(ensuredIdentity, metadata);
              if (resolved.channelId) ensuredIdentity.channelId = text(resolved.channelId, 'channelId');
              return resolved;
            }
            catch (error) { if (!existing) sessions.delete(key); throw error; }
          });
          break;
        }
        case '/session/close': {
          const identity = sessionIdentity(body, false);
          result = await serialSession(identity, async (key) => {
            const existing = sessions.get(key);
            if (existing && ((body.channelId && body.channelId !== existing.channelId) || (body.sid && body.sid !== existing.sid))) {
              throw new ChatIngressError('session_identity_conflict', 'Session identity does not match');
            }
            await providers.close(identity);
            sessions.delete(key);
            return { closed: true };
          });
          break;
        }
        case '/events/claim': result = { events: await journal.claim(body) }; break;
        case '/events/ack': result = await journal.ack(body); break;
        case '/events/fail': result = await journal.fail({ ...body, reason: body.reason || body.error || 'handler_failed' }); break;
        case '/events/resolve': result = await journal.resolveUncertain(body); break;
        case '/runtime/activate': {
          const previous = journal.status().activeRuntimeId;
          result = await journal.activate({ ...body, url: targetUrl(body.url, forbiddenPorts) });
          if (previous !== result.runtimeId) {
            for (const socket of webSockets) {
              socket.end(Buffer.from([0x88, 0x02, 0x03, 0xf4]));
              const timer = setTimeout(() => socket.destroy(), 1000);
              timer.unref();
            }
          }
          flushPending();
          break;
        }
        case '/runtime/drain': result = await journal.drain(body); break;
        case '/runtime/resume': result = await journal.resume(body); flushPending(); break;
        default: return json(response, 404, { error: 'not_found' });
      }
      return json(response, 200, { ok: true, ...result });
    } catch (error) {
      if (!journal.status().healthy) await failClosed(error);
      json(response, error.statusCode || 500, { error: error.code || 'internal_error', message: error.statusCode ? error.message : 'Chat ingress request failed' });
    }
  });
  controlServer.requestTimeout = requestTimeoutMs;
  controlServer.headersTimeout = Math.min(requestTimeoutMs, 10_000);
  controlServer.on('clientError', (_error, socket) => socket.destroy());

  function currentTarget() {
    const state = status();
    if (!state.healthy || !state.activeRuntimeUrl) throw new ChatIngressError('runtime_unavailable', 'No healthy active runtime', 503);
    return new URL(targetUrl(state.activeRuntimeUrl, forbiddenPorts));
  }

  function proxyOptions(request, target) {
    const headers = { ...request.headers };
    // Never manufacture a trusted identity or forward the ingress control secret.
    if (authenticated(request)) delete headers.authorization;
    delete headers['x-arubot-ingress-secret'];
    const remote = request.socket.remoteAddress || '127.0.0.1';
    const trusted = trustProxy(remote);
    if (!trusted) {
      for (const name of ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip']) delete headers[name];
    }
    headers['x-forwarded-for'] = headers['x-forwarded-for'] ? `${headers['x-forwarded-for']}, ${remote}` : remote;
    headers['x-forwarded-proto'] ||= 'http';
    headers['x-forwarded-host'] ||= headers.host;
    return {
      hostname: target.hostname.replace(/^\[|\]$/g, ''),
      port: target.port,
      path: request.url,
      method: request.method,
      headers,
    };
  }

  function forwardRequest(request, response, body) {
    let target;
    try { target = currentTarget(); } catch (error) {
      request.resume();
      return json(response, error.statusCode || 503, { error: error.code || 'runtime_unavailable' });
    }
    const upstream = http.request(proxyOptions(request, target), (incoming) => {
      response.writeHead(incoming.statusCode || 502, incoming.headers);
      incoming.pipe(response);
      incoming.on('error', () => response.destroy());
    });
    proxyRequests.add(upstream);
    upstream.on('close', () => proxyRequests.delete(upstream));
    upstream.on('error', () => {
      if (response.headersSent) response.destroy();
      else json(response, 502, { error: 'runtime_unavailable' });
    });
    request.on('aborted', () => upstream.destroy());
    response.on('close', () => { if (!response.writableFinished) upstream.destroy(); });
    if (body) upstream.end(body);
    else request.pipe(upstream);
  }

  function queueRequest(request, response) {
    if (pendingRequests.size >= maxPendingRequests || Number(request.headers['content-length']) > maxPendingBytes) {
      request.resume();
      response.setHeader('retry-after', '1');
      return json(response, 503, { error: 'runtime_transition_busy' });
    }
    const item = { request, response, chunks: [], bytes: 0, ready: false, timer: null };
    pendingRequests.add(item);
    const remove = () => {
      if (!pendingRequests.delete(item)) return false;
      pendingBytes -= item.bytes;
      clearTimeout(item.timer);
      return true;
    };
    item.remove = remove;
    item.timer = setTimeout(() => {
      if (!remove()) return;
      request.resume();
      response.setHeader('retry-after', '1');
      json(response, 503, { error: 'runtime_transition_timeout' });
    }, drainWaitTimeoutMs);
    item.timer.unref();
    request.on('data', (chunk) => {
      if (!pendingRequests.has(item)) return;
      if (pendingBytes + chunk.length > maxPendingBytes) {
        remove();
        response.setHeader('retry-after', '1');
        json(response, 503, { error: 'runtime_transition_busy' });
        return;
      }
      item.chunks.push(chunk);
      item.bytes += chunk.length;
      pendingBytes += chunk.length;
    });
    request.once('end', () => { item.ready = true; flushPending(); });
    request.once('aborted', remove);
    request.once('error', remove);
    response.once('close', remove);
  }

  function flushPending() {
    const state = status();
    if (!state.healthy || state.draining || !state.activeRuntimeId) return;
    for (const item of pendingRequests) {
      if (!item.ready || !item.remove()) continue;
      forwardRequest(item.request, item.response, Buffer.concat(item.chunks));
    }
  }

  const publicServer = http.createServer((request, response) => {
    if (isControlPath(request.url)) {
      request.resume();
      return json(response, 404, { error: 'not_found' });
    }
    if (status().healthy && journal.status().draining) return queueRequest(request, response);
    return forwardRequest(request, response);
  });
  publicServer.headersTimeout = 15_000;
  publicServer.requestTimeout = 120_000;
  publicServer.on('clientError', (_error, socket) => socket.destroy());
  publicServer.on('upgrade', (request, socket, head) => {
    let target;
    try {
      if (isControlPath(request.url)) throw new Error('Control path');
      if (journal.status().draining) throw new Error('Runtime is draining');
      target = currentTarget();
    } catch {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    const upstream = http.request(proxyOptions(request, target));
    proxyRequests.add(upstream);
    upstream.on('close', () => proxyRequests.delete(upstream));
    upstream.once('upgrade', (incoming, peer, upstreamHead) => {
      if (journal.status().draining || journal.status().activeRuntimeUrl !== target.origin) {
        peer.destroy();
        socket.destroy();
        return;
      }
      webSockets.add(socket);
      socket.once('close', () => webSockets.delete(socket));
      sockets.add(peer);
      peer.once('close', () => sockets.delete(peer));
      let headers = `HTTP/1.1 ${incoming.statusCode} ${incoming.statusMessage}\r\n`;
      for (let i = 0; i < incoming.rawHeaders.length; i += 2) headers += `${incoming.rawHeaders[i]}: ${incoming.rawHeaders[i + 1]}\r\n`;
      socket.write(headers + '\r\n');
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) peer.write(head);
      socket.pipe(peer).pipe(socket);
      peer.on('error', () => socket.destroy());
      socket.on('error', () => peer.destroy());
      peer.on('close', () => socket.destroy());
      socket.on('close', () => peer.destroy());
    });
    upstream.once('response', (incoming) => {
      incoming.resume();
      socket.end(`HTTP/1.1 ${incoming.statusCode} ${incoming.statusMessage}\r\nConnection: close\r\n\r\n`);
    });
    upstream.once('error', () => socket.destroy());
    socket.once('close', () => upstream.destroy());
    upstream.end();
  });

  for (const server of [controlServer, publicServer]) server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  async function probeRuntime() {
    if (probeRunning || stopping || fatal) return;
    const state = journal.status();
    if (!state.activeRuntimeId || !state.activeRuntimeUrl || (state.draining && !state.inflight)) return;
    probeRunning = true;
    try {
      // A failed TCP connection indicates a dead worker; slow/failed readiness alone does not.
      const target = new URL(targetUrl(state.activeRuntimeUrl, forbiddenPorts));
      await new Promise((resolve, reject) => {
        const req = http.get({ hostname: target.hostname.replace(/^\[|\]$/g, ''), port: target.port, path: '/api/readiness', timeout: runtimeProbeTimeoutMs }, (res) => { res.resume(); resolve(); });
        req.once('timeout', () => { req.destroy(); resolve(); });
        req.once('error', reject);
      });
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        try {
          if (journal.status().activeRuntimeId === state.activeRuntimeId) {
            await journal.markRuntimeUncertain({ runtimeId: state.activeRuntimeId, reason: 'runtime_connection_lost' });
          }
        } catch (failure) { if (!journal.status().healthy) await failClosed(failure); }
      }
    } finally { probeRunning = false; }
  }

  return {
    controlServer,
    publicServer,
    status,
    failClosed,
    async acceptEvent(envelope) {
      if (!journal.status().healthy || fatal) throw new ChatIngressError('ingress_unavailable', 'Chat ingress is unhealthy', 503);
      const identity = sessionIdentity(envelope);
      const key = JSON.stringify([identity.provider, identity.ownerUserId]);
      let registered = sessions.get(key);
      if (!registered || registered.sid !== identity.sid || (registered.channelId && registered.channelId !== identity.channelId)) {
        // Inventory can connect a channel before any API worker exists. The adapter is
        // the authorization authority and has already checked the persisted account grant.
        const listed = await providers.list();
        const authoritative = (Array.isArray(listed) ? listed : listed?.sessions || []).find((item) =>
          item.provider === identity.provider && item.ownerUserId === identity.ownerUserId
          && item.sid === identity.sid && item.channelId === identity.channelId);
        if (authoritative) {
          registered = identity;
          sessions.set(key, registered);
        }
      }
      if (!registered || registered.sid !== identity.sid || (registered.channelId && registered.channelId !== identity.channelId)) {
        throw new ChatIngressError('session_identity_conflict', 'Event does not belong to an ensured owner session');
      }
      if (!registered.channelId && identity.channelId) registered.channelId = identity.channelId;
      try {
        const result = await journal.append(envelope);
        if (journal.status().journalBytes - lastCompactionBytes >= compactionThresholdBytes) void compactJournal();
        return result;
      }
      catch (error) {
        // Oversize or malformed provider events are not safe to silently discard either.
        await failClosed(error);
        throw error;
      }
    },
    async start() {
      if (started || stopping) throw new Error('Chat ingress cannot be started twice');
      started = true;
      try {
        const control = await listen(controlServer, controlPort, '127.0.0.1');
        forbiddenPorts.add(control.port);
        const gateway = await listen(publicServer, publicPort, publicHost);
        forbiddenPorts.add(gateway.port);
        if (runtimeProbeIntervalMs > 0) {
          monitorTimer = setInterval(() => { void probeRuntime(); }, runtimeProbeIntervalMs);
          monitorTimer.unref();
        }
        if (compactionIntervalMs > 0) {
          compactTimer = setInterval(() => { void compactJournal(); }, compactionIntervalMs);
          compactTimer.unref();
        }
        return { control, gateway };
      } catch (error) {
        if (controlServer.listening) await new Promise((resolve) => controlServer.close(resolve));
        throw error;
      }
    },
    stop({ closeJournal = true } = {}) {
      if (stopPromise) return stopPromise;
      stopping = true;
      clearInterval(monitorTimer);
      clearInterval(compactTimer);
      stopPromise = (async () => {
        await Promise.allSettled([...sessionTails.values()]);
        let shutdownError;
        try { await stopProviders(); } catch (error) { shutdownError = error; }
        for (const item of pendingRequests) {
          item.remove();
          json(item.response, 503, { error: 'ingress_stopping' });
        }
        for (const req of proxyRequests) req.destroy();
        for (const socket of sockets) socket.destroy();
        await Promise.all([controlServer, publicServer].map((server) => server.listening ? new Promise((resolve) => server.close(resolve)) : Promise.resolve()));
        if (closeJournal) await journal.close();
        if (shutdownError) throw shutdownError;
      })();
      return stopPromise;
    },
    probeRuntime,
  };
}

export async function main(env = process.env, dependencies = {}) {
  const secret = await loadChatIngressSecret(env);
  const directory = env.ARUBOT_CHAT_INGRESS_DATA_DIR;
  if (!directory || !path.isAbsolute(directory)) throw new Error('ARUBOT_CHAT_INGRESS_DATA_DIR must be an absolute persistent path outside release directories');
  const journal = await createChatIngressJournal({
    directory,
    dedupeTtlMs: Number(env.ARUBOT_CHAT_INGRESS_DEDUPE_TTL_MS || 6 * 60 * 60 * 1000),
    maxAckedReceipts: Number(env.ARUBOT_CHAT_INGRESS_MAX_ACKED_RECEIPTS || 100_000),
  });
  let providers;
  let database;
  const service = createChatIngressService({
    journal,
    secret,
    controlPort: Number(env.ARUBOT_CHAT_INGRESS_PORT || 3701),
    publicPort: Number(env.PORT || 3001),
    publicHost: env.ARUBOT_CHAT_INGRESS_HOST || '0.0.0.0',
    compactionThresholdBytes: Number(env.ARUBOT_CHAT_INGRESS_COMPACT_BYTES || 64 * 1024 * 1024),
    trustedProxies: String(env.ARUBOT_TRUSTED_PROXIES || 'loopback').split(',').map((value) => value.trim()).filter(Boolean),
    providers: {
      ensure: (...args) => providers.ensure(...args),
      close: (...args) => providers.close(...args),
      list: (...args) => providers.list(...args),
      health: () => providers?.health?.(),
      shutdown: () => providers?.shutdown(),
    },
  });
  const stopService = service.stop.bind(service);
  let closePromise;
  let signalShutdown;
  service.stop = (options) => {
    closePromise ||= (async () => {
      if (signalShutdown) {
        process.off('SIGTERM', signalShutdown);
        process.off('SIGINT', signalShutdown);
      }
      try { await stopService(options); }
      finally { await database?.closeDatabaseConnections(); }
    })();
    return closePromise;
  };
  try {
    database = dependencies.database || await import('./supabase.js');
    database.validateSecretEncryptionConfig();
    await database.initDb();
    const createIngressProviders = dependencies.createIngressProviders || (await import('./chat-ingress-providers.mjs')).createIngressProviders;
    providers = await createIngressProviders({ db: database, env, onEvent: (event) => service.acceptEvent(event), onFatal: (error) => service.failClosed(error) });
    await service.start();
    await providers.start?.();
    if (!service.status().healthy) throw new Error('Initial chat ingress inventory is unhealthy');
    if (dependencies.sendReady) dependencies.sendReady();
    else process.send?.('ready');
    let exiting = false;
    signalShutdown = () => {
      if (exiting) return;
      exiting = true;
      const watchdog = setTimeout(() => process.exit(1), 20_000);
      watchdog.unref();
      void service.stop().catch(() => {
        console.error('[chat-ingress] shutdown did not complete cleanly');
        process.exitCode = 1;
      }).finally(() => clearTimeout(watchdog));
    };
    if (dependencies.installSignalHandlers !== false) {
      process.once('SIGTERM', signalShutdown);
      process.once('SIGINT', signalShutdown);
    }
    return service;
  } catch (error) {
    await service.stop().catch(() => {});
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await import('dotenv/config');
  main().catch(async (error) => {
    console.error('[chat-ingress] startup failed:', error.message);
    await delay(10);
    process.exitCode = 1;
  });
}
