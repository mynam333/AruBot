'use client';

import * as Dialog from '@radix-ui/react-dialog';
import * as Switch from '@radix-ui/react-switch';
import {
  Check,
  Clapperboard,
  Gift,
  Loader2,
  MessageSquare,
  Plus,
  ChevronRight,
  Settings,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RouletteThemeSwatch } from '@/components/rouletteThemeSwatch';
import { CommandVariableHelpButton } from '@/features/admin/command-variable-help';
import { parseCommandTriggers } from '@/features/admin/command-triggers';
import {
  RouletteItemsEditor,
} from '@/features/admin/roulette-item-editor';
import {
  createDefaultRouletteItems,
  normalizeEditableRouletteItems,
  type EditableRouletteItem,
} from '@/features/admin/roulette-item-model';
import {
  VideoDonationIdlePlaylistEditor,
} from '@/features/admin/video-donation-idle-playlist-editor';
import {
  createDefaultVideoDonationIdlePlaylist,
  normalizeVideoDonationIdlePlaylist,
  type VideoDonationIdlePlaylist,
} from '@/features/admin/video-donation-idle-playlist-model';
import { apiUrl } from '@/shared/api/http';
import { cn } from '@/shared/lib/utils';
import {
  deriveLegacyAmountFields,
  describeDonationAmountRule,
  DONATION_AMOUNT_OPERATOR_OPTIONS,
  serializeDonationAmountConditions,
  type DonationAmountConditionForm,
  type DonationAmountOperator,
} from './donation-rule-amount-conditions';

type DialogButtonVariant = 'default' | 'secondary' | 'outline' | 'soft';

type ActionDialogButtonProps = {
  variant?: DialogButtonVariant;
  label?: string;
  className?: string;
  trailingChevron?: boolean;
};

const ROULETTE_LAYOUT_OPTIONS = [
  { value: 'reel', label: '릴 형태' },
  { value: 'wheel', label: '휠 형태' },
] as const;
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
type RouletteLayout = (typeof ROULETTE_LAYOUT_OPTIONS)[number]['value'];
type RouletteSkin = (typeof ROULETTE_SKIN_OPTIONS)[number]['value'];
const ROULETTE_SKIN_NAMES = ROULETTE_SKIN_OPTIONS.map((option) => option.value);

type ActionDialogFrameProps = ActionDialogButtonProps & {
  icon: React.ReactNode;
  badge: string;
  title: string;
  description: string;
  children: React.ReactNode;
  submitLabel?: string;
  pending?: boolean;
  onSubmit: (close: () => void) => void;
  onOpen?: () => void;
  headerAction?: React.ReactNode;
  testId?: string;
};

const triggerVariants = {
  default: 'bg-primary text-primary-foreground shadow-subtle hover:-translate-y-0.5 hover:shadow-lift active:translate-y-0',
  secondary: 'bg-secondary text-secondary-foreground hover:-translate-y-0.5 hover:bg-muted active:translate-y-0',
  outline: 'border bg-card/80 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-pastel-sky/45 active:translate-y-0 dark:hover:bg-muted',
  soft: 'bg-pastel-mint/70 text-teal-950 hover:-translate-y-0.5 hover:bg-pastel-mint dark:bg-primary/20 dark:text-teal-50 dark:hover:bg-primary/25',
} satisfies Record<DialogButtonVariant, string>;

function refreshResource(endpoint?: string) {
  window.dispatchEvent(new CustomEvent('arubot:resource-refresh', { detail: endpoint ? { endpoint } : undefined }));
}

async function postJson(path: string, body: unknown) {
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

function getApiErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message && error.message !== 'request_failed') {
    return error.message;
  }
  return fallback;
}

function normalizeCommand(value: string) {
  return value.trim();
}

