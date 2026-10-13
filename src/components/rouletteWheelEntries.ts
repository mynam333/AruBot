/** Keep server entry order and weights together, including duplicate labels. */
export function buildRouletteWheelEntries(
  items: string[], finalLabel: string, itemWeights?: number[] | null, selectedItemIndex?: number | null,
) {
  const validWeights = Array.isArray(itemWeights) && itemWeights.length === items.length
    && itemWeights.every(weight => Number.isFinite(weight) && weight >= 0)
    && itemWeights.some(weight => weight > 0);
  const entries = items.map((label, index) => ({
    label: String(label ?? '').trim(), weight: validWeights ? itemWeights![index] : 1, sourceIndex: index,
  })).filter(entry => entry.label);
  const result = String(finalLabel ?? '').trim();
  const matches = (label: string) => label.normalize('NFC') === result.normalize('NFC');
  let selectedIndex = entries.findIndex(entry => entry.sourceIndex === selectedItemIndex && entry.weight > 0 && matches(entry.label));
  if (selectedIndex < 0) selectedIndex = entries.findIndex(entry => entry.weight > 0 && matches(entry.label));
  if (selectedIndex < 0 && result) {
    selectedIndex = entries.length;
    entries.push({ label: result, weight: 1, sourceIndex: -1 });
  }
  return {
    items: entries.map(entry => entry.label),
    weights: entries.map(entry => entry.weight),
    selectedIndex: Math.max(0, selectedIndex),
  };
}
