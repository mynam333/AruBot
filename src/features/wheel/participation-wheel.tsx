'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, UsersRound } from 'lucide-react';
import { buildWheelSegments, entryAtSlot, normalizeDegrees, spinFrame, wheelTimeMs, type WheelSegment } from './wheel-motion';
import type { WheelEntry, WheelSpin, WheelTheme } from './types';
import styles from './participation-wheel.module.css';

export interface ParticipationWheelProps {
  entries: WheelEntry[];
  spin: WheelSpin | null;
  /** Server Unix time (ms), refreshed with each received state response. */
  serverNow?: number;
  theme?: WheelTheme;
  onComplete?: (spinId: string) => void;
  sound?: boolean;
  compact?: boolean;
}

const TAU = Math.PI * 2;
const SIZE = 720;
const CENTER = SIZE / 2;
const RADIUS = 350;
const FONT = 'Pretendard, "Pretendard Variable", "Noto Sans KR", system-ui, sans-serif';
const PALETTES: Record<WheelTheme, readonly string[]> = {
  festival: ['#259d92', '#f58b79', '#f3c65c', '#79b4ed', '#80c8a5', '#df9bac', '#56becb', '#eba45f'],
  studio: ['#90c6bb', '#e5a397', '#e2c978', '#96b6d9', '#b1c99b', '#d4adc5', '#8fc6cd', '#d9b38c'],
  midnight: ['#35afa2', '#ed8f80', '#eac35d', '#81afe7', '#85bf98', '#d998b5', '#69bccb', '#dfa26d'],
};

function fitLabel(context: CanvasRenderingContext2D, label: string, width: number) {
  const clean = label.replace(/\s+/g, ' ').trim();
  if (context.measureText(clean).width <= width) return clean;
  const characters = Array.from(clean);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (context.measureText(`${characters.slice(0, middle).join('')}\u2026`).width <= width) low = middle;
    else high = middle - 1;
  }
  return low ? `${characters.slice(0, low).join('')}\u2026` : '';
}

function slicePath(context: CanvasRenderingContext2D, start: number, end: number, radius = RADIUS) {
  context.beginPath();
  context.moveTo(CENTER, CENTER);
  context.arc(CENTER, CENTER, radius, start, end);
  context.closePath();
}

