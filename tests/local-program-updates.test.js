const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { EventEmitter } = require('events');
const { spawnSync } = require('child_process');
const ts = require('typescript');

const main = fs.readFileSync(path.join(__dirname, '../local-program/main.cjs'), 'utf8');
const source = ts.createSourceFile('main.cjs', main, ts.ScriptTarget.Latest, true);
const functions = new Set([
  'dataPath', 'tempUpdatePath', 'readJson', 'writeJson', 'deleteJson', 'loadPendingUpdate',
  'persistPendingInstallerUpdate', 'clearPendingInstallerUpdate', 'readUpdateApplyResult',
  'writeUpdateApplyAttempt', 'clearUpdateApplyResult', 'cleanupInstallerFile', 'inspectLastUpdateApplyResult',
  'normalizeVersion', 'compareVersions', 'resolveManifestUrl', 'resolveDownloadUrl', 'getUpdaterFeedUrl',
  'configureAutoUpdater', 'checkForUpdatesWithElectronUpdater', 'downloadUpdateWithElectronUpdater',
  'fetchUpdateManifest', 'downloadInstaller', 'quotePowerShellString', 'getCurrentInstallDirectory',
  'scheduleSilentInstallerOnQuit', 'checkForLocalUpdates', 'prepareLocalUpdate', 'runStartupUpdate',
  'installLocalUpdate', 'handleUpdateInstallError', 'setUpdateState',
]);
const variables = new Set([
  'updateState', 'pendingInstallerUpdate', 'updateCheckPromise', 'updateDownloadPromise', 'updateInstallPromise',
  'electronUpdateReady', 'restartAfterUpdate', 'installerScheduled', 'updateQuitRequested', 'appQuitting',
]);
const implementation = source.statements.filter((node) =>
  ts.isFunctionDeclaration(node) ? functions.has(node.name?.text)
    : ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => variables.has(d.name.getText(source))),
).map((node) => node.getText(source)).join('\n');
const quitHook = source.statements.find((node) => node.getText(source).startsWith("app.on('will-quit'"));
const startupHook = source.statements.find((node) => node.getText(source).startsWith('app.whenReady().then'));
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arubot-updater-test-'));
  roots.push(root);
  const paths = { userData: path.join(root, 'data'), temp: options.unicode ? path.join(root, '업데이트 테스트') : root, exe: path.join(root, 'installed', 'AruBot.exe') };
  fs.mkdirSync(path.dirname(paths.exe), { recursive: true });
  fs.writeFileSync(paths.exe, 'not an executable');
  const bytes = Buffer.from('fixture installer, never executed');
  const manifest = { version: '1.1.0', url: 'https://release.test/installer.exe', fileName: 'AruBot-Local-Program-1.1.0.exe',
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'), ...options.manifest };
  const updater = new EventEmitter();
  updater.setFeedURL = jest.fn();
  updater.checkForUpdates = jest.fn(async () => {
    if (options.checkError) throw new Error('native check unavailable');
    updater.emit(options.current ? 'update-not-available' : 'update-available', { version: options.current ? '1.0.0' : '1.1.0' });
  });
  updater.downloadUpdate = jest.fn(async () => {
    if (options.downloadError) throw new Error('native download unavailable');
    updater.emit('download-progress', { percent: 50 });
    updater.emit('update-downloaded', { version: '1.1.0' });
  });
  updater.quitAndInstall = jest.fn();
  const app = new EventEmitter();
  app.isPackaged = options.packaged !== false;
  app.getVersion = () => options.version || '1.0.0';
  app.getPath = (key) => paths[key];
  app.quit = jest.fn();
  const immediates = [];
  const timeouts = [];
  const children = [];
  const context = vm.createContext({
    fs, path, crypto, Buffer, URL, AbortSignal,
    process: { platform: 'win32', pid: process.pid, execPath: paths.exe }, app, autoUpdater: updater,
    config: { updateManifestUrl: 'https://release.test/latest.json' }, mainWindow: {}, singleInstance: true,
    emitState: jest.fn(), addLog: jest.fn(), stopAgent: jest.fn(), avatarService: null, pngtuberService: null,
    fxAssetServer: { close: jest.fn(async () => {}) },
    setImmediate: (fn) => immediates.push(fn),
    setTimeout: (fn, delay) => { timeouts.push({ fn, delay }); return { unref() {} }; },
    dialog: { showMessageBox: jest.fn(async () => ({ response: options.confirm ? 0 : 1 })) },
    spawn: jest.fn(() => { const child = new EventEmitter(); child.unref = jest.fn(); children.push(child); return child; }),
    fetch: jest.fn(async (url) => ({ ok: true, json: async () => manifest, arrayBuffer: async () => bytes })),
  });
  vm.runInContext(`${implementation}\n${quitHook.getText(source)}\nautoUpdater.on('error', handleUpdateInstallError);`, context);
  return {
    root, context, updater, app, manifest, paths, children, timeouts,
    call: (name, ...args) => context[name](...args),
    state: () => vm.runInContext('({ ...updateState })', context),
    flushQuit: () => { for (const fn of immediates.splice(0)) fn(); },
    helper: () => fs.readFileSync(context.spawn.mock.calls[0][1].at(-1), 'utf8'),
  };
}

