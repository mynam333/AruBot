'use client';

import { ExternalLink, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataView } from '@/components/ui/data-view';
import { Input } from '@/components/ui/input';
import { readJson } from '@/shared/api/http';

type Action = { href: string; label: string };

function getRows(data: unknown) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];

  const object = data as Record<string, unknown>;
  return (
    (['items', 'rules', 'rows', 'data', 'points', 'logs', 'definitions']
      .map((key) => object[key])
      .find(Array.isArray) as unknown[] | undefined) || []
  );
}

export function ResourceDashboard({
  endpoint,
  title,
  description,
  actions = [],
  actionSlot,
}: {
  endpoint?: string;
  title: string;
  description: string;
  actions?: Action[];
  actionSlot?: React.ReactNode;
}) {
  const [data, setData] = useState<unknown>(null);
  const [query, setQuery] = useState('');
  const [isPending, startTransition] = useTransition();

  const rows = useMemo(() => getRows(data), [data]);
  const filteredData = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery || !rows.length) return data;

    return {
      items: rows.filter((row) => JSON.stringify(row).toLowerCase().includes(normalizedQuery)),
    };
  }, [data, query, rows]);

  const load = useCallback(() => {
    if (!endpoint) return;

    startTransition(async () => {
      const next = await readJson(endpoint);
      setData(next);
    });
  }, [endpoint]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const refresh = (event: Event) => {
      const targetEndpoint = (event as CustomEvent<{ endpoint?: string }>).detail?.endpoint;
      if (!targetEndpoint || targetEndpoint === endpoint) load();
    };
    window.addEventListener('arubot:resource-refresh', refresh);
    return () => window.removeEventListener('arubot:resource-refresh', refresh);
  }, [endpoint, load]);

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {actions.map((action) => (
                <LinkButton key={action.href} href={action.href} variant="outline">
                  {action.label}
                  <ExternalLink className="h-4 w-4" />
                </LinkButton>
              ))}
              {actionSlot}
              <Button type="button" onClick={load} disabled={!endpoint || isPending}>
                <RefreshCw className={isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                새로고침
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="이름이나 키워드로 찾기"
                aria-label="이름이나 키워드로 찾기"
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={data ? 'mint' : 'neutral'}>{data ? '준비됨' : '불러오는 중'}</Badge>
              <Badge tone="cyan">{rows.length}개 항목</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <DataView
        title="목록"
        description="저장된 항목을 한눈에 확인해요."
        data={filteredData}
      />
    </div>
  );
}
