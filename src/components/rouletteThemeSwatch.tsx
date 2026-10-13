import { getRouletteThemeMaterial } from './rouletteThemeMaterials';
import { getRouletteThemeArtwork } from './rouletteThemes';

export function RouletteThemeSwatch({ themeId }: { themeId: string }) {
  const artwork = getRouletteThemeArtwork(themeId);
  const material = getRouletteThemeMaterial(themeId, artwork);
  return (
    <span
      aria-hidden="true"
      data-roulette-swatch={material.atmosphere}
      className="relative grid h-[var(--control-height)] w-[var(--control-height)] shrink-0 place-items-center overflow-hidden rounded-[var(--radius-control)] border"
      style={{ ...material.css, background: 'var(--roulette-backdrop)', borderColor: 'var(--roulette-line)' }}
    >
      <svg viewBox="0 0 64 64" fill="none" className="h-full w-full" focusable="false" aria-hidden="true">
        {artwork.swatch}
      </svg>
    </span>
  );
}
