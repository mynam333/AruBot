const fs = require('fs');
const path = require('path');

describe('roulette overlay startup regression', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const viewer = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'RouletteViewer.tsx'), 'utf8');
  const viewerBodyClass = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'viewer', 'viewer-body-class.tsx'), 'utf8');
  const globals = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'globals.css'), 'utf8');

  test('stored roulette result is marked as history and cannot trigger a spin on connect', () => {
    const websocketStart = serverIndex.indexOf('// Send current stored result if exists');
    const websocketEnd = serverIndex.indexOf('// Keepalive', websocketStart);
    expect(serverIndex.slice(websocketStart, websocketEnd)).toContain('initialSnapshot: true');
    expect(viewer).toContain('initialSnapshot?: boolean');
    expect(viewer).toContain('if (data.initialSnapshot === true)');
    expect(viewer.indexOf('if (data.initialSnapshot === true)')).toBeLessThan(viewer.indexOf('// 유효한 룰렛 메시지로 판단'));
  });

  test('viewer route makes both document surfaces transparent for OBS', () => {
    expect(viewerBodyClass).toContain("root.classList.add('arubot-viewer-root')");
    expect(viewerBodyClass).toContain("root.style.background = 'transparent'");
    expect(viewerBodyClass).toContain("document.body.style.background = 'transparent'");
    expect(globals).toContain('html.arubot-viewer-root');
    expect(globals).toContain('html:has(body .viewer-route)');
    expect(globals).toContain('background-color: transparent !important');
  });
});
