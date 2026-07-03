'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { CircleHelp, Copy, Loader2, Tags, X } from 'lucide-react';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  variables?: BotVariable[];
};

function providerTone(provider: string) {
  if (provider === 'youtube') return 'rose';
  return provider === 'cime' ? 'violet' : 'mint';
}

function providerLabel(provider: string) {
  if (provider === 'youtube') return 'YouTube';
  return provider === 'cime' ? 'CIME' : 'CHZZK';
}

export function CommandVariableHelpButton() {
  const [open, setOpen] = useState(false);
  const [variables, setVariables] = useState<BotVariable[]>([]);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || loaded || isPending) return;
    setFailed(false);
    startTransition(async () => {
      try {
        const data = await readJson<VariablesResponse>('/api/bot/variables');
        setVariables(data?.variables || []);
      } catch {
        setFailed(true);
      } finally {
        setLoaded(true);
      }
    });
  }, [isPending, loaded, open]);

  const groups = useMemo(() => {
    const map = new Map<string, BotVariable[]>();
    for (const variable of variables) {
      const list = map.get(variable.group) || [];
      list.push(variable);
      map.set(variable.group, list);
    }
    return Array.from(map.entries());
  }, [variables]);

  const copyVariable = async (key: string) => {
    await navigator.clipboard?.writeText(key).catch(() => undefined);
    toast.success(`${key} 변수를 복사했습니다.`);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label="사용 가능한 변수 보기" className="shrink-0 bg-card/75">
          <CircleHelp className="h-[1em] w-[1em]" />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-foreground/24 backdrop-blur-[clamp(0.5rem,1.4vw,1rem)] data-[state=open]:animate-fade-in" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[80] grid max-h-[min(92svh,54rem)] w-[min(94vw,58rem)] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[var(--radius-panel)] border bg-card/96 shadow-lift outline-none backdrop-blur-2xl data-[state=open]:animate-modal-in"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="relative overflow-hidden border-b bg-[radial-gradient(circle_at_12%_0%,hsl(var(--accent-sky)/0.72),transparent_36%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--accent-mint)/0.24),hsl(var(--accent-lemon)/0.18))] p-[clamp(1rem,2.8vw,1.75rem)]">
            <div className="absolute inset-x-[8%] top-0 h-[max(0.125rem,0.18vw)] rounded-full bg-[linear-gradient(90deg,hsl(var(--accent-mint)),hsl(var(--accent-sky)),hsl(var(--accent-coral)))]" />
            <div className="relative flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-primary/12 text-primary ring-1 ring-primary/25">
                    <Tags className="h-[1em] w-[1em]" />
                  </span>
                  <Badge tone="sky">사용 가능한 변수</Badge>
                  <Badge tone={variables.length ? 'mint' : 'neutral'}>{variables.length}개</Badge>
                </div>
                <Dialog.Title className="break-keep text-[clamp(1.35rem,3vw,2rem)] font-semibold leading-tight">
                  명령어 문구에 넣을 변수를 바로 확인하세요.
                </Dialog.Title>
                <Dialog.Description className="mt-2 max-w-[64ch] break-keep text-sm leading-7 text-muted-foreground">
                  변수는 채팅 명령어 응답, 출석 메시지, 안내 문구에서 시청자와 방송 상태에 맞는 값으로 자동 치환됩니다.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button type="button" variant="outline" size="icon" aria-label="닫기" className="shrink-0 bg-card/75">
                  <X className="h-[1em] w-[1em]" />
                </Button>
              </Dialog.Close>
            </div>
          </div>

          <div className="arubot-modal-scroll min-h-0 overflow-y-auto p-[clamp(1rem,2.4vw,1.5rem)]">
            {isPending ? (
              <div className="grid min-h-[16rem] place-items-center rounded-[var(--radius-panel)] border bg-background/65 text-sm font-semibold text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  변수 목록을 불러오는 중입니다.
                </span>
              </div>
            ) : groups.length ? (
              <div className="grid items-start gap-4 lg:grid-cols-2">
                {groups.map(([group, items]) => (
                  <section key={group} className="grid min-w-0 self-start gap-3 rounded-[var(--radius-panel)] border bg-background/62 p-[clamp(0.9rem,1.8vw,1.15rem)]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-base font-bold">{group}</h3>
                      <Badge tone="neutral">{items.length}개</Badge>
                    </div>
                    <div className="grid gap-2">
                      {items.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => copyVariable(item.key)}
                          className="group grid min-w-0 gap-2 rounded-[var(--radius-card)] border bg-card/72 p-[clamp(0.85rem,1.5vw,1rem)] text-left transition hover:-translate-y-0.5 hover:border-primary/35 hover:bg-pastel-sky/35 hover:shadow-subtle"
                        >
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <code className="min-w-0 break-all rounded-[var(--radius-control)] bg-muted px-2.5 py-1 text-sm font-bold leading-6 text-foreground">
                              {item.key}
                            </code>
                            <Copy className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-primary" />
                          </div>
                          {item.providers?.length ? (
                            <div className="flex flex-wrap gap-1.5">
                              {item.providers.map((provider) => (
                                <Badge key={provider} tone={providerTone(provider)}>{providerLabel(provider)}</Badge>
                              ))}
                            </div>
                          ) : null}
                          <div className="break-keep text-sm font-semibold">{item.label}</div>
                          <p className="break-keep text-xs leading-5 text-muted-foreground">{item.description}</p>
                          {item.caveat ? <p className="break-keep text-xs leading-5 text-amber-700 dark:text-amber-300">{item.caveat}</p> : null}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="grid min-h-[16rem] place-items-center rounded-[var(--radius-panel)] border bg-background/65 p-8 text-center text-sm leading-6 text-muted-foreground">
                {failed ? '변수 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' : '표시할 변수가 없습니다.'}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
