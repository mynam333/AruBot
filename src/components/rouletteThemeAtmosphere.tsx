import React, { useId, useInsertionEffect } from 'react';
import type { RouletteAtmosphereKind } from './rouletteThemeMaterials';

const ATMOSPHERE_CSS = `
  .roulette-atmosphere {
    position:absolute; inset:-12%; z-index:0; overflow:hidden;
    pointer-events:none; user-select:none; opacity:0;
    transition:opacity 320ms ease-out;
  }
  .roulette-atmosphere--active { opacity:var(--roulette-atmosphere-opacity,.8); }
  .roulette-atmosphere--compact { inset:0; }
  .roulette-atmosphere__art { display:block; width:100%; height:100%; overflow:hidden; }
  .roulette-atmosphere__motion { animation-play-state:paused !important; }
  .roulette-atmosphere--active .roulette-atmosphere__motion { animation-play-state:running !important; }
  .roulette-atmosphere__light { animation:roulette-atmosphere-light 9s ease-in-out infinite; }
  .roulette-atmosphere__ribbon { animation:roulette-atmosphere-ribbon 14s ease-in-out infinite alternate; }
  .roulette-atmosphere__curtain { animation:roulette-atmosphere-curtain 12s ease-in-out infinite alternate; transform-origin:0 0; }
  .roulette-atmosphere__facet { animation:roulette-atmosphere-facet 11s ease-in-out infinite; }
  .roulette-atmosphere__orbit { animation:roulette-atmosphere-orbit 36s ease-in-out infinite alternate; transform-origin:500px 500px; }
  .roulette-atmosphere__pixel { animation:roulette-atmosphere-pixel 6s steps(2,end) infinite; }
  .roulette-atmosphere__petal { animation:roulette-atmosphere-petal 13s ease-in-out infinite; transform-box:fill-box; transform-origin:center; }
  .roulette-atmosphere__wave { animation:roulette-atmosphere-wave 10s ease-in-out infinite alternate; }
  .roulette-atmosphere__bubble { animation:roulette-atmosphere-bubble 12s ease-in-out infinite; }
  .roulette-atmosphere__corona { animation:roulette-atmosphere-corona 24s ease-in-out infinite alternate; transform-origin:500px 500px; }
  .roulette-atmosphere__signal { animation:roulette-atmosphere-signal 7s steps(1,end) infinite; }
  .roulette-atmosphere__engraving { animation:roulette-atmosphere-engraving 14s ease-in-out infinite; }
  .roulette-atmosphere .roulette-atmosphere__delayed { animation-delay:-5s; }
  .overlay-paused .roulette-atmosphere .roulette-atmosphere__motion { animation-play-state:paused !important; }
  @keyframes roulette-atmosphere-light { 0%,100%{opacity:.24;transform:translateX(-12px)} 50%{opacity:.7;transform:translateX(12px)} }
  @keyframes roulette-atmosphere-ribbon { from{transform:translate(-6px,-8px)} to{transform:translate(8px,10px)} }
  @keyframes roulette-atmosphere-curtain { from{transform:skewY(-.4deg)} to{transform:skewY(.6deg)} }
  @keyframes roulette-atmosphere-facet { 0%,100%{opacity:.5} 50%{opacity:.85} }
  @keyframes roulette-atmosphere-orbit { from{transform:rotate(-4deg)} to{transform:rotate(4deg)} }
  @keyframes roulette-atmosphere-pixel { 0%,75%,100%{opacity:.4} 25%,50%{opacity:.9} }
  @keyframes roulette-atmosphere-petal { 0%{transform:translate(0,-28px) rotate(-12deg);opacity:0} 18%,70%{opacity:.75} 100%{transform:translate(14px,90px) rotate(56deg);opacity:0} }
  @keyframes roulette-atmosphere-wave { from{transform:translateX(-18px)} to{transform:translateX(18px)} }
  @keyframes roulette-atmosphere-bubble { 0%{transform:translate(0,24px);opacity:0} 25%,65%{opacity:.6} 100%{transform:translate(8px,-62px);opacity:0} }
  @keyframes roulette-atmosphere-corona { from{transform:rotate(-2deg);opacity:.5} to{transform:rotate(2deg);opacity:.8} }
  @keyframes roulette-atmosphere-signal { 0%,76%,100%{opacity:.25} 78%,88%{opacity:.9} }
  @keyframes roulette-atmosphere-engraving { 0%,100%{opacity:.4} 50%{opacity:.75} }
  @media (prefers-reduced-motion:reduce) {
    .roulette-atmosphere { transition:none; }
    .roulette-atmosphere .roulette-atmosphere__motion { animation:none !important; }
  }
`;

