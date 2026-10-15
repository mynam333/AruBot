'use client';

import { ArrowDown, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, Check, Crown, Dice5, Flag, Move, Pause, Shield, Timer, Users, X } from 'lucide-react';
import { memo, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { MARBLE_SIZES, MARBLE_EVENT_LABELS, marbleBlockGeometry, marbleBoardLayout, marbleChallengeText, marbleContentIcon, marbleNextRoll, type MarbleBlock, type MarbleLayoutItem, type MarbleLayouts, type MarbleOrientation, type MarblePlayer, type MarbleSnapshot, type MarbleTimer } from '../../../shared/marble';
import { marbleCardMotion, marbleCompleteLabel, marbleMissionPage, marblePawnMotion, marblePawnPlacement, marbleTileRegions, marbleTravelEdge, paginateMarbleText } from './marble-presentation';
import { MarbleDiceScene } from './marble-dice';
import { MarbleTileArt } from './marble-tile-art';
import styles from './marble-stage.module.css';

// These exports are shared by the scoped layout editor, without a separate utility file.
/* eslint-disable react-refresh/only-export-components */
export { MARBLE_BLOCK_GEOMETRY, marbleBlockGeometry } from '../../../shared/marble';
export const MARBLE_STAGE_SIZES = MARBLE_SIZES;
export const MARBLE_STAGE_LABELS: Record<MarbleBlock, string> = { board: '게임 보드', dice: '주사위', timer: '타이머', card: '미션 카드', roster: '참가자 목록' };
export const MARBLE_STAGE_BLOCKS: MarbleBlock[] = ['board', 'dice', 'timer', 'card', 'roster'];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function constrainMarbleLayout(block: MarbleBlock, item: MarbleLayoutItem, orientation: MarbleOrientation): MarbleLayoutItem {
  const canvas = MARBLE_STAGE_SIZES[orientation];
  const base = marbleBlockGeometry(block, orientation);
  const heightFactor = canvas.width / canvas.height * base.height / base.width;
  const width = clamp(Number.isFinite(item.width) ? item.width : 25, 8, Math.min(100, 100 / heightFactor));
  return { ...item, width, x: clamp(Number.isFinite(item.x) ? item.x : 0, 0, 100 - width), y: clamp(Number.isFinite(item.y) ? item.y : 0, 0, 100 - width * heightFactor) };
}

function useMotionPreference() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function useServerClock(snapshot: MarbleSnapshot, reduced: boolean) {
  const [clock, setClock] = useState({ snapshot, now: snapshot.serverNow });
  useEffect(() => {
    const started = performance.now();
    let frame = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      cancelAnimationFrame(frame); clearTimeout(timeout);
      if (document.hidden) return;
      const state = snapshot.state;
      const now = state.status === 'paused' ? state.pausedAt ?? snapshot.serverNow : snapshot.serverNow + performance.now() - started;
      setClock({ snapshot, now });
      if (state.status !== 'running') return;
      const rolls = Object.values(state.playerStates ?? {}).flatMap(player => [player.lastRoll, player.pending?.challenge?.roll]).concat(state.lastRoll);
      const moving = !reduced && state.status === 'running' && rolls.some(roll => roll && now < roll.endsAt + 1000);
      if (moving) frame = requestAnimationFrame(tick);
      else timeout = setTimeout(tick, 100);
    };
    tick();
    document.addEventListener('visibilitychange', tick);
    return () => { cancelAnimationFrame(frame); clearTimeout(timeout); document.removeEventListener('visibilitychange', tick); };
  }, [snapshot, reduced]);
  return snapshot.state.status === 'paused' ? snapshot.state.pausedAt ?? snapshot.serverNow : clock.snapshot === snapshot ? clock.now : snapshot.serverNow;
}

const FitText = memo(function FitText({ children, className, max = 24, min = 11 }: { children: string; className?: string; max?: number; min?: number }) {
  const root = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const box = root.current;
    const content = text.current;
    if (!box || !content) return;
    const fit = () => {
      let size = max;
      content.style.fontSize = `${size}px`;
      while (size > min && (content.scrollWidth > box.clientWidth + 1 || content.scrollHeight > box.clientHeight + 1)) {
        size -= 1; content.style.fontSize = `${size}px`;
      }
    };
    const observer = new ResizeObserver(fit);
    observer.observe(box); fit();
    return () => observer.disconnect();
  }, [children, max, min]);
  return <div ref={root} className={`${styles.fitText} ${className ?? ''}`} title={children}><span ref={text} style={{ fontSize: max }}>{children}</span></div>;
});

