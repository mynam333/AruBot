const React = require('react');
const load = require('./load-source.cjs');

const themeIds = ['studio', 'prism', 'aurora', 'velvet', 'mono', 'deco', 'crystal', 'ink', 'nova', 'ceramic', 'arcade', 'sakura', 'ocean', 'solar', 'cyber', 'gold'];

module.exports = function loadRouletteThemes() {
  const imports = {
    react: { ...React, default: React },
    './geometry': load('src/components/rouletteThemes/geometry.ts'),
  };
  const registryImports = { '../rouletteWheelUtils': load('src/components/rouletteWheelUtils.ts') };
  for (const id of themeIds) {
    registryImports[`./${id}`] = load(`src/components/rouletteThemes/${id}.tsx`, { ...imports, [`./${id}.css`]: {} });
  }
  return load('src/components/rouletteThemes/index.ts', registryImports);
};
