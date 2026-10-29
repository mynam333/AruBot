const load = require('./helpers/load-source.cjs');
const { animateRouletteWheel, getRouletteMotionProfile } = load('src/components/rouletteMotion.ts');

describe('roulette wheel animation lifecycle', () => {
  const profile = getRouletteMotionProfile('studio');
  let originalWindow;

  beforeEach(() => {
    jest.useFakeTimers();
    originalWindow = global.window;
    global.window = {
      setTimeout, clearTimeout,
      requestAnimationFrame: callback => setTimeout(() => callback(performance.now()), 16),
      cancelAnimationFrame: clearTimeout,
    };
  });
  afterEach(() => {
    global.window = originalWindow;
    jest.useRealTimers();
  });

  function fixture(animate) {
    const wheel = { style: {}, animate };
    const finish = jest.fn();
    const cleanup = animateRouletteWheel(wheel, 30, 2345, 1000, profile, finish);
    return { wheel, finish, cleanup };
  }

  test.each(['missing', 'throwing'])('%s WAAPI uses continuous frames and settles once', mode => {
    const r = fixture(mode === 'throwing' ? () => { throw new Error('unsupported'); } : undefined);
    expect(r.wheel.style.transform).toBe('rotate(30deg)');
    jest.advanceTimersByTime(200);
    const first = r.wheel.style.transform;
    jest.advanceTimersByTime(200);
    expect(r.wheel.style.transform).not.toBe(first);
    expect(r.finish).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    expect(r.wheel.style.transform).toBe('rotate(2345deg)');
    expect(r.finish).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('native completion and its watchdog cannot finish the same spin twice', () => {
    const animation = { cancel: jest.fn(), onfinish: null, oncancel: null };
    const animate = jest.fn(() => animation);
    const r = fixture(animate);
    const frames = animate.mock.calls[0][0];
    expect(frames[0].transform).toBe('rotate(30deg)');
    expect(frames.at(-1).transform).toBe('rotate(2345deg)');
    jest.advanceTimersByTime(1000);
    const complete = animation.onfinish;
    complete();
    complete();
    jest.advanceTimersByTime(1000);
    expect(r.finish).toHaveBeenCalledTimes(1);
    expect(r.wheel.style.transform).toBe('rotate(2345deg)');
    expect(animation.cancel).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('external cancellation resumes at elapsed progress rather than rewinding', () => {
    const animation = { cancel: jest.fn(), onfinish: null, oncancel: null };
    const r = fixture(() => animation);
    jest.advanceTimersByTime(500);
    animation.oncancel();
    const angle = parseFloat(r.wheel.style.transform.slice(7));
    expect(angle).toBeGreaterThan(1000);
    jest.advanceTimersByTime(16);
    expect(parseFloat(r.wheel.style.transform.slice(7))).toBeGreaterThan(angle);
    jest.advanceTimersByTime(1000);
    expect(r.finish).toHaveBeenCalledTimes(1);
  });

  test('lost native finish events cannot lock the spin barrier forever', () => {
    const animation = { cancel: jest.fn(), onfinish: null, oncancel: null };
    const r = fixture(() => animation);
    jest.advanceTimersByTime(1249);
    expect(r.finish).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(r.finish).toHaveBeenCalledTimes(1);
    expect(r.wheel.style.transform).toBe('rotate(2345deg)');
  });

  test.each([true, false])('cleanup never reports an unmounted or replaced spin (native=%s)', native => {
    const animation = { cancel: jest.fn(), onfinish: null, oncancel: null };
    const r = fixture(native ? () => animation : undefined);
    const lateFinish = animation.onfinish;
    r.cleanup();
    r.cleanup();
    lateFinish?.();
    jest.advanceTimersByTime(2000);
    expect(r.finish).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    expect(animation.oncancel).toBeNull();
  });
});
