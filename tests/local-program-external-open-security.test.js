const fs = require('fs');
const path = require('path');

const root = process.cwd();

describe('local program external URL hardening', () => {
  test('renderer preload does not expose a generic external opener', () => {
    const preload = fs.readFileSync(path.join(root, 'local-program', 'preload.cjs'), 'utf8');

    expect(preload).not.toContain('external:open');
    expect(preload).not.toContain('openExternal:');
    expect(preload).toContain('openDashboard');
  });

  test('main process only opens validated http dashboard URLs', () => {
    const main = fs.readFileSync(path.join(root, 'local-program', 'main.cjs'), 'utf8');

    expect(main).not.toContain("ipcMain.handle('external:open'");
    expect(main).toContain('function getSafeExternalHttpUrl');
    expect(main).toContain("['https:', 'http:'].includes(url.protocol)");
    expect(main).toContain('shell.openExternal(getSafeExternalHttpUrl');
  });
});
