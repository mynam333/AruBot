export function startSongbookOverlayCleanup({ store, logger = console }) {
  let stopped = false;
  let pending;
  let timer;
  function schedule(delay) {
    timer = setTimeout(() => {
      pending = run();
    }, delay);
    timer.unref?.();
  }
  async function run() {
    try { await store.cleanupCompletedRequests(); }
    catch (error) { logger.error('[songbook] Completed request cleanup failed:', error); }
    finally { if (!stopped) schedule(30_000); }
  }
  // Give existing OBS windows time to reconnect after a backend deployment.
  schedule(120_000);
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await pending;
  };
}
