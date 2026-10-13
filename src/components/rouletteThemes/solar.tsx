import type { RouletteThemeArtwork } from './types';
import { point, ring } from './geometry';
import './solar.css';

const vermilion = '#e8402a';
const orange = '#ff872b';
const citron = '#e9ef59';
const white = '#fffefb';
const ink = '#802b26';

function coordinates(radius: number, angle: number) {
  const p = point(radius, angle);
  return `${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
}

function enamelWedge(start: number, end: number) {
  return `M${coordinates(442, start)}A442 442 0 0 1 ${coordinates(442, end)}L${coordinates(430, end)}A430 430 0 0 0 ${coordinates(430, start)}Z`;
}

const solar = {
  id: 'solar',
  designNotes: 'Kinetic corona: twenty swept vermilion and tangerine enamel blades with citron facets, separated by daylight and anchored to a white ceramic race. A compact solar rotor carries one long white-hot winning tip. Matching directional rays unify panel, hub and picker; no flames, metallic gold, filters or added motion.',
  palette: [vermilion, white, orange, citron, '#ffb6a2', '#f45b38'],
  tokens: {
    '--roulette-backdrop': '#fffefb',
    '--roulette-panel': white,
    '--roulette-panel-strong': '#ffe9df',
    '--roulette-line': '#f3a28e',
    '--roulette-text': '#612821',
    '--roulette-muted': '#86524a',
    '--roulette-accent': vermilion,
    '--roulette-accent-2': '#c24421',
    '--roulette-result': '#bd3423',
    '--roulette-shadow': 'rgba(128,43,38,.18)',
    '--roulette-rim-outer': vermilion,
    '--roulette-rim-inner': white,
    '--roulette-rim-line': vermilion,
    '--roulette-hub': white,
    '--roulette-hub-line': vermilion,
    '--roulette-hub-text': '#802b26',
    '--roulette-hub-muted': '#86524a',
    '--roulette-label-light': white,
    '--roulette-label-dark': '#58241f',
    '--roulette-pointer': vermilion,
    '--roulette-pointer-core': citron,
    '--roulette-segment-line': white,
    '--roulette-segment-gloss': 'rgba(255,254,251,.12)',
    '--roulette-tick': vermilion,
    '--roulette-track': white,
  },
  rim: (idPrefix: string) => {
    const apertureId = `${idPrefix}-solar-aperture`;
    return <>
      <defs>
        <clipPath id={apertureId}>
          <path d={ring(495, 414)} fillRule="evenodd" clipRule="evenodd" />
        </clipPath>
      </defs>
      {/* The annular clip contains every painted edge, including antialiasing. */}
      <g clipPath={`url(#${apertureId})`} stroke="none">
        <path d={ring(451, 414)} fill={vermilion} fillRule="evenodd" />
        <path d={ring(446, 418)} fill={white} fillRule="evenodd" />
        {Array.from({ length: 20 }, (_, index) => {
          const a = index * 18;
          const tip = index % 2 === 0 ? 494 : 483;
          return <g key={index}>
            <path
              d={`M${coordinates(442, a - 6)}L${coordinates(tip, a + 1)}L${coordinates(tip - 7, a + 5)}L${coordinates(453, a + 10)}L${coordinates(442, a + 7)}Z`}
              fill={index % 2 === 0 ? vermilion : orange}
            />
            <path
              d={`M${coordinates(450, a - 3)}L${coordinates(tip - 4, a + 1.6)}L${coordinates(tip - 9, a + 3.8)}L${coordinates(458, a + 5.7)}Z`}
              fill={index % 4 === 0 ? citron : index % 2 === 0 ? orange : '#ffc681'}
            />
            <path d={enamelWedge(a - 5, a + 9)} fill={index % 2 === 0 ? vermilion : orange} />
            <path d={enamelWedge(a - 5, a - 2)} fill={index % 4 === 0 ? citron : '#ffb6a2'} />
          </g>;
        })}
        <path d={ring(427, 424)} fill={orange} fillRule="evenodd" />
        <path d={ring(419, 414)} fill={vermilion} fillRule="evenodd" />
      </g>
    </>;
  },
  pointer: (idPrefix: string) => {
    const enamelId = `${idPrefix}-solar-pointer-enamel`;
    return <g stroke="none">
      <defs>
        <linearGradient id={enamelId} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#ff9f36" />
          <stop offset=".5" stopColor={orange} />
          <stop offset="1" stopColor={vermilion} />
        </linearGradient>
      </defs>
      <path d="M90 190 65 112 39 103 46 82 23 70 42 53 31 30 59 34 65 10 85 26 104 10 113 35 141 29 134 54 157 69 135 84 141 105 115 111Z" fill={ink} />
      <path d="M90 182 71 107 46 99 53 80 31 69 49 55 40 37 64 41 69 20 85 34 101 19 108 42 133 36 127 57 148 69 128 82 134 99 109 106Z" fill={`url(#${enamelId})`} />
      <path d="M90 190 72 107 90 117 108 107Z" fill={vermilion} />
      <path d="M90 176 80 109H100Z" fill={white} />
      <circle cx="90" cy="68" r="34" fill={white} />
      <circle cx="90" cy="68" r="27" fill={vermilion} />
      <path d="M72 72A20 20 0 0 1 98 49L89 66 106 62A20 20 0 0 1 81 87L89 70Z" fill={citron} />
      <circle cx="90" cy="68" r="7" fill={white} />
      <path d="M54 48 65 49M117 93 122 86" fill="none" stroke={white} strokeWidth="4" strokeLinecap="round" />
    </g>;
  },
  panel: <g stroke="none">
    <path d="M24 30 13 8 31 22 34 5 42 27 61 13 53 35 82 31 62 45 91 53 61 59 79 78 52 68 58 92 40 76 29 96 27 72Z" fill={vermilion} />
    <path d="M42 27 61 13 53 35 43 40ZM62 45 91 53 61 59 49 53ZM52 68 58 92 40 76 40 64Z" fill={orange} />
    <path d="M51 19 47 34 42 34ZM73 51 59 55 57 49ZM50 78 41 69 44 65Z" fill={citron} />
    <path d="M18 27A27 27 0 0 1 18 81L18 70A16 16 0 0 0 18 38Z" fill={white} />
    <path d="M18 39A15 15 0 0 1 18 69L18 58A4 4 0 0 0 18 50Z" fill={orange} />
  </g>,
  hub: <g stroke="none">
    {Array.from({ length: 8 }, (_, index) => <path key={index} d="M20 13 24 2 30 5 28 15Z" transform={`rotate(${index * 45} 24 24)`} fill={index % 2 ? orange : vermilion} />)}
    <circle cx="24" cy="24" r="14" fill={vermilion} />
    <circle cx="24" cy="24" r="10" fill={citron} />
    <path d="M24 14A10 10 0 0 1 34 24H24Z" fill={white} />
    <circle cx="24" cy="24" r="4" fill={vermilion} />
  </g>,
  swatch: <g stroke="none">
    {Array.from({ length: 12 }, (_, index) => <path key={index} d="M27 12 32 1 37 4 36 14Z" transform={`rotate(${index * 30} 32 32)`} fill={index % 2 ? orange : vermilion} />)}
    <circle cx="32" cy="32" r="23" fill={vermilion} />
    <circle cx="32" cy="32" r="20" fill={white} />
    <path d="M32 32V14A18 18 0 0 1 47.588 41Z" fill={orange} />
    <path d="M32 32 47.588 41A18 18 0 0 1 16.412 41Z" fill={citron} />
    <path d="M32 32 16.412 41A18 18 0 0 1 32 14Z" fill={vermilion} />
    <circle cx="32" cy="32" r="7" fill={white} />
    <circle cx="32" cy="32" r="3" fill={vermilion} />
  </g>,
} satisfies RouletteThemeArtwork;

export default solar;
