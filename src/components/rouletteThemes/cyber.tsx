import type { RouletteThemeArtwork } from './types';
import { aperture, point, ring } from './geometry';

const carbon = '#080d12';
const board = '#12282d';
const cyan = '#30e6ed';
const magenta = '#ff49bc';
const lime = '#d4ff43';
const white = '#e9fff6';
const circuits = [cyan, cyan, magenta, magenta, lime, lime, cyan, cyan];

// Radial step cuts keep the chassis angular without approaching the label aperture.
const outline = Array.from({ length: 8 }, (_, index) => [
  [-22.5, 472], [-17, 493], [-6, 493], [-6, 482],
  [6, 482], [6, 493], [17, 493],
].map(([offset, radius]) => point(radius, index * 45 + offset)))
  .flat().map((p, index) => `${index ? 'L' : 'M'}${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(' ') + 'Z';

function trace(vertices: [number, number][]) {
  return vertices.map(([radius, angle], index) => {
    const p = point(radius, angle);
    return `${index ? 'L' : 'M'}${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
  }).join(' ');
}

const scaleMarks = Array.from({ length: 80 }, (_, index) => {
  const angle = index * 4.5;
  return trace([[index % 5 === 0 ? 420 : 425, angle], [432, angle]]);
}).join(' ');

