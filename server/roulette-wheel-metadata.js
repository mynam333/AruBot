export function getRouletteWheelMetadata(def, picked = null) {
  const entries = (Array.isArray(def?.items) ? def.items : []).filter(item => item && typeof item.label === 'string' && item.label);
  const items = entries.map(item => item.label);
  let itemWeights = entries.map(item => {
    const value = Number(def?.type === 'probability' ? item.probability : item.weight);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  });
  if (!Number.isFinite(itemWeights.reduce((sum, weight) => sum + weight, 0))) {
    const max = itemWeights.reduce((largest, weight) => Math.max(largest, weight), 0);
    itemWeights = itemWeights.map(weight => weight / max);
  }
  // Legacy all-zero weighted definitions choose the first item deterministically.
  if (items.length && !itemWeights.some(weight => weight > 0) && def?.type !== 'probability') itemWeights[0] = 1;
  let selectedItemIndex = null;
  if (Number.isInteger(picked?.selectedItemIndex) && picked.selectedItemIndex >= 0 && picked.selectedItemIndex < entries.length) {
    selectedItemIndex = picked.selectedItemIndex;
  } else if (picked) {
    const matches = entries.flatMap((item, index) => item.label === picked.label && String(item.value ?? '') === String(picked.value ?? '') ? [index] : []);
    if (matches.length === 1) selectedItemIndex = matches[0];
  }
  return { items, itemWeights, selectedItemIndex };
}
