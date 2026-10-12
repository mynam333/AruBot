const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const filename = path.join(__dirname, '../src/features/admin/action-blueprint-page.tsx');
const source = fs.readFileSync(filename, 'utf8');
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function testController(overrides = {}) {
  let arrow;
  const find = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'testRun') arrow = node.initializer;
    ts.forEachChild(node, find);
  };
  find(ast);
  if (!arrow) throw new Error('Missing blueprint test controller');
  const bindings = {
    writable: true, testing: false, saving: false, validationErrors: [],
    window: { confirm: jest.fn(() => true) },
    blueprint: { id: 'draft', version: { id: 'saved-version' } },
    serializeBlueprintSnapshot: () => 'snapshot', persistedSnapshotRef: { current: 'snapshot' },
    save: jest.fn(async () => ({ id: 'draft', version: { id: 'new-saved-version' } })),
    setTesting: jest.fn(), setActiveRunNodeId: jest.fn(),
    simulatorContext: () => ({ user: { userId: 'test_viewer' } }),
    jsonRequest: jest.fn(async () => ({ ok: true, executed: ['start', 'device'] })),
    readJson: jest.fn(async () => ({ runs: [] })),
    setRuns: jest.fn(), setRunSteps: jest.fn(), replayRunSteps: jest.fn(),
    toast: { success: jest.fn(), error: jest.fn() },
    ...overrides,
  };
  const compiled = ts.transpileModule(`const testRun = ${arrow.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return { run: new Function(...Object.keys(bindings), `${compiled}; return testRun;`)(...Object.values(bindings)), bindings };
}

test('existing default and keyboard test actions remain safe simulation', async () => {
  const { run, bindings } = testController();
  await run();
  expect(bindings.window.confirm).not.toHaveBeenCalled();
  expect(bindings.jsonRequest).toHaveBeenCalledWith('/api/action-blueprints/draft/test', 'POST', expect.objectContaining({ mode: 'simulation', confirmConnected: false, versionId: 'saved-version' }));
  expect(bindings.toast.success).toHaveBeenCalledWith(expect.stringContaining('기기 전송 없음'));
});

test('connected test cancellation does not save or send any request', async () => {
  const { run, bindings } = testController({ window: { confirm: jest.fn(() => false) } });
  await run('connected');
  expect(bindings.window.confirm).toHaveBeenCalledWith(expect.stringContaining('방송 화면'));
  expect(bindings.save).not.toHaveBeenCalled();
  expect(bindings.jsonRequest).not.toHaveBeenCalled();
  expect(bindings.setTesting).not.toHaveBeenCalled();
});

test('connected testing saves the current graph and sends its exact version after confirmation', async () => {
  const { run, bindings } = testController({ persistedSnapshotRef: { current: 'old-snapshot' } });
  await run('connected');
  expect(bindings.save).toHaveBeenCalledTimes(1);
  expect(bindings.window.confirm).toHaveBeenCalledWith(expect.stringContaining('나중에 실행'));
  expect(bindings.jsonRequest).toHaveBeenCalledWith('/api/action-blueprints/draft/test', 'POST', expect.objectContaining({ mode: 'connected', confirmConnected: true, versionId: 'new-saved-version' }));
  expect(bindings.toast.success).toHaveBeenCalledWith(expect.stringContaining('기기 실행 완료 미확인'));
  expect(bindings.setTesting).toHaveBeenLastCalledWith(false);
});

test.each([{ testing: true }, { saving: true }, { writable: false }, { validationErrors: ['invalid'] }])('does not execute while unavailable: %j', async (overrides) => {
  const { run, bindings } = testController(overrides);
  await run('connected');
  expect(bindings.jsonRequest).not.toHaveBeenCalled();
  expect(bindings.window.confirm).not.toHaveBeenCalled();
});

test('save failure does not execute the previously saved graph', async () => {
  const { run, bindings } = testController({ persistedSnapshotRef: { current: '' }, save: async () => null });
  await run('connected');
  expect(bindings.jsonRequest).not.toHaveBeenCalled();
  expect(bindings.setTesting).toHaveBeenLastCalledWith(false);
});

test('delivery errors are shown rather than a success toast', async () => {
  const { run, bindings } = testController({ jsonRequest: async () => ({ ok: false, error: 'blueprint_desktop_unavailable' }) });
  await run('connected');
  expect(bindings.toast.error).toHaveBeenCalledWith('blueprint_desktop_unavailable');
  expect(bindings.toast.success).not.toHaveBeenCalled();
});

test('both test controls and run history distinguish simulation from device execution', () => {
  expect(source).toContain("onClick={() => void testRun('simulation')}");
  expect(source).toContain("onClick={() => void testRun('connected')}");
  expect(source).toContain('연결 기기 실제 테스트');
  expect(source).toContain('전체 그래프 시뮬레이션');
  expect(source).toContain("run.context?.testMode === 'connected'");
  expect(source).toContain('기기 실행 완료 미확인 · 로컬 프로그램 로그 확인');
  expect(ast.parseDiagnostics).toHaveLength(0);
});
