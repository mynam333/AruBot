import React from 'react';
import { getRouletteThemeArtwork } from './rouletteThemes';
import { createWheelSegments, getWheelThemeId, wheelLabelForeground, wheelLabelGraphemes } from './rouletteWheelUtils';
import type { WheelSegment, WheelSkinFamily, WheelThemeId } from './rouletteWheelUtils';

function polarPoint(cx: number, cy: number, radius: number, angle: number, exact = false) {
  const radians = ((angle - 90) * Math.PI) / 180;
  const x = cx + Math.cos(radians) * radius;
  const y = cy + Math.sin(radians) * radius;
  return exact ? { x, y } : { x: +x.toFixed(3), y: +y.toFixed(3) };
}

function safeCount(count: number) {
  return Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
}

function contourPath(radius: number, amplitude: number, waves: number, phase = 0) {
  return Array.from({ length: 240 }, (_, index) => {
    const angle = index * 1.5;
    const r = radius + amplitude * Math.cos((angle * waves + phase) * Math.PI / 180);
    const point = polarPoint(500, 500, r, angle);
    return `${index ? 'L' : 'M'}${point.x} ${point.y}`;
  }).join(' ') + ' Z';
}

function ringPath(outer: string, innerRadius = 414) {
  return `${outer} M500 ${500 - innerRadius} A${innerRadius} ${innerRadius} 0 1 0 500 ${500 + innerRadius} A${innerRadius} ${innerRadius} 0 1 0 500 ${500 - innerRadius} Z`;
}

function arcBetween(radius: number, start: number, end: number) {
  const sweep = end >= start ? 1 : 0;
  const point = polarPoint(500, 500, radius, end, true);
  const finish = `A${radius} ${radius} 0 0 ${sweep} ${point.x} ${point.y}`;
  if (Math.abs(end - start) <= 180) return finish;
  // Two arcs keep near-full sectors visible when the browser rounds close endpoints.
  const middle = polarPoint(500, 500, radius, (start + end) / 2, true);
  return `A${radius} ${radius} 0 0 ${sweep} ${middle.x} ${middle.y} ${finish}`;
}

function bandPath(inner: number, outer: number, start: number, end: number) {
  if (end <= start) return '';
  if (end - start >= 360) return ringPath(`M500 ${500 - outer}A${outer} ${outer} 0 1 1 500 ${500 + outer}A${outer} ${outer} 0 1 1 500 ${500 - outer}Z`, inner);
  const a = polarPoint(500, 500, outer, start, true);
  const c = polarPoint(500, 500, inner, end, true);
  return `M${a.x} ${a.y} ${arcBetween(outer, start, end)} L${c.x} ${c.y} ${arcBetween(inner, end, start)} Z`;
}

function segmentPath({ start, end, span }: WheelSegment) {
  if (span <= 0) return '';
  if (span >= 360) return 'M500 10 A490 490 0 1 1 500 990 A490 490 0 1 1 500 10 Z';
  const a = polarPoint(500, 500, 490, start, true);
  return `M500 500 L${a.x} ${a.y} ${arcBetween(490, start, end)} Z`;
}

const inkByTheme: Record<WheelThemeId, string> = {
  studio: '#202326', prism: '#172c34', aurora: '#164c4d', velvet: '#f8dea1',
  mono: '#151719', deco: '#ead59b', crystal: '#244c62', ink: '#262924',
  nova: '#e0a779', ceramic: '#1746a0', arcade: '#fff3bd', sakura: '#71233e',
  ocean: '#d2f7ed', solar: '#571d0d', cyber: '#c6ff51', gold: '#efe1b4',
};

function matteMaterial(theme: WheelThemeId) {
  return theme === 'mono' || theme === 'ink';
}

function flatSectorMaterial(theme: WheelThemeId) {
  return matteMaterial(theme) || theme === 'arcade' || theme === 'cyber';
}

