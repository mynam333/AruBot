import React from 'react';
import { createRouletteSpinRandom, resolveRouletteSpinSeed } from '@/components/roulette-spin-random';
import { getBrowserApiBase } from '@/shared/api/http';
import { connectOverlaySocket } from '@/shared/api/overlay-socket';
import { RouletteThemeAtmosphere } from './rouletteThemeAtmosphere';
import { getRouletteThemeMaterial } from './rouletteThemeMaterials';
import { WheelGlassOverlay, WheelLabelsSvg, WheelPointer, WheelSegmentsSvg, WheelSelectedSegment, WheelSkinOrnaments } from './rouletteWheelSkins';
import { createWheelSegments, splitWheelLabel } from './rouletteWheelUtils';
import { buildRouletteWheelEntries } from './rouletteWheelEntries';
import { RouletteFitText } from './rouletteFitText';
import { getRouletteMotionProfile, rouletteMotionPhase, rouletteMotionProgress, rouletteWheelKeyframes } from './rouletteMotion';
import './roulettePresentation.css';

type WindowWithLegacyAudioContext = Window & { webkitAudioContext?: typeof AudioContext };

const DEFAULT_PRODUCTION_API_BASE = 'https://arubotapi.yuaru.com';

function getRouletteApiBase() {
  const configured = getBrowserApiBase();
  if (configured) return configured;
  if (typeof window === 'undefined') return DEFAULT_PRODUCTION_API_BASE;

  const { hostname, protocol } = window.location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  if (isLocal) return `${protocol}//127.0.0.1:3001`;
  if (hostname.endsWith('.yuaru.com')) return DEFAULT_PRODUCTION_API_BASE;
  return window.location.origin;
}

function getRouletteWsUrl(token: string, testConnectionId = '') {
  const url = new URL('/api/roulette/ws', getRouletteApiBase());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', token);
  if (testConnectionId) url.searchParams.set('testConnectionId', testConnectionId);
  return url.toString();
}

type Theme = 'studio' | 'prism' | 'aurora' | 'velvet' | 'mono' | 'deco' | 'crystal' | 'ink' | 'nova' | 'ceramic' | 'arcade' | 'sakura' | 'ocean' | 'solar' | 'cyber' | 'gold' | 'classic' | 'fire' | 'ice' | 'pastel' | 'forest' | 'midnight' | 'sunset';
type RouletteLayout = 'reel' | 'wheel';
const ROULETTE_THEME_NAMES: Theme[] = ['studio', 'prism', 'aurora', 'velvet', 'mono', 'deco', 'crystal', 'ink', 'nova', 'ceramic', 'arcade', 'sakura', 'ocean', 'solar', 'cyber', 'gold', 'classic', 'fire', 'ice', 'pastel', 'forest', 'midnight', 'sunset'];
const ROULETTE_THEME_ALIASES: Partial<Record<Theme, Theme>> = {
  classic: 'studio',
  fire: 'solar',
  ice: 'ocean',
  pastel: 'prism',
  forest: 'aurora',
  midnight: 'mono',
  sunset: 'solar',
};
const ROULETTE_LAYOUT_NAMES: RouletteLayout[] = ['reel', 'wheel'];

function parseRouletteLook(value?: unknown): { theme?: Theme; layout?: RouletteLayout } {
  const text = String(value || '').toLowerCase().trim();
  if (!text) return {};
  const parts = text.split(/[:_\-\s]+/).filter(Boolean);
  const rawTheme = parts.find((part): part is Theme => ROULETTE_THEME_NAMES.includes(part as Theme));
  const theme = rawTheme ? (ROULETTE_THEME_ALIASES[rawTheme] || rawTheme) : undefined;
  const layout = parts.find((part): part is RouletteLayout => ROULETTE_LAYOUT_NAMES.includes(part as RouletteLayout));
  return {
    ...(theme ? { theme } : {}),
    ...(layout ? { layout } : {}),
  };
}

type WsPayload = {
  type: 'roulette';
  initialSnapshot?: boolean;
  token?: string;
  name?: string | null;
  username?: string | null;
  value?: number | string | null;
  label?: string | null;
  createdAt?: number | string | null;
  theme?: string | null;
  items?: string[] | null;
  itemWeights?: number[] | null;
  selectedItemIndex?: number | null;
  channelId?: string | null;
  spinId?: string | null;
  spinDurationMs?: number | string | null;
  instant?: boolean;
  testMode?: boolean;
  batchId?: string | null;
  batchCount?: number | string | null;
};

type RouletteTestReadyPayload = {
  type: 'roulette:test-ready';
  token?: string;
  channelId?: string | null;
  testConnectionId?: string;
  serverTimestamp?: number;
};

// WebSocket 연결 상태 추적을 위한 인터페이스
interface WebSocketDebugInfo {
  connectionAttempts: number;
  lastConnectionTime: number;
  lastMessageTime: number;
  tokenValid: boolean;
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'error';
  lastError: string | null;
  messageCount: number;
  reconnectAttempts: number;
  validMessagesReceived: number;
  initialMessagesSkipped: number;
  queuedMessagesCount: number;
  channelId: string | null; // 추가: 현재 채널 ID
}

type RouletteViewerProps = {
  viewerToken?: string;
};

type WheelSpinPlan = {
  id: number;
  startRotation: number;
  finalRotation: number;
  durationMs: number;
  motionTheme: Theme;
  reducedMotion: boolean;
};

type SpinCompletionBarrier = {
  id: number;
  reelDone: boolean;
  wheelDone: boolean;
  completed: boolean;
  finish: () => void;
};

function tryFinishSpinBarrier(barrier: SpinCompletionBarrier | null) {
  if (!barrier || barrier.completed || !barrier.reelDone || !barrier.wheelDone) return;
  barrier.completed = true;
  barrier.finish();
}

const DEFAULT_ROULETTE_SPIN_DURATION_MS = 5200;
const WHEEL_STOP_EDGE_PADDING_RATIO = 0.14;

function normalizeRouletteSpinDuration(value: unknown) {
  const durationMs = Number(value);
  if (!Number.isFinite(durationMs) || durationMs < 1000 || durationMs > 20000) {
    return DEFAULT_ROULETTE_SPIN_DURATION_MS;
  }
  return Math.round(durationMs);
}

function randomWheelStopOffsetRatio(random = Math.random) {
  const maxOffset = 0.5 - WHEEL_STOP_EDGE_PADDING_RATIO;
  return ((random() * 2) - 1) * maxOffset;
}

function wheelStopRotationForIndex(index: number, segmentCount: number, offsetRatio = 0, weights?: number[]) {
  const segments = createWheelSegments(Math.max(1, segmentCount), weights);
  const segment = segments[Math.max(0, Math.min(segments.length - 1, index))];
  const maxOffset = 0.5 - WHEEL_STOP_EDGE_PADDING_RATIO;
  const safeOffsetRatio = Math.max(-maxOffset, Math.min(maxOffset, offsetRatio));
  return -(segment.center + safeOffsetRatio * segment.span);
}

function wheelIndexAtPointer(rotation: number, segmentCount: number, weights?: number[]) {
  const segments = createWheelSegments(Math.max(1, segmentCount), weights);
  const pointerAngle = (((-rotation) % 360) + 360) % 360;
  return Math.max(0, segments.findIndex(segment => segment.span > 0 && pointerAngle >= segment.start && pointerAngle < segment.end));
}

function equivalentForwardRotation(currentRotation: number, targetModuloRotation: number, turns = 6) {
  const currentModulo = ((currentRotation % 360) + 360) % 360;
  const targetModulo = ((targetModuloRotation % 360) + 360) % 360;
  const delta = (targetModulo - currentModulo + 360) % 360;
  return currentRotation + delta + (Math.max(1, turns) * 360);
}

