'use client';

import * as Dialog from '@radix-ui/react-dialog';
import * as Switch from '@radix-ui/react-switch';
import {
  ArrowDown, ArrowDownLeft, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight,
  Check, ChevronDown, CloudRain, Copy, Crosshair, Eye, EyeOff, Grid2X2, ImagePlus, Loader2,
  Monitor, Pause, Play, RefreshCw, Rocket, RotateCcw, Save, Send, Shuffle, SlidersHorizontal,
  Smile, Square, Sticker, Trash2, Wind, X,
} from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useBotChannel } from '@/components/app-shell/bot-channel-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { readJsonResult } from '@/shared/api/http';
import { cn } from '@/shared/lib/utils';
import {
  DEFAULT_EMOTE_SETTINGS, EMOTE_ANIMATIONS, EMOTE_DIRECTIONS, EMOTE_NUMERIC_FIELDS, EMOTE_ORIGINS,
  normalizeEmoteSettings,
} from '../../../shared/emote-overlay';
import { EmoteStage, type EmoteStageHandle } from './emote-stage';
import { createChzzkEmoteSamples } from '../../../shared/emote-samples';
import type { EmoteImage, EmoteSettings } from './types';
import styles from './emote-overlay-page.module.css';

type NumericPath = keyof typeof EMOTE_NUMERIC_FIELDS;
type SettingsResponse = { settings: EmoteSettings; revision: number; epoch: number; viewerPath: string };
type Action = 'test' | 'clear' | 'rotate';
type Confirmation = 'reload' | 'reset' | 'clear' | 'rotate' | null;

const modes = [
  { value: 'float', label: '풍선', icon: Wind },
  { value: 'rain', label: '탄성 낙하', icon: CloudRain },
  { value: 'sticker', label: '스티커', icon: Sticker },
  { value: 'launch', label: '발사', icon: Rocket },
  { value: 'random', label: '랜덤', icon: Shuffle },
];
const animationLabels: Record<string, string> = {
  fade: '페이드', pop: '팝', bounce: '바운스', spin: '스핀', glitch: '글리치', blur: '블러',
  dissolve: '디졸브', dust: '더스트', drop: '드롭', explode: '폭발', compress: '압축',
};
const directionLabels: Record<string, string> = { random: '랜덤', up: '위', down: '아래', left: '왼쪽', right: '오른쪽', center: '중앙' };
const originLabels: Record<string, string> = {
  bottomLeft: '왼쪽 아래', bottom: '아래 중앙', bottomRight: '오른쪽 아래', left: '왼쪽 중앙', right: '오른쪽 중앙',
  topLeft: '왼쪽 위', top: '위 중앙', topRight: '오른쪽 위', random: '랜덤', custom: '직접 지정',
};
const originGrid = [
  { value: 'topLeft', icon: ArrowDownRight }, { value: 'top', icon: ArrowDown }, { value: 'topRight', icon: ArrowDownLeft },
  { value: 'left', icon: ArrowRight }, { value: 'custom', icon: Crosshair }, { value: 'right', icon: ArrowLeft },
  { value: 'bottomLeft', icon: ArrowUpRight }, { value: 'bottom', icon: ArrowUp }, { value: 'bottomRight', icon: ArrowUpLeft },
];
const selectClass = 'h-10 w-full min-w-0 rounded-md border bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

function pathValue(settings: EmoteSettings, path: string) {
  return path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], settings);
}

function patchedSettings(settings: EmoteSettings, path: string, value: unknown): EmoteSettings {
  const next = structuredClone(settings);
  const [group, child] = path.split('.');
  const target = next as unknown as Record<string, unknown>;
  if (child) (target[group] as Record<string, unknown>)[child] = value;
  else target[group] = value;
  // Keep interval endpoints stable while editing either end of the range.
  if (path === 'rain.restitutionMin') next.rain.restitutionMax = Math.max(next.rain.restitutionMax, Number(value));
  if (path === 'rain.restitutionMax') next.rain.restitutionMin = Math.min(next.rain.restitutionMin, Number(value));
  return normalizeEmoteSettings(next);
}