function MaterialDefs({ theme, id }: { theme: WheelThemeId; id: string }) {
  const soft = theme === 'sakura' || theme === 'velvet';
  const glass = theme === 'crystal' || theme === 'ceramic' || theme === 'ocean' || theme === 'aurora';
  return <>
    <linearGradient id={`${id}-bevel`} x1="0" y1="0" x2="1" y2="1">
      <stop stopColor="#fff" stopOpacity={soft ? '.28' : '.65'} />
      <stop offset=".28" stopColor="#fff" stopOpacity=".08" />
      <stop offset=".52" stopColor="#10191a" stopOpacity=".16" />
      <stop offset=".74" stopColor="#fff" stopOpacity={soft ? '.12' : '.42'} />
      <stop offset="1" stopColor="#10191a" stopOpacity=".25" />
    </linearGradient>
    <radialGradient id={`${id}-surface`} cx=".42" cy=".32" r=".72">
      <stop stopColor="#fff" stopOpacity={soft ? '.1' : glass ? '.24' : '.15'} />
      <stop offset=".55" stopColor="#fff" stopOpacity=".015" />
      <stop offset=".88" stopColor="#142027" stopOpacity={soft ? '.08' : '.06'} />
      <stop offset="1" stopColor="#142027" stopOpacity={glass ? '.19' : '.12'} />
    </radialGradient>
    <radialGradient id={`${id}-lip`}>
      <stop offset=".84" stopColor="#10191a" stopOpacity="0" />
      <stop offset=".91" stopColor="#10191a" stopOpacity=".2" />
      <stop offset=".94" stopColor="#fff" stopOpacity=".48" />
      <stop offset=".975" stopColor="#fff" stopOpacity=".1" />
      <stop offset="1" stopColor="#10191a" stopOpacity=".16" />
    </radialGradient>
  </>;
}

function texturePattern(themeId: WheelThemeId, id: string) {
  const common = { id, patternUnits: 'userSpaceOnUse' as const };
  switch (themeId) {
    case 'studio': return <pattern {...common} width="24" height="24"><path d="M2 0V8M14 0V4" stroke="#151719" strokeWidth="1.5" /></pattern>;
    case 'prism': return <pattern {...common} width="60" height="40"><path d="M0 40 30 0 60 40M30 0V40" fill="none" stroke="#172c34" strokeWidth="2" /></pattern>;
    case 'aurora': return <pattern {...common} width="90" height="36"><path d="M-15 28Q8-3 30 18T75 18T120 18M-15 36Q8 5 30 26T75 26T120 26" fill="none" stroke="#befaf0" strokeWidth="2" /></pattern>;
    case 'velvet': return <pattern {...common} width="20" height="20"><path d="M5 0V20M8 0V20" stroke="#4e142a" strokeWidth="1" /></pattern>;
    case 'mono': return <pattern {...common} width="32" height="32"><path d="M0 0 32 32" stroke="#151719" strokeWidth="2" /></pattern>;
    case 'deco': return <pattern {...common} width="64" height="40"><path d="M0 40 32 0 64 40M8 40 32 10 56 40M16 40 32 20 48 40" fill="none" stroke="#e8ce88" strokeWidth="1.5" /></pattern>;
    case 'crystal': return <pattern {...common} width="72" height="60"><path d="M0 0 36 20 72 0M0 60 36 20 72 60M36 20V0" fill="none" stroke="#efffff" strokeWidth="2" /></pattern>;
    case 'ink': return <pattern {...common} width="73" height="57"><path d="M3 7 17 9M39 19 58 16M11 41 38 42M61 49 70 48" stroke="#34382f" strokeWidth=".9" /><path d="M24 0 27 17M51 37 54 53" stroke="#34382f" strokeWidth=".5" /></pattern>;
    case 'nova': return <pattern {...common} width="52" height="52"><path d="M20 26H32M26 20V32" stroke="#d5a078" strokeWidth="1.5" /><circle cx="0" cy="0" r="2" fill="#d5a078" /></pattern>;
    case 'ceramic': return <pattern {...common} width="60" height="30"><path d="M-15 28Q0 0 15 28T45 28T75 28M-15 28Q0 10 15 28T45 28T75 28" fill="none" stroke="#1746a0" strokeWidth="2" /></pattern>;
    case 'arcade': return <pattern {...common} width="32" height="32"><path d="M0 0H16V16H32" fill="none" stroke="#131b25" strokeWidth="4" /><rect x="4" y="22" width="6" height="6" fill="#fff3bd" /></pattern>;
    case 'sakura': return <pattern {...common} width="60" height="44"><path d="M0 44Q30-16 60 44M8 44Q30 0 52 44M16 44Q30 16 44 44" fill="none" stroke="#8d3551" strokeWidth="1.5" /></pattern>;
    case 'ocean': return <pattern {...common} width="72" height="36"><path d="M-18 20Q0-2 18 20T54 20T90 20M-18 30Q0 8 18 30T54 30T90 30" fill="none" stroke="#b8eee2" strokeWidth="2" /></pattern>;
    case 'solar': return <pattern {...common} width="36" height="42"><path d="M0 42 18 0 36 42M18 12V36" fill="none" stroke="#a63518" strokeWidth="2" /></pattern>;
    case 'cyber': return <pattern {...common} width="72" height="48"><path d="M0 8H20L32 20H72M0 36H44L56 24H72" fill="none" stroke="#bcff4a" strokeWidth="2" /><rect x="28" y="16" width="7" height="7" fill="#bcff4a" /></pattern>;
    case 'gold': return <pattern {...common} width="42" height="56"><path d="M21 56V0M21 42Q1 39 5 23Q24 25 21 42M21 27Q42 24 37 8Q18 11 21 27" fill="none" stroke="#e4d09a" strokeWidth="1.5" /></pattern>;
  }
}

