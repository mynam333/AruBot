import type { RouletteThemeArtwork } from './types';
import { aperture, point, polygon, ring } from './geometry';
import './prism.css';

const sapphire = '#2453e6';
const coral = '#f47768';
const citron = '#eee36b';
const teal = '#20b7a3';
const ink = '#17336c';
const paper = '#f8fcff';

const folds = [
  { face: sapphire, light: '#92b7ff', shade: '#173cae', edge: '#dfeaff' },
  { face: coral, light: '#ffd2bc', shade: '#c54c4f', edge: '#fff0e7' },
  { face: citron, light: '#fff5ae', shade: '#b2a63c', edge: '#fffde1' },
  { face: teal, light: '#a5f0df', shade: '#087f80', edge: '#e4fff7' },
];

function face(...vertices: ReturnType<typeof point>[]) {
  return vertices.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(' ') + 'Z';
}

// The clip also removes the chords of the inner facets from the clear aperture.
const outline = aperture(`M${polygon(12, 494, -15)}Z`, 415);
const pleats = Array.from({ length: 12 }, (_, index) => {
  const start = index * 30 - 15;
  return {
    color: folds[Math.floor(index / 3)],
    a: point(491, start),
    b: point(491, start + 30),
    c: point(425, start + 30),
    d: point(425, start),
    ridge: point(459, start + 11),
    lipA: point(479, start + 1.2),
    lipB: point(479, start + 28.8),
    seamA: point(450, start + 2),
    seamB: point(430, start + 2),
  };
});

