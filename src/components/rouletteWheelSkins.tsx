import React from 'react';
import type { WheelSkinFamily } from './rouletteWheelUtils';

function polarPoint(cx: number, cy: number, radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: +(cx + (Math.cos(radians) * radius)).toFixed(3),
    y: +(cy + (Math.sin(radians) * radius)).toFixed(3),
  };
}

function segmentPath(index: number, segmentCount: number, family: WheelSkinFamily) {
  const count = Math.max(1, segmentCount);
  if (count === 1) return 'M 500 8 A 492 492 0 1 1 499.9 8 Z';
  const segmentDeg = 360 / count;
  const familyGap = family === 'deco' || family === 'arcade' ? 0.75 : family === 'ink' ? 1.35 : 1.05;
  const gap = Math.min(familyGap, segmentDeg * 0.038);
  const start = (index * segmentDeg) + gap;
  const end = ((index + 1) * segmentDeg) - gap;
  const largeArc = end - start > 180 ? 1 : 0;
  const outerStart = polarPoint(500, 500, 490, start);
  const outerEnd = polarPoint(500, 500, 490, end);
  return [
    'M 500 500',
    `L ${outerStart.x} ${outerStart.y}`,
    `A 490 490 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    'Z',
  ].join(' ');
}

function texturePattern(family: WheelSkinFamily, id: string) {
  if (family === 'arcade') {
    return (
      <pattern id={id} width="28" height="28" patternUnits="userSpaceOnUse">
        <path d="M0 0H28V28" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="2" />
        <rect x="4" y="4" width="3" height="3" fill="rgba(255,255,255,.16)" />
      </pattern>
    );
  }
  if (family === 'ceramic') {
    return (
      <pattern id={id} width="46" height="24" patternUnits="userSpaceOnUse">
        <path d="M-12 20 Q0 4 12 20 T36 20 T60 20" fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="2" />
      </pattern>
    );
  }
  if (family === 'deco') {
    return (
      <pattern id={id} width="38" height="38" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <path d="M19 0V38M0 19H38" stroke="rgba(255,244,191,.12)" strokeWidth="1.5" />
      </pattern>
    );
  }
  if (family === 'ink') {
    return (
      <pattern id={id} width="31" height="31" patternUnits="userSpaceOnUse" patternTransform="rotate(18)">
        <path d="M0 8H31M0 17H31M0 27H31" stroke="rgba(255,255,255,.075)" strokeWidth="2" />
      </pattern>
    );
  }
  if (family === 'crystal') {
    return (
      <pattern id={id} width="54" height="54" patternUnits="userSpaceOnUse">
        <path d="M0 0 54 54M54 0 0 54M27 0V54" stroke="rgba(255,255,255,.13)" strokeWidth="1.5" />
      </pattern>
    );
  }
  return (
    <pattern id={id} width="24" height="24" patternUnits="userSpaceOnUse">
      <circle cx="3" cy="3" r="1.2" fill="rgba(255,255,255,.11)" />
    </pattern>
  );
}

export function WheelSegmentsSvg({
  family,
  palette,
  segmentCount,
  themeId = 'studio',
}: {
  family: WheelSkinFamily;
  palette: string[];
  segmentCount: number;
  themeId?: string;
}) {
  const count = Math.max(1, segmentCount);
  const colors = palette.length ? palette : ['#f8fafc', '#111827'];
  const uid = React.useId().replace(/:/g, '');
  const textureId = `${uid}-texture`;
  const glossId = `${uid}-gloss`;
  const depthId = `${uid}-depth`;

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 1000 1000" aria-hidden="true" data-wheel-theme={themeId}>
      <defs>
        <linearGradient id={glossId} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="white" stopOpacity=".34" />
          <stop offset=".24" stopColor="white" stopOpacity=".06" />
          <stop offset=".64" stopColor="black" stopOpacity="0" />
          <stop offset="1" stopColor="black" stopOpacity=".30" />
        </linearGradient>
        <radialGradient id={depthId} cx="50%" cy="42%" r="64%">
          <stop offset="42%" stopColor="black" stopOpacity="0" />
          <stop offset="78%" stopColor="black" stopOpacity=".12" />
          <stop offset="100%" stopColor="black" stopOpacity=".42" />
        </radialGradient>
        {texturePattern(family, textureId)}
        {Array.from({ length: count }).map((_, index) => {
          const base = colors[index % colors.length];
          const next = colors[(index + 1) % colors.length];
          return (
            <linearGradient key={`${uid}-fill-${index}`} id={`${uid}-fill-${index}`} x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor={base} />
              <stop offset=".58" stopColor={base} />
              <stop offset="1" stopColor={next} stopOpacity=".86" />
            </linearGradient>
          );
        })}
      </defs>

      <circle cx="500" cy="500" r="492" fill="rgba(2,6,23,.92)" />
      {Array.from({ length: count }).map((_, index) => {
        const d = segmentPath(index, count, family);
        return (
          <g key={`${themeId}-segment-${index}`}>
            <path d={d} fill={`url(#${uid}-fill-${index})`} />
            <path d={d} fill={`url(#${textureId})`} opacity={family === 'mono' ? 0.46 : 0.62} />
            <path d={d} fill={`url(#${glossId})`} opacity=".76" />
            <path d={d} fill="none" stroke="var(--roulette-segment-line)" strokeWidth={count > 18 ? 2 : 3.5} />
          </g>
        );
      })}
      <circle cx="500" cy="500" r="490" fill={`url(#${depthId})`} />
      <circle cx="500" cy="500" r="490" fill="none" stroke="rgba(255,255,255,.32)" strokeWidth="5" />
      <circle cx="500" cy="500" r="474" fill="none" stroke="rgba(255,255,255,.13)" strokeWidth="2" />
      <circle cx="500" cy="500" r="157" fill="none" stroke="rgba(0,0,0,.24)" strokeWidth="7" />
    </svg>
  );
}