function MissionText({ text, now, readyAt }: { text: string; now: number; readyAt: number }) {
  const viewport = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<{ text: string; pages: string[]; fontSize: number }>({ text: '', pages: [], fontSize: 24 });
  useEffect(() => {
    const box = viewport.current;
    const sample = probe.current;
    if (!box || !sample) return;
    let active = true;
    const measure = () => {
      if (!active || box.clientWidth < 1 || box.clientHeight < 1) return;
      const fits = (page: string) => { sample.textContent = page; return sample.scrollHeight <= box.clientHeight && sample.scrollWidth <= box.clientWidth; };
      let fontSize = 25;
      for (; fontSize >= 22; fontSize -= 1) {
        sample.style.fontSize = `${fontSize}px`;
        if (fits(text)) break;
      }
      if (fontSize < 22) fontSize = 24;
      sample.style.fontSize = `${fontSize}px`;
      const pages = paginateMarbleText(text, fits);
      setMeasured({ text, pages, fontSize });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(box); measure();
    void document.fonts.ready.then(measure);
    document.fonts.addEventListener('loadingdone', measure);
    return () => { active = false; observer.disconnect(); document.fonts.removeEventListener('loadingdone', measure); };
  }, [text]);
  const pages = measured.text === text ? measured.pages : [];
  const index = marbleMissionPage(now, readyAt, pages.length);
  return <div className={styles.missionText} role="note" aria-label={text} data-mission-pages={pages.length} data-mission-page={index + 1}>
    <div ref={viewport} className={styles.missionViewport}>
      <div key={`${text}-${index}`} className={styles.missionPageText} style={{ fontSize: measured.fontSize }} aria-hidden="true">{pages[index] ?? ''}</div>
      <div ref={probe} className={styles.missionProbe} aria-hidden="true" />
    </div>
    {pages.length > 1 ? <span className={styles.missionPageNumber} aria-hidden="true">{index + 1} / {pages.length}</span> : null}
  </div>;
}

function profileImage(url: string | null | undefined) {
  if (!url) return null;
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : null; } catch { return null; }
}

const Avatar = memo(function Avatar({ player }: { player: MarblePlayer }) {
  const url = profileImage(player.avatarUrl);
  const [failed, setFailed] = useState<string | null>(null);
  return <span className={styles.avatar} style={{ '--player-color': player.color } as CSSProperties}>
    <span className={styles.initial}>{Array.from(player.name.trim())[0] || 'P'}</span>
    {url && failed !== url ? <img src={url} alt="" referrerPolicy="no-referrer" draggable={false} decoding="async" onError={() => setFailed(url)} /> : null}
  </span>;
});


const travelIcons = { left: ArrowLeft, up: ArrowUp, right: ArrowRight, down: ArrowDown };

