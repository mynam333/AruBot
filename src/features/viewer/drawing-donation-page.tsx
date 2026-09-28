'use client';

import Link from 'next/link';
import type Hls from 'hls.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, Loader2, MonitorPlay, Volume2, VolumeX } from 'lucide-react';
import { LegalFooter } from '@/components/app-shell/legal-footer';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { DrawingStudio } from '@/components/drawing/DrawingStudio';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { apiUrl } from '@/shared/api/http';
import { formatNumber } from '@/shared/lib/utils';

type Streamer = {
  channelUid: string;
  viewerUserId?: string;
  publicUid?: string | null;
  canonicalChannelUid?: string | null;
  channelName?: string | null;
  avatarUrl?: string | null;
  provider?: string | null;
  points: number;
  liveSurfaces?: LiveSurface[];
  drawingDonation: {
    pricingMode: 'fixed' | 'ink';
    costPoints: number;
    inkCostPerUnit: number;
    maxStrokes?: number;
    maxPoints?: number;
    replayMaxSec: number;
    resultHoldSec: number;
    canvas: { widthRatio: number; heightRatio: number };
    blocked?: boolean;
    blockReason?: string | null;
  };
};

type LiveSurface = {
  provider: 'chzzk' | 'cime' | 'youtube' | string;
  channelId: string;
  channelName?: string | null;
  avatarUrl?: string | null;
  live?: boolean | null;
  watchUrl?: string;
  embedUrl?: string;
  hlsChannelId?: string;
  hlsSupported?: boolean;
  embeddable?: boolean;
};

const providerLabels: Record<string, string> = {
  chzzk: '치지직',
  cime: '씨미',
  youtube: 'YouTube',
};

function ViewerShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen px-[var(--page-gutter)] py-[clamp(1rem,2.6vw,1.75rem)]">
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <Link href="/" className="inline-flex items-center gap-3 rounded-lg border bg-card px-3 py-2 shadow-subtle transition-colors hover:bg-muted">
          <img src="/files/logo.png" alt="" className="aspect-square w-[clamp(2rem,4vw,2.5rem)] object-contain" />
          <span className="text-sm font-semibold">AruBot</span>
        </Link>
        <div className="flex items-center gap-2">
          <LinkButton href="/viewer/me" variant="ghost">내 포인트</LinkButton>
          <ThemeToggle />
        </div>
      </header>
      {children}
      <div className="mx-auto w-full max-w-7xl">
        <LegalFooter />
      </div>
    </main>
  );
}

async function loadStreamer(channelUid: string, signal?: AbortSignal) {
  const response = await fetch(apiUrl(`/api/viewer/drawing-donation/streamers/${encodeURIComponent(channelUid)}`), { credentials: 'include', cache: 'no-store', signal });
  if (!response.ok) throw Object.assign(new Error('streamer unavailable'), { status: response.status });
  return response.json() as Promise<{ streamer: Streamer }>;
}

