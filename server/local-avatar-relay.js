import crypto from 'crypto';
import { getLiveRoleLevel } from './live-command-permissions.js';

const CHANNEL = 'arubot_local_avatars_v1';
const clean = (v, length) =>
  String(v || '')
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{M}]/gu, '')
    .slice(0, length);
export function normalizeChzzkAvatarEvent(entry, event, now = Date.now()) {
  if (!['chat', 'donation', 'subscription'].includes(event?.type)) return null;
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
  const identity =
    raw.messageId ||
    raw.eventId ||
    raw.donationId ||
    `${event.type}:${userId}:${raw.messageTime || raw.timestamp || event.ts}:${message}:${event.amount || 0}`;
  return {
    id: crypto.createHash('sha256').update(String(identity)).digest('hex'),
    kind: event.type,
    userId,
    name: clean(event.user, 32),
    text: message,
    role: role >= 4 ? 'owner' : role >= 2 ? 'moderator' : 'everyone',
    amount: Math.min(1e9, Math.max(0, Number(event.amount) || 0)),
    at: now,
  };
}

// Transient notifications only: no chat history, assets, or settings are persisted here.
export function createLocalAvatarRelay({
  createClient,
  publish,
  onError = () => {},
}) {
  const instance = crypto.randomUUID(),
    subscriptions = new Map(),
    interests = new Map();
  let client,
    stopped = false,
    ready = false,
    retry,
    pulse,
    flushing = false;
  const queue = [];
  const send = (socket, value) => {
    if (socket.readyState !== 1) return;
    if (socket.bufferedAmount > 128 * 1024) {
      socket.close(1013, 'Slow avatar consumer');
      return;
    }
    try {
      socket.send(JSON.stringify(value));
    } catch {}
  };
  const deliver = (owner, event) => {
    for (const [socket, id] of subscriptions)
      if (id === owner) send(socket, { type: 'avatars.event', event });
  };
  const status = () => {
    for (const socket of subscriptions.keys())
      send(socket, { type: 'avatars.status', ready });
  };
  const notify = async (data) => {
    if (!ready || stopped) return;
    try {
      await publish(CHANNEL, JSON.stringify({ ...data, instance }));
    } catch (error) {
      onError(error);
    }
  };
  const announce = () =>
    notify({
      kind: 'interest',
      owners: [...new Set(subscriptions.values())].slice(0, 200),
    });
  const receive = (message) => {
    try {
      const data = JSON.parse(message.payload);
      if (data.instance === instance) return;
      if (data.kind === 'discover') {
        void announce();
        return;
      }
      if (data.kind === 'interest' && Array.isArray(data.owners)) {
        if (interests.size >= 100 && !interests.has(data.instance)) return;
        interests.set(data.instance, {
          owners: new Set(
            data.owners
              .filter((v) => typeof v === 'string' && v.length <= 128)
              .slice(0, 200),
          ),
          at: Date.now(),
        });
        return;
      }
      if (data.kind === 'events' && Array.isArray(data.events))
        for (const item of data.events.slice(0, 8)) {
          if (item.event && Date.now() - item.event.at < 30000)
            deliver(item.owner, item.event);
        }
    } catch {}
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
      status();
      client = null;
      void current.end().catch(() => {});
      clearTimeout(retry);
      retry = setTimeout(connect, 5000);
      retry.unref?.();
    };
    current.on('error', failed);
    current.on('end', failed);
    current.on('notification', receive);
    try {
      await current.connect();
      if (stopped) {
        await current.end();
        return;
      }
      await current.query(`LISTEN ${CHANNEL}`);
      ready = true;
      status();
      await notify({ kind: 'discover' });
      await announce();
    } catch (error) {
      onError(error);
      failed();
    }
  }
  async function flush() {
    if (flushing || !queue.length) return;
    flushing = true;
    try {
      const events = [];
      while (queue.length && events.length < 4) {
        const next = queue[0];
        if (Date.now() - next.event.at >= 5000) {
          queue.shift();
          continue;
        }
        if (Buffer.byteLength(JSON.stringify([...events, next])) > 7000) {
          if (!events.length) queue.shift();
          break;
        }
        events.push(queue.shift());
      }
      if (events.length) await notify({ kind: 'events', events });
    } finally {
      flushing = false;
    }
  }
  const flushTimer = setInterval(() => void flush(), 50);
  flushTimer.unref?.();
  return {
    start() {
      void connect();
      pulse = setInterval(() => {
        void announce();
        for (const [id, item] of interests)
          if (Date.now() - item.at > 60000) interests.delete(id);
      }, 20000);
      pulse.unref?.();
    },
    subscribe(owner, socket, enabled) {
      if (enabled) subscriptions.set(socket, String(owner));
      else subscriptions.delete(socket);
      void announce();
      send(socket, { type: 'avatars.status', ready, subscribed: enabled });
    },
    remove(socket) {
      subscriptions.delete(socket);
      void announce();
    },
    emit(owner, event) {
      if (!event) return;
      owner = String(owner);
      deliver(owner, event);
      if (
        ready &&
        [...interests.values()].some(
          (item) => Date.now() - item.at < 60000 && item.owners.has(owner),
        )
      ) {
        if (queue.length >= 256) queue.shift();
        queue.push({ owner, event });
      }
    },
    async stop() {
      stopped = true;
      clearTimeout(retry);
      clearInterval(pulse);
      clearInterval(flushTimer);
      if (client) await client.end().catch(() => {});
      subscriptions.clear();
      interests.clear();
      queue.length = 0;
    },
  };
}
