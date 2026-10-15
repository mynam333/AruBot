import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createIngressProviders } from '../server/chat-ingress-providers.mjs';

const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function clock() {
  let time = Date.UTC(2026, 9, 15), serial = 0;
  const tasks = new Map();
  return {
    now: () => time,
    timers: {
      setTimeout(fn, ms) { const id = ++serial; tasks.set(id, { fn, at: time + ms }); return id; },
      clearTimeout(id) { tasks.delete(id); },
    },
    async advance(ms) {
      const end = time + ms;
      for (let count = 0; count < 1000; count++) {
        const next = [...tasks].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        time = next[1].at;
        tasks.delete(next[0]);
        void next[1].fn();
        await flush();
      }
      time = end;
      await flush();
    },
    tasks,
  };
}

function harness(t, overrides = {}) {
  const time = clock();
  let uuid = 0;
  const h = { time, events: [], requests: [], sockets: [], receivers: [], updates: [], claims: [], releases: [],
    tokens: new Map(), legacy: new Map(), leases: new Map(), channels: new Map(), fatal: [], logs: [],
    bot: { id: 'default', accessToken: 'bot-access', refreshToken: 'bot-refresh', selectedChannelId: 'bot-channel', status: 'active' } };
  h.bot.expiresAt = new Date(time.now() + 3_600_000).toISOString();
  h.add = (provider, owner = 'owner', fields = {}) => {
    const token = { platformUserId: `${provider}-channel`, accessToken: `${provider}-access`, refreshToken: `${provider}-refresh`,
      tokenType: 'Bearer', scope: 'chat donation subscription', identityUpdatedAt: '2026-10-01',
      expiresAt: new Date(time.now() + 3_600_000).toISOString(), ...fields };
    h.tokens.set(`${provider}:${owner}`, token);
    if (provider === 'youtube') h.channels.set(owner, { youtubeChannelId: 'youtube-channel', moderatorRegistered: true });
    return token;
  };
  h.db = {
    async getTokens(sid) { return h.legacy.get(sid) || null; },
    async getPlatformTokens(provider, owner) { return h.tokens.get(`${provider}:${owner}`) || null; },
    async updateTokens(sid, tokens, { expectedTokens }) {
      h.updates.push({ sid, tokens, expectedTokens });
      if (h.legacy.get(sid) !== expectedTokens) throw new Error('authorization changed');
      h.legacy.set(sid, tokens);
    },
    async upsertPlatformTokens(provider, owner, platformUserId, tokens, { expectedTokens }) {
      h.updates.push({ provider, owner, platformUserId, tokens, expectedTokens });
      if (h.tokens.get(`${provider}:${owner}`) !== expectedTokens) return false;
      h.tokens.set(`${provider}:${owner}`, tokens);
      return true;
    },
    async listPlatformAccounts(owner) {
      return [...h.tokens].filter(([key]) => key.endsWith(`:${owner}`)).map(([key, token]) => ({
        provider: key.split(':')[0], platform_user_id: token.platformUserId, channel_id: token.platformUserId,
      }));
    },
    async getYoutubeStreamerChannel(owner) { return h.channels.get(owner) || null; },
    async getYoutubeBotProfile() { return h.bot; },
    async listAllSidsWithTokens() { return [...h.legacy.keys()]; },
    async listPlatformTokenUsers(provider) {
      return [...h.tokens].filter(([key]) => key.startsWith(`${provider}:`))
        .map(([key, token]) => ({ userId: key.slice(provider.length + 1), platformUserId: token.platformUserId }));
    },
    async claimRuntimeLease(key, ownerId, ttl) {
      h.claims.push({ key, ownerId });
      const current = h.leases.get(key);
      if (current && current.ownerId !== ownerId && current.expiresAt > time.now()) return { acquired: false };
      const lease = { acquired: true, resourceKey: key, ownerId, expiresAt: time.now() + ttl };
      h.leases.set(key, lease);
      return lease;
    },
    async releaseRuntimeLease(key, ownerId) {
      h.releases.push({ key, ownerId });
      if (h.leases.get(key)?.ownerId === ownerId) h.leases.delete(key);
    },
  };
  h.http = {
    async get(url, options) {
      h.requests.push({ method: 'get', url, options });
      if (url.endsWith('/sessions/auth')) return { data: { content: { url: 'wss://provider.invalid/?sessionKey=provider-key' } } };
      if (url.endsWith('/users/me')) return { data: { content: { channelId: 'chzzk-channel' } } };
      if (url.endsWith('/videos')) return { data: { items: [{ snippet: { title: 'Live title' }, liveStreamingDetails: { activeLiveChatId: 'live-chat' } }] } };
      throw new Error(`Unexpected GET ${url}`);
    },
    async post(url, body, options) {
      h.requests.push({ method: 'post', url, body, options });
      if (url.endsWith('/token')) return { data: { content: { accessToken: 'renewed-access', expiresIn: 3600 } } };
      return { data: {} };
    },
  };
  class Socket extends EventEmitter {
    constructor(kind) { super(); this.kind = kind; this.stopped = false; this.sent = []; h.sockets.push(this); }
    disconnect() { this.stopped = true; this.emit('disconnect'); }
    terminate() { this.stopped = true; this.emit('close'); }
    send(value) { this.sent.push(value); }
  }
  const getIoClient = async () => (url, options) => {
    h.socketOptions = options;
    const socket = new Socket('chzzk');
    queueMicrotask(() => socket.emit('SYSTEM', JSON.stringify({ type: 'connected', data: { sessionKey: 'chzzk-session' } })));
    return socket;
  };
  class CimeSocket extends Socket {
    constructor() { super('cime'); queueMicrotask(() => this.emit('open')); }
  }
  const createYoutubeLiveChatReceiver = input => {
    const receiver = new EventEmitter();
    receiver.input = input;
    receiver.start = async () => { receiver.emit('start', 'live-video'); return true; };
    receiver.stop = () => { receiver.stopped = true; receiver.emit('end', 'stopped'); };
    h.receivers.push(receiver);
    return receiver;
  };
  h.options = {
    db: h.db, http: h.http, getIoClient, WebSocket: CimeSocket, createYoutubeLiveChatReceiver,
    now: time.now, timers: time.timers, random: () => 0.5, randomUUID: () => `uuid-${++uuid}`,
    instanceId: 'test-ingress', onEvent: async event => { h.events.push(event); }, onFatal: error => h.fatal.push(error),
    logger: { warn: (...args) => h.logs.push(args), error: (...args) => h.logs.push(args) },
    env: { CHZZK_CLIENT_ID: 'client', CHZZK_CLIENT_SECRET: 'secret', CIME_CLIENT_ID: 'client', CIME_CLIENT_SECRET: 'secret',
      YOUTUBE_CLIENT_ID: 'client', YOUTUBE_CLIENT_SECRET: 'secret' },
    config: { connectTimeoutMs: 1000, leaseTtlMs: 10_000, leaseRenewMs: 3000, pingMs: 500, staleMs: 2000 },
    ...overrides,
  };
  h.api = createIngressProviders(h.options);
  h.ensure = (provider, extra = {}) => h.api.ensure({ provider, ownerUserId: 'owner', ...extra });
  t.after(async () => { await h.api.shutdown().catch(() => {}); });
  return h;
}

