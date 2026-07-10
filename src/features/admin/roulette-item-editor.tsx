'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  createEditableRouletteItem,
  normalizeEditableRouletteItems,
  type EditableRouletteItem,
} from './roulette-item-model';

export function RouletteItemsEditor({
  items,
  onChange,
}: {
  items: EditableRouletteItem[];
  onChange: (items: EditableRouletteItem[]) => void;
}) {
  const updateItem = (id: string, patch: Partial<EditableRouletteItem>) => {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const addItem = () => {
    onChange([...items, createEditableRouletteItem('roulette_item', { weight: '1' })]);
  };

  const removeItem = (id: string) => {
    if (items.length <= 2) return;
    onChange(items.filter((item) => item.id !== id));
  };

  const validItems = normalizeEditableRouletteItems(items);
  const totalWeight = validItems.reduce((sum, item) => sum + item.weight, 0);

  return (
    <div className="grid gap-[clamp(0.85rem,1.7vw,1.15rem)]">
      <div className="flex flex-wrap items-center justify-between gap-[clamp(0.65rem,1.2vw,0.9rem)]">
        <div className="flex flex-wrap items-center gap-[clamp(0.5rem,1vw,0.75rem)]">
          <Badge tone="lemon">항목 {validItems.length}개</Badge>
          <Badge tone="neutral">총 가중치 {totalWeight || 0}</Badge>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addItem}>
          <Plus className="h-[1em] w-[1em]" />
          항목 추가
        </Button>
      </div>

      <div className="grid gap-[clamp(0.75rem,1.4vw,1rem)]">
        {items.map((item, index) => (
          <div
            key={item.id}
            className="grid min-w-0 gap-[clamp(0.65rem,1.2vw,0.9rem)] rounded-[var(--radius-control)] border bg-background/72 p-[clamp(0.85rem,1.6vw,1.1rem)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.38fr)_minmax(0,1.2fr)_minmax(var(--control-height),0.18fr)] lg:items-end"
          >
            <label className="grid min-w-0 gap-[clamp(0.4rem,0.8vw,0.6rem)] text-sm font-semibold">
              항목 이름
              <Input
                value={item.label}
                onChange={(event) => updateItem(item.id, { label: event.target.value })}
                placeholder={`항목 ${index + 1}`}
              />
            </label>
            <label className="grid min-w-0 gap-[clamp(0.4rem,0.8vw,0.6rem)] text-sm font-semibold">
              가중치
              <Input
                value={item.weight}
                onChange={(event) => updateItem(item.id, { weight: event.target.value })}
                inputMode="numeric"
                placeholder="1"
              />
            </label>
            <label className="grid min-w-0 gap-[clamp(0.4rem,0.8vw,0.6rem)] text-sm font-semibold">
              실행 액션
              <Input
                value={item.value}
                onChange={(event) => updateItem(item.id, { value: event.target.value })}
                placeholder="비워두거나 ${action::이름}"
              />
            </label>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={`${item.label || `항목 ${index + 1}`} 삭제`}
              onClick={() => removeItem(item.id)}
              disabled={items.length <= 2}
              className="justify-self-end text-destructive hover:border-destructive/35 hover:bg-destructive/10"
            >
              <Trash2 className="h-[1em] w-[1em]" />
            </Button>
          </div>
        ))}
      </div>

      <div className="rounded-[var(--radius-control)] border bg-muted/45 p-[clamp(0.85rem,1.6vw,1.1rem)] text-sm leading-6 text-muted-foreground">
        가중치가 높을수록 더 자주 뽑힙니다. 실행 액션은 비워둘 수 있고, 자동화 액션을 연결할 때만 입력하면 됩니다.
      </div>
    </div>
  );
}