function ActionDialogFrame({
  icon,
  badge,
  title,
  description,
  children,
  submitLabel = '저장하기',
  pending = false,
  onSubmit,
  onOpen,
  headerAction,
  testId,
  variant = 'secondary',
  label = badge,
  className,
  trailingChevron = false,
}: ActionDialogFrameProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) onOpen?.();
      }}
    >
      <Dialog.Trigger
        type="button"
        className={cn(
          'inline-flex min-h-[var(--control-height)] max-w-full min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] px-[clamp(0.875rem,1.6vw,1.125rem)] text-sm font-semibold tracking-normal transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
          triggerVariants[variant],
          className,
        )}
        data-testid={testId}
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate">{label}</span>
        </span>
        {trailingChevron ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/24 backdrop-blur-[clamp(0.5rem,1.4vw,1rem)] data-[state=open]:animate-fade-in" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 grid max-h-[min(92svh,50rem)] w-[min(92vw,44rem)] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[var(--radius-panel)] border bg-card/96 shadow-lift outline-none backdrop-blur-2xl data-[state=open]:animate-modal-in"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="border-b bg-card p-[clamp(1.25rem,3vw,2rem)]">
            <div className="relative flex items-start justify-between gap-[clamp(1rem,2vw,1.5rem)]">
              <div className="min-w-0">
                <div className="mb-[clamp(0.75rem,1.6vw,1rem)] flex flex-wrap items-center gap-[clamp(0.5rem,1vw,0.75rem)]">
                  <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-primary/12 text-primary ring-1 ring-primary/25">
                    {icon}
                  </span>
                  <Badge tone="mint">{badge}</Badge>
                </div>
                <Dialog.Title className="break-keep text-[clamp(1.5rem,4vw,2.35rem)] font-semibold leading-tight tracking-normal">
                  {title}
                </Dialog.Title>
                <Dialog.Description className="mt-[clamp(0.75rem,1.4vw,1rem)] max-w-[58ch] break-keep text-sm leading-7 text-muted-foreground md:text-base">
                  {description}
                </Dialog.Description>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {headerAction}
                <Dialog.Close asChild>
                  <Button type="button" variant="outline" size="icon" aria-label="닫기" className="bg-card/75">
                    <X className="h-[1em] w-[1em]" />
                  </Button>
                </Dialog.Close>
              </div>
            </div>
          </div>

          <div className="arubot-modal-scroll grid min-h-0 gap-[clamp(1rem,2vw,1.35rem)] overflow-y-auto p-[clamp(1.25rem,3vw,2rem)]">
            {children}
          </div>

          <div className="flex flex-col-reverse gap-[clamp(0.65rem,1.2vw,0.875rem)] border-t bg-background/64 p-[clamp(1rem,2.4vw,1.5rem)] sm:flex-row sm:items-center sm:justify-end">
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" disabled={pending}>
                취소
              </Button>
            </Dialog.Close>
            <Button type="button" disabled={pending} onClick={() => onSubmit(() => setOpen(false))}>
              {pending ? <Loader2 className="h-[1em] w-[1em] animate-spin" /> : <Check className="h-[1em] w-[1em]" />}
              {submitLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid min-w-0 gap-[clamp(0.5rem,1vw,0.75rem)] text-sm font-semibold">{label}{children}</label>;
}

function Textarea({
  value,
  onChange,
  placeholder,
  min = 'min-h-[clamp(6.75rem,14svh,9.5rem)]',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  min?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={cn(
        'box-border w-full min-w-0 max-w-full resize-y rounded-[var(--radius-control)] border bg-background/80 px-[clamp(0.85rem,1.6vw,1.1rem)] py-[clamp(0.85rem,1.6vw,1.1rem)] text-sm leading-7 outline-none transition placeholder:text-muted-foreground focus:border-primary/45 focus:ring-2 focus:ring-ring',
        min,
      )}
    />
  );
}

export function CommandCreateDialog({ variant = 'secondary', label = '명령어 만들기', className, trailingChevron }: ActionDialogButtonProps) {
  const [name, setName] = useState('');
  const [command, setCommand] = useState('!');
  const [response, setResponse] = useState('');
  const [pointsCost, setPointsCost] = useState('0');
  const [cooldownSec, setCooldownSec] = useState('3');
  const [enabled, setEnabled] = useState(true);
  const [isPending, startTransition] = useTransition();

  const submit = (close: () => void) => {
    const keywords = parseCommandTriggers(command);
    const primaryKeyword = keywords[0] || '';
    const message = response.trim();
    if (!primaryKeyword) return toast.warning('명령어를 입력해 주세요.');
    if (!message) return toast.warning('응답 문구를 입력해 주세요.');
    startTransition(async () => {
      try {
        await postJson('/api/bot/rules/upsert', {
          rule: {
            id: `cmd_${Date.now().toString(36)}`,
            name: name.trim() || primaryKeyword,
            keywords,
            responses: [message],
            enabled,
            adminOnly: false,
            requiredRoleLevel: 1,
            pointsCost: Math.max(0, Number(pointsCost || 0)),
            cooldown: Math.max(1, Number(cooldownSec || 1)) * 1000,
            lastUsed: 0,
          },
        });
        toast.success('명령어를 추가했어요.');
        refreshResource('/api/bot/rules');
        setName('');
        setCommand('!');
        setResponse('');
        setPointsCost('0');
        close();
      } catch (error) {
        toast.error(getApiErrorMessage(error, '명령어를 저장하지 못했어요.'));
      }
    });
  };

  return (
    <ActionDialogFrame
      icon={<MessageSquare className="h-[1em] w-[1em]" />}
      badge="채팅 명령어"
      title="방송에서 바로 쓰는 명령어를 만들어요."
      description="시청자가 채팅에 입력할 말과 봇이 돌려줄 반응을 만듭니다. 포인트로 참여하는 명령어도 함께 준비할 수 있어요."
      submitLabel="명령어 추가"
      pending={isPending}
      onSubmit={submit}
      variant={variant}
      label={label}
      className={className}
      trailingChevron={trailingChevron}
      testId="command-create-trigger"
      headerAction={<CommandVariableHelpButton />}
    >
      <div className="grid gap-[clamp(1rem,2vw,1.35rem)] md:grid-cols-[repeat(2,minmax(0,1fr))]">
        <Field label="표시 이름">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 투표 안내" />
        </Field>
        <Field label="채팅 명령어">
          <Input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="예: !투표 !예측 !vote" />
        </Field>
      </div>
      <Field label="응답 문구">
        <Textarea
          value={response}
          onChange={setResponse}
          placeholder="예: !투표 번호 포인트 형식으로 예측에 참여할 수 있어요."
          min="min-h-[clamp(4.75rem,9svh,6.25rem)]"
        />
      </Field>
      <div className="grid gap-[clamp(1rem,2vw,1.35rem)] md:grid-cols-[repeat(2,minmax(0,1fr))]">
        <Field label="사용 포인트">
          <Input value={pointsCost} onChange={(event) => setPointsCost(event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="쿨다운(초)">
          <Input value={cooldownSec} onChange={(event) => setCooldownSec(event.target.value)} inputMode="numeric" />
        </Field>
        <div className="flex justify-end md:col-span-2">
          <SwitchRow checked={enabled} onCheckedChange={setEnabled} label="바로 사용" className="w-full sm:w-[min(100%,18rem)]" />
        </div>
      </div>
    </ActionDialogFrame>
  );
}

function SwitchRow({ checked, onCheckedChange, label, className }: { checked: boolean; onCheckedChange: (value: boolean) => void; label: string; className?: string }) {
  return (
    <div className={cn('flex min-h-[var(--control-height)] min-w-0 items-center justify-between gap-3 rounded-[var(--radius-control)] border bg-background/70 px-[clamp(0.85rem,1.6vw,1.1rem)]', className)}>
      <span className="min-w-0 truncate text-sm font-semibold">{label}</span>
      <Switch.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="relative h-[1.75rem] w-[3.25rem] rounded-full border bg-muted transition data-[state=checked]:border-primary/35 data-[state=checked]:bg-primary/75"
      >
        <Switch.Thumb className="block h-[1.35rem] w-[1.35rem] translate-x-[0.2rem] rounded-full bg-card shadow-subtle transition data-[state=checked]:translate-x-[1.55rem]" />
      </Switch.Root>
    </div>
  );
}

export function RouletteCreateDialog({ variant = 'secondary', label = '룰렛 만들기', className, trailingChevron }: ActionDialogButtonProps) {
  const [name, setName] = useState('오늘의 룰렛');
  const [command, setCommand] = useState('!룰렛');
  const [layout, setLayout] = useState<RouletteLayout>('reel');
  const [skin, setSkin] = useState<RouletteSkin>('studio');
  const [items, setItems] = useState<EditableRouletteItem[]>(() => createDefaultRouletteItems());
  const [isPending, startTransition] = useTransition();

  const normalizedItems = useMemo(() => normalizeEditableRouletteItems(items), [items]);

  const submit = (close: () => void) => {
    const rouletteName = name.trim();
    const keyword = normalizeCommand(command);
    if (!rouletteName) return toast.warning('룰렛 이름을 입력해 주세요.');
    if (normalizedItems.length < 2) return toast.warning('룰렛 항목은 2개 이상 필요합니다.');
    startTransition(async () => {
      try {
        await postJson('/api/roulette/definitions/upsert', {
          definition: {
            id: `rlt_${Date.now().toString(36)}`,
            name: rouletteName,
            type: 'items',
            theme: `${layout}:${skin}`,
            items: normalizedItems,
          },
        });
        if (keyword && keyword !== '!') {
          await postJson('/api/bot/rules/upsert', {
            rule: {
              id: `cmd_roulette_${Date.now().toString(36)}`,
              name: `${rouletteName} 실행`,
              keywords: [keyword],
              responses: [`${rouletteName}을 돌립니다. \${roulette::${rouletteName}}`],
              enabled: true,
              adminOnly: false,
              requiredRoleLevel: 1,
              pointsCost: 0,
              cooldown: 3000,
              lastUsed: 0,
            },
          });
          refreshResource('/api/bot/rules');
        }
        toast.success('룰렛을 추가했어요.');
        refreshResource('/api/roulette/definitions');
        close();
      } catch {
        toast.error('룰렛을 저장하지 못했어요.');
      }
    });
  };

  return (
    <ActionDialogFrame
      icon={<Sparkles className="h-[1em] w-[1em]" />}
      badge="룰렛"
      title="시청자가 바로 돌릴 수 있는 룰렛을 만들어요."
      description="항목 이름, 가중치, 실행 액션을 나눠 입력해 방송 이벤트 룰렛을 준비합니다."
      submitLabel="룰렛 추가"
      pending={isPending}
      onSubmit={submit}
      variant={variant}
      label={label}
      className={className}
      trailingChevron={trailingChevron}
      testId="roulette-create-trigger"
    >
      <div className="grid gap-[clamp(1rem,2vw,1.35rem)] md:grid-cols-[repeat(2,minmax(0,1fr))]">
        <Field label="룰렛 이름">
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="실행 명령어">
          <Input value={command} onChange={(event) => setCommand(event.target.value)} />
        </Field>
        <Field label="표현 형태">
          <select value={layout} onChange={(event) => setLayout(event.target.value === 'wheel' ? 'wheel' : 'reel')} className="min-h-[var(--control-height)] rounded-[var(--radius-control)] border bg-background px-3 text-sm">
            {ROULETTE_LAYOUT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="스킨">
          <span className="flex min-w-0 items-center gap-2">
            <RouletteThemeSwatch themeId={skin} />
            <select value={skin} onChange={(event) => setSkin((ROULETTE_SKIN_NAMES.includes(event.target.value as RouletteSkin) ? event.target.value : 'studio') as RouletteSkin)} className="min-h-[var(--control-height)] min-w-0 flex-1 rounded-[var(--radius-control)] border bg-background px-3 text-sm">
              {ROULETTE_SKIN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </span>
        </Field>
      </div>
      <div className="grid gap-[clamp(0.5rem,1vw,0.75rem)] text-sm font-semibold">
        <div>룰렛 항목</div>
        <RouletteItemsEditor items={items} onChange={setItems} />
      </div>
      <div className="rounded-[var(--radius-control)] border bg-background/70 p-[clamp(0.85rem,1.6vw,1.1rem)] text-sm leading-6 text-muted-foreground">
        현재 항목 {normalizedItems.length}개가 준비되었습니다. 같은 가중치를 입력하면 같은 확률로 추첨됩니다.
      </div>
    </ActionDialogFrame>
  );
}

export function VideoDonationSettingsDialog({ variant = 'secondary', label = '영상 후원 설정', className }: ActionDialogButtonProps) {
  const [enabled, setEnabled] = useState(false);
  const [pointsPerSecond, setPointsPerSecond] = useState('1');
  const [maxDurationMinutes, setMaxDurationMinutes] = useState('10');
  const [perUserLimit, setPerUserLimit] = useState('0');
  const [volume, setVolume] = useState('100');
  const [providers, setProviders] = useState({
    youtube: true,
    tiktok: false,
    chzzk_clip: true,
    cime_clip: false,
  });
  const [idlePlaylist, setIdlePlaylist] = useState<VideoDonationIdlePlaylist>(() => createDefaultVideoDonationIdlePlaylist());
  const [isPending, startTransition] = useTransition();

  const load = async () => {
    try {
      const response = await fetch(apiUrl('/api/video-donation/settings'), { credentials: 'include', cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      setEnabled(payload.acceptEnabled === true);
      setPointsPerSecond(String(payload.pointsPerSecond ?? 1));
      setMaxDurationMinutes(String(Math.max(1, Math.round(Number(payload.maxDurationSec || 600) / 60))));
      setPerUserLimit(String(payload.perUserLimit ?? 0));
      setVolume(String(Math.max(0, Math.min(100, Math.round(Number(payload.volume ?? 100))))));
      setProviders({
        youtube: payload.providers?.youtube !== false,
        tiktok: payload.providers?.tiktok === true,
        chzzk_clip: payload.providers?.chzzk_clip !== false,
        cime_clip: payload.providers?.cime_clip === true,
      });
      setIdlePlaylist(normalizeVideoDonationIdlePlaylist(payload.idlePlaylist));
    } catch {
      // Existing values remain editable when loading fails.
    }
  };

  const submit = (close: () => void) => {
    startTransition(async () => {
      try {
        await postJson('/api/video-donation/settings', {
          acceptEnabled: enabled,
          pointsPerSecond: Math.max(0, Number(pointsPerSecond || 0)),
          maxDurationSec: Math.max(1, Number(maxDurationMinutes || 1)) * 60,
          perUserLimit: Math.max(0, Number(perUserLimit || 0)),
          volume: Math.max(0, Math.min(100, Math.round(Number(volume || 0)))),
          providers,
          idlePlaylist,
        });
        toast.success('영상 후원 설정을 저장했어요.');
        refreshResource('/api/video-donation/queue');
        close();
      } catch (error) {
        toast.error(getApiErrorMessage(error, '영상 후원 설정을 저장하지 못했어요.'));
      }
    });
  };

  return (
    <ActionDialogFrame
      icon={<Clapperboard className="h-[1em] w-[1em]" />}
      badge="영상 후원"
      title="영상 후원 접수 방식을 설정해요."
      description="시청자가 포인트로 영상을 신청하고 방송 화면에 자연스럽게 이어지도록 비용과 길이를 정합니다."
      submitLabel="설정 저장"
      pending={isPending}
      onSubmit={submit}
      onOpen={load}
      variant={variant}
      label={label}
      className={className}
      testId="video-donation-settings-trigger"
    >
      <SwitchRow checked={enabled} onCheckedChange={setEnabled} label="영상 후원 받기" />
      <div className="grid min-w-0 gap-[clamp(0.75rem,1.5vw,1rem)] rounded-[var(--radius-card)] border bg-background/62 p-[clamp(1rem,2vw,1.25rem)] md:grid-cols-[repeat(2,minmax(0,1fr))]">
        <SwitchRow
          checked={providers.youtube}
          onCheckedChange={(value) => setProviders((current) => ({ ...current, youtube: value }))}
          label="YouTube 받기"
        />
        <SwitchRow
          checked={providers.tiktok}
          onCheckedChange={(value) => setProviders((current) => ({ ...current, tiktok: value }))}
          label="TikTok 받기"
        />
        <SwitchRow
          checked={providers.chzzk_clip}
          onCheckedChange={(value) => setProviders((current) => ({ ...current, chzzk_clip: value }))}
          label="CHZZK 클립 받기"
        />
        <SwitchRow
          checked={providers.cime_clip}
          onCheckedChange={(value) => setProviders((current) => ({ ...current, cime_clip: value }))}
          label="CIME 클립 받기"
        />
      </div>
      <VideoDonationIdlePlaylistEditor value={idlePlaylist} onChange={setIdlePlaylist} />
      <div className="grid min-w-0 gap-[clamp(1.15rem,2.4vw,1.65rem)] rounded-[var(--radius-card)] border bg-background/62 p-[clamp(1rem,2vw,1.25rem)] md:grid-cols-[repeat(2,minmax(0,1fr))]">
        <Field label="초당 포인트">
          <Input value={pointsPerSecond} onChange={(event) => setPointsPerSecond(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="최대 재생 시간(분)">
          <Input value={maxDurationMinutes} onChange={(event) => setMaxDurationMinutes(event.target.value)} inputMode="numeric" />
        </Field>
        <Field label="1인 대기열 제한">
          <Input value={perUserLimit} onChange={(event) => setPerUserLimit(event.target.value)} inputMode="numeric" />
        </Field>
        <Field label={`기본 소리 크기 ${Math.max(0, Math.min(100, Math.round(Number(volume || 0))))}%`}>
          <div className="flex min-h-[var(--control-height)] min-w-0 items-center gap-[clamp(0.75rem,1.5vw,1rem)] rounded-[var(--radius-control)] border bg-background/80 px-[clamp(0.85rem,1.6vw,1.1rem)]">
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(event) => setVolume(event.target.value)}
              className="min-w-0 flex-1 accent-primary"
              aria-label="영상 후원 기본 소리 크기"
            />
            <span className="w-[4ch] text-right text-sm font-semibold tabular-nums">{Math.max(0, Math.min(100, Math.round(Number(volume || 0))))}%</span>
          </div>
        </Field>
      </div>
    </ActionDialogFrame>
  );
}

export function DonationSettingsDialog({ variant = 'secondary', label = '후원 설정', className }: ActionDialogButtonProps) {
  const [pointsPerK, setPointsPerK] = useState('10');
  const [isPending, startTransition] = useTransition();

  const load = async () => {
    try {
      const response = await fetch(apiUrl('/api/donation/settings'), { credentials: 'include', cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      setPointsPerK(String(payload.settings?.pointsPerK ?? 10));
    } catch {
      // Keep local defaults.
    }
  };

  const submit = (close: () => void) => {
    startTransition(async () => {
      try {
        await postJson('/api/donation/settings', { settings: { pointsPerK: Math.max(0, Number(pointsPerK || 0)) } });
        toast.success('후원 설정을 저장했어요.');
        refreshResource('/api/donation/rules');
        close();
      } catch {
        toast.error('후원 설정을 저장하지 못했어요.');
      }
    });
  };

  return (
    <ActionDialogFrame
      icon={<Settings className="h-[1em] w-[1em]" />}
      badge="후원 설정"
      title="후원 포인트 적립 기준을 정해요."
      description="후원한 마음이 다음 참여 포인트로 이어지도록 금액별 적립 기준을 정합니다."
      submitLabel="설정 저장"
      pending={isPending}
      onSubmit={submit}
      onOpen={load}
      variant={variant}
      label={label}
      className={className}
      testId="donation-settings-trigger"
    >
      <Field label="1,000원당 지급 포인트">
        <Input value={pointsPerK} onChange={(event) => setPointsPerK(event.target.value)} inputMode="numeric" />
      </Field>
    </ActionDialogFrame>
  );
}

export function DonationRuleCreateDialog({ variant = 'secondary', label = '반응 만들기', className }: ActionDialogButtonProps) {
  const [name, setName] = useState('');
  const [amountConditions, setAmountConditions] = useState<DonationAmountConditionForm[]>([
    { id: 'cond_initial', operator: 'gte', amount: '1000', amountTo: '' },
  ]);
  const [messageIncludes, setMessageIncludes] = useState('');
  const [response, setResponse] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [isPending, startTransition] = useTransition();

  const submit = (close: () => void) => {
    if (!response.trim()) return toast.warning('후원 반응 문구를 입력해 주세요.');
    const normalizedAmountConditions = serializeDonationAmountConditions(amountConditions);
    if (!normalizedAmountConditions.length) return toast.warning('금액 조건을 하나 이상 입력해 주세요.');
    const legacyAmounts = deriveLegacyAmountFields(normalizedAmountConditions);
    startTransition(async () => {
      try {
        await postJson('/api/donation/rules/upsert', {
          rule: {
            id: `don_${Date.now().toString(36)}`,
            name: name.trim() || `${describeDonationAmountRule({ amountConditions: normalizedAmountConditions })} 반응`,
            enabled,
            ...legacyAmounts,
            amountConditions: normalizedAmountConditions,
            message: messageIncludes.trim(),
            wildcard: true,
            response: response.trim(),
          },
        });
        toast.success('후원 반응을 추가했어요.');
        refreshResource('/api/donation/rules');
        setName('');
        setResponse('');
        setMessageIncludes('');
        setAmountConditions([{ id: 'cond_initial', operator: 'gte', amount: '1000', amountTo: '' }]);
        close();
      } catch {
        toast.error('후원 반응을 저장하지 못했어요.');
      }
    });
  };

  const updateAmountCondition = (id: string, patch: Partial<DonationAmountConditionForm>) => {
    setAmountConditions((current) => current.map((condition) => (
      condition.id === id ? { ...condition, ...patch } : condition
    )));
  };

  const addAmountCondition = () => {
    setAmountConditions((current) => [
      ...current,
      { id: `cond_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, operator: 'gte', amount: '1000', amountTo: '' },
    ]);
  };

  const removeAmountCondition = (id: string) => {
    if (amountConditions.length <= 1) return toast.warning('금액 조건은 하나 이상 필요합니다.');
    setAmountConditions((current) => current.filter((condition) => condition.id !== id));
  };

  return (
    <ActionDialogFrame
      icon={<Gift className="h-[1em] w-[1em]" />}
      badge="후원 반응"
      title="후원 조건에 맞는 반응을 만들어요."
      description="특정 금액이나 메시지가 들어왔을 때 채팅과 연출이 더 특별하게 반응하게 합니다."
      submitLabel="반응 추가"
      pending={isPending}
      onSubmit={submit}
      headerAction={<CommandVariableHelpButton scope="donation" />}
      variant={variant}
      label={label}
      className={className}
      testId="donation-rule-create-trigger"
    >
      <div className="grid gap-[clamp(1rem,2vw,1.35rem)]">
        <Field label="반응 이름">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 큰손 감사 인사" />
        </Field>
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">트리거 금액 조건</div>
            <Button type="button" variant="outline" size="sm" onClick={addAmountCondition}>
              <Plus className="h-4 w-4" />
              조건 추가
            </Button>
          </div>
          <div className="grid gap-2">
            {amountConditions.map((condition) => (
              <div key={condition.id} className="grid gap-2 rounded-[var(--radius-control)] border bg-background/55 p-3 md:grid-cols-[minmax(8rem,0.36fr)_minmax(0,1fr)_minmax(0,1fr)_var(--control-height)] md:items-center">
                <select
                  value={condition.operator}
                  onChange={(event) => updateAmountCondition(condition.id, { operator: event.target.value as DonationAmountOperator })}
                  className="min-h-[var(--control-height)] rounded-[var(--radius-control)] border bg-background px-3 text-sm"
                >
                  {DONATION_AMOUNT_OPERATOR_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <Input
                  value={condition.amount}
                  onChange={(event) => updateAmountCondition(condition.id, { amount: event.target.value })}
                  inputMode="numeric"
                  placeholder={condition.operator === 'range' ? '시작 금액' : '금액'}
                />
                {condition.operator === 'range' ? (
                  <Input
                    value={condition.amountTo}
                    onChange={(event) => updateAmountCondition(condition.id, { amountTo: event.target.value })}
                    inputMode="numeric"
                    placeholder="끝 금액"
                  />
                ) : (
                  <div className="hidden md:block" />
                )}
                <Button type="button" variant="ghost" size="icon" aria-label="금액 조건 삭제" onClick={() => removeAmountCondition(condition.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
      <Field label="메시지 포함 조건">
        <Input value={messageIncludes} onChange={(event) => setMessageIncludes(event.target.value)} placeholder="특정 문구가 없으면 금액만 볼게요." />
      </Field>
      <Field label="반응 문구">
        <Textarea value={response} onChange={setResponse} placeholder="예: 후원 감사합니다! 방송에서 바로 확인할게요." />
      </Field>
      <SwitchRow checked={enabled} onCheckedChange={setEnabled} label="바로 사용" />
    </ActionDialogFrame>
  );
}
