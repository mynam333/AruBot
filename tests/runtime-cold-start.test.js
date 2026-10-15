const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { EventEmitter } = require('events');
const load = require('./helpers/load-server-functions.cjs');
const { createRuntimeRecoverySupervisor } = require('./helpers/load-source.cjs')('server/runtime-recovery.js');

const quiet = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function inventoryLoader(client) {
  const filename = path.join(__dirname, '../server/supabase.js');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const pick = name => source.statements.find(node => node.name?.text === name).getText(source).replace(/^export /, '');
  const quote = value => `"${value}"`;
  return new Function('supabase', 'ensure', 'buildColumnExpression', 'parseSelectColumns', 'quoteIdent',
    `${pick('PgQueryBuilder')}\n${pick('listAllSidsWithTokens')}\nreturn { listAllSidsWithTokens, PgQueryBuilder };`)(client, () => {}, quote, value => value.split(',').map(quote).join(', '), quote);
}

function bootstrap(overrides = {}) {
  const bindings = {
    console: quiet, REGISTERED_RUNTIME_MONITOR_CONCURRENCY: 4,
    listAllSidsWithTokens: jest.fn(async () => ['user:legacy', 'user:shared']),
    listPlatformTokenUsers: jest.fn(async () => [{ userId: 'shared' }, { userId: 'platform-only' }]),
    activeSids: new Map(), runtimeReadinessState: { shuttingDown: false },
    getBotSettings: jest.fn(async () => ({})),
    resolveChzzkChannelUidsForSid: jest.fn(async sid => [`channel-${sid}`]),
    ensureChzzkChatSessionForLiveSid: jest.fn(async () => ({ connected: true })),
    refreshChzzkLiveStatusForSid: jest.fn(async () => ({ live: false })),
    sleep: async () => {}, ...overrides,
  };
  return { ...bindings, ...load(['forEachWithConcurrency', 'bootstrapEnsureSessions'], bindings) };
}

test('stored CHZZK inventory uses a non-NULL SQL predicate and fetches every page', async () => {
  const rows = Array.from({ length: 1203 }, (_, index) => ({ sid: `user:${String(index).padStart(4, '0')}` }));
  const queries = [];
  let PgQueryBuilder;
  const client = { from: table => {
    const builder = new PgQueryBuilder(table);
    builder._execute = async () => {
      const query = builder._buildSql();
      queries.push(query);
      // Reproduce SQL NULL comparison: the old predicate returns no rows.
      const usable = query.values[0] === '' && query.sql.includes('"access_token" > $1');
      return { data: usable ? rows.slice(builder.offsetCount, builder.offsetCount + builder.limitCount) : [], error: null };
    };
    return builder;
  } };
  const api = inventoryLoader(client);
  PgQueryBuilder = api.PgQueryBuilder;
  expect(await api.listAllSidsWithTokens()).toEqual(rows.map(row => row.sid));
  expect(queries).toHaveLength(3);
  expect(queries[0].sql).toContain('order by "sid" asc limit 500 offset 0');
  expect(queries[0].values).toEqual(['']);
});

test('inventory errors are not interpreted as an empty connected-account list', async () => {
  const client = { from: () => {
    const query = { select() { return this; }, gt() { return this; }, order() { return this; },
      range: async () => ({ error: new Error('database unavailable') }) };
    return query;
  } };
  await expect(inventoryLoader(client).listAllSidsWithTokens()).rejects.toThrow('database unavailable');
});

test('cold startup subscribes legacy and platform-only users once, including offline channels', async () => {
  const h = bootstrap();
  await h.bootstrapEnsureSessions();
  expect([...h.activeSids.keys()]).toEqual(['user:legacy', 'user:shared', 'user:platform-only']);
  expect(h.ensureChzzkChatSessionForLiveSid).toHaveBeenCalledTimes(3);
  expect(h.ensureChzzkChatSessionForLiveSid).toHaveBeenCalledWith('user:platform-only', 'channel-user:platform-only');
  expect(h.refreshChzzkLiveStatusForSid.mock.calls.every(([, options]) => options.ensureChat === false)).toBe(true);
});

