const fs = require('fs');
const path = require('path');

const root = process.cwd();

describe('action blueprint node editor regressions', () => {
  const blueprintPage = fs.readFileSync(path.join(root, 'src', 'features', 'admin', 'action-blueprint-page.tsx'), 'utf8');
  const fxOverlay = fs.readFileSync(path.join(root, 'src', 'components', 'FxOverlay.tsx'), 'utf8');
  const serverIndex = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
  const localProgram = fs.readFileSync(path.join(root, 'local-program', 'main.cjs'), 'utf8');

  test('FX node editor exposes custom CSS and CSS class fields used by the overlay', () => {
    const fxEditorStart = blueprintPage.indexOf("if (node.type === 'fx')");
    const fxEditorEnd = blueprintPage.indexOf("if (node.type === 'overlay')", fxEditorStart);
    const fxEditor = blueprintPage.slice(fxEditorStart, fxEditorEnd);

    expect(fxEditor).toContain('label="적용할 CSS 키"');
    expect(fxEditor).toContain("onChange('animationKey', value)");
    expect(fxEditor).toContain('label="CSS 코드"');
    expect(fxEditor).toContain("onChange('cssCode', value)");
    expect(fxOverlay).toContain('{item.cssCode ? <style>{item.cssCode}</style> : null}');
    expect(serverIndex).toContain('cssCode: normalizeFxCssCode(input.cssCode)');
  });

  test('FX kind can remain blank in the node editor', () => {
    const fxEditorStart = blueprintPage.indexOf("if (node.type === 'fx')");
    const fxEditorEnd = blueprintPage.indexOf("if (node.type === 'overlay')", fxEditorStart);
    const fxEditor = blueprintPage.slice(fxEditorStart, fxEditorEnd);

    expect(fxEditor).toContain("const kind = typeof cfg.kind === 'string' ? cfg.kind : 'image'");
    expect(fxEditor).toContain('placeholder="비워두거나 image, sticker, video, sound"');
    expect(fxEditor).toContain('const assets = normalizedKind');
    expect(fxEditor).toContain("onChange('assetKind', asset?.kind || '')");
    expect(serverIndex).toContain("String(input.kind || input.type || input.assetKind || 'image').toLowerCase()");
    expect(localProgram).toContain("String(payload.kind || payload.assetKind || (type.includes('sound') ? 'sound' : 'image')).toLowerCase()");
  });

  test('node edit modal shows output variables and node cards no longer claim selection opens all variables', () => {
    const modalStart = blueprintPage.indexOf('<Dialog.Root open={!!editingNode}');
    const modalEnd = blueprintPage.indexOf('</Dialog.Root>', modalStart);
    const modal = blueprintPage.slice(modalStart, modalEnd);

    expect(modal).toContain('<NodeReferencePanel node={editingNode} />');
    expect(blueprintPage).not.toContain('선택하면 전체 확인');
  });
});
