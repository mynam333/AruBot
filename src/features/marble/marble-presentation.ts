import type { MarbleRoll } from '../../../shared/marble';

export function marbleCompleteLabel(followup: 'forward' | 'backward' | 'bonus' | null) {
  return followup === 'forward' ? '전진 주사위 굴리기' : followup === 'backward' ? '후진 주사위 굴리기' : followup === 'bonus' ? '한 번 더 굴리기' : '미션 완료';
}

export type MarblePresentationRect = { x: number; y: number; width: number; height: number };
export type MarbleTravelEdge = 'left' | 'up' | 'right' | 'down';

/** Only the board sequence decides travel direction; mission artwork stays upright. */
export function marbleTravelEdge(from: MarblePresentationRect, to: MarblePresentationRect): MarbleTravelEdge {
  const dx = to.x + to.width / 2 - from.x - from.width / 2;
  const dy = to.y + to.height / 2 - from.y - from.height / 2;
  return Math.abs(dx) > Math.abs(dy) ? dx < 0 ? 'left' : 'right' : dy < 0 ? 'up' : 'down';
}

const unit = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => value * value * (3 - 2 * value);

/** All motion samples the shared server timeline, including pause and reconnect. */
export function marblePawnMotion(roll: MarbleRoll | null | undefined, position: number, now: number, reduced = false) {
  const rest = { from: position, to: position, progress: 1, lift: 0, tilt: 0, scaleX: 1, scaleY: 1, moving: false, step: 0, steps: roll?.path.length ?? 0, landing: 0 };
  if (!roll) return rest;
  if (reduced || now >= roll.endsAt) return { ...rest, step: roll.path.length, landing: reduced ? 0 : unit((now - roll.endsAt) / 560) };
  const elapsed = now - roll.startedAt - roll.diceDurationMs;
  if (elapsed <= 0 || !roll.path.length) return { ...rest, from: roll.from, to: roll.from };
  const step = Math.min(roll.path.length - 1, Math.floor(elapsed / Math.max(1, roll.stepDurationMs)));
  const t = unit(elapsed / Math.max(1, roll.stepDurationMs) - step);
  const airborne = unit((t - .1) / .76);
  const hop = Math.sin(Math.PI * airborne);
  const compression = t < .1 ? Math.sin(t / .1 * Math.PI) : t > .86 ? Math.sin((t - .86) / .14 * Math.PI) : 0;
  return { ...rest, from: step === 0 ? roll.from : roll.path[step - 1], to: roll.path[step], progress: smooth(airborne), lift: hop * 23,
    tilt: Math.sin(airborne * Math.PI * 2) * 7, scaleX: 1 - hop * .04 + compression * .06, scaleY: 1 + hop * .055 - compression * .065,
    moving: true, step, steps: roll.path.length };
}

export function marbleCardMotion(now: number, readyAt: number, golden: boolean, reduced = false) {
  if (reduced) return { revealed: now >= readyAt, progress: now >= readyAt ? 1 : 0, rotation: now >= readyAt ? 0 : -180, lift: 0, sheen: 0 };
  const progress = unit((now - readyAt) / (golden ? 820 : 320));
  const eased = 1 - (1 - progress) ** 3;
  return { revealed: golden ? progress >= .26 : progress > 0, progress,
    rotation: golden && progress < 1 ? -180 * (1 - eased) : 0, lift: progress < 1 ? Math.sin(progress * Math.PI) * (golden ? 13 : 0) : 0,
    sheen: golden && progress > .45 && progress < 1 ? (progress - .45) / .55 : 0 };
}

export function marbleTileRegions(width: number, height: number) {
  const titleHeight = Math.min(68, Math.max(30, height * .3));
  const title = { x: 12, y: height - titleHeight - 12, width: width - 24, height: titleHeight };
  return { title, pawns: { x: width * .18, y: 18, width: width * .64, height: Math.max(1, title.y - 26) } };
}

export function marblePawnPlacement(width: number, height: number, count: number, index: number) {
  const { pawns } = marbleTileRegions(width, height);
  const columns = Math.min(3, Math.max(1, count));
  const rows = Math.ceil(Math.max(1, count) / columns);
  const gap = 4;
  const labelHeight = count === 1 ? 24 : 0;
  const size = Math.max(1, Math.min(72, (pawns.width - (columns - 1) * gap) / columns, (pawns.height - labelHeight - (rows - 1) * gap) / rows));
  const gridWidth = columns * size + (columns - 1) * gap;
  const gridHeight = rows * size + (rows - 1) * gap + labelHeight;
  return {
    x: pawns.x + (pawns.width - gridWidth) / 2 + (index % columns) * (size + gap) + size / 2,
    y: pawns.y + (pawns.height - gridHeight) / 2 + Math.floor(index / columns) * (size + gap) + size / 2,
    size, labelHeight,
  };
}

/** The measurement callback uses the actual rendered font and content box. */
export function paginateMarbleText(text: string, fits: (page: string) => boolean): string[] {
  if (!text) return [''];
  const units = Array.from(new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(text), item => item.segment);
  const pages: string[] = [];
  let start = 0;
  while (start < units.length) {
    let low = start + 1;
    let high = units.length;
    let end = start;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (fits(units.slice(start, middle).join(''))) { end = middle; low = middle + 1; }
      else high = middle - 1;
    }
    if (end === start) throw new RangeError('The mission body must fit at least one grapheme.');
    if (end < units.length) {
      const earliestBreak = start + Math.floor((end - start) * .6);
      for (let boundary = end; boundary > earliestBreak; boundary -= 1) {
        if (/\s/u.test(units[boundary - 1])) { end = boundary; break; }
      }
    }
    pages.push(units.slice(start, end).join(''));
    start = end;
  }
  return pages;
}

export function marbleMissionPage(now: number, readyAt: number, count: number) {
  return count > 1 ? Math.floor(Math.max(0, now - readyAt) / 5000) % count : 0;
}
