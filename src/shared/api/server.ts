export function getInternalApiBase() {
  return (
    process.env.ARUBOT_API_INTERNAL_BASE ||
    process.env.SERVER_API_BASE ||
    process.env.API_BASE ||
    process.env.NEXT_PUBLIC_API_BASE ||
    'http://127.0.0.1:3001'
  ).replace(/\/$/, '');
}

export function serverApiUrl(path: string, base = getInternalApiBase()) {
  if (path.startsWith('http')) return path;
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

const SERVER_API_READ_TIMEOUT_MS = 6_000;

export async function readServerJson<T>(
  path: string,
  init?: RequestInit & { next?: { revalidate?: number } },
): Promise<T | null> {
  try {
    const cache = init?.cache ?? (init?.next ? undefined : 'no-store');
    const response = await fetch(serverApiUrl(path), {
      ...init,
      cache,
      signal: init?.signal ?? AbortSignal.timeout(SERVER_API_READ_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
