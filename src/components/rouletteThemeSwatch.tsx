import type { ReactNode } from 'react';
import { getRouletteThemeMaterial, type RouletteAtmosphereKind } from './rouletteThemeMaterials';

// Static, ID-free geometry keeps repeated picker instances cheap and SSR-safe.
const swatchArt: Record<RouletteAtmosphereKind, ReactNode> = {
  precision: <>
    <rect x="6" y="7" width="52" height="50" rx="4" fill="#e5e9e7" stroke="#858f8c" strokeWidth="2" />
    <circle cx="32" cy="33" r="21" fill="#25292d" />
    <circle cx="32" cy="33" r="17" fill="#f8faf8" stroke="#bdc5c2" strokeWidth="2" />
    <path d="M32 16v5m17 12h-5M32 50v-5M15 33h5M20 21l4 4m20-4-4 4M20 45l4-4m20 4-4-4" stroke="#535d60" strokeWidth="2" />
    <path d="M32 33 40 22" stroke="#ec3c35" strokeWidth="3" strokeLinecap="round" />
    <circle cx="32" cy="33" r="4" fill="#25292d" />
    <rect x="44" y="6" width="10" height="5" rx="1" fill="#ec3c35" />
    <path d="M12 55h10m4 0h5" stroke="#858f8c" strokeWidth="2" />
  </>,
  spectrum: <>
    <path d="m32 4 25 15v29L32 61 7 46V18Z" fill="#174eff" />
    <path d="m32 4 25 15-25 13Z" fill="#eaf7ff" />
    <path d="m57 19 0 29-25-16Z" fill="#ff6757" />
    <path d="m57 48-25 13V32Z" fill="#ffe64b" />
    <path d="M32 61 7 46l25-14Z" fill="#19bfa3" />
    <path d="M7 18 32 4v28Z" fill="#446fff" />
    <path d="m7 18 25 14L7 46Z" fill="#ffb8b0" />
    <path d="m32 4 0 57M7 18l50 30M57 19 7 46" stroke="#ffffff" strokeWidth="1.5" opacity=".75" />
    <path d="m32 21 10 11-10 10-10-10Z" fill="#ffffff" stroke="#174eff" strokeWidth="2" />
  </>,
  aurora: <>
    <path d="M8 45C-2 26 15 4 34 6c21 0 31 25 19 41-10 15-37 15-45-2Z" fill="#064d3c" stroke="#168768" strokeWidth="2" />
    <path d="M5 38C19 10 39 45 58 15" fill="none" stroke="#71f5c3" strokeWidth="8" />
    <path d="M8 43C24 17 38 55 58 28" fill="none" stroke="#168768" strokeWidth="5" />
    <path d="M12 51C24 26 44 51 56 36" fill="none" stroke="#c0b4fa" strokeWidth="4" />
    <path d="M8 32C22 15 39 34 53 16" fill="none" stroke="#c6ffe4" strokeWidth="2" />
    <path d="m30 7 6 0-3 8Z" fill="#c6ffe4" />
  </>,
  velvet: <>
    <path d="M32 5c4-5 9 1 10 4 6-3 11 2 10 7 6 0 8 6 5 11 5 4 4 10-1 13 3 5-2 11-7 10-1 7-8 9-12 5-4 6-11 5-13 0-6 3-12-1-11-7-7 0-10-6-6-11-5-4-4-11 1-13-2-6 2-11 8-10 1-7 8-10 13-6Z" fill="#e7ba71" />
    <circle cx="32" cy="32" r="23" fill="#8f1234" stroke="#520d22" strokeWidth="2" />
    <path d="M13 17c8 15 14 17 19 5 5 12 11 10 19-5M12 23c5 20 15 28 20 24 5 4 15-4 20-24" fill="none" stroke="#d74760" strokeWidth="3" />
    <path d="M16 16q8 17 16 5 8 12 16-5" fill="none" stroke="#ffe4b2" strokeWidth="2" />
    <path d="m32 29 5 8-5 8-5-8Z" fill="#e7ba71" />
    <circle cx="32" cy="9" r="3" fill="#ffe4b2" />
  </>,
  mono: <>
    <path d="M3 6h58v5H3zm0 47h58v5H3Z" fill="#111111" />
    <circle cx="32" cy="32" r="19" fill="#ffffff" stroke="#111111" strokeWidth="4" />
    <path d="M32 13a19 19 0 0 1 19 19H32Zm0 19v19a19 19 0 0 1-19-19Z" fill="#111111" />
    <circle cx="32" cy="32" r="5" fill="#ffffff" stroke="#111111" strokeWidth="2" />
    <path d="m45 10 12 0-6 10Z" fill="#111111" />
    <path d="M4 27v10m56-10v10" stroke="#111111" strokeWidth="3" />
  </>,
  deco: <>
    <path d="M24 3h16v7h9v9h9v26h-9v9h-9v7H24v-7h-9v-9H6V19h9v-9h9Z" fill="#111615" stroke="#d1af68" strokeWidth="2" />
    <path d="M32 49 13 30l3-11 10-7h12l10 7 3 11Z" fill="#263025" stroke="#d1af68" strokeWidth="1.5" />
    <path d="M32 49V12m0 37L16 19m16 30 16-30M32 49 13 30m19 19 19-19M32 49l-6-37m6 37 6-37" stroke="#d1af68" strokeWidth="1.5" />
    <path d="m32 27 8 10-8 12-8-12Z" fill="#e9d9a3" stroke="#111615" strokeWidth="2" />
    <path d="M23 54h18" stroke="#d1af68" strokeWidth="2" />
  </>,
  crystal: <>
    <path d="m20 5 26 3 14 19-8 25-27 9L5 41 4 19Z" fill="#f5fdff" stroke="#89adbd" strokeWidth="1.5" />
    <path d="M20 5 18 25 4 19m14 6 7 36L5 41Zm0 0 28-17-9 19Zm19 2 23 0-8 25Zm0 0-12 34 27-9Z" fill="#a8d9ed" />
    <path d="m18 25 19 2-12 34Z" fill="#e5f8ff" />
    <path d="m18 25 19 2 9-19m-9 19 15 25M18 25 5 41m13-16 2-20m17 22-12 34" fill="none" stroke="#ffffff" strokeWidth="2" />
    <path d="m27 19 9 2 5 11-8 10-12-9Z" fill="#ffffff" fillOpacity=".8" stroke="#89adbd" strokeWidth="1.5" />
    <path d="M42 12v12m-6-6h12" stroke="#ffffff" strokeWidth="2" />
  </>,
  ink: <>
    <path d="M9 8 58 5 55 59 5 56Z" fill="#f5f4ef" />
    <path d="M42 12C20 0 3 22 10 39c5 15 26 22 40 9 9-9 8-22-1-30 8 15 0 29-12 30-13 1-22-8-21-19 1-10 13-18 26-17Z" fill="#272824" />
    <path d="M17 15C8 23 7 33 12 42m33 9c8-5 13-17 9-27" fill="none" stroke="#62665e" strokeWidth="1.5" />
    <path d="m6 16 7-6m35 0 5 5M8 44l4 5" stroke="#999b8f" strokeWidth="1" />
    <path d="M39 39h15v16H39Z" fill="#ac302e" />
    <path d="M42 42h9v10h-9Zm4 0v10m-4-5h9" fill="none" stroke="#f5f4ef" strokeWidth="1.2" />
  </>,
  nova: <>
    <circle cx="32" cy="32" r="24" fill="#121b20" stroke="#ca8f66" strokeWidth="2" />
    <ellipse cx="32" cy="32" rx="29" ry="12" transform="rotate(-32 32 32)" fill="none" stroke="#ca8f66" strokeWidth="1.5" />
    <circle cx="32" cy="32" r="16" fill="none" stroke="#72d5df" strokeWidth="1" strokeDasharray="3 3" />
    <path d="M32 5v10m0 34v10M5 32h10m34 0h10" stroke="#72d5df" strokeWidth="2" />
    <path d="M23 32h18m-9-9v18" stroke="#72d5df" strokeWidth="1" />
    <path d="m32 24 5 8-5 8-5-8Z" fill="#ca8f66" />
    <circle cx="53" cy="17" r="3" fill="#efcfb4" />
    <path d="M11 49h8m-4-4v8" stroke="#efcfb4" strokeWidth="1.5" />
  </>,
  ceramic: <>
    <circle cx="32" cy="32" r="28" fill="#fffefa" stroke="#1748a0" strokeWidth="2" />
    <circle cx="32" cy="32" r="24" fill="none" stroke="#6087c2" strokeWidth="1" />
    <circle cx="32" cy="32" r="18" fill="#f6f8fc" stroke="#1748a0" strokeWidth="2" />
    {[0, 60, 120, 180, 240, 300].map(angle => <g key={angle} transform={`rotate(${angle} 32 32)`}>
      <path d="M29 10q3-6 6 0-3 6-6 0" fill="#1748a0" />
      <path d="M32 32c-10-1-12-10-7-12 5 0 6 7 7 12" fill="#6087c2" />
    </g>)}
    <circle cx="32" cy="32" r="4" fill="#1748a0" />
  </>,
  arcade: <>
    <path d="M12 4h40v5h5v42h-5v9H12v-9H7V9h5Z" fill="#ffdc42" />
    <path d="M15 13h34v26H15Z" fill="#171b1c" />
    <path d="M20 8h24v3H20Z" fill="#ef4b44" />
    <path d="M27 17h10v4h5v11h-5v4H27v-4h-5V21h5Z" fill="#23c9b5" />
    <path d="M29 23h6v7h-6Z" fill="#171b1c" />
    <path d="M12 43h40v5H12Z" fill="#ef4b44" />
    <path d="M21 43v10m-4-5h8" stroke="#171b1c" strokeWidth="3" />
    <path d="M37 50h5v5h-5Zm8-3h5v5h-5Z" fill="#171b1c" />
  </>,
  sakura: <>
    <path d="M32 55 3 29C10 4 47-5 61 29Z" fill="#f3bacb" stroke="#b74465" strokeWidth="2" />
    <path d="M32 55 7 21l9-7Zm0 0L26 9l11-1Zm0 0L48 13l8 9Z" fill="#fff0f1" />
    <path d="M32 55 7 21m25 34L16 14m16 41L26 9m6 46 5-47m-5 47 16-42m-16 42 24-33m-24 33 29-26" stroke="#9e5269" strokeWidth="1.2" />
    <path d="M3 29C10 4 47-5 61 29" fill="none" stroke="#723147" strokeWidth="4" />
    <path d="M32 55v6" stroke="#723147" strokeWidth="4" />
    <circle cx="32" cy="53" r="3" fill="#e5c293" />
  </>,
  ocean: <>
    <circle cx="32" cy="32" r="28" fill="#b6c9ce" stroke="#64919c" strokeWidth="2" />
    <circle cx="32" cy="32" r="21" fill="#102f46" stroke="#e6fff7" strokeWidth="2" />
    <path d="M12 34c7-11 16 11 24 0 7-9 12-6 16 0a20 20 0 0 1-40 0Z" fill="#1d6f86" />
    <path d="M15 42c7-9 12 9 22 0 4-5 8-5 12-1a20 20 0 0 1-34 1Z" fill="#2dcac1" />
    <path d="M16 29c5-7 10-1 13-3" fill="none" stroke="#d7f3ec" strokeWidth="2" strokeLinecap="round" />
    {[0, 45, 90, 135, 180, 225, 270, 315].map(angle => <circle key={angle} cx="32" cy="7" r="1.8" fill="#102f46" transform={`rotate(${angle} 32 32)`} />)}
  </>,
  solar: <>
    <path d="m32 2 5 11 10-7-1 13 13-1-7 11 10 5-12 5 7 11-13-2-1 13-10-8-6 10-4-12-12 5 3-13-12-3 9-9-7-10 13 0 2-12 9 9Z" fill="#ff6b24" />
    <circle cx="32" cy="32" r="20" fill="#fff5e8" stroke="#cf312b" strokeWidth="2" />
    <path d="M32 12a20 20 0 0 1 0 40Z" fill="#ffb348" />
    <circle cx="32" cy="32" r="12" fill="#f24825" />
    <circle cx="32" cy="32" r="6" fill="#fff5e8" />
    <path d="M21 20a16 16 0 0 1 11-4" fill="none" stroke="#ffffff" strokeWidth="2" />
  </>,
  cyber: <>
    <path d="M18 7h29l10 10v29L46 57H17L7 46V18Z" fill="#071c21" stroke="#23dfed" strokeWidth="2" />
    <path d="M19 16h23l6 7v20l-6 6H23l-7-7V23Z" fill="#144752" />
    <path d="M1 22h11l8 8m43 12H52l-8-8M43 1v11l-8 8M22 63V51l8-7" fill="none" stroke="#23dfed" strokeWidth="2" />
    <path d="M2 46h8l7 7M47 11l7 7h8" fill="none" stroke="#ee4dba" strokeWidth="3" />
    <path d="m32 22 10 10-10 10-10-10Z" fill="#d1fb42" />
    <path d="m32 28 4 4-4 4-4-4Z" fill="#071c21" />
    <path d="M19 6h12M38 58h10" stroke="#d1fb42" strokeWidth="3" />
  </>,
  gold: <>
    <circle cx="32" cy="32" r="28" fill="#e5cd90" stroke="#b28d4c" strokeWidth="2" />
    <circle cx="32" cy="32" r="25" fill="none" stroke="#0e523b" strokeWidth="4" strokeDasharray="3 5" />
    <circle cx="32" cy="32" r="20" fill="#0e523b" stroke="#fff0c7" strokeWidth="1.5" />
    <circle cx="32" cy="32" r="15" fill="#f2e4be" stroke="#b28d4c" strokeWidth="1.5" />
    <path d="m32 20 8 12-8 12-8-12Z" fill="#0e523b" />
    <path d="M15 27q-3 10 6 15m28-15q3 10-6 15" fill="none" stroke="#e5cd90" strokeWidth="2" />
    <path d="M14 28l5 2m-4 4 5 1m-3 5 5-1m28-11-5 2m4 4-5 1m3 5-5-1" stroke="#e5cd90" strokeWidth="1.5" />
  </>,
};

export function RouletteThemeSwatch({ themeId }: { themeId: string }) {
  const material = getRouletteThemeMaterial(themeId);
  return (
    <span
      aria-hidden="true"
      data-roulette-swatch={material.atmosphere}
      className="relative grid h-[var(--control-height)] w-[var(--control-height)] shrink-0 place-items-center overflow-hidden rounded-[var(--radius-control)] border"
      style={{ ...material.css, background: 'var(--roulette-backdrop)', borderColor: 'var(--roulette-line)' }}
    >
      <svg viewBox="0 0 64 64" fill="none" className="h-full w-full" focusable="false" aria-hidden="true">
        {swatchArt[material.atmosphere]}
      </svg>
    </span>
  );
}
