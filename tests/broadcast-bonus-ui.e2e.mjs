// Run Next dev on 3107 with ARUBOT_API_INTERNAL_BASE and NEXT_PUBLIC_API_BASE
// set to http://127.0.0.1:3198, then node --test tests/broadcast-bonus-ui.e2e.mjs.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { BROADCAST_BONUS_CATEGORIES, MAX_BROADCAST_BONUS } from '../shared/broadcast-bonus.js';

const base = 'http://127.0.0.1:3107';
const channel = 'chzzk:bonus-fixture';
const publicPath = `/c/${encodeURIComponent(channel)}/points`;
const publicApi = `/api/public/${encodeURIComponent(channel)}/broadcast-bonus`;
const adminApi = '/api/points/broadcast-bonus';
const sessionKey = '00000000-0000-4000-8000-000000000001';
const first = { live: true, sessionKey, amount: 200, categories: ['video'] };
const offline = { live: false, sessionKey: null, amount: 0, categories: [] };
const ranking = { points: [{ username: '테스트 시청자', points: 321 }], total: 1, totalPoints: 321 };
const shots = process.env.ARUBOT_BONUS_SHOTS;
let browser, server;

before(async () => {
  // Only the non-personalized profile and ordinary ranking are read by Next SSR.
  server = createServer((req, res) => {
    const pathname = new URL(req.url, base).pathname;
    const body = pathname.endsWith('/points') ? ranking : pathname.endsWith('/profile') ? { displayName: '테스트 방송' } : null;
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(3198, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  if (shots) await mkdir(shots, { recursive: true });
});
after(async () => { await browser?.close(); server?.closeAllConnections(); server?.close(); });

async function open(t, { scopes = ['points:write'], path = '/points', mobile = false, api }) {
  const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource:')) errors.push(msg.text());
  });
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  page.setDefaultTimeout(8000);
  const active = { ownerUserId: 'owner', displayName: '테스트 방송', role: 'manager', scopes };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const headers = { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS' };
    const reply = (json, status = 200) => route.fulfill({ json, status, headers });
    if (method === 'OPTIONS') return reply(null);
    if (url.pathname.endsWith('/broadcast-bonus')) return api({ route, url, method, reply });
    if (url.pathname === '/api/bot-management/context') return reply({ actorUserId: 'manager', isSiteAdmin: false, active, channels: [active], scopeGroups: [] });
    if (url.pathname === '/api/channelpoints/list') return reply({ ...ranking, settings: {} });
    if (url.pathname === '/api/donation/settings') return reply({ settings: {} });
    if (url.pathname === '/api/viewer/points') return reply({ totalPoints: 321, balances: [], platforms: [] });
    if (url.pathname.endsWith('/points')) return reply(ranking);
    return reply({}, 404);
  });
  const response = await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  assert.equal(response.status(), 200);
  return page;
}

async function capture(page, name) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  if (shots) await page.screenshot({ path: join(shots, name + '.png') });
}

async function expandBonus(panel) {
  const summary = panel.locator('summary');
  await summary.waitFor();
  assert.equal(await panel.locator('details').evaluate((el) => el.open), false);
  assert.equal(await panel.locator('details > div').isVisible(), false);
  await summary.focus();
  await summary.press('Enter');
  await panel.locator('details[open]').waitFor();
}

test('delegated editor saves only this session, validates limits and can turn it off', async (t) => {
  let saved = first;
  const writes = [];
  const page = await open(t, { api: ({ url, method, route, reply }) => {
    assert.equal(url.pathname, adminApi);
    assert.equal(url.searchParams.get('botOwner'), 'owner');
    if (method === 'PUT') {
      const payload = route.request().postDataJSON();
      writes.push(payload);
      saved = { ...saved, ...payload };
    }
    return reply(saved);
  } });
  const panel = page.getByRole('region', { name: '추가 포인트' });
  const amount = panel.getByLabel('1인당 추가 포인트 (P)');
  const save = panel.getByRole('button', { name: '추가 포인트 저장' });
  await expandBonus(panel);
  await panel.getByText('방송 중 · 사용 중').waitFor();
  assert.equal(await amount.inputValue(), '200');
  for (const { label } of BROADCAST_BONUS_CATEGORIES) assert.ok(await panel.getByLabel(label).isVisible());
  assert.ok(await save.isDisabled());
  for (const invalid of ['', '-1', '1.5', String(MAX_BROADCAST_BONUS + 1)]) {
    await amount.fill(invalid);
    assert.ok(await save.isDisabled());
  }
  await amount.fill('500');
  await panel.locator('summary').click();
  assert.ok(await amount.isHidden());
  await expandBonus(panel);
  assert.equal(await amount.inputValue(), '500');
  assert.equal(writes.length, 0);
  await panel.getByLabel(BROADCAST_BONUS_CATEGORIES[0].label).uncheck();
  assert.ok(await save.isDisabled());
  await panel.getByLabel(BROADCAST_BONUS_CATEGORIES[1].label).check();
  await save.click();
  await panel.getByText('추가 포인트를 저장했습니다.').waitFor();
  await capture(page, 'admin-desktop');
  await amount.fill('0');
  await save.click();
  await panel.getByText('방송 중 · 사용 안 함').waitFor();
  assert.deepEqual(writes, [500, 0].map((value) => ({ sessionKey, amount: value, categories: ['bgm'] })));
});

