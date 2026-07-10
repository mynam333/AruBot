'use client';

import * as Dialog from '@radix-ui/react-dialog';
import * as Switch from '@radix-ui/react-switch';
import { BellPlus, Check, Loader2, MessageSquareText, Timer, X } from 'lucide-react';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiUrl } from '@/shared/api/http';
import { cn } from '@/shared/lib/utils';

type MacroCreateDialogProps = {
  variant?: 'default' | 'secondary' | 'outline' | 'soft';
  label?: string;
};

const intervalPresets = [
  { label: '5분', value: 300 },
  { label: '10분', value: 600 },
  { label: '15분', value: 900 },
  { label: '30분', value: 1800 },
];

const triggerVariants = {
  default: 'bg-primary text-primary-foreground shadow-subtle hover:-translate-y-0.5 hover:shadow-lift active:translate-y-0',
  secondary: 'bg-secondary text-secondary-foreground hover:-translate-y-0.5 hover:bg-muted active:translate-y-0',
  outline: 'border bg-card/80 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-pastel-sky/45 active:translate-y-0 dark:hover:bg-muted',
  soft: 'bg-pastel-mint/70 text-teal-950 hover:-translate-y-0.5 hover:bg-pastel-mint dark:bg-primary/20 dark:text-teal-50 dark:hover:bg-primary/25',
} satisfies Record<NonNullable<MacroCreateDialogProps['variant']>, string>;

async function createMacro(payload: { message: string; intervalSec: number; enabled: boolean }) {
  const response = await fetch(apiUrl('/api/macros/upsert'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ macro: payload }),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error || 'create_failed');
  }

  return response.json();
}