const cyber = {
  id: 'cyber',
  designNotes: 'Neon circuit instrument: a carbon-black stepped chassis with eight chamfered service ports, hard cyan and magenta bus traces, acid-lime contact pads and a calibrated inner rail. Large planar cuts and split edge lights remain readable at 280px. A single probe blade, side-mounted circuit chip and asymmetric processor hub repeat the hardware language without pixel motifs, blur or ornamental motion.',
  palette: [carbon, cyan, magenta, lime, '#22575c', white],
  tokens: {
    '--roulette-backdrop': carbon,
    '--roulette-stage-ambient': 'none',
    '--roulette-panel': carbon,
    '--roulette-panel-strong': '#0c191e',
    '--roulette-panel-finish': 'none',
    '--roulette-text': white,
    '--roulette-muted': '#a4c8cb',
    '--roulette-line': '#326d73',
    '--roulette-accent': cyan,
    '--roulette-accent-2': magenta,
    '--roulette-result': lime,
    '--roulette-hub': carbon,
    '--roulette-hub-line': cyan,
    '--roulette-hub-text': lime,
    '--roulette-hub-muted': '#a4c8cb',
    '--roulette-label-light': white,
    '--roulette-label-dark': carbon,
    '--roulette-pointer': cyan,
    '--roulette-pointer-core': lime,
    '--roulette-rim-inner': carbon,
    '--roulette-rim-line': cyan,
    '--roulette-segment-line': carbon,
    '--roulette-segment-gloss': 'transparent',
    '--roulette-tick': cyan,
    '--roulette-track': board,
    '--roulette-shadow': 'rgba(0,0,0,.3)',
  },
  rim: (idPrefix) => <>
    <defs>
      <clipPath id={`${idPrefix}-cyber-clearance`}>
        <path d={ring(496, 414)} fillRule="evenodd" clipRule="evenodd" />
      </clipPath>
    </defs>
    <g clipPath={`url(#${idPrefix}-cyber-clearance)`} strokeLinejoin="bevel" strokeLinecap="butt" stroke="none">
      <path d={aperture(outline, 414)} fill={carbon} fillRule="evenodd" />
      <path d={outline} fill="none" stroke="#38727b" strokeWidth="2" />
      <path d={ring(442, 414)} fill={board} fillRule="evenodd" />
      <path d={ring(434, 417)} fill={carbon} fillRule="evenodd" />
      <path d={ring(418, 414)} fill={cyan} fillRule="evenodd" />
      <path d={scaleMarks} fill="none" stroke="#81b1b7" strokeWidth="2" />
      {circuits.map((color, index) => {
        const angle = index * 45;
        const bus = trace([[475, angle + 9], [475, angle + 15], [458, angle + 18], [458, angle + 31], [468, angle + 34]]);
        const returnBus = trace([[466, angle + 9], [466, angle + 14], [449, angle + 17], [449, angle + 29], [441, angle + 32]]);
        return <g key={angle}>
          <path d={bus} fill="none" stroke={color} strokeWidth="5" />
          <path d={returnBus} fill="none" stroke={color} strokeWidth="2" opacity=".75" />
          <path d={trace([[488, angle + 8], [488, angle + 16], [468, angle + 21]])} fill="none" stroke={color} strokeWidth="3" />
          <g transform={`rotate(${angle} 500 500)`}>
            <path d="M469 26H483V19H517V26H531V52L518 65H482L469 52Z" fill="#1b363d" stroke="#427580" strokeWidth="2" />
            <path d="M477 31H523V47L514 56H486L477 47Z" fill={carbon} />
            <path d="M480 32H503V37H480Z" fill={color} />
            <path d="M508 32H520V37H508Z" fill={white} />
            <path d="M485 46H492V51H485Z M497 46H504V51H497Z M509 46H516V51H509Z" fill={lime} />
            <path d="M487 65V73H495V79M513 65V73H505V79" fill="none" stroke={color} strokeWidth="3" />
            <path d="M493 77H497V83H493Z M503 77H507V83H503Z" fill={color} />
            <path d="M454 39L459 34M541 34L546 39" stroke={white} strokeWidth="3" />
          </g>
          <g transform={`rotate(${angle + 34} 500 500)`}>
            <path d="M495 27H505V37H495Z" fill={carbon} stroke={color} strokeWidth="2" />
            <path d="M498 30H502V34H498Z" fill={lime} />
          </g>
        </g>;
      })}
    </g>
  </>,
  pointer: (idPrefix) => <g id={`${idPrefix}-cyber-probe`} stroke="none" strokeLinejoin="bevel">
    <path d="M48 10H132L150 28V73L117 112L90 190L63 112L30 73V28Z" fill={carbon} />
    <path d="M49 15H131L145 30V71L113 109L90 183L67 109L35 71V30Z" fill={cyan} />
    <path d="M53 23H127L137 33V68L106 105L90 158L74 105L43 68V33Z" fill={board} />
    <path d="M91 23H127L137 33V47H125V36H91Z" fill={magenta} />
    <path d="M54 36H112L124 48V70L110 84H70L54 68Z" fill={carbon} />
    <path d="M65 46H107L114 53V64L105 73H77L65 61Z" fill={lime} />
    <path d="M77 54H103V59H89V68H82V59H77Z" fill={carbon} />
    <path d="M83 84H97L94 122L90 165L86 122Z" fill={lime} />
    <path d="M43 42H48V65L64 83M132 54V66L116 83" fill="none" stroke={white} strokeWidth="3" />
    <path d="M64 15H80V20H64Z M101 15H117V20H101Z" fill={white} />
  </g>,
  panel: <g stroke="none" strokeLinecap="butt" strokeLinejoin="bevel">
    <path d="M7 15H33L46 28V40H68L79 29H93M7 85H33L46 72V60H68L79 71H93" fill="none" stroke={cyan} strokeWidth="4" />
    <path d="M8 25H27L36 34V66L27 75H8" fill="none" stroke="#38727b" strokeWidth="3" />
    <path d="M11 38H29L39 48V60H20L11 51Z" fill={board} stroke={cyan} strokeWidth="3" />
    <path d="M19 44H27L32 49V54H24L19 49Z" fill={lime} />
    <path d="M45 50H91" stroke={magenta} strokeWidth="4" />
    <path d="M80 44H92V56H80Z" fill={carbon} stroke={magenta} strokeWidth="3" />
    <path d="M8 12H16V18H8Z M8 82H16V88H8Z M87 26H95V32H87Z M87 68H95V74H87Z" fill={lime} />
  </g>,
  hub: <g stroke="none" strokeLinecap="butt" strokeLinejoin="bevel">
    <path d="M15 10H32L39 17V32L32 39H15L9 33V16Z" fill={carbon} stroke={cyan} strokeWidth="2" />
    <path d="M18 16H29L33 20V29L29 33H18L15 29V20Z" fill={board} />
    <path d="M19 20H29V24H24V30H19Z" fill={lime} />
    <path d="M18 10V4H8M28 10V3M9 21H3M9 29H2M18 39V45M28 39V45H39" fill="none" stroke={cyan} strokeWidth="2.5" />
    <path d="M39 20H45V9M39 29H46M34 35L42 43" fill="none" stroke={magenta} strokeWidth="2.5" />
    <path d="M4 2H10V7H4Z M42 5H47V11H42Z M38 42H44V47H38Z" fill={lime} />
  </g>,
  swatch: <g stroke="none" strokeLinejoin="bevel">
    <path d="M0 0H64V64H0Z" fill={carbon} />
    <path d="M19 3H45L61 19V45L45 61H19L3 45V19Z" fill={board} stroke={cyan} strokeWidth="2" />
    <path d="M32 12A20 20 0 0 1 52 32H32Z" fill={cyan} />
    <path d="M52 32A20 20 0 0 1 22 49L32 32Z" fill={magenta} />
    <path d="M22 49A20 20 0 0 1 15 22L32 32Z" fill={lime} />
    <path d="M15 22A20 20 0 0 1 32 12V32Z" fill={carbon} />
    <path d="M26 25H37L40 28V37L36 40H27L24 37V28Z" fill={carbon} stroke={cyan} strokeWidth="1.5" />
    <path d="M29 30H35V33H32V36H29Z" fill={lime} />
    <path d="M23 4H41V8L32 19L23 8Z" fill={carbon} />
    <path d="M29 5H35V9L32 15L29 9Z" fill={lime} />
    <path d="M7 26V19L17 9M57 37V45L47 55" fill="none" stroke={magenta} strokeWidth="2" />
    <path d="M8 41V45L20 57H27M40 7H44L54 17" fill="none" stroke={lime} strokeWidth="2" />
  </g>,
} satisfies RouletteThemeArtwork;

export default cyber;
