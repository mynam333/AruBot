import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMarbleRuntime, assertMarbleCommandAvailable, marbleRuleConflict } from '../server/marble-runtime.js';
import { DEFAULT_MARBLE_SETTINGS } from '../shared/marble.js';
import { botManagementRoutePolicy, canUseBotManagementRoute } from '../shared/bot-management-policy.js';

function setup(options = {}) {
  let time = 10000;
  const settings = structuredClone(DEFAULT_MARBLE_SETTINGS);
  settings.points.enabled = true; settings.donation.enabled = true;
  settings.points.command = '!주루마블'; settings.points.cost = 100;
  settings.donation.minimum = 1000;
  let configuration = { settings, status: 'running', phase: 'ready' };
  const calls = [], logs = [];
  let reads = 0;
  const store = {
    configuration: async () => { reads++; return configuration; },
    trigger: async (owner, input) => { calls.push({ owner, ...input }); return { accepted: true, cost: input.source === 'points' ? 100 : 0 }; },
  };
  const runtime = createMarbleRuntime({ store, resolveOwner: sid => sid.replace(/^user:/, ''),
    now: () => time, recordEvent: async (...args) => logs.push(args), ...options });
  return { runtime, settings, store, calls, logs, reads: () => reads,
    setTime: value => { time = value; }, setConfig: value => { configuration = value; } };
}
const chat = provider => ({ sid: 'user:host', provider, userId: 'viewer', username: '시청자',
  channelUid: 'channel', text: '!주루마블', event: { messageId: 'message-1' } });

