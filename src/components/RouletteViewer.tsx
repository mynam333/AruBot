import React from 'react';

// Module-scope overlay kind and component to avoid remounts on parent re-renders
type OverlayKind = 'none' | 'sakura' | 'midnight' | 'sunset' | 'grid' | 'noise' | 'embers' | 'snow' | 'scan' | 'shimmer' | 'confetti' | 'leaves' | 'gold-sweep';

const OverlaySvg: React.FC<{ kind: OverlayKind }> = React.memo(({ kind }) => {
  const makeSeed = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24); }
    return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return Math.abs(h) / 0xffffffff; };
  };
  const rnd = React.useMemo(() => makeSeed(String(kind)), [kind]);
  const snowFlakes = React.useMemo(() => (
    kind === 'snow' ? Array.from({ length: 32 }).map((_, i) => {
      const s = +(0.7 + (i % 3) * 0.12).toFixed(2); // 크기 스케일
      const rot = Math.floor(rnd() * 360);
      const cx = (i * 5) % 100;
      const cy = -Math.floor(rnd() * 50);
      const dx = ((i % 4) - 2);
      const dur = 6 + (i % 5);
      const delay = -+(rnd() * dur).toFixed(2); // 중간부터 시작하도록 음수 지연
      const yStart = -20 - ((i % 6) * 8); // -20% .. -68%
      return { id: `f${i}`, cx, cy, s, rot, dx, dur, delay, yStart } as const;
    }) : []
  ), [kind, rnd]);
  const confettiPieces = React.useMemo(() => (
    kind === 'confetti' ? Array.from({ length: 24 }).map((_, i) => {
      const w = 1.2 + (i % 3) * 0.3, h = 3 + (i % 2) * 0.5;
      const x = (i * 4.5) % 100;
      const y = -Math.floor(rnd() * 60);
      const dx = ((i % 7) - 3);
      const rot = (i % 8) * 22.5;
      const dur = 5 + (i % 4);
      const delay = -+(rnd() * dur).toFixed(2);
      const palette = ['#fda4af', '#a7f3d0', '#fde68a', '#93c5fd', '#c4b5fd'];
      const fill = palette[i % palette.length];
      const yStart = -20 - ((i % 5) * 10); // -20% .. -60%
      return { id: `c${i}`, w, h, x, y, dx, rot, dur, delay, fill, yStart } as const;
    }) : []
  ), [kind, rnd]);
  const embers = React.useMemo(() => (
    kind === 'embers' ? Array.from({ length: 28 }).map((_, i) => {
      const cx = Math.floor(rnd() * 100);           // 0..100% 가로 시작
      const cy = 105 + Math.floor(rnd() * 25);      // 105..130 아래 시작
      const s  = +(0.7 + rnd() * 0.7).toFixed(2);   // 스케일 0.7..1.4
      const rot = Math.floor(rnd() * 360);          // 무작위 회전
      const dx = +( (rnd() * 10 - 5).toFixed(2) );  // -5%..+5% 가로 드리프트
      const dur = 6 + Math.floor(rnd() * 5);        // 6..10s
      const delay = -+(rnd() * dur).toFixed(2);     // 중간부터 시작
      const fDur = +(0.7 + rnd() * 0.7).toFixed(2); // 깜빡임 0.7..1.4s
      const fDelay = -+(rnd() * fDur).toFixed(2);
      const palette = ['#f59e0b', '#f97316', '#fb923c', '#fbbf24'];
      const stroke = ['#fed7aa', '#fde68a', '#fff7ed', '#fee2e2'][i % 4];
      const fill = palette[i % palette.length];
      return { id: `e${i}`, cx, cy, s, rot, dx, dur, delay, fDur, fDelay, fill, stroke } as const;
    }) : []
  ), [kind, rnd]);
  const leavesPieces = React.useMemo(() => (
    kind === 'leaves' ? Array.from({ length: 5 }).map((_, i) => {
      const x = Math.floor(rnd() * 100);        // 0..100% 가로 분포
      const y = Math.floor(rnd() * 8);          // 상단 여백 소폭
      const s = 0.55 + rnd() * 0.25;            // 더 작게 0.55..0.80배
      const rot = -25 + rnd() * 50;             // -25..+25deg
      const yStart = -20 - Math.floor(rnd() * 60); // -20%..-80%
      const dur = 7 + (i % 3);                  // 7..9s
      const delay = -+(rnd() * dur).toFixed(2); // 중간부터 시작
      return { id: `l${i}`, x, y, s, rot, yStart, dur, delay } as const;
    }) : []
  ), [kind, rnd]);
  const sakuraPetals = React.useMemo(() => (
    kind === 'sakura' ? Array.from({ length: 18 }).map((_, i) => {
      const x = Math.floor((i * 100 / 18) + (i % 3) * 2) % 100; // 균일 분포 + 소폭 오프셋
      const rot = -30 + (i % 9) * 7; // -30..+28deg
      const s = 0.9 + (i % 4) * 0.06; // 0.9..1.08
      const dur = (7.5 + (i % 5)) + (i % 2) * 0.6; // 7.5..11.1s
      const delay = -+((rnd() * dur) % 3).toFixed(2); // 중간부터 시작
      const yStart = -20 - ((i % 6) * 8); // -20..-68%
      return { id: `p${i}`, x, rot, s, dur, delay, yStart } as const;
    }) : []
  ), [kind, rnd]);
  const midnightStars = React.useMemo(() => (
    kind === 'midnight' ? Array.from({ length: 24 }).map((_, i) => {
      // Stratified grid (cols x rows) to avoid clustering + jitter for natural dispersion
      const cols = 6, rows = 4;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const jx = (rnd() * 14 - 7); // -7..+7 jitter
      const jy = (rnd() * 14 - 7); // -7..+7 jitter
      let cx = ((col + 0.5) * (100 / cols)) + jx; // center of cell + jitter
      let cy = ((row + 0.5) * (100 / rows)) + jy;
      cx = Math.max(2, Math.min(98, cx));
      cy = Math.max(2, Math.min(98, cy));
      const s = +(0.55 + rnd() * 0.35).toFixed(2); // 0.55..0.90 (smaller)
      const baseRot = Math.floor(rnd() * 360);
      const t = +(1.6 + rnd() * 2.0).toFixed(2); // 1.6..3.6s twinkle
      const delay = -+(rnd() * t).toFixed(2); // mid-cycle start
      const rotAmp = +(2 + rnd() * 3).toFixed(2); // 2..5deg (smaller rotation)
      const rotDur = +(6 + rnd() * 4).toFixed(2); // 6..10s
      // Drift vectors (user units) from a unique angle per star so each wanders in a different direction
      const ang = rnd() * Math.PI * 2; // 0..2pi
      const A = 2 + rnd() * 2; // 2..4
      const B = 1.5 + rnd() * 2; // 1.5..3.5
      const ax = +( (Math.cos(ang) * A).toFixed(2) );
      const ay = +( (Math.sin(ang) * A).toFixed(2) );
      const bx = +( (Math.cos(ang + Math.PI / 2) * B).toFixed(2) );
      const by = +( (Math.sin(ang + Math.PI / 2) * B).toFixed(2) );
      const driftDur = +(24 + rnd() * 18).toFixed(2); // 24..42s (slower drift)
      const driftDelay = -+(rnd() * driftDur).toFixed(2);
      const palette = [
        ['#e5e7eb', '#93c5fd'], // white -> light blue
        ['#f3f4f6', '#a5b4fc'], // off-white -> indigo
        ['#e0f2fe', '#bae6fd'], // sky tints
        ['#fef3c7', '#fde68a']  // warm twinkle
      ];
      const [c1, c2] = palette[i % palette.length];
      return { id: `ms${i}`, cx, cy, s, baseRot, t, delay, rotAmp, rotDur, ax, ay, bx, by, driftDur, driftDelay, c1, c2 } as const;
    }) : []
  ), [kind, rnd]);

  if (kind === 'embers') {
    return (
      <svg className="absolute inset-0 z-0 w-full h-full pointer-events-none opacity-65 mix-blend-screen" viewBox="0 0 100 100" preserveAspectRatio="none">
        <g>
          {embers.map(p => (
            <g key={p.id} transform={`translate(${p.cx}, ${p.cy})`}>
              {/* 상승 애니메이션은 .ember, 깜빡임은 .ember-shape */}
              <g className="ember" style={{ ['--dx' as any]: `${p.dx}%`, ['--dur' as any]: `${p.dur}s`, ['--delay' as any]: `${p.delay}s` }}>
                <g transform={`rotate(${p.rot}) scale(${p.s})`}>
                  {/* 눈물방울 형태의 불티 */}
                  <path className="ember-shape" d="M0,-1.6 C0.55,-0.6 0.45,0.5 0,1.3 C-0.45,0.5 -0.55,-0.6 0,-1.6 Z"
                    fill={p.fill} stroke={p.stroke} strokeWidth={0.15}
                    style={{ ['--fDur' as any]: `${p.fDur}s`, ['--fDelay' as any]: `${p.fDelay}s` }} />
                </g>
              </g>
            </g>
          ))}
        </g>
      </svg>
    );
  }
  if (kind === 'snow') {
    return (
      <svg className="absolute inset-0 z-0 w-full h-full pointer-events-none opacity-65" viewBox="0 0 100 100" preserveAspectRatio="none">
        <g stroke="#e0f2fe" strokeOpacity="0.95" strokeWidth="0.6" strokeLinecap="round">
          {snowFlakes.map(f => (
            <g key={f.id} className="flake" style={{ ['--dx' as any]: `${f.dx}px`, ['--dur' as any]: `${f.dur}s`, ['--delay' as any]: `${f.delay}s`, ['--yStart' as any]: `${f.yStart}%` }}>
              <g transform={`translate(${f.cx}, ${f.cy}) rotate(${f.rot}) scale(${f.s})`} className="flake-shape">
                <line x1="0" y1="-2" x2="0" y2="2" />
                <line x1="-2" y1="0" x2="2" y2="0" />
                <line x1="-1.4" y1="-1.4" x2="1.4" y2="1.4" />
                <line x1="-1.4" y1="1.4" x2="1.4" y2="-1.4" />
                {/* 작은 가지 */}
                <line x1="0" y1="-2" x2="0.6" y2="-2.6" />
                <line x1="0" y1="-2" x2="-0.6" y2="-2.6" />
                <line x1="2" y1="0" x2="2.6" y2="0.6" />
                <line x1="2" y1="0" x2="2.6" y2="-0.6" />
                <line x1="0" y1="2" x2="0.6" y2="2.6" />
                <line x1="0" y1="2" x2="-0.6" y2="2.6" />
                <line x1="-2" y1="0" x2="-2.6" y2="0.6" />
                <line x1="-2" y1="0" x2="-2.6" y2="-0.6" />
              </g>
            </g>
          ))}
        </g>
      </svg>
    );
  }
  if (kind === 'scan') {
    return (
      <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-65 mix-blend-screen" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="scan-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f0abfc" stopOpacity="0" />
            <stop offset="50%" stopColor="#f0abfc" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#f0abfc" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect className="scanline" x="0" y="0" width="100" height="100" fill="url(#scan-grad)" style={{ animationDelay: `${-(rnd() * 7).toFixed(2)}s` }} />
      </svg>
    );
  }
  if (kind === 'shimmer') {
    return (
      <svg className="absolute inset-0 z-0 w-full h-full pointer-events-none opacity-40 mix-blend-screen" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="shim-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fef3c7" stopOpacity="0" />
            <stop offset="50%" stopColor="#fde68a" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect className="gold-sweep" x="-20" y="-50" width="40" height="200" fill="url(#shim-grad)" style={{ ['--delay' as any]: `${-(rnd() * 7).toFixed(2)}s`, ['--phase' as any]: `${-(rnd() * 7).toFixed(2)}s` }} />
      </svg>
    );
  }
  if (kind === 'confetti') {
    return (
      <svg className="absolute inset-0 z-0 w-full h-full pointer-events-none opacity-70 mix-blend-screen" viewBox="0 0 100 100" preserveAspectRatio="none">
        <g>
          {confettiPieces.map(c => (
            <rect key={c.id} className="confetti" width={c.w} height={c.h} x={c.x} y={c.y} fill={c.fill} style={{ ['--dx' as any]: `${c.dx}px`, ['--rot' as any]: `${c.rot}deg`, ['--dur' as any]: `${c.dur}s`, ['--delay' as any]: `${c.delay}s` }} />
          ))}
        </g>
      </svg>
    );
  }
  if (kind === 'leaves') {
    return (
      <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-65 mix-blend-screen" viewBox="0 0 100 100" preserveAspectRatio="none">
        <g fill="#86efac" fillOpacity="0.6">
          {leavesPieces.map(l => (
            <path key={l.id} className="leaf" d="M10 20 C 15 10, 25 10, 30 20 C 25 30, 15 30, 10 20 Z"
              transform={`translate(${l.x},${l.y}) scale(${l.s}) rotate(${l.rot})`}
              style={{ ['--yStart' as any]: `${l.yStart}%`, animationDuration: `${l.dur}s`, animationDelay: `${l.delay}s` }} />
          ))}
        </g>
      </svg>
    );
  }
  if (kind === 'sakura') {
    return (
      <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-70 mix-blend-screen" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <radialGradient id="sak-grad" cx="50%" cy="0%" r="85%">
            <stop offset="0%" stopColor="#fecdd3" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="sak-glow" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fda4af" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="100" height="100" fill="url(#sak-grad)" />
        <g fill="#fecdd3" fillOpacity="0.55">
          {sakuraPetals.map(p => (
            <path key={p.id} className="petal" d="M5 20c2-3 6-3 8 0c2 3-1 6-4 7c-3-1-6-4-4-7z"
              transform={`translate(${p.x},0) rotate(${p.rot}) scale(${p.s})`}
              style={{ ['--dur' as any]: `${p.dur}s`, ['--delay' as any]: `${p.delay}s`, ['--yStart' as any]: `${p.yStart}%` }} />
          ))}
        </g>
        <rect x="0" y="0" width="100" height="100" fill="url(#sak-glow)" />
      </svg>
    );
  }
  if (kind === 'midnight') {
    return (
      <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-65 mix-blend-screen" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <radialGradient id="mid-vignette" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor="#111827" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.8" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width="100" height="100" fill="url(#mid-vignette)" />
        <g strokeLinejoin="round" strokeLinecap="round">
          {midnightStars.map(s => (
            <g key={s.id} className="star" style={{ ['--t' as any]: `${s.t}s`, ['--delay' as any]: `${s.delay}s` }}>
              <defs>
                <radialGradient id={`mid-star-${s.id}`} cx="50%" cy="50%" r="70%">
                  <stop offset="0%" stopColor={s.c1} stopOpacity="1" />
                  <stop offset="100%" stopColor={s.c2} stopOpacity="0.35" />
                </radialGradient>
              </defs>
              <g transform={`translate(${s.cx}, ${s.cy})`}>
                <g className="star-drift" style={{ ['--ax' as any]: `${s.ax}`, ['--ay' as any]: `${s.ay}`, ['--bx' as any]: `${s.bx}`, ['--by' as any]: `${s.by}`, ['--driftDur' as any]: `${s.driftDur}s`, ['--driftDelay' as any]: `${s.driftDelay}s` }}>
                  <g className="star-rot" style={{ ['--rotAmp' as any]: `${s.rotAmp}deg`, ['--rotDur' as any]: `${s.rotDur}s` }} transform={`rotate(${s.baseRot}) scale(${s.s})`}>
                    <path className="star-shape" d="M0,-2.2 L0.35,-0.5 L1.2,0 L0.35,0.5 L0,2.2 L-0.35,0.5 L-1.2,0 L-0.35,-0.5 Z" fill={`url(#mid-star-${s.id})`} stroke={s.c1} strokeWidth="0.32" />
                  </g>
                </g>
              </g>
            </g>
          ))}
        </g>
      </svg>
    );
  }
  if (kind === 'sunset') {
    return (
      <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-40 mix-blend-screen" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <radialGradient id="sun-core" cx="0%" cy="0%" r="60%">
            <stop offset="0%" stopColor="#fde68a" stopOpacity="1.0" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="sun-rays" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="100" height="100" fill="url(#sun-core)" className="sun-core-pulse" style={{ ['--delay' as any]: `${-(rnd() * 6).toFixed(2)}s` }} />
        <g stroke="url(#sun-rays)" strokeWidth="2" strokeOpacity="0.5" className="sun-rays-pulse" style={{ ['--delay2' as any]: `${-(rnd() * 7.2).toFixed(2)}s` }}>
          <line x1="0" y1="0" x2="40" y2="0" />
          <line x1="0" y1="0" x2="0" y2="40" />
          <line x1="0" y1="0" x2="35" y2="15" />
          <line x1="0" y1="0" x2="15" y2="35" />
        </g>
      </svg>
    );
  }
  if (kind === 'grid') {
    return (
      <svg className="absolute inset-0 z-0 w-full h-full pointer-events-none opacity-60" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <pattern id="grid-pat" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="currentColor" strokeWidth="0.4" className="text-white/40" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="100" height="100" fill="url(#grid-pat)" />
      </svg>
    );
  }
  if (kind === 'noise') {
    return (
      <svg className="absolute inset-0 z-0 w-full h-full pointer-events-none opacity-57 mix-blend-soft-light" viewBox="0 0 100 100" preserveAspectRatio="none">
        <filter id="noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100" height="100" filter="url(#noise)" />
      </svg>
    );
  }
  if (!kind || kind === 'none') return null;
  return null;
});