function FamilyMotif({ family }: { family: WheelSkinFamily }) {
  if (family === 'deco') {
    return (
      <g fill="var(--roulette-tick)">
        {Array.from({ length: 12 }).map((_, index) => <rect key={index} x="491" y="9" width="18" height="18" transform={`rotate(${index * 30} 500 500) rotate(45 500 18)`} opacity=".88" />)}
      </g>
    );
  }
  if (family === 'crystal') {
    return (
      <g fill="none" stroke="var(--roulette-tick)" strokeWidth="3" opacity=".74">
        {Array.from({ length: 8 }).map((_, index) => <path key={index} d="M500 4 520 28 500 50 480 28Z" transform={`rotate(${index * 45} 500 500)`} />)}
      </g>
    );
  }
  if (family === 'arcade') {
    return (
      <g fill="var(--roulette-tick)" opacity=".86">
        {Array.from({ length: 16 }).map((_, index) => <rect key={index} x="494" y="5" width="12" height={index % 2 ? 18 : 28} transform={`rotate(${index * 22.5} 500 500)`} />)}
      </g>
    );
  }
  if (family === 'nova') {
    return (
      <g fill="none" stroke="var(--roulette-tick)" opacity=".52">
        <ellipse cx="500" cy="500" rx="510" ry="470" strokeWidth="2" transform="rotate(18 500 500)" />
        <ellipse cx="500" cy="500" rx="510" ry="470" strokeWidth="2" transform="rotate(-18 500 500)" />
      </g>
    );
  }
  if (family === 'ceramic') {
    return (
      <g fill="var(--roulette-tick)" opacity=".82">
        {Array.from({ length: 24 }).map((_, index) => <circle key={index} cx="500" cy="19" r="5" transform={`rotate(${index * 15} 500 500)`} />)}
      </g>
    );
  }
  if (family === 'velvet') {
    return (
      <g fill="var(--roulette-tick)" stroke="rgba(0,0,0,.45)" strokeWidth="2">
        {Array.from({ length: 16 }).map((_, index) => <circle key={index} cx="500" cy="17" r="7" transform={`rotate(${index * 22.5} 500 500)`} />)}
      </g>
    );
  }
  return null;
}

