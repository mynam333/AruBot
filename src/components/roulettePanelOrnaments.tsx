import React from 'react';
import { getRouletteThemeArtwork } from './rouletteThemes';
import { getRouletteThemeMaterial } from './rouletteThemeMaterials';

const accent = 'var(--roulette-accent, currentColor)';

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
              {getRouletteThemeArtwork(themeId).panel}
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
      {getRouletteThemeArtwork(themeId).hub}
    </svg>
  );
});
