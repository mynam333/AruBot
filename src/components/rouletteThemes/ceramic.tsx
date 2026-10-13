import type { RouletteThemeArtwork } from './types';
import { aperture, ring, scallop } from './geometry';

const cobalt = '#214d91';
const ink = '#173b74';
const wash = '#88a7ca';
const porcelain = '#fcfdfb';

const ceramic = {
  id: 'ceramic',
  designNotes: 'Scalloped white porcelain with twelve hand-painted cobalt floral sprays, a fine double foot-ring and quiet glaze highlights. Broad white reserves keep the china delicate at small sizes. A flower-topped porcelain pendant supplies one winning point; the same asymmetric sprig appears on the panel, hub and miniature plate. No animation, filters or legacy artwork required.',
  palette: ['#fcfdfb', '#214d91', '#dce5e9', '#7799bd', '#f1f5f3', '#173b74'],
  tokens: {
    '--roulette-backdrop': '#fcfdfb',
    '--roulette-panel': '#fcfdfb',
    '--roulette-panel-strong': '#f0f4f4',
    '--roulette-text': ink,
    '--roulette-muted': '#536c88',
    '--roulette-accent': cobalt,
    '--roulette-accent-2': '#7394b8',
    '--roulette-result': ink,
    '--roulette-line': '#91a9c3',
    '--roulette-shadow': 'rgba(42,62,76,.14)',
    '--roulette-rim-outer': '#fcfdfb',
    '--roulette-rim-inner': '#fcfdfb',
    '--roulette-rim-line': cobalt,
    '--roulette-hub': 'linear-gradient(135deg, #ffffff, #fcfdfb 64%, #e2e9e9)',
    '--roulette-hub-line': cobalt,
    '--roulette-hub-text': ink,
    '--roulette-hub-muted': '#536c88',
    '--roulette-label-dark': '#17365f',
    '--roulette-label-light': '#ffffff',
    '--roulette-segment-line': '#a3b7c9',
    '--roulette-segment-gloss': 'rgba(255,255,255,.10)',
    '--roulette-pointer': cobalt,
    '--roulette-pointer-core': porcelain,
    '--roulette-track': '#e6edee',
  },
  rim: (idPrefix: string) => {
    const glaze = `${idPrefix}-ceramic-glaze`;
    const clear = `${idPrefix}-ceramic-clear`;
    return <>
      <defs>
        <linearGradient id={glaze} x1="0" y1="0" x2=".8" y2="1">
          <stop stopColor="#ffffff" />
          <stop offset=".36" stopColor="#fbfcfa" />
          <stop offset=".72" stopColor="#e3eaea" />
          <stop offset="1" stopColor="#fafcfb" />
        </linearGradient>
        <clipPath id={clear}>
          <path d={ring(496, 414)} fillRule="evenodd" clipRule="evenodd" />
        </clipPath>
      </defs>
      {/* The annular clip also contains antialiased strokes and floral tips. */}
      <g clipPath={`url(#${clear})`} strokeLinecap="round" strokeLinejoin="round">
        <path d={aperture(scallop(482, 10, 24), 415)} fill={ink} fillRule="evenodd" />
        <path d={aperture(scallop(479, 10, 24), 415)} fill={`url(#${glaze})`} fillRule="evenodd" />
        <path d={scallop(477, 10, 24)} fill="none" stroke="#fff" strokeWidth="3" />
        <path d={scallop(471, 8, 24)} fill="none" stroke={wash} strokeWidth="1.8" />
        <path d={scallop(466, 6, 24)} fill="none" stroke={cobalt} strokeWidth="1.4" />
        {Array.from({ length: 24 }, (_, index) => <g key={index} transform={`rotate(${index * 15} 500 500)`}>
          <path d="M491 22Q500 14 509 22M495 26Q500 22 505 26" fill="none" stroke={cobalt} strokeWidth="2" />
          <path d="M488 29Q500 20 512 29" fill="none" stroke="#fff" strokeWidth="1.8" />
        </g>)}
        {Array.from({ length: 12 }, (_, index) => <g key={index} transform={`rotate(${15 + index * 30} 500 500)`}>
          <path d="M446 65C457 44 479 69 497 55C510 44 521 43 536 55C551 65 559 55 550 49C544 45 540 52 546 55M501 57C516 68 535 70 553 66" fill="none" stroke={cobalt} strokeWidth="2.5" />
          <path d="M473 62C460 62 457 50 462 42C474 44 480 52 473 62ZM519 58C521 43 531 40 541 44C537 55 529 60 519 58ZM485 61C477 68 467 72 460 68C464 60 473 58 485 61Z" fill={wash} />
          <path d="M472 59Q470 49 463 45M523 55Q530 48 537 46M479 63L465 67" fill="none" stroke={cobalt} strokeWidth="2" />
          <path d="M499 49C488 49 483 42 488 38C483 30 493 27 499 33C503 23 513 29 510 36C520 34 523 43 514 47C519 55 509 60 503 53C497 60 488 56 491 50Z" fill={porcelain} stroke={cobalt} strokeWidth="2.1" />
          <path d="M501 43Q490 32 491 40Q491 46 498 46M504 42Q510 31 506 34M508 46Q518 40 514 44M504 49Q511 55 510 50M499 49Q493 55 496 51" fill="none" stroke={wash} strokeWidth="2.6" />
          <path d="M499 43Q505 40 507 46Q506 50 501 49Q498 47 501 45" fill="none" stroke={ink} strokeWidth="2" />
          <path d="M449 64Q447 54 441 54Q438 61 449 64ZM552 65Q561 58 566 63Q561 70 552 65Z" fill={cobalt} />
          <path d="M482 73Q499 66 516 73" fill="none" stroke={wash} strokeWidth="1.4" />
        </g>)}
        <path d={ring(432, 415)} fill={porcelain} fillRule="evenodd" />
        <path d={ring(432, 429.5)} fill={cobalt} fillRule="evenodd" />
        <path d={ring(426, 424.5)} fill={wash} fillRule="evenodd" />
        <path d={ring(419, 415)} fill={cobalt} fillRule="evenodd" />
        <path d="M77 492A423 423 0 0 1 470 78M539 79A423 423 0 0 1 835 242" fill="none" stroke="#fff" strokeWidth="2.3" />
      </g>
    </>;
  },
  pointer: (idPrefix: string) => {
    const glaze = `${idPrefix}-ceramic-pendant`;
    return <>
      <defs>
        <linearGradient id={glaze} x1="0" y1="0" x2="1" y2=".7">
          <stop stopColor="#ffffff" />
          <stop offset=".55" stopColor={porcelain} />
          <stop offset="1" stopColor="#d9e3e6" />
        </linearGradient>
      </defs>
      <path d="M90 190C79 151 60 120 49 94C31 80 33 57 45 49C38 31 55 18 70 22C78 8 103 8 111 22C129 17 143 32 135 49C149 60 148 82 131 94C120 121 102 151 90 190Z" fill={ink} />
      <path d="M90 176C79 141 65 119 54 91C37 78 40 60 50 51C43 34 57 22 73 27C81 13 101 14 108 27C125 22 137 36 130 51C143 63 140 79 126 91C115 119 101 145 90 176Z" fill={`url(#${glaze})`} />
      <path d="M54 81C44 66 49 58 57 52C49 38 59 30 75 33C82 22 97 20 107 33" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <g fill="none" stroke={cobalt} strokeLinecap="round" strokeLinejoin="round">
        <path d="M67 97C86 86 99 69 94 46M80 87C64 88 57 78 62 69C76 68 82 77 80 87ZM92 72C92 59 106 54 115 61C111 73 101 78 92 72Z" strokeWidth="3.8" />
        <path d="M91 49C80 50 74 43 78 37C74 29 85 26 91 32C95 23 106 28 103 36C114 37 112 46 104 47C105 57 95 58 91 49Z" fill="#f9fbf9" strokeWidth="2.8" />
        <path d="M88 38Q99 34 101 43Q94 50 89 43M66 75L77 83M99 68L110 62" stroke={wash} strokeWidth="3" />
        <path d="M68 107Q90 116 112 107M74 119Q90 125 106 119" strokeWidth="2.2" />
      </g>
      <path d="M79 133Q90 137 101 133L90 177Z" fill={cobalt} />
      <path d="M84 136L90 160" fill="none" stroke="#becfe1" strokeWidth="2" />
    </>;
  },
  panel: <g strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 89V23Q13 11 25 11H77M20 86V25Q20 18 27 18H73" fill="none" stroke={cobalt} strokeWidth="2.5" />
    <path d="M29 86C53 77 61 57 56 33M46 71C25 72 26 53 33 48C49 50 54 60 46 71ZM56 58C54 41 70 35 80 44C77 56 66 64 56 58Z" fill="#dce7ee" stroke={cobalt} strokeWidth="3" />
    <path d="M55 38C43 41 36 33 42 27C39 18 49 15 56 22C60 12 72 17 68 25C79 26 77 36 69 37C70 46 60 47 55 38Z" fill={porcelain} stroke={cobalt} strokeWidth="2.8" />
    <path d="M52 27Q62 23 65 31Q61 39 54 33M34 54L44 65M62 54L74 46M42 78Q65 81 73 65" fill="none" stroke={wash} strokeWidth="3" />
    <path d="M72 70Q70 59 79 57Q85 66 72 70ZM33 81Q23 74 26 68Q37 68 33 81Z" fill={cobalt} />
  </g>,
  hub: <g strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 38Q30 30 28 12M20 30C8 32 8 22 12 18C22 19 26 24 20 30ZM27 23C27 14 36 12 41 17C38 24 32 27 27 23Z" fill="#dce7ee" stroke={cobalt} strokeWidth="1.8" />
    <path d="M26 15C19 17 15 12 19 9C17 4 23 3 27 7C31 2 36 6 34 10C39 13 35 18 31 16C29 21 24 20 26 15Z" fill={porcelain} stroke={cobalt} strokeWidth="1.6" />
    <path d="M23 10Q29 7 31 12L28 15M13 22L20 27M30 21L36 18M16 38Q30 40 36 32" fill="none" stroke={wash} strokeWidth="1.8" />
  </g>,
  swatch: <g strokeLinecap="round" strokeLinejoin="round">
    <path d="M32 2Q37 1 40 6Q46 3 49 10Q57 9 57 17Q65 21 61 28Q65 35 60 40Q61 48 53 50Q51 59 43 58Q38 65 32 61Q25 65 20 58Q12 59 10 51Q2 49 4 41Q-1 35 3 29Q-1 21 7 17Q7 9 15 10Q18 3 25 6Q27 1 32 2Z" fill={porcelain} stroke={cobalt} strokeWidth="1.4" />
    <circle cx="32" cy="32" r="24" fill="none" stroke={wash} strokeWidth="1" />
    <circle cx="32" cy="32" r="21" fill="none" stroke={cobalt} strokeWidth="1.2" />
    <path d="M19 46Q38 36 34 21M27 38C15 39 16 27 20 25C30 26 32 33 27 38ZM35 31C36 22 45 22 49 27C47 34 40 36 35 31Z" fill="#dce7ee" stroke={cobalt} strokeWidth="1.8" />
    <path d="M33 23C26 25 22 19 26 16C25 11 31 10 34 14C38 10 44 13 41 17C47 21 43 26 39 24C37 29 32 29 33 23Z" fill={porcelain} stroke={cobalt} strokeWidth="1.7" />
    <path d="M30 18Q37 15 38 21Q34 25 31 21M21 30L26 35M40 30L45 27M25 47Q38 48 43 39" fill="none" stroke={wash} strokeWidth="1.7" />
  </g>,
} satisfies RouletteThemeArtwork;

export default ceramic;
