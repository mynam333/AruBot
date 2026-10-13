import type { RouletteThemeArtwork } from './types';
import { aperture, point, ring } from './geometry';
import './arcade.css';

const black = '#121616';
const yellow = '#ffdb3b';
const coral = '#ff6655';
const teal = '#29cbb7';
const white = '#fff6d6';

// Each stair corner, rather than just its midpoint, stays inside radius 496.
const cabinetRows = Array.from({ length: 30 }, (_, index) => {
  const top = -480 + index * 32;
  const bottom = top + 32;
  const halfWidth = Math.floor(Math.sqrt(496 ** 2 - Math.max(top ** 2, bottom ** 2)) / 16) * 16;
  return { top: top + 500, bottom: bottom + 500, left: 500 - halfWidth, right: 500 + halfWidth };
});
const cabinet = [...cabinetRows.flatMap(({ top, bottom, right }) => [[right, top], [right, bottom]]),
  ...cabinetRows.slice().reverse().flatMap(({ top, bottom, left }) => [[left, bottom], [left, top]])]
  .map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ') + 'Z';
const shell = aperture(cabinet, 414);

const arcade = {
  id: 'arcade',
  designNotes: '1980s coin-op cabinet with a stair-stepped black housing, inset yellow edge, square marquee lamps, orthogonal circuit traces and coral/teal hardware. A single pixel-stepped pointer blade lands at (90,190). The side ornaments echo a cabinet control deck; the hub is a pixel joystick. Flat solid inks only, no glow, lettering or autonomous motion. Every rim detail is clipped to the cabinet silhouette and its radius-414 clear aperture.',
  palette: [yellow, coral, teal, black, white, '#439bd1'],
  tokens: {
    '--roulette-backdrop': black,
    '--roulette-stage-ambient': 'none',
    '--roulette-panel': black,
    '--roulette-panel-strong': '#202828',
    '--roulette-panel-finish': 'none',
    '--roulette-line': yellow,
    '--roulette-text': white,
    '--roulette-muted': '#bad5cc',
    '--roulette-accent': yellow,
    '--roulette-accent-2': teal,
    '--roulette-result': yellow,
    '--roulette-rim-outer': black,
    '--roulette-rim-inner': black,
    '--roulette-rim-line': yellow,
    '--roulette-hub': black,
    '--roulette-hub-line': yellow,
    '--roulette-hub-text': yellow,
    '--roulette-hub-muted': '#bad5cc',
    '--roulette-pointer': yellow,
    '--roulette-pointer-core': coral,
    '--roulette-label-light': white,
    '--roulette-label-dark': black,
    '--roulette-segment-line': black,
    '--roulette-segment-gloss': 'transparent',
    '--roulette-track': '#202828',
    '--roulette-tick': teal,
    '--roulette-shadow': 'transparent',
  },
  rim: (idPrefix) => <>
    <defs>
      <clipPath id={`${idPrefix}-arcade-cabinet`}>
        <path d={shell} fillRule="evenodd" clipRule="evenodd" />
      </clipPath>
    </defs>
    <g clipPath={`url(#${idPrefix}-arcade-cabinet)`} strokeLinejoin="miter" strokeLinecap="square">
      <path d={shell} fill={black} fillRule="evenodd" stroke={yellow} strokeWidth="14" />
      <path d="M20 420V580H36V644H68V716H100V780H132V812H164V844H196V876H260V908H324V940H388V972H500" fill="none" stroke={teal} strokeWidth="12" />
      <path d="M980 420V580H964V644H932V716H900V780H868V812H836V844H804V876H740V908H676V940H612V972H500" fill="none" stroke={coral} strokeWidth="12" />
      <path d={ring(429, 414)} fill={yellow} fillRule="evenodd" />
      <path d={ring(425, 418)} fill={black} fillRule="evenodd" />
      <path d={ring(420, 418)} fill={teal} fillRule="evenodd" />
      {Array.from({ length: 28 }, (_, index) => {
        const p = point(452, (index + .5) * 360 / 28);
        const color = index % 7 === 0 ? coral : index % 7 === 6 ? teal : yellow;
        return <g key={index} transform={`translate(${Math.round(p.x) - 10} ${Math.round(p.y) - 10})`} stroke="none">
          <path d="M0 0H20V20H0Z" fill={color} />
          <path d="M4 4H12V8H8V12H4Z" fill={white} />
          <path d="M4 16H16V4H20V20H4Z" fill={black} fillOpacity=".28" />
        </g>;
      })}
      {[0, 90, 180, 270].map((angle, index) => <g key={angle} transform={`rotate(${angle} 500 500)`}>
        <path d="M388 52H432V36H476M524 36H568V52H612" fill="none" stroke={index % 2 ? coral : teal} strokeWidth="6" />
        <path d="M488 32H512V56H488Z" fill={yellow} />
        <path d="M496 40H504V48H496Z" fill={black} />
      </g>)}
    </g>
  </>,
  pointer: (_idPrefix) => <g stroke="none">
    <path d="M38 12H142V28H158V76H142V106H126V132H110V164L90 190L70 164V132H54V106H38V76H22V28H38Z" fill={black} />
    <path d="M44 20H136V36H150V68H134V98H118V126H102V162L90 180L78 162V126H62V98H46V68H30V36H44Z" fill={yellow} />
    <path d="M54 32H126V48H138V60H122V90H106V116H96V151H84V116H74V90H58V60H42V48H54Z" fill={coral} />
    <path d="M54 32H126V44H66V60H54Z" fill={white} />
    <path d="M78 60H102V84H78Z" fill={black} />
    <path d="M84 66H96V78H84Z" fill={teal} />
  </g>,
  panel: <g stroke="none">
    <path d="M8 18H58V26H74V34H20V66H74V74H58V82H8Z" fill={yellow} />
    <path d="M8 28H14V72H8Z" fill={coral} />
    <path d="M26 40H34V32H50V40H58V56H50V64H34V56H26Z" fill={teal} />
    <path d="M38 42H46V66H38Z" fill={black} />
    <path d="M26 66H62V74H26Z" fill={teal} />
    <path d="M66 46H78V58H66Z" fill={coral} />
    <path d="M82 60H94V72H82Z" fill={yellow} />
    <path d="M68 48H74V52H68Z" fill={white} />
  </g>,
  hub: <g stroke="none">
    <path d="M8 34H40V42H8Z" fill={teal} />
    <path d="M18 18H24V36H18Z" fill={white} />
    <path d="M14 4H28V8H32V20H28V24H14V20H10V8H14Z" fill={coral} />
    <path d="M14 8H24V12H18V16H14Z" fill={yellow} />
    <path d="M32 26H40V32H32Z" fill={yellow} />
    <path d="M12 38H36V42H12Z" fill={black} fillOpacity=".3" />
  </g>,
  swatch: <g stroke="none">
    <path d="M10 2H54V6H60V58H54V62H10V58H4V6H10Z" fill={black} />
    <path d="M10 6H54V10H58V54H54V58H10V54H6V10H10Z M14 12V52H50V12Z" fill={yellow} fillRule="evenodd" />
    <path d="M12 18H16V48H12Z" fill={teal} />
    <path d="M48 18H52V48H48Z" fill={coral} />
    <path d="M32 16A18 18 0 0 1 50 34H32Z" fill={teal} />
    <path d="M50 34A18 18 0 0 1 32 52V34Z" fill={coral} />
    <path d="M32 52A18 18 0 0 1 14 34H32Z" fill={yellow} />
    <path d="M14 34A18 18 0 0 1 32 16V34Z" fill={white} />
    <path d="M26 28H38V40H26Z" fill={black} />
    <path d="M30 30H34V36H30Z" fill={teal} />
    <path d="M26 8H38V14H36V18L32 24L28 18V14H26Z" fill={black} />
    <path d="M30 10H34V16L32 20L30 16Z" fill={coral} />
  </g>,
} satisfies RouletteThemeArtwork;

export default arcade;