function drawWheel(
  canvas: HTMLCanvasElement,
  segments: readonly WheelSegment[],
  totalSlots: number,
  theme: WheelTheme,
  cssSize: number,
  pixelRatio: number,
  selectedSlot: number | null,
  rotation: number,
) {
  const pixels = Math.min(2560, Math.max(1, Math.round(cssSize * pixelRatio)));
  if (canvas.width !== pixels || canvas.height !== pixels) {
    canvas.width = pixels;
    canvas.height = pixels;
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(pixels / SIZE, 0, 0, pixels / SIZE, 0, 0);
  context.clearRect(0, 0, SIZE, SIZE);
  const palette = PALETTES[theme];
  const winner = selectedSlot === null ? undefined : entryAtSlot(segments, selectedSlot);

  if (!totalSlots) {
    for (let index = 0; index < 8; index++) {
      slicePath(context, index * TAU / 8 - Math.PI / 2, (index + 1) * TAU / 8 - Math.PI / 2);
      context.globalAlpha = theme === 'midnight' ? 0.24 : 0.2;
      context.fillStyle = palette[index];
      context.fill();
      context.globalAlpha = 1;
      context.strokeStyle = theme === 'midnight' ? '#252927' : '#ffffff';
      context.lineWidth = 2;
      context.stroke();
    }
    return;
  }

  for (const segment of segments) {
    const start = segment.startSlot / totalSlots * TAU - Math.PI / 2;
    const end = (segment.startSlot + segment.slots) / totalSlots * TAU - Math.PI / 2;
    const color = Math.abs(Math.trunc(segment.entry.colorIndex) || 0) % palette.length;
    slicePath(context, start, end);
    context.fillStyle = palette[color];
    context.fill();
    if (winner && segment.entry.id !== winner.id) {
      context.fillStyle = theme === 'midnight' ? 'rgba(20, 26, 24, 0.28)' : 'rgba(255, 255, 255, 0.28)';
      context.fill();
    }
  }

  // Slot marks preserve the lottery's true resolution without rendering 1,000 labels.
  const markStride = Math.max(1, Math.ceil(totalSlots / 1000));
  context.lineWidth = totalSlots > 180 ? 0.7 : 1.4;
  context.strokeStyle = 'rgba(24, 48, 43, 0.35)';
  context.beginPath();
  for (let slot = 0; slot < totalSlots; slot += markStride) {
    const angle = slot / totalSlots * TAU - Math.PI / 2;
    context.moveTo(CENTER + Math.cos(angle) * (RADIUS - 9), CENTER + Math.sin(angle) * (RADIUS - 9));
    context.lineTo(CENTER + Math.cos(angle) * RADIUS, CENTER + Math.sin(angle) * RADIUS);
  }
  context.stroke();

  context.lineWidth = segments.length > 100 ? 0.55 : 2;
  context.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  context.beginPath();
  if (segments.length > 1) for (const segment of segments) {
    const angle = segment.startSlot / totalSlots * TAU - Math.PI / 2;
    context.moveTo(CENTER + Math.cos(angle) * 65, CENTER + Math.sin(angle) * 65);
    context.lineTo(CENTER + Math.cos(angle) * (RADIUS - 11), CENTER + Math.sin(angle) * (RADIUS - 11));
  }
  context.stroke();

  const baseFontSize = Math.min(32, Math.max(21, 12 * SIZE / Math.max(1, cssSize)));
  let labelsDrawn = 0;
  for (const segment of segments) {
    if (labelsDrawn >= 40) break;
    const span = segment.slots / totalSlots * TAU;
    const middle = (segment.startSlot + segment.slots / 2) / totalSlots * TAU - Math.PI / 2;
    const fontSize = Math.min(baseFontSize, span * RADIUS * 0.34 / 1.3);
    if (fontSize * cssSize / SIZE < 11.5) continue;
    labelsDrawn++;
    const isSingle = segments.length === 1;
    const labelAngle = isSingle ? -Math.PI / 2 : middle;
    const displayAngle = normalizeDegrees(labelAngle * 180 / Math.PI + rotation);
    const flip = displayAngle > 90 && displayAngle < 270;
    context.save();
    context.translate(CENTER + Math.cos(labelAngle) * RADIUS * 0.62, CENTER + Math.sin(labelAngle) * RADIUS * 0.62);
    context.rotate(isSingle ? -rotation * Math.PI / 180 : labelAngle + (flip ? Math.PI : 0));
    context.font = `650 ${fontSize}px ${FONT}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#132f2d';
    const hasCount = segment.slots > 1 && span * RADIUS * 0.5 > fontSize * 3.4;
    context.fillText(fitLabel(context, segment.entry.label || segment.entry.username, RADIUS * 0.57), 0, hasCount ? -fontSize * 0.4 : 0);
    if (hasCount) {
      context.font = `550 ${fontSize * 0.63}px ${FONT}`;
      context.fillText(`${segment.slots.toLocaleString('ko-KR')}\uad8c`, 0, fontSize * 0.65);
    }
    context.restore();
  }

  context.beginPath();
  context.arc(CENTER, CENTER, RADIUS - 14, 0, TAU);
  context.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  context.lineWidth = 1;
  context.stroke();

  if (selectedSlot !== null) {
    const selected = segments.find((segment) => selectedSlot >= segment.startSlot && selectedSlot < segment.startSlot + segment.slots);
    if (selected) {
      context.beginPath();
      context.arc(CENTER, CENTER, RADIUS - 5, selected.startSlot / totalSlots * TAU - Math.PI / 2, (selected.startSlot + selected.slots) / totalSlots * TAU - Math.PI / 2);
      context.strokeStyle = '#fff8d5';
      context.lineWidth = 8;
      context.stroke();
    }
    const centerAngle = (selectedSlot + 0.5) / totalSlots * TAU - Math.PI / 2;
    context.beginPath();
    context.moveTo(CENTER + Math.cos(centerAngle) * (RADIUS - 21), CENTER + Math.sin(centerAngle) * (RADIUS - 21));
    context.lineTo(CENTER + Math.cos(centerAngle) * (RADIUS - 48), CENTER + Math.sin(centerAngle) * (RADIUS - 48));
    context.strokeStyle = '#173b32';
    context.lineWidth = 7;
    context.lineCap = 'round';
    context.stroke();
    context.strokeStyle = '#fff8d5';
    context.lineWidth = 3;
    context.stroke();
    context.lineCap = 'butt';
  }
}

export function ParticipationWheel({ entries, spin, serverNow, theme = 'festival', onComplete, sound = false, compact = false }: ParticipationWheelProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const rotorRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef<HTMLDivElement>(null);
  const completionRef = useRef(onComplete);
  const completedIds = useRef(new Set<string>());
  const clockRef = useRef<{ server: number; local: number } | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const soundRef = useRef(sound);
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null);
  const [settledId, setSettledId] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ size: 0, dpr: 1 });

  // Value-stable snapshots avoid restarting effects when polling returns new object identities.
  const spinValue = spin ? JSON.stringify(spin) : 'null';
  const snapshot = useMemo(() => JSON.parse(spinValue) as WheelSpin | null, [spinValue]);
  const entriesValue = JSON.stringify(snapshot?.entries ?? entries);
  const geometry = useMemo(() => buildWheelSegments(JSON.parse(entriesValue) as WheelEntry[]), [entriesValue]);
  const validSpin = snapshot && geometry.totalSlots === snapshot.totalSlots
    && Number.isFinite(wheelTimeMs(snapshot.startedAt)) && Number.isFinite(snapshot.durationMs)
    && entryAtSlot(geometry.segments, snapshot.selectedSlot)?.id === snapshot.entryId ? snapshot : null;
  const settled = Boolean(validSpin && settledId === validSpin.id);

  useEffect(() => { completionRef.current = onComplete; }, [onComplete]);
  useEffect(() => { soundRef.current = sound; }, [sound]);
  useEffect(() => {
    clockRef.current = { server: Number.isFinite(serverNow) ? serverNow! : Date.now(), local: performance.now() };
  }, [serverNow]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let disposed = false;
    const measure = () => {
      const size = Math.round(stage.getBoundingClientRect().width * 0.91);
      const dpr = window.devicePixelRatio || 1;
      setDimensions((previous) => previous.size === size && previous.dpr === dpr ? previous : { size, dpr });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    window.addEventListener('resize', measure);
    let resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const updateDpr = () => {
      resolution.removeEventListener('change', updateDpr);
      resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      resolution.addEventListener('change', updateDpr);
      measure();
    };
    resolution.addEventListener('change', updateDpr);
    measure();
    // Repaint loaded webfont metrics once; no canvas work happens in the animation loop.
    void document.fonts?.ready.then(() => { if (!disposed) setDimensions((previous) => ({ ...previous })); });
    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener('resize', measure);
      resolution.removeEventListener('change', updateDpr);
    };
  }, []);

  useEffect(() => {
    if (!canvasRef.current || !dimensions.size) return;
    drawWheel(canvasRef.current, geometry.segments, geometry.totalSlots, theme, dimensions.size, dimensions.dpr,
      settled && validSpin ? validSpin.selectedSlot : null,
      settled && validSpin ? spinFrame(validSpin, wheelTimeMs(validSpin.startedAt) + Math.max(0, validSpin.durationMs)).rotation : 0);
  }, [geometry, theme, dimensions, settled, validSpin]);

  useEffect(() => {
    if (!sound) return;
    const unlock = () => {
      try {
        audioRef.current ??= new AudioContext();
        void audioRef.current.resume().catch(() => {});
      } catch { /* Audio is optional, including browsers that disallow playback. */ }
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      const audio = audioRef.current;
      audioRef.current = null;
      if (audio && audio.state !== 'closed') void audio.close().catch(() => {});
    };
  }, [sound]);

  useEffect(() => {
    const rotor = rotorRef.current;
    const pointer = pointerRef.current;
    if (!rotor || reducedMotion === null) return;
    if (!validSpin) {
      rotor.style.transform = 'rotate(0deg)';
      rotor.style.willChange = 'auto';
      setSettledId(null);
      return;
    }
    const currentSpin = validSpin;
    const startedAt = wheelTimeMs(currentSpin.startedAt);
    let frameId = 0;
    let timeoutId = 0;
    let lastBoundary: number | null = null;
    let lastTick = -Infinity;
    let lastElapsed = -Infinity;
    let pointerAnimation: Animation | undefined;
    let disposed = false;
    setSettledId(null);
    rotor.style.willChange = reducedMotion ? 'auto' : 'transform';

    const tick = (now: number) => {
      if (now - lastTick < 65 || reducedMotion) return;
      lastTick = now;
      pointerAnimation?.cancel();
      pointerAnimation = pointer?.animate([
        { transform: 'rotate(0deg)' }, { transform: 'rotate(-9deg)', offset: 0.24 }, { transform: 'rotate(0deg)' },
      ], { duration: 115, easing: 'ease-out' });
      const audio = audioRef.current;
      if (!soundRef.current || !audio || audio.state !== 'running') return;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(1150, audio.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(550, audio.currentTime + 0.018);
      gain.gain.setValueAtTime(0.018, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.028);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.03);
    };

    const renderFrame = () => {
      if (disposed) return;
      const localNow = performance.now();
      const clock = clockRef.current;
      const serverTime = clock ? clock.server + localNow - clock.local : Date.now();
      // Clock corrections may advance playback, but must never rewind a live wheel.
      const elapsed = Math.max(lastElapsed, serverTime - startedAt);
      lastElapsed = elapsed;
      const frame = spinFrame(currentSpin, startedAt + elapsed);
      const rotation = frame.finished ? normalizeDegrees(frame.rotation) : reducedMotion ? 0 : frame.rotation;
      rotor.style.transform = `rotate(${rotation}deg)`;
      const boundary = Math.floor(frame.rotation / 360 * currentSpin.totalSlots);
      if (!frame.finished && elapsed > 0 && lastBoundary !== null && boundary !== lastBoundary) tick(localNow);
      lastBoundary = boundary;
      if (frame.finished) {
        rotor.style.willChange = 'auto';
        pointerAnimation?.cancel();
        setSettledId(currentSpin.id);
        if (!completedIds.current.has(currentSpin.id)) {
          completedIds.current.add(currentSpin.id);
          completionRef.current?.(currentSpin.id);
        }
        return;
      }
      if (document.hidden || reducedMotion || elapsed < 0) {
        const remaining = Math.max(1, currentSpin.durationMs - elapsed);
        timeoutId = window.setTimeout(renderFrame, Math.min(remaining, 250));
      } else frameId = requestAnimationFrame(renderFrame);
    };
    const resume = () => {
      cancelAnimationFrame(frameId);
      clearTimeout(timeoutId);
      lastBoundary = null;
      renderFrame();
    };
    document.addEventListener('visibilitychange', resume);
    renderFrame();
    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(timeoutId);
      pointerAnimation?.cancel();
      document.removeEventListener('visibilitychange', resume);
      rotor.style.willChange = 'auto';
    };
  }, [validSpin, reducedMotion]);

  const phase = snapshot && !validSpin ? 'invalid' : settled ? 'settled' : validSpin ? 'spinning' : geometry.totalSlots ? 'ready' : 'empty';
  const accessibleLabel = phase === 'invalid' ? '추첨 정보를 확인할 수 없습니다.'
    : settled && validSpin ? `당첨: ${validSpin.label || validSpin.username}. ${geometry.totalSlots.toLocaleString('ko-KR')}개 참가권 중 ${validSpin.selectedSlot + 1}번.`
    : validSpin ? `추첨 중. 참가권 ${geometry.totalSlots.toLocaleString('ko-KR')}개.`
    : geometry.totalSlots ? `항목 ${geometry.segments.length.toLocaleString('ko-KR')}개, 총 ${geometry.totalSlots.toLocaleString('ko-KR')}칸.` : '참여 대기 중.';

  return (
    <div className={styles.stage} data-theme={theme} data-compact={compact || undefined} data-phase={phase} ref={stageRef}>
      <div className={styles.wheel} role="img" aria-label={accessibleLabel}>
        <div className={styles.rim} aria-hidden="true" />
        <div className={styles.rotor} ref={rotorRef} aria-hidden="true">
          <canvas className={styles.canvas} ref={canvasRef} width={720} height={720} />
        </div>
        <div className={styles.hub} aria-hidden="true">
          {settled ? <Check className={styles.hubIcon} strokeWidth={2.6} /> : !geometry.totalSlots ? <UsersRound className={styles.hubIcon} strokeWidth={1.7} /> : null}
          {!settled && geometry.totalSlots > 0 && <span className={styles.slotCount}>{geometry.totalSlots.toLocaleString('ko-KR')}</span>}
          <span className={styles.hubLabel}>{phase === 'invalid' ? '확인 필요' : settled ? '당첨' : validSpin ? '추첨 중' : geometry.totalSlots ? '참가권' : '참여 대기'}</span>
        </div>
        <div className={styles.pointerMount} aria-hidden="true">
          <div className={styles.pointer} ref={pointerRef}><span className={styles.pointerPin} /></div>
        </div>
      </div>
      <span className={styles.screenReader} role="status" aria-live="polite" aria-atomic="true">{accessibleLabel}</span>
    </div>
  );
}

export default ParticipationWheel;
