'use client';

import * as Dialog from '@radix-ui/react-dialog';
import * as Switch from '@radix-ui/react-switch';
import { Bell, Check, Clock3, Edit3, Loader2, MessageSquareText, RefreshCw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiUrl, readJson } from '@/shared/api/http';
import { cn } from '@/shared/lib/utils';

type Macro = {
  id: string;
  message?: string;
  intervalSec?: number;
  enabled?: boolean;
};

type MacroResponse = {
  macros?: Macro[];
};

const intervalPresets = [
  { label: '5분', value: 300 },
  { label: '10분', value: 600 },
  { label: '15분', value: 900 },
  { label: '30분', value: 1800 },
];

function formatInterval(seconds?: number) {
  const value = Math.max(1, Number(seconds || 0));
  if (value >= 3600 && value % 3600 === 0) return `${value / 3600}시간마다`;
  if (value >= 60 && value % 60 === 0) return `${value / 60}분마다`;
  if (value >= 60) return `${Math.round(value / 60)}분마다`;
  return `${value}초마다`;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'request_failed');
  return data as T;
}

function refreshMacros() {
  window.dispatchEvent(new CustomEvent('arubot:resource-refresh', { detail: { endpoint: '/api/macros' } }));
}

function MacroEditDialog({
  macro,
  open,
  onOpenChange,
  onSaved,
  onDeleted,
}: {
  macro: Macro | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [message, setMessage] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState('10');
  const [enabled, setEnabled] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [deleting, startDeleteTransition] = useTransition();

  useEffect(() => {
    if (!macro || !open) return;
    setMessage(String(macro.message || ''));
    setIntervalMinutes(String(Math.max(1, Math.round(Number(macro.intervalSec || 600) / 60))));
    setEnabled(macro.enabled !== false);
  }, [macro, open]);

  const intervalSec = useMemo(() => {
    const minutes = Number(intervalMinutes);
    if (!Number.isFinite(minutes)) return 0;
    return Math.max(1, Math.round(minutes * 60));
  }, [intervalMinutes]);

  const save = () => {
    if (!macro?.id) return;
    const trimmed = message.trim();
    if (!trimmed) return toast.warning('알림 문구를 입력해 주세요.');
    if (!intervalSec) return toast.warning('반복 간격을 확인해 주세요.');

    startTransition(async () => {
      try {
        await postJson('/api/macros/upsert', {
          macro: {
            id: macro.id,
            message: trimmed,
            intervalSec,
            enabled,
          },
        });
        toast.success('자동 알림을 수정했어요.');
        refreshMacros();
        onSaved();
        onOpenChange(false);
      } catch {
        toast.error('자동 알림을 저장하지 못했어요.');
      }
    });
  };

  const remove = () => {
    if (!macro?.id) return;
    startDeleteTransition(async () => {
      try {
        await postJson('/api/macros/delete', { id: macro.id });
        toast.success('자동 알림을 삭제했어요.');
        refreshMacros();
        onDeleted();
        onOpenChange(false);
      } catch {
        toast.error('자동 알림을 삭제하지 못했어요.');
      }
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/24 backdrop-blur-[clamp(0.5rem,1.4vw,1rem)] data-[state=open]:animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[min(92svh,46rem)] w-[min(94vw,44rem)] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[var(--radius-panel)] border bg-card/96 shadow-lift outline-none backdrop-blur-2xl data-[state=open]:animate-modal-in">
          <div className="border-b bg-card p-[clamp(1.25rem,3vw,2rem)]">
            <div className="relative flex items-start justify-between gap-[clamp(1rem,2vw,1.5rem)]">
              <div className="min-w-0">
                <Badge tone="mint">자동 알림 수정</Badge>
                <Dialog.Title className="mt-3 break-keep text-[clamp(1.45rem,4vw,2.2rem)] font-semibold leading-tight tracking-normal">
                  방송 중 나갈 안내를 다듬어요.
                </Dialog.Title>
                <Dialog.Description className="mt-2 max-w-[58ch] break-keep text-sm leading-7 text-muted-foreground md:text-base">
                  문구와 반복 간격을 바꾸면 다음 알림부터 새 내용으로 이어집니다.
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
            <label className="grid min-w-0 gap-[clamp(0.5rem,1vw,0.75rem)] text-sm font-semibold">
              알림 문구
              <div className="relative">
                <MessageSquareText className="pointer-events-none absolute left-[clamp(0.75rem,1.4vw,1rem)] top-[clamp(0.875rem,1.6vw,1.125rem)] h-[1.1em] w-[1.1em] text-muted-foreground" />
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value.slice(0, 1000))}
                  className="box-border min-h-[clamp(6.75rem,14svh,9.5rem)] w-full min-w-0 max-w-full resize-y rounded-[var(--radius-control)] border bg-background/80 py-[clamp(0.85rem,1.6vw,1.1rem)] pl-[clamp(2.45rem,4vw,3rem)] pr-[clamp(0.85rem,1.6vw,1.1rem)] text-sm leading-7 outline-none transition placeholder:text-muted-foreground focus:border-primary/45 focus:ring-2 focus:ring-ring"
                />
              </div>
              <span className="text-xs font-medium text-muted-foreground">{message.trim().length.toLocaleString('ko-KR')} / 1,000자</span>
            </label>

            <div className="grid gap-[clamp(0.875rem,1.7vw,1.125rem)] md:grid-cols-[minmax(0,1fr)_minmax(0,0.72fr)] md:items-end">
              <label className="grid min-w-0 gap-[clamp(0.5rem,1vw,0.75rem)] text-sm font-semibold">
                반복 간격
                <div className="relative">
                  <Clock3 className="pointer-events-none absolute left-[clamp(0.75rem,1.4vw,1rem)] top-1/2 h-[1.1em] w-[1.1em] -translate-y-1/2 text-muted-foreground" />
                  <Input value={intervalMinutes} onChange={(event) => setIntervalMinutes(event.target.value)} inputMode="decimal" className="pl-[clamp(2.45rem,4vw,3rem)]" />
                </div>
              </label>
              <div className="flex flex-wrap gap-[clamp(0.4rem,0.9vw,0.65rem)]">
                {intervalPresets.map((preset) => (
                  <Button
                    key={preset.value}
                    type="button"
                    variant={intervalSec === preset.value ? 'soft' : 'outline'}
                    size="sm"
                    onClick={() => setIntervalMinutes(String(preset.value / 60))}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-[clamp(0.75rem,1.4vw,1rem)] rounded-[var(--radius-card)] border bg-background/62 p-[clamp(1rem,2vw,1.25rem)] sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold">바로 사용하기</div>
                <p className="mt-[clamp(0.25rem,0.8vw,0.45rem)] text-sm leading-6 text-muted-foreground">끄면 목록에는 남지만 방송 중에는 보내지 않아요.</p>
              </div>
              <Switch.Root
                checked={enabled}
                onCheckedChange={setEnabled}
                aria-label="자동 알림 사용 여부"
                className="relative h-[1.75rem] w-[3.25rem] rounded-full border bg-muted transition data-[state=checked]:border-primary/35 data-[state=checked]:bg-primary/75"
              >
                <Switch.Thumb className="block h-[1.35rem] w-[1.35rem] translate-x-[0.2rem] rounded-full bg-card shadow-subtle transition data-[state=checked]:translate-x-[1.55rem]" />
              </Switch.Root>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-[clamp(0.65rem,1.2vw,0.875rem)] border-t bg-background/64 p-[clamp(1rem,2.4vw,1.5rem)] sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="destructive" onClick={remove} disabled={deleting || isPending}>
              {deleting ? <Loader2 className="h-[1em] w-[1em] animate-spin" /> : <Trash2 className="h-[1em] w-[1em]" />}
              삭제
            </Button>
            <div className="flex flex-col-reverse gap-[clamp(0.65rem,1.2vw,0.875rem)] sm:flex-row sm:items-center sm:justify-end">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={isPending || deleting}>취소</Button>
              </Dialog.Close>
              <Button type="button" onClick={save} disabled={isPending || deleting}>
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

export function MacrosPage() {
  const [macros, setMacros] = useState<Macro[]>([]);
  const [isPending, startTransition] = useTransition();
  const [editingMacro, setEditingMacro] = useState<Macro | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(() => {
    startTransition(async () => {
      const data = await readJson<MacroResponse>('/api/macros');
      setMacros(Array.isArray(data?.macros) ? data.macros : []);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const refresh = (event: Event) => {
      const endpoint = (event as CustomEvent<{ endpoint?: string }>).detail?.endpoint;
      if (!endpoint || endpoint === '/api/macros') load();
    };
    window.addEventListener('arubot:resource-refresh', refresh);
    return () => window.removeEventListener('arubot:resource-refresh', refresh);
  }, [load]);

  const activeCount = macros.filter((macro) => macro.enabled !== false).length;

  const openEdit = (macro: Macro) => {
    setEditingMacro(macro);
    setEditOpen(true);
  };

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <CardTitle>반복 안내 목록</CardTitle>
              <CardDescription>방송 중 자연스럽게 나갈 공지와 참여 안내를 확인하고 다듬어요.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={macros.length ? 'mint' : 'neutral'}>{macros.length}개 알림</Badge>
              <Badge tone={activeCount ? 'sky' : 'neutral'}>{activeCount}개 사용 중</Badge>
              <Button type="button" variant="outline" onClick={load} disabled={isPending}>
                <RefreshCw className={cn('h-[1em] w-[1em]', isPending && 'animate-spin')} />
                새로고침
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-3">
        {macros.map((macro) => (
          <Card key={macro.id} className="overflow-hidden">
            <CardContent className="grid gap-4 p-[clamp(1rem,2vw,1.35rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,0.34fr)] lg:items-center">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge tone={macro.enabled === false ? 'neutral' : 'mint'}>{macro.enabled === false ? '꺼짐' : '사용 중'}</Badge>
                  <Badge tone="sky">{formatInterval(macro.intervalSec)}</Badge>
                </div>
                <div className="rounded-[var(--radius-control)] bg-background/55 p-[clamp(0.85rem,1.5vw,1rem)]">
                  <p className="line-clamp-3 break-words text-sm leading-7 text-foreground">{macro.message || '알림 문구가 없습니다.'}</p>
                </div>
              </div>
              <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                <Button type="button" variant="outline" size="sm" onClick={() => openEdit(macro)}>
                  <Edit3 className="h-[1em] w-[1em]" />
                  수정
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {!macros.length ? (
          <Card>
            <CardContent className="grid place-items-center gap-3 p-[clamp(2rem,5vw,3rem)] text-center">
              <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-muted text-primary">
                <Bell className="h-[1em] w-[1em]" />
              </span>
              <div>
                <div className="font-semibold">{isPending ? '자동 알림을 불러오는 중입니다' : '아직 자동 알림이 없습니다'}</div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">자주 안내하는 참여 방법이나 공지를 만들어두면 방송 중 자연스럽게 채팅에 나갑니다.</p>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <MacroEditDialog
        macro={editingMacro}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={load}
        onDeleted={load}
      />
    </div>
  );
}