export const WheelSegmentsSvg = React.memo(function WheelSegmentsSvg({ palette, segmentCount, themeId = 'studio', weights }: {
  family: WheelSkinFamily; palette: string[]; segmentCount: number; themeId?: string; weights?: number[];
}) {
  const count = safeCount(segmentCount);
  const segments = createWheelSegments(count, weights);
  const theme = getWheelThemeId(themeId);
  const colors = palette.length ? palette : ['#f7f7f3', '#25282b'];
  const uid = React.useId().replace(/:/g, '');
  const lightPaper = theme === 'ink' || theme === 'ceramic' || theme === 'sakura' || theme === 'mono';
  return (
    <svg className={`roulette-wheel-sectors roulette-wheel-sectors--${theme} pointer-events-none absolute inset-0 h-full w-full overflow-visible`} viewBox="0 0 1000 1000" aria-hidden="true" data-wheel-theme={themeId}>
      <defs>
        {texturePattern(theme, `${uid}-texture`)}
        {!flatSectorMaterial(theme) ? <MaterialDefs theme={theme} id={uid} /> : null}
        <clipPath id={`${uid}-border`}><path d={ringPath('M500 8A492 492 0 1 1 500 992A492 492 0 1 1 500 8Z', 454)} clipRule="evenodd" /></clipPath>
      </defs>
      <circle cx="500" cy="500" r="498" fill={lightPaper ? '#f6f6ef' : '#172226'} />
      {segments.map((segment, index) => {
        if (segment.span <= 0) return null;
        const d = segmentPath(segment);
        const color = colors[index % colors.length];
        const foreground = wheelLabelForeground(color, inkByTheme[theme]);
        const angle = segment.center;
        const marker = polarPoint(500, 500, 476, angle);
        const detailGap = Math.min(2, segment.span * .08);
        return (
          <g key={`${themeId}-segment-${index}`} data-wheel-segment-index={index} data-wheel-segment-start={segment.start} data-wheel-segment-end={segment.end}>
            <path d={d} fill={color} />
            {!flatSectorMaterial(theme) ? <path d={d} fill={`url(#${uid}-surface)`} /> : null}
            {segment.span >= 4 ? <>
              <path d={bandPath(480, 487, segment.start + detailGap, segment.end - detailGap)} fill={foreground} opacity=".16" />
              <path d={bandPath(477, 478.2, segment.start + detailGap, segment.end - detailGap)} fill={foreground} opacity=".46" />
            </> : null}
            {segment.span >= 7.5 && (theme === 'velvet' || theme === 'sakura') ? <path d={bandPath(451, 452, segment.start + detailGap, segment.end - detailGap)} fill="none" stroke={foreground} strokeWidth=".85" strokeDasharray={theme === 'velvet' ? '2 6' : '1 8'} opacity=".5" /> : null}
            {segment.span >= 15 && (theme === 'prism' || theme === 'crystal') ? <path d={bandPath(456, 473, segment.start + detailGap, segment.center)} fill="#fff" opacity={theme === 'crystal' ? '.32' : '.16'} /> : null}
            {segment.span >= 7.5 ? <path d={d} fill={`url(#${uid}-texture)`} opacity={theme === 'ceramic' ? .58 : theme === 'ink' ? .18 : .24} clipPath={`url(#${uid}-border)`} /> : null}
            {segment.span >= 10 && theme === 'studio' ? <path d={bandPath(455, 460, segment.start + detailGap, segment.end - detailGap)} fill={foreground} opacity=".4" /> : null}
            {segment.span >= 7.5 && (theme === 'arcade' || theme === 'cyber') ? <rect x={marker.x - 3} y={marker.y - 6} width="6" height="12" fill={foreground} opacity=".72" transform={`rotate(${angle} ${marker.x} ${marker.y})`} /> : null}
          </g>
        );
      })}
      {segments.length > 1 ? <g fill="none" strokeLinecap="butt" data-wheel-hairlines={theme}>
        {segments.filter(segment => segment.span > .12 && segment.span < 360).map((segment, index) => {
          const inner = polarPoint(500, 500, 100, segment.start);
          const outer = polarPoint(500, 500, 489, segment.start);
          return <g key={index}>
            {!flatSectorMaterial(theme) ? <path d={`M${inner.x} ${inner.y}L${outer.x} ${outer.y}`} stroke="#fff" strokeOpacity=".28" strokeWidth="2.2" /> : null}
            <path d={`M${inner.x} ${inner.y}L${outer.x} ${outer.y}`} stroke={matteMaterial(theme) ? inkByTheme[theme] : '#142027'} strokeOpacity={matteMaterial(theme) ? '.3' : '.32'} strokeWidth={matteMaterial(theme) ? '.8' : '.65'} />
          </g>;
        })}
      </g> : null}
      <circle cx="500" cy="500" r="491" fill="none" stroke={inkByTheme[theme]} strokeWidth={theme === 'arcade' ? 7 : 2} opacity=".7" />
      {theme === 'ink' ? <path d={contourPath(487, 2, 13)} fill="none" stroke="#30342e" strokeWidth="3" opacity=".36" /> : null}
    </svg>
  );
});