export function MacroCreateDialog({
  variant = 'secondary',
  label = '알림 만들기',
}: MacroCreateDialogProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState('10');
  const [enabled, setEnabled] = useState(true);
  const [isPending, startTransition] = useTransition();

  const messageLength = message.trim().length;
  const intervalSec = useMemo(() => {
    const minutes = Number(intervalMinutes);
    if (!Number.isFinite(minutes)) return 0;
    return Math.max(1, Math.round(minutes * 60));
  }, [intervalMinutes]);

  const reset = () => {
    setMessage('');
    setIntervalMinutes('10');
    setEnabled(true);
  };

  const submit = () => {
    const trimmed = message.trim();
    if (!trimmed) {
      toast.warning('알림 문구를 입력해 주세요.');
      return;
    }
    if (!intervalSec) {
      toast.warning('반복 간격을 확인해 주세요.');
      return;
    }

    startTransition(async () => {
      try {
        await createMacro({
          message: trimmed,
          intervalSec,
          enabled,
        });
        toast.success('자동 알림을 추가했어요.', {
          description: enabled ? '방송 중 설정한 간격으로 채팅에 안내됩니다.' : '꺼진 상태로 저장했어요. 필요할 때 켜면 됩니다.',
        });
        window.dispatchEvent(new CustomEvent('arubot:resource-refresh', { detail: { endpoint: '/api/macros' } }));
        reset();
        setOpen(false);
      } catch {
        toast.error('자동 알림을 추가하지 못했어요.', {
          description: '플랫폼 연결 상태를 확인한 뒤 다시 시도해 주세요.',
        });
      }
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        type="button"
        className={cn(
          'inline-flex min-h-[var(--control-height)] max-w-full min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] px-[clamp(0.875rem,1.6vw,1.125rem)] text-sm font-semibold tracking-normal transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
          triggerVariants[variant],
        )}
        data-testid="macro-create-trigger"
        title="반복 안내를 현재 화면에서 바로 추가합니다."
      >
        <BellPlus className="h-[1em] w-[1em]" />
        {label}
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/24 backdrop-blur-[clamp(0.5rem,1.4vw,1rem)] data-[state=open]:animate-fade-in" />
        <Dialog.Content
          data-testid="macro-create-dialog"
          className="fixed left-1/2 top-1/2 z-50 grid max-h-[min(92svh,44rem)] w-[min(92vw,42rem)] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[var(--radius-panel)] border bg-card/96 shadow-lift outline-none backdrop-blur-2xl data-[state=open]:animate-modal-in"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="border-b bg-card p-[clamp(1.25rem,3vw,2rem)]">
            <div className="relative flex items-start justify-between gap-[clamp(1rem,2vw,1.5rem)]">
              <div className="min-w-0">
                <div className="mb-[clamp(0.75rem,1.6vw,1rem)] flex flex-wrap items-center gap-[clamp(0.5rem,1vw,0.75rem)]">
                  <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-primary/12 text-primary ring-1 ring-primary/25">
                    <Timer className="h-[1.1em] w-[1.1em]" />
                  </span>
                  <Badge tone="mint">자동 알림</Badge>
                </div>
                <Dialog.Title className="break-keep text-[clamp(1.5rem,4vw,2.35rem)] font-semibold leading-tight tracking-normal">
                  방송 중 반복 안내를 추가해요.
                </Dialog.Title>
                <Dialog.Description className="mt-[clamp(0.75rem,1.4vw,1rem)] max-w-[54ch] break-keep text-sm leading-7 text-muted-foreground md:text-base">
                  시청자에게 자주 알려야 하는 공지, 참여 방법, 후원 안내를 정해둔 간격으로 자연스럽게 보내요.
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
                  placeholder="예: !투표로 예측에 참여하고 포인트를 확인해 보세요."
                  className="box-border min-h-[clamp(6.75rem,14svh,9.5rem)] w-full min-w-0 max-w-full resize-y rounded-[var(--radius-control)] border bg-background/80 py-[clamp(0.85rem,1.6vw,1.1rem)] pl-[clamp(2.45rem,4vw,3rem)] pr-[clamp(0.85rem,1.6vw,1.1rem)] text-sm leading-7 outline-none transition placeholder:text-muted-foreground focus:border-primary/45 focus:ring-2 focus:ring-ring"
                />
              </div>
              <span className="text-xs font-medium text-muted-foreground">{messageLength.toLocaleString('ko-KR')} / 1,000자</span>
            </label>

            <div className="grid gap-[clamp(0.875rem,1.7vw,1.125rem)] md:grid-cols-[minmax(0,1fr)_minmax(0,0.72fr)] md:items-end">
              <label className="grid min-w-0 gap-[clamp(0.5rem,1vw,0.75rem)] text-sm font-semibold">
                반복 간격
                <div className="relative">
                  <Timer className="pointer-events-none absolute left-[clamp(0.75rem,1.4vw,1rem)] top-1/2 h-[1.1em] w-[1.1em] -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={intervalMinutes}
                    onChange={(event) => setIntervalMinutes(event.target.value)}
                    inputMode="decimal"
                    aria-label="반복 간격"
                    data-testid="macro-create-interval"
                    className="pl-[clamp(2.45rem,4vw,3rem)]"
                  />
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
                <p className="mt-[clamp(0.25rem,0.8vw,0.45rem)] text-sm leading-6 text-muted-foreground">
                  끄면 저장만 하고 방송 중에는 보내지 않아요.
                </p>
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

          <div className="flex flex-col-reverse gap-[clamp(0.65rem,1.2vw,0.875rem)] border-t bg-background/64 p-[clamp(1rem,2.4vw,1.5rem)] sm:flex-row sm:items-center sm:justify-end">
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" disabled={isPending} data-testid="macro-create-cancel">
                취소
              </Button>
            </Dialog.Close>
            <Button type="button" onClick={submit} disabled={isPending} data-testid="macro-create-submit">
              {isPending ? <Loader2 className="h-[1em] w-[1em] animate-spin" /> : <Check className="h-[1em] w-[1em]" />}
              추가하기
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
