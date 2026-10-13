import type { RouletteThemeArtwork } from './types';
import { aperture, ring, scallop } from './geometry';
import './velvet.css';

const gold = '#d4b578';
const thread = '#f0d7a0';
const wine = '#68152f';
const shadow = '#350d20';
const outline = scallop(480, 13, 16);
const folds = Array.from({ length: 16 }, (_, index) => index * 22.5);

const velvet = {
  id: 'velvet',
  designNotes: 'Opera-house passementerie: sixteen gathered burgundy velvet swags, broad soft folds, antique-gold couching and bound tassels. Gold is thread and cord rather than a reflective metal bezel. The tieback pointer has one terminal at (90,190); a clipped 414-radius aperture protects every sector. Panel, hub and picker repeat the same textile construction at their own optical scale.',
  palette: ['#741b39', '#e4c58a', '#3e1429', '#c8687c', '#f5e5c5', '#a13b58'],
  tokens: {
    '--roulette-panel': '#57152d',
    '--roulette-panel-strong': '#3e1025',
    '--roulette-line': '#bd995f',
    '--roulette-text': '#fff0d6',
    '--roulette-muted': '#e6c2b7',
    '--roulette-accent': gold,
    '--roulette-accent-2': thread,
    '--roulette-result': '#fae6b7',
    '--roulette-hub': 'linear-gradient(110deg, #3e1025, #842c48 45%, #57152d 78%)',
    '--roulette-hub-line': gold,
    '--roulette-hub-text': '#fff0d6',
    '--roulette-hub-muted': '#e6c2b7',
    '--roulette-label-light': '#fff0dc',
    '--roulette-label-dark': '#300c1c',
    '--roulette-segment-line': 'rgba(243,216,168,.34)',
    '--roulette-segment-gloss': 'rgba(233,166,180,.025)',
    '--roulette-track': '#4a122a',
    '--roulette-shadow': 'rgba(31,5,17,.38)',
  },
  rim: (idPrefix) => <>
    <defs>
      <clipPath id={`${idPrefix}-velvet-aperture`}>
        <path d={aperture(outline, 415)} clipRule="evenodd" />
      </clipPath>
      <linearGradient id={`${idPrefix}-velvet-pile`} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#9c3955" />
        <stop offset=".36" stopColor="#65162f" />
        <stop offset=".7" stopColor="#491024" />
        <stop offset="1" stopColor="#7d2943" />
      </linearGradient>
      <linearGradient id={`${idPrefix}-velvet-fold`} x1="0" y1="0" x2="0" y2="1">
        <stop stopColor="#370c20" />
        <stop offset=".4" stopColor="#751a38" />
        <stop offset=".73" stopColor="#a4445c" />
        <stop offset="1" stopColor="#62142e" />
      </linearGradient>
      <linearGradient id={`${idPrefix}-velvet-cord`} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#f0d7a0" />
        <stop offset=".55" stopColor="#b38b50" />
        <stop offset="1" stopColor="#d4b578" />
      </linearGradient>
    </defs>
    {/* The extra unit keeps antialiased edges outside the 414-radius aperture. */}
    <g clipPath={`url(#${idPrefix}-velvet-aperture)`}>
      <path d={aperture(outline, 415)} fill={`url(#${idPrefix}-velvet-pile)`} fillRule="evenodd" />
      <path d={outline} fill="none" stroke={shadow} strokeWidth="11" />
      <path d={scallop(477, 12, 16)} fill="none" stroke={gold} strokeWidth="5" />
      <path d={scallop(470, 11, 16)} fill="none" stroke={thread} strokeWidth="1.8" strokeDasharray="3 5" />
      {folds.map(angle => <g key={angle} transform={`rotate(${angle} 500 500)`}>
        <path d="M410 42Q500 90 590 42L580 27Q500 54 420 27Z" fill={`url(#${idPrefix}-velvet-fold)`} />
        <path d="M421 36Q500 72 579 36M438 30Q500 53 562 30" fill="none" stroke="#be6173" strokeWidth="2.5" opacity=".48" />
        <path d="M450 25Q458 47 479 58M550 25Q542 47 521 58" fill="none" stroke={shadow} strokeWidth="4" opacity=".6" />
        <path d="M410 43Q500 96 590 43" fill="none" stroke={shadow} strokeWidth="8" />
        <path d="M410 41Q500 94 590 41" fill="none" stroke={`url(#${idPrefix}-velvet-cord)`} strokeWidth="4.5" />
        <path d="M415 45Q500 99 585 45" fill="none" stroke={thread} strokeWidth="1.8" strokeDasharray="2 6" />
      </g>)}
      {folds.map(angle => <g key={angle} transform={`rotate(${angle + 11.25} 500 500)`}>
        <path d="M489 39Q500 30 511 39L508 48H492Z" fill={shadow} stroke={gold} strokeWidth="2" />
        <path d="M495 48H505L512 71Q500 78 488 71Z" fill="#b48b51" />
        <path d="M496 50L493 70M500 50V73M504 50L507 70" fill="none" stroke={thread} strokeWidth="2" />
        <path d="M491 43H509M492 47H508" stroke={thread} strokeWidth="2" />
      </g>)}
      <path d={ring(433, 414)} fill={shadow} fillRule="evenodd" />
      <circle cx="500" cy="500" r="429" fill="none" stroke="#8d3750" strokeWidth="5" />
      <circle cx="500" cy="500" r="421" fill="none" stroke={gold} strokeWidth="5" />
      <circle cx="500" cy="500" r="421" fill="none" stroke={thread} strokeWidth="2" strokeDasharray="2 7" />
      <circle cx="500" cy="500" r="415.5" fill="none" stroke="#a87945" strokeWidth="3" />
    </g>
  </>,
  pointer: (idPrefix) => <>
    <defs>
      <linearGradient id={`${idPrefix}-velvet-pointer`} x1="0" y1="0" x2="1" y2="0">
        <stop stopColor="#451025" /><stop offset=".4" stopColor="#9b3c56" />
        <stop offset=".62" stopColor="#741d39" /><stop offset="1" stopColor="#451025" />
      </linearGradient>
    </defs>
    <path d="M90 190L53 111C38 91 28 72 36 56C23 36 43 19 61 24Q90 3 119 24C137 19 157 36 144 56C152 72 142 91 127 111Z" fill={gold} />
    <path d="M90 177L61 108C46 87 38 71 46 56C34 41 49 27 65 34Q90 14 115 34C131 27 146 41 134 56C142 71 134 87 119 108Z" fill={`url(#${idPrefix}-velvet-pointer)`} />
    <path d="M47 55Q90 90 133 55M50 64Q90 98 130 64" fill="none" stroke={shadow} strokeWidth="5" />
    <path d="M45 51Q90 85 135 51" fill="none" stroke={thread} strokeWidth="3" />
    <path d="M57 36Q64 55 82 67M123 36Q116 55 98 67M90 26V62" fill="none" stroke="#c36b7c" strokeWidth="2.5" />
    <path d="M79 74Q90 66 101 74L99 85H81Z" fill={gold} stroke={shadow} strokeWidth="2" />
    <path d="M83 86H97L106 117Q90 126 74 117Z" fill="#bb945b" />
    <path d="M85 88L81 116M90 88V120M95 88L99 116M81 78H99" fill="none" stroke={thread} strokeWidth="2.5" />
    <path d="M81 137L90 190L99 137Q90 143 81 137Z" fill={thread} />
    <path d="M60 94L75 130M120 94L105 130" fill="none" stroke={gold} strokeWidth="2" strokeDasharray="2 5" />
  </>,
  panel: <g strokeLinejoin="round" strokeLinecap="round">
    <path d="M8 8H91Q78 27 42 33Q33 62 42 92H9Z" fill={shadow} />
    <path d="M12 10H85Q72 23 34 29Q23 58 34 90H12Z" fill={wine} />
    <path d="M21 12Q26 26 21 51Q18 72 22 89M35 12Q41 20 65 17" fill="none" stroke="#a84b63" strokeWidth="5" />
    <path d="M13 12Q33 48 86 12M14 20Q35 51 76 27" fill="none" stroke={gold} strokeWidth="3" />
    <path d="M13 53Q26 61 42 51M13 57Q26 65 42 55" fill="none" stroke={thread} strokeWidth="2.5" />
    <path d="M39 54Q58 51 56 66" fill="none" stroke={gold} strokeWidth="3" />
    <path d="M51 66H61L66 84Q56 90 46 84Z" fill={gold} />
    <path d="M54 70L52 83M58 70L60 83" stroke={shadow} strokeWidth="2" />
    <path d="M8 8V92M13 90H35M51 64H61" fill="none" stroke={gold} strokeWidth="2" />
  </g>,
  hub: <g strokeLinejoin="round">
    <path d="M24 4Q31 10 39 9Q38 18 44 24Q38 30 39 39Q30 38 24 44Q18 38 9 39Q10 30 4 24Q10 18 9 9Q18 10 24 4Z" fill={shadow} stroke={gold} strokeWidth="1.6" />
    <path d="M24 9Q31 20 39 24Q31 28 24 39Q17 28 9 24Q17 20 24 9Z" fill="#9a3854" />
    <path d="M12 15Q24 31 36 15M12 33Q24 17 36 33" fill="none" stroke={gold} strokeWidth="2" />
    <path d="M20 20H28V28H20Z" fill={thread} />
    <path d="M23 21V27M26 21V27" stroke="#986938" strokeWidth="1.5" />
  </g>,
  swatch: <>
    <rect x="2" y="2" width="60" height="60" rx="7" fill={shadow} />
    <path d="M4 5H60V18Q47 39 32 26Q17 39 4 18Z" fill="#943650" />
    <path d="M8 7Q11 20 25 27M56 7Q53 20 39 27" fill="none" stroke="#c3697d" strokeWidth="3" />
    <path d="M5 17Q18 39 32 24Q46 39 59 17" fill="none" stroke={gold} strokeWidth="2.5" />
    <path d="M27 23H37L35 32H29Z" fill={thread} />
    <path d="M30 33H34L39 48Q32 53 25 48Z" fill={gold} />
    <path d="M32 35V47M29 37L28 46M35 37L36 46" stroke={shadow} strokeWidth="1.5" />
    <rect x="4" y="4" width="56" height="56" rx="5" fill="none" stroke={gold} strokeWidth="1.5" />
  </>,
} satisfies RouletteThemeArtwork;

export default velvet;
