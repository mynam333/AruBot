'use client';

import { useBotChannel } from '@/components/app-shell/bot-channel-provider';

import * as Dialog from '@radix-ui/react-dialog';
import * as Switch from '@radix-ui/react-switch';
import * as Tabs from '@radix-ui/react-tabs';
import {
  AlertCircle, Check, CircleDot, Clock3, Coins, Gift, History, List,
  Loader2, Maximize2, MessageSquare, Minimize2, Pause, Play, Plus,
  RefreshCw, RotateCcw, Save, Search, Settings2, Trash2, Trophy,
  UsersRound, Volume2, VolumeX, WifiOff, X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, LinkButton } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { ParticipationWheel } from '@/features/wheel/participation-wheel';
import { wheelTimeMs } from '@/features/wheel/wheel-motion';
import type { WheelEntry, WheelHistoryEntry, WheelSettings, WheelState } from '@/features/wheel/types';
import { readJsonResult } from '@/shared/api/http';
import styles from './participation-wheel-page.module.css';

type WheelResponse = { wheel: WheelState; serverNow: number };
type Snapshot = WheelResponse & { receivedAt: number };
type Action = 'open' | 'close' | 'add' | 'remove' | 'clear' | 'spin';
type Intent = {
  path: string;
  method: 'PUT' | 'POST';
  body: Record<string, unknown>;
  kind: Action | 'settings';
  success: string;
};
type Problem = { message: string; auth?: boolean };
type Confirmation = { kind: 'clear' } | { kind: 'remove'; entry: WheelEntry };

const number = (value: number) => value.toLocaleString('ko-KR');
const sourceLabels = { chat: '채팅', points: '포인트', donation: '후원', manual: '직접 추가' };
const colors = ['#259d92', '#f58b79', '#f3c65c', '#79b4ed', '#80c8a5', '#df9bac', '#56becb', '#eba45f'];
const removalLabels = { one: '당첨 1칸 제외', keep: '모두 유지', all: '당첨 항목 전체 제외' };
const themes = [
  { value: 'festival', label: '페스티벌', colors: ['#259d92', '#f58b79', '#f3c65c', '#79b4ed'] },
  { value: 'studio', label: '스튜디오', colors: ['#90c6bb', '#e5a397', '#e2c978', '#96b6d9'] },
  { value: 'midnight', label: '미드나잇', colors: ['#21352b', '#35afa2', '#eac35d', '#81afe7'] },
] as const;

function serverTime(snapshot: Snapshot | null) {
  return snapshot ? snapshot.serverNow + Math.max(0, performance.now() - snapshot.receivedAt) : 0;
}

function spinEndsAt(spin: WheelHistoryEntry | null | undefined) {
  if (!spin) return 0;
  return wheelTimeMs(spin.startedAt) + spin.durationMs;
}

function sameSettings(a: WheelSettings | null, b: WheelSettings | null) {
  if (!a || !b) return a === b;
  return a.title === b.title && a.theme === b.theme && a.removal === b.removal
    && a.spinDurationMs === b.spinDurationMs
    && a.chat.enabled === b.chat.enabled && a.chat.command === b.chat.command && a.chat.perUserLimit === b.chat.perUserLimit
    && a.points.enabled === b.points.enabled && a.points.command === b.points.command && a.points.costPerSlot === b.points.costPerSlot
    && a.donation.enabled === b.donation.enabled && a.donation.wonPerSlot === b.donation.wonPerSlot;
}

function isWheelResponse(value: WheelResponse): boolean {
  const wheel = value?.wheel;
  return Number.isFinite(value?.serverNow) && Boolean(wheel && typeof wheel.roundId === 'string'
    && Number.isSafeInteger(wheel.revision) && Array.isArray(wheel.entries) && Array.isArray(wheel.history)
    && Number.isSafeInteger(wheel.totalSlots) && wheel.settings?.chat && wheel.settings?.points && wheel.settings?.donation);
}

