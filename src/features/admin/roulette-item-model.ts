export type EditableRouletteItem = {
  id: string;
  label: string;
  weight: string;
  value: string;
};

export type PersistedRouletteItem = {
  label?: string;
  value?: string | null;
  weight?: number;
  probability?: number;
};

export function createEditableRouletteItem(seed: string, item?: Partial<EditableRouletteItem>): EditableRouletteItem {
  return {
    id: `${seed}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    label: item?.label ?? '',
    weight: item?.weight ?? '1',
    value: item?.value ?? '',
  };
}

export function createDefaultRouletteItems(): EditableRouletteItem[] {
  return [
    createEditableRouletteItem('roulette_item', { label: '당첨', weight: '1' }),
    createEditableRouletteItem('roulette_item', { label: '한 번 더', weight: '1' }),
    createEditableRouletteItem('roulette_item', { label: '꽝', weight: '1' }),
  ];
}

export function toEditableRouletteItems(items?: PersistedRouletteItem[]): EditableRouletteItem[] {
  const next = (items || [])
    .map((item, index) => createEditableRouletteItem(`roulette_item_${index}`, {
      label: String(item?.label || ''),
      weight: String(Math.max(1, Number(item?.weight ?? item?.probability ?? 1) || 1)),
      value: item?.value == null ? '' : String(item.value),
    }))
    .filter((item) => item.label.trim());
  return next.length >= 2 ? next : createDefaultRouletteItems();
}

export function normalizeEditableRouletteItems(items: EditableRouletteItem[]) {
  return items
    .map((item) => ({
      label: item.label.trim(),
      value: item.value.trim() ? item.value.trim() : null,
      weight: Math.max(1, Number(item.weight || 1)),
    }))
    .filter((item) => item.label);
}
