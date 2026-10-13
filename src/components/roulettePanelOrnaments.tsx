import React from 'react';
import { getRouletteThemeMaterial } from './rouletteThemeMaterials';
import type { RouletteAtmosphereKind } from './rouletteThemeMaterials';

const accent = 'var(--roulette-accent, currentColor)';
const accent2 = 'var(--roulette-accent-2, currentColor)';
const line = 'var(--roulette-line, currentColor)';
const muted = 'var(--roulette-muted, currentColor)';

// Static geometry is shared between instances; each side has its own square viewport.
const panelMotifs: Record<RouletteAtmosphereKind, React.ReactNode> = {
  precision: <>
    <path d="M10 18H78M10 82H78M18 24V76M24 24V76" stroke={line} />
    <path d="M24 30H40M24 38H33M24 46H33M24 54H40M24 62H33M24 70H40" stroke={accent} />
    <path d="M44 49H70V51H44Z M12 44H18V56H12Z" fill={accent2} stroke="none" />
    <path d="M58 25H74V31M58 75H74V69M46 22V28M46 72V78" stroke={muted} />
    <path d="M82 46L88 50L82 54Z" fill={accent} stroke="none" />
  </>,
  spectrum: <>
    <path d="M8 18L48 12L82 42L48 54Z" fill={accent} fillOpacity=".14" />
    <path d="M8 18L48 54L18 86Z" fill={accent2} fillOpacity=".22" stroke={accent2} />
    <path d="M48 54L82 42L68 84L18 86Z" fill={accent} fillOpacity=".08" />
    <path d="M48 12V54L68 84M8 18L82 42M18 86L48 54" stroke={accent} />
    <path d="M16 12L46 7M73 87L87 48M27 80L48 60L63 78" stroke={line} />
  </>,
  aurora: <>
    <path d="M8 10C70 26 4 60 82 83L72 92C-3 67 52 35 8 21Z" fill={accent} fillOpacity=".15" stroke="none" />
    <path d="M8 14C67 29 5 64 80 88M17 8C80 27 14 59 88 79" stroke={accent} />
    <path d="M8 36C50 27 16 81 71 92M8 40C42 34 13 84 63 94" stroke={accent2} opacity=".7" />
    <path d="M24 15C66 30 30 44 42 61M47 69Q56 79 74 83" stroke={line} />
  </>,
  velvet: <>
    <path d="M10 12V88M15 16V84" stroke={line} />
    <path d="M18 50C40 48 32 21 53 22C69 23 65 40 54 35C47 32 51 26 56 28M18 50C40 52 32 79 53 78C69 77 65 60 54 65C47 68 51 74 56 72" />
    <path d="M20 50C45 37 64 44 80 28M20 50C45 63 64 56 80 72M34 41Q28 25 39 17M34 59Q28 75 39 83" stroke={accent2} />
    <path d="M62 43Q64 30 78 31Q75 43 62 43Z M62 57Q64 70 78 69Q75 57 62 57Z" fill={accent} fillOpacity=".2" />
    <path d="M18 50L26 44L34 50L26 56Z M38 12L42 16L38 20L34 16Z M38 80L42 84L38 88L34 84Z" fill={accent} />
    <path d="M19 21V37M19 63V79" stroke={accent2} strokeDasharray="1 4" />
  </>,
  mono: <>
    <path d="M10 16H85M10 84H85" strokeWidth="3" />
    <path d="M10 23H67M10 77H67M18 33V67M26 33V67" />
    <path d="M36 42H57V58H36Z M66 42H71V58H66Z" fill="currentColor" stroke="none" />
    <path d="M80 36V64M74 50H86" stroke={muted} />
  </>,
  deco: <>
    <path d="M10 84V28H22V20H34V12H84M16 88V34H28V26H40V18H88" stroke={line} />
    <path d="M24 78V45H36V33H48V25H60V21H78L24 78Z" fill={accent} fillOpacity=".12" />
    <path d="M24 78L36 33M24 78L48 25M24 78L60 21M24 78L78 21M24 78L78 42M24 78L78 60" />
    <path d="M32 84H50V76H64V68H78V54M32 90H56V82H70V74H84V54" stroke={accent2} />
  </>,
  crystal: <>
    <path d="M10 34L32 14H62L83 35L68 74L39 89L14 65Z" fill={line} fillOpacity=".13" />
    <path d="M10 34L38 40L32 14M38 40L62 14L83 35L55 54Z M38 40L14 65L39 89L55 54L68 74" />
    <path d="M18 34L34 21H58L74 36L61 69L40 80L22 61Z" stroke={line} />
    <path d="M38 40L39 89L55 54Z" fill={accent2} fillOpacity=".15" stroke="none" />
    <path d="M15 25L25 15M74 79L85 52" stroke={muted} />
  </>,
  ink: <>
    <path d="M12 16C39 26 18 51 32 74L27 87L21 72L23 65C11 44 29 29 12 16Z" fill="currentColor" stroke="none" />
    <path d="M17 14C46 36 18 47 35 75M15 33L13 48M32 81L37 90" stroke={muted} />
    <path d="M51 20L76 22L75 48L50 46Z M55 25L71 26L70 43L54 42Z M62 26V42M55 32H70M62 37H70" stroke={accent2} strokeWidth="2" />
    <path d="M43 73L79 69L68 74L48 76Z" fill={muted} stroke="none" />
  </>,
  nova: <>
    <path d="M15 82A45 45 0 0 1 73 16M21 76A37 37 0 0 1 69 24M27 70A29 29 0 0 1 64 32" />
    <path d="M13 67L22 65M12 51H20M18 35L26 39M29 22L35 29M46 14L49 22M62 12V20" stroke={accent2} />
    <path d="M26 81L68 29M43 62H77M60 45V79" stroke={line} />
    <circle cx="60" cy="62" r="10" stroke={accent2} />
    <path d="M56 62H64M60 58V66M9 87H31M9 87V75M76 13H87V24" stroke={muted} />
  </>,
  ceramic: <>
    <path d="M10 12V88M16 12V88M23 14Q39 23 23 32Q39 41 23 50Q39 59 23 68Q39 77 23 86" />
    <path d="M39 80C68 64 40 40 69 21M42 72Q29 55 48 54Q59 65 42 72Z M55 50Q73 49 75 35Q55 31 55 50Z M59 33Q44 31 48 18Q64 18 59 33Z" fill={accent} fillOpacity=".12" />
    <path d="M43 66L48 59M60 44L69 39M54 24L58 29M43 83Q73 74 77 57" stroke={accent2} />
    <path d="M75 61Q85 62 81 72Q73 71 75 61Z" fill={accent} />
  </>,
  arcade: <g shapeRendering="crispEdges" stroke="none">
    <path d="M8 32V16H24V8H72V14H30V22H14V32Z M8 68V84H24V92H72V86H30V78H14V68Z" fill={accent} />
    <path d="M22 40H34V28H58V34H40V46H28V66H22Z M46 58H58V46H70V40H82V52H70V64H58V76H46Z" fill={accent2} />
    <path d="M12 44H18V50H12Z M12 56H18V62H12Z M40 44H46V50H40Z M72 70H80V78H72Z" fill={muted} />
    <path d="M36 84H42V90H36Z M48 84H54V90H48Z M60 84H66V90H60Z" fill={line} />
  </g>,
  sakura: <>
    <path d="M15 81L18 23L32 15L49 14L66 21L79 34L85 50Z" fill={accent2} fillOpacity=".13" />
    <path d="M15 81L18 23M15 81L32 15M15 81L49 14M15 81L66 21M15 81L79 34M15 81L85 50" />
    <path d="M17 37L29 30L43 29L58 35L68 45L73 58M15 70L25 76" stroke={line} />
    <path d="M52 64L55 55L64 53L62 62Z M66 80L70 69L79 67L78 76Z M37 42L39 34L47 32L46 40Z" fill={accent2} stroke="none" />
    <path d="M12 85L17 87L23 80L18 78Z" fill={accent} />
  </>,
  ocean: <>
    <path d="M9 16C27 24 9 33 22 42S9 59 22 68S9 81 22 89M15 12C33 20 15 29 28 38S15 55 28 64S15 77 28 86" stroke={line} />
    <path d="M49 17A36 36 0 0 1 49 83M48 25A28 28 0 0 1 48 75" strokeWidth="2" />
    <path d="M51 20L53 26M72 29L68 34M82 48H76M74 70L69 66M54 80L55 74" stroke={accent2} strokeWidth="3" />
    <path d="M39 48Q47 40 55 48T71 48M39 57Q47 49 55 57T71 57" stroke={accent2} />
    <path d="M40 15H47M40 85H47" stroke={muted} />
  </>,
  solar: <>
    <path d="M23 29A25 25 0 0 1 23 71M28 35A18 18 0 0 1 28 65" />
    <path d="M22 23L18 9L28 20Z M37 25L40 9L45 29Z M48 34L63 21L55 40Z M54 46L82 46L55 54Z M48 66L63 79L55 60Z M37 75L40 91L45 71Z M22 77L18 91L28 80Z" fill={accent2} fillOpacity=".3" stroke={accent2} />
    <path d="M56 29L69 16M64 37L76 31M64 63L76 69M56 71L69 84" stroke={line} />
    <path d="M13 38L19 50L13 62" strokeWidth="2" />
  </>,
  cyber: <>
    <path d="M10 15H32L45 28H75M10 85H32L45 72H75M16 26V39L29 52V70M10 34V43L22 55V76" />
    <path d="M26 14H42L56 28V39H81M26 86H42L56 72V61H81" stroke={line} />
    <path d="M41 43H58V57H41Z M75 25H81V31H75Z M75 69H81V75H75Z" stroke={accent2} />
    <path d="M45 47H54V53H45Z M28 32H35V38H28Z M28 62H35V68H28Z" fill={accent2} stroke="none" />
    <path d="M36 47H41M36 53H41M58 47H63M58 53H63M46 38V43M52 38V43M46 57V62M52 57V62" />
  </>,
  gold: <>
    <path d="M12 17V83H79M17 21V78H74" stroke={line} />
    <path d="M28 76Q66 59 67 20M32 78Q72 59 72 21" />
    <path d="M36 71Q19 64 28 52Q41 56 36 71Z M47 62Q31 51 41 40Q54 47 47 62Z M57 50Q44 36 57 29Q67 38 57 50Z M64 35Q58 20 71 14Q77 27 64 35Z M42 69Q55 72 61 59Q47 55 42 69Z M56 57Q71 60 77 46Q63 43 56 57Z" fill={accent} fillOpacity=".18" />
    <path d="M29 57L35 65M42 45L47 55M57 34V43M48 64L55 62M62 52L70 49M26 83H66" stroke={accent2} strokeWidth=".8" />
  </>,
};

