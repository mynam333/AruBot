'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Check, ChevronRight, Loader2, PencilLine, Play, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { RouletteCreateDialog } from '@/features/admin/admin-action-dialogs';
import { ViewerTokenPanel } from '@/features/admin/viewer-token-panel';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import {
  normalizeEditableRouletteItems,
  RouletteItemsEditor,
  toEditableRouletteItems,
  type EditableRouletteItem,
} from '@/features/admin/roulette-item-editor';
import { apiUrl, readJson } from '@/shared/api/http';

type RouletteItem = {
  label?: string;
  value?: string | null;
  weight?: number;
  probability?: number;
};

type RouletteDefinition = {
  id?: string;
  name: string;
  type?: string;
  theme?: string;
  items?: RouletteItem[];
};

type RouletteDefinitionsResponse = {
  definitions?: RouletteDefinition[];
};

type RouletteTestResponse = {
  result?: {
    result?: {
      label?: string;
      value?: string | null;
    };
    path?: string;
  };
};

const ROULETTE_PAGE_SIZE = 8;
const ROULETTE_LAYOUT_OPTIONS = [
  { value: 'reel', label: '릴 형태' },
  { value: 'wheel', label: '휠 형태' },
] as const;
type RouletteLayout = (typeof ROULETTE_LAYOUT_OPTIONS)[number]['value'];
const ROULETTE_SKIN_OPTIONS = [
  { value: 'studio', label: '스튜디오' },
  { value: 'prism', label: '프리즘' },
  { value: 'aurora', label: '오로라' },
  { value: 'velvet', label: '벨벳' },
  { value: 'mono', label: '모노' },
  { value: 'deco', label: '아르데코' },
  { value: 'crystal', label: '크리스탈' },
  { value: 'ink', label: '수묵' },
  { value: 'nova', label: '노바' },
  { value: 'ceramic', label: '세라믹' },
  { value: 'arcade', label: '아케이드' },
  { value: 'sakura', label: '사쿠라' },
  { value: 'ocean', label: '오션' },
  { value: 'solar', label: '솔라' },
  { value: 'cyber', label: '네온' },
  { value: 'gold', label: '골드' },
] as const;
type RouletteSkin = (typeof ROULETTE_SKIN_OPTIONS)[number]['value'];
const ROULETTE_SKIN_NAMES = ROULETTE_SKIN_OPTIONS.map((option) => option.value);
const ROULETTE_LEGACY_SKIN_MAP: Record<string, RouletteSkin> = {
  classic: 'studio',
  fire: 'solar',
  ice: 'ocean',
  pastel: 'prism',
  forest: 'aurora',
  midnight: 'mono',
  sunset: 'solar',
};
const ROULETTE_SKIN_PREVIEWS: Record<RouletteSkin, { accent: string; accent2: string; panel: string; result: string; palette: string[] }> = {
  studio: { accent: '#f8fafc', accent2: '#38bdf8', panel: '#0a0d16', result: '#ffffff', palette: ['#f8fafc', '#111827', '#8b5cf6', '#06b6d4', '#f59e0b', '#e5e7eb'] },
  prism: { accent: '#22d3ee', accent2: '#bef264', panel: '#14102a', result: '#eaff9a', palette: ['#22d3ee', '#f0abfc', '#bef264', '#fb7185', '#a78bfa', '#67e8f9'] },
  aurora: { accent: '#5eead4', accent2: '#c4b5fd', panel: '#081325', result: '#ccfbf1', palette: ['#5eead4', '#8b5cf6', '#2dd4bf', '#c4b5fd', '#22c55e', '#38bdf8'] },
  velvet: { accent: '#f9d27d', accent2: '#fecdd3', panel: '#320a18', result: '#ffe8a3', palette: ['#f9d27d', '#7f1d1d', '#be123c', '#fbbf24', '#581c87', '#fecdd3'] },
  mono: { accent: '#f9fafb', accent2: '#a3a3a3', panel: '#030508', result: '#ffffff', palette: ['#f9fafb', '#1f2937', '#d1d5db', '#4b5563', '#ffffff', '#111827'] },
  deco: { accent: '#f8d77e', accent2: '#c9912a', panel: '#080706', result: '#fff2b6', palette: ['#f8d77e', '#121212', '#d6a33f', '#2f2414', '#fff4bf', '#0b0d11'] },
  crystal: { accent: '#7dd3fc', accent2: '#c4b5fd', panel: '#061e34', result: '#f0fdff', palette: ['#e0faff', '#7dd3fc', '#c4b5fd', '#38bdf8', '#f8feff', '#93c5fd'] },
  ink: { accent: '#f7f7f2', accent2: '#c1121f', panel: '#030405', result: '#fff8f4', palette: ['#f7f7f2', '#1f2933', '#e8ecef', '#0b0d10', '#d9dde0', '#c1121f'] },
  nova: { accent: '#c4b5fd', accent2: '#38bdf8', panel: '#06061a', result: '#fef08a', palette: ['#c4b5fd', '#38bdf8', '#312e81', '#f0abfc', '#0f172a', '#fef08a'] },
  ceramic: { accent: '#60a5fa', accent2: '#eff6ff', panel: '#06122a', result: '#ffffff', palette: ['#f8fbff', '#1d4ed8', '#dbeafe', '#60a5fa', '#eff6ff', '#2563eb'] },
  arcade: { accent: '#67e8f9', accent2: '#bef264', panel: '#040512', result: '#f8ff9a', palette: ['#67e8f9', '#f0abfc', '#bef264', '#111827', '#22d3ee', '#fb7185'] },
  sakura: { accent: '#fda4af', accent2: '#fef3c7', panel: '#361425', result: '#ffe5ee', palette: ['#fda4af', '#fecdd3', '#f9a8d4', '#f0abfc', '#ffe4e6', '#fb7185'] },
  ocean: { accent: '#7dd3fc', accent2: '#5eead4', panel: '#031f38', result: '#dffcff', palette: ['#7dd3fc', '#0ea5e9', '#5eead4', '#0369a1', '#bae6fd', '#67e8f9'] },
  solar: { accent: '#fbbf24', accent2: '#fb923c', panel: '#361709', result: '#fff0b3', palette: ['#fbbf24', '#fb923c', '#f97316', '#fde68a', '#ef4444', '#fed7aa'] },
  cyber: { accent: '#f0abfc', accent2: '#bef264', panel: '#14082a', result: '#d9ff8f', palette: ['#f0abfc', '#22d3ee', '#bef264', '#a78bfa', '#fb7185', '#67e8f9'] },
  gold: { accent: '#ffd66b', accent2: '#fff1b8', panel: '#22190a', result: '#fff5bf', palette: ['#ffd66b', '#b8892f', '#fff1b8', '#f4a261', '#d4af37', '#ffe8a3'] },
};