test('failed live lookup does not block the subscription; bootstrap waits for that attempt', async () => {
  const subscription = deferred();
  const h = bootstrap({ listAllSidsWithTokens: async () => ['user:owner'], listPlatformTokenUsers: async () => [],
    ensureChzzkChatSessionForLiveSid: jest.fn(() => subscription.promise),
    refreshChzzkLiveStatusForSid: jest.fn(async () => { throw new Error('503'); }) });
  let done = false;
  const run = h.bootstrapEnsureSessions().then(() => { done = true; });
  await tick();
  expect(h.ensureChzzkChatSessionForLiveSid).toHaveBeenCalled();
  expect(done).toBe(false);
  subscription.resolve({ connected: true });
  await run;
  expect(done).toBe(true);
});

test('one failed inventory still recovers the other inventory but does not report ready', async () => {
  const h = bootstrap({ listAllSidsWithTokens: async () => { throw new Error('legacy inventory failed'); } });
  await expect(h.bootstrapEnsureSessions()).rejects.toThrow('legacy inventory failed');
  expect(h.ensureChzzkChatSessionForLiveSid).toHaveBeenCalledTimes(2);
});

test('stopping the server prevents bootstrap from creating more sessions', async () => {
  const h = bootstrap({ runtimeReadinessState: { shuttingDown: true } });
  await h.bootstrapEnsureSessions();
  expect(h.ensureChzzkChatSessionForLiveSid).not.toHaveBeenCalled();
});

test('simultaneous website and startup session requests share the entire CHZZK creation', async () => {
  const opened = deferred();
  const create = jest.fn(() => opened.promise);
  const store = new Map();
  const h = load(['singleFlight', 'ownerUserIdFromSid', 'ensureSession'], {
    singleFlightRequests: new Map(), sessionStore: store,
    assertProviderRuntimeConnected() {}, ensureChzzkSessionOwned: create,
  });
  const first = h.ensureSession('user:owner', 'channel');
  const second = h.ensureSession('legacy-owner', 'channel');
  await tick();
  expect(create).toHaveBeenCalledTimes(1);
  const entry = { connected: true, sids: new Set() };
  opened.resolve(entry);
  expect(await first).toBe(entry);
  expect(await second).toBe(entry);
  expect([...store.values()]).toEqual([entry, entry]);
});

test('platform-only CHZZK authorization refresh is conditional and needs no cookie login', async () => {
  const tokens = { accessToken: 'old', refreshToken: 'refresh', platformUserId: 'channel', expiresAt: '2000-01-01', scope: 'chat' };
  const persist = jest.fn(async () => true);
  const h = load(['getValidAccessToken', 'loadValidChzzkAccessToken', 'singleFlight', 'ownerUserIdFromSid'], {
    singleFlightRequests: new Map(), assertProviderRuntimeConnected() {},
    getTokens: async () => null, getPlatformTokens: jest.fn(async () => tokens),
    upsertPlatformTokens: persist, updateTokens: jest.fn(),
    axios: { post: jest.fn(async () => ({ data: { accessToken: 'fresh', expiresIn: 3600 } })) },
    OPENAPI_BASE: 'https://example.test', CHZZK_CLIENT_ID: 'id', CHZZK_CLIENT_SECRET: 'secret', DEFAULT_TIMEOUT: 8000,
    computeExpiresAt: () => '2099-01-01',
  });
  expect(await h.getValidAccessToken('user:owner')).toBe('fresh');
  expect(persist).toHaveBeenCalledWith('chzzk', 'owner', 'channel', expect.objectContaining({ accessToken: 'fresh', scope: 'chat' }), { expectedTokens: tokens });
  persist.mockResolvedValue(false);
  await expect(h.getValidAccessToken('user:owner')).rejects.toThrow('authorization changed');
});

test('CHZZK recovery retries with backoff without a dashboard request and stops after success', async () => {
  jest.useFakeTimers();
  try {
    const supervisor = createRuntimeRecoverySupervisor({ baseDelayMs: 1000, jitterRatio: 0 });
    const ensure = jest.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValue({ connected: true });
    const h = load(['scheduleProviderSessionRecovery', 'recoverProviderSession', 'providerRuntimeRecoveryKey'], {
      console: quiet, normalizeRuntimeProvider: value => value, providerRuntimeRecoverySupervisor: supervisor,
      isProviderSessionRecoveryBlocked: () => false, assertProviderRuntimeConnected() {},
      ensureSession: ensure, chzzkRuntimeErrors: new Map(),
    });
    h.scheduleProviderSessionRecovery('chzzk', 'owner', { sid: 'user:owner', channelId: 'channel' });
    h.scheduleProviderSessionRecovery('chzzk', 'owner', { sid: 'user:owner' });
    await jest.advanceTimersByTimeAsync(1000);
    expect(ensure).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2000);
    expect(ensure).toHaveBeenCalledTimes(2);
    expect(ensure).toHaveBeenLastCalledWith('user:owner', 'channel');
    expect(supervisor.listStates()).toEqual([]);
    supervisor.cancelAll();
  } finally { jest.useRealTimers(); }
});

