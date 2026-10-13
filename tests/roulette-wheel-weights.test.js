const load = require('./helpers/load-source.cjs');
const { createWheelSegments } = load('src/components/rouletteWheelUtils.ts');

describe('weighted roulette wheel geometry', () => {
  test('keeps the equal-sector API when weights are omitted', () => {
    expect(createWheelSegments(4)).toEqual([
      { start: 0, end: 90, span: 90, center: 45 },
      { start: 90, end: 180, span: 90, center: 135 },
      { start: 180, end: 270, span: 90, center: 225 },
      { start: 270, end: 360, span: 90, center: 315 },
    ]);
  });

  test('uses proportional clockwise sectors from twelve oclock', () => {
    const expected = [
      { start: 0, end: 45, span: 45, center: 22.5 },
      { start: 45, end: 135, span: 90, center: 90 },
      { start: 135, end: 360, span: 225, center: 247.5 },
    ];
    createWheelSegments(3, [1, 2, 5]).forEach((segment, index) => {
      for (const field of ['start', 'end', 'span', 'center']) expect(segment[field]).toBeCloseTo(expected[index][field], 10);
    });
  });

  test('preserves zero-width indices without giving them a minimum slice', () => {
    expect(createWheelSegments(5, [0, 1, 0, 3, 0])).toEqual([
      { start: 0, end: 0, span: 0, center: 0 },
      { start: 0, end: 90, span: 90, center: 45 },
      { start: 90, end: 90, span: 0, center: 90 },
      { start: 90, end: 360, span: 270, center: 225 },
      { start: 360, end: 360, span: 0, center: 360 },
    ]);
  });

  test.each([
    ['wrong length', [1, 2]],
    ['empty array', []],
    ['all zero', [0, -0, 0]],
    ['negative', [1, -1, 2]],
    ['nan', [1, NaN, 2]],
    ['infinity', [1, Infinity, 2]],
    ['negative infinity', [1, -Infinity, 2]],
    ['string', [1, '2', 3]],
    ['null entry', [1, null, 3]],
    ['undefined entry', [1, undefined, 3]],
    ['sparse array', Array(3)],
    ['not an array', { 0: 1, 1: 2, 2: 3, length: 3 }],
    ['null weights', null],
  ])('falls back to equal sectors for %s', (_name, weights) => {
    expect(createWheelSegments(3, weights)).toEqual(createWheelSegments(3));
  });

  test('one positive weight takes the full circle even between zero-weight entries', () => {
    expect(createWheelSegments(3, [0, 7, 0])[1]).toEqual({ start: 0, end: 360, span: 360, center: 180 });
    expect(createWheelSegments(1, [5])).toEqual([{ start: 0, end: 360, span: 360, center: 180 }]);
    expect(createWheelSegments(2, [1, 1]).map((segment) => segment.span)).toEqual([180, 180]);
  });

  test('scales large finite weights before summing', () => {
    const expected = createWheelSegments(3, [1, Number.MAX_VALUE / 1e308, 1]);
    createWheelSegments(3, [1e308, Number.MAX_VALUE, 1e308])
      .forEach((segment, index) => expect(segment.span).toBeCloseTo(expected[index].span, 10));
    expect(createWheelSegments(2, [Number.MAX_VALUE, Number.MAX_VALUE]).map((segment) => segment.span)).toEqual([180, 180]);
  });

  test('accepts tiny finite values without inventing a minimum width', () => {
    const tiny = createWheelSegments(2, [1e-8, 1])[0];
    expect(tiny.span).toBeGreaterThan(0);
    expect(tiny.span).toBeLessThan(.00001);
    expect(tiny.span).toBeCloseTo(360e-8 / (1 + 1e-8), 12);
    const subnormal = createWheelSegments(3, [Number.MIN_VALUE, Number.MIN_VALUE * 2, Number.MIN_VALUE * 3]);
    subnormal.forEach((segment, index) => expect(segment.span).toBeCloseTo(60 * (index + 1), 10));
  });

  test('keeps every boundary contiguous for many mixed weights', () => {
    const weights = Array.from({ length: 1000 }, (_, index) => index % 7 === 0 ? 0 : (index % 31 + 1) / 7);
    const total = weights.reduce((sum, value) => sum + value, 0);
    const segments = createWheelSegments(weights.length, weights);
    expect(segments).toHaveLength(weights.length);
    expect(segments.at(-1).end).toBe(360);
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      expect(segment.start).toBe(index === 0 ? 0 : segments[index - 1].end);
      expect(segment.end).toBeGreaterThanOrEqual(segment.start);
      expect(segment.span).toBeCloseTo(weights[index] / total * 360, 10);
      expect(segment.center).toBe(segment.start + segment.span / 2);
      if (!weights[index]) expect(segment.span).toBe(0);
    }
  });

  test.each([0, -1, NaN, Infinity])('returns no segments for an invalid/empty count %s', (count) => {
    expect(createWheelSegments(count)).toEqual([]);
  });
});
