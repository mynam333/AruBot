import type { RouletteThemeArtwork } from './types';
import { aperture, point, ring, scallop } from './geometry';
import './sakura.css';

const ink = '#672b43';
const paper = '#fff3f0';
const rose = '#c67b8c';
const foil = '#dfb5a0';
const outline = scallop(482, 12, 12, 180);
const fans = Array.from({ length: 12 }, (_, index) => 15 + index * 30);
const ribs = [
  [404, 39], [431, 26], [461, 18], [500, 15],
  [539, 18], [569, 26], [596, 39],
];

const sakura = {
  id: 'sakura',
  designNotes: 'Twelve overlapping sensu leaves in blush washi, wine-ink bamboo ribs and restrained rose-foil binding. Broad alternating paper folds and notched geometric petals remain legible at 280px. A silk-bound fan pointer ends only at (90,190). The 415-radius clipped aperture leaves the required 414-radius interior clear; the scalloped silhouette reaches radius 494. Small ornaments are redrawn at their native scale, not miniaturized rim artwork.',
  palette: ['#fff3f0', '#a43e61', '#efb8c5', '#672b43', '#b8cdc3', '#dfb5a0'],
  tokens: {
    '--roulette-panel': '#fff3f0',
    '--roulette-panel-strong': '#eed4d6',
    '--roulette-line': '#ba7c8d',
    '--roulette-text': ink,
    '--roulette-muted': '#875267',
    '--roulette-accent': '#9a3659',
    '--roulette-accent-2': '#6c8c7e',
    '--roulette-result': '#943250',
    '--roulette-shadow': 'rgba(86,32,52,.16)',
    '--roulette-hub': '#fff3f0',
    '--roulette-hub-line': ink,
    '--roulette-hub-text': ink,
    '--roulette-hub-muted': '#875267',
    '--roulette-label-dark': '#502238',
    '--roulette-label-light': '#fff6f1',
    '--roulette-segment-line': '#a7657c',
    '--roulette-segment-gloss': 'rgba(255,243,240,.025)',
    '--roulette-track': '#fff3f0',
    '--roulette-pointer': ink,
    '--roulette-pointer-core': paper,
  },
  rim: (idPrefix) => <>
    <defs>
      <clipPath id={`${idPrefix}-sakura-clear`}>
        <path d={aperture(outline, 415)} clipRule="evenodd" />
      </clipPath>
      <linearGradient id={`${idPrefix}-sakura-paper`} x1="0" y1="0" x2="0" y2="1">
        <stop stopColor="#fff9f2" /><stop offset=".54" stopColor="#f9e0e3" />
        <stop offset="1" stopColor="#d895a8" />
      </linearGradient>
      <linearGradient id={`${idPrefix}-sakura-foil`} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#f2d7bb" /><stop offset=".4" stopColor="#b46c7e" />
        <stop offset=".68" stopColor="#f1ceb5" /><stop offset="1" stopColor="#ae6778" />
      </linearGradient>
    </defs>
    {/* Clip every painted edge, including strokes, outside the clear aperture. */}
    <g clipPath={`url(#${idPrefix}-sakura-clear)`} stroke="none">
      <path d={aperture(outline, 415)} fill={ink} fillRule="evenodd" />
      <path d={aperture(scallop(477, 11, 12, 180), 433)} fill="#e9b7c4" fillRule="evenodd" />
      <path d={outline} fill="none" stroke={`url(#${idPrefix}-sakura-foil)`} strokeWidth="7" />
      {fans.map(angle => <g key={angle} transform={`rotate(${angle} 500 500)`}>
        <path d="M500 82L391 42Q500 -16 609 42Z" fill={ink} />
        <path d="M500 75L399 40Q500 -9 601 40Z" fill={`url(#${idPrefix}-sakura-paper)`} />
        <path d="M500 75L431 26L461 18ZM500 75L500 15L539 18ZM500 75L569 26L596 39Z" fill="#d690a7" opacity=".55" />
        <path d="M500 75L461 18L476 16ZM500 75L539 18L552 21Z" fill="#fffaf2" />
        <path d="M399 40Q500 -9 601 40M409 45Q500 5 591 45" fill="none" stroke={`url(#${idPrefix}-sakura-foil)`} strokeWidth="3" />
        <path d={ribs.map(([x, y]) => `M500 76L${x} ${y}`).join('')} fill="none" stroke={ink} strokeWidth="1.7" opacity=".85" />
        <path d="M468 47L458 34L465 29L471 31L475 26L484 31L477 48L472 53ZM523 50L520 35L528 28L533 32L539 31L544 38L530 54Z" fill={ink} opacity=".75" />
        <path d="M472 34L472 47M529 37L527 48" stroke={paper} strokeWidth="1.5" />
        <path d="M492 67Q500 64 508 67L506 79H494Z" fill={foil} />
        <path d="M493 71H507M494 75H506" stroke={ink} strokeWidth="1.6" />
      </g>)}
      {fans.map(angle => <g key={angle} transform={`rotate(${angle + 15} 500 500)`}>
        <path d="M500 33L507 41L503 52L510 58L500 68L490 58L497 52L493 41Z" fill={ink} />
        <path d="M500 39V62M494 57L500 62L506 57" fill="none" stroke={foil} strokeWidth="2" />
      </g>)}
      <path d={ring(434, 415)} fill={ink} fillRule="evenodd" />
      <path d={ring(430, 425)} fill={`url(#${idPrefix}-sakura-foil)`} fillRule="evenodd" />
      <path d={ring(421, 417)} fill={paper} fillRule="evenodd" />
      {Array.from({ length: 72 }, (_, index) => {
        const a = point(435, index * 5);
        const b = point(440, index * 5 + .5);
        return <path key={index} d={`M${a.x} ${a.y}L${b.x} ${b.y}`} stroke={paper} strokeWidth="1.5" />;
      })}
    </g>
  </>,
  pointer: (idPrefix) => <>
    <defs>
      <linearGradient id={`${idPrefix}-sakura-leaf`} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#fff8ed" /><stop offset=".6" stopColor="#f0c3cd" /><stop offset="1" stopColor="#cd879d" />
      </linearGradient>
    </defs>
    <g stroke="none">
      <path d="M90 190L24 65Q30 24 90 12Q150 24 156 65Z" fill={ink} />
      <path d="M90 159L31 63Q41 28 90 19Q139 28 149 63Z" fill={`url(#${idPrefix}-sakura-leaf)`} />
      <path d="M90 159L46 42L62 30ZM90 159L90 19L110 25ZM90 159L128 36L142 50Z" fill="#c77d96" opacity=".57" />
      <path d="M90 154L35 59M90 154L54 36M90 154L73 25M90 154L90 21M90 154L107 25M90 154L126 36M90 154L145 59" fill="none" stroke={ink} strokeWidth="1.8" />
      <path d="M33 63Q90 25 147 63M38 72Q90 37 142 72" fill="none" stroke={foil} strokeWidth="4" />
      <path d="M68 87L57 72L63 63L70 66L75 61L83 68L77 86L72 91ZM108 88L99 73L107 64L113 68L120 66L125 75L115 89Z" fill={ink} />
      <path d="M70 71L72 83M111 73L111 83" stroke={paper} strokeWidth="2" />
      <path d="M74 135Q90 124 106 135L90 190Z" fill={ink} />
      <path d="M80 136Q90 130 100 136L98 145H82Z" fill={foil} />
      <path d="M82 140H98" stroke={ink} strokeWidth="2" />
      <path d="M87 149H93L90 179Z" fill={paper} />
    </g>
  </>,
  panel: <g stroke="none">
    <path d="M18 80L9 34Q33 3 77 18L91 35Z" fill={ink} />
    <path d="M20 72L14 35Q39 10 74 23L83 34Z" fill="#f3cbd2" />
    <path d="M20 72L28 23L42 19ZM20 72L57 20L71 24Z" fill={paper} />
    <path d="M20 72L16 35M20 72L29 23M20 72L44 20M20 72L58 21M20 72L73 26M20 72L83 34" fill="none" stroke={ink} strokeWidth="2" />
    <path d="M16 39Q42 17 79 36" fill="none" stroke={foil} strokeWidth="4" />
    <path d="M46 40L42 32L48 29L52 33L57 32L59 39L49 48Z" fill="#a54e6b" />
    <path d="M16 68L24 73L21 81L13 76Z" fill={foil} />
    <path d="M16 79Q12 88 29 87L40 91M29 87L38 82" fill="none" stroke={ink} strokeWidth="2.5" />
    <path d="M39 88L50 91L43 95Z" fill={rose} />
  </g>,
  hub: <g stroke="none">
    <path d="M24 41L3 18Q7 5 24 3Q41 5 45 18Z" fill={ink} />
    <path d="M24 35L7 17Q12 8 24 7Q36 8 41 17Z" fill="#f1c2cf" />
    <path d="M24 35L15 10L21 8ZM24 35L27 8L34 11Z" fill={paper} />
    <path d="M24 35L8 17M24 35L16 10M24 35V8M24 35L32 10M24 35L40 17" fill="none" stroke={ink} strokeWidth="1.3" />
    <path d="M8 19Q24 9 40 19" fill="none" stroke={foil} strokeWidth="2.5" />
    <path d="M20 33H28L27 39H21Z" fill={foil} />
    <path d="M24 40V45M24 44L32 42" fill="none" stroke={ink} strokeWidth="1.7" />
  </g>,
  swatch: <g stroke="none">
    <rect x="2" y="2" width="60" height="60" rx="6" fill={paper} />
    <path d="M3 46L61 18V61H3Z" fill="#b8cdc3" />
    <path d="M32 54L5 24Q12 6 32 5Q52 6 59 24Z" fill={ink} />
    <path d="M32 46L10 23Q17 11 32 10Q47 11 54 23Z" fill="#e8abba" />
    <path d="M32 46L19 14L28 11ZM32 46L35 11L45 16Z" fill={paper} />
    <path d="M32 46L11 23M32 46L21 14M32 46V11M32 46L43 14M32 46L53 23" fill="none" stroke={ink} strokeWidth="1.4" />
    <path d="M11 25Q32 12 53 25" fill="none" stroke={foil} strokeWidth="3" />
    <path d="M29 29L24 22L29 20L32 23L35 20L40 24L34 32Z" fill={ink} />
    <path d="M28 43H36L35 49H29Z" fill={foil} />
    <path d="M32 51Q30 58 42 56" fill="none" stroke={ink} strokeWidth="2" />
    <rect x="2.75" y="2.75" width="58.5" height="58.5" rx="5.25" fill="none" stroke={rose} strokeWidth="1.5" />
  </g>,
} satisfies RouletteThemeArtwork;

export default sakura;
