import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { OrthographicCamera, Quaternion, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const source = readFileSync(new URL('./marble-dice-motion.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { MARBLE_DICE_FACES, MARBLE_DICE_RADIUS, MARBLE_DICE_SETTLED_AT, MARBLE_DICE_VIEW, marbleDiceProgress, marbleDiceSupport, marbleDiceValues, marbleDiePose } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const pose = (progress, options = {}) => marbleDiePose({ value: 5, index: 0, count: 2, seed: 'roll-42', progress, ...options });
const normals = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)];

test('opposite faces sum to seven and every supplied result faces the viewer on a flat base', () => {
  for (let i = 0; i < 6; i += 2) assert.equal(MARBLE_DICE_FACES[i] + MARBLE_DICE_FACES[i + 1], 7);
  for (let value = 1; value <= 6; value += 1) for (const index of [0, 1]) {
    const result = pose(1, { value, index });
    const rotation = new Quaternion(...result.quaternion);
    const face = normals[MARBLE_DICE_FACES.indexOf(value)].clone().applyQuaternion(rotation);
    assert.ok(face.z > 0.97, `result ${value} is not the readable front face`);
    assert.ok(Math.abs(face.y) < 1e-12);
    assert.ok(Math.abs(result.position[1] - 0.5) < 1e-12);
    const bottom = normals.map(normal => normal.clone().applyQuaternion(rotation).y);
    assert.ok(bottom.some(y => Math.abs(y + 1) < 1e-12));
  }
});

test('timeline is deterministic, seekable, seed-varied and exactly held from 0.8 onward', () => {
  for (const progress of [0, 0.05, 0.1, 0.3, 0.47, 0.63, 0.72, 0.8, 1]) {
    assert.deepEqual(pose(progress), pose(progress));
    pose(1); pose(0);
    assert.deepEqual(pose(progress), pose(progress));
  }
  assert.notDeepEqual(pose(0.3), pose(0.3, { seed: 'another-roll' }));
  for (let value = 1; value <= 6; value += 1) for (const index of [0, 1]) {
    const result = pose(1, { value, index });
    for (const progress of [MARBLE_DICE_SETTLED_AT, 0.85, 0.99, 2, Infinity]) assert.deepEqual(pose(progress, { value, index }), result);
    for (const progress of [0, 0.05, 0.3, 0.7]) assert.deepEqual(pose(progress, { value, index, reduced: true }), result);
  }
});

test('all poses have finite unit rotations and conservative fixed-camera framing for one or two dice', () => {
  const { width, height, verticalSpan, position, target } = MARBLE_DICE_VIEW;
  const h = verticalSpan / 2, w = h * width / height;
  const camera = new OrthographicCamera(-w, w, h, -h, 0.1, 40);
  camera.position.fromArray(position); camera.lookAt(...target); camera.updateMatrixWorld();
  const corners = [-0.5, 0.5].flatMap(x => [-0.5, 0.5].flatMap(y => [-0.5, 0.5].map(z => new Vector3(x, y, z))));
  for (const seed of ['', 'roll-42', 'server:271828', '동일 결과', 'ffff', '0000']) for (const count of [1, 2]) {
    for (let value = 1; value <= 6; value += 1) for (let index = 0; index < count; index += 1) {
      for (let frame = 0; frame <= 400; frame += 1) {
        const result = pose(frame / 400, { value, index, count, seed });
        assert.ok([...result.position, ...result.quaternion, result.lift, result.shadowOpacity, result.shadowScale].every(Number.isFinite));
        const rotation = new Quaternion(...result.quaternion);
        assert.ok(Math.abs(rotation.length() - 1) < 1e-12);
        assert.ok(result.lift >= 0);
        assert.ok(result.position[1] - marbleDiceSupport(result.quaternion) >= -1e-12);
        for (const corner of corners) {
          const projected = corner.clone().applyQuaternion(rotation).add(new Vector3(...result.position)).project(camera);
          assert.ok(Math.abs(projected.x) < 0.95 && Math.abs(projected.y) < 0.95, `clipping: ${JSON.stringify({ seed, value, index, count, frame, projected })}`);
        }
      }
    }
  }
});

test('actual rounded geometry never penetrates the floor, and has contact at landings', () => {
  const geometry = new RoundedBoxGeometry(1, 1, 1, 4, MARBLE_DICE_RADIUS);
  const positions = geometry.getAttribute('position');
  const vertex = new Vector3();
  for (const index of [0, 1]) for (let value = 1; value <= 6; value += 1) {
    const delay = index * 0.018;
    const toProgress = t => delay + t * (0.8 - delay) / 0.8;
    for (const time of [0, 0.1, 0.28, 0.47, 0.55, 0.63, 0.72, 0.77, 0.8]) {
      const result = pose(toProgress(time), { value, index });
      const rotation = new Quaternion(...result.quaternion);
      let bottom = Infinity;
      for (let i = 0; i < positions.count; i += 1) bottom = Math.min(bottom, vertex.fromBufferAttribute(positions, i).applyQuaternion(rotation).y + result.position[1]);
      assert.ok(bottom >= -1e-7);
      assert.ok(Math.abs(bottom - result.lift) < 0.004, `floating contact at ${time}: ${bottom - result.lift}`);
    }
  }
  geometry.dispose();
});

test('held dice remain readable at a 288px parent without enlarging the 134px scene', () => {
  const view = MARBLE_DICE_VIEW;
  const makeCamera = (span, position, target) => {
    const h = span / 2, w = h * view.width / view.height;
    const camera = new OrthographicCamera(-w, w, h, -h, 0.1, 40);
    camera.position.fromArray(position); camera.lookAt(...target); camera.updateMatrixWorld();
    return camera;
  };
  const current = makeCamera(view.verticalSpan, view.position, view.target);
  const previous = makeCamera(3, [0, 7.98, 10], [0, 0.98, 0]);
  const geometry = new RoundedBoxGeometry(1, 1, 1, 4, MARBLE_DICE_RADIUS);
  const vertices = geometry.getAttribute('position');
  const vertex = new Vector3();
  const hostHeight = 134 * 288 / 440;
  const projectedSize = (camera, result) => {
    const rotation = new Quaternion(...result.quaternion);
    const position = new Vector3(...result.position);
    let left = Infinity, right = -Infinity, top = -Infinity, bottom = Infinity;
    for (let i = 0; i < vertices.count; i += 1) {
      vertex.fromBufferAttribute(vertices, i).applyQuaternion(rotation).add(position).project(camera);
      left = Math.min(left, vertex.x); right = Math.max(right, vertex.x);
      bottom = Math.min(bottom, vertex.y); top = Math.max(top, vertex.y);
    }
    return { width: (right - left) * hostHeight * view.width / view.height / 2, height: (top - bottom) * hostHeight / 2 };
  };
  for (const seed of ['roll-42', 'server:271828', 'ffff', '0000']) for (const count of [1, 2]) {
    for (let index = 0; index < count; index += 1) for (let value = 1; value <= 6; value += 1) {
      const result = pose(1, { value, index, count, seed });
      const size = projectedSize(current, result), oldSize = projectedSize(previous, result);
      assert.ok(size.width >= 57 && size.height >= 60, `small result: ${JSON.stringify(size)}`);
      assert.ok(size.width / oldSize.width >= 1.5 && size.height / oldSize.height >= 1.5);
      assert.ok(size.height < hostHeight - 12, 'no breathing room within the unchanged scene');
      assert.deepEqual(pose(0.1, { value, index, count, seed, reduced: true }), result);
    }
  }
  geometry.dispose();
});

test('phase joins are continuous, bounces decay, and two dice never collide', () => {
  for (const index of [0, 1]) {
    const delay = index * 0.018;
    for (const boundary of [0.1, 0.47, 0.63, 0.72, 0.8]) {
      const p = delay + boundary * (0.8 - delay) / 0.8;
      const before = pose(p - 1e-8, { index }), after = pose(p + 1e-8, { index });
      assert.ok(new Vector3(...before.position).distanceTo(new Vector3(...after.position)) < 1e-5);
      assert.ok(new Quaternion(...before.quaternion).angleTo(new Quaternion(...after.quaternion)) < 1e-5);
    }
  }
  assert.ok(pose(0.285).lift > pose(0.55).lift && pose(0.55).lift > pose(0.675).lift);
  for (let i = 0; i <= 1000; i += 1) {
    const a = pose(i / 1000, { index: 0 }), b = pose(i / 1000, { index: 1 });
    assert.ok(b.position[0] - a.position[0] > Math.sqrt(3));
  }
});

test('malformed inputs cannot introduce fabricated visible results or nonfinite timing', () => {
  assert.deepEqual(marbleDiceValues([6, 2, 4]), [6, 2]);
  assert.deepEqual(marbleDiceValues([0, NaN]), []);
  assert.deepEqual(marbleDiceValues([1.5, 7]), []);
  assert.equal(marbleDiceProgress(NaN), 0);
  assert.equal(marbleDiceProgress(-Infinity), 0);
  assert.equal(marbleDiceProgress(Infinity), 1);
  for (const p of [NaN, -Infinity, Infinity, -5, 6]) assert.ok([...pose(p).position, ...pose(p).quaternion].every(Number.isFinite));
});

// Opt in with MARBLE_DICE_BROWSER_TEST=1. Uses only existing local dependencies;
// MARBLE_DICE_BROWSER_CHANNEL=chrome can select an already installed browser.
test('isolated browser: visible pixels, responsive framing, hold, reduced motion, loss/recovery and cleanup', {
  skip: process.env.MARBLE_DICE_BROWSER_TEST !== '1', timeout: 90000,
}, async () => {
  const { build } = await import('esbuild');
  const { chromium } = await import('playwright');
  const { createServer } = await import('node:http');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, basename, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { default: sharp } = await import('sharp');
  const output = await mkdtemp(join(tmpdir(), 'marble-dice-qa-'));
  const bundle = await build({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { MarbleDiceScene } from './marble-dice.tsx';
      const root = createRoot(document.getElementById('stage'));
      let frame = { dice: [5, 2], progress: 0, seed: 'browser-roll', reduced: false };
      window.setDiceFrame = next => { frame = { ...frame, ...next }; root.render(<React.StrictMode><MarbleDiceScene {...frame} /></React.StrictMode>); };
      window.unmountDice = () => root.render(null);
      window.setDiceFrame({});
    `, resolveDir: dirname(fileURLToPath(import.meta.url)), loader: 'tsx' },
    bundle: true, write: false, outdir: output, format: 'esm', splitting: true, jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  const files = new Map(bundle.outputFiles.map(file => [`/${basename(file.path)}`, file.contents]));
  const server = createServer((request, response) => {
    const file = files.get(request.url);
    if (file) {
      response.setHeader('Content-Type', request.url.endsWith('.css') ? 'text/css' : 'text/javascript');
      response.end(file);
    } else if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); }
    else {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marble dice isolated QA</title><link rel="stylesheet" href="/stdin.css"><style>body{margin:24px}#stage{position:relative;width:440px;height:210px}@media(max-width:500px){body{margin:16px}#stage{transform:scale(.75);transform-origin:top left}}</style></head><body><main id="stage"></main><script type="module" src="/stdin.js"></script></body></html>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.MARBLE_DICE_BROWSER_CHANNEL || undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 3 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(() => {
      window.diceDraws = 0;
      const original = WebGL2RenderingContext.prototype.drawElements;
      WebGL2RenderingContext.prototype.drawElements = function (...args) { window.diceDraws += 1; return original.apply(this, args); };
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    await page.goto(url);
    assert.equal(await page.title(), 'Marble dice isolated QA');
    assert.equal(new URL(page.url()).origin, url);
    const scene = page.locator('[data-marble-dice]');
    const waitReady = () => page.waitForFunction(() => document.querySelector('[data-marble-dice]')?.dataset.renderer === 'webgl');
    const frame = async next => {
      await page.evaluate(next => window.setDiceFrame(next), next);
      await page.waitForTimeout(45);
    };
    const capture = async name => {
      const buffer = await scene.screenshot({ path: join(output, `${name}.png`), omitBackground: true, scale: 'css' });
      const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let visible = 0, clear = 0, minX = info.width, maxX = 0, minY = info.height, maxY = 0;
      for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
        const a = data[(y * info.width + x) * 4 + 3];
        if (a === 0) clear += 1;
        if (a > 100) { visible += 1; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      }
      assert.ok(visible > 300 && clear > info.width * info.height / 4, `${name}: blank or opaque canvas`);
      assert.ok(minX > 2 && minY > 2 && maxX < info.width - 3 && maxY < info.height - 3, `${name}: clipped pixels`);
      return buffer;
    };
    await waitReady();
    assert.equal(await scene.locator('canvas').count(), 1);
    assert.equal(await scene.locator('canvas').evaluate(canvas => canvas.width), 880);
    const bounds = await scene.boundingBox();
    const canvasBounds = await scene.locator('canvas').boundingBox();
    assert.equal(bounds.height, 134);
    assert.ok(Math.abs(canvasBounds.width / canvasBounds.height - 440 / 146) < 0.001);
    assert.ok(Math.abs(canvasBounds.x - bounds.x - (bounds.width - canvasBounds.width) / 2) < 0.1);
    assert.equal(await scene.getAttribute('aria-label'), '주사위 5, 2');
    await frame({ progress: 0.29 });
    const airborne = await capture('desktop-flight');
    await frame({ progress: 0.8 });
    const result = await capture('desktop-result');
    assert.notDeepEqual(airborne, result);
    const holdDraws = await page.evaluate(() => window.diceDraws);
    await frame({ progress: 0.96 });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.diceDraws), holdDraws, 'hold or idle caused another GPU render');
    for (let value = 1; value <= 6; value += 1) {
      await frame({ dice: [value], progress: 1 });
      await capture(`desktop-face-${value}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await frame({ dice: [6, 1], progress: 0.3 });
    await capture('mobile-flight');
    await frame({ progress: 1 });
    await capture('mobile-result');
    assert.equal(await scene.evaluate(el => getComputedStyle(el).width), '440px');
    assert.equal(await scene.evaluate(el => getComputedStyle(el).top), '38px');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await frame({ progress: 0.2 });
    const reduced = await capture('mobile-reduced');
    const reducedDraws = await page.evaluate(() => window.diceDraws);
    await frame({ progress: 0.6 });
    assert.equal(await page.evaluate(() => window.diceDraws), reducedDraws);
    assert.deepEqual(await capture('mobile-reduced-hold'), reduced);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await scene.evaluate(el => { el.style.display = 'none'; });
    await page.waitForTimeout(50);
    const hiddenDraws = await page.evaluate(() => window.diceDraws);
    await frame({ dice: [2, 4], progress: 0.4 });
    assert.equal(await page.evaluate(() => window.diceDraws), hiddenDraws);
    await scene.evaluate(el => { el.style.display = ''; });
    await page.waitForFunction(previous => window.diceDraws > previous, hiddenDraws);
    await scene.locator('canvas').evaluate(canvas => {
      const extension = canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
      window.restoreDiceContext = () => extension.restoreContext();
      extension.loseContext();
    });
    await page.waitForFunction(() => document.querySelector('[data-marble-dice]')?.dataset.renderer === 'fallback');
    await frame({ dice: [6, 3], progress: 0.7 });
    assert.equal(await scene.locator('[data-face="6"] [data-pip="true"]').count(), 6);
    assert.equal(await scene.locator('[data-face="3"] [data-pip="true"]').count(), 3);
    await capture('mobile-context-lost');
    await page.evaluate(() => window.restoreDiceContext());
    await waitReady();
    await frame({ progress: 1 });
    await capture('mobile-restored');
    await page.evaluate(() => window.unmountDice());
    await page.waitForFunction(() => document.querySelectorAll('canvas').length === 0);
    await frame({ dice: [4], progress: 1 });
    await waitReady();
    assert.equal(await scene.locator('canvas').count(), 1);
    assert.deepEqual(errors, []);
    await page.close();

    const startupPage = await browser.newPage({ viewport: { width: 390, height: 738 } });
    await startupPage.addInitScript(() => {
      // Model the first stage resize/reveal without a useful observer wakeup.
      window.IntersectionObserver = class {
        observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
      };
      const reveal = new MutationObserver(() => {
        const stage = document.getElementById('stage');
        if (!stage) return;
        reveal.disconnect();
        stage.style.opacity = '0';
        setTimeout(() => { stage.style.opacity = '1'; }, 120);
      });
      reveal.observe(document, { childList: true, subtree: true });
      let failOnce = true;
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type === '2d' && failOnce) { failOnce = false; throw new Error('transient dice texture test'); }
        return original.call(this, type, ...args);
      };
    });
    for (let reload = 0; reload < 3; reload += 1) {
      await startupPage.goto(url);
      await startupPage.waitForFunction(() => document.querySelector('[data-marble-dice]')?.dataset.diceStatus === 'ready', null, { timeout: 5000 });
      const startupScene = startupPage.locator('[data-marble-dice]');
      assert.equal(await startupScene.getAttribute('data-dice-attempts'), '2');
      assert.match(await startupScene.getAttribute('data-dice-error'), /transient dice texture test/);
      assert.equal(await startupScene.locator('canvas').count(), 1);
      assert.equal(await startupScene.getAttribute('data-renderer'), 'webgl');
    }
    await startupPage.setViewportSize({ width: 1440, height: 854 });
    await startupPage.evaluate(() => window.setDiceFrame({ dice: [3, 3], progress: 0.4 }));
    await startupPage.waitForFunction(() => document.querySelector('[data-marble-dice]')?.dataset.dice === '3,3');
    assert.equal(await startupPage.locator('[data-renderer="webgl"] canvas').count(), 1);
    await startupPage.close();

    const interruptedPage = await browser.newPage({ viewport: { width: 390, height: 738 } });
    let releaseImport;
    const importing = new Promise(resolve => { releaseImport = resolve; });
    await interruptedPage.route('**/RoundedBoxGeometry-*.js', async route => {
      await interruptedPage.locator('#stage').evaluate(el => { el.style.opacity = '0'; });
      await route.continue();
      releaseImport();
    });
    await interruptedPage.goto(url);
    await importing;
    await interruptedPage.waitForFunction(() => document.querySelector('[data-marble-dice]')?.dataset.diceStatus === 'waiting-visible');
    assert.equal(await interruptedPage.locator('canvas').count(), 0);
    await interruptedPage.locator('#stage').evaluate(el => { el.style.opacity = '1'; });
    await interruptedPage.waitForFunction(() => document.querySelector('[data-marble-dice]')?.dataset.diceStatus === 'ready', null, { timeout: 5000 });
    assert.equal(await interruptedPage.locator('canvas').count(), 1);
    await interruptedPage.close();

    const fallbackPage = await browser.newPage();
    await fallbackPage.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return type.includes('webgl') ? null : original.call(this, type, ...args);
      };
    });
    await fallbackPage.goto(url);
    await fallbackPage.waitForFunction(() => typeof window.setDiceFrame === 'function');
    await fallbackPage.evaluate(() => window.setDiceFrame({ dice: [1, 5], progress: 1 }));
    await fallbackPage.waitForFunction(() => document.querySelector('[data-marble-dice]')?.dataset.diceAttempts === '3');
    await fallbackPage.waitForTimeout(500);
    assert.equal(await fallbackPage.locator('[data-renderer="fallback"]').count(), 1);
    assert.equal(await fallbackPage.locator('[data-marble-dice]').getAttribute('data-dice-status'), 'context-failed');
    assert.equal(await fallbackPage.locator('[data-marble-dice]').getAttribute('data-dice-attempts'), '3');
    assert.equal(await fallbackPage.locator('[data-face="5"] [data-pip="true"]').count(), 5);
    assert.equal(await fallbackPage.locator('canvas').count(), 0);
    await fallbackPage.close();
    console.log(`Browser QA passed (desktop 1280x720, mobile 390x844, DPR capped at 2). Evidence: ${output}`);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
