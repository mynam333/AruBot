import type { ReactNode } from 'react';
import type { MarbleIcon } from '../../../shared/marble';

const INK = '#493848';

function Sticker({ d, fill }: { d: string; fill: string }) {
  return <><path d={d} fill={fill} stroke="#fff" strokeWidth={8} /><path d={d} fill={fill} /></>;
}

function DiceSticker({ variant }: { variant: 'forward' | 'backward' | 'extra' }) {
  const colors = {
    forward: { top: '#b1ead6', side: '#47aa96', front: '#83d9c3', highlight: '#e5fff3', badge: '#e1f8ee', sign: '#258f7b' },
    backward: { top: '#ddcbf4', side: '#9477bc', front: '#bea6e5', highlight: '#f5edff', badge: '#f2e9ff', sign: '#9258a3' },
    extra: { top: '#ffb2be', side: '#d96d92', front: '#f28fa1', highlight: '#ffe7e7', badge: '#fff0bd', sign: '#b75681' },
  }[variant];
  const silhouette = 'M45.5 22 66.5 34Q70 36 70 40V64Q70 68 66.5 70L45.5 82Q42 84 38.5 82L17.5 70Q14 68 14 64V40Q14 36 17.5 34L38.5 22Q42 20 45.5 22Z';

  return <>
    <path d={silhouette} fill={colors.top} stroke="#fff" strokeWidth={8} />
    <path d="M14.875 36.5 42 52V83Q40.25 83 38.5 82L17.5 70Q14 68 14 64V40Q14 38 14.875 36.5Z" fill={colors.front} stroke="none" />
    <path d="M42 52 69.125 36.5Q70 38 70 40V64Q70 68 66.5 70L45.5 82Q43.75 83 42 83Z" fill={colors.side} stroke="none" />
    <path d={silhouette} />
    <path d="m14.875 36.5 27.125 15.5 27.125-15.5M42 52v31" strokeWidth={2.5} />
    {/* All faces use the same projected cube axes: (28, 16), (-28, 16), (0, 32). */}
    <g transform="matrix(.875 .5 -.875 .5 42 20)">
      <path d="M6 12V6h7" stroke={colors.highlight} strokeWidth={2.5} />
      <circle cx={16} cy={16} r={3.5} fill="#fff8e8" strokeWidth={1.5} />
    </g>
    {/* Visible faces are 1, 3 and 2; their hidden opposites are 6, 4 and 5. */}
    <g fill="#fff8e8" strokeWidth={1.5}>
      <g transform="matrix(.875 .5 0 1 14 36)">
        <circle cx={8} cy={8} r={3.2} />
        <circle cx={16} cy={16} r={3.2} />
        <circle cx={24} cy={24} r={3.2} />
      </g>
      <g transform="matrix(.875 -.5 0 1 42 52)">
        <circle cx={9} cy={9} r={3.2} />
        <circle cx={23} cy={23} r={3.2} />
      </g>
    </g>
    <circle cx={81} cy={16} r={10} fill={colors.badge} stroke="#fff" strokeWidth={6} />
    <circle cx={81} cy={16} r={10} fill={colors.badge} strokeWidth={2.5} />
    {variant === 'extra'
      ? <path d="m81 10 1.8 3.8 4.2.6-3 3 .7 4.1-3.7-2-3.7 2 .7-4.1-3-3 4.2-.6Z" fill={colors.sign} stroke={colors.sign} strokeWidth={1} />
      : <path d={variant === 'backward' ? 'M76 16h10' : 'M76 16h10m-5-5v10'} stroke={colors.sign} strokeWidth={3} />}
  </>;
}

