const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.join(__dirname, '..');
const featureRoot = path.join(root, 'src/features/admin');
const features = ['connection-page', 'commands-page', 'points-page', 'macros-page', 'roulette-page',
  'video-donation-queue-page', 'drawing-donation-page', 'donation-rules-page', 'predictions-page',
  'automations-page', 'action-blueprint-page', 'event-logs-page', 'participation-wheel-page',
  'dashboard-page', 'admin-action-dialogs', 'macro-create-dialog', 'viewer-token-panel'];
const source = (name) => fs.readFileSync(path.join(featureRoot, `${name}.tsx`), 'utf8');
const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true };
let access;
const cache = new Map();

function setAccess(role, scopes = []) {
  const permitted = (module, mode) => role !== 'manager' || scopes.includes('*')
    || scopes.includes(`${module}:${mode}`) || (mode === 'read' && scopes.includes(`${module}:write`));
  access = { active: { ownerUserId: 'owner', role, scopes }, canRead: (module) => permitted(module, 'read'),
    canWrite: (module) => permitted(module, 'write'), canManageMembers: role !== 'manager' };
}

function loadFile(filename, extraExports = '') {
  const key = `${filename}:${extraExports}`;
  if (cache.has(key)) return cache.get(key);
  const module = { exports: {} };
  cache.set(key, module.exports);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8') + extraExports, { compilerOptions }).outputText;
  vm.runInNewContext(compiled, {
    module, exports: module.exports, console, URL, URLSearchParams, AbortController, DOMException,
    process, setTimeout, clearTimeout, setInterval, clearInterval,
    require(name) {
      if (name === '@/components/app-shell/bot-channel-provider') return { useBotChannel: () => access };
      if (name === '@/shared/api/http') return { apiUrl: (value) => value, apiWsUrl: (value) => value,
        readJson: () => { throw new Error('Unexpected network during render'); } };
      if (name.endsWith('.css')) return new Proxy({}, { get: (_target, key) => String(key) });
      if (name === '@/components/drawing/DrawingArchiveDialog') return { DrawingArchiveDialog: () => null };
      if (name.startsWith('@/shared/drawing/')) return {};
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(filename), name);
        const resolved = [base, `${base}.tsx`, `${base}.ts`, `${base}.js`, path.join(base, 'index.ts')]
          .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (!resolved) throw new Error(`Cannot resolve ${name}`);
        return loadFile(resolved);
      }
      return require(name);
    },
  }, { filename });
  return module.exports;
}

function render(name, component, props = {}, extraExports = '') {
  const exported = loadFile(path.join(featureRoot, `${name}.tsx`), extraExports);
  return renderToStaticMarkup(React.createElement(exported[component], props));
}

