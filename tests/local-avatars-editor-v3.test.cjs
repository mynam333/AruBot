const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { defaultConfig, validateConfig, reactionTemplates } = require('../local-program/avatars/schema.cjs');
const { files } = require('../local-program/avatars/bundled.cjs');

const renderer = fs.readFileSync(path.join(__dirname, '../local-program/renderer/avatars.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../local-program/renderer/avatars.css'), 'utf8');
let browser;
before(async () => {
  let executablePath = chromium.executablePath();
  if (!fs.existsSync(executablePath) && process.env.LOCALAPPDATA) {
    const cache = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
    const installed = fs.existsSync(cache) ? fs.readdirSync(cache).filter((name) => name.startsWith('chromium_headless_shell-')).sort().reverse() : [];
    executablePath = installed.map((name) => path.join(cache, name, 'chrome-headless-shell-win64/chrome-headless-shell.exe')).find((file) => fs.existsSync(file));
  }
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
});
after(async () => { await browser?.close(); });

async function mount(t, { recovery = null } = {}) {
  const page = await browser.newPage({ viewport: { width: 980, height: 900 } });
  t.after(() => page.close());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('http://avatar-fixture.test/**', (route) => {
    const file = path.basename(new URL(route.request().url()).pathname);
    return route.fulfill(files.has(file) ? { body: fs.readFileSync(files.get(file)), contentType: 'image/png' } : { body: '<html></html>', contentType: 'text/html' });
  });
  await page.setContent('<div id="page-avatars" class="active"><div id="avatarStudio"></div></div>');
  await page.addStyleTag({ content: css });
  const config = validateConfig(defaultConfig());
  await page.evaluate(({ config, templates, recovery }) => {
    window.__calls = [];
    window.__recovery = recovery;
    window.__polls = [];
    window.setInterval = (fn) => { window.__polls.push(fn); return 1; };
    let id = 0;
    if (!crypto.randomUUID) crypto.randomUUID = () => `fixture-id-${++id}`;
    const snapshot = { actors: [], game: null, configRevision: 1, simulationTime: 1000 };
    window.__state = {
      config, snapshot, connected: true, commandsKnown: true, commandAliases: [], clients: 0,
      url: 'http://avatar-fixture.test/overlay?key=test', previewUrl: 'http://avatar-fixture.test/overlay?preview=1', rehearsalUrl: 'http://avatar-fixture.test/overlay?rehearsal=1',
      assets: [], catalog: [], blocked: [], recent: [], diagnostics: [], templates,
      preview: { snapshot: structuredClone(snapshot), recent: [], diagnostics: [] }, rehearsal: { snapshot: structuredClone(snapshot), recent: [], diagnostics: [] },
    };
    const result = () => structuredClone(window.__state);
    window.aruLocal = {
      avatarState: async () => result(),
      avatarSave: async (value) => {
        window.__calls.push(['save', structuredClone(value)]);
        if (window.__saveFails) throw new Error('injected save failure');
        window.__state.config = structuredClone(value); return result();
      },
      avatarBackup: async (restore) => {
        window.__calls.push(['backup', restore]);
        if (window.__holdBackup) return new Promise((resolve) => { window.__cancelBackup = () => resolve(null); });
        if (window.__backupCanceled) return null;
        if (restore) window.__state.config.avatars[0].name = 'Restored';
        return result();
      },
      avatarDraft: async (action, payload) => {
        window.__calls.push(['draft', action, structuredClone(payload)]);
        if (action === 'load') return window.__recovery;
        window.__recovery = action === 'discard' ? null : structuredClone(payload);
        return window.__recovery;
      },
      avatarCommand: async (command, payload) => {
        window.__calls.push(['command', command, structuredClone(payload)]);
        if (command === 'backup-cancel') window.__cancelBackup?.();
        return result();
      },
      avatarCopy: async (kind, payload) => { window.__calls.push(['copy', kind, payload]); return true; },
      avatarDiagnostics: async () => true,
    };
    window.confirm = () => true;
  }, { config, templates: reactionTemplates(), recovery });
  await page.addScriptTag({ content: renderer });
  await page.locator('[data-field="avatar.name"]').waitFor();
  t.after(() => assert.deepEqual(errors, [], 'no renderer runtime errors'));
  return { page, config };
}
async function click(page, action) {
  await page.locator(`[data-av="${action}"]`).first().click();
  await page.waitForFunction(() => !document.querySelector('#avatarStudio').hasAttribute('aria-busy'));
}
async function tab(page, name) { await page.locator(`[data-tab="${name}"]`).click(); }