test('startup hook schedules a background download without needing any update IPC', async () => {
  const f = fixture();
  Object.assign(f.context, {
    loadConfig() {}, getFxViewerState: () => ({}), createWindow: jest.fn(), runStartupDiscoverySync: async () => {},
    AvatarService: class { start() { return Promise.resolve(); } },
    PngTuberService: class { start() { return Promise.resolve(); } }, requestObs: null, sendObsRequest() {},
  });
  const callback = startupHook.expression.arguments[0];
  vm.runInContext(`(${callback.getText(source)})()`, f.context);
  expect(f.context.createWindow).toHaveBeenCalledTimes(1);
  f.timeouts.find((timer) => timer.delay === 2500).fn();
  await f.call('prepareLocalUpdate');
  expect(f.state()).toMatchObject({ status: 'ready', readyToApply: true, downloaded: true });
  expect(f.updater.downloadUpdate).toHaveBeenCalledTimes(1);
  expect(f.updater.autoInstallOnAppQuit).toBe(true);
  expect(f.app.quit).not.toHaveBeenCalled();
  expect(f.context.dialog.showMessageBox).not.toHaveBeenCalled();
});

test('development launches do not download or install updates automatically', async () => {
  const f = fixture({ packaged: false });
  await f.call('runStartupUpdate');
  expect(f.updater.checkForUpdates).not.toHaveBeenCalled();
  expect(f.context.fetch).not.toHaveBeenCalled();
});

test('startup and manual downloads share one operation, and checks preserve a ready update', async () => {
  const f = fixture();
  await Promise.all([f.call('runStartupUpdate'), f.call('prepareLocalUpdate'), f.call('prepareLocalUpdate')]);
  const checked = await f.call('checkForLocalUpdates');
  expect(checked).toMatchObject({ status: 'ready', readyToApply: true });
  expect(f.updater.checkForUpdates).toHaveBeenCalledTimes(1);
  expect(f.updater.downloadUpdate).toHaveBeenCalledTimes(1);
  expect(f.context.fetch).not.toHaveBeenCalled();
});

test('checking during an active download cannot erase progress or start a second download', async () => {
  const f = fixture();
  f.updater.downloadUpdate.mockImplementation(async () => f.updater.emit('download-progress', { percent: 37 }));
  const preparing = f.call('prepareLocalUpdate');
  await new Promise(setImmediate);
  expect(await f.call('checkForLocalUpdates')).toMatchObject({ status: 'downloading', progress: { percent: 37 } });
  f.updater.emit('update-downloaded', { version: '1.1.0' });
  await preparing;
  expect(f.updater.checkForUpdates).toHaveBeenCalledTimes(1);
});

test('latest version never downloads or quits', async () => {
  const f = fixture({ current: true });
  await f.call('runStartupUpdate');
  await f.call('installLocalUpdate');
  f.flushQuit();
  expect(f.state()).toMatchObject({ status: 'idle', updateAvailable: false });
  expect(f.updater.downloadUpdate).not.toHaveBeenCalled();
  expect(f.app.quit).not.toHaveBeenCalled();
  expect(f.context.dialog.showMessageBox).not.toHaveBeenCalled();
});

test('a failed native retry does not reuse stale native metadata for a manifest download', async () => {
  const f = fixture({ downloadError: true, manifest: { sha256: '' } });
  await f.call('runStartupUpdate');
  expect(f.state().status).toBe('error');
  f.updater.checkForUpdates.mockRejectedValue(new Error('native feed temporarily unavailable'));
  f.manifest.sha256 = crypto.createHash('sha256').update('fixture installer, never executed').digest('hex');
  await f.call('prepareLocalUpdate');
  expect(f.updater.downloadUpdate).toHaveBeenCalledTimes(1);
  expect(f.state()).toMatchObject({ readyToApply: true, electronUpdater: false, manualInstaller: true });
});

