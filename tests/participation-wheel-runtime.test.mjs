import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { createParticipationWheelRuntime, parseWheelCommand, registerParticipationWheelRoutes, wheelEventId } from '../server/participation-wheel-runtime.js';

const settings = {
  chat: { enabled: true, command: '!돌림판', perUserLimit: 2 },
  points: { enabled: true, command: '!돌림판추가', costPerSlot: 100 },
  donation: { enabled: true, wonPerSlot: 1000 },
};
const input = { sid: 'user:owner', userId: 'viewer', username: '시청자', channelUid: 'channel', provider: 'chzzk', text: '!돌림판 피자', event: { messageId: 'message-1' } };

test('free and paid commands support labels, optional integer slots and exact aliases', () => {
  assert.deepEqual(parseWheelCommand('!돌림판 아이스 아메리카노', settings), { source: 'chat', label: '아이스 아메리카노', slots: 1, command: '!돌림판' });
  assert.equal(parseWheelCommand('!돌림판추가 3 아이스 아메리카노', settings).slots, 3);
  assert.equal(parseWheelCommand('!돌림판추가 아이스 아메리카노', settings).slots, 1);
  assert.equal(parseWheelCommand('!돌림판다른명령 피자', settings), null);
  assert.equal(parseWheelCommand('!돌림판 피자', { ...settings, chat: { ...settings.chat, enabled: false } }), null);
  for (const text of ['!돌림판', '!돌림판추가 0 피자', '!돌림판추가 101 피자', `!돌림판 ${'가'.repeat(61)}`, '!돌림판 a\u0301\u0302\u0303\u0304']) {
    assert.equal(parseWheelCommand(text, settings).invalid, true, text);
  }
});

test('durable event keys use provider identity, not receipt time', () => {
  const key = wheelEventId({ ...input, kind: 'chat', now: 1 });
  assert.equal(key, wheelEventId({ ...input, kind: 'chat', now: 999999 }));
  assert.notEqual(key, wheelEventId({ ...input, provider: 'youtube', kind: 'chat', now: 1 }));
  const donation = { provider: 'chzzk', kind: 'donation', userId: 'same-viewer', event: { id: 'same-viewer', transactionId: 'tx-1' } };
  assert.equal(wheelEventId({ ...donation, now: 1 }), wheelEventId({ ...donation, now: 999999 }));
  assert.notEqual(wheelEventId(donation), wheelEventId({ ...donation, event: { transactionId: 'tx-2' } }));
});

test('a replay is handled without another receipt reply or event log', async () => {
  const calls = [], logs = [];
  const runtime = createParticipationWheelRuntime({ getWheel: async () => ({ settings }), enterWheel: async (sid, value) => {
    calls.push([sid, value]); return { accepted: true, duplicate: calls.length > 1, slots: 1, cost: 0 };
  }, recordEvent: async (...args) => { logs.push(args); } });
  assert.match((await runtime.chat(input)).reply, /피자 1칸 추가/);
  assert.deepEqual(await runtime.chat(input), { handled: true, reply: '' });
  assert.equal(calls[0][1].eventId, calls[1][1].eventId);
  assert.equal(logs.length, 1);
});

test('paid input delegates one atomic spend with trusted identity', async () => {
  let received;
  const runtime = createParticipationWheelRuntime({ getWheel: async () => ({ settings }), enterWheel: async (sid, value) => {
    received = { sid, ...value }; return { accepted: true, slots: value.slots, cost: value.slots * 100 };
  } });
  assert.match((await runtime.chat({ ...input, text: '!돌림판추가 4 커피' })).reply, /4칸 추가 \(400P 사용\)/);
  assert.equal(received.sid, input.sid);
  assert.equal(received.source, 'points');
  assert.equal(received.channelUid, input.channelUid);
  assert.equal(received.userId, input.userId);
  assert.equal(received.cost, undefined);
});

test('an inactive wheel never shadows existing custom commands or accepts donations', async () => {
  let calls = 0;
  const runtime = createParticipationWheelRuntime({ getWheel: async () => ({ settings, collecting: false }), enterWheel: async () => { calls++; } });
  assert.equal((await runtime.chat(input)).handled, false);
  assert.equal((await runtime.donation({ ...input, amount: 2000, currency: 'KRW' })).accepted, false);
  assert.equal(calls, 0);
});

test('command floods stop before the transaction and resume after the time window', async () => {
  let calls = 0, time = 0;
  const runtime = createParticipationWheelRuntime({ now: () => time, getWheel: async () => ({ settings }), enterWheel: async () => { calls++; return { accepted: true }; } });
  for (let index = 0; index < 20; index++) await runtime.chat(input);
  assert.equal(calls, 6);
  time = 10001;
  await runtime.chat(input);
  assert.equal(calls, 7);
});

