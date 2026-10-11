import crypto from 'crypto';
import { getLiveRoleLevel } from './live-command-permissions.js';
import { hasZalgoText, sanitizeZalgoText } from '../shared/text-safety.js';

const CHANNEL = 'arubot_local_avatars_v1';
const MAX_OWNERS = 200;
const MAX_NOTIFY_BYTES = 7999;
const MAX_INPUT_CHARS = 8192;
const EVENT_TTL = 5000;
const PRIORITIES = ['control', 'paid', 'command', 'chat'];
// Reserved slots per owner, independently for local and remote delivery.
const CAPACITIES = [8, 16, 16, 24];
// Weighted service 8:4:2:1, with an owner rotation after every selected event.
const SERVICE_ORDER = [0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0];
const scalar = (value) =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
const clean = (value, length) =>
  sanitizeZalgoText(scalar(value).slice(0, MAX_INPUT_CHARS))
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .slice(0, length);
export function normalizeChzzkAvatarEvent(entry, event, now = Date.now()) {
  if (!['chat', 'donation', 'subscription'].includes(event?.type)) return null;
  const input = scalar(event.message);
  // Never turn malicious combining marks into a valid command by sanitizing input.
  if (input.length > MAX_INPUT_CHARS || hasZalgoText(input)) return null;
  const raw = event.raw || {};
  const userId = clean(
    raw.senderChannelId ||
      raw.donatorChannelId ||
      raw.subscriberChannelId ||
      raw.profile?.userId,
    128,
  );
  if (!userId) return null;
  const role = getLiveRoleLevel(raw.userRoleCode ?? raw.profile?.userRoleCode, {
    isOwner: userId === entry.channelId,
  });
  const message = clean(event.message, 300);
  const sourceTime = scalar(raw.messageTime || raw.timestamp || event.ts).slice(0, 128);
  const identity =
    raw.messageId ||
    raw.eventId ||
    raw.donationId ||
    `${event.type}:${userId}:${sourceTime || 'undefined'}:${message}:${event.amount || 0}`;
  return {
    id: crypto
      .createHash('sha256')
      .update(scalar(identity).slice(0, MAX_INPUT_CHARS))
      .digest('hex'),
    kind: event.type,
    userId,
    name: clean(event.user, 32),
    text: message,
    role: role >= 4 ? 'owner' : role >= 2 ? 'moderator' : 'everyone',
    amount: Math.min(1e9, Math.max(0, Number(event.amount) || 0)),
    at: now,
  };
}

function ownerKey(owner) {
  const value = scalar(owner);
  return value && value.length <= 128 && !/[\p{Cc}\p{Cf}]/u.test(value)
    ? value
    : null;
}

// Snapshot only the bounded wire fields. Legacy callers may supply just id/at.
function snapshotEvent(event) {
  if (!event || typeof event !== 'object' || !Number.isFinite(event.at))
    return null;
  const result = { at: event.at };
  for (const [key, limit] of Object.entries({
    id: 160, kind: 16, userId: 128, name: 32, text: 300, role: 16,
  })) {
    if (event[key] === undefined) continue;
    if (typeof event[key] !== 'string' || event[key].length > limit) return null;
    result[key] = event[key];
  }
  if (!result.id || (result.kind && !['chat', 'donation', 'subscription'].includes(result.kind)))
    return null;
  if (event.amount !== undefined) {
    if (!Number.isFinite(event.amount)) return null;
    result.amount = event.amount;
  }
  return result;
}

