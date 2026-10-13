import type { RouletteThemeArtwork } from './types';
import { point, ring } from './geometry';
import './studio.css';

const studio = {
  id: 'studio',
  designNotes: 'A pearl-white broadcast instrument with a recessed graphite calibration dial, machined shoulders, captive fasteners, paired cooling slots and a red tally lens. The pointer is a ceramic-clad index blade with one precise tip; the panels and hub repeat the inset hardware rather than ornamental linework. The wheel aperture stays completely clear below radius 414.',
  palette: ['#fafbfa', '#262b2e', '#d5dddc', '#d33731', '#98aaa8', '#f0f2ee'],
  tokens: {
    '--roulette-panel': '#fafbfa',
    '--roulette-panel-strong': '#f0f3f1',
    '--roulette-line': '#a4afad',
    '--roulette-text': '#22292b',
    '--roulette-muted': '#505d5c',
    '--roulette-result': '#bb2824',
    '--roulette-accent-2': '#cf342e',
    '--roulette-hub': 'linear-gradient(145deg, #ffffff 12%, #edf1ef 62%, #c4cecb)',
    '--roulette-hub-line': '#7d8987',
    '--roulette-track': '#e8eeeb',
  },
  rim: (idPrefix: string) => <>
    <defs>
      <linearGradient id={`${idPrefix}-studio-pearl`} x1="0" y1="0" x2=".8" y2="1">
        <stop stopColor="#ffffff" />
        <stop offset=".32" stopColor="#f1f5f2" />
        <stop offset=".63" stopColor="#dce3df" />
        <stop offset=".82" stopColor="#f8faf8" />
        <stop offset="1" stopColor="#a6b1ad" />
      </linearGradient>
      <linearGradient id={`${idPrefix}-studio-metal`} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#7f8b87" />
        <stop offset=".21" stopColor="#f9fcfa" />
        <stop offset=".47" stopColor="#aebbb5" />
        <stop offset=".68" stopColor="#ffffff" />
        <stop offset="1" stopColor="#697772" />
      </linearGradient>
      <linearGradient id={`${idPrefix}-studio-dial`} x1="0" y1="0" x2=".4" y2="1">
        <stop stopColor="#111719" />
        <stop offset=".52" stopColor="#30383a" />
        <stop offset="1" stopColor="#1c2325" />
      </linearGradient>
      <linearGradient id={`${idPrefix}-studio-tally`} x1="0" y1="0" x2="0" y2="1">
        <stop stopColor="#fa7970" />
        <stop offset=".42" stopColor="#e9473e" />
        <stop offset="1" stopColor="#a71d1a" />
      </linearGradient>
      <clipPath id={`${idPrefix}-studio-aperture`}>
        <path d={ring(496, 414)} clipRule="evenodd" />
      </clipPath>
    </defs>
    <g clipPath={`url(#${idPrefix}-studio-aperture)`}>
      <path d={ring(495, 414)} fill="#687570" fillRule="evenodd" />
      <path d={ring(493, 415)} fill={`url(#${idPrefix}-studio-metal)`} fillRule="evenodd" />
      <path d={ring(487, 451)} fill={`url(#${idPrefix}-studio-pearl)`} fillRule="evenodd" />
      <circle cx="500" cy="500" r="486" fill="none" stroke="#ffffff" strokeWidth="2" />
      <circle cx="500" cy="500" r="457" fill="none" stroke="#b1bcb7" strokeWidth="3" />
      <path d={ring(453, 419)} fill={`url(#${idPrefix}-studio-dial)`} fillRule="evenodd" />
      <circle cx="500" cy="500" r="451" fill="none" stroke="#080e10" strokeWidth="3" />
      <circle cx="500" cy="500" r="422" fill="none" stroke="#67726e" strokeWidth="2" />
      <path d={ring(420, 414)} fill={`url(#${idPrefix}-studio-metal)`} fillRule="evenodd" />
      <circle cx="500" cy="500" r="415" fill="none" stroke="#e8efea" strokeWidth="2" />

      <g strokeLinecap="butt">
        {Array.from({ length: 96 }, (_, index) => {
          const angle = index * 3.75;
          if (angle < 8 || angle > 352) return null;
          const major = index % 8 === 0;
          const middle = index % 4 === 0;
          const outer = point(446, angle);
          const inner = point(major ? 427 : middle ? 433 : 439, angle);
          return <path key={index} d={`M${outer.x} ${outer.y}L${inner.x} ${inner.y}`} stroke={major ? '#ffffff' : '#a6b3ad'} strokeWidth={major ? 4 : 2} />;
        })}
      </g>

      {[45, 135, 225, 315].map(angle => <g key={angle} transform={`rotate(${angle} 500 500)`}>
        <circle cx="500" cy="29" r="11" fill="#aab6b0" />
        <circle cx="500" cy="28" r="8.5" fill={`url(#${idPrefix}-studio-metal)`} stroke="#f7faf7" strokeWidth="1.5" />
        <path d="M495 28H505" stroke="#525e59" strokeWidth="2.5" strokeLinecap="round" />
      </g>)}

      {[76, 104, 256, 284].map(angle => <g key={angle} transform={`rotate(${angle} 500 500)`}>
        <rect x="470" y="23" width="60" height="17" rx="5" fill="#c1cbc5" stroke="#ffffff" strokeWidth="1.5" />
        <path d="M479 28V35M489 28V35M499 28V35M509 28V35M519 28V35" stroke="#586761" strokeWidth="3" strokeLinecap="round" />
      </g>)}

      {[22.5, 157.5, 202.5, 337.5].map(angle => <g key={angle} transform={`rotate(${angle} 500 500)`}>
        <path d="M500 15V43" stroke="#a6b3ac" strokeWidth="2" />
        <path d="M503 16V42" stroke="#ffffff" strokeWidth="1.5" />
      </g>)}

      <rect x="471" y="19" width="58" height="23" rx="6" fill="#9faea6" />
      <rect x="475" y="21" width="50" height="17" rx="4" fill="#182321" />
      <rect x="480" y="24" width="40" height="10" rx="2" fill={`url(#${idPrefix}-studio-tally)`} />
      <path d="M483 26H517" stroke="#ffaba1" strokeWidth="1.5" />
      <path d="M497 54H503V74H497Z" fill="#f05449" />
      <g transform="rotate(180 500 500)">
        <rect x="469" y="24" width="62" height="13" rx="6.5" fill="#b1bdb6" />
        <rect x="473" y="26" width="54" height="8" rx="4" fill="#f9fcf9" />
        <path d="M488 28V32M500 28V32M512 28V32" stroke="#6c7c72" strokeWidth="2" />
      </g>
    </g>
  </>,
  pointer: (idPrefix: string) => <>
    <defs>
      <linearGradient id={`${idPrefix}-studio-pointer-shell`} x1="0" y1="0" x2="1" y2=".6">
        <stop stopColor="#ffffff" />
        <stop offset=".48" stopColor="#f3f6f3" />
        <stop offset=".76" stopColor="#ccd6cf" />
        <stop offset="1" stopColor="#8b9a90" />
      </linearGradient>
      <linearGradient id={`${idPrefix}-studio-pointer-red`} x1="0" y1="0" x2="1" y2="0">
        <stop stopColor="#ff7b6c" />
        <stop offset=".45" stopColor="#ed4d40" />
        <stop offset="1" stopColor="#ad231e" />
      </linearGradient>
    </defs>
    <path d="M62 9H118Q134 9 134 25V70Q134 80 128 93L90 190 52 93Q46 80 46 70V25Q46 9 62 9Z" fill="#35413c" />
    <path d="M63 12H117Q131 12 131 26V69Q131 78 125 91L90 190 55 91Q49 78 49 69V26Q49 12 63 12Z" fill={`url(#${idPrefix}-studio-pointer-shell)`} />
    <path d="M57 66V27Q57 20 65 20H116" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
    <rect x="62" y="27" width="56" height="39" rx="7" fill="#afbeb4" />
    <rect x="65" y="29" width="50" height="33" rx="5" fill="#202a26" />
    <rect x="71" y="36" width="38" height="14" rx="3" fill={`url(#${idPrefix}-studio-pointer-red)`} />
    <path d="M75 39H105" stroke="#ffa795" strokeWidth="2" strokeLinecap="round" />
    <path d="M78 56H102" stroke="#63766a" strokeWidth="2" strokeLinecap="round" />
    <circle cx="62" cy="79" r="4" fill="#899a8e" />
    <circle cx="118" cy="79" r="4" fill="#899a8e" />
    <path d="M60 79H64M116 79H120" stroke="#f9fcf8" strokeWidth="1.5" />
    <path d="M71 76H109L90 190Z" fill="#29372f" />
    <path d="M77 81H103L90 190Z" fill={`url(#${idPrefix}-studio-pointer-red)`} />
    <path d="M79 84 90 174" stroke="#ffb49e" strokeWidth="1.5" />
  </>,
  panel: <g fill="none" strokeLinejoin="round">
    <path d="M15 17H76Q84 17 84 25V75Q84 83 76 83H15Z" fill="#e0e7e2" stroke="#a5b3ab" strokeWidth="2" />
    <path d="M19 21H75Q80 21 80 27V72" stroke="#ffffff" strokeWidth="2" />
    <path d="M15 17H23V83H15Z" fill="#b1beb5" stroke="none" />
    <path d="M18 29H21M18 39H21M18 49H21M18 59H21M18 69H21" stroke="#54665a" strokeWidth="2" />
    <rect x="33" y="28" width="40" height="16" rx="3" fill="#28372d" stroke="none" />
    <rect x="38" y="32" width="30" height="7" rx="1.5" fill="#da3c30" stroke="none" />
    <path d="M40 33H65" stroke="#ffac97" strokeWidth="1.5" />
    <path d="M34 58H73" stroke="#94a59a" strokeWidth="5" strokeLinecap="round" />
    <path d="M35 57H71" stroke="#35473b" strokeWidth="2" strokeLinecap="round" />
    <rect x="47" y="51" width="12" height="13" rx="2" fill="#f9fcf8" stroke="#718578" strokeWidth="1.5" />
    <path d="M51 54H55M37 72H43M49 72H55M61 72H67" stroke="#718578" strokeWidth="2" />
  </g>,
  hub: <g fill="none">
    <circle cx="24" cy="24" r="21" fill="#d8e1da" stroke="#84968a" strokeWidth="1.5" />
    <circle cx="24" cy="24" r="17" fill="#28362d" stroke="#fcfff9" strokeWidth="2" />
    <path d="M13 29V19M17 16H31M35 19V29" stroke="#7c9282" strokeWidth="2" strokeLinecap="round" />
    <rect x="17" y="20" width="14" height="9" rx="2" fill="#e74b3b" />
    <path d="M20 22H28" stroke="#ffb29c" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M21 34H27" stroke="#dae7db" strokeWidth="2" strokeLinecap="round" />
  </g>,
  swatch: <>
    <rect x="2" y="2" width="60" height="60" rx="7" fill="#edf2ec" />
    <circle cx="32" cy="33" r="27" fill="#aab9ad" />
    <circle cx="32" cy="32" r="26" fill="#fbfdf8" />
    <circle cx="32" cy="32" r="22" fill="#28342d" />
    <circle cx="32" cy="32" r="17" fill="#d5ded4" />
    <path d="M32 32V15A17 17 0 0 1 47 40Z" fill="#e34a39" />
    <path d="M32 32 47 40A17 17 0 0 1 18 42Z" fill="#f9fcf5" />
    <path d="M32 32 18 42A17 17 0 0 1 17 24Z" fill="#8ea28f" />
    <circle cx="32" cy="32" r="5" fill="#f9fcf5" stroke="#6e8171" />
    <path d="M11 32H14M50 32H53M32 50V53M17 17 19 19M45 45 47 47M17 47 19 45M45 19 47 17" stroke="#e3ede1" strokeWidth="1.5" />
    <path d="M28 5H36V13L32 22 28 13Z" fill="#e64434" stroke="#f9fcf5" strokeWidth="1.5" />
  </>,
} satisfies RouletteThemeArtwork;

export default studio;