function NumericSetting({ path, label, value, onChange, unit = '', scale = 1, maximum }: {
  path: NumericPath; label: string; value: number; onChange: (value: number) => void; unit?: string; scale?: number; maximum?: number;
}) {
  const id = useId();
  const [minimum, schemaMaximum, step] = EMOTE_NUMERIC_FIELDS[path];
  const max = Math.min(schemaMaximum, maximum ?? schemaMaximum);
  const display = (number: number) => String(Number((number * scale).toFixed(3)));
  const [input, setInput] = useState(display(value));
  useEffect(() => setInput(String(Number((value * scale).toFixed(3)))), [value, scale]);
  const commit = () => {
    const parsed = input.trim() ? Number(input) / scale : value;
    const bounded = Number.isFinite(parsed) ? Math.max(minimum, Math.min(max, parsed)) : value;
    const rounded = step >= 1 ? Math.round(bounded) : Number(bounded.toFixed(4));
    onChange(rounded); setInput(display(rounded));
  };
  return <div className="min-w-0 space-y-2">
    <label htmlFor={id} className="flex flex-wrap items-center justify-between gap-x-2 text-xs font-medium"><span>{label}</span>{unit ? <span className="font-normal text-muted-foreground">{unit}</span> : null}</label>
    <div className={styles.numberRow}>
      <input className={styles.range} type="range" aria-label={`${label} 슬라이더`} min={minimum} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} />
      <Input id={id} type="number" inputMode="decimal" min={Number((minimum * scale).toFixed(4))} max={Number((max * scale).toFixed(4))} step="any" value={input} className="h-9 min-h-9 px-2 text-right tabular-nums" onChange={event => {
        setInput(event.target.value);
        if (!event.target.value.trim()) return;
        const parsed = Number(event.target.value) / scale;
        if (Number.isFinite(parsed) && parsed >= minimum && parsed <= max && (step < 1 || Number.isInteger(parsed))) onChange(parsed);
      }} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} />
    </div>
  </div>;
}

function SelectSetting({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  const id = useId();
  return <div className="min-w-0 space-y-2"><label className="block text-xs font-medium" htmlFor={id}>{label}</label><select id={id} value={value} onChange={event => onChange(event.target.value)} className={selectClass}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>;
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return <div className="flex min-w-0 items-center justify-between gap-4"><label htmlFor={id} className="text-sm font-medium">{label}</label><Switch.Root id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} className="peer relative h-6 w-11 shrink-0 rounded-full bg-muted-foreground/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary"><Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[22px]" /></Switch.Root></div>;
}

