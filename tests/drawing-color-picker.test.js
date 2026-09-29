const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const loadSource = require('./helpers/load-source.cjs');
const { pickScreenColor, sampleDrawingColor } = loadSource('src/shared/drawing/color-picker.ts');
let savedWindow;

beforeEach(() => { savedWindow = global.window; global.window = { isSecureContext: true }; });
afterEach(() => { if (savedWindow === undefined) delete global.window; else global.window = savedWindow; });

test('opens the native picker synchronously from the user gesture and normalizes its screen color', async () => {
  const open = jest.fn(async () => ({ sRGBHex: '#AaBB12' }));
  window.EyeDropper = class { open = open; };
  const controller = new AbortController();
  const promise = pickScreenColor(controller.signal);
  expect(open).toHaveBeenCalledWith({ signal: controller.signal });
  await expect(promise).resolves.toEqual({ status: 'picked', color: '#aabb12' });
});

test('unsupported browsers and insecure pages use the canvas fallback', async () => {
  await expect(pickScreenColor(new AbortController().signal)).resolves.toEqual({ status: 'unsupported' });
  window.EyeDropper = jest.fn();
  window.isSecureContext = false;
  await expect(pickScreenColor(new AbortController().signal)).resolves.toEqual({ status: 'unsupported' });
  expect(window.EyeDropper).not.toHaveBeenCalled();
});

test('Escape cancels without selecting a color and real API failures remain distinguishable', async () => {
  window.EyeDropper = class { open() { return Promise.reject({ name: 'AbortError' }); } };
  await expect(pickScreenColor(new AbortController().signal)).resolves.toEqual({ status: 'cancelled' });
  window.EyeDropper = class { open() { return Promise.reject(new Error('unavailable')); } };
  await expect(pickScreenColor(new AbortController().signal)).rejects.toThrow('unavailable');
});

test('ignores screen selections received after an abort', async () => {
  const controller = new AbortController();
  window.EyeDropper = class { async open() { controller.abort(); return { sRGBHex: '#123456' }; } };
  await expect(pickScreenColor(controller.signal)).resolves.toEqual({ status: 'cancelled' });
});

test('the canvas fallback clamps edge coordinates and samples the visible background', () => {
  const getImageData = jest.fn(() => ({ data: [255, 0, 0, 128] }));
  const canvas = { width: 100, height: 50, getContext: () => ({ getImageData }) };
  expect(sampleDrawingColor(canvas, 1, -0.1, '#ffffff')).toBe('#ff7f7f');
  expect(getImageData).toHaveBeenCalledWith(99, 0, 1, 1);
  getImageData.mockReturnValue({ data: [0, 0, 0, 0] });
  expect(sampleDrawingColor(canvas, 0, 0, '#fafafa')).toBe('#fafafa');
  expect(sampleDrawingColor(canvas, 0, 0, null)).toBeNull();
});

function editor(pick = jest.fn(async () => ({ status: 'picked', color: '#39afc2' }))) {
  const filename = path.join(__dirname, '../src/components/drawing/DrawingStudio.tsx');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'DrawingStudio');
  const names = ['chooseColor', 'applyPickedColor', 'cancelColorPicker', 'startColorPicker'];
  const code = ts.transpileModule(names.map((name) => component.body.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(source)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const state = { tool: 'rectangle', brush: { color: '#ffffff', alpha: 0.4 }, outline: { color: '#191b20', alpha: 0.6, size: 0.01, enabled: true }, shape: { fillColor: '#517ee1', fillAlpha: 0.7, fillEnabled: true } };
  const bindings = {
    tool: 'rectangle', busy: false, review: null, draftReady: true, recoverable: null,
    activeRef: { current: null }, colorPickerRef: { current: null }, cursorRef: { current: { style: {} } },
    pickScreenColor: pick, stopPlayback: jest.fn(), toast: { info: jest.fn(), error: jest.fn() },
    setColorPicker: jest.fn(), setTool: jest.fn((tool) => { state.tool = tool; }),
    setBrush: jest.fn((update) => { state.brush = update(state.brush); }),
    setOutlineStyle: jest.fn((update) => { state.outline = update(state.outline); }),
    setShapeStyle: jest.fn((update) => { state.shape = update(state.shape); }),
  };
  const api = new Function(...Object.keys(bindings), `${code}\nreturn { ${names.join(', ')} };`)(...Object.values(bindings));
  return { ...bindings, ...api, state };
}

test.each(['brush', 'outline', 'fill'])('screen sampling changes only the requested %s color and retains the previous tool and opacity', async (target) => {
  const h = editor();
  await h.startColorPicker(target);
  expect(h.state.tool).toBe('rectangle');
  expect(h.state.brush).toEqual({ color: target === 'brush' ? '#39afc2' : '#ffffff', alpha: 0.4 });
  expect(h.state.outline).toEqual({ color: target === 'outline' ? '#39afc2' : '#191b20', alpha: 0.6, size: 0.01, enabled: true });
  expect(h.state.shape).toEqual({ fillColor: target === 'fill' ? '#39afc2' : '#517ee1', fillAlpha: 0.7, fillEnabled: true });
  expect(h.colorPickerRef.current).toBeNull();
});

test('canvas mode preserves the outline target and restores the shape tool on cancellation', async () => {
  const h = editor(jest.fn(async () => ({ status: 'unsupported' })));
  await h.startColorPicker('outline');
  expect(h.state.tool).toBe('picker');
  expect(h.colorPickerRef.current.target).toBe('outline');
  h.cancelColorPicker();
  expect(h.state.tool).toBe('rectangle');
  expect(h.state.outline.color).toBe('#191b20');
});

test('an obsolete picker result cannot overwrite a new target', async () => {
  let resolveFirst;
  const pick = jest.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; })).mockResolvedValue({ status: 'picked', color: '#eb5757' });
  const h = editor(pick);
  const first = h.startColorPicker('brush');
  await h.startColorPicker('outline');
  resolveFirst({ status: 'picked', color: '#123456' });
  await first;
  expect(h.state.brush.color).toBe('#ffffff');
  expect(h.state.outline.color).toBe('#eb5757');
});
