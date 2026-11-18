const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function componentSource(file, component) {
  const text = fs.readFileSync(path.join(__dirname, '../src/features/admin', `${file}.tsx`), 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return { ast, root: ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === component) };
}

function evaluate(expression, bindings) {
  const source = ts.transpileModule(`const value = ${expression};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  return new Function('require', 'exports', ...Object.keys(bindings), `${source}; return value;`)(require, {}, ...Object.values(bindings));
}

function callback(file, component, name, bindings) {
  const { ast, root } = componentSource(file, component);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) {
      expression = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  if (!expression) throw new Error(`Missing ${component}.${name}`);
  return evaluate(expression.getText(ast), bindings);
}

const toast = () => ({ success: jest.fn(), error: jest.fn(), warning: jest.fn() });

test.each(['video', 'bgm', 'neither'])('settings save sends only the changed %s volume', async (target) => {
  const postJson = jest.fn(async () => ({}));
  const bindings = {
    settingsState: 'ready', isPending: false, chzzkUrlEntered: '', chzzkUrlRemoving: false, chzzkCanEnable: false,
    chzzkVideoDonation: { pauseEnabled: false, queueEnabled: false }, chzzkOverlayUrl: undefined,
    setIsPending: jest.fn(), postJson, enabled: true, pointsPerSecond: '4', maxDurationMinutes: '10', perUserLimit: '2',
    volume: '0', bgmVolume: '0', volumeDirtyRef: { current: { video: target === 'video', bgm: target === 'bgm' } },
    providers: { youtube: true }, idlePlaylist: { enabled: false }, bgmEnabled: true, bgmAcceptEnabled: true,
    bgmPointsPerSecond: '8', bgmIdlePlaylist: { enabled: false },
    setChzzkOverlayUrl: jest.fn(), setChzzkUrlRevealed: jest.fn(), toast: toast(), refreshResource: jest.fn(),
    getApiErrorMessage: String,
  };
  const close = jest.fn();
  await callback('admin-action-dialogs', 'VideoDonationSettingsDialog', 'submit', bindings)(close);
  expect(postJson).toHaveBeenCalledTimes(1);
  const [url, payload] = postJson.mock.calls[0];
  expect(url).toBe('/api/video-donation/settings');
  expect(payload).toMatchObject({ acceptEnabled: true, pointsPerSecond: 4, bgm: { enabled: true, pointsPerSecond: 8 } });
  if (target === 'video') expect(payload.volume).toBe(0);
  else expect(payload).not.toHaveProperty('volume');
  if (target === 'bgm') expect(payload.bgm.volume).toBe(0);
  else expect(payload.bgm).not.toHaveProperty('volume');
  expect(close).toHaveBeenCalled();
});

test.each(['video', 'bgm'])('queue applies only %s and preserves the other unsaved slider', async (target) => {
  const bindings = {
    writable: true, volumePending: null, volume: 19, bgmVolume: 0,
    volumeDirtyRef: { current: { video: true, bgm: true } },
    setVolumePending: jest.fn(), postJson: jest.fn(async () => ({})), toast: toast(), load: jest.fn(),
  };
  await callback('video-donation-queue-page', 'VideoDonationQueuePage', 'applyVolume', bindings)(target);
  expect(bindings.postJson).toHaveBeenCalledWith('/api/video-donation/control', { op: 'volume', target, volume: target === 'bgm' ? 0 : 19 });
  expect(bindings.volumeDirtyRef.current).toEqual({ video: target !== 'video', bgm: target !== 'bgm' });
  expect(bindings.setVolumePending.mock.calls).toEqual([[target], [null]]);
});

test('failed volume changes keep the unsaved slider available for retry', async () => {
  const bindings = {
    writable: true, volumePending: null, volume: 19, bgmVolume: 0,
    volumeDirtyRef: { current: { video: false, bgm: true } },
    setVolumePending: jest.fn(), postJson: jest.fn(async () => { throw new Error('failed'); }), toast: toast(), load: jest.fn(),
  };
  await callback('video-donation-queue-page', 'VideoDonationQueuePage', 'applyVolume', bindings)('bgm');
  expect(bindings.volumeDirtyRef.current.bgm).toBe(true);
  expect(bindings.load).not.toHaveBeenCalled();
  expect(bindings.setVolumePending).toHaveBeenLastCalledWith(null);
});

test.each([
  [{ video: false, bgm: false }, 31, 0],
  [{ video: true, bgm: false }, undefined, 0],
  [{ video: false, bgm: true }, 31, undefined],
])('queue WS updates preserve locally edited volume drafts: %j', (dirty, video, bgm) => {
  const bindings = {
    queuePayloadVersionRef: { current: 0 }, volumeDirtyRef: { current: dirty },
    ...Object.fromEntries(['setItems', 'setCurrentItem', 'setPaused', 'setIdleDeferred', 'setVolume', 'setBgmVolume'].map((name) => [name, jest.fn()])),
  };
  callback('video-donation-queue-page', 'VideoDonationQueuePage', 'applyQueuePayload', bindings)({ items: [], volume: 31, bgm: { volume: 0 } });
  for (const [name, expected] of [['setVolume', video], ['setBgmVolume', bgm]]) {
    if (expected === undefined) expect(bindings[name]).not.toHaveBeenCalled();
    else expect(bindings[name]).toHaveBeenCalledWith(expected);
  }
});

test.each([true, false])('rendered queue has two labeled bounded sliders and scoped apply buttons (writable %s)', (writable) => {
  const { ast, root } = componentSource('video-donation-queue-page', 'VideoDonationQueuePage');
  let controls;
  function visit(node) {
    if (ts.isJsxExpression(node) && node.expression?.getText(ast).startsWith("(['video', 'bgm'] as const).map")) controls = node.expression.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(root);
  expect(controls).toBeTruthy();
  const icon = () => React.createElement('span');
  const nodes = evaluate(controls, {
    volume: 31, bgmVolume: 0, writable, volumePending: null, volumeDirtyRef: { current: {} },
    setVolume() {}, setBgmVolume() {}, applyVolume() {}, Volume2: icon, VolumeX: icon, Loader2: icon,
    Button: ({ size, variant, ...props }) => React.createElement('button', props),
  });
  const html = renderToStaticMarkup(React.createElement(React.Fragment, null, nodes));
  expect(html.match(/type="range"/g)).toHaveLength(2);
  expect(html).toContain('aria-label="영상 후원 소리 크기"');
  expect(html).toContain('aria-label="BGM 소리 크기"');
  expect(html).toContain('aria-label="영상 후원 소리 적용"');
  expect(html).toContain('aria-label="BGM 소리 적용"');
  expect(html).toContain('value="0"');
  expect(html.match(/min="0" max="100"/g)).toHaveLength(2);
  expect((html.match(/disabled=""/g) || []).length).toBe(writable ? 0 : 4);
});