function IconButton({ label, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <Tooltip content={label}><button type="button" aria-label={label} title={label} className={styles.iconButton} {...props}>{children}</button></Tooltip>;
}

function SourceToggle({ id, checked, onChange, children }: {
  id: string; checked: boolean; onChange: (enabled: boolean) => void; children: React.ReactNode;
}) {
  return <div className={styles.sourceHeading}>
    <label htmlFor={id}>{children}</label>
    <Switch.Root id={id} checked={checked} onCheckedChange={onChange} className={styles.switch}>
      <Switch.Thumb className={styles.switchThumb} />
    </Switch.Root>
  </div>;
}

export function ParticipationWheelPage() {
  const { canWrite } = useBotChannel();
  const writable = canWrite('wheel');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  const [draft, setDraft] = useState<WheelSettings | null>(null);
  const [baseSettings, setBaseSettings] = useState<WheelSettings | null>(null);
  const dirtyRef = useRef(false);
  const [readProblem, setReadProblem] = useState<Problem | null>(null);
  const [actionProblem, setActionProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<Intent['kind'] | null>(null);
  const [retryIntent, setRetryIntent] = useState<Intent | null>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(false);
  const readController = useRef<AbortController | null>(null);
  const writeController = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const appliedSequence = useRef(0);
  const [now, setNow] = useState(0);
  const [offline, setOffline] = useState(false);
  const [muted, setMuted] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
  const stageRef = useRef<HTMLElement | null>(null);
  const [stageProblem, setStageProblem] = useState('');
  const [label, setLabel] = useState('');
  const [slots, setSlots] = useState('1');
  const [search, setSearch] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const confirmReturnFocus = useRef<HTMLElement | null>(null);
  const addInputRef = useRef<HTMLInputElement | null>(null);

  const accept = useCallback((data: WheelResponse, requestSequence: number) => {
    if (!mountedRef.current || requestSequence < appliedSequence.current) return false;
    const current = snapshotRef.current;
    if (current && data.wheel.roundId === current.wheel.roundId && data.wheel.revision < current.wheel.revision) return false;
    appliedSequence.current = requestSequence;
    const next = { ...data, receivedAt: performance.now() };
    snapshotRef.current = next;
    setSnapshot(next);
    setNow(data.serverNow);
    if (!dirtyRef.current) {
      setDraft(structuredClone(data.wheel.settings));
      setBaseSettings(structuredClone(data.wheel.settings));
    }
    setReadProblem(null);
    return true;
  }, []);

  const refresh = useCallback(async () => {
    if (!mountedRef.current || document.visibilityState === 'hidden' || pendingRef.current || readController.current) return;
    if (!navigator.onLine) { setOffline(true); return; }
    const controller = new AbortController();
    readController.current = controller;
    const requestSequence = ++sequence.current;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 10000);
    setRefreshing(true);
    try {
      const result = await readJsonResult<WheelResponse>('/api/wheel', { credentials: 'include', signal: controller.signal });
      if (!mountedRef.current || controller.signal.aborted || requestSequence < appliedSequence.current) return;
      if (result.ok && isWheelResponse(result.data)) accept(result.data, requestSequence);
      else setReadProblem({
        auth: !result.ok && (result.status === 401 || result.status === 403),
        message: result.ok ? '돌림판 응답을 확인할 수 없습니다.' : result.status === 401 ? '로그인이 필요합니다. 플랫폼 연결에서 다시 로그인해 주세요.'
          : result.status === 403 ? '이 채널의 돌림판 관리 권한이 없습니다.' : result.status === null ? '서버에 연결할 수 없습니다. 마지막 상태를 유지합니다.' : result.message,
      });
    } catch {
      if (mountedRef.current && timedOut && requestSequence >= appliedSequence.current) setReadProblem({ message: '서버 응답이 지연되고 있습니다. 마지막 상태를 유지합니다.' });
    } finally {
      window.clearTimeout(timeout);
      if (readController.current === controller) {
        readController.current = null;
        if (mountedRef.current) setRefreshing(false);
      }
    }
  }, [accept]);

  useEffect(() => {
    mountedRef.current = true;
    setFullscreenAvailable(Boolean(document.fullscreenEnabled));
    const syncConnection = () => {
      setOffline(!navigator.onLine);
      if (navigator.onLine) void refresh();
      else readController.current?.abort();
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') readController.current?.abort();
      else { setNow(serverTime(snapshotRef.current)); void refresh(); }
    };
    const onFullscreen = () => setFullscreen(document.fullscreenElement === stageRef.current);
    syncConnection();
    const poll = window.setInterval(() => void refresh(), 1500);
    const clock = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') setNow((previous) =>
        spinEndsAt(snapshotRef.current?.wheel.latestSpin) + 2500 > previous ? serverTime(snapshotRef.current) : previous);
    }, 100);
    window.addEventListener('online', syncConnection);
    window.addEventListener('offline', syncConnection);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      mountedRef.current = false;
      window.clearInterval(poll);
      window.clearInterval(clock);
      readController.current?.abort();
      readController.current = null;
      writeController.current?.abort();
      window.removeEventListener('online', syncConnection);
      window.removeEventListener('offline', syncConnection);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [refresh]);

  const perform = async (intent: Intent) => {
    if (!writable) return;
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(intent.kind);
    setActionProblem(null);
    setNotice('');
    readController.current?.abort();
    const requestSequence = ++sequence.current;
    // A read started before this mutation must never replace its result.
    appliedSequence.current = requestSequence;
    const controller = new AbortController();
    writeController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const result = await readJsonResult<WheelResponse>(intent.path, {
        method: intent.method, credentials: 'include', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(intent.body),
      });
      if (!mountedRef.current) return;
      if (!result.ok) {
        const uncertain = result.status === null || result.status >= 500 || result.status === 408;
        setRetryIntent(uncertain ? intent : null);
        setActionProblem({ auth: result.status === 401 || result.status === 403,
          message: uncertain ? '요청 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.' : result.message });
        return;
      }
      if (!isWheelResponse(result.data)) throw new Error('Invalid response');
      if (intent.kind === 'settings') dirtyRef.current = false;
      accept(result.data, requestSequence);
      setRetryIntent(null);
      setNotice(intent.success);
      if (intent.kind === 'add') { setLabel(''); setSlots('1'); }
      if (intent.kind === 'remove' || intent.kind === 'clear') setConfirmation(null);
    } catch {
      if (mountedRef.current) {
        setRetryIntent(intent);
        setActionProblem({ message: '요청 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.' });
      }
    } finally {
      window.clearTimeout(timeout);
      writeController.current = null;
      pendingRef.current = false;
      if (mountedRef.current) { setPending(null); void refresh(); }
    }
  };

  const wheel = snapshot?.wheel;
  const dirty = draft !== null && !sameSettings(draft, baseSettings);
  const conflict = dirty && Boolean(wheel) && !sameSettings(baseSettings, wheel!.settings);
  const spinning = Boolean(wheel?.latestSpin && spinEndsAt(wheel.latestSpin) > now);
  const remaining = Math.max(0, Math.ceil((spinEndsAt(wheel?.latestSpin) - now) / 1000));
  const locked = !writable || Boolean(pending || retryIntent || offline || readProblem || !wheel);
  // Removal is committed when a spin starts. Its live counts would reveal the winner.
  const spinEntryIds = useMemo(() => new Set(spinning ? wheel?.latestSpin?.entries.map((entry) => entry.id) : []), [spinning, wheel?.latestSpin]);
  const displayEntries = useMemo(() => spinning && wheel?.latestSpin
    ? [...wheel.latestSpin.entries, ...wheel.entries.filter((entry) => !spinEntryIds.has(entry.id))]
    : wheel?.entries || [], [spinning, wheel, spinEntryIds]);
  const displayTotalSlots = displayEntries.reduce((total, entry) => total + entry.slots, 0);
  const queuedSlots = spinning ? displayEntries.filter((entry) => !spinEntryIds.has(entry.id)).reduce((total, entry) => total + entry.slots, 0) : 0;
  const visibleEntries = useMemo(() => displayEntries.filter((entry) =>
    `${entry.label} ${entry.username}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [displayEntries, search]);
  const people = useMemo(() => new Set(displayEntries.filter((entry) => entry.username?.trim())
    .map((entry) => entry.username.trim().toLocaleLowerCase())).size, [displayEntries]);
  const completedHistory = (wheel?.history || []).filter((spin) => spinEndsAt(spin) <= now);
  const latestResult = wheel?.latestSpin && !spinning ? wheel.latestSpin : null;
  const previewSpin = wheel?.latestSpin && now < spinEndsAt(wheel.latestSpin) + 2500 ? wheel.latestSpin : null;

  const act = (action: Action, extra: Record<string, unknown> = {}) => {
    if (locked) return;
    if ((action === 'spin' || action === 'clear' || action === 'remove') && spinEndsAt(snapshotRef.current?.wheel.latestSpin) > serverTime(snapshotRef.current)) return;
    const messages: Record<Action, string> = {
      open: '참여 모집을 시작했습니다.', close: '참여 모집을 마감했습니다.', add: '항목을 추가했습니다.',
      remove: '항목을 삭제했습니다. 남은 유료 포인트는 환불됩니다.',
      clear: '돌림판을 초기화했습니다. 미사용 유료 포인트는 환불됩니다.', spin: '추첨을 시작했습니다.',
    };
    void perform({ path: '/api/wheel/action', method: 'POST', kind: action,
      body: { action, ...extra, requestId: crypto.randomUUID() }, success: messages[action] });
  };

  const changeDraft = (next: WheelSettings) => {
    if (!writable) return;
    dirtyRef.current = !sameSettings(next, baseSettings);
    setDraft(next);
    setNotice('');
  };

  const discardDraft = () => {
    if (!wheel) return;
    dirtyRef.current = false;
    setDraft(structuredClone(wheel.settings));
    setBaseSettings(structuredClone(wheel.settings));
  };

  const saveSettings = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || locked || !dirty || conflict) return;
    if (draft.chat.enabled && draft.points.enabled && draft.chat.command.toLowerCase() === draft.points.command.toLowerCase()) {
      setActionProblem({ message: '무료 채팅과 포인트 참여 명령어는 서로 달라야 합니다.' });
      return;
    }
    void perform({ path: '/api/wheel/settings', method: 'PUT', kind: 'settings',
      body: { settings: draft, requestId: crypto.randomUUID() },
      success: '참여 설정을 저장했습니다.' });
  };

  const toggleFullscreen = async () => {
    setStageProblem('');
    try {
      if (document.fullscreenElement === stageRef.current) await document.exitFullscreen();
      else await stageRef.current?.requestFullscreen();
    } catch { setStageProblem('전체 화면으로 전환할 수 없습니다. 브라우저 권한을 확인해 주세요.'); }
  };

  const confirm = (next: Confirmation, trigger: HTMLElement) => {
    confirmReturnFocus.current = trigger;
    setConfirmation(next);
  };

  const errorBanner = (problem: Problem) => <>
    <AlertCircle size={17} aria-hidden="true" /><span>{problem.message}</span>
    {problem.auth ? <LinkButton href="/connection" variant="outline" size="sm">플랫폼 연결</LinkButton> : null}
  </>;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}><CircleDot aria-hidden="true" /><h1>돌림판</h1>
          {wheel ? <span className={styles.round} title={wheel.roundId}>라운드 {wheel.roundId.slice(0, 8)}</span> : null}
        </div>
        <div className={styles.headerStats} aria-label="현재 참여 현황">
          <span><UsersRound size={16} aria-hidden="true" /><strong>{wheel ? number(people) : '-'}</strong>명</span>
          <span><CircleDot size={16} aria-hidden="true" /><strong>{wheel ? number(displayTotalSlots) : '-'}</strong>칸</span>
          <IconButton label="새로고침" onClick={() => void refresh()} disabled={refreshing || Boolean(pending) || offline}>
            <RefreshCw size={16} className={refreshing ? styles.loadingIcon : undefined} />
          </IconButton>
        </div>
      </header>

      {offline ? <div role="alert" className={styles.error}><WifiOff size={17} /><span>오프라인입니다. 연결이 복구될 때까지 마지막 상태를 유지합니다.</span></div>
        : readProblem ? <div role="alert" className={styles.error}>{errorBanner(readProblem)}</div> : null}
      {actionProblem ? <div role="alert" className={styles.error}>{errorBanner(actionProblem)}
        {retryIntent ? <Button size="sm" variant="outline" disabled={!writable || (Boolean(pending) || offline)} onClick={() => void perform(retryIntent)}>
          <RefreshCw size={14} />{pending ? '확인 중' : '같은 요청 다시 확인'}
        </Button> : null}
      </div> : null}
      <div role="status" className={styles.notice}>{notice ? <><Check size={15} aria-hidden="true" />{notice}</> : null}</div>

      {!wheel || !draft ? <div className={styles.initialState} aria-busy={!readProblem && !offline}>
        {!readProblem && !offline ? <Loader2 size={28} className={styles.loadingIcon} /> : <CircleDot size={32} />}
        <h2>{readProblem?.auth ? '돌림판에 접근할 수 없습니다' : readProblem || offline ? '돌림판을 불러오지 못했습니다' : '돌림판을 불러오는 중'}</h2>
        {readProblem || offline ? <Button variant="outline" onClick={() => void refresh()} disabled={refreshing || offline}><RefreshCw size={16} />다시 불러오기</Button> : null}
      </div> : <div className={styles.workspace}>
        <section className={styles.stage} ref={stageRef} aria-label="돌림판 추첨" data-theme={wheel.settings.theme}>
          <div className={styles.stageToolbar}>
            <div className={styles.stageTitle}><h2>{wheel.settings.title}</h2>
              <span className={styles.collectionState} data-open={wheel.collecting}><i />{wheel.collecting ? '모집 중' : '모집 마감'}</span>
            </div>
            <div className={styles.stageTools}>
              <IconButton label={muted ? '효과음 켜기' : '효과음 끄기'} aria-pressed={!muted} onClick={() => setMuted(!muted)}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</IconButton>
              <IconButton label={fullscreen ? '전체 화면 종료' : fullscreenAvailable ? '전체 화면' : '전체 화면을 지원하지 않는 브라우저'} onClick={() => void toggleFullscreen()} disabled={!fullscreenAvailable}>
                {fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              </IconButton>
            </div>
          </div>
          {stageProblem ? <p role="alert" className={styles.stageError}>{stageProblem}</p> : null}
          <div className={styles.wheelVisual}>
            <ParticipationWheel entries={wheel.entries} spin={previewSpin} serverNow={snapshot.serverNow} theme={wheel.settings.theme} sound={!muted} />
          </div>
          <div className={styles.result} aria-live="polite" aria-atomic="true">
            {spinning ? <><span className={styles.resultLabel}>추첨 중</span><strong>결과를 기다려 주세요</strong></>
              : latestResult ? <><span className={styles.resultLabel}><Trophy size={15} />{previewSpin ? '당첨 결과' : '최근 추첨 결과'}</span><strong>{latestResult.label}</strong><span>{latestResult.username || '직접 추가'} · {number(latestResult.selectedSlot + 1)}번 칸</span></>
                : <><span className={styles.resultLabel}>{wheel.totalSlots ? '추첨 준비 완료' : '참여 대기 중'}</span><strong>{wheel.totalSlots ? `${number(wheel.totalSlots)}칸의 선택지` : '아직 등록된 항목이 없습니다'}</strong></>}
          </div>
          <div className={styles.spinControls}>
            <Button variant="outline" disabled={!writable || (locked)} onClick={() => act(wheel.collecting ? 'close' : 'open')}>
              {pending === 'open' || pending === 'close' ? <Loader2 size={17} className={styles.loadingIcon} /> : wheel.collecting ? <Pause size={17} /> : <Plus size={17} />}
              {wheel.collecting ? '모집 마감' : '모집 시작'}
            </Button>
            <Button className={styles.spinButton} disabled={!writable || (locked || spinning || !wheel.totalSlots)} onClick={() => act('spin')}>
              {spinning || pending === 'spin' ? <Loader2 size={19} className={styles.loadingIcon} /> : <Play size={19} fill="currentColor" />}
              {spinning ? `추첨 중 · ${remaining}초` : pending === 'spin' ? '시작 중' : '돌리기'}
            </Button>
          </div>
          <div className={styles.stageFacts}><span><Clock3 size={14} />{wheel.settings.spinDurationMs / 1000}초</span><span>{removalLabels[wheel.settings.removal]}</span><span>1칸당 동일 확률</span></div>
          {spinning ? <p className={styles.spinNote}>추첨 시작 시점의 {number(wheel.latestSpin!.totalSlots)}칸으로 진행 중 · 새 참여는 다음 추첨에 반영</p> : null}
          {fullscreen && (offline || readProblem || actionProblem) ? <p role="alert" className={styles.stageError}>{offline ? '오프라인 · 마지막 상태 유지 중' : actionProblem?.message || readProblem?.message}</p> : null}
        </section>

        <Tabs.Root defaultValue="entries" className={styles.inspector}>
          <Tabs.List aria-label="돌림판 관리" className={styles.tabs}>
            <Tabs.Trigger value="entries"><List size={16} />항목<span>{displayEntries.length}</span></Tabs.Trigger>
            <Tabs.Trigger value="settings"><Settings2 size={16} />참여 설정{dirty ? <i aria-label="저장하지 않은 변경" /> : null}</Tabs.Trigger>
            <Tabs.Trigger value="history"><History size={16} />추첨 기록</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="entries" className={styles.tabContent}>
            <form className={styles.addForm} onSubmit={(event) => { event.preventDefault(); if (label.trim()) act('add', { label: label.trim(), slots: Number(slots) }); }}>
              <div className={styles.sectionHeading}><h3>직접 추가</h3><span>최대 1,000칸</span></div>
              <fieldset disabled={locked || wheel.totalSlots >= 1000 || wheel.entries.length >= 200} className={styles.addFields}>
                <label className={styles.field}>항목 이름<input ref={addInputRef} className={styles.input} required maxLength={60} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="항목 이름 입력" /></label>
                <label className={`${styles.field} ${styles.slotInput}`}>칸 수<Input type="number" min={1} max={Math.min(100, 1000 - wheel.totalSlots)} step={1} required value={slots} onChange={(event) => setSlots(event.target.value)} /></label>
                <Button type="submit" variant="outline" aria-label="항목 추가" disabled={!label.trim()}><Plus size={19} /></Button>
              </fieldset>
            </form>
            <div className={styles.entryToolbar}>
              <label className={styles.search}><Search size={16} aria-hidden="true" /><input aria-label="항목 또는 참여자 검색" placeholder="항목 또는 참여자 검색" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
              <IconButton label="돌림판 초기화" disabled={!writable || (locked || spinning)} onClick={(event) => confirm({ kind: 'clear' }, event.currentTarget)}><RotateCcw size={17} /></IconButton>
            </div>
            <div className={styles.listHeader}><span>{search ? `${visibleEntries.length}개 검색 결과` : `${spinning ? '추첨 중' : '등록 항목'} ${displayEntries.length}개`}</span><span>칸 수 / 당첨 확률</span></div>
            <ul className={styles.entries} aria-label="참여 항목">
              {visibleEntries.map((entry) => <li key={entry.id} className={styles.entry}>
                <span className={styles.entryColor} style={{ backgroundColor: colors[Math.abs(entry.colorIndex) % colors.length] }} />
                <div className={styles.entryName}><strong>{entry.label}</strong><span>{entry.username || '관리자'}<span className={styles.source} data-source={entry.source}>{sourceLabels[entry.source]}</span></span></div>
                <div className={styles.entryNumbers}><strong>{number(entry.slots)}<small>칸</small></strong><span>{spinning && !spinEntryIds.has(entry.id) ? '다음 추첨' : `${((entry.slots / (spinning ? wheel.latestSpin!.totalSlots : wheel.totalSlots) || 0) * 100).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%`}</span></div>
                <IconButton label={`${entry.label} 삭제`} disabled={!writable || (locked || spinning)} onClick={(event) => confirm({ kind: 'remove', entry }, event.currentTarget)}><Trash2 size={15} /></IconButton>
              </li>)}
            </ul>
            {!visibleEntries.length ? <div className={styles.empty}><UsersRound size={28} /><strong>{search ? '일치하는 항목이 없습니다' : '등록된 항목이 없습니다'}</strong>{search ? <button type="button" onClick={() => setSearch('')}>검색 지우기</button> : null}</div> : null}
            <footer className={styles.listFooter}><span>{spinning ? '추첨 중' : '합계'} <strong>{number(spinning ? wheel.latestSpin!.totalSlots : wheel.totalSlots)}칸</strong>{queuedSlots ? ` · 다음 추첨 +${number(queuedSlots)}칸` : null}</span><span>{number(people)}명 · {displayEntries.length}개 항목</span></footer>
          </Tabs.Content>

          <Tabs.Content value="settings" className={styles.tabContent}>
            <form onSubmit={saveSettings} className={styles.settingsForm}>
              {conflict ? <div className={styles.conflict} role="status"><AlertCircle size={16} /><p>다른 화면에서 설정이 변경되었습니다. 편집 중인 값은 유지했습니다.</p><div>
                <Button type="button" size="sm" variant="outline" disabled={Boolean(pending || retryIntent)} onClick={discardDraft}>서버 설정 불러오기</Button>
                <Button type="button" size="sm" variant="ghost" disabled={Boolean(pending || retryIntent)} onClick={() => {
                  dirtyRef.current = !sameSettings(draft, wheel.settings);
                  setBaseSettings(structuredClone(wheel.settings));
                }}>내 변경 유지</Button>
              </div></div> : null}
              <fieldset disabled={!writable || Boolean(pending || retryIntent)} className={styles.settingsFields}>
                <label className={styles.field}>돌림판 제목<Input required maxLength={60} value={draft.title} onChange={(event) => changeDraft({ ...draft, title: event.target.value })} /></label>
                <section className={styles.sourceSettings}>
                  <SourceToggle id="wheel-chat-enabled" checked={draft.chat.enabled} onChange={(enabled) => changeDraft({ ...draft, chat: { ...draft.chat, enabled } })}><MessageSquare size={17} />무료 채팅 참여</SourceToggle>
                  <div className={styles.fieldPair}>
                    <label className={styles.field}>참여 명령어<Input required pattern="![^\s]+" title="!로 시작하며 공백이 없는 명령어" maxLength={60} value={draft.chat.command} onChange={(event) => changeDraft({ ...draft, chat: { ...draft.chat, command: event.target.value } })} /></label>
                    <label className={styles.field}>1인당 한도<Input type="number" min={1} max={1000} step={1} required value={draft.chat.perUserLimit} onChange={(event) => changeDraft({ ...draft, chat: { ...draft.chat, perUserLimit: Number(event.target.value) } })} /></label>
                  </div>
                  <code className={styles.example}>{draft.chat.command || '!돌림판'} 항목</code>
                  <p className={styles.help}>한 라운드의 누적 참여 횟수 기준입니다. 항목을 삭제해도 무료 참여 한도는 복구되지 않습니다.</p>
                </section>
                <section className={styles.sourceSettings}>
                  <SourceToggle id="wheel-points-enabled" checked={draft.points.enabled} onChange={(enabled) => changeDraft({ ...draft, points: { ...draft.points, enabled } })}><Coins size={17} />포인트 참여</SourceToggle>
                  <div className={styles.fieldPair}>
                    <label className={styles.field}>참여 명령어<Input required pattern="![^\s]+" title="!로 시작하며 공백이 없는 명령어" maxLength={60} value={draft.points.command} onChange={(event) => changeDraft({ ...draft, points: { ...draft.points, command: event.target.value } })} /></label>
                    <label className={styles.field}>1칸당 포인트<Input type="number" min={1} max={2147483647} step={1} required value={draft.points.costPerSlot} onChange={(event) => changeDraft({ ...draft, points: { ...draft.points, costPerSlot: Number(event.target.value) } })} /></label>
                  </div>
                  <code className={styles.example}>{draft.points.command || '!돌림판추가'} 3 항목</code>
                  <p className={styles.help}>칸 수를 생략하면 1칸입니다. 요청한 칸 전체가 등록될 때만 포인트가 차감됩니다.</p>
                </section>
                <section className={styles.sourceSettings}>
                  <SourceToggle id="wheel-donation-enabled" checked={draft.donation.enabled} onChange={(enabled) => changeDraft({ ...draft, donation: { ...draft.donation, enabled } })}><Gift size={17} />후원 참여</SourceToggle>
                  <label className={styles.field}>1칸당 후원 금액 (원)<Input type="number" min={1} max={Number.MAX_SAFE_INTEGER} step={1} required value={draft.donation.wonPerSlot} onChange={(event) => changeDraft({ ...draft, donation: { ...draft.donation, wonPerSlot: Number(event.target.value) } })} /></label>
                  <p className={styles.help}>원화 후원만 적용됩니다. 후원 건별로 칸 수를 내림 계산하며 잔액은 이월되지 않습니다. 항목 이름은 후원 메시지 앞 60자, 메시지가 없으면 닉네임입니다.</p>
                </section>
                <section className={styles.sourceSettings}>
                  <h3 className={styles.settingHeading}><Settings2 size={17} />추첨 설정</h3>
                  <label className={styles.field} htmlFor="wheel-duration"><span className={styles.rangeLabel}>회전 시간<strong>{draft.spinDurationMs / 1000}초</strong></span></label>
                  <input id="wheel-duration" className={styles.range} type="range" min={4} max={15} step={1} value={draft.spinDurationMs / 1000} onChange={(event) => changeDraft({ ...draft, spinDurationMs: Number(event.target.value) * 1000 })} />
                  <div className={styles.rangeEnds}><span>4초</span><span>15초</span></div>
                  <label className={styles.field}>추첨 후 당첨 항목<select className={styles.select} value={draft.removal} onChange={(event) => changeDraft({ ...draft, removal: event.target.value as WheelSettings['removal'] })}>
                    <option value="one">당첨 1칸 제외</option><option value="keep">모두 유지</option><option value="all">당첨 항목 전체 제외</option>
                  </select></label>
                  <fieldset className={styles.themeField}><legend>돌림판 테마</legend><div className={styles.themes}>
                    {themes.map((theme) => <label key={theme.value} className={styles.theme}>
                      <input type="radio" name="wheel-theme" value={theme.value} checked={draft.theme === theme.value} onChange={() => changeDraft({ ...draft, theme: theme.value })} />
                      <span className={styles.swatch}>{theme.colors.map((color) => <i key={color} style={{ backgroundColor: color }} />)}{draft.theme === theme.value ? <Check size={16} /> : null}</span>
                      <span>{theme.label}</span>
                    </label>)}
                  </div></fieldset>
                </section>
                <p className={styles.help}>이곳에서 저장한 명령어는 돌림판 전용 시스템 명령어입니다. 일반 채팅 명령어에 중복 등록하지 않아도 됩니다.</p>
              </fieldset>
              <div className={styles.saveBar}><span>{dirty ? '저장하지 않은 변경' : '모든 변경 저장됨'}</span><div>
                <IconButton label="설정 변경 취소" disabled={!dirty || Boolean(pending || retryIntent)} onClick={discardDraft}><RotateCcw size={16} /></IconButton>
                <Button type="submit" disabled={locked || !dirty || conflict}><Save size={16} />{pending === 'settings' ? '저장 중' : '설정 저장'}</Button>
              </div></div>
            </form>
          </Tabs.Content>

          <Tabs.Content value="history" className={styles.tabContent}>
            <div className={styles.historyHeading}><h3>추첨 기록</h3><span>{completedHistory.length}회 완료</span></div>
            {spinning ? <div className={styles.historyPending}><Loader2 size={17} className={styles.loadingIcon} />현재 추첨 진행 중 · 종료 후 결과 공개</div> : null}
            <ol className={styles.history}>
              {completedHistory.map((spin) => <li key={spin.id}>
                <Trophy size={18} className={styles.historyTrophy} />
                <div><strong>{spin.label}</strong><span>{spin.username || '직접 추가'} · {number(spin.selectedSlot + 1)} / {number(spin.totalSlots)}번 칸</span><time dateTime={new Date(wheelTimeMs(spin.startedAt)).toISOString()}>{new Date(wheelTimeMs(spin.startedAt)).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></div>
              </li>)}
            </ol>
            {!completedHistory.length ? <div className={styles.empty}><History size={28} /><strong>완료된 추첨이 없습니다</strong></div> : null}
          </Tabs.Content>
        </Tabs.Root>
      </div>}

      <Dialog.Root open={Boolean(confirmation)} onOpenChange={(open) => { if (!open && !pending && !retryIntent) setConfirmation(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <Dialog.Content className={`${styles.page} ${styles.dialog}`} onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (confirmReturnFocus.current?.isConnected) confirmReturnFocus.current.focus();
            else addInputRef.current?.focus();
          }}>
            <div className={styles.dialogHeading}><Dialog.Title>{confirmation?.kind === 'clear' ? '돌림판을 초기화할까요?' : '이 항목을 삭제할까요?'}</Dialog.Title>
              <IconButton label="닫기" onClick={() => setConfirmation(null)} disabled={!writable || (Boolean(pending || retryIntent))}><X size={18} /></IconButton>
            </div>
            <Dialog.Description className={styles.dialogDescription}>
              {confirmation?.kind === 'clear' ? '모든 항목을 지우고 새 라운드를 시작합니다. 무료 참여 누적 한도도 초기화되며, 최근 추첨 기록 50개는 유지됩니다.' : `“${confirmation?.entry.label || ''}”의 남은 칸을 삭제합니다. 진행 중인 추첨의 항목에는 영향을 주지 않습니다.`}
            </Dialog.Description>
            <p className={styles.refundWarning}><Coins size={18} /><span>남아 있는 미사용 유료 포인트만 환불됩니다. 후원금은 환불되지 않습니다.</span></p>
            {actionProblem ? <div role="alert" className={styles.dialogError}><p>{actionProblem.message}</p>{retryIntent ? <Button size="sm" variant="outline" disabled={!writable || (Boolean(pending) || offline)} onClick={() => void perform(retryIntent)}><RefreshCw size={14} />같은 요청 다시 확인</Button> : null}</div> : null}
            {spinning ? <p className={styles.dialogError}>진행 중인 추첨이 끝난 뒤 {confirmation?.kind === 'clear' ? '초기화' : '삭제'}할 수 있습니다.</p> : null}
            <div className={styles.dialogActions}>
              <Button type="button" variant="outline" autoFocus disabled={!writable || (Boolean(pending || retryIntent))} onClick={() => setConfirmation(null)}>취소</Button>
              <Button type="button" variant="destructive" disabled={!writable || (locked || spinning)} onClick={() => {
                if (confirmation?.kind === 'clear') act('clear');
                else if (confirmation) act('remove', { entryId: confirmation.entry.id });
              }}>{pending ? <Loader2 size={16} className={styles.loadingIcon} /> : <Trash2 size={16} />}{confirmation?.kind === 'clear' ? '초기화' : '항목 삭제'}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