function createEventQueue(drop, observeAge) {
  const owners = new Map();
  const expired = (item, now) =>
    now - item.event.at >= EVENT_TTL || now - item.queuedAt >= EVENT_TTL;
  return {
    push(item) {
      let state = owners.get(item.owner);
      if (!state) {
        if (owners.size >= MAX_OWNERS) {
          drop('ownerLimit', item);
          return false;
        }
        state = { lanes: CAPACITIES.map(() => []), cursor: 0 };
        owners.set(item.owner, state);
      }
      const lane = state.lanes[item.priority];
      if (item.priority === 3 && item.event.kind === 'chat' && item.event.userId) {
        const index = lane.findIndex((old) => old.event.userId === item.event.userId);
        if (index !== -1) {
          // Refresh the content, not the original queue deadline or FIFO position.
          item.queuedAt = lane[index].queuedAt;
          lane[index] = item;
          return 'coalesced';
        }
      }
      if (lane.length >= CAPACITIES[item.priority]) {
        drop('overflow', item);
        return false;
      }
      lane.push(item);
      return true;
    },
    prune(now) {
      for (const [owner, state] of owners) {
        for (let priority = 0; priority < state.lanes.length; priority++) {
          state.lanes[priority] = state.lanes[priority].filter((item) => {
            observeAge(item, now);
            if (!expired(item, now)) return true;
            drop('expired', item);
            return false;
          });
        }
        if (state.lanes.every((lane) => !lane.length)) owners.delete(owner);
      }
    },
    take(maxBytes = Infinity) {
      const first = owners.entries().next().value;
      if (!first) return null;
      const [owner, state] = first;
      for (let offset = 0; offset < SERVICE_ORDER.length; offset++) {
        const cursor = (state.cursor + offset) % SERVICE_ORDER.length;
        const lane = state.lanes[SERVICE_ORDER[cursor]];
        if (!lane.length) continue;
        if (lane[0].bytes > maxBytes) return null;
        const item = lane.shift();
        state.cursor = (cursor + 1) % SERVICE_ORDER.length;
        owners.delete(owner);
        if (state.lanes.some((other) => other.length)) owners.set(owner, state);
        return item;
      }
      return null;
    },
    snapshot(now) {
      let depth = 0, oldestAgeMs = 0;
      for (const state of owners.values()) {
        for (const lane of state.lanes) {
          for (const item of lane) {
            depth++;
            oldestAgeMs = Math.max(oldestAgeMs, now - item.queuedAt, now - item.event.at);
          }
        }
      }
      return { owners: owners.size, depth, oldestAgeMs: Math.max(0, oldestAgeMs) };
    },
    clear(reason) {
      if (reason) {
        for (const state of owners.values())
          for (const lane of state.lanes)
            for (const item of lane) drop(reason, item);
      }
      owners.clear();
    },
  };
}

