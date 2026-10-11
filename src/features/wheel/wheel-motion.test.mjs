import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('./wheel-motion.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { buildWheelSegments, entryAtSlot, finalWheelRotation, normalizeDegrees, slotAtPointer, spinFrame, wheelTravel, wheelTimeMs } =
  await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const entry = (id, slots) => ({ id, slots, label: id, username: id, source: 'manual', colorIndex: 0, createdAt: 0 });

test('every slot lands exactly at the 12 oclock pointer, including 1000 slots', () => {
  for (const total of [1, 2, 3, 7, 24, 99, 1000]) {
    for (let selected = 0; selected < total; selected++) {
      const rotation = finalWheelRotation(selected, total, 7);
      assert.equal(slotAtPointer(rotation, total), selected);
      const angle = normalizeDegrees(rotation + (selected + 0.5) * 360 / total);
      assert.ok(Math.min(angle, 360 - angle) < 1e-9);
    }
  }
});

test('slot ownership is proportional, contiguous only, and never changed by labels', () => {
  const { segments, totalSlots } = buildWheelSegments([entry('a', 2), entry('a', 3), entry('b', 4), entry('a', 1)]);
  assert.equal(totalSlots, 10);
  assert.deepEqual(segments.map(({ startSlot, slots }) => [startSlot, slots]), [[0, 5], [5, 4], [9, 1]]);
  assert.deepEqual(Array.from({ length: 10 }, (_, slot) => entryAtSlot(segments, slot).id), ['a', 'a', 'a', 'a', 'a', 'b', 'b', 'b', 'b', 'a']);
  assert.equal(entryAtSlot(segments, -1), undefined);
  assert.equal(entryAtSlot(segments, 10), undefined);
  assert.equal(entryAtSlot(segments, 0.5), undefined);
});

test('empty and malformed slots do not create phantom chances', () => {
  assert.deepEqual(buildWheelSegments([]), { segments: [], totalSlots: 0 });
  assert.equal(buildWheelSegments([entry('a', -1), entry('b', NaN), entry('c', 1.5), entry('d', 0)]).totalSlots, 0);
  assert.equal(slotAtPointer(0, 0), -1);
  assert.equal(finalWheelRotation(-1, 10, 6), 0);
});

test('each angular slot has the same width independent of entry size', () => {
  const { segments, totalSlots } = buildWheelSegments([entry('a', 1), entry('b', 999)]);
  const counts = { a: 0, b: 0 };
  for (let slot = 0; slot < totalSlots; slot++) {
    for (const fraction of [0.001, 0.25, 0.5, 0.999]) {
      const angle = -(slot + fraction) * 360 / totalSlots;
      const actual = slotAtPointer(angle, totalSlots);
      assert.equal(actual, slot);
      counts[entryAtSlot(segments, actual).id]++;
    }
  }
  assert.deepEqual(counts, { a: 4, b: 3996 });
});

test('motion is monotone, smooth at joins, and has exact endpoints', () => {
  assert.equal(wheelTravel(-1), 0);
  assert.equal(wheelTravel(0), 0);
  assert.equal(wheelTravel(1), 1);
  assert.equal(wheelTravel(2), 1);
  let previous = 0;
  for (let i = 1; i <= 10000; i++) {
    const value = wheelTravel(i / 10000);
    assert.ok(value >= previous - 1e-12 && value <= 1);
    previous = value;
  }
  const h = 1e-5;
  for (const t of [0.12, 0.2]) {
    const before = (wheelTravel(t) - wheelTravel(t - h)) / h;
    const after = (wheelTravel(t + h) - wheelTravel(t)) / h;
    assert.ok(Math.abs(before - after) < 0.001);
  }
  assert.ok(wheelTravel(h) / h < 0.001);
  assert.ok((1 - wheelTravel(1 - h)) / h < 0.001);
});

test('replays, polling, and reloads share one absolute server timeline', () => {
  const spin = { startedAt: 100000, durationMs: 12000, selectedSlot: 887, totalSlots: 1000, turns: 8 };
  assert.deepEqual(spinFrame(spin, 99000), { progress: 0, finished: false, rotation: 0 });
  assert.equal(spinFrame(spin, 105000).finished, false);
  assert.deepEqual(spinFrame(spin, 105000), spinFrame({ ...spin }, 105000));
  assert.equal(spinFrame(spin, 111999).finished, false);
  const end = spinFrame(spin, 112000);
  assert.equal(end.finished, true);
  assert.equal(end.progress, 1);
  assert.equal(slotAtPointer(end.rotation, spin.totalSlots), spin.selectedSlot);
  assert.deepEqual(end, spinFrame(spin, 999999999));
});

test('zero duration still waits for a future start time', () => {
  const spin = { startedAt: 1000, durationMs: 0, selectedSlot: 0, totalSlots: 1, turns: 0 };
  assert.equal(spinFrame(spin, 999).finished, false);
  assert.equal(spinFrame(spin, 1000).finished, true);
});

test('canonical millisecond timestamps and legacy ISO timestamps share the same timeline', () => {
  const timestamp = '2026-10-11T04:00:00.000Z';
  const start = Date.parse(timestamp);
  const spin = { startedAt: timestamp, durationMs: 10000, selectedSlot: 7, totalSlots: 8, turns: 6 };
  assert.equal(wheelTimeMs(timestamp), start);
  assert.equal(wheelTimeMs(start), start);
  assert.deepEqual(spinFrame(spin, start + 4000), spinFrame({ ...spin, startedAt: start }, start + 4000));
  assert.equal(spinFrame(spin, start + 9999).finished, false);
  assert.equal(spinFrame(spin, start + 10000).finished, true);
  assert.ok(Number.isNaN(wheelTimeMs('invalid-date')));
});
