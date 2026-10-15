import { createHash, randomUUID } from 'node:crypto';
import axios from 'axios';
import WebSocket from 'ws';
import youtubeReceiver from './youtube-live-chat-receiver.cjs';
import { installChzzkSocketIo2ParserGuard } from './chzzk-socket-io2-guard.js';

const PROVIDERS = new Set(['chzzk', 'cime', 'youtube']);
const ownerId = value => String(value || '').replace(/^user:/, '').trim();
const unwrap = response => response?.data?.content ?? response?.data ?? {};
const failure = (code, message = code) => Object.assign(new Error(message), { code });
const errorText = error => String(error?.code || error?.message || 'ingress_connection_failed').slice(0, 320);
const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; } };

async function getIoClient() {
  // Socket.IO 2 must use its Node ws transport, not Node 22's global WebSocket.
  if (globalThis.WebSocket) delete globalThis.WebSocket;
  installChzzkSocketIo2ParserGuard(await import('socket.io-parser'));
  const module = await import('socket.io-client');
  return module.default || module;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function eventKey(provider, channelId, eventName, payload, uuid) {
  const packet = parse(payload) || {};
  const kind = String(packet.event || packet.type || eventName).toUpperCase();
  const data = provider === 'cime' ? (packet.data || packet.content || packet) : packet;
  const original = provider === 'youtube' ? packet.receiverRaw || packet : data;
  // A donation's generic `id` can identify the donor, not the transaction.
  const id = original.messageId || original.messageID || original.msgId || original.eventId
    || original.donationId || original.transactionId || original.subscriptionId
    || ((kind === 'CHAT' || provider === 'youtube') ? original.id : null);
  const timestamp = original.messageTime || original.msgTime || original.timestamp
    || original.createdAt || original.publishedAt || original.time || packet.timestamp;
  const identity = id ? ['id', String(id)]
    : timestamp ? ['event', String(timestamp), canonical(original)]
      // No provider ID/time means identical legitimate donations cannot be distinguished.
      : ['receipt', uuid()];
  return createHash('sha256').update(JSON.stringify([provider, channelId, kind, identity])).digest('hex');
}

/** Independent, persistent-provider connections. Importing this module never starts DB/network work. */
export function createIngressProviders(options = {}) {
  if (typeof options.onEvent !== 'function') throw new TypeError('onEvent must persist each received event');
  const { onEvent, logger = console, onFatal = () => {} } = options;
  const http = options.http || axios;
  const Ws = options.WebSocket || WebSocket;
  const ioClient = options.getIoClient || getIoClient;
  const createReceiver = options.createYoutubeLiveChatReceiver || youtubeReceiver.createYoutubeLiveChatReceiver;
  const toYoutubeItem = options.toYoutubeLiveChatItem || youtubeReceiver.toYoutubeLiveChatItem;
  const now = options.now || Date.now;
  const uuid = options.randomUUID || randomUUID;
  const random = options.random || Math.random;
  const timers = options.timers || { setTimeout, clearTimeout };
  const env = options.env || process.env;
  const config = {
    inventoryMs: 15_000, retryBaseMs: 1_000, retryMaxMs: 60_000,
    leaseTtlMs: 45_000, leaseRenewMs: 15_000, connectTimeoutMs: 25_000,
    httpTimeoutMs: 10_000, pingMs: 60_000, staleMs: 180_000,
    maxPendingEvents: 10_000, historyGraceMs: 2_000,
    ...options.config,
  };
  if (config.leaseRenewMs >= config.leaseTtlMs || config.leaseRenewMs <= 0) {
    throw new TypeError('leaseRenewMs must be positive and less than leaseTtlMs');
  }
  const instanceId = options.instanceId || `chat-ingress:${process.pid}:${uuid()}`;
  const entries = new Map();
  const resourceOwners = new Map();
  let database;
  let closed = false;
  let started = false;
  let inventoryTimer = null;
  let inventoryPromise = null;
  let inventoryError = null;
  let circuitError = null;
  let pendingEvents = 0;
  const failedEvents = [];
  const db = () => (database ||= Promise.resolve(options.db || import('./supabase.js')));
  const later = (fn, delay) => {
    const timer = timers.setTimeout(fn, Math.max(0, delay));
    timer?.unref?.();
    return timer;
  };
  const active = entry => !closed && !circuitError && !entry.closed && entries.get(entry.key) === entry;
  const current = (entry, generation) => active(entry) && generation === entry.generation;
  const assertCurrent = (entry, generation) => {
    if (!current(entry, generation)) throw failure('ingress_connection_cancelled');
  };
  function metadata(entry) {
    return {
      provider: entry.provider, ownerUserId: entry.ownerUserId, sid: entry.sid,
      channelId: entry.channelId || null, connected: entry.connected,
      sessionKey: entry.sessionKey || null, broadcastId: entry.broadcastId || null,
      liveChatId: entry.liveChatId || null, title: entry.title || '',
      botChannelId: entry.botChannelId || null, subscribed: entry.subscribed,
      lastError: entry.lastError || null,
    };
  }
  function cancelTimer(entry, name) {
    if (entry[name] != null) timers.clearTimeout(entry[name]);
    entry[name] = null;
  }
  function stopTransport(entry) {
    entry.generation += 1;
    entry.connected = false;
    entry.subscribed = false;
    entry.sessionKey = null;
    for (const timer of ['pingTimer', 'leaseTimer', 'leaseExpiryTimer']) cancelTimer(entry, timer);
    entry.cancelConnect?.();
    entry.cancelConnect = null;
    const transport = entry.transport;
    entry.transport = null;
    if (!transport) return;
    try {
      if (entry.provider === 'youtube') transport.stop('ingress_disconnected');
      else if (entry.provider === 'chzzk') transport.disconnect();
      else transport.terminate();
    } catch { /* The generation guard also fences late transport events. */ }
  }
  async function release(entry) {
    const key = entry.leaseKey;
    entry.leaseKey = null;
    await entry.leaseInFlight?.catch(() => {});
    if (!key) return;
    try { await (await db()).releaseRuntimeLease(key, instanceId); }
    catch (error) { logger.warn?.('[chat-ingress] lease release failed', errorText(error)); }
    finally { if (resourceOwners.get(key) === entry) resourceOwners.delete(key); }
  }
  function trip(error, event = null) {
    if (event) failedEvents.push(event);
    if (circuitError) return;
    circuitError = failure('ingress_persistence_failed', errorText(error));
    for (const entry of entries.values()) {
      entry.lastError = circuitError.code;
      cancelTimer(entry, 'retryTimer');
      stopTransport(entry);
      void release(entry);
    }
    logger.error?.('[chat-ingress] persistence circuit open; receivers stopped', errorText(error));
    try { Promise.resolve(onFatal(circuitError)).catch(() => {}); } catch { }
  }
  function receive(entry, generation, eventName, raw) {
    if (!current(entry, generation)) return;
    let event;
    try {
      const payload = typeof raw === 'string' ? raw : JSON.parse(JSON.stringify(raw));
      event = {
        provider: entry.provider, ownerUserId: entry.ownerUserId, sid: entry.sid,
        channelId: entry.channelId, eventName, payload,
        eventKey: eventKey(entry.provider, entry.channelId, eventName, payload, uuid),
        receivedAt: now(),
      };
    } catch (error) { trip(error); return; }
    pendingEvents += 1;
    // Serial persistence per channel preserves provider order; the journal owns deduplication.
    entry.persistence = entry.persistence.then(async () => {
      if (circuitError) { failedEvents.push(event); return; }
      try { await onEvent(event); }
      catch (error) { trip(error, event); }
    }).finally(() => { pendingEvents -= 1; });
    if (pendingEvents > config.maxPendingEvents) trip(failure('ingress_persistence_backpressure'));
  }
  function retry(entry, error) {
    if (!active(entry)) return;
    entry.lastError = errorText(error);
    stopTransport(entry);
    // Do not reacquire before release finishes, or a delayed release could delete the new lease.
    entry.releasing = release(entry);
    if (entry.retryTimer != null) return;
    const base = Math.min(config.retryMaxMs, config.retryBaseMs * (2 ** Math.min(entry.attempts++, 10)));
    const delay = Math.round(base * (0.8 + random() * 0.4));
    entry.retryAt = now() + delay;
    entry.retryTimer = later(() => {
      entry.retryTimer = null;
      if (active(entry)) void ensure({ provider: entry.provider, ownerUserId: entry.ownerUserId, sid: entry.sid })
        .catch(error => logger.warn?.('[chat-ingress] retry failed', errorText(error)));
    }, delay);
  }
  function claim(entry, generation) {
    const request = (async () => {
      await entry.leaseInFlight?.catch(() => {});
      assertCurrent(entry, generation);
      await claimOwned(entry, generation);
    })();
    entry.leaseInFlight = request;
    return request.finally(() => { if (entry.leaseInFlight === request) entry.leaseInFlight = null; });
  }
  async function claimOwned(entry, generation) {
    const resource = entry.provider === 'chzzk' ? entry.channelId : entry.ownerUserId;
    const key = `provider-runtime:${entry.provider}:${resource}`;
    // Prevent duplicate channels within this process as well as between processes.
    const localOwner = resourceOwners.get(key);
    if (localOwner && localOwner !== entry) throw failure('provider_runtime_lease_not_acquired');
    resourceOwners.set(key, entry);
    entry.leaseKey = key;
    const lease = await (await db()).claimRuntimeLease(key, instanceId, config.leaseTtlMs);
    if (!current(entry, generation)) {
      if (lease?.acquired) await (await db()).releaseRuntimeLease(key, instanceId);
      throw failure('ingress_connection_cancelled');
    }
    if (!lease?.acquired || lease.fallback) {
      throw failure(lease?.fallback ? 'ingress_durable_lease_required' : 'provider_runtime_lease_not_acquired');
    }
    const expiry = Math.min(now() + config.leaseTtlMs, new Date(lease.expiresAt || now() + config.leaseTtlMs).getTime());
    cancelTimer(entry, 'leaseExpiryTimer');
    entry.leaseExpiryTimer = later(() => {
      if (current(entry, generation)) retry(entry, failure('ingress_lease_expired'));
    }, Math.max(0, expiry - now() - 250));
    cancelTimer(entry, 'leaseTimer');
    entry.leaseTimer = later(async () => {
      if (!current(entry, generation)) return;
      try { await claim(entry, generation); }
      catch (error) { if (current(entry, generation)) retry(entry, error); }
    }, config.leaseRenewMs);
  }
  async function storedTokens(entry) {
    const store = await db();
    const legacy = entry.provider === 'chzzk' ? await store.getTokens(entry.sid) : null;
    const tokens = legacy || await store.getPlatformTokens(entry.provider, entry.ownerUserId);
    if (!tokens?.accessToken) throw failure('ingress_authorization_revoked');
    return { tokens, legacy: !!legacy };
  }
  async function validTokens(entry, generation) {
    const store = await db();
    let { tokens, legacy } = await storedTokens(entry);
    assertCurrent(entry, generation);
    if (!(new Date(tokens.expiresAt).getTime() > now() + 60_000)) {
      if (!tokens.refreshToken) throw failure('ingress_reauthorization_required');
      const expectedTokens = tokens;
      const google = entry.provider === 'youtube';
      const prefix = entry.provider.toUpperCase();
      const clientId = env[`${prefix}_CLIENT_ID`] || (google ? env.GOOGLE_YOUTUBE_CLIENT_ID : '');
      const clientSecret = env[`${prefix}_CLIENT_SECRET`] || (google ? env.GOOGLE_YOUTUBE_CLIENT_SECRET : '');
      if (!clientId || !clientSecret) throw failure('ingress_oauth_credentials_missing');
      const body = google ? new URLSearchParams({ client_id: clientId, client_secret: clientSecret,
        refresh_token: tokens.refreshToken, grant_type: 'refresh_token' }).toString()
        : { grantType: 'refresh_token', refreshToken: tokens.refreshToken, clientId, clientSecret };
      const response = await http.post(google ? (env.YOUTUBE_TOKEN_URL || 'https://oauth2.googleapis.com/token')
        : `${apiBase(entry.provider)}/auth/v1/token`, body, {
        timeout: config.httpTimeoutMs,
        headers: { 'Content-Type': google ? 'application/x-www-form-urlencoded' : 'application/json' },
      });
      assertCurrent(entry, generation);
      const payload = unwrap(response);
      const accessToken = google ? payload.access_token : payload.accessToken;
      if (!accessToken) throw failure('ingress_invalid_refresh_response');
      tokens = { ...tokens, accessToken,
        refreshToken: (google ? payload.refresh_token : payload.refreshToken) || tokens.refreshToken,
        tokenType: (google ? payload.token_type : payload.tokenType) || tokens.tokenType || 'Bearer',
        scope: payload.scope || tokens.scope,
        expiresAt: new Date(now() + Math.max(1, Number((google ? payload.expires_in : payload.expiresIn) || 3600)) * 1000).toISOString(),
      };
      if (legacy) await store.updateTokens(entry.sid, tokens, { expectedTokens });
      else if (!await store.upsertPlatformTokens(entry.provider, entry.ownerUserId, expectedTokens.platformUserId, tokens, { expectedTokens })) {
        throw failure('ingress_authorization_changed');
      }
      assertCurrent(entry, generation);
    }
    return { tokens, legacy };
  }
  function apiBase(provider) {
    return provider === 'chzzk' ? (env.CHZZK_OPENAPI_BASE || 'https://openapi.chzzk.naver.com')
      : (env.CIME_OPENAPI_BASE || 'https://ci.me/api/openapi');
  }
  async function authorize(entry, generation) {
    const { tokens, legacy } = await validTokens(entry, generation);
    const store = await db();
    if (entry.provider === 'youtube') {
      const channel = await store.getYoutubeStreamerChannel(entry.ownerUserId);
      const botId = channel?.botProfileId || env.YOUTUBE_BOT_PROFILE_ID || 'default';
      const bot = await store.getYoutubeBotProfile(botId);
      assertCurrent(entry, generation);
      if (!channel?.youtubeChannelId || channel.moderatorRegistered !== true) {
        throw failure('youtube_bot_moderator_not_confirmed');
      }
      // Only the API's send path refreshes the central bot; its writer has no CAS contract.
      if (!bot?.accessToken || !bot.selectedChannelId || ['revoked', 'disconnected', 'reauth_required'].includes(bot.status)
        || (!(new Date(bot.expiresAt).getTime() > now()) && !bot.refreshToken)) {
        throw failure('youtube_bot_reauthorization_required');
      }
      entry.botChannelId = bot.selectedChannelId;
      if (!entry.connected) entry.title = channel.lastLiveTitle || '';
      entry.registeredChannel = channel;
      return { tokens, channelId: String(channel.youtubeChannelId), grant: `${tokens.platformUserId}:${tokens.identityUpdatedAt || ''}:${channel.youtubeChannelId}:${bot.selectedChannelId}` };
    }
    const accounts = await store.listPlatformAccounts(entry.ownerUserId);
    assertCurrent(entry, generation);
    const account = accounts.find(item => item.provider === entry.provider
      && (legacy || String(item.platform_user_id) === String(tokens.platformUserId)));
    let channelId = account?.channel_id || (entry.provider === 'cime' ? tokens.platformUserId : null);
    if (!channelId && entry.profileAccessToken === tokens.accessToken) channelId = entry.profileChannelId;
    if (!channelId) {
      const response = await http.get(`${apiBase(entry.provider)}/open/v1/users/me`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` }, timeout: config.httpTimeoutMs,
      });
      assertCurrent(entry, generation);
      const profile = unwrap(response);
      channelId = profile.channelId || profile.channel?.channelId;
      if (channelId) {
        entry.profileAccessToken = tokens.accessToken;
        entry.profileChannelId = String(channelId);
      }
    }
    if (!channelId) throw failure('ingress_channel_not_found');
    return { tokens, channelId: String(channelId), grant: `${legacy ? 'legacy' : tokens.platformUserId}:${tokens.identityUpdatedAt || ''}:${tokens.consentGrantedAt || ''}` };
  }
  function connectionWait(entry, generation, attach) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        timers.clearTimeout(timer);
        if (entry.cancelConnect === cancel) entry.cancelConnect = null;
        if (error) reject(error); else resolve();
      };
      const cancel = () => finish(failure('ingress_connection_cancelled'));
      const timer = later(() => finish(failure('ingress_connect_timeout')), config.connectTimeoutMs);
      entry.cancelConnect = cancel;
      try { attach(error => {
        if (!current(entry, generation)) return finish(failure('ingress_connection_cancelled'));
        if (error && settled) retry(entry, error); else finish(error);
      }); } catch (error) { finish(error); }
    });
  }
  async function subscribe(entry, generation, accessToken) {
    for (const kind of ['chat', 'donation', 'subscription']) {
      assertCurrent(entry, generation);
      await http.post(`${apiBase(entry.provider)}/open/v1/sessions/events/subscribe/${kind}`, null, {
        params: { sessionKey: entry.sessionKey }, headers: { Authorization: `Bearer ${accessToken}` },
        timeout: config.httpTimeoutMs,
      });
    }
    assertCurrent(entry, generation);
    entry.subscribed = true;
  }
  async function openSocket(entry, generation, tokens) {
    const response = await http.get(`${apiBase(entry.provider)}/open/v1/sessions/auth`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` }, timeout: config.httpTimeoutMs,
    });
    assertCurrent(entry, generation);
    const content = unwrap(response);
    if (!content.url) throw failure('ingress_session_url_missing');
    if (entry.provider === 'chzzk') {
      const io = await ioClient();
      assertCurrent(entry, generation);
      await connectionWait(entry, generation, done => {
        const socketOptions = { reconnection: false, forceNew: true, timeout: 5000, transports: ['websocket'] };
        const socket = typeof io === 'function' ? io(content.url, socketOptions) : io.connect(content.url, socketOptions);
        entry.transport = socket;
        let subscribing = false;
        socket.on('SYSTEM', raw => {
          if (!current(entry, generation)) return;
          const message = parse(raw);
          if (['revoked', 'unsubscribed'].includes(message?.type)) return done(failure('chzzk_subscription_revoked'));
          if (message?.type !== 'connected' || subscribing) return;
          entry.sessionKey = message.data?.sessionKey;
          if (!entry.sessionKey) return done(failure('ingress_session_key_missing'));
          subscribing = true;
          void subscribe(entry, generation, tokens.accessToken).then(() => done(), done);
        });
        for (const eventName of ['CHAT', 'DONATION', 'SUBSCRIPTION']) {
          socket.on(eventName, raw => receive(entry, generation, eventName, raw));
        }
        for (const eventName of ['disconnect', 'connect_error', 'connect_timeout', 'error']) {
          socket.on(eventName, () => done(failure(`chzzk_${eventName}`)));
        }
      });
    } else {
      const url = new URL(content.url);
      entry.sessionKey = url.searchParams.get('sessionKey') || url.searchParams.get('session_key') || content.sessionKey;
      if (!entry.sessionKey) throw failure('ingress_session_key_missing');
      await connectionWait(entry, generation, done => {
        const socket = new Ws(content.url, { handshakeTimeout: 5000 });
        entry.transport = socket;
        entry.lastEventAt = now();
        socket.on('open', () => {
          if (!current(entry, generation)) return;
          void subscribe(entry, generation, tokens.accessToken).then(() => done(), done);
          const ping = () => {
            if (!current(entry, generation)) return;
            if (now() - entry.lastEventAt > config.staleMs) return done(failure('cime_websocket_stale'));
            try { socket.send(JSON.stringify({ type: 'PING' })); }
            catch { done(failure('cime_ping_failed')); return; }
            entry.pingTimer = later(ping, config.pingMs);
          };
          entry.pingTimer = later(ping, config.pingMs);
        });
        socket.on('message', buffer => {
          if (!current(entry, generation)) return;
          entry.lastEventAt = now();
          const raw = buffer.toString('utf8');
          const message = parse(raw);
          if (message?.type === 'PONG' || message?.action === 'PONG') return;
          receive(entry, generation, 'MESSAGE', raw);
        });
        socket.on('pong', () => { if (current(entry, generation)) entry.lastEventAt = now(); });
        socket.on('close', () => done(failure('cime_websocket_closed')));
        socket.on('error', () => done(failure('cime_websocket_error')));
      });
    }
  }
  async function openYoutube(entry, generation, tokens) {
    // Set only for a new provider connection, never when an API worker attaches.
    entry.acceptAfterTs = now() - config.historyGraceMs;
    entry.broadcastId = null;
    entry.liveChatId = null;
    entry.metadataRetryAt = 0;
    let consecutiveErrors = 0;
    await connectionWait(entry, generation, done => {
      const receiver = createReceiver({ channelId: entry.channelId, intervalMs: Number(env.YOUTUBE_CHAT_FETCH_INTERVAL_MS || 5000) });
      entry.transport = receiver;
      let didStart = false;
      receiver.on('start', info => {
        if (!current(entry, generation)) return;
        didStart = true;
        entry.broadcastId = String(typeof info === 'object' ? info?.broadcastId || info?.liveId || '' : info || '') || null;
        entry.liveChatId = (typeof info === 'object' && info?.liveChatId) || null;
        entry.title = (typeof info === 'object' && info?.title) || entry.title;
        const saved = entry.registeredChannel;
        if (!entry.liveChatId && saved?.lastDetectedVideoId === entry.broadcastId) entry.liveChatId = saved.lastLiveChatId || null;
        entry.subscribed = true;
        consecutiveErrors = 0;
        done();
      });
      receiver.on('chat', original => {
        if (!current(entry, generation)) return;
        try {
          const item = toYoutubeItem(original);
          const timestamp = new Date(item.snippet?.publishedAt).getTime();
          if (Number.isFinite(timestamp) && timestamp < entry.acceptAfterTs) return;
          consecutiveErrors = 0;
          receive(entry, generation, 'CHAT_ITEM', item);
        } catch (error) { trip(error); }
      });
      receiver.on('error', error => {
        if (!current(entry, generation)) return;
        entry.lastError = errorText(error);
        if (!didStart || ++consecutiveErrors >= 3) done(error);
      });
      receiver.on('end', () => done(failure('youtube_receiver_ended')));
      void Promise.resolve(receiver.start()).then(ok => {
        if (!current(entry, generation)) { try { receiver.stop('ingress_cancelled'); } catch { } return; }
        if (!ok) done(failure('youtube_receiver_start_failed'));
      }, done);
    });
    await hydrateYoutubeMetadata(entry, generation, tokens);
  }
  async function hydrateYoutubeMetadata(entry, generation, tokens) {
    if (!entry.broadcastId || entry.liveChatId || entry.metadataRetryAt > now()) return;
    entry.metadataRetryAt = now() + 60_000;
    try {
      const details = options.fetchYoutubeMetadata
        ? await options.fetchYoutubeMetadata({ broadcastId: entry.broadcastId, accessToken: tokens.accessToken })
        : (await http.get(`${env.YOUTUBE_API_BASE || 'https://www.googleapis.com/youtube/v3'}/videos`, {
          params: { id: entry.broadcastId, part: 'snippet,liveStreamingDetails' },
          headers: { Authorization: `Bearer ${tokens.accessToken}` }, timeout: config.httpTimeoutMs,
        }))?.data?.items?.[0];
      assertCurrent(entry, generation);
      entry.liveChatId = details?.liveChatId || details?.liveStreamingDetails?.activeLiveChatId || entry.liveChatId;
      entry.title = details?.title || details?.snippet?.title || entry.title;
    } catch (error) {
      // Metadata quota failures must not stop the independent chat receiver.
      logger.warn?.('[chat-ingress] YouTube metadata unavailable', errorText(error));
    }
  }
  async function ensure(input, { revalidate = false } = {}) {
    const provider = String(input?.provider || '').toLowerCase();
    const ownerUserId = ownerId(input?.ownerUserId);
    const sid = String(input?.sid || `user:${ownerUserId}`);
    if (!PROVIDERS.has(provider) || !ownerUserId || ownerId(sid) !== ownerUserId) throw failure('ingress_invalid_owner');
    if (closed) throw failure('ingress_shutdown');
    if (circuitError) throw circuitError;
    const key = `${provider}:${ownerUserId}`;
    let entry = entries.get(key);
    if (!entry) {
      entry = { key, provider, ownerUserId, sid, channelId: null, connected: false, subscribed: false,
        generation: 0, attempts: 0, retryAt: 0, closed: false, persistence: Promise.resolve() };
      entries.set(key, entry);
    }
    // Worker dispatch calls this for every event. Inventory, not message traffic,
    // performs token/authorization revalidation at its fixed polling cadence.
    if (!revalidate && entry.connected && entry.subscribed && active(entry)) {
      if (input.channelId && String(input.channelId) !== entry.channelId) throw failure('ingress_channel_mismatch');
      return metadata(entry);
    }
    if (entry.connecting) return entry.connecting;
    // Inventory/API probes must not bypass the exponential connection backoff.
    if (!entry.connected && entry.retryTimer != null && entry.retryAt > now()) return metadata(entry);
    entry.connecting = (async () => {
      await entry.releasing;
      const generation = entry.generation;
      try {
        const authorized = await authorize(entry, generation);
        assertCurrent(entry, generation);
        if (input.channelId && String(input.channelId) !== authorized.channelId) throw failure('ingress_channel_mismatch');
        if (entry.connected && entry.subscribed && entry.channelId === authorized.channelId && entry.grant === authorized.grant) {
          if (provider === 'youtube') await hydrateYoutubeMetadata(entry, generation, authorized.tokens);
          return metadata(entry);
        }
        if (entry.transport) {
          stopTransport(entry);
          await release(entry);
        }
        entry.channelId = authorized.channelId;
        entry.grant = authorized.grant;
        const connectionGeneration = entry.generation;
        assertCurrent(entry, connectionGeneration);
        cancelTimer(entry, 'retryTimer');
        await claim(entry, connectionGeneration);
        assertCurrent(entry, connectionGeneration);
        // Recheck persisted authorization after acquiring ownership, before any socket is created.
        const latest = await storedTokens(entry);
        assertCurrent(entry, connectionGeneration);
        if (latest.tokens.accessToken !== authorized.tokens.accessToken) throw failure('ingress_authorization_changed');
        if (provider === 'youtube') await openYoutube(entry, connectionGeneration, authorized.tokens);
        else await openSocket(entry, connectionGeneration, authorized.tokens);
        assertCurrent(entry, connectionGeneration);
        entry.connected = true;
        entry.lastError = null;
        entry.attempts = 0;
      } catch (error) {
        if (active(entry)) retry(entry, error);
      }
      return metadata(entry);
    })().finally(() => {
      entry.connecting = null;
      if (active(entry) && !entry.connected && entry.retryTimer == null) retry(entry, failure(entry.lastError || 'ingress_disconnected'));
    });
    return entry.connecting;
  }
  async function close({ provider, ownerUserId }) {
    const entry = entries.get(`${String(provider).toLowerCase()}:${ownerId(ownerUserId)}`);
    if (!entry) return false;
    entry.closed = true;
    cancelTimer(entry, 'retryTimer');
    stopTransport(entry);
    await entry.connecting;
    await entry.releasing;
    await release(entry);
    await entry.persistence;
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
    return true;
  }
  async function reconcile() {
    if (closed || circuitError) return;
    if (inventoryPromise) return inventoryPromise;
    inventoryPromise = (async () => {
      const store = await db();
      const desired = new Map();
      // Do not close anything until every inventory query has succeeded.
      for (const sid of await store.listAllSidsWithTokens()) {
        const ownerUserId = ownerId(sid);
        desired.set(`chzzk:${ownerUserId}`, { provider: 'chzzk', ownerUserId, sid });
      }
      for (const provider of PROVIDERS) {
        for (const row of await store.listPlatformTokenUsers(provider)) {
          const ownerUserId = ownerId(row.userId);
          if (ownerUserId && !desired.has(`${provider}:${ownerUserId}`)) {
            desired.set(`${provider}:${ownerUserId}`, { provider, ownerUserId, sid: `user:${ownerUserId}` });
          }
        }
      }
      if (closed || circuitError) return;
      for (const entry of entries.values()) if (!desired.has(entry.key)) await close(entry);
      // Bound startup load without serializing every channel behind a slow provider.
      const inputs = Array.from(desired.values());
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(4, inputs.length) }, async () => {
        while (cursor < inputs.length && !closed && !circuitError) await ensure(inputs[cursor++], { revalidate: true });
      }));
      inventoryError = null;
    })().catch(error => {
      inventoryError = errorText(error);
      logger.error?.('[chat-ingress] inventory refresh failed', inventoryError);
    }).finally(() => { inventoryPromise = null; });
    return inventoryPromise;
  }
  async function start() {
    if (closed) throw failure('ingress_shutdown');
    if (started) return list();
    started = true;
    const tick = async () => {
      await reconcile();
      if (!closed && !circuitError) inventoryTimer = later(tick, config.inventoryMs);
    };
    await tick();
    return list();
  }
  function list() { return Array.from(entries.values(), metadata); }
  function health() {
    return { healthy: !closed && !circuitError && !inventoryError,
      lastError: circuitError?.code || inventoryError || null,
      pendingEvents, failedEvents: failedEvents.length };
  }
  async function shutdown() {
    closed = true;
    if (inventoryTimer != null) timers.clearTimeout(inventoryTimer);
    for (const entry of entries.values()) await close(entry);
    await inventoryPromise;
    // Callers must not report a clean drain if a received event was never persisted.
    if (circuitError) throw circuitError;
  }
  return { ensure, close, list, start, health, shutdown };
}
