const fs = require('fs');
const path = require('path');

describe('OBS scene filter regressions', () => {
  const root = path.join(__dirname, '..');
  const blueprintPage = fs.readFileSync(path.join(root, 'src', 'features', 'admin', 'action-blueprint-page.tsx'), 'utf8');
  const automationsPage = fs.readFileSync(path.join(root, 'src', 'features', 'admin', 'automations-page.tsx'), 'utf8');
  const serverIndex = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
  const localProgram = fs.readFileSync(path.join(root, 'local-program', 'main.cjs'), 'utf8');

  test('discovers filters attached to scenes and records their target kind', () => {
    const discoveryStart = localProgram.indexOf('async function discoverObs');
    const discoveryEnd = localProgram.indexOf('async function getObsSceneItem', discoveryStart);
    const discovery = localProgram.slice(discoveryStart, discoveryEnd);

    expect(discovery).toContain("...scenes.slice(0, 80).map((scene) => ({ name: scene.name, targetType: 'scene' }))");
    expect(discovery).toContain("targetType: 'source'");
    expect(discovery).toContain("sendObsRequest(ws, 'GetSourceFilterList', { sourceName: target.name }");
    expect(discovery).toContain('targetType: target.targetType');
  });

  test('lets blueprint users choose a source or scene before choosing its filter', () => {
    expect(blueprintPage).toContain('label="필터 대상 종류"');
    expect(blueprintPage).toContain("{ value: 'scene', label: '장면' }");
    expect(blueprintPage).toContain("onChange('filterTargetName', value)");
    expect(blueprintPage).toContain("(filter.targetType || 'source') === filterTargetType");
    expect(blueprintPage).toContain('filter.sourceName === filterTargetName');
  });

  test('validates the new target while keeping saved source filter nodes compatible', () => {
    for (const source of [blueprintPage, serverIndex]) {
      expect(source).toContain("String(");
      expect(source).toContain("filterTargetType || 'source'");
      expect(source).toContain('filterTargetName');
      expect(source).toContain('sourceName');
      expect(source).toContain('필터 대상이 필요합니다.');
    }
  });

  test('executes scene filters through the OBS source filter API and preserves source fallback', () => {
    const runtimeStart = localProgram.indexOf('async function runObsAction');
    const runtimeEnd = localProgram.indexOf('async function discoverTits', runtimeStart);
    const runtime = localProgram.slice(runtimeStart, runtimeEnd);

    expect(runtime).toContain("payload.filterTargetType === 'scene'");
    expect(runtime).toContain('payload.filterTargetName');
    expect(runtime).toContain("filterTargetType === 'scene' ? payload.sceneName : payload.sourceName");
    expect(runtime).toContain("sendObsRequest(ws, 'GetSourceFilter', { sourceName, filterName }");
    expect(runtime).toContain("sendObsRequest(ws, 'SetSourceFilterEnabled', { sourceName, filterName, filterEnabled }");
  });

  test('supports the same target selection in the OBS integration test panel', () => {
    expect(automationsPage).toContain("useState<'source' | 'scene'>('source')");
    expect(automationsPage).toContain('label="필터 대상 종류"');
    expect(automationsPage).toContain('filterTargetType: selectedObsFilterTargetType');
    expect(automationsPage).toContain('filterTargetName: selectedObsFilterTargetName');
    expect(automationsPage).toContain('availableObsFilters.map');
  });
});
