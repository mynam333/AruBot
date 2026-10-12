'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readJsonResult } from '@/shared/api/http';
import type { SongbookRequest } from './types';

export function useSongbookRequests(endpoint: string) {
  const [items, setItems] = useState<SongbookRequest[]>([]);
  const [auth, setAuth] = useState<'loading' | 'ready' | 'login' | 'error'>('loading');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const previousEndpoint = useRef(endpoint);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (previousEndpoint.current !== endpoint) {
      previousEndpoint.current = endpoint;
      setItems([]); setAuth('loading'); setError('');
    }
    const controller = new AbortController();
    let inFlight = false;
    const load = async () => {
      if (inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const result = await readJsonResult<{ items: SongbookRequest[] }>(endpoint, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result.ok) { setItems(result.data.items); setAuth('ready'); setError(''); }
        else { setAuth(result.status === 401 ? 'login' : 'error'); setError(result.message); if (result.status === 401 || result.status === 403) setItems([]); }
      } catch { if (!controller.signal.aborted) { setAuth('error'); setError('신청 내역에 연결하지 못했습니다.'); } }
      finally { inFlight = false; }
    };
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    document.addEventListener('visibilitychange', load);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [endpoint, revision]);
  return { items, auth, error, refresh };
}