function Board({ snapshot, now, reduced, orientation }: { snapshot: MarbleSnapshot; now: number; reduced: boolean; orientation: MarbleOrientation }) {
  const state = snapshot.state;
  const tiles = state.settings.tiles;
  const board = marbleBoardLayout(tiles.length, orientation);
  const focused = state.players.find(player => player.id === state.currentPlayerId) ?? state.players[0];
  const focusRoll = focused ? state.playerStates?.[focused.id]?.lastRoll ?? (focused.id === state.currentPlayerId ? state.lastRoll : null) : null;
  const focusPose = focused ? marblePawnMotion(focusRoll, focused.position, now, reduced) : null;
  const arrivals = !reduced && focusRoll && now >= focusRoll.endsAt && now < focusRoll.endsAt + 560;
  const poses = state.players.map(player => {
    const roll = state.playerStates?.[player.id]?.lastRoll ?? (player.id === state.currentPlayerId ? state.lastRoll : null);
    return { player, pose: marblePawnMotion(roll, player.position, now, reduced) };
  });
  return <div className={styles.board} style={{ width: board.width, height: board.height }} aria-label={`${tiles.length}칸 게임 보드`}>
    {tiles.map((tile, index) => {
      const point = board.slots[index];
      const next = board.slots[(index + 1) % tiles.length];
      const direction = marbleTravelEdge(point, next);
      const DirectionIcon = travelIcons[direction];
      const regions = marbleTileRegions(point.width, point.height);
      const icon = marbleContentIcon(tile, index);
      const active = !!focusPose && focusPose.to === index;
      const occupied = poses.some(item => item.pose.to === index);
      const golden = tile.effects.some(effect => effect.type === 'card');
      const corner = (point.x < board.cellWidth / 2 || point.x + point.width > board.width - board.cellWidth / 2)
        && (point.y < board.cellHeight / 2 || point.y + point.height > board.height - board.cellHeight / 2);
      const trail = !!focusPose?.moving && !!focusRoll?.path.slice(Math.max(0, focusPose.step - 2), focusPose.step).includes(index);
      return <div key={tile.id} className={styles.tile} data-tile-index={index} data-active={active} data-moving={active && focusPose?.moving}
        data-arrived={active && !!arrivals} data-corner={corner} data-golden={golden} data-occupied={occupied} data-trail={trail}
        style={{ left: point.x + 3, top: point.y + 3, width: point.width - 6, height: point.height - 6,
          '--tile-color': tile.color, '--title-x': `${regions.title.x - 3}px`, '--title-y': `${regions.title.y - 3}px`,
          '--title-width': `${regions.title.width}px`, '--title-height': `${regions.title.height}px`,
          '--symbol-top': `${regions.pawns.y + regions.pawns.height / 2 - 3}px`,
          '--symbol-size': `${Math.min(100, regions.pawns.height * .92, point.width * .58)}px`,
          '--arrival-opacity': arrivals && active ? 1 - (now - focusRoll.endsAt) / 560 : 0 } as CSSProperties}
        title={`${index}번: ${tile.title}\n${tile.text}`}>
        <div className={styles.tileBand} />
        <div className={styles.tileMeta}><span>{String(index).padStart(2, '0')}</span></div>
        <div className={styles.tileDirection} data-direction={direction} aria-hidden="true"><DirectionIcon /></div>
        <div className={styles.tileSymbol} data-icon={icon} aria-hidden="true"><MarbleTileArt kind={icon} /></div>
        <FitText className={styles.tileTitle} max={tiles.length > 28 ? 28 : orientation === 'portrait' ? 36 : 32} min={16}>{tile.title}</FitText>
        {active && arrivals ? <span className={styles.landingFrame} aria-hidden="true" /> : null}
      </div>;
    })}
    {poses.map(({ player, pose }) => {
      const from = board.slots[pose.from];
      const to = board.slots[pose.to];
      const occupants = poses.filter(other => other.pose.to === pose.to);
      const order = occupants.findIndex(other => other.player.id === player.id);
      const origin = marblePawnPlacement(from.width, from.height, occupants.length, order);
      const destination = marblePawnPlacement(to.width, to.height, occupants.length, order);
      const lift = Math.max(0, Math.min(pose.lift, origin.y - origin.size / 2 - 7, destination.y - destination.size / 2 - 7));
      const dx = to.x - from.x;
      const tilt = pose.tilt * (dx < 0 ? -1 : 1);
      const x = from.x + origin.x + (to.x + destination.x - from.x - origin.x) * pose.progress;
      const y = from.y + origin.y + (to.y + destination.y - from.y - origin.y) * pose.progress;
      const landing = pose.landing > 0 && pose.landing < 1;
      return <div key={player.id} className={styles.pawn} data-focused={player.id === focused?.id} data-crowded={occupants.length > 1}
        data-player-id={player.id} data-slot-index={pose.to} data-moving={pose.moving} aria-label={`${player.name}, ${pose.to}번 칸`} title={`${player.name}, ${pose.to}번 칸`}
        style={{ left: 0, top: 0, transform: `translate3d(${x}px, ${y - lift}px, 0) translate(-50%, -50%)`,
          '--pawn-size': `${destination.size}px`, '--player-color': player.color, zIndex: Math.round(y) + 10 } as CSSProperties}>
        {landing ? <span className={styles.pawnLanding} aria-hidden="true" style={{ opacity: (1 - pose.landing) * .6, transform: `scale(${1 + pose.landing * .5})` }} /> : null}
        <div className={styles.pawnBody} style={{ transform: `rotate(${tilt}deg) scale(${pose.scaleX}, ${pose.scaleY})` }}><Avatar player={player} /></div>
        <span className={styles.pawnName} title={player.name}>{player.name}</span>
        <span className={styles.pawnShadow} style={{ opacity: .23 - lift / 220, transform: `translateY(${lift}px) scale(${1 - lift / 110})` }} />
      </div>;
    })}
  </div>;
}


