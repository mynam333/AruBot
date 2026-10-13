import type { SongbookOverlaySnapshot } from '../../../shared/songbook-overlay';

export function connectSongbookOverlay({ url, onData, onConnection, fetcher = fetch }: {
  url: string; onData: (data: SongbookOverlaySnapshot | null) => void;
  onConnection?: (connected: boolean) => void; fetcher?: typeof fetch;
}) {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let failures = 0;
  async function poll() {
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 8000);
    let delay = 2000;
    try {
      const response = await fetcher(url, { credentials: 'omit', cache: 'no-store', signal: controller.signal });
      if (!response.ok) {
        if (!disposed && [400, 401, 403, 404].includes(response.status)) onData(null);
        throw new Error('songbook_overlay_unavailable');
      }
      const data = await response.json() as SongbookOverlaySnapshot;
      if (!data?.config?.layouts || !Array.isArray(data.queue) || !Number.isFinite(data.queueCount)) throw new Error('invalid_snapshot');
      if (!disposed) { onData(data); onConnection?.(true); }
      failures = 0;
    } catch {
      if (!disposed) onConnection?.(false);
      delay = Math.min(30000, 2000 * 2 ** Math.min(++failures, 4));
    } finally {
      clearTimeout(timeout);
      if (!disposed) timer = setTimeout(poll, delay);
    }
  }
  void poll();
  return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
}
