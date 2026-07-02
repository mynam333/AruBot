'use client';

import { ChevronRight, Loader2, Play, RefreshCw, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { RouletteCreateDialog } from '@/features/admin/admin-action-dialogs';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
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
              <CardDescription>룰렛을 만들고, OBS 오버레이와 같은 실제 실행 흐름으로 테스트합니다.</CardDescription>
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
                            <code className="block w-max max-w-[34rem] whitespace-nowrap rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{item.value}</code>
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
                  <LinkButton href={`/roulette/defs/${encodeURIComponent(definition.id || definition.name)}`} variant="outline">
                    자세히
                    <ChevronRight className="h-4 w-4" />
                  </LinkButton>
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