function button(html, label) {
  return [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
    .map((match) => match[0]).find((value) => value.replace(/<[^>]*>/g, '').includes(label));
}

function callback(name, callbackName, globals = {}) {
  const text = source(name);
  const ast = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === callbackName) {
      found = node.initializer;
      if (ts.isCallExpression(found)) found = found.arguments[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!found) throw new Error(`Missing ${callbackName}`);
  const compiled = ts.transpileModule(`const handler = ${found.getText(ast)};`, { compilerOptions }).outputText;
  return vm.runInNewContext(`${compiled}\nhandler`, { writable: false, ownerControls: false, ...globals });
}

describe('Delegated feature controls', () => {
  beforeEach(() => setAccess('manager', ['commands:read']));

  test('read-only command search and attendance inspection remain available', () => {
    const html = render('commands-page', 'CommandsPage');
    expect(button(html, '명령어 만들기')).toContain('disabled=""');
    expect(button(html, '새로고침')).not.toContain('disabled=""');
    expect(button(html, '출석 설정')).not.toContain('disabled=""');
    expect(html.match(/<input[^>]+placeholder="명령어, 이름, 답변으로 찾기"[^>]*>/)?.[0]).not.toContain('disabled=""');
  });

  test.each(['owner', 'site_admin'])('%s retains command creation', (role) => {
    setAccess(role);
    expect(button(render('commands-page', 'CommandsPage'), '명령어 만들기')).not.toContain('disabled=""');
  });

  test('full manager can operate but cannot access OAuth or overlay credentials', () => {
    setAccess('manager', ['*']);
    expect(button(render('commands-page', 'CommandsPage'), '명령어 만들기')).not.toContain('disabled=""');
    const html = render('connection-page', 'ConnectionPage');
    expect(html).not.toMatch(/href="[^\"]*\/api\/auth\//);
    expect(html).not.toContain('YouTube로 시작');
    expect(render('viewer-token-panel', 'ViewerTokenPanel', { title: 'OBS', description: 'url', endpoint: '/api/roulette/viewer-url' })).toBe('');
  });

  test('read-only queue rows prohibit drag, skip, delete, and refund', () => {
    setAccess('manager', ['video:read']);
    const html = render('video-donation-queue-page', 'VideoDonationItemCard', {
      item: { id: 'v1', title: 'Video', provider: 'youtube', videoId: 'video123', cost: 10 },
      current: true, draggable: true, onDelete() {}, onRefundDelete() {}, onSkip() {},
    }, '\nexport { VideoDonationItemCard };');
    expect(html).toContain('draggable="false"');
    expect(button(html, '삭제')).toContain('disabled=""');
    expect(button(html, '반환')).toContain('disabled=""');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="현재 영상 스킵"/);
  });

  test('read-only event logs cannot replay effects', () => {
    setAccess('manager', ['logs:read']);
    const html = render('event-logs-page', 'LogCard', {
      log: { id: 'log', category: 'drawing_donation', metadata: { drawingId: 'drawing' } }, onReplay() {},
    }, '\nexport { LogCard };');
    expect(button(html, '그림 재생')).toContain('disabled=""');
  });

  test('read-only donation settings remain inspectable while creation is disabled', () => {
    setAccess('manager', ['donations:read']);
    expect(button(render('admin-action-dialogs', 'DonationSettingsDialog'), '후원 설정')).not.toContain('disabled=""');
    expect(button(render('admin-action-dialogs', 'DonationRuleCreateDialog'), '반응 만들기')).toContain('disabled=""');
    expect(button(render('macro-create-dialog', 'MacroCreateDialog'), '알림 만들기')).toContain('disabled=""');
  });

  test.each([
    ['commands-page', ['saveEdit', 'removeRule', 'saveAttendanceSettings']],
    ['points-page', ['savePoints', 'adjustPoints', 'deletePoints', 'savePointSettings']],
    ['macros-page', ['save', 'remove']],
    ['donation-rules-page', ['saveEdit', 'removeRule']],
    ['video-donation-queue-page', ['persistOrder', 'moveWaitingItem', 'removeItem', 'controlPlayback', 'applyVolume']],
    ['drawing-donation-page', ['saveSettings', 'runItemAction', 'removeItem', 'moveItem', 'moderateBlock']],
    ['predictions-page', ['create', 'action']],
    ['participation-wheel-page', ['perform', 'changeDraft']],
    ['action-blueprint-page', ['save', 'publish', 'testRun', 'deleteBlueprint', 'restoreVersion', 'addNode', 'pasteSelection', 'undoBlueprint']],
    ['automations-page', ['saveSettings', 'discoverObs', 'runObsAction', 'testTts', 'runNetwork', 'uploadSound', 'deleteSound']],
    ['event-logs-page', ['replay']],
  ])('%s mutation handlers stop before touching state or network in read-only mode', async (name, handlers) => {
    for (const handler of handlers) expect(await callback(name, handler)()).toBeUndefined();
  });

  test('owner-only handlers also stop before reading state or network for a full manager', async () => {
    for (const name of ['revoke', 'registerYoutubeChannel', 'removeYoutubeChannel', 'confirmYoutubeConsent']) {
      expect(await callback('connection-page', name, { writable: true })()).toBeUndefined();
    }
    for (const name of ['createControlLink', 'createLocalProgramToken', 'rotateLocalProgramToken', 'loadFxViewerUrl']) {
      expect(await callback('automations-page', name, { writable: true })()).toBeUndefined();
    }
  });

  test('limited dashboard fetches base profile/status only, not inaccessible module data', async () => {
    const requests = [];
    const noop = () => {};
    const load = callback('dashboard-page', 'loadDashboard', {
      connectionReadable: false, settingsReadable: false, commandsReadable: false, videoReadable: false,
      hasLoadedRef: { current: false }, setRefreshing: noop, setLoading: noop, setPendingDetails: noop,
      setError: noop, setDashboardData: noop, DOMException,
      readJsonResult: async (url) => { requests.push(url); return { ok: true, data: { platforms: [{ provider: 'chzzk' }] } }; },
    });
    await load();
    expect(requests).toEqual(['/api/account/platforms', '/api/platforms/status?refresh=true']);
  });

  test('drawing review is not blocked by an unrelated denied lookup or owner-only viewer URL', async () => {
    const requests = [];
    const noop = () => {};
    const load = callback('drawing-donation-page', 'refresh', {
      blocksReadable: false, ownerControls: false, defaultSettings: { canvas: {} },
      setSettings: noop, setItems: noop, setBlockedUsers: noop, setOverlayPath: noop, setViewerDonationPath: noop,
      readJson: async (url) => { requests.push(url); return url.endsWith('viewer-url')
        ? { token: null, path: null, ownerOnly: true } : { items: [], settings: { canvas: {} } }; },
    });
    await load();
    expect(requests).not.toContain('/api/bot/blocked-users');
    expect(requests).toContain('/api/drawing-donation/queue');
  });

  test('all current feature and dialog consumers are within the admin provider boundary', () => {
    const imports = new RegExp(`@/features/admin/(?:${features.join('|')})(?:['"])`);
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const filename = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(filename);
        else if (/\.[jt]sx?$/.test(entry.name) && imports.test(fs.readFileSync(filename, 'utf8'))) {
          const relative = path.relative(root, filename).replace(/\\/g, '/');
          expect(relative.startsWith('src/app/(admin)/') || relative.startsWith('src/features/admin/')).toBe(true);
        }
      }
    }
    walk(path.join(root, 'src'));
    expect(fs.readFileSync(path.join(root, 'src/app/(admin)/layout.tsx'), 'utf8')).toContain('<AdminShell>');
    expect(fs.readFileSync(path.join(root, 'src/components/app-shell/admin-shell.tsx'), 'utf8')).toContain('<BotChannelProvider>');
    expect(fs.readFileSync(path.join(root, 'src/app/drawing-lab/page.tsx'), 'utf8')).not.toMatch(imports);
  });
});