// Transient notifications only: no chat history, assets, or settings are persisted here.
export function createLocalAvatarRelay({
  createClient,
  publish,
  onError = () => {},
  now = () => Date.now(),
}) {
  const instance = crypto.randomUUID(),
    subscriptions = new Map(),
    interests = new Map(),
    commands = new Map();
  let client,
    started = false,
    stopped = false,
    ready = false,
    retry,
    pulse,
    flushing = false,
    announcing = false,
    announcePending = false,
    eventPublishAt = null,
    controlPublishAt = null,
    publishHealthy = false,
    lastStatusAt = 0;
  // Drops/coalesces count delivery copies, not unique platform events. Successful
  // publish means NOTIFY accepted the packet, not that a remote consumer acted.
  const counters = {
    dropped: 0, coalesced: 0, localDelivered: 0, published: 0,
    publishFailures: 0, socketFailures: 0, maxQueueAgeMs: 0, lastPublishAt: null,
    drops: Object.fromEntries([
      'invalid', 'expired', 'overflow', 'ownerLimit', 'oversize',
      'unavailable', 'publishFailed', 'stopped',
    ].map((key) => [key, 0])),
    droppedByPriority: Object.fromEntries(PRIORITIES.map((key) => [key, 0])),
  };
  const drop = (reason, item, count = 1) => {
    counters.dropped += count;
    counters.drops[reason] += count;
    if (item) counters.droppedByPriority[PRIORITIES[item.priority]] += count;
  };
  const observeAge = (item, time) => {
    counters.maxQueueAgeMs = Math.max(
      counters.maxQueueAgeMs, time - item.queuedAt, time - item.event.at,
    );
  };
  const localQueue = createEventQueue(drop, observeAge);
  const remoteQueue = createEventQueue(drop, observeAge);
  const publishAge = () => Math.max(0,
    eventPublishAt === null ? 0 : now() - eventPublishAt,
    controlPublishAt === null ? 0 : now() - controlPublishAt,
  );
  const deliveryReady = () => ready && publishHealthy && !stopped && publishAge() < EVENT_TTL;
  const getMetrics = () => ({
    ...counters,
    drops: { ...counters.drops },
    droppedByPriority: { ...counters.droppedByPriority },
    ready, deliveryReady: deliveryReady(), localReady: !stopped,
    publishInFlightAgeMs: publishAge(),
    localQueue: localQueue.snapshot(now()), remoteQueue: remoteQueue.snapshot(now()),
    subscriptions: subscriptions.size, interestInstances: interests.size, commandOwners: commands.size,
  });
  const forgetSocket = (socket) => {
    const owner = subscriptions.get(socket);
    subscriptions.delete(socket);
    if (owner && ![...subscriptions.values()].includes(owner)) commands.delete(owner);
  };
  const send = (socket, value) => {
    try {
      if (socket.readyState !== 1) return false;
      if (socket.bufferedAmount > 128 * 1024) {
        counters.socketFailures++;
        forgetSocket(socket);
        socket.close(1013, 'Slow avatar consumer');
        return false;
      }
      socket.send(JSON.stringify(value));
      return true;
    } catch {
      counters.socketFailures++;
      return false;
    }
  };
  const deliver = (owner, event) => {
    for (const [socket, id] of subscriptions)
      if (id === owner && send(socket, { type: 'avatars.event', event }))
        counters.localDelivered++;
  };
  const statusValue = (owner, diagnostics = getMetrics()) => ({
    type: 'avatars.status', ready,
    deliveryReady: deliveryReady(),
    commandsKnown: ready && !stopped && commands.has(owner),
    commandAliases: ready && !stopped ? [...(commands.get(owner) || [])] : [],
    diagnostics,
  });
  const status = (owner) => {
    const diagnostics = getMetrics();
    for (const [socket, id] of subscriptions)
      if (owner === undefined || owner === id) send(socket, statusValue(id, diagnostics));
  };
  const notify = async (data) => {
    if (!ready || stopped) return false;
    const current = client;
    const payload = JSON.stringify({ ...data, instance });
    if (Buffer.byteLength(payload) > MAX_NOTIFY_BYTES) return false;
    try {
      await publish(CHANNEL, payload);
      if (stopped || client !== current || !ready) return false;
      counters.lastPublishAt = now();
      const changed = !publishHealthy;
      publishHealthy = true;
      if (changed) status();
      return true;
    } catch (error) {
      counters.publishFailures++;
      if (client === current) {
        publishHealthy = false;
        status();
      }
      onError(error);
      return false;
    }
  };
  // At most one control publish and one event publish may be in flight.
  const announce = async (discover = false) => {
    if (stopped || !ready) return;
    if (announcing) {
      announcePending = true;
      return;
    }
    announcing = true;
    controlPublishAt = now();
    try {
      if (discover) await notify({ kind: 'discover' });
      do {
        announcePending = false;
        await notify({ kind: 'interest', owners: [...new Set(subscriptions.values())] });
      } while (announcePending && !stopped && ready);
    } finally {
      announcing = false;
      controlPublishAt = null;
    }
  };
  const priorityOf = (owner, event) => {
    if (event.kind === 'donation' || event.kind === 'subscription') return 1;
    const token = (event.text || '').trim().split(/\s+/, 1)[0].toLowerCase();
    if (['!leave', '!\uD1F4\uC7A5'].includes(token)) return 0;
    if (token.startsWith('!') || commands.get(owner)?.includes(token)) return 2;
    return 3;
  };
  const prepare = (owner, event) => {
    owner = ownerKey(owner);
    event = snapshotEvent(event);
    if (!owner || !event) {
      drop('invalid');
      return null;
    }
    const item = { owner, event, priority: priorityOf(owner, event), queuedAt: now() };
    if (now() - event.at >= EVENT_TTL) {
      drop('expired', item);
      return null;
    }
    if (event.at > now() + EVENT_TTL) {
      drop('invalid', item);
      return null;
    }
    item.bytes = Buffer.byteLength(JSON.stringify({ owner, event }));
    if (item.bytes > 7000) {
      drop('oversize', item);
      return null;
    }
    return item;
  };
  const enqueue = (queue, item) => {
    if (queue.push({ ...item }) === 'coalesced') counters.coalesced++;
  };
  const receive = (message) => {
    if (stopped || (message?.channel && message.channel !== CHANNEL)) return;
    if (!message) {
      drop('invalid');
      return;
    }
    if (typeof message.payload !== 'string' || message.payload.length > MAX_NOTIFY_BYTES || Buffer.byteLength(message.payload) > MAX_NOTIFY_BYTES) {
      drop('oversize');
      return;
    }
    try {
      const data = JSON.parse(message.payload);
      if (!data || typeof data.instance !== 'string' || !data.instance || data.instance.length > 128) {
        drop('invalid');
        return;
      }
      if (data.instance === instance) return;
      if (data.kind === 'discover') {
        void announce();
        return;
      }
      if (data.kind === 'interest' && Array.isArray(data.owners)) {
        if (interests.size >= 100 && !interests.has(data.instance)) return;
        interests.set(data.instance, {
          owners: new Set(
            data.owners.slice(0, MAX_OWNERS).filter((v) => typeof v === 'string' && ownerKey(v)),
          ),
          at: now(),
        });
        return;
      }
      if (data.kind === 'events' && Array.isArray(data.events)) {
        if (data.events.length > 8) drop('overflow', null, data.events.length - 8);
        for (const item of data.events.slice(0, 8)) {
          const prepared = prepare(item?.owner, item?.event);
          if (prepared && [...subscriptions.values()].includes(prepared.owner))
            enqueue(localQueue, prepared);
        }
      }
    } catch {
      drop('invalid');
    }
  };
  async function connect() {
    if (stopped) return;
    let current;
    try {
      current = createClient();
    } catch (error) {
      onError(error);
      retry = setTimeout(connect, 5000);
      retry.unref?.();
      return;
    }
    client = current;
    const failed = () => {
      if (client !== current || stopped) return;
      ready = false;
      publishHealthy = false;
      remoteQueue.clear('unavailable');
      status();
      client = null;
      void current.end().catch(() => {});
      clearTimeout(retry);
      retry = setTimeout(connect, 5000);
      retry.unref?.();
    };
    current.on('error', failed);
    current.on('end', failed);
    current.on('notification', (message) => {
      if (client === current && ready) receive(message);
    });
    try {
      await current.connect();
      if (stopped || client !== current) {
        await current.end();
        return;
      }
      await current.query(`LISTEN ${CHANNEL}`);
      if (stopped || client !== current) return;
      ready = true;
      status();
      await announce(true);
    } catch (error) {
      onError(error);
      failed();
    }
  }
  async function flush() {
    if (flushing || !ready || stopped) return;
    flushing = true;
    try {
      const events = [];
      let bytes = Buffer.byteLength(JSON.stringify({ kind: 'events', events: [], instance }));
      const batch = [];
      while (events.length < 4) {
        const next = remoteQueue.take(MAX_NOTIFY_BYTES - bytes - (events.length ? 1 : 0));
        if (!next) break;
        bytes += next.bytes + (events.length ? 1 : 0);
        observeAge(next, now());
        batch.push(next);
        events.push({ owner: next.owner, event: next.event });
      }
      if (events.length) {
        eventPublishAt = now();
        if (await notify({ kind: 'events', events }))
          counters.published += events.length;
        else
          for (const item of batch) drop('publishFailed', item);
      }
    } finally {
      flushing = false;
      eventPublishAt = null;
    }
  }
  const flushTimer = setInterval(() => {
    localQueue.prune(now());
    remoteQueue.prune(now());
    for (let i = 0; i < 32; i++) {
      const item = localQueue.take();
      if (!item) break;
      observeAge(item, now());
      deliver(item.owner, item.event);
    }
    void flush();
    if (now() - lastStatusAt >= 1000) {
      lastStatusAt = now();
      status();
    }
  }, 50);
  flushTimer.unref?.();
  return {
    start() {
      if (started || stopped) return;
      started = true;
      void connect();
      pulse = setInterval(() => {
        void announce();
        for (const [id, item] of interests)
          if (now() - item.at >= 60000) interests.delete(id);
      }, 20000);
      pulse.unref?.();
    },
    subscribe(owner, socket, enabled) {
      owner = ownerKey(owner);
      let accepted = !stopped && !!owner && enabled === true;
      if (accepted) {
        const others = [...subscriptions].filter(([other]) => other !== socket).map(([, id]) => id);
        const owners = [...new Set([...others, owner])];
        if (
          owners.length > MAX_OWNERS ||
          others.filter((id) => id === owner).length >= 4 ||
          Buffer.byteLength(JSON.stringify({ kind: 'interest', owners, instance })) > MAX_NOTIFY_BYTES
        ) {
          accepted = false;
          drop('ownerLimit');
        }
      }
      if (accepted) {
        if (subscriptions.get(socket) !== owner) forgetSocket(socket);
        subscriptions.set(socket, owner);
      } else forgetSocket(socket);
      void announce();
      send(socket, { ...statusValue(owner), subscribed: accepted });
      return accepted;
    },
    // Owner-scoped, process-local advisory metadata, never commands to execute.
    // string[] replaces the snapshot; [] means known empty; null clears knowledge.
    // Invalid/over-budget input returns false without changing the previous snapshot.
    // Up to 200 owners, 128 aliases/owner, 64 UTF-16 units/alias and 4096 JSON
    // UTF-8 bytes/owner. Parent refreshes on command changes and clears on teardown
    // or failed lookup. Metadata is not propagated to other relay instances.
    // Removing the final local subscriber also discards that owner's snapshot.
    setCommands(owner, aliases) {
      owner = ownerKey(owner);
      if (stopped || !owner) return false;
      if (aliases === null) {
        commands.delete(owner);
        status(owner);
        return true;
      }
      if (!Array.isArray(aliases) || aliases.length > 128 || (!commands.has(owner) && commands.size >= MAX_OWNERS))
        return false;
      const normalized = [];
      for (const alias of aliases) {
        if (typeof alias !== 'string' || !alias || alias.length > 64 || /[\s\p{Cc}\p{Cf}]/u.test(alias) || hasZalgoText(alias))
          return false;
        const value = alias.normalize('NFC').toLowerCase();
        if (value.length > 64) return false;
        normalized.push(value);
      }
      const unique = [...new Set(normalized)];
      if (Buffer.byteLength(JSON.stringify(unique)) > 4096) return false;
      commands.set(owner, unique);
      status(owner);
      return true;
    },
    getMetrics,
    remove(socket) {
      forgetSocket(socket);
      void announce();
    },
    emit(owner, event) {
      if (!event) return;
      if (stopped) {
        drop('stopped');
        return;
      }
      const item = prepare(owner, event);
      if (!item) return;
      owner = item.owner;
      for (const [socket, id] of subscriptions)
        if (id === owner && socket.bufferedAmount > 128 * 1024)
          send(socket, { type: 'avatars.status', ready });
      if ([...subscriptions.values()].includes(owner)) enqueue(localQueue, item);
      if (
        [...interests.values()].some(
          (interest) => now() - interest.at < 60000 && interest.owners.has(owner),
        )
      ) {
        if (ready) enqueue(remoteQueue, item);
        else drop('unavailable', item);
      }
    },
    async stop() {
      stopped = true;
      ready = false;
      publishHealthy = false;
      clearTimeout(retry);
      clearInterval(pulse);
      clearInterval(flushTimer);
      if (client) await client.end().catch(() => {});
      subscriptions.clear();
      interests.clear();
      commands.clear();
      localQueue.clear('stopped');
      remoteQueue.clear('stopped');
    },
  };
}
