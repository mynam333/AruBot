const path = require('path');
const { execFileSync } = require('child_process');

describe('roulette spin deterministic choreography', () => {
  test('the same spin ID produces the same sequence in popup and OBS instances', () => {
    const moduleUrl = new URL(
      '../src/components/roulette-spin-random.js',
      `file://${__filename.replace(/\\/g, '/')}`,
    ).href;
    const script = `
      const { createRouletteSpinRandom, resolveRouletteSpinSeed } = await import(${JSON.stringify(moduleUrl)});
      const meta = { spinId: 'shared-spin-id', name: '테스트 룰렛', label: '당첨', createdAt: '2026-07-26T12:00:00.000Z' };
      const seed = resolveRouletteSpinSeed(meta, '당첨');
      const popupRandom = createRouletteSpinRandom(seed);
      const obsRandom = createRouletteSpinRandom(seed);
      const popupSequence = Array.from({ length: 32 }, () => popupRandom());
      const obsSequence = Array.from({ length: 32 }, () => obsRandom());
      const otherRandom = createRouletteSpinRandom('another-spin-id');
      const otherSequence = Array.from({ length: 32 }, () => otherRandom());
      console.log(JSON.stringify({ seed, popupSequence, obsSequence, otherSequence }));
    `;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      cwd: path.join(__dirname, '..'),
    }).trim());

    expect(result.seed).toBe('shared-spin-id');
    expect(result.popupSequence).toEqual(result.obsSequence);
    expect(result.popupSequence).not.toEqual(result.otherSequence);
    expect(result.popupSequence.every((value) => value >= 0 && value < 1)).toBe(true);
  });
});
