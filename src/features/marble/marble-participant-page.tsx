'use client';

import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { Check, Dice5, ExternalLink, Loader2, LogOut, Monitor, Pause, Play, Plus, RefreshCw, Settings2, ShieldCheck, Timer, UsersRound, WifiOff, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, LinkButton } from '@/components/ui/button';
import { readJsonResult } from '@/shared/api/http';
import { MarbleStage } from './marble-stage';
import { MarbleParticipationEditor } from './marble-participation-editor';
import { marbleCompleteLabel } from './marble-presentation';
import { useMarbleSnapshot } from './use-marble-snapshot';
import { marbleChallengeText, marbleNextRoll, type MarbleInvitation, type MarblePlayer, type MarbleSnapshot, type MarbleViewerOverlay } from '../../../shared/marble';
import styles from '@/features/admin/marble-page.module.css';

type Mutation = {
  path: string; method: 'POST' | 'PUT' | 'DELETE'; body: Record<string, unknown>;
  snapshot?: boolean; success?: () => void; conflict?: () => void;
};

// A network retry retains its request ID so an uncertain write is not executed twice.
// eslint-disable-next-line react-refresh/only-export-components
export function useMarbleMutation(accept: (snapshot: MarbleSnapshot) => unknown, refresh: () => unknown) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState<Mutation | null>(null);
  const [offline, setOffline] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const update = () => setOffline(!navigator.onLine);
    update(); window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { mounted.current = false; controller.current?.abort(); window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  const send = async (intent: Mutation): Promise<boolean> => {
    if (controller.current || !navigator.onLine) return false;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError(''); setRetry(null);
    const timeout = window.setTimeout(() => request.abort(), 12000);
    try {
      const result = await readJsonResult<MarbleSnapshot>(intent.path, { method: intent.method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(intent.body), signal: request.signal });
      if (!mounted.current) return false;
      if (!result.ok) {
        if (result.status === 409 && ['stale_revision', 'stale_player_state', 'stale_participation', 'stale_participation_revision', 'stale_overlay_revision'].includes(result.code || '')) {
          setError('다른 요청으로 상태가 변경되었습니다. 최신 상태를 확인해 주세요. 작성 중인 내용은 유지됩니다.');
          intent.conflict?.(); void refresh();
        } else {
          setError(result.status === 401 ? '로그인이 만료되었습니다. 다시 로그인해 주세요.' : result.status === 403 ? '이 작업에 대한 권한이 없습니다.' : result.message);
          if (result.status === null || result.status >= 500) setRetry(intent);
        }
        return false;
      }
      if (intent.snapshot) {
        if (!result.data?.state?.settings || !result.data.state.playerStates || !Number.isFinite(result.data.serverNow) || !Number.isSafeInteger(result.data.state.revision)) {
          setError('응답 상태를 확인하지 못했습니다. 같은 요청을 다시 확인해 주세요.'); setRetry(intent); return false;
        }
        accept(result.data);
      } else void refresh();
      intent.success?.();
      return true;
    } catch {
      if (mounted.current) { setError('서버 응답을 확인하지 못했습니다. 같은 요청을 다시 확인하면 중복 실행되지 않습니다.'); setRetry(intent); }
      return false;
    } finally {
      window.clearTimeout(timeout); controller.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  return { busy, error, retry, offline, send, setError };
}

export function MarbleProfile({ player }: { player: Pick<MarblePlayer, 'name' | 'avatarUrl' | 'color'> }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [player.avatarUrl]);
  const photo = player.avatarUrl && /^https:\/\//i.test(player.avatarUrl) && !failed;
  return <><span className={styles.avatar} style={{ borderColor: player.color }}>{photo ? <img src={player.avatarUrl!} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span>{player.name.slice(0, 1)}</span>}</span><span className={styles.playerName}>{player.name}</span></>;
}

export function MarblePlayerStatus({ snapshot, playerId }: { snapshot: MarbleSnapshot; playerId: string }) {
  const [now, setNow] = useState(snapshot.serverNow);
  useEffect(() => {
    const anchor = performance.now();
    setNow(snapshot.serverNow);
    const interval = window.setInterval(() => setNow(snapshot.serverNow + performance.now() - anchor), 500);
    return () => window.clearInterval(interval);
  }, [snapshot]);
  const runtime = snapshot.state.playerStates[playerId];
  const timer = runtime?.timer;
  const clock = snapshot.state.pausedAt ?? now;
  const remaining = timer ? Math.min(timer.durationMs, Math.max(0, timer.paused || timer.deadline === null ? timer.remainingMs : timer.deadline - clock)) : 0;
  const seconds = Math.ceil(remaining / 1000);
  return <small>{snapshot.state.status === 'paused' ? '일시정지' : runtime?.phase === 'effect' ? '미션 중' : '굴리기 대기'}{timer ? ` · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}${timer.paused ? ' 정지' : ''}` : ''}</small>;
}

export function MarblePlayerControls({ snapshot, playerId, host = false, disabled, onAction }: {
  snapshot: MarbleSnapshot; playerId: string | null; host?: boolean; disabled: boolean;
  onAction: (action: string, payload?: Record<string, unknown>) => void;
}) {
  const [now, setNow] = useState(snapshot.serverNow);
  useEffect(() => {
    const anchor = performance.now();
    setNow(snapshot.serverNow);
    const interval = window.setInterval(() => setNow(snapshot.serverNow + performance.now() - anchor), 200);
    return () => window.clearInterval(interval);
  }, [snapshot]);
  const state = snapshot.state;
  const selectingPlayer = host && state.players.length > 1;
  const player = state.players.find(item => item.id === playerId);
  const runtime = playerId ? state.playerStates[playerId] : undefined;
  const followup = marbleNextRoll(runtime?.pending);
  const ready = runtime?.phase === 'ready';
  const moving = Boolean(runtime?.pending && (state.pausedAt ?? now) < runtime.pending.readyAt);
  const challenge = runtime?.pending?.challenge;
  const challengeRolling = !!challenge?.roll && (state.pausedAt ?? now) < challenge.roll.endsAt;
  const awaitingResult = !!challenge && !challenge.outcome;
  const needsDice = awaitingResult && challenge.rollDice && !challenge.roll;
  const canJudge = !moving && !challengeRolling && !needsDice;
  const allowed = !disabled && state.status === 'running' && !!player && !!runtime && (host || (snapshot.actorPlayerId === playerId && state.settings.participantControl));
  const timer = runtime?.timer;
  const remaining = timer ? Math.min(timer.durationMs, Math.max(0, timer.paused || timer.deadline === null ? timer.remainingMs : timer.deadline - (state.pausedAt ?? now))) : 0;
  const seconds = Math.ceil(remaining / 1000);
  const act = (action: string, payload: Record<string, unknown> = {}) => onAction(action, { ...payload, playerId });

  return <section className={styles.controls} aria-label={selectingPlayer ? '선택 참가자 제어' : '내 진행'}>
    <div className={styles.sectionHeading}><h2>{selectingPlayer ? '선택 참가자' : '내 진행'}</h2><span className={styles.badge}>자유 진행</span></div>
    {player ? <>
      <div className={styles.playerHeading}><MarbleProfile player={player} /><span>{player.position}번 칸</span></div>
      <div className={styles.playerFacts}><span>완주 {player.laps}회</span><span>방어권 {player.shields}개</span>{player.skipTurns > 0 ? <span>쉬기 {player.skipTurns}회</span> : null}</div>
      <div className={styles.diceResult} aria-label="최근 주사위 결과">{runtime?.lastRoll ? <><Dice5 size={20} /><strong>{runtime.lastRoll.dice.join(' + ')}</strong><span>합계 {runtime.lastRoll.dice.reduce((a, b) => a + b, 0)}</span></> : <span>아직 굴린 주사위가 없습니다.</span>}</div>
      <Button type="button" className={styles.rollButton} disabled={!allowed || !ready} onClick={() => act('roll')}><Dice5 size={19} />{moving ? '이동 중' : selectingPlayer ? '선택 참가자 굴리기' : '주사위 굴리기'}</Button>
      {runtime?.pending && !moving ? <div className={styles.mission} aria-live="polite"><span className={styles.eyebrow}>{challenge?.outcome ? challenge.outcome === 'success' ? '미션 성공 · 보상' : '미션 실패 · 벌칙' : runtime.pending.cardId ? '황금 카드' : '진행 중인 미션'}</span><h3>{runtime.pending.title}</h3><p>{marbleChallengeText(challengeRolling ? challenge!.missionText : runtime.pending.text, challengeRolling ? null : challenge)}</p>{runtime.pending.shieldDelta !== undefined ? <output className={styles.shieldChange} data-negative={runtime.pending.shieldDelta < 0}><ShieldCheck size={15} />방어권 {runtime.pending.shieldDelta === 0 ? '변동 없음' : `${runtime.pending.shieldDelta > 0 ? '+' : ''}${runtime.pending.shieldDelta}장`} · 보유 {player.shields}장</output> : null}
        {awaitingResult ? <div className={styles.challengeOutcomes}><div data-outcome="success"><strong><Check size={15} />성공 보상</strong><p>{marbleChallengeText(challenge.success.text, challengeRolling ? null : challenge)}</p></div><div data-outcome="failure"><strong><X size={15} />실패 벌칙</strong><p>{marbleChallengeText(challenge.failure.text, challengeRolling ? null : challenge)}</p></div></div> : null}
        {challenge?.roll ? <output className={styles.challengeDie}><Dice5 size={19} />{challengeRolling ? '미션 주사위 굴리는 중' : `미션 주사위 ${challenge.roll.dice[0]}눈`}</output> : null}
      </div> : <p className={styles.muted}>{state.status === 'paused' ? '게임 일시정지' : moving ? '말 이동 중' : state.status === 'running' ? '굴리기 대기' : state.status === 'finished' ? '게임 종료' : '게임 시작 대기'}</p>}
      {timer ? <div className={styles.timerArea}>
        <div className={styles.sectionHeading}><span><Timer size={16} />{timer.paused ? '타이머 일시정지' : seconds === 0 ? '시간 종료' : '남은 시간'}</span><output className={styles.timerValue}>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</output></div>
        {host ? <div className={styles.actions}><Button type="button" size="sm" variant="outline" disabled={!allowed || !canJudge} onClick={() => act(timer.paused ? 'timer-resume' : 'timer-pause')}>{timer.paused ? <Play size={14} /> : <Pause size={14} />}{timer.paused ? '재개' : '정지'}</Button><Button type="button" size="sm" variant="outline" disabled={!allowed || !canJudge} onClick={() => act('timer-add', { seconds: 30 })}><Plus size={14} />30초</Button><Button type="button" size="sm" variant="ghost" disabled={!allowed || !canJudge} onClick={() => act('timer-finish')}><Check size={14} />타이머 종료</Button></div> : null}
      </div> : null}
      {awaitingResult ? <>
        {needsDice ? <Button type="button" disabled={!allowed || moving} onClick={() => act('challenge-roll')}><Dice5 size={17} />미션 주사위 굴리기</Button> : null}
        <div className={styles.controlPair}><Button type="button" className={styles.challengeSuccess} disabled={!allowed || !canJudge} onClick={() => act('challenge-result', { outcome: 'success' })}><Check size={17} />성공</Button><Button type="button" variant="outline" className={styles.challengeFailure} disabled={!allowed || !canJudge} onClick={() => act('challenge-result', { outcome: 'failure' })}><X size={17} />실패</Button></div>
      </> : null}
      <div className={styles.controlPair}>{!awaitingResult ? <Button type="button" variant="secondary" disabled={!allowed || ready || moving || challengeRolling} onClick={() => act('complete')}>{followup ? <Dice5 size={17} /> : <Check size={17} />}{challenge && !followup ? '결과 확인 · 다음 진행' : marbleCompleteLabel(followup)}</Button> : null}<Button type="button" variant="outline" disabled={!allowed || ready || moving || challengeRolling || (!host && player.shields < 1)} onClick={() => act('pass')}><ShieldCheck size={17} />{host ? '미션 패스' : '방어권 사용'}</Button></div>
      {!host && !state.settings.participantControl ? <p className={styles.warning}>방장이 참가자 직접 조작을 껐습니다.</p> : null}
      {(host ? runtime?.donationQueue.length : snapshot.viewerDonationQueueCount ?? 0) ? <p className={styles.muted}>후원 굴리기 대기 {host ? runtime?.donationQueue.length : snapshot.viewerDonationQueueCount}건</p> : null}
    </> : <p className={styles.empty}>참가자를 선택해 주세요.</p>}
  </section>;
}

type JoinedRoom = { ownerUserId: string; title?: string; displayName?: string; status?: string };
type Inbox = { invitations: MarbleInvitation[]; rooms: JoinedRoom[]; viewerOverlay?: MarbleViewerOverlay };

export function MarbleInvitations() {
  const [data, setData] = useState<Inbox | null>(null);
  const [error, setError] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const read = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    if (read.current) return;
    const controller = new AbortController(); read.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const result = await readJsonResult<Inbox>('/api/viewer/marble/invitations', { credentials: 'include', signal: controller.signal });
      if (!mounted.current || read.current !== controller) return;
      if (result.ok && Array.isArray(result.data.invitations) && Array.isArray(result.data.rooms)) { setData(result.data); setError(''); }
      else setError(result.ok ? '초대 응답을 확인하지 못했습니다.' : result.status === 401 ? '받은 초대를 확인하려면 로그인해 주세요.' : result.message);
    } catch { if (mounted.current && read.current === controller) setError('초대를 불러오지 못했습니다. 자동으로 다시 연결합니다.'); }
    finally { window.clearTimeout(timeout); if (read.current === controller) read.current = null; }
  }, []);
  const mutation = useMarbleMutation(() => {}, refresh);
  useEffect(() => {
    mounted.current = true; void refresh();
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 10000);
    return () => { mounted.current = false; read.current?.abort(); window.clearInterval(interval); };
  }, [refresh]);
  const answer = async (id: string, action: 'accept' | 'decline') => {
    if (mutation.busy || mutation.retry || mutation.offline) return;
    setPendingId(id);
    await mutation.send({ path: `/api/viewer/marble/invitations/${encodeURIComponent(id)}`, method: 'POST', body: { action, requestId: crypto.randomUUID() }, success: () => {
      read.current?.abort(); read.current = null; void refresh();
    } });
  };
  const disabled = mutation.busy || mutation.offline || !!mutation.retry;
  const invitations = data?.invitations.filter(item => item.status === 'pending') ?? [];
  return <section className={styles.inbox} aria-label="받은 초대와 참여 중인 방">
    <div className={styles.sectionHeading}><h2>받은 초대</h2><Button type="button" variant="ghost" size="icon" aria-label="초대 새로고침" title="초대 새로고침" disabled={mutation.busy} onClick={() => void refresh()}><RefreshCw size={16} /></Button></div>
    {error ? <p role="alert" className={styles.warning}>{error}</p> : null}
    {mutation.error || mutation.offline ? <div role="alert" className={styles.error}><span>{mutation.offline ? '오프라인입니다. 연결 후 초대에 응답할 수 있습니다.' : mutation.error}</span>{mutation.retry ? <Button type="button" size="sm" variant="outline" disabled={mutation.busy || mutation.offline} onClick={() => void mutation.send(mutation.retry!)}><RefreshCw size={14} />요청 결과 다시 확인</Button> : null}</div> : null}
    {!data && !error ? <p role="status" className={styles.muted}>초대 확인 중</p> : null}
    {data && invitations.length === 0 ? <p className={styles.muted}>대기 중인 초대가 없습니다.</p> : null}
    <ul className={styles.simpleList}>{invitations.map(invite => <li key={invite.id}><div><strong>{invite.displayName}</strong><span>만료 {new Date(invite.expiresAt).toLocaleDateString('ko-KR')}</span></div><div className={styles.actions}><Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void answer(invite.id, 'decline')}><X size={14} />거절</Button><Button type="button" size="sm" disabled={disabled} onClick={() => void answer(invite.id, 'accept')}>{mutation.busy && pendingId === invite.id ? <Loader2 size={14} className={styles.spin} /> : <Check size={14} />}수락</Button></div></li>)}</ul>
    <h3 className={styles.subheading}>참여 중인 방</h3>
    {data && data.rooms.length === 0 ? <p className={styles.muted}>참여 중인 방이 없습니다.</p> : null}
    <ul className={styles.simpleList}>{data?.rooms.map(room => <li key={room.ownerUserId}><div><strong>{room.displayName || '스트리머'}</strong><span>{room.title || '주루마블'} · {room.status === 'running' ? '플레이 중' : room.status === 'paused' ? '일시정지' : room.status === 'finished' ? '종료' : '준비'}{data.viewerOverlay?.ownerUserId === room.ownerUserId ? ' · 내 OBS 표시 중' : ''}</span></div><LinkButton href={`/viewer/marble/play/${encodeURIComponent(room.ownerUserId)}`} size="sm" variant="outline">참여하기<ExternalLink size={14} /></LinkButton></li>)}</ul>
  </section>;
}