const prism: RouletteThemeArtwork = {
  id: 'prism',
  designNotes: 'Folded optical spectrum: twelve interlocking origami pleats grouped into sapphire, coral, citron and teal quadrants. Broad colored faces, pale cut edges and offset fold ridges replace the repeated rainbow triangles. A circular white aperture lip, asymmetric folded-paper pointer and matching open-fold emblems unify the light title and result strips. All rim paint is clipped outside radius 415 and inside radius 494; the sole winning tip is (90,190).',
  palette: [sapphire, coral, citron, '#eaf4ff', teal, '#ffd4c9'],
  tokens: {
    '--roulette-backdrop': '#f0f6fc',
    '--roulette-panel': '#fbfdff',
    '--roulette-panel-strong': '#f1f6ff',
    '--roulette-panel-finish': 'none',
    '--roulette-text': '#182d5b',
    '--roulette-muted': '#465d82',
    '--roulette-line': '#9cafdd',
    '--roulette-accent': sapphire,
    '--roulette-accent-2': '#b63f39',
    '--roulette-result': '#2045ba',
    '--roulette-hub': '#fbfdff',
    '--roulette-hub-line': sapphire,
    '--roulette-hub-text': '#2045ba',
    '--roulette-hub-muted': '#465d82',
    '--roulette-label-dark': '#142544',
    '--roulette-label-light': '#ffffff',
    '--roulette-segment-line': '#ffffff',
    '--roulette-segment-gloss': 'rgba(255,255,255,.06)',
    '--roulette-track': '#ffffff',
    '--roulette-shadow': 'rgba(24,45,91,.16)',
    '--roulette-atmosphere-opacity': '.36',
  },
  rim: (idPrefix) => <>
    <defs>
      <clipPath id={`${idPrefix}-prism-aperture`}>
        <path d={outline} fillRule="evenodd" clipRule="evenodd" />
      </clipPath>
    </defs>
    <g clipPath={`url(#${idPrefix}-prism-aperture)`} strokeLinejoin="round">
      <path d={outline} fill={ink} fillRule="evenodd" />
      {pleats.map(({ color, a, b, c, d, ridge, lipA, lipB, seamA, seamB }, index) => <g key={index}>
        <path d={face(a, b, c, d)} fill={color.face} />
        <path d={face(a, b, ridge)} fill={color.light} />
        <path d={face(b, c, ridge)} fill={color.shade} />
        <path d={face(c, d, ridge)} fill={color.face} />
        <path d={face(d, a, ridge)} fill={color.edge} />
        <path d={face(a, b, lipB, lipA)} fill={paper} fillOpacity=".84" />
        <path d={face(lipA, lipB, ridge)} fill={color.face} fillOpacity=".22" />
        <path d={`M${a.x} ${a.y}L${ridge.x} ${ridge.y}L${c.x} ${c.y}`} fill="none" stroke={paper} strokeWidth="2.4" />
        <path d={`M${b.x} ${b.y}L${ridge.x} ${ridge.y}L${d.x} ${d.y}`} fill="none" stroke={color.shade} strokeWidth="1.8" />
        <path d={`M${seamA.x} ${seamA.y}L${seamB.x} ${seamB.y}`} stroke={color.shade} strokeWidth="2.4" />
      </g>)}
      <path d={ring(428, 415)} fill={paper} fillRule="evenodd" />
      <circle cx="500" cy="500" r="427" fill="none" stroke={ink} strokeWidth="2" />
      <circle cx="500" cy="500" r="417" fill="none" stroke="#b3c6e4" strokeWidth="3" />
      <path d={`M${polygon(12, 492, -15)}Z`} fill="none" stroke={ink} strokeWidth="3" />
      <path d={`M${polygon(12, 487, -15)}Z`} fill="none" stroke={paper} strokeOpacity=".72" strokeWidth="1.8" />
    </g>
  </>,
  pointer: (idPrefix) => <>
    <defs>
      <linearGradient id={`${idPrefix}-prism-pointer-fold`} x1="48" y1="32" x2="112" y2="162" gradientUnits="userSpaceOnUse">
        <stop stopColor="#ffffff" />
        <stop offset="1" stopColor="#c8dcff" />
      </linearGradient>
    </defs>
    <path d="M35 42 63 12H111L146 54 135 91 90 190 45 86Z" fill={ink} />
    <path d="M39 43 65 16H109L141 55 131 89 90 181 49 84Z" fill={paper} />
    <path d="M39 43 65 16 88 68 49 84Z" fill={coral} />
    <path d="M65 16H109L88 68Z" fill={citron} />
    <path d="M109 16 141 55 88 68Z" fill="#fff7b3" />
    <path d="M141 55 131 89 90 181 88 68Z" fill={teal} />
    <path d="M49 84 88 68 90 181Z" fill={sapphire} />
    <path d="M39 43 88 68 90 173 73 92Z" fill={`url(#${idPrefix}-prism-pointer-fold)`} />
    <path d="M88 68 141 55 115 79 90 173Z" fill="#b6f4e6" />
    <path d="M88 68 115 79 90 190Z" fill={sapphire} />
    <path d="M45 43 86 63 107 21M93 69 131 59" fill="none" stroke="#ffffff" strokeWidth="2.5" />
    <path d="M65 21 84 61M51 80 72 90M119 78 132 66" fill="none" stroke={ink} strokeOpacity=".48" strokeWidth="1.5" />
  </>,
  panel: <g stroke="none">
    <path d="M10 27 47 9 85 31 76 69 39 91 15 69Z" fill={ink} />
    <path d="M13 28 47 12 56 43 18 66Z" fill={sapphire} />
    <path d="M47 12 81 32 56 43Z" fill={citron} />
    <path d="M81 32 73 67 56 43Z" fill={teal} />
    <path d="M18 66 56 43 39 87Z" fill={coral} />
    <path d="M56 43 73 67 39 87Z" fill="#afe9df" />
    <path d="M13 28 56 43 33 47 18 66Z" fill="#eaf4ff" />
    <path d="M47 12 56 43 61 29Z" fill="#fffad1" />
    <path d="M33 47 56 43 39 87Z" fill="#ffffff" />
    <path d="M18 29 43 17M60 45 76 36M42 79 66 66" fill="none" stroke="#ffffff" strokeWidth="2" />
    <path d="M18 75 36 90M53 8 79 23" fill="none" stroke="#9cafdd" strokeWidth="2" />
  </g>,
  hub: <g stroke="none">
    <path d="M5 15 23 5 43 17 37 35 19 44 7 33Z" fill={ink} />
    <path d="M7 16 23 7 27 23 9 32Z" fill={sapphire} />
    <path d="M23 7 40 18 27 23Z" fill={citron} />
    <path d="M40 18 35 34 27 23Z" fill={teal} />
    <path d="M9 32 27 23 19 41Z" fill={coral} />
    <path d="M27 23 35 34 19 41Z" fill="#abecdd" />
    <path d="M7 16 27 23 16 25 9 32Z M16 25 27 23 19 41Z" fill={paper} />
  </g>,
  swatch: <g stroke="none">
    <path d="M15 3H49L61 15V49L49 61H15L3 49V15Z" fill={ink} />
    <path d="M16 5H48L57 15 43 19 20 15 7 19Z" fill={sapphire} />
    <path d="M48 5 59 16V48L48 57 45 43 49 20 43 19Z" fill={coral} />
    <path d="M59 48 48 59H16L7 48 21 45 44 49 45 43Z" fill={citron} />
    <path d="M16 59 5 48V16L16 7 20 21 15 44 21 45Z" fill={teal} />
    <path d="M16 5H48L43 10H20Z M59 16V48L54 43V20Z M48 59H16L21 54H44Z M5 48V16L10 21V44Z" fill="#ffffff" fillOpacity=".58" />
    <path d="M20 17H44L47 21V44L43 47H20L17 43V20Z" fill={paper} />
    <path d="M22 26 32 20 43 27 38 39 28 44 23 36Z" fill={sapphire} />
    <path d="M32 20 43 27 33 30Z" fill={citron} />
    <path d="M43 27 38 39 33 30Z" fill={teal} />
    <path d="M23 36 33 30 28 44Z" fill={coral} />
    <path d="M22 26 33 30 28 44 28 33Z" fill="#ffffff" />
  </g>,
};

export default prism;
