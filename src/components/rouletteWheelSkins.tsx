import React from 'react';
import type { WheelSkinFamily } from './rouletteWheelUtils';

function polarPoint(cx: number, cy: number, radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: +(cx + (Math.cos(radians) * radius)).toFixed(3),
    y: +(cy + (Math.sin(radians) * radius)).toFixed(3),
  };
}

function segmentPath(index: number, segmentCount: number) {
  const count = Math.max(1, segmentCount);
  if (count === 1) {
    return 'M 500 7 A 493 493 0 1 1 499.9 7 Z';
  }
  const segmentDeg = 360 / count;
  const gap = Math.min(1.6, segmentDeg * 0.045);
  const start = (index * segmentDeg) + gap;
  const end = ((index + 1) * segmentDeg) - gap;
  const largeArc = end - start > 180 ? 1 : 0;
  const outerStart = polarPoint(500, 500, 493, start);
  const outerEnd = polarPoint(500, 500, 493, end);
  return [
    'M 500 500',
    `L ${outerStart.x} ${outerStart.y}`,
    `A 493 493 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    'Z',
  ].join(' ');
}

export function WheelSegmentsSvg({ family, palette, segmentCount }: { family: WheelSkinFamily; palette: string[]; segmentCount: number }) {
  const count = Math.max(1, segmentCount);
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 1000 1000" aria-hidden="true">
      <defs>
        <linearGradient id="rouletteSegmentShade" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,0.22)" />
          <stop offset="0.36" stopColor="rgba(255,255,255,0.03)" />
          <stop offset="1" stopColor="rgba(0,0,0,0.24)" />
        </linearGradient>
        <filter id="rouletteSegmentTexture" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency={family === 'mono' ? '0.018 0.68' : '0.035 0.16'} numOctaves="2" seed="29" result="noise" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .12 0" result="grain" />
          <feBlend in="SourceGraphic" in2="grain" mode="screen" result="textured" />
          <feComposite in="textured" in2="SourceAlpha" operator="in" />
        </filter>
        {Array.from({ length: count }).map((_, index) => (
          <linearGradient key={`segment-gradient-${index}`} id={`rouletteSegmentFill${index}`} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.16" />
            <stop offset="0.2" stopColor={palette[index % palette.length]} />
            <stop offset="0.82" stopColor={palette[index % palette.length]} />
            <stop offset="1" stopColor="#050508" stopOpacity="0.22" />
          </linearGradient>
        ))}
      </defs>
      {Array.from({ length: count }).map((_, index) => {
        const d = segmentPath(index, count);
        return (
          <g key={`segment-${index}`}>
            <path d={d} fill={`url(#rouletteSegmentFill${index})`} filter="url(#rouletteSegmentTexture)" />
            <path d={d} fill="url(#rouletteSegmentShade)" opacity="0.48" />
            <path d={d} fill="none" stroke="rgba(255,255,255,0.26)" strokeWidth="3" />
          </g>
        );
      })}
      <circle cx="500" cy="500" r="493" fill="none" stroke="rgba(255,255,255,0.36)" strokeWidth="6" />
    </svg>
  );
}

export const WheelSkinOrnaments = React.memo(function WheelSkinOrnaments({ family }: { family: WheelSkinFamily }) {
  return (
    <svg className="roulette-wheel-ornaments pointer-events-none absolute inset-[-1.8%] z-20 h-[103.6%] w-[103.6%] overflow-visible" viewBox="0 0 1000 1000" aria-hidden="true">
      <circle cx="500" cy="500" r="476" fill="none" stroke="var(--roulette-accent-2)" strokeWidth="3" opacity={family === 'mono' ? 0.34 : 0.52} />
      <circle cx="500" cy="500" r="452" fill="none" stroke="rgba(255,255,255,0.26)" strokeWidth="2" strokeDasharray="4 18" />
    </svg>
  );
});

export function WheelSelectedSegment({ selectedIndex, segmentCount }: { selectedIndex: number; segmentCount: number }) {
  if (selectedIndex < 0 || segmentCount < 1) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 1000 1000" aria-hidden="true">
      <defs>
        <filter id="rouletteSelectedGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0" stdDeviation="10" floodColor="currentColor" floodOpacity="0.64" />
        </filter>
      </defs>
      <path d={segmentPath(selectedIndex, segmentCount)} fill="rgba(255,255,255,0.12)" stroke="var(--roulette-result)" strokeWidth="8" strokeLinejoin="round" filter="url(#rouletteSelectedGlow)" />
    </svg>
  );
}

export function WheelLabelsSvg({ labelLines, selectedIndex }: { labelLines: string[][]; selectedIndex: number }) {
  const count = Math.max(1, labelLines.length);
  const segmentDeg = 360 / count;
  const fontSize = count > 12 ? 26 : count > 8 ? 32 : count > 5 ? 38 : 44;
  const radius = count > 10 ? 360 : 350;
  return (
    <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 1000 1000" aria-hidden="true">
      {labelLines.map((lines, index) => {
        const centerAngle = (index * segmentDeg) + (segmentDeg / 2);
        const point = polarPoint(500, 500, radius, centerAngle);
        const isSelected = index === selectedIndex;
        const lineGap = fontSize * 0.92;
        return (
          <g key={`wheel-label-${index}`} transform={`rotate(${centerAngle} ${point.x} ${point.y})`}>
            <text x={point.x} y={point.y} textAnchor="middle" dominantBaseline="middle" fill={isSelected ? 'var(--roulette-result)' : 'rgba(255,255,255,0.96)'} fontSize={isSelected ? fontSize + 2 : fontSize} fontWeight="800" stroke="rgba(0,0,0,0.68)" strokeWidth="7" paintOrder="stroke fill">
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
