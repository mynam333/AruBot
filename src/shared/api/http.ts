export function getServerApiBase() {
  return (process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || '').replace(/\/$/, '');
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

export async function readJson<T>(path: string, init?: RequestInit): Promise<T | null> {
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
  }
}
