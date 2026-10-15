'use client';

import * as Dialog from '@radix-ui/react-dialog';
import * as Switch from '@radix-ui/react-switch';
import * as Tabs from '@radix-ui/react-tabs';
import { Check, Copy, Dice5, ExternalLink, Eye, EyeOff, History, LayoutGrid, Link2Off, Loader2, Monitor, Pause, Pencil, Play, Plus, RefreshCw, RotateCcw, Save, Search, Settings2, Square, Trash2, UserPlus, UsersRound, WifiOff, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useBotChannel } from '@/components/app-shell/bot-channel-provider';
import { Button, LinkButton } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { MarbleContentEditor } from '@/features/marble/marble-content-editor';
import { MarbleParticipationFields } from '@/features/marble/marble-participation-editor';
import { MarbleLayoutEditor, type MarbleLayoutEditorProps } from '@/features/marble/marble-layout-editor';
import { MarbleStage } from '@/features/marble/marble-stage';
import { MarbleInvitations, MarblePlayerControls, MarblePlayerStatus, MarbleProfile, useMarbleMutation } from '@/features/marble/marble-participant-page';
import { useMarbleSnapshot } from '@/features/marble/use-marble-snapshot';
import { readJsonResult } from '@/shared/api/http';
import { DEFAULT_MARBLE_SETTINGS, MARBLE_COLORS, parseMarbleSettings, type MarbleLayouts, type MarblePlayer, type MarbleSettings } from '../../../shared/marble';
import styles from './marble-page.module.css';