test.each(['checkError', 'downloadError'])('%s falls back to verified, persisted installer without restarting', async (key) => {
  const f = fixture({ [key]: true });
  await f.call('runStartupUpdate');
  expect(f.state()).toMatchObject({ status: 'ready', manualInstaller: true, readyToApply: true });
  expect(f.updater.autoInstallOnAppQuit).toBe(false);
  const pending = JSON.parse(fs.readFileSync(path.join(f.paths.userData, 'pending-update.json'), 'utf8'));
  expect(pending.sha256).toBe(f.manifest.sha256);
  expect(fs.existsSync(pending.installerPath)).toBe(true);
  f.app.emit('will-quit');
  f.app.emit('will-quit');
  expect(f.context.spawn).toHaveBeenCalledTimes(1);
  expect(f.helper()).toContain('$restartAfterInstall = $false');
  expect(f.helper()).toContain('[System.Security.Cryptography.SHA256]::Create()');
  expect(f.helper()).toContain('-WindowStyle Hidden -Wait -PassThru -ErrorAction Stop');
  expect(f.helper().indexOf('Write-UpdateResult "finished"')).toBeLessThan(f.helper().indexOf('Start-Process -FilePath $launchPath'));
  expect(f.updater.quitAndInstall).not.toHaveBeenCalled();
});

test.each(['', 'a'.repeat(64)])('missing or mismatched checksum cannot schedule installation; retry works', async (sha256) => {
  const f = fixture({ checkError: true, manifest: { sha256 } });
  await f.call('runStartupUpdate');
  expect(f.state()).toMatchObject({ status: 'error', readyToApply: false });
  expect(f.call('scheduleSilentInstallerOnQuit')).toBe(false);
  f.manifest.sha256 = crypto.createHash('sha256').update('fixture installer, never executed').digest('hex');
  await f.call('prepareLocalUpdate');
  expect(f.state().readyToApply).toBe(true);
});

