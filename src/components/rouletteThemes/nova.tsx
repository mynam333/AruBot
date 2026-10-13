import type { RouletteThemeArtwork } from './types';
import { point, ring } from './geometry';
import './nova.css';

const carbon = '#14191b';
const copper = '#d09a73';
const copperLight = '#f3d3b4';
const cyan = '#94edf0';

function arc(radius: number, start: number, end: number) {
  const a = point(radius, start);
  const b = point(radius, end);
  return `M${a.x} ${a.y}A${radius} ${radius} 0 ${end - start > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
}

const nova = {
  id: 'nova',
  designNotes: 'A carbon observatory azimuth instrument, not a star field: intersecting copper armillary tracks, four vernier saddles, engraved angular divisions and arctic-cyan alignment gates. The single optical-sight pointer, quadrant panel ornaments and reticle hub repeat the same mechanical vocabulary. Every rim mark is clipped to the 415-496 annulus with an antialiasing guard around the clear 414 aperture; no artwork changes spin geometry or layout.',
  palette: ['#202729', '#d09a73', '#94edf0', '#526c66', '#e6eded', '#805e4c'],
  tokens: {
    '--roulette-panel': '#1b2223',
    '--roulette-panel-strong': '#101516',
    '--roulette-backdrop': '#111718',
    '--roulette-line': '#7b8988',
    '--roulette-text': '#eef8f5',
    '--roulette-muted': '#bbc9c5',
    '--roulette-accent': copper,
    '--roulette-accent-2': cyan,
    '--roulette-result': '#f3d3b4',
    '--roulette-rim-inner': carbon,
    '--roulette-rim-line': copper,
    '--roulette-hub': carbon,
    '--roulette-hub-line': copper,
    '--roulette-hub-text': '#eef8f5',
    '--roulette-hub-muted': '#b7d2cf',
    '--roulette-pointer': copperLight,
    '--roulette-pointer-core': cyan,
    '--roulette-segment-line': '#8caaa4',
    '--roulette-segment-gloss': 'rgba(226,246,239,.04)',
    '--roulette-tick': cyan,
    '--roulette-track': '#263532',
  },
  rim: (idPrefix: string) => {
    const metal = `${idPrefix}-nova-copper`;
    const aperture = `${idPrefix}-nova-aperture`;
    return <>
      <defs>
        <linearGradient id={metal} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor={copperLight} />
          <stop offset=".25" stopColor="#ae7452" />
          <stop offset=".48" stopColor="#e6b58e" />
          <stop offset=".7" stopColor="#80583f" />
          <stop offset="1" stopColor="#f0c6a3" />
        </linearGradient>
        <clipPath id={aperture}>
          <path d={ring(496, 415)} clipRule="evenodd" />
        </clipPath>
      </defs>
      {/* The annular clip also contains stroke expansion on the mounting saddles. */}
      <g clipPath={`url(#${aperture})`} strokeLinejoin="round">
        <path d={ring(478, 414)} fill={carbon} fillRule="evenodd" />
        <path d={ring(476, 468)} fill={`url(#${metal})`} fillRule="evenodd" />
        <path d={ring(466, 449)} fill="#26332f" fillRule="evenodd" />
        <circle cx="500" cy="500" r="466" fill="none" stroke="#060e0d" strokeWidth="3" />
        <circle cx="500" cy="500" r="449" fill="none" stroke="#a57b60" strokeWidth="2" />
        {Array.from({ length: 96 }, (_, index) => {
          const major = index % 8 === 0;
          const a = point(major ? 451 : 457, index * 3.75);
          const b = point(464, index * 3.75);
          return <path key={index} d={`M${a.x} ${a.y}L${b.x} ${b.y}`} stroke={major ? copperLight : '#b0b9a4'} strokeWidth={major ? 3 : 1.5} />;
        })}
        {[-32, 32].map((angle) => <g key={angle} transform={`rotate(${angle} 500 500)`}>
          <ellipse cx="500" cy="500" rx="489" ry="433" fill="none" stroke="#0b1011" strokeWidth="10" />
          <ellipse cx="500" cy="500" rx="489" ry="433" fill="none" stroke={`url(#${metal})`} strokeWidth="5" />
          <ellipse cx="500" cy="500" rx="486" ry="430" fill="none" stroke="#ecd1b7" strokeWidth="1" />
        </g>)}
        <path d={ring(425, 414)} fill={`url(#${metal})`} fillRule="evenodd" />
        <path d={ring(420, 416)} fill="#0d1516" fillRule="evenodd" />
        {[0, 90, 180, 270].map((angle) => <g key={angle}>
          <path d={arc(437, angle + 12, angle + 37)} fill="none" stroke={cyan} strokeWidth="5" />
          <path d={arc(437, angle + 42, angle + 57)} fill="none" stroke="#69958c" strokeWidth="3" />
          <path d={arc(437, angle + 63, angle + 77)} fill="none" stroke={copper} strokeWidth="2" />
          <g transform={`rotate(${angle} 500 500)`}>
            <path d="M469 9H531L540 27V57L524 72H476L460 57V27Z" fill={`url(#${metal})`} stroke="#101719" strokeWidth="3" />
            <path d="M474 17H526L531 29V54L520 64H480L469 54V29Z" fill={carbon} />
            <path d="M479 26H521M480 52H520" fill="none" stroke={copper} strokeWidth="2" />
            <path d="M481 33V44M490 33V39M500 30V47M510 33V39M519 33V44" fill="none" stroke={copperLight} strokeWidth="2" />
            <path d="M495 54H505V78H495Z" fill={cyan} />
            <path d="M485 77H515" stroke={cyan} strokeWidth="4" />
            <circle cx="471" cy="48" r="3" fill={copperLight} />
            <circle cx="529" cy="48" r="3" fill={copperLight} />
          </g>
        </g>)}
        {[45, 135, 225, 315].map((angle) => <g key={angle} transform={`rotate(${angle} 500 500)`}>
          <path d="M492 23H508V45H492Z" fill={carbon} stroke={copper} strokeWidth="2" />
          <path d="M496 28H504V39H496Z" fill={copperLight} />
        </g>)}
      </g>
    </>;
  },
  pointer: (idPrefix: string) => {
    const metal = `${idPrefix}-nova-sight`;
    return <g strokeLinejoin="round">
      <defs>
        <linearGradient id={metal} x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#9a6548" />
          <stop offset=".45" stopColor={copperLight} />
          <stop offset=".65" stopColor={copper} />
          <stop offset="1" stopColor="#80523c" />
        </linearGradient>
      </defs>
      <path d="M69 90H111V112L90 190L69 112Z" fill={`url(#${metal})`} />
      <path d="M79 109H101L90 170Z" fill={carbon} />
      <path d="M88 109H92V146H88Z" fill={cyan} />
      <path d="M42 34H57V73H42ZM123 34H138V73H123Z" fill={`url(#${metal})`} stroke={carbon} strokeWidth="3" />
      <circle cx="90" cy="54" r="40" fill={`url(#${metal})`} stroke={carbon} strokeWidth="3" />
      <circle cx="90" cy="54" r="31" fill={carbon} stroke={copperLight} strokeWidth="2" />
      <circle cx="90" cy="54" r="21" fill="none" stroke={cyan} strokeWidth="3" strokeDasharray="25 8" transform="rotate(-90 90 54)" />
      <path d="M90 26V43M90 65V82M62 54H79M101 54H118" stroke={copperLight} strokeWidth="3" />
      <circle cx="90" cy="54" r="5" fill={cyan} />
      <path d="M46 42H51M46 50H51M46 58H51M46 66H51M129 42H134M129 50H134M129 58H134M129 66H134" stroke={carbon} strokeWidth="2" />
    </g>;
  },
  panel: <g fill="none" strokeLinecap="butt" strokeLinejoin="miter">
    <path d="M17 84A61 61 0 0 1 78 23" stroke={copper} strokeWidth="6" />
    <path d="M27 84A51 51 0 0 1 78 33" stroke="#63776f" strokeWidth="2" />
    <path d="M38 84A40 40 0 0 1 78 44" stroke={cyan} strokeWidth="3" />
    <path d="M18 70L25 72M23 53L30 57M33 39L39 45M47 29L51 37M63 24L65 32" stroke={copperLight} strokeWidth="3" />
    <path d="M20 85H81V22M31 77L76 32" stroke={copper} strokeWidth="3" />
    <circle cx="62" cy="62" r="12" fill={carbon} stroke={cyan} strokeWidth="2.5" />
    <path d="M62 44V56M62 68V80M44 62H56M68 62H80" stroke={copperLight} strokeWidth="2.5" />
    <circle cx="62" cy="62" r="3" fill={cyan} stroke="none" />
    <path d="M13 80H23V90H13ZM76 18H86V28H76Z" fill={copper} stroke="none" />
  </g>,
  hub: <g fill="none" strokeLinecap="butt">
    <circle cx="24" cy="24" r="18" stroke={copper} strokeWidth="2.5" />
    <ellipse cx="24" cy="24" rx="20" ry="10" transform="rotate(-38 24 24)" stroke={cyan} strokeWidth="2" />
    <path d="M24 3V14M24 34V45M3 24H14M34 24H45" stroke={copperLight} strokeWidth="2.5" />
    <circle cx="24" cy="24" r="5" fill={carbon} stroke={cyan} strokeWidth="2" />
  </g>,
  swatch: <g>
    <circle cx="32" cy="32" r="29" fill={carbon} stroke={copper} strokeWidth="2" />
    <circle cx="32" cy="32" r="24" fill="none" stroke="#a88368" strokeWidth="2" strokeDasharray="2 4" />
    <ellipse cx="32" cy="32" rx="29" ry="21" transform="rotate(-32 32 32)" fill="none" stroke={copperLight} strokeWidth="1.5" />
    <ellipse cx="32" cy="32" rx="29" ry="21" transform="rotate(32 32 32)" fill="none" stroke={copper} strokeWidth="1.5" />
    <circle cx="32" cy="32" r="16" fill="#263532" stroke={cyan} strokeWidth="2" />
    <path d="M32 12V26M32 38V52M12 32H26M38 32H52" stroke={cyan} strokeWidth="2" />
    <circle cx="32" cy="32" r="4" fill={copperLight} />
    <path d="M28 2H36V9H28ZM28 55H36V62H28ZM2 28H9V36H2ZM55 28H62V36H55Z" fill={copper} />
  </g>,
} satisfies RouletteThemeArtwork;

export default nova;