function parseRouletteTheme(value?: string | null) {
  const text = String(value || 'studio').toLowerCase().trim();
  const parts = text.split(/[:_\-\s]+/).filter(Boolean);
  const layout = parts.find((part) => part === 'reel' || part === 'wheel') || 'reel';
  const rawSkin = parts.find((part) => ROULETTE_SKIN_NAMES.includes(part as RouletteSkin) || ROULETTE_LEGACY_SKIN_MAP[part]) || text || 'studio';
  const skin = ROULETTE_LEGACY_SKIN_MAP[rawSkin] || rawSkin;
  return { layout, theme: ROULETTE_SKIN_NAMES.includes(skin as RouletteSkin) ? (skin as RouletteSkin) : 'studio' };
}

function getRouletteSkinLabel(value: string) {
  return ROULETTE_SKIN_OPTIONS.find((option) => option.value === value)?.label || '스튜디오';
}

function RouletteSkinPreview({ layout, skin }: { layout: RouletteLayout; skin: RouletteSkin }) {
  const preview = ROULETTE_SKIN_PREVIEWS[skin] || ROULETTE_SKIN_PREVIEWS.studio;
  const gradient = `conic-gradient(${preview.palette.map((color, index) => {
    const slice = 360 / preview.palette.length;
    return `${color} ${index * slice}deg ${(index + 1) * slice}deg`;
  }).join(', ')})`;

  return (
    <div className="grid gap-3 rounded-[var(--radius-control)] border bg-background/72 p-4 shadow-subtle">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">미리보기</div>
        <div className="text-xs font-semibold text-muted-foreground">{layout === 'wheel' ? '휠 형태' : '릴 형태'} · {getRouletteSkinLabel(skin)}</div>
      </div>
      <div className="grid min-h-[8rem] place-items-center overflow-hidden rounded-[var(--radius-control)] border" style={{ borderColor: `${preview.accent}55`, background: `radial-gradient(circle at 58% 42%, ${preview.accent}2e, transparent 34%), linear-gradient(135deg, ${preview.panel}, #050608)` }}>
        {layout === 'wheel' ? (
          <div className="relative grid aspect-square w-[7.6rem] place-items-center rounded-full" style={{ background: `linear-gradient(135deg, ${preview.accent2}, ${preview.accent})`, boxShadow: `0 0 28px ${preview.accent}55` }}>
            <div className="absolute inset-[0.45rem] rounded-full" style={{ background: gradient }} />
            <div className="absolute inset-[2.1rem] grid place-items-center rounded-full border bg-black/72 text-center" style={{ borderColor: `${preview.accent}66` }}>
              <span className="text-[0.68rem] font-black tracking-[0.18em] text-white/55">RESULT</span>
              <span className="text-lg font-black leading-none" style={{ color: preview.result, textShadow: `0 0 14px ${preview.accent}` }}>대박</span>
            </div>
            <div className="absolute -top-1 h-0 w-0 border-x-[0.5rem] border-t-[0.9rem] border-x-transparent" style={{ borderTopColor: preview.accent2 }} />
          </div>
        ) : (
          <div className="relative grid w-[min(92%,22rem)] grid-cols-[0.42fr_0.58fr] overflow-hidden rounded-[0.45rem] border" style={{ borderColor: `${preview.accent}66`, clipPath: 'polygon(0 16%, 6% 0, 100% 0, 100% 84%, 94% 100%, 0 100%)', boxShadow: `0 0 28px ${preview.accent}3f` }}>
            <div className="grid content-center gap-2 p-4" style={{ background: `linear-gradient(135deg, ${preview.panel}, #111827)` }}>
              <div className="h-7 w-7 rounded-full border" style={{ borderColor: `${preview.accent}66`, background: `radial-gradient(circle, ${preview.accent}, transparent 62%)` }} />
              <div className="truncate text-sm font-black text-white">스페셜 룰렛</div>
              <div className="truncate text-xs font-semibold text-white/68">테스트 시청자님</div>
            </div>
            <div className="grid place-items-center border-l p-4" style={{ borderColor: `${preview.accent}44`, background: `linear-gradient(90deg, #050608, ${preview.panel})` }}>
              <div className="text-[2rem] font-black leading-none" style={{ color: preview.result, textShadow: `0 0 18px ${preview.accent}` }}>대박</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error || 'request_failed');
  }
  return response.json();
}

function RouletteEditDialog({
  definition,
  onSaved,
}: {
  definition: RouletteDefinition;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(definition.name);
  const [layout, setLayout] = useState<RouletteLayout>(() => parseRouletteTheme(definition.theme).layout);
  const [theme, setTheme] = useState<RouletteSkin>(() => parseRouletteTheme(definition.theme).theme);
  const [items, setItems] = useState<EditableRouletteItem[]>(() => toEditableRouletteItems(definition.items));
  const [isPending, startTransition] = useTransition();

  const reset = useCallback(() => {
    const parsed = parseRouletteTheme(definition.theme);
    setName(definition.name);
    setLayout(parsed.layout);
    setTheme(parsed.theme);
    setItems(toEditableRouletteItems(definition.items));
  }, [definition]);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const save = () => {
    const rouletteName = name.trim();
    const normalizedItems = normalizeEditableRouletteItems(items);
    if (!rouletteName) return toast.warning('룰렛 이름을 입력해 주세요.');
    if (normalizedItems.length < 2) return toast.warning('룰렛 항목은 2개 이상 필요합니다.');

    startTransition(async () => {
      try {
        await postJson('/api/roulette/definitions/upsert', {
          definition: {
            ...definition,
            id: definition.id || `rlt_${Date.now().toString(36)}`,
            name: rouletteName,
            type: 'items',
            theme: `${layout}:${theme}`,
            items: normalizedItems,
          },
        });
        toast.success('룰렛을 저장했어요.');
        onSaved();
        setOpen(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '룰렛을 저장하지 못했어요.');
      }
    });
  };

  const deleteRoulette = () => {
    const ok = window.confirm(`${definition.name} 룰렛을 삭제할까요? 삭제한 룰렛은 되돌릴 수 없습니다.`);
    if (!ok) return;

    startTransition(async () => {
      try {
        await postJson('/api/roulette/definitions/delete', {
          id: definition.id || '',
          name: definition.name,
        });
        toast.success('룰렛을 삭제했어요.');
        onSaved();
        setOpen(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '룰렛을 삭제하지 못했어요.');
      }
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button type="button" variant="outline">
          자세히
          <ChevronRight className="h-4 w-4" />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/24 backdrop-blur-[clamp(0.5rem,1.4vw,1rem)] data-[state=open]:animate-fade-in" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 grid max-h-[min(92svh,54rem)] w-[min(94vw,58rem)] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[var(--radius-panel)] border bg-card/96 shadow-lift outline-none backdrop-blur-2xl data-[state=open]:animate-modal-in"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="relative overflow-hidden bg-[radial-gradient(circle_at_12%_0%,hsl(var(--accent-lemon)/0.74),transparent_36%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent-sky)/0.22),hsl(var(--accent-mint)/0.2))] p-[clamp(1.25rem,3vw,2rem)]">
            <div className="absolute inset-x-[8%] top-0 h-[max(0.125rem,0.18vw)] rounded-full bg-[linear-gradient(90deg,hsl(var(--accent-lemon)),hsl(var(--accent-mint)),hsl(var(--accent-sky)))]" />
            <div className="relative flex items-start justify-between gap-[clamp(1rem,2vw,1.5rem)]">
              <div className="min-w-0">
                <div className="mb-[clamp(0.75rem,1.6vw,1rem)] flex flex-wrap items-center gap-[clamp(0.5rem,1vw,0.75rem)]">
                  <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-primary/12 text-primary ring-1 ring-primary/25">
                    <PencilLine className="h-[1em] w-[1em]" />
                  </span>
                  <Badge tone="lemon">룰렛 편집</Badge>
                  <Badge tone="neutral">{normalizeEditableRouletteItems(items).length}개 항목</Badge>
                </div>
                <Dialog.Title className="break-keep text-[clamp(1.5rem,4vw,2.35rem)] font-semibold leading-tight tracking-normal">
                  {definition.name}
                </Dialog.Title>
                <Dialog.Description className="mt-[clamp(0.75rem,1.4vw,1rem)] max-w-[64ch] break-keep text-sm leading-7 text-muted-foreground md:text-base">
                  룰렛 이름과 항목을 바로 다듬고, 당첨 순간에 함께 나갈 자동화 액션도 연결할 수 있어요.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button type="button" variant="outline" size="icon" aria-label="닫기" className="shrink-0 bg-card/75">
                  <X className="h-[1em] w-[1em]" />
                </Button>
              </Dialog.Close>
            </div>
          </div>

          <div className="arubot-modal-scroll grid min-h-0 gap-[clamp(1rem,2vw,1.35rem)] overflow-y-auto p-[clamp(1.25rem,3vw,2rem)]">
            <div className="grid gap-[clamp(1rem,2vw,1.35rem)] md:grid-cols-[minmax(0,1fr)_minmax(10rem,0.25fr)_minmax(10rem,0.28fr)]">
              <label className="grid gap-[clamp(0.5rem,1vw,0.75rem)] text-sm font-semibold">
                룰렛 이름
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="grid gap-[clamp(0.5rem,1vw,0.75rem)] text-sm font-semibold">
                표현 형태
                <select value={layout} onChange={(event) => setLayout(event.target.value === 'wheel' ? 'wheel' : 'reel')} className="min-h-[var(--control-height)] rounded-[var(--radius-control)] border bg-background px-3 text-sm">
                  {ROULETTE_LAYOUT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="grid gap-[clamp(0.5rem,1vw,0.75rem)] text-sm font-semibold">
                스킨
                <select value={theme} onChange={(event) => setTheme((ROULETTE_SKIN_NAMES.includes(event.target.value as RouletteSkin) ? event.target.value : 'studio') as RouletteSkin)} className="min-h-[var(--control-height)] rounded-[var(--radius-control)] border bg-background px-3 text-sm">
                  {ROULETTE_SKIN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            </div>

            <RouletteSkinPreview layout={layout} skin={theme} />

            <div className="grid gap-[clamp(0.5rem,1vw,0.75rem)]">
              <div className="text-sm font-semibold">룰렛 항목</div>
              <RouletteItemsEditor items={items} onChange={setItems} />
            </div>
          </div>

          <div className="flex flex-col gap-[clamp(0.65rem,1.2vw,0.875rem)] border-t bg-background/64 p-[clamp(1rem,2.4vw,1.5rem)] sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="destructive" disabled={isPending} onClick={deleteRoulette}>
              <Trash2 className="h-[1em] w-[1em]" />
              룰렛 삭제
            </Button>
            <div className="flex flex-col-reverse gap-[clamp(0.65rem,1.2vw,0.875rem)] sm:flex-row sm:items-center sm:justify-end">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={isPending}>
                  취소
                </Button>
              </Dialog.Close>
              <Button type="button" disabled={isPending} onClick={save}>
                {isPending ? <Loader2 className="h-[1em] w-[1em] animate-spin" /> : <Check className="h-[1em] w-[1em]" />}
                저장
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function RoulettePage() {
  const [definitions, setDefinitions] = useState<RouletteDefinition[]>([]);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [isPending, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      const data = await readJson<RouletteDefinitionsResponse>('/api/roulette/definitions');
      setDefinitions(data?.definitions || []);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const refresh = (event: Event) => {
      const endpoint = (event as CustomEvent<{ endpoint?: string }>).detail?.endpoint;
      if (!endpoint || endpoint === '/api/roulette/definitions') load();
    };
    window.addEventListener('arubot:resource-refresh', refresh);
    return () => window.removeEventListener('arubot:resource-refresh', refresh);
  }, [load]);

  const totalItems = useMemo(() => definitions.reduce((sum, definition) => sum + (definition.items?.length || 0), 0), [definitions]);
  const totalPages = Math.max(1, Math.ceil(definitions.length / ROULETTE_PAGE_SIZE));
  const visibleDefinitions = useMemo(() => {
    const currentPage = Math.min(page, totalPages);
    const start = (currentPage - 1) * ROULETTE_PAGE_SIZE;
    return definitions.slice(start, start + ROULETTE_PAGE_SIZE);
  }, [definitions, page, totalPages]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const testRoulette = async (definition: RouletteDefinition) => {
    const key = definition.id || definition.name;
    setTestingId(key);
    try {
      const data = await postJson<RouletteTestResponse>('/api/roulette/test', { id: definition.id, name: definition.name });
      const picked = data?.result?.result;
      setTestResults((current) => ({ ...current, [key]: picked?.label || '결과 확인 완료' }));
      toast.success(`${definition.name} 테스트 결과: ${picked?.label || '완료'}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '룰렛 테스트를 실행하지 못했어요.');
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="grid gap-[clamp(1rem,2vw,1.5rem)]">
      <section className="relative overflow-hidden rounded-[var(--radius-panel)] border bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent-lemon)/0.2),hsl(var(--accent-mint)/0.16))] p-[clamp(1.25rem,2.6vw,1.75rem)] shadow-subtle">
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-4xl">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-primary/12 text-primary ring-1 ring-primary/25">
                <Sparkles className="h-5 w-5" />
              </span>
              <Badge tone="lemon">룰렛</Badge>
              <Badge tone="mint">{definitions.length}개</Badge>
              <Badge tone="neutral">{totalItems}개 항목</Badge>
            </div>
            <h1 className="text-3xl font-semibold leading-tight tracking-normal md:text-4xl">룰렛 이벤트</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground md:text-base">
              포인트와 후원 반응에서 실행할 룰렛을 관리하고, 방송 화면에 표시될 룰렛 오버레이 주소를 같은 화면에서 바로 확인합니다.
            </p>
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <RouletteCreateDialog />
            <LinkButton href="/roulette/logs" variant="outline">결과 보기</LinkButton>
            <Button type="button" variant="outline" onClick={load} disabled={isPending}>
              <RefreshCw className={isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              새로고침
            </Button>
          </div>
        </div>
      </section>

      <ViewerTokenPanel
        title="룰렛 화면 주소"
        description="이 주소를 OBS 브라우저 소스에 넣으면 룰렛 결과가 방송 화면에 표시돼요."
        endpoint="/api/roulette/viewer-url"
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>방송 이벤트로 실행할 룰렛</CardTitle>
              <CardDescription>룰렛을 만들고 바로 테스트합니다.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="mint">{definitions.length}개</Badge>
              <Badge tone="neutral">{totalItems}개 항목</Badge>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {visibleDefinitions.map((definition) => {
          const key = definition.id || definition.name;
          const items = definition.items || [];
          const look = parseRouletteTheme(definition.theme);
          const layoutLabel = look.layout === 'wheel' ? '휠 형태' : '릴 형태';
          const skinLabel = getRouletteSkinLabel(look.theme);
          return (
            <Card key={key} className="overflow-hidden">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{definition.name}</CardTitle>
                    <CardDescription>{definition.type === 'probability' ? '확률형 룰렛' : '가중치 룰렛'} · {layoutLabel} · {skinLabel} 스킨</CardDescription>
                  </div>
                  <Badge tone="lemon">{items.length}개 항목</Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-2">
                  {items.slice(0, 6).map((item, index) => (
                    <div key={`${item.label}-${index}`} className="grid gap-2 rounded-[var(--radius-control)] border bg-background/70 p-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
                      <div className="min-w-0 max-w-full">
                        <div className="truncate font-semibold">{item.label || '항목'}</div>
                        {item.value ? (
                          <div className="mt-1 max-w-full overflow-x-auto">
                            <code className="block w-max max-w-[34rem] whitespace-nowrap rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">실행 액션: {item.value}</code>
                          </div>
                        ) : null}
                      </div>
                      <Badge tone={item.value?.includes('${action::') || item.value?.includes('${automation::') || item.value?.includes('${blueprint::') ? 'violet' : 'neutral'}>
                        {item.probability != null ? `${item.probability}%` : `가중치 ${item.weight || 1}`}
                      </Badge>
                    </div>
                  ))}
                  {items.length > 6 ? <div className="text-xs text-muted-foreground">외 {items.length - 6}개 항목이 더 있습니다.</div> : null}
                </div>
                {testResults[key] ? (
                  <div className="rounded-[var(--radius-control)] border bg-pastel-mint/45 p-3 text-sm font-semibold text-teal-900 dark:text-teal-50">
                    최근 테스트 결과: {testResults[key]}
                  </div>
                ) : null}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="soft" onClick={() => testRoulette(definition)} disabled={testingId === key}>
                    {testingId === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    테스트 실행
                  </Button>
                  <RouletteEditDialog definition={definition} onSaved={load} />
                </div>
              </CardContent>
            </Card>
          );
        })}
        {!definitions.length ? (
          <Card className="lg:col-span-2">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              {isPending ? '룰렛을 불러오는 중입니다.' : '아직 만든 룰렛이 없습니다.'}
            </CardContent>
          </Card>
        ) : null}
      </div>
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