test.each(['cime', 'youtube'])('%s connects before observing live state and survives failed live lookup', async provider => {
  const order = [];
  const bindings = {
    console: quiet, REGISTERED_RUNTIME_MONITOR_CONCURRENCY: 4, sleep: async () => {},
    runtimeReadinessState: { shuttingDown: false }, listPlatformTokenUsers: async () => [{ userId: 'owner' }],
    cimeSessionStore: new Map(), youtubeSessionStore: new Map(), WebSocket: { OPEN: 1, CONNECTING: 0 },
    ensureProviderRuntimeLease: async () => order.push('lease'),
    getProviderSessionRecoveryStatus: () => null, isYoutubeReauthRequired: () => false,
    ensureCimeSession: async () => { order.push('connect'); return {}; },
    waitForCimeSessionOpen: async () => {}, ensureCimeSubscribed: async () => {},
    ensureYoutubeSession: async () => { order.push('connect'); return {}; },
    refreshCimeLiveStatus: async () => { order.push('live'); throw new Error('503'); },
    refreshYoutubeLiveStatus: async () => { order.push('live'); throw new Error('503'); },
    getYoutubeStreamerChannel: async () => null, isProviderRuntimeLeaseConflict: () => false,
    scheduleProviderSessionRecovery: jest.fn(),
  };
  const name = provider === 'cime' ? 'bootstrapEnsureCimeSessions' : 'bootstrapEnsureYoutubeSessions';
  await load(['forEachWithConcurrency', name], bindings)[name]();
  expect(order).toEqual(['lease', 'connect', 'live']);
  expect(bindings.scheduleProviderSessionRecovery).not.toHaveBeenCalled();
});

test('provider inventory failure does not prevent other providers from recovering', async () => {
  const order = [];
  const h = load(['bootstrapRegisteredChannelLiveStatuses'], {
    console: quiet, providerObservationBootstrapPending: true, runtimeReadinessState: { shuttingDown: false },
    primeConnectedProviderLiveObservations: async () => { throw new Error('DB lookup failed'); },
    bootstrapEnsureSessions: async () => { order.push('chzzk'); throw new Error('CHZZK lookup failed'); },
    bootstrapEnsureCimeSessions: async () => order.push('cime'),
    bootstrapEnsureYoutubeSessions: async () => order.push('youtube'), sleep: async () => {},
  });
  await expect(h.bootstrapRegisteredChannelLiveStatuses()).rejects.toThrow('inventory/bootstrap failed');
  expect(order).toEqual(['chzzk', 'cime', 'youtube']);
});

test('a lease acquired after shutdown is released instead of starting a new runtime', async () => {
  const state = { shuttingDown: false };
  const lease = deferred();
  const release = jest.fn(async () => {});
  const leases = new Map();
  const h = load(['ensureProviderRuntimeLease', 'providerRuntimeLeaseResourceKey'], {
    runtimeReadinessState: state, providerRuntimeLeases: leases, claimRuntimeLease: () => lease.promise,
    releaseRuntimeLease: release, INSTANCE_ID: 'old-instance', PROVIDER_RUNTIME_LEASE_RENEW_MS: 15000, PROVIDER_RUNTIME_LEASE_TTL_MS: 45000,
  });
  const pending = h.ensureProviderRuntimeLease('chzzk', 'owner', { channelId: 'channel' });
  state.shuttingDown = true;
  lease.resolve({ acquired: true });
  await expect(pending).rejects.toThrow('server_shutting_down');
  expect(release).toHaveBeenCalledWith('provider-runtime:chzzk:channel', 'old-instance');
  expect(leases.size).toBe(0);
});