const hubMotifs: Record<RouletteAtmosphereKind, React.ReactNode> = {
  precision: <><path d="M9 13H39M9 35H39M14 17V31M19 17V22M24 17V25M29 17V22M34 17V31" /><path d="M21 28H27V32H21Z" fill={accent2} stroke="none" /></>,
  spectrum: <><path d="M8 18L22 7L39 16L32 38L13 34Z M8 18L25 23L22 7M25 23L39 16M25 23L32 38L13 34Z" /><path d="M8 18L25 23L13 34Z" fill={accent2} fillOpacity=".4" /></>,
  aurora: <><path d="M9 11C40 14 7 33 39 37L33 41C1 33 32 17 9 16Z" fill={accent} fillOpacity=".22" /><path d="M16 7C46 19 15 27 38 32" stroke={accent2} /></>,
  velvet: <><path d="M8 24C19 22 13 9 23 10C34 9 29 21 24 17M8 24C19 26 13 39 23 38C34 39 29 27 24 31M12 24H38M29 24Q32 12 40 14M29 24Q32 36 40 34" /><path d="M18 24L24 19L30 24L24 29Z" fill={accent} /></>,
  mono: <><path d="M8 10H40M8 38H40" strokeWidth="3" /><path d="M8 15H40M8 33H40" /><path d="M15 20H27V28H15Z M31 20H34V28H31Z" fill="currentColor" stroke="none" /></>,
  deco: <><path d="M10 37V20H16V14H22V8H28V14H34V20H40V37Z M10 37H40M25 37L16 14M25 37V8M25 37L34 14M25 37L10 20M25 37L40 20" /></>,
  crystal: <><path d="M8 18L17 9H31L40 18L24 40Z M8 18H40M17 9L16 18L24 40L32 18L31 9M16 18L24 9L32 18" /><path d="M16 18H32L24 40Z" fill={accent2} fillOpacity=".15" /></>,
  ink: <><path d="M9 9Q23 17 15 39L11 35Q17 17 9 9Z" fill="currentColor" stroke="none" /><path d="M24 12H39V34H24Z M28 17H35V29H28Z M31 17V29M28 23H35" stroke={accent2} /></>,
  nova: <><path d="M10 31A17 17 0 1 1 31 40M14 30A12 12 0 1 1 30 35M24 5V10M6 24H11M36 24H42" /><path d="M17 31L33 15M19 24H29M24 19V29" stroke={accent2} /></>,
  ceramic: <><path d="M9 12Q24 5 39 12M9 36Q24 43 39 36M15 33Q31 25 29 13M22 28Q10 28 13 18Q25 17 22 28Z M27 21Q27 11 37 15Q37 25 27 21Z" /><path d="M15 23L20 26M30 19L34 17" stroke={accent2} /></>,
  arcade: <g stroke="none" shapeRendering="crispEdges"><path d="M8 16V8H24V16H16V24H8Z M24 32H32V24H40V40H24Z" fill={accent} /><path d="M19 19H29V29H19Z M32 8H40V16H32Z M8 32H16V40H8Z" fill={accent2} /></g>,
  sakura: <><path d="M10 38L8 18L15 10L25 8L35 13L41 23Z M10 38L15 10M10 38L25 8M10 38L35 13M9 26Q21 13 34 27" /><path d="M28 34L30 28L36 26L35 32Z" fill={accent2} /></>,
  ocean: <><circle cx="24" cy="24" r="17" /><circle cx="24" cy="24" r="12" /><path d="M24 7V12M24 36V41M7 24H12M36 24H41M15 24Q19 19 24 24T33 24M16 29Q20 24 25 29T32 29" stroke={accent2} /></>,
  solar: <><path d="M24 6L27 15L35 10L33 20L43 24L33 28L35 38L27 33L24 42L21 33L13 38L15 28L5 24L15 20L13 10L21 15Z" /><path d="M24 17L31 24L24 31L17 24Z" fill={accent2} fillOpacity=".4" /></>,
  cyber: <><path d="M17 17H31V31H17Z M8 8H16L21 13V17M40 8H32L27 13V17M8 40H16L21 35V31M40 40H32L27 35V31M7 24H17M31 24H41" /><path d="M21 21H27V27H21Z" fill={accent2} /></>,
  gold: <><path d="M24 39Q7 28 14 10M24 39Q41 28 34 10M14 28Q3 24 8 17Q17 20 14 28Z M13 18Q7 10 15 7Q21 15 13 18Z M34 28Q45 24 40 17Q31 20 34 28Z M35 18Q41 10 33 7Q27 15 35 18Z" /><path d="M24 15L29 23L24 31L19 23Z" fill={accent2} fillOpacity=".3" /></>,
};

