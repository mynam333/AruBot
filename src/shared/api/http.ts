import { getBotManagementOwner } from '@/shared/lib/bot-management-context';

function scopedManagementUrl(url: string, websocket = false) {
  if (typeof window === 'undefined') return url;
  if (!/^\/(?:dashboard|streamer|connection|commands|macros|points|predictions|roulette|wheels|marble|video-donations|drawing-donations|donations|automations|actions|logs|settings|variables|diagnostics|bot-managers|songbook|emote-overlay)(?:\/|$)/.test(window.location.pathname)) return url;
  const owner = getBotManagementOwner();
  if (!owner) return url;
  const parsed = new URL(url, window.location.origin);
  if (websocket && !/^\/api\/(?:video-donation|drawing-donation)\/admin\/ws$/.test(parsed.pathname)) return url;
  if (!parsed.pathname.startsWith('/api/')
    || /^\/api\/(?:auth|arubot-admin|public|viewer)(?:\/|$)/.test(parsed.pathname)
    || /^\/api\/youtube\/bot(?:\/|$)/.test(parsed.pathname)
    || ['/api/health', '/api/readiness', '/api/version'].includes(parsed.pathname)) return url;
  if (!parsed.searchParams.has('botOwner')) parsed.searchParams.set('botOwner', owner);
  return /^https?:\/\//.test(url) ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

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
  return scopedManagementUrl(`${base}${path.startsWith('/') ? '' : '/'}${path}`);
}

export function apiWsUrl(path: string, base = getBrowserApiBase()) {
  const url = scopedManagementUrl(path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`, true);
  if (url.startsWith('https://')) return `wss://${url.slice('https://'.length)}`;
  if (url.startsWith('http://')) return `ws://${url.slice('http://'.length)}`;
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${url.startsWith('/') ? '' : '/'}${url}`;
  }
  return url;
}

const pendingJsonReads = new Map<string, Promise<unknown>>();
const pendingJsonResultReads = new Map<string, Promise<JsonResult<unknown>>>();

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

function readDeadline(init?: RequestInit) {
  // Bound only reads: aborting a mutation cannot undo its server-side effects.
  if (!['GET', 'HEAD'].includes(String(init?.method || 'GET').toUpperCase())) {
    return { signal: init?.signal, timedOut: () => false, dispose: () => {} };
  }
  const controller = new AbortController();
  const cancel = () => controller.abort(init?.signal?.reason);
  init?.signal?.addEventListener('abort', cancel, { once: true });
  if (init?.signal?.aborted) cancel();
  let expired = false;
  const timer = setTimeout(() => { expired = true; controller.abort(); }, 15_000);
  return {
    signal: controller.signal,
    timedOut: () => expired,
    dispose: () => { clearTimeout(timer); init?.signal?.removeEventListener('abort', cancel); },
  };
}

export async function readJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  const dedupe = canDedupeJsonRead(init);
  const key = dedupe ? jsonReadKey(path, init) : '';
  if (dedupe && pendingJsonReads.has(key)) {
    return pendingJsonReads.get(key) as Promise<T | null>;
  }

  const request = (async () => {
    const deadline = readDeadline(init);
    try {
      const response = await fetch(apiUrl(path), {
        ...init,
        credentials: init?.credentials ?? 'include',
        cache: init?.cache ?? 'no-store',
        signal: deadline.signal,
      });
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      return null;
    } finally {
      deadline.dispose();
      if (dedupe) pendingJsonReads.delete(key);
    }
  })();

  if (dedupe) pendingJsonReads.set(key, request);
  return request;
}

export type JsonResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; data: null; status: number | null; message: string; code?: string };

export async function readJsonResult<T>(path: string, init?: RequestInit): Promise<JsonResult<T>> {
  const dedupe = canDedupeJsonRead(init);
  const key = dedupe ? jsonReadKey(path, init) : '';
  if (dedupe && pendingJsonResultReads.has(key)) {
    return pendingJsonResultReads.get(key) as Promise<JsonResult<T>>;
  }

  const request = (async (): Promise<JsonResult<T>> => {
    const deadline = readDeadline(init);
    try {
      const response = await fetch(apiUrl(path), {
        ...init,
        credentials: init?.credentials ?? 'include',
        cache: init?.cache ?? 'no-store',
        signal: deadline.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string; message?: string; code?: string } | null;
        return {
          ok: false,
          data: null,
          status: response.status,
          message: body?.message || body?.error || `요청 실패 (${response.status})`,
          ...(typeof body?.code === 'string' ? { code: body.code } : {}),
        };
      }
      return { ok: true, data: await response.json() as T, status: response.status };
    } catch (error) {
      if (init?.signal?.aborted) throw error;
      if (deadline.timedOut()) return { ok: false, data: null, status: 408, code: 'request_timeout', message: '서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.' };
      const interrupted = error && typeof error === 'object' && 'name' in error
        && ['AbortError', 'TimeoutError', 'NetworkError'].includes(String(error.name));
      return {
        ok: false,
        data: null,
        status: null,
        message: interrupted || error instanceof TypeError
          ? '서버 연결이 잠시 끊겼습니다. 잠시 후 다시 시도해 주세요.'
          : error instanceof Error ? error.message : '서버에 연결할 수 없습니다.',
      };
    } finally {
      deadline.dispose();
      if (dedupe) pendingJsonResultReads.delete(key);
    }
  })();

  if (dedupe) pendingJsonResultReads.set(key, request as Promise<JsonResult<unknown>>);
  return request;
}
