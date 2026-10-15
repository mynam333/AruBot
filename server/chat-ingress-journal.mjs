import fs from 'node:fs/promises';
import { constants as fsConstants, createReadStream } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const DAY = 86_400_000;
const MAX_EVENT_BYTES = 1024 * 1024;
const clone = (value) => structuredClone(value);
const digest = (value) => createHash('sha256').update(value).digest('hex');

export class ChatIngressError extends Error {
  constructor(code, message, statusCode = 409) {
    super(message);
    this.name = 'ChatIngressError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function identifier(value, field, max = 512) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new ChatIngressError('invalid_request', `Invalid ${field}`, 400);
  }
  return value;
}

function encode(record) {
  const body = JSON.stringify(record);
  return JSON.stringify({ body, checksum: digest(body) }) + '\n';
}

async function syncDirectory(directory) {
  // Windows does not expose fsync on directory handles. File contents are still fsynced.
  if (process.platform === 'win32') return;
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function replayWal(filename, apply) {
  let parts = [];
  let length = 0;
  let validBytes = 0;
  for await (const chunk of createReadStream(filename)) {
    let start = 0;
    while (start < chunk.length) {
      const end = chunk.indexOf(10, start);
      const part = chunk.subarray(start, end < 0 ? chunk.length : end);
      parts.push(part);
      length += part.length;
      if (end < 0) break;
      const line = JSON.parse(Buffer.concat(parts, length).toString('utf8'));
      if (typeof line.body !== 'string' || digest(line.body) !== line.checksum) throw new Error('Journal checksum mismatch');
      apply(JSON.parse(line.body));
      validBytes += length + 1;
      parts = [];
      length = 0;
      start = end + 1;
    }
  }
  return { validBytes, incompleteBytes: length };
}

async function acquireLock(directory) {
  const name = digest(directory).slice(0, 40);
  const address = process.platform === 'win32'
    ? `\\\\.\\pipe\\arubot-chat-ingress-${name}`
    : process.platform === 'linux' ? `\0arubot-chat-ingress-${name}` : null;
  if (!address) throw new Error('Chat ingress journal locking requires Linux or Windows');
  // The kernel guard makes stale PID-file removal safe against competing restarts.
  const guard = net.createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    guard.once('error', reject);
    guard.listen(address, resolve);
  }).catch((error) => {
    throw new ChatIngressError('journal_locked', `Journal is already in use: ${error.code}`, 503);
  });
  const lockPath = path.join(directory, 'ingress.pid');
  const token = randomUUID();
  try {
    try {
      const stat = await fs.lstat(lockPath);
      if (!stat.isFile()) throw new Error('Journal PID lock is not a regular file');
      const old = JSON.parse(await fs.readFile(lockPath, 'utf8'));
      let alive = true;
      try { process.kill(old.pid, 0); } catch (error) { alive = error.code !== 'ESRCH'; }
      if (alive) throw new ChatIngressError('journal_locked', 'Journal PID lock is held', 503);
      await fs.unlink(lockPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const lock = await fs.open(lockPath, 'wx', 0o600);
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, token, startedAt: Date.now() }));
      await lock.sync();
    } finally { await lock.close(); }
    await syncDirectory(directory);
  } catch (error) {
    await new Promise((resolve) => guard.close(resolve));
    throw error;
  }
  return async () => {
    try {
      const current = JSON.parse(await fs.readFile(lockPath, 'utf8'));
      if (current.token === token) await fs.unlink(lockPath);
    } finally { await new Promise((resolve) => guard.close(resolve)); }
  };
}

/** ACKs release payloads immediately. Recent receipts retain dedupe for 6h/100k
 * by default (configurable, never beyond 7d). Capacity eviction shortens that
 * window; monitor oldestAckedAt/evictedReceipts. Pending/uncertain work never expires. */
