const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const root = path.join(__dirname, '../src/components');
function evaluate(source, bindings = {}) {
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const loaded = { exports: {} };
  new Function('exports', 'module', ...Object.keys(bindings), output)(loaded.exports, loaded, ...Object.values(bindings));
  return loaded.exports;
}
const { buildRouletteWheelEntries } = evaluate(fs.readFileSync(path.join(root, 'rouletteWheelEntries.ts'), 'utf8'));
const { createWheelSegments } = evaluate(fs.readFileSync(path.join(root, 'rouletteWheelUtils.ts'), 'utf8'));
const viewer = ts.createSourceFile('viewer.tsx', fs.readFileSync(path.join(root, 'RouletteViewer.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['randomWheelStopOffsetRatio', 'wheelStopRotationForIndex', 'wheelIndexAtPointer', 'equivalentForwardRotation'];
const functions = viewer.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(viewer));
const padding = viewer.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(viewer) === 'WHEEL_STOP_EDGE_PADDING_RATIO')).getText(viewer);
const geometry = evaluate(`${padding}\n${functions.join('\n')}\nexport { ${names.join(', ')} };`, { createWheelSegments });

test('server order and duplicate-label winner weights remain aligned', () => {
  expect(buildRouletteWheelEntries(['같은 항목', '다른 항목', '같은 항목'], '같은 항목', [1, 7, 2], 2)).toEqual({
    items: ['같은 항목', '다른 항목', '같은 항목'], weights: [1, 7, 2], selectedIndex: 2,
  });
});

test('legacy and invalid weight payloads remain usable without reordering', () => {
  expect(buildRouletteWheelEntries(['A', 'B'], 'B')).toEqual({ items: ['A', 'B'], weights: [1, 1], selectedIndex: 1 });
  expect(buildRouletteWheelEntries(['A', 'B'], 'C', [-1, 4])).toEqual({ items: ['A', 'B', 'C'], weights: [1, 1, 1], selectedIndex: 2 });
  expect(buildRouletteWheelEntries(['A', 'B'], 'B', [0, 0]).weights).toEqual([1, 1]);
  expect(buildRouletteWheelEntries(['', 'A', 'B'], 'B', [100, 2, 3], 2)).toEqual({ items: ['A', 'B'], weights: [2, 3], selectedIndex: 1 });
});

test('random positions stay inside the weighted winner and are not fixed at its center', () => {
  const weights = [1, 7, 2];
  const segments = createWheelSegments(3, weights);
  for (let target = 0; target < 3; target += 1) {
    const positions = new Set();
    for (let sample = 0; sample < 100; sample += 1) {
      const offset = geometry.randomWheelStopOffsetRatio(() => sample / 100);
      const stop = geometry.wheelStopRotationForIndex(target, 3, offset, weights);
      const rotation = geometry.equivalentForwardRotation(123, stop, 6);
      const angle = ((-rotation % 360) + 360) % 360;
      expect(angle).toBeGreaterThan(segments[target].start);
      expect(angle).toBeLessThan(segments[target].end);
      expect(geometry.wheelIndexAtPointer(rotation, 3, weights)).toBe(target);
      positions.add(stop);
    }
    expect(positions.size).toBe(100);
  }
});

test('zero-width sectors cannot displace the selected pointer index', () => {
  const rotation = geometry.wheelStopRotationForIndex(1, 3, .3, [0, 2, 0]);
  expect(geometry.wheelIndexAtPointer(rotation, 3, [0, 2, 0])).toBe(1);
});
