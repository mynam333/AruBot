import { getWheelThemeId, type WheelThemeId } from '../rouletteWheelUtils';
import type { RouletteThemeArtwork } from './types';
import studio from './studio';
import prism from './prism';
import aurora from './aurora';
import velvet from './velvet';
import mono from './mono';
import deco from './deco';
import crystal from './crystal';
import ink from './ink';
import nova from './nova';
import ceramic from './ceramic';
import arcade from './arcade';
import sakura from './sakura';
import ocean from './ocean';
import solar from './solar';
import cyber from './cyber';
import gold from './gold';

export const rouletteThemeArtworks: Record<WheelThemeId, RouletteThemeArtwork> = {
  studio, prism, aurora, velvet, mono, deco, crystal, ink,
  nova, ceramic, arcade, sakura, ocean, solar, cyber, gold,
};

export function getRouletteThemeArtwork(themeId: string): RouletteThemeArtwork {
  return rouletteThemeArtworks[getWheelThemeId(String(themeId || '').toLowerCase())];
}
