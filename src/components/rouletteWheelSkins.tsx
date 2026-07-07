import React from 'react';
import type { WheelSkinFamily } from './rouletteWheelUtils';

function polarPoint(cx: number, cy: number, radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: +(cx + (Math.cos(radians) * radius)).toFixed(3),
    y: +(cy + (Math.sin(radians) * radius)).toFixed(3),
  };
}

function segmentPath(index: number) {
  const start = (index * 45) + 2.2;
  const end = ((index + 1) * 45) - 2.2;
  const outerStart = polarPoint(500, 500, 493, start);
  const outerEnd = polarPoint(500, 500, 493, end);
  const innerEnd = polarPoint(500, 500, 226, end);
  const innerStart = polarPoint(500, 500, 226, start);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A 493 493 0 0 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A 226 226 0 0 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

function getSegmentTexture(family: WheelSkinFamily) {
  switch (family) {
    case 'mono':
      return { frequency: '0.018 0.72', opacity: '0.18', mode: 'screen' as const, seed: 29, octaves: 2 };
    case 'velvet':
      return { frequency: '0.72', opacity: '0.16', mode: 'multiply' as const, seed: 11, octaves: 3 };
    case 'deco':
      return { frequency: '0.11 0.42', opacity: '0.14', mode: 'multiply' as const, seed: 41, octaves: 2 };
    case 'crystal':
      return { frequency: '0.026 0.16', opacity: '0.18', mode: 'screen' as const, seed: 53, octaves: 2 };
    case 'ink':
      return { frequency: '0.58 0.08', opacity: '0.12', mode: 'multiply' as const, seed: 67, octaves: 4 };
    case 'nova':
      return { frequency: '0.08 0.22', opacity: '0.19', mode: 'screen' as const, seed: 79, octaves: 3 };
    case 'ceramic':
      return { frequency: '0.034 0.12', opacity: '0.10', mode: 'screen' as const, seed: 83, octaves: 2 };
    case 'arcade':
      return { frequency: '0.22 0.22', opacity: '0.16', mode: 'screen' as const, seed: 97, octaves: 1 };
    default:
      return { frequency: '0.032 0.18', opacity: '0.20', mode: 'screen' as const, seed: 17, octaves: 2 };
  }
}

function getSegmentPatternId(family: WheelSkinFamily) {
  switch (family) {
    case 'mono': return 'rouletteMonoBrush';
    case 'velvet': return 'rouletteVelvetNap';
    case 'deco': return 'rouletteDecoSunburst';
    case 'crystal': return 'rouletteCrystalFacet';
    case 'ink': return 'rouletteInkWash';
    case 'nova': return 'rouletteNovaDust';
    case 'ceramic': return 'rouletteCeramicGlaze';
    case 'arcade': return 'rouletteArcadeGrid';
    default: return 'roulettePrismFacet';
  }
}

function getPatternOpacity(family: WheelSkinFamily) {
  switch (family) {
    case 'mono': return 0.46;
    case 'velvet': return 0.62;
    case 'deco': return 0.50;
    case 'crystal': return 0.66;
    case 'ink': return 0.58;
    case 'nova': return 0.52;
    case 'ceramic': return 0.46;
    case 'arcade': return 0.56;
    default: return 0.54;
  }
}

function getShadeOpacity(family: WheelSkinFamily) {
  switch (family) {
    case 'prism':
    case 'crystal':
    case 'nova':
      return 0.62;
    case 'ink':
    case 'ceramic':
      return 0.44;
    default:
      return 0.52;
  }
}

export function WheelSegmentsSvg({ family, palette }: { family: WheelSkinFamily; palette: string[] }) {
  const texture = getSegmentTexture(family);
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 1000 1000" aria-hidden="true">
      <defs>
        <linearGradient id="rouletteSegmentShade" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,0.22)" />
          <stop offset="0.36" stopColor="rgba(255,255,255,0.04)" />
          <stop offset="0.66" stopColor="rgba(0,0,0,0.04)" />
          <stop offset="1" stopColor="rgba(0,0,0,0.24)" />
        </linearGradient>
        <linearGradient id="rouletteSegmentSpecular" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,0.34)" />
          <stop offset="0.18" stopColor="rgba(255,255,255,0.10)" />
          <stop offset="0.52" stopColor="rgba(255,255,255,0.00)" />
          <stop offset="1" stopColor="rgba(0,0,0,0.20)" />
        </linearGradient>
        <filter id="rouletteSegmentTexture" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency={texture.frequency} numOctaves={texture.octaves} seed={texture.seed} result="noise" />
          <feColorMatrix
            in="noise"
            type="matrix"
            values={`0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 ${texture.opacity} 0`}
            result="grain"
          />
          <feBlend in="SourceGraphic" in2="grain" mode={texture.mode as 'screen' | 'multiply'} result="textured" />
          <feComposite in="textured" in2="SourceAlpha" operator="in" />
        </filter>
        <pattern id="rouletteMonoBrush" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(12)">
          <path d="M0 2h18M0 9h18M0 16h18" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
          <path d="M0 5h18M0 13h18" stroke="rgba(0,0,0,0.18)" strokeWidth="1" />
        </pattern>
        <pattern id="rouletteVelvetNap" width="32" height="32" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)">
          <path d="M0 10c7-7 17-7 32 0M0 23c8-5 18-5 32 0" stroke="rgba(255,255,255,0.055)" strokeWidth="2" fill="none" />
        </pattern>
        <pattern id="roulettePrismFacet" width="70" height="70" patternUnits="userSpaceOnUse">
          <path d="M0 55 26 0 70 22M0 18 38 70 70 34" stroke="rgba(255,255,255,0.14)" strokeWidth="2" fill="none" />
        </pattern>
        <pattern id="rouletteDecoSunburst" width="56" height="56" patternUnits="userSpaceOnUse">
          <path d="M28 0v56M0 28h56M8 8l40 40M48 8 8 48" stroke="rgba(255,224,150,0.16)" strokeWidth="2" />
          <path d="M28 8 37 28 28 48 19 28z" fill="rgba(0,0,0,0.12)" />
        </pattern>
        <pattern id="rouletteCrystalFacet" width="84" height="84" patternUnits="userSpaceOnUse">
          <path d="M0 62 31 0 84 24M0 20 46 84 84 38M31 0 46 84" stroke="rgba(255,255,255,0.20)" strokeWidth="2" fill="none" />
          <path d="M31 0 46 84 84 24z" fill="rgba(255,255,255,0.045)" />
        </pattern>
        <pattern id="rouletteInkWash" width="92" height="48" patternUnits="userSpaceOnUse" patternTransform="rotate(-9)">
          <path d="M-6 34c22-16 39-16 60 0s38 16 60 0" stroke="rgba(0,0,0,0.18)" strokeWidth="7" strokeLinecap="round" fill="none" />
          <path d="M-4 14c20 9 40 9 60 0s39-9 60 0" stroke="rgba(255,255,255,0.13)" strokeWidth="2" fill="none" />
        </pattern>
        <pattern id="rouletteNovaDust" width="76" height="76" patternUnits="userSpaceOnUse">
          <circle cx="14" cy="18" r="1.8" fill="rgba(255,255,255,0.32)" />
          <circle cx="52" cy="11" r="1.1" fill="rgba(255,255,255,0.24)" />
          <circle cx="62" cy="49" r="1.6" fill="rgba(255,255,255,0.28)" />
          <path d="M8 62c21-28 43-42 66-42" stroke="rgba(255,255,255,0.12)" strokeWidth="2" fill="none" />
        </pattern>
        <pattern id="rouletteCeramicGlaze" width="74" height="74" patternUnits="userSpaceOnUse">
          <path d="M0 38c15-15 29-15 44 0s29 15 44 0M6 12c16 8 32 8 48 0" stroke="rgba(30,95,170,0.18)" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M14 53c12-8 22-8 34 0" stroke="rgba(255,255,255,0.18)" strokeWidth="2" fill="none" />
        </pattern>
        <pattern id="rouletteArcadeGrid" width="34" height="34" patternUnits="userSpaceOnUse">
          <path d="M0 0h34v34H0zM17 0v34M0 17h34" stroke="rgba(255,255,255,0.12)" strokeWidth="1" fill="none" />
          <rect x="4" y="4" width="4" height="4" fill="rgba(255,255,255,0.18)" />
          <rect x="24" y="22" width="5" height="5" fill="rgba(255,255,255,0.12)" />
        </pattern>
        {Array.from({ length: 8 }).map((_, index) => (
          <linearGradient key={`segment-gradient-${index}`} id={`rouletteSegmentFill${index}`} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity={family === 'mono' ? 0.30 : 0.24} />
            <stop offset="0.22" stopColor={palette[index % palette.length]} />
            <stop offset="0.76" stopColor={palette[index % palette.length]} />
            <stop offset="1" stopColor="#050508" stopOpacity="0.30" />
          </linearGradient>
        ))}
      </defs>
      {Array.from({ length: 8 }).map((_, index) => {
        const d = segmentPath(index);
        const texturePattern = `url(#${getSegmentPatternId(family)})`;
        return (
          <g key={`segment-${index}`}>
            <path d={d} fill={`url(#rouletteSegmentFill${index})`} filter="url(#rouletteSegmentTexture)" />
            <path d={d} fill={texturePattern} opacity={getPatternOpacity(family)} />
            <path d={d} fill="url(#rouletteSegmentShade)" opacity={getShadeOpacity(family)} />
            <path d={d} fill="none" stroke="rgba(255,255,255,0.32)" strokeWidth="3" />
            <path d={d} fill="none" stroke="rgba(0,0,0,0.42)" strokeWidth="9" strokeLinejoin="round" />
            <path d={d} fill="url(#rouletteSegmentSpecular)" opacity={index % 2 === 0 ? 0.38 : 0.24} />
          </g>
        );
      })}
      <circle cx="500" cy="500" r="493" fill="none" stroke="rgba(255,255,255,0.26)" strokeWidth="4" />
      <circle cx="500" cy="500" r="226" fill="none" stroke="rgba(0,0,0,0.60)" strokeWidth="10" />
    </svg>
  );
}