test('construction is lazy; concurrent CHZZK ensure creates one guarded, fully subscribed connection', async t => {
  const h = harness(t);
  assert.equal(h.requests.length, 0);
  assert.equal(h.claims.length, 0);
  h.add('chzzk');
  const results = await Promise.all(Array.from({ length: 12 }, () => h.ensure('chzzk')));
  assert.equal(h.sockets.length, 1);
  assert.deepEqual(h.socketOptions, { reconnection: false, forceNew: true, timeout: 5000, transports: ['websocket'] });
  assert.equal(h.requests.filter(request => request.url.includes('/subscribe/')).length, 3);
  assert.equal(results[0].sessionKey, 'chzzk-session');
  assert.equal(results[0].connected, true);
  assert.equal(results[0].subscribed, true);
  assert.deepEqual(JSON.parse(JSON.stringify(results[0])), results[0]);
  assert.equal(JSON.stringify(results).includes('chzzk-access'), false);
  assert.equal(h.claims[0].key, 'provider-runtime:chzzk:chzzk-channel');
});

test('CHZZK preserves received payload and stable event IDs without collapsing repeat donors', async t => {
  const h = harness(t); h.add('chzzk'); await h.ensure('chzzk');
  const raw = JSON.stringify({ messageId: 'chat-1', content: '!roll', profile: { userId: 'viewer' } });
  h.sockets[0].emit('CHAT', raw);
  h.sockets[0].emit('CHAT', raw);
  h.sockets[0].emit('DONATION', { id: 'donor-1', messageTime: 100, amount: 1000 });
  h.sockets[0].emit('DONATION', { id: 'donor-1', messageTime: 101, amount: 1000 });
  h.sockets[0].emit('DONATION', { id: 'donor-1', amount: 1000 });
  h.sockets[0].emit('DONATION', { id: 'donor-1', amount: 1000 });
  await flush();
  assert.equal(h.events[0].payload, raw);
  assert.equal(h.events[0].eventKey, h.events[1].eventKey);
  assert.notEqual(h.events[2].eventKey, h.events[3].eventKey);
  assert.notEqual(h.events[4].eventKey, h.events[5].eventKey);
  assert.equal(h.events[0].sid, 'user:owner');
  assert.equal(h.events[0].receivedAt, h.time.now());
});