export async function createChatIngressJournal({
  directory,
  now = Date.now,
  retentionMs = 7 * DAY,
  dedupeTtlMs = 6 * 60 * 60 * 1000,
  maxAckedReceipts = 100_000,
  maxEventBytes = MAX_EVENT_BYTES,
  syncFile = (handle) => handle.sync(),
} = {}) {
  if (!directory) throw new Error('A persistent chat ingress journal directory is required');
  await fs.mkdir(path.resolve(directory), { recursive: true, mode: 0o700 });
  directory = await fs.realpath(path.resolve(directory));
  await fs.chmod(directory, 0o700);
  const releaseLock = await acquireLock(directory);
  const walPath = path.join(directory, 'events.wal');
  let handle;
  let closed = false;
  let closing = false;
  let closePromise;
  let failure = null;
  let tail = Promise.resolve();
  let entries = new Map();
  let dedupe = new Map();
  let runtime = { runtimeId: null, url: null, draining: false };
  let counts = { pending: 0, inflight: 0, acked: 0, uncertain: 0 };
  let pending = new Map();
  let busyOwners = new Map();
  let receipts = new Map();
  let evictedReceipts = 0;
  let walBytes = 0;
  if (!Number.isInteger(maxAckedReceipts) || maxAckedReceipts < 1 || maxAckedReceipts > 1_000_000
      || !Number.isFinite(dedupeTtlMs) || dedupeTtlMs < 60_000 || !Number.isFinite(retentionMs) || retentionMs < 60_000) {
    await releaseLock();
    throw new Error('Invalid journal receipt capacity or retention');
  }
  const receiptTtlMs = Math.min(7 * DAY, retentionMs, dedupeTtlMs);

  function pruneReceipts() {
    const cutoff = now() - receiptTtlMs;
    for (const [id, entry] of receipts) {
      if (receipts.size <= maxAckedReceipts && entry.completedAt >= cutoff) break;
      receipts.delete(id);
      entries.delete(id);
      if (entry.dedupeKey && dedupe.get(entry.dedupeKey) === id) dedupe.delete(entry.dedupeKey);
      counts.acked--;
      evictedReceipts++;
    }
  }

  function retainReceipt(entry) {
    const { id, provider, ownerUserId, sid, channelId, eventName, receivedAt } = entry.event;
    entry.event = { id, provider, ownerUserId, sid, channelId, eventName, receivedAt };
    receipts.set(id, entry);
    pruneReceipts();
  }

  function transition(entry, state) {
    if (entry.state) {
      counts[entry.state]--;
      if (entry.state === 'pending') pending.delete(entry.event.id);
      if (entry.state === 'inflight' || entry.state === 'uncertain') {
        const owner = entry.event.ownerUserId;
        const left = (busyOwners.get(owner) || 1) - 1;
        if (left) busyOwners.set(owner, left); else busyOwners.delete(owner);
      }
    }
    entry.state = state;
    counts[state]++;
    if (state === 'pending') pending.set(entry.event.id, entry);
    if (state === 'inflight' || state === 'uncertain') busyOwners.set(entry.event.ownerUserId, (busyOwners.get(entry.event.ownerUserId) || 0) + 1);
  }

  function rebuildIndexes() {
    counts = { pending: 0, inflight: 0, acked: 0, uncertain: 0 };
    pending = new Map();
    busyOwners = new Map();
    receipts = new Map();
    for (const entry of entries.values()) {
      const state = entry.state;
      delete entry.state;
      transition(entry, state);
      if (state === 'acked') {
        const { id, provider, ownerUserId, sid, channelId, eventName, receivedAt } = entry.event;
        entry.event = { id, provider, ownerUserId, sid, channelId, eventName, receivedAt };
        receipts.set(id, entry);
      }
    }
    receipts = new Map([...receipts].sort((a, b) => a[1].completedAt - b[1].completedAt));
    pruneReceipts();
  }

  function apply(record) {
    switch (record.op) {
      case 'snapshot':
        entries = new Map(record.entries.map((entry) => [entry.event.id, entry]));
        dedupe = new Map(record.entries.filter((entry) => entry.dedupeKey).map((entry) => [entry.dedupeKey, entry.event.id]));
        runtime = record.runtime;
        rebuildIndexes();
        break;
      case 'append':
        entries.set(record.entry.event.id, record.entry);
        delete record.entry.state;
        transition(record.entry, 'pending');
        if (record.entry.dedupeKey) dedupe.set(record.entry.dedupeKey, record.entry.event.id);
        break;
      case 'claim':
        for (const id of record.ids) {
          transition(entries.get(id), 'inflight');
          Object.assign(entries.get(id), { runtimeId: record.runtimeId, claimedAt: record.at });
        }
        break;
      case 'ack':
        transition(entries.get(record.id), 'acked');
        Object.assign(entries.get(record.id), { completedAt: record.at });
        retainReceipt(entries.get(record.id));
        break;
      case 'uncertain':
        for (const id of record.ids) {
          transition(entries.get(id), 'uncertain');
          Object.assign(entries.get(id), { reason: record.reason, completedAt: record.at });
        }
        if (record.drain) runtime.draining = true;
        break;
      case 'resolve': {
        const entry = entries.get(record.id);
        transition(entry, record.action === 'retry' ? 'pending' : 'acked');
        Object.assign(entry, {
          completedAt: record.at,
          resolution: { action: record.action, operator: record.operator, reason: record.reason, at: record.at },
        });
        if (record.action === 'retry') delete entry.runtimeId;
        // Retrying an explicitly reconciled event returns it to its original FIFO position.
        if (record.action === 'retry') rebuildIndexes();
        else retainReceipt(entry);
        break;
      }
      case 'runtime': runtime = record.runtime; break;
      default: throw new Error('Unknown journal operation');
    }
  }

  async function persist(record) {
    try {
      const encoded = encode(record);
      await handle.writeFile(encoded);
      await syncFile(handle);
      walBytes += Buffer.byteLength(encoded);
      apply(record);
    } catch (error) {
      failure = error;
      throw new ChatIngressError('journal_unavailable', 'Event persistence failed; ingress is stopped', 503);
    }
  }

  function run(task) {
    if (closing || closed) return Promise.reject(new ChatIngressError('journal_unavailable', 'Journal is unavailable', 503));
    const result = tail.then(() => {
      if (closed || failure) throw new ChatIngressError('journal_unavailable', 'Journal is unavailable', 503);
      return task();
    });
    tail = result.catch(() => {});
    return result;
  }

  function assertRuntime(runtimeId, allowDraining = false) {
    identifier(runtimeId, 'runtimeId');
    if (runtime.runtimeId !== runtimeId) throw new ChatIngressError('inactive_runtime', 'Only the active runtime may consume events');
    if (!allowDraining && runtime.draining) throw new ChatIngressError('runtime_draining', 'Runtime is draining');
  }

  function count(state) {
    return counts[state] || 0;
  }

  try {
    try {
      const stat = await fs.lstat(walPath);
      if (!stat.isFile()) throw new Error('Journal WAL is not a regular file');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    handle = await fs.open(walPath, fsConstants.O_CREAT | fsConstants.O_RDWR | fsConstants.O_APPEND, 0o600);
    await handle.chmod(0o600);
    const recovered = await replayWal(walPath, apply);
    walBytes = recovered.validBytes;
    if (recovered.incompleteBytes) {
      // Only an incomplete final record can be discarded; acknowledged lines must validate.
      await handle.close();
      await fs.truncate(walPath, recovered.validBytes);
      handle = await fs.open(walPath, 'a+', 0o600);
      await syncFile(handle);
    }
    await syncDirectory(directory);
    const interrupted = [...entries.values()].filter((entry) => entry.state === 'inflight').map((entry) => entry.event.id);
    if (interrupted.length) await persist({ op: 'uncertain', ids: interrupted, reason: 'ingress_restarted_during_execution', at: now(), drain: true });
  } catch (error) {
    await handle?.close().catch(() => {});
    await releaseLock();
    throw error;
  }

  return {
    directory,
    append(envelope) {
      return run(async () => {
        pruneReceipts();
        if (!envelope || typeof envelope !== 'object') throw new ChatIngressError('invalid_event', 'Invalid event', 400);
        const event = {
          id: randomUUID(),
          provider: identifier(envelope.provider, 'provider', 32),
          ownerUserId: identifier(envelope.ownerUserId, 'ownerUserId'),
          sid: identifier(envelope.sid, 'sid'),
          channelId: identifier(envelope.channelId, 'channelId'),
          eventName: identifier(envelope.eventName, 'eventName', 128),
          payload: envelope.payload ?? null,
          receivedAt: Number.isSafeInteger(envelope.receivedAt) && envelope.receivedAt > 0 ? envelope.receivedAt : now(),
        };
        const serialized = JSON.stringify(event);
        if (Buffer.byteLength(serialized) > maxEventBytes) throw new ChatIngressError('event_too_large', 'Event exceeds journal size limit', 413);
        const stableId = envelope.dedupeKey ?? envelope.eventKey ?? envelope.eventId ?? envelope.id;
        const key = stableId == null ? null : digest(JSON.stringify([event.provider, event.ownerUserId, event.channelId, event.eventName, identifier(String(stableId), 'dedupeKey', 2048)]));
        if (key && dedupe.has(key)) return { event: clone(entries.get(dedupe.get(key)).event), duplicate: true };
        const entry = { event: JSON.parse(serialized), dedupeKey: key, state: 'pending' };
        await persist({ op: 'append', entry });
        return { event: clone(entry.event), duplicate: false };
      });
    },
    claim({ runtimeId, limit = 32 }) {
      return run(async () => {
        assertRuntime(runtimeId);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ChatIngressError('invalid_request', 'limit must be between 1 and 100', 400);
        const busy = new Set(busyOwners.keys());
        const channelKey = (entry) => entry.event.ownerUserId;
        // An uncertain side effect blocks its channel until explicit operator reconciliation.
        const selected = [];
        for (const entry of pending.values()) {
          const key = channelKey(entry);
          if (entry.state !== 'pending' || busy.has(key)) continue;
          selected.push(entry);
          busy.add(key);
          if (selected.length >= limit) break;
        }
        if (selected.length) await persist({ op: 'claim', ids: selected.map((entry) => entry.event.id), runtimeId, at: now() });
        return selected.map((entry) => clone(entry.event));
      });
    },
    ack({ runtimeId, id }) {
      return run(async () => {
        assertRuntime(runtimeId, true);
        const entry = entries.get(identifier(id, 'id'));
        if (!entry || entry.runtimeId !== runtimeId || !['inflight', 'acked'].includes(entry.state)) throw new ChatIngressError('invalid_ack', 'Event is not owned by this runtime');
        if (entry.state === 'acked') return { acknowledged: true, duplicate: true };
        await persist({ op: 'ack', id, at: now() });
        return { acknowledged: true, duplicate: false };
      });
    },
    fail({ runtimeId, id, reason = 'handler_failed' }) {
      return run(async () => {
        assertRuntime(runtimeId, true);
        const entry = entries.get(identifier(id, 'id'));
        if (!entry || entry.runtimeId !== runtimeId || !['inflight', 'uncertain'].includes(entry.state)) throw new ChatIngressError('invalid_ack', 'Event is not owned by this runtime');
        if (entry.state === 'inflight') await persist({ op: 'uncertain', ids: [id], reason: String(reason).slice(0, 500), at: now() });
        return { uncertain: true };
      });
    },
    markRuntimeUncertain({ runtimeId, reason = 'runtime_unreachable' }) {
      return run(async () => {
        assertRuntime(runtimeId, true);
        const ids = [...entries.values()].filter((entry) => entry.state === 'inflight' && entry.runtimeId === runtimeId).map((entry) => entry.event.id);
        await persist({ op: 'uncertain', ids, reason: String(reason).slice(0, 500), at: now(), drain: true });
        return { uncertain: ids.length };
      });
    },
    activate({ runtimeId, url, expectedRuntimeId }) {
      return run(async () => {
        identifier(runtimeId, 'runtimeId');
        identifier(url, 'url', 2048);
        if (expectedRuntimeId !== runtime.runtimeId) throw new ChatIngressError('runtime_conflict', 'Active runtime changed');
        if (runtime.runtimeId === runtimeId && runtime.url === url && !runtime.draining) return clone(runtime);
        if (count('inflight')) throw new ChatIngressError('runtime_busy', 'Inflight events must finish before activation');
        if (runtime.runtimeId && runtime.runtimeId !== runtimeId && !runtime.draining) throw new ChatIngressError('runtime_not_drained', 'Drain the old runtime before activation');
        await persist({ op: 'runtime', runtime: { runtimeId, url, draining: false } });
        return clone(runtime);
      });
    },
    drain({ runtimeId }) {
      return run(async () => {
        assertRuntime(runtimeId, true);
        if (!runtime.draining) await persist({ op: 'runtime', runtime: { ...runtime, draining: true } });
        return clone(runtime);
      });
    },
    resume({ runtimeId }) {
      return run(async () => {
        assertRuntime(runtimeId, true);
        if (runtime.draining) await persist({ op: 'runtime', runtime: { ...runtime, draining: false } });
        return clone(runtime);
      });
    },
    status() {
      return {
        protocolVersion: 1,
        activeRuntimeId: runtime.runtimeId,
        activeRuntimeUrl: runtime.url,
        draining: runtime.draining,
        inflight: count('inflight'),
        backlog: count('pending'),
        uncertain: count('uncertain'),
        acked: count('acked'),
        journalBytes: walBytes,
        dedupeEntries: dedupe.size,
        maxAckedReceipts,
        dedupeTtlMs: receiptTtlMs,
        evictedReceipts,
        oldestAckedAt: receipts.values().next().value?.completedAt ?? null,
        healthy: !failure && !closed && !closing,
      };
    },
    listUncertain({ limit = 100 } = {}) {
      return [...entries.values()].filter((entry) => entry.state === 'uncertain').slice(0, Math.min(100, Math.max(1, limit))).map(clone);
    },
    resolveUncertain({ id, action, operator, reason, confirm }) {
      return run(async () => {
        if (!['retry', 'discard'].includes(action) || confirm !== 'I_HAVE_RECONCILED_SIDE_EFFECTS') {
          throw new ChatIngressError('reconciliation_required', 'Explicit side-effect reconciliation is required', 400);
        }
        identifier(operator, 'operator');
        identifier(reason, 'reason');
        const entry = entries.get(identifier(id, 'id'));
        if (!entry || entry.state !== 'uncertain') throw new ChatIngressError('not_uncertain', 'Event is not uncertain');
        await persist({ op: 'resolve', id, action, operator, reason, at: now() });
        return { resolved: true, action };
      });
    },
    compact() {
      return run(async () => {
        const before = entries.size;
        pruneReceipts();
        const retained = [...entries.values()];
        const removed = before - retained.length;
        const record = { op: 'snapshot', entries: retained, runtime };
        const tempPath = path.join(directory, `events-${randomUUID()}.tmp`);
        let temp;
        try {
          temp = await fs.open(tempPath, 'wx', 0o600);
          const encoded = encode(record);
          await temp.writeFile(encoded);
          await syncFile(temp);
          await temp.close();
          temp = null;
          await handle.close();
          await fs.rename(tempPath, walPath);
          await syncDirectory(directory);
          handle = await fs.open(walPath, 'a+', 0o600);
          walBytes = Buffer.byteLength(encoded);
          apply(record);
          return { removed, retained: retained.length };
        } catch (error) {
          failure = error;
          throw new ChatIngressError('journal_unavailable', 'Journal compaction failed; ingress is stopped', 503);
        } finally { await temp?.close().catch(() => {}); }
      });
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        await tail;
        closed = true;
        try { await handle.close(); } finally { await releaseLock(); }
      })();
      return closePromise;
    },
  };
}
