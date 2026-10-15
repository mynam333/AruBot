import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createChatIngressJournal } from '../server/chat-ingress-journal.mjs';

const runtime = { runtimeId: 'blue', url: 'http://127.0.0.1:3710', expectedRuntimeId: null };
const event = (id, owner = 'alice', provider = 'chzzk') => ({ provider, ownerUserId: owner, sid: `user:${owner}`, channelId: `channel:${owner}`, eventName: 'chat', dedupeKey: id, payload: { message: `!command ${id}` } });
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'arubot-ingress-journal-'));
  const journal = await createChatIngressJournal({ directory, ...options });
  t.after(async () => { await journal.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return { journal, directory };
}

test('an event is neither accepted nor claimable before its actual fsync completes', async (t) => {
  const gate = deferred();
  let syncs = 0;
  const { journal, directory } = await fixture(t, {
    syncFile: async (handle) => { syncs++; await handle.sync(); if (syncs === 1) await gate.promise; },
  });
  let accepted = false;
  const append = journal.append(event('one')).then((result) => { accepted = true; return result; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(accepted, false);
  assert.equal(journal.status().backlog, 0);
  assert.match(await fs.readFile(path.join(directory, 'events.wal'), 'utf8'), /checksum/);
  gate.resolve();
  await append;
  assert.equal(journal.status().backlog, 1);
  assert.equal(syncs, 1);
});

test('dedupe is scoped to owner/channel/event and persists after ACK and journal restart', async (t) => {
  const { journal, directory } = await fixture(t);
  const first = await journal.append(event('same'));
  assert.equal((await journal.append(event('same'))).event.id, first.event.id);
  await journal.append(event('same', 'bob'));
  await journal.activate(runtime);
  const claimed = await journal.claim({ runtimeId: 'blue', limit: 20 });
  assert.equal(claimed.length, 2);
  await journal.ack({ runtimeId: 'blue', id: first.event.id });
  await journal.fail({ runtimeId: 'blue', id: claimed[1].id });
  await journal.close();
  const reopened = await createChatIngressJournal({ directory });
  assert.equal((await reopened.append(event('same'))).duplicate, true);
  assert.equal(reopened.status().uncertain, 1);
  assert.equal(reopened.status().backlog, 0);
  await reopened.close();
});

test('one inflight event per real owner preserves FIFO even across platforms; owners run concurrently', async (t) => {
  const { journal } = await fixture(t);
  const a1 = (await journal.append(event('a1'))).event;
  const a2 = (await journal.append(event('a2', 'alice', 'youtube'))).event;
  const b1 = (await journal.append(event('b1', 'bob'))).event;
  await journal.activate(runtime);
  assert.deepEqual((await journal.claim({ runtimeId: 'blue' })).map((item) => item.id), [a1.id, b1.id]);
  assert.deepEqual(await journal.claim({ runtimeId: 'blue' }), []);
  await journal.ack({ runtimeId: 'blue', id: a1.id });
  assert.deepEqual((await journal.claim({ runtimeId: 'blue' })).map((item) => item.id), [a2.id]);
});

test('drain stops claims, still accepts events/ACK, and CAS activation cannot cross inflight work', async (t) => {
  const { journal } = await fixture(t);
  await journal.append(event('a1'));
  await journal.activate(runtime);
  const [claimed] = await journal.claim({ runtimeId: 'blue' });
  await assert.rejects(journal.claim({ runtimeId: 'green' }), { code: 'inactive_runtime' });
  await journal.drain({ runtimeId: 'blue' });
  await journal.append(event('a2'));
  await assert.rejects(journal.claim({ runtimeId: 'blue' }), { code: 'runtime_draining' });
  const green = { runtimeId: 'green', url: 'http://127.0.0.1:3711', expectedRuntimeId: 'blue' };
  await assert.rejects(journal.activate(green), { code: 'runtime_busy' });
  await assert.rejects(journal.ack({ runtimeId: 'green', id: claimed.id }), { code: 'inactive_runtime' });
  await journal.ack({ runtimeId: 'blue', id: claimed.id });
  await assert.rejects(journal.activate({ ...green, expectedRuntimeId: null }), { code: 'runtime_conflict' });
  await journal.activate(green);
  await assert.rejects(journal.ack({ runtimeId: 'blue', id: claimed.id }), { code: 'inactive_runtime' });
  assert.equal((await journal.claim({ runtimeId: 'green' }))[0].payload.message, '!command a2');
});

test('concurrent claims cannot claim the same event, and ACK retries are idempotent', async (t) => {
  const { journal } = await fixture(t);
  await journal.append(event('a1'));
  await journal.activate(runtime);
  const claims = await Promise.all(Array.from({ length: 12 }, () => journal.claim({ runtimeId: 'blue' })));
  const claimed = claims.flat();
  assert.equal(claimed.length, 1);
  assert.equal((await journal.ack({ runtimeId: 'blue', id: claimed[0].id })).duplicate, false);
  assert.equal((await journal.ack({ runtimeId: 'blue', id: claimed[0].id })).duplicate, true);
});

test('uncertain executions block owner FIFO until explicit reconciled operator action', async (t) => {
  const { journal } = await fixture(t);
  await journal.append(event('a1'));
  await journal.append(event('a2'));
  await journal.activate(runtime);
  const [item] = await journal.claim({ runtimeId: 'blue' });
  await journal.fail({ runtimeId: 'blue', id: item.id, reason: 'remote_side_effect_unknown' });
  assert.deepEqual(await journal.claim({ runtimeId: 'blue' }), []);
  await assert.rejects(journal.resolveUncertain({ id: item.id, action: 'retry' }), { code: 'reconciliation_required' });
  await journal.resolveUncertain({ id: item.id, action: 'discard', operator: 'operator', reason: 'Confirmed external action completed', confirm: 'I_HAVE_RECONCILED_SIDE_EFFECTS' });
  assert.equal((await journal.claim({ runtimeId: 'blue' }))[0].payload.message, '!command a2');
});

test('compaction retains all pending/uncertain events and seven days of ACK dedupe', async (t) => {
  let now = 1_000_000;
  const { journal, directory } = await fixture(t, { now: () => now, dedupeTtlMs: 7 * 86_400_000 });
  await journal.append(event('old'));
  await journal.append(event('pending'));
  await journal.append(event('uncertain', 'bob'));
  await journal.activate(runtime);
  const [old, uncertain] = await journal.claim({ runtimeId: 'blue' });
  await journal.ack({ runtimeId: 'blue', id: old.id });
  await journal.fail({ runtimeId: 'blue', id: uncertain.id });
  now += 6 * 86_400_000;
  assert.equal((await journal.compact()).removed, 0);
  now += 2 * 86_400_000;
  assert.equal((await journal.compact()).removed, 1);
  assert.equal(journal.status().backlog, 1);
  assert.equal(journal.status().uncertain, 1);
  await journal.close();
  const reopened = await createChatIngressJournal({ directory, now: () => now });
  assert.equal(reopened.status().backlog, 1);
  assert.equal(reopened.status().uncertain, 1);
  await reopened.close();
});

test('fsync failure fails closed without exposing an unpersisted event to consumers', async (t) => {
  const { journal } = await fixture(t, { syncFile: async () => { throw new Error('disk full'); } });
  await assert.rejects(journal.append(event('one')), { code: 'journal_unavailable' });
  assert.equal(journal.status().healthy, false);
  assert.equal(journal.status().backlog, 0);
  await assert.rejects(journal.append(event('two')), { code: 'journal_unavailable' });
});

test('ACK immediately releases raw payloads, including WAL replay, and compaction only retains receipts', async (t) => {
  const { journal, directory } = await fixture(t);
  const input = { ...event('large'), payload: { message: 'RAW_CONTENT_MUST_NOT_REMAIN_AFTER_COMPACTION'.repeat(1000) } };
  await journal.append(input);
  await journal.activate(runtime);
  const [item] = await journal.claim({ runtimeId: 'blue' });
  await journal.ack({ runtimeId: 'blue', id: item.id });
  assert.equal((await journal.append(input)).event.payload, undefined);
  const before = journal.status().journalBytes;
  assert.equal(before, (await fs.stat(path.join(directory, 'events.wal'))).size);
  await journal.close();
  const reopened = await createChatIngressJournal({ directory });
  assert.equal((await reopened.append(input)).event.payload, undefined);
  assert.equal(reopened.status().acked, 1);
  await reopened.compact();
  assert.ok(reopened.status().journalBytes < before / 10);
  assert.equal((await fs.readFile(path.join(directory, 'events.wal'), 'utf8')).includes('RAW_CONTENT_MUST_NOT_REMAIN'), false);
  await reopened.close();
});

test('receipt capacity and TTL are bounded without evicting pending or uncertain work', async (t) => {
  let now = 1_000_000;
  const { journal } = await fixture(t, { now: () => now, dedupeTtlMs: 60_000, maxAckedReceipts: 2 });
  for (const owner of ['one', 'two', 'three']) await journal.append(event(owner, owner));
  await journal.activate(runtime);
  for (const item of await journal.claim({ runtimeId: 'blue' })) {
    await journal.ack({ runtimeId: 'blue', id: item.id });
    now += 1000;
  }
  assert.equal(journal.status().acked, 2);
  assert.equal(journal.status().dedupeEntries, 2);
  assert.equal(journal.status().evictedReceipts, 1);
  await journal.append(event('uncertain', 'four'));
  const [uncertain] = await journal.claim({ runtimeId: 'blue' });
  await journal.fail({ runtimeId: 'blue', id: uncertain.id });
  await journal.append(event('pending', 'four'));
  now += 120_000;
  await journal.compact();
  assert.equal(journal.status().acked, 0);
  assert.equal(journal.status().uncertain, 1);
  assert.equal(journal.status().backlog, 1);
  assert.equal(journal.status().dedupeEntries, 2);
  assert.equal(journal.status().evictedReceipts, 3);
});

test('partial final WAL write is truncated, but a complete corrupt record fails startup', async (t) => {
  const { journal, directory } = await fixture(t);
  await journal.append(event('saved'));
  await journal.close();
  const filename = path.join(directory, 'events.wal');
  await fs.appendFile(filename, '{"body":"torn');
  const reopened = await createChatIngressJournal({ directory });
  assert.equal(reopened.status().backlog, 1);
  await reopened.close();
  await fs.appendFile(filename, '{"body":"{}","checksum":"wrong"}\n');
  await assert.rejects(createChatIngressJournal({ directory }), /checksum/);
});

test('exclusive kernel/PID guard rejects a second ingress and crash restart marks inflight uncertain', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'arubot-ingress-child-'));
  const moduleUrl = new URL('../server/chat-ingress-journal.mjs', import.meta.url).href;
  const source = `
    import { createChatIngressJournal } from ${JSON.stringify(moduleUrl)};
    const journal = await createChatIngressJournal({directory: process.env.TEST_JOURNAL});
    await journal.append(${JSON.stringify(event('crash'))});
    await journal.append(${JSON.stringify(event('waiting'))});
    await journal.activate(${JSON.stringify(runtime)});
    const [item] = await journal.claim({runtimeId:'blue'});
    process.send({ready:true, id:item.id});
    setInterval(()=>{}, 1000);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env, TEST_JOURNAL: directory }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode == null && child.signalCode == null) { child.kill('SIGKILL'); await once(child, 'exit'); }
    await fs.rm(directory, { recursive: true, force: true });
  });
  const message = await Promise.race([once(child, 'message'), once(child, 'exit').then(() => { throw new Error(stderr); })]);
  assert.equal(message[0].ready, true);
  await assert.rejects(createChatIngressJournal({ directory }), { code: 'journal_locked' });
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  const recovered = await createChatIngressJournal({ directory });
  assert.equal(recovered.status().uncertain, 1);
  assert.equal(recovered.status().backlog, 1);
  assert.equal(recovered.status().draining, true);
  await recovered.resume({ runtimeId: 'blue' });
  assert.deepEqual(await recovered.claim({ runtimeId: 'blue' }), []);
  await recovered.close();
});