test('per-event ensure is a memory-only metadata read; inventory alone revalidates revocation', async t => {
  const h = harness(t); h.add('youtube');
  await h.api.start();
  let reads = 0;
  const read = h.db.getPlatformTokens;
  h.db.getPlatformTokens = async (...args) => { reads++; return read(...args); };
  const requests = h.requests.length;
  for (let i = 0; i < 100; i++) assert.equal((await h.ensure('youtube')).connected, true);
  assert.equal(reads, 0);
  assert.equal(h.requests.length, requests);
  h.channels.get('owner').moderatorRegistered = false;
  await h.time.advance(15_000);
  assert.ok(reads >= 1);
  assert.equal(h.receivers[0].stopped, true);
  assert.equal(h.api.list()[0].connected, false);
});

test('CIME emits the original UTF-8 message and subscribes all event kinds, with ping/stale reconnect', async t => {
  const h = harness(t); h.add('cime');
  const connected = await h.ensure('cime');
  assert.equal(connected.sessionKey, 'provider-key');
  assert.equal(connected.subscribed, true);
  const raw = JSON.stringify({ event: 'CHAT', data: { messageId: '1', content: 'hello' } });
  h.sockets[0].emit('message', Buffer.from(raw));
  h.sockets[0].emit('message', Buffer.from('{"type":"PONG"}'));
  await flush();
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].eventName, 'MESSAGE');
  assert.equal(h.events[0].payload, raw);
  await h.time.advance(500);
  assert.deepEqual(h.sockets[0].sent, ['{"type":"PING"}']);
  await h.time.advance(3000);
  assert.equal(h.sockets[0].stopped, true);
  assert.equal(h.sockets.length, 2);
});

test('connection retries are exponential and repeated API probes cannot bypass them', async t => {
  const h = harness(t); h.add('chzzk');
  h.http.get = async () => { throw new Error('upstream unavailable'); };
  await h.ensure('chzzk');
  assert.equal(h.claims.length, 1);
  for (let i = 0; i < 10; i++) await h.ensure('chzzk');
  assert.equal(h.claims.length, 1);
  await h.time.advance(1000);
  assert.equal(h.claims.length, 2);
  await h.time.advance(1999);
  assert.equal(h.claims.length, 2);
  await h.time.advance(1);
  assert.equal(h.claims.length, 3);
});