test('real CHZZK session functions subscribe all event types once and schedule recovery on disconnect', async () => {
  const sockets = [];
  const socketFactory = jest.fn(() => {
    const socket = new EventEmitter();
    socket.disconnect = jest.fn(() => socket.emit('disconnect', 'client disconnect'));
    sockets.push(socket);
    queueMicrotask(() => socket.emit('SYSTEM', { type: 'connected', data: { sessionKey: 'key' } }));
    return socket;
  });
  const post = jest.fn(async () => ({}));
  const get = jest.fn(async () => ({ data: { content: { url: 'wss://example.test/chat' } } }));
  const recovery = jest.fn();
  const bindings = {
    console: quiet, singleFlightRequests: new Map(), sessionStore: new Map(), channelSessionStore: new Map(),
    sessionCreatePromises: new Map(), runtimeReadinessState: { shuttingDown: false }, chzzkRuntimeErrors: new Map(),
    assertProviderRuntimeConnected() {}, ensureProviderRuntimeLease: async () => ({}),
    getValidAccessToken: async () => 'token', axios: { get, post }, OPENAPI_BASE: 'https://example.test',
    DEFAULT_TIMEOUT: 8000, getIoClient: async () => socketFactory, compactLogText: value => value,
    scheduleProviderSessionRecovery: recovery,
  };
  const h = load(['singleFlight', 'ownerUserIdFromSid', 'ensureSession', 'ensureChzzkSessionOwned', 'ensureSubscribed', 'subscribeEvent'], bindings);
  const [first, second] = await Promise.all([h.ensureSession('user:owner', 'channel'), h.ensureSession('user:owner', 'channel')]);
  expect(first).toBe(second);
  expect(first.connected).toBe(true);
  expect(first.subscribed.has('ALL')).toBe(true);
  expect(socketFactory).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledTimes(1);
  expect(post.mock.calls.map(([url]) => url.split('/').at(-1))).toEqual(['chat', 'donation', 'subscription']);
  expect(sockets[0].listenerCount('CHAT')).toBe(1);
  sockets[0].emit('disconnect', 'transport close');
  expect(first.connected).toBe(false);
  expect(recovery).toHaveBeenCalledWith('chzzk', 'owner', { sid: 'user:owner', channelId: 'channel', reason: 'websocket_closed' });
  const reconnected = await h.ensureSession('user:owner', 'channel');
  expect(reconnected).not.toBe(first);
  expect(reconnected.connected).toBe(true);
  expect(post).toHaveBeenCalledTimes(6);
  expect(recovery).toHaveBeenCalledTimes(1);
});

test('PM2 ready is sent once after successful startup, never after a failed inventory or shutdown', async () => {
  const state = { initialBootstrapCompleted: false, shuttingDown: false };
  const send = jest.fn();
  const recover = jest.fn().mockRejectedValueOnce(new Error('DB inventory unavailable')).mockResolvedValue();
  const h = load(['runRegisteredRuntimeMonitor'], {
    registeredRuntimeMonitorRunning: false, lastFullProviderRecoveryAt: 0,
    REGISTERED_PROVIDER_RECOVERY_INTERVAL_MS: 60000, runtimeReadinessState: state,
    bootstrapRegisteredChannelLiveStatuses: recover, bootstrapEnsureSessions: async () => {},
    server: { listening: true }, process: { send },
  });
  await expect(h.runRegisteredRuntimeMonitor('startup')).rejects.toThrow('DB inventory unavailable');
  expect(state.initialBootstrapCompleted).toBe(false);
  expect(send).not.toHaveBeenCalled();
  await h.runRegisteredRuntimeMonitor('startup');
  await h.runRegisteredRuntimeMonitor('scheduled');
  expect(state.initialBootstrapCompleted).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith('ready');
  state.shuttingDown = true;
  expect(await h.runRegisteredRuntimeMonitor('startup')).toBe(false);
  expect(recover).toHaveBeenCalledTimes(2);
});

test('shutdown during a lease renewal does not leave ownership behind for the next process', async () => {
  const state = { shuttingDown: false };
  const pending = deferred();
  const release = jest.fn(async () => {});
  const lease = { resourceKey: 'provider-runtime:chzzk:channel' };
  const h = load(['renewProviderRuntimeLeases'], {
    runtimeReadinessState: state, providerRuntimeLeaseRenewalRunning: false,
    providerRuntimeLeases: new Map([[lease.resourceKey, lease]]),
    claimRuntimeLease: () => pending.promise, releaseRuntimeLease: release,
    INSTANCE_ID: 'old-instance', PROVIDER_RUNTIME_LEASE_TTL_MS: 45000,
  });
  const run = h.renewProviderRuntimeLeases();
  state.shuttingDown = true;
  pending.resolve({ acquired: true });
  await run;
  expect(release).toHaveBeenCalledWith(lease.resourceKey, 'old-instance');
});
