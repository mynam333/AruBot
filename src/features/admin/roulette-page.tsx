'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Check, ChevronRight, Loader2, PencilLine, Play, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { RouletteCreateDialog } from '@/features/admin/admin-action-dialogs';
import { ViewerTokenPanel } from '@/features/admin/viewer-token-panel';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EmptyState, PageHeader } from '@/components/ui/page';
import { Pagination } from '@/components/ui/pagination';
import { RouletteThemeSwatch } from '@/components/rouletteThemeSwatch';
import {
  RouletteItemsEditor,
} from '@/features/admin/roulette-item-editor';
import {
  normalizeEditableRouletteItems,
  toEditableRouletteItems,
  type EditableRouletteItem,
} from '@/features/admin/roulette-item-model';
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
    spinId?: string;
    spinDurationMs?: number;
    spinStartedAt?: number;
  };
};

type RouletteViewerUrlResponse = {
  token?: string;
  path?: string;
};

type RouletteEmbeddedMessage = {
  type?: string;
  token?: string;
  testConnectionId?: string;
  spinId?: string | null;
  label?: string | null;
  value?: string | number | null;
  selectedIndex?: number;
  itemCount?: number;
};

type RouletteTestPhase = 'preparing' | 'connecting' | 'spinning' | 'settled' | 'error';

const ROULETTE_PAGE_SIZE = 8;

