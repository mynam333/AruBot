function hashRouletteSpinSeed(value) {
  const text = String(value || 'arubot-roulette').normalize('NFC');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createRouletteSpinRandom(seed) {
  let state = hashRouletteSpinSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function resolveRouletteSpinSeed(meta, finalLabel) {
  const spinId = String(meta?.spinId || '').trim();
  if (spinId) return spinId;
  return [meta?.name, meta?.label, meta?.value, meta?.createdAt, finalLabel]
    .map((value) => String(value ?? ''))
    .join('|');
}
