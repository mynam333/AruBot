import { randomUUID } from 'node:crypto';
import { extractChatEmotes } from './emote-extractor.js';
import { createChzzkEmoteSamples } from '../shared/emote-samples.js';

export function createEmoteOverlayRuntime({ store, logger = console, now = Date.now }) {
  const cache = new Map();
  const queues = new Map();
  const watchers = new Map();
  let stopped = false;
  let lastWarning = -Infinity;
  const warn = error => {
    if (now() - lastWarning < 30_000) return;
    lastWarning = now(); logger.warn('[emote-overlay] Processing unavailable:', error?.message || 'unknown error');
  };
  async function config(owner) {
    const hit = cache.get(owner);
    if (hit && now() - hit.at < 5000) return hit.promise;
    const record = { at: now(), promise: Promise.resolve().then(() => store.get(owner)) };
    cache.set(owner, record);
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    try { return await record.promise; }
    catch (error) { if (cache.get(owner) === record) cache.delete(owner); throw error; }
  }
  function wake(path) {
    const token = path?.split('/').at(-1);
    for (const listener of watchers.get(token) || []) { try { listener(); } catch (error) { warn(error); } }
  }
  function enqueue(owner, event) {
    const queue = queues.get(owner) || { tail: Promise.resolve(), pending: 0, generation: 0 };
    if (stopped || queue.pending >= 16 || (!queues.has(owner) && queues.size >= 1000)) return;
    queues.set(owner, queue); queue.pending++;
    const generation = queue.generation, expiresAt = now() + 8000;
    queue.tail = queue.tail.then(async () => {
      if (generation !== queue.generation || now() >= expiresAt) return;
      const record = await config(owner);
      if (!record?.settings.enabled || generation !== queue.generation || now() >= expiresAt) return;
      if (await store.append(owner, event, { epoch: record.epoch, expiresAt })) wake(record.viewerPath);
    }).catch(warn).finally(() => { queue.pending--; if (!queue.pending) queues.delete(owner); });
  }
  function ingestEvent(entry, event) {
    if (stopped || event?.type !== 'chat') return;
    const timestamp = event.ts ?? event.raw?.messageTime;
    const ts = typeof timestamp === 'string' && !/^\d+$/.test(timestamp) ? Date.parse(timestamp) : Number(timestamp || 0);
    if (ts && now() - ts > 15000) return;
    const provider = event.provider || entry.provider || 'chzzk';
    const normalized = extractChatEmotes(provider, event);
    if (!normalized) return;
    const owners = new Set([entry.ownerUserId, entry.primarySid, ...Array.from(entry.sids || [])].filter(Boolean).map(value => String(value).replace(/^user:/, '')));
    for (const owner of owners) enqueue(owner, normalized);
  }
  async function changed(owner, fn) {
    const before = await store.get(owner);
    const result = await fn();
    const queue = queues.get(owner);
    if (queue) queue.generation++;
    cache.delete(owner); wake(before?.viewerPath); wake(result?.viewerPath);
    return result;
  }
  function subscribe(token, callback) {
    const set = watchers.get(token) || new Set();
    if (stopped || set.size >= 8 || (!watchers.has(token) && watchers.size >= 2000)) return null;
    set.add(callback); watchers.set(token, set);
    return () => { set.delete(callback); if (!set.size) watchers.delete(token); };
  }
  async function test(owner) {
    const row = await store.get(owner, { create: true });
    if (!row.settings.enabled) throw Object.assign(new Error('먼저 이모티콘 오버레이를 켜고 저장해 주세요.'), { status: 409 });
    const event = { key: `test:${randomUUID()}`, actor: 'admin-test', items: createChzzkEmoteSamples(5) };
    const result = await store.append(owner, event, { test: true, epoch: row.epoch, expiresAt: now() + 8000 });
    if (!result) throw Object.assign(new Error('현재 표시 한도에 도달했습니다. 잠시 후 다시 테스트해 주세요.'), { status: 429 });
    wake(row.viewerPath); return { sent: result.items.length };
  }
  const cleanupTimer = setInterval(() => { if (!stopped) store.cleanup().catch(warn); }, 60_000);
  cleanupTimer.unref?.();
  return {
    ingestEvent, subscribe, test,
    get: owner => store.get(owner, { create: true }),
    save: (owner, settings, revision) => changed(owner, () => store.save(owner, settings, revision)),
    clear: owner => changed(owner, () => store.clear(owner)),
    rotate: owner => changed(owner, () => store.clear(owner, true)),
    snapshot: (token, after) => store.snapshot(token, after),
    stop: async () => {
      stopped = true;
      clearInterval(cleanupTimer);
      const listeners = [...watchers.values()].flatMap(set => [...set]);
      watchers.clear();
      for (const listener of listeners) { try { listener({ closed: true }); } catch (error) { warn(error); } }
      await Promise.allSettled([...queues.values()].map(queue => queue.tail));
      cache.clear();
    },
  };
}
