const loadSource = require('./helpers/load-source.cjs');
const { drawingShortcut, TOOL_SHORTCUTS, BRUSH_SHORTCUTS } = loadSource('src/shared/drawing/shortcuts.ts');

const event = (code, overrides = {}) => ({ code, key: '', target: null, ...overrides });

describe('drawing shortcuts', () => {
  test('every tool and brush tooltip shortcut resolves to the matching action', () => {
    for (const [tool, key] of Object.entries(TOOL_SHORTCUTS)) {
      expect(drawingShortcut(event(`Key${key}`))).toEqual({ action: 'tool', tool });
    }
    for (const [brush, key] of Object.entries(BRUSH_SHORTCUTS)) {
      expect(drawingShortcut(event(`${/\d/.test(key) ? 'Digit' : 'Key'}${key}`))).toEqual({ action: 'brush', brush });
    }
    expect(drawingShortcut(event('KeyM'))).toEqual({ action: 'tool', tool: 'select' });
  });

  test('Korean keyboard layout still uses physical shortcut keys, but IME composition is untouched', () => {
    expect(drawingShortcut(event('KeyB', { key: 'ㅠ' }))).toEqual({ action: 'tool', tool: 'freehand' });
    expect(drawingShortcut(event('KeyB', { isComposing: true }))).toBeNull();
    expect(drawingShortcut(event('', { key: 'e' }))).toEqual({ action: 'brush', brush: 'eraser' });
  });

  test('text fields, sliders, contenteditable, dialogs and active gestures cannot trigger shortcuts', () => {
    const closest = jest.fn().mockReturnValue({});
    expect(drawingShortcut(event('KeyB', { target: { closest } }))).toBeNull();
    expect(closest).toHaveBeenCalledWith(expect.stringContaining('input, textarea, select, [contenteditable]'));
    expect(drawingShortcut(event('KeyB'), true)).toBeNull();
    expect(drawingShortcut(event('KeyB', { defaultPrevented: true }))).toBeNull();
    expect(drawingShortcut(event('KeyB', { repeat: true }))).toBeNull();
  });

  test('size repeats, escape, undo and redo work without stealing unrelated browser shortcuts', () => {
    expect(drawingShortcut(event('BracketLeft', { repeat: true }))).toEqual({ action: 'size', delta: -1 });
    expect(drawingShortcut(event('BracketRight'))).toEqual({ action: 'size', delta: 1 });
    expect(drawingShortcut(event('Escape'))).toEqual({ action: 'deselect' });
    for (const modifier of ['ctrlKey', 'metaKey']) {
      expect(drawingShortcut(event('KeyZ', { [modifier]: true }))).toEqual({ action: 'undo' });
      expect(drawingShortcut(event('KeyZ', { [modifier]: true, shiftKey: true }))).toEqual({ action: 'redo' });
      expect(drawingShortcut(event('KeyY', { [modifier]: true }))).toEqual({ action: 'redo' });
      expect(drawingShortcut(event('KeyS', { [modifier]: true }))).toBeNull();
    }
    expect(drawingShortcut(event('KeyB', { altKey: true }))).toBeNull();
    expect(drawingShortcut(event('KeyB', { shiftKey: true }))).toBeNull();
  });
});