export const WheelSkinOrnaments = React.memo(function WheelSkinOrnaments({ family }: { family: WheelSkinFamily }) {
  if (family === 'velvet') {
    return (
      <svg className="roulette-wheel-ornaments pointer-events-none absolute inset-[-4.2%] z-20 h-[108.4%] w-[108.4%] overflow-visible" viewBox="0 0 1000 1000" aria-hidden="true">
        <defs>
          <linearGradient id="rouletteVelvetGold" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#fff1b8" />
            <stop offset="0.42" stopColor="#d59b35" />
            <stop offset="1" stopColor="#5a2608" />
          </linearGradient>
          <radialGradient id="rouletteVelvetRuby" cx="50%" cy="42%" r="58%">
            <stop offset="0" stopColor="#ffe4ea" />
            <stop offset="0.42" stopColor="#fb2f6f" />
            <stop offset="1" stopColor="#610016" />
          </radialGradient>
        </defs>
        <g className="roulette-wheel-ornament-secondary" fill="none" stroke="url(#rouletteVelvetGold)" strokeLinecap="round" strokeLinejoin="round">
          <path d="M254 137c-42 14-73 41-94 80 38-19 74-23 108-11M746 137c42 14 73 41 94 80-38-19-74-23-108-11" strokeWidth="4" opacity="0.76" />
          <path d="M176 750c24 38 58 66 102 82-25-32-31-67-18-104M824 750c-24 38-58 66-102 82 25-32 31-67 18-104" strokeWidth="4" opacity="0.76" />
          <path d="M328 116c46-24 80-24 126 0M546 116c46-24 80-24 126 0M328 884c46 24 80 24 126 0M546 884c46 24 80 24 126 0" strokeWidth="3" opacity="0.56" />
        </g>
        <g transform="translate(500 38)">
          <path d="M-54 46 0-8 54 46 38 114h-76z" fill="url(#rouletteVelvetGold)" stroke="#fff1b8" strokeWidth="3" />
          <path d="M-44 45-26 0-6 45 0-22 10 45 30 0 46 45" fill="none" stroke="#fff1b8" strokeWidth="5" strokeLinejoin="round" />
          <circle cx="0" cy="36" r="13" fill="url(#rouletteVelvetRuby)" stroke="#ffd6a1" strokeWidth="3" />
        </g>
        {Array.from({ length: 8 }).map((_, index) => (
          <g key={`velvet-ruby-${index}`} transform={`rotate(${index * 45} 500 500) translate(500 67)`}>
            <circle r="15" fill="url(#rouletteVelvetRuby)" stroke="#ffdba1" strokeWidth="4" />
            <circle cx="-4" cy="-5" r="4" fill="#fff2f5" opacity="0.86" />
          </g>
        ))}
      </svg>
    );
  }

  if (family === 'prism') {
    return (
      <svg className="roulette-wheel-ornaments pointer-events-none absolute inset-[-5%] z-20 h-[110%] w-[110%] overflow-visible" viewBox="0 0 1000 1000" aria-hidden="true">
        <defs>
          <linearGradient id="roulettePrismShard" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#e9fff7" />
            <stop offset="0.36" stopColor="#4ee7ff" />
            <stop offset="0.68" stopColor="#b7ff55" />
            <stop offset="1" stopColor="#7c3cff" />
          </linearGradient>
        </defs>
        {Array.from({ length: 10 }).map((_, index) => (
          <g className={index % 2 ? 'roulette-wheel-ornament-secondary' : undefined} key={`prism-shard-${index}`} transform={`rotate(${index * 36 + (index % 2 ? 12 : -8)} 500 500) translate(500 ${index % 2 ? 55 : 78})`}>
            <path d="M0-28 18 4 2 34-21 8z" fill="url(#roulettePrismShard)" stroke="rgba(236,253,245,0.82)" strokeWidth="3" opacity={index % 3 === 0 ? 0.96 : 0.68} />
            <path d="M0-28 2 34" stroke="rgba(255,255,255,0.62)" strokeWidth="2" />
            <path d="M-21 8 18 4" stroke="rgba(255,255,255,0.46)" strokeWidth="2" />
          </g>
        ))}
        <g className="roulette-wheel-ornament-secondary" fill="none" stroke="url(#roulettePrismShard)" strokeLinecap="round">
          <circle cx="500" cy="500" r="438" strokeWidth="3" opacity="0.74" strokeDasharray="2 18" />
          <circle cx="500" cy="500" r="404" strokeWidth="2" opacity="0.52" strokeDasharray="42 20" />
        </g>
      </svg>
    );
  }

  if (family === 'deco') {
    return (
      <svg className="roulette-wheel-ornaments pointer-events-none absolute inset-[-4%] z-20 h-[108%] w-[108%] overflow-visible" viewBox="0 0 1000 1000" aria-hidden="true">
        <defs>
          <linearGradient id="rouletteDecoGold" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#fff4bf" />
            <stop offset="0.44" stopColor="#c9912a" />
            <stop offset="1" stopColor="#17120a" />
          </linearGradient>
        </defs>
        <g fill="none" stroke="url(#rouletteDecoGold)" strokeLinecap="square">
          <circle cx="500" cy="500" r="438" strokeWidth="5" opacity="0.82" />
          <circle cx="500" cy="500" r="404" strokeWidth="3" opacity="0.52" strokeDasharray="64 18 8 18" />
          <path className="roulette-wheel-ornament-secondary" d="M185 186h94v28h-66v66h-28zM721 186h94v94h-28v-66h-66zM185 720h28v66h66v28h-94zM787 720h28v94h-94v-28h66z" strokeWidth="8" />
        </g>
        {Array.from({ length: 16 }).map((_, index) => (
          <g key={`deco-step-${index}`} transform={`rotate(${index * 22.5} 500 500) translate(500 72)`}>
            <path d="M-18 0h36v18h-10v14h-16V18h-10z" fill="url(#rouletteDecoGold)" opacity={index % 2 === 0 ? 0.86 : 0.48} />
          </g>
        ))}
      </svg>
    );
  }

  if (family === 'crystal') {
    return (
      <svg className="roulette-wheel-ornaments pointer-events-none absolute inset-[-5%] z-20 h-[110%] w-[110%] overflow-visible" viewBox="0 0 1000 1000" aria-hidden="true">
        <defs>
          <linearGradient id="rouletteCrystalIce" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#f8feff" />
            <stop offset="0.34" stopColor="#7dd3fc" />
            <stop offset="0.68" stopColor="#c4b5fd" />
            <stop offset="1" stopColor="#0f172a" />
          </linearGradient>
        </defs>
        <g fill="none" stroke="url(#rouletteCrystalIce)">
          <circle cx="500" cy="500" r="444" strokeWidth="3" opacity="0.70" />
          <circle className="roulette-wheel-ornament-secondary" cx="500" cy="500" r="415" strokeWidth="2" opacity="0.46" strokeDasharray="18 20" />
        </g>
        {Array.from({ length: 12 }).map((_, index) => (
          <g key={`crystal-gem-${index}`} transform={`rotate(${index * 30 + (index % 2 ? 10 : 0)} 500 500) translate(500 ${index % 3 === 0 ? 46 : 76})`}>
            <path d="M0-34 26-10 18 26 0 42-18 26-26-10z" fill="url(#rouletteCrystalIce)" stroke="rgba(240,253,255,0.86)" strokeWidth="3" opacity={index % 3 === 0 ? 0.94 : 0.66} />
            <path d="M0-34v76M-26-10h52M-18 26 26-10" stroke="rgba(255,255,255,0.48)" strokeWidth="2" />
          </g>
        ))}
      </svg>
    );
  }

  if (family === 'ink') {
    return (
      <svg className="roulette-wheel-ornaments pointer-events-none absolute inset-[-3.6%] z-20 h-[107.2%] w-[107.2%] overflow-visible" viewBox="0 0 1000 1000" aria-hidden="true">
        <defs>
          <filter id="rouletteInkFeather" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.035 0.16" numOctaves="3" seed="131" result="wash" />
            <feDisplacementMap in="SourceGraphic" in2="wash" scale="8" />
          </filter>
          <linearGradient id="rouletteInkStroke" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.42" stopColor="#2f343b" />
            <stop offset="1" stopColor="#050505" />
          </linearGradient>
        </defs>
        <g filter="url(#rouletteInkFeather)" fill="none" stroke="url(#rouletteInkStroke)" strokeLinecap="round">
          <circle cx="500" cy="500" r="438" strokeWidth="12" opacity="0.62" strokeDasharray="360 42 110 28" />
          <circle cx="500" cy="500" r="410" strokeWidth="4" opacity="0.36" strokeDasharray="18 18" />
          <path className="roulette-wheel-ornament-secondary" d="M205 253c74-104 180-151 318-140M791 751c-72 101-176 148-312 140" strokeWidth="10" opacity="0.40" />
        </g>
        {Array.from({ length: 4 }).map((_, index) => (
          <g key={`ink-seal-${index}`} transform={`rotate(${index * 90 + 45} 500 500) translate(500 82)`}>
            <rect x="-18" y="-18" width="36" height="36" rx="5" fill="#c1121f" opacity="0.82" />
            <path d="M-8-6h16M-8 2h16M-3-12v24M6-12v24" stroke="#fff2f2" strokeWidth="2" opacity="0.72" />
          </g>
        ))}
      </svg>
    );
  }

  if (family === 'nova') {
    return (
      <svg className="roulette-wheel-ornaments pointer-events-none absolute inset-[-5.6%] z-20 h-[111.2%] w-[111.2%] overflow-visible" viewBox="0 0 1000 1000" aria-hidden="true">
        <defs>
          <radialGradient id="rouletteNovaStar" cx="50%" cy="45%" r="60%">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.30" stopColor="#c4b5fd" />
            <stop offset="0.72" stopColor="#38bdf8" />
            <stop offset="1" stopColor="#312e81" />
          </radialGradient>
        </defs>
        <g fill="none" stroke="url(#rouletteNovaStar)" strokeLinecap="round">
          <ellipse cx="500" cy="500" rx="462" ry="386" strokeWidth="3" opacity="0.58" transform="rotate(-13 500 500)" />
          <ellipse className="roulette-wheel-ornament-secondary" cx="500" cy="500" rx="432" ry="348" strokeWidth="2" opacity="0.38" transform="rotate(22 500 500)" strokeDasharray="12 18" />
          <circle cx="500" cy="500" r="444" strokeWidth="2" opacity="0.46" strokeDasharray="2 20" />
        </g>
        {Array.from({ length: 18 }).map((_, index) => (
          <g key={`nova-star-${index}`} transform={`rotate(${index * 20} 500 500) translate(500 ${index % 4 === 0 ? 52 : index % 2 ? 90 : 68})`}>
            <path d="M0-18 5-5 18 0 5 5 0 18-5 5-18 0-5-5z" fill="url(#rouletteNovaStar)" opacity={index % 3 === 0 ? 0.92 : 0.54} />
          </g>
        ))}
      </svg>
    );
  }

  if (family === 'ceramic') {
    return (
      <svg className="roulette-wheel-ornaments pointer-events-none absolute inset-[-3.8%] z-20 h-[107.6%] w-[107.6%] overflow-visible" viewBox="0 0 1000 1000" aria-hidden="true">
        <defs>
          <linearGradient id="rouletteCeramicBlue" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#f8fbff" />
            <stop offset="0.38" stopColor="#60a5fa" />
            <stop offset="0.72" stopColor="#1d4ed8" />
            <stop offset="1" stopColor="#eff6ff" />
          </linearGradient>
        </defs>
        <g fill="none" stroke="url(#rouletteCeramicBlue)" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="500" cy="500" r="439" strokeWidth="7" opacity="0.78" />
          <circle cx="500" cy="500" r="412" strokeWidth="2" opacity="0.46" strokeDasharray="7 15" />
          <g className="roulette-wheel-ornament-secondary">
            <path d="M260 142c34 22 54 50 60 84 6-34 26-62 60-84M620 142c34 22 54 50 60 84 6-34 26-62 60-84M260 858c34-22 54-50 60-84 6 34 26 62 60 84M620 858c34-22 54-50 60-84 6 34 26 62 60 84" strokeWidth="4" opacity="0.62" />
            <path d="M155 430c46-16 82-8 108 24M845 430c-46-16-82-8-108 24M155 570c46 16 82 8 108-24M845 570c-46 16-82 8-108-24" strokeWidth="4" opacity="0.62" />
          </g>
        </g>
        {Array.from({ length: 8 }).map((_, index) => (
          <g key={`ceramic-dot-${index}`} transform={`rotate(${index * 45} 500 500) translate(500 72)`}>
            <circle r="12" fill="#eff6ff" stroke="url(#rouletteCeramicBlue)" strokeWidth="4" />
            <circle r="4" fill="#1d4ed8" opacity="0.76" />
          </g>
        ))}
      </svg>
    );
  }

  if (family === 'arcade') {
    return (
      <svg className="roulette-wheel-ornaments pointer-events-none absolute inset-[-4.4%] z-20 h-[108.8%] w-[108.8%] overflow-visible" viewBox="0 0 1000 1000" aria-hidden="true">
        <defs>
          <linearGradient id="rouletteArcadeNeon" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#67e8f9" />
            <stop offset="0.34" stopColor="#f0abfc" />
            <stop offset="0.68" stopColor="#bef264" />
            <stop offset="1" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
        <g fill="none" stroke="url(#rouletteArcadeNeon)">
          <circle cx="500" cy="500" r="441" strokeWidth="4" opacity="0.74" />
          <circle cx="500" cy="500" r="418" strokeWidth="3" opacity="0.52" strokeDasharray="4 12" />
        </g>
        {Array.from({ length: 32 }).map((_, index) => (
          <g key={`arcade-led-${index}`} transform={`rotate(${index * 11.25} 500 500) translate(500 68)`}>
            <rect x="-7" y="-7" width="14" height="14" rx="3" fill={index % 3 === 0 ? '#bef264' : index % 3 === 1 ? '#67e8f9' : '#f0abfc'} opacity={index % 4 === 0 ? 0.95 : 0.58} />
          </g>
        ))}
        <g className="roulette-wheel-ornament-secondary" stroke="url(#rouletteArcadeNeon)" strokeWidth="3" opacity="0.45">
          <path d="M182 210h122M696 210h122M182 790h122M696 790h122" />
          <path d="M210 182v122M790 182v122M210 696v122M790 696v122" />
        </g>
      </svg>
    );
  }

  return (
    <svg className="roulette-wheel-ornaments pointer-events-none absolute inset-[-2.2%] z-20 h-[104.4%] w-[104.4%] overflow-visible" viewBox="0 0 1000 1000" aria-hidden="true">
      <defs>
        <linearGradient id="rouletteMonoSteel" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.34" stopColor="#8c9199" />
          <stop offset="0.66" stopColor="#1b1f27" />
          <stop offset="1" stopColor="#f8fafc" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="url(#rouletteMonoSteel)">
        <circle cx="500" cy="500" r="444" strokeWidth="4" opacity="0.72" />
        <circle className="roulette-wheel-ornament-secondary" cx="500" cy="500" r="423" strokeWidth="2" opacity="0.44" strokeDasharray="18 10" />
      </g>
      {Array.from({ length: 24 }).map((_, index) => (
        <rect
          className={index % 3 === 0 ? undefined : 'roulette-wheel-ornament-secondary'}
          key={`mono-notch-${index}`}
          x="493"
          y="54"
          width="14"
          height={index % 3 === 0 ? 34 : 20}
          rx="3"
          fill="url(#rouletteMonoSteel)"
          opacity={index % 3 === 0 ? 0.72 : 0.38}
          transform={`rotate(${index * 15} 500 500)`}
        />
      ))}
      {Array.from({ length: 8 }).map((_, index) => (
        <g key={`mono-screw-${index}`} transform={`rotate(${index * 45 + 22.5} 500 500) translate(500 86)`}>
          <circle r="13" fill="#161a20" stroke="url(#rouletteMonoSteel)" strokeWidth="4" />
          <path d="M-7 0H7" stroke="#f8fafc" strokeWidth="2" opacity="0.72" />
        </g>
      ))}
    </svg>
  );
});