test('failed subscriptions do not report connected; disconnected socket events are fenced', async t => {
  const h = harness(t); h.add('chzzk');
  const post = h.http.post;
  let fail = true;
  h.http.post = async (...args) => {
    if (fail && args[0].endsWith('/subscribe/donation')) { fail = false; throw new Error('503'); }
    return post(...args);
  };
  const first = await h.ensure('chzzk');
  assert.equal(first.connected, false);
  assert.equal(first.subscribed, false);
  h.sockets[0].emit('CHAT', { messageId: 'stale' });
  await h.time.advance(1000);
  assert.equal(h.api.list()[0].connected, true);
  assert.equal(h.sockets.length, 2);
  assert.equal(h.events.length, 0);
});

test('platform refresh preserves scope and uses the original conditional token snapshot', async t => {
  const h = harness(t);
  const original = h.add('cime', 'owner', { expiresAt: new Date(h.time.now() - 1000).toISOString(), scope: 'keep-scope' });
  assert.equal((await h.ensure('cime')).connected, true);
  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0].expectedTokens, original);
  assert.equal(h.updates[0].tokens.scope, 'keep-scope');
  assert.equal(h.updates[0].tokens.refreshToken, original.refreshToken);
  assert.equal(h.requests.find(r => r.url.endsWith('/sessions/auth')).options.headers.Authorization, 'Bearer renewed-access');
});

test('legacy CHZZK token refresh does not upsert a new grant and preserves expectedTokens identity', async t => {
  const h = harness(t);
  const original = { accessToken: 'expired', refreshToken: 'refresh', expiresAt: '2020-01-01', scope: 'legacy-scope' };
  h.legacy.set('user:owner', original);
  assert.equal((await h.ensure('chzzk')).connected, true);
  assert.equal(h.updates[0].sid, 'user:owner');
  assert.equal(h.updates[0].expectedTokens, original);
  assert.equal(h.updates[0].tokens.scope, 'legacy-scope');
});

test('revocation racing with OAuth refresh cannot resurrect the grant or create a socket', async t => {
  const h = harness(t); h.add('cime', 'owner', { expiresAt: '2020-01-01' });
  const gate = deferred();
  const post = h.http.post;
  h.http.post = async (...args) => args[0].endsWith('/token') ? gate.promise : post(...args);
  const connecting = h.ensure('cime');
  await flush();
  h.tokens.delete('cime:owner');
  gate.resolve({ data: { accessToken: 'late-token', expiresIn: 3600 } });
  const state = await connecting;
  assert.equal(state.connected, false);
  assert.equal(state.lastError, 'ingress_authorization_changed');
  assert.equal(h.tokens.size, 0);
  assert.equal(h.sockets.length, 0);
});

test('inventory starts all stored accounts without a website and closes revoked accounts', async t => {
  const h = harness(t); h.add('chzzk'); h.add('cime'); h.add('youtube');
  await h.api.start();
  assert.equal(h.api.list().length, 3);
  assert.ok(h.api.list().every(entry => entry.connected));
  h.tokens.delete('chzzk:owner');
  h.tokens.delete('cime:owner');
  h.tokens.delete('youtube:owner');
  await h.time.advance(15_000);
  assert.deepEqual(h.api.list(), []);
  assert.equal(h.leases.size, 0);
});

test('inventory query failure does not mistake an unavailable database for revoked grants', async t => {
  const h = harness(t); h.add('chzzk');
  await h.api.start();
  h.db.listPlatformTokenUsers = async () => { throw new Error('DB unavailable'); };
  await h.time.advance(15_000);
  assert.equal(h.api.list().length, 1);
  assert.equal(h.sockets[0].stopped, false);
  assert.equal(h.api.health().healthy, false);
});

