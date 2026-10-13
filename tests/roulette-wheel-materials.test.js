const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./helpers/load-source.cjs');
const utils = load('src/components/rouletteWheelUtils.ts');
const skins = load('src/components/rouletteWheelSkins.tsx', { react: { ...React, default: React }, './rouletteWheelUtils': utils });
const themes = ['studio', 'prism', 'aurora', 'velvet', 'mono', 'deco', 'crystal', 'ink', 'nova', 'ceramic', 'arcade', 'sakura', 'ocean', 'solar', 'cyber', 'gold'];
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

describe('roulette material detailing', () => {
  test.each(themes)('%s preserves weighted geometry and resolves every paint reference', themeId => {
    const props = { themeId, family: 'mono', palette: ['#fff', '#202629'], segmentCount: 4, weights: [0, 1, 2, 5], selectedIndex: 2 };
    const markup = renderToStaticMarkup(React.createElement(React.Fragment, null,
      ...[skins.WheelSegmentsSvg, skins.WheelSkinOrnaments, skins.WheelSelectedSegment, skins.WheelPointer].map((Component, key) => React.createElement(Component, { ...props, key }))));
    const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, id] of markup.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(id);
    expect(markup).not.toMatch(/NaN|Infinity|feTurbulence|<animate/);
    expect(markup).not.toContain('data-wheel-segment-index="0"');
    for (const [index, segment] of utils.createWheelSegments(4, props.weights).entries()) {
      if (!segment.span) continue;
      expect(markup).toContain(`data-wheel-segment-index="${index}" data-wheel-segment-start="${segment.start}" data-wheel-segment-end="${segment.end}"`);
    }
    expect(markup).toContain('viewBox="0 0 180 200"');
    if (themeId === 'mono' || themeId === 'ink') expect(markup).not.toMatch(/<linearGradient|<radialGradient/);
  });

  test.each([[1, [1]], [3, [0, 7, 0]], [2, [1e-8, 1]], [64, undefined]])('renders stable sparse, tiny and dense sectors (%s)', (segmentCount, weights) => {
    const markup = render(skins.WheelSegmentsSvg, { family: 'mono', themeId: 'crystal', palette: ['#fff'], segmentCount, weights });
    expect(markup).not.toMatch(/NaN|Infinity/);
    expect((markup.match(/data-wheel-segment-index=/g) || []).length).toBe(utils.createWheelSegments(segmentCount, weights).filter(segment => segment.span > 0).length);
  });

  test('keeps invalid and zero-weight selections hidden', () => {
    for (const selectedIndex of [-1, 0, 3, NaN]) expect(render(skins.WheelSelectedSegment, { selectedIndex, segmentCount: 3, weights: [0, 1, 2] })).toBe('');
  });

  test.each(['mono', 'ink', 'arcade', 'cyber'])('%s sector faces remain matte', themeId => {
    const markup = render(skins.WheelSegmentsSvg, { family: 'mono', themeId, palette: ['#fff'], segmentCount: 6 });
    expect(markup).not.toMatch(/<linearGradient|<radialGradient/);
  });

  test('cyber rim details use segmented circuitry without metallic gradients', () => {
    const markup = render(skins.WheelSkinOrnaments, { family: 'mono', themeId: 'cyber' });
    expect(markup).not.toMatch(/<linearGradient|<radialGradient/);
    expect(markup).toContain('data-wheel-rim-finish="cyber"');
  });

  test.each([[1, [1], 0], [3, [0, 7, 0], 1]])('full-circle selection has no radial seam (%s)', (segmentCount, weights, selectedIndex) => {
    const markup = render(skins.WheelSelectedSegment, { themeId: 'gold', segmentCount, weights, selectedIndex });
    const paths = [...markup.matchAll(/<path d="([^"]+)"/g)].map(match => match[1]);
    for (const path of paths.slice(0, -1)) {
      expect(path).toMatch(/^M500 /);
      expect(path).not.toMatch(/L/);
    }
  });
});