function createRouletteTestConnectionId() {
  if (typeof window !== 'undefined' && typeof window.crypto?.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `roulette_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

function normalizeRouletteResultLabel(value: unknown) {
  return String(value || '').trim().normalize('NFC');
}

const ROULETTE_LAYOUT_OPTIONS = [
  { value: 'reel', label: '릴 형태' },
  { value: 'wheel', label: '휠 형태' },
] as const;
type RouletteLayout = (typeof ROULETTE_LAYOUT_OPTIONS)[number]['value'];
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
type RouletteSkin = (typeof ROULETTE_SKIN_OPTIONS)[number]['value'];
const ROULETTE_SKIN_NAMES = ROULETTE_SKIN_OPTIONS.map((option) => option.value);
const ROULETTE_LEGACY_SKIN_MAP: Record<string, RouletteSkin> = {
  classic: 'studio',
  fire: 'solar',
  ice: 'ocean',
  pastel: 'prism',
  forest: 'aurora',
  midnight: 'mono',
  sunset: 'solar',
};

function parseRouletteTheme(value?: string | null) {
  const text = String(value || 'studio').toLowerCase().trim();
  const parts = text.split(/[:_\-\s]+/).filter(Boolean);
  const layout = parts.find((part) => part === 'reel' || part === 'wheel') || 'reel';
  const rawSkin = parts.find((part) => ROULETTE_SKIN_NAMES.includes(part as RouletteSkin) || ROULETTE_LEGACY_SKIN_MAP[part]) || text || 'studio';
  const skin = ROULETTE_LEGACY_SKIN_MAP[rawSkin] || rawSkin;
  return { layout, theme: ROULETTE_SKIN_NAMES.includes(skin as RouletteSkin) ? (skin as RouletteSkin) : 'studio' };
}

function getRouletteSkinLabel(value: string) {
  return ROULETTE_SKIN_OPTIONS.find((option) => option.value === value)?.label || '스튜디오';
}


async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error || 'request_failed');
  }
  return response.json();
}

function RouletteEditDialog({
  definition,
  onSaved,
}: {
  definition: RouletteDefinition;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(definition.name);
  const [layout, setLayout] = useState<RouletteLayout>(() => parseRouletteTheme(definition.theme).layout);
  const [theme, setTheme] = useState<RouletteSkin>(() => parseRouletteTheme(definition.theme).theme);
  const [items, setItems] = useState<EditableRouletteItem[]>(() => toEditableRouletteItems(definition.items));
  const [isPending, startTransition] = useTransition();

  const reset = useCallback(() => {
    const parsed = parseRouletteTheme(definition.theme);
    setName(definition.name);
    setLayout(parsed.layout);
    setTheme(parsed.theme);
    setItems(toEditableRouletteItems(definition.items));
  }, [definition]);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const save = () => {
    const rouletteName = name.trim();
    const normalizedItems = normalizeEditableRouletteItems(items);
    if (!rouletteName) return toast.warning('룰렛 이름을 입력해 주세요.');
    if (normalizedItems.length < 2) return toast.warning('룰렛 항목은 2개 이상 필요합니다.');

    startTransition(async () => {
      try {
        await postJson('/api/roulette/definitions/upsert', {
          definition: {
            ...definition,
            id: definition.id || `rlt_${Date.now().toString(36)}`,
            name: rouletteName,
            type: 'items',
            theme: `${layout}:${theme}`,
            items: normalizedItems,
          },
        });
        toast.success('룰렛을 저장했어요.');
        onSaved();
        setOpen(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '룰렛을 저장하지 못했어요.');
      }
    });
  };

  const deleteRoulette = () => {
    const ok = window.confirm(`${definition.name} 룰렛을 삭제할까요? 삭제한 룰렛은 되돌릴 수 없습니다.`);
    if (!ok) return;

    startTransition(async () => {
      try {
        await postJson('/api/roulette/definitions/delete', {
          id: definition.id || '',
          name: definition.name,
        });
        toast.success('룰렛을 삭제했어요.');
        onSaved();
        setOpen(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '룰렛을 삭제하지 못했어요.');
      }
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button type="button" variant="outline">
          자세히
          <ChevronRight className="h-4 w-4" />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/24 backdrop-blur-[clamp(0.5rem,1.4vw,1rem)] data-[state=open]:animate-fade-in" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 grid max-h-[min(92svh,54rem)] w-[min(94vw,58rem)] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[var(--radius-panel)] border bg-card/96 shadow-lift outline-none backdrop-blur-2xl data-[state=open]:animate-modal-in"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="border-b bg-card p-[clamp(1.25rem,3vw,2rem)]">
            <div className="flex items-start justify-between gap-[clamp(1rem,2vw,1.5rem)]">
              <div className="min-w-0">
                <div className="mb-[clamp(0.75rem,1.6vw,1rem)] flex flex-wrap items-center gap-[clamp(0.5rem,1vw,0.75rem)]">
                  <span className="grid aspect-square w-[var(--icon-box)] place-items-center rounded-[var(--radius-control)] bg-primary/12 text-primary ring-1 ring-primary/25">
                    <PencilLine className="h-[1em] w-[1em]" />
                  </span>
                  <Badge tone="lemon">룰렛 편집</Badge>
                  <Badge tone="neutral">{normalizeEditableRouletteItems(items).length}개 항목</Badge>
                </div>
                <Dialog.Title className="break-keep text-[clamp(1.5rem,4vw,2.1rem)] font-bold leading-tight tracking-tight">
                  {definition.name}
                </Dialog.Title>
                <Dialog.Description className="mt-[clamp(0.75rem,1.4vw,1rem)] max-w-[64ch] break-keep text-sm leading-7 text-muted-foreground md:text-base">
                  룰렛 이름과 항목을 바로 다듬고, 당첨 순간에 함께 나갈 자동화 액션도 연결할 수 있어요.
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
            <div className="grid gap-[clamp(1rem,2vw,1.35rem)] md:grid-cols-[minmax(0,1fr)_minmax(10rem,0.25fr)_minmax(10rem,0.28fr)]">
              <label className="grid gap-[clamp(0.5rem,1vw,0.75rem)] text-sm font-semibold">
                룰렛 이름
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="grid gap-[clamp(0.5rem,1vw,0.75rem)] text-sm font-semibold">
                표현 형태
                <select value={layout} onChange={(event) => setLayout(event.target.value === 'wheel' ? 'wheel' : 'reel')} className="min-h-[var(--control-height)] rounded-[var(--radius-control)] border bg-background px-3 text-sm">
                  {ROULETTE_LAYOUT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="grid gap-[clamp(0.5rem,1vw,0.75rem)] text-sm font-semibold">
                스킨
                <span className="flex min-w-0 items-center gap-2">
                  <RouletteThemeSwatch themeId={theme} />
                  <select value={theme} onChange={(event) => setTheme((ROULETTE_SKIN_NAMES.includes(event.target.value as RouletteSkin) ? event.target.value : 'studio') as RouletteSkin)} className="min-h-[var(--control-height)] min-w-0 flex-1 rounded-[var(--radius-control)] border bg-background px-3 text-sm">
                    {ROULETTE_SKIN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </span>
              </label>
            </div>

            <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border bg-muted/25 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold">방송 화면 설정</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">{layout === 'wheel' ? '휠 형태' : '릴 형태'} · {getRouletteSkinLabel(theme)} 스킨이 다음 실행부터 실제 OBS 화면에 적용됩니다.</div>
              </div>
              <Badge tone="mint">실제 데이터 사용</Badge>
            </div>

            <div className="grid gap-[clamp(0.5rem,1vw,0.75rem)]">
              <div className="text-sm font-semibold">룰렛 항목</div>
              <RouletteItemsEditor items={items} onChange={setItems} />
            </div>
          </div>

          <div className="flex flex-col gap-[clamp(0.65rem,1.2vw,0.875rem)] border-t bg-background/64 p-[clamp(1rem,2.4vw,1.5rem)] sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="destructive" disabled={isPending} onClick={deleteRoulette}>
              <Trash2 className="h-[1em] w-[1em]" />
              룰렛 삭제
            </Button>
            <div className="flex flex-col-reverse gap-[clamp(0.65rem,1.2vw,0.875rem)] sm:flex-row sm:items-center sm:justify-end">
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={isPending}>
                  취소
                </Button>
              </Dialog.Close>
              <Button type="button" disabled={isPending} onClick={save}>
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

function RouletteTestDialog({
  definition,
  testConnectionId,
  onClose,
  onSettled,
  onFailed,
}: {
  definition: RouletteDefinition;
  testConnectionId: string;
  onClose: () => void;
  onSettled: (definition: RouletteDefinition, label: string) => void;
  onFailed: (message: string) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const requestStartedRef = useRef(false);
  const finishedRef = useRef(false);
  const expectedSpinRef = useRef<{ spinId: string; label: string } | null>(null);
  const pendingSettledRef = useRef<Map<string, RouletteEmbeddedMessage>>(new Map());
  const timeoutRef = useRef<number | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const [viewer, setViewer] = useState<RouletteViewerUrlResponse | null>(null);
  const [phase, setPhase] = useState<RouletteTestPhase>('preparing');
  const [resultLabel, setResultLabel] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const look = useMemo(() => parseRouletteTheme(definition.theme), [definition.theme]);
  const itemCount = definition.items?.length || 0;
  const canClose = phase === 'settled' || phase === 'error';

  const clearDeadline = useCallback(() => {
    if (timeoutRef.current != null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const fail = useCallback((message: string) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    pendingSettledRef.current.clear();
    clearDeadline();
    setErrorMessage(message);
    setPhase('error');
    onFailed(message);
  }, [clearDeadline, onFailed]);

  const settleFromMessage = useCallback((message: RouletteEmbeddedMessage) => {
    if (finishedRef.current) return;
    const expected = expectedSpinRef.current;
    if (!expected || message.spinId !== expected.spinId) return;

    const stoppedLabel = String(message.label || '').trim();
    const sameLabel = normalizeRouletteResultLabel(stoppedLabel) === normalizeRouletteResultLabel(expected.label);
    if (!sameLabel) {
      fail('포인터가 멈춘 항목과 서버 테스트 결과가 일치하지 않습니다.');
      return;
    }
    if (Number(message.itemCount) !== itemCount) {
      fail('룰렛에 전체 항목이 반영되지 않았습니다.');
      return;
    }

    finishedRef.current = true;
    pendingSettledRef.current.clear();
    clearDeadline();
    setResultLabel(stoppedLabel);
    setPhase('settled');
    onSettled(definition, stoppedLabel);
  }, [clearDeadline, definition, fail, itemCount, onSettled]);

  const runTest = useCallback(async () => {
    if (requestStartedRef.current || finishedRef.current) return;
    requestStartedRef.current = true;
    setPhase('spinning');
    clearDeadline();
    const requestController = new AbortController();
    requestAbortRef.current = requestController;
    timeoutRef.current = window.setTimeout(() => {
      requestController.abort();
      fail('룰렛 테스트 요청 시간이 초과되었습니다. 네트워크 연결을 확인해 주세요.');
    }, 15000);

    try {
      const data = await postJson<RouletteTestResponse>('/api/roulette/test', {
        id: definition.id,
        name: definition.name,
        testConnectionId,
      }, requestController.signal);
      if (requestAbortRef.current === requestController) requestAbortRef.current = null;
      if (finishedRef.current) return;
      clearDeadline();
      const run = data?.result;
      const picked = run?.result;
      const spinId = String(run?.spinId || '').trim();
      const label = String(picked?.label || '').trim();
      if (!spinId || !label) throw new Error('룰렛 테스트 결과를 확인하지 못했습니다.');

      expectedSpinRef.current = { spinId, label };
      const durationMs = Math.max(1000, Number(run?.spinDurationMs) || 5200);
      timeoutRef.current = window.setTimeout(() => {
        fail('룰렛이 정지했다는 응답을 받지 못했습니다. 오버레이 연결 상태를 확인해 주세요.');
      }, durationMs + 5000);

      const pending = pendingSettledRef.current.get(spinId);
      if (pending) {
        pendingSettledRef.current.delete(spinId);
        settleFromMessage(pending);
      }
    } catch (error) {
      if (requestAbortRef.current === requestController) requestAbortRef.current = null;
      if (finishedRef.current) return;
      fail(error instanceof Error ? error.message : '룰렛 테스트를 실행하지 못했어요.');
    }
  }, [clearDeadline, definition.id, definition.name, fail, settleFromMessage, testConnectionId]);

  useEffect(() => {
    let cancelled = false;
    const pendingSettled = pendingSettledRef.current;
    setPhase('preparing');
    timeoutRef.current = window.setTimeout(() => {
      fail('룰렛 테스트 화면 연결 시간이 초과되었습니다.');
    }, 15000);

    void (async () => {
      try {
        const nextViewer = await readJson<RouletteViewerUrlResponse>(
          `/api/roulette/viewer-url?testConnectionId=${encodeURIComponent(testConnectionId)}`,
        );
        if (cancelled || finishedRef.current) return;
        if (!nextViewer?.token || !nextViewer.path) {
          fail('룰렛 오버레이 주소를 준비하지 못했습니다.');
          return;
        }
        setViewer(nextViewer);
        setPhase('connecting');
      } catch (error) {
        if (!cancelled) {
          fail(error instanceof Error ? error.message : '룰렛 오버레이 주소를 준비하지 못했습니다.');
        }
      }
    })();

    return () => {
      cancelled = true;
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
      pendingSettled.clear();
      clearDeadline();
    };
  }, [clearDeadline, fail, testConnectionId]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<RouletteEmbeddedMessage>) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = event.data;
      if (!message || message.token !== viewer?.token || message.testConnectionId !== testConnectionId) return;

      if (message.type === 'arubot:roulette-ready') {
        void runTest();
        return;
      }
      if (message.type !== 'arubot:roulette-settled' || finishedRef.current) return;
      const spinId = String(message.spinId || '').trim();
      if (!spinId) return;
      if (!expectedSpinRef.current) {
        pendingSettledRef.current.set(spinId, message);
        return;
      }
      settleFromMessage(message);
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [runTest, settleFromMessage, testConnectionId, viewer?.token]);

  const viewerUrl = useMemo(() => {
    if (!viewer?.path || typeof window === 'undefined') return '';
    const url = new URL(viewer.path, window.location.origin);
    url.searchParams.set('embeddedTest', '1');
    url.searchParams.set('testConnectionId', testConnectionId);
    return url.toString();
  }, [testConnectionId, viewer?.path]);

  const phaseLabel = {
    preparing: '화면 준비 중',
    connecting: '오버레이 연결 중',
    spinning: '실제 회전 중',
    settled: '정지 완료',
    error: '연결 점검 필요',
  }[phase];

  return (
    <Dialog.Root open onOpenChange={(nextOpen) => { if (!nextOpen && canClose) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/72 backdrop-blur-xl data-[state=open]:animate-fade-in" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 grid max-h-[96svh] w-[min(96vw,72rem)] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[var(--radius-panel)] border border-white/12 bg-slate-950 text-white shadow-lift outline-none data-[state=open]:animate-modal-in"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => { if (!canClose) event.preventDefault(); }}
          onPointerDownOutside={(event) => { if (!canClose) event.preventDefault(); }}
        >
          <header className="flex items-start justify-between gap-4 border-b border-white/10 px-[clamp(1rem,3vw,1.75rem)] py-[clamp(1rem,2.4vw,1.5rem)]">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone={phase === 'settled' ? 'mint' : phase === 'error' ? 'amber' : 'cyan'}>{phaseLabel}</Badge>
                <Badge tone="neutral">전체 {itemCount}개 항목</Badge>
              </div>
              <Dialog.Title className="truncate text-xl font-bold tracking-tight sm:text-2xl">{definition.name} 테스트</Dialog.Title>
              <Dialog.Description className="mt-2 text-sm leading-6 text-slate-300">
                실제 OBS 오버레이와 동일한 데이터와 회전 엔진으로 테스트합니다.
              </Dialog.Description>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="테스트 화면 닫기" disabled={!canClose} onClick={onClose} className="shrink-0 text-white hover:bg-white/10 hover:text-white">
              <X className="h-4 w-4" />
            </Button>
          </header>

          <div className="arubot-modal-scroll min-h-0 overflow-y-auto p-[clamp(0.75rem,2vw,1.5rem)]">
            <div className={`relative mx-auto overflow-hidden rounded-[calc(var(--radius-panel)*.78)] border border-white/12 bg-[radial-gradient(circle_at_center,#172033_0%,#020617_70%)] shadow-2xl ${look.layout === 'wheel' ? 'aspect-square w-[min(68svh,100%)]' : 'aspect-video w-full'}`}>
              {viewerUrl ? (
                <iframe
                  ref={iframeRef}
                  src={viewerUrl}
                  title={`${definition.name} 룰렛 실제 테스트`}
                  allow="autoplay"
                  referrerPolicy="same-origin"
                  className="h-full w-full border-0"
                />
              ) : (
                <div className="grid h-full min-h-72 place-items-center text-center text-slate-300">
                  <div className="grid justify-items-center gap-3">
                    <Loader2 className="h-7 w-7 animate-spin text-teal-300" />
                    <span className="text-sm font-semibold">실제 룰렛 화면을 준비하고 있습니다.</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <footer className="flex flex-col gap-3 border-t border-white/10 bg-white/[0.035] px-[clamp(1rem,3vw,1.75rem)] py-[clamp(1rem,2.4vw,1.35rem)] sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm font-semibold">
              {phase === 'settled' ? <span className="text-teal-200">테스트 당첨: {resultLabel}</span> : null}
              {phase === 'error' ? <span className="text-amber-200">{errorMessage}</span> : null}
              {phase !== 'settled' && phase !== 'error' ? <span className="text-slate-300">포인터가 멈출 때까지 결과를 공개하지 않습니다.</span> : null}
            </div>
            <Button type="button" disabled={!canClose} onClick={onClose} className="shrink-0">
              {canClose ? '완료' : <><Loader2 className="h-4 w-4 animate-spin" /> 회전 완료 대기</>}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function RoulettePage() {
  const [definitions, setDefinitions] = useState<RouletteDefinition[]>([]);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testDefinition, setTestDefinition] = useState<RouletteDefinition | null>(null);
  const [testConnectionId, setTestConnectionId] = useState('');
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

  const testRoulette = (definition: RouletteDefinition) => {
    const key = definition.id || definition.name;
    setTestResults((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setTestingId(key);
    setTestConnectionId(createRouletteTestConnectionId());
    setTestDefinition(definition);
  };

  const handleTestSettled = useCallback((definition: RouletteDefinition, label: string) => {
    const key = definition.id || definition.name;
    setTestResults((current) => ({ ...current, [key]: label }));
    setTestingId(null);
    toast.success(`${definition.name} 테스트 결과: ${label}`);
  }, []);

  const handleTestFailed = useCallback((message: string) => {
    setTestingId(null);
    toast.error(message);
  }, []);

  const closeTest = useCallback(() => {
    setTestingId(null);
    setTestDefinition(null);
    setTestConnectionId('');
  }, []);

  return (
    <div className="grid gap-[clamp(1rem,2vw,1.5rem)]">
      <PageHeader
        eyebrow="Broadcast overlay"
        title="룰렛"
        description="룰렛 항목과 표시 방식을 관리하고 실제 OBS 브라우저 소스 주소를 확인합니다."
        actions={
          <>
            <RouletteCreateDialog />
            <LinkButton href="/roulette/logs" variant="outline">결과 보기</LinkButton>
            <Button type="button" variant="outline" onClick={load} disabled={isPending}>
              <RefreshCw className={isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              새로고침
            </Button>
          </>
        }
      />

      <ViewerTokenPanel
        title="룰렛 화면 주소"
        description="이 주소를 OBS 브라우저 소스에 넣으면 룰렛 결과가 방송 화면에 표시돼요."
        endpoint="/api/roulette/viewer-url"
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>방송 이벤트로 실행할 룰렛</CardTitle>
              <CardDescription>룰렛을 만들고 바로 테스트합니다.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="mint">{definitions.length}개</Badge>
              <Badge tone="neutral">{totalItems}개 항목</Badge>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {visibleDefinitions.map((definition) => {
          const key = definition.id || definition.name;
          const items = definition.items || [];
          const look = parseRouletteTheme(definition.theme);
          const layoutLabel = look.layout === 'wheel' ? '휠 형태' : '릴 형태';
          const skinLabel = getRouletteSkinLabel(look.theme);
          return (
            <Card key={key} className="overflow-hidden">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{definition.name}</CardTitle>
                    <CardDescription>{definition.type === 'probability' ? '확률형 룰렛' : '가중치 룰렛'} · {layoutLabel} · {skinLabel} 스킨</CardDescription>
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
                            <code className="block w-max max-w-[34rem] whitespace-nowrap rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">실행 액션: {item.value}</code>
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
                  <Button type="button" variant="soft" onClick={() => testRoulette(definition)} disabled={testingId !== null || testDefinition !== null}>
                    {testingId === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    {testingId === key ? '회전 중' : '테스트 실행'}
                  </Button>
                  <RouletteEditDialog definition={definition} onSaved={load} />
                </div>
              </CardContent>
            </Card>
          );
        })}
        {!definitions.length ? <EmptyState className="lg:col-span-2" icon={Sparkles} title={isPending ? '룰렛을 불러오는 중입니다' : '만든 룰렛이 없습니다'} description={isPending ? '잠시만 기다려 주세요.' : '실제 방송에 사용할 첫 룰렛을 만들어 주세요.'} action={isPending ? undefined : <RouletteCreateDialog />} /> : null}
      </div>
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      {testDefinition && testConnectionId ? (
        <RouletteTestDialog
          definition={testDefinition}
          testConnectionId={testConnectionId}
          onClose={closeTest}
          onSettled={handleTestSettled}
          onFailed={handleTestFailed}
        />
      ) : null}
    </div>
  );
}