test('YouTube uses the existing receiver, rejects warm history, and retains its cutoff across API attaches', async t => {
  const h = harness(t); h.add('youtube');
  const state = await h.ensure('youtube');
  assert.equal(state.connected, true);
  assert.equal(state.broadcastId, 'live-video');
  assert.equal(state.liveChatId, 'live-chat');
  assert.equal(state.title, 'Live title');
  assert.equal(state.botChannelId, 'bot-channel');
  const timestamp = new Date(h.time.now() - 1000);
  const item = { id: 'fresh', timestamp, author: { channelId: 'viewer', name: 'Viewer' }, message: [{ text: '!hello' }] };
  h.receivers[0].emit('chat', { ...item, id: 'old', timestamp: new Date(h.time.now() - 20_000) });
  h.receivers[0].emit('chat', item);
  await h.time.advance(6000);
  await h.ensure('youtube');
  h.receivers[0].emit('chat', { ...item, id: 'delivered-after-api-restart' });
  await flush();
  assert.equal(h.receivers.length, 1);
  assert.equal(h.events.length, 2);
  assert.equal(h.events[0].eventName, 'CHAT_ITEM');
  assert.equal(h.events[0].payload.snippet.displayMessage, '!hello');
  assert.equal(h.events[0].payload.authorDetails.channelId, 'viewer');
});

test('YouTube metadata quota failures do not disconnect chat and saved matching metadata is reused', async t => {
  const h = harness(t); h.add('youtube');
  const get = h.http.get;
  h.http.get = async (...args) => {
    if (args[0].endsWith('/videos')) throw new Error('quota exceeded');
    return get(...args);
  };
  assert.equal((await h.ensure('youtube')).connected, true);
  await h.api.close({ provider: 'youtube', ownerUserId: 'owner' });
  Object.assign(h.channels.get('owner'), { lastDetectedVideoId: 'live-video', lastLiveChatId: 'saved-live-chat' });
  assert.equal((await h.ensure('youtube')).liveChatId, 'saved-live-chat');
});

test('inventory recovers missing YouTube reply metadata without reconnecting or per-message network requests', async t => {
  const h = harness(t); h.add('youtube');
  const get = h.http.get;
  let unavailable = true, lookups = 0;
  h.http.get = async (...args) => {
    if (args[0].endsWith('/videos')) {
      lookups++;
      if (unavailable) throw new Error('503');
    }
    return get(...args);
  };
  await h.api.start();
  assert.equal(h.api.list()[0].liveChatId, null);
  unavailable = false;
  for (let i = 0; i < 10; i++) await h.ensure('youtube');
  assert.equal(lookups, 1);
  await h.time.advance(60_000);
  assert.equal(h.api.list()[0].liveChatId, 'live-chat');
  assert.equal(lookups, 2);
  assert.equal(h.receivers.length, 1);
});

test('YouTube requires stored authorization, moderator confirmation and a configured bot profile', async t => {
  const h = harness(t); h.add('youtube');
  h.channels.get('owner').moderatorRegistered = false;
  assert.equal((await h.ensure('youtube')).lastError, 'youtube_bot_moderator_not_confirmed');
  assert.equal(h.receivers.length, 0);
  h.channels.get('owner').moderatorRegistered = true;
  h.bot = null;
  await h.time.advance(1000);
  assert.equal(h.api.list()[0].lastError, 'youtube_bot_reauthorization_required');
  assert.equal(h.receivers.length, 0);
});

test('YouTube receiver error threshold and end reconnect without creating parallel receivers', async t => {
  const h = harness(t); h.add('youtube'); await h.ensure('youtube');
  h.receivers[0].emit('error', new Error('503'));
  h.receivers[0].emit('error', new Error('503'));
  assert.equal(h.receivers[0].stopped, undefined);
  h.receivers[0].emit('error', new Error('503'));
  assert.equal(h.receivers[0].stopped, true);
  await h.time.advance(1000);
  assert.equal(h.receivers.length, 2);
  h.receivers[1].emit('end');
  await h.time.advance(1000);
  assert.equal(h.receivers.length, 3);
  assert.equal(h.api.list()[0].connected, true);
});

