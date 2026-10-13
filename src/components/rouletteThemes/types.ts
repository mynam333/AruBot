import type { ReactNode } from 'react';
import type { WheelThemeId } from '../rouletteWheelUtils';

/** Artwork stays separate from weighted geometry and all spin state. */
export type RouletteThemeArtwork = {
  id: WheelThemeId;
  designNotes: string;
  palette?: string[];
  tokens?: Record<`--roulette-${string}`, string>;
  // Wheel coordinates: 1000 square, center 500, clear aperture radius 414.
  rim: (idPrefix: string) => ReactNode;
  // Pointer coordinates: 180 x 200, exactly one winning tip at (90, 190).
  pointer: (idPrefix: string) => ReactNode;
  // Panel: 100 square, left side only; the host mirrors it for the right side.
  panel: ReactNode;
  // Hub: 48 square. Picker: 64 square. Neither may contain text.
  hub: ReactNode;
  swatch: ReactNode;
};
