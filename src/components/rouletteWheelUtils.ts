export type WheelSkinFamily = 'velvet' | 'prism' | 'mono' | 'deco' | 'crystal' | 'ink' | 'nova' | 'ceramic' | 'arcade';

export type WheelThemeId = 'studio' | 'prism' | 'aurora' | 'velvet' | 'mono' | 'deco' | 'crystal' | 'ink' | 'nova' | 'ceramic' | 'arcade' | 'sakura' | 'ocean' | 'solar' | 'cyber' | 'gold';

export type WheelSegment = { start: number; end: number; span: number; center: number };

export function createWheelSegments(count: number, weights?: number[]): WheelSegment[] {
  const size = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (!size) return [];
  let largest = 0;
  let valid = Array.isArray(weights) && weights.length === size;
  if (valid) {
    for (let index = 0; index < size; index += 1) {
      const weight = weights![index];
      if (!Number.isFinite(weight) || weight < 0) {
        valid = false;
        break;
      }
      largest = Math.max(largest, weight);
    }
  }
  if (!valid || largest === 0) {
    return Array.from({ length: size }, (_, index) => {
      const start = index / size * 360;
      const end = (index + 1) / size * 360;
      return { start, end, span: end - start, center: (start + end) / 2 };
    });
  }

  // Scale before summing so finite, very large weights cannot overflow the total.
  const scaled = weights!.map((weight) => weight / largest);
  let total = 0;
  let correction = 0;
  let lastPositive = 0;
  for (let index = 0; index < size; index += 1) {
    const value = scaled[index];
    if (value > 0) lastPositive = index;
    const adjusted = value - correction;
    const next = total + adjusted;
    correction = (next - total) - adjusted;
    total = next;
  }
  let cursor = 0;
  let cumulative = 0;
  correction = 0;
  return scaled.map((value, index) => {
    const start = cursor;
    if (value > 0) {
      const adjusted = value - correction;
      const next = cumulative + adjusted;
      correction = (next - cumulative) - adjusted;
      cumulative = next;
      cursor = index === lastPositive ? 360 : Math.max(start, Math.min(360, cumulative / total * 360));
    }
    const span = cursor - start;
    return { start, end: cursor, span, center: start + span / 2 };
  });
}

const wheelThemes = new Set<string>(['studio', 'prism', 'aurora', 'velvet', 'mono', 'deco', 'crystal', 'ink', 'nova', 'ceramic', 'arcade', 'sakura', 'ocean', 'solar', 'cyber', 'gold']);
const legacyThemes: Record<string, WheelThemeId> = {
  classic: 'studio', pastel: 'prism', forest: 'aurora', midnight: 'mono',
  ice: 'ocean', fire: 'solar', sunset: 'solar',
};

export function getWheelThemeId(themeId: string): WheelThemeId {
  return wheelThemes.has(themeId) ? themeId as WheelThemeId : legacyThemes[themeId] || 'studio';
}

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

const graphemeSegmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

export function wheelLabelGraphemes(label: string): string[] {
  return graphemeSegmenter
    ? Array.from(graphemeSegmenter.segment(label), ({ segment }) => segment)
    : Array.from(label);
}

export function splitWheelLabel(label: string): string[] {
  const clean = label.trim().replace(/\s+/gu, ' ');
  if (!clean) return ['룰렛'];
  const graphemes = wheelLabelGraphemes(clean);
  if (graphemes.length < 7) return [clean];
  const parts = clean.split(' ');
  if (parts.length > 1) {
    const splitAt = Math.ceil(parts.length / 2);
    let bestSplit = splitAt;
    let bestDifference = Infinity;
    let prefixLength = 0;
    for (let index = 1; index < parts.length; index += 1) {
      prefixLength += wheelLabelGraphemes(parts[index - 1]).length + (index > 1 ? 1 : 0);
      const difference = Math.abs(prefixLength - (graphemes.length - prefixLength - 1));
      if (difference < bestDifference) {
        bestDifference = difference;
        bestSplit = index;
      }
    }
    const lines = [parts.slice(0, bestSplit).join(' '), parts.slice(bestSplit).join(' ')];
    if (Math.min(...lines.map((line) => wheelLabelGraphemes(line).length)) >= graphemes.length * .22) return lines;
  }
  const midpoint = Math.ceil(graphemes.length / 2);
  return [graphemes.slice(0, midpoint).join('').trim(), graphemes.slice(midpoint).join('').trim()].filter(Boolean);
}

export function wheelLabelForeground(color: string, fallback = '#151719'): string {
  const hex = color.trim().match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i)?.[1];
  const rgb = color.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)/i);
  const channels = hex
    ? (hex.length === 3 ? Array.from(hex, (value) => parseInt(value + value, 16)) : [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)))
    : rgb ? rgb.slice(1, 4).map(Number) : null;
  if (!channels) return fallback;
  const [red, green, blue] = channels.map((value) => {
    const channel = Math.max(0, Math.min(255, value)) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  const luminance = .2126 * red + .7152 * green + .0722 * blue;
  // Compare the actual near-black ink and white, not a midpoint in RGB space.
  return (luminance + .05) / .0584 >= 1.05 / (luminance + .05) ? '#151719' : '#ffffff';
}
