'use client';

import { useEffect } from 'react';

export function useVisibilityPolling(callback: () => void | Promise<void>, intervalMs: number, enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let disposed = false;
    let timer: number | null = null;

    const clearTimer = () => {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

    const run = () => {
      if (!disposed && isVisible()) void callback();
    };

    const start = () => {
      clearTimer();
      if (!isVisible()) return;
      timer = window.setInterval(run, intervalMs);
    };

    const handleVisibilityChange = () => {
      if (isVisible()) {
        run();
        start();
      } else {
        clearTimer();
      }
    };

    run();
    start();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);
    window.addEventListener('online', handleVisibilityChange);

    return () => {
      disposed = true;
      clearTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
      window.removeEventListener('online', handleVisibilityChange);
    };
  }, [callback, enabled, intervalMs]);
}
