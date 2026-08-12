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
  contexts?: VariableContext[];
  caveat?: string;
};

type VariableContext = 'command' | 'attendance' | 'donation' | 'blueprint';

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

function contextLabel(context: VariableContext) {
  if (context === 'attendance') return '출석';
  if (context === 'donation') return '후원';
  if (context === 'blueprint') return '블루프린트';
  return '명령어';
}

function groupDescription(group: string, count: number) {
  if (group === '카운트') {
    return '사용할 때마다 1씩 증가하고, 증가한 현재 값이 변수 자리에 표시됩니다. 유저별 카운트와 모든 유저 합산 카운트를 따로 쓸 수 있어요.';
  }
  return `채팅 문구에 넣으면 ${count}가지 상황을 자동으로 채워줘요.`;
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
      <section className="border-b pb-5">
        <div className="max-w-3xl">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span aria-hidden="true" className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-primary/12 text-primary">
              <Tags aria-hidden="true" className="h-5 w-5" />
            </span>
            <Badge tone="sky">치환 변수</Badge>
            <Badge tone={variables.length ? 'mint' : 'neutral'}>{variables.length}개</Badge>
          </div>
          <h1 className="break-keep text-2xl font-bold leading-tight tracking-tight md:text-3xl">치환 변수</h1>
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
                <CardDescription>{groupDescription(group, items.length)}</CardDescription>
              </CardHeader>
              <CardContent className="grid min-w-0 gap-3">
                {items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => copy(item.key)}
                    aria-label={`${item.label} ${item.key} 변수 복사`}
                    className="group grid min-w-0 overflow-hidden gap-2 rounded-[var(--radius-card)] border bg-background/65 p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/35 hover:bg-pastel-sky/35 hover:shadow-subtle"
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <code className="block min-w-0 max-w-full break-all whitespace-normal rounded-[var(--radius-control)] bg-muted px-2.5 py-1 text-sm font-bold leading-6 text-foreground">{item.key}</code>
                      <Copy aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-primary" />
                    </div>
                    {item.providers?.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {item.providers.map((provider) => (
                          <Badge key={provider} tone={providerTone(provider)}>{providerLabel(provider)}</Badge>
                        ))}
                      </div>
                    ) : null}
                    {item.contexts?.length ? (
                      <div className="flex flex-wrap gap-1.5" aria-label="사용 위치">
                        {item.contexts.map((context) => (
                          <Badge key={context} tone="cyan">{contextLabel(context)}</Badge>
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