function remainingTime(timer: MarbleTimer | null, now: number, readyAt?: number) {
  if (!timer) return 0;
  if (timer.paused || timer.deadline === null) return Math.max(0, timer.remainingMs);
  return Math.max(0, Math.min(timer.durationMs, timer.deadline - Math.max(now, readyAt ?? now)));
}
function timeLabel(ms: number) { const seconds = Math.ceil(ms / 1000); return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`; }

type Drag = { pointer: number; clientX: number; clientY: number; block: MarbleBlock; original: MarbleLayoutItem; mode: 'move' | 'resize'; orientation: MarbleOrientation };

export type MarbleStageProps = {
  snapshot: MarbleSnapshot; layouts?: MarbleLayouts; orientation?: MarbleOrientation; editable?: boolean;
  onLayoutChange?: (layouts: MarbleLayouts) => void; selected?: MarbleBlock; onSelect?: (block: MarbleBlock) => void;
};

export function MarbleStage({ snapshot, layouts = snapshot.state.settings.layouts, orientation: forced, editable = false, onLayoutChange, selected, onSelect }: MarbleStageProps) {
  const root = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1920, height: 1080 });
  const drag = useRef<Drag | null>(null);
  const latestLayouts = useRef(layouts);
  latestLayouts.current = layouts;
  const reduced = useMotionPreference();
  const now = useServerClock(snapshot, reduced);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) => setViewport({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(root.current); return () => observer.disconnect();
  }, []);
  const orientation = forced ?? (viewport.width >= viewport.height ? 'landscape' : 'portrait');
  const canvas = MARBLE_STAGE_SIZES[orientation];
  const zoom = Math.max(.001, Math.min(viewport.width / canvas.width, viewport.height / canvas.height));
  const state = snapshot.state;
  const player = state.players.find(item => item.id === state.currentPlayerId) ?? state.players[0];
  const playerState = player ? state.playerStates?.[player.id] : null;
  const movementRoll = playerState?.lastRoll ?? state.lastRoll;
  const pending = playerState?.pending ?? state.pending;
  const challenge = pending?.challenge;
  const roll = challenge?.roll ?? movementRoll;
  const challengeRolling = !!challenge?.roll && now < challenge.roll.endsAt;
  const goldenCard = pending?.cardId ? state.settings.cards.find(card => card.id === pending.cardId) : null;
  const landingTile = pending ? state.settings.tiles.find(tile => tile.id === pending.tileId) : null;
  const goldenOnly = !!goldenCard && landingTile?.effects.length === 1 && landingTile.effects[0].type === 'card';
  const missionText = challenge ? marbleChallengeText(challenge.outcome ? pending.text : [challenge.missionText, `성공: ${challenge.success.text}`, `실패: ${challenge.failure.text}`].join('\n'), challengeRolling ? null : challenge)
    : goldenOnly ? [...new Set([goldenCard.text, landingTile.effects[0].text, ...(pending?.effects.map(effect => effect.text) ?? [])].filter(Boolean))].join('\n') : pending?.text ?? '';
  const followup = marbleNextRoll(pending);
  const eventLabel = goldenCard?.eventKind ? MARBLE_EVENT_LABELS[goldenCard.eventKind] : '특별 이벤트';
  const shieldDelta = pending?.shieldDelta;
  const timer = playerState?.timer ?? state.timer;
  const rolling = !!roll && !reduced && now < roll.startedAt + roll.diceDurationMs * .82;
  const dice = roll?.dice ?? (state.settings.diceCount === 2 ? [1, 1] : [1]);
  const progress = !roll || reduced ? 1 : clamp((now - roll.startedAt) / Math.max(1, roll.diceDurationMs), 0, 1);
  const missionReady = !!pending && now >= pending.readyAt;
  const cardMotion = marbleCardMotion(now, pending?.readyAt ?? now, !!pending?.cardId, reduced);
  const reveal = !!pending && cardMotion.revealed;
  const pose = marblePawnMotion(movementRoll, player?.position ?? 0, now, reduced);
  const paused = state.status === 'paused';
  const travelLabel = roll?.direction === -1 ? '후진' : roll?.direction === 1 ? '전진' : '이동';
  const phaseLabel = paused ? '일시정지' : rolling ? challenge?.roll ? '미션 주사위' : roll?.direction ? `${travelLabel} 주사위` : '굴리는 중' : pose.moving ? `${Math.min(pose.step + 1, pose.steps)} / ${pose.steps}칸 ${travelLabel}` : pending && !missionReady ? '이동 대기' : challenge?.outcome ? challenge.outcome === 'success' ? '미션 성공' : '미션 실패' : challenge?.roll ? '미션 주사위 결과' : pending ? pending.cardId ? '이벤트 진행' : '미션 진행' : state.status === 'finished' ? '종료' : '준비';
  const remaining = remainingTime(timer, now, pending?.readyAt);
  const label = player?.name ?? '플레이어';
  const updateLayout = (block: MarbleBlock, patch: Partial<MarbleLayoutItem>) => {
    if (!editable) return;
    const current = latestLayouts.current;
    const next = { ...current, [orientation]: { ...current[orientation], [block]: constrainMarbleLayout(block, { ...current[orientation][block], ...patch }, orientation) } };
    latestLayouts.current = next; onLayoutChange?.(next);
  };
  const begin = (event: PointerEvent<HTMLElement>, block: MarbleBlock, mode: 'move' | 'resize') => {
    if (!editable || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus(); onSelect?.(block);
    drag.current = { pointer: event.pointerId, clientX: event.clientX, clientY: event.clientY, block, original: constrainMarbleLayout(block, latestLayouts.current[orientation][block], orientation), mode, orientation };
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || !editable || current.pointer !== event.pointerId || current.orientation !== orientation) return;
    const dx = (event.clientX - current.clientX) / zoom / canvas.width * 100;
    const dy = (event.clientY - current.clientY) / zoom / canvas.height * 100;
    if (current.mode === 'move') updateLayout(current.block, { x: current.original.x + dx, y: current.original.y + dy });
    else {
      const shape = marbleBlockGeometry(current.block, orientation);
      const factor = canvas.width / canvas.height * shape.height / shape.width;
      const change = Math.abs(dx) >= Math.abs(dy / factor) ? dx : dy / factor;
      updateLayout(current.block, { width: clamp(current.original.width + change, 8, Math.min(100 - current.original.x, (100 - current.original.y) / factor)) });
    }
  };
  const end = () => { drag.current = null; };
  const keyboard = (event: KeyboardEvent<HTMLElement>, block: MarbleBlock, resize = false) => {
    if (!editable || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { if (drag.current) updateLayout(block, drag.current.original); end(); return; }
    onSelect?.(block);
    const value = constrainMarbleLayout(block, latestLayouts.current[orientation][block], orientation);
    const step = event.shiftKey ? 10 : 1;
    if (resize) updateLayout(block, { width: value.width + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -step : step) / canvas.width * 100 });
    else updateLayout(block, { x: value.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0) / canvas.width * 100, y: value.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) / canvas.height * 100 });
  };
  const block = (id: MarbleBlock, content: ReactNode) => {
    const item = constrainMarbleLayout(id, layouts[orientation][id], orientation);
    if (!editable && (!item.visible || id === 'roster' && state.players.length <= 1 || id === 'timer' && !timer || id === 'card' && !pending)) return null;
    const shape = marbleBlockGeometry(id, orientation);
    const width = canvas.width * item.width / 100;
    return <section key={id} className={styles.block} data-block={id} data-selected={editable && selected === id} data-editable={editable} data-hidden={!item.visible}
      aria-label={MARBLE_STAGE_LABELS[id]} tabIndex={editable ? 0 : undefined} title={editable ? '드래그 이동 · 방향키 1px · Shift + 방향키 10px' : undefined}
      onPointerDown={event => begin(event, id, 'move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onKeyDown={event => keyboard(event, id)}
      onFocus={editable ? () => onSelect?.(id) : undefined}
      style={{ left: item.x / 100 * canvas.width, top: item.y / 100 * canvas.height, width, height: width * shape.height / shape.width }}>
      <div className={styles.blockContent} style={{ width: shape.width, height: shape.height, transform: `scale(${width / shape.width})` }}>{content}</div>
      {editable ? <><span className={styles.blockLabel}><Move />{MARBLE_STAGE_LABELS[id]}</span><button className={styles.resizeHandle} type="button" title="크기 조절" aria-label={`${MARBLE_STAGE_LABELS[id]} 크기 조절`} onPointerDown={event => begin(event, id, 'resize')} onKeyDown={event => keyboard(event, id, true)}><ArrowDownRight /></button></> : null}
    </section>;
  };
  return <div ref={root} className={styles.viewport} data-orientation={orientation} data-reduced-motion={reduced} data-paused={paused} style={forced ? { aspectRatio: `${canvas.width} / ${canvas.height}` } : undefined}>
    <div className={styles.stage} style={{ width: canvas.width, height: canvas.height, left: (viewport.width - canvas.width * zoom) / 2, top: (viewport.height - canvas.height * zoom) / 2, transform: `scale(${zoom})` }}>
      {block('board', <Board snapshot={snapshot} now={now} reduced={reduced} orientation={orientation} />)}
      {block('dice', <div className={styles.diceBlock} data-mission-roll={!!challenge?.roll} data-phase={paused ? 'paused' : rolling ? 'rolling' : pose.moving ? 'moving' : 'ready'}><header className={styles.blockHeading}>{player ? <Avatar player={player} /> : <Dice5 />}<FitText max={26} min={16}>{label}</FitText>{paused ? <Pause /> : <Dice5 />}</header>
        <MarbleDiceScene dice={dice} progress={progress} seed={roll?.id ?? 'ready'} reduced={reduced} />
        <div className={styles.diceResult} aria-label={roll && !rolling ? `주사위 합계 ${dice.reduce((sum, value) => sum + value, 0)}` : '주사위 대기'}>{!rolling && roll ? <b>{dice.reduce((sum, value) => sum + value, 0)}</b> : <Dice5 />}<span>{phaseLabel}</span>{!rolling && dice.length > 1 ? <small>{dice.join(' + ')}</small> : null}</div>
      </div>)}
      {block('timer', <div className={styles.timerBlock} data-expired={!!timer && remaining === 0} data-urgent={!!timer && remaining > 0 && remaining <= 10000 && missionReady && !paused && !timer.paused}>
        <header className={styles.blockHeading}><Timer /><span>{paused || timer?.paused ? '일시정지' : timer && !missionReady ? '미션 대기' : timer && remaining === 0 ? '시간 종료' : '남은 시간'}</span></header>
        <div className={styles.timerDigits}>{timer ? timeLabel(remaining) : '--:--'}{state.status === 'paused' || timer?.paused ? <Pause /> : null}</div>
        <div className={styles.timerTrack} role="progressbar" aria-label="미션 남은 시간" aria-valuemin={0} aria-valuemax={timer ? Math.ceil(timer.durationMs / 1000) : 1} aria-valuenow={Math.ceil(remaining / 1000)}><span style={{ width: `${timer ? clamp(remaining / Math.max(1, timer.durationMs) * 100, 0, 100) : 0}%` }} /></div>
      </div>)}
      {block('card', <div className={styles.cardScene} data-revealed={reveal} data-golden={!!pending?.cardId} data-outcome={challenge?.outcome} style={{ '--mission-color': pending?.color ?? '#d4a332' } as CSSProperties}>
        <div className={styles.cardRotor} style={{ transform: `translateY(${-cardMotion.lift}px) rotateY(${pending?.cardId ? cardMotion.rotation : 0}deg)` }}>
        <div className={styles.mission} data-golden={!!pending?.cardId} aria-hidden={!reveal && !!pending?.cardId}>
        <header className={styles.blockHeading}>{challenge?.outcome ? challenge.outcome === 'success' ? <Check /> : <X /> : pending?.cardId ? <Crown /> : <Flag />}<span>{challenge?.outcome ? challenge.outcome === 'success' ? '성공 · 보상' : '실패 · 벌칙' : challenge ? '황금 미션' : pending?.cardId ? '황금 이벤트' : '미션'}</span><FitText max={22} min={15}>{label}</FitText></header>
        {pending && (reveal || pending.cardId) ? <div className={styles.missionContent}><div className={styles.missionTitleRow}>{goldenCard ? <MarbleTileArt kind={marbleContentIcon(goldenCard)} /> : null}<FitText className={styles.missionTitle} max={34} min={20}>{goldenOnly ? goldenCard.title : pending.title}</FitText></div><MissionText text={missionText} now={now} readyAt={challenge?.resolvedAt ?? challenge?.roll?.endsAt ?? pending.readyAt + (pending.cardId ? 820 : 320)} />
          <footer className={styles.missionFooter}>{followup ? <><Dice5 />{marbleCompleteLabel(followup)}</> : challenge ? <><Crown />{challenge.outcome ? '결과 확인 중' : challengeRolling ? '미션 주사위 굴리는 중' : challenge.rollDice && !challenge.roll ? '미션 주사위 대기' : '성공·실패 판정 대기'}</> : pending.cardId ? <><Crown />{eventLabel}</> : <><Flag />{roll?.to ?? player?.position ?? 0}번 칸</>}{shieldDelta !== undefined ? <span data-shield-loss={shieldDelta < 0}><Shield />방어권 {shieldDelta === 0 ? '변동 없음' : `${shieldDelta > 0 ? '+' : ''}${shieldDelta}`}</span> : timer ? <span><Timer />{timeLabel(remaining)}</span> : null}</footer></div>
          : <div className={styles.cardBack}><div className={styles.cardSeal}>{pending?.cardId ? <Crown /> : <Flag />}</div><strong>{pending ? '곧 공개됩니다' : state.status === 'finished' ? '플레이 종료' : '오늘의 첫 미션'}</strong><span>{pending ? '도착 후 미션 공개' : state.status === 'finished' ? '함께한 시간을 기억해요' : '미션 대기 중'}</span></div>}
        {pending?.cardId && cardMotion.sheen > 0 ? <span className={styles.cardSheen} aria-hidden="true" style={{ transform: `translateX(${-150 + cardMotion.sheen * 350}%) skewX(-18deg)`, opacity: Math.sin(cardMotion.sheen * Math.PI) * .5 }} /> : null}
        </div>
        {pending?.cardId ? <div className={styles.goldenBack} aria-hidden={reveal}><MarbleTileArt kind="card" /><strong>황금 카드</strong><b>특별 이벤트</b><span>{missionReady ? '오늘의 이벤트 공개' : '도착 후 공개'}</span></div> : null}
        </div>
      </div>)}
      {block('roster', <div className={styles.roster}><header className={styles.blockHeading}><Users /><span>함께 플레이</span><b>{state.players.length}</b></header><div className={styles.rosterGrid}>
        {state.players.map(item => {
          const own = state.playerStates?.[item.id];
          const ownRoll = own?.lastRoll;
          const moving = !!ownRoll && now < ownRoll.endsAt;
          const pose = marblePawnMotion(ownRoll, item.position, now, reduced);
          return <div className={styles.rosterPlayer} key={item.id} data-focused={item.id === player?.id} style={{ '--player-color': item.color } as CSSProperties}><Avatar player={item} /><div><FitText max={17} min={11}>{item.name}</FitText><span>{state.status === 'paused' ? '일시정지' : moving ? '이동 중' : own?.timer ? timeLabel(remainingTime(own.timer, now, own.pending?.readyAt)) : own?.pending ? '미션 중' : '준비'}<b>{pose.to}번</b></span></div>{item.shields > 0 ? <span className={styles.playerShield} title={`방어권 ${item.shields}개`}><Shield />{item.shields}</span> : null}</div>;
        })}
      </div></div>)}
    </div>
  </div>;
}
