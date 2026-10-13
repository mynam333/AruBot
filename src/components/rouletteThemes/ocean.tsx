import type { RouletteThemeArtwork } from './types';
import { point, ring } from './geometry';

const navy = '#102d36';
const teal = '#18545c';
const seaGlass = '#8dd8c6';
const pearl = '#eaf4e9';
const brass = '#c7ad73';
const bronze = '#786344';

const ocean = {
  id: 'ocean',
  designNotes: 'A pressure-rated submersible porthole: satin brass rope edging, twelve slotted fasteners, a deep teal enamel channel with engraved wave crests, and a pearl inner gasket. The pointer is a tapered depth-gauge instrument with one winning tip. Matching miniature pressure gauges and wave seals keep panel, hub and picker coherent. A hard annular clip preserves the 414-unit aperture and 496-unit outside limit. Static artwork needs no animation or legacy central branches.',
  palette: ['#12343e', '#57b5a9', '#e5f1e6', '#246977', '#c7ad73', '#a2cfc5'],
  tokens: {
    '--roulette-backdrop': '#102d36',
    '--roulette-panel': '#173e46',
    '--roulette-panel-strong': '#102d36',
    '--roulette-line': '#8aa89c',
    '--roulette-text': pearl,
    '--roulette-muted': '#aecbc3',
    '--roulette-accent': seaGlass,
    '--roulette-accent-2': brass,
    '--roulette-result': '#d2f4df',
    '--roulette-shadow': 'rgba(6,31,35,.34)',
    '--roulette-rim-outer': '#c7ad73',
    '--roulette-rim-inner': teal,
    '--roulette-rim-line': pearl,
    '--roulette-hub': 'linear-gradient(145deg, #28616a, #102d36 75%)',
    '--roulette-hub-line': brass,
    '--roulette-hub-text': pearl,
    '--roulette-hub-muted': '#aecbc3',
    '--roulette-label-light': '#f1fff5',
    '--roulette-label-dark': '#102d36',
    '--roulette-pointer': brass,
    '--roulette-pointer-core': seaGlass,
    '--roulette-segment-line': '#86ada5',
    '--roulette-segment-gloss': 'rgba(234,244,233,.10)',
    '--roulette-tick': pearl,
    '--roulette-track': '#173e46',
  },
  rim: (idPrefix: string) => {
    const metal = `${idPrefix}-ocean-brass`;
    const enamel = `${idPrefix}-ocean-enamel`;
    const clear = `${idPrefix}-ocean-aperture`;
    return <>
      <defs>
        <linearGradient id={metal} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#f1e4b8" />
          <stop offset=".25" stopColor="#c7ad73" />
          <stop offset=".51" stopColor="#8e7952" />
          <stop offset=".73" stopColor="#e2d2a3" />
          <stop offset="1" stopColor="#ac9361" />
        </linearGradient>
        <linearGradient id={enamel} x1="0" y1="0" x2=".7" y2="1">
          <stop stopColor="#296d71" />
          <stop offset=".4" stopColor="#16434c" />
          <stop offset="1" stopColor="#102d36" />
        </linearGradient>
        <clipPath id={clear}>
          <path d={ring(496, 414)} fillRule="evenodd" clipRule="evenodd" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clear})`} strokeLinecap="round" strokeLinejoin="round">
        <path d={ring(491, 414)} fill={navy} fillRule="evenodd" />
        {/* Four flush clamp saddles interrupt the round pressure-vessel silhouette. */}
        {[0, 90, 180, 270].map(angle => <g key={angle} transform={`rotate(${angle} 500 500)`}>
          <path d="M466 26L474 9Q500 2 526 9L534 26V55H466Z" fill={bronze} />
          <path d="M471 25L478 12Q500 7 522 12L529 25V49H471Z" fill={`url(#${metal})`} />
          <path d="M481 15H519" fill="none" stroke={pearl} strokeWidth="2" />
        </g>)}
        <path d={ring(487, 416)} fill={`url(#${metal})`} fillRule="evenodd" />
        <circle cx="500" cy="500" r="486" fill="none" stroke={pearl} strokeWidth="2" />
        <path d={ring(480, 471)} fill={bronze} fillRule="evenodd" />
        {Array.from({ length: 72 }, (_, index) => <path
          key={index}
          d="M492 21Q500 22 506 31"
          transform={`rotate(${index * 5} 500 500)`}
          fill="none" stroke="#ddc995" strokeWidth="4" />)}
        <circle cx="500" cy="500" r="470" fill="none" stroke="#f1e4b8" strokeWidth="2" />
        <path d={ring(467, 431)} fill={`url(#${enamel})`} fillRule="evenodd" />
        <circle cx="500" cy="500" r="465" fill="none" stroke="#081f2a" strokeWidth="3" />
        <circle cx="500" cy="500" r="433" fill="none" stroke="#73aba0" strokeWidth="2" />
        {Array.from({ length: 12 }, (_, index) => <g key={index} transform={`rotate(${15 + index * 30} 500 500)`}>
          <path d="M465 57Q476 62 488 54C500 43 509 43 520 50C507 47 503 52 505 57C510 66 524 64 535 57" fill="none" stroke="#79b2a5" strokeWidth="3" />
          <path d="M468 64Q482 68 495 61M514 68Q526 69 534 65" fill="none" stroke="#467f7c" strokeWidth="2" />
        </g>)}
        {Array.from({ length: 12 }, (_, index) => {
          const p = point(450, index * 30);
          return <g key={index} transform={`translate(${p.x} ${p.y}) rotate(${index * 30 + 45})`}>
            <circle r="12" fill="#09272f" />
            <circle r="9.5" fill={`url(#${metal})`} stroke={bronze} strokeWidth="1.5" />
            <path d="M-6-4A7 7 0 0 1 6-4" fill="none" stroke="#f6ebca" strokeWidth="1.5" />
            <path d="M-5 1H5" fill="none" stroke={bronze} strokeWidth="3" />
            <path d="M-5-1H5" fill="none" stroke={navy} strokeWidth="2" />
          </g>;
        })}
        <path d={ring(429, 414)} fill={pearl} fillRule="evenodd" />
        <path d={ring(429, 426)} fill="#aabca9" fillRule="evenodd" />
        <path d={ring(419, 414)} fill={navy} fillRule="evenodd" />
        <circle cx="500" cy="500" r="420.5" fill="none" stroke={seaGlass} strokeWidth="1.5" />
        {Array.from({ length: 48 }, (_, index) => <path key={index}
          d={index % 4 === 0 ? 'M500 73V79' : 'M500 74V77'}
          transform={`rotate(${index * 7.5} 500 500)`}
          fill="none" stroke="#546e65" strokeWidth={index % 4 === 0 ? 2 : 1.3} />)}
      </g>
    </>;
  },
  pointer: (idPrefix: string) => {
    const metal = `${idPrefix}-ocean-needle-metal`;
    const glass = `${idPrefix}-ocean-needle-glass`;
    return <>
      <defs>
        <linearGradient id={metal} x1="0" y1="0" x2="1" y2=".5">
          <stop stopColor="#f2e7be" />
          <stop offset=".45" stopColor="#d5c18f" />
          <stop offset="1" stopColor="#8f774f" />
        </linearGradient>
        <linearGradient id={glass} x1="0" y1="0" x2=".4" y2="1">
          <stop stopColor="#9de1cc" />
          <stop offset="1" stopColor="#347e7b" />
        </linearGradient>
      </defs>
      <path d="M90 190L61 117C45 98 38 78 40 57C42 29 61 10 90 10S138 29 140 57C142 78 135 98 119 117Z" fill={navy} />
      <path d="M90 190L66 113C51 95 44 77 46 58C48 33 65 16 90 16S132 33 134 58C136 77 129 95 114 113Z" fill={`url(#${metal})`} />
      <path d="M58 53C63 29 82 24 105 28" fill="none" stroke={pearl} strokeWidth="3" strokeLinecap="round" />
      <circle cx="90" cy="65" r="31" fill={navy} stroke={bronze} strokeWidth="3" />
      <circle cx="90" cy="65" r="24" fill={`url(#${glass})`} />
      <path d="M72 60A19 19 0 0 1 108 60M76 51L79 55M90 46V51M104 51L101 55" fill="none" stroke={navy} strokeWidth="2.5" />
      <path d="M90 65L101 56M69 74Q79 67 90 74T111 74" fill="none" stroke={navy} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="90" cy="65" r="3.5" fill={pearl} />
      <path d="M74 107Q90 112 106 107L90 168Z" fill={teal} />
      <path d="M79 113L90 153V115Z" fill={seaGlass} />
      <path d="M78 99Q90 103 102 99" fill="none" stroke={bronze} strokeWidth="2" />
    </>;
  },
  panel: <g strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 15H29L40 27V73L29 85H11Z" fill={navy} stroke={brass} strokeWidth="2" />
    <path d="M18 20V33M18 67V80" fill="none" stroke={seaGlass} strokeWidth="3" />
    <circle cx="34" cy="50" r="25" fill={brass} stroke={bronze} strokeWidth="2" />
    <circle cx="34" cy="50" r="20" fill={teal} stroke={pearl} strokeWidth="1.5" />
    <path d="M20 47A14 14 0 0 1 48 47M34 35V39M24 39L27 42M44 39L41 42M34 49L42 43" fill="none" stroke={pearl} strokeWidth="2.5" />
    <path d="M19 55Q26 50 34 55T49 55M22 61Q28 57 34 61T46 61" fill="none" stroke={seaGlass} strokeWidth="2" />
    <path d="M64 38H79M63 50H88M64 62H79" fill="none" stroke={brass} strokeWidth="2" />
    <circle cx="34" cy="49" r="2.5" fill={brass} stroke="none" />
  </g>,
  hub: <g strokeLinecap="round" strokeLinejoin="round">
    <circle cx="24" cy="24" r="21" fill={navy} stroke={brass} strokeWidth="2.5" />
    <circle cx="24" cy="24" r="16" fill={teal} stroke={seaGlass} strokeWidth="1" />
    <path d="M13 22A11 11 0 0 1 35 22M24 13V16M16 16L18 19M32 16L30 19M24 24L31 18" fill="none" stroke={pearl} strokeWidth="2" />
    <path d="M11 29Q17 25 24 29T37 29M15 34Q19 31 24 34T33 34" fill="none" stroke={seaGlass} strokeWidth="2" />
    <circle cx="24" cy="24" r="2.5" fill={brass} stroke="none" />
  </g>,
  swatch: <g stroke="none">
    <circle cx="32" cy="32" r="31" fill={navy} />
    <circle cx="32" cy="32" r="29" fill={brass} />
    <circle cx="32" cy="32" r="26.5" fill={teal} />
    <circle cx="32" cy="32" r="22.5" fill={pearl} />
    <path d="M32 32V11A21 21 0 0 1 50.187 21.5Z" fill="#57b5a9" />
    <path d="M32 32L50.187 21.5A21 21 0 0 1 50.187 42.5Z" fill={navy} />
    <path d="M32 32L50.187 42.5A21 21 0 0 1 32 53Z" fill="#a2cfc5" />
    <path d="M32 32V53A21 21 0 0 1 13.813 42.5Z" fill={brass} />
    <path d="M32 32L13.813 42.5A21 21 0 0 1 13.813 21.5Z" fill="#246977" />
    {[0, 60, 120, 180, 240, 300].map(angle => <g key={angle} transform={`rotate(${angle} 32 32)`}>
      <circle cx="32" cy="7.5" r="1.8" fill={brass} />
      <path d="M31 7.5H33" stroke={navy} strokeWidth=".8" />
    </g>)}
    <circle cx="32" cy="32" r="7.5" fill={navy} stroke={brass} strokeWidth="1.5" />
    <path d="M27 32Q29.5 29 32 32T37 32M28 35Q30 33 32 35T36 35" fill="none" stroke={seaGlass} strokeWidth="1.3" />
    <path d="M28 3H36L32 14Z" fill={brass} stroke={navy} strokeWidth="1" />
  </g>,
} satisfies RouletteThemeArtwork;

export default ocean;
