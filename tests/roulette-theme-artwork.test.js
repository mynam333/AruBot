const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const postcss = require('postcss');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./helpers/load-source.cjs');
const { rouletteThemeArtworks, getRouletteThemeArtwork } = require('./helpers/load-roulette-themes.cjs')();
const { getRouletteThemeMaterial } = load('src/components/rouletteThemeMaterials.ts');
const themes = ['studio', 'prism', 'aurora', 'velvet', 'mono', 'deco', 'crystal', 'ink', 'nova', 'ceramic', 'arcade', 'sakura', 'ocean', 'solar', 'cyber', 'gold'];
const svg = node => renderToStaticMarkup(React.createElement('svg', { viewBox: '0 0 1000 1000' }, node));

describe('independent roulette theme artwork', () => {
  test('registers all existing themes without changing legacy IDs', () => {
    expect(Object.keys(rouletteThemeArtworks)).toEqual(themes);
    for (const [legacy, current] of Object.entries({ classic: 'studio', pastel: 'prism', forest: 'aurora', midnight: 'mono', ice: 'ocean', fire: 'solar', sunset: 'solar' })) {
      expect(getRouletteThemeArtwork(legacy)).toBe(rouletteThemeArtworks[current]);
    }
    expect(getRouletteThemeArtwork('unknown')).toBe(rouletteThemeArtworks.studio);
  });

  test.each(themes)('%s supplies complete distinct artwork with isolated paint IDs', id => {
    const art = getRouletteThemeArtwork(id);
    expect(art.id).toBe(id);
    expect(art.designNotes.length).toBeGreaterThan(30);
    expect(art.palette).toHaveLength(6);
    expect(art.palette.every(color => /^#[0-9a-f]{6}$/i.test(color))).toBe(true);
    const rims = [];
    for (const prefix of ['first', 'second']) {
      const rim = svg(art.rim(prefix + '-rim'));
      expect((rim.match(/<[a-z]/g) || []).length).toBeLessThan(350);
      rims.push(rim + svg(art.pointer(prefix + '-pointer')));
    }
    const markup = rims.join('');
    const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    expect(ids.length).toBe(new Set(ids).size);
    expect(ids.every(value => /^(first|second)-(rim|pointer)-/.test(value))).toBe(true);
    for (const [, reference] of markup.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(reference);
    expect(markup).not.toMatch(/NaN|Infinity|<filter|<foreignObject|<animate|<text/);
    for (const part of ['panel', 'hub', 'swatch']) {
      const small = svg(art[part]);
      expect(small.length).toBeGreaterThan(80);
      expect(small).not.toMatch(/\bid=|url\(#|<text|NaN|Infinity/);
    }
  });

  test.each(themes)('%s material overrides preserve shared metadata and do not mutate defaults', id => {
    const original = getRouletteThemeMaterial(id);
    const snapshot = JSON.stringify(original);
    const art = getRouletteThemeArtwork(id);
    const material = getRouletteThemeMaterial(id, art);
    expect(material.palette).toBe(art.palette);
    expect(material.atmosphere).toBe(original.atmosphere);
    expect(material.family).toBe(original.family);
    expect(material.css).toEqual({ ...original.css, ...art.tokens });
    expect(JSON.stringify(getRouletteThemeMaterial(id))).toBe(snapshot);
  });

  test('has unique silhouettes and keeps theme CSS isolated', () => {
    expect(new Set(themes.map(id => svg(rouletteThemeArtworks[id].rim('same')))).size).toBe(themes.length);
    for (const id of themes) {
      const filename = path.join(__dirname, '..', 'src', 'components', 'rouletteThemes', `${id}.css`);
      if (!fs.existsSync(filename)) continue;
      const source = fs.readFileSync(filename, 'utf8');
      postcss.parse(source).walkRules(rule => {
        if (rule.parent.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
        for (const selector of rule.selectors) {
          expect(selector.trim().startsWith(`.roulette-presentation[data-roulette-theme='${id}']`)).toBe(true);
        }
      });
    }
  });
});