export function WheelSelectedSegment({ selectedIndex }: { selectedIndex: number }) {
  if (selectedIndex < 0) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 1000 1000" aria-hidden="true">
      <path
        d={segmentPath(selectedIndex)}
        fill="rgba(255,255,255,0.18)"
        stroke="var(--roulette-result)"
        strokeWidth="8"
        strokeLinejoin="round"
        filter="url(#rouletteSelectedGlow)"
      />
      <defs>
        <filter id="rouletteSelectedGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0" stdDeviation="12" floodColor="currentColor" floodOpacity="0.70" />
          <feDropShadow dx="0" dy="0" stdDeviation="28" floodColor="currentColor" floodOpacity="0.38" />
        </filter>
      </defs>
    </svg>
  );
}

export function WheelLabelsSvg({ labelLines, selectedIndex }: { labelLines: string[][]; selectedIndex: number }) {
  return (
    <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 1000 1000" aria-hidden="true">
      {labelLines.map((lines, index) => {
        const isSelected = index === selectedIndex;
        const fontSize = lines.some((line) => line.length >= 5) ? 36 : 43;
        const labelCenterY = 104;
        const lineGap = fontSize * 0.92;
        return (
          <g key={`wheel-label-${index}`} transform={`rotate(${index * 45 + 22.5} 500 500)`}>
            <text
              x="500"
              y={labelCenterY}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={isSelected ? 'var(--roulette-result)' : 'rgba(255,255,255,0.94)'}
              fontSize={isSelected ? fontSize + 3 : fontSize}
              fontWeight="900"
              letterSpacing="0"
              stroke="rgba(0,0,0,0.62)"
              strokeWidth={isSelected ? 10 : 8}
              paintOrder="stroke fill"
            >
              {lines.map((line, lineIndex) => (
                <tspan key={`${line}-${lineIndex}`} x="500" dy={lines.length === 1 ? 0 : (lineIndex === 0 ? -lineGap / 2 : lineGap)}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