const TILE_ART = {
  start: <>
    <Sticker d="M26 16h4v64h-4z" fill="#ffd28e" />
    <Sticker d="M30 19h47q5 0 5 5v36q0 5-5 5H30Z" fill="#fff9ec" />
    <path d="M32 21h16v14H32ZM48 35h16v14H48ZM64 21h13q3 0 3 3v11H64ZM32 49h16v14H32ZM64 49h16v11q0 3-3 3H64Z" fill="#4fcab2" stroke="none" />
    <path d="M35 24h8M67 24h8" stroke="#bff9e7" strokeWidth={3} />
    <path d="M30 19h47q5 0 5 5v36q0 5-5 5H30" />
    <path d="M21 82h18" strokeWidth={5} />
    <circle cx={28} cy={15} r={5} fill="#ff8995" />
  </>,
  drink: <>
    <Sticker d="M65 36h8q11 0 11 13v5q0 14-17 14h-5v-9h5q8 0 8-7v-2q0-5-7-5h-3Z" fill="#ffd26e" />
    <Sticker d="M23 31h45v43q0 8-9 8H32q-9 0-9-8Z" fill="#ffcc53" />
    <path d="M57 34h9v40q0 6-8 6h-6q6-3 6-10Z" fill="#efa13b" stroke="none" />
    <path d="M29 45v23" stroke="#fff0ad" strokeWidth={5} />
    <path d="M34 77h21" stroke="#ffe795" strokeWidth={3} />
    <Sticker d="M21 35q-8-3-5-11 2-7 10-6 3-9 12-6 6-6 13-1 10-3 14 6 12-1 12 9 0 9-9 10H53v8q0 5-5 5t-5-5V34q-8 6-14 0-4 4-8 1Z" fill="#fffbed" />
    <path d="M24 24q4-3 8 0M40 20q6-4 11 0" stroke="#e7ccb2" strokeWidth={2.5} />
    <path d="M37 53v17m10-17v17m10-17v17" stroke="#d99835" strokeWidth={2.5} />
  </>,
  snack: <>
    <Sticker d="M14 68q0-8 34-8t34 8v4q0 11-34 11T14 72Z" fill="#ffadb5" />
    <ellipse cx={48} cy={67} rx={30} ry={8} fill="#fff6eb" strokeWidth={2} />
    <Sticker d="M17 45 43 27l29 17v24l-25 8-30-11Z" fill="#ffd468" />
    <path d="m17 45 30 9 25-10M47 54v22" />
    <path d="m49 56 21-8v18l-21 7Z" fill="#f7b448" stroke="none" />
    <path d="m24 44 20-12 10 6" stroke="#fff1b4" strokeWidth={3} />
    <ellipse cx={34} cy={43} rx={4} ry={2.5} fill="#e69b38" stroke="none" />
    <circle cx={28} cy={59} r={3.5} fill="#eaa040" stroke="none" />
    <circle cx={41} cy={65} r={2.5} fill="#eaa040" stroke="none" />
    <path d="M56 39C40 28 43 14 52 17c7 2 5 15 13 20 7 4 14-1 13-8-1-12-13-13-16-3L55 41" stroke="#fff" strokeWidth={14} />
    <path d="M56 39C40 28 43 14 52 17c7 2 5 15 13 20 7 4 14-1 13-8-1-12-13-13-16-3L55 41" stroke={INK} strokeWidth={10} />
    <path d="M56 39C40 28 43 14 52 17c7 2 5 15 13 20 7 4 14-1 13-8-1-12-13-13-16-3L55 41" stroke="#eab47b" strokeWidth={6} />
    <path d="m48 24 2 1m22 0 2 1m-8 10 1-2" stroke="#fff4d8" strokeWidth={2.5} />
  </>,
  cheers: <>
    <path d="M29 64v16m-9 1h18M67 64v16m-9 1h18" stroke="#fff" strokeWidth={9} />
    <path d="M29 64v16m-9 1h18M67 64v16m-9 1h18" strokeWidth={3.5} />
    <Sticker d="M17 28h25v20q0 16-13 16T17 48Z" fill="#ffdccd" />
    <Sticker d="M54 28h25v20q0 16-12 16T54 48Z" fill="#fff0b2" />
    <path d="M19 39q11 4 21 0v9q0 14-11 14T19 48Z" fill="#ff8c9e" stroke="none" />
    <path d="M56 39q10 4 21 0v9q0 14-10 14T56 48Z" fill="#ffc757" stroke="none" />
    <path d="M23 34v16M60 34v16" stroke="#fffaf0" strokeWidth={3.5} />
    <path d="M17 28h25v20q0 16-13 16T17 48ZM54 28h25v20q0 16-12 16T54 48Z" />
    <path d="M48 13v7M34 16l4 5M62 16l-4 5" stroke="#ef9c42" strokeWidth={4} />
  </>,
  talk: <>
    <Sticker d="M41 14h29q12 0 12 12v13q0 12-12 12h-4l-10 9v-9H41q-12 0-12-12V26q0-12 12-12Z" fill="#85dbd6" />
    <path d="M62 22h9q3 0 3 3" stroke="#cafff0" strokeWidth={3} />
    <Sticker d="M24 30h35q15 0 15 15v16q0 15-15 15H38L24 85V75q-11-3-11-14V45q0-15 11-15Z" fill="#ffabb9" />
    <path d="M21 45q0-7 8-7h18" stroke="#ffe3e9" strokeWidth={4} />
    <path d="M26 49h10m-5 0v15m12 0V49l6 8 6-8v15m8-15v15" strokeWidth={3.5} />
    <path d="M61 72h-9" stroke="#e57899" strokeWidth={3} />
  </>,
  speech: <>
    <Sticker d="M25 14h28q12 0 12 12v16q0 12-12 12H36L23 64V53q-10-2-10-11V26q0-12 12-12Z" fill="#a4e7cc" />
    <path d="M21 28q0-6 8-6h11" stroke="#e8fff4" strokeWidth={3.5} />
    <path d="M24 30h8v7q0 6-7 9l-2-4q5-2 5-5h-4ZM39 30h8v7q0 6-7 9l-2-4q5-2 5-5h-4Z" fill="#3c8570" stroke="none" />
    <Sticker d="M49 39h19q15 0 15 14v13q0 13-13 14v7L57 80h-8q-14 0-14-14V53q0-14 14-14Z" fill="#c7b9f1" />
    <path d="M44 53q0-6 7-6h12" stroke="#eee7ff" strokeWidth={3.5} />
    <path d="m43 69 6-15 6 15m-10-5h8M63 60h6v9h-6q-3 0-3-3t3-3h6" strokeWidth={2.5} />
  </>,
  forbidden: <>
    <Sticker d="M28 23h35q16 0 16 16v22q0 16-16 16H42L26 85v-9q-12-3-12-15V39q0-16 14-16Z" fill="#ffb5bc" />
    <path d="M23 41q0-9 10-9h11" stroke="#ffe8e5" strokeWidth={4} />
    <path d="M29 60V45l12 15V45M53 45h4q5 0 5 5v5q0 5-5 5h-4q-5 0-5-5v-5q0-5 5-5Z" stroke="#9a4e72" strokeWidth={2.5} />
    <path d="M26 66h36" stroke="#9a4e72" strokeWidth={2.5} />
    <circle cx={70} cy={25} r={15} fill="#fff7ec" stroke="#fff" strokeWidth={8} />
    <circle cx={70} cy={25} r={15} fill="#fff7ec" />
    <circle cx={70} cy={25} r={9} stroke="#e85c77" strokeWidth={3.5} />
    <path d="m64 19 12 12" stroke="#e85c77" strokeWidth={3.5} />
  </>,
  water: <>
    <Sticker d="M20 24q28-8 56 0l-6 50q-1 9-22 9t-22-9Z" fill="#e8fcff" />
    <path d="M24 42q12-5 24 0t24 0l-4 31q0 7-20 7t-20-7Z" fill="#7ad8ed" stroke="none" />
    <path d="M24 42q12-5 24 0t24 0" stroke="#459fc6" strokeWidth={2.5} />
    <path d="m31 50 2 18M29 30l1 6" stroke="#fff" strokeWidth={4} />
    <path d="M37 76q12 3 23-1" stroke="#bff9ff" strokeWidth={3} />
    <path d="M48 12S37 24 37 30a11 11 0 0 0 22 0c0-6-11-18-11-18Z" fill="#51b9eb" />
    <path d="M45 23q-4 5-3 8" stroke="#d4f8ff" strokeWidth={3} />
    <path d="m42 51 1 18m11-18-1 18m12-20-2 18" stroke="#49b4d0" strokeWidth={2.5} />
  </>,
  card: <>
    <Sticker d="M29 13h44q7 0 7 7v51q0 7-7 7H29q-7 0-7-7V20q0-7 7-7Z" fill="#efa75c" />
    <Sticker d="M22 19h43q7 0 7 7v51q0 7-7 7H22q-7 0-7-7V26q0-7 7-7Z" fill="#ffda73" />
    <path d="M23 28h41v47H23Z" stroke="#c9853f" strokeWidth={2} />
    <path d="M26 33v35M30 25h25" stroke="#fff2bb" strokeWidth={3} />
    <path d="m29 44 9 6 6-12 6 12 10-6-4 18H33Z" fill="#fff4bc" />
    <path d="M34 65h21" stroke="#ba733e" strokeWidth={3} />
    <path d="m44 47 5 7-5 6-5-6Z" fill="#f67f96" strokeWidth={2} />
    <path d="M31 71h7m12 0h7" stroke="#c9853f" strokeWidth={2} />
  </>,
  shield: <>
    <Sticker d="M20 23h56q6 0 6 6v10q-9 0-9 9t9 9v10q0 6-6 6H20q-6 0-6-6V57q9 0 9-9t-9-9V29q0-6 6-6Z" fill="#9de1c8" />
    <path d="M25 30h8m10 0h27" stroke="#e1fff1" strokeWidth={4} />
    <path d="M36 29v7m0 8v8m0 8v7" stroke="#509b90" strokeWidth={2} />
    <path d="M22 65h8m34 0h8" stroke="#5ab29f" strokeWidth={2.5} />
    <path d="M44 39q10 0 16-6 7 6 16 6v10q0 16-16 23-16-7-16-23Z" fill="#fff5d3" />
    <path d="m52 51 6 6 10-12" stroke="#25987e" strokeWidth={5} />
  </>,
  forward: <DiceSticker variant="forward" />,
  backward: <DiceSticker variant="backward" />,
  extra: <DiceSticker variant="extra" />,
  rest: <>
    <path d="M32 26q-6-5 0-10M46 25q-6-5 0-12M59 26q-5-5 0-10" stroke="#a18b9e" strokeWidth={3} />
    <Sticker d="M67 40h6q11 0 11 11t-13 13h-7v-8h5q7 0 7-5t-7-4h-2Z" fill="#ffaab6" />
    <Sticker d="M14 76q0-5 34-5t34 5q0 8-34 8t-34-8Z" fill="#a5e2d2" />
    <Sticker d="M22 38h48v15q0 24-24 24T22 53Z" fill="#ffc2cc" />
    <ellipse cx={46} cy={38} rx={24} ry={7} fill="#fff6e9" />
    <ellipse cx={46} cy={39} rx={17} ry={3.5} fill="#b88560" stroke="none" />
    <path d="M28 50q0 10 5 14" stroke="#fff0ef" strokeWidth={4} />
    <path d="M56 37q-4-12 10-14 2 12-10 14Z" fill="#80c998" strokeWidth={2.5} />
    <path d="m56 37 6-9" stroke="#4d946d" strokeWidth={2} />
    <path d="m39 52 1 13m7-13v15m8-15-1 13" stroke="#e797aa" strokeWidth={2.5} />
  </>,
  timer: <>
    <Sticker d="M42 12h13q3 0 3 3v5H39v-5q0-3 3-3ZM44 21h9v10h-9Z" fill="#ff9ea9" />
    <path d="m69 31 6-6 5 5-6 6" fill="#ffce7a" />
    <circle cx={48} cy={54} r={30} fill="#80d9c6" stroke="#fff" strokeWidth={8} />
    <circle cx={48} cy={54} r={30} fill="#80d9c6" />
    <path d="M27 43q5-10 17-12" stroke="#d5fff0" strokeWidth={3} />
    <circle cx={48} cy={54} r={23} fill="#fff8e6" strokeWidth={2.5} />
    <path d="M48 34a20 20 0 0 1 17 30L48 54Z" fill="#ffd16f" stroke="none" />
    <path d="M48 36v3m0 30v3M30 54h3m30 0h3" stroke="#b39a8a" strokeWidth={2.5} />
    <path d="M48 41v13l10 6" strokeWidth={4} />
    <circle cx={48} cy={54} r={3.5} fill="#ff9ea9" strokeWidth={2} />
  </>,
  mission: <>
    <Sticker d="M25 18h45q7 0 7 7v53q0 6-7 6H25q-7 0-7-6V25q0-7 7-7Z" fill="#a3deed" />
    <path d="M27 26h41v50H27Z" fill="#fff8e9" strokeWidth={2} />
    <path d="M29 15v10m12-10v10m12-10v10" stroke="#fff" strokeWidth={8} />
    <path d="M29 15v10m12-10v10m12-10v10" strokeWidth={4} />
    <path d="M59 19h11v22l-5-4-6 4Z" fill="#ff9db0" strokeWidth={2.5} />
    <rect x={33} y={37} width={9} height={9} rx={2} fill="#ffdc85" strokeWidth={2} />
    <path d="m33 41 4 4 7-8M49 42h6" strokeWidth={2.5} />
    <rect x={33} y={53} width={9} height={9} rx={2} fill="#bdebd2" strokeWidth={2} />
    <path d="m33 57 4 4 7-8M49 57h12M34 69h22" strokeWidth={2.5} />
    <path d="M22 32v34M29 80h33" stroke="#d3f7fb" strokeWidth={2.5} />
  </>,
} satisfies Record<MarbleIcon, ReactNode>;

export function MarbleTileArt({ kind, className }: { kind: MarbleIcon; className?: string }) {
  return <svg
    className={className}
    viewBox="0 0 96 96"
    width={96}
    height={96}
    fill="none"
    stroke={INK}
    strokeWidth={3}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    data-marble-art={kind}
  >{TILE_ART[kind]}</svg>;
}
