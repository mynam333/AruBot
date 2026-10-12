const validCursor = value => typeof value === 'string' && /^\d{1,19}$/.test(value) && BigInt(value) <= 9223372036854775807n;

// A shared cursor protects against overlapping SSE, HTTP fallback and reconnects.
export function createEmoteInbox(onSnapshot) {
  let epoch = -1, revision = -1, cursor;
  return {
    get cursor() { return cursor; },
    accept(snapshot) {
      if (!snapshot || !validCursor(snapshot.cursor) || !Number.isSafeInteger(snapshot.epoch)
        || !Number.isSafeInteger(snapshot.revision) || !Array.isArray(snapshot.events)
        || !snapshot.settings || !Number.isFinite(snapshot.serverNow)) return false;
      if (snapshot.epoch < epoch || (snapshot.epoch === epoch && snapshot.revision < revision)) return false;
      const initial = cursor === undefined;
      const cleared = snapshot.epoch !== epoch;
      if (cleared) cursor = '0';
      const previous = BigInt(cursor || '0');
      const events = initial || !snapshot.settings.enabled ? [] : snapshot.events.slice(0, 120).filter(event =>
        validCursor(event.id) && BigInt(event.id) > previous && BigInt(event.id) <= BigInt(snapshot.cursor)
        && Number.isFinite(event.createdAt) && snapshot.serverNow - event.createdAt <= 8000
        && snapshot.serverNow - event.createdAt >= -2000 && Array.isArray(event.items)
      ).sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1).filter((event, i, all) => !i || event.id !== all[i - 1].id);
      epoch = snapshot.epoch; revision = snapshot.revision;
      cursor = BigInt(snapshot.cursor) > previous ? snapshot.cursor : String(previous);
      onSnapshot({ ...snapshot, events, cleared });
      return true;
    },
  };
}

export function connectEmoteOverlay({ streamUrl, stateUrl, onSnapshot, onClear, onConnectionChange = () => {} }, env = globalThis) {
  const inbox = createEmoteInbox(onSnapshot);
  let stopped = false, stream = null, retry = null, request = null, healthy = false;
  let attempts = 0, lastMessage = Date.now(), received = 0;
  const url = base => `${base}${base.includes('?') ? '&' : '?'}${inbox.cursor === undefined ? '' : `after=${inbox.cursor}`}`;
  const closeStream = () => { const previous = stream; stream = null; previous?.close(); };
  const reconnect = () => {
    if (stopped) return;
    closeStream(); healthy = false; onConnectionChange(false);
    if (retry !== null) return;
    retry = env.setTimeout(connect, Math.min(15000, 1000 * 2 ** Math.min(attempts++, 4)) + Math.random() * 300);
    void poll();
  };
  const accept = snapshot => {
    if (inbox.accept(snapshot)) { received++; lastMessage = Date.now(); return true; }
    return false;
  };
  const poll = async () => {
    if (stopped || healthy || request) return;
    const controller = new AbortController(); request = controller;
    const sequence = received;
    const timeout = env.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await env.fetch(url(stateUrl), { cache: 'no-store', credentials: 'omit', signal: controller.signal });
      if (stopped || controller.signal.aborted || sequence !== received) return;
      if (response.status === 401 || response.status === 404) { onClear(); return; }
      if (!response.ok) return;
      const snapshot = await response.json();
      if (!stopped && !controller.signal.aborted && sequence === received && accept(snapshot)) onConnectionChange(true);
    } catch { /* Reconciliation continues indefinitely while the API restarts. */ }
    finally { env.clearTimeout(timeout); if (request === controller) request = null; }
  };
  const connect = () => {
    if (stopped) return;
    if (retry !== null) env.clearTimeout(retry);
    retry = null; closeStream(); healthy = false; lastMessage = Date.now();
    try {
      const current = new env.EventSource(url(streamUrl)); stream = current;
      current.addEventListener('state', event => {
        if (stopped || current !== stream) return;
        try {
          if (accept(JSON.parse(event.data))) { healthy = true; onConnectionChange(true); }
        } catch { reconnect(); }
      });
      current.addEventListener('heartbeat', () => {
        if (stopped || current !== stream) return;
        lastMessage = Date.now(); attempts = 0;
      });
      current.addEventListener('unavailable', event => {
        if (stopped || current !== stream) return;
        try { if ([401, 404].includes(JSON.parse(event.data).status)) onClear(); } catch {}
        reconnect();
      });
      current.onerror = () => { if (current === stream) reconnect(); };
    } catch { reconnect(); }
  };
  const tick = env.setInterval(() => {
    if (stream && Date.now() - lastMessage > (healthy ? 35000 : 10000)) reconnect();
    if (!healthy) void poll();
  }, 2000);
  const wake = () => { attempts = 0; connect(); void poll(); };
  const visible = () => { if (!env.document?.hidden) wake(); };
  env.addEventListener?.('online', wake);
  env.addEventListener?.('pageshow', wake);
  env.document?.addEventListener('visibilitychange', visible);
  connect();
  return () => {
    stopped = true; closeStream(); request?.abort(); env.clearInterval(tick);
    if (retry !== null) env.clearTimeout(retry);
    env.removeEventListener?.('online', wake); env.removeEventListener?.('pageshow', wake);
    env.document?.removeEventListener('visibilitychange', visible);
  };
}