type SettingsDraft = { value: MarbleSettings; base: MarbleSettings; conflict: boolean };
type LayoutDraft = { value: MarbleLayouts; base: MarbleLayouts; conflict: boolean };
type UserResult = { id?: string; userId?: string; displayName: string; avatarUrl?: string | null };
type Confirmation = { kind: 'end' } | { kind: 'rotate' } | { kind: 'start' } | { kind: 'disconnect' } | { kind: 'remove'; player: MarblePlayer };
const statusLabels = { lobby: '준비', running: '플레이 중', paused: '일시정지', finished: '종료' };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function Tool({ label, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <Tooltip content={label}><button type="button" className={styles.iconButton} aria-label={label} title={label} {...props}>{children}</button></Tooltip>;
}

function Toggle({ id, label, checked, onChange, disabled }: { id: string; label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <div className={styles.toggleRow}><label htmlFor={id}>{label}</label><Switch.Root id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} className={styles.switch}><Switch.Thumb className={styles.switchThumb} /></Switch.Root></div>;
}

function PersonalOverlayEditor({ token, ...props }: Omit<MarbleLayoutEditorProps, 'snapshot'> & { token: string }) {
  const { snapshot, error, refresh } = useMarbleSnapshot(`/api/overlays/marble?token=${encodeURIComponent(token)}`);
  return <>
    {error ? <div className={styles.error} role="alert"><WifiOff size={18} /><span>{error}</span><Tool label="OBS 미리보기 다시 연결" onClick={() => void refresh()}><RefreshCw size={16} /></Tool></div> : null}
    {snapshot ? <MarbleLayoutEditor {...props} snapshot={snapshot} /> : <p className={styles.muted}>OBS 화면 연결 중</p>}
  </>;
}

function PlayerEditor({ player, disabled, save, cancel }: { player: MarblePlayer; disabled: boolean; save: (name: string, color: string) => void; cancel: () => void }) {
  const [name, setName] = useState(player.name);
  const [color, setColor] = useState(player.color);
  const [base] = useState({ name: player.name, color: player.color });
  const conflict = base.color !== player.color || (!player.userId && base.name !== player.name);
  return <form className={styles.playerEdit} onSubmit={event => { event.preventDefault(); if (!disabled && !conflict) save(name.trim(), color); }}>
    <label className={styles.field}>이름<Input required maxLength={40} value={player.userId ? player.name : name} disabled={disabled || !!player.userId} onChange={event => setName(event.target.value)} /></label>
    <label className={styles.field}>말 테두리<input className={styles.colorInput} type="color" value={color} disabled={disabled} onChange={event => setColor(event.target.value)} /></label>
    <div className={styles.actions}><Tool label="변경 취소" onClick={cancel}><X size={17} /></Tool><Tooltip content="참가자 저장"><Button type="submit" size="icon" disabled={disabled || conflict || !name.trim()} aria-label="참가자 저장"><Check size={17} /></Button></Tooltip></div>
    {player.userId ? <p className={styles.profileNote}>이름과 사진은 연결된 계정의 대표 프로필을 사용합니다.</p> : null}
    {conflict ? <p className={styles.profileNote} role="alert">참가자 정보가 변경되었습니다. 취소 후 최신 정보를 확인해 주세요.</p> : null}
  </form>;
}

export function MarblePage() {
  const { canWrite, active } = useBotChannel();
  return <MarbleWorkspace key={active.ownerUserId} writable={canWrite('marble')} />;
}

function MarbleWorkspace({ writable }: { writable: boolean }) {
  const { snapshot, error, refresh, accept } = useMarbleSnapshot('/api/marble');
  const mutation = useMarbleMutation(accept, refresh);
  const [tab, setTab] = useState('game');
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [layoutDraft, setLayoutDraft] = useState<LayoutDraft | null>(null);
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [editingPlayer, setEditingPlayer] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(MARBLE_COLORS[1] || '#3b9c8c');
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<UserResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searched, setSearched] = useState(false);
  const searchRequest = useRef<AbortController | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [origin, setOrigin] = useState('');
  const state = snapshot?.state;
  const settings = draft?.value ?? state?.settings ?? DEFAULT_MARBLE_SETTINGS;
  const settingsConflict = !!draft && (draft.conflict || (!!state && !same(draft.base, state.settings)));
  const layouts = layoutDraft?.value ?? state?.settings.layouts ?? DEFAULT_MARBLE_SETTINGS.layouts;
  const layoutConflict = !!layoutDraft && (layoutDraft.conflict || (!!state && !same(layoutDraft.base, state.settings.layouts)));
  const running = state?.status === 'running' || state?.status === 'paused';
  const disabled = !writable || mutation.busy || mutation.offline || !!mutation.retry || !!error || !snapshot;
  const editDisabled = !writable || mutation.busy || !!mutation.retry || !snapshot;
  const selectedId = state?.players.some(player => player.id === selected) ? selected : state?.players[0]?.id ?? null;
  const selectedRuntime = selectedId ? state?.playerStates[selectedId] : undefined;
  const personalOverlay = !!snapshot?.viewerOverlay?.ownerUserId || state?.players.some(player => player.userId && player.userId !== snapshot?.ownerUserId);
  const display = snapshot && selectedRuntime ? { ...snapshot, state: { ...snapshot.state, ...selectedRuntime, currentPlayerId: selectedId } } : snapshot;
  const queued = state ? Object.values(state.playerStates).reduce((count, item) => count + item.donationQueue.length, 0) : 0;
  const overlayUrl = revealed && snapshot?.overlayToken && origin ? `${origin}/viewer/marble/${encodeURIComponent(snapshot.overlayToken)}` : '';

  useEffect(() => { setOrigin(window.location.origin); if (window.location.hash === '#obs') setTab('obs'); return () => searchRequest.current?.abort(); }, []);
  useEffect(() => {
    if (!draft && !layoutDraft && !editingPlayer) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [draft, layoutDraft, editingPlayer]);
  const updateSettings = (next: MarbleSettings) => {
    if (!state) return;
    setNotice('');
    setDraft(current => ({ value: next, base: current?.base ?? structuredClone(state.settings), conflict: current?.conflict ?? false }));
  };
  const action = (action: string, payload: Record<string, unknown> = {}, success?: () => void) => {
    if (!state || disabled) return;
    setNotice('');
    const playerId = typeof payload.playerId === 'string' ? payload.playerId : selectedId;
    const guard = ['roll', 'complete', 'pass', 'challenge-roll', 'challenge-result', 'timer-pause', 'timer-resume', 'timer-add', 'timer-finish'].includes(action) && playerId
      ? { playerId, expectedRollId: state.playerStates[playerId]?.lastRoll?.id ?? null } : {};
    void mutation.send({ path: '/api/marble/action', method: 'POST', snapshot: true, body: { action, ...payload, ...guard, revision: state.revision, requestId: crypto.randomUUID() }, success });
  };
  const saveSettings = () => {
    if (!state || !draft || disabled || settingsConflict) return;
    try { parseMarbleSettings(draft.value, state.settings); }
    catch (cause) { mutation.setError(cause instanceof Error ? cause.message : '설정 값을 확인해 주세요.'); return; }
    const patch = Object.fromEntries((Object.keys(draft.value) as (keyof MarbleSettings)[]).filter(key => !same(draft.value[key], draft.base[key])).map(key => [key, draft.value[key]]));
    void mutation.send({ path: '/api/marble/settings', method: 'PUT', snapshot: true, body: { settings: patch, revision: state.revision, requestId: crypto.randomUUID() }, success: () => { setDraft(null); setNotice('설정을 저장했습니다.'); }, conflict: () => setDraft(current => current ? { ...current, conflict: true } : null) });
  };
  const saveLayouts = () => {
    if (!state || !layoutDraft || disabled || layoutConflict) return;
    void mutation.send({ path: '/api/marble/layout', method: 'PUT', snapshot: true, body: { layouts: layoutDraft.value, revision: state.revision, requestId: crypto.randomUUID() }, success: () => { setLayoutDraft(null); setNotice('OBS 배치를 저장했습니다.'); }, conflict: () => setLayoutDraft(current => current ? { ...current, conflict: true } : null) });
  };
  const restoreBroadcastLayouts = () => {
    if (!state || editDisabled || layoutConflict || same(layouts, DEFAULT_MARBLE_SETTINGS.layouts)) return;
    if (!window.confirm(`가로·세로 배치를 방송형 기본 배치로 바꿀까요?${layoutDraft ? ' 저장하지 않은 배치 변경은 대체됩니다.' : ''} 배치 저장 전에는 방송에 반영되지 않습니다.`)) return;
    setLayoutDraft(current => ({ value: structuredClone(DEFAULT_MARBLE_SETTINGS.layouts), base: current?.base ?? structuredClone(state.settings.layouts), conflict: false }));
    setNotice('방송형 기본 배치를 불러왔습니다.');
  };
  const cancelSettings = () => {
    if (!window.confirm('작성 중인 설정을 취소하고 서버의 최신 설정을 불러올까요?')) return;
    setDraft(null); mutation.setError(''); void refresh();
  };
  const search = async () => {
    searchRequest.current?.abort();
    if (!query.trim()) { setUsers([]); setSearched(false); return; }
    const controller = new AbortController(); searchRequest.current = controller;
    setSearchBusy(true); setSearchError(''); setUsers([]); setSearched(false);
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const result = await readJsonResult<{ users: UserResult[] }>(`/api/marble/users?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
      if (searchRequest.current !== controller) return;
      if (result.ok) { setUsers(result.data.users); setSearched(true); }
      else setSearchError(result.message);
    } catch { if (searchRequest.current === controller) setSearchError('검색에 실패했습니다. 다시 검색해 주세요.'); }
    finally { window.clearTimeout(timeout); if (searchRequest.current === controller) { searchRequest.current = null; setSearchBusy(false); } }
  };
  const invite = (user: UserResult) => {
    const memberUserId = user.userId || user.id;
    if (!memberUserId || disabled || state?.players.some(player => player.userId === memberUserId)) return;
    void mutation.send({ path: '/api/marble/invites', method: 'POST', snapshot: true, body: { memberUserId, requestId: crypto.randomUUID() }, success: () => { setNotice(`${user.displayName} 님에게 초대를 보냈습니다.`); setUsers(current => current.filter(item => item !== user)); } });
  };
  const copyOverlay = async () => {
    try { await navigator.clipboard.writeText(overlayUrl); setNotice('OBS 주소를 복사했습니다.'); }
    catch { mutation.setError('주소를 복사하지 못했습니다. 표시된 주소를 직접 선택해 주세요.'); }
  };
  const confirm = () => {
    if (!confirmation || disabled) return;
    if (confirmation.kind === 'rotate') {
      void mutation.send({ path: '/api/marble/overlay/rotate', method: 'POST', snapshot: true, body: { requestId: crypto.randomUUID() }, success: () => { setConfirmation(null); setRevealed(false); setNotice('OBS 주소를 재발급했습니다. 브라우저 소스 주소를 교체해 주세요.'); } });
    } else if (confirmation.kind === 'disconnect') {
      void mutation.send({ path: '/api/marble/participation/disconnect', method: 'POST', snapshot: true, body: { requestId: crypto.randomUUID(), participationRevision: snapshot?.viewerParticipation?.revision }, success: () => { setConfirmation(null); setNotice('시청자 참여를 내 게임으로 복원했습니다.'); } });
    } else if (confirmation.kind === 'remove') action('remove-player', { playerId: confirmation.player.id }, () => setConfirmation(null));
    else action(confirmation.kind, {}, () => setConfirmation(null));
  };
  const saveBar = <div className={styles.saveBar}><span>{draft ? '저장하지 않은 설정' : '모든 변경사항 저장됨'}</span><div className={styles.actions}><Button type="button" variant="ghost" disabled={!draft || mutation.busy || !!mutation.retry} onClick={cancelSettings}><X size={16} />취소</Button><Button type="button" disabled={!draft || disabled || settingsConflict || (running && !!draft && (!same(draft.value.tiles, state?.settings.tiles) || !same(draft.value.cards, state?.settings.cards)))} onClick={saveSettings}>{mutation.busy ? <Loader2 size={16} className={styles.spin} /> : <Save size={16} />}설정 저장</Button></div></div>;

  return <div className={styles.page}>
    <header className={styles.header}><div className={styles.heading}><Dice5 size={24} /><h1>주루마블</h1>{state ? <span className={styles.status} data-status={state.status}>{statusLabels[state.status]}</span> : null}</div><div className={styles.actions}>
      {state?.status === 'running' ? <Button variant="outline" disabled={disabled} onClick={() => action('pause')}><Pause size={16} />일시정지</Button> : state?.status === 'paused' ? <Button disabled={disabled} onClick={() => action('resume')}><Play size={16} />계속하기</Button> : <Button disabled={disabled || !state?.players.length || !!draft || !!editingPlayer} onClick={() => state?.status === 'finished' ? setConfirmation({ kind: 'start' }) : action('start')}><Play size={16} />{state?.status === 'finished' ? '다시 시작' : '게임 시작'}</Button>}
      {running ? <Button variant="outline" disabled={disabled} onClick={() => setConfirmation({ kind: 'end' })}><Square size={15} />종료</Button> : null}
      <Tool label="상태 새로고침" disabled={mutation.busy} onClick={() => void refresh()}><RefreshCw size={17} /></Tool>
    </div></header>
    {!writable ? <p className={styles.warning}>읽기 전용입니다. 게임 진행과 설정 변경에는 주루마블 쓰기 권한이 필요합니다.</p> : null}
    {snapshot?.viewerOverlay?.ownerUserId ? <section className={styles.conflict} aria-label="OBS 표시 방"><span>내 OBS: <strong>{snapshot.viewerOverlay.roomTitle || '온라인 주루마블'}</strong></span><LinkButton href={`/viewer/marble/play/${encodeURIComponent(snapshot.viewerOverlay.ownerUserId)}`} variant="outline" size="sm"><Monitor size={15} />참여 중인 방·참여 종료</LinkButton></section> : null}
    {snapshot?.viewerParticipation?.connectedOwnerUserId ? <section className={styles.conflict} aria-label="시청자 참여 연결"><span>내 시청자 참여: <strong>{snapshot.viewerParticipation.connectedRoomTitle || '온라인 주루마블'}</strong>. {snapshot.viewerParticipation.suspended ? '참여가 종료되어 포인트·후원 연동이 중단되었습니다.' : '이 방으로 포인트·후원이 연결되어 있습니다.'} 아래의 내 게임 참여 설정은 연결 복원 후 적용됩니다.</span><LinkButton href={`/viewer/marble/play/${encodeURIComponent(snapshot.viewerParticipation.connectedOwnerUserId)}`} variant="outline" size="sm"><Settings2 size={15} />온라인 참여 설정</LinkButton><Button variant="outline" size="sm" disabled={disabled} onClick={() => setConfirmation({ kind: 'disconnect' })}><Link2Off size={15} />내 게임으로 시청자 참여 복원</Button></section> : null}
    {mutation.offline || error ? <div className={styles.error} role="alert"><WifiOff size={18} /><span>{mutation.offline ? '오프라인입니다. 연결이 복구되면 자동으로 동기화합니다. 편집 내용은 유지됩니다.' : typeof error === 'string' ? error : '서버에 연결하지 못했습니다. 자동으로 다시 연결합니다.'}</span><Button size="sm" variant="outline" onClick={() => void refresh()}><RefreshCw size={14} />다시 확인</Button></div> : null}
    {mutation.error ? <div className={styles.error} role="alert"><span>{mutation.error}</span>{mutation.retry ? <Button size="sm" variant="outline" disabled={mutation.busy || mutation.offline} onClick={() => void mutation.send(mutation.retry!)}><RefreshCw size={14} />요청 결과 다시 확인</Button> : null}</div> : null}
    <p className={styles.notice} role="status">{mutation.busy ? '요청 처리 중' : notice}</p>
    <Tabs.Root value={tab} onValueChange={setTab}>
      <Tabs.List className={styles.tabs} aria-label="주루마블 관리"><Tabs.Trigger value="game"><Dice5 size={16} />게임</Tabs.Trigger><Tabs.Trigger value="content"><LayoutGrid size={16} />판·카드{draft ? <span className={styles.dirtyDot} aria-label="저장하지 않은 설정" /> : null}</Tabs.Trigger><Tabs.Trigger value="participation"><Settings2 size={16} />참여 설정</Tabs.Trigger><Tabs.Trigger value="obs"><Monitor size={16} />OBS 배치{layoutDraft ? <span className={styles.dirtyDot} aria-label="저장하지 않은 배치" /> : null}</Tabs.Trigger></Tabs.List>
      <Tabs.Content value="game" className={styles.tabPanel}>
        {(draft || editingPlayer) && !running ? <p className={styles.warning}>변경사항을 저장하거나 취소한 뒤 게임을 시작해 주세요.</p> : null}
        {snapshot && display ? <>
          <div className={styles.gameGrid}><section className={styles.boardArea} aria-label="게임 판"><div className={styles.sectionHeading}><h2>{state?.settings.title}</h2><span className={styles.muted}>{state?.settings.tiles.length}칸 · 주사위 {state?.settings.diceCount}개</span></div><div className={styles.boardViewport}><MarbleStage snapshot={display} /></div>
            {(state?.players.length ?? 0) > 1 ? <div className={styles.rosterSummary}>{state?.players.map(player => <button key={player.id} type="button" aria-pressed={selectedId === player.id} onClick={() => setSelected(player.id)}><MarbleProfile player={player} /><strong>{player.position}번</strong><MarblePlayerStatus snapshot={snapshot} playerId={player.id} /></button>)}</div> : null}
          </section><div className={styles.inspector}>
            {(state?.players.length ?? 0) > 1 ? <label className={styles.field}>조작할 참가자<select className={styles.select} value={selectedId ?? ''} onChange={event => setSelected(event.target.value)}>{state?.players.map(player => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label> : null}
            <MarblePlayerControls snapshot={snapshot} playerId={selectedId} host disabled={disabled} onAction={action} />
            {(state?.players.length ?? 0) > 1 && !personalOverlay ? <Button variant="ghost" size="sm" disabled={disabled || state?.currentPlayerId === selectedId} onClick={() => action('focus', { playerId: selectedId })}><Monitor size={14} />선택 참가자를 OBS에 표시</Button> : null}
          </div></div>
          <section className={styles.section} aria-label="플레이어 관리"><div className={styles.sectionHeading}><h2>{state?.players.length === 1 ? '플레이어' : '참가자'}</h2><span className={styles.muted}>{state?.players.length}/8</span></div>
            <ul className={styles.playerList}>{state?.players.map(player => <li key={player.id}>{editingPlayer === player.id ? <PlayerEditor player={player} disabled={disabled || running} cancel={() => setEditingPlayer(null)} save={(nextName, nextColor) => action('update-player', { playerId: player.id, ...(!player.userId ? { name: nextName } : {}), color: nextColor }, () => setEditingPlayer(null))} /> : <><div className={styles.identity}><MarbleProfile player={player} />{player.userId ? <span className={styles.badge}>연결 계정</span> : null}</div><div className={styles.actions}><span className={styles.muted}>{player.laps}회 완주</span><Tool label={`${player.name} 수정`} disabled={disabled || running || editingPlayer !== null} onClick={() => setEditingPlayer(player.id)}><Pencil size={16} /></Tool><Tool label={`${player.name} 삭제`} disabled={disabled || running} onClick={() => setConfirmation({ kind: 'remove', player })}><Trash2 size={16} /></Tool></div></>}</li>)}</ul>
            <details className={styles.disclosure}><summary><UsersRound size={16} />추가 참가자 · 온라인 멀티</summary><div className={styles.disclosureBody}>
              {running ? <p className={styles.warning}>게임을 종료하면 참가자를 추가하거나 변경할 수 있습니다.</p> : null}
              <form className={styles.addPlayer} onSubmit={event => { event.preventDefault(); action('add-player', { name: name.trim(), color }, () => { setName(''); setNotice('참가자를 추가했습니다.'); }); }}><label className={styles.field}>오프라인 참가자 이름<Input required maxLength={40} value={name} disabled={disabled || running || (state?.players.length ?? 0) >= 8} onChange={event => setName(event.target.value)} /></label><label className={styles.field}>말 테두리<input type="color" className={styles.colorInput} value={color} disabled={disabled || running} onChange={event => setColor(event.target.value)} /></label><Button type="submit" variant="outline" disabled={disabled || running || !name.trim() || (state?.players.length ?? 0) >= 8}><Plus size={16} />추가</Button></form>
              <p className={styles.muted}>온라인 계정 초대와 받은 초대는 참여 설정에서 확인할 수 있습니다.</p>
            </div></details>
          </section>
          <section className={styles.section} aria-label="게임 기록"><div className={styles.sectionHeading}><h2><History size={16} />최근 기록</h2>{queued > 0 ? <span className={styles.warning}>후원 굴리기 대기 {queued}건</span> : null}</div>{!state?.history.length ? <p className={styles.muted}>아직 기록이 없습니다.</p> : <ol className={styles.history}>{state.history.slice(-20).reverse().map(item => <li key={item.id}><time dateTime={new Date(item.at).toISOString()}>{new Date(item.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</time><span>{item.text}</span></li>)}</ol>}</section>
        </> : <div className={styles.loading} role="status">{error ? '게임을 불러오지 못했습니다.' : <><Loader2 className={styles.spin} size={22} />게임 불러오는 중</>}</div>}
      </Tabs.Content>
      <Tabs.Content value="content" className={styles.tabPanel}>
        {running ? <p className={styles.warning}>게임 진행 중에는 판과 카드를 변경할 수 없습니다. 일시정지가 아닌 게임 종료 후 편집해 주세요.</p> : null}
        {settingsConflict ? <div className={styles.conflict} role="alert">서버 설정이 변경되었습니다. 초안은 유지되며 저장은 중지됩니다. 변경 취소로 최신 설정을 불러와 주세요.<Button size="sm" variant="outline" disabled={mutation.busy} onClick={() => void refresh()}><RefreshCw size={14} />최신 상태 확인</Button></div> : null}
        <form onSubmit={event => { event.preventDefault(); saveSettings(); }}><MarbleContentEditor settings={settings} onChange={updateSettings} disabled={editDisabled || running} />{saveBar}</form>
      </Tabs.Content>
      <Tabs.Content value="participation" forceMount className={styles.tabPanel}>
        <form className={styles.settingsForm} onSubmit={event => { event.preventDefault(); saveSettings(); }}>
          <fieldset disabled={editDisabled} className={styles.settingsFields}><section className={styles.section}><h2>기본 설정</h2><div className={styles.fieldPair}><label className={styles.field}>게임 제목<Input required maxLength={60} value={settings.title} onChange={event => updateSettings({ ...settings, title: event.target.value })} /></label><label className={styles.field}>주사위 개수<select className={styles.select} value={settings.diceCount} onChange={event => updateSettings({ ...settings, diceCount: Number(event.target.value) as 1 | 2 })}><option value={1}>1개</option><option value={2}>2개</option></select></label></div></section>
          <section className={styles.section}><h2>시청자 참여</h2><label className={styles.field}>포인트·후원 굴리기 대상<select className={styles.select} value={settings.triggerPlayerId ?? ''} onChange={event => updateSettings({ ...settings, triggerPlayerId: event.target.value || null })}><option value="">첫 번째 플레이어 (기본)</option>{state?.players.map(player => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label>
            <MarbleParticipationFields idPrefix="marble" value={settings} onChange={participation => updateSettings({ ...settings, ...participation })} disabled={editDisabled} />
          </section><section className={styles.section}><h2>온라인 참가자</h2><Toggle id="marble-participant-control" label="참가자 본인 말 직접 조작" checked={settings.participantControl} onChange={participantControl => updateSettings({ ...settings, participantControl })} disabled={editDisabled} /></section></fieldset>
          {settingsConflict ? <p className={styles.conflict} role="alert">서버 설정이 바뀌었습니다. 작성 중인 내용은 유지됩니다. 변경 취소 후 최신 설정을 확인해 주세요.</p> : null}{saveBar}
        </form>
        <div className={styles.onlineGrid}><section className={styles.section} aria-label="온라인 초대"><h2><UserPlus size={17} />온라인 계정 초대</h2>{running ? <p className={styles.warning}>게임 종료 후 새 참가자를 초대하거나 초대를 철회할 수 있습니다.</p> : null}<form className={styles.searchForm} onSubmit={event => { event.preventDefault(); void search(); }}><label className={styles.field}>사용자 검색<Input value={query} maxLength={100} onChange={event => { searchRequest.current?.abort(); searchRequest.current = null; setSearchBusy(false); setQuery(event.target.value); setUsers([]); setSearched(false); }} placeholder="대표 닉네임" disabled={!writable} /></label><Button type="submit" variant="outline" disabled={disabled || searchBusy || !query.trim()}>{searchBusy ? <Loader2 size={16} className={styles.spin} /> : <Search size={16} />}검색</Button></form>{searchError ? <p className={styles.warning} role="alert">{searchError}</p> : null}{searched && !users.length ? <p className={styles.muted}>검색 결과가 없습니다.</p> : null}
          <ul className={styles.simpleList}>{users.map(user => { const id = user.userId || user.id; const joined = state?.players.some(player => player.userId === id); const pending = snapshot?.invitations?.some(item => item.memberUserId === id && item.status === 'pending'); return <li key={id}><span>{user.displayName}</span><Button size="sm" variant="outline" disabled={disabled || running || pending || joined || (state?.players.length ?? 0) >= 8} onClick={() => invite(user)}>{joined ? <Check size={14} /> : <UserPlus size={14} />}{joined ? '참여 중' : pending ? '초대 대기' : '초대'}</Button></li>; })}</ul>
          <h3 className={styles.subheading}>보낸 초대</h3><ul className={styles.simpleList}>{snapshot?.invitations?.filter(item => item.status === 'pending').map(invitation => <li key={invitation.id}><div><strong>{invitation.displayName}</strong><span>수락 대기 · {new Date(invitation.expiresAt).toLocaleDateString('ko-KR')} 만료</span></div><Button type="button" variant="ghost" size="sm" disabled={disabled || running} onClick={() => void mutation.send({ path: `/api/marble/invites/${encodeURIComponent(invitation.id)}`, method: 'DELETE', snapshot: true, body: { requestId: crypto.randomUUID() }, success: () => setNotice('초대를 철회했습니다.') })}><X size={14} />철회</Button></li>)}</ul>{!snapshot?.invitations?.some(item => item.status === 'pending') ? <p className={styles.muted}>대기 중인 초대가 없습니다.</p> : null}
        </section><MarbleInvitations /></div>
      </Tabs.Content>
      <Tabs.Content value="obs" className={styles.tabPanel}>
        <section className={styles.section} aria-label="OBS 주소">
          <div className={styles.sectionHeading}><h2>투명 OBS 브라우저 소스</h2><Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => setConfirmation({ kind: 'rotate' })}><RefreshCw size={15} />주소 재발급</Button></div>
          <div className={styles.addressBar}>
            <Input readOnly aria-label="OBS 주소" value={overlayUrl || '주소가 숨겨져 있습니다.'} />
            <Tool label={revealed ? '주소 숨기기' : '주소 보기'} disabled={!snapshot?.overlayToken} onClick={() => setRevealed(value => !value)}>{revealed ? <EyeOff size={17} /> : <Eye size={17} />}</Tool>
            <Tool label="OBS 주소 복사" disabled={!overlayUrl} onClick={() => void copyOverlay()}><Copy size={17} /></Tool>
            <Tool label="OBS 새 창 보기" disabled={!overlayUrl} onClick={() => window.open(overlayUrl, '_blank', 'noopener,noreferrer')}><ExternalLink size={17} /></Tool>
          </div>
        </section>
        <div className={styles.sectionHeading}><h2>화면 배치</h2><Button type="button" variant="outline" size="sm" disabled={editDisabled || layoutConflict || same(layouts, DEFAULT_MARBLE_SETTINGS.layouts)} onClick={restoreBroadcastLayouts}><RotateCcw size={15} />방송형 기본 배치</Button></div>
        {snapshot?.overlayToken ? <PersonalOverlayEditor token={snapshot.overlayToken} layouts={layouts} disabled={editDisabled} onChange={(next: MarbleLayouts) => setLayoutDraft(current => ({ value: next, base: current?.base ?? structuredClone(snapshot.state.settings.layouts), conflict: current?.conflict ?? false }))} /> : <p className={styles.muted}>게임 연결 후 배치를 편집할 수 있습니다.</p>}
        {layoutConflict ? <p className={styles.conflict} role="alert">서버의 OBS 배치가 변경되었습니다. 작성 중인 배치는 유지됩니다. 취소 후 최신 배치를 확인해 주세요.</p> : null}
        <div className={styles.saveBar}><span>{layoutDraft ? '저장하지 않은 배치' : '가로·세로 배치 저장됨'}</span><div className={styles.actions}><Button variant="ghost" disabled={!layoutDraft || mutation.busy || !!mutation.retry} onClick={() => { if (window.confirm('배치 변경을 취소하고 최신 배치를 불러올까요?')) { setLayoutDraft(null); void refresh(); } }}><X size={16} />취소</Button><Button disabled={!layoutDraft || disabled || layoutConflict} onClick={saveLayouts}><Save size={16} />배치 저장</Button></div></div>
      </Tabs.Content>
    </Tabs.Root>
    <Dialog.Root open={!!confirmation} onOpenChange={open => { if (!open && !mutation.busy) setConfirmation(null); }}><Dialog.Portal><Dialog.Overlay className={styles.dialogOverlay} /><Dialog.Content className={styles.dialog} onEscapeKeyDown={event => { if (mutation.busy) event.preventDefault(); }} onInteractOutside={event => { if (mutation.busy) event.preventDefault(); }}>
      <Dialog.Title className={styles.dialogTitle}>{confirmation?.kind === 'end' ? '게임을 종료할까요?' : confirmation?.kind === 'rotate' ? 'OBS 주소를 재발급할까요?' : confirmation?.kind === 'remove' ? '참가자를 삭제할까요?' : confirmation?.kind === 'disconnect' ? '시청자 참여를 내 게임으로 복원할까요?' : '새 게임을 시작할까요?'}</Dialog.Title>
      <Dialog.Description className={styles.dialogDescription}>{confirmation?.kind === 'end' ? `진행 중인 미션이 종료됩니다. 남은 후원 굴리기 ${queued}건은 삭제되며 외부 후원 금액은 환불되지 않습니다. 온라인 참가자와 OBS 연결은 유지됩니다.` : confirmation?.kind === 'rotate' ? '기존 주소는 즉시 사용할 수 없게 됩니다. OBS 브라우저 소스의 주소를 새 주소로 교체해야 합니다.' : confirmation?.kind === 'remove' ? `${confirmation.player.name} 님의 말과 참가 정보를 삭제합니다.` : confirmation?.kind === 'disconnect' ? '새 포인트·후원 굴리기는 내 게임의 참여 설정을 다시 적용합니다. OBS 표시 방과 기존 방의 예약·참가는 유지됩니다.' : '위치와 진행 효과를 초기화합니다. 이전 게임 기록은 남습니다.'}</Dialog.Description>
      {mutation.error ? <p className={styles.warning} role="alert">{mutation.error}</p> : null}<div className={styles.dialogActions}><Button variant="ghost" disabled={mutation.busy} onClick={() => setConfirmation(null)}>취소</Button><Button variant={confirmation?.kind === 'start' || confirmation?.kind === 'disconnect' ? 'default' : 'destructive'} disabled={disabled} onClick={confirm}>{mutation.busy ? <Loader2 size={16} className={styles.spin} /> : <Check size={16} />}{confirmation?.kind === 'end' ? '예약 삭제 후 종료' : confirmation?.kind === 'rotate' ? '재발급' : confirmation?.kind === 'remove' ? '삭제' : confirmation?.kind === 'disconnect' ? '내 게임으로 연결 복원' : '새 게임 시작'}</Button></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}
