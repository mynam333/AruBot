'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl } from '@/shared/api/http';
import type { MarbleSnapshot } from '../../../shared/marble';

function isSnapshot(value: unknown): value is MarbleSnapshot {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<MarbleSnapshot>;
  const state = data.state;
  return Number.isFinite(data.serverNow) && !!state && state.version === 1
    && (data.overlayRevision === undefined || (!!data.overlayRevision
      && Number.isSafeInteger(data.overlayRevision.connection) && data.overlayRevision.connection >= 0
      && Number.isSafeInteger(data.overlayRevision.source) && data.overlayRevision.source >= 0))
    && Number.isSafeInteger(state.revision) && state.revision >= 0
    && ['lobby', 'running', 'paused', 'finished'].includes(state.status)
    && Array.isArray(state.players) && !!state.settings
    && Array.isArray(state.settings.tiles) && state.settings.tiles.length >= 12
    && state.settings.tiles.length <= 40 && state.settings.tiles.length % 4 === 0
    && state.settings.tiles.every(tile => typeof tile.title === 'string' && Array.isArray(tile.effects))
    && !!state.settings.layouts?.landscape && !!state.settings.layouts?.portrait;
}

function isOlder(data: MarbleSnapshot, previous: MarbleSnapshot): boolean {
  if (previous.overlayRevision && !data.overlayRevision) return true;
  if (data.overlayRevision && !previous.overlayRevision) return false;
  if (data.overlayRevision && previous.overlayRevision) {
    for (const key of ['connection', 'source'] as const) {
      if (data.overlayRevision[key] !== previous.overlayRevision[key]) return data.overlayRevision[key] < previous.overlayRevision[key];
    }
  }
  return data.state.revision < previous.state.revision
    || (data.state.revision === previous.state.revision && data.serverNow < previous.serverNow);
}

export function useMarbleSnapshot(path: string): {
  snapshot: MarbleSnapshot | null;
  error: string | null;
  refresh: () => Promise<void>;
  accept: (data: MarbleSnapshot) => void;
} {
  const [view, setView] = useState<{ path: string; snapshot: MarbleSnapshot | null; error: string | null }>({ path, snapshot: null, error: null });
  const scope = useRef<{ path: string; data: MarbleSnapshot | null; active: boolean; denied: boolean }>({ path, data: null, active: false, denied: false });
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const accept = useCallback((data: MarbleSnapshot) => {
    const current = scope.current;
    if (!current.active || current.denied || current.path !== path || !isSnapshot(data)) return;
    const previous = current.data;
    if (previous && isOlder(data, previous)) return;
    current.data = data;
    setView({ path, snapshot: data, error: null });
  }, [path]);
  const refresh = useCallback(async () => { await refreshRef.current(); }, []);

  useEffect(() => {
    const current = { path, data: null as MarbleSnapshot | null, active: true, denied: false };
    scope.current = current;
    setView({ path, snapshot: null, error: null });
    let retry: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let pending: Promise<void> | null = null;
    let failures = 0;
    const run = (): Promise<void> => {
      if (!current.active) return Promise.resolve();
      if (pending) return pending;
      clearTimeout(retry);
      const request = new AbortController();
      controller = request;
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; request.abort(); }, 8000);
      pending = (async () => {
        try {
          const response = await fetch(apiUrl(path), { signal: request.signal, cache: 'no-store', credentials: 'include', headers: { Accept: 'application/json' } });
          const data: unknown = await response.json().catch(() => null);
          if (!current.active || request.signal.aborted) return;
          if (!response.ok) {
            if ([401, 403, 404].includes(response.status)) {
              current.denied = true;
              current.data = null;
            }
            const body = data as { message?: unknown; error?: unknown } | null;
            const message = typeof body?.message === 'string' ? body.message : typeof body?.error === 'string' ? body.error : `연결 요청 실패 (${response.status})`;
            throw new Error(message);
          }
          if (!isSnapshot(data)) throw new Error('게임 상태를 읽을 수 없습니다. 자동으로 다시 연결합니다.');
          if (!current.active || request.signal.aborted) return;
          const previous = current.data;
          if (previous && isOlder(data, previous)) {
            throw new Error('이전 게임 상태가 도착했습니다. 최신 상태를 다시 확인합니다.');
          }
          current.denied = false;
          accept(data);
          failures = 0;
        } catch (error) {
          if (!current.active) return;
          failures += 1;
          setView({ path, snapshot: current.data, error: timedOut ? '서버 응답 시간이 초과되었습니다. 자동으로 다시 연결합니다.' : error instanceof Error ? error.message : '연결이 끊겼습니다. 자동으로 다시 연결합니다.' });
        } finally {
          clearTimeout(timeout);
          pending = null;
          if (current.active) retry = setTimeout(() => { void run(); }, Math.min(10000, 1000 * 2 ** Math.min(failures, 4)));
        }
      })();
      return pending;
    };
    refreshRef.current = run;
    const reconnect = () => { if (document.visibilityState !== 'hidden') void run(); };
    window.addEventListener('online', reconnect);
    document.addEventListener('visibilitychange', reconnect);
    void run();
    return () => {
      current.active = false;
      clearTimeout(retry);
      controller?.abort();
      window.removeEventListener('online', reconnect);
      document.removeEventListener('visibilitychange', reconnect);
      if (refreshRef.current === run) refreshRef.current = async () => {};
    };
  }, [path, accept]);

  return { snapshot: view.path === path ? view.snapshot : null, error: view.path === path ? view.error : null, refresh, accept };
}