test('offline, failed reads and changed broadcasts cannot submit a stale draft', async (t) => {
  let state = offline, status = 200;
  const writes = [];
  const page = await open(t, { mobile: true, api: ({ method, route, reply }) => {
    if (method === 'PUT') {
      writes.push(route.request().postDataJSON());
      state = { ...first, sessionKey: '00000000-0000-4000-8000-000000000002', amount: 40 };
      return reply({}, 409);
    }
    return reply(state, status);
  } });
  const panel = page.getByRole('region', { name: '추가 포인트' });
  const refresh = panel.getByRole('button', { name: '방송 상태 새로고침' });
  const amount = panel.getByRole('spinbutton');
  const save = panel.getByRole('button', { name: '추가 포인트 저장' });
  await expandBonus(panel);
  await panel.getByText('오프라인').waitFor();
  assert.ok(await amount.isDisabled());
  assert.ok(await save.isDisabled());
  await panel.scrollIntoViewIfNeeded();
  await capture(page, 'admin-mobile-offline');
  state = first;
  await refresh.click();
  await amount.fill('77');
  status = 503;
  await refresh.click();
  await panel.getByText('조회 실패').waitFor();
  assert.ok(await save.isDisabled());
  status = 200;
  await refresh.click();
  await panel.getByText('방송 중 · 사용 중').waitFor();
  assert.equal(await amount.inputValue(), '77');
  await save.click();
  await panel.getByText('방송 상태가 바뀌었습니다.', { exact: false }).waitFor();
  await page.waitForFunction(() => document.querySelector('#broadcast-bonus-amount').value === '40');
  assert.ok(await save.isDisabled());
  assert.deepEqual(writes, [{ sessionKey, amount: 77, categories: ['video'] }]);
});

test('points:read plus donations:write allows inspection but no mutation', async (t) => {
  const methods = [];
  const page = await open(t, { scopes: ['points:read', 'donations:write'], api: ({ method, reply }) => { methods.push(method); return reply(first); } });
  const panel = page.getByRole('region', { name: '추가 포인트' });
  await expandBonus(panel);
  await panel.getByText('포인트 쓰기 권한이 필요합니다.').waitFor();
  assert.ok(await panel.getByRole('spinbutton').isDisabled());
  assert.ok(await panel.getByRole('checkbox').first().isDisabled());
  assert.ok(await panel.getByRole('button', { name: '추가 포인트 저장' }).isDisabled());
  await panel.locator('form').evaluate((form) => form.requestSubmit());
  assert.ok(methods.every((method) => method === 'GET'));
});

test('public limit and private remaining stay separate from ranking, including zero and guest', async (t) => {
  let state = { live: true, amount: 500, categories: ['bgm', 'roulette'], remaining: 125 };
  let pause, release;
  const page = await open(t, { path: publicPath, mobile: true, api: async ({ url, method, reply }) => {
    assert.equal(url.pathname, publicApi);
    assert.equal(method, 'GET');
    const result = state;
    if (pause) { const notify = pause; pause = null; await new Promise((resolve) => { release = resolve; notify(); }); }
    return reply(result);
  } });
  const panel = page.getByRole('region', { name: '추가 포인트' });
  const row = page.getByRole('row').filter({ hasText: '테스트 시청자' });
  await expandBonus(panel);
  await panel.getByText('125P', { exact: true }).waitFor();
  await row.getByText('321P').waitFor();
  await capture(page, 'public-mobile');
  const signal = (name) => page.evaluate((event) => window.dispatchEvent(new Event(event)), name);
  state = { ...state, remaining: 0 };
  await signal('focus');
  await panel.getByText('0P', { exact: true }).waitFor();
  const pending = new Promise((resolve) => { pause = resolve; });
  await signal('focus');
  await pending;
  assert.ok(await panel.isHidden());
  state = { ...state, remaining: null };
  await signal('arubot:auth-changed');
  await panel.getByText('500P').waitFor();
  release();
  assert.ok(await panel.getByText('남은 추가 포인트').isHidden());
  assert.match(await panel.textContent(), /BGM 신청 · 룰렛/);
  for (const inactive of [{ ...state, amount: 0 }, { ...state, live: false }]) {
    state = { ...state, amount: 500, live: true };
    await signal('focus');
    await panel.getByText('500P').waitFor();
    state = inactive;
    const response = page.waitForResponse((res) => new URL(res.url()).pathname === publicApi);
    await signal('focus');
    await response;
    assert.ok(await panel.isHidden());
    assert.ok(await row.getByText('321P').isVisible());
  }
});

test('a failed public poll drops the personal balance; subsequent reads are not cached', async (t) => {
  let status = 200, remaining = 90;
  const page = await open(t, { path: publicPath, api: ({ reply }) =>
    reply({ live: true, amount: 200, categories: ['command'], remaining }, status) });
  const panel = page.getByRole('region', { name: '추가 포인트' });
  await expandBonus(panel);
  await panel.getByText('90P', { exact: true }).waitFor();
  await page.evaluate(() => {
    const original = window.fetch;
    window.bonusReads = [];
    window.fetch = (input, options) => {
      if (String(input).includes('/broadcast-bonus')) window.bonusReads.push([options.credentials, options.cache]);
      return original(input, options);
    };
  });
  // Let the periodic read fail without an auth or visibility event clearing it first.
  status = 503;
  await panel.waitFor({ state: 'hidden', timeout: 20_000 });
  status = 200;
  remaining = 35;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await panel.getByText('35P').waitFor();
  const reads = await page.evaluate(() => window.bonusReads);
  assert.ok(reads.length >= 2);
  reads.forEach((read) => assert.deepEqual(read, ['include', 'no-store']));
});

test('viewer overview shows ordinary points without advertising the event feature', async (t) => {
  const calls = [];
  const page = await open(t, { path: '/viewer/me', api: ({ url, reply }) => { calls.push(url.pathname); return reply({}, 403); } });
  await page.getByText('방송별 일반 포인트의 합계입니다.').waitFor();
  assert.equal(await page.getByText('추가 포인트', { exact: false }).count(), 0);
  assert.deepEqual(calls, []);
});