export const WheelSkinOrnaments = React.memo(function WheelSkinOrnaments({ family, themeId }: { family: WheelSkinFamily; themeId?: string }) {
  const theme = getWheelThemeId(themeId || family);
  const uid = React.useId().replace(/:/g, '');
  return <svg className={`roulette-wheel-ornaments roulette-wheel-ornaments--${theme} pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible`} viewBox="0 0 1000 1000" aria-hidden="true" data-wheel-chrome={themeId || theme}>
    <g data-wheel-rim-finish={theme}>{getRouletteThemeArtwork(theme).rim(`${uid}-rim`)}</g>
  </svg>;
});

export function WheelSelectedSegment({ selectedIndex, segmentCount, family = 'mono', themeId, weights }: { selectedIndex: number; segmentCount: number; family?: WheelSkinFamily; themeId?: string; weights?: number[] }) {
  const count = safeCount(segmentCount);
  const theme = getWheelThemeId(themeId || family);
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= count || segmentCount < 1) return null;
  const segment = createWheelSegments(count, weights)[selectedIndex];
  if (segment.span <= 0) return null;
  const angle = segment.center;
  const graphic = theme === 'arcade' || theme === 'cyber' || theme === 'mono';
  const color = theme === 'studio' || theme === 'ink' ? '#c83f36' : theme === 'ceramic' ? '#1746a0' : theme === 'sakura' ? '#832c4e' : 'var(--roulette-result)';
  const inset = segment.span >= 360 ? 0 : Math.min(.8, segment.span * .025);
  const start = segment.start + inset;
  const end = segment.end - inset;
  const strokeWidth = Math.min(1.6, segment.span * Math.PI / 180 * 250 * .12);
  return <svg className={`roulette-wheel-selection roulette-wheel-selection--${theme} pointer-events-none absolute inset-0 h-full w-full overflow-visible`} viewBox="0 0 1000 1000" aria-hidden="true" data-wheel-selection={theme}>
    <path d={segmentPath(segment)} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin={graphic ? 'miter' : 'round'} strokeDasharray={theme === 'mono' ? '9 6' : undefined} opacity=".9" />
    <path d={bandPath(468, 484, start, end)} fill={color} opacity=".12" />
    <path d={bandPath(479, 483, start, end)} fill={color} />
    <path d={bandPath(470, 471.2, start, end)} fill={color} opacity=".8" />
    {!flatSectorMaterial(theme) ? <path d={bandPath(477, 478, start, end)} fill="#fff" opacity=".7" /> : null}
    {segment.span >= 5.625 ? <g transform={`rotate(${angle} 500 500)`} fill={color}>{graphic ? <path d="M491 39H509V48H504V56H496V48H491Z" /> : <path d="M491 37Q500 42 509 37L500 55Z" />}</g> : null}
  </svg>;
}