export function MarbleParticipantPage({ ownerId }: { ownerId: string }) {
  return <MarbleParticipantWorkspace key={ownerId} ownerId={ownerId} />;
}

function MarbleParticipantWorkspace({ ownerId }: { ownerId: string }) {
  const path = `/api/viewer/marble/rooms/${encodeURIComponent(ownerId)}`;
  const { snapshot, error, refresh, accept } = useMarbleSnapshot(path);
  const mutation = useMarbleMutation(accept, refresh);
  const [leaving, setLeaving] = useState(false);
  const [left, setLeft] = useState(false);
  const playerId = snapshot?.actorPlayerId ?? null;
  const runtime = playerId ? snapshot?.state.playerStates[playerId] : undefined;
  const display = snapshot && runtime ? { ...snapshot, state: { ...snapshot.state, ...runtime, currentPlayerId: playerId } } : snapshot;
  const disabled = mutation.busy || mutation.offline || !!mutation.retry || !!error;
  const action = (action: string, payload?: Record<string, unknown>) => {
    if (!snapshot || !playerId || disabled || !snapshot.state.settings.participantControl) return;
    void mutation.send({ path: `${path}/action`, method: 'POST', snapshot: true, body: { action, playerId, expectedRollId: snapshot.state.playerStates[playerId]?.lastRoll?.id ?? null, ...(action === 'pass' ? { useShield: true } : {}), ...(action === 'challenge-result' ? { outcome: payload?.outcome } : {}), revision: snapshot.state.revision, requestId: crypto.randomUUID() } });
  };
  if (left) return <main className={`${styles.page} ${styles.participantPage}`}>
    <header className={styles.header}><h1>참여 종료</h1><LinkButton href="/marble#obs" variant="outline" size="sm"><Monitor size={16} />내 OBS·주루마블</LinkButton></header>
    <p role="status" className={styles.notice}>이 방의 참여를 종료했습니다.</p><MarbleInvitations />
  </main>;
  return <main className={`${styles.page} ${styles.participantPage}`}>
    <header className={styles.header}><div className={styles.heading}><Dice5 size={24} /><h1>{snapshot?.state.settings.title || '주루마블'}</h1><span className={styles.badge}>참가자</span></div><div className={styles.actions}><LinkButton href="/marble#obs" variant="outline" size="sm">내 OBS 주소·배치</LinkButton><Button variant="outline" size="sm" disabled={disabled || !snapshot?.actorInvitationId} onClick={() => setLeaving(true)}><LogOut size={15} />참여 종료</Button></div></header>
    <p className={styles.notice} role="status">{mutation.busy ? '요청 처리 중' : ''}</p>
    {mutation.offline || error ? <div className={styles.error} role="alert"><WifiOff size={18} /><span>{mutation.offline ? '오프라인입니다. 연결이 복구되면 자동으로 동기화합니다.' : typeof error === 'string' ? error : '방에 연결할 수 없습니다.'}</span><Button variant="outline" size="sm" onClick={() => void refresh()}><RefreshCw size={14} />다시 확인</Button><LinkButton href={`/viewer/login?returnTo=${encodeURIComponent(`/viewer/marble/play/${ownerId}`)}`} size="sm" variant="outline">로그인</LinkButton></div> : null}
    {mutation.error ? <div className={styles.error} role="alert"><span>{mutation.error}</span>{mutation.retry ? <Button size="sm" variant="outline" disabled={mutation.busy || mutation.offline} onClick={() => void mutation.send(mutation.retry!)}><RefreshCw size={14} />요청 결과 다시 확인</Button> : null}</div> : null}
    <Tabs.Root defaultValue="game">
      <Tabs.List className={styles.tabs} aria-label="온라인 주루마블"><Tabs.Trigger value="game"><Dice5 size={16} />게임</Tabs.Trigger><Tabs.Trigger value="participation"><Settings2 size={16} />내 시청자 참여</Tabs.Trigger><Tabs.Trigger value="invitations"><UsersRound size={16} />초대·참여 중인 방</Tabs.Trigger></Tabs.List>
      <Tabs.Content value="game" className={styles.tabPanel}>
        {snapshot?.viewerOverlay ? <section className={styles.section} aria-label="내 OBS 표시 방"><div className={styles.sectionHeading}><span><Monitor size={16} /> {snapshot.viewerOverlay.connected ? '내 OBS에 이 방 표시 중' : snapshot.viewerOverlay.ownerUserId ? `내 OBS: ${snapshot.viewerOverlay.roomTitle || '다른 방'}` : '내 OBS: 내 주루마블'}</span>{!snapshot.viewerOverlay.connected ? <Button size="sm" variant="outline" disabled={disabled} onClick={() => void mutation.send({ path: `${path}/overlay`, method: 'POST', snapshot: true, body: { requestId: crypto.randomUUID(), overlayRevision: snapshot.viewerOverlay!.revision } })}><Monitor size={15} />이 방을 내 OBS에 표시</Button> : null}</div></section> : null}
        {snapshot && display ? <div className={styles.gameGrid}><div className={styles.boardArea}><div className={styles.boardViewport}><MarbleStage snapshot={display} /></div><div className={styles.rosterSummary}>{snapshot.state.players.map(player => <span key={player.id}><MarbleProfile player={player} /><strong>{player.position}번</strong><MarblePlayerStatus snapshot={snapshot} playerId={player.id} /></span>)}</div></div><MarblePlayerControls snapshot={snapshot} playerId={playerId} disabled={disabled} onAction={action} /></div> : <div className={styles.loading} role="status">{error ? '참여 권한과 로그인 상태를 확인해 주세요.' : <><Loader2 className={styles.spin} size={22} />방에 연결 중</>}</div>}
      </Tabs.Content>
      <Tabs.Content value="participation" forceMount className={styles.tabPanel}>
        {snapshot?.viewerParticipation ? <MarbleParticipationEditor participation={snapshot.viewerParticipation} roomTitle={snapshot.state.settings.title} playerName={snapshot.state.players.find(player => player.id === playerId)?.name || '내 말'} disabled={disabled} onSave={(draft, success, conflict) => {
          void mutation.send({ path: `${path}/participation`, method: 'PUT', snapshot: true, body: { requestId: crypto.randomUUID(), participationRevision: draft.revision, connected: draft.connected, settings: draft.settings }, success, conflict });
        }} /> : <p className={styles.muted}>참여 설정을 불러오는 중입니다.</p>}
      </Tabs.Content>
      <Tabs.Content value="invitations" forceMount className={styles.tabPanel}><MarbleInvitations /></Tabs.Content>
    </Tabs.Root>
    <Dialog.Root open={leaving} onOpenChange={open => { if (!mutation.busy) setLeaving(open); }}><Dialog.Portal><Dialog.Overlay className={styles.dialogOverlay} /><Dialog.Content className={styles.dialog}>
      <Dialog.Title className={styles.dialogTitle}>이 방의 참여를 종료할까요?</Dialog.Title>
      <Dialog.Description className={styles.dialogDescription}>내 말과 진행 중인 미션, 남은 후원 예약 {snapshot?.viewerDonationQueueCount || 0}건을 삭제합니다. 외부 후원 금액은 환불되지 않습니다. {snapshot?.viewerOverlay?.connected ? '내 OBS는 내 판으로 돌아갑니다.' : '현재 선택한 OBS 방은 유지됩니다.'} 개인 배치와 시청자 참여 설정은 보존되며, 다시 참여하려면 새 초대가 필요합니다.</Dialog.Description>
      {mutation.error ? <div role="alert" className={styles.warning}><p>{mutation.error}</p>{mutation.retry ? <Button size="sm" variant="outline" disabled={mutation.busy || mutation.offline} onClick={() => void mutation.send(mutation.retry!)}><RefreshCw size={14} />요청 결과 다시 확인</Button> : null}</div> : null}
      <div className={styles.dialogActions}><Button variant="ghost" disabled={mutation.busy} onClick={() => setLeaving(false)}>취소</Button><Button variant="destructive" disabled={disabled || !snapshot?.actorInvitationId} onClick={() => void mutation.send({ path: `${path}/leave`, method: 'POST', body: { requestId: crypto.randomUUID(), invitationId: snapshot!.actorInvitationId }, success: () => { setLeaving(false); setLeft(true); } })}><LogOut size={16} />참여 종료</Button></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </main>;
}