test('invalid identity and argument errors never enter or deduct', async () => {
  let calls = 0;
  const runtime = createParticipationWheelRuntime({ getWheel: async () => ({ settings }), enterWheel: async () => { calls++; } });
  assert.equal((await runtime.chat({ ...input, userId: '' })).handled, true);
  assert.equal((await runtime.chat({ ...input, text: '!돌림판추가 1000 커피' })).handled, true);
  assert.equal((await runtime.chat({ ...input, text: '일반 채팅' })).handled, false);
  assert.equal(calls, 0);
});

test('donations require KRW and minimum amount and preserve stable source IDs', async () => {
  const calls = [];
  const runtime = createParticipationWheelRuntime({ getWheel: async () => ({ settings }), enterWheel: async (sid, value) => { calls.push(value); return { accepted: true, slots: 2 }; } });
  const donation = { ...input, amount: 2500, text: '후원 항목', currency: 'KRW', event: { transactionId: 'tx1' } };
  await runtime.donation({ ...donation, currency: 'USD' });
  await runtime.donation({ ...donation, amount: 999 });
  assert.equal(calls.length, 0);
  await runtime.donation(donation);
  assert.equal(calls[0].amount, 2500);
  assert.equal(calls[0].source, 'donation');
  assert.equal(calls[0].label, '후원 항목');
});

test('lookup cache coalesces bursts but invalidation exposes saved command edits', async () => {
  let reads = 0, time = 0, current = structuredClone(settings);
  const runtime = createParticipationWheelRuntime({ now: () => time, getWheel: async () => { reads++; return { settings: structuredClone(current) }; }, enterWheel: async () => ({ accepted: true }) });
  await Promise.all(Array.from({ length: 10 }, () => runtime.chat({ ...input, text: '!관련없는명령' })));
  assert.equal(reads, 1);
  current.chat.command = '!참여'; runtime.invalidate(input.sid);
  assert.equal((await runtime.chat(input)).handled, false);
  assert.equal((await runtime.chat({ ...input, text: '!참여 커피' })).handled, true);
  assert.equal(reads, 2);
  time = 1001; await runtime.chat(input);
  assert.equal(reads, 3);
});

async function routes(t, overrides = {}) {
  const app = express(); app.use(express.json());
  const calls = [];
  registerParticipationWheelRoutes(app, {
    getPartitionId: async (req) => req.headers['x-test-owner'] === 'owner' ? 'user:owner' : null,
    getWheel: async (sid) => ({ sid, settings, revision: 1 }),
    updateWheel: async (...args) => { calls.push(args); return { settings: args[1] }; },
    actWheel: async (...args) => { calls.push(args); return { latestSpin: { id: 'spin-1' } }; },
    getBotRules: async () => [], getBotSettings: async () => ({}), runtime: { invalidate() {} }, ...overrides,
  });
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/wheel`;
  return { calls, request: (path = '', method = 'GET', body, login = true) => fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(login ? { 'x-test-owner': 'owner' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }) };
}

test('management API is authenticated, tenant scoped, and read-only action names are rejected', async (t) => {
  const { calls, request } = await routes(t);
  assert.equal((await request('', 'GET', undefined, false)).status, 401);
  const response = await request('/action', 'POST', { sid: 'user:victim', action: 'add', requestId: 'request-1', source: 'points', label: '항목', slots: 2 });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(calls[0][0], 'user:owner');
  assert.equal(calls[0][1].source, undefined);
  assert.equal((await request('/action', 'POST', { action: 'enter', userId: 'victim' })).status, 400);
});

test('settings and opening reject aliases owned by existing commands', async (t) => {
  const { calls, request } = await routes(t, { getBotRules: async () => [{ enabled: true, keywords: ['!돌림판'] }] });
  assert.equal((await request('/settings', 'PUT', { settings, requestId: 'request-1' })).status, 409);
  assert.equal((await request('/settings', 'PUT', { settings: { title: '다른 제목' }, requestId: 'request-partial' })).status, 409);
  assert.equal((await request('/action', 'POST', { action: 'open', requestId: 'request-2' })).status, 409);
  assert.equal(calls.length, 0);
});

test('backend provider hooks connect all three chat and donation routes without starting the bot', () => {
  const source = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.equal((source.match(/participationWheelRuntime\.chat\(/g) || []).length, 3);
  assert.equal((source.match(/participationWheelRuntime\.donation\(/g) || []).length, 3);
  assert.ok(source.includes('registerParticipationWheelRoutes(app,'));
});
