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
type PlatformStatusItem = {
  provider?: string;
  label?: string;
  connected?: boolean;
  channel?: string | null;
  live?: boolean | null;
  streamConnected?: boolean;
  mode?: string;
  queueSize?: number;
  lastError?: string | null;
  lastStatus?: number | null;
  reauthRequired?: boolean;
  ignoredDonations?: {
    count?: number;
    byReason?: Record<string, number>;
    recent?: Array<{ reason?: string; currency?: string | null; amountDisplayString?: string | null; user?: string | null }>;
  };
};

function getRows(data: unknown) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];

  const object = data as Record<string, unknown>;
  return (
    (['items', 'rules', 'macros', 'rows', 'data', 'points', 'logs', 'definitions']
      .map((key) => object[key])
      .find(Array.isArray) as unknown[] | undefined) || []
  );
}

function getPlatformStatusItems(data: unknown): PlatformStatusItem[] {
  if (!data || typeof data !== 'object') return [];
  const items = (data as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.filter((item): item is PlatformStatusItem => (
    !!item && typeof item === 'object' && typeof (item as PlatformStatusItem).provider === 'string'
  ));
}

function platformBadgeTone(item: PlatformStatusItem) {
  if (item.reauthRequired || item.lastError) return 'rose' as const;
  if (!item.connected) return 'amber' as const;
  if (item.streamConnected) return 'mint' as const;
  return 'sky' as const;
}

function platformStatusLabel(item: PlatformStatusItem) {
  if (item.reauthRequired) return '재인증 필요';
  if (item.lastError) return '확인 필요';
  if (!item.connected) return '미연결';
  if (item.streamConnected) return '수신 중';
  if (item.live === false) return '방송 대기';
  return '연결됨';
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
  const platformStatusItems = useMemo(() => getPlatformStatusItems(data), [data]);
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
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,0.32fr)] md:items-center">
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

      {platformStatusItems.length ? (
        <section className="grid gap-3 lg:grid-cols-3">
          {platformStatusItems.map((item) => {
            const ignoredCount = Number(item.ignoredDonations?.count || 0);
            const ignoredReasons = Object.entries(item.ignoredDonations?.byReason || {});
            return (
              <Card key={item.provider || item.label} className="bg-card/85">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{item.label || item.provider || '플랫폼'}</CardTitle>
                      <CardDescription className="truncate">{item.channel || '연결된 채널 없음'}</CardDescription>
                    </div>
                    <Badge tone={platformBadgeTone(item)}>{platformStatusLabel(item)}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">수신 방식</span>
                      <Badge tone="neutral">{item.mode || '-'}</Badge>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">라이브</span>
                      <Badge tone={item.live === true ? 'mint' : item.live === false ? 'amber' : 'neutral'}>
                        {item.live === true ? '라이브 중' : item.live === false ? '대기 중' : '미확인'}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">이벤트 큐</span>
                      <span className="font-semibold">{Number(item.queueSize || 0)}</span>
                    </div>
                    {ignoredCount ? (
                      <div className="rounded-[var(--radius-control)] border bg-background/70 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="font-medium">무시된 YouTube 후원</span>
                          <Badge tone="amber">{ignoredCount}건</Badge>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {ignoredReasons.map(([reason, count]) => (
                            <Badge key={reason} tone="neutral">{reason} {count}</Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {item.lastError ? (
                      <div className="rounded-[var(--radius-control)] border border-rose-500/20 bg-rose-500/10 p-3 text-xs leading-5 text-rose-700 dark:text-rose-200">
                        {item.lastStatus ? `${item.lastStatus} ` : ''}{item.lastError}
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      ) : null}

      <DataView
        title="목록"
        description="저장된 항목을 한눈에 확인해요."
        data={filteredData}
      />
    </div>
  );
}
