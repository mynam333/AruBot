type ProbePlayer = {
  cueVideoById?: (videoId: string) => void;
  destroy?: () => void;
  getDuration?: () => number;
};

type ProbeYouTubeApi = {
  Player: new (element: HTMLElement, options: Record<string, unknown>) => ProbePlayer;
};

export type YouTubeDurationProbeRequest = {
  probeId?: unknown;
  mediaProvider?: unknown;
  provider?: unknown;
  mediaId?: unknown;
  timeoutMs?: unknown;
};

export type YouTubeDurationProbeResult = {
  type: 'duration_probe_result';
  probeId: string;
  mediaProvider: 'youtube';
  mediaId: string;
  durationSec?: number;
  errorCode?: string;
};

export function createYouTubeDurationProbeRunner(
  getYouTubeApi: () => Promise<ProbeYouTubeApi>,
) {
  const jobs = new Map<string, () => void>();
  const queued = new Map<string, () => void>();
  const completed = new Map<string, { result: YouTubeDurationProbeResult; expiresAt: number }>();
  let activeCount = 0;
  let disposed = false;
  const drain = () => {
    while (!disposed && activeCount < 2 && queued.size) {
      const [id, run] = queued.entries().next().value!;
      queued.delete(id);
      run();
    }
  };

  const probe = (
    request: YouTubeDurationProbeRequest,
    report: (result: YouTubeDurationProbeResult) => void,
  ) => {
    const probeId = String(request.probeId || '').trim();
    const mediaProvider = String(request.mediaProvider || request.provider || '').trim().toLowerCase();
    const mediaId = String(request.mediaId || '').trim();
    if (!probeId || mediaProvider !== 'youtube' || !/^[A-Za-z0-9_-]{6,64}$/.test(mediaId)) return;
    if (disposed || jobs.has(probeId)) return;
    for (const [id, entry] of completed) if (entry.expiresAt <= Date.now()) completed.delete(id);
    const previous = completed.get(probeId);
    if (previous?.result.mediaId === mediaId) { report(previous.result); return; }
    const publish = (result: YouTubeDurationProbeResult) => {
      // A repeated HTTP/WS delivery must not construct another hidden YouTube iframe.
      completed.set(probeId, { result, expiresAt: Date.now() + 30000 });
      while (completed.size > 128) completed.delete(completed.keys().next().value!);
      report(result);
    };

    const requestedTimeoutMs = Number(request.timeoutMs);
    const timeoutMs = Math.min(12_000, Math.max(1_000, Number.isFinite(requestedTimeoutMs) ? requestedTimeoutMs : 10_000));
    const deadline = Date.now() + timeoutMs;
    let cancelled = false;
    let started = false;
    let apiLoadTimer: number | null = null;

    const baseResult = {
      type: 'duration_probe_result' as const,
      probeId,
      mediaProvider: 'youtube' as const,
      mediaId,
    };
    if (jobs.size >= 32) { publish({ ...baseResult, errorCode: 'probe_busy' }); return; }
    const releaseSlot = () => {
      queued.delete(probeId);
      if (started) { activeCount -= 1; started = false; }
      void Promise.resolve().then(drain);
    };
    const disposeBeforePlayer = () => {
      if (cancelled) return;
      cancelled = true;
      if (apiLoadTimer != null) window.clearTimeout(apiLoadTimer);
      jobs.delete(probeId);
      releaseSlot();
    };
    const failBeforePlayer = (errorCode: string) => {
      if (cancelled) return;
      disposeBeforePlayer();
      publish({ ...baseResult, errorCode });
    };

    jobs.set(probeId, disposeBeforePlayer);
    apiLoadTimer = window.setTimeout(() => failBeforePlayer('iframe_api_timeout'), timeoutMs);

    const start = () => getYouTubeApi().then((YT) => {
      if (cancelled || !jobs.has(probeId) || !YT?.Player) return;
      if (apiLoadTimer != null) window.clearTimeout(apiLoadTimer);

      const host = document.createElement('div');
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'position:fixed;left:-10000px;top:0;width:200px;height:200px;opacity:0;pointer-events:none;overflow:hidden;';
      const mount = document.createElement('div');
      host.appendChild(mount);
      document.body.appendChild(host);

      let player: ProbePlayer | null = null;
      let pollTimer: number | null = null;
      let timeoutTimer: number | null = null;
      let finished = false;

      const cleanup = () => {
        if (finished) return;
        finished = true;
        cancelled = true;
        jobs.delete(probeId);
        if (pollTimer != null) window.clearInterval(pollTimer);
        if (timeoutTimer != null) window.clearTimeout(timeoutTimer);
        try { player?.destroy?.(); } catch {}
        host.remove();
        releaseSlot();
      };
      const complete = (result: { durationSec: number } | { errorCode: string }) => {
        if (finished) return;
        cleanup();
        publish({ ...baseResult, ...result });
      };

      const readDuration = () => {
        if (finished) return;
        const duration = Number(player?.getDuration?.());
        if (!Number.isFinite(duration) || duration <= 0) return;
        complete({ durationSec: Math.ceil(duration) });
      };

      jobs.set(probeId, cleanup);
      timeoutTimer = window.setTimeout(
        () => complete({ errorCode: 'player_duration_timeout' }),
        Math.max(250, deadline - Date.now()),
      );
      pollTimer = window.setInterval(readDuration, 200);

      try {
        player = new YT.Player(mount, {
          width: '200',
          height: '200',
          videoId: mediaId,
          playerVars: {
            autoplay: 0,
            controls: 0,
            playsinline: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              readDuration();
              if (!finished && Number(player?.getDuration?.()) <= 0) {
                try { player?.cueVideoById?.(mediaId); } catch {}
              }
            },
            onStateChange: readDuration,
            onError: (event: { data?: unknown }) => {
              const errorCode = String(event?.data ?? 'unknown').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20);
              complete({ errorCode: `player_error_${errorCode || 'unknown'}` });
            },
          },
        });
      } catch {
        complete({ errorCode: 'player_create_failed' });
      }
    }).catch(() => {
      failBeforePlayer('iframe_api_failed');
    });
    queued.set(probeId, () => {
      if (cancelled || disposed) return;
      started = true;
      activeCount += 1;
      void start();
    });
    drain();
  };

  const dispose = () => {
    disposed = true;
    for (const cleanup of Array.from(jobs.values())) cleanup();
    jobs.clear();
    queued.clear();
    completed.clear();
  };

  return { probe, dispose };
}
