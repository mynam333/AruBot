type ProbePlayer = {
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
  durationSec: number;
};

export function createYouTubeDurationProbeRunner(
  getYouTubeApi: () => Promise<ProbeYouTubeApi>,
) {
  const jobs = new Map<string, () => void>();

  const probe = (
    request: YouTubeDurationProbeRequest,
    report: (result: YouTubeDurationProbeResult) => void,
  ) => {
    const probeId = String(request.probeId || '').trim();
    const mediaProvider = String(request.mediaProvider || request.provider || '').trim().toLowerCase();
    const mediaId = String(request.mediaId || '').trim();
    if (!probeId || mediaProvider !== 'youtube' || !/^[A-Za-z0-9_-]{6,64}$/.test(mediaId)) return;
    if (jobs.has(probeId)) return;

    const requestedTimeoutMs = Number(request.timeoutMs);
    const timeoutMs = Math.min(10_000, Math.max(1_000, Number.isFinite(requestedTimeoutMs) ? requestedTimeoutMs : 8_000));
    const deadline = Date.now() + timeoutMs;
    let cancelled = false;
    let apiLoadTimer: number | null = null;
    jobs.set(probeId, () => {
      cancelled = true;
      if (apiLoadTimer != null) window.clearTimeout(apiLoadTimer);
      jobs.delete(probeId);
    });
    apiLoadTimer = window.setTimeout(() => jobs.get(probeId)?.(), timeoutMs);

    void getYouTubeApi().then((YT) => {
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
        jobs.delete(probeId);
        if (pollTimer != null) window.clearInterval(pollTimer);
        if (timeoutTimer != null) window.clearTimeout(timeoutTimer);
        try { player?.destroy?.(); } catch {}
        host.remove();
      };

      const readDuration = () => {
        if (finished) return;
        const duration = Number(player?.getDuration?.());
        if (!Number.isFinite(duration) || duration <= 0) return;
        const durationSec = Math.ceil(duration);
        cleanup();
        report({
          type: 'duration_probe_result',
          probeId,
          mediaProvider: 'youtube',
          mediaId,
          durationSec,
        });
      };

      jobs.set(probeId, cleanup);
      timeoutTimer = window.setTimeout(cleanup, Math.max(250, deadline - Date.now()));
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
            onReady: readDuration,
            onStateChange: readDuration,
            onError: cleanup,
          },
        });
      } catch {
        cleanup();
      }
    }).catch(() => {
      jobs.get(probeId)?.();
    });
  };

  const dispose = () => {
    for (const cleanup of Array.from(jobs.values())) cleanup();
    jobs.clear();
  };

  return { probe, dispose };
}
