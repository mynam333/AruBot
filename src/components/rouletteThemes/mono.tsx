import type { RouletteThemeArtwork } from './types';
import { point, ring } from './geometry';
import './mono.css';

const ink = '#111111';
const paper = '#ffffff';

function band(inner: number, outer: number, start: number, end: number) {
  const a = point(outer, start);
  const b = point(outer, end);
  const c = point(inner, end);
  const d = point(inner, start);
  return `M${a.x} ${a.y}A${outer} ${outer} 0 0 1 ${b.x} ${b.y}L${c.x} ${c.y}A${inner} ${inner} 0 0 0 ${d.x} ${d.y}Z`;
}

const minorTicks = Array.from({ length: 96 }, (_, index) => {
  if (index % 8 === 0) return '';
  const a = point(index % 4 === 0 ? 428 : 434, index * 3.75);
  const b = point(444, index * 3.75);
  return `M${a.x} ${a.y}L${b.x} ${b.y}`;
}).join(' ');

const majorTicks = Array.from({ length: 12 }, (_, index) => {
  const a = point(425, index * 30);
  const b = point(446, index * 30);
  return `M${a.x} ${a.y}L${b.x} ${b.y}`;
}).join(' ');

const mono = {
  id: 'mono',
  designNotes: 'Swiss editorial dial built from solid ink and untouched white. Opposed black bezel fields, a separate calibrated inner rail, oversized registration targets and four square index gates create a legible mechanical hierarchy. The pointer is a single black blade with a registration-bearing head. Panel rules, split registration hub and miniature dial repeat the same print vocabulary without lettering, gloss or decorative motion.',
  palette: ['#ffffff', '#111111', '#d9d9d9', '#3c3c3c', '#f2f2f2', '#696969'],
  tokens: {
    '--roulette-panel': paper,
    '--roulette-panel-strong': paper,
    '--roulette-panel-finish': 'none',
    '--roulette-text': ink,
    '--roulette-muted': '#4a4a4a',
    '--roulette-result': ink,
    '--roulette-accent': ink,
    '--roulette-accent-2': ink,
    '--roulette-line': ink,
    '--roulette-track': '#eeeeee',
    '--roulette-hub': paper,
    '--roulette-hub-line': ink,
    '--roulette-hub-text': ink,
    '--roulette-hub-muted': '#4a4a4a',
    '--roulette-shadow': 'transparent',
    '--roulette-segment-gloss': 'transparent',
  },
  rim: (idPrefix) => <>
    <defs>
      <clipPath id={`${idPrefix}-mono-aperture`}>
        <path d={ring(496, 414)} fillRule="evenodd" clipRule="evenodd" />
      </clipPath>
    </defs>
    <g clipPath={`url(#${idPrefix}-mono-aperture)`} fill={ink} stroke="none">
      <path d={ring(496, 414)} fillRule="evenodd" />
      <path d={ring(487, 421)} fill={paper} fillRule="evenodd" />
      <path d={band(451, 483, 3, 87)} />
      <path d={band(451, 483, 183, 267)} />
      <circle cx="500" cy="500" r="449" fill="none" stroke={ink} strokeWidth="2" />
      <path d={minorTicks} fill="none" stroke={ink} strokeWidth="2" />
      <path d={majorTicks} fill="none" stroke={ink} strokeWidth="6" />
      <circle cx="500" cy="500" r="417" fill="none" stroke={paper} strokeWidth="2" />
      {[0, 90, 180, 270].map((angle) => <g key={angle} transform={`rotate(${angle} 500 500)`}>
        <path d="M480 10H520V47H480Z" fill={paper} />
        <path d="M484 14H516V45H484Z" />
        <path d="M497 20H503V39H497Z" fill={paper} />
        <path d="M474 18H477V37H474Z M523 18H526V37H523Z" />
      </g>)}
      {[45, 135, 225, 315].map((angle, index) => {
        const foreground = index % 2 === 0 ? paper : ink;
        const background = index % 2 === 0 ? ink : paper;
        return <g key={angle} transform={`rotate(${angle} 500 500)`}>
          <circle cx="500" cy="33" r="14" fill={background} />
          <circle cx="500" cy="33" r="9" fill="none" stroke={foreground} strokeWidth="2.5" />
          <path d="M482 33H518M500 15V51" fill="none" stroke={foreground} strokeWidth="2.5" />
          <circle cx="500" cy="33" r="3" fill={foreground} />
        </g>;
      })}
      {[15, 30, 60, 75, 105, 120, 150, 165, 195, 210, 240, 255, 285, 300, 330, 345].map((angle) => {
        const reversed = angle < 90 || (angle > 180 && angle < 270);
        return <g key={angle} transform={`rotate(${angle} 500 500)`} fill={reversed ? paper : ink}>
          <path d="M496 23H504V42H496Z" />
          <path d="M490 25H492V40H490Z M508 25H510V40H508Z" opacity=".65" />
        </g>;
      })}
    </g>
  </>,
  pointer: (idPrefix) => <g id={`${idPrefix}-mono-pointer`} stroke="none">
    <path d="M38 12H142V72L90 190L38 72Z" fill={ink} />
    <path d="M45 19H135V70L90 171L45 70Z" fill={paper} />
    <path d="M62 77H118L90 190Z" fill={ink} />
    <path d="M86 88H94V126H86Z" fill={paper} />
    <path d="M52 26H63V30H52Z M117 26H128V30H117Z M52 61H63V65H52Z M117 61H128V65H117Z" fill={ink} />
    <circle cx="90" cy="46" r="21" fill={ink} />
    <circle cx="90" cy="46" r="14" fill={paper} />
    <path d="M90 32A14 14 0 0 1 104 46H90Z M90 46V60A14 14 0 0 1 76 46Z" fill={ink} />
    <path d="M90 20V30M90 62V72M64 46H74M106 46H116" fill="none" stroke={ink} strokeWidth="3" />
    <circle cx="90" cy="46" r="4" fill={paper} stroke={ink} strokeWidth="2" />
  </g>,
  panel: <g fill="currentColor" stroke="none">
    <path d="M7 12H89V19H7Z M7 25H72V27H7Z M7 81H89V88H7Z M7 73H72V75H7Z" />
    <path d="M7 34H12V66H7Z M18 34H20V66H18Z" />
    <circle cx="45" cy="50" r="16" fill="none" stroke="currentColor" strokeWidth="3" />
    <path d="M45 34A16 16 0 0 1 61 50H45Z M45 50V66A16 16 0 0 1 29 50Z" />
    <path d="M45 29V71M24 50H66" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M74 38H82V62H74Z M87 38H90V62H87Z" />
  </g>,
  hub: <g fill="currentColor" stroke="none">
    <path d="M3 3H16V6H6V16H3Z M32 3H45V16H42V6H32Z M3 32H6V42H16V45H3Z M42 32H45V45H32V42H42Z" />
    <circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M24 9A15 15 0 0 1 39 24H24Z M24 24V39A15 15 0 0 1 9 24Z" />
    <path d="M24 5V43M5 24H43" fill="none" stroke="currentColor" strokeWidth="2" />
  </g>,
  swatch: <g stroke="none">
    <path d="M0 0H64V64H0Z" fill={paper} />
    <circle cx="32" cy="32" r="29" fill={ink} />
    <circle cx="32" cy="32" r="25" fill={paper} />
    <path d="M32 9A23 23 0 0 1 55 32H32Z M32 32V55A23 23 0 0 1 9 32Z" fill={ink} />
    <circle cx="32" cy="32" r="16" fill={paper} />
    <circle cx="32" cy="32" r="12" fill="none" stroke={ink} strokeWidth="2" />
    <path d="M32 20A12 12 0 0 1 44 32H32Z M32 32V44A12 12 0 0 1 20 32Z" fill={ink} />
    <path d="M28 3H36V9H28Z" fill={paper} />
    <path d="M29 4H35V8L32 15L29 8Z" fill={ink} />
    <path d="M4 30H9V34H4Z M55 30H60V34H55Z M30 55H34V60H30Z" fill={paper} />
  </g>,
} satisfies RouletteThemeArtwork;

export default mono;
