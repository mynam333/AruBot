import { getRouletteThemeMaterial } from './rouletteThemeMaterials';

export function RouletteThemeSwatch({ themeId }: { themeId: string }) {
  const material = getRouletteThemeMaterial(themeId);
  return (
    <span
      aria-hidden="true"
      className="relative grid h-[var(--control-height)] w-[var(--control-height)] shrink-0 place-items-center overflow-hidden rounded-[var(--radius-control)] border shadow-subtle"
      style={{ ...material.css, background: 'var(--roulette-backdrop)', borderColor: 'var(--roulette-rim-line)' }}
    >
      <span className="absolute inset-[13%] rounded-full" style={{ background: 'var(--roulette-rim-outer)', boxShadow: '0 0 14px var(--roulette-pointer-core)' }} />
      <span className="absolute inset-[22%] rounded-full" style={{ background: 'conic-gradient(from 20deg,var(--roulette-pointer),var(--roulette-pointer-core),var(--roulette-pointer),var(--roulette-pointer-core),var(--roulette-pointer))' }} />
      <span className="absolute inset-[40%] rounded-full border" style={{ background: 'var(--roulette-hub)', borderColor: 'var(--roulette-hub-line)' }} />
      <span className="absolute left-1/2 top-[12%] h-[18%] w-[12%] -translate-x-1/2 [clip-path:polygon(0_0,100%_0,50%_100%)]" style={{ background: 'var(--roulette-pointer-core)' }} />
    </span>
  );
}