export const WheelSkinOrnaments = React.memo(function WheelSkinOrnaments({
  family,
  themeId = 'studio',
}: {
  family: WheelSkinFamily;
  themeId?: string;
}) {
  const uid = React.useId().replace(/:/g, '');
  return (
    <svg className="roulette-wheel-ornaments pointer-events-none absolute inset-[-2.5%] z-20 h-[105%] w-[105%] overflow-visible" viewBox="0 0 1000 1000" aria-hidden="true" data-wheel-chrome={themeId}>
      <defs>
        <filter id={`${uid}-chrome-shadow`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="10" stdDeviation="14" floodColor="#000" floodOpacity=".58" />
        </filter>
      </defs>
      <circle cx="500" cy="500" r="494" fill="none" stroke="var(--roulette-rim-line)" strokeWidth="38" opacity=".54" filter={`url(#${uid}-chrome-shadow)`} />
      <circle cx="500" cy="500" r="491" fill="none" stroke="var(--roulette-rim-line)" strokeWidth="2.5" opacity=".88" />
      <circle cx="500" cy="500" r="469" fill="none" stroke="rgba(0,0,0,.52)" strokeWidth="7" />
      <g stroke="var(--roulette-tick)" strokeLinecap="round">
        {Array.from({ length: 48 }).map((_, index) => (
          <line key={index} x1="500" y1={index % 4 === 0 ? 18 : 24} x2="500" y2={index % 4 === 0 ? 41 : 36} strokeWidth={index % 4 === 0 ? 4 : 2} opacity={index % 4 === 0 ? .92 : .54} transform={`rotate(${index * 7.5} 500 500)`} />
        ))}
      </g>
      <FamilyMotif family={family} />
    </svg>
  );
});

export function WheelSelectedSegment({ selectedIndex, segmentCount, family = 'mono' }: { selectedIndex: number; segmentCount: number; family?: WheelSkinFamily }) {
  const uid = React.useId().replace(/:/g, '');
  if (selectedIndex < 0 || segmentCount < 1) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 1000 1000" aria-hidden="true">
      <defs>
        <filter id={`${uid}-selected-glow`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0" stdDeviation="13" floodColor="var(--roulette-result)" floodOpacity=".82" />
        </filter>
        <linearGradient id={`${uid}-selected-fill`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="white" stopOpacity=".34" />
          <stop offset=".55" stopColor="var(--roulette-result)" stopOpacity=".12" />
          <stop offset="1" stopColor="white" stopOpacity=".05" />
        </linearGradient>
      </defs>
      <path d={segmentPath(selectedIndex, segmentCount, family)} fill={`url(#${uid}-selected-fill)`} stroke="var(--roulette-result)" strokeWidth="7" strokeLinejoin="round" filter={`url(#${uid}-selected-glow)`} />
    </svg>
  );
}

export function WheelLabelsSvg({ labelLines, selectedIndex }: { labelLines: string[][]; selectedIndex: number }) {
  const count = Math.max(1, labelLines.length);
  const segmentDeg = 360 / count;
  const fontSize = count > 18 ? 20 : count > 14 ? 24 : count > 10 ? 29 : count > 7 ? 35 : 42;
  const radius = count > 14 ? 356 : count > 9 ? 352 : 344;
  return (
    <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 1000 1000" aria-hidden="true">
      {labelLines.map((lines, index) => {
        const centerAngle = (index * segmentDeg) + (segmentDeg / 2);
        const point = polarPoint(500, 500, radius, centerAngle);
        const isSelected = index === selectedIndex;
        const lineGap = fontSize * 0.92;
        return (
          <g key={`wheel-label-${index}`} transform={`rotate(${centerAngle} ${point.x} ${point.y})`}>
            <text
              x={point.x}
              y={point.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={isSelected ? 'var(--roulette-result)' : 'rgba(255,255,255,.97)'}
              fontFamily="var(--roulette-font-display)"
              fontSize={isSelected ? fontSize + 2 : fontSize}
              fontWeight="850"
              letterSpacing={count > 12 ? '-.02em' : '-.01em'}
              stroke="rgba(0,0,0,.76)"
              strokeWidth={count > 14 ? 6 : 7.5}
              paintOrder="stroke fill"
            >
              {lines.map((line, lineIndex) => (
                <tspan key={`${line}-${lineIndex}`} x={point.x} dy={lines.length === 1 ? 0 : (lineIndex === 0 ? -lineGap / 2 : lineGap)}>{line}</tspan>
              ))}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export const WheelGlassOverlay = React.memo(function WheelGlassOverlay() {
  return (
    <div className="pointer-events-none absolute inset-[8.4%] z-20 overflow-hidden rounded-full" aria-hidden="true">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_36%_20%,rgba(255,255,255,.28),transparent_25%),linear-gradient(145deg,rgba(255,255,255,.10),transparent_38%,rgba(0,0,0,.16))] opacity-70" />
      <div className="absolute left-[12%] top-[8%] h-[24%] w-[52%] -rotate-[18deg] rounded-full border-t border-white/35 opacity-55 blur-[1px]" />
    </div>
  );
});

export const WheelPointer = React.memo(function WheelPointer({ themeId = 'studio' }: { themeId?: string }) {
  const uid = React.useId().replace(/:/g, '');
  return (
    <svg className="pointer-events-none absolute left-1/2 top-[-1.7%] z-50 h-[18%] w-[17%] -translate-x-1/2 overflow-visible" viewBox="0 0 180 190" aria-hidden="true" data-pointer-theme={themeId}>
      <defs>
        <linearGradient id={`${uid}-pointer-metal`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="white" stopOpacity=".96" />
          <stop offset=".42" stopColor="var(--roulette-pointer)" />
          <stop offset="1" stopColor="black" stopOpacity=".42" />
        </linearGradient>
        <filter id={`${uid}-pointer-shadow`} x="-50%" y="-30%" width="200%" height="200%">
          <feDropShadow dx="0" dy="10" stdDeviation="9" floodColor="#000" floodOpacity=".72" />
          <feDropShadow dx="0" dy="0" stdDeviation="7" floodColor="var(--roulette-shadow)" floodOpacity=".9" />
        </filter>
      </defs>
      <path d="M90 174 37 67 55 26h70l18 41Z" fill={`url(#${uid}-pointer-metal)`} stroke="rgba(255,255,255,.56)" strokeWidth="3" filter={`url(#${uid}-pointer-shadow)`} />
      <path d="M90 154 61 72 71 48h38l10 24Z" fill="var(--roulette-pointer-core)" stroke="rgba(0,0,0,.3)" strokeWidth="3" />
      <circle cx="90" cy="60" r="10" fill="var(--roulette-pointer)" opacity=".9" />
    </svg>
  );
});
