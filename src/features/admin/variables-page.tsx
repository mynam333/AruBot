'use client';

import { Copy, Tags } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { readJson } from '@/shared/api/http';

type BotVariable = {
  key: string;
  label: string;
  description: string;
  group: string;
  providers?: string[];
  caveat?: string;
};

type VariablesResponse = {
  variables: BotVariable[];
};

function providerTone(provider: string) {
  if (provider === 'youtube') return 'rose';
  return provider === 'cime' ? 'violet' : 'mint';
}

function providerLabel(provider: string) {
  if (provider === 'youtube') return 'YouTube';
  return provider === 'cime' ? 'CIME' : 'CHZZK';
}

export function VariablesPage() {
  const [variables, setVariables] = useState<BotVariable[]>([]);
  const [isPending, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      const data = await readJson<VariablesResponse>('/api/bot/variables');
      setVariables(data?.variables || []);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, BotVariable[]>();
    for (const variable of variables) {
      const list = map.get(variable.group) || [];
      list.push(variable);
      map.set(variable.group, list);
    }
    return Array.from(map.entries());
  }, [variables]);

  const copy = async (key: string) => {
    await navigator.clipboard?.writeText(key).catch(() => undefined);
    toast.success(`${key} 변수를 복사했습니다.`);
  };

  return (
    <div className="grid gap-[clamp(1rem,2vw,1.5rem)]">
      <section className="relative overflow-hidden rounded-[var(--radius-panel)] border bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent-sky)/0.24),hsl(var(--accent-lemon)/0.18))] p-[clamp(1.25rem,2.8vw,2rem)] shadow-subtle">
        <div className="max-w-3xl">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-primary/12 text-primary">
              <Tags className="h-5 w-5" />
            </span>
            <Badge tone="sky">치환 변수</Badge>
            <Badge tone={variables.length ? 'mint' : 'neutral'}>{variables.length}개</Badge>
          </div>
          <h1 className="break-keep text-3xl font-semibold leading-tight md:text-4xl">명령어 답변에 바로 넣을 수 있는 변수입니다.</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
            변수는 채팅 명령어, 자동 응답, 방송 안내 문구에서 시청자와 방송 상태에 맞는 값으로 바뀝니다.
          </p>
        </div>
      </section>

      {groups.length ? (
        <div className="grid gap-5 xl:grid-cols-3">
          {groups.map(([group, items]) => (
            <Card key={group}>
              <CardHeader>
                <CardTitle>{group}</CardTitle>
                <CardDescription>채팅 문구에 넣으면 {items.length}가지 상황을 자동으로 채워줘요.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => copy(item.key)}
                    className="group grid gap-2 rounded-[var(--radius-card)] border bg-background/65 p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/35 hover:bg-pastel-sky/35 hover:shadow-subtle"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <code className="rounded-[var(--radius-control)] bg-muted px-2.5 py-1 text-sm font-bold text-foreground">{item.key}</code>
                      <Copy className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-primary" />
                    </div>
                    {item.providers?.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {item.providers.map((provider) => (
                          <Badge key={provider} tone={providerTone(provider)}>{providerLabel(provider)}</Badge>
                        ))}
                      </div>
                    ) : null}
                    <div className="text-sm font-semibold">{item.label}</div>
                    <p className="break-keep text-xs leading-5 text-muted-foreground">{item.description}</p>
                    {item.caveat ? <p className="break-keep text-xs leading-5 text-amber-700 dark:text-amber-300">{item.caveat}</p> : null}
                  </button>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {isPending ? '변수 목록을 불러오는 중입니다.' : '표시할 변수를 불러오지 못했습니다.'}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
