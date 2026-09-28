const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const loadSource = require('./helpers/load-source.cjs');
const transforms = loadSource('shared/drawing/selection.js');
const { createDrawing, createBrush, validateDrawing } = loadSource('shared/drawing/document.js', { './selection.js': transforms });

function editor(handle, pointer) {
  const file = path.join(__dirname, '../src/components/drawing/DrawingStudio.tsx');
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'DrawingStudio');
  const functions = ['beginSelection', 'updateSelection'].map((name) => component.body.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(source));
  const code = ts.transpileModule(functions.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const doc = createDrawing(4, 3, 'editor-test'); doc.width = 160; doc.height = 120;
  const selection = { rect: { x: 20, y: 20, width: 40, height: 20 }, frame: { x: 0.25, y: 0.25, scaleX: 1, scaleY: 1, angle: 0, t: 0 }, operationId: null, layerId: 'layer-1' };
  const bindings = {
    ...transforms, createBrush, selection, selectedCorners: [], layerId: 'layer-1',
    docRef: { current: doc }, activeRef: { current: null }, viewRef: { current: { zoom: 1, x: 0, y: 0 } },
    canvasRef: { current: { focus: jest.fn() } }, penPointerRef: { current: null }, lastPointer: { current: null },
    busy: false, review: null, recoverable: null, activeLayer: { visible: true, locked: false }, settings: {},
    uid: () => 'gesture', pointCount: () => 0, finishStroke: jest.fn(), schedule: jest.fn(), stopPlayback: jest.fn(),
    setSelection: jest.fn(), setSelectedCorners: jest.fn(),
    point: jest.fn((event, clamp = true) => clamp ? { ...pointer, x: Math.max(0, Math.min(1, pointer.x)), y: Math.max(0, Math.min(1, pointer.y)) } : pointer),
  };
  const api = new Function(...Object.keys(bindings), `${code}\nreturn { beginSelection, updateSelection };`)(...Object.values(bindings));
  api.beginSelection({ pointerId: 1, button: 0, pointerType: 'mouse', altKey: false, ctrlKey: false, metaKey: false, nativeEvent: {}, preventDefault() {}, stopPropagation() {}, currentTarget: { setPointerCapture() {} }, target: { closest: () => ({ getAttribute: () => handle }) } });
  return { ...bindings, ...api };
}

test('rotation gestures starting outside the canvas retain raw coordinates and record every frame', () => {
  const pointer = { x: -0.1, y: -0.2, p: 0.65, t: 10000 }, h = editor('rotate', pointer);
  expect(h.point).toHaveBeenCalledWith({}, false);
  expect(h.activeRef.current.start).toEqual(pointer);
  h.updateSelection({ ...pointer, t: 10100 }, false);
  expect(h.docRef.current.strokes[0].frames.at(-1).angle).toBe(0);
  h.updateSelection({ ...pointer, x: 0.65, y: 0.25, t: 10400 }, false);
  const stroke = h.docRef.current.strokes[0];
  expect(stroke.points[0]).toEqual({ ...pointer, x: 0, y: 0 });
  expect(stroke.frames.map((frame) => frame.t)).toEqual([10000, 10100, 10400]);
  expect(stroke.frames[2].angle).toBeGreaterThan(90);
  expect(stroke.points[1].t).toBe(10400);
  validateDrawing(h.docRef.current);
});

test('Shift resizing stores centered proportional changes as timed frames', () => {
  const pointer = { x: 0.375, y: 0.25, p: 0.65, t: 20000 }, h = editor('e', pointer);
  h.updateSelection({ ...pointer, x: 0.4375, t: 20200 }, true);
  h.updateSelection({ ...pointer, x: 0.3125, t: 20700 }, true);
  const frames = h.docRef.current.strokes[0].frames;
  expect(frames.map(({ x, y, scaleX, scaleY, t }) => ({ x, y, scaleX, scaleY, t }))).toEqual([
    { x: 0.25, y: 0.25, scaleX: 1, scaleY: 1, t: 20000 },
    { x: 0.25, y: 0.25, scaleX: 1.5, scaleY: 1.5, t: 20200 },
    { x: 0.25, y: 0.25, scaleX: 0.5, scaleY: 0.5, t: 20700 },
  ]);
  validateDrawing(h.docRef.current);
});
