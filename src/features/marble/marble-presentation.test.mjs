import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { marbleBoardLayout } from '../../../shared/marble.js';

const source = readFileSync(new URL('./marble-presentation.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { marbleTileRegions, marblePawnPlacement, paginateMarbleText, marbleMissionPage, marblePawnMotion, marbleCardMotion, marbleTravelEdge } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('direction markers connect every consecutive tile including all corners and the final return to start', () => {
  const deltas = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
  for (const orientation of ['landscape', 'portrait']) for (let count = 12; count <= 40; count += 4) {
    const { slots } = marbleBoardLayout(count, orientation);
    const directions = slots.map((slot, index) => {
      const next = slots[(index + 1) % count];
      const edge = marbleTravelEdge(slot, next);
      const [x, y] = deltas[edge];
      assert.equal(Math.sign(next.x - slot.x), x);
      assert.equal(Math.sign(next.y - slot.y), y);
      return edge;
    });
    assert.equal(directions[0], 'left');
    assert.equal(directions.at(-1), 'down');
    assert.equal(directions.filter((edge, i) => edge !== directions[(i + 1) % count]).length, 4);
  }
});

test('one through eight pawns and their labels stay above titles for every board size and orientation', () => {
  for (const orientation of ['landscape', 'portrait']) for (let count = 12; count <= 40; count += 4) {
    for (const slot of marbleBoardLayout(count, orientation).slots) {
      const { title, pawns } = marbleTileRegions(slot.width, slot.height);
      for (let occupants = 1; occupants <= 8; occupants++) {
        const markers = Array.from({ length: occupants }, (_, index) => marblePawnPlacement(slot.width, slot.height, occupants, index));
        for (const marker of markers) {
          assert(marker.x - marker.size / 2 >= pawns.x - 1e-9);
          assert(marker.x + marker.size / 2 <= pawns.x + pawns.width + 1e-9);
          assert(marker.y - marker.size / 2 >= pawns.y - 1e-9);
          assert(marker.y + marker.size / 2 + marker.labelHeight <= title.y - 8 + 1e-9);
        }
        for (let a = 0; a < markers.length; a++) for (let b = a + 1; b < markers.length; b++) {
          assert(Math.abs(markers[a].x - markers[b].x) >= markers[a].size || Math.abs(markers[a].y - markers[b].y) >= markers[a].size);
        }
      }
    }
  }
});

test('pagination preserves all characters, blank lines, spaces and grapheme clusters', () => {
  const samples = ['', '한 줄 미션', Array.from({ length: 20 }, (_, index) => `${index + 1}. 미션 문장을 읽어 주세요.`).join('\n'), '\n\n 시작  공백 \n\n 끝\n', '가'.repeat(400), '👩‍👩‍👧‍👦 e\u0301 한글 '.repeat(40)];
  const units = value => Array.from(new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(value));
  const fits = page => page.split('\n').length <= 4 && units(page).length <= 48;
  for (const text of samples) {
    const pages = paginateMarbleText(text, fits);
    assert.equal(pages.join(''), text);
    assert(pages.every(fits));
    assert.deepEqual(pages.flatMap(units).map(unit => unit.segment), units(text).map(unit => unit.segment));
  }
});

test('page selection follows server time, wraps, freezes and resumes without skipping', () => {
  assert.equal(marbleMissionPage(999, 1000, 4), 0);
  assert.equal(marbleMissionPage(5999, 1000, 4), 0);
  assert.equal(marbleMissionPage(6000, 1000, 4), 1);
  assert.equal(marbleMissionPage(21000, 1000, 4), 0);
  const pausedAt = 12500;
  assert.equal(marbleMissionPage(pausedAt, 1000, 4), marbleMissionPage(pausedAt, 1000, 4));
  assert.equal(marbleMissionPage(pausedAt + 90000, 91000, 4), marbleMissionPage(pausedAt, 1000, 4));
});

test('impossible measurement is explicit instead of silently dropping text', () => {
  assert.throws(() => paginateMarbleText('미션', () => false), RangeError);
});

const roll = { id: 'motion', playerId: 'player', dice: [3], from: 22, to: 1, path: [23, 0, 1], startedAt: 1000, diceDurationMs: 1200, stepDurationMs: 200, endsAt: 2800, source: 'manual' };

test('pawn anticipation, hops and landing follow the authoritative path without early result movement', () => {
  assert.equal(marblePawnMotion(roll, 1, 2000).to, 22);
  assert.equal(marblePawnMotion(roll, 1, 2200).progress, 1);
  for (let index = 0; index < roll.path.length; index++) {
    let previous = 0;
    for (let offset = 1; offset < 200; offset++) {
      const pose = marblePawnMotion(roll, 1, 2200 + index * 200 + offset);
      assert.equal(pose.to, roll.path[index]);
      assert.equal(pose.from, index ? roll.path[index - 1] : roll.from);
      assert(pose.progress >= previous && pose.progress <= 1);
      assert(pose.lift >= 0 && pose.lift <= 23);
      assert(pose.scaleX > .9 && pose.scaleX < 1.1 && pose.scaleY > .9 && pose.scaleY < 1.1);
      previous = pose.progress;
    }
  }
  assert.equal(marblePawnMotion(roll, 1, 2800).moving, false);
  assert.equal(marblePawnMotion(roll, 1, 3080).landing, .5);
  assert.equal(marblePawnMotion(roll, 1, 3800).landing, 1);
});

test('restored and reduced-motion pawn snapshots do not replay historical rolls', () => {
  assert.equal(marblePawnMotion(roll, 7, 100000).to, 7);
  const quiet = marblePawnMotion(roll, 1, 2300, true);
  assert.equal(quiet.to, 1);
  assert.equal(quiet.lift, 0);
  assert.equal(quiet.tilt, 0);
  assert.equal(quiet.landing, 0);
  assert.deepEqual(marblePawnMotion(roll, 1, 2500), marblePawnMotion(roll, 1, 2500));
});

test('golden card uses a real half-turn and settles on a readable face', () => {
  assert.equal(marbleCardMotion(900, 1000, true).rotation, -180);
  const half = marbleCardMotion(1410, 1000, true);
  assert(half.rotation > -90 && half.rotation < 0);
  assert.equal(half.revealed, true);
  assert(half.lift > 0);
  assert.equal(marbleCardMotion(1820, 1000, true).rotation, 0);
  assert.equal(marbleCardMotion(10000, 1000, true).sheen, 0);
  assert.equal(marbleCardMotion(999, 1000, true, true).revealed, false);
  assert.deepEqual(marbleCardMotion(1000, 1000, true, true), { revealed: true, progress: 1, rotation: 0, lift: 0, sheen: 0 });
});
