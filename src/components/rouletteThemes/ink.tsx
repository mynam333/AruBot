import type { RouletteThemeArtwork } from './types';
import { aperture, point, ring } from './geometry';

const paper = '#f8f8f2';
const sumi = '#242925';
const graphite = '#777e73';
const seal = '#b73732';

function contour(radius: number, amplitude: number, start = 0, end = 360) {
  return Array.from({ length: 181 }, (_, index) => {
    const angle = start + (end - start) * index / 180;
    const radians = angle * Math.PI / 180;
    const p = point(radius + amplitude * (Math.sin(radians * 3 + .7) * .65 + Math.sin(radians * 7) * .35), angle);
    return `${index ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }).join(' ');
}

// Two pressure-shaped edges describe a brush stroke without procedural noise.
function brush(start: number, end: number, radius: number, width: number) {
  const edges = [1, -1].map((side) => Array.from({ length: 121 }, (_, index) => {
    const t = (side === 1 ? index : 120 - index) / 120;
    const angle = start + (end - start) * t;
    const radians = angle * Math.PI / 180;
    const pressure = .15 + .85 * Math.pow(Math.sin(Math.PI * t), .65);
    const drift = 3 * Math.sin(radians * 3 + .4) + 1.5 * Math.sin(radians * 9);
    const p = point(radius + drift + side * width * pressure / 2, angle);
    return `${index === 0 && side === 1 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }).join(' '));
  return edges.join(' ') + 'Z';
}

const sealArtwork = <g stroke="none">
    <path d="M1 2 29 0 31 29 2 31 0 17Z" fill={seal} />
    <path d="M6 7 24 5 25 24 7 26Z" fill="none" stroke={paper} strokeWidth="1.8" />
    <path d="M11 10 19 9 20 19 12 20 11 15M16 9 16 14M20 24 20 28M2 10 5 10" fill="none" stroke={paper} strokeWidth="2" />
  </g>;

