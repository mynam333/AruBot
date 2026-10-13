import type { RouletteThemeArtwork } from './types';
import { point, ring } from './geometry';
import './gold.css';

const champagne = '#e7ce8d';
const highlight = '#fff2cb';
const emerald = '#07583e';
const deep = '#063c2c';

const reeds = Array.from({ length: 144 }, (_, index) => {
  const start = point(482, index * 2.5);
  const end = point(492, index * 2.5);
  return `M${start.x} ${start.y}L${end.x} ${end.y}`;
}).join(' ');
const leaves = Array.from({ length: 19 }, (_, index) => 22 + index * 7.5);

const gold = {
  id: 'gold',
  designNotes: 'Casino medallion: a perfectly circular champagne-gold coin with 144 milled edge reeds, a deep emerald enamel channel, paired ascending engraved laurel branches and bright concentric lips. A round mint seal becomes the single-tip pointer. Small ornaments repeat the laurel and mint die without text, architectural corners or brown washes. The 415-495 paint annulus leaves an antialiasing margin around the required 414 aperture.',
  palette: ['#e7ce8d', '#07583e', '#fff2cb', '#318366', '#bfd9b4', '#c9b065'],
  tokens: {
    '--roulette-backdrop': '#094c37',
    '--roulette-panel': '#126348',
    '--roulette-panel-strong': deep,
    '--roulette-panel-finish': 'linear-gradient(145deg, #1b735329, transparent 52%, #012b2029)',
    '--roulette-line': champagne,
    '--roulette-text': '#fff5d9',
    '--roulette-muted': '#d3e4ca',
    '--roulette-accent': champagne,
    '--roulette-accent-2': highlight,
    '--roulette-result': highlight,
    '--roulette-rim-inner': emerald,
    '--roulette-rim-line': champagne,
    '--roulette-hub': 'linear-gradient(135deg, #fff2cb, #e7ce8d 48%, #f4e4b3)',
    '--roulette-hub-line': '#c0a15f',
    '--roulette-hub-text': deep,
    '--roulette-hub-muted': '#285a40',
    '--roulette-label-light': '#fff8e5',
    '--roulette-label-dark': '#073c2a',
    '--roulette-pointer': highlight,
    '--roulette-pointer-core': emerald,
    '--roulette-segment-line': 'rgba(17,70,40,.3)',
    '--roulette-segment-gloss': 'rgba(255,244,207,.055)',
    '--roulette-tick': champagne,
    '--roulette-track': '#1b684c',
    '--roulette-shadow': 'rgba(0,28,18,.35)',
  },
  rim: (idPrefix) => <>
    <defs>
      <linearGradient id={`${idPrefix}-coin-metal`} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#c2a45e" />
        <stop offset=".22" stopColor={highlight} />
        <stop offset=".48" stopColor={champagne} />
        <stop offset=".7" stopColor="#b69b53" />
        <stop offset=".88" stopColor="#f8e8b9" />
        <stop offset="1" stopColor={champagne} />
      </linearGradient>
      <clipPath id={`${idPrefix}-coin-aperture`}>
        <path d={ring(495, 415)} fillRule="evenodd" clipRule="evenodd" />
      </clipPath>
    </defs>
    <g clipPath={`url(#${idPrefix}-coin-aperture)`}>
      <path d={ring(495, 415)} fill={`url(#${idPrefix}-coin-metal)`} fillRule="evenodd" />
      <path d={reeds} fill="none" stroke="#756f3e" strokeWidth="3" />
      <circle cx="500" cy="500" r="493" fill="none" stroke={highlight} strokeWidth="2" />
      <circle cx="500" cy="500" r="479" fill="none" stroke={highlight} strokeWidth="3" />
      <path d={ring(473, 430)} fill={deep} fillRule="evenodd" />
      <circle cx="500" cy="500" r="468" fill="none" stroke="#268566" strokeWidth="2" />
      <circle cx="500" cy="500" r="432" fill="none" stroke="#9ab27a" strokeWidth="1.5" />
      <g fill="none" stroke={champagne} strokeWidth="2.2">
        <path d="M616.47 65.33A450 450 0 0 1 616.47 934.67M383.53 934.67A450 450 0 0 1 383.53 65.33" />
      </g>
      {[1, -1].map(side => <g key={side} transform={side === -1 ? 'translate(1000 0) scale(-1 1)' : undefined}>
        {leaves.map(angle => <g key={angle} transform={`rotate(${angle} 500 500) translate(500 50)`}>
          <path d="M-1 0Q-18-1-22-15Q-5-17-1 0ZM-1 0Q-16 4-19 16Q-3 16-1 0Z" fill={champagne} />
          <path d="M-3-2-17-11M-3 2-14 11" fill="none" stroke="#908449" strokeWidth="1.3" />
        </g>)}
      </g>)}
      {[0, 180].map(angle => <g key={angle} transform={`rotate(${angle} 500 500)`}>
        <circle cx="500" cy="49" r="15" fill={champagne} stroke={highlight} strokeWidth="2" />
        <circle cx="500" cy="49" r="10" fill={emerald} />
        <path d="M500 42 505 49 500 56 495 49Z" fill={highlight} />
      </g>)}
      <circle cx="500" cy="500" r="426" fill="none" stroke={highlight} strokeWidth="3" />
      <circle cx="500" cy="500" r="417" fill="none" stroke="#8d8449" strokeWidth="4" />
    </g>
  </>,
  pointer: (idPrefix) => <>
    <defs>
      <linearGradient id={`${idPrefix}-mint-metal`} x1="0" y1="0" x2="1" y2=".75">
        <stop stopColor={highlight} />
        <stop offset=".38" stopColor={champagne} />
        <stop offset=".68" stopColor="#c0a460" />
        <stop offset="1" stopColor={highlight} />
      </linearGradient>
    </defs>
    <path d="M90 8C52 8 34 31 34 57C34 79 48 94 62 109L90 190 118 109C132 94 146 79 146 57C146 31 128 8 90 8Z" fill={deep} />
    <path d="M90 12C56 12 39 33 39 57C39 78 54 94 67 107L90 190 113 107C126 94 141 78 141 57C141 33 124 12 90 12Z" fill={`url(#${idPrefix}-mint-metal)`} />
    <path d="M90 103V190L113 107Z" fill="#c4aa65" />
    <circle cx="90" cy="57" r="40" fill={emerald} stroke={highlight} strokeWidth="3" />
    <circle cx="90" cy="57" r="34" fill="none" stroke={champagne} strokeWidth="1.5" />
    <path d="M86 79Q61 71 68 47M94 79Q119 71 112 47" fill="none" stroke={champagne} strokeWidth="2" />
    <path d="M70 67Q55 63 59 53Q72 56 70 67ZM72 57Q63 45 69 37Q78 46 72 57ZM79 76Q65 79 63 68Q75 67 79 76ZM110 67Q125 63 121 53Q108 56 110 67ZM108 57Q117 45 111 37Q102 46 108 57ZM101 76Q115 79 117 68Q105 67 101 76Z" fill={champagne} />
    <path d="M90 35 101 53 90 68 79 53Z" fill={highlight} />
    <path d="M90 35V68L101 53Z" fill="#c9b065" />
  </>,
  panel: <g stroke="none">
    <path d="M58 83C23 71 24 38 47 18" fill="none" stroke={champagne} strokeWidth="3" />
    <path d="M37 60Q14 63 15 43Q34 43 37 60ZM33 43Q17 34 26 20Q43 28 33 43ZM40 29Q35 13 49 9Q56 25 40 29ZM47 74Q27 83 20 65Q38 58 47 74ZM34 51Q35 30 51 33Q53 48 34 51ZM39 66Q40 45 58 48Q57 65 39 66ZM53 79Q55 60 70 64Q71 79 53 79Z" fill={champagne} />
    <path d="M33 55 21 49M32 37 28 27M42 23 47 14M39 71 27 68M39 45 47 38M45 60 54 52M59 74 66 68" stroke={deep} strokeWidth="1.5" fill="none" />
  </g>,
  hub: <g stroke="none">
    <path d="M22 41C8 37 5 23 13 10M26 41C40 37 43 23 35 10" fill="none" stroke={deep} strokeWidth="1.8" />
    <path d="M11 26Q1 22 5 14Q14 17 11 26ZM12 18Q8 7 16 5Q21 12 12 18ZM16 35Q4 36 5 27Q15 26 16 35ZM37 26Q47 22 43 14Q34 17 37 26ZM36 18Q40 7 32 5Q27 12 36 18ZM32 35Q44 36 43 27Q33 26 32 35Z" fill={emerald} />
    <path d="M24 10 31 23 24 33 17 23Z" fill={deep} />
    <path d="M24 10V33L31 23Z" fill="#328361" />
  </g>,
  swatch: <g stroke="none">
    <circle cx="32" cy="32" r="30" fill={champagne} />
    <circle cx="32" cy="32" r="27.5" fill="none" stroke="#817b46" strokeWidth="3" strokeDasharray="1.4 2.2" />
    <circle cx="32" cy="32" r="25" fill={deep} stroke={highlight} strokeWidth="1.5" />
    <circle cx="32" cy="32" r="18.5" fill={champagne} />
    <path d="M32 13.5A18.5 18.5 0 0 1 48 41.3L32 32Z" fill={emerald} />
    <path d="M16 41.3A18.5 18.5 0 0 1 32 13.5V32Z" fill={highlight} />
    <path d="M32 50.5A18.5 18.5 0 0 1 16 41.3L32 32Z" fill="#318366" />
    <circle cx="32" cy="32" r="7" fill={highlight} stroke={deep} strokeWidth="1.5" />
    <path d="M32 26 36 32 32 38 28 32Z" fill={emerald} />
    <path d="M9 29Q5 23 10 20Q14 24 9 29ZM12 20Q9 14 15 13Q18 18 12 20ZM55 29Q59 23 54 20Q50 24 55 29ZM52 20Q55 14 49 13Q46 18 52 20Z" fill={champagne} />
  </g>,
} satisfies RouletteThemeArtwork;

export default gold;
