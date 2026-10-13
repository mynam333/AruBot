import type { RouletteThemeArtwork } from './types';
import { aperture, polygon, ring } from './geometry';
import './deco.css';

const jade = '#0b211d';
const gold = '#d6bd82';
const light = '#f6e9c7';
const octagon = (radius: number) => `M${polygon(8, radius, 22.5)}Z`;

const deco = {
  id: 'deco',
  designNotes: 'Architectural jewellery in black jade and champagne gold. Eight stepped crown mounts carry broad sunburst fans; octagonal bevels, baguette inlays and a circular machined lip frame a strictly clear aperture. A stepped fan brooch resolves into one uninterrupted winning needle. The same fan and setback architecture repeat in the plaque, hub and picker without relying on legacy artwork.',
  palette: ['#102c25', '#d6bd82', '#40564b', '#f1e4c3', '#9c875e', '#18231f'],
  tokens: {
    '--roulette-panel': '#10241e',
    '--roulette-panel-strong': '#091a16',
    '--roulette-text': '#f6e9c7',
    '--roulette-muted': '#cfc4a7',
    '--roulette-accent': '#d6bd82',
    '--roulette-accent-2': '#f6e9c7',
    '--roulette-result': '#f6e9c7',
    '--roulette-line': '#a68d5b',
    '--roulette-hub': '#0b211d',
    '--roulette-hub-line': '#d6bd82',
    '--roulette-hub-text': '#f6e9c7',
    '--roulette-hub-muted': '#cfc4a7',
    '--roulette-track': '#243b2f',
  },
  rim: (idPrefix: string) => {
    const metal = `${idPrefix}-deco-metal`;
    const enamel = `${idPrefix}-deco-enamel`;
    const clear = `${idPrefix}-deco-aperture`;
    return <>
      <defs>
        <linearGradient id={metal} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#fff2d4" />
          <stop offset=".22" stopColor="#c4a66a" />
          <stop offset=".43" stopColor="#f4e4bb" />
          <stop offset=".58" stopColor="#8d7041" />
          <stop offset=".78" stopColor="#e6cf96" />
          <stop offset="1" stopColor="#aa8c53" />
        </linearGradient>
        <linearGradient id={enamel} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#355046" />
          <stop offset=".38" stopColor={jade} />
          <stop offset=".74" stopColor="#071612" />
          <stop offset="1" stopColor="#253e33" />
        </linearGradient>
        <clipPath id={clear}>
          <path d={ring(496, 414)} clipRule="evenodd" />
        </clipPath>
      </defs>
      {/* Clip every bevel and mount, including stroke expansion, away from the sectors. */}
      <g clipPath={`url(#${clear})`} strokeLinejoin="miter">
        <path d={aperture(octagon(490))} fill={`url(#${metal})`} fillRule="evenodd" />
        <path d={aperture(octagon(480))} fill={jade} fillRule="evenodd" />
        <path d={aperture(octagon(471))} fill={`url(#${metal})`} fillRule="evenodd" />
        <path d={aperture(octagon(465))} fill={`url(#${enamel})`} fillRule="evenodd" />
        <path d={octagon(485)} fill="none" stroke={light} strokeWidth="1.8" />
        <path d={octagon(476)} fill="none" stroke="#6a5c3b" strokeWidth="2" />
        {Array.from({ length: 8 }, (_, index) => <g key={index} transform={`rotate(${index * 45} 500 500)`}>
          <path d="M413 69V40H437V25H463V9H537V25H563V40H587V69L555 83H445Z" fill={`url(#${metal})`} stroke="#091b16" strokeWidth="3" />
          <path d="M423 64V47H447V33H472V18H528V33H553V47H577V64L549 77H451Z" fill={jade} />
          <path d="M429 59V52H453V38H478V24H522V38H547V52H571V59" fill="none" stroke={light} strokeWidth="2" />
          <path d="M500 79L447 45H462V31H480V21H520V31H538V45H553Z" fill={`url(#${metal})`} />
          <path d="M500 77L454 46M500 77L466 33M500 77L482 23M500 77V22M500 77L518 23M500 77L534 33M500 77L546 46" fill="none" stroke={jade} strokeWidth="3" />
          <path d="M425 60H440L458 73M575 60H560L542 73" fill="none" stroke={gold} strokeWidth="2.5" />
          <path d="M486 76H514L510 83H490Z" fill={gold} />
          <path d="M490 77H510" stroke={light} strokeWidth="2" />
        </g>)}
        {Array.from({ length: 8 }, (_, index) => <g key={index} transform={`rotate(${22.5 + index * 45} 500 500)`}>
          <path d="M485 29L500 18L515 29V58L500 70L485 58Z" fill={`url(#${metal})`} />
          <path d="M491 32L500 25L509 32V54L500 62L491 54Z" fill="#183d30" stroke="#f0ddb0" strokeWidth="1.8" />
          <path d="M491 32L500 25V62L491 54Z" fill="#42634d" />
          <path d="M496 32V49M504 35V54" stroke="#91a486" strokeWidth="1.8" />
          <path d="M474 38V59L482 67M526 38V59L518 67" fill="none" stroke={gold} strokeWidth="2.5" />
        </g>)}
        <circle cx="500" cy="500" r="421" fill="none" stroke="#071612" strokeWidth="14" />
        <circle cx="500" cy="500" r="424" fill="none" stroke={`url(#${metal})`} strokeWidth="7" />
        <circle cx="500" cy="500" r="418" fill="none" stroke={light} strokeWidth="2" />
        <circle cx="500" cy="500" r="415" fill="none" stroke="#937b4e" strokeWidth="2" />
      </g>
    </>;
  },
  pointer: (idPrefix: string) => {
    const metal = `${idPrefix}-deco-pointer-metal`;
    return <>
      <defs>
        <linearGradient id={metal} x1="0" y1="0" x2="1" y2=".2">
          <stop stopColor="#927344" />
          <stop offset=".35" stopColor="#f5e4b9" />
          <stop offset=".52" stopColor="#fff4da" />
          <stop offset=".53" stopColor="#bb995c" />
          <stop offset="1" stopColor="#e8d3a2" />
        </linearGradient>
      </defs>
      <path d="M68 9H112V23H133V39H153V69H139V88H120L105 113L90 190L75 113L60 88H41V69H27V39H47V23H68Z" fill={`url(#${metal})`} />
      <path d="M73 15H107V29H128V45H147V64H133V81H116L101 108H79L64 81H47V64H33V45H52V29H73Z" fill={jade} stroke="#695938" strokeWidth="2" />
      <path d="M90 101L44 53H58V37H77V22H103V37H122V53H136Z" fill={`url(#${metal})`} />
      <path d="M90 98L50 54M90 98L64 39M90 98L80 25M90 98V23M90 98L100 25M90 98L116 39M90 98L130 54" fill="none" stroke={jade} strokeWidth="3" />
      <path d="M39 59V50H58V33H78V19M102 19V33H122V50H141V59" fill="none" stroke={light} strokeWidth="1.8" />
      <path d="M73 101H107L101 112H79Z" fill={gold} stroke={jade} strokeWidth="2" />
      <path d="M79 104H101" stroke={light} strokeWidth="2" />
      <path d="M79 114L90 190V114Z" fill={light} />
      <path d="M90 114V190L101 114Z" fill="#b1945f" />
    </>;
  },
  panel: <g fill="none" strokeLinejoin="miter">
    <path d="M9 87V29H23V17H39V8H87V16H45V25H31V38H19V87Z" fill={gold} />
    <path d="M24 79V47H37V35H51V24H77L85 32V57H72V69H58V81H24Z" fill="#284337" />
    <path d="M25 78L37 36H50V25H68V19H82V38H88V54L25 78Z" fill={gold} />
    <path d="M25 78L41 37M25 78L54 26M25 78L69 22M25 78L81 28M25 78L83 41M25 78L85 53" stroke={jade} strokeWidth="3.2" />
    <path d="M33 89H61V80H75V68H89V54" stroke={light} strokeWidth="3" />
    <path d="M17 86V35H29V23H44V14H84" stroke={light} strokeWidth="1.8" />
    <path d="M21 75H31V85H21Z" fill={light} />
  </g>,
  hub: <g strokeLinejoin="miter">
    <path d="M17 3H31L45 17V31L31 45H17L3 31V17Z" fill={gold} />
    <path d="M18 6H30L42 18V30L30 42H18L6 30V18Z" fill={jade} />
    <path d="M10 24V18H17V12H21V8H27V12H31V18H38V24L24 37Z" fill={light} />
    <path d="M24 36L13 21M24 36L19 15M24 36V11M24 36L29 15M24 36L35 21" fill="none" stroke={jade} strokeWidth="1.8" />
    <path d="M19 36H29V39H19Z" fill={gold} />
  </g>,
  swatch: <>
    <path d="M18 3H46L61 18V46L46 61H18L3 46V18Z" fill={gold} />
    <path d="M19 6H45L58 19V45L45 58H19L6 45V19Z" fill={jade} />
    <path d="M14 32V23H22V16H28V9H36V16H42V23H50V32L32 49Z" fill={light} />
    <path d="M32 48L17 28M32 48L24 20M32 48V13M32 48L40 20M32 48L47 28" fill="none" stroke={jade} strokeWidth="2.5" />
    <path d="M24 49H40V53H24Z" fill={gold} />
    <path d="M10 38V44L20 54M54 38V44L44 54" fill="none" stroke={gold} strokeWidth="2" />
  </>,
} satisfies RouletteThemeArtwork;

export default deco;