export type RoulettePanelOrnamentsProps = {
  themeId: string;
  position: 'heading' | 'result';
};

export const RoulettePanelOrnaments = React.memo(function RoulettePanelOrnaments({
  themeId,
  position,
}: RoulettePanelOrnamentsProps) {
  const kind = getRouletteThemeMaterial(themeId).atmosphere;
  return (
    <div
      className={`roulette-panel-ornaments roulette-panel-ornaments--${position}`}
      data-kind={kind}
      data-position={position}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, zIndex: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'hidden' }}
    >
      {(['left', 'right'] as const).map((side) => (
        <svg
          key={side}
          className={`roulette-panel-ornament-side roulette-panel-ornament-side--${side}`}
          viewBox="0 0 100 100"
          preserveAspectRatio={side === 'left' ? 'xMinYMid meet' : 'xMaxYMid meet'}
          width="100%"
          height="100%"
          focusable="false"
          fill="none"
          stroke={accent}
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ position: 'absolute', top: '50%', [side]: 0, width: 'min(20%, var(--roulette-ornament-width, 50px))', maxHeight: 88, transform: 'translateY(-50%)', overflow: 'hidden' }}
        >
          {/* Clipped side viewports guarantee a clear middle 60% at every size. */}
          <g transform={side === 'right' ? 'translate(100 0) scale(-1 1)' : undefined}>
            <g transform={position === 'heading' ? 'translate(0 8) scale(.84)' : undefined}>
              {panelMotifs[kind]}
            </g>
          </g>
        </svg>
      ))}
    </div>
  );
});

export const RouletteHubEmblem = React.memo(function RouletteHubEmblem({ themeId }: { themeId: string }) {
  const kind = getRouletteThemeMaterial(themeId).atmosphere;
  return (
    <svg
      className="roulette-hub-emblem"
      data-kind={kind}
      viewBox="0 0 48 48"
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', pointerEvents: 'none' }}
    >
      {hubMotifs[kind]}
    </svg>
  );
});
