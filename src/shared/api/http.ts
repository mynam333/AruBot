export function getServerApiBase() {
  const serverOnlyBase = typeof window === 'undefined' ? process.env.API_BASE : '';
  return (serverOnlyBase || process.env.NEXT_PUBLIC_API_BASE || '').replace(/\/$/, '');
}

export function getBrowserApiBase() {
  const configured = (process.env.NEXT_PUBLIC_API_BASE || '').replace(/\/$/, '');
  if (configured) return configured;
  if (typeof window !== 'undefined') {
    const { hostname, protocol, port } = window.location;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    if (isLocal && port !== '3001') return `${protocol}//127.0.0.1:3001`;
  }
  return '';
}

export function apiUrl(path: string, base = getBrowserApiBase()) {
  if (path.startsWith('http')) return path;
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

export function apiWsUrl(path: string, base = getBrowserApiBase()) {
  const url = apiUrl(path, base);
  if (url.startsWith('https://')) return `wss://${url.slice('https://'.length)}`;
  if (url.startsWith('http://')) return `ws://${url.slice('http://'.length)}`;
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${path.startsWith('/') ? '' : '/'}${path}`;
  }
  return url;
}

const pendingJsonReads = new Map<string, Promise<unknown>>();

function canDedupeJsonRead(init?: RequestInit) {
  const method = String(init?.method || 'GET').toUpperCase();
  return method === 'GET' && !init?.body && !init?.signal;
}

function jsonReadKey(path: string, init?: RequestInit) {
  return JSON.stringify({
    path: apiUrl(path),
    credentials: init?.credentials ?? 'include',
    cache: init?.cache ?? 'no-store',
    headers: init?.headers || null,
  });
}

export async function readJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  const dedupe = canDedupeJsonRead(init);
  const key = dedupe ? jsonReadKey(path, init) : '';
  if (dedupe && pendingJsonReads.has(key)) {
    return pendingJsonReads.get(key) as Promise<T | null>;
  }

  const request = (async () => {
    try {
      const response = await fetch(apiUrl(path), {
        ...init,
        credentials: init?.credentials ?? 'include',
        cache: init?.cache ?? 'no-store',
      });
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      return null;
    } finally {
      if (dedupe) pendingJsonReads.delete(key);
    }
  })();

  if (dedupe) pendingJsonReads.set(key, request);
  return request;
}