test('explicit installation downloads once, confirms once and requests native silent restart', async () => {
  const f = fixture({ confirm: true });
  await Promise.all([f.call('installLocalUpdate'), f.call('installLocalUpdate')]);
  expect(f.state().status).toBe('installing');
  expect(f.context.dialog.showMessageBox).toHaveBeenCalledTimes(1);
  expect(f.updater.downloadUpdate).toHaveBeenCalledTimes(1);
  expect(f.updater.quitAndInstall).not.toHaveBeenCalled();
  f.flushQuit();
  expect(f.updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  f.app.emit('will-quit');
  expect(f.context.spawn).not.toHaveBeenCalled();
});

test('postponing installation leaves the ready update available and does not interrupt playback', async () => {
  const f = fixture();
  await f.call('runStartupUpdate');
  await f.call('installLocalUpdate');
  f.flushQuit();
  expect(f.state().status).toBe('ready');
  expect(f.app.quit).not.toHaveBeenCalled();
  expect(f.updater.quitAndInstall).not.toHaveBeenCalled();
  expect(f.context.dialog.showMessageBox.mock.calls[0][1]).toMatchObject({ defaultId: 1, cancelId: 1 });
});

test('explicit fallback install restarts only after successful installer exit', async () => {
  const f = fixture({ checkError: true, confirm: true });
  await f.call('installLocalUpdate');
  f.flushQuit();
  expect(f.app.quit).toHaveBeenCalledTimes(1);
  f.app.emit('will-quit');
  expect(f.helper()).toContain('$restartAfterInstall = $true');
  expect(f.helper()).toContain('$restartAfterInstall -and $process.ExitCode -eq 0');
  expect(f.helper()).not.toContain('--force-run');
});

const windowsTest = process.platform === 'win32' ? test : test.skip;
windowsTest.each([
  { restart: false, exitCode: 0, tamper: false, calls: 'install', status: 'finished' },
  { restart: true, exitCode: 0, tamper: false, calls: 'install,restart', status: 'finished' },
  { restart: true, exitCode: 1, tamper: false, calls: 'install', status: 'finished' },
  { restart: true, exitCode: 0, tamper: true, calls: '', status: 'failed' },
])('PowerShell helper executes safely with mocked processes: %j', async ({ restart, exitCode, tamper, calls, status }) => {
  const f = fixture({ checkError: true, unicode: true });
  await f.call('prepareLocalUpdate');
  const pending = f.call('loadPendingUpdate');
  if (tamper) fs.writeFileSync(pending.installerPath, 'corrupted download');
  f.call('scheduleSilentInstallerOnQuit', { restart });
  const helperPath = f.context.spawn.mock.calls[0][1].at(-1);
  const callPath = path.join(f.root, 'process-calls.txt');
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  const prefix = [
    'function Get-Process { param($Id, $ErrorAction) return $null }',
    'function Start-Process {',
    '  param($FilePath, $ArgumentList, $WindowStyle, [switch] $Wait, [switch] $PassThru, $WorkingDirectory, $ErrorAction)',
    `  $callsPath = ${quote(callPath)}`,
    '  if ($Wait) {',
    '    [System.IO.File]::AppendAllText($callsPath, "install,")',
    `    return [pscustomobject]@{ ExitCode = ${exitCode} }`,
    '  }',
    '  $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json',
    '  if ($result.status -ne "finished") { throw "restart preceded the result write" }',
    '  [System.IO.File]::AppendAllText($callsPath, "restart,")',
    '}',
    '',
  ].join('\r\n');
  // Stub both process commands before executing the generated helper. No EXE is ever run.
  fs.writeFileSync(helperPath, '\uFEFF' + prefix + f.helper().replace(/^\uFEFF/, ''));
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helperPath], {
    encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  const actual = fs.existsSync(callPath) ? fs.readFileSync(callPath, 'utf8').replace(/,$/, '') : '';
  const applied = f.call('readUpdateApplyResult');
  expect({ calls: actual, status: applied.status, error: applied.status === 'failed' && !tamper ? applied.message : null })
    .toEqual({ calls, status, error: null });
});

test('pending fallback installer survives restart without another download', async () => {
  const f = fixture({ checkError: true });
  await f.call('prepareLocalUpdate');
  vm.runInContext('pendingInstallerUpdate = null; updateState = { status: "idle" };', f.context);
  expect(f.call('loadPendingUpdate')).not.toBeNull();
  const requests = f.context.fetch.mock.calls.length;
  await f.call('runStartupUpdate');
  expect(f.state()).toMatchObject({ readyToApply: true, manualInstaller: true });
  expect(f.context.fetch).toHaveBeenCalledTimes(requests);
});

test('deleted installer produces a retryable error instead of closing the program', async () => {
  const f = fixture({ checkError: true, confirm: true });
  await f.call('prepareLocalUpdate');
  const pending = f.call('loadPendingUpdate');
  fs.unlinkSync(pending.installerPath);
  await expect(f.call('installLocalUpdate')).rejects.toThrow('설치 파일이 없어졌습니다');
  f.flushQuit();
  expect(f.state()).toMatchObject({ status: 'error', readyToApply: false });
  expect(f.app.quit).not.toHaveBeenCalled();
});

test('native install errors remain visible and allow another explicit attempt', async () => {
  const f = fixture({ confirm: true });
  await f.call('installLocalUpdate');
  f.flushQuit();
  f.updater.emit('error', new Error('installer could not launch'));
  expect(f.state()).toMatchObject({ status: 'error', readyToApply: true, error: 'installer could not launch' });
  await f.call('installLocalUpdate');
  f.flushQuit();
  expect(f.updater.quitAndInstall).toHaveBeenCalledTimes(2);
});

test('PowerShell UTF-8 BOM results are read and successful installation is reconciled', () => {
  const f = fixture({ version: '1.1.0' });
  fs.mkdirSync(f.paths.userData);
  fs.writeFileSync(path.join(f.paths.userData, 'update-apply-result.json'), '\uFEFF' + JSON.stringify({ latestVersion: '1.1.0', status: 'finished' }));
  expect(f.call('inspectLastUpdateApplyResult').applied).toBe(true);
  expect(f.state()).toMatchObject({ status: 'idle', updateAvailable: false, readyToApply: false });
});

test('an app already quitting cannot start a delayed startup download', async () => {
  const f = fixture();
  f.app.emit('will-quit');
  await f.call('runStartupUpdate');
  expect(f.updater.checkForUpdates).not.toHaveBeenCalled();
});

test('update UI preserves a ready install button and displays installing/error ahead of ready', () => {
  const renderer = ts.createSourceFile('renderer.js', fs.readFileSync(path.join(__dirname, '../local-program/renderer/renderer.js'), 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = renderer.statements.find((node) => ts.isFunctionDeclaration(node) && node.name.text === 'renderUpdateState');
  const elements = new Map();
  const context = vm.createContext({ $: (selector) => {
    if (!elements.has(selector)) elements.set(selector, {});
    return elements.get(selector);
  } });
  vm.runInContext(`let latestUpdate = null; let updateActionPending = false; ${declaration.getText(renderer)}`, context);
  context.renderUpdateState({ status: 'ready', readyToApply: true, updateAvailable: true });
  expect(elements.get('#installUpdateButton')).toMatchObject({ disabled: false, textContent: '설치 후 다시 시작' });
  context.renderUpdateState({ status: 'installing', readyToApply: true });
  expect(elements.get('#installUpdateButton').disabled).toBe(true);
  expect(elements.get('#updateStatusText').textContent).toContain('자동으로 다시 시작');
  context.renderUpdateState({ status: 'error', readyToApply: true, error: 'disk full' });
  expect(elements.get('#updateStatusText').textContent).toContain('disk full');
  expect(elements.get('#installUpdateButton').disabled).toBe(false);
  context.renderUpdateState({ status: 'downloading', updateAvailable: true });
  expect(elements.get('#installUpdateButton').disabled).toBe(true);
  expect(elements.get('#updateStatusText').textContent).toContain('다운로드');
});