type Theme = 'classic' | 'fire' | 'ice' | 'cyber' | 'gold' | 'pastel' | 'forest' | 'sakura' | 'midnight' | 'sunset';

type WsPayload = {
  type: 'roulette';
  token?: string;
  name?: string | null;
  username?: string | null;
  value?: number | string | null;
  label?: string | null;
  createdAt?: number | string | null;
  theme?: Theme | null;
  items?: string[] | null;
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

export default function RouletteViewer() {
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
  // RAF physics refs
  const rafIdRef = React.useRef<number | null>(null);
  const animStartRef = React.useRef<number>(0);
  const durationRef = React.useRef<number>(5200); // 5.2s
  const v0Ref = React.useRef<number>(0); // px/s
  const aRef = React.useRef<number>(0);  // px/s^2 (deceleration)
  const startCenterRef = React.useRef<number>(0); // start center index (rows)
  const targetIndexRef = React.useRef<number>(0);  // final center index (integer rows)
  const poolRef = React.useRef<string[]>([]);
  const finalIndexRef = React.useRef<number | null>(null);
  const finalLabelRef = React.useRef<string | null>(null);

  // WebSocket 디버깅 정보 상태
  const [debugInfo, setDebugInfo] = React.useState<WebSocketDebugInfo>({
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
  const reconnectTimeoutRef = React.useRef<number | null>(null);

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
  const queuedEventsRef = React.useRef<any[]>([]);
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
      window.removeEventListener('pointerdown', onInteract as any);
      window.removeEventListener('keydown', onInteract as any);
    };
  }, []);
  const token = React.useMemo(() => {
    try {
      const parts = (typeof window !== 'undefined' ? window.location.pathname : '').split('/').filter(Boolean);
      const idx = parts.indexOf('roulette');
      return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : '';
    } catch { return ''; }
  }, []);

  // 메시지 채널 ID 검증 함수
  const validateMessageChannelId = React.useCallback((message: any, expectedChannelId: string | null): boolean => {
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
  const updateDebugInfo = React.useCallback((updates: Partial<WebSocketDebugInfo>) => {
    setDebugInfo(prev => {
      const newInfo = { ...prev, ...updates };
      return newInfo;
    });
  }, []);
  // URL override for theme (optional)
  const themeOverride: Theme | null = React.useMemo(() => {
    try {
      const q = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
      const t = (q.get('theme') || '').toLowerCase();
      return (t === 'neon' || t === 'mono' || t === 'classic') ? (t as Theme) : null;
    } catch { return null; }
  }, []);
  const theme: Theme = themeOverride || serverTheme || 'classic';
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
      const loc = (typeof window !== 'undefined' ? window.location : { protocol: 'http:', hostname: 'localhost', origin: 'https://arubot.yuaru.kr' }) as Location | any;
      const isHttps = loc.protocol === 'https:';
      const httpProto = isHttps ? 'https:' : 'http:';
      const backendHost = (loc.hostname === 'localhost') ? `localhost:3001` : `arubotapi.yuaru.kr`;
      const backendBase = `${httpProto}//${backendHost}`;
      const a = new Audio(`${loc.origin}/files/roulette_start.weba`);
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
            a.src = `${loc.origin}/files/roulette_start.mp3`;
            a.load();
          };
        } catch { startAudioRef.current = null; }
      };
      startAudioRef.current = a;
    } catch {}
    try {
      const loc = (typeof window !== 'undefined' ? window.location : { protocol: 'http:', hostname: 'localhost', origin: 'https://arubot.yuaru.kr' }) as Location | any;
      const isHttps = loc.protocol === 'https:';
      const httpProto = isHttps ? 'https:' : 'http:';
      const backendHost = (loc.hostname === 'localhost') ? `localhost:3001` : `arubotapi.yuaru.kr`;
      const backendBase = `${httpProto}//${backendHost}`;
      const b = new Audio(`${loc.origin}/files/roulette_end.mp3`);
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
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
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
    if (startAudioRef.current) { try { startAudioRef.current.currentTime = 0; startAudioRef.current.play(); return; } catch {} }
    playBeep(880, 120, 'square', 0.015);
  }, [sfxOn, playBeep]);
  const playEndSfx = React.useCallback(() => {
    if (!sfxOn || !(userInteractedRef.current || canAutoPlayRef.current)) return;
    if (endAudioRef.current) { try { endAudioRef.current.currentTime = 0; endAudioRef.current.play(); return; } catch {} }
    playBeep(440, 120, 'triangle', 0.02); setTimeout(()=>playBeep(660, 120, 'triangle', 0.02), 130);
  }, [sfxOn, playBeep]);

  // WebSocket 연결 및 재연결 로직 (서버에서 채널 검증 수행)
  const connectWebSocket = React.useCallback(() => {
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
      const loc = (typeof window !== 'undefined' ? window.location : { protocol: 'http:', hostname: 'localhost' }) as Location | any;
      const isHttps = loc.protocol === 'https:';
      const wsProto = isHttps ? 'wss:' : 'ws:';
      // Use backend API host for WS: arubotapi.yuaru.kr in production, localhost:3001 in dev
      const wsHost = (loc.hostname === 'localhost')
        ? `localhost:3001`
        : `arubotapi.yuaru.kr`;
      const url = `${wsProto}//${wsHost}/api/roulette/ws?token=${encodeURIComponent(token)}`;
      
      updateDebugInfo({ 
        connectionState: 'connecting',
        connectionAttempts: debugInfo.connectionAttempts + 1,
        lastConnectionTime: Date.now()
      });

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setError(null);
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
      };

      ws.onmessage = async (ev) => {
        try {
          updateDebugInfo({ 
            lastMessageTime: Date.now(),
            messageCount: debugInfo.messageCount + 1
          });

          const data = JSON.parse(ev.data) as WsPayload;
          if (data && data.type === 'roulette') {
            // 채널 ID 검증 로직 추가
            if (channelIdValidationEnabledRef.current) {
              const messageChannelId = (data as any).channelId;
              
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
            if ((data as any).channelId) {
              updateDebugInfo({ 
                channelId: (data as any).channelId
              });
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
              updateDebugInfo({ 
                initialMessagesSkipped: debugInfo.initialMessagesSkipped + 1
              });
              return;
            }
            
            // 유효한 룰렛 메시지로 판단
            if (!firstValidMessageReceivedRef.current) {
              firstValidMessageReceivedRef.current = true;
            }
            
            updateDebugInfo({ 
              validMessagesReceived: debugInfo.validMessagesReceived + 1
            });
            
            // If autoplay not yet enabled, try one more prime attempt just-in-time
            if (!canAutoPlayRef.current && sfxOn) {
              try { await primeAudio(); } catch {}
            }
            
            // Build a key to detect duplicate payloads
            const key = `${data.token || ''}|${data.label || ''}|${data.value ?? ''}|${data.createdAt || ''}`;
            
            // Ignore if in cooldown window to avoid quick re-triggers, except for instant/batched roulette events
            const isInstantPayload = (data as any).instant === true;
            const hasBatch = !!(data as any).batchId;
            if (now < spinCooldownUntilRef.current && !isInstantPayload && !hasBatch) {
              return;
            }
            
            // Ignore if identical to last and very recent (handles multi-instance duplicate broadcasts)
            // Do not dedupe batched payloads
            if (!hasBatch && lastSpinKeyRef.current === key && (now - lastSpinAtRef.current) < 5000) {
              return;
            }
            
            // 메시지 우선순위 계산 (높을수록 우선)
            const getMessagePriority = (payload: WsPayload): number => {
              let priority = 0;
              
              // 즉시 실행 메시지는 높은 우선순위
              if ((payload as any).instant === true) priority += 100;
              
              // 배치 메시지는 중간 우선순위
              if ((payload as any).batchId) priority += 50;
              
              // 최근 메시지일수록 높은 우선순위
              const createdAt = Number(payload.createdAt) || now;
              const recency = Math.max(0, 10000 - (now - createdAt)) / 1000; // 0-10점
              priority += recency;
              
              // 완전한 데이터를 가진 메시지는 높은 우선순위
              if (payload.label || payload.value) priority += 10;
              
              return priority;
            };
            
            // If a spin is already in progress, buffer this event for later processing
            if (isSpinningRef.current) {
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
              return;
            }
            
            const applyEvent = (payload: WsPayload) => {
              const isInstant = (payload as any).instant === true;
              const final = String(payload.label || (payload.value != null ? String(payload.value) : ''));
              isSpinningRef.current = true;
              lastSpinKeyRef.current = key;
              lastSpinAtRef.current = now;
              
              // Update batch progress markers
              if ((payload as any).batchId && (payload as any).batchCount && Number((payload as any).batchCount) > 0) {
                if (currentBatchIdRef.current !== String((payload as any).batchId)) {
                  currentBatchIdRef.current = String((payload as any).batchId);
                  currentBatchTotalRef.current = Math.max(1, Number((payload as any).batchCount));
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
                showInstantResult(final, payload as any);
              } else {
                // Animated spin: set state immediately and run full spin
                setState({ name: payload.name || undefined, username: payload.username || undefined, label: payload.label || undefined, value: (payload.value != null ? payload.value : undefined) });
                const allowedThemes = ['classic','fire','ice','cyber','gold','pastel','forest','sakura','midnight','sunset'];
                if (payload.theme && allowedThemes.includes(String(payload.theme).toLowerCase())) setServerTheme(String(payload.theme).toLowerCase() as any);
                startSpinAnimation(final, Array.isArray(payload.items) ? payload.items : null);
              }
            };
            applyEvent(data);
          }
        } catch (parseError) {
          console.error('[RouletteViewer] 메시지 파싱 오류:', parseError, '원본 데이터:', ev.data);
        }
      };

      ws.onerror = (event) => {
        const errorMsg = `WebSocket 연결 오류: ${event.type}`;
        console.error('[RouletteViewer]', errorMsg, event);
        setError('connection error');
        updateDebugInfo({ 
          connectionState: 'error',
          lastError: errorMsg
        });
      };

      ws.onclose = (event) => {
        const closeMsg = `WebSocket 연결 종료: code=${event.code}, reason=${event.reason}, wasClean=${event.wasClean}`;
        console.warn('[RouletteViewer]', closeMsg);
        
        // 서버 검증 실패 감지 (채널 접근 거부 등)
        if (event.code === 1008 || event.code === 1009 || event.code === 1012) {
          const serverErrorMsg = event.code === 1008 ? '토큰이 유효하지 않습니다' :
                                 event.code === 1009 ? '채널 접근이 거부되었습니다' :
                                 event.code === 1012 ? '채널을 찾을 수 없습니다' :
                                 '서버 검증 실패';
          setError(serverErrorMsg);
          updateDebugInfo({ 
            connectionState: 'error',
            lastError: serverErrorMsg
          });
          return; // 서버 검증 실패 시 재연결하지 않음
        }
        
        // 채널 ID 검증 상태 정리
        expectedChannelIdRef.current = null;
        channelIdValidationEnabledRef.current = channelValidationOn;
        
        updateDebugInfo({ 
          connectionState: 'disconnected',
          lastError: closeMsg,
          channelId: null // 연결 종료 시 채널 ID 정리
        });

        // 비정상 종료인 경우 재연결 시도
        if (!event.wasClean && debugInfo.reconnectAttempts < 3) {
          const delay = Math.min(1000 * Math.pow(2, debugInfo.reconnectAttempts), 10000); // 지수 백오프
          updateDebugInfo({ 
            reconnectAttempts: debugInfo.reconnectAttempts + 1
          });

          reconnectTimeoutRef.current = window.setTimeout(() => {
            connectWebSocket();
          }, delay);
        }
      };

      return () => { 
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        try { 
          ws.close(); 
        } catch (closeError) {
          console.warn('[RouletteViewer] WebSocket 종료 중 오류:', closeError);
        }
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
  }, [token, validateToken, validateMessageChannelId, updateDebugInfo, debugInfo.connectionAttempts, debugInfo.messageCount, debugInfo.reconnectAttempts, sfxOn, channelValidationOn, primeAudio]);

  React.useEffect(() => {
    const cleanup = connectWebSocket();
    return cleanup;
  }, [connectWebSocket]);

  const showInstantResult = React.useCallback((finalLabel: string, meta?: any) => {
    // Cancel outstanding timers
    timersRef.current.forEach(id => window.clearTimeout(id));
    timersRef.current = [];
    // Fade out whole content layer first
    setActive(false);
    const OUT_MS = FADE_MS;
    const IN_SETTLE_MS = 1000;
    const FINAL_CHECK_MS = FADE_MS;
    const prepId = window.setTimeout(() => {
      // Prepare next label and fade in whole content layer with new result
      // Apply theme and state here so the old item stays visible during fade-out
      try {
        const allowedThemes = ['classic','fire','ice','cyber','gold','pastel','forest','sakura','midnight','sunset'];
        if (meta && meta.theme && allowedThemes.includes(String(meta.theme).toLowerCase())) {
          setServerTheme(String(meta.theme).toLowerCase() as any);
        }
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
      playEndSfx();
      setActive(true);
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
  }, [playEndSfx]);

  const startSpinAnimation = React.useCallback((finalLabel: string, itemsFromServer: string[] | null) => {
    // clear previous timers
    timersRef.current.forEach(id => window.clearTimeout(id));
    timersRef.current = [];
    // keep reel view; no separate final stage view
    // Build reel with random items and inject final at stop time to avoid blanks
    const baseItems = Array.isArray(itemsFromServer) && itemsFromServer.length > 0
      ? itemsFromServer.slice()
      : ['🎉 축하', '행운!', '꽝?', '한 번 더', '✨ 반짝', '🔥 고', '⭐ 스타', '💫 번쩍', '🎲 룰렛'];
    const cleaned = baseItems.map(s => String(s)).filter(s => s.length > 0);
    const pool = cleaned.length ? cleaned : ['행운!', '룰렛', '고!'];
    poolRef.current = pool.slice();
    const rand = () => pool[Math.floor(Math.random() * pool.length)];
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

    // Physics-based continuous scrolling with RAF
    // Ensure we have a stable row height for this run
    const measuredH = rowRef.current?.getBoundingClientRect().height || 0;
    const rowHpx = (rowH && rowH > 0) ? rowH : (measuredH > 0 ? Math.round(measuredH) : 64);
    if (rowHpx !== rowH && rowHpx > 0) setRowH(rowHpx);
    const startIdx = rowsHalf; // starting center index (rows)
    // Pick a pleasant number of rows to travel; ensure enough randomness shown
    const travelRows = Math.max(40, Math.min(120, pool.length * 8));
    const targetIdx = startIdx + travelRows; // virtual absolute target index
    finalIndexRef.current = targetIdx;
    finalLabelRef.current = finalLabel;
    startCenterRef.current = startIdx;
    targetIndexRef.current = targetIdx;
    animStartRef.current = performance.now();
    const distancePx = (targetIdx - startIdx) * rowHpx;
    const T = durationRef.current; // 5200ms
    const a = (2 * distancePx) / (T * T); // decel
    const v0 = a * T; // initial velocity px/ms
    aRef.current = a; v0Ref.current = v0;

    if (rafIdRef.current) { cancelAnimationFrame(rafIdRef.current); }
    const run = (now: number) => {
      const t = now - animStartRef.current;
      const clamped = Math.min(T, Math.max(0, t));
      const s = (v0 * clamped) - (0.5 * a * clamped * clamped); // px
      const currentCenter = startIdx + (s / rowHpx);
      setOffsetRows(currentCenter);
      setScrollIndex(Math.floor(currentCenter));
      if (t < T) {
        rafIdRef.current = requestAnimationFrame(run);
      } else {
        // Final snap to exact center and small overshoot bounce
        setOffsetRows(targetIdx);
        setScrollIndex(targetIdx);
        // Overshoot: +2px then settle back
        const px2rows = (px: number) => px / rowHpx;
        const overshoot = () => {
          setOffsetRows(targetIdx + px2rows(2));
          requestAnimationFrame(() => {
            setOffsetRows(targetIdx - px2rows(1));
            requestAnimationFrame(() => {
              setOffsetRows(targetIdx);
              // done
              playEndSfx();
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
            });
          });
        };
        overshoot();
      }
    };
    rafIdRef.current = requestAnimationFrame(run);
  }, [playStartSfx, playEndSfx, rowH, computeRowsHalf]);

  // Process any queued roulette events after current spin completes
  processQueuedRef.current = () => {
    if (isSpinningRef.current) return;
    const next = queuedEventsRef.current.shift();
    if (!next) return;
    
    // 큐 상태 업데이트
    updateDebugInfo({ 
      queuedMessagesCount: queuedEventsRef.current.length
    });
    // Apply next immediately; if instant, reveal instantly; else run full spin
    setTimeout(() => {
      // mimic onmessage path
      const payload: any = next;
      const key = `${payload.token || ''}|${payload.label || ''}|${payload.value ?? ''}|${payload.createdAt || ''}`;
      const now = Date.now();
      const isBatch = !!(payload as any).batchId;
      if (!isBatch && lastSpinKeyRef.current === key && (now - lastSpinAtRef.current) < 5000) {
        processQueuedRef.current();
        return;
      }
      const allowedThemes = ['classic','fire','ice','cyber','gold','pastel','forest','sakura','midnight','sunset'];
      if (payload.theme && allowedThemes.includes(String(payload.theme).toLowerCase())) setServerTheme(String(payload.theme).toLowerCase() as any);
      setState({ name: payload.name || undefined, username: payload.username || undefined, label: payload.label || undefined, value: (payload.value != null ? payload.value : undefined) });
      const final = String(payload.label || (payload.value != null ? String(payload.value) : ''));
      isSpinningRef.current = true;
      lastSpinKeyRef.current = key;
      lastSpinAtRef.current = now;
      // Update batch progress for queued payload
      if ((payload as any).batchId && (payload as any).batchCount && Number((payload as any).batchCount) > 0) {
        if (currentBatchIdRef.current !== String((payload as any).batchId)) {
          currentBatchIdRef.current = String((payload as any).batchId);
          currentBatchTotalRef.current = Math.max(1, Number((payload as any).batchCount));
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
        startSpinAnimation(final, Array.isArray(payload.items) ? payload.items : null);
      }
    }, 50);
  };

  // Theme mapping (CSS-only). Background stays transparent; only the box/text change.
  type ThemeSpec = {
    boxBg: string; ring: string; border: string; accent: string; result: string;
    ringW: string; radius: string; overlay?: 'none' | 'sakura' | 'midnight' | 'sunset' | 'grid' | 'noise' | 'embers' | 'snow' | 'scan' | 'shimmer' | 'confetti' | 'leaves' | 'gold-sweep';
  };
  const pickTheme = (name?: string): ThemeSpec => {
    switch ((name || '').toLowerCase()) {
      case 'fire':
        return {
          boxBg: 'bg-red-900/50 md:bg-red-900/60',
          ring: 'ring-orange-400/70',
          accent: 'text-orange-300',
          result: 'text-amber-200',
          border: 'border-white/10',
          ringW: 'md:ring-4',
          radius: 'rounded-3xl',
          overlay: 'embers'
        };
      case 'ice':
        return {
          boxBg: 'bg-cyan-900/40 md:bg-cyan-900/50',
          ring: 'ring-cyan-400/60',
          accent: 'text-cyan-300',
          result: 'text-sky-200',
          border: 'border-white/10',
          ringW: 'md:ring-4',
          radius: 'rounded-2xl',
          overlay: 'snow'
        };
      case 'cyber':
        return {
          boxBg: 'bg-fuchsia-950/60 md:bg-fuchsia-950/70',
          ring: 'ring-fuchsia-400/60',
          accent: 'text-fuchsia-300',
          result: 'text-lime-200',
          border: 'border-white/10',
          ringW: 'md:ring-2',
          radius: 'rounded-xl',
          overlay: 'scan'
        };
      case 'gold':
        return {
          boxBg: 'bg-zinc-900/70',
          ring: 'ring-amber-400/70',
          accent: 'text-amber-300',
          result: 'text-amber-100',
          border: 'border-amber-300/20',
          ringW: 'md:ring-8',
          radius: 'rounded-[28px]',
          overlay: 'shimmer'
        };
      case 'pastel':
        return {
          boxBg: 'bg-rose-900/40 md:bg-rose-900/50',
          ring: 'ring-pink-300/60',
          accent: 'text-pink-200',
          result: 'text-rose-100',
          border: 'border-white/10',
          ringW: 'md:ring-2',
          radius: 'rounded-2xl',
          overlay: 'confetti'
        };
      case 'forest':
        return {
          boxBg: 'bg-emerald-950/50 md:bg-emerald-950/60',
          ring: 'ring-emerald-400/60',
          accent: 'text-emerald-300',
          result: 'text-green-100',
          border: 'border-white/10',
          ringW: 'md:ring-4',
          radius: 'rounded-3xl',
          overlay: 'leaves'
        };
      case 'sakura':
        return {
          boxBg: 'bg-rose-900/45 md:bg-rose-900/55',
          ring: 'ring-rose-300/70',
          accent: 'text-rose-200',
          result: 'text-pink-100',
          border: 'border-rose-300/20',
          ringW: 'md:ring-4',
          radius: 'rounded-[32px]',
          overlay: 'sakura'
        };
      case 'midnight':
        return {
          boxBg: 'bg-slate-950/70',
          ring: 'ring-indigo-400/60',
          accent: 'text-indigo-300',
          result: 'text-blue-200',
          border: 'border-white/10',
          ringW: 'md:ring-2',
          radius: 'rounded-2xl',
          overlay: 'midnight'
        };
      case 'sunset':
        return {
          boxBg: 'bg-orange-950/60 md:bg-orange-950/70',
          ring: 'ring-amber-400/70',
          accent: 'text-amber-300',
          result: 'text-orange-200',
          border: 'border-amber-300/20',
          ringW: 'md:ring-6',
          radius: 'rounded-[24px]',
          overlay: 'sunset'
        };
      case 'classic':
      default:
        return {
          boxBg: 'bg-black/70 md:bg-black/80',
          ring: 'ring-emerald-400/50',
          accent: 'text-emerald-300',
          result: 'text-emerald-200',
          border: 'border-white/10',
          ringW: 'md:ring-4',
          radius: 'rounded-2xl',
          overlay: 'none'
        };
    }
  };
  const t = pickTheme(serverTheme || theme || 'classic');
  // Memoize overlay element so it does not remount during item updates
  const overlayKind = (t.overlay || 'none') as OverlayKind;
  const overlayEl = React.useMemo(() => <OverlaySvg kind={overlayKind} />, [overlayKind]);

  // Inject animation keyframes once to avoid re-creating <style> on every render (which can reset animations)
  React.useEffect(() => {
    const STYLE_ID = 'roulette-overlay-animations';
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;
    const css = `
@keyframes ember-rise { 0% { transform: translateY(0) translateX(0); opacity: 0; } 10% { opacity: 0.9; } 100% { transform: translateY(-160%) translateX(var(--dx, -6%)); opacity: 0; } }
.ember { animation: ember-rise var(--dur, 7s) linear infinite; animation-delay: var(--delay, 0s); transform-box: view-box; transform-origin: center; }
@keyframes ember-flicker { 0%, 100% { opacity: 0.85; transform: scale(1); } 50% { opacity: 1; transform: scale(1.12); } }
.ember-shape { animation: ember-flicker var(--fDur, 1s) ease-in-out infinite; animation-delay: var(--fDelay, 0s); transform-box: fill-box; transform-origin: center; }

@keyframes flake-fall { 0% { transform: translateY(var(--yStart, -20%)) translateX(0); opacity: 0; } 10% { opacity: 0.9; } 100% { transform: translateY(120%) translateX(var(--dx, 0)); opacity: 0; } }
.flake { animation: flake-fall var(--dur, 7s) linear infinite; animation-delay: var(--delay, 0s); transform-box: view-box; transform-origin: center; }

@keyframes scan-move { 0% { transform: translateY(-100%);} 100% { transform: translateY(100%);} }
.scanline { animation: scan-move 7s linear infinite; transform-box: fill-box; transform-origin: center; }

@keyframes shimmer-move { 0% { transform: translateX(-40%);} 100% { transform: translateX(240%);} }
.shimmer { animation: shimmer-move 7s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }

/* Gold (shimmer) custom sweep: tilt to the right and run once over 7s */
@keyframes gold-sweep-move { 0% { transform: translateX(-40%) rotate(8deg);} 100% { transform: translateX(240%) rotate(8deg);} }
.gold-sweep { animation: gold-sweep-move 7s ease-in-out infinite; transform-box: fill-box; transform-origin: center; animation-delay: calc(var(--delay, 0s) + var(--phase, 0s)); }

@keyframes confetti-fall { 0% { transform: translateY(var(--yStart, -20%)) rotate(0deg); opacity: 0; } 10% { opacity: 1; } 100% { transform: translateY(160%) rotate(var(--rot, 120deg)); opacity: 0; } }
.confetti { animation: confetti-fall var(--dur, 7s) linear infinite; animation-delay: calc(var(--delay, 0s) - var(--rand, 0s)); transform-box: view-box; transform-origin: center; }

@keyframes leaf-sway { 0% { transform: translateY(var(--yStart, -20%)) translateX(0) rotate(0deg); opacity: 0;} 10% { opacity: 0.9;} 50% { transform: translateY(50%) translateX(2%) rotate(6deg);} 100% { transform: translateY(120%) translateX(-2%) rotate(-8deg); opacity: 0;} }
.leaf { animation: leaf-sway 8s ease-in-out infinite; transform-box: view-box; transform-origin: center; }

/* Sakura petals */
@keyframes petal-fall { 0% { transform: translateY(var(--yStart, -20%)) rotate(0deg); opacity: 0.6; } 10% { opacity: 1; } 100% { transform: translateY(160%) rotate(360deg); opacity: 0.6; } }
@keyframes petal-sway { 0% { transform: translateX(0); } 50% { transform: translateX(2%); } 100% { transform: translateX(0); } }
.petal { animation: petal-fall var(--dur, 8s) linear infinite, petal-sway 3.5s ease-in-out infinite; animation-delay: calc(var(--delay, 0s) - var(--rand, 0s)); transform-box: view-box; transform-origin: center; }

/* Midnight stars */
@keyframes star-twinkle { 0%, 100% { opacity: 0.6; transform: scale(1); } 50% { opacity: 1; transform: scale(1.6); } }
.star { transform-box: view-box; transform-origin: center; }
.star-shape { animation: star-twinkle var(--t, 2s) ease-in-out infinite; animation-delay: var(--delay, 0s); transform-box: fill-box; transform-origin: center; }
@keyframes star-rotate { 0% { transform: rotate(calc(var(--rotAmp, 4deg) * -1)); } 50% { transform: rotate(calc(var(--rotAmp, 4deg))); } 100% { transform: rotate(calc(var(--rotAmp, 4deg) * -1)); } }
.star-rot { animation: star-rotate var(--rotDur, 9s) ease-in-out infinite; transform-box: view-box; transform-origin: center; }

/* Midnight star drift: slowly wander using two control vectors, loop back to origin */
@keyframes star-drift {
  0%   { transform: translate(0, 0); }
  33%  { transform: translate(var(--ax, 1px), var(--ay, 1px)); }
  66%  { transform: translate(var(--bx, -1px), var(--by, -1px)); }
  100% { transform: translate(0, 0); }
}
.star-drift { animation: star-drift var(--driftDur, 18s) ease-in-out infinite; animation-delay: var(--driftDelay, 0s); transform-box: view-box; transform-origin: center; }

/* Sunset pulse */
@keyframes sunset-pulse { 0% { transform: scale(0.98);} 50% { transform: scale(1.06);} 100% { transform: scale(0.98);} }
.sun-core-pulse { animation: sunset-pulse 6s ease-in-out infinite; animation-delay: var(--delay, 0s); transform-box: view-box; transform-origin: center; }
.sun-rays-pulse { animation: sunset-pulse 7.2s ease-in-out infinite; animation-delay: var(--delay2, 0s); transform-box: view-box; transform-origin: center; }

@keyframes pop { 0%{ transform: scale(0.9); opacity: .2 } 60%{ transform: scale(1.04); opacity: 1 } 100%{ transform: scale(1); } }

/* Pause all overlay animations when parent has .overlay-paused */
.overlay-paused .ember,
.overlay-paused .flake,
.overlay-paused .scanline,
.overlay-paused .shimmer,
.overlay-paused .gold-sweep,
.overlay-paused .confetti,
.overlay-paused .leaf,
.overlay-paused .petal,
.overlay-paused .star { animation-play-state: paused !important; }
    `;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
    return () => { /* keep global styles for the session */ };
  }, []);


  return (
    <div className="min-h-screen text-white flex items-center justify-center"
      style={{ backgroundAttachment: active ? 'fixed' as const : undefined, backgroundColor: 'transparent' }}>
      <div className="text-center w-full h-[100dvh] p-0">
        {error && <div className="mb-4 text-red-400 text-sm">{error}</div>}
        
        {/* Keep box + overlay always mounted to avoid animation resets. Idle: blank white */}
        <div className={`relative mx-auto w-full h-[100dvh] ${active ? `${t.radius} ${t.boxBg} md:border ${t.border} md:shadow-2xl ${t.ringW} ${t.ring}` : ''} overflow-hidden`}
          style={{ backdropFilter: active ? 'blur(2px)' : undefined }}>
          {active && overlayEl}
          {/* Batch progress badge */}
          {batchProgress.id && (
            <div className="absolute top-3 right-3 z-20">
              <div className="px-2.5 py-1 rounded-md text-xs font-semibold bg-black/60 border border-white/15 shadow backdrop-blur">
                <span className="text-gray-200">연차</span>
                <span className="mx-1 text-gray-400">•</span>
                <span className="text-blue-300">{batchProgress.done}</span>
                <span className="text-gray-400"> / </span>
                <span className="text-blue-300">{batchProgress.total}</span>
              </div>
            </div>
          )}
          {/* Content layer fades in/out (fade timing synced to FADE_MS) */}
          <div
            className={`relative z-10 transition-opacity ${active ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            style={{ transitionDuration: FADE_MS + 'ms' }}
          >
            <div className="px-5 pt-5 pb-2 text-left md:text-left">
              <div className={`${t.accent} font-medium text-[clamp(52px,5.2vw,88px)]`}>{state.username ? `${state.username}님의` : ''}</div>
              <div className="font-extrabold leading-tight text-[clamp(62px,6.5vw,100px)]">{state.name ? `${state.name} 룰렛!` : '룰렛!'}</div>
            </div>
            <div className="px-3 md:px-5 pb-5">
              {/* Slot-machine style vertical reel (top -> bottom) */}
              <div className="relative h-[62vh] md:h-[70vh] bg-black/40 border border-white/10 rounded-xl overflow-hidden">
                <div ref={reelRef} className="relative w-full h-full flex items-center justify-center will-change-transform">
                  {/* Measure a row height using hidden ghost row */}
                  <div ref={rowRef} className="invisible absolute top-1/2 left-0 w-full -translate-y-1/2">
                    <div className={`text-[12vw] md:text-[8vw] font-black ${t.result} leading-tight`}>8</div>
                  </div>
                  {/* Reel content */}
                  {(() => {
                    const measured = rowRef.current?.getBoundingClientRect().height || 0;
                    const rh = rowH > 0 ? rowH : (measured > 0 ? Math.round(measured) : 0);
                    const reelH = reelRef.current?.getBoundingClientRect().height || 0;
                    if (!rh || !reelH) return null; // wait until measured to avoid blank flash
                    const center = offsetRows;
                    // Compute how many full rows fit in the reel height
                    const rowsVisible = Math.max(3, Math.ceil(reelH / rh) + 1);
                    const buffer = 6; // render extra rows above/below
                    const windowRows = rowsVisible + buffer * 2 + 2;
                    const firstIndex = Math.floor(center) - Math.ceil(rowsVisible / 2) - buffer;
                    // Align the CENTER of the current row to the midline (not the row's top)
                    const transformPx = Math.round((reelH / 2) - ((center - firstIndex + 0.5) * rh));
                    return (
                      <div
                        className="absolute left-0 right-0 top-0 flex flex-col items-stretch will-change-transform"
                        style={{ transform: `translateY(${transformPx}px)` }}
                      >
                        {Array.from({ length: windowRows }).map((_, k) => {
                          const idx = firstIndex + k;
                          const label = labelFor(idx);
                          const isCenter = idx === Math.round(center);
                          return (
                            <div key={idx} className="w-full flex items-center justify-center" style={{ height: rh }}>
                              <div
                                className={`text-[12vw] md:text-[8vw] font-black ${t.result} leading-tight transition-transform duration-150`}
                                style={{ transform: isCenter ? 'scale(1.06)' : 'scale(1)' }}
                              >
                                {label}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                  {/* Center guide */}
                  <div className="pointer-events-none absolute left-0 right-0 top-1/2 -translate-y-1/2 border-t border-b border-white/10" style={{ height: 2 }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