const ink = {
  id: 'ink',
  designNotes: 'Sumi on warm-white hanji: a pressure-shaped, interrupted ink sweep holds a deliberately quiet paper annulus. Three edited dry-brush cuts, fine broken graphite contours and one vermilion seal replace mechanical concentric decoration. A dipped-brush pointer, vertical margin stroke and compact seal emblems repeat this vocabulary at small sizes. Flat pigments only; no texture filters or added motion.',
  palette: [paper, sumi, '#d4d9ce', '#646f65', '#eceee6', seal],
  tokens: {
    '--roulette-backdrop': paper,
    '--roulette-panel': '#fcfcf7',
    '--roulette-panel-strong': '#eceee6',
    '--roulette-panel-finish': 'none',
    '--roulette-text': sumi,
    '--roulette-muted': '#656e64',
    '--roulette-accent': sumi,
    '--roulette-accent-2': seal,
    '--roulette-result': seal,
    '--roulette-line': '#a7ada0',
    '--roulette-rim-outer': sumi,
    '--roulette-rim-inner': paper,
    '--roulette-rim-line': graphite,
    '--roulette-hub': paper,
    '--roulette-hub-line': sumi,
    '--roulette-hub-text': sumi,
    '--roulette-hub-muted': '#656e64',
    '--roulette-pointer': sumi,
    '--roulette-pointer-core': seal,
    '--roulette-label-light': paper,
    '--roulette-label-dark': sumi,
    '--roulette-segment-line': graphite,
    '--roulette-segment-gloss': 'transparent',
    '--roulette-shadow': 'rgba(36,41,37,.08)',
    '--roulette-track': '#e7eae1',
  },
  rim: (idPrefix) => <>
    <defs>
      <clipPath id={`${idPrefix}-ink-annulus`}>
        <path d={ring(496, 414)} fillRule="evenodd" clipRule="evenodd" />
      </clipPath>
    </defs>
    <g clipPath={`url(#${idPrefix}-ink-annulus)`} stroke="none">
      <path d={aperture(contour(487, 4) + 'Z', 414)} fill={paper} fillRule="evenodd" />
      <path d={contour(491, 2, 79, 322)} fill="none" stroke={graphite} strokeWidth="1.3" />
      <path d={brush(31, 369, 465, 43)} fill={sumi} />
      <path d={brush(57, 347, 434, 7)} fill={sumi} opacity=".78" />
      <path d={contour(423, 1.8, 16, 342)} fill="none" stroke={graphite} strokeWidth="1.5" />
      <path d={brush(184, 299, 470, 3.8)} fill={paper} opacity=".88" />
      <path d={brush(197, 278, 478, 2.2)} fill={paper} opacity=".7" />
      <path d={brush(82, 123, 458, 2.6)} fill={paper} />
      <path d={contour(446, 3, 220, 326)} fill="none" stroke={graphite} strokeWidth="1.1" />
      <path d={contour(474, 1, 36, 59)} fill="none" stroke={sumi} strokeWidth="2.2" />
      <g transform="translate(772 817) rotate(-8) scale(1.35)">
        {sealArtwork}
      </g>
    </g>
  </>,
  pointer: () => <g stroke="none">
    <path d="M54 17 119 13 128 60 119 90 107 134 90 184 76 145 61 105 51 62Z" fill={paper} />
    <path d="M59 20 117 17 123 60 115 89 103 137 90 190 79 143 65 103 56 62Z" fill={sumi} />
    <path d="M61 22 115 19 120 61 59 65Z" fill={seal} />
    <path d="M70 29 105 27 108 53 73 55Z" fill="none" stroke={paper} strokeWidth="2.5" />
    <path d="M80 36 96 35 98 47 84 48 83 42M90 35 91 41" fill="none" stroke={paper} strokeWidth="3" />
    <path d="M66 73Q82 115 89 167Q85 121 74 77Z" fill={paper} />
    <path d="M109 78Q106 108 94 151" fill="none" stroke={graphite} strokeWidth="2" />
    <path d="M61 68 117 64" fill="none" stroke={paper} strokeWidth="2" />
  </g>,
  panel: <g stroke="none">
    <path d="M20 10C46 29 20 50 35 76L31 91 23 78C13 59 30 35 20 10Z" fill={sumi} />
    <path d="M24 19C43 41 23 56 33 73M18 44 17 59M31 86 35 93" fill="none" stroke={graphite} strokeWidth="1.5" />
    <g transform="translate(49 24) rotate(-5 15 15)">{sealArtwork}</g>
    <path d="M47 70 85 68M51 75 71 74" fill="none" stroke={graphite} strokeWidth="1.5" />
  </g>,
  hub: <g stroke="none">
    <path d="M26 5C11 2 2 15 6 29C8 37 13 41 22 42L19 39C8 34 6 19 13 12C16 8 21 7 26 5Z" fill={sumi} />
    <path d="M8 13C2 26 9 39 20 43M29 5 34 7" fill="none" stroke={graphite} strokeWidth="1" />
    <g transform="translate(21 15) rotate(-5 10 10) scale(.66)">{sealArtwork}</g>
  </g>,
  swatch: <g stroke="none">
    <path d="M32 2C49 1 62 15 62 32C63 49 49 62 32 62C15 63 2 49 2 32C1 15 15 2 32 2Z" fill={paper} />
    <path d="M44 6C26-2 5 11 4 29C2 47 18 61 36 59C49 59 59 48 60 35C58 50 44 58 31 54C15 51 8 39 12 24C16 11 29 6 44 6Z" fill={sumi} />
    <path d="M48 12C59 24 53 45 42 49M10 25C6 40 17 52 29 54" fill="none" stroke={graphite} strokeWidth="1" />
    <path d="M20 21Q31 13 41 19M18 26 31 20" fill="none" stroke={sumi} strokeWidth="1.2" />
    <g transform="translate(31 30) rotate(-7 9 9) scale(.59)">{sealArtwork}</g>
  </g>,
} satisfies RouletteThemeArtwork;

export default ink;
