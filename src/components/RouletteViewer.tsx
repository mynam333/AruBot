import React from 'react';
import { getBrowserApiBase } from '@/shared/api/http';
import { WheelLabelsSvg, WheelSegmentsSvg, WheelSelectedSegment, WheelSkinOrnaments } from './rouletteWheelSkins';
import { getWheelSkinFamily, splitWheelLabel } from './rouletteWheelUtils';

// Module-scope overlay kind and component to avoid remounts on parent re-renders
type OverlayKind = 'none' | 'sakura' | 'midnight' | 'sunset' | 'grid' | 'noise' | 'embers' | 'snow' | 'scan' | 'shimmer' | 'confetti' | 'leaves' | 'gold-sweep';

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

function getRouletteWsUrl(token: string) {
  const url = new URL('/api/roulette/ws', getRouletteApiBase());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', token);
  return url.toString();
}

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
  token?: string;
  name?: string | null;
  username?: string | null;
  value?: number | string | null;
  label?: string | null;
  createdAt?: number | string | null;
  theme?: string | null;
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

type RouletteViewerProps = {
  viewerToken?: string;
};

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
  const reconnectTimeoutRef = React.useRef<number | null>(null);
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

  React.useEffect(() => {
    if (!previewMode) return;
    const sampleItems = ['아루 코인', 'VIP 포인트', '한 번 더', '선물 상자', '대박', '축하 멘트', '보너스', '오늘의 주인공'];
    const finalLabel = sampleItems[4];
    const centerIndex = 6;
    poolRef.current = sampleItems;
    finalIndexRef.current = centerIndex;
    finalLabelRef.current = finalLabel;
    scrollItemsRef.current = ['축하 멘트', '보너스', '아루 코인', '선물 상자', 'VIP 포인트', '한 번 더', finalLabel, '오늘의 주인공', '아루 코인'];
    setScrollItems(scrollItemsRef.current);
    setScrollIndex(centerIndex);
    setOffsetRows(centerIndex);
    setState({ name: '스페셜 룰렛', username: '테스트 시청자', label: finalLabel, value: finalLabel });
    setBatchProgress({ id: 'preview', done: 2, total: 5 });
    setError(null);
    setActive(true);
  }, [previewMode]);

  // Simple SFX using fixed server files
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const startAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const endAudioRef = React.useRef<HTMLAudioElement | null>(null);
  React.useEffect(() => {
    // Prefer front-end static assets at /public/files (served at same-origin /files)
    // Fallback to backend API host if same-origin is missing
    try {
      const loc = (typeof window !== 'undefined' ? window.location : { origin: 'https://arubot.yuaru.com' }) as Location | any;
      const backendBase = getRouletteApiBase();
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
      const loc = (typeof window !== 'undefined' ? window.location : { origin: 'https://arubot.yuaru.com' }) as Location | any;
      const backendBase = getRouletteApiBase();
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
      const url = getRouletteWsUrl(token);
      
      updateDebugInfo({ 
        connectionState: 'connecting',
        lastConnectionTime: Date.now()
      });
      updateDebugInfo((prev) => ({ connectionAttempts: prev.connectionAttempts + 1 }));

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
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
      };

      ws.onmessage = async (ev) => {
        try {
          updateDebugInfo((prev) => ({ 
            lastMessageTime: Date.now(),
            messageCount: prev.messageCount + 1
          }));

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
                applyServerLook(payload.theme);
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
          const reason = String(event.reason || '').trim();
          const serverErrorMsg = reason || (
            event.code === 1008 ? '토큰이 유효하지 않습니다' :
            event.code === 1009 ? '채널 접근이 거부되었습니다' :
            event.code === 1012 ? '채널을 찾을 수 없습니다' :
            '서버 검증 실패'
          );
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
        if (!event.wasClean && reconnectAttemptsRef.current < 3) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000); // 지수 백오프
          reconnectAttemptsRef.current += 1;
          updateDebugInfo({ reconnectAttempts: reconnectAttemptsRef.current });

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
  }, [previewMode, token, validateToken, validateMessageChannelId, updateDebugInfo, sfxOn, channelValidationOn, primeAudio, applyServerLook]);

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
  }, [playEndSfx, applyServerLook]);

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
      applyServerLook(payload.theme);
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

  type RouletteSkin = {
    id: Theme;
    label: string;
    overlay: OverlayKind;
    palette: string[];
    css: React.CSSProperties & Record<`--roulette-${string}`, string>;
  };

  const ROULETTE_SKINS: Record<Theme, RouletteSkin> = {
    studio: {
      id: 'studio',
      label: '스튜디오',
      overlay: 'grid',
      palette: ['#f8fafc', '#111827', '#8b5cf6', '#06b6d4', '#f59e0b', '#e5e7eb', '#22c55e', '#64748b'],
      css: {
        '--roulette-panel': 'rgba(15, 18, 28, 0.80)',
        '--roulette-panel-strong': 'rgba(10, 13, 22, 0.94)',
        '--roulette-line': 'rgba(248, 250, 252, 0.24)',
        '--roulette-text': '#f8fafc',
        '--roulette-muted': 'rgba(226, 232, 240, 0.72)',
        '--roulette-accent': '#f8fafc',
        '--roulette-accent-2': '#38bdf8',
        '--roulette-result': '#ffffff',
        '--roulette-shadow': 'rgba(148, 163, 184, 0.30)',
      },
    },
    prism: {
      id: 'prism',
      label: '프리즘',
      overlay: 'scan',
      palette: ['#22d3ee', '#f0abfc', '#bef264', '#fb7185', '#a78bfa', '#67e8f9', '#facc15', '#34d399'],
      css: {
        '--roulette-panel': 'rgba(16, 13, 32, 0.77)',
        '--roulette-panel-strong': 'rgba(20, 16, 42, 0.93)',
        '--roulette-line': 'rgba(217, 249, 157, 0.30)',
        '--roulette-text': '#fffaff',
        '--roulette-muted': 'rgba(237, 233, 254, 0.72)',
        '--roulette-accent': '#22d3ee',
        '--roulette-accent-2': '#bef264',
        '--roulette-result': '#eaff9a',
        '--roulette-shadow': 'rgba(34, 211, 238, 0.32)',
      },
    },
    aurora: {
      id: 'aurora',
      label: '오로라',
      overlay: 'shimmer',
      palette: ['#5eead4', '#8b5cf6', '#2dd4bf', '#c4b5fd', '#22c55e', '#38bdf8', '#a7f3d0', '#818cf8'],
      css: {
        '--roulette-panel': 'rgba(4, 24, 29, 0.76)',
        '--roulette-panel-strong': 'rgba(8, 19, 37, 0.92)',
        '--roulette-line': 'rgba(94, 234, 212, 0.30)',
        '--roulette-text': '#f0fffb',
        '--roulette-muted': 'rgba(209, 250, 244, 0.70)',
        '--roulette-accent': '#5eead4',
        '--roulette-accent-2': '#c4b5fd',
        '--roulette-result': '#ccfbf1',
        '--roulette-shadow': 'rgba(94, 234, 212, 0.34)',
      },
    },
    velvet: {
      id: 'velvet',
      label: '벨벳',
      overlay: 'gold-sweep',
      palette: ['#f9d27d', '#7f1d1d', '#be123c', '#fbbf24', '#581c87', '#fecdd3', '#b45309', '#fff7ed'],
      css: {
        '--roulette-panel': 'rgba(38, 9, 20, 0.80)',
        '--roulette-panel-strong': 'rgba(50, 10, 24, 0.94)',
        '--roulette-line': 'rgba(249, 210, 125, 0.32)',
        '--roulette-text': '#fff7ed',
        '--roulette-muted': 'rgba(255, 235, 205, 0.70)',
        '--roulette-accent': '#f9d27d',
        '--roulette-accent-2': '#fecdd3',
        '--roulette-result': '#ffe8a3',
        '--roulette-shadow': 'rgba(190, 18, 60, 0.34)',
      },
    },
    mono: {
      id: 'mono',
      label: '모노',
      overlay: 'noise',
      palette: ['#f9fafb', '#1f2937', '#d1d5db', '#4b5563', '#ffffff', '#111827', '#9ca3af', '#e5e7eb'],
      css: {
        '--roulette-panel': 'rgba(8, 10, 14, 0.84)',
        '--roulette-panel-strong': 'rgba(3, 5, 8, 0.96)',
        '--roulette-line': 'rgba(255, 255, 255, 0.26)',
        '--roulette-text': '#f9fafb',
        '--roulette-muted': 'rgba(229, 231, 235, 0.68)',
        '--roulette-accent': '#f9fafb',
        '--roulette-accent-2': '#a3a3a3',
        '--roulette-result': '#ffffff',
        '--roulette-shadow': 'rgba(255, 255, 255, 0.20)',
      },
    },
    deco: {
      id: 'deco',
      label: '아르데코',
      overlay: 'gold-sweep',
      palette: ['#f8d77e', '#121212', '#d6a33f', '#2f2414', '#fff4bf', '#0b0d11', '#b8892f', '#2b1d0d'],
      css: {
        '--roulette-panel': 'rgba(16, 13, 10, 0.82)',
        '--roulette-panel-strong': 'rgba(8, 7, 6, 0.96)',
        '--roulette-line': 'rgba(248, 215, 126, 0.34)',
        '--roulette-text': '#fff4d2',
        '--roulette-muted': 'rgba(255, 234, 184, 0.68)',
        '--roulette-accent': '#f8d77e',
        '--roulette-accent-2': '#c9912a',
        '--roulette-result': '#fff2b6',
        '--roulette-shadow': 'rgba(201, 145, 42, 0.36)',
      },
    },
    crystal: {
      id: 'crystal',
      label: '크리스탈',
      overlay: 'snow',
      palette: ['#e0faff', '#7dd3fc', '#c4b5fd', '#38bdf8', '#f8feff', '#93c5fd', '#67e8f9', '#dbeafe'],
      css: {
        '--roulette-panel': 'rgba(6, 21, 36, 0.74)',
        '--roulette-panel-strong': 'rgba(6, 30, 52, 0.92)',
        '--roulette-line': 'rgba(186, 230, 253, 0.34)',
        '--roulette-text': '#f8feff',
        '--roulette-muted': 'rgba(224, 247, 255, 0.72)',
        '--roulette-accent': '#7dd3fc',
        '--roulette-accent-2': '#c4b5fd',
        '--roulette-result': '#f0fdff',
        '--roulette-shadow': 'rgba(125, 211, 252, 0.38)',
      },
    },
    ink: {
      id: 'ink',
      label: '수묵',
      overlay: 'noise',
      palette: ['#f7f7f2', '#1f2933', '#e8ecef', '#0b0d10', '#d9dde0', '#3b3f46', '#c1121f', '#f5f5f0'],
      css: {
        '--roulette-panel': 'rgba(10, 11, 12, 0.82)',
        '--roulette-panel-strong': 'rgba(3, 4, 5, 0.96)',
        '--roulette-line': 'rgba(255, 255, 255, 0.24)',
        '--roulette-text': '#f7f7f2',
        '--roulette-muted': 'rgba(230, 232, 232, 0.66)',
        '--roulette-accent': '#f7f7f2',
        '--roulette-accent-2': '#c1121f',
        '--roulette-result': '#fff8f4',
        '--roulette-shadow': 'rgba(193, 18, 31, 0.30)',
      },
    },
    nova: {
      id: 'nova',
      label: '노바',
      overlay: 'midnight',
      palette: ['#c4b5fd', '#38bdf8', '#312e81', '#f0abfc', '#0f172a', '#93c5fd', '#fef08a', '#818cf8'],
      css: {
        '--roulette-panel': 'rgba(8, 9, 34, 0.80)',
        '--roulette-panel-strong': 'rgba(6, 6, 26, 0.94)',
        '--roulette-line': 'rgba(196, 181, 253, 0.34)',
        '--roulette-text': '#f7f4ff',
        '--roulette-muted': 'rgba(226, 221, 255, 0.68)',
        '--roulette-accent': '#c4b5fd',
        '--roulette-accent-2': '#38bdf8',
        '--roulette-result': '#fef08a',
        '--roulette-shadow': 'rgba(124, 58, 237, 0.40)',
      },
    },
    ceramic: {
      id: 'ceramic',
      label: '세라믹',
      overlay: 'shimmer',
      palette: ['#f8fbff', '#1d4ed8', '#dbeafe', '#60a5fa', '#eff6ff', '#2563eb', '#ffffff', '#93c5fd'],
      css: {
        '--roulette-panel': 'rgba(8, 24, 48, 0.74)',
        '--roulette-panel-strong': 'rgba(6, 18, 42, 0.92)',
        '--roulette-line': 'rgba(147, 197, 253, 0.34)',
        '--roulette-text': '#f8fbff',
        '--roulette-muted': 'rgba(219, 234, 254, 0.72)',
        '--roulette-accent': '#60a5fa',
        '--roulette-accent-2': '#eff6ff',
        '--roulette-result': '#ffffff',
        '--roulette-shadow': 'rgba(37, 99, 235, 0.34)',
      },
    },
    arcade: {
      id: 'arcade',
      label: '아케이드',
      overlay: 'scan',
      palette: ['#67e8f9', '#f0abfc', '#bef264', '#111827', '#22d3ee', '#fb7185', '#facc15', '#a78bfa'],
      css: {
        '--roulette-panel': 'rgba(8, 7, 24, 0.80)',
        '--roulette-panel-strong': 'rgba(4, 5, 18, 0.94)',
        '--roulette-line': 'rgba(103, 232, 249, 0.34)',
        '--roulette-text': '#f5fbff',
        '--roulette-muted': 'rgba(224, 242, 254, 0.68)',
        '--roulette-accent': '#67e8f9',
        '--roulette-accent-2': '#bef264',
        '--roulette-result': '#f8ff9a',
        '--roulette-shadow': 'rgba(240, 171, 252, 0.36)',
      },
    },
    ocean: {
      id: 'ocean',
      label: '오션',
      overlay: 'snow',
      palette: ['#7dd3fc', '#0ea5e9', '#5eead4', '#0369a1', '#bae6fd', '#67e8f9', '#14b8a6', '#e0f2fe'],
      css: {
        '--roulette-panel': 'rgba(4, 24, 43, 0.78)',
        '--roulette-panel-strong': 'rgba(3, 31, 56, 0.93)',
        '--roulette-line': 'rgba(125, 211, 252, 0.32)',
        '--roulette-text': '#f0fbff',
        '--roulette-muted': 'rgba(224, 242, 254, 0.72)',
        '--roulette-accent': '#7dd3fc',
        '--roulette-accent-2': '#5eead4',
        '--roulette-result': '#dffcff',
        '--roulette-shadow': 'rgba(14, 165, 233, 0.35)',
      },
    },
    solar: {
      id: 'solar',
      label: '솔라',
      overlay: 'sunset',
      palette: ['#fbbf24', '#fb923c', '#f97316', '#fde68a', '#ef4444', '#fed7aa', '#f59e0b', '#fff7ed'],
      css: {
        '--roulette-panel': 'rgba(38, 18, 8, 0.78)',
        '--roulette-panel-strong': 'rgba(54, 23, 9, 0.93)',
        '--roulette-line': 'rgba(251, 191, 36, 0.32)',
        '--roulette-text': '#fff8ed',
        '--roulette-muted': 'rgba(255, 232, 195, 0.70)',
        '--roulette-accent': '#fbbf24',
        '--roulette-accent-2': '#fb923c',
        '--roulette-result': '#fff0b3',
        '--roulette-shadow': 'rgba(249, 115, 22, 0.34)',
      },
    },
    classic: {
      id: 'classic',
      label: '스튜디오',
      overlay: 'none',
      palette: ['#44f5b4', '#1f8f76', '#f7d66b', '#ff7b8f', '#7bb7ff', '#c4f970', '#41d7ff', '#ffb36b'],
      css: {
        '--roulette-panel': 'rgba(5, 12, 20, 0.76)',
        '--roulette-panel-strong': 'rgba(7, 18, 28, 0.92)',
        '--roulette-line': 'rgba(180, 255, 231, 0.24)',
        '--roulette-text': '#f5fffb',
        '--roulette-muted': 'rgba(223, 255, 246, 0.68)',
        '--roulette-accent': '#44f5b4',
        '--roulette-accent-2': '#f7d66b',
        '--roulette-result': '#f8ffcf',
        '--roulette-shadow': 'rgba(20, 245, 184, 0.32)',
      },
    },
    fire: {
      id: 'fire',
      label: '솔라',
      overlay: 'embers',
      palette: ['#ffb86b', '#ff6b40', '#ffd166', '#f94144', '#f8961e', '#f3722c', '#ffe66d', '#ff477e'],
      css: {
        '--roulette-panel': 'rgba(31, 8, 5, 0.78)',
        '--roulette-panel-strong': 'rgba(42, 10, 5, 0.92)',
        '--roulette-line': 'rgba(255, 190, 111, 0.28)',
        '--roulette-text': '#fff8ef',
        '--roulette-muted': 'rgba(255, 231, 203, 0.68)',
        '--roulette-accent': '#ff9d42',
        '--roulette-accent-2': '#ffe66d',
        '--roulette-result': '#fff0b8',
        '--roulette-shadow': 'rgba(255, 112, 67, 0.34)',
      },
    },
    ice: {
      id: 'ice',
      label: '오션',
      overlay: 'snow',
      palette: ['#b7f7ff', '#62d2ff', '#d7fbff', '#7dd3fc', '#bae6fd', '#a5f3fc', '#93c5fd', '#e0f2fe'],
      css: {
        '--roulette-panel': 'rgba(4, 21, 33, 0.72)',
        '--roulette-panel-strong': 'rgba(3, 31, 49, 0.9)',
        '--roulette-line': 'rgba(186, 230, 253, 0.30)',
        '--roulette-text': '#f3fbff',
        '--roulette-muted': 'rgba(225, 247, 255, 0.70)',
        '--roulette-accent': '#8ee7ff',
        '--roulette-accent-2': '#c7f9ff',
        '--roulette-result': '#e7fbff',
        '--roulette-shadow': 'rgba(125, 211, 252, 0.34)',
      },
    },
    cyber: {
      id: 'cyber',
      label: '네온',
      overlay: 'scan',
      palette: ['#f0abfc', '#22d3ee', '#bef264', '#a78bfa', '#fb7185', '#67e8f9', '#e879f9', '#facc15'],
      css: {
        '--roulette-panel': 'rgba(17, 7, 31, 0.78)',
        '--roulette-panel-strong': 'rgba(20, 8, 42, 0.93)',
        '--roulette-line': 'rgba(240, 171, 252, 0.30)',
        '--roulette-text': '#fff6ff',
        '--roulette-muted': 'rgba(244, 214, 255, 0.68)',
        '--roulette-accent': '#f0abfc',
        '--roulette-accent-2': '#bef264',
        '--roulette-result': '#d9ff8f',
        '--roulette-shadow': 'rgba(217, 70, 239, 0.35)',
      },
    },
    gold: {
      id: 'gold',
      label: '골드',
      overlay: 'shimmer',
      palette: ['#ffd66b', '#b8892f', '#fff1b8', '#f4a261', '#d4af37', '#ffe8a3', '#c58b28', '#fff7d6'],
      css: {
        '--roulette-panel': 'rgba(22, 18, 9, 0.80)',
        '--roulette-panel-strong': 'rgba(34, 25, 10, 0.94)',
        '--roulette-line': 'rgba(255, 214, 107, 0.34)',
        '--roulette-text': '#fff8e1',
        '--roulette-muted': 'rgba(255, 238, 194, 0.68)',
        '--roulette-accent': '#ffd66b',
        '--roulette-accent-2': '#fff1b8',
        '--roulette-result': '#fff5bf',
        '--roulette-shadow': 'rgba(255, 214, 107, 0.36)',
      },
    },
    pastel: {
      id: 'pastel',
      label: '프리즘',
      overlay: 'confetti',
      palette: ['#fecdd3', '#bfdbfe', '#bbf7d0', '#fde68a', '#ddd6fe', '#fbcfe8', '#a7f3d0', '#fed7aa'],
      css: {
        '--roulette-panel': 'rgba(43, 24, 38, 0.68)',
        '--roulette-panel-strong': 'rgba(52, 28, 46, 0.88)',
        '--roulette-line': 'rgba(255, 214, 232, 0.30)',
        '--roulette-text': '#fff7fb',
        '--roulette-muted': 'rgba(255, 228, 239, 0.70)',
        '--roulette-accent': '#f9a8d4',
        '--roulette-accent-2': '#fde68a',
        '--roulette-result': '#fff7ad',
        '--roulette-shadow': 'rgba(249, 168, 212, 0.34)',
      },
    },
    forest: {
      id: 'forest',
      label: '오로라',
      overlay: 'leaves',
      palette: ['#86efac', '#22c55e', '#bef264', '#14b8a6', '#4ade80', '#a3e635', '#34d399', '#bbf7d0'],
      css: {
        '--roulette-panel': 'rgba(4, 28, 20, 0.76)',
        '--roulette-panel-strong': 'rgba(4, 39, 26, 0.91)',
        '--roulette-line': 'rgba(134, 239, 172, 0.28)',
        '--roulette-text': '#f1fff5',
        '--roulette-muted': 'rgba(222, 255, 229, 0.68)',
        '--roulette-accent': '#86efac',
        '--roulette-accent-2': '#bef264',
        '--roulette-result': '#ecffc8',
        '--roulette-shadow': 'rgba(74, 222, 128, 0.32)',
      },
    },
    sakura: {
      id: 'sakura',
      label: '사쿠라',
      overlay: 'sakura',
      palette: ['#fda4af', '#fecdd3', '#f9a8d4', '#f0abfc', '#ffe4e6', '#fb7185', '#fbcfe8', '#fef3c7'],
      css: {
        '--roulette-panel': 'rgba(44, 16, 31, 0.72)',
        '--roulette-panel-strong': 'rgba(54, 20, 37, 0.90)',
        '--roulette-line': 'rgba(253, 164, 175, 0.30)',
        '--roulette-text': '#fff7fa',
        '--roulette-muted': 'rgba(255, 225, 233, 0.70)',
        '--roulette-accent': '#fda4af',
        '--roulette-accent-2': '#fef3c7',
        '--roulette-result': '#ffe5ee',
        '--roulette-shadow': 'rgba(251, 113, 133, 0.35)',
      },
    },
    midnight: {
      id: 'midnight',
      label: '모노',
      overlay: 'midnight',
      palette: ['#93c5fd', '#6366f1', '#c4b5fd', '#38bdf8', '#818cf8', '#e0e7ff', '#a5b4fc', '#67e8f9'],
      css: {
        '--roulette-panel': 'rgba(5, 9, 24, 0.80)',
        '--roulette-panel-strong': 'rgba(8, 13, 35, 0.94)',
        '--roulette-line': 'rgba(147, 197, 253, 0.28)',
        '--roulette-text': '#f4f7ff',
        '--roulette-muted': 'rgba(220, 230, 255, 0.68)',
        '--roulette-accent': '#93c5fd',
        '--roulette-accent-2': '#c4b5fd',
        '--roulette-result': '#e0e7ff',
        '--roulette-shadow': 'rgba(99, 102, 241, 0.38)',
      },
    },
    sunset: {
      id: 'sunset',
      label: '솔라',
      overlay: 'sunset',
      palette: ['#fbbf24', '#fb7185', '#fdba74', '#f97316', '#fde68a', '#fca5a5', '#f59e0b', '#fef3c7'],
      css: {
        '--roulette-panel': 'rgba(38, 16, 11, 0.78)',
        '--roulette-panel-strong': 'rgba(50, 19, 11, 0.92)',
        '--roulette-line': 'rgba(251, 191, 36, 0.30)',
        '--roulette-text': '#fff8f0',
        '--roulette-muted': 'rgba(255, 226, 204, 0.68)',
        '--roulette-accent': '#fbbf24',
        '--roulette-accent-2': '#fb7185',
        '--roulette-result': '#fff0bb',
        '--roulette-shadow': 'rgba(249, 115, 22, 0.34)',
      },
    },
  };

  const t = ROULETTE_SKINS[(serverTheme || theme || 'studio') as Theme] || ROULETTE_SKINS.studio;
  const skinChrome = React.useMemo(() => {
    const id = t.id;
    if (id === 'deco') {
      return {
        metal: 'linear-gradient(135deg, rgba(255,244,191,0.30), rgba(28,22,13,0.86) 22%, rgba(5,5,5,0.96) 52%, rgba(201,145,42,0.34) 78%, rgba(255,244,191,0.22))',
        glass: 'linear-gradient(180deg, rgba(255,244,191,0.18), rgba(0,0,0,0.62) 34%, rgba(18,14,8,0.80) 78%, rgba(201,145,42,0.12)), repeating-linear-gradient(90deg, transparent 0 34px, rgba(255,244,191,0.08) 34px 36px)',
        bevel: 'linear-gradient(90deg, transparent, rgba(255,244,191,0.88), rgba(201,145,42,0.72), rgba(255,244,191,0.52), transparent)',
        shadow: '0 34px 94px rgba(5,5,5,0.48), 0 0 72px var(--roulette-shadow)',
        labelBg: 'rgba(255,244,191,0.58)',
      };
    }
    if (id === 'crystal') {
      return {
        metal: 'linear-gradient(135deg, rgba(248,254,255,0.34), rgba(125,211,252,0.24) 26%, rgba(7,20,38,0.82) 54%, rgba(196,181,253,0.26) 82%, rgba(248,254,255,0.20))',
        glass: 'linear-gradient(180deg, rgba(248,254,255,0.22), rgba(15,23,42,0.46) 36%, rgba(6,30,52,0.70) 78%, rgba(248,254,255,0.14)), linear-gradient(120deg, transparent 0 36%, rgba(255,255,255,0.14) 38%, transparent 40% 64%, rgba(255,255,255,0.10) 66%, transparent 68%)',
        bevel: 'linear-gradient(90deg, transparent, rgba(248,254,255,0.86), rgba(125,211,252,0.72), rgba(196,181,253,0.68), transparent)',
        shadow: '0 32px 90px rgba(6,21,36,0.42), 0 0 78px var(--roulette-shadow)',
        labelBg: 'rgba(248,254,255,0.62)',
      };
    }
    if (id === 'ink') {
      return {
        metal: 'linear-gradient(135deg, rgba(247,247,242,0.20), rgba(31,41,51,0.48) 30%, rgba(2,3,4,0.96) 58%, rgba(193,18,31,0.16))',
        glass: 'linear-gradient(180deg, rgba(247,247,242,0.14), rgba(0,0,0,0.54) 32%, rgba(10,11,12,0.78) 76%, rgba(193,18,31,0.08)), radial-gradient(circle at 22% 18%, rgba(255,255,255,0.12), transparent 28%)',
        bevel: 'linear-gradient(90deg, transparent, rgba(247,247,242,0.76), rgba(193,18,31,0.54), rgba(247,247,242,0.42), transparent)',
        shadow: '0 32px 90px rgba(0,0,0,0.50), 0 0 64px var(--roulette-shadow)',
        labelBg: 'rgba(247,247,242,0.58)',
      };
    }
    if (id === 'nova') {
      return {
        metal: 'linear-gradient(135deg, rgba(196,181,253,0.28), rgba(49,46,129,0.40) 30%, rgba(5,6,24,0.94) 58%, rgba(56,189,248,0.20))',
        glass: 'radial-gradient(circle at 70% 22%, rgba(254,240,138,0.15), transparent 26%), linear-gradient(180deg, rgba(196,181,253,0.18), rgba(0,0,0,0.54) 34%, rgba(8,9,34,0.78) 78%, rgba(56,189,248,0.10))',
        bevel: 'linear-gradient(90deg, transparent, rgba(196,181,253,0.76), rgba(56,189,248,0.72), rgba(254,240,138,0.54), transparent)',
        shadow: '0 34px 96px rgba(8,9,34,0.52), 0 0 86px var(--roulette-shadow)',
        labelBg: 'rgba(196,181,253,0.56)',
      };
    }
    if (id === 'ceramic') {
      return {
        metal: 'linear-gradient(135deg, rgba(248,251,255,0.30), rgba(29,78,216,0.30) 31%, rgba(6,18,42,0.88) 56%, rgba(239,246,255,0.22))',
        glass: 'linear-gradient(180deg, rgba(248,251,255,0.20), rgba(6,18,42,0.48) 34%, rgba(8,24,48,0.72) 78%, rgba(239,246,255,0.14)), repeating-linear-gradient(135deg, transparent 0 28px, rgba(239,246,255,0.07) 28px 30px)',
        bevel: 'linear-gradient(90deg, transparent, rgba(248,251,255,0.86), rgba(96,165,250,0.70), rgba(239,246,255,0.72), transparent)',
        shadow: '0 32px 90px rgba(8,24,48,0.42), 0 0 72px var(--roulette-shadow)',
        labelBg: 'rgba(239,246,255,0.62)',
      };
    }
    if (id === 'arcade') {
      return {
        metal: 'linear-gradient(135deg, rgba(103,232,249,0.24), rgba(240,171,252,0.28) 28%, rgba(4,5,18,0.94) 54%, rgba(190,242,100,0.24)), repeating-linear-gradient(90deg, transparent 0 18px, rgba(255,255,255,0.055) 18px 20px)',
        glass: 'linear-gradient(180deg, rgba(103,232,249,0.16), rgba(0,0,0,0.56) 34%, rgba(8,7,24,0.76) 78%, rgba(190,242,100,0.10)), repeating-linear-gradient(0deg, rgba(255,255,255,0.055) 0 1px, transparent 1px 9px)',
        bevel: 'linear-gradient(90deg, transparent, rgba(103,232,249,0.82), rgba(240,171,252,0.72), rgba(190,242,100,0.72), transparent)',
        shadow: '0 32px 90px rgba(4,5,18,0.48), 0 0 78px var(--roulette-shadow)',
        labelBg: 'rgba(103,232,249,0.56)',
      };
    }
    if (id === 'velvet' || id === 'gold' || id === 'solar') {
      return {
        metal: 'linear-gradient(135deg, rgba(255,242,194,0.34), rgba(94,38,9,0.36) 32%, rgba(12,8,5,0.88) 52%, rgba(255,194,92,0.26))',
        glass: 'linear-gradient(180deg, rgba(255,236,181,0.20), rgba(0,0,0,0.56) 34%, rgba(23,8,4,0.74) 78%, rgba(255,236,181,0.12))',
        bevel: 'linear-gradient(90deg, transparent, rgba(255,236,181,0.82), rgba(255,255,255,0.62), transparent)',
        shadow: '0 32px 90px rgba(25,9,4,0.46), 0 0 76px var(--roulette-shadow)',
        labelBg: 'rgba(255,244,214,0.62)',
      };
    }
    if (id === 'mono' || id === 'studio') {
      return {
        metal: 'linear-gradient(135deg, rgba(255,255,255,0.26), rgba(31,41,55,0.42) 32%, rgba(3,5,8,0.90) 55%, rgba(255,255,255,0.16))',
        glass: 'linear-gradient(180deg, rgba(255,255,255,0.18), rgba(0,0,0,0.50) 32%, rgba(0,0,0,0.72) 76%, rgba(255,255,255,0.10))',
        bevel: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.78), rgba(148,163,184,0.56), transparent)',
        shadow: '0 32px 90px rgba(0,0,0,0.42), 0 0 64px var(--roulette-shadow)',
        labelBg: 'rgba(255,255,255,0.58)',
      };
    }
    if (id === 'sakura') {
      return {
        metal: 'linear-gradient(135deg, rgba(255,228,236,0.34), rgba(115,28,61,0.38) 35%, rgba(36,11,24,0.88) 56%, rgba(253,164,175,0.24))',
        glass: 'linear-gradient(180deg, rgba(255,228,236,0.20), rgba(0,0,0,0.48) 34%, rgba(44,16,31,0.72) 78%, rgba(255,228,236,0.12))',
        bevel: 'linear-gradient(90deg, transparent, rgba(255,228,236,0.80), rgba(253,164,175,0.62), transparent)',
        shadow: '0 32px 90px rgba(44,16,31,0.40), 0 0 72px var(--roulette-shadow)',
        labelBg: 'rgba(255,228,236,0.58)',
      };
    }
    return {
      metal: 'linear-gradient(135deg, rgba(255,255,255,0.18), rgba(34,211,238,0.20) 28%, rgba(7,10,22,0.88) 55%, rgba(190,242,100,0.18))',
      glass: 'linear-gradient(180deg, rgba(255,255,255,0.15), rgba(0,0,0,0.46) 32%, rgba(4,12,24,0.72) 76%, rgba(255,255,255,0.10))',
      bevel: 'linear-gradient(90deg, transparent, var(--roulette-accent-2), rgba(255,255,255,0.64), var(--roulette-accent), transparent)',
      shadow: '0 32px 90px rgba(0,0,0,0.38), 0 0 76px var(--roulette-shadow)',
      labelBg: 'rgba(255,255,255,0.56)',
    };
  }, [t.id]);
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
@keyframes result-lock { 0% { filter: brightness(1); letter-spacing: 0; } 38% { filter: brightness(1.55); letter-spacing: 0.025em; } 100% { filter: brightness(1); letter-spacing: 0; } }
.roulette-result-lock { animation: result-lock 900ms cubic-bezier(.2,.8,.2,1) both; }
@media (prefers-reduced-motion: reduce) {
  .roulette-result-lock,
  .ember,
  .flake,
  .scanline,
  .shimmer,
  .gold-sweep,
  .confetti,
  .leaf,
  .petal,
  .star { animation: none !important; }
}

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
@media (max-width: 520px) {
  .roulette-wheel-ornaments .roulette-wheel-ornament-secondary { display: none; }
  .roulette-wheel-ornaments { opacity: 0.78; }
}
    `;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
    return () => { /* keep global styles for the session */ };
  }, []);


  const wheelSource = (poolRef.current.length ? poolRef.current : scrollItemsRef.current).slice(0, 8);
  const wheelFallback = ['행운', '보너스', '성공', '한 번 더', '반짝', '선물', '스타', '당첨'];
  const wheelItems = Array.from({ length: 8 }).map((_, index) => String(wheelSource[index] || wheelFallback[index] || '룰렛'));
  const wheelLabelLines = React.useMemo(() => wheelItems.map(splitWheelLabel), [wheelItems]);
  const wheelRotation = offsetRows * 24;
  const wheelSkinFamily = React.useMemo(() => getWheelSkinFamily(t.id), [t.id]);
  const selectedWheelIndex = React.useMemo(() => {
    const target = String(state.label || state.value || '').replace(/\s+/g, '').trim();
    if (!target) return -1;
    return wheelItems.findIndex((item) => item.replace(/\s+/g, '').trim() === target);
  }, [state.label, state.value, wheelItems]);

  const renderReelWindow = () => (
    <div className="relative w-full max-w-[760px]">
      <div className="absolute inset-[-10px] rounded-[8px]" style={{ background: 'linear-gradient(135deg, var(--roulette-accent-2), transparent 30%, transparent 70%, var(--roulette-accent))', filter: 'blur(16px)', opacity: 0.58 }} />
      <div className="relative overflow-hidden rounded-[8px] border p-[clamp(8px,1.2vw,14px)]" style={{ borderColor: 'rgba(255,255,255,0.30)', background: skinChrome.metal, boxShadow: '0 24px 64px rgba(0,0,0,0.42), inset 0 0 0 1px rgba(255,255,255,0.10)' }}>
        <div className="pointer-events-none absolute inset-x-[4%] top-0 h-px" style={{ background: skinChrome.bevel, boxShadow: '0 0 18px var(--roulette-shadow)' }} />
        <div className="pointer-events-none absolute inset-x-[4%] bottom-0 h-px" style={{ background: skinChrome.bevel, boxShadow: '0 0 18px var(--roulette-shadow)' }} />
        <div className="mb-2 flex items-center justify-between px-1 text-[11px] font-black tracking-[0.18em]" style={{ color: 'var(--roulette-muted)' }}>
          <span>RESULT</span>
          <span style={{ color: 'var(--roulette-accent-2)' }}>{active ? 'LIVE' : 'READY'}</span>
        </div>
        <div className="relative h-[clamp(180px,23vw,330px)] overflow-hidden rounded-[8px] border" style={{ borderColor: 'rgba(255,255,255,0.14)', background: skinChrome.glass }}>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[34%]" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.16), transparent)' }} />
          <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-[18%]" style={{ background: 'linear-gradient(90deg, rgba(0,0,0,0.58), transparent)' }} />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-[18%]" style={{ background: 'linear-gradient(270deg, rgba(0,0,0,0.58), transparent)' }} />
          <div className="pointer-events-none absolute inset-x-[10%] top-1/2 z-20 h-px -translate-y-1/2" style={{ background: 'linear-gradient(90deg, transparent, var(--roulette-accent-2), var(--roulette-accent), transparent)', boxShadow: '0 0 22px var(--roulette-shadow)' }} />
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-30 h-0 w-0 -translate-x-1/2 -translate-y-[calc(50%+clamp(58px,8vw,122px))] border-x-[14px] border-b-[20px] border-x-transparent" style={{ borderBottomColor: 'var(--roulette-accent-2)', filter: 'drop-shadow(0 0 14px var(--roulette-shadow))' }} />
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-30 h-0 w-0 -translate-x-1/2 translate-y-[clamp(58px,8vw,122px)] border-x-[14px] border-t-[20px] border-x-transparent" style={{ borderTopColor: 'var(--roulette-accent-2)', filter: 'drop-shadow(0 0 14px var(--roulette-shadow))' }} />
          <div ref={reelRef} className="relative h-full w-full overflow-hidden">
            <div ref={rowRef} className="invisible absolute left-0 top-1/2 w-full -translate-y-1/2">
              <div className="px-4 text-center text-[clamp(62px,8.6vw,132px)] font-black leading-tight">8</div>
            </div>
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
                <div className="absolute left-0 right-0 top-0 flex flex-col items-stretch will-change-transform" style={{ transform: `translateY(${transformPx}px)` }}>
                  {Array.from({ length: windowRows }).map((_, k) => {
                    const idx = firstIndex + k;
                    const label = labelFor(idx);
                    const isCenter = idx === Math.round(center);
                    return (
                      <div key={idx} className="flex w-full items-center justify-center px-4" style={{ height: rh }}>
                        <div
                          className={`max-w-full truncate text-center text-[clamp(62px,8.6vw,132px)] font-black leading-tight transition-transform duration-150 ${isCenter ? 'roulette-result-lock' : ''}`}
                          style={{
                            color: isCenter ? 'var(--roulette-result)' : 'rgba(255,255,255,0.18)',
                            textShadow: isCenter ? '0 0 26px var(--roulette-shadow), 0 0 10px var(--roulette-accent), 0 12px 28px rgba(0,0,0,0.62)' : 'none',
                            transform: isCenter ? 'scale(1.02)' : 'scale(0.86)',
                          }}
                        >
                          {label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );

  const renderIdentity = (compact = false) => (
    <div className={compact ? 'grid justify-items-center gap-3 text-center' : 'grid gap-[clamp(14px,2vw,24px)]'}>
      <div className="grid h-[clamp(54px,5vw,78px)] w-[clamp(54px,5vw,78px)] place-items-center rounded-full border" style={{ borderColor: 'var(--roulette-line)', background: 'radial-gradient(circle, rgba(255,255,255,0.08), rgba(0,0,0,0.20))', boxShadow: '0 0 28px var(--roulette-shadow), inset 0 0 22px rgba(255,255,255,0.08)' }}>
        <div className="h-[45%] w-[45%]" style={{ clipPath: 'polygon(50% 0, 61% 37%, 100% 50%, 61% 63%, 50% 100%, 39% 63%, 0 50%, 39% 37%)', background: 'var(--roulette-text)', filter: 'drop-shadow(0 0 14px var(--roulette-accent))' }} />
      </div>
      <h1 className="break-keep text-[clamp(30px,4.2vw,64px)] font-black leading-[1.02]" style={{ textShadow: '0 10px 34px rgba(0,0,0,0.38)' }}>
        {state.name ? `${state.name}` : '룰렛'}
      </h1>
      <div className="flex max-w-[min(100%,410px)] items-center gap-3 rounded-[8px] border px-4 py-3" style={{ borderColor: 'var(--roulette-line)', background: 'rgba(255,255,255,0.055)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)' }}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border" style={{ borderColor: 'var(--roulette-line)', color: 'var(--roulette-accent-2)', background: 'rgba(0,0,0,0.28)' }}>
          <span className="h-4 w-4 rounded-full" style={{ background: 'currentColor', boxShadow: '0 14px 0 -5px currentColor' }} />
        </span>
        <p className="min-w-0 truncate text-[clamp(16px,1.6vw,26px)] font-extrabold leading-tight" style={{ color: 'var(--roulette-text)' }}>
          {state.username ? `${state.username}님` : '시청자명'}
        </p>
      </div>
      {batchProgress.id ? (
        <div className="grid max-w-[min(100%,410px)] gap-2">
          <div className="flex items-center justify-between text-[clamp(12px,1vw,14px)] font-black tracking-[0.14em]" style={{ color: 'var(--roulette-muted)' }}>
            <span>PROGRESS</span>
            <span style={{ color: 'var(--roulette-result)' }}>{batchProgress.done} / {batchProgress.total}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full border bg-black/36" style={{ borderColor: 'var(--roulette-line)' }}>
            <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, (batchProgress.done / Math.max(1, batchProgress.total)) * 100))}%`, background: 'linear-gradient(90deg, var(--roulette-accent), var(--roulette-accent-2))', boxShadow: '0 0 18px var(--roulette-shadow)' }} />
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      className="min-h-screen w-screen overflow-hidden text-white"
      style={{ backgroundAttachment: active ? 'fixed' as const : undefined, backgroundColor: 'transparent', ...t.css }}
    >
      {error ? (
        <div className="fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-[8px] border border-red-300/30 bg-black/70 px-3 py-2 text-[13px] font-semibold text-red-100 shadow-lg backdrop-blur-md">
          {error}
        </div>
      ) : null}

      <div className="grid h-[100dvh] w-full place-items-center p-[clamp(10px,2.2vw,28px)]">
        {layout === 'wheel' ? (
          <section
            aria-label="룰렛 휠 오버레이"
            className={`roulette-stage relative grid aspect-square w-[min(94vmin,790px)] place-items-center overflow-visible rounded-full transition-all duration-300 ${active ? 'scale-100 opacity-100' : 'pointer-events-none scale-[0.985] opacity-0'}`}
            style={{
              filter: 'drop-shadow(0 28px 70px rgba(0,0,0,0.46))',
              color: 'var(--roulette-text)',
              transitionDuration: FADE_MS + 'ms',
            }}
          >
            {active ? (
              <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
                {overlayEl}
              </div>
            ) : null}
            <div
              className="absolute inset-[-2.5%] rounded-full opacity-80"
              style={{
                background: 'radial-gradient(circle, var(--roulette-shadow), transparent 62%)',
                filter: 'blur(20px)',
              }}
            />
            <div
              className="absolute inset-0 rounded-full border"
              style={{
                borderColor: 'rgba(255,255,255,0.20)',
                background: `${skinChrome.metal}, radial-gradient(circle at 50% 42%, rgba(255,255,255,0.08), transparent 36%), radial-gradient(circle, var(--roulette-panel-strong), rgba(0,0,0,0.86) 72%)`,
                boxShadow: `${skinChrome.shadow}, inset 0 0 0 clamp(10px,1.7vmin,16px) rgba(255,255,255,0.035), inset 0 0 0 clamp(18px,3.2vmin,28px) rgba(0,0,0,0.36), inset 0 1px 0 rgba(255,255,255,0.18)`,
              }}
            />
            <WheelSkinOrnaments family={wheelSkinFamily} />
            {wheelSkinFamily === 'mono' ? Array.from({ length: 12 }).map((_, index) => (
              <div
                key={`rim-panel-${index}`}
                className="absolute left-1/2 top-1/2 h-[clamp(10px,2.2vmin,18px)] w-[clamp(28px,6.4vmin,52px)] rounded-[4px] border"
                style={{
                  borderColor: 'rgba(255,255,255,0.16)',
                  background: `linear-gradient(180deg, rgba(255,255,255,0.16), rgba(0,0,0,0.30)), ${skinChrome.metal}`,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 0 14px rgba(0,0,0,0.38)',
                  transform: `translate(-50%, -50%) rotate(${index * 30}deg) translateY(calc(-1 * min(44vmin, 362px)))`,
                }}
              />
            )) : null}
            <div
              className="absolute inset-[3.2%] rounded-full"
              style={{
                background: 'repeating-conic-gradient(from -1deg, rgba(255,255,255,0.34) 0deg 0.9deg, transparent 0.9deg 5.625deg)',
                opacity: 0.72,
                maskImage: 'radial-gradient(circle, transparent 65%, black 66%, black 72%, transparent 73%)',
                WebkitMaskImage: 'radial-gradient(circle, transparent 65%, black 66%, black 72%, transparent 73%)',
              }}
            />
            <div
              className="absolute inset-[5.8%] rounded-full"
              style={{
                background: 'conic-gradient(from 18deg, transparent, var(--roulette-accent-2), transparent 24%, transparent 50%, var(--roulette-accent), transparent 68%, transparent)',
                opacity: 0.62,
                filter: 'blur(1px)',
                boxShadow: '0 0 42px var(--roulette-shadow)',
                maskImage: 'radial-gradient(circle, transparent 58%, black 59%, black 66%, transparent 67%)',
                WebkitMaskImage: 'radial-gradient(circle, transparent 58%, black 59%, black 66%, transparent 67%)',
              }}
            />
            <div
              className="absolute inset-[8.8%] rounded-full"
              style={{
                background: 'radial-gradient(circle at 42% 30%, rgba(255,255,255,0.12), transparent 24%), radial-gradient(circle, rgba(0,0,0,0.04), rgba(0,0,0,0.36) 72%, rgba(255,255,255,0.08))',
                boxShadow: 'inset 0 0 0 clamp(3px,0.7vmin,7px) rgba(255,255,255,0.14), inset 0 0 56px rgba(0,0,0,0.42), 0 0 42px var(--roulette-shadow)',
              }}
            />
            <div
              className="absolute inset-[12.2%] rounded-full"
              style={{
                transform: `rotate(${wheelRotation}deg)`,
                background: 'radial-gradient(circle, transparent 46%, rgba(0,0,0,0.12) 47%, rgba(0,0,0,0.22) 72%, rgba(255,255,255,0.08) 73%, transparent 75%)',
                maskImage: 'radial-gradient(circle, transparent 0 43%, black 44%)',
                WebkitMaskImage: 'radial-gradient(circle, transparent 0 43%, black 44%)',
              }}
            >
              <WheelSegmentsSvg family={wheelSkinFamily} palette={t.palette} />
              <WheelSelectedSegment selectedIndex={selectedWheelIndex} />
              {Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={`divider-${index}`}
                  className="absolute left-1/2 top-1/2 h-[43%] w-[clamp(2px,0.34vmin,4px)] origin-top -translate-x-1/2"
                  style={{
                    transform: `rotate(${index * 45}deg)`,
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.85), var(--roulette-accent-2) 15%, rgba(0,0,0,0.18) 82%, transparent)',
                    boxShadow: '0 0 12px var(--roulette-shadow)',
                  }}
                />
              ))}
              {Array.from({ length: 16 }).map((_, index) => (
                <div
                  key={`jewel-${index}`}
                  className="absolute left-1/2 top-1/2 h-[clamp(7px,1.55vmin,13px)] w-[clamp(7px,1.55vmin,13px)] rounded-full border"
                  style={{
                    borderColor: 'rgba(255,255,255,0.56)',
                    background: index % 2 === 0 ? 'var(--roulette-accent-2)' : 'var(--roulette-accent)',
                    boxShadow: '0 0 14px var(--roulette-shadow), inset 0 1px 0 rgba(255,255,255,0.80)',
                    transform: `translate(-50%, -50%) rotate(${index * 22.5}deg) translateY(calc(-1 * min(39vmin, 303px)))`,
                  }}
                />
              ))}
              <WheelLabelsSvg labelLines={wheelLabelLines} selectedIndex={selectedWheelIndex} />
            </div>
            <div
              className="absolute left-1/2 top-[-2.8%] z-40 grid h-[clamp(76px,13vmin,116px)] w-[clamp(58px,9.4vmin,88px)] -translate-x-1/2 place-items-center"
              style={{ filter: 'drop-shadow(0 10px 18px rgba(0,0,0,0.48)) drop-shadow(0 0 22px var(--roulette-shadow))' }}
            >
              <div className="absolute inset-x-[28%] top-[8%] h-[24%] rounded-t-full" style={{ background: skinChrome.metal, border: '1px solid rgba(255,255,255,0.20)' }} />
              <div
                className="absolute inset-x-[6%] top-[19%] h-[69%]"
                style={{
                  clipPath: 'polygon(50% 0, 100% 24%, 58% 100%, 42% 100%, 0 24%)',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.90), var(--roulette-accent-2) 30%, var(--roulette-accent) 62%, rgba(0,0,0,0.38))',
                  boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.28), inset 0 0 24px rgba(0,0,0,0.38)',
                }}
              />
              <div className="absolute top-[36%] h-[18%] w-[20%] rotate-45 bg-white/70 blur-[1px]" />
            </div>
            <div
              className="absolute inset-[25.4%] z-20 rounded-full border"
              style={{
                borderColor: 'rgba(255,255,255,0.18)',
                background: 'radial-gradient(circle, rgba(255,255,255,0.12), transparent 34%), radial-gradient(circle, rgba(24,18,24,0.98), rgba(3,3,7,1) 74%)',
                boxShadow: 'inset 0 0 42px rgba(0,0,0,0.56), 0 0 0 clamp(2px,0.45vmin,4px) rgba(255,255,255,0.08)',
              }}
            />
            <div
              className="absolute inset-[27.6%] z-30 rounded-full"
              style={{
                background: 'repeating-conic-gradient(from 0deg, var(--roulette-accent-2) 0deg 1.1deg, rgba(255,255,255,0.10) 1.1deg 4.5deg, transparent 4.5deg 7.5deg)',
                opacity: 0.68,
                boxShadow: '0 0 30px var(--roulette-shadow)',
                maskImage: 'radial-gradient(circle, transparent 62%, black 63%, black 72%, transparent 73%)',
                WebkitMaskImage: 'radial-gradient(circle, transparent 62%, black 63%, black 72%, transparent 73%)',
              }}
            />
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={`hub-jewel-${index}`}
                className="absolute left-1/2 top-1/2 z-30 h-[clamp(5px,1.15vmin,10px)] w-[clamp(5px,1.15vmin,10px)] rounded-full"
                style={{
                  background: 'var(--roulette-accent-2)',
                  boxShadow: '0 0 12px var(--roulette-shadow), inset 0 1px 0 rgba(255,255,255,0.82)',
                  transform: `translate(-50%, -50%) rotate(${index * 45}deg) translateY(calc(-1 * min(18.5vmin, 148px)))`,
                }}
              />
            ))}
            <div
              className="absolute inset-[31%] z-30 grid place-items-center rounded-full border"
              style={{
                borderColor: 'rgba(255,255,255,0.28)',
                background: 'linear-gradient(180deg, rgba(255,255,255,0.15), rgba(0,0,0,0.12)), radial-gradient(circle at 50% 18%, rgba(255,255,255,0.20), transparent 30%), radial-gradient(circle, rgba(38,28,38,0.98), #050508 76%)',
                boxShadow: '0 0 52px var(--roulette-shadow), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -18px 42px rgba(0,0,0,0.36)',
              }}
            >
              <div className="grid max-w-[76%] justify-items-center gap-[clamp(2px,0.9vmin,8px)] text-center">
                <div className="max-w-full truncate text-[clamp(12px,1.75vmin,18px)] font-black leading-tight" style={{ color: 'var(--roulette-text)', textShadow: '0 8px 22px rgba(0,0,0,0.45)' }}>{state.name || '룰렛'}</div>
                <div className="max-w-full truncate text-[clamp(9px,1.25vmin,13px)] font-extrabold" style={{ color: 'var(--roulette-muted)' }}>{state.username ? `${state.username}님` : '시청자명'}</div>
                <div className="relative mt-[clamp(1px,0.4vmin,4px)] h-[clamp(22px,3.4vmin,38px)] w-[clamp(22px,3.4vmin,38px)]">
                  <div className="absolute inset-0" style={{ clipPath: 'polygon(50% 0, 61% 37%, 100% 50%, 61% 63%, 50% 100%, 39% 63%, 0 50%, 39% 37%)', background: 'var(--roulette-result)', filter: 'drop-shadow(0 0 18px var(--roulette-shadow))' }} />
                  <div className="absolute inset-[34%] rounded-full bg-white/75" />
                </div>
                <div className="text-[clamp(9px,1.12vmin,12px)] font-black tracking-[0.18em]" style={{ color: 'var(--roulette-muted)' }}>RESULT</div>
                <div className="roulette-result-lock max-w-[210px] truncate text-[clamp(26px,4.6vmin,48px)] font-black leading-none" style={{ color: 'var(--roulette-result)', textShadow: '0 0 24px var(--roulette-shadow), 0 7px 20px rgba(0,0,0,0.48)' }}>{state.label || state.value || '준비 완료'}</div>
              </div>
            </div>
            {batchProgress.id ? (
              <div
                className="absolute bottom-[3.4%] left-1/2 z-30 min-w-[clamp(110px,19vmin,168px)] -translate-x-1/2 rounded-[8px] border px-[clamp(14px,2.6vmin,24px)] py-[clamp(6px,1.1vmin,10px)] text-center text-[clamp(19px,3.4vmin,32px)] font-black tracking-[0.08em]"
                style={{
                  borderColor: 'rgba(255,255,255,0.26)',
                  background: `linear-gradient(180deg, rgba(255,255,255,0.12), rgba(0,0,0,0.18)), ${skinChrome.metal}`,
                  color: 'var(--roulette-result)',
                  boxShadow: '0 0 24px var(--roulette-shadow), inset 0 1px 0 rgba(255,255,255,0.22)',
                }}
              >
                {batchProgress.done} / {batchProgress.total}
              </div>
            ) : null}
          </section>
        ) : (
            <section
              aria-label="룰렛 릴 오버레이"
              className={`roulette-stage relative grid w-[min(96vw,1180px)] grid-cols-1 items-stretch gap-0 overflow-hidden rounded-[8px] border shadow-2xl transition-all duration-300 lg:grid-cols-[minmax(280px,0.72fr)_minmax(420px,1.28fr)] ${active ? 'scale-100 opacity-100' : 'pointer-events-none scale-[0.985] opacity-0'}`}
              style={{
                minHeight: 'clamp(420px, 34vw, 560px)',
                borderColor: 'var(--roulette-line)',
                background: `linear-gradient(100deg, rgba(255,255,255,0.10), transparent 11%, transparent 89%, rgba(255,255,255,0.08)), radial-gradient(circle at 66% 50%, var(--roulette-shadow), transparent 27%), ${skinChrome.metal}, linear-gradient(135deg, var(--roulette-panel-strong), var(--roulette-panel))`,
                boxShadow: `${skinChrome.shadow}, inset 0 0 0 1px rgba(255,255,255,0.10), inset 0 1px 0 rgba(255,255,255,0.16)`,
                color: 'var(--roulette-text)',
                clipPath: 'polygon(0 10%, 3% 0, 100% 0, 100% 90%, 97% 100%, 0 100%)',
                transitionDuration: FADE_MS + 'ms',
              }}
            >
            {active ? overlayEl : null}
            <div className="pointer-events-none absolute inset-0 z-[1] opacity-90" style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.10), transparent 22%, transparent 78%, rgba(255,255,255,0.08)), radial-gradient(circle at 62% 50%, var(--roulette-shadow), transparent 28%)' }} />
            <div className="pointer-events-none absolute inset-x-[4%] top-0 z-[2] h-px" style={{ background: 'linear-gradient(90deg, transparent, var(--roulette-accent), var(--roulette-accent-2), transparent)', boxShadow: '0 0 22px var(--roulette-shadow)' }} />
            <div className="pointer-events-none absolute inset-x-[7%] bottom-[3%] z-[2] h-[3px]" style={{ background: skinChrome.bevel, boxShadow: '0 0 22px var(--roulette-shadow)' }} />
            <div className="pointer-events-none absolute right-0 top-[10%] z-[2] h-[80%] w-[34px]" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.16), rgba(0,0,0,0.18)), repeating-linear-gradient(180deg, transparent 0 10px, rgba(255,255,255,0.12) 10px 11px)' }} />
            <div className="pointer-events-none absolute left-1/2 top-[7%] z-30 h-0 w-0 -translate-x-1/2 border-x-[16px] border-t-[28px] border-x-transparent" style={{ borderTopColor: 'var(--roulette-accent-2)', filter: 'drop-shadow(0 0 16px var(--roulette-shadow))' }} />
            <div className="relative z-10 grid min-w-0 content-center border-b p-[clamp(18px,2.6vw,34px)] lg:border-b-0 lg:border-r" style={{ borderColor: 'var(--roulette-line)' }}>
              {renderIdentity()}
            </div>
            <div className="relative z-20 grid min-w-0 place-items-center p-[clamp(16px,2.4vw,32px)]">
              {renderReelWindow()}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