function labelUnits(text: string) {
  return wheelLabelGraphemes(text).reduce((total, character) => total + (/\s/u.test(character) ? .36 : /^[ilI1.,'!:;|]$/u.test(character) ? .38 : /^[MWmw]$/u.test(character) ? 1.08 : /^[A-Z]$/u.test(character) ? .84 : /^[a-z0-9]$/u.test(character) ? .72 : 1.04), 0);
}

function shortenLabel(text: string, maxUnits: number) {
  if (labelUnits(text) <= maxUnits) return text;
  const letters = wheelLabelGraphemes(text);
  let units = 0;
  let end = 0;
  while (end < letters.length && units + labelUnits(letters[end]) + 1 <= maxUnits) {
    units += labelUnits(letters[end]);
    end += 1;
  }
  return end ? `${letters.slice(0, end).join('').trimEnd()}…` : '…';
}

export const WheelLabelsSvg = React.memo(function WheelLabelsSvg({ labelLines, selectedIndex, themeId = 'studio', palette, weights }: {
  labelLines: string[][]; selectedIndex: number; themeId?: string; palette?: string[]; weights?: number[];
}) {
  const segments = createWheelSegments(labelLines.length, weights);
  const theme = getWheelThemeId(themeId);
  return <svg className={`roulette-wheel-labels roulette-wheel-labels--${theme} pointer-events-none absolute inset-0 h-full w-full overflow-visible`} viewBox="0 0 1000 1000" aria-hidden="true" data-wheel-label-theme={theme}>
    {labelLines.map((sourceLines, index) => {
      const segment = segments[index];
      if (segment.span <= 0) return null;
      const radial = segment.span < 30;
      const radius = radial ? 333 : segment.span >= 180 ? 326 : 345;
      // Size against this sector, not the total item count; tiny sectors stay tiny.
      const arcWidth = 2 * (radial ? 204 : radius - 58) * Math.sin(Math.min(120, segment.span) * Math.PI / 360);
      const maxWidth = radial ? 246 : Math.min(450, arcWidth * .86);
      const baseFontSize = radial ? Math.min(28, arcWidth * .7) : segment.span < 45 ? 31 : segment.span < 72 ? 38 : 44;
      const lines = sourceLines.filter(Boolean).slice(0, 2);
      const fullLabel = sourceLines.join(' ');
      const displayLines = radial && segment.span < 360 / 26 ? [fullLabel] : lines.length ? lines : [''];
      const widthUnits = Math.max(1, ...displayLines.map(labelUnits));
      const heightLimit = radial ? arcWidth * .8 / (displayLines.length * 1.22) : 46;
      const fontSize = Math.min(baseFontSize, heightLimit, Math.max(baseFontSize * .7, maxWidth / widthUnits));
      if (fontSize < 12) return null;
      const centerAngle = segment.center;
      const point = polarPoint(500, 500, radius, centerAngle);
      const rotation = radial ? centerAngle + (centerAngle <= 180 ? -90 : 90) : centerAngle + (centerAngle > 90 && centerAngle < 270 ? 180 : 0);
      const fill = palette?.length ? wheelLabelForeground(palette[index % palette.length], inkByTheme[theme]) : inkByTheme[theme];
      return <g key={`wheel-label-${index}`} transform={`rotate(${rotation} ${point.x} ${point.y})`} data-wheel-label-index={index} data-selected={index === selectedIndex ? 'true' : 'false'}>
        <title>{fullLabel}</title>
        <text x={point.x} y={point.y} textAnchor="middle" dominantBaseline="middle" fill={fill} fontFamily="var(--roulette-font-display)" fontSize={fontSize} fontWeight={theme === 'ink' || theme === 'deco' ? '700' : '800'} letterSpacing="0" stroke="none" paintOrder="stroke fill">
          {displayLines.map((line, lineIndex) => <tspan key={lineIndex} x={point.x} dy={lineIndex === 0 ? -(displayLines.length - 1) * fontSize * .61 : fontSize * 1.22}>{shortenLabel(line, maxWidth / fontSize)}</tspan>)}
        </text>
      </g>;
    })}
  </svg>;
});

export const WheelGlassOverlay = React.memo(function WheelGlassOverlay({ themeId = 'studio' }: { themeId?: string } = {}) {
  const theme = getWheelThemeId(themeId);
  if (!['aurora', 'crystal', 'ceramic', 'ocean'].includes(theme)) return null;
  return <svg className={`roulette-wheel-material roulette-wheel-material--${theme} pointer-events-none absolute inset-[8.6%] z-20 h-[82.8%] w-[82.8%] overflow-visible`} viewBox="0 0 1000 1000" aria-hidden="true" data-wheel-material={theme}>
    {theme === 'crystal' ? <g fill="#fff" fillOpacity=".18" stroke="#edffff" strokeWidth="2"><path d="M205 103 273 60 248 93 206 138Z" /><path d="M700 43 756 71 823 120 762 89Z" /><path d="M951 636 919 690 933 629Z" /></g> : null}
    {theme === 'aurora' ? <path d={bandPath(475, 479, 214, 316)} fill="#c2ffdf" opacity=".45" /> : null}
    {theme === 'ceramic' ? <path d={bandPath(480, 484, 270, 333)} fill="#fff" opacity=".9" /> : null}
    {theme === 'ocean' ? <g fill="none" stroke="#c6fff4" strokeWidth="2" opacity=".3"><path d={bandPath(478, 482, 32, 80)} /><path d={bandPath(478, 482, 213, 261)} /></g> : null}
  </svg>;
});

export const WheelPointer = React.memo(function WheelPointer({ themeId = 'studio' }: { themeId?: string }) {
  const theme = getWheelThemeId(themeId);
  const uid = React.useId().replace(/:/g, '');
  return <div className={`roulette-wheel-pointer roulette-wheel-pointer--${theme} pointer-events-none absolute left-[43%] top-[-1%] z-50 h-[16%] w-[14%]`} style={{ transformOrigin: '50% 24%', transform: 'rotate(var(--roulette-pointer-deflect, 0deg))' }} aria-hidden="true" data-pointer-theme={themeId}>
    <svg className="block h-full w-full overflow-visible" viewBox="0 0 180 200">{getRouletteThemeArtwork(theme).pointer(`${uid}-pointer`)}</svg>
  </div>;
});