test('legacy API lease ownership blocks migration until release; renewal loss stops intake', async t => {
  const h = harness(t); h.add('chzzk');
  h.leases.set('provider-runtime:chzzk:chzzk-channel', { ownerId: 'legacy-api', expiresAt: h.time.now() + 10_000 });
  assert.equal((await h.ensure('chzzk')).lastError, 'provider_runtime_lease_not_acquired');
  assert.equal(h.sockets.length, 0);
  h.leases.clear();
  await h.time.advance(1000);
  assert.equal(h.sockets.length, 1);
  h.leases.set('provider-runtime:chzzk:chzzk-channel', { ownerId: 'other-ingress', expiresAt: h.time.now() + 20_000 });
  await h.time.advance(3000);
  assert.equal(h.sockets[0].stopped, true);
  assert.equal(h.api.list()[0].connected, false);
  h.sockets[0].emit('CHAT', { messageId: 'after-fencing' });
  await flush();
  assert.equal(h.events.length, 0);
});

test('a fallback non-durable lease is refused', async t => {
  const h = harness(t); h.add('cime');
  h.db.claimRuntimeLease = async () => ({ acquired: true, fallback: true });
  assert.equal((await h.ensure('cime')).lastError, 'ingress_durable_lease_required');
  assert.equal(h.sockets.length, 0);
});

test('closing during a delayed lease claim releases ownership and never opens a late socket', async t => {
  const h = harness(t); h.add('chzzk');
  const gate = deferred();
  h.db.claimRuntimeLease = () => gate.promise;
  const connecting = h.ensure('chzzk');
  await flush();
  const closing = h.api.close({ provider: 'chzzk', ownerUserId: 'owner' });
  gate.resolve({ acquired: true });
  await connecting; await closing;
  assert.equal(h.sockets.length, 0);
  assert.ok(h.releases.length >= 1);
  assert.equal(h.api.list().length, 0);
});

test('a stalled lease renewal is fenced at expiry and its late release cannot remove the replacement lease', async t => {
  const h = harness(t); h.add('chzzk'); await h.ensure('chzzk');
  const gate = deferred();
  const claim = h.db.claimRuntimeLease;
  let renewals = 0;
  h.db.claimRuntimeLease = async (...args) => {
    if (++renewals === 1) { await gate.promise; }
    return claim(...args);
  };
  await h.time.advance(3000);
  assert.equal(renewals, 1);
  await h.time.advance(8000);
  assert.equal(h.sockets[0].stopped, true);
  assert.equal(h.sockets.length, 1);
  gate.resolve();
  await flush();
  assert.equal(h.sockets.length, 2);
  assert.equal(h.api.list()[0].connected, true);
  assert.equal(h.leases.get('provider-runtime:chzzk:chzzk-channel')?.ownerId, 'test-ingress');
});

test('revocation closes a pending provider auth request before a late session response creates a socket', async t => {
  const h = harness(t); h.add('cime');
  const gate = deferred();
  h.http.get = () => gate.promise;
  const connecting = h.ensure('cime');
  await flush();
  const closing = h.api.close({ provider: 'cime', ownerUserId: 'owner' });
  h.tokens.delete('cime:owner');
  gate.resolve({ data: { url: 'wss://provider.invalid/?sessionKey=late' } });
  await connecting; await closing;
  assert.equal(h.sockets.length, 0);
  assert.equal(h.leases.size, 0);
});

test('raw donations are persisted sequentially and timestamps are not replaced at worker attach', async t => {
  const gate = deferred();
  const seen = [], committed = [];
  const h = harness(t, { onEvent: async event => {
    seen.push(event);
    if (seen.length === 1) await gate.promise;
    committed.push(event);
  } });
  h.add('chzzk'); await h.ensure('chzzk');
  const first = { donationId: 'one', donatorId: 'viewer', messageTime: 123, amount: 1000 };
  h.sockets[0].emit('DONATION', first);
  h.sockets[0].emit('DONATION', { ...first, donationId: 'two', messageTime: 124 });
  await flush();
  await h.ensure('chzzk');
  assert.equal(seen.length, 1);
  assert.equal(committed.length, 0);
  gate.resolve(); await flush();
  assert.equal(committed.length, 2);
  assert.deepEqual(committed[0].payload, first);
  assert.deepEqual(committed.map(event => event.payload.messageTime), [123, 124]);
});