function EffectSection({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return <details open={open} className="border-t"><summary className={cn(styles.summary, 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}><h3 className="text-sm font-semibold">{title}</h3><ChevronDown className="h-4 w-4 text-muted-foreground" /></summary><div className="space-y-5 pb-6">{children}</div></details>;
}

function ConfirmationDialog({ kind, busy, error, onCancel, onConfirm }: { kind: Exclude<Confirmation, null>; busy: boolean; error: string; onCancel: () => void; onConfirm: () => void }) {
  const content = {
    reload: { title: '저장된 설정을 다시 불러올까요?', description: '아직 저장하지 않은 변경 사항은 사라집니다.', action: '다시 불러오기' },
    reset: { title: '모든 설정을 기본값으로 바꿀까요?', description: '현재 편집값이 기본값으로 바뀝니다. OBS에는 저장한 후 적용됩니다.', action: '기본값 적용' },
    clear: { title: 'OBS 이모티콘을 모두 비울까요?', description: '연결된 모든 이모티콘 오버레이에서 현재 화면과 대기 효과가 사라집니다.', action: 'OBS 화면 비우기' },
    rotate: { title: 'OBS 주소를 재발급할까요?', description: '기존 주소는 즉시 사용할 수 없게 됩니다. OBS 브라우저 소스에도 새 주소를 등록해야 합니다.', action: '주소 재발급' },
  }[kind];
  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) onCancel(); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" /><Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-5 shadow-xl">
    <div className="flex items-start justify-between gap-3"><Dialog.Title className="pt-2 text-base font-semibold">{content.title}</Dialog.Title><Button variant="ghost" size="icon" aria-label="닫기" disabled={busy} onClick={onCancel}><X className="h-4 w-4" /></Button></div>
    <Dialog.Description className="mt-3 text-sm leading-6 text-muted-foreground">{content.description}</Dialog.Description>
    {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
    <div className="mt-6 flex flex-wrap justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={onCancel}>취소</Button><Button variant={kind === 'rotate' || kind === 'clear' ? 'destructive' : 'default'} disabled={busy} onClick={onConfirm}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{content.action}</Button></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}

export function EmoteOverlayPage() {
  const { canWrite } = useBotChannel();
  const writable = canWrite('emotes');
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [draft, setDraft] = useState<EmoteSettings>(() => normalizeEmoteSettings(DEFAULT_EMOTE_SETTINGS));
  const normalized = useMemo<EmoteSettings>(() => normalizeEmoteSettings(draft), [draft]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [dialogError, setDialogError] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [count, setCount] = useState(0);
  const [checkerboard, setCheckerboard] = useState(true);
  const [sample, setSample] = useState<EmoteImage | null>(null);
  const [sampleCount, setSampleCount] = useState('8');
  const stage = useRef<EmoteStageHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const sampleUrl = useRef<string | null>(null);
  const lock = useRef(false);
  const mounted = useRef(false);
  const readController = useRef<AbortController | null>(null);
  const dirty = Boolean(data && JSON.stringify(normalized) !== JSON.stringify(normalizeEmoteSettings(data.settings)));
  const disabled = !writable || loading || Boolean(busy) || !data;
  const address = useMemo(() => data?.viewerPath && typeof window !== 'undefined' ? new URL(data.viewerPath, window.location.origin).href : '', [data?.viewerPath]);

  const load = useCallback(async () => {
    readController.current?.abort();
    const controller = new AbortController(); readController.current = controller;
    setLoading(true); setError('');
    try {
      const result = await readJsonResult<SettingsResponse>('/api/emote-overlay', { signal: controller.signal });
      if (controller.signal.aborted || !mounted.current) return;
      if (!result.ok) { setError(result.message); return; }
      setData(result.data); setDraft(normalizeEmoteSettings(result.data.settings)); setConflict(false); setRevealed(false);
    } catch { if (!controller.signal.aborted && mounted.current) setError('오버레이 설정을 불러오지 못했습니다.'); }
    finally { if (!controller.signal.aborted && mounted.current) setLoading(false); }
  }, []);

  useEffect(() => {
    mounted.current = true; void load();
    return () => { mounted.current = false; readController.current?.abort(); if (sampleUrl.current) URL.revokeObjectURL(sampleUrl.current); };
  }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  useEffect(() => stage.current?.pause(paused), [paused]);

  const set = (path: string, value: unknown) => { if (!disabled) setDraft(current => patchedSettings(current, path, value)); };
  const number = (path: NumericPath, label: string, unit = '', scale = 1, maximum?: number) => <NumericSetting key={path} path={path} label={label} unit={unit} scale={scale} maximum={maximum} value={Number(pathValue(normalized, path))} onChange={value => set(path, value)} />;
  const requestConfirmation = (kind: Exclude<Confirmation, null>) => { setDialogError(''); setConfirmation(kind); };

  const save = async () => {
    if (!data || !writable || lock.current || loading) return;
    lock.current = true; setBusy('save'); setError('');
    try {
      const result = await readJsonResult<SettingsResponse>('/api/emote-overlay/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: normalized, revision: data.revision }) });
      if (!mounted.current) return;
      if (!result.ok) { setError(result.status === 409 ? '다른 곳에서 설정이 변경되었습니다. 편집한 값은 유지했습니다. 저장된 설정을 다시 불러온 후 변경해 주세요.' : result.message); setConflict(result.status === 409); return; }
      setData(result.data); setDraft(normalizeEmoteSettings(result.data.settings)); setConflict(false);
      toast.success('이모티콘 오버레이 설정을 저장했습니다.');
    } finally { lock.current = false; if (mounted.current) setBusy(null); }
  };

  const action = async (kind: Action) => {
    if (!writable || !data || lock.current || loading) return;
    lock.current = true; setBusy(kind); setDialogError('');
    try {
      const result = await readJsonResult<{ epoch?: number; viewerPath?: string }>(`/api/emote-overlay/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!mounted.current) return;
      if (!result.ok) { if (kind === 'test') toast.error(result.message); else setDialogError(result.message); return; }
      setData(current => current ? { ...current, epoch: result.data.epoch ?? current.epoch, viewerPath: result.data.viewerPath ?? current.viewerPath } : current);
      if (kind === 'rotate') setRevealed(false);
      setConfirmation(null);
      toast.success(kind === 'test' ? '저장된 설정으로 OBS 테스트를 전송했습니다.' : kind === 'rotate' ? 'OBS 주소를 재발급했습니다.' : 'OBS 이모티콘 화면을 비웠습니다.');
    } finally { lock.current = false; if (mounted.current) setBusy(null); }
  };

  const preview = () => {
    const amount = Math.max(1, Math.min(30, Math.round(Number(sampleCount) || 8)));
    setSampleCount(String(amount)); setPaused(false); stage.current?.pause(false);
    const items = sample ? Array.from({ length: amount }, () => ({ ...sample })) : createChzzkEmoteSamples(amount);
    stage.current?.emit(items, normalized, Math.floor(Math.random() * 0xffffffff));
  };
  const copyAddress = async () => {
    try { await navigator.clipboard.writeText(address); toast.success('OBS 이모티콘 오버레이 주소를 복사했습니다.'); }
    catch { setRevealed(true); toast.error('복사하지 못했습니다. 표시된 주소를 직접 복사해 주세요.'); }
  };
  const chooseSample = (file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(file.type) || file.size > 8 * 1024 * 1024) { toast.error('8MB 이하의 PNG, JPG, WebP, GIF, AVIF 이미지를 선택해 주세요.'); return; }
    stage.current?.clear();
    if (sampleUrl.current) URL.revokeObjectURL(sampleUrl.current);
    const url = URL.createObjectURL(file); sampleUrl.current = url;
    setSample({ url, name: file.name, provider: 'test' });
  };
  const removeSample = () => {
    stage.current?.clear();
    if (sampleUrl.current) URL.revokeObjectURL(sampleUrl.current);
    sampleUrl.current = null; setSample(null);
  };
  const confirm = () => {
    if (confirmation === 'reset') { if (writable) setDraft(normalizeEmoteSettings(DEFAULT_EMOTE_SETTINGS)); setConfirmation(null); }
    else if (confirmation === 'reload') { setConfirmation(null); void load(); }
    else if (confirmation === 'clear' || confirmation === 'rotate') void action(confirmation);
  };

  return <div className={cn(styles.page, 'space-y-6')}>
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0"><h1 className="flex items-center gap-2 text-2xl font-bold"><Smile className="h-6 w-6 shrink-0 text-primary" />이모티콘 오버레이</h1><div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span className={cn('inline-flex items-center gap-1.5 font-medium', data?.settings.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}><span className={cn('h-1.5 w-1.5 rounded-full', data?.settings.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/60')} />{loading && !data ? '불러오는 중' : !data ? '연결 확인 필요' : data.settings.enabled ? '활성화됨' : '비활성화됨'}</span>{!writable ? <span className="border-l pl-2 text-muted-foreground">읽기 전용</span> : dirty ? <span className="border-l pl-2 text-amber-700 dark:text-amber-400">저장하지 않은 변경</span> : data ? <span className="border-l pl-2 text-muted-foreground">저장됨</span> : null}</div></div>
      <div className="flex flex-wrap items-center gap-2"><Tooltip content="저장된 설정 다시 불러오기"><Button size="icon" variant="outline" aria-label="저장된 설정 다시 불러오기" disabled={loading || Boolean(busy)} onClick={() => { if (dirty) requestConfirmation('reload'); else void load(); }}><RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /></Button></Tooltip><Tooltip content="기본값으로 초기화"><Button size="icon" variant="outline" aria-label="기본값으로 초기화" disabled={disabled} onClick={() => requestConfirmation('reset')}><RotateCcw className="h-4 w-4" /></Button></Tooltip><Button disabled={disabled || !dirty || conflict} onClick={() => void save()}>{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}저장</Button></div>
    </header>

    {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-destructive bg-destructive/5 px-4 py-3"><p className="min-w-0 text-sm text-destructive [overflow-wrap:anywhere]">{error}</p>{conflict ? <Button size="sm" variant="outline" disabled={loading || Boolean(busy)} onClick={() => requestConfirmation('reload')}><RefreshCw className="h-3.5 w-3.5" />저장된 설정 불러오기</Button> : !data ? <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>재시도</Button> : null}</div> : null}

    <div className={styles.workspace}>
      <aside className={cn(styles.preview, 'space-y-5')} aria-label="이모티콘 미리보기">
        <section className="min-w-0 space-y-3">
          <header className="flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-sm font-semibold"><Monitor className="h-4 w-4" />로컬 미리보기</h2><div className="flex items-center gap-2"><span className="text-xs tabular-nums text-muted-foreground" aria-label="현재 미리보기 개수">{count} / {normalized.maxActive}</span><Tooltip content={checkerboard ? '검은 배경' : '투명 격자 배경'}><Button size="icon" variant="ghost" aria-label={checkerboard ? '검은 배경' : '투명 격자 배경'} onClick={() => setCheckerboard(value => !value)}>{checkerboard ? <Square className="h-4 w-4" /> : <Grid2X2 className="h-4 w-4" />}</Button></Tooltip></div></header>
          <div className={cn(styles.surface, checkerboard && styles.checkerboard)} data-testid="emote-preview"><EmoteStage ref={stage} settings={normalized} onCount={setCount} className="absolute inset-0" /></div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2"><Input type="number" aria-label="미리보기 이모티콘 개수" min={1} max={30} step={1} value={sampleCount} onChange={event => setSampleCount(event.target.value)} onBlur={() => setSampleCount(String(Math.max(1, Math.min(30, Math.round(Number(sampleCount) || 8)))))} className="w-16 px-2 text-center" /><Button variant="secondary" onClick={preview}><Play className="h-4 w-4" />미리보기</Button></div>
            <div className="flex gap-1"><Tooltip content={paused ? '미리보기 재개' : '미리보기 일시정지'}><Button size="icon" variant="outline" aria-label={paused ? '미리보기 재개' : '미리보기 일시정지'} aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}</Button></Tooltip><Tooltip content="미리보기 비우기"><Button size="icon" variant="outline" aria-label="미리보기 비우기" onClick={() => stage.current?.clear()}><Trash2 className="h-4 w-4" /></Button></Tooltip></div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2"><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" className="hidden" aria-label="미리보기 이미지 선택" onChange={event => { chooseSample(event.target.files?.[0]); event.target.value = ''; }} /><Button variant="ghost" size="sm" onClick={() => fileInput.current?.click()}><ImagePlus className="h-4 w-4" />테스트 이미지</Button>{sample ? <><span className="min-w-0 max-w-[180px] truncate text-xs text-muted-foreground" title={sample.name}>{sample.name}</span><Tooltip content="치지직 기본 이모티콘으로 되돌리기"><Button size="icon" variant="ghost" aria-label="치지직 기본 이모티콘으로 되돌리기" onClick={removeSample}><X className="h-4 w-4" /></Button></Tooltip></> : <span className="text-xs text-muted-foreground">치지직 기본 이모티콘 · PNG/GIF</span>}</div>
        </section>

        <section className="min-w-0 space-y-3 border-t pt-5" aria-label="OBS 연결">
          <header className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">OBS 이모티콘 오버레이 주소</h2><div className="flex gap-1"><Tooltip content={revealed ? '주소 숨기기' : '주소 표시'}><Button size="icon" variant="ghost" aria-label={revealed ? 'OBS 주소 숨기기' : 'OBS 주소 표시'} disabled={!address || loading} onClick={() => setRevealed(value => !value)}>{revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button></Tooltip><Tooltip content="OBS 주소 복사"><Button size="icon" variant="outline" aria-label="OBS 주소 복사" disabled={!address || loading} onClick={() => void copyAddress()}><Copy className="h-4 w-4" /></Button></Tooltip><Tooltip content="OBS 주소 재발급"><Button size="icon" variant="ghost" aria-label="OBS 주소 재발급" disabled={disabled} onClick={() => requestConfirmation('rotate')}><RefreshCw className="h-4 w-4" /></Button></Tooltip></div></header>
          <button type="button" className={cn(styles.address, 'rounded-md border bg-muted/30 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50')} disabled={!address || loading} aria-label={revealed ? 'OBS 주소 숨기기' : 'OBS 주소 표시'} aria-expanded={revealed} onClick={() => setRevealed(value => !value)}><span aria-hidden={!revealed} className={cn(styles.addressText, revealed ? 'select-text blur-0' : 'select-none blur-sm')}>{address || '--------------------------'}</span></button>
          <div className="flex flex-wrap items-center justify-between gap-2"><Button variant="outline" size="sm" disabled={disabled || !data?.settings.enabled || dirty} onClick={() => void action('test')}>{busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}OBS 테스트 전송</Button><Button variant="ghost" size="sm" disabled={disabled} onClick={() => requestConfirmation('clear')}><Trash2 className="h-4 w-4" />OBS 화면 비우기</Button></div>
        </section>
      </aside>

      <div className={styles.settings}>
        <fieldset disabled={disabled} className="min-w-0 space-y-6 border-0 p-0">
          <legend className="sr-only">이모티콘 오버레이 설정</legend>
          <section className="space-y-5 border-b pb-6"><Toggle label="이모티콘 오버레이 사용" checked={normalized.enabled} disabled={disabled} onChange={value => set('enabled', value)} /><div className="flex flex-wrap gap-x-5 gap-y-3">{([{ value: 'chzzk', label: '치지직', color: 'bg-emerald-500' }, { value: 'cime', label: '씨미', color: 'bg-sky-500' }, { value: 'youtube', label: 'YouTube', color: 'bg-red-500' }] as const).map(provider => <label key={provider.value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={normalized.providers[provider.value]} onChange={event => set(`providers.${provider.value}`, event.target.checked)} className="h-4 w-4 accent-primary" /><span className={cn('h-1.5 w-1.5 rounded-full', provider.color)} />{provider.label}</label>)}</div></section>

          <section className="space-y-4"><h2 className="text-sm font-semibold">효과</h2><div className="grid grid-cols-5 gap-1 rounded-md border bg-muted/30 p-1" role="group" aria-label="오버레이 효과">{modes.map(mode => <button type="button" key={mode.value} aria-pressed={normalized.mode === mode.value} className={cn(styles.modeButton, 'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50', normalized.mode === mode.value ? 'bg-background text-primary shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:bg-muted hover:text-foreground')} onClick={() => set('mode', mode.value)}><mode.icon className="h-5 w-5" /><span>{mode.label}</span></button>)}</div></section>

          <section className="space-y-5 pb-2"><h2 className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal className="h-4 w-4 text-muted-foreground" />공통 설정</h2><div className={styles.fields}>
            {number('size', '이모티콘 크기', 'px · 1080p 기준')}{number('opacity', '불투명도', '%', 100)}
            {number('duration', '표시 시간', '초')}{number('speed', '이동 속도', '배')}
            {number('variation', '랜덤 변동 폭', '± %', 100)}{number('fadeMs', '페이드 시간', '초', 0.001)}
          </div></section>

          <div>
            {normalized.mode === 'float' || normalized.mode === 'random' ? <EffectSection title="풍선 이동"><SelectSetting label="이동 방향" value={normalized.float.direction} options={[{ value: 'leftToRight', label: '왼쪽 → 오른쪽' }, { value: 'rightToLeft', label: '오른쪽 → 왼쪽' }, { value: 'bottomToTop', label: '아래 → 위' }, { value: 'topToBottom', label: '위 → 아래' }, { value: 'random', label: '랜덤' }]} onChange={value => set('float.direction', value)} /><div className={styles.fields}>{number('float.sway', '흔들림 폭', 'px')}{number('float.swaySpeed', '흔들림 속도', '배')}{number('float.spin', '회전 속도', '°/초')}</div></EffectSection> : null}
            {normalized.mode === 'rain' || normalized.mode === 'random' ? <EffectSection title="탄성 낙하"><div className={styles.fields}>{number('rain.gravity', '중력', '배')}{number('rain.drift', '좌우 흩뿌림')}{number('rain.restitutionMin', '최소 탄성', '%', 100)}{number('rain.restitutionMax', '최대 탄성', '%', 100)}{number('rain.friction', '마찰', '%', 100)}{number('rain.releaseAfter', '아래로 사라지기 시작', '수명의 %', 100)}</div><Toggle label="이모티콘끼리 충돌" checked={normalized.rain.collisions} disabled={disabled} onChange={value => set('rain.collisions', value)} /></EffectSection> : null}
            {normalized.mode === 'sticker' || normalized.mode === 'random' ? <EffectSection title="스티커"><div className={styles.fields}><SelectSetting label="등장 애니메이션" value={normalized.sticker.enter} options={EMOTE_ANIMATIONS.map(value => ({ value, label: animationLabels[value] }))} onChange={value => set('sticker.enter', value)} /><SelectSetting label="퇴장 애니메이션" value={normalized.sticker.exit} options={EMOTE_ANIMATIONS.map(value => ({ value, label: animationLabels[value] }))} onChange={value => set('sticker.exit', value)} />{number('sticker.enterMs', '등장 시간', '초', 0.001)}{number('sticker.exitMs', '퇴장 시간', '초', 0.001)}<SelectSetting label="애니메이션 방향" value={normalized.sticker.direction} options={EMOTE_DIRECTIONS.map(value => ({ value, label: directionLabels[value] }))} onChange={value => set('sticker.direction', value)} />{number('sticker.rotation', '랜덤 기울기', '± °')}{number('sticker.fragments', '분해 효과 조각 수', '개')}</div></EffectSection> : null}
            {normalized.mode === 'launch' || normalized.mode === 'random' ? <EffectSection title="발사"><div className="flex flex-wrap items-end gap-5"><div className="w-36 shrink-0"><div className="mb-2 text-xs font-medium">발사 위치</div><div className="grid grid-cols-3 gap-1 rounded-md border p-1" role="group" aria-label="발사 위치 빠른 선택">{originGrid.map(origin => <Tooltip content={originLabels[origin.value]} key={origin.value}><button type="button" aria-label={`${originLabels[origin.value]}에서 발사`} aria-pressed={normalized.launch.origin === origin.value} onClick={() => set('launch.origin', origin.value)} className={cn('flex aspect-square items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', normalized.launch.origin === origin.value ? 'bg-primary/10 text-primary ring-1 ring-primary/40' : 'text-muted-foreground hover:bg-muted')}><origin.icon className="h-4 w-4" /></button></Tooltip>)}</div></div><div className="min-w-[120px] flex-1"><SelectSetting label="발사 위치 선택" value={normalized.launch.origin} options={EMOTE_ORIGINS.map(value => ({ value, label: originLabels[value] }))} onChange={value => set('launch.origin', value)} /></div></div><div className={styles.fields}>{normalized.launch.origin === 'custom' ? <>{number('launch.x', '발사 위치 X', '%')}{number('launch.y', '발사 위치 Y', '%')}</> : null}{number('launch.angle', '발사 각도', '°')}{number('launch.spread', '발사 각도 분산', '°')}{number('launch.power', '발사 강도')}{number('launch.gravity', '발사 중력', '배')}{number('launch.spin', '발사 회전 속도', '°/초')}{number('launch.trail', '잔상 수', '개')}</div></EffectSection> : null}
            <EffectSection title="고급 · 표시 영역과 제한" open={false}><h4 className="text-xs font-semibold text-muted-foreground">표시 영역</h4><div className={styles.fields}>{number('area.x', '왼쪽 위치', '%')}{number('area.y', '위쪽 위치', '%')}{number('area.width', '영역 너비', '%', 1, 100 - normalized.area.x)}{number('area.height', '영역 높이', '%', 1, 100 - normalized.area.y)}</div><div className="border-t pt-5"><h4 className="mb-5 text-xs font-semibold text-muted-foreground">표시 제한</h4><div className={styles.fields}>{number('maxActive', '동시 표시 한도', '개')}{number('maxPerMessage', '메시지당 한도', '개')}{number('perSecond', '초당 표시 한도', '개')}{number('cooldownMs', '사용자별 쿨다운', '초', 0.001)}</div></div></EffectSection>
          </div>
        </fieldset>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-5"><span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">{dirty ? '저장하지 않은 변경' : <><Check className="h-3.5 w-3.5" />{data ? '모든 변경 저장됨' : '설정 연결 대기'}</>}</span><Button disabled={disabled || !dirty || conflict} onClick={() => void save()}>{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}저장</Button></footer>
      </div>
    </div>
    {confirmation ? <ConfirmationDialog kind={confirmation} busy={Boolean(busy)} error={dialogError} onCancel={() => setConfirmation(null)} onConfirm={confirm} /> : null}
  </div>;
}
