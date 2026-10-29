const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/components/rouletteMotion.ts'), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const loaded = { exports: {} };
new Function('exports', 'module', output)(loaded.exports, loaded);
const { getRouletteMotionProfile, rouletteMotionProgress, rouletteWheelKeyframes, rouletteMotionPhase } = loaded.exports;
const themes = ['studio', 'prism', 'aurora', 'velvet', 'mono', 'deco', 'crystal', 'ink', 'nova', 'ceramic', 'arcade', 'sakura', 'ocean', 'solar', 'cyber', 'gold'];

describe('roulette material motion', () => {
  test.each(themes)('%s moves continuously forward to the exact target', theme => {
    const profile = getRouletteMotionProfile(theme);
    expect(rouletteMotionProgress(0, profile)).toBe(0);
    expect(rouletteMotionProgress(1, profile)).toBe(1);
    let previous = 0;
    for (let i = 1; i <= 1000; i += 1) {
      const current = rouletteMotionProgress(i / 1000, profile);
      expect(current).toBeGreaterThanOrEqual(previous);
      expect(current).toBeLessThanOrEqual(1);
      previous = current;
    }
    for (const join of [profile.acceleration, profile.cruise]) {
      const before = rouletteMotionProgress(join - .000001, profile);
      const after = rouletteMotionProgress(join + .000001, profile);
      expect(after - before).toBeLessThan(.00002);
    }
    const frames = rouletteWheelKeyframes(35, 2637.25, profile);
    expect(frames[0]).toEqual({ offset: 0, transform: 'rotate(35deg)' });
    expect(frames.at(-1)).toEqual({ offset: 1, transform: 'rotate(2637.25deg)' });
    expect(rouletteMotionPhase(0, profile)).toBe('launch');
    expect(rouletteMotionPhase(profile.acceleration, profile)).toBe('cruise');
    expect(rouletteMotionPhase(profile.cruise, profile)).toBe('brake');
    expect(rouletteMotionPhase(1, profile)).toBe('settled');
  });

  test('all material profiles differ and unknown themes are safe', () => {
    expect(new Set(themes.map(theme => JSON.stringify(getRouletteMotionProfile(theme)))).size).toBe(16);
    expect(getRouletteMotionProfile('unknown')).toEqual(getRouletteMotionProfile('studio'));
    expect(rouletteMotionProgress(NaN, getRouletteMotionProfile('studio'))).toBe(0);
  });

  test('identical endpoints stay still for an explicitly instant result', () => {
    const frames = rouletteWheelKeyframes(800, 800, getRouletteMotionProfile('arcade'));
    expect(new Set(frames.map(frame => frame.transform))).toEqual(new Set(['rotate(800deg)']));
  });
});
