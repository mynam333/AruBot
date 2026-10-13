import type { RouletteThemeArtwork } from './types';
import { aperture, point, ring, scallop } from './geometry';
import './aurora.css';

const silhouette = scallop(478, 15, 3, 25);
const opening = aperture(silhouette, 414);

// Tapered, undulating cloth edges stay annular; the aperture clips every layer.
function silkEdge(start: number, sweep: number, offset: number) {
  return Array.from({ length: 85 }, (_, index) => {
    const t = index / 84;
    const radius = 456 + 18 * Math.sin(t * Math.PI * 2 - .9)
      + offset * Math.sin(Math.PI * t);
    const p = point(radius, start + sweep * t);
    return `${index ? 'L' : 'M'}${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
  }).join(' ');
}

function silkBand(start: number, sweep: number) {
  const top = silkEdge(start, sweep, 19);
  const bottom = silkEdge(start, sweep, -19).slice(1).split('L').reverse();
  return `${top}L${bottom.join('L')}Z`;
}

const ribbons = [-46, 74, 194].map((start, index) => ({
  index,
  body: silkBand(start, 172),
  edge: silkEdge(start, 172, 19),
  hem: silkEdge(start, 172, -19),
  folds: [-13, -8, -3, 2, 7, 12].map(offset => silkEdge(start, 172, offset)),
}));

const aurora = {
  id: 'aurora',
  designNotes: 'Northern-light silk: three broad overlapping mint, emerald and iris ribbons with tapered hems, directional satin folds and a softly lobed outline. A twisted silk pointer converges on one exact winning tip; the same folded ribbon is legible in panel, hub and picker artwork. All rim paint is clipped outside radius 414.',
  palette: ['#073e32', '#81efc4', '#237c63', '#bcb0ed', '#d9ffec', '#392e5b'],
  tokens: {
    '--roulette-panel': '#103c34',
    '--roulette-panel-strong': '#082f28',
    '--roulette-text': '#effff7',
    '--roulette-muted': '#b1dccd',
    '--roulette-result': '#e2fff1',
    '--roulette-accent': '#88edc5',
    '--roulette-accent-2': '#c0b2ef',
    '--roulette-line': '#69b49b',
    '--roulette-track': '#194c40',
    '--roulette-hub': 'linear-gradient(145deg, #22604d, #092f29 64%, #352d4d)',
    '--roulette-hub-line': '#a4e5ca',
    '--roulette-hub-text': '#effff7',
    '--roulette-hub-muted': '#b1dccd',
    '--roulette-panel-finish': 'linear-gradient(120deg, #9bf2cf18, transparent 30% 68%, #bdb0ec1c)',
  },
  rim: (idPrefix: string) => <>
    <defs>
      <clipPath id={`${idPrefix}-aurora-aperture`}>
        <path d={opening} clipRule="evenodd" />
      </clipPath>
      <linearGradient id={`${idPrefix}-aurora-ground`} x1="130" y1="80" x2="790" y2="950" gradientUnits="userSpaceOnUse">
        <stop stopColor="#285f51" />
        <stop offset=".3" stopColor="#092c26" />
        <stop offset=".65" stopColor="#183e37" />
        <stop offset="1" stopColor="#44345f" />
      </linearGradient>
      <linearGradient id={`${idPrefix}-aurora-mint`} x1="140" y1="40" x2="820" y2="930" gradientUnits="userSpaceOnUse">
        <stop stopColor="#174e41" />
        <stop offset=".2" stopColor="#69d9ae" />
        <stop offset=".38" stopColor="#d7ffeb" />
        <stop offset=".48" stopColor="#80e7bc" />
        <stop offset=".64" stopColor="#277761" />
        <stop offset=".8" stopColor="#a6f6d6" />
        <stop offset="1" stopColor="#30674f" />
      </linearGradient>
      <linearGradient id={`${idPrefix}-aurora-iris`} x1="760" y1="50" x2="270" y2="930" gradientUnits="userSpaceOnUse">
        <stop stopColor="#574472" />
        <stop offset=".22" stopColor="#c5b8f2" />
        <stop offset=".4" stopColor="#eee5ff" />
        <stop offset=".52" stopColor="#8c81b9" />
        <stop offset=".73" stopColor="#448c79" />
        <stop offset="1" stopColor="#b8f2d9" />
      </linearGradient>
      <linearGradient id={`${idPrefix}-aurora-selvedge`} x1="140" y1="100" x2="900" y2="820" gradientUnits="userSpaceOnUse">
        <stop stopColor="#e2fff0" />
        <stop offset=".36" stopColor="#84dcb7" />
        <stop offset=".61" stopColor="#c9b7ef" />
        <stop offset="1" stopColor="#67c5a5" />
      </linearGradient>
    </defs>
    <g clipPath={`url(#${idPrefix}-aurora-aperture)`}>
      <path d={opening} fill={`url(#${idPrefix}-aurora-ground)`} fillRule="evenodd" />
      <path d={silhouette} fill="none" stroke="#082c25" strokeWidth="8" />
      <path d={silhouette} fill="none" stroke={`url(#${idPrefix}-aurora-selvedge)`} strokeWidth="3" />
      {ribbons.map(ribbon => <g key={ribbon.index}>
        <path d={ribbon.body} fill="#031f1a" stroke="#031f1a" strokeWidth="8" strokeLinejoin="round" />
        <path d={ribbon.body} fill={`url(#${idPrefix}-aurora-${ribbon.index === 1 ? 'iris' : 'mint'})`} />
        <path d={ribbon.hem} fill="none" stroke="#144c40" strokeWidth="4" strokeLinecap="round" />
        {ribbon.folds.map((d, index) => <path key={index} d={d} fill="none"
          stroke={index % 2 ? '#effff6' : '#123e35'} strokeOpacity={index % 2 ? '.25' : '.19'}
          strokeWidth={index === 3 ? '2.5' : '1.5'} strokeLinecap="round" />)}
        <path d={ribbon.edge} fill="none" stroke={ribbon.index === 1 ? '#f0e8ff' : '#d7ffea'} strokeWidth="3" strokeLinecap="round" />
      </g>)}
      <path d={ring(427, 414)} fill="#0b342b" fillRule="evenodd" />
      <circle cx="500" cy="500" r="425" fill="none" stroke="#36856c" strokeWidth="3" />
      <circle cx="500" cy="500" r="417" fill="none" stroke={`url(#${idPrefix}-aurora-selvedge)`} strokeWidth="6" />
      <path d={silkEdge(203, 77, -25)} fill="none" stroke="#d6ffe9" strokeWidth="2" opacity=".7" />
    </g>
  </>,
  pointer: (idPrefix: string) => <>
    <defs>
      <linearGradient id={`${idPrefix}-aurora-pointer`} x1="51" y1="25" x2="120" y2="174" gradientUnits="userSpaceOnUse">
        <stop stopColor="#dcffef" />
        <stop offset=".25" stopColor="#79e1b5" />
        <stop offset=".52" stopColor="#20785c" />
        <stop offset=".72" stopColor="#a4f1cf" />
        <stop offset="1" stopColor="#d9ffec" />
      </linearGradient>
      <linearGradient id={`${idPrefix}-aurora-pointer-fold`} x1="133" y1="27" x2="68" y2="149" gradientUnits="userSpaceOnUse">
        <stop stopColor="#e1d3ff" />
        <stop offset=".42" stopColor="#a093cf" />
        <stop offset=".72" stopColor="#443959" />
        <stop offset="1" stopColor="#1c604c" />
      </linearGradient>
    </defs>
    <path d="M90 190C77 150 37 115 35 76C32 42 57 19 92 18C128 16 147 45 143 72C138 115 104 139 90 190Z" fill="#d7ffeb" />
    <path d="M90 183C73 141 42 112 40 77C37 47 59 24 92 23C123 21 141 47 138 72C133 112 102 141 90 183Z" fill="#113f33" />
    <path d="M90 190C79 146 48 117 45 79C42 47 67 25 95 27C76 42 69 63 79 83C95 113 104 127 90 190Z" fill={`url(#${idPrefix}-aurora-pointer)`} />
    <path d="M95 27C121 23 141 48 135 75C128 110 99 130 90 190C83 146 82 128 96 100C113 68 119 48 95 27Z" fill={`url(#${idPrefix}-aurora-pointer-fold)`} />
    <path d="M90 190C94 144 116 119 128 93C109 107 101 107 89 99C81 126 81 153 90 190Z" fill={`url(#${idPrefix}-aurora-pointer)`} />
    <path d="M56 89C48 60 63 41 78 36M98 32C125 45 117 70 107 88M94 119C87 139 86 155 89 170" fill="none" stroke="#effff5" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M67 51C59 71 69 91 77 102M129 53C134 74 119 96 107 111" fill="none" stroke="#b6f5d9" strokeWidth="1.5" opacity=".7" />
  </>,
  panel: <g strokeLinejoin="round" strokeLinecap="round">
    <path d="M9 10C53 7 72 32 51 55C34 75 51 87 89 83L82 94C33 98 15 73 37 48C55 28 31 19 9 21Z" fill="#276b56" stroke="#78cfae" strokeWidth="1.5" />
    <path d="M9 10C48 9 62 26 48 46C27 75 49 89 85 87C51 81 45 68 60 48C80 22 44 3 9 10Z" fill="#a89ad2" />
    <path d="M9 10C39 12 52 26 42 44C22 71 38 86 71 91C42 73 49 63 61 47C45 49 37 36 39 28C33 18 22 13 9 10Z" fill="#8fefc6" />
    <path d="M12 13C37 13 54 27 42 45M40 62C31 76 48 89 75 91M61 23C72 38 57 49 53 58" fill="none" stroke="#e0ffed" strokeWidth="2" />
    <path d="M13 29C26 30 29 37 23 51C10 82 38 96 61 97" fill="none" stroke="#b9a9e8" strokeWidth="2" />
  </g>,
  hub: <g strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 8C28 4 45 16 31 29C24 37 33 40 43 37L37 44C17 45 10 34 22 22C29 15 18 10 7 13Z" fill="#b5a6e8" />
    <path d="M7 8C25 8 34 15 25 25C13 36 25 41 39 40C18 42 9 35 17 23C24 14 16 11 7 8Z" fill="#8befc3" />
    <path d="M9 9C25 9 30 16 24 23M22 31C19 37 28 40 37 40" fill="none" stroke="#e1fff0" strokeWidth="1.7" />
  </g>,
  swatch: <>
    <rect x="3" y="3" width="58" height="58" rx="8" fill="#0b342b" />
    <path d="M6 22C17 4 45 3 57 23C43 12 26 15 18 27C9 39 20 52 36 58C11 57 0 38 6 22Z" fill="#80e8bc" />
    <path d="M21 8C42 2 65 20 57 42C54 52 47 57 37 58C52 44 52 31 42 23C35 15 27 12 21 8Z" fill="#bdacef" />
    <path d="M7 26C12 13 34 9 47 17M22 47C32 57 48 52 54 40" fill="none" stroke="#e0ffed" strokeWidth="2" strokeLinecap="round" />
    <path d="M14 35C13 23 25 16 37 19C23 21 17 29 21 40C25 47 37 50 46 44C34 56 17 50 14 35Z" fill="#2e9672" />
  </>,
} satisfies RouletteThemeArtwork;

export default aurora;