const stylesheets = new WeakMap<Document, { element: HTMLStyleElement; users: number }>();

function useAtmosphereStyles() {
  // React 18 cannot hoist/deduplicate <style>; previews share one sheet per document.
  useInsertionEffect(() => {
    let sheet = stylesheets.get(document);
    if (!sheet) {
      const element = document.createElement('style');
      element.dataset.rouletteAtmosphere = 'themes';
      element.textContent = ATMOSPHERE_CSS;
      document.head.appendChild(element);
      sheet = { element, users: 0 };
      stylesheets.set(document, sheet);
    }
    sheet.users += 1;
    return () => {
      sheet.users -= 1;
      if (sheet.users === 0) {
        sheet.element.remove();
        stylesheets.delete(document);
      }
    };
  }, []);
}

const CORNERS = ['', 'translate(1000 0) scale(-1 1)', 'translate(0 1000) scale(1 -1)', 'translate(1000 1000) scale(-1 -1)'];
const SIDES = ['', 'translate(1000 0) scale(-1 1)'];
const SEVEN = Array.from({ length: 7 }, (_, i) => i);

function Corners({ children, opposite = false }: { children: React.ReactNode; opposite?: boolean }) {
  return <>{CORNERS.map((transform, i) => (!opposite || i === 0 || i === 3) ? <g key={i} transform={transform}>{children}</g> : null)}</>;
}

