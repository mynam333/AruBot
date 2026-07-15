import React from 'react';
import { getBrowserApiBase } from '@/shared/api/http';
import { RouletteThemeAtmosphere } from './rouletteThemeAtmosphere';
import { getRouletteThemeMaterial } from './rouletteThemeMaterials';
import { WheelGlassOverlay, WheelLabelsSvg, WheelPointer, WheelSegmentsSvg, WheelSelectedSegment, WheelSkinOrnaments } from './rouletteWheelSkins';
import { splitWheelLabel } from './rouletteWheelUtils';

// Module-scope overlay kind and component to avoid remounts on parent re-renders
type OverlayKind = 'none' | 'sakura' | 'midnight' | 'sunset' | 'grid' | 'noise' | 'embers' | 'snow' | 'scan' | 'shimmer' | 'confetti' | 'leaves' | 'gold-sweep';
type CssVariableStyle = React.CSSProperties & Record<`--${string}`, string | number>;
type WindowWithLegacyAudioContext = Window & { webkitAudioContext?: typeof AudioContext };

function cssVariables(style: CssVariableStyle): React.CSSProperties {
  return style;
}

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
              <g className="ember" style={cssVariables({ '--dx': `${p.dx}%`, '--dur': `${p.dur}s`, '--delay': `${p.delay}s` })}>
                <g transform={`rotate(${p.rot}) scale(${p.s})`}>
                  {/* 눈물방울 형태의 불티 */}
                  <path className="ember-shape" d="M0,-1.6 C0.55,-0.6 0.45,0.5 0,1.3 C-0.45,0.5 -0.55,-0.6 0,-1.6 Z"
                    fill={p.fill} stroke={p.stroke} strokeWidth={0.15}
                    style={cssVariables({ '--fDur': `${p.fDur}s`, '--fDelay': `${p.fDelay}s` })} />
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
            <g key={f.id} className="flake" style={cssVariables({ '--dx': `${f.dx}px`, '--dur': `${f.dur}s`, '--delay': `${f.delay}s`, '--yStart': `${f.yStart}%` })}>
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
        <rect className="gold-sweep" x="-20" y="-50" width="40" height="200" fill="url(#shim-grad)" style={cssVariables({ '--delay': `${-(rnd() * 7).toFixed(2)}s`, '--phase': `${-(rnd() * 7).toFixed(2)}s` })} />
      </svg>
    );
  }
  if (kind === 'confetti') {
    return (
      <svg className="absolute inset-0 z-0 w-full h-full pointer-events-none opacity-70 mix-blend-screen" viewBox="0 0 100 100" preserveAspectRatio="none">
        <g>
          {confettiPieces.map(c => (
            <rect key={c.id} className="confetti" width={c.w} height={c.h} x={c.x} y={c.y} fill={c.fill} style={cssVariables({ '--dx': `${c.dx}px`, '--rot': `${c.rot}deg`, '--dur': `${c.dur}s`, '--delay': `${c.delay}s` })} />
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
              style={cssVariables({ '--yStart': `${l.yStart}%`, animationDuration: `${l.dur}s`, animationDelay: `${l.delay}s` })} />
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
              style={cssVariables({ '--dur': `${p.dur}s`, '--delay': `${p.delay}s`, '--yStart': `${p.yStart}%` })} />
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
            <g key={s.id} className="star" style={cssVariables({ '--t': `${s.t}s`, '--delay': `${s.delay}s` })}>
              <defs>
                <radialGradient id={`mid-star-${s.id}`} cx="50%" cy="50%" r="70%">
                  <stop offset="0%" stopColor={s.c1} stopOpacity="1" />
                  <stop offset="100%" stopColor={s.c2} stopOpacity="0.35" />
                </radialGradient>
              </defs>
              <g transform={`translate(${s.cx}, ${s.cy})`}>
                <g className="star-drift" style={cssVariables({ '--ax': `${s.ax}`, '--ay': `${s.ay}`, '--bx': `${s.bx}`, '--by': `${s.by}`, '--driftDur': `${s.driftDur}s`, '--driftDelay': `${s.driftDelay}s` })}>
                  <g className="star-rot" style={cssVariables({ '--rotAmp': `${s.rotAmp}deg`, '--rotDur': `${s.rotDur}s` })} transform={`rotate(${s.baseRot}) scale(${s.s})`}>
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
        <rect x="0" y="0" width="100" height="100" fill="url(#sun-core)" className="sun-core-pulse" style={cssVariables({ '--delay': `${-(rnd() * 6).toFixed(2)}s` })} />
        <g stroke="url(#sun-rays)" strokeWidth="2" strokeOpacity="0.5" className="sun-rays-pulse" style={cssVariables({ '--delay2': `${-(rnd() * 7.2).toFixed(2)}s` })}>
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
  initialSnapshot?: boolean;
  token?: string;
  name?: string | null;
  username?: string | null;
  value?: number | string | null;
  label?: string | null;
  createdAt?: number | string | null;
  theme?: string | null;
  items?: string[] | null;
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

function normalizeWheelResultLabel(value: unknown) {
  return String(value || '').trim().normalize('NFC');
}

function randomWheelStopOffsetRatio() {
  const maxOffset = 0.5 - WHEEL_STOP_EDGE_PADDING_RATIO;
  return ((Math.random() * 2) - 1) * maxOffset;
}

function wheelStopRotationForIndex(index: number, segmentCount: number, offsetRatio = 0) {
  const count = Math.max(1, segmentCount);
  const segmentDeg = 360 / count;
  const maxOffset = 0.5 - WHEEL_STOP_EDGE_PADDING_RATIO;
  const safeOffsetRatio = Math.max(-maxOffset, Math.min(maxOffset, offsetRatio));
  return -((index * segmentDeg) + (segmentDeg / 2) + (safeOffsetRatio * segmentDeg));
}

function wheelIndexAtPointer(rotation: number, segmentCount: number) {
  const count = Math.max(1, segmentCount);
  const segmentDeg = 360 / count;
  const pointerAngle = (((-rotation) % 360) + 360) % 360;
  return Math.min(count - 1, Math.floor(pointerAngle / segmentDeg));
}

function equivalentForwardRotation(currentRotation: number, targetModuloRotation: number, turns = 6) {
  const currentModulo = ((currentRotation % 360) + 360) % 360;
  const targetModulo = ((targetModuloRotation % 360) + 360) % 360;
  const delta = (targetModulo - currentModulo + 360) % 360;
  return currentRotation + delta + (Math.max(1, turns) * 360);
}

function buildWheelItemsForResult(pool: string[], finalLabel: string, selectedIndex: number) {
  const target = finalLabel.trim();
  const targetKey = normalizeWheelResultLabel(target);
  const cleaned = pool.map((item) => String(item || '').trim()).filter(Boolean);
  const targetPoolIndex = cleaned.findIndex((item) => normalizeWheelResultLabel(item) === targetKey);
  const candidates = cleaned.slice();
  if (target && targetPoolIndex >= 0) candidates.splice(targetPoolIndex, 1);
  const itemCount = Math.max(1, candidates.length + (target ? 1 : 0));
  const safeIndex = Math.min(Math.max(0, selectedIndex), itemCount - 1);
  const items = candidates.slice();
  if (target) items.splice(safeIndex, 0, target);
  return items;
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
    if (typeof window === 'undefined' || window.parent === window) return;
    window.parent.postMessage({ ...payload, token, testConnectionId }, window.location.origin);
  }, [testConnectionId, token]);

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

    const { id, startRotation, finalRotation, durationMs } = wheelSpinPlan;
    wheel.style.transform = `rotate(${startRotation}deg)`;
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
      wheel.style.transition = `transform ${durationMs}ms cubic-bezier(0.12, 0.68, 0.1, 1)`;
      let completed = false;
      let settleId: number | null = null;
      const finishFallback = () => {
        if (completed) return;
        completed = true;
        wheel.removeEventListener('transitionend', onTransitionEnd);
        notifyWheelFinished();
      };
      const onTransitionEnd = (event: TransitionEvent) => {
        if (event.target === wheel && event.propertyName === 'transform') finishFallback();
      };
      wheel.addEventListener('transitionend', onTransitionEnd);
      const frameId = window.requestAnimationFrame(() => {
        wheel.style.transform = `rotate(${finalRotation}deg)`;
        settleId = window.setTimeout(finishFallback, durationMs + 250);
      });
      return () => {
        window.cancelAnimationFrame(frameId);
        if (settleId != null) window.clearTimeout(settleId);
        wheel.removeEventListener('transitionend', onTransitionEnd);
        wheel.style.transition = '';
      };
    }

    const animation = wheel.animate(
      [
        { transform: `rotate(${startRotation}deg)` },
        { transform: `rotate(${finalRotation}deg)` },
      ],
      {
        duration: durationMs,
        easing: 'cubic-bezier(0.12, 0.68, 0.1, 1)',
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
      const url = getRouletteWsUrl(token, testConnectionId);
      
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
        if (!testConnectionId) postEmbeddedMessage({ type: 'arubot:roulette-ready' });
      };

      ws.onmessage = async (ev) => {
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
            const key = `${data.token || ''}|${data.label || ''}|${data.value ?? ''}|${data.createdAt || ''}`;
            
            // Ignore if in cooldown window to avoid quick re-triggers, except for instant/batched roulette events
            const isInstantPayload = data.instant === true;
            const hasBatch = !!data.batchId;
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
      const instantWheelIndex = 0;
      const instantWheelItems = buildWheelItemsForResult(poolRef.current, finalLabel, instantWheelIndex);
      const instantWheelRotation = wheelStopRotationForIndex(
        instantWheelIndex,
        instantWheelItems.length,
        randomWheelStopOffsetRatio(),
      );
      setWheelItemsState(instantWheelItems);
      setWheelSelectedIndex(instantWheelIndex);
      wheelRotationRef.current = instantWheelRotation;
      setWheelRotationDeg(instantWheelRotation);
      setWheelSettled(true);
      playEndSfx();
      setActive(true);
      postEmbeddedMessage({
        type: 'arubot:roulette-settled',
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
  }, [playEndSfx, applyServerLook, postEmbeddedMessage]);

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
    poolRef.current = pool.slice();
    const finalAlreadyIncluded = pool.some((item) => normalizeWheelResultLabel(item) === normalizeWheelResultLabel(finalLabel));
    const wheelItemCount = Math.max(1, pool.length + (finalAlreadyIncluded ? 0 : 1));
    const wheelTargetIndex = Math.floor(Math.random() * wheelItemCount);
    const nextWheelItems = buildWheelItemsForResult(pool, finalLabel, wheelTargetIndex);
    setWheelItemsState(nextWheelItems);
    setWheelSettled(false);
    const wheelStartRotation = wheelRotationRef.current;
    const wheelStopOffsetRatio = randomWheelStopOffsetRatio();
    const wheelFinalRotation = equivalentForwardRotation(
      wheelStartRotation,
      wheelStopRotationForIndex(wheelTargetIndex, nextWheelItems.length, wheelStopOffsetRatio),
      6 + Math.floor(Math.random() * 3)
    );
    const wheelResolvedIndex = wheelIndexAtPointer(wheelFinalRotation, nextWheelItems.length);
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
      postEmbeddedMessage({
        type: 'arubot:roulette-settled',
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
    setWheelRotationDeg(wheelStartRotation);
    setWheelSpinPlan({
      id: wheelSpinPlanId,
      startRotation: wheelStartRotation,
      finalRotation: wheelFinalRotation,
      durationMs: spinDurationMs,
    });
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
    finalLabelRef.current = wheelResolvedLabel;
    startCenterRef.current = startIdx;
    targetIndexRef.current = targetIdx;
    animStartRef.current = performance.now();
    const distancePx = (targetIdx - startIdx) * rowHpx;
    const T = spinDurationMs;
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
              const barrier = spinCompletionBarrierRef.current;
              if (barrier?.id === wheelSpinPlanId) {
                barrier.reelDone = true;
                tryFinishSpinBarrier(barrier);
              }
            });
          });
        };
        overshoot();
      }
    };
    rafIdRef.current = requestAnimationFrame(run);
  }, [playStartSfx, playEndSfx, rowH, computeRowsHalf, postEmbeddedMessage, embeddedTestMode, updateDebugInfo, layout, urlLook.layout]);

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
      const payload: WsPayload = next;
      const key = `${payload.token || ''}|${payload.label || ''}|${payload.value ?? ''}|${payload.createdAt || ''}`;
      const now = Date.now();
      const isBatch = !!payload.batchId;
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

  const t = ROULETTE_SKINS[theme] || ROULETTE_SKINS.studio;
  const themeMaterial = getRouletteThemeMaterial(t.id);
  const overlayKind: OverlayKind = t.overlay || 'none';
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

  const renderReelWindow = () => (
    <section
      aria-label="룰렛 릴 오버레이"
      className={`roulette-stage relative isolate w-[min(94vw,1040px)] overflow-hidden border transition-[opacity,transform] ${active ? 'scale-100 opacity-100' : 'pointer-events-none scale-[0.985] opacity-0'}`}
      style={{
        borderColor: 'var(--roulette-line)',
        borderRadius: 'var(--roulette-radius)',
        background: 'var(--roulette-backdrop)',
        boxShadow: '0 32px 90px rgba(0,0,0,.52), 0 0 54px var(--roulette-shadow), inset 0 1px 0 rgba(255,255,255,.16)',
        color: 'var(--roulette-text)',
        transitionDuration: FADE_MS + 'ms',
      }}
    >
      <RouletteThemeAtmosphere kind={themeMaterial.atmosphere} active={active} compact />
      {active ? <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-20 mix-blend-soft-light">{overlayEl}</div> : null}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-px" style={{ background: 'linear-gradient(90deg,transparent,var(--roulette-accent),transparent)', boxShadow: '0 0 18px var(--roulette-shadow)' }} />
      <div className="relative z-10 grid lg:grid-cols-[minmax(230px,0.66fr)_minmax(430px,1.34fr)]">
        <header className="relative flex min-w-0 flex-col justify-between gap-6 overflow-hidden border-b p-[clamp(22px,3.6vw,42px)] lg:border-b-0 lg:border-r" style={{ borderColor: 'var(--roulette-line)', background: 'linear-gradient(145deg,rgba(255,255,255,.055),transparent 58%)' }}>
          <div className="pointer-events-none absolute bottom-0 left-0 top-0 w-1" style={{ background: 'linear-gradient(180deg,transparent,var(--roulette-accent),transparent)', boxShadow: '0 0 18px var(--roulette-shadow)' }} />
          <div className="min-w-0">
            <div className="mb-4 flex items-center gap-2.5 text-[clamp(10px,1vw,12px)] font-extrabold tracking-[0.16em]" style={{ color: 'var(--roulette-accent-2)' }}>
              <span className="h-2 w-2 rounded-full" style={{ background: 'currentColor', boxShadow: '0 0 12px currentColor' }} />
              룰렛 실행
            </div>
            <h1 className="max-w-[12ch] break-keep text-[clamp(26px,3.4vw,48px)] font-black leading-[1.08] tracking-[-0.035em]" style={{ fontFamily: 'var(--roulette-font-display)' }}>{state.name || '룰렛'}</h1>
            {state.username ? <p className="mt-3 truncate text-[clamp(15px,1.6vw,22px)] font-semibold" style={{ color: 'var(--roulette-muted)' }}>{state.username}님</p> : null}
          </div>
          {batchProgress.id ? (
            <div className="grid gap-2.5">
              <div className="flex items-center justify-between text-xs font-bold" style={{ color: 'var(--roulette-muted)' }}><span>진행</span><span style={{ color: 'var(--roulette-result)' }}>{batchProgress.done} / {batchProgress.total}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-black/30"><div className="h-full rounded-full" style={{ width: `${progressPercent}%`, background: 'var(--roulette-accent-2)' }} /></div>
            </div>
          ) : null}
        </header>

        <div className="relative min-h-[clamp(280px,35vw,440px)] p-[clamp(20px,3.2vw,38px)]">
          <div className="absolute inset-x-[10%] top-1/2 z-20 h-[clamp(92px,11vw,132px)] -translate-y-1/2 border" style={{ borderColor: 'var(--roulette-accent-2)', borderRadius: 'calc(var(--roulette-radius) * .55)', background: 'var(--roulette-track)', boxShadow: '0 0 36px var(--roulette-shadow), inset 0 0 28px rgba(255,255,255,.055)' }} />
          <div className="pointer-events-none absolute inset-x-[8%] top-1/2 z-30 h-px -translate-y-1/2" style={{ background: 'linear-gradient(90deg,transparent,var(--roulette-accent-2),transparent)', boxShadow: '0 0 18px var(--roulette-shadow)' }} />
          <div className="pointer-events-none absolute left-[7.2%] top-1/2 z-30 h-[clamp(48px,6vw,70px)] w-1 -translate-y-1/2" style={{ background: 'var(--roulette-accent)', boxShadow: '0 0 16px var(--roulette-shadow)' }} />
          <div className="pointer-events-none absolute right-[7.2%] top-1/2 z-30 h-[clamp(48px,6vw,70px)] w-1 -translate-y-1/2" style={{ background: 'var(--roulette-accent)', boxShadow: '0 0 16px var(--roulette-shadow)' }} />
          <div ref={reelRef} className="relative h-full min-h-[clamp(236px,30vw,370px)] overflow-hidden border bg-black/25" style={{ borderColor: 'var(--roulette-line)', borderRadius: 'calc(var(--roulette-radius) * .72)', boxShadow: 'inset 0 18px 36px rgba(0,0,0,.3), inset 0 -18px 36px rgba(0,0,0,.3)' }}>
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[32%] bg-gradient-to-b from-black/70 to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[32%] bg-gradient-to-t from-black/70 to-transparent" />
            <div ref={rowRef} className="invisible absolute left-0 top-1/2 w-full -translate-y-1/2"><div className="px-4 text-center text-[clamp(44px,7vw,86px)] font-black leading-tight">8</div></div>
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
                  {Array.from({ length: windowRows }).map((_, itemIndex) => {
                    const index = firstIndex + itemIndex;
                    const label = labelFor(index);
                    const isCenter = index === Math.round(center);
                    return (
                      <div key={index} className="flex w-full items-center justify-center px-4" style={{ height: rh }}>
                        <div className={`max-w-full truncate text-center text-[clamp(44px,7vw,86px)] font-black leading-tight tracking-[-0.035em] ${isCenter ? 'roulette-result-lock' : ''}`} style={{ color: isCenter ? 'var(--roulette-result)' : 'rgba(255,255,255,.24)', fontFamily: 'var(--roulette-font-display)', textShadow: isCenter ? '0 0 24px var(--roulette-shadow), 0 8px 24px rgba(0,0,0,.58)' : 'none', transform: isCenter ? 'scale(1)' : 'scale(.88)' }}>{label}</div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </section>
  );

  const renderWheel = () => (
    <section
      aria-label="룰렛 휠 오버레이"
      className={`roulette-stage relative isolate grid aspect-square w-[min(89vmin,760px)] place-items-center transition-[opacity,transform] ${active ? 'scale-100 opacity-100' : 'pointer-events-none scale-[0.985] opacity-0'}`}
      style={{ color: 'var(--roulette-text)', filter: 'drop-shadow(0 30px 72px rgba(0,0,0,.58))', transitionDuration: FADE_MS + 'ms' }}
    >
      <RouletteThemeAtmosphere kind={themeMaterial.atmosphere} active={active} />
      {active ? <div className="pointer-events-none absolute inset-[-8%] z-0 overflow-hidden rounded-full opacity-10 mix-blend-soft-light">{overlayEl}</div> : null}
      <div className="absolute inset-[-5%] z-0 rounded-full" style={{ background: 'radial-gradient(circle,var(--roulette-shadow),transparent 67%)', filter: 'blur(22px)', opacity: .84 }} />
      <div className="absolute inset-0 z-10 rounded-full p-[clamp(13px,2.2vmin,22px)]" style={{ background: 'var(--roulette-rim-outer)', boxShadow: '0 22px 65px rgba(0,0,0,.56), 0 0 44px var(--roulette-shadow), inset 0 1px 1px rgba(255,255,255,.62)' }}>
        <div className="h-full w-full rounded-full" style={{ background: 'var(--roulette-rim-inner)', boxShadow: 'inset 0 0 0 clamp(5px,.8vmin,8px) rgba(0,0,0,.46), inset 0 0 24px rgba(0,0,0,.62)' }} />
      </div>
      <WheelSkinOrnaments family={wheelSkinFamily} themeId={t.id} />
      <div
        ref={wheelDiscRef}
        data-testid="roulette-wheel-disc"
        data-selected-index={wheelSelectedIndex}
        data-settled={wheelSettled ? 'true' : 'false'}
        className="absolute inset-[8.6%] z-10 overflow-hidden rounded-full will-change-transform"
        style={{ transform: `rotate(${wheelRotationDeg}deg)`, boxShadow: '0 0 38px var(--roulette-shadow), inset 0 0 34px rgba(0,0,0,.34)' }}
      >
        <WheelSegmentsSvg family={wheelSkinFamily} palette={t.palette} segmentCount={wheelCount} themeId={t.id} />
        <WheelSelectedSegment selectedIndex={wheelSettled ? wheelSelectedIndex : -1} segmentCount={wheelCount} family={wheelSkinFamily} />
        <WheelLabelsSvg labelLines={wheelLabelLines} selectedIndex={wheelSettled ? wheelSelectedIndex : -1} />
      </div>
      <WheelGlassOverlay />
      <WheelPointer themeId={t.id} />
      <div className="absolute inset-[35.2%] z-40 grid place-items-center rounded-full border p-[clamp(10px,1.6vmin,18px)] text-center" style={{ borderColor: 'var(--roulette-hub-line)', background: 'var(--roulette-hub)', boxShadow: '0 0 38px var(--roulette-shadow), 0 12px 32px rgba(0,0,0,.48), inset 0 1px 1px rgba(255,255,255,.28), inset 0 -10px 22px rgba(0,0,0,.30)' }}>
        <div className="pointer-events-none absolute inset-[9%] rounded-full border" style={{ borderColor: 'rgba(255,255,255,.16)' }} />
        <div className="grid max-w-full justify-items-center gap-[clamp(2px,.65vmin,6px)]">
          <div className="max-w-full truncate text-[clamp(10px,1.4vmin,14px)] font-extrabold tracking-[0.08em]" style={{ color: 'var(--roulette-muted)', fontFamily: 'var(--roulette-font-display)' }}>{state.name || '룰렛'}</div>
          {state.username ? <div className="max-w-full truncate text-[clamp(10px,1.4vmin,14px)] font-semibold" style={{ color: 'var(--roulette-muted)' }}>{state.username}님</div> : null}
          <div className={wheelSettled ? 'roulette-result-lock max-w-[94%] break-keep text-center text-[clamp(18px,4vmin,42px)] font-black leading-[.98] tracking-[-0.04em]' : 'max-w-[92%] truncate text-[clamp(18px,3.2vmin,32px)] font-black leading-none tracking-[-0.03em]'} style={{ color: 'var(--roulette-result)', fontFamily: 'var(--roulette-font-display)', textShadow: '0 0 22px var(--roulette-shadow), 0 4px 12px rgba(0,0,0,.46)' }}>{wheelSettled ? (state.label || state.value || '') : '회전 중'}</div>
          {batchProgress.id ? <div className="text-[clamp(10px,1.3vmin,13px)] font-bold" style={{ color: 'var(--roulette-accent-2)' }}>진행 {batchProgress.done} / {batchProgress.total}</div> : null}
        </div>
      </div>
    </section>
  );

  return (
    <div className="min-h-screen w-screen overflow-hidden text-white" data-roulette-theme={t.id} data-roulette-material={themeMaterial.material} style={{ backgroundColor: 'transparent', ...t.css, ...themeMaterial.css }}>
      {error ? <div className="fixed left-1/2 top-5 z-50 -translate-x-1/2 rounded-lg border border-red-300/30 bg-slate-950/90 px-3 py-2 text-xs font-semibold text-red-100 shadow-lg">{error}</div> : null}
      <div className="grid h-[100dvh] w-full place-items-center p-[clamp(10px,2vw,24px)]">
        {layout === 'wheel' ? renderWheel() : renderReelWindow()}
      </div>
    </div>
  );
}

