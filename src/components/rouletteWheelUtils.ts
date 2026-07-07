export type WheelSkinFamily = 'velvet' | 'prism' | 'mono' | 'deco' | 'crystal' | 'ink' | 'nova' | 'ceramic' | 'arcade';

export function getWheelSkinFamily(themeId: string): WheelSkinFamily {
  if (themeId === 'deco') return 'deco';
  if (themeId === 'crystal' || themeId === 'ocean' || themeId === 'ice') return 'crystal';
  if (themeId === 'ink') return 'ink';
  if (themeId === 'nova' || themeId === 'midnight') return 'nova';
  if (themeId === 'ceramic') return 'ceramic';
  if (themeId === 'arcade' || themeId === 'cyber') return 'arcade';
  if (themeId === 'velvet' || themeId === 'gold' || themeId === 'solar') return 'velvet';
  if (themeId === 'mono' || themeId === 'studio' || themeId === 'classic') return 'mono';
  return 'prism';
}

export function splitWheelLabel(label: string): string[] {
  const clean = label.trim();
  if (!clean) return ['룰렛'];
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length > 1 && clean.length >= 5) {
    const splitAt = Math.ceil(parts.length / 2);
    return [parts.slice(0, splitAt).join(' '), parts.slice(splitAt).join(' ')];
  }
  if (clean.length >= 7) return [clean.slice(0, Math.ceil(clean.length / 2)), clean.slice(Math.ceil(clean.length / 2))];
  return [clean];
}
