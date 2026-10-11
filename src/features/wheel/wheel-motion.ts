import type { WheelEntry, WheelSpin } from './types';

export interface WheelSegment {
  entry: WheelEntry;
  startSlot: number;
  slots: number;
}

export const normalizeDegrees = (degrees: number) => ((degrees % 360) + 360) % 360;

export const wheelTimeMs = (value: string | number) => typeof value === 'number' ? value : Date.parse(value);

export function buildWheelSegments(entries: readonly WheelEntry[]) {
  const segments: WheelSegment[] = [];
  let totalSlots = 0;
  for (const entry of entries) {
    const slots = Number.isSafeInteger(entry.slots) && entry.slots > 0 ? entry.slots : 0;
    if (!slots) continue;
    const previous = segments[segments.length - 1];
    if (previous?.entry.id === entry.id) previous.slots += slots;
    else segments.push({ entry, startSlot: totalSlots, slots });
    totalSlots += slots;
  }
  return { segments, totalSlots };
}

export function entryAtSlot(segments: readonly WheelSegment[], slot: number) {
  if (!Number.isInteger(slot) || slot < 0) return undefined;
  return segments.find((segment) => slot >= segment.startSlot && slot < segment.startSlot + segment.slots)?.entry;
}

export function slotAtPointer(rotation: number, totalSlots: number) {
  if (!Number.isInteger(totalSlots) || totalSlots <= 0) return -1;
  return Math.min(totalSlots - 1, Math.floor(normalizeDegrees(-rotation) / 360 * totalSlots));
}

export function finalWheelRotation(selectedSlot: number, totalSlots: number, turns: number) {
  if (!Number.isInteger(selectedSlot) || selectedSlot < 0 || selectedSlot >= totalSlots) return 0;
  const fullTurns = Number.isFinite(turns) ? Math.max(0, Math.floor(turns)) : 0;
  return fullTurns * 360 + normalizeDegrees(-(selectedSlot + 0.5) * 360 / totalSlots);
}

/** Integrated velocity: smooth acceleration, a short coast, then a long friction-like slowdown. */
export function wheelTravel(progress: number) {
  const t = Math.max(0, Math.min(1, progress));
  if (t === 0 || t === 1) return t;
  const acceleration = 0.12;
  const coastEnd = 0.2;
  const deceleration = 1 - coastEnd;
  const distance = acceleration / 2 + (coastEnd - acceleration) + deceleration * 0.4;
  if (t < acceleration) {
    const u = t / acceleration;
    return acceleration * (u ** 3 - 0.5 * u ** 4) / distance;
  }
  if (t < coastEnd) return (acceleration / 2 + t - acceleration) / distance;
  const u = (t - coastEnd) / deceleration;
  const integral = u - 2 * u ** 3 + 2 * u ** 4 - 0.6 * u ** 5;
  return Math.min(1, (acceleration / 2 + coastEnd - acceleration + deceleration * integral) / distance);
}

export function spinFrame(spin: Pick<WheelSpin, 'durationMs' | 'selectedSlot' | 'totalSlots' | 'turns'> & { startedAt: string | number }, now: number) {
  const duration = Math.max(0, spin.durationMs);
  const elapsed = now - wheelTimeMs(spin.startedAt);
  const progress = duration > 0 ? Math.max(0, Math.min(1, elapsed / duration)) : Number(elapsed >= 0);
  const finalRotation = finalWheelRotation(spin.selectedSlot, spin.totalSlots, spin.turns);
  return {
    progress,
    finished: elapsed >= duration,
    rotation: progress === 1 ? finalRotation : finalRotation * wheelTravel(progress),
  };
}
