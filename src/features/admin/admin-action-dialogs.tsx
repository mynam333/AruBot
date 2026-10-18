'use client';

import { useBotChannel } from '@/components/app-shell/bot-channel-provider';

import * as Dialog from '@radix-ui/react-dialog';
import * as Switch from '@radix-ui/react-switch';
import {
  Check,
  Clapperboard,
  Eye,
  EyeOff,
  Gift,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  ChevronRight,
  Settings,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useId, useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { RouletteThemeSwatch } from '@/components/rouletteThemeSwatch';
import { CommandVariableHelpButton } from '@/features/admin/command-variable-help';
import { parseCommandTriggers } from '@/features/admin/command-triggers';
import { RegexSwitch } from './regex-switch';
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
  module: 'commands' | 'roulette' | 'video' | 'donations';
  readOnlyView?: boolean;
  icon: React.ReactNode;
  badge: string;
  title: string;
  description: string;
  children: React.ReactNode;
  submitLabel?: string;
  pending?: boolean;
  disabled?: boolean;
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

const CHZZK_CONNECTION_STATUS_LABELS = new Map([
  ['connecting', '연결 중'],
  ['connected', '연결됨'],
  ['retrying', '재연결 중'],
  ['disabled', '사용 안 함'],
]);
const CHZZK_PUBLIC_CONNECTION_ERRORS = [
  '재생 상태 동기화 실패',
  '치지직 영상후원 처리 실패 · 자동 재시도 중',
  '치지직 연결 실패 · 자동 재연결 중',
  '치지직 영상후원 대기 한도 초과',
  '치지직 스킵 동기화 실패',
  '치지직 재생 상태 알림 실패',
];

function readChzzkConnection(value?: { status?: string; error?: string | null }) {
  // Never render arbitrary backend errors that could contain the private URL.
  return {
    label: CHZZK_CONNECTION_STATUS_LABELS.get(value?.status ?? '') ?? '상태 확인 필요',
    error: value?.error
      ? CHZZK_PUBLIC_CONNECTION_ERRORS.includes(value.error) ? value.error : '치지직 연결 오류가 발생했습니다. 연결 URL을 확인해 주세요.'
      : '',
  };
}

function ActionDialogFrame({
  module,
  readOnlyView = false,
  icon,
  badge,
  title,
  description,
  children,
  submitLabel = '저장하기',
  pending = false,
  disabled = false,
  onSubmit,
  onOpen,
  headerAction,
  testId,
  variant = 'secondary',
  label = badge,
  className,
  trailingChevron = false,
}: ActionDialogFrameProps) {
  const { canWrite } = useBotChannel();
  const writable = canWrite(module);
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
        disabled={!writable && !readOnlyView}
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
            <fieldset disabled={!writable || disabled} className="contents">{children}</fieldset>
          </div>

          <div className="flex flex-col-reverse gap-[clamp(0.65rem,1.2vw,0.875rem)] border-t bg-background/64 p-[clamp(1rem,2.4vw,1.5rem)] sm:flex-row sm:items-center sm:justify-end">
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" disabled={pending}>
                취소
              </Button>
            </Dialog.Close>
            <Button type="button" disabled={!writable || pending || disabled} onClick={() => { if (writable && !disabled) onSubmit(() => setOpen(false)); }}>
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
  const [regex, setRegex] = useState(false);
  const [response, setResponse] = useState('');
  const [pointsCost, setPointsCost] = useState('0');
  const [cooldownSec, setCooldownSec] = useState('3');
  const [enabled, setEnabled] = useState(true);
  const [isPending, startTransition] = useTransition();

  const submit = (close: () => void) => {
    const keywords = parseCommandTriggers(command, { regex });
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
            regex,
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
        setRegex(false);
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
      module="commands"
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
          {regex ? <Textarea value={command} onChange={setCommand} placeholder="!(투표|예측|vote)" min="min-h-20" />
            : <Input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="예: !투표 !예측 !vote" />}
        </Field>
      </div>
      <RegexSwitch checked={regex} onCheckedChange={setRegex} />
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

function SwitchRow({ checked, onCheckedChange, label, className, disabled }: { checked: boolean; onCheckedChange: (value: boolean) => void; label: string; className?: string; disabled?: boolean }) {
  return (
    <div className={cn('flex min-h-[var(--control-height)] min-w-0 items-center justify-between gap-3 rounded-[var(--radius-control)] border bg-background/70 px-[clamp(0.85rem,1.6vw,1.1rem)]', className)}>
      <span className="min-w-0 truncate text-sm font-semibold">{label}</span>
      <Switch.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={label}
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
      module="roulette"
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
  const [bgmEnabled, setBgmEnabled] = useState(false);
  const [bgmAcceptEnabled, setBgmAcceptEnabled] = useState(false);
  const [bgmPointsPerSecond, setBgmPointsPerSecond] = useState('1');
  const [bgmIdlePlaylist, setBgmIdlePlaylist] = useState<VideoDonationIdlePlaylist>(() => createDefaultVideoDonationIdlePlaylist());
  const [chzzkVideoDonation, setChzzkVideoDonation] = useState({ pauseEnabled: false, queueEnabled: false, configured: false });
  const [chzzkOverlayUrl, setChzzkOverlayUrl] = useState<string | undefined>();
  const [chzzkUrlRevealed, setChzzkUrlRevealed] = useState(false);
  const [chzzkConnection, setChzzkConnection] = useState(() => readChzzkConnection());
  const [chzzkStatusRefreshing, setChzzkStatusRefreshing] = useState(false);
  const chzzkStatusVersion = useRef(0);
  const [settingsState, setSettingsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [isPending, setIsPending] = useState(false);
  const loadVersion = useRef(0);
  const chzzkUrlId = useId();
  const chzzkUrlRemoving = chzzkOverlayUrl === '';
  const chzzkUrlEntered = chzzkOverlayUrl?.trim() || '';
  let chzzkUrlValid = false;
  try {
    const url = new URL(chzzkUrlEntered);
    chzzkUrlValid = url.protocol === 'https:'
      && url.hostname === 'chzzk.naver.com'
      && !url.username && !url.password && !url.port && !url.hash
      // Check the raw authority too: URL normalizes an explicit :443 to an empty port.
      && /^https:\/\/chzzk\.naver\.com\/video-donation\/video@[A-Za-z0-9_-]+(?:\?[^\s#]*)?$/.test(chzzkUrlEntered);
  } catch {
    // The server performs CHZZK-specific URL validation on save.
  }
  const chzzkCanEnable = !chzzkUrlRemoving && (chzzkVideoDonation.configured || chzzkUrlValid);

  const load = async () => {
    const version = ++loadVersion.current;
    ++chzzkStatusVersion.current;
    setChzzkStatusRefreshing(false);
    setChzzkConnection(readChzzkConnection());
    setSettingsState('loading');
    setChzzkOverlayUrl(undefined);
    setChzzkUrlRevealed(false);
    try {
      const response = await fetch(apiUrl('/api/video-donation/settings'), { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error('request_failed');
      const payload = await response.json();
      if (version !== loadVersion.current) return;
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
      setBgmEnabled(payload.bgm?.enabled === true);
      setBgmAcceptEnabled(payload.bgm?.acceptEnabled === true);
      setBgmPointsPerSecond(String(payload.bgm?.pointsPerSecond ?? 1));
      setBgmIdlePlaylist(normalizeVideoDonationIdlePlaylist(payload.bgm?.idlePlaylist));
      setChzzkVideoDonation({
        pauseEnabled: payload.chzzkVideoDonation?.pauseEnabled === true,
        queueEnabled: payload.chzzkVideoDonation?.queueEnabled === true,
        configured: payload.chzzkVideoDonation?.configured === true,
      });
      setChzzkConnection(readChzzkConnection(payload.chzzkVideoDonation));
      setSettingsState('ready');
    } catch {
      if (version !== loadVersion.current) return;
      setSettingsState('error');
      toast.error('설정을 불러오지 못했어요. 창을 다시 열어 주세요.');
    }
  };

  const refreshChzzkStatus = async () => {
    if (settingsState !== 'ready' || chzzkStatusRefreshing || isPending) return;
    const version = ++chzzkStatusVersion.current;
    setChzzkStatusRefreshing(true);
    try {
      const response = await fetch(apiUrl('/api/video-donation/settings'), { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error('request_failed');
      const payload = await response.json();
      if (version !== chzzkStatusVersion.current) return;
      setChzzkConnection(readChzzkConnection(payload.chzzkVideoDonation));
    } catch {
      if (version !== chzzkStatusVersion.current) return;
      setChzzkConnection((current) => ({ ...current, error: '연결 상태를 불러오지 못했어요. 다시 새로고침해 주세요.' }));
    } finally {
      if (version === chzzkStatusVersion.current) setChzzkStatusRefreshing(false);
    }
  };

  const submit = async (close: () => void) => {
    if (settingsState !== 'ready' || isPending) return;
    if (chzzkUrlEntered && !chzzkUrlValid) return toast.warning('올바른 치지직 영상후원 URL을 입력해 주세요.');
    if (!chzzkUrlRemoving && !chzzkCanEnable && (chzzkVideoDonation.pauseEnabled || chzzkVideoDonation.queueEnabled)) {
      return toast.warning('치지직 영상후원 URL을 입력해 주세요.');
    }
    setIsPending(true);
    try {
      await postJson('/api/video-donation/settings', {
        acceptEnabled: enabled,
        pointsPerSecond: Math.max(0, Number(pointsPerSecond || 0)),
        maxDurationSec: Math.max(1, Number(maxDurationMinutes || 1)) * 60,
        perUserLimit: Math.max(0, Number(perUserLimit || 0)),
        volume: Math.max(0, Math.min(100, Math.round(Number(volume || 0)))),
        providers,
        idlePlaylist,
        bgm: { enabled: bgmEnabled, acceptEnabled: bgmAcceptEnabled, pointsPerSecond: Number(bgmPointsPerSecond), idlePlaylist: bgmIdlePlaylist },
        chzzkVideoDonation: {
          pauseEnabled: !chzzkUrlRemoving && chzzkVideoDonation.pauseEnabled,
          queueEnabled: !chzzkUrlRemoving && chzzkVideoDonation.queueEnabled,
          ...(chzzkOverlayUrl !== undefined ? { overlayUrl: chzzkOverlayUrl.trim() } : {}),
        },
      });
      setChzzkOverlayUrl(undefined);
      setChzzkUrlRevealed(false);
      toast.success('영상 후원 설정을 저장했어요.');
      refreshResource('/api/video-donation/queue');
      close();
    } catch (error) {
      toast.error(getApiErrorMessage(error, '영상 후원 설정을 저장하지 못했어요.'));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <ActionDialogFrame
      module="video"
      readOnlyView
      icon={<Clapperboard className="h-[1em] w-[1em]" />}
      badge="영상 후원"
      title="영상 후원 · BGM 설정"
      description="시청자가 포인트로 영상을 신청하고 방송 화면에 자연스럽게 이어지도록 비용과 길이를 정합니다."
      submitLabel="설정 저장"
      pending={isPending}
      disabled={settingsState !== 'ready' || isPending}
      onSubmit={submit}
      onOpen={load}
      variant={variant}
      label={label}
      className={className}
      testId="video-donation-settings-trigger"
    >
      {settingsState !== 'ready' ? (
        <p role={settingsState === 'error' ? 'alert' : 'status'} className="text-sm text-muted-foreground">
          {settingsState === 'error' ? '설정을 불러오지 못했어요. 창을 닫고 다시 열어 주세요.' : '설정을 불러오는 중입니다.'}
        </p>
      ) : null}
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
      <section className="grid min-w-0 gap-4 border-t py-5" aria-label="치지직 영상후원 연동">
        <h3 className="text-base font-semibold">치지직 영상후원 연동</h3>
        <div className="grid min-w-0 gap-2">
          <label htmlFor={chzzkUrlId} className="text-sm font-semibold">치지직 영상후원 URL</label>
          <div className="flex min-w-0 items-center gap-2">
            <Input
              id={chzzkUrlId}
              type={chzzkUrlRevealed ? 'text' : 'password'}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              inputMode="url"
              value={chzzkOverlayUrl ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                setChzzkOverlayUrl(value.trim() ? value : chzzkUrlRemoving ? '' : undefined);
              }}
              placeholder={chzzkVideoDonation.configured && !chzzkUrlRemoving ? 'URL 저장됨 · 변경할 새 URL 입력' : '치지직 영상후원 URL 입력'}
              className="min-w-0 flex-1"
            />
            <Tooltip content={chzzkUrlRevealed ? '입력한 URL 숨기기' : '입력한 URL 보기'}>
              <span className="inline-flex shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  disabled={!chzzkUrlEntered}
                  aria-label={chzzkUrlRevealed ? '입력한 URL 숨기기' : '입력한 URL 보기'}
                  aria-pressed={chzzkUrlRevealed}
                  onClick={() => setChzzkUrlRevealed((value) => !value)}
                >
                  {chzzkUrlRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </span>
            </Tooltip>
          </div>
          {chzzkVideoDonation.configured ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span role="status" className="text-xs text-muted-foreground">
                {chzzkUrlRemoving ? '저장 시 연결 URL이 삭제됩니다.' : 'URL 저장됨'}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (chzzkUrlRemoving) {
                    setChzzkOverlayUrl(undefined);
                  } else {
                    setChzzkOverlayUrl('');
                    setChzzkUrlRevealed(false);
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
                {chzzkUrlRemoving ? 'URL 삭제 취소' : '저장된 URL 삭제'}
              </Button>
            </div>
          ) : null}
          <div className="flex min-w-0 items-center justify-between gap-2">
            <p role="status" className="min-w-0 break-keep text-xs text-muted-foreground">
              저장된 설정의 연결 상태: {chzzkConnection.label}
            </p>
            <Tooltip content="치지직 연결 상태 새로고침">
              <span className="inline-flex shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  aria-label="치지직 연결 상태 새로고침"
                  disabled={chzzkStatusRefreshing}
                  onClick={refreshChzzkStatus}
                >
                  <RefreshCw className={cn('h-4 w-4', chzzkStatusRefreshing && 'animate-spin motion-reduce:animate-none')} />
                </Button>
              </span>
            </Tooltip>
          </div>
          {chzzkConnection.error ? <p role="alert" className="break-keep text-xs leading-5 text-destructive">{chzzkConnection.error}</p> : null}
        </div>
        <div className="grid gap-4">
          {([
            { key: 'pauseEnabled', label: '치지직 영상후원 중 AruBot 영상·BGM 일시정지' },
            { key: 'queueEnabled', label: '치지직 영상후원을 AruBot 대기열에 추가' },
          ] as const).map(({ key, label: toggleLabel }) => (
            <label key={key} className="flex min-h-[var(--control-height)] min-w-0 items-center justify-between gap-3">
              <span className="min-w-0 break-keep text-sm font-semibold">{toggleLabel}</span>
              <Switch.Root
                checked={!chzzkUrlRemoving && chzzkVideoDonation[key]}
                onCheckedChange={(value) => setChzzkVideoDonation((current) => ({ ...current, [key]: value }))}
                disabled={chzzkUrlRemoving || (!chzzkCanEnable && !chzzkVideoDonation[key])}
                aria-label={toggleLabel}
                className="relative h-[1.75rem] w-[3.25rem] shrink-0 rounded-full border bg-muted transition disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary/35 data-[state=checked]:bg-primary/75"
              >
                <Switch.Thumb className="block h-[1.35rem] w-[1.35rem] translate-x-[0.2rem] rounded-full bg-card shadow-subtle transition data-[state=checked]:translate-x-[1.55rem]" />
              </Switch.Root>
            </label>
          ))}
        </div>
        {!chzzkUrlRemoving && chzzkVideoDonation.pauseEnabled && chzzkVideoDonation.queueEnabled ? (
          <p role="note" className="break-keep text-xs leading-5 text-muted-foreground">
            두 기능을 함께 켜면 AruBot 대기열 재생이 우선하며, 치지직 연동 일시정지는 적용되지 않습니다.
          </p>
        ) : null}
        {!chzzkUrlRemoving && chzzkVideoDonation.queueEnabled ? (
          <p role="note" className="break-keep text-sm leading-6 text-amber-800 dark:text-amber-200">
            치지직 기본 영상후원 소스는 OBS에서 제거해 중복 재생을 방지해 주세요.
          </p>
        ) : null}
      </section>
      <fieldset disabled={bgmEnabled} className="min-w-0 disabled:opacity-50">
        <VideoDonationIdlePlaylistEditor value={idlePlaylist} onChange={setIdlePlaylist} />
      </fieldset>
      <section className="grid min-w-0 gap-4 border-y py-5" aria-label="BGM 설정">
        <h3 className="text-base font-semibold">BGM</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <SwitchRow checked={bgmEnabled} onCheckedChange={setBgmEnabled} disabled={idlePlaylist.enabled} label="BGM 사용" />
          <SwitchRow checked={bgmAcceptEnabled} onCheckedChange={setBgmAcceptEnabled} disabled={!bgmEnabled} label="BGM 신청 받기" />
        </div>
        {idlePlaylist.enabled ? <p className="text-sm text-muted-foreground">대기 음악을 끈 후 BGM을 켤 수 있습니다.</p> : null}
        <Field label="BGM 초당 포인트">
          <Input type="number" min={0} step="any" value={bgmPointsPerSecond} onChange={(event) => setBgmPointsPerSecond(event.target.value)} />
        </Field>
        <fieldset disabled={!bgmEnabled} className="min-w-0 disabled:opacity-50">
          <VideoDonationIdlePlaylistEditor value={bgmIdlePlaylist} onChange={setBgmIdlePlaylist} title="대기 BGM" idPrefix="bgm-idle" />
        </fieldset>
      </section>
      <div className="grid min-w-0 gap-[clamp(1.15rem,2.4vw,1.65rem)] rounded-[var(--radius-card)] border bg-background/62 p-[clamp(1rem,2vw,1.25rem)] md:grid-cols-[repeat(2,minmax(0,1fr))]">
        <Field label="영상 후원 초당 포인트">
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
  const [settingsState, setSettingsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [isPending, startTransition] = useTransition();

  const load = async () => {
    setSettingsState('loading');
    try {
      const response = await fetch(apiUrl('/api/donation/settings'), { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error('settings_load_failed');
      const payload = await response.json();
      if (!payload.settings) throw new Error('settings_missing');
      setPointsPerK(String(payload.settings?.pointsPerK ?? 10));
      setSettingsState('ready');
    } catch {
      setSettingsState('error');
    }
  };

  const submit = (close: () => void) => {
    if (settingsState !== 'ready' || isPending) return;
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
      module="donations"
      readOnlyView
      icon={<Settings className="h-[1em] w-[1em]" />}
      badge="후원 설정"
      title="후원 포인트 적립 기준을 정해요."
      description="후원한 마음이 다음 참여 포인트로 이어지도록 금액별 적립 기준을 정합니다."
      submitLabel="설정 저장"
      pending={isPending}
      disabled={settingsState !== 'ready' || isPending}
      onSubmit={submit}
      onOpen={load}
      variant={variant}
      label={label}
      className={className}
      testId="donation-settings-trigger"
    >
      {settingsState !== 'ready' ? (
        <p role={settingsState === 'error' ? 'alert' : 'status'} className="text-sm text-muted-foreground">
          {settingsState === 'error' ? '설정을 불러오지 못했어요. 창을 닫고 다시 열어 주세요.' : '설정을 불러오는 중입니다.'}
        </p>
      ) : null}
      <Field label="1,000원당 지급 포인트">
        <Input disabled={settingsState !== 'ready' || isPending} value={pointsPerK} onChange={(event) => setPointsPerK(event.target.value)} inputMode="numeric" />
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
  const [regex, setRegex] = useState(false);
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
            regex,
            wildcard: true,
            response: response.trim(),
          },
        });
        toast.success('후원 반응을 추가했어요.');
        refreshResource('/api/donation/rules');
        setName('');
        setResponse('');
        setMessageIncludes('');
        setRegex(false);
        setAmountConditions([{ id: 'cond_initial', operator: 'gte', amount: '1000', amountTo: '' }]);
        close();
      } catch (error) {
        toast.error(getApiErrorMessage(error, '후원 반응을 저장하지 못했어요.'));
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
      module="donations"
      icon={<Gift className="h-[1em] w-[1em]" />}
      badge="후원 반응"
      title="후원 조건에 맞는 반응을 만들어요."
      description="특정 금액이나 메시지가 들어왔을 때 채팅과 연출이 더 특별하게 반응하게 합니다."
      submitLabel="반응 추가"
      pending={isPending}
      onSubmit={submit}
      headerAction={<CommandVariableHelpButton scope="donation" onInsert={(key) => setResponse((value) => value + key)} />}
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
      <Field label={regex ? '메시지 정규식' : '메시지 포함 조건'}>
        <Input value={messageIncludes} onChange={(event) => setMessageIncludes(event.target.value)} placeholder={regex ? '(룰렛|돌려줘)' : '특정 문구가 없으면 금액만 볼게요.'} maxLength={regex ? 256 : undefined} />
      </Field>
      <RegexSwitch checked={regex} onCheckedChange={setRegex} />
      <Field label="반응 문구">
        <Textarea value={response} onChange={setResponse} placeholder="예: 후원 감사합니다! 방송에서 바로 확인할게요." />
      </Field>
      <SwitchRow checked={enabled} onCheckedChange={setEnabled} label="바로 사용" />
    </ActionDialogFrame>
  );
}