test('chat bubble controls save, validate, and survive scene presets', async (t) => {
  const { page } = await mount(t);
  await tab(page, 'scene');
  assert.equal(await page.locator('[data-field="bubbles"]').isChecked(), true);
  await page.locator('[data-field="bubbleDuration"]').fill('9');
  await page.locator('[data-field="bubbleMaxLength"]').fill('96');
  await page.locator('[data-field="bubbleSize"]').fill('28');
  await page.locator('[data-field="bubbles"]').uncheck();
  await page.locator('[data-preset="party"]').click();
  assert.equal(await page.locator('[data-field="bubbles"]').isChecked(), false);
  await page.locator('[data-field="bubbles"]').check();
  await click(page, 'save');
  const config = await page.evaluate(() => window.__calls.filter(([kind]) => kind === 'save').at(-1)[1]);
  assert.equal(config.bubbles, true);
  assert.equal(config.bubbleDuration, 9);
  assert.equal(config.bubbleMaxLength, 96);
  assert.equal(config.bubbleSize, 28);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('unsaved export and canceled export retain draft, selection, and undo', async (t) => {
  const { page, config } = await mount(t);
  assert.match(await page.locator('.av-state').filter({ has: page.locator('[data-state="run"]') }).textContent(), /걷기 이미지 대체/);
  await page.locator('[data-field="avatar.name"]').fill('Unsaved name');
  await tab(page, 'storage');
  await click(page, 'backup');
  assert.equal(await page.locator('#avDirty').textContent(), '미저장 변경');
  await tab(page, 'avatars');
  assert.equal(await page.locator('[data-field="avatar.name"]').inputValue(), 'Unsaved name');
  await click(page, 'undo');
  assert.equal(await page.locator('[data-field="avatar.name"]').inputValue(), config.avatars[0].name);
  await click(page, 'redo');
  assert.equal(await page.locator('[data-field="avatar.name"]').inputValue(), 'Unsaved name');
  await page.evaluate(() => { window.__backupCanceled = true; });
  await tab(page, 'storage'); await click(page, 'backup'); await tab(page, 'avatars');
  assert.equal(await page.locator('[data-field="avatar.name"]').inputValue(), 'Unsaved name');
});

test('save failure preserves draft and recovery payload excludes history', async (t) => {
  const { page } = await mount(t);
  await page.locator('[data-field="avatar.name"]').fill('Draft stays');
  await page.evaluate(() => { window.__saveFails = true; });
  await click(page, 'save');
  assert.match(await page.locator('#avNotice').textContent(), /injected save failure/);
  assert.equal(await page.locator('[data-field="avatar.name"]').inputValue(), 'Draft stays');
  await page.waitForFunction(() => window.__calls.some(([kind, action]) => kind === 'draft' && action === 'save'));
  const payload = await page.evaluate(() => window.__calls.filter(([kind, action]) => kind === 'draft' && action === 'save').at(-1)[2]);
  assert.ok(payload.undoAssets.length > 0);
  assert.equal(payload.history, undefined);
});

test('draft recovery never auto-applies to live settings', async (t) => {
  const config = validateConfig(defaultConfig()); config.avatars[0].name = 'Recovered draft';
  const { page } = await mount(t, { recovery: { config } });
  assert.equal(await page.locator('#avRecovery').isVisible(), true);
  await click(page, 'recover');
  assert.equal(await page.locator('[data-field="avatar.name"]').inputValue(), 'Recovered draft');
  assert.equal(await page.evaluate(() => window.__calls.filter(([kind]) => kind === 'save').length), 0);
});

test('timing modes and templates preserve explicit v3 semantics', async (t) => {
  const { page } = await mount(t);
  await tab(page, 'rules'); await click(page, 'add-rule');
  assert.equal(await page.locator('[data-field="rule.durationMode"]').inputValue(), 'step');
  await page.locator('[data-field="rule.durationMode"]').selectOption('fixed');
  await click(page, 'save');
  assert.equal(await page.evaluate(() => window.__state.config.rules.at(-1).durationFromChat), false);
  await click(page, 'add-template'); await click(page, 'add-template'); await click(page, 'save');
  const rules = await page.evaluate(() => window.__state.config.rules);
  assert.notEqual(rules.at(-1).id, rules.at(-2).id);
  assert.notDeepEqual(rules.at(-1).aliases, rules.at(-2).aliases);
  assert.equal(rules.at(-1).templateVersion, 1);
});

test('rehearsal keeps identity and saved source separate from preview', async (t) => {
  const { page } = await mount(t);
  await tab(page, 'games');
  await page.locator('[data-test-field="userId"]').fill('same-user');
  await page.locator('[data-test-option="source"]').selectOption('saved');
  await page.locator('#avTestForm [type="submit"]').click();
  await page.waitForFunction(() => window.__calls.some(([kind, command]) => kind === 'command' && command === 'rehearsal'));
  let calls = await page.evaluate(() => window.__calls.filter(([kind, command]) => kind === 'command' && command === 'rehearsal'));
  assert.equal(calls[0][2].source, 'saved'); assert.equal(calls[0][2].config, undefined); assert.equal(calls[0][2].actorId, 'same-user');
  await page.locator('[data-test-option="source"]').selectOption('draft');
  await page.locator('#avTestForm [type="submit"]').click();
  await page.waitForFunction(() => window.__calls.filter(([kind, command]) => kind === 'command' && command === 'rehearsal').length === 2);
  calls = await page.evaluate(() => window.__calls.filter(([kind, command]) => kind === 'command' && command === 'rehearsal'));
  assert.equal(calls[1][2].actorId, 'same-user'); assert.ok(calls[1][2].config);
});

test('keyed participant polling preserves focus and timeout edits', async (t) => {
  const { page } = await mount(t);
  await page.evaluate(async () => { window.__state.snapshot.actors = [{ id: 'actor-1', number: 1, name: 'Viewer', avatar: window.__state.config.defaultAvatar, wins: 0, targeting: true }]; await window.__polls[0](); });
  await tab(page, 'viewers');
  const input = page.locator('[data-timeout]'); await input.fill('27');
  await page.evaluate(async () => { window.__originalRow = document.querySelector('[data-viewer-row]'); await window.__polls[0](); });
  assert.equal(await input.inputValue(), '27');
  assert.equal(await input.evaluate((node) => node === document.activeElement), true);
  assert.equal(await page.evaluate(() => window.__originalRow === document.querySelector('[data-viewer-row]')), true);
});

test('viewer assignments preserve unsaved selections, save offline profiles and support release', async (t) => {
  const { page, config } = await mount(t);
  await page.evaluate(async () => {
    window.__state.viewers = [{ id: 'saved-viewer', name: '시청자 1', avatar: window.__state.config.defaultAvatar, avatarAssignment: '', active: false, wins: 0 }];
    const command = window.aruLocal.avatarCommand;
    window.aruLocal.avatarCommand = async (name, payload) => {
      if (name === 'assign-avatar') {
        if (window.__assignmentFails) throw new Error('disk full');
        window.__state.viewers[0].avatarAssignment = payload.avatarId;
      }
      return command(name, payload);
    };
    await window.__polls[0]();
  });
  await tab(page, 'viewers');
  const select = page.locator('[data-viewer-avatar]');
  await select.selectOption(config.avatars[1].id);
  await page.evaluate(async () => { await window.__polls[0](); });
  assert.equal(await select.inputValue(), config.avatars[1].id);
  assert.equal(await page.locator('[data-assignment-status]').textContent(), '저장 대기');
  await page.evaluate(() => { window.__assignmentFails = true; });
  await click(page, 'assign-avatar');
  assert.equal(await select.inputValue(), config.avatars[1].id);
  await page.evaluate(() => { window.__assignmentFails = false; });
  await click(page, 'assign-avatar');
  assert.equal(await page.locator('[data-assignment-status]').textContent(), '고정 지정됨');
  await select.selectOption('');
  await click(page, 'assign-avatar');
  assert.equal(await page.locator('[data-assignment-status]').textContent(), '시청자 선택 사용');
  assert.equal(await page.locator('[data-mode="remove"]').isDisabled(), true);
  if (process.env.AVATAR_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.AVATAR_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.AVATAR_SCREENSHOT_DIR, 'viewer-assignment.png'), fullPage: true });
  }
});

