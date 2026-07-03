'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Check, ChevronRight, Loader2, PencilLine, Play, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { RouletteCreateDialog } from '@/features/admin/admin-action-dialogs';
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
  const [theme, setTheme] = useState(definition.theme || 'pastel');
  const [items, setItems] = useState<EditableRouletteItem[]>(() => toEditableRouletteItems(definition.items));
  const [isPending, startTransition] = useTransition();

  const reset = useCallback(() => {
    setName(definition.name);
    setTheme(definition.theme || 'pastel');
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
            theme: theme.trim() || 'pastel',
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
            <div className="grid gap-[clamp(1rem,2vw,1.35rem)] md:grid-cols-[minmax(0,1fr)_minmax(10rem,0.34fr)]">
              <label className="grid gap-[clamp(0.5rem,1vw,0.75rem)] text-sm font-semibold">
                룰렛 이름
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="grid gap-[clamp(0.5rem,1vw,0.75rem)] text-sm font-semibold">
                테마
                <Input value={theme} onChange={(event) => setTheme(event.target.value)} placeholder="pastel" />
              </label>
            </div>

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
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-primary/12 text-primary">
                  <Sparkles className="h-5 w-5" />
                </span>
                <Badge tone="lemon">룰렛</Badge>
                <Badge tone="mint">{definitions.length}개</Badge>
                <Badge tone="neutral">{totalItems}개 항목</Badge>
              </div>
              <CardTitle>방송 이벤트로 실행할 룰렛</CardTitle>
              <CardDescription>룰렛을 만들고 바로 테스트합니다.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <RouletteCreateDialog />
              <LinkButton href="/roulette/logs" variant="outline">결과 보기</LinkButton>
              <LinkButton href="/roulette/viewer" variant="outline">OBS 주소</LinkButton>
              <Button type="button" variant="outline" onClick={load} disabled={isPending}>
                <RefreshCw className={isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                새로고침
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {visibleDefinitions.map((definition) => {
          const key = definition.id || definition.name;
          const items = definition.items || [];
          return (
            <Card key={key} className="overflow-hidden">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{definition.name}</CardTitle>
                    <CardDescription>{definition.type === 'probability' ? '확률형 룰렛' : '가중치 룰렛'} · {definition.theme || 'pastel'} 테마</CardDescription>
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