for (const provider of ['chzzk', 'cime', 'youtube']) {
  test(`${provider}: exact command forwards stable event and canonical owner, records cost`, async () => {
    const s = setup();
    const result = await s.runtime.chat(chat(provider));
    assert.equal(result.handled, true); assert.match(result.reply, /100P/);
    assert.equal(s.calls[0].owner, 'host'); assert.equal(s.calls[0].source, 'points');
    assert.equal(s.calls[0].channelUid, 'channel'); assert.equal(s.calls[0].userId, 'viewer');
    assert.match(s.calls[0].eventId, new RegExp(`^${provider}:chat:`));
    assert.equal(s.logs[0][1].pointDelta, -100);
  });
  test(`${provider}: donation event uses independent durable key and preserves currency`, async () => {
    const s = setup();
    await s.runtime.donation({ ...chat(provider), amount: 1500, currency: 'KRW' });
    assert.equal(s.calls[0].source, 'donation');
    assert.match(s.calls[0].eventId, new RegExp(`^${provider}:donation:`));
    assert.equal(s.logs[0][1].pointDelta, 0);
  });
}
test('normal chat, bot echo and unknown providers never call store', async () => {
  const s = setup();
  for (const input of [{ ...chat('cime'), text: '안녕하세요' }, { ...chat('cime'), isBotSelf: true }, chat('unknown')]) {
    assert.equal((await s.runtime.chat(input)).handled, false);
  }
  assert.equal(s.reads(), 0); assert.equal(s.calls.length, 0);
});
test('nonexisting or inactive game leaves other commands available', async () => {
  const s = setup(); s.setConfig(null);
  assert.equal((await s.runtime.chat(chat('cime'))).handled, false);
  s.setConfig({ settings: s.settings, status: 'finished' }); s.runtime.invalidate('host');
  assert.equal((await s.runtime.chat(chat('cime'))).handled, false);
  assert.equal(s.calls.length, 0);
});
test('cache is bounded by expiry and invalidation; args never reach point transaction', async () => {
  const s = setup();
  await s.runtime.chat({ ...chat('cime'), text: '!주루마블 something' });
  await s.runtime.chat({ ...chat('cime'), text: '!other' });
  assert.equal(s.reads(), 1); assert.equal(s.calls.length, 0);
  s.setTime(12000); await s.runtime.chat({ ...chat('cime'), text: '!other' });
  assert.equal(s.reads(), 2);
  s.runtime.invalidate('host'); await s.runtime.chat({ ...chat('cime'), text: '!other' });
  assert.equal(s.reads(), 3);
});
test('admission and flood budget cannot cause charges', async () => {
  const denied = setup({ admitCommand: async () => false });
  assert.equal((await denied.runtime.chat(chat('cime'))).reply, ''); assert.equal(denied.calls.length, 0);
  const s = setup();
  for (let i = 0; i < 8; i++) await s.runtime.chat({ ...chat('cime'), event: { messageId: `id-${i}` } });
  assert.equal(s.calls.length, 4);
});
test('duplicates are silent and not logged twice', async () => {
  const s = setup(); s.store.trigger = async () => ({ accepted: true, duplicate: true, cost: 100 });
  assert.equal((await s.runtime.chat(chat('cime'))).reply, ''); assert.equal(s.logs.length, 0);
});
test('transaction rejection or failure never produces success response', async () => {
  const s = setup(); s.store.trigger = async () => ({ accepted: false, reason: 'insufficient_points' });
  assert.doesNotMatch((await s.runtime.chat(chat('youtube'))).reply, /주사위를 굴립니다/);
  s.store.trigger = async () => { throw new Error('database down'); };
  assert.doesNotMatch((await s.runtime.chat(chat('youtube'))).reply, /주사위를 굴립니다/);
  assert.equal(s.logs.length, 0);
});
test('disabled bot, low amounts and non-KRW do not enqueue donations', async () => {
  const s = setup({ getBotSettings: async () => ({ botEnabled: false }) });
  for (const input of [{ amount: 5000, currency: 'USD' }, { amount: 500, currency: 'KRW' }, { amount: 5000, currency: 'KRW' }]) {
    assert.equal((await s.runtime.donation({ ...chat('youtube'), ...input })).accepted, false);
  }
  assert.equal(s.calls.length, 0);
});
test('command collisions include enabled rules, wildcard prefixes, wheel and attendance', () => {
  const s = setup();
  assert.throws(() => assertMarbleCommandAvailable(s.settings, { rules: [{ keywords: ['!주루마블'] }] }), /이미 사용 중/);
  assert.throws(() => assertMarbleCommandAvailable(s.settings, { rules: [{ keywords: ['!주루'], wildcard: true }] }), /이미 사용 중/);
  assert.throws(() => assertMarbleCommandAvailable(s.settings, { wheel: { settings: { chat: { enabled: true, command: '!주루마블' } } } }), /이미 사용 중/);
  assert.throws(() => assertMarbleCommandAvailable(s.settings, { bot: { attendanceCommandKeyword: '!주루마블' } }), /이미 사용 중/);
  assert.doesNotThrow(() => assertMarbleCommandAvailable(s.settings, { rules: [{ enabled: false, keywords: ['!주루마블'] }] }));
  assert.equal(marbleRuleConflict({ keywords: ['!주루'] }, '!주루마블'), false);
});
test('marble management scope does not grant participant or token routes', () => {
  const reader = { role: 'manager', scopes: ['marble:read'] };
  assert.equal(canUseBotManagementRoute(reader, botManagementRoutePolicy('GET', '/api/marble')), true);
  assert.equal(canUseBotManagementRoute(reader, botManagementRoutePolicy('POST', '/api/marble/action')), false);
  assert.equal(botManagementRoutePolicy('POST', '/api/viewer/marble/rooms/victim/action'), null);
  assert.equal(botManagementRoutePolicy('GET', '/api/overlays/marble'), null);
});
test('all providers wire command and donation ingress', () => {
  const code = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.equal((code.match(/marbleRuntime\.chat\(/g) || []).length, 3);
  assert.equal((code.match(/marbleRuntime\.donation\(/g) || []).length, 3);
  assert.match(code, /registerMarbleRoutes\(app/);
});

test('connected configuration uses actor settings but trigger and logging keep the source channel', async () => {
  const s = setup();
  s.setConfig({ status: 'running', connectedOwnerUserId: 'remote-host', settings: {
    points: { enabled: true, command: '!personal', cost: 250 }, donation: { enabled: true, minimum: 2000 },
  } });
  assert.equal((await s.runtime.chat(chat('chzzk'))).handled, false);
  assert.equal((await s.runtime.chat({ ...chat('chzzk'), text: '!personal' })).handled, true);
  assert.equal(s.calls[0].owner, 'host'); assert.equal(s.calls[0].channelUid, 'channel');
  assert.equal(s.logs[0][0], 'user:host');
  assert.equal((await s.runtime.donation({ ...chat('chzzk'), amount: 1999, currency: 'KRW' })).accepted, false);
  await s.runtime.donation({ ...chat('chzzk'), amount: '2000', currency: 'KRW' });
  assert.equal(s.calls[1].owner, 'host'); assert.equal(s.calls[1].amount, 2000);
  for (const status of ['finished', 'unavailable']) {
    s.setConfig({ settings: s.settings, status, connectedOwnerUserId: 'remote-host' });
    s.runtime.invalidate('host');
    assert.equal((await s.runtime.chat(chat('chzzk'))).handled, false);
    assert.equal((await s.runtime.donation({ ...chat('chzzk'), amount: 10000, currency: 'KRW' })).accepted, false);
  }
  assert.equal(s.calls.length, 2);
});

test('late invalidated cache reads neither authorize old commands nor overwrite a newer in-flight read', async () => {
  const s = setup();
  const pending = [];
  s.store.configuration = () => new Promise(resolve => pending.push(resolve));
  const old = s.runtime.chat(chat('cime'));
  while (pending.length < 1) await new Promise(resolve => setImmediate(resolve));
  s.runtime.invalidate('host');
  const fresh = s.runtime.chat({ ...chat('cime'), text: '!personal' });
  while (pending.length < 2) await new Promise(resolve => setImmediate(resolve));
  pending[0]({ settings: s.settings, status: 'running' });
  await new Promise(resolve => setImmediate(resolve));
  const joined = s.runtime.chat({ ...chat('cime'), text: '!not-a-command' });
  const next = { settings: { ...s.settings, points: { ...s.settings.points, command: '!personal' } }, status: 'running' };
  pending[1](next);
  assert.equal((await old).handled, false);
  assert.equal((await fresh).handled, true);
  assert.equal((await joined).handled, false);
  assert.equal(pending.length, 2); assert.equal(s.calls.length, 1);
  assert.equal((await s.runtime.chat(chat('cime'))).handled, false);
  assert.equal(pending.length, 2);
});

test('command collision normalization agrees with normalized paid trigger matching', () => {
  const settings = { points: { enabled: true, command: '!MARBLE' } };
  assert.throws(() => assertMarbleCommandAvailable(settings, { rules: [{ keywords: ['!ｍａｒｂｌｅ'] }] }), { code: 'command_conflict' });
  assert.throws(() => assertMarbleCommandAvailable(settings, { wheel: { settings: { points: { enabled: true, command: '!ＭＡＲＢＬＥ' } } } }), { code: 'command_conflict' });
});