test('game commands carry complete options and 980px editor stays bounded', async (t) => {
  const { page } = await mount(t);
  await tab(page, 'games'); await page.locator('[data-field="gameSettings.recruitSeconds"]').fill('9'); await click(page, 'preview-race');
  const payload = await page.evaluate(() => window.__calls.find(([kind, command]) => kind === 'command' && command === 'preview-game')[2]);
  assert.equal(payload.options.recruitSeconds, 9); assert.equal(payload.duration, 30);
  for (const name of ['avatars', 'scene', 'rules', 'games', 'viewers', 'storage']) {
    await tab(page, name);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name);
  }
});

test('backup job polling and cancellation remain available while editor is busy', async (t) => {
  const { page } = await mount(t);
  await tab(page, 'storage');
  await page.evaluate(() => { window.__holdBackup = true; });
  await page.locator('[data-av="backup"]').click();
  await page.evaluate(async () => { window.__state.job = { id: 'job-1', status: 'running', action: 'export', progress: 40 }; await window.__polls[0](); });
  await page.locator('.av-job button').click();
  await page.waitForFunction(() => !document.querySelector('#avatarStudio').hasAttribute('aria-busy'));
  const call = await page.evaluate(() => window.__calls.find(([kind, command]) => kind === 'command' && command === 'backup-cancel'));
  assert.equal(call[2].id, 'job-1');
});

