const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const sharp = require('sharp');
const { defaultConfig, publicConfig, validateConfig } = require('../local-program/pngtuber/schema.cjs');

const rendererDir = path.join(__dirname, '../local-program/renderer');
const assetId = `${'a'.repeat(64)}.png`;
const importedId = `${'b'.repeat(64)}.png`;
const fixtureOrigin = 'http://pngtuber-fixture.test';
let browser, fixtureImage;

before(async () => {
  const candidates = [chromium.executablePath(), process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe'];
  const executablePath = candidates.find((file) => file && fs.existsSync(file));
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  fixtureImage = await sharp(path.join(__dirname, '../local-program/avatars/bundled/Mask Dude/Idle (32x32).png'))
    .extract({ left: 0, top: 0, width: 32, height: 32 }).resize(128, 128, { kernel: 'nearest' }).png().toBuffer();
});
after(async () => { await browser?.close(); });

async function mount(t, options = {}) {
  const page = await browser.newPage({ viewport: options.viewport || { width: 1180, height: 780 } });
  page.setDefaultTimeout(5000);
  t.after(() => page.close());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('dialog', (dialog) => dialog.accept());
  await page.route(`${fixtureOrigin}/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.startsWith('/assets/')) return route.fulfill({ body: fixtureImage, contentType: 'image/png' });
    if (pathname === '/preview') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body style="margin:0;background:transparent;display:grid;place-items:center;height:100vh"><img alt="모의 출력" src="/assets/${assetId}" style="width:60%;height:90%;object-fit:contain;image-rendering:pixelated"></body></html>` });
    if (pathname.endsWith('icon.ico')) return route.fulfill({ contentType: 'image/x-icon', body: fs.readFileSync(path.join(rendererDir, '../build/icon.ico')) });
    const file = path.basename(pathname || 'index.html');
    if (file === 'avatars.js') return route.fulfill({ contentType: 'text/javascript', body: '' });
    if (['index.html', 'renderer.js', 'avatar-icons.js', 'pngtuber.js', 'styles.css', 'avatars.css', 'pngtuber.css'].includes(file)) {
      return route.fulfill({ body: fs.readFileSync(path.join(rendererDir, file)), contentType: file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html' });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  const config = publicConfig(defaultConfig());
  Object.assign(config, { enabled: true, closedAsset: assetId, inputName: '방송 마이크', inputUuid: 'mic-1', reactions: [{ id: 'cheer', name: '응원', asset: assetId, durationSec: 5 }] }, options.config);
  await page.addInitScript(({ config, assetId, importedId, origin, options }) => {
    if (window.top !== window) return;
    window.__calls = [];
    window.__polls = new Map();
    window.__allPolls = [];
    let timer = 0;
    window.setInterval = (fn) => { window.__allPolls.push(fn); window.__polls.set(++timer, fn); return timer; };
    window.clearInterval = (id) => window.__polls.delete(id);
    window.__failState = options.failState || false;
    window.__state = {
      config, url: `${origin}/overlay?key=private-fixture-secret`, previewUrl: `${origin}/preview`,
      runtime: { connected: true, sourceAvailable: true, muted: false, levelDb: -32, mouthOpen: true, mode: 'open', asset: assetId, reactionId: '', remainingMs: 0, queued: 0, error: '' },
      assets: [{ id: assetId, name: '기본 이미지.png', url: `${origin}/assets/${assetId}` }],
      inputs: [{ name: '방송 마이크', uuid: 'mic-1' }, { name: '보조 마이크', uuid: 'mic-2' }],
    };
    const state = () => structuredClone(window.__state);
    window.aruLocal = {
      onState() {}, onLocalTask() {}, getState: () => new Promise(() => {}),
      pngtuberState: async () => {
        window.__calls.push(['state']);
        if (window.__failState) throw new Error('startup failed C:/private/config?key=private-fixture-secret');
        if (window.__holdPoll) { window.__holdPoll = false; const stale = state(); return new Promise((resolve) => { window.__releasePoll = () => resolve(stale); }); }
        return state();
      },
      pngtuberSave: async (config) => {
        window.__calls.push(['save', structuredClone(config)]);
        if (window.__failSave) throw new Error(window.__failSave);
        window.__state.config = structuredClone(config);
        return state();
      },
      pngtuberDiscover: async () => {
        window.__calls.push(['discover']);
        if (window.__discoverFails) throw new Error('OBS disconnected');
        window.__state.inputs = [{ name: '새 마이크', uuid: 'mic-new' }];
        return state();
      },
      pngtuberImport: async () => {
        window.__calls.push(['import']);
        if (window.__importError) throw new Error(window.__importError);
        if (window.__cancelImport) return null;
        if (!window.__state.assets.some((asset) => asset.id === importedId)) window.__state.assets.push({ id: importedId, name: '추가 이미지.png', url: `${origin}/assets/${importedId}` });
        return { ...state(), importedAssetId: importedId };
      },
      pngtuberTrigger: async (payload) => {
        window.__calls.push(['trigger', structuredClone(payload)]);
        if (window.__triggerReason) return { ok: false, reason: window.__triggerReason };
        window.__state.runtime.reactionId = payload.reactionId;
        window.__state.runtime.remainingMs = payload.durationSec * 1000;
        window.__state.runtime.queued = 2;
        return { ok: true, ...payload, queued: 2 };
      },
      pngtuberCommand: async (command) => {
        window.__calls.push(['command', command]);
        Object.assign(window.__state.runtime, { reactionId: '', queued: 0, remainingMs: 0 });
        return state();
      },
      pngtuberCopy: async (kind, payload) => { window.__calls.push(['copy', kind, payload]); return !window.__copyFails; },
    };
  }, { config, assetId, importedId, origin: fixtureOrigin, options });
  await page.goto(`${fixtureOrigin}/index.html#${options.hidden ? 'connect' : 'pngtuber'}`);
  if (!options.hidden) await page.locator(options.failState ? '#ptRetry' : '#ptFields:not([disabled])').waitFor();
  t.after(() => assert.deepEqual(errors, [], 'no renderer or console errors'));
  return { page, config };
}
const field = (page, name) => page.locator(`[data-pt-field="${name}"]`).first();
const row = (page, index = 0) => page.locator(`[data-pt-row="${index}"]`);
async function click(page, action, scope = page) {
  await scope.locator(`[data-pt="${action}"]`).first().click();
  await page.waitForFunction(() => !document.getElementById('pngtuberEditor').hasAttribute('aria-busy'));
}
async function save(page) {
  await page.locator('#ptSave').click();
  await page.waitForFunction(() => !document.getElementById('pngtuberEditor').hasAttribute('aria-busy'));
}
async function poll(page) { await page.evaluate(async () => { for (const fn of window.__polls.values()) await fn(); }); }
async function calls(page, kind) { return page.evaluate((kind) => window.__calls.filter((call) => call[0] === kind), kind); }

test('navigation loads the scoped editor and preserves other views', async (t) => {
  const { page } = await mount(t, { hidden: true });
  assert.equal((await calls(page, 'state')).length, 0);
  await page.locator('.nav-item[data-page="pngtuber"]').click();
  await page.locator('#ptFields:not([disabled])').waitFor();
  assert.equal(await page.title(), 'AruBot 로컬 프로그램');
  assert.equal(await page.locator('#pageTitle').textContent(), '짚톡');
  assert.equal(await page.locator('.hero-grid').isVisible(), false);
  assert.equal(await page.locator('#ptPreview').getAttribute('tabindex'), '-1');
  assert.equal(await page.locator('#ptPreview').evaluate((node) => node.inert), true);
  await page.locator('.nav-item[data-page="obs"]').click();
  assert.equal(await page.locator('#page-obs').isVisible(), true);
  assert.equal(await page.locator('.hero-grid').isVisible(), true);
  assert.equal(await page.locator('#page-pngtuber').isVisible(), false);
  assert.equal(await page.evaluate(() => document.body.classList.contains('pngtuber-page')), false);
});

test('source, enabled, mic controls and output changes require explicit save', async (t) => {
  const { page } = await mount(t, { config: { enabled: false } });
  await page.locator('#ptInput').selectOption('1');
  await field(page, 'enabled').check();
  await field(page, 'thresholdDb').fill('-44');
  assert.equal(await page.locator('#ptThresholdRange').inputValue(), '-44');
  await page.locator('#ptThresholdRange').fill('-36');
  assert.equal(await field(page, 'thresholdDb').inputValue(), '-36');
  await field(page, 'hysteresisDb').fill('8');
  await field(page, 'holdMs').fill('240');
  await page.locator('[data-pt-field="fit"][value="cover"]').check();
  await field(page, 'flipX').check();
  await field(page, 'port').fill('17843');
  assert.equal(await page.locator('#ptDirty').textContent(), '미저장 변경');
  assert.equal(await page.locator('#ptSaved').textContent(), '저장된 설정 · 꺼짐');
  assert.equal((await calls(page, 'save')).length, 0);
  await save(page);
  const config = (await calls(page, 'save'))[0][1];
  assert.deepEqual(validateConfig(config).inputUuid, 'mic-2');
  assert.equal(config.inputName, '보조 마이크');
  assert.equal(config.enabled, true);
  assert.equal(config.thresholdDb, -36);
  assert.equal(config.hysteresisDb, 8);
  assert.equal(config.holdMs, 240);
  assert.equal(config.fit, 'cover');
  assert.equal(config.flipX, true);
  assert.equal(config.port, 17843);
  assert.equal(await page.locator('#ptDirty').textContent(), '저장 완료');
});

test('polling keeps unsaved fields, focus and iframe context intact', async (t) => {
  const { page } = await mount(t);
  await row(page).locator('[data-pt-reaction="name"]').fill('편집 중 이름');
  await page.evaluate(() => {
    window.__focused = document.activeElement;
    window.__preview = document.getElementById('ptPreview');
    window.__previewWindow = window.__preview.contentWindow;
    window.__previewMutations = 0;
    new MutationObserver((changes) => { window.__previewMutations += changes.length; }).observe(window.__preview, { attributes: true, attributeFilter: ['src'] });
    window.__state.config.thresholdDb = -50;
    window.__state.config.reactions[0].name = '외부 변경';
    Object.assign(window.__state.runtime, { levelDb: -18.5, muted: true, reactionId: 'cheer', remainingMs: 2500, queued: 3 });
  });
  await poll(page); await poll(page);
  assert.equal(await row(page).locator('[data-pt-reaction="name"]').inputValue(), '편집 중 이름');
  assert.equal(await field(page, 'thresholdDb').inputValue(), '-38');
  assert.equal(await page.locator('#ptLevel').textContent(), '-18.5 dB');
  assert.equal(await page.locator('#ptMouth').textContent(), '음소거');
  assert.equal(await page.locator('#ptQueued').textContent(), '3개');
  assert.equal(await page.evaluate(() => window.__focused === document.activeElement), true);
  assert.equal(await page.evaluate(() => window.__preview === document.getElementById('ptPreview') && window.__previewWindow === window.__preview.contentWindow && window.__previewMutations === 0), true);
});

test('poll timers stop on page and document hiding and resume once', async (t) => {
  const { page } = await mount(t);
  await page.locator('.nav-item[data-page="obs"]').click();
  const previous = (await calls(page, 'state')).length;
  await page.evaluate(async () => { for (const fn of window.__allPolls) await fn(); });
  assert.equal((await calls(page, 'state')).length, previous);
  assert.equal(await page.evaluate(() => window.__polls.size), 0);
  await page.locator('.nav-item[data-page="pngtuber"]').click();
  assert.equal(await page.evaluate(() => window.__polls.size), 1);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.evaluate(() => window.__polls.size), 0);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.evaluate(() => window.__polls.size), 1);
});

test('discovery works disabled and retains a missing selected source and unsaved controls', async (t) => {
  const { page } = await mount(t, { config: { enabled: false } });
  await field(page, 'holdMs').fill('432');
  await click(page, 'discover');
  assert.equal(await page.locator('#ptInput').inputValue(), 'missing');
  assert.match(await page.locator('#ptInput option:checked').textContent(), /방송 마이크.*목록에 없음/);
  assert.equal(await field(page, 'holdMs').inputValue(), '432');
  assert.equal(await field(page, 'enabled').isChecked(), false);
  await page.locator('#ptInput').selectOption('0');
  await save(page);
  assert.equal((await calls(page, 'save'))[0][1].inputUuid, 'mic-new');
});

test('import, cancel, existing-image selection and fallback stay draft-only', async (t) => {
  const { page } = await mount(t);
  const open = page.locator('[data-pt-slot="openAsset"]');
  const muted = page.locator('[data-pt-slot="mutedAsset"]');
  assert.match(await open.locator('[data-pt-asset-status]').textContent(), /입 다묾으로 대체/);
  await field(page, 'thresholdDb').fill('-48');
  await click(page, 'import', open);
  assert.equal(await field(page, 'openAsset').inputValue(), importedId);
  assert.equal(await field(page, 'thresholdDb').inputValue(), '-48');
  await field(page, 'mutedAsset').selectOption(importedId);
  await page.evaluate(() => { window.__cancelImport = true; });
  await click(page, 'import', muted);
  assert.equal(await field(page, 'mutedAsset').inputValue(), importedId);
  await click(page, 'remove-asset', open);
  assert.equal(await field(page, 'openAsset').inputValue(), '');
  assert.equal(await open.locator('img').getAttribute('src'), `${fixtureOrigin}/assets/${assetId}`);
  assert.equal((await calls(page, 'save')).length, 0);
  await save(page);
  assert.equal((await calls(page, 'save'))[0][1].mutedAsset, importedId);
});

test('new reactions get unique IDs and cannot test or copy before saving', async (t) => {
  const { page } = await mount(t);
  await click(page, 'add'); await click(page, 'add');
  assert.equal(await row(page, 1).locator('[data-pt-reaction="id"]').inputValue(), 'reaction-1');
  assert.equal(await row(page, 2).locator('[data-pt-reaction="id"]').inputValue(), 'reaction-2');
  assert.equal(await row(page, 2).locator('[data-pt="test"]').isDisabled(), true);
  assert.equal(await row(page, 2).locator('[data-pt="copy-variable"]').isDisabled(), true);
  await row(page, 1).locator('[data-pt-reaction="asset"]').selectOption(assetId);
  await row(page, 2).locator('[data-pt-reaction="asset"]').selectOption(assetId);
  await row(page, 2).locator('[data-pt-reaction="name"]').fill('박수');
  await row(page, 2).locator('[data-pt-reaction="id"]').fill('clap');
  await row(page, 2).locator('[data-pt-reaction="durationSec"]').fill('7.5');
  await field(page, 'reactionMode').selectOption('replace');
  await save(page);
  await click(page, 'copy-variable', row(page, 2));
  assert.deepEqual((await calls(page, 'copy')).at(-1), ['copy', 'variable', { reactionId: 'clap', durationSec: 7.5 }]);
  assert.equal(await row(page, 2).locator('[data-pt-variable]').textContent(), '${pngtuber::clap::7.5}');
  await click(page, 'test', row(page, 2));
  assert.deepEqual((await calls(page, 'trigger')).at(-1)[1], { reactionId: 'clap', durationSec: 7.5 });
  assert.equal(await page.locator('#ptReaction').textContent(), '박수');
  assert.equal(await page.locator('#ptRemaining').textContent(), '7.5초');
  assert.equal(await page.locator('#ptQueued').textContent(), '2개');
  await click(page, 'clear');
  assert.deepEqual((await calls(page, 'command')).at(-1), ['command', 'clear']);
  assert.equal(await page.locator('#ptReaction').textContent(), '없음');
  await click(page, 'delete', row(page, 1));
  assert.equal(await page.locator('[data-pt-row]').count(), 2);
  await save(page);
  assert.deepEqual((await calls(page, 'save')).at(-1)[1].reactions.map((item) => item.id), ['cheer', 'clap']);
});

test('validation rejects unsafe or duplicate IDs and out-of-range numeric edits', async (t) => {
  const { page } = await mount(t);
  await click(page, 'add');
  const id = row(page, 1).locator('[data-pt-reaction="id"]');
  await id.fill('cheer');
  assert.equal(await id.getAttribute('aria-invalid'), 'true');
  await save(page);
  assert.equal((await calls(page, 'save')).length, 0);
  await id.fill('unsafe::id');
  assert.equal(await id.getAttribute('aria-invalid'), 'true');
  await id.fill('safe-id_2');
  await row(page, 1).locator('[data-pt-reaction="asset"]').selectOption(assetId);
  await field(page, 'holdMs').fill('2001');
  await save(page);
  assert.equal((await calls(page, 'save')).length, 0);
  assert.equal(await field(page, 'holdMs').inputValue(), '2001');
  await field(page, 'holdMs').fill('2000');
  await row(page, 1).locator('[data-pt-reaction="durationSec"]').fill('301');
  await save(page);
  assert.equal((await calls(page, 'save')).length, 0);
  await row(page, 1).locator('[data-pt-reaction="durationSec"]').fill('300');
  await save(page);
  assert.equal((await calls(page, 'save')).length, 1);
});

test('startup retry and failed save retain edits without leaking raw paths or keys', async (t) => {
  const { page } = await mount(t, { failState: true });
  assert.match(await page.locator('#ptNoticeText').textContent(), /불러오지 못했습니다/);
  assert.doesNotMatch(await page.locator('#pngtuberEditor').textContent(), /C:\/private|private-fixture-secret/);
  await page.evaluate(() => { window.__failState = false; });
  await click(page, 'retry');
  await page.locator('#ptFields:not([disabled])').waitFor();
  await field(page, 'port').fill('17845');
  await page.evaluate(() => { window.__failSave = 'listen EADDRINUSE C:/private?key=private-fixture-secret'; });
  await save(page);
  assert.match(await page.locator('#ptNoticeText').textContent(), /포트가 사용 중/);
  assert.equal(await field(page, 'port').inputValue(), '17845');
  assert.equal(await page.locator('#ptDirty').textContent(), '미저장 변경');
  await page.evaluate(() => { window.__failSave = false; });
  await save(page);
  assert.equal(await page.locator('#ptDirty').textContent(), '저장 완료');
});

test('stale polling cannot replace the result of an explicit save', async (t) => {
  const { page } = await mount(t);
  await page.evaluate(() => { window.__holdPoll = true; window.__pending = [...window.__polls.values()][0](); });
  await field(page, 'holdMs').fill('900');
  await save(page);
  await page.evaluate(async () => { window.__releasePoll(); await window.__pending; });
  assert.equal(await field(page, 'holdMs').inputValue(), '900');
  assert.equal(await page.locator('#ptDirty').textContent(), '저장 완료');
});

test('copy uses bool result, hides URL until reveal, and hides it on navigation', async (t) => {
  const { page } = await mount(t);
  assert.equal(await page.locator('#ptUrl').inputValue(), '****************');
  await click(page, 'copy-url');
  assert.deepEqual((await calls(page, 'copy'))[0], ['copy', 'url', undefined]);
  await click(page, 'reveal');
  assert.match(await page.locator('#ptUrl').inputValue(), /private-fixture-secret/);
  await page.locator('.nav-item[data-page="connect"]').click();
  await page.locator('.nav-item[data-page="pngtuber"]').click();
  assert.equal(await page.locator('#ptUrl').inputValue(), '****************');
  await page.evaluate(() => { window.__copyFails = true; });
  await click(page, 'copy-url');
  assert.match(await page.locator('#ptNoticeText').textContent(), /복사하지 못했습니다/);
});

test('test rejection reasons are actionable and never reported as success', async (t) => {
  const { page } = await mount(t);
  for (const [reason, expected] of [['queue-full', /대기열이 가득/], ['disabled', /꺼져 있습니다/], ['unknown-reaction', /반응을 찾을 수 없습니다/]]) {
    await page.evaluate((reason) => { window.__triggerReason = reason; }, reason);
    await click(page, 'test', row(page));
    assert.match(await page.locator('#ptNoticeText').textContent(), expected);
    assert.doesNotMatch(await page.locator('#ptNoticeText').textContent(), /요청했습니다/);
  }
  await page.evaluate(() => { window.__state.runtime.error = 'Selected OBS audio input is unavailable'; });
  await poll(page);
  assert.match(await page.locator('#ptRuntimeError').textContent(), /소스를 선택하고 저장/);
  await page.evaluate(() => { window.__importError = 'Images must be at most 20 MiB'; });
  await click(page, 'import', page.locator('[data-pt-slot="closedAsset"]'));
  assert.match(await page.locator('#ptNoticeText').textContent(), /20 MiB 이하/);
});

test('beforeunload prevents discarding unsaved work but not saved or reset state', async (t) => {
  const { page } = await mount(t);
  const blocked = () => page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
  assert.equal(await blocked(), false);
  await field(page, 'thresholdDb').fill('-40');
  assert.equal(await blocked(), true);
  await click(page, 'reset');
  assert.equal(await blocked(), false);
  await field(page, 'thresholdDb').fill('-44');
  await save(page);
  assert.equal(await blocked(), false);
});

test('desktop editor remains bounded and produces screenshot evidence', async (t) => {
  const { page } = await mount(t);
  const screenshotDir = process.env.PNGTUBER_SCREENSHOT_DIR;
  if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });
  for (const [width, height] of [[1180, 780], [980, 680]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const overflow = await page.locator('#pngtuberEditor').evaluate((root) => [...root.querySelectorAll('input, select, button, .pt-asset, .pt-reaction, iframe')].filter((node) => {
      const box = node.getBoundingClientRect();
      return box.width && (box.right > innerWidth + 1 || box.left < 0 || node.scrollWidth > node.clientWidth + 2 && node.tagName === 'BUTTON');
    }).map((node) => node.getAttribute('aria-label') || node.id || node.className));
    assert.deepEqual(overflow, [], `${width}px controls fit their viewport`);
    await page.locator('[data-pt-slot="closedAsset"] img').evaluate((node) => node.decode());
    assert.equal(await page.locator('[data-pt-slot="closedAsset"] img').evaluate((node) => node.naturalWidth > 0), true);
    assert.equal(await page.locator('#pngtuberEditor [data-pt="discover"] svg').count(), 1);
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, `pngtuber-editor-${width}x${height}.png`), animations: 'disabled' });
      await page.screenshot({ path: path.join(screenshotDir, `pngtuber-editor-${width}x${height}-full.png`), fullPage: true, animations: 'disabled' });
    }
  }
  assert.equal(await page.locator('[id*="nextjs"], vite-error-overlay').count(), 0);
});