test('YouTube owner token refresh is conditional and preserves scope when Google omits it', async t => {
  const h = harness(t);
  const original = h.add('youtube', 'owner', { expiresAt: '2020-01-01', scope: 'youtube.readonly' });
  const post = h.http.post;
  h.http.post = async (...args) => args[0].endsWith('/token')
    ? { data: { access_token: 'google-renewed', expires_in: 3600 } } : post(...args);
  assert.equal((await h.ensure('youtube')).connected, true);
  assert.equal(h.updates[0].expectedTokens, original);
  assert.equal(h.updates[0].tokens.scope, 'youtube.readonly');
  assert.equal(h.updates[0].tokens.refreshToken, original.refreshToken);
  assert.equal(h.bot.accessToken, 'bot-access');
});

test('same channel under two owners cannot create duplicate sockets inside one ingress', async t => {
  const h = harness(t); h.add('chzzk'); h.add('chzzk', 'second');
  const states = await Promise.all([h.ensure('chzzk'), h.ensure('chzzk', { ownerUserId: 'second' })]);
  assert.equal(states.filter(state => state.connected).length, 1);
  assert.equal(h.sockets.length, 1);
});

test('a channel remains locally fenced until a delayed release completes across owner aliases', async t => {
  const h = harness(t); h.add('chzzk'); h.add('chzzk', 'second');
  await h.ensure('chzzk');
  const gate = deferred();
  const release = h.db.releaseRuntimeLease;
  h.db.releaseRuntimeLease = async (...args) => { await gate.promise; return release(...args); };
  const closing = h.api.close({ provider: 'chzzk', ownerUserId: 'owner' });
  await flush();
  assert.equal((await h.ensure('chzzk', { ownerUserId: 'second' })).connected, false);
  assert.equal(h.sockets.length, 1);
  gate.resolve(); await closing;
  await h.time.advance(1000);
  assert.equal(h.sockets.length, 2);
  assert.equal(h.api.list()[0].connected, true);
  assert.equal(h.leases.size, 1);
});

test('persistence is ordered, backlogged events survive API reattachment, and shutdown waits for durability', async t => {
  const gate = deferred();
  const saved = [];
  const h = harness(t, { onEvent: async event => { if (!saved.length) await gate.promise; saved.push(event); } });
  h.add('chzzk'); await h.ensure('chzzk');
  h.sockets[0].emit('CHAT', { messageId: 'first' });
  h.sockets[0].emit('CHAT', { messageId: 'second' });
  await h.ensure('chzzk');
  assert.equal(h.api.health().pendingEvents, 2);
  let done = false;
  const closing = h.api.shutdown().then(() => { done = true; });
  await flush();
  assert.equal(done, false);
  gate.resolve();
  await closing;
  assert.deepEqual(saved.map(event => event.payload.messageId), ['first', 'second']);
});

test('journal failure trips a visible global circuit, stops receivers and rejects clean shutdown', async t => {
  const h = harness(t, { onEvent: async () => { throw new Error('disk full'); } });
  h.add('chzzk'); h.add('youtube');
  await h.ensure('chzzk'); await h.ensure('youtube');
  h.sockets[0].emit('CHAT', { messageId: 'must-not-disappear' });
  await flush();
  assert.equal(h.api.health().healthy, false);
  assert.equal(h.api.health().lastError, 'ingress_persistence_failed');
  assert.equal(h.api.health().failedEvents, 1);
  assert.equal(h.fatal.length, 1);
  assert.equal(h.sockets[0].stopped, true);
  assert.equal(h.receivers[0].stopped, true);
  await assert.rejects(h.ensure('chzzk'), { code: 'ingress_persistence_failed' });
  await h.time.advance(60_000);
  assert.equal(h.sockets.length, 1);
  await assert.rejects(h.api.shutdown(), { code: 'ingress_persistence_failed' });
});