async function loadLivePlayback(surface: LiveSurface, signal?: AbortSignal) {
  const provider = encodeURIComponent(surface.provider);
  const channelId = encodeURIComponent(surface.hlsChannelId || surface.channelId);
  const response = await fetch(apiUrl(`/api/drawing-donation/live-playback?provider=${provider}&channelId=${channelId}`), { credentials: 'include', cache: 'no-store', signal });
  if (!response.ok) {
    const error = new Error('live playback unavailable') as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<{ playbackUrl?: string | null; embedUrl?: string | null }>;
}

export function DrawingDonationEditorPage({ channelUid }: { channelUid: string }) {
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const [streamer, setStreamer] = useState<Streamer | null>(null);
  const [streamerStatus, setStreamerStatus] = useState<'loading' | 'ready' | 'login-required' | 'not-found' | 'error'>('loading');
  const [streamerRetryToken, setStreamerRetryToken] = useState(0);
  const [selectedSurfaceKey, setSelectedSurfaceKey] = useState('');
  const [livePlaybackUrl, setLivePlaybackUrl] = useState('');
  const [liveEmbedUrl, setLiveEmbedUrl] = useState('');
  const [livePlaybackStatus, setLivePlaybackStatus] = useState<'idle' | 'loading' | 'ready' | 'offline' | 'error'>('idle');
  const [playbackRetryToken, setPlaybackRetryToken] = useState(0);
  const manualSurfaceSelectionRef = useRef(false);
  const attemptedSurfaceKeysRef = useRef(new Set<string>());
  const [liveMuted, setLiveMuted] = useState(true);
  const [liveVolume, setLiveVolume] = useState(0.35);
  const liveSurfaces = useMemo(() => streamer?.liveSurfaces || [], [streamer]);
  const selectedSurface = useMemo(() => {
    if (!liveSurfaces.length) return null;
    return liveSurfaces.find((surface) => `${surface.provider}:${surface.channelId}` === selectedSurfaceKey) || liveSurfaces.find((surface) => surface.live === true) || liveSurfaces[0];
  }, [liveSurfaces, selectedSurfaceKey]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    setStreamer(null);
    setStreamerStatus('loading');
    loadStreamer(channelUid, controller.signal)
      .then((data) => {
        if (cancelled) return;
        const found = data.streamer;
        if (!found) throw Object.assign(new Error('streamer unavailable'), { status: 404 });
        setStreamer({ ...found, viewerUserId: found.viewerUserId || crypto.randomUUID() });
        setStreamerStatus('ready');
        manualSurfaceSelectionRef.current = false;
        attemptedSurfaceKeysRef.current.clear();
        const surfaces = found?.liveSurfaces || [];
        const preferred = surfaces.find((surface) => surface.live === true) || surfaces[0];
        if (preferred) setSelectedSurfaceKey(`${preferred.provider}:${preferred.channelId}`);
      })
      .catch((error: Error & { status?: number }) => {
        if (cancelled) return;
        setStreamerStatus(error.status === 401 ? 'login-required' : error.status === 404 ? 'not-found' : 'error');
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [channelUid, streamerRetryToken]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    setLivePlaybackUrl('');
    setLiveEmbedUrl('');
    if (!selectedSurface) {
      setLivePlaybackStatus('idle');
      return () => {
        cancelled = true;
      };
    }
    setLivePlaybackStatus('loading');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18_000);
    loadLivePlayback(selectedSurface, controller.signal)
      .then((payload) => {
        if (cancelled) return;
        const playbackUrl = payload.playbackUrl || '';
        const embedUrl = payload.embedUrl || '';
        setLivePlaybackUrl(playbackUrl);
        setLiveEmbedUrl(embedUrl);
        if (!playbackUrl && !embedUrl) throw Object.assign(new Error('live playback unavailable'), { status: 404 });
        attemptedSurfaceKeysRef.current.clear();
        if (embedUrl) setLivePlaybackStatus('ready');
      })
      .catch((error: Error & { status?: number }) => {
        if (cancelled) return;
        const offline = error.status === 404;
        setLivePlaybackStatus(offline ? 'offline' : 'error');
        if (offline && !manualSurfaceSelectionRef.current) {
          attemptedSurfaceKeysRef.current.add(`${selectedSurface.provider}:${selectedSurface.channelId}`);
          const next = liveSurfaces.find((surface) => !attemptedSurfaceKeysRef.current.has(`${surface.provider}:${surface.channelId}`));
          if (next) {
            setSelectedSurfaceKey(`${next.provider}:${next.channelId}`);
            return;
          }
          attemptedSurfaceKeysRef.current.clear();
        }
        if (offline) retryTimer = setTimeout(() => setPlaybackRetryToken((current) => current + 1), 20_000);
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [liveSurfaces, playbackRetryToken, selectedSurface]);

  useEffect(() => {
    const video = liveVideoRef.current;
    if (!video || !livePlaybackUrl) return undefined;
    let hls: Hls | null = null;
    let disposed = false;
    video.playsInline = true;
    const play = () => video.play().catch(() => undefined);
    const onPlaying = () => setLivePlaybackStatus('ready');
    const onError = () => {
      if (!disposed) {
        console.warn('[Drawing Donation] Video playback failed:', video.error?.code, video.error?.message);
        setLivePlaybackStatus('error');
      }
    };
    video.addEventListener('playing', onPlaying);
    video.addEventListener('error', onError);
    const playNatively = () => {
      video.src = livePlaybackUrl;
      video.addEventListener('loadedmetadata', play, { once: true });
    };
    import('hls.js')
      .then(({ default: Hls }) => {
        if (disposed) return;
        if (!Hls.isSupported()) {
          if (video.canPlayType('application/vnd.apple.mpegurl')) playNatively();
          else setLivePlaybackStatus('error');
          return;
        }
        hls = new Hls({
          lowLatencyMode: true,
          enableWorker: true,
          backBufferLength: 30,
          liveSyncDurationCount: 3,
        });
        hls.loadSource(livePlaybackUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, play);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal && !disposed) {
            console.warn('[Drawing Donation] HLS playback failed:', data.type, data.details);
            setLivePlaybackStatus('error');
          }
        });
      })
      .catch(() => {
        if (disposed) return;
        if (video.canPlayType('application/vnd.apple.mpegurl')) playNatively();
        else setLivePlaybackStatus('error');
      });
    return () => {
      disposed = true;
      hls?.destroy();
      video.removeEventListener('loadedmetadata', play);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('error', onError);
      video.removeAttribute('src');
      video.load();
    };
  }, [livePlaybackUrl]);

  useEffect(() => {
    if (livePlaybackStatus !== 'error' || !selectedSurface) return undefined;
    const timer = setTimeout(() => setPlaybackRetryToken((current) => current + 1), 10_000);
    return () => clearTimeout(timer);
  }, [livePlaybackStatus, selectedSurface]);

  useEffect(() => {
    const video = liveVideoRef.current;
    if (!video) return;
    video.muted = liveMuted;
    video.volume = Math.max(0, Math.min(1, liveVolume));
    if (!liveMuted) video.play().catch(() => undefined);
  }, [liveMuted, livePlaybackUrl, liveVolume]);

  return (
    <ViewerShell>
      <section className="mx-auto mt-[clamp(1rem,3vw,2rem)] max-w-7xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="ghost"><Link href={`/c/${encodeURIComponent(channelUid)}`}><ArrowLeft aria-hidden="true" className="h-[1em] w-[1em]" /> 공개 페이지로</Link></Button>
          {streamer ? <Badge tone="mint">{formatNumber(streamer.points)}P 보유</Badge> : null}
        </div>

        {streamerStatus !== 'ready' ? (
          <div role={streamerStatus === 'loading' ? 'status' : 'alert'} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel)] border bg-card p-4 shadow-subtle">
            <div className="space-y-1 text-sm">
              <p className="font-semibold">
                {streamerStatus === 'loading' ? '그림 후원 정보를 불러오는 중입니다.'
                  : streamerStatus === 'login-required' ? '로그인이 필요해요.'
                    : streamerStatus === 'not-found' ? '이 채널의 그림 후원 정보를 찾지 못했어요.'
                      : '그림 후원 정보를 불러오지 못했어요.'}
              </p>
              {streamerStatus !== 'loading' ? (
                <p className="text-muted-foreground">
                  {streamerStatus === 'login-required' ? '시청자 계정으로 로그인하면 방송 화면과 보유 포인트를 불러올 수 있어요.'
                    : streamerStatus === 'not-found' ? '공개 페이지에서 그림 후원 활성화 여부와 연결한 시청자 계정을 확인해 주세요.'
                      : '서버 연결을 확인한 뒤 다시 시도해 주세요. 다시 시도해도 그린 그림은 유지됩니다.'}
                </p>
              ) : null}
            </div>
            {streamerStatus === 'login-required' ? (
              <LinkButton href={`/viewer/login?returnTo=${encodeURIComponent(`/viewer/drawing/${encodeURIComponent(channelUid)}`)}`}>로그인하고 계속하기</LinkButton>
            ) : streamerStatus !== 'loading' ? (
              <Button type="button" variant="outline" onClick={() => setStreamerRetryToken((current) => current + 1)}>정보 다시 불러오기</Button>
            ) : <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        ) : null}

        {liveSurfaces.length ? (
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-panel)] border bg-card/80 p-3 shadow-subtle">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground"><MonitorPlay className="h-[1em] w-[1em]" /> 그릴 방송 화면</span>
            {liveSurfaces.map((surface) => {
              const key = `${surface.provider}:${surface.channelId}`;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    manualSurfaceSelectionRef.current = true;
                    attemptedSurfaceKeysRef.current.clear();
                    setSelectedSurfaceKey(key);
                    setPlaybackRetryToken((current) => current + 1);
                  }}
                  className={`inline-flex min-h-[var(--control-height-sm)] items-center gap-2 rounded-full border px-3 text-xs font-semibold transition ${selectedSurfaceKey === key ? 'border-primary/40 bg-primary/12 text-primary' : 'bg-background/70 text-muted-foreground hover:border-primary/30 hover:text-foreground'}`}
                >
                  {providerLabels[surface.provider] || surface.provider}
                  {surface.live === true ? <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[0.65rem] text-white">LIVE</span> : null}
                </button>
              );
            })}
            {selectedSurface?.watchUrl ? (
              <Button asChild variant="ghost" size="sm">
                <a href={selectedSurface.watchUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-[1em] w-[1em]" /> 방송 열기</a>
              </Button>
            ) : null}
          </div>
        ) : null}

        {streamer && streamerStatus === 'ready' ? (
          <DrawingStudio
            channelUid={streamer.publicUid || streamer.channelUid}
            viewerUserId={streamer.viewerUserId || channelUid}
            points={streamer.points}
            settings={streamer.drawingDonation}
            onSubmitted={(cost) => setStreamer((current) => current ? { ...current, points: Math.max(0, current.points - cost) } : current)}
            background={<>
              {selectedSurface?.hlsSupported ? (
                livePlaybackUrl ? (
                  <video
                    ref={liveVideoRef}
                    className="absolute inset-0 h-full w-full bg-black object-cover"
                    muted={liveMuted}
                    playsInline
                    autoPlay
                  />
                ) : (
                  <div className="absolute inset-0 grid place-items-center bg-black text-center text-sm text-white/72">
                    <span>{livePlaybackStatus === 'loading' ? '방송 화면을 불러오는 중입니다.' : '화면 연결과 관계없이 그림을 계속 그릴 수 있어요.'}</span>
                  </div>
                )
              ) : liveEmbedUrl ? (
                <iframe
                  key={liveEmbedUrl}
                  src={liveEmbedUrl}
                  title={`${providerLabels[selectedSurface?.provider || ''] || selectedSurface?.provider} 방송 화면`}
                  className="absolute inset-0 h-full w-full border-0 bg-black"
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  referrerPolicy="no-referrer-when-downgrade"
                  onError={() => setLivePlaybackStatus('error')}
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center bg-muted/30 text-center text-sm text-muted-foreground">
                  <span>{selectedSurface && livePlaybackStatus === 'loading' ? '방송 화면을 불러오는 중입니다.' : '방송 화면 위에 올라갈 위치를 생각하며 그려주세요.'}</span>
                </div>
              )}
              {selectedSurface && (livePlaybackStatus === 'offline' || livePlaybackStatus === 'error') ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
                  <div className="pointer-events-auto flex items-center gap-2 rounded-full border bg-card/90 px-3 py-1.5 text-xs shadow-subtle backdrop-blur-xl">
                    <span>{livePlaybackStatus === 'offline' ? '현재 생방송을 찾지 못했어요.' : '방송 화면 연결이 끊겼어요.'}</span>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setPlaybackRetryToken((current) => current + 1)}>다시 연결</Button>
                  </div>
                </div>
              ) : null}
              {selectedSurface?.hlsSupported ? (
                <div className="absolute right-3 top-3 z-20 flex max-w-[min(18rem,calc(100%-1.5rem))] items-center gap-2 rounded-full border bg-card/88 px-2 py-1.5 shadow-subtle backdrop-blur-xl">
                  <Button type="button" size="icon" variant="ghost" onClick={() => setLiveMuted((current) => !current)} aria-label={liveMuted ? '방송 소리 켜기' : '방송 소리 끄기'}>
                    {liveMuted ? <VolumeX className="h-[1em] w-[1em]" /> : <Volume2 className="h-[1em] w-[1em]" />}
                  </Button>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(liveVolume * 100)}
                    onChange={(event) => {
                      const next = Math.max(0, Math.min(100, Number(event.target.value || 0))) / 100;
                      setLiveVolume(next);
                      if (next > 0) setLiveMuted(false);
                    }}
                    className="h-[var(--control-height-sm)] w-[clamp(5rem,12vw,8rem)] accent-primary"
                    aria-label="방송 배경 음량"
                  />
                </div>
              ) : null}
            </>}
          />
        ) : null}
      </section>
    </ViewerShell>
  );
}