export default function RouletteViewer({ viewerToken = '' }: RouletteViewerProps) {
  const [state, setState] = React.useState<{ name?: string | null; username?: string | null; label?: string | null; value?: number | string | null }>(() => ({}));
  const [error, setError] = React.useState<string | null>(null);
  const [active, setActive] = React.useState(false);
  const [, setScrollItems] = React.useState<string[]>([]);
  const scrollItemsRef = React.useRef<string[]>([]);
  const [, setScrollIndex] = React.useState(0);
  const [offsetRows, setOffsetRows] = React.useState(0); // smooth center index (float)
  const reelRef = React.useRef<HTMLDivElement | null>(null);
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const [rowH, setRowH] = React.useState(0);
  const rowsHalfRef = React.useRef(6);
  const rowsHalfSpinRef = React.useRef<number | null>(null);
  const [wheelItemsState, setWheelItemsState] = React.useState<string[]>([]);
  const [wheelWeights, setWheelWeights] = React.useState<number[]>([]);
  const [wheelSelectedIndex, setWheelSelectedIndex] = React.useState(-1);
  const [wheelRotationDeg, setWheelRotationDeg] = React.useState(0);
  const [wheelSettled, setWheelSettled] = React.useState(false);
  const [wheelSpinPlan, setWheelSpinPlan] = React.useState<WheelSpinPlan | null>(null);
  const wheelDiscRef = React.useRef<HTMLDivElement | null>(null);
  const wheelAnimationRef = React.useRef<Animation | null>(null);
  const wheelSpinPlanIdRef = React.useRef(0);
  const wheelRotationRef = React.useRef(0);
  const spinCompletionBarrierRef = React.useRef<SpinCompletionBarrier | null>(null);
  // RAF physics refs
  const rafIdRef = React.useRef<number | null>(null);
  const animStartRef = React.useRef<number>(0);
  const presentationRef = React.useRef<HTMLDivElement>(null);
  const startCenterRef = React.useRef<number>(0); // start center index (rows)
  const targetIndexRef = React.useRef<number>(0);  // final center index (integer rows)
  const poolRef = React.useRef<string[]>([]);
  const finalIndexRef = React.useRef<number | null>(null);
  const finalLabelRef = React.useRef<string | null>(null);

  // WebSocket 디버깅 정보 상태
  const [, setDebugInfo] = React.useState<WebSocketDebugInfo>({
    connectionAttempts: 0,
    lastConnectionTime: 0,
    lastMessageTime: 0,
    tokenValid: false,
    connectionState: 'disconnected',
    lastError: null,
    messageCount: 0,
    reconnectAttempts: 0,
    validMessagesReceived: 0,
    initialMessagesSkipped: 0,
    queuedMessagesCount: 0,
    channelId: null, // 추가: 현재 채널 ID
  });
  const wsRef = React.useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = React.useRef(0);

  // Deterministic label provider for any integer index (prevents blanks)
  const labelFor = React.useCallback((idx: number) => {
    if (finalIndexRef.current != null && idx === finalIndexRef.current && finalLabelRef.current != null) {
      return finalLabelRef.current;
    }
    const arr = scrollItemsRef.current;
    if (idx >= 0 && idx < arr.length && typeof arr[idx] !== 'undefined') return arr[idx];
    const pool = poolRef.current;
    if (pool && pool.length) {
      // Simple index hash -> stable pseudo-random pick
      const h = Math.abs((idx * 2654435761) >>> 0);
      const n = h % pool.length;
      return pool[n];
    }
    return '…';
  }, []);

  // Helper: estimate how many rows fit in half the viewport (above or below center)
  const computeRowsHalf = React.useCallback(() => {
    try {
      const vh = reelRef.current?.getBoundingClientRect().height || 0;
      const rh = rowH || (rowRef.current?.getBoundingClientRect().height || 0);
      if (vh > 0 && rh > 0) {
        const half = Math.ceil(vh / (rh * 2));
        rowsHalfRef.current = Math.max(5, Math.min(18, half));
        return rowsHalfRef.current;
      }
    } catch {}
    return rowsHalfRef.current;
  }, [rowH]);
  const [serverTheme, setServerTheme] = React.useState<Theme | null>(null);
  const [serverLayout, setServerLayout] = React.useState<RouletteLayout | null>(null);
  const timersRef = React.useRef<number[]>([]);
  const userInteractedRef = React.useRef(false);
  const canAutoPlayRef = React.useRef(false);
  const isSpinningRef = React.useRef(false);
  const spinCooldownUntilRef = React.useRef(0);
  const lastSpinKeyRef = React.useRef<string | null>(null);
  const lastSpinAtRef = React.useRef(0);

  // 초기 메시지 처리 개선을 위한 상태
  const connectionEstablishedAtRef = React.useRef<number>(0);
  const firstValidMessageReceivedRef = React.useRef(false);
  const INITIAL_MESSAGE_GRACE_PERIOD = 2000; // 연결 후 2초 내의 메시지는 초기 메시지로 간주

  // 채널 ID 검증을 위한 상태
  const expectedChannelIdRef = React.useRef<string | null>(null);
  const channelIdValidationEnabledRef = React.useRef(true); // 채널 ID 검증 활성화 여부

  // Measure row height when active and on resize
  React.useLayoutEffect(() => {
    const measure = () => {
      try {
        const h = rowRef.current?.getBoundingClientRect().height || 0;
        if (h && Math.abs(h - rowH) > 1) setRowH(Math.floor(h));
      } catch {}
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [rowH, active]);

  // Try to programmatically enable autoplay by briefly playing muted
  const primeAudio = React.useCallback(async () => {
    try {
      const a = startAudioRef.current;
      const b = endAudioRef.current;
      const el = a || b;
      if (!el) return false;
      const prevMuted = el.muted;
      const prevVol = el.volume;
      el.muted = true;
      el.volume = 0;
      try { await el.play(); } catch {}
      try { el.pause(); } catch {}
      try { el.currentTime = 0; } catch {}
      el.muted = prevMuted;
      el.volume = prevVol;
      canAutoPlayRef.current = true;
      return true;
    } catch {
      return false;
    }
  }, []);

  // Queue for incoming roulette events while a spin is in progress (to support multi-spin)
  const queuedEventsRef = React.useRef<WsPayload[]>([]);
  const processQueuedRef = React.useRef<() => void>(() => {});
  // Batch progress tracking (server sends batchId, batchCount)
  const currentBatchIdRef = React.useRef<string | null>(null);
  const currentBatchTotalRef = React.useRef<number>(0);
  const currentBatchDoneRef = React.useRef<number>(0);
  const [batchProgress, setBatchProgress] = React.useState<{ id: string | null, done: number, total: number }>({ id: null, done: 0, total: 0 });
  // Unified fade (blink) timing in ms for container opacity and instant sequencing
  const FADE_MS = 250;

  React.useEffect(() => {
    const onInteract = () => { userInteractedRef.current = true; };
    window.addEventListener('pointerdown', onInteract, { once: true });
    window.addEventListener('keydown', onInteract, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onInteract);
      window.removeEventListener('keydown', onInteract);
    };
  }, []);
  const token = React.useMemo(() => {
    const propToken = String(viewerToken || '').trim();
    if (propToken) return propToken;
    try {
      const parts = (typeof window !== 'undefined' ? window.location.pathname : '').split('/').filter(Boolean);
      const idx = parts.indexOf('roulette');
      return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : '';
    } catch { return ''; }
  }, [viewerToken]);
  const previewMode = React.useMemo(() => {
    try {
      const q = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
      return q.get('preview') === '1';
    } catch { return false; }
  }, []);
  const embeddedTestMode = React.useMemo(() => {
    try {
      const q = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
      return q.get('embeddedTest') === '1';
    } catch { return false; }
  }, []);
  const testConnectionId = React.useMemo(() => {
    try {
      const q = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
      const value = String(q.get('testConnectionId') || '').trim();
      return /^[A-Za-z0-9_-]{16,128}$/.test(value) ? value : '';
    } catch { return ''; }
  }, []);
  const postEmbeddedMessage = React.useCallback((payload: Record<string, unknown>) => {
    if (typeof window === 'undefined') return;
    const message = { ...payload, token, testConnectionId };
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(message, window.location.origin);
        return;
      }
    } catch { }
    try {
      if (window.parent !== window) window.parent.postMessage(message, window.location.origin);
    } catch { }
  }, [testConnectionId, token]);
  const announceRouletteSettled = React.useCallback((payload: {
    spinId?: string | null;
    label: string;
    value?: string | number | null;
    selectedIndex: number;
    itemCount: number;
  }) => {
    postEmbeddedMessage({ type: 'arubot:roulette-settled', ...payload });
    const spinId = String(payload.spinId || '').trim();
    if (!spinId || previewMode || testConnectionId) return;

    const notifyServer = () => {
      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      try {
        socket.send(JSON.stringify({
          type: 'roulette:settled',
          spinId,
          label: payload.label,
        }));
      } catch { }
    };

    // Two animation frames put the acknowledgement after React has committed
    // the final result and the browser has painted it at least once.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(notifyServer);
    });
  }, [postEmbeddedMessage, previewMode, testConnectionId]);

  // 메시지 채널 ID 검증 함수
  const validateMessageChannelId = React.useCallback((message: WsPayload, expectedChannelId: string | null): boolean => {
    try {
      // 메시지에 channelId가 없으면 검증 통과 (하위 호환성)
      if (!message.channelId) {
        return true;
      }

      // 예상 채널 ID가 없으면 첫 번째 유효한 메시지의 채널 ID를 저장
      if (!expectedChannelId) {
        return true;
      }

      // 채널 ID 일치 검증
      const isValid = message.channelId === expectedChannelId;
      if (!isValid) {
        console.warn('[RouletteViewer] 채널 ID 불일치:', {
          expected: expectedChannelId,
          received: message.channelId,
          messageType: message.type
        });
      }

      return isValid;
    } catch (error) {
      console.error('[RouletteViewer] 메시지 채널 ID 검증 중 오류:', error);
      return false;
    }
  }, []);

  // 토큰 기본 검증 함수 (채널 검증은 서버에서만)
  const validateToken = React.useCallback((tokenToValidate: string): boolean => {
    if (!tokenToValidate || typeof tokenToValidate !== 'string') {
      console.warn('[RouletteViewer] 토큰이 비어있거나 유효하지 않습니다:', tokenToValidate);
      return false;
    }
    
    // 토큰 길이 검증 (일반적으로 UUID 형태이므로 최소 길이 확인)
    if (tokenToValidate.length < 8) {
      console.warn('[RouletteViewer] 토큰이 너무 짧습니다:', tokenToValidate.length);
      return false;
    }
    
    return true;
  }, []);

  // 디버깅 정보 업데이트 함수
  const updateDebugInfo = React.useCallback((updates: Partial<WebSocketDebugInfo> | ((prev: WebSocketDebugInfo) => Partial<WebSocketDebugInfo>)) => {
    setDebugInfo(prev => {
      const patch = typeof updates === 'function' ? updates(prev) : updates;
      const newInfo = { ...prev, ...patch };
      return newInfo;
    });
  }, []);
  // URL override for theme/layout (optional)
  const urlLook = React.useMemo(() => {
    try {
      const q = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
      return {
        ...parseRouletteLook(q.get('theme')),
        ...parseRouletteLook(q.get('layout')),
      };
    } catch { return {}; }
  }, []);
  const theme: Theme = urlLook.theme || serverTheme || 'studio';
  const layout: RouletteLayout = urlLook.layout || serverLayout || 'reel';
  const applyServerLook = React.useCallback((value?: unknown) => {
    const look = parseRouletteLook(value);
    if (look.theme) setServerTheme(look.theme);
    if (look.layout) setServerLayout(look.layout);
  }, []);

  React.useEffect(() => {
    if (!active || layout !== 'wheel' || !wheelSpinPlan) return;
    const wheel = wheelDiscRef.current;
    if (!wheel) return;

    try { wheelAnimationRef.current?.cancel(); } catch {}

    const { id, startRotation, finalRotation, durationMs, motionTheme, reducedMotion } = wheelSpinPlan;
    const profile = getRouletteMotionProfile(motionTheme);
    wheel.style.transform = `rotate(${reducedMotion ? finalRotation : startRotation}deg)`;
    const notifyWheelFinished = () => {
      if (wheelSpinPlanIdRef.current !== id) return;
      wheelRotationRef.current = finalRotation;
      setWheelRotationDeg(finalRotation);
      setWheelSettled(true);
      const barrier = spinCompletionBarrierRef.current;
      if (barrier?.id === id) {
        barrier.wheelDone = true;
        tryFinishSpinBarrier(barrier);
      }
    };

    if (typeof wheel.animate !== 'function') {
      let completed = false;
      let frameId = 0;
      const started = performance.now();
      const finishFallback = () => {
        if (completed) return;
        completed = true;
        wheel.style.transform = `rotate(${finalRotation}deg)`;
        notifyWheelFinished();
      };
      const tick = (now: number) => {
        const time = Math.min(1, (now - started) / durationMs);
        const progress = reducedMotion ? 1 : rouletteMotionProgress(time, profile);
        wheel.style.transform = `rotate(${startRotation + (finalRotation - startRotation) * progress}deg)`;
        if (time >= 1) finishFallback();
        else if (!completed) frameId = window.requestAnimationFrame(tick);
      };
      frameId = window.requestAnimationFrame(tick);
      const settleId = window.setTimeout(finishFallback, durationMs + 250);
      return () => {
        window.cancelAnimationFrame(frameId);
        window.clearTimeout(settleId);
      };
    }

    const animation = wheel.animate(
      rouletteWheelKeyframes(reducedMotion ? finalRotation : startRotation, finalRotation, profile),
      {
        duration: durationMs,
        easing: 'linear',
        fill: 'forwards',
      },
    );
    wheelAnimationRef.current = animation;
    animation.onfinish = () => {
      wheel.style.transform = `rotate(${finalRotation}deg)`;
      if (wheelAnimationRef.current === animation) wheelAnimationRef.current = null;
      try { animation.cancel(); } catch {}
      notifyWheelFinished();
    };

    return () => {
      animation.onfinish = null;
      if (wheelAnimationRef.current === animation && animation.playState !== 'finished') {
        try { animation.cancel(); } catch {}
        wheelAnimationRef.current = null;
      }
    };
  }, [active, layout, wheelSpinPlan]);

  React.useEffect(() => () => {
    try { wheelAnimationRef.current?.cancel(); } catch {}
    if (spinCompletionBarrierRef.current) spinCompletionBarrierRef.current.completed = true;
    spinCompletionBarrierRef.current = null;
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    timersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    timersRef.current = [];
  }, []);
  // SFX defaults to ON; allow disabling with ?sfx=off
  const sfxOn = React.useMemo(() => {
    try {
      const q = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
      const sfxParam = (q.get('sfx') || '').toLowerCase();
      return sfxParam !== 'off';
    } catch { return true; }
  }, []);

  // 채널 ID 검증 기본값은 ON; ?channelValidation=off로 비활성화 가능
  const channelValidationOn = React.useMemo(() => {
    try {
      const q = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
      const validationParam = (q.get('channelValidation') || '').toLowerCase();
      return validationParam !== 'off';
    } catch { return true; }
  }, []);

  // Simple SFX using fixed server files
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const startAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const endAudioRef = React.useRef<HTMLAudioElement | null>(null);
  React.useEffect(() => {
    // Prefer front-end static assets at /public/files (served at same-origin /files)
    // Fallback to backend API host if same-origin is missing
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://arubot.yuaru.com';
      const backendBase = getRouletteApiBase();
      const a = new Audio(`${origin}/files/roulette_start.weba`);
      // Avoid crossOrigin to reduce CORS influence
      a.preload = 'auto';
      a.addEventListener('canplaythrough', () => { if (!canAutoPlayRef.current) { primeAudio().catch(()=>{}); } }, { once: true });
      a.onerror = () => {
        try {
          // Backend fallback
          a.src = `${backendBase}/files/roulette_start.weba`;
          a.load();
          a.onerror = () => {
            // Last resort: try mp3 with same name if provided later
            a.src = `${origin}/files/roulette_start.mp3`;
            a.load();
          };
        } catch { startAudioRef.current = null; }
      };
      startAudioRef.current = a;
    } catch {}
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://arubot.yuaru.com';
      const backendBase = getRouletteApiBase();
      const b = new Audio(`${origin}/files/roulette_end.mp3`);
      b.preload = 'auto';
      b.addEventListener('canplaythrough', () => { if (!canAutoPlayRef.current) { primeAudio().catch(()=>{}); } }, { once: true });
      b.onerror = () => {
        try {
          b.src = `${backendBase}/files/roulette_end.mp3`;
          b.load();
        } catch { endAudioRef.current = null; }
      };
      endAudioRef.current = b;
    } catch {}
  }, [primeAudio]);

  // Try to prime audio automatically using muted autoplay (Chrome allows muted autoplay)
  React.useEffect(() => {
    const prime = async () => {
      try {
        const a = startAudioRef.current;
        const b = endAudioRef.current;
        if (!a && !b) return;
        // Use whichever is available
        const el = a || b!;
        el.muted = true;
        el.volume = 0;
        // Ensure it can start
        try { await el.play(); } catch {}
        try { el.pause(); } catch {}
        try { el.currentTime = 0; } catch {}
        el.muted = false;
        el.volume = 1;
        canAutoPlayRef.current = true;
      } catch {}
    };
    // Delay slightly to allow resource load
    const id = window.setTimeout(prime, 300);
    return () => { window.clearTimeout(id); };
  }, []);
  const playBeep = React.useCallback((freq: number, durMs = 120, type: OscillatorType = 'sine', gain = 0.02) => {
    if (!sfxOn) return;
    try {
      const AudioContextCtor = window.AudioContext || (window as WindowWithLegacyAudioContext).webkitAudioContext;
      if (!audioCtxRef.current && AudioContextCtor) audioCtxRef.current = new AudioContextCtor();
      if (!audioCtxRef.current) return;
      const ctx = audioCtxRef.current!;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.value = gain;
      osc.connect(g).connect(ctx.destination);
      const now = ctx.currentTime;
      osc.start(now);
      osc.stop(now + durMs / 1000);
    } catch {}
  }, [sfxOn]);
  const playStartSfx = React.useCallback(() => {
    if (!sfxOn || !(userInteractedRef.current || canAutoPlayRef.current)) return;
    if (startAudioRef.current) {
      try {
        startAudioRef.current.currentTime = 0;
        void startAudioRef.current.play().catch(() => playBeep(880, 120, 'square', 0.015));
        return;
      } catch {}
    }
    playBeep(880, 120, 'square', 0.015);
  }, [sfxOn, playBeep]);
  const playEndSfx = React.useCallback(() => {
    if (!sfxOn || !(userInteractedRef.current || canAutoPlayRef.current)) return;
    if (endAudioRef.current) {
      try {
        endAudioRef.current.currentTime = 0;
        void endAudioRef.current.play().catch(() => {
          playBeep(440, 120, 'triangle', 0.02);
          window.setTimeout(() => playBeep(660, 120, 'triangle', 0.02), 130);
        });
        return;
      } catch {}
    }
    playBeep(440, 120, 'triangle', 0.02); setTimeout(()=>playBeep(660, 120, 'triangle', 0.02), 130);
  }, [sfxOn, playBeep]);

  // WebSocket 연결 및 재연결 로직 (서버에서 채널 검증 수행)
  const connectWebSocket = React.useCallback(() => {
    if (previewMode) {
      updateDebugInfo({
        tokenValid: true,
        connectionState: 'connected',
        lastError: null
      });
      return;
    }

    if (!token) {
      const errorMsg = 'invalid token';
      setError(errorMsg);
      updateDebugInfo({ 
        tokenValid: false, 
        connectionState: 'error', 
        lastError: errorMsg 
      });
      return;
    }

    // 토큰 기본 검증만 수행 (채널 검증은 서버에서)
    const isTokenValid = validateToken(token);
    updateDebugInfo({ tokenValid: isTokenValid });
    
    if (!isTokenValid) {
      const errorMsg = 'token validation failed';
      setError(errorMsg);
      updateDebugInfo({ 
        connectionState: 'error', 
        lastError: errorMsg 
      });
      return;
    }

    try {
      const disconnect = connectOverlaySocket({
        url: () => getRouletteWsUrl(token, testConnectionId),
        onConnecting: () => {
          updateDebugInfo({ connectionState: 'connecting', lastConnectionTime: Date.now() });
          updateDebugInfo((prev) => ({ connectionAttempts: prev.connectionAttempts + 1 }));
        },
        onOpen: (ws) => {
        wsRef.current = ws;
        setError(null);
        reconnectAttemptsRef.current = 0;
        connectionEstablishedAtRef.current = Date.now();
        firstValidMessageReceivedRef.current = false;
        
        // 채널 ID 검증 상태 초기화
        expectedChannelIdRef.current = null;
        channelIdValidationEnabledRef.current = channelValidationOn;
        
        updateDebugInfo({ 
          connectionState: 'connected',
          lastError: null,
          reconnectAttempts: 0,
          channelId: null // 연결 시 채널 ID 초기화
        });
        if (!testConnectionId) postEmbeddedMessage({ type: 'arubot:roulette-ready' });
      },

      onMessage: async (ev) => {
        try {
          updateDebugInfo((prev) => ({ 
            lastMessageTime: Date.now(),
            messageCount: prev.messageCount + 1
          }));

          const data = JSON.parse(ev.data) as WsPayload | RouletteTestReadyPayload;
          if (data?.type === 'roulette:test-ready') {
            if (testConnectionId && data.testConnectionId === testConnectionId && data.token === token) {
              postEmbeddedMessage({ type: 'arubot:roulette-ready' });
            }
            return;
          }
          if (data && data.type === 'roulette') {
            // 채널 ID 검증 로직 추가
            if (channelIdValidationEnabledRef.current) {
              const messageChannelId = data.channelId;
              
              // 첫 번째 메시지에서 예상 채널 ID 설정
              if (!expectedChannelIdRef.current && messageChannelId) {
                expectedChannelIdRef.current = messageChannelId;
                updateDebugInfo({ 
                  channelId: messageChannelId
                });
              }
              
              // 메시지 채널 ID 검증
              const isChannelValid = validateMessageChannelId(data, expectedChannelIdRef.current);
              if (!isChannelValid) {
                console.warn('[RouletteViewer] 잘못된 채널 ID의 메시지 무시:', {
                  expected: expectedChannelIdRef.current,
                  received: messageChannelId,
                  messageData: data
                });
                return; // 잘못된 채널 ID 메시지 무시
              }
            }
            
            // 채널 ID 정보 업데이트 (서버에서 전송된 경우)
            if (data.channelId) {
              updateDebugInfo({ 
                channelId: data.channelId
              });
            }

            // The server sends the last persisted result as connection context.
            // It is history, not a new spin request, so the overlay must remain idle.
            if (data.initialSnapshot === true) {
              updateDebugInfo((prev) => ({ initialMessagesSkipped: prev.initialMessagesSkipped + 1 }));
              return;
            }
            
            // 개선된 초기 메시지 처리 로직
            const now = Date.now();
            const timeSinceConnection = now - connectionEstablishedAtRef.current;
            const isWithinGracePeriod = timeSinceConnection < INITIAL_MESSAGE_GRACE_PERIOD;
            
            // 초기 메시지 판단 기준:
            // 1. 연결 후 grace period 내의 메시지
            // 2. 명시적인 사용자 액션 없이 받은 메시지 (createdAt이 연결 시점 이전)
            // 3. 빈 데이터나 기본값만 있는 메시지
            const isLikelyInitialMessage = isWithinGracePeriod && (
              !data.label && 
              !data.value && 
              (!data.createdAt || Number(data.createdAt) < connectionEstablishedAtRef.current)
            );
            
            if (isLikelyInitialMessage && !firstValidMessageReceivedRef.current) {
              updateDebugInfo((prev) => ({ initialMessagesSkipped: prev.initialMessagesSkipped + 1 }));
              return;
            }
            
            // 유효한 룰렛 메시지로 판단
            if (!firstValidMessageReceivedRef.current) {
              firstValidMessageReceivedRef.current = true;
            }
            
            updateDebugInfo((prev) => ({ validMessagesReceived: prev.validMessagesReceived + 1 }));
            
            // If autoplay not yet enabled, try one more prime attempt just-in-time
            if (!canAutoPlayRef.current && sfxOn) {
              try { await primeAudio(); } catch {}
            }
            
            // Build a key to detect duplicate payloads
            const key = data.spinId ? `${data.token || ''}|${data.spinId}` : `${data.token || ''}|${data.label || ''}|${data.value ?? ''}|${data.createdAt || ''}`;
            
            // The visual cooldown must not discard a newly chained server spin.
            const isInstantPayload = data.instant === true;
            const hasBatch = !!data.batchId;
            const isCoolingDown = now < spinCooldownUntilRef.current && !isInstantPayload && !hasBatch;
            
            // Ignore if identical to last and very recent (handles multi-instance duplicate broadcasts)
            // Do not dedupe batched payloads
            if (!hasBatch && lastSpinKeyRef.current === key && (now - lastSpinAtRef.current) < 5000) {
              return;
            }
            
            // 메시지 우선순위 계산 (높을수록 우선)
            const getMessagePriority = (payload: WsPayload): number => {
              let priority = 0;
              
              // 즉시 실행 메시지는 높은 우선순위
              if (payload.instant === true) priority += 100;
              
              // 배치 메시지는 중간 우선순위
              if (payload.batchId) priority += 50;
              
              // 최근 메시지일수록 높은 우선순위
              const createdAt = Number(payload.createdAt) || now;
              const recency = Math.max(0, 10000 - (now - createdAt)) / 1000; // 0-10점
              priority += recency;
              
              // 완전한 데이터를 가진 메시지는 높은 우선순위
              if (payload.label || payload.value) priority += 10;
              
              return priority;
            };
            
            // If a spin is already in progress, buffer this event for later processing
            if (isSpinningRef.current || isCoolingDown) {
              if (data.spinId && queuedEventsRef.current.some(event => event.spinId === data.spinId)) return;
              // 우선순위에 따라 큐에 삽입
              const priority = getMessagePriority(data);
              const insertIndex = queuedEventsRef.current.findIndex(
                queuedEvent => getMessagePriority(queuedEvent) < priority
              );
              
              if (insertIndex === -1) {
                queuedEventsRef.current.push(data);
              } else {
                queuedEventsRef.current.splice(insertIndex, 0, data);
              }
              
              updateDebugInfo({ 
                queuedMessagesCount: queuedEventsRef.current.length
              });
              if (!isSpinningRef.current && isCoolingDown) {
                const wakeId = window.setTimeout(() => processQueuedRef.current(), Math.max(1, spinCooldownUntilRef.current - now + 1));
                timersRef.current.push(wakeId);
              }
              return;
            }
            
            const applyEvent = (payload: WsPayload) => {
              const isInstant = payload.instant === true;
              const final = String(payload.label || (payload.value != null ? String(payload.value) : ''));
              isSpinningRef.current = true;
              lastSpinKeyRef.current = key;
              lastSpinAtRef.current = now;
              
              // Update batch progress markers
              if (payload.batchId && payload.batchCount && Number(payload.batchCount) > 0) {
                if (currentBatchIdRef.current !== String(payload.batchId)) {
                  currentBatchIdRef.current = String(payload.batchId);
                  currentBatchTotalRef.current = Math.max(1, Number(payload.batchCount));
                  currentBatchDoneRef.current = 1;
                } else {
                  currentBatchDoneRef.current = Math.min(currentBatchTotalRef.current, currentBatchDoneRef.current + 1);
                }
                setBatchProgress({ id: currentBatchIdRef.current, done: currentBatchDoneRef.current, total: currentBatchTotalRef.current });
                if (currentBatchDoneRef.current >= currentBatchTotalRef.current) {
                  window.setTimeout(() => {
                    currentBatchIdRef.current = null;
                    currentBatchTotalRef.current = 0;
                    currentBatchDoneRef.current = 0;
                    setBatchProgress({ id: null, done: 0, total: 0 });
                  }, 300);
                }
              } else {
                currentBatchIdRef.current = null;
                currentBatchTotalRef.current = 0;
                currentBatchDoneRef.current = 0;
                setBatchProgress({ id: null, done: 0, total: 0 });
              }
              
              if (isInstant) {
                // Defer state/theme updates to inside showInstantResult, after fade-out completes
                showInstantResult(final, payload);
              } else {
                // Animated spin: set state immediately and run full spin
                setState({ name: payload.name || undefined, username: payload.username || undefined, label: payload.label || undefined, value: (payload.value != null ? payload.value : undefined) });
                applyServerLook(payload.theme);
                startSpinAnimation(final, Array.isArray(payload.items) ? payload.items : null, payload);
              }
            };
            applyEvent(data);
          }
        } catch (parseError) {
          console.error('[RouletteViewer] 메시지 파싱 오류:', parseError, '원본 데이터:', ev.data);
        }
      },

      onError: (event) => {
        const errorMsg = 'WebSocket 연결 오류';
        console.error('[RouletteViewer]', errorMsg, event);
        setError('connection error');
        updateDebugInfo({ 
          connectionState: 'error',
          lastError: errorMsg
        });
      },

      onClose: (event) => {
        wsRef.current = null;
        const closeMsg = `WebSocket 연결 종료: code=${event.code}, reason=${event.reason}, wasClean=${event.wasClean}`;
        const intentionalTestClose = Boolean(
          testConnectionId && event.code === 1000 && event.reason === 'Test event delivered',
        );
        if (!intentionalTestClose) console.warn('[RouletteViewer]', closeMsg);

        if (intentionalTestClose) {
          updateDebugInfo({
            connectionState: 'disconnected',
            lastError: null,
          });
          return;
        }
        
        // 서버 검증 실패 감지 (채널 접근 거부 등)
        if (event.code === 1008 || event.code === 1009 || event.code === 1012) {
          const reason = String(event.reason || '').trim();
          const serverErrorMsg = reason || (
            event.code === 1008 ? '토큰이 유효하지 않습니다' :
            event.code === 1009 ? '메시지 크기가 한도를 초과했습니다' :
            event.code === 1012 ? '서버가 재시작 중입니다' :
            '서버 검증 실패'
          );
          setError(serverErrorMsg);
          updateDebugInfo({ 
            connectionState: 'error',
            lastError: serverErrorMsg
          });
          return;
        }
        
        // 채널 ID 검증 상태 정리
        expectedChannelIdRef.current = null;
        channelIdValidationEnabledRef.current = channelValidationOn;
        
        updateDebugInfo({ 
          connectionState: 'disconnected',
          lastError: closeMsg,
          channelId: null // 연결 종료 시 채널 ID 정리
        });

      },
      shouldReconnect: (event) => !(testConnectionId && event.code === 1000 && event.reason === 'Test event delivered'),
      onRetry: () => {
        reconnectAttemptsRef.current += 1;
        updateDebugInfo({ reconnectAttempts: reconnectAttemptsRef.current });
      },
      });

      return () => {
        disconnect();
        wsRef.current = null;
      };
    } catch (connectionError) {
      const errorMsg = `WebSocket 연결 실패: ${connectionError}`;
      console.error('[RouletteViewer]', errorMsg);
      setError('failed to connect');
      updateDebugInfo({ 
        connectionState: 'error',
        lastError: errorMsg
      });
    }
  // Keep this callback stable enough to avoid reconnect churn during roulette animation state updates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewMode, token, testConnectionId, validateToken, validateMessageChannelId, updateDebugInfo, sfxOn, channelValidationOn, primeAudio, applyServerLook, postEmbeddedMessage]);

  React.useEffect(() => {
    const cleanup = connectWebSocket();
    return cleanup;
  }, [connectWebSocket]);

  const showInstantResult = React.useCallback((finalLabel: string, meta?: WsPayload) => {
    // Cancel outstanding timers
    timersRef.current.forEach(id => window.clearTimeout(id));
    timersRef.current = [];
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    wheelSpinPlanIdRef.current += 1;
    if (spinCompletionBarrierRef.current) spinCompletionBarrierRef.current.completed = true;
    spinCompletionBarrierRef.current = null;
    try { wheelAnimationRef.current?.cancel(); } catch {}
    wheelAnimationRef.current = null;
    setWheelSpinPlan(null);
    // Fade out whole content layer first
    setActive(false);
    const OUT_MS = FADE_MS;
    const IN_SETTLE_MS = 1000;
    const FINAL_CHECK_MS = FADE_MS;
    const prepId = window.setTimeout(() => {
      // Prepare next label and fade in whole content layer with new result
      // Apply theme and state here so the old item stays visible during fade-out
      try {
        if (meta && meta.theme) applyServerLook(meta.theme);
        if (meta) {
          setState({
            name: meta.name || undefined,
            username: meta.username || undefined,
            label: meta.label || undefined,
            value: (meta.value != null ? meta.value : undefined)
          });
        }
      } catch {}
      setScrollItems([finalLabel]);
      setScrollIndex(0);
      const instantEntries = buildRouletteWheelEntries(meta?.items || poolRef.current, finalLabel, meta?.itemWeights, meta?.selectedItemIndex);
      const instantWheelIndex = instantEntries.selectedIndex;
      const instantWheelItems = instantEntries.items;
      const spinRandom = createRouletteSpinRandom(resolveRouletteSpinSeed(meta, finalLabel));
      const instantWheelRotation = wheelStopRotationForIndex(
        instantWheelIndex,
        instantWheelItems.length,
        randomWheelStopOffsetRatio(spinRandom),
        instantEntries.weights,
      );
      setWheelItemsState(instantWheelItems);
      setWheelWeights(instantEntries.weights);
      setWheelSelectedIndex(instantWheelIndex);
      wheelRotationRef.current = instantWheelRotation;
      setWheelRotationDeg(instantWheelRotation);
      setWheelSettled(true);
      playEndSfx();
      setActive(true);
      announceRouletteSettled({
        spinId: meta?.spinId || null,
        label: finalLabel,
        value: meta?.value ?? null,
        selectedIndex: instantWheelIndex,
        itemCount: instantWheelItems.length,
      });
      const doneId = window.setTimeout(() => {
        // Allow next queued item to display
        isSpinningRef.current = false;
        // Keep cooldown in sync with fade pacing
        spinCooldownUntilRef.current = Date.now() + FADE_MS;
        processQueuedRef.current();
        // If last item (no more queued) and batch finished, fade out once at the end
        window.setTimeout(() => {
          const noMoreQueued = queuedEventsRef.current.length === 0;
          const batchDone = !currentBatchIdRef.current || (currentBatchDoneRef.current >= currentBatchTotalRef.current && currentBatchTotalRef.current > 0);
          if (noMoreQueued && batchDone) {
            setActive(false);
          }
        }, FINAL_CHECK_MS);
      }, IN_SETTLE_MS);
      timersRef.current.push(doneId);
    }, OUT_MS);
    timersRef.current.push(prepId);
  }, [playEndSfx, applyServerLook, announceRouletteSettled]);

  const startSpinAnimation = React.useCallback((finalLabel: string, itemsFromServer: string[] | null, meta?: WsPayload) => {
    // clear previous timers
    timersRef.current.forEach(id => window.clearTimeout(id));
    timersRef.current = [];
    wheelSpinPlanIdRef.current += 1;
    if (spinCompletionBarrierRef.current) spinCompletionBarrierRef.current.completed = true;
    spinCompletionBarrierRef.current = null;
    try { wheelAnimationRef.current?.cancel(); } catch {}
    wheelAnimationRef.current = null;
    // keep reel view; no separate final stage view
    // Build reel with random items and inject final at stop time to avoid blanks
    const baseItems = Array.isArray(itemsFromServer) && itemsFromServer.length > 0
      ? itemsFromServer.slice()
      : [finalLabel];
    const cleaned = baseItems.map(s => String(s)).filter(s => s.length > 0);
    const pool = cleaned.length ? cleaned : [finalLabel].filter(Boolean);
    const motionTheme = urlLook.theme || parseRouletteLook(meta?.theme).theme || theme;
    const motionProfile = getRouletteMotionProfile(motionTheme);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    poolRef.current = pool.slice();
    const spinRandom = createRouletteSpinRandom(resolveRouletteSpinSeed(meta, finalLabel));
    const entries = buildRouletteWheelEntries(baseItems, finalLabel, meta?.itemWeights, meta?.selectedItemIndex);
    const wheelTargetIndex = entries.selectedIndex;
    const nextWheelItems = entries.items;
    setWheelItemsState(nextWheelItems);
    setWheelWeights(entries.weights);
    setWheelSettled(false);
    const wheelStartRotation = spinRandom() * 360;
    const wheelStopOffsetRatio = randomWheelStopOffsetRatio(spinRandom);
    const wheelFinalRotation = equivalentForwardRotation(
      wheelStartRotation,
      wheelStopRotationForIndex(wheelTargetIndex, nextWheelItems.length, wheelStopOffsetRatio, entries.weights),
      motionProfile.turns + Math.floor(spinRandom() * 3)
    );
    const wheelResolvedIndex = wheelIndexAtPointer(wheelFinalRotation, nextWheelItems.length, entries.weights);
    const wheelResolvedLabel = nextWheelItems[wheelResolvedIndex] || finalLabel;
    setWheelSelectedIndex(wheelResolvedIndex);
    const spinDurationMs = normalizeRouletteSpinDuration(meta?.spinDurationMs);
    const wheelSpinPlanId = wheelSpinPlanIdRef.current;
    const messageLayout = parseRouletteLook(meta?.theme).layout;
    const waitForPhysicalWheel = (urlLook.layout || messageLayout || layout) === 'wheel';
    const finishSpin = () => {
      const barrier = spinCompletionBarrierRef.current;
      if (!barrier || barrier.id !== wheelSpinPlanId) return;
      spinCompletionBarrierRef.current = null;
      wheelRotationRef.current = wheelFinalRotation;
      setWheelRotationDeg(wheelFinalRotation);
      setWheelSettled(true);
      setWheelSpinPlan(null);
      presentationRef.current?.setAttribute('data-spin-phase', 'settled');
      presentationRef.current?.style.setProperty('--roulette-pointer-deflect', '0deg');
      presentationRef.current?.style.setProperty('--roulette-spin-speed', '0');
      announceRouletteSettled({
        spinId: meta?.spinId || null,
        label: wheelResolvedLabel,
        value: meta?.value ?? null,
        selectedIndex: wheelResolvedIndex,
        itemCount: nextWheelItems.length,
      });
      playEndSfx();
      if (embeddedTestMode) {
        isSpinningRef.current = false;
        spinCooldownUntilRef.current = Date.now() + 600;
        if (meta?.testMode === true) {
          queuedEventsRef.current.length = 0;
          updateDebugInfo({ queuedMessagesCount: 0 });
          return;
        }
        const hasQueued = queuedEventsRef.current.length > 0;
        setActive(false);
        if (hasQueued) {
          const nextId = window.setTimeout(() => { processQueuedRef.current(); }, FADE_MS);
          timersRef.current.push(nextId);
        }
        return;
      }
      const hideId = window.setTimeout(() => {
        const hasQueued = queuedEventsRef.current.length > 0;
        isSpinningRef.current = false;
        spinCooldownUntilRef.current = Date.now() + 600;
        if (hasQueued) {
          setActive(false);
          window.setTimeout(() => { processQueuedRef.current(); }, FADE_MS);
        } else {
          setActive(false);
        }
      }, 1000);
      timersRef.current.push(hideId);
    };
    spinCompletionBarrierRef.current = {
      id: wheelSpinPlanId,
      reelDone: false,
      wheelDone: !waitForPhysicalWheel,
      completed: false,
      finish: finishSpin,
    };
    wheelRotationRef.current = wheelStartRotation;
    setWheelRotationDeg(wheelStartRotation);
    setWheelSpinPlan({
      id: wheelSpinPlanId,
      startRotation: wheelStartRotation,
      finalRotation: wheelFinalRotation,
      durationMs: spinDurationMs,
      motionTheme,
      reducedMotion,
    });
    const rand = () => pool[Math.floor(spinRandom() * pool.length)];
    const seq: string[] = [];
    // Initial head padding based on viewport
    const rowsHalf = computeRowsHalf();
    rowsHalfSpinRef.current = rowsHalf; // lock for this spin
    const initHead = Math.max(rowsHalf + 3, 12);
    for (let k = 0; k < initHead; k++) seq.push(rand());
    setScrollItems(seq);
    scrollItemsRef.current = seq;
    // Start with center index at rowsHalf (so there are enough items above)
    setScrollIndex(rowsHalf);
    setOffsetRows(rowsHalf);
    setActive(true);
    playStartSfx();

    // Reel and wheel share the same material-specific acceleration curve.
    // Ensure we have a stable row height for this run
    const measuredH = rowRef.current?.getBoundingClientRect().height || 0;
    const rowHpx = (rowH && rowH > 0) ? rowH : (measuredH > 0 ? Math.round(measuredH) : 64);
    if (rowHpx !== rowH && rowHpx > 0) setRowH(rowHpx);
    const startIdx = rowsHalf; // starting center index (rows)
    // Pick a pleasant number of rows to travel; ensure enough randomness shown
    const travelRows = Math.max(40, Math.min(120, pool.length * 8));
    const targetIdx = startIdx + travelRows; // virtual absolute target index
    finalIndexRef.current = targetIdx;
    finalLabelRef.current = wheelResolvedLabel;
    startCenterRef.current = startIdx;
    targetIndexRef.current = targetIdx;
    animStartRef.current = performance.now();
    const T = spinDurationMs;
    let previousRotation = wheelStartRotation;
    let previousTime = 0;
    let lastContact = -1000;
    let contactStrength = 0;
    let phase = '';

    if (rafIdRef.current) { cancelAnimationFrame(rafIdRef.current); }
    const run = (now: number) => {
      const t = now - animStartRef.current;
      const clamped = Math.min(T, Math.max(0, t));
      const progress = rouletteMotionProgress(clamped / T, motionProfile);
      const currentCenter = reducedMotion ? targetIdx : startIdx + travelRows * progress;
      setOffsetRows(currentCenter);
      setScrollIndex(Math.floor(currentCenter));
      const surface = presentationRef.current;
      if (surface) {
        const nextPhase = rouletteMotionPhase(clamped / T, motionProfile);
        if (nextPhase !== phase) { surface.dataset.spinPhase = nextPhase; phase = nextPhase; }
        const rotation = wheelStartRotation + (wheelFinalRotation - wheelStartRotation) * progress;
        const speed = Math.abs(rotation - previousRotation) / Math.max(1, clamped - previousTime);
        if (wheelIndexAtPointer(rotation, nextWheelItems.length, entries.weights) !== wheelIndexAtPointer(previousRotation, nextWheelItems.length, entries.weights)) {
          lastContact = clamped;
          contactStrength = Math.min(1, speed / .3);
        }
        const elapsed = clamped - lastContact;
        const deflect = reducedMotion ? 0 : -motionProfile.pointer * contactStrength * Math.exp(-elapsed / 48) * Math.sin(elapsed / 18);
        surface.style.setProperty('--roulette-pointer-deflect', `${deflect.toFixed(3)}deg`);
        surface.style.setProperty('--roulette-spin-speed', reducedMotion ? '0' : Math.min(1, speed / 1.6).toFixed(3));
        previousRotation = rotation;
        previousTime = clamped;
      }
      if (t < T) {
        rafIdRef.current = requestAnimationFrame(run);
      } else {
        // Keep the actual winning row fixed; only the track recoils on contact.
        setOffsetRows(targetIdx);
        setScrollIndex(targetIdx);
        const track = surface?.querySelector('.roulette-reel-track');
        if (!reducedMotion && motionProfile.recoil && track && typeof track.animate === 'function') {
          track.animate([
            { translate: '0 0' }, { translate: `0 ${motionProfile.recoil}px` },
            { translate: `0 ${-motionProfile.recoil / 3}px` }, { translate: '0 0' },
          ], { duration: 280, easing: 'ease-out' });
        }
        const barrier = spinCompletionBarrierRef.current;
        if (barrier?.id === wheelSpinPlanId) {
          barrier.reelDone = true;
          tryFinishSpinBarrier(barrier);
        }
      }
    };
    rafIdRef.current = requestAnimationFrame(run);
  }, [playStartSfx, playEndSfx, rowH, computeRowsHalf, announceRouletteSettled, embeddedTestMode, updateDebugInfo, layout, urlLook.layout, urlLook.theme, theme]);

  // Process any queued roulette events after current spin completes
  processQueuedRef.current = () => {
    if (isSpinningRef.current) return;
    const next = queuedEventsRef.current.shift();
    if (!next) return;
    // Reserve the slot before the short transition delay; several wakeups may coincide.
    isSpinningRef.current = true;
    
    // 큐 상태 업데이트
    updateDebugInfo({ 
      queuedMessagesCount: queuedEventsRef.current.length
    });
    // Apply next immediately; if instant, reveal instantly; else run full spin
    setTimeout(() => {
      // mimic onmessage path
      const payload: WsPayload = next;
      const key = payload.spinId ? `${payload.token || ''}|${payload.spinId}` : `${payload.token || ''}|${payload.label || ''}|${payload.value ?? ''}|${payload.createdAt || ''}`;
      const now = Date.now();
      const isBatch = !!payload.batchId;
      if (!isBatch && lastSpinKeyRef.current === key && (now - lastSpinAtRef.current) < 5000) {
        isSpinningRef.current = false;
        processQueuedRef.current();
        return;
      }
      applyServerLook(payload.theme);
      setState({ name: payload.name || undefined, username: payload.username || undefined, label: payload.label || undefined, value: (payload.value != null ? payload.value : undefined) });
      const final = String(payload.label || (payload.value != null ? String(payload.value) : ''));
      isSpinningRef.current = true;
      lastSpinKeyRef.current = key;
      lastSpinAtRef.current = now;
      // Update batch progress for queued payload
      if (payload.batchId && payload.batchCount && Number(payload.batchCount) > 0) {
        if (currentBatchIdRef.current !== String(payload.batchId)) {
          currentBatchIdRef.current = String(payload.batchId);
          currentBatchTotalRef.current = Math.max(1, Number(payload.batchCount));
          currentBatchDoneRef.current = 1;
        } else {
          currentBatchDoneRef.current = Math.min(currentBatchTotalRef.current, currentBatchDoneRef.current + 1);
        }
        setBatchProgress({ id: currentBatchIdRef.current, done: currentBatchDoneRef.current, total: currentBatchTotalRef.current });
        // When finished, reset trackers after a short delay
        if (currentBatchDoneRef.current >= currentBatchTotalRef.current) {
          window.setTimeout(() => {
            currentBatchIdRef.current = null;
            currentBatchTotalRef.current = 0;
            currentBatchDoneRef.current = 0;
            setBatchProgress({ id: null, done: 0, total: 0 });
          }, 300);
        }
      } else {
        currentBatchIdRef.current = null;
        currentBatchTotalRef.current = 0;
        currentBatchDoneRef.current = 0;
        setBatchProgress({ id: null, done: 0, total: 0 });
      }
      if (payload.instant === true) {
        showInstantResult(final, payload);
      } else {
        startSpinAnimation(final, Array.isArray(payload.items) ? payload.items : null, payload);
      }
    }, 50);
  };


  const themeMaterial = getRouletteThemeMaterial(theme);
  const wheelItems = React.useMemo(
    () => wheelItemsState.map((item) => String(item || '').trim()).filter(Boolean),
    [wheelItemsState]
  );
  const wheelLabelLines = React.useMemo(() => wheelItems.map(splitWheelLabel), [wheelItems]);
  const wheelSkinFamily = themeMaterial.family;
  const wheelCount = Math.max(1, wheelItems.length);
  const progressPercent = batchProgress.id
    ? Math.max(0, Math.min(100, (batchProgress.done / Math.max(1, batchProgress.total)) * 100))
    : 0;

  const renderHeading = () => (
    <header className="roulette-heading">
      <h1><RouletteFitText max={30} min={10}>{state.name || '룰렛'}</RouletteFitText></h1>
      {state.username ? <p><RouletteFitText max={16} min={9}>{state.username + '님'}</RouletteFitText></p> : null}
    </header>
  );

  const renderResult = (reel = false) => (
    <footer
      className={`roulette-result ${wheelSettled ? 'roulette-result-lock' : ''}`}
      data-settled={wheelSettled ? 'true' : 'false'}
      role="status"
      aria-live={active ? 'polite' : 'off'}
    >
      <span className="roulette-result-caption">{wheelSettled ? '당첨' : '추첨 중'}</span>
      {(!reel || wheelSettled) ? (
        <div className="roulette-result-name">
          <RouletteFitText max={reel ? 26 : 38} min={8}>
            {wheelSettled ? (state.label || String(state.value ?? '')) : '행운의 순간을 기다려 주세요'}
          </RouletteFitText>
        </div>
      ) : <span className="roulette-reel-running" aria-hidden="true"><i /><i /><i /></span>}
      {batchProgress.id ? (
        <div className="roulette-batch" aria-label={`진행 ${batchProgress.done} / ${batchProgress.total}`}>
          <span>{batchProgress.done} / {batchProgress.total}</span>
          <div><i style={{ width: `${progressPercent}%` }} /></div>
        </div>
      ) : null}
    </footer>
  );

  const renderReelWindow = () => (
    <section
      aria-label="룰렛 릴 오버레이"
      className="roulette-stage roulette-reel-stage"
      data-active={active}
      data-settled={wheelSettled}
      style={{ transitionDuration: FADE_MS + 'ms' }}
    >
      <RouletteThemeAtmosphere kind={themeMaterial.atmosphere} active={active} compact />
      <div className="roulette-reel-frame" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="roulette-reel-body">
        {renderHeading()}
        <div className="roulette-reel-machine">
          <span className="roulette-reel-index roulette-reel-index-left" aria-hidden="true" />
          <span className="roulette-reel-index roulette-reel-index-right" aria-hidden="true" />
          <div className="roulette-reel-track" aria-hidden="true" />
          <div ref={reelRef} className="roulette-reel-window" aria-hidden="true">
            <div ref={rowRef} className="roulette-reel-measure">8</div>
            {(() => {
              const measured = rowRef.current?.getBoundingClientRect().height || 0;
              const rh = rowH > 0 ? rowH : (measured > 0 ? Math.round(measured) : 0);
              const reelH = reelRef.current?.getBoundingClientRect().height || 0;
              if (!rh || !reelH) return null;
              const center = offsetRows;
              const rowsVisible = Math.max(3, Math.ceil(reelH / rh) + 1);
              const buffer = 6;
              const windowRows = rowsVisible + buffer * 2 + 2;
              const firstIndex = Math.floor(center) - Math.ceil(rowsVisible / 2) - buffer;
              const transformPx = Math.round((reelH / 2) - ((center - firstIndex + 0.5) * rh));
              return (
                <div className="roulette-reel-rows" style={{ transform: `translateY(${transformPx}px)` }}>
                  {Array.from({ length: windowRows }).map((_, itemIndex) => {
                    const index = firstIndex + itemIndex;
                    const label = labelFor(index);
                    const isCenter = index === Math.round(center);
                    return (
                      <div key={index} className="roulette-reel-row" data-center={isCenter} style={{ height: rh }}>
                        <RouletteFitText max={52} min={8}>{label}</RouletteFitText>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      </div>
      {renderResult(true)}
    </section>
  );

  const renderWheel = () => (
    <section
      aria-label="룰렛 휠 오버레이"
      className="roulette-stage roulette-wheel-stage"
      data-active={active}
      data-settled={wheelSettled}
      style={{ transitionDuration: FADE_MS + 'ms' }}
    >
      {renderHeading()}
      <div className="roulette-wheel-chassis">
        <RouletteThemeAtmosphere kind={themeMaterial.atmosphere} active={active} />
        <div className="roulette-wheel-rim"><div /></div>
        <WheelSkinOrnaments family={wheelSkinFamily} themeId={theme} />
        <div
          ref={wheelDiscRef}
          data-testid="roulette-wheel-disc"
          data-selected-index={wheelSelectedIndex}
          data-settled={wheelSettled ? 'true' : 'false'}
          className="roulette-wheel-disc"
          style={{ transform: `rotate(${wheelRotationDeg}deg)` }}
        >
          <WheelSegmentsSvg family={wheelSkinFamily} palette={themeMaterial.palette} segmentCount={wheelCount} themeId={theme} weights={wheelWeights} />
          <WheelSelectedSegment selectedIndex={wheelSettled ? wheelSelectedIndex : -1} segmentCount={wheelCount} family={wheelSkinFamily} themeId={theme} weights={wheelWeights} />
          <WheelLabelsSvg labelLines={wheelLabelLines} selectedIndex={wheelSettled ? wheelSelectedIndex : -1} palette={themeMaterial.palette} themeId={theme} weights={wheelWeights} />
        </div>
        <WheelGlassOverlay themeId={theme} />
        <WheelPointer themeId={theme} />
        <div className="roulette-wheel-hub">
          <span className="roulette-hub-mark" aria-hidden="true" />
          <span>{wheelSettled ? '당첨' : '회전 중'}</span>
        </div>
      </div>
      {renderResult()}
    </section>
  );

  return (
    <div
      ref={presentationRef}
      className="roulette-presentation"
      data-roulette-theme={theme}
      data-roulette-material={themeMaterial.material}
      data-roulette-layout={layout}
      style={themeMaterial.css}
    >
      {error ? <div role="alert" className="roulette-connection-error">{error}</div> : null}
      <div className="roulette-viewport" aria-hidden={!active}>
        {layout === 'wheel' ? renderWheel() : renderReelWindow()}
      </div>
    </div>
  );
}

