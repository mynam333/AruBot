const HEARTBEAT_MS = 10000;
const RESPONSE_TIMEOUT_MS = 25000;
const CONNECT_TIMEOUT_MS = 10000;

export function connectDrawingOverlay<T>({ url, onItem, onUpdateRequired, onConnectionChange }: {
  url: string;
  onItem: (item: T | null) => void;
  onUpdateRequired: (required: boolean) => void;
  onConnectionChange: (connected: boolean) => void;
}) {
  let disposed = false;
  let socket: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let lastResponseAt = Date.now();

  const closeSocket = () => {
    if (connectTimer !== null) clearTimeout(connectTimer);
    connectTimer = null;
    const previous = socket;
    socket = null;
    if (!previous) return;
    previous.onopen = previous.onmessage = previous.onclose = previous.onerror = null;
    try { previous.close(); } catch {}
  };
  const reconnect = () => {
    if (disposed) return;
    closeSocket();
    onConnectionChange(false);
    if (retryTimer !== null) return;
    retryTimer = setTimeout(connect, Math.min(10000, 1800 * 2 ** Math.min(attempts++, 3)));
  };
  const connect = () => {
    if (disposed) return;
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    closeSocket();
    onConnectionChange(false);
    lastResponseAt = Date.now();
    try {
      const current = new WebSocket(url);
      socket = current;
      // Wait for the authenticated snapshot, not just the WebSocket handshake.
      connectTimer = setTimeout(reconnect, CONNECT_TIMEOUT_MS);
      current.onmessage = (event) => {
        if (disposed || socket !== current) return;
        try {
          const payload = JSON.parse(String(event.data || '{}')) as { type?: string; item?: T | null };
          if (!['drawing-donation.current', 'drawing-donation.update-required', 'pong'].includes(payload.type || '')) return;
          lastResponseAt = Date.now();
          if (payload.type === 'pong') return;
          if (connectTimer !== null) clearTimeout(connectTimer);
          connectTimer = null;
          attempts = 0;
          onConnectionChange(true);
          onUpdateRequired(payload.type === 'drawing-donation.update-required');
          if (payload.type === 'drawing-donation.current') onItem(payload.item || null);
        } catch {
          // Ignore malformed overlay payloads.
        }
      };
      current.onclose = current.onerror = () => {
        if (socket === current) reconnect();
      };
    } catch {
      reconnect();
    }
  };
  const heartbeat = setInterval(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastResponseAt >= RESPONSE_TIMEOUT_MS) { reconnect(); return; }
    try { socket.send(JSON.stringify({ type: 'ping' })); } catch { reconnect(); }
  }, HEARTBEAT_MS);
  const wake = () => { attempts = 0; connect(); };
  const onVisibility = () => { if (!document.hidden) wake(); };
  window.addEventListener('online', wake);
  window.addEventListener('pageshow', wake);
  document.addEventListener('visibilitychange', onVisibility);
  connect();
  return () => {
    disposed = true;
    clearInterval(heartbeat);
    if (retryTimer !== null) clearTimeout(retryTimer);
    closeSocket();
    window.removeEventListener('online', wake);
    window.removeEventListener('pageshow', wake);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

export function scheduleDrawingOverlayReload(delayMs: number) {
  let disposed = false;
  let controller: AbortController | null = null;
  const storageKey = 'arubot:drawing-overlay:last-reload';
  let previousReload = 0;
  try { previousReload = Number(window.sessionStorage.getItem(storageKey)) || 0; } catch {}
  const reload = async () => {
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 8000);
    try {
      // Keep the working overlay document if the frontend is also restarting.
      const response = await fetch(window.location.href, { method: 'HEAD', cache: 'no-store', signal: controller.signal });
      if (!disposed && response.ok) {
        try { window.sessionStorage.setItem(storageKey, String(Date.now())); } catch {}
        window.location.reload();
      }
    } catch {}
    finally {
      clearTimeout(timeout);
      if (!disposed) timer = setTimeout(() => { void reload(); }, 60000);
    }
  };
  let timer = setTimeout(() => { void reload(); }, Math.max(delayMs, 60000 - Math.max(0, Date.now() - previousReload)));
  return () => {
    disposed = true;
    clearTimeout(timer);
    controller?.abort();
  };
}
