import type { RouletteThemeArtwork } from './types';
import { aperture, point, polygon, ring } from './geometry';
import './crystal.css';

const ice = '#f6fcff';
const silver = '#9bb4c3';
const deep = '#526f82';
const mist = '#d4e5eb';
const dispersion = ['#a4e7e1', '#b9c4ed', '#e5becf', '#e5dda9'];

function face(...vertices: ReturnType<typeof point>[]) {
  return vertices.map((p, index) => `${index ? 'L' : 'M'}${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(' ') + 'Z';
}

const silhouette = aperture(`M${polygon(16, 494, 11.25)}Z`, 416);
const cuts = Array.from({ length: 16 }, (_, index) => {
  const angle = index * 22.5 + 11.25;
  const lit = Math.cos((angle + 45) * Math.PI / 180);
  return {
    a: point(494, angle), b: point(494, angle + 22.5),
    c: point(470, angle + 22.5), d: point(470, angle),
    e: point(424, angle), f: point(424, angle + 22.5),
    ridge: point(454, angle + 11.25),
    edgeA: point(488, angle + 1), edgeB: point(488, angle + 21.5),
    bright: lit > .25 ? '#ffffff' : lit < -.45 ? '#acbecb' : '#dce9ee',
    shade: lit > .25 ? '#aec7d2' : lit < -.45 ? '#6c8a9c' : '#91acbc',
  };
});

const crystal: RouletteThemeArtwork = {
  id: 'crystal',
  designNotes: 'Cut clear quartz: a sixteen-sided optical crown with broad table facets, recessed triangular pavilion cuts and a thin silver aperture seat. Directional blue-grey planes carry depth; sparse mint, lilac, rose and champagne edge refractions remain confined to the rim. The pointer is one long hexagonal quartz termination with its sole winning tip at (90,190). A matching quartz specimen and emerald-cut hub remain legible at small sizes. The evenodd clip confines all rim paint to radii 416 through 494.',
  palette: ['#eff8fc', '#acccd9', '#dce5ec', '#b5c4d4', '#c6dfdd', '#e7dce7'],
  tokens: {
    '--roulette-backdrop': '#e8f0f3',
    '--roulette-stage-ambient': 'none',
    '--roulette-panel': '#f7fbfd',
    '--roulette-panel-strong': '#dce9ef',
    '--roulette-panel-finish': 'none',
    '--roulette-line': '#96aebb',
    '--roulette-text': '#263e4e',
    '--roulette-muted': '#536b7a',
    '--roulette-accent': '#456a80',
    '--roulette-accent-2': '#82738f',
    '--roulette-result': '#30556e',
    '--roulette-hub': '#f0f7fa',
    '--roulette-hub-line': '#99aebb',
    '--roulette-hub-text': '#294c60',
    '--roulette-hub-muted': '#526d7c',
    '--roulette-label-dark': '#223e50',
    '--roulette-label-light': '#ffffff',
    '--roulette-segment-line': '#9db5c3',
    '--roulette-segment-gloss': 'rgba(255,255,255,.07)',
    '--roulette-track': '#eef5f8',
    '--roulette-shadow': 'rgba(54,77,92,.18)',
    '--roulette-atmosphere-opacity': '.24',
  },
  rim: (idPrefix) => <>
    <defs>
      <clipPath id={`${idPrefix}-quartz-aperture`}>
        <path d={silhouette} fillRule="evenodd" clipRule="evenodd" />
      </clipPath>
    </defs>
    <g clipPath={`url(#${idPrefix}-quartz-aperture)`} strokeLinejoin="bevel">
      <path d={silhouette} fill={mist} fillRule="evenodd" />
      {cuts.map((cut, index) => <g key={index}>
        <path d={face(cut.a, cut.b, cut.c, cut.d)} fill={cut.bright} />
        <path d={face(cut.d, cut.c, cut.ridge)} fill={ice} fillOpacity=".87" />
        <path d={face(cut.c, cut.f, cut.ridge)} fill={cut.shade} fillOpacity=".86" />
        <path d={face(cut.f, cut.e, cut.ridge)} fill={cut.bright} fillOpacity=".8" />
        <path d={face(cut.e, cut.d, cut.ridge)} fill={mist} fillOpacity=".85" />
        <path d={face(cut.d, cut.c, cut.f, cut.e)} fill="none" stroke={deep} strokeOpacity=".42" strokeWidth="1.1" />
        <path d={`M${cut.d.x} ${cut.d.y}L${cut.ridge.x} ${cut.ridge.y}L${cut.f.x} ${cut.f.y}`} fill="none" stroke="#fff" strokeWidth="1.8" />
        {index % 2 === 0 ? <path d={`M${cut.edgeA.x} ${cut.edgeA.y}L${cut.edgeB.x} ${cut.edgeB.y}`} fill="none" stroke={dispersion[index / 2 % 4]} strokeWidth="3.2" /> : null}
      </g>)}
      <path d={`M${polygon(16, 493, 11.25)}Z`} fill="none" stroke={deep} strokeWidth="2.2" />
      <path d={`M${polygon(16, 489, 11.25)}Z`} fill="none" stroke="#fff" strokeWidth="1.8" />
      <path d={ring(421, 416)} fill={deep} fillRule="evenodd" />
      <path d={ring(419.5, 417)} fill="#d8edf2" fillRule="evenodd" />
    </g>
  </>,
  pointer: (idPrefix) => <>
    <defs>
      <clipPath id={`${idPrefix}-quartz-tip`}>
        <path d="M71 18H109L138 54L119 114L90 190L61 114L42 54Z" />
      </clipPath>
    </defs>
    <g clipPath={`url(#${idPrefix}-quartz-tip)`} strokeLinejoin="bevel">
      <path d="M71 18H109L138 54L119 114L90 190L61 114L42 54Z" fill={deep} />
      <path d="M71 18H109L112 55H68Z" fill="#fff" />
      <path d="M71 18L68 55L42 54Z" fill="#bad3df" />
      <path d="M109 18L138 54L112 55Z" fill="#91abbf" />
      <path d="M42 54L68 55L90 190L61 114Z" fill="#afc7d5" />
      <path d="M68 55H112L90 190Z" fill="#f0faff" />
      <path d="M112 55L138 54L119 114L90 190Z" fill="#7595aa" />
      <path d="M80 57H105L90 166Z" fill="#d8eaf2" />
      <path d="M71 18L68 55L90 181M109 18L112 55L94 154M45 54H135" fill="none" stroke="#fff" strokeWidth="2" />
      <path d="M47 59L65 114L86 169" fill="none" stroke="#a5e5dc" strokeWidth="2" />
      <path d="M134 58L116 112L99 157" fill="none" stroke="#d7bfe5" strokeWidth="2" />
      <path d="M71 18H109L138 54L119 114L90 190L61 114L42 54Z" fill="none" stroke={deep} strokeWidth="3" />
    </g>
  </>,
  panel: <g strokeLinejoin="bevel" strokeWidth="1.5">
    <path d="M35 15L56 8L74 28L68 74L47 92L28 70Z" fill="#dcebf2" stroke={deep} />
    <path d="M35 15L48 33L56 8L74 28L59 36L47 92L40 65Z" fill="#fbfeff" />
    <path d="M59 36L74 28L68 74L47 92Z" fill="#96b2c3" />
    <path d="M35 15L48 33L40 65L28 70Z" fill="#bed4df" />
    <path d="M35 15L48 33L59 36L74 28M48 33L40 65L47 92M59 36L47 92" fill="none" stroke="#fff" />
    <path d="M18 47L30 38L38 52L32 77L24 82L13 67Z" fill="#e6f1f5" stroke={silver} />
    <path d="M30 38L26 54L24 82L32 77L38 52Z" fill="#a4bece" />
    <path d="M18 47L26 54L30 38M26 54L24 82" fill="none" stroke="#fff" />
    <path d="M69 34L64 69" stroke="#dbbbdc" />
    <path d="M33 23L30 49" stroke="#9de0d7" />
  </g>,
  hub: <g strokeLinejoin="bevel">
    <path d="M17 5H31L41 15V33L31 43H17L7 33V15Z" fill="#b1c9d6" stroke={deep} strokeWidth="1.2" />
    <path d="M17 5L20 13H28L31 5ZM7 15L15 18V30L7 33ZM31 43L28 35H20L17 43Z" fill="#f8fdff" />
    <path d="M31 5L28 13L33 18L41 15ZM41 33L33 30L28 35L31 43Z" fill="#7c9bb0" />
    <path d="M20 13H28L33 18V30L28 35H20L15 30V18Z" fill="#e6f2f8" stroke="#fff" strokeWidth="1.1" />
    <path d="M20 13L15 18V30L20 35M17 5L7 15M41 33L31 43" fill="none" stroke="#aadfd7" strokeWidth="1.2" />
    <path d="M28 13L33 18V30L28 35" fill="none" stroke="#baaecf" strokeWidth="1" />
  </g>,
  swatch: <g strokeLinejoin="bevel">
    <path d="M23 3H41L55 17L60 33L48 54L32 61L14 51L4 31L11 14Z" fill="#dce9ef" stroke={deep} strokeWidth="1.3" />
    <path d="M23 3H41L42 18L22 17Z" fill="#fff" />
    <path d="M41 3L55 17L60 33L45 30L42 18Z" fill="#99b5c7" />
    <path d="M60 33L48 54L32 61L37 43L45 30Z" fill="#7696aa" />
    <path d="M32 61L14 51L4 31L20 34L37 43Z" fill="#c1d5df" />
    <path d="M4 31L11 14L23 3L22 17L20 34Z" fill="#f6fcff" />
    <path d="M22 17L42 18L45 30L37 43L20 34Z" fill="#eff8fc" stroke="#fff" strokeWidth="1.3" />
    <path d="M20 34L37 43L32 61M42 18L55 17M22 17L11 14" fill="none" stroke={silver} strokeWidth="1" />
    <path d="M6 29L14 16L22 7" fill="none" stroke="#93dace" strokeWidth="1.7" />
    <path d="M56 34L45 52L35 56" fill="none" stroke="#d5b8da" strokeWidth="1.7" />
  </g>,
};

export default crystal;
