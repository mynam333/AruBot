import { EventEmitter } from 'node:events';
import { timingSafeEqual } from 'node:crypto';

export function createChatIngressClient({
  url = process.env.ARUBOT_CHAT_INGRESS_URL || '',
  secret = process.env.ARUBOT_CHAT_INGRESS_SECRET || '',
  runtimeId = process.env.ARUBOT_RUNTIME_ID || '',
  fetchImpl = fetch, pollMs = 250, logger = console,
} = {}) {
  const enabled = Boolean(url);
  if (enabled) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname)
      || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('chat_ingress_requires_loopback_url');
    if (secret.length < 32 || !/^[A-Za-z0-9_.:-]{1,160}$/.test(runtimeId)) throw new Error('chat_ingress_credentials_missing');
  }
  let active = !enabled;
  let draining = false;
  let stopped = false;
  let timer;
  let running = false;
  let claiming = false;
  let lastStatus = null;
  let lastWarningAt = 0;
  const inflight = new Set();
  // A lost ACK must never execute its already-completed handler again.
  const completions = new Map();
  const base = url.replace(/\/$/, '');

  async function request(route, body, timeoutMs = 10000) {
    const response = await fetchImpl(`${base}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || `ingress_http_${response.status}`), { status: response.status });
    return data;
  }
  function authorize(header) {
    const expected = Buffer.from(`Bearer ${secret}`);
    const actual = Buffer.from(String(header || ''));
    return enabled && actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  async function finish(id, outcome) {
    await request(outcome.error ? '/events/fail' : '/events/ack', { runtimeId, id, ...(outcome.error ? { error: outcome.error } : {}) });
    completions.delete(id);
  }
  async function refresh() {
    lastStatus = await request('/status');
    if (lastStatus.protocolVersion !== 1) throw new Error('chat_ingress_protocol_mismatch');
    active = lastStatus.activeRuntimeId === runtimeId;
    return lastStatus;
  }
  async function tick(handler) {
    if (running || stopped) return;
    running = true;
    try {
      await refresh();
      for (const [id, outcome] of completions) await finish(id, outcome);
      if (!active || draining || lastStatus.draining || lastStatus.healthy === false || inflight.size >= 16) return;
      claiming = true;
      const result = await request('/events/claim', { runtimeId, limit: 16 - inflight.size });
      for (const event of result.events || []) {
        if (inflight.has(event.id)) continue;
        inflight.add(event.id);
        void (async () => {
          let outcome = {};
          try { await handler(event); }
          catch (error) {
            outcome = { error: String(error?.message || error).slice(0, 500) };
            logger.error('[chat-ingress] Event needs operator review', event.id, outcome.error);
          }
          completions.set(event.id, outcome);
          try { await finish(event.id, outcome); } catch { /* Retry only the acknowledgement. */ }
          finally {
            inflight.delete(event.id);
            if (timer && !draining && !stopped) setImmediate(() => { void tick(handler); });
          }
        })();
      }
    } catch (error) {
      // Fail closed for new work; existing handlers retain their right to finish.
      active = false;
      if (Date.now() - lastWarningAt > 10000) {
        lastWarningAt = Date.now();
        logger.warn('[chat-ingress] Reconnecting:', error?.message || error);
      }
    } finally { claiming = false; running = false; }
  }
  return {
    enabled, runtimeId, request, authorize, refresh,
    get active() { return active; },
    get draining() { return draining; },
    get status() { return lastStatus; },
    get pending() { return inflight.size + completions.size + Number(claiming); },
    canRun() { return !enabled || (active && !draining && !stopped && !lastStatus?.draining && lastStatus?.healthy !== false); },
    ensure(input) { return request('/session/ensure', input, 30000); },
    close(input) { return request('/session/close', input); },
    drain() { draining = true; },
    resume() { draining = false; },
    start(handler) {
      if (!enabled || timer) return;
      stopped = false;
      void tick(handler);
      timer = setInterval(() => { void tick(handler); }, pollMs);
      timer.unref?.();
    },
    async stop(timeoutMs = 12000) {
      draining = true;
      const deadline = Date.now() + timeoutMs;
      while ((inflight.size || completions.size) && Date.now() < deadline) {
        for (const [id, outcome] of completions) await finish(id, outcome).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (inflight.size || completions.size) throw new Error('chat_ingress_drain_timeout');
      stopped = true;
      clearInterval(timer);
      timer = null;
    },
    tick,
  };
}

export function createIngressSocket(metadata) {
  const socket = new EventEmitter();
  socket.connected = metadata.connected === true;
  socket.readyState = socket.connected ? 1 : 0;
  socket.send = () => {};
  // API replacement detaches the facade, never the platform receiver.
  socket.disconnect = socket.close = socket.terminate = () => { socket.connected = false; socket.readyState = 3; };
  socket.dispatch = async (name, payload) => {
    for (const listener of socket.listeners(name)) await listener(payload);
  };
  return socket;
}
