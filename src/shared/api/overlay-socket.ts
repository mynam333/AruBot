type OverlaySocketOptions = {
  url: string | (() => string);
  onConnecting?: () => void;
  onOpen?: (socket: WebSocket) => void;
  onMessage: (event: MessageEvent, socket: WebSocket) => void | Promise<void>;
  onError?: (error: unknown) => void;
  onClose?: (event: CloseEvent) => void;
  onRetry?: (attempt: number, delayMs: number) => void;
  shouldReconnect?: (event: CloseEvent) => boolean;
};

const HEARTBEAT_MS = 10000;
const RESPONSE_TIMEOUT_MS = 25000;
const CONNECT_TIMEOUT_MS = 10000;

export function connectOverlaySocket(options: OverlaySocketOptions) {
  let disposed = false;
  let socket: WebSocket | null = null;
  let attempts = 0;
  let lastResponseAt = Date.now();
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;

  const closeSocket = () => {
    if (connectTimer !== null) clearTimeout(connectTimer);
    connectTimer = null;
    const previous = socket;
    socket = null;
    if (!previous) return;
    previous.onopen = previous.onmessage = previous.onclose = previous.onerror = null;
    try { previous.close(); } catch {}
  };
  const retry = () => {
    if (disposed) return;
    closeSocket();
    if (retryTimer !== null) return;
    // Limit the interval, never the number of attempts.
    const delay = Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5));
    retryTimer = setTimeout(connect, delay);
    options.onRetry?.(attempts, delay);
  };
  const connect = () => {
    if (disposed) return;
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    closeSocket();
    lastResponseAt = Date.now();
    try {
      options.onConnecting?.();
      const current = new WebSocket(typeof options.url === 'function' ? options.url() : options.url);
      socket = current;
      connectTimer = setTimeout(retry, CONNECT_TIMEOUT_MS);
      current.onopen = () => {
        if (disposed || socket !== current) return;
        if (connectTimer !== null) clearTimeout(connectTimer);
        connectTimer = null;
        lastResponseAt = Date.now();
        options.onOpen?.(current);
      };
      current.onmessage = (event) => {
        if (disposed || socket !== current) return;
        lastResponseAt = Date.now();
        attempts = 0;
        if (connectTimer !== null) clearTimeout(connectTimer);
        connectTimer = null;
        try { void Promise.resolve(options.onMessage(event, current)).catch(() => undefined); } catch {}
      };
      current.onerror = (error) => {
        if (disposed || socket !== current) return;
        retry();
        options.onError?.(error);
      };
      current.onclose = (event) => {
        if (disposed || socket !== current) return;
        if (options.shouldReconnect?.(event) === false) dispose();
        else retry();
        options.onClose?.(event);
      };
    } catch (error) {
      retry();
      options.onError?.(error);
    }
  };
  const ping = () => {
    if (!socket) return;
    if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) { retry(); return; }
    if (socket.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastResponseAt >= RESPONSE_TIMEOUT_MS) { retry(); return; }
    try { socket.send(JSON.stringify({ type: 'ping' })); } catch { retry(); }
  };
  const wake = () => {
    if (disposed) return;
    if (socket?.readyState === WebSocket.OPEN && Date.now() - lastResponseAt < RESPONSE_TIMEOUT_MS) ping();
    else connect();
  };
  const onVisibility = () => { if (!document.hidden) wake(); };
  const heartbeat = setInterval(ping, HEARTBEAT_MS);
  const dispose = () => {
    disposed = true;
    clearInterval(heartbeat);
    if (retryTimer !== null) clearTimeout(retryTimer);
    closeSocket();
    window.removeEventListener('online', wake);
    window.removeEventListener('pageshow', wake);
    document.removeEventListener('visibilitychange', onVisibility);
  };
  window.addEventListener('online', wake);
  window.addEventListener('pageshow', wake);
  document.addEventListener('visibilitychange', onVisibility);
  connect();
  return dispose;
}
