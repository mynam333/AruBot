const loadSource = require('./helpers/load-source.cjs');

function controls() {
  const states = [], effects = [], listeners = new Map();
  let index = 0;
  const element = { contains: (target) => target === element, getBoundingClientRect: () => ({ left: 200, right: 400, top: 10, bottom: 50 }) };
  const target = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
  };
  global.window = target; global.document = { documentElement: target };
  const { DrawingHoverControls } = loadSource('src/components/drawing/DrawingHoverControls.tsx', {
    react: {
      useRef: () => ({ current: element }),
      useState: (initial) => { const i = index++; if (states[i] === undefined) states[i] = initial; return [states[i], (value) => { states[i] = value; }]; },
      useEffect: (effect) => { if (!effects.length) effects.push(effect); },
    },
  });
  const render = () => { index = 0; return DrawingHoverControls({ children: 'controls' }).props; };
  render(); const cleanup = effects[0]();
  return {
    render, element, cleanup, listeners,
    event: (name, overrides = {}) => listeners.get(name)?.({ pointerId: 1, clientX: 300, clientY: 30, buttons: 0, target: null, ...overrides }),
  };
}

afterEach(() => { delete global.window; delete global.document; });

test('audio controls appear only on idle hover and never intercept a drawing gesture', () => {
  const h = controls();
  expect(h.render()['data-visible']).toBe(false);
  h.event('pointermove'); expect(h.render()['data-visible']).toBe(true);
  h.event('pointermove', { clientX: 100 }); expect(h.render()['data-visible']).toBe(false);
  h.event('pointerdown', { clientX: 100, buttons: 1 });
  h.event('pointermove', { buttons: 1 });
  expect(h.render().className).toContain('pointer-events-none'); expect(h.render()['data-visible']).toBe(false);
  h.event('pointerup'); expect(h.render()['data-visible']).toBe(true);
  h.event('pointermove', { buttons: 1 }); expect(h.render()['data-visible']).toBe(false);
  h.cleanup(); expect(h.listeners.size).toBe(0);
});

test('volume slider dragging stays visible until release, then hides outside its bounds', () => {
  const h = controls();
  h.event('pointermove'); h.event('pointerdown', { buttons: 1, target: h.element });
  h.event('pointermove', { clientX: 450, buttons: 1 }); expect(h.render()['data-visible']).toBe(true);
  h.event('pointerup', { clientX: 450 }); expect(h.render()['data-visible']).toBe(false);
  h.event('pointermove'); h.event('pointercancel'); expect(h.render()['data-visible']).toBe(false);
  h.event('pointermove'); h.event('pointerleave'); expect(h.render()['data-visible']).toBe(false);
  h.event('pointermove'); h.event('scroll'); expect(h.render()['data-visible']).toBe(false);
  h.cleanup();
});

test('keyboard focus reveals controls, while pointer cancellation and blur clear drag state', () => {
  const h = controls();
  h.render().onFocusCapture({ target: { matches: () => true } }); expect(h.render()['data-visible']).toBe(true);
  h.render().onBlurCapture({ currentTarget: h.element, relatedTarget: null }); expect(h.render()['data-visible']).toBe(false);
  h.event('pointerdown', { buttons: 1 }); h.event('pointerdown', { pointerId: 2, buttons: 1 });
  h.event('pointerup'); expect(h.render()['data-visible']).toBe(false);
  h.event('pointercancel', { pointerId: 2 }); h.event('pointermove'); expect(h.render()['data-visible']).toBe(true);
  h.event('blur'); expect(h.render()['data-visible']).toBe(false);
  h.cleanup();
});