test('hidden invalid clip fields cannot be silently clamped during save', async (t) => {
  const { page } = await mount(t);
  await page.locator('.av-state details').first().locator('summary').click();
  await page.locator('[data-field="clip.idle.fps"]').fill('61');
  assert.equal(await page.locator('[data-field="clip.idle.fps"]').getAttribute('aria-invalid'), 'true');
  await tab(page, 'scene'); await click(page, 'save');
  assert.match(await page.locator('#avNotice').textContent(), /fps/);
  assert.equal(await page.evaluate(() => window.__calls.some(([kind]) => kind === 'save')), false);
});

test('dirty start with saved settings never applies the draft', async (t) => {
  const { page, config } = await mount(t);
  await page.locator('[data-field="avatar.name"]').fill('Not live');
  await page.locator('[data-av="toggle"]').click();
  await page.locator('dialog button[value="saved"]').click();
  await page.waitForFunction(() => !document.querySelector('#avatarStudio').hasAttribute('aria-busy'));
  assert.equal(await page.evaluate(() => window.__state.config.avatars[0].name), config.avatars[0].name);
  assert.equal(await page.evaluate(() => window.__state.config.enabled), true);
  assert.equal(await page.locator('[data-field="avatar.name"]').inputValue(), 'Not live');
  assert.equal(await page.locator('#avDirty').textContent(), '미저장 변경');
});

test('dirty restore cancellation retains both draft and live config', async (t) => {
  const { page } = await mount(t);
  await page.locator('[data-field="avatar.name"]').fill('Before restore');
  await tab(page, 'storage');
  await page.locator('[data-av="restore"]').click();
  await page.locator('dialog button[value="cancel"]').click();
  await page.waitForFunction(() => !document.querySelector('#avatarStudio').hasAttribute('aria-busy'));
  await tab(page, 'avatars');
  assert.equal(await page.locator('[data-field="avatar.name"]').inputValue(), 'Before restore');
  assert.equal(await page.evaluate(() => window.__calls.some(([kind]) => kind === 'backup')), false);
});
