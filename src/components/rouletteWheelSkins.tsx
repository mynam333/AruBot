import React from 'react';
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

function polygonPoints(sides: number, radius: number, offset = 0) {
  return Array.from({ length: sides }, (_, index) => {
    const point = polarPoint(500, 500, radius, offset + index * 360 / sides);
    return `${point.x},${point.y}`;
  }).join(' ');
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

function RimFinish({ theme, id }: { theme: WheelThemeId; id: string }) {
  if (theme === 'mono') return <g fill="none" stroke="#181b1b"><circle cx="500" cy="500" r="484" strokeWidth=".8" /><circle cx="500" cy="500" r="430" strokeWidth=".7" /></g>;
  if (theme === 'ink') return <g fill="none" stroke="#f3f1e8" opacity=".62"><path d={contourPath(459, 7, 5, 16)} strokeWidth="1.2" strokeDasharray="39 12 7 24 91 8" /><path d={contourPath(466, 6, 5, 16)} strokeWidth=".7" strokeDasharray="70 32 9 18" /></g>;
  if (theme === 'cyber') return <g fill="none" stroke="#5adee1" strokeWidth=".9" data-wheel-rim-finish={theme}>
    <circle cx="500" cy="500" r="416" strokeDasharray="46 8 7 12" opacity=".65" />
    <circle cx="500" cy="500" r="430" strokeDasharray="30 6 3 6" opacity=".5" />
    {[45, 135, 225, 315].map(angle => <g key={angle} transform={`rotate(${angle} 500 500)`}><path d="M481 64H494L505 75H519" /><path d="M484 71H491L502 82H510" stroke="#ef91c7" /><rect x="479" y="62" width="3" height="3" fill="#c6ff51" stroke="none" /></g>)}
  </g>;
  const textile = theme === 'velvet' || theme === 'sakura';
  const metal = theme === 'deco' || theme === 'gold' || theme === 'nova' || theme === 'ocean';
  const edge = theme === 'velvet' ? '#f1d497' : theme === 'sakura' ? '#fff2f4' : inkByTheme[theme];
  return <g data-wheel-rim-finish={theme}>
    <path d={bandPath(415, 431, 0, 360)} fill={`url(#${id}-lip)`} fillRule="evenodd" opacity={textile ? '.5' : '.85'} />
    <path d={bandPath(418, 425, 0, 360)} fill={`url(#${id}-bevel)`} fillRule="evenodd" />
    <circle cx="500" cy="500" r="416" fill="none" stroke="#fff" strokeWidth="1.1" opacity=".48" />
    <circle cx="500" cy="500" r="428" fill="none" stroke="#10191a" strokeWidth=".8" opacity=".35" />
    {metal ? <>
      <path d={bandPath(477, 486, 0, 360)} fill={`url(#${id}-bevel)`} fillRule="evenodd" opacity=".65" />
      <circle cx="500" cy="500" r="474" fill="none" stroke={edge} strokeWidth=".8" opacity=".55" />
      <circle cx="500" cy="500" r="432" fill="none" stroke={edge} strokeWidth=".8" opacity=".7" />
    </> : null}
    {textile ? <>
      <path d={contourPath(theme === 'velvet' ? 477 : 474, theme === 'velvet' ? 8 : 10, theme === 'velvet' ? 24 : 8)} fill="none" stroke={edge} strokeWidth="1.1" strokeDasharray="2.2 5" opacity=".7" />
      <circle cx="500" cy="500" r="444" fill="none" stroke={edge} strokeWidth=".7" opacity=".45" />
    </> : null}
    {theme === 'ceramic' ? <>
      <path d={contourPath(483, 7, 32)} fill="none" stroke="#fff" strokeWidth="3" opacity=".8" />
      <circle cx="500" cy="500" r="440" fill="none" stroke="#1746a0" strokeWidth=".7" opacity=".65" />
    </> : null}
    {theme === 'aurora' ? <path d={contourPath(470, 17, 3, 25)} fill="none" stroke={`url(#${id}-bevel)`} strokeWidth="9" /> : null}
    {theme === 'studio' ? <circle cx="500" cy="500" r="483" fill="none" stroke={`url(#${id}-bevel)`} strokeWidth="15" /> : null}
    {theme === 'crystal' || theme === 'prism' ? <polygon points={polygonPoints(12, 488, 15)} fill="none" stroke={theme === 'crystal' ? '#fff' : '#f9fff7'} strokeWidth="1.3" opacity=".8" /> : null}
    {theme === 'solar' ? <circle cx="500" cy="500" r="453" fill="none" stroke={`url(#${id}-bevel)`} strokeWidth="25" /> : null}
    {theme === 'arcade' ? <circle cx="500" cy="500" r="430" fill="none" stroke={edge} strokeWidth="1" strokeDasharray="4 12" opacity=".55" /> : null}
  </g>;
}

function DialTicks({ count = 60, inner = 438, outer = 471, color = '#f5f6f4', majorEvery = 5, width = 2, skipAngles = [] }: {
  count?: number; inner?: number; outer?: number; color?: string; majorEvery?: number; width?: number; skipAngles?: number[];
}) {
  return <g stroke={color}>{Array.from({ length: count }, (_, index) => {
    const angle = index * 360 / count;
    if (angle < 9 || angle > 351 || skipAngles.includes(angle)) return null;
    const major = index % majorEvery === 0;
    return <line key={index} x1="500" y1={500 - outer} x2="500" y2={500 - (major ? inner : outer - (outer - inner) * .45)} strokeWidth={major ? width * 1.5 : width} opacity={major ? 1 : .65} transform={`rotate(${angle} 500 500)`} />;
  })}</g>;
}

function FamilyMotif({ themeId }: { themeId: WheelThemeId }) {
  switch (themeId) {
    case 'studio': return <>
      <circle cx="500" cy="500" r="454" fill="none" stroke="#25282b" strokeWidth="78" />
      <circle cx="500" cy="500" r="482" fill="none" stroke="#f3f4ef" strokeWidth="20" />
      <circle cx="500" cy="500" r="414" fill="none" stroke="#aeb5b6" strokeWidth="3" />
      <DialTicks count={72} inner={436} outer={466} majorEvery={6} />
      {[90, 180, 270].map((angle, index) => { const p = polarPoint(500, 500, 482, angle); return <text key={angle} x={p.x} y={p.y} fill="#25282b" fontSize="15" fontFamily="monospace" textAnchor="middle" dominantBaseline="middle" transform={`rotate(${angle} ${p.x} ${p.y})`}>{String((index + 1) * 15).padStart(2, '0')}</text>; })}
      <path d="M490 26H510V72H490Z" fill="#ed4940" />
    </>;
    case 'prism': return <>
      <path d={ringPath(`M${polygonPoints(12, 497, 15)}Z`)} fill="#20333b" fillRule="evenodd" />
      {Array.from({ length: 12 }, (_, index) => {
        const angle = index * 30 + 15;
        const a = polarPoint(500, 500, 493, angle); const b = polarPoint(500, 500, 493, angle + 30);
        const c = polarPoint(500, 500, 418, angle + 30); const d = polarPoint(500, 500, 418, angle);
        const mid = polarPoint(500, 500, 465, angle + 15);
        const colors = ['#64dada', '#ff7970', '#f5dc64'];
        return <g key={index} stroke="#20333b" strokeWidth="2"><path d={`M${a.x} ${a.y}L${b.x} ${b.y}L${c.x} ${c.y}L${d.x} ${d.y}Z`} fill={colors[index % 3]} /><path d={`M${a.x} ${a.y}L${mid.x} ${mid.y}L${d.x} ${d.y}Z`} fill="#fff" fillOpacity=".36" /><path d={`M${b.x} ${b.y}L${mid.x} ${mid.y}L${c.x} ${c.y}Z`} fill="#172c34" fillOpacity=".12" /></g>;
      })}
    </>;
    case 'aurora': return <>
      <path d={ringPath(contourPath(471, 17, 3, 25))} fill="#123e44" fillRule="evenodd" />
      <path d={contourPath(469, 17, 3, 25)} fill="none" stroke="#53d7bd" strokeWidth="12" />
      <path d={contourPath(454, 15, 3, 44)} fill="none" stroke="#9eeeda" strokeWidth="3" />
      <path d={contourPath(440, 9, 3, 65)} fill="none" stroke="#459b9d" strokeWidth="7" />
      <circle cx="500" cy="500" r="417" fill="none" stroke="#b5f8e4" strokeWidth="4" />
      {[35, 155, 275].map((angle) => <path key={angle} d="M471 27Q519 17 556 52Q506 39 464 72" fill="none" stroke="#d2faf0" strokeWidth="3" opacity=".75" transform={`rotate(${angle} 500 500)`} />)}
    </>;
    case 'velvet': return <>
      <path d={ringPath(contourPath(479, 11, 24))} fill="#771b37" fillRule="evenodd" stroke="#e4bd73" strokeWidth="4" />
      <circle cx="500" cy="500" r="446" fill="none" stroke="#481026" strokeWidth="45" />
      <circle cx="500" cy="500" r="426" fill="none" stroke="#f1d497" strokeWidth="5" />
      <circle cx="500" cy="500" r="439" fill="none" stroke="#c69056" strokeWidth="1.5" strokeDasharray="3 8" />
      {Array.from({ length: 24 }, (_, index) => <g key={index} transform={`rotate(${7.5 + index * 15} 500 500)`}><circle cx="500" cy="37" r="7" fill="#ebcf8d" stroke="#481026" strokeWidth="2" /><path d="M482 48Q500 66 518 48" fill="none" stroke="#b6606a" strokeWidth="3" /></g>)}
    </>;
    case 'mono': return <>
      <circle cx="500" cy="500" r="451" fill="none" stroke="#f4f4ef" strokeWidth="78" />
      <circle cx="500" cy="500" r="490" fill="none" stroke="#181b1b" strokeWidth="6" />
      <circle cx="500" cy="500" r="423" fill="none" stroke="#181b1b" strokeWidth="5" strokeDasharray="12 9" />
      {[45, 135, 225, 315].map((angle, index) => { const p = polarPoint(500, 500, 459, angle); return <text key={angle} x={p.x} y={p.y} fontSize="28" fontWeight="900" fontFamily="monospace" fill="#181b1b" textAnchor="middle" dominantBaseline="middle" transform={`rotate(${angle} ${p.x} ${p.y})`}>{String(index + 1).padStart(2, '0')}</text>; })}
      <DialTicks count={16} inner={447} outer={473} color="#181b1b" width={3} majorEvery={4} skipAngles={[45, 135, 225, 315]} />
    </>;
    case 'deco': return <>
      <path d={ringPath('M380 9H620V29H700V61H769L939 231V300H971V380H991V620H971V700H939V769L769 939H700V971H620V991H380V971H300V939H231L61 769V700H29V620H9V380H29V300H61V231L231 61H300V29H380Z')} fill="#191e22" fillRule="evenodd" stroke="#d7b66d" strokeWidth="3" />
      <circle cx="500" cy="500" r="424" fill="none" stroke="#ead39b" strokeWidth="5" />
      {Array.from({ length: 12 }, (_, index) => <g key={index} transform={`rotate(${15 + index * 30} 500 500)`} fill="none" stroke="#d8b875" strokeWidth="2"><path d="M500 78 466 28H534Z M500 78 478 28M500 78V20M500 78 522 28" /><path d="M461 46H451V65H464V76H477" /></g>)}
    </>;
    case 'crystal': return <>
      <path d={ringPath(`M${polygonPoints(12, 496, 15)}Z`)} fill="#ceeaf4" fillOpacity=".8" fillRule="evenodd" stroke="#f1ffff" strokeWidth="2" />
      {Array.from({ length: 12 }, (_, index) => {
        const a = polarPoint(500, 500, 496, 15 + index * 30); const b = polarPoint(500, 500, 496, 45 + index * 30); const c = polarPoint(500, 500, 416, 30 + index * 30);
        return <g key={index}><path d={`M${a.x} ${a.y}L${b.x} ${b.y}L${c.x} ${c.y}Z`} fill={index % 3 === 0 ? '#fff' : index % 3 === 1 ? '#7bbdce' : '#e0faff'} fillOpacity=".75" stroke="#f1ffff" strokeWidth="2" /><path d={`M${a.x} ${a.y}L${c.x} ${c.y}`} stroke="#548ca5" strokeWidth="1.5" opacity=".5" /></g>;
      })}
      <circle cx="500" cy="500" r="414" fill="none" stroke="#eefeff" strokeWidth="5" />
    </>;
    case 'ink': return <>
      <path d={ringPath(contourPath(479, 8, 7, 29))} fill="#f3f1e8" fillRule="evenodd" />
      <path d={contourPath(461, 8, 5, 16)} fill="none" stroke="#232d2a" strokeWidth="21" strokeDasharray="1660 20 450 16 700" strokeLinecap="butt" />
      <path d={contourPath(480, 5, 9, 80)} fill="none" stroke="#232d2a" strokeWidth="3" opacity=".58" />
      <path d={contourPath(437, 6, 6, 20)} fill="none" stroke="#232d2a" strokeWidth="6" strokeDasharray="1040 42 310 18" opacity=".78" />
      <path d={contourPath(424, 2, 11)} fill="none" stroke="#232d2a" strokeWidth="1.5" opacity=".5" />
      <g transform="rotate(-12 824 802)"><rect x="805" y="782" width="37" height="37" fill="#b93c32" /><path d="M813 790H834V811H827V795H819V805H815M832 801H826" fill="none" stroke="#f3f1e8" strokeWidth="2.5" /></g>
    </>;
    case 'nova': return <>
      <circle cx="500" cy="500" r="450" fill="none" stroke="#1d2428" strokeWidth="75" />
      <circle cx="500" cy="500" r="488" fill="none" stroke="#d7a37b" strokeWidth="3" />
      <ellipse cx="500" cy="500" rx="491" ry="440" fill="none" stroke="#bd8664" strokeWidth="2" transform="rotate(33 500 500)" />
      <ellipse cx="500" cy="500" rx="491" ry="440" fill="none" stroke="#bd8664" strokeWidth="2" transform="rotate(-33 500 500)" />
      <circle cx="500" cy="500" r="422" fill="none" stroke="#805d47" strokeWidth="5" />
      <DialTicks count={80} inner={432} outer={444} color="#d5a27b" majorEvery={10} width={1.5} />
      {[90, 180, 270].map((angle) => <g key={angle} transform={`rotate(${angle} 500 500)`} stroke="#f0c5a0" fill="none"><circle cx="500" cy="29" r="12" strokeWidth="2" /><path d="M481 29H519M500 10V48" strokeWidth="2" /><circle cx="500" cy="29" r="3" fill="#f0c5a0" /></g>)}
    </>;
    case 'ceramic': return <>
      <path d={ringPath(contourPath(480, 9, 32))} fill="#fafcf5" fillRule="evenodd" stroke="#31559b" strokeWidth="2" />
      <circle cx="500" cy="500" r="422" fill="none" stroke="#164798" strokeWidth="5" />
      <circle cx="500" cy="500" r="436" fill="none" stroke="#31559b" strokeWidth="2" />
      <circle cx="500" cy="500" r="479" fill="none" stroke="#31559b" strokeWidth="2" />
      {Array.from({ length: 32 }, (_, index) => <g key={index} transform={`rotate(${5.625 + index * 11.25} 500 500)`} fill="none" stroke="#1746a0" strokeWidth="2"><path d="M479 51Q500 18 521 51Q500 35 479 51Z M483 53Q500 32 517 53M488 58Q500 45 512 58" /><circle cx="500" cy="31" r="2" fill="#1746a0" /></g>)}
    </>;
    case 'arcade': return <>
      <path d={ringPath('M100 14H900V38H962V100H986V900H962V962H900V986H100V962H38V900H14V100H38V38H100Z')} fill="#1e2a34" fillRule="evenodd" stroke="#f4df72" strokeWidth="8" strokeLinejoin="miter" />
      <path d="M108 32H445M555 32H892V56H946V110M32 108V892H56V946H110" fill="none" stroke="#69d4c7" strokeWidth="10" />
      <path d="M110 968H890V944H944V890H968V110" fill="none" stroke="#f07169" strokeWidth="10" />
      <circle cx="500" cy="500" r="419" fill="none" stroke="#101820" strokeWidth="10" />
      {[[116, 116], [884, 116], [116, 884], [884, 884]].map(([x, y], index) => <g key={index} transform={`translate(${x} ${y})`}><path d="M-24-8H-8V-24H8V-8H24V8H8V24H-8V8H-24Z" fill={index % 2 ? '#f07169' : '#69d4c7'} /><rect x="-6" y="-6" width="12" height="12" fill="#101820" /></g>)}
      <DialTicks count={32} inner={435} outer={455} color="#f4df72" majorEvery={4} width={5} />
    </>;
    case 'sakura': return <>
      <path d={ringPath(contourPath(477, 13, 8, 0))} fill="#f8dce3" fillRule="evenodd" stroke="#aa536e" strokeWidth="2" />
      <circle cx="500" cy="500" r="421" fill="none" stroke="#78334f" strokeWidth="5" />
      {Array.from({ length: 8 }, (_, index) => <g key={index} transform={`rotate(${22.5 + index * 45} 500 500)`}><path d="M500 78 460 31Q500 9 540 31Z" fill="#f5b5c8" stroke="#9c4262" strokeWidth="2" /><path d="M500 78 472 25M500 78 486 21M500 78V19M500 78 514 21M500 78 528 25" fill="none" stroke="#b86982" strokeWidth="1.5" /><path d="M500 91Q481 81 488 65Q501 68 500 91Q517 82 511 67Q500 70 500 91Z" fill="#78334f" /></g>)}
      <circle cx="500" cy="500" r="440" fill="none" stroke="#fff2f4" strokeWidth="2" strokeDasharray="2 10" />
    </>;
    case 'ocean': return <>
      <circle cx="500" cy="500" r="451" fill="none" stroke="#174c60" strokeWidth="79" />
      <circle cx="500" cy="500" r="487" fill="none" stroke="#5ebcb5" strokeWidth="8" />
      <circle cx="500" cy="500" r="421" fill="none" stroke="#a5ddd2" strokeWidth="6" />
      <circle cx="500" cy="500" r="433" fill="none" stroke="#092b40" strokeWidth="5" />
      {Array.from({ length: 12 }, (_, index) => <g key={index} transform={`rotate(${15 + index * 30} 500 500)`}><circle cx="500" cy="45" r="12" fill="#a2d1c5" stroke="#072c3f" strokeWidth="3" /><path d="M494 39 506 51" stroke="#174c60" strokeWidth="3" /><path d="M524 53Q535 31 546 53T568 53M524 60Q535 38 546 60T568 60" fill="none" stroke="#65b8b4" strokeWidth="2" /></g>)}
    </>;
    case 'solar': return <>
      <circle cx="500" cy="500" r="449" fill="none" stroke="#f49a40" strokeWidth="68" />
      {Array.from({ length: 32 }, (_, index) => <path key={index} d={index % 2 ? 'M484 49 500 16 516 49 510 69H490Z' : 'M485 53 492 4H508L515 53 500 75Z'} fill={index % 2 ? '#d8492c' : '#f8c85c'} stroke="#8f321b" strokeWidth="1.5" transform={`rotate(${5.625 + index * 11.25} 500 500)`} />)}
      <circle cx="500" cy="500" r="425" fill="none" stroke="#a83e20" strokeWidth="6" />
      <circle cx="500" cy="500" r="435" fill="none" stroke="#ffdd81" strokeWidth="3" />
    </>;
    case 'cyber': return <>
      <path d={ringPath('M288 12H712L788 88H867L988 209V712L912 788V867L791 988H288L212 912H133L12 791V288L88 212V133L209 12Z')} fill="#122c31" fillRule="evenodd" stroke="#5adee1" strokeWidth="3" />
      <path d="M310 27H686L758 100M973 308V689L899 758M691 973H310L242 900M27 691V310L100 242" fill="none" stroke="#c6ff51" strokeWidth="8" />
      <circle cx="500" cy="500" r="421" fill="none" stroke="#5adee1" strokeWidth="5" strokeDasharray="116 14 34 14" />
      {Array.from({ length: 8 }, (_, index) => <g key={index} transform={`rotate(${22.5 + index * 45} 500 500)`} fill="none" stroke="#5adee1" strokeWidth="2"><path d="M476 38V54L492 70V81M492 30V51L510 69H527" /><rect x="472" y="29" width="8" height="8" fill="#c6ff51" stroke="none" /><rect x="524" y="65" width="8" height="8" fill="#c6ff51" stroke="none" /></g>)}
    </>;
    case 'gold': return <>
      <circle cx="500" cy="500" r="453" fill="none" stroke="#e1c68b" strokeWidth="80" />
      <circle cx="500" cy="500" r="453" fill="none" stroke="#174f40" strokeWidth="53" />
      <circle cx="500" cy="500" r="489" fill="none" stroke="#8a683d" strokeWidth="3" />
      <circle cx="500" cy="500" r="420" fill="none" stroke="#fcf0c5" strokeWidth="5" />
      <DialTicks count={120} inner={480} outer={486} color="#89673c" majorEvery={5} width={1.5} />
      {Array.from({ length: 36 }, (_, index) => <g key={index} transform={`rotate(${5 + index * 10} 500 500)`} stroke="#efdfae" strokeWidth="1.3" fill="#d3b779"><path d="M500 62Q475 61 478 39Q500 40 500 62Z M500 62Q524 59 519 37Q499 41 500 62Z" /><path d="M500 64V27M500 58 482 43M500 58 516 42" fill="none" stroke="#816738" /></g>)}
      <circle cx="500" cy="500" r="436" fill="none" stroke="#cfb67e" strokeWidth="1.5" />
    </>;
  }
}

export const WheelSkinOrnaments = React.memo(function WheelSkinOrnaments({ family, themeId }: { family: WheelSkinFamily; themeId?: string }) {
  const theme = getWheelThemeId(themeId || family);
  const uid = React.useId().replace(/:/g, '');
  return <svg className={`roulette-wheel-ornaments roulette-wheel-ornaments--${theme} pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible`} viewBox="0 0 1000 1000" aria-hidden="true" data-wheel-chrome={themeId || theme}>
    {!matteMaterial(theme) && theme !== 'cyber' ? <defs><MaterialDefs theme={theme} id={uid} /></defs> : null}
    <FamilyMotif themeId={theme} />
    <RimFinish theme={theme} id={uid} />
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

function PointerMotif({ themeId }: { themeId: WheelThemeId }) {
  // Every silhouette shares exactly one winning tip: x=90, y=190.
  switch (themeId) {
    case 'studio': return <><path d="M56 19H124V68L90 190 56 68Z" fill="#f6f6ef" stroke="#25282b" strokeWidth="4" /><path d="M75 57H105L90 190Z" fill="#e34b43" /><path d="M68 34H112" stroke="#25282b" strokeWidth="5" /></>;
    case 'prism': return <><path d="M40 45 105 12 142 73 90 190Z" fill="#62dbdc" stroke="#20333b" strokeWidth="3" /><path d="M40 45 94 83 90 190Z" fill="#f57d73" /><path d="M105 12 94 83 142 73Z" fill="#f5df71" /><path d="M94 83 142 73 90 190Z" fill="#c3f0e6" /><path d="M40 45 94 83 105 12M94 83 90 190" fill="none" stroke="#20333b" strokeWidth="2" /></>;
    case 'aurora': return <><path d="M90 190C77 146 37 102 49 57C62 11 123 15 135 51C151 101 97 137 90 190Z" fill="#144c50" stroke="#9eeeda" strokeWidth="3" /><path d="M90 190C86 132 121 106 118 67C116 44 98 40 83 45C107 75 68 106 90 190Z" fill="#77e5c5" /><path d="M66 58C56 95 83 115 83 138" fill="none" stroke="#c7ffee" strokeWidth="3" /></>;
    case 'velvet': return <><path d="M90 190 46 89Q23 59 45 42Q43 18 70 22Q90 5 110 22Q137 18 135 42Q157 59 134 89Z" fill="#efd49a" stroke="#693044" strokeWidth="3" /><path d="M90 173 61 84Q44 56 70 43Q90 26 110 43Q136 56 119 84Z" fill="#831f3d" /><path d="M72 65Q90 44 108 65L90 126Z" fill="#af3d56" /><circle cx="90" cy="58" r="5" fill="#efd49a" /></>;
    case 'mono': return <><path d="M41 18H139V77L90 190 41 77Z" fill="#f6f6ef" stroke="#151719" strokeWidth="5" /><path d="M55 68H125L90 190Z" fill="#151719" /><path d="M59 36H121M59 48H121" stroke="#151719" strokeWidth="4" /></>;
    case 'deco': return <><path d="M37 20H143V47H128V73H114V103H105L90 190 75 103H66V73H52V47H37Z" fill="#dfc181" stroke="#252324" strokeWidth="3" /><path d="M55 30H125V47H112V70H100L90 171 80 70H68V47H55Z" fill="#202629" /><path d="M90 33V133M77 35 85 80M103 35 95 80" stroke="#efd9a2" strokeWidth="3" /></>;
    case 'crystal': return <><path d="M60 17H120L144 64 90 190 36 64Z" fill="#c7eaf4" stroke="#f5ffff" strokeWidth="3" /><path d="M60 17 76 64 36 64Z" fill="#f5ffff" /><path d="M120 17 104 64 144 64Z" fill="#90c5dc" /><path d="M60 17H120L104 64H76Z" fill="#e9fcff" /><path d="M76 64 90 190 36 64Z" fill="#77b8ce" /><path d="M104 64 90 190 144 64Z" fill="#e2fbfc" /><path d="M76 64H104L90 190Z" fill="#addcea" /><path d="M36 64H144M76 64 90 190 104 64" fill="none" stroke="#f5ffff" strokeWidth="2" /></>;
    case 'ink': return <><path d="M60 16 126 21 119 75 109 82 101 142 90 190 83 159 68 91 57 78Z" fill="#272e2a" /><path d="M68 19 126 24 120 70 61 65Z" fill="#ba4034" /><path d="M75 31H108V57H99V38H85V51H80M104 44H99" fill="none" stroke="#f1f0e5" strokeWidth="3" /><path d="M96 86 92 167M76 95 87 146" stroke="#f1f0e5" strokeWidth="2" opacity=".7" /></>;
    case 'nova': return <><path d="M90 190 67 97V23H113V97Z" fill="#d7a680" stroke="#20272d" strokeWidth="4" /><circle cx="90" cy="52" r="30" fill="#20272d" stroke="#d7a680" strokeWidth="3" /><circle cx="90" cy="52" r="15" fill="none" stroke="#d7a680" strokeWidth="2" /><path d="M90 17V37M90 67V87M55 52H75M105 52H125M90 96V166" stroke="#efd0b3" strokeWidth="3" /></>;
    case 'ceramic': return <><path d="M90 190 47 83Q26 51 51 30Q64 8 90 20Q116 8 129 30Q154 51 133 83Z" fill="#fbfcf4" stroke="#1746a0" strokeWidth="3" /><path d="M61 64Q90 19 119 64Q90 45 61 64ZM65 80Q90 48 115 80M71 96Q90 68 109 96" fill="none" stroke="#1746a0" strokeWidth="4" /><path d="M77 120H103L90 190Z" fill="#1746a0" /></>;
    case 'arcade': return <><path d="M42 18H138V66H126V102H114V138H102V172H96V184L90 190 84 184V172H78V138H66V102H54V66H42Z" fill="#f4df72" stroke="#16232c" strokeWidth="5" strokeLinejoin="miter" /><path d="M57 34H123V60H111V90H99V145H81V90H69V60H57Z" fill="#ef7166" /><path d="M70 35H110V53H70Z" fill="#64d0bd" /></>;
    case 'sakura': return <><path d="M90 190 31 62Q43 16 90 14Q137 16 149 62Z" fill="#f4b9cb" stroke="#813850" strokeWidth="3" /><path d="M90 172 46 50M90 172 65 27M90 172V19M90 172 115 27M90 172 134 50" fill="none" stroke="#a85875" strokeWidth="2" /><path d="M90 190 74 141Q89 120 106 141Z" fill="#813850" /><path d="M48 59Q90 30 132 59" fill="none" stroke="#fff1f5" strokeWidth="5" /></>;
    case 'ocean': return <><path d="M65 15H115L138 61 90 190 42 61Z" fill="#174a60" stroke="#b3e2d5" strokeWidth="3" /><circle cx="90" cy="57" r="24" fill="#77bfb6" stroke="#082e43" strokeWidth="4" /><path d="M71 56Q80 44 90 56T109 56M73 66Q82 54 91 66T108 66" fill="none" stroke="#164d60" strokeWidth="3" /><path d="M73 103H107L90 190Z" fill="#9de1d1" /></>;
    case 'solar': return <><path d="M90 190 48 103 21 77 46 70 32 34 66 39 90 8 110 39 148 30 135 66 158 80 130 103Z" fill="#f7ca62" stroke="#92351d" strokeWidth="3" /><path d="M90 190 63 96 46 68 76 74 90 39 106 74 134 68 117 96Z" fill="#e35b2d" /><path d="M90 176 78 93 90 68 103 93Z" fill="#ffdf8b" /></>;
    case 'cyber': return <><path d="M52 13H116L141 38V74L112 111 90 190 67 111 39 74V37Z" fill="#12343b" stroke="#56dee0" strokeWidth="3" /><path d="M61 27H109L125 43V60H107L90 161 73 60H54V43Z" fill="#c6ff51" /><path d="M73 39H108V48H89V73M54 83 73 103M126 83 107 103" fill="none" stroke="#12343b" strokeWidth="5" /><path d="M69 116 90 190 112 116" fill="none" stroke="#c6ff51" strokeWidth="3" /></>;
    case 'gold': return <><path d="M90 190 57 107Q23 76 43 39Q63 2 101 15Q143 23 142 64Q141 89 119 107Z" fill="#e6ce98" stroke="#725634" strokeWidth="3" /><circle cx="90" cy="61" r="34" fill="#175743" stroke="#f8e7b4" strokeWidth="2" /><path d="M69 82Q49 57 72 34M111 82Q131 57 108 34" fill="none" stroke="#d7c18b" strokeWidth="3" /><path d="M66 69Q53 64 58 54Q71 55 66 69M64 51Q56 40 65 36Q76 42 64 51M114 69Q127 64 122 54Q109 55 114 69M116 51Q124 40 115 36Q104 42 116 51" fill="#e6ce98" /><path d="M79 120H101L90 190Z" fill="#175743" /><path d="M81 47H99V77H81Z" fill="none" stroke="#e6ce98" strokeWidth="3" /></>;
  }
}

function PointerFinish({ theme }: { theme: WheelThemeId }) {
  // Inset tooling never extends past the shared winning tip at (90, 190).
  const line = { fill: 'none', strokeWidth: 1.25, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (theme) {
    case 'studio': return <g {...line}><path d="M60 64V24H120M77 61 89 163" stroke="#fff" /><path d="M116 30V61M68 44H112" stroke="#8e9698" /><path d="M84 29H96" stroke="#e34b43" /></g>;
    case 'prism': return <g {...line} stroke="#fff" strokeOpacity=".8"><path d="M47 46 101 20 132 69 99 77ZM46 51 85 158M99 86 93 159" /><path d="M102 30 97 62" /></g>;
    case 'aurora': return <g {...line} stroke="#d5fff1"><path d="M60 51C74 25 117 28 126 54M124 60C138 96 102 120 96 148" /><path d="M87 52C99 78 80 102 87 125" opacity=".55" /></g>;
    case 'velvet': return <g {...line} stroke="#f7e1ac"><path d="M53 76Q38 57 57 45Q52 27 73 32Q90 18 107 32Q127 27 123 45Q143 57 127 76" /><path d="M67 91 90 151 113 91" strokeDasharray="1 4" /><path d="M74 57Q90 40 106 57" opacity=".6" /></g>;
    case 'mono': return <path d="M48 24H132V61M63 58H117" fill="none" stroke="#151719" strokeWidth="1" />;
    case 'deco': return <g {...line} stroke="#fff0c2"><path d="M42 25H138M42 29H49V50H62V75H73V98M131 30V50H118V75H107V98" /><path d="M84 106 90 151 96 106" /></g>;
    case 'crystal': return <g {...line}><path d="M65 23H115L133 60H109L90 170 71 60H47Z" stroke="#fff" /><path d="M82 69H98L90 149Z" fill="#fff" fillOpacity=".32" stroke="none" /><path d="M107 24 99 57M52 68 82 143" stroke="#548ca5" strokeOpacity=".45" /></g>;
    case 'ink': return <path d="M65 25 68 58M114 31 111 61M72 85 78 106M99 95 96 119" fill="none" stroke="#f3f1e8" strokeWidth=".8" strokeDasharray="6 3 2 4" opacity=".6" />;
    case 'nova': return <g {...line} stroke="#ffe1bd"><path d="M71 88V97L86 158M109 88V97L96 141" /><circle cx="90" cy="52" r="24" strokeDasharray="1 5" /><path d="M82 48H98M90 44V60" stroke="#6cd8d9" /></g>;
    case 'ceramic': return <g {...line}><path d="M52 77Q32 52 58 33Q70 18 87 25M95 26Q116 16 126 39" stroke="#fff" strokeWidth="3" /><path d="M56 84Q65 103 72 117M124 84Q115 103 108 117M81 119H99" stroke="#1746a0" strokeOpacity=".5" /></g>;
    case 'arcade': return <g fill="none" strokeWidth="2"><path d="M48 24H131M48 28V60H60V96H72V131" stroke="#fff7c1" /><path d="M130 69H121V104H109V136H98V165" stroke="#943e38" /></g>;
    case 'sakura': return <g {...line} stroke="#fff3f7"><path d="M40 60Q51 24 87 22M96 22Q128 26 140 60M53 71Q90 51 127 71" /><path d="M65 77 84 137M98 127 118 74" opacity=".6" /></g>;
    case 'ocean': return <g {...line}><path d="M69 21H111L131 61 102 136M48 61 79 145" stroke="#d9fff2" /><circle cx="90" cy="57" r="19" stroke="#e9fff4" strokeDasharray="20 6" /><path d="M81 111 90 163 99 111" stroke="#174c60" /></g>;
    case 'solar': return <g {...line} stroke="#fff0b8"><path d="M40 42 69 46 90 17 108 46 138 39M31 77 51 79 63 96M139 77 128 82 119 97M87 95 90 146" /></g>;
    case 'cyber': return <g {...line} stroke="#dcfff4"><path d="M56 19H113L134 41V68M46 42V70L65 95M117 86 104 105" /><path d="M64 33H72M116 47V54M84 111 90 146" stroke="#ef91c7" strokeWidth="2" /></g>;
    case 'gold': return <g {...line} stroke="#fff0c6"><path d="M48 40Q64 10 98 21Q132 28 135 57M48 78Q50 94 64 103L78 130M130 88 112 108 102 135" /><circle cx="90" cy="61" r="29" strokeWidth=".7" strokeDasharray="1 4" /><path d="M85 52V72M95 52V72" /></g>;
  }
}

export const WheelPointer = React.memo(function WheelPointer({ themeId = 'studio' }: { themeId?: string }) {
  const theme = getWheelThemeId(themeId);
  return <div className={`roulette-wheel-pointer roulette-wheel-pointer--${theme} pointer-events-none absolute left-[43%] top-[-1%] z-50 h-[16%] w-[14%]`} style={{ transformOrigin: '50% 24%', transform: 'rotate(var(--roulette-pointer-deflect, 0deg))' }} aria-hidden="true" data-pointer-theme={themeId}>
    <svg className="block h-full w-full overflow-visible" viewBox="0 0 180 200"><PointerMotif themeId={theme} /><PointerFinish theme={theme} /></svg>
  </div>;
});
