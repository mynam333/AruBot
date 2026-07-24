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
    const timeoutMs = Math.min(12_000, Math.max(1_000, Number.isFinite(requestedTimeoutMs) ? requestedTimeoutMs : 10_000));
    const deadline = Date.now() + timeoutMs;
    let cancelled = false;
    let apiLoadTimer: number | null = null;

    const baseResult = {
      type: 'duration_probe_result' as const,
      probeId,
      mediaProvider: 'youtube' as const,
      mediaId,
    };
    const disposeBeforePlayer = () => {
      if (cancelled) return;
      cancelled = true;
      if (apiLoadTimer != null) window.clearTimeout(apiLoadTimer);
      jobs.delete(probeId);
    };
    const failBeforePlayer = (errorCode: string) => {
      if (cancelled) return;
      disposeBeforePlayer();
      report({ ...baseResult, errorCode });
    };

    jobs.set(probeId, disposeBeforePlayer);
    apiLoadTimer = window.setTimeout(() => failBeforePlayer('iframe_api_timeout'), timeoutMs);

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
      const complete = (result: { durationSec: number } | { errorCode: string }) => {
        if (finished) return;
        cleanup();
        report({ ...baseResult, ...result });
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
  };

  const dispose = () => {
    for (const cleanup of Array.from(jobs.values())) cleanup();
    jobs.clear();
  };

  return { probe, dispose };
}