function ThemeMotif({ kind, id }: { kind: RouletteAtmosphereKind; id: string }) {
  switch (kind) {
    case 'precision':
      return (
        <g fill="none" stroke="var(--roulette-line,#9caebc)" strokeWidth="1.5">
          <Corners>
            <path d="M24 176V24H176 M36 112V36H112" />
            {SEVEN.map((i) => <path key={i} d={`M${52 + i * 16} 24v${i % 3 === 0 ? 12 : 5} M24 ${52 + i * 16}h${i % 3 === 0 ? 12 : 5}`} />)}
            <path d="M58 70h24 M70 58v24" stroke="var(--roulette-accent,#9fe9ff)" />
            <rect x="22" y="190" width="4" height="26" fill="var(--roulette-accent,#9fe9ff)" stroke="none" />
          </Corners>
          <g className="roulette-atmosphere__motion roulette-atmosphere__light" stroke="none" fill="var(--roulette-accent-2,#eef5fa)">
            <path d="M334 24h332v4H334z M400 33h200v1H400z M334 972h332v4H334z" />
          </g>
        </g>
      );
    case 'spectrum':
      return (
        <g strokeWidth="1.5" strokeLinejoin="round">
          <Corners opposite>
            <path d="M0 0h276L65 85Z" fill="#cffafe" fillOpacity=".7" stroke="#a5f3fc" />
            <path d="M0 0l65 85L16 250Z" fill="#22d3ee" fillOpacity=".5" stroke="#67e8f9" />
            <path d="M65 85l93-49-48 90Z" fill="#f472b6" fillOpacity=".65" stroke="#fbcfe8" />
            <path d="M158 36l118-36-64 83Z" fill="#fef08a" fillOpacity=".55" stroke="#fef9c3" />
            <path d="M16 250l49-165 45 41Z" fill="#a78bfa" fillOpacity=".32" stroke="#ddd6fe" />
            <path d="M65 85l93-49-48 90Z" fill="#fff" fillOpacity=".15" className="roulette-atmosphere__motion roulette-atmosphere__facet" />
          </Corners>
        </g>
      );
    case 'aurora':
      return (
        <g fill="none" strokeLinecap="round">
          {SIDES.map((transform, i) => (
            <g key={i} transform={transform}>
              <g className={`roulette-atmosphere__motion roulette-atmosphere__ribbon ${i ? 'roulette-atmosphere__delayed' : ''}`}>
                <path d="M-24 16C170 166-28 315 52 500S160 758 12 988L-12 988C118 756 62 689 22 506S120 173-40 16Z" fill="#65edbd" fillOpacity=".16" />
                <path d="M-16 0C164 165-35 338 38 507S154 766 0 1000" stroke="#a7f3d0" strokeWidth="3" opacity=".7" />
                <path d="M4 0C186 163-5 340 63 503S184 759 26 1000" stroke="#2dd4bf" strokeWidth="1.5" opacity=".65" />
                <path d="M22 0C204 160 14 333 86 495S205 751 48 1000" stroke="#c4b5fd" strokeWidth="1" opacity=".4" />
              </g>
            </g>
          ))}
        </g>
      );
    case 'velvet':
      return (
        <>
          <path d="M0 0H1000V35Q875 138 750 35Q625 116 500 35Q375 116 250 35Q125 138 0 35Z" fill="#6e1231" />
          <path d="M0 35Q125 138 250 35Q375 116 500 35Q625 116 750 35Q875 138 1000 35" fill="none" stroke="#d7b46e" strokeWidth="3" />
          {SIDES.map((transform, i) => (
            <g key={i} transform={transform}>
              <g className="roulette-atmosphere__motion roulette-atmosphere__curtain">
                <path d="M0 0H112C122 186 102 285 48 360Q21 542 52 1000H0Z" fill="#570c26" />
                <path d="M28 0C66 190 46 263 28 357Q4 596 27 1000 M62 0C93 180 81 277 39 360" fill="none" stroke="#ad3456" strokeOpacity=".5" strokeWidth="8" />
                <path d="M110 8C116 190 93 302 48 360" fill="none" stroke="#e6c688" strokeWidth="2" />
                <path d="M20 352l38 7-3 9-36-7Z M44 367v46l-5 13h12l-5-13" fill="#d7b46e" />
              </g>
            </g>
          ))}
        </>
      );
    case 'mono':
      return (
        <g fill="none" stroke="var(--roulette-text,#f7f7f7)" strokeWidth="2">
          <Corners>
            <path d="M18 98V18H98 M38 78V38H78" strokeWidth="5" />
            <circle cx="91" cy="91" r="17" />
            <path d="M64 91h54 M91 64v54" />
            <path d="M142 22h58 M22 142v58" strokeWidth="10" />
          </Corners>
          <path d="M360 26h50m12 0h16m12 0h68m12 0h26m12 0h72" strokeWidth="7" />
          <path d="M400 975h200 M500 963v24" />
        </g>
      );
    case 'deco':
      return (
        <g fill="none" stroke="#e3c076" strokeWidth="2" strokeLinejoin="miter">
          <Corners>
            <path d="M18 210V18H210 M29 182V29H182" />
            <path d="M40 150V40H150V51H125V65H105V83H83V105H65V125H51V150Z" fill="#b68b40" fillOpacity=".2" />
            <path d="M40 150L150 40 M40 40l99 18 M40 40l81 36 M40 40l63 54 M40 40l45 72 M40 40l27 90 M40 40l9 108" />
            <path d="M42 174h15v-14h15v-14 M174 42v15h-14v15h-14" strokeWidth="1" />
          </Corners>
          <path d="M382 24h96l22 17 22-17h96 M450 16h38l12 10 12-10h38" />
        </g>
      );
    case 'crystal':
      return (
        <g stroke="#dbf8ff" strokeOpacity=".65" strokeWidth="1.2" strokeLinejoin="bevel">
          <Corners opposite>
            <path d="M0 0H206L64 70Z" fill="#e7fcff" fillOpacity=".6" />
            <path d="M0 0l64 70-35 149Z" fill="#80d8ef" fillOpacity=".4" />
            <path d="M64 70l34 77L29 219Z" fill="#f3fcff" fillOpacity=".3" />
            <path d="M64 70L206 0l-88 105Z" fill="#6dbbf7" fillOpacity=".25" />
            <path d="M0 296l44 55-19 139Z" fill="#bceaff" fillOpacity=".2" />
            <path d="M0 296l44 55-29 44Z" fill="#f4ffff" fillOpacity=".4" className="roulette-atmosphere__motion roulette-atmosphere__facet" />
            <path d="M238 0l99 21 64-21 M64 70l-47 78 M98 147l-37 27" fill="none" />
          </Corners>
        </g>
      );
    case 'ink':
      return (
        <>
          <path d="M0 0H90L85 42l9 31-12 36 6 31-14 50 6 42-13 28 7 63-13 50 8 39-14 47 8 53-12 71 6 50-16 72 6 64-13 65 7 52-10 61 8 59-10 41H0Z" fill="#faf9f1" fillOpacity=".94" />
          <path d="M0 953l82-7 61 10 54-9 77 7 62-13 63 12 74-6 52 8 68-13 64 10 61-6 82 12 69-6 81 7V1000H0Z" fill="#f5f4eb" fillOpacity=".88" />
          <path d="M13 12C82 100 39 190 41 287S8 439 30 568Q53 708 17 878L10 878C44 713 38 662 19 570S36 376 32 285 74 108 13 12Z" fill="#282e2a" fillOpacity=".78" />
          <path d="M25 18C93 116 48 206 52 282 M11 602Q36 751 10 931 M82 975Q256 953 408 977T778 976" fill="none" stroke="#353d37" strokeOpacity=".5" strokeWidth="1.5" />
          <g transform="translate(918 39) rotate(3)" fill="none" stroke="#b9493c" strokeWidth="3">
            <path d="M0 0h38v43H0Z M7 7h24v29H7Z M19 7v29 M7 18h24 M7 27h12" />
          </g>
        </>
      );
    case 'nova':
      return (
        <g fill="none" strokeWidth="1.5">
          <g className="roulette-atmosphere__motion roulette-atmosphere__orbit">
            <ellipse cx="500" cy="500" rx="574" ry="446" stroke="#d59469" transform="rotate(-22 500 500)" opacity=".7" />
            <ellipse cx="500" cy="500" rx="594" ry="466" stroke="#75d9e1" transform="rotate(-22 500 500)" opacity=".25" />
            <path d="M120 109A570 445 0 0 1 740 46 M847 830l19-5-2 19" stroke="#d59469" strokeWidth="3" />
          </g>
          <path d="M24 120V24H120 M976 880v96H880" stroke="#d59469" />
          {SEVEN.map((i) => <path key={i} d={`M${58 + i * 18} 46v${i % 2 ? 6 : 14}`} stroke="#d59469" />)}
          {SIDES.map((transform, i) => (
            <g key={i} transform={transform} stroke="#75d9e1">
              <circle cx="55" cy="500" r="20" /><circle cx="55" cy="500" r="4" />
              <path d="M22 500h20m26 0h20 M55 467v20m0 26v20 M25 550v58m7-58v20" />
            </g>
          ))}
        </g>
      );
    case 'ceramic':
      return (
        <>
          <path d="M0 0H1000V26H0Z M0 974H1000V1000H0Z M0 0H26V1000H0Z M974 0H1000V1000H974Z" fill="#f4fafb" fillOpacity=".9" />
          <g fill="none" stroke="#2855a0" strokeWidth="2">
            <path d="M12 0V1000 M988 0V1000 M0 12H1000 M0 988H1000" />
            <Corners>
              <path d="M27 145Q27 27 145 27 M37 145Q37 37 145 37" />
              <path d="M74 74C36 43 82 32 82 66C84 26 123 52 88 75C128 53 125 102 89 85C125 103 83 126 82 90C82 127 40 102 73 85C39 101 35 60 74 74Z" fill="#e9f1fb" />
              <circle cx="81" cy="79" r="7" fill="#2855a0" />
            </Corners>
            {SEVEN.map((i) => <path key={i} d={`M${218 + i * 82} 26q20 44 40 0m-32 0q12 28 24 0 M${218 + i * 82} 974q20-44 40 0m-32 0q12-28 24 0`} opacity=".75" />)}
          </g>
        </>
      );
    case 'arcade':
      return (
        <g shapeRendering="crispEdges">
          <defs>
            <pattern id={`${id}-scan`} width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 0h8v2H0Z" fill="#75f7bd" fillOpacity=".1" /></pattern>
          </defs>
          <path d="M0 0h22v1000H0Z M978 0h22v1000h-22Z" fill={`url(#${id}-scan)`} />
          <Corners>
            <path d="M18 114V42h24V18h108v10H52v24H28v62Z" fill="#84f8bd" />
            <path d="M40 85V61h24V37h72v10H74v24H50v14Z" fill="#fbd66d" />
            <path d="M59 108h20v20H59Z M86 108h20v20H86Z M113 108h20v20h-20Z" fill="#ef769a" />
          </Corners>
          <g fill="#fbd66d" className="roulette-atmosphere__motion roulette-atmosphere__pixel">
            <path d="M364 22h12v12h-12Z M388 22h12v12h-12Z M412 22h12v12h-12Z M576 966h12v12h-12Z M600 966h12v12h-12Z M624 966h12v12h-12Z" />
          </g>
        </g>
      );
    case 'sakura':
      return (
        <>
          <Corners opposite>
            <path d="M16 16H180A164 164 0 0 1 16 180Z" fill="#fce4e9" fillOpacity=".58" stroke="#d995a5" strokeWidth="2" />
            <g fill="none" stroke="#c48777" strokeWidth="1.5">
              <path d="M16 16l161 29 M16 16l149 69 M16 16l116 116 M16 16l69 149 M16 16l29 161 M39 16A23 23 0 0 1 16 39" />
              <path d="M165 16A149 149 0 0 1 16 165" stroke="#fff5f6" strokeWidth="4" />
            </g>
          </Corners>
          {[['48', '335'], ['932', '610'], ['81', '735'], ['907', '198']].map(([x, y], i) => (
            <g key={i} transform={`translate(${x} ${y}) rotate(${i * 64})`}>
              <path d="M0 0C-18-22-15-40 0-32C15-40 18-22 0 0Z" fill="#f4b7c9" stroke="#d888a5" strokeWidth="1" className={`roulette-atmosphere__motion roulette-atmosphere__petal ${i % 2 ? 'roulette-atmosphere__delayed' : ''}`} />
            </g>
          ))}
        </>
      );
    case 'ocean':
      return (
        <g fill="none">
          <Corners>
            <path d="M20 185A165 165 0 0 1 185 20 M30 185A155 155 0 0 1 185 30" stroke="#79c9d2" strokeWidth="2" />
            <path d="M24 151l8 1 M61 73l6 6 M151 24l1 8" stroke="#d9e4d3" strokeWidth="5" />
          </Corners>
          <g stroke="#65d6d5" strokeWidth="2" className="roulette-atmosphere__motion roulette-atmosphere__wave">
            <path d="M-40 950Q40 914 120 950T280 950T440 950T600 950T760 950T920 950T1080 950" opacity=".65" />
            <path d="M-40 973Q40 937 120 973T280 973T440 973T600 973T760 973T920 973T1080 973" opacity=".28" />
          </g>
          {SIDES.map((transform, i) => (
            <g key={i} transform={transform} stroke="#aeedef" strokeWidth="1.5">
              <g className={`roulette-atmosphere__motion roulette-atmosphere__bubble ${i ? 'roulette-atmosphere__delayed' : ''}`}>
                <circle cx="43" cy="645" r="7" /><circle cx="62" cy="715" r="4" /><circle cx="38" cy="752" r="10" />
              </g>
            </g>
          ))}
        </g>
      );
    case 'solar':
      return (
        <g fill="none" stroke="#f7bd59">
          <g className="roulette-atmosphere__motion roulette-atmosphere__corona">
            {Array.from({ length: 32 }, (_, i) => (
              <g key={i} transform={`rotate(${i * 11.25} 500 500)`}>
                <path d={`M500 ${i % 4 === 0 ? -20 : 16}V${i % 2 ? 51 : 76}`} strokeWidth={i % 4 === 0 ? 4 : 1.5} />
                {i % 4 === 0 ? <path d="M492 45l8 29 8-29" stroke="#f08447" strokeWidth="1.5" /> : null}
              </g>
            ))}
          </g>
          <path d="M285 36Q500-39 715 36 M285 964Q500 1039 715 964" strokeWidth="2" opacity=".55" />
          <path d="M8 285Q70 500 8 715 M992 285Q930 500 992 715" stroke="#f08447" strokeWidth="3" opacity=".45" />
        </g>
      );
    case 'cyber':
      return (
        <g fill="none" stroke="var(--roulette-accent,#6ee7b7)" strokeWidth="2" strokeLinejoin="miter">
          <Corners>
            <path d="M16 174V54l38-38h120 M32 170V61l29-29h109" />
            <path d="M19 244h25V130l44-44h134 M19 290h39V146l46-46h91" opacity=".5" />
            <path d="M70 41h43 M41 70v43" stroke="var(--roulette-accent-2,#df94e4)" strokeWidth="5" />
            <circle cx="227" cy="86" r="5" /><circle cx="200" cy="100" r="4" />
          </Corners>
          <g className="roulette-atmosphere__motion roulette-atmosphere__signal" fill="var(--roulette-accent-2,#df94e4)" stroke="none">
            <path d="M40 209h8v15h-8Z M952 776h8v15h-8Z M177 96h16v8h-16Z M807 896h16v8h-16Z" />
          </g>
        </g>
      );
    case 'gold':
      return (
        <g fill="none" stroke="#d9b464" strokeWidth="1.5">
          <Corners>
            <path d="M18 204A186 186 0 0 1 204 18 M26 204A178 178 0 0 1 204 26 M34 204A170 170 0 0 1 204 34" />
            <path d="M41 173Q70 63 173 41" strokeWidth="2.5" />
            {SEVEN.map((i) => (
              <g key={i} transform={`rotate(${i * 11} 204 204)`}>
                <path d="M42 194Q20 184 37 169Q54 178 42 194Z" fill="#c99f48" fillOpacity=".28" />
                <path d="M26 194h7 M22 184l9 1" strokeWidth="1" />
              </g>
            ))}
          </Corners>
          <g className="roulette-atmosphere__motion roulette-atmosphere__engraving">
            <path d="M370 24Q435 5 500 24Q565 43 630 24 M370 24Q435 43 500 24Q565 5 630 24 M370 976Q435 957 500 976Q565 995 630 976 M370 976Q435 995 500 976Q565 957 630 976" />
            <path d="M489 24l11-7 11 7-11 7Z M489 976l11-7 11 7-11 7Z" fill="#f4dda0" fillOpacity=".5" />
          </g>
        </g>
      );
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export const RouletteThemeAtmosphere = React.memo(function RouletteThemeAtmosphere({
  kind,
  active,
  compact = false,
}: {
  kind: RouletteAtmosphereKind;
  active: boolean;
  compact?: boolean;
}) {
  const id = `roulette-atmosphere-${useId().replace(/:/g, '')}`;
  useAtmosphereStyles();
  return (
    <div
      className={`roulette-atmosphere ${active ? 'roulette-atmosphere--active' : ''} ${compact ? 'roulette-atmosphere--compact' : ''}`}
      data-kind={kind}
      aria-hidden="true"
    >
      <svg className="roulette-atmosphere__art" viewBox="0 0 1000 1000" preserveAspectRatio="none" focusable="false">
        <defs>
          <clipPath id={`${id}-edge`}>
            {/* A hard empty center also contains animated motifs, without painting an OBS backdrop. */}
            <path clipRule="evenodd" d={compact
              ? 'M0 0H1000V1000H0Z M180 85H820L915 180V820L820 915H180L85 820V180Z'
              : 'M0 0H1000V1000H0Z M230 100H770L880 210V790L770 900H230L120 790V210Z'} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${id}-edge)`}><ThemeMotif kind={kind} id={id} /></g>
      </svg>
    </div>
  );
});

