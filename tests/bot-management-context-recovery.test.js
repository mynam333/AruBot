const loadSource = require('./helpers/load-source.cjs');
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
let savedGlobals, cleanup;
const context = () => ({
  actorUserId: 'actor', isSiteAdmin: false,
  active: { ownerUserId: 'target', displayName: 'Channel', role: 'manager', scopes: ['commands:write'] },
  channels: [], scopeGroups: [],
});
const response = (status = 200, body = context(), headers = {}) => new Response(JSON.stringify(body), { status, headers });
const requests = () => loadSource('src/shared/api/bot-management-context-request.ts', {
  '@/shared/api/http': { getBrowserApiBase: () => 'https://api.arubot.test' },
});

beforeEach(() => {
  jest.useFakeTimers();
  savedGlobals = Object.fromEntries(['window', 'document', 'fetch'].map((key) => [key, global[key]]));
  global.fetch = jest.fn(async () => response());
});
afterEach(() => {
  cleanup?.(); cleanup = null;
  for (const [key, value] of Object.entries(savedGlobals)) {
    if (value === undefined) delete global[key]; else global[key] = value;
  }
  jest.clearAllTimers(); jest.useRealTimers();
});

test('context bootstrap uses session credentials and the exact requested owner', async () => {
  const api = requests();
  await expect(api.readContext('target', new AbortController().signal)).resolves.toEqual(context());
  expect(fetch).toHaveBeenCalledWith('https://api.arubot.test/api/bot-management/context?botOwner=target',
    expect.objectContaining({ credentials: 'include', cache: 'no-store', signal: expect.any(AbortSignal) }));
  expect(jest.getTimerCount()).toBe(0);
});

test.each([401, 403, 404, 400])('HTTP %i is not automatically retried', async (status) => {
  const api = requests();
  fetch.mockResolvedValueOnce(response(status));
  const error = await api.readContext('target', new AbortController().signal).catch((cause) => cause);
  expect(api.isRetryableContextError(error)).toBe(false);
});

test.each([408, 429, 500, 502, 503, 504])('HTTP %i allows bounded backoff', async (status) => {
  const api = requests();
  fetch.mockResolvedValueOnce(response(status));
  const error = await api.readContext('target', new AbortController().signal).catch((cause) => cause);
  expect(api.isRetryableContextError(error)).toBe(true);
  expect([0, 1, 2, 3, 4, 100].map((attempt) => api.contextRetryDelay(attempt, error))).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
});

test('network failures use a recoverable localized error', async () => {
  const api = requests();
  fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  const error = await api.readContext('target', new AbortController().signal).catch((cause) => cause);
  expect(api.isRetryableContextError(error)).toBe(true);
  expect(error.message).not.toContain('Failed to fetch');
});

test('retry scheduling honors Retry-After', async () => {
  const api = requests();
  fetch.mockResolvedValueOnce(response(429, {}, { 'Retry-After': '90' }));
  const error = await api.readContext('target', new AbortController().signal).catch((cause) => cause);
  expect(api.contextRetryDelay(0, error)).toBe(90_000);
});

test('a hanging permission request times out and can recover', async () => {
  const api = requests();
  fetch.mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason));
  }));
  const result = api.readContext('target', new AbortController().signal).catch((cause) => cause);
  await jest.advanceTimersByTimeAsync(10_000);
  expect(api.isRetryableContextError(await result)).toBe(true);
  expect((await result).status).toBe(408);
});

test('parent cancellation is not mistaken for a recoverable network failure', async () => {
  const api = requests(), controller = new AbortController();
  fetch.mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason));
  }));
  const result = api.readContext('target', controller.signal).catch((cause) => cause);
  controller.abort();
  expect(api.isRetryableContextError(await result)).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});

test('mismatched owners and malformed responses fail closed', async () => {
  const api = requests();
  await expect(api.readContext('other', new AbortController().signal)).rejects.toThrow('요청한 채널');
  fetch.mockResolvedValueOnce(response(200, { actorUserId: 'actor' }));
  await expect(api.readContext('target', new AbortController().signal)).rejects.toThrow('응답');
});

// Exercise the real provider's hooks, event listeners and timers without a DOM dependency.
function mount() {
  const hooks = [], storage = new Map([['arubot:bot-owner', 'target'], ['arubot:bot-actor', 'actor']]);
  let cursor = 0, dirty = true, pending = [], tree;
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const memo = (factory, deps) => {
    const index = cursor++;
    if (!hooks[index] || !equal(hooks[index].deps, deps)) hooks[index] = { value: factory(), deps };
    return hooks[index].value;
  };
  global.window = Object.assign(new EventTarget(), {
    location: { href: 'https://arubot.test/commands', reload: jest.fn(), assign: jest.fn() },
    history: { replaceState: jest.fn() }, setTimeout, clearTimeout, setInterval, clearInterval,
    sessionStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
  });
  global.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const jsx = (type, props, key) => ({ type, props, key });
  const ownerStorage = loadSource('src/shared/lib/bot-management-context.ts');
  const { BotChannelProvider } = loadSource('src/components/app-shell/bot-channel-provider.tsx', {
    react: {
      createContext: () => ({ Provider: 'ContextProvider' }), useContext: () => null,
      useState: (initial) => {
        const index = cursor++;
        hooks[index] ||= { value: initial };
        return [hooks[index].value, (next) => {
          const value = typeof next === 'function' ? next(hooks[index].value) : next;
          if (!Object.is(value, hooks[index].value)) { hooks[index].value = value; dirty = true; }
        }];
      },
      useRef: (initial) => { const index = cursor++; return hooks[index] ||= { current: initial }; },
      useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps),
      useEffect: (effect, deps) => {
        const index = cursor++;
        if (!hooks[index] || !equal(hooks[index].deps, deps)) pending.push(() => {
          hooks[index]?.cleanup?.(); hooks[index] = { deps, cleanup: effect() };
        });
      },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'lucide-react': { Loader2: 'Loader', LogIn: 'Login', RefreshCw: 'Refresh', UserRound: 'User' },
    '@/components/ui/button': { Button: 'button', LinkButton: 'a' },
    '@/shared/api/bot-management-context-request': requests(),
    '@/shared/lib/bot-management-context': ownerStorage,
    '@/shared/config/navigation': { adminNav: [], getBotPageModule: () => 'commands' },
  });
  const render = () => {
    while (dirty) {
      dirty = false; cursor = 0; pending = [];
      tree = BotChannelProvider({ children: 'editor' });
      for (const effect of pending) effect();
    }
  };
  const settle = async () => { for (let i = 0; i < 5; i += 1) { await flush(); render(); } };
  render();
  cleanup = () => hooks.forEach((hook) => hook.cleanup?.());
  return {
    settle, ownerStorage, tree: () => tree,
    value: () => tree.type === 'ContextProvider' ? tree.props.value : null,
    advance: async (ms) => { await jest.advanceTimersByTimeAsync(ms); await settle(); },
    visible: async () => { document.dispatchEvent(new Event('visibilitychange')); await settle(); },
    event: async (name) => { window.dispatchEvent(new Event(name)); await settle(); },
  };
}

test('recent tab switches do not refetch; unchanged background checks keep the context identity', async () => {
  const h = mount(); await h.settle();
  const value = h.value();
  await h.visible(); await h.advance(1000); await h.visible();
  expect(fetch).toHaveBeenCalledTimes(1);
  await h.advance(29_000);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(h.value()).toBe(value);
  expect(window.location.reload).not.toHaveBeenCalled();
});

test('a background failure retains the editor and permissions then automatically recovers', async () => {
  const h = mount(); await h.settle();
  const value = h.value(), editorContainer = h.tree().props.children;
  fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await h.advance(30_000);
  expect(h.value()).toBe(value);
  expect(h.tree().props.children.key).toBe(editorContainer.key);
  expect(h.tree().props.children.props.children[1]).toBe('editor');
  expect(h.tree().props.children.props.children[0].props.role).toBe('status');
  expect(h.ownerStorage.getBotManagementOwner()).toBe('target');
  await h.visible(); expect(fetch).toHaveBeenCalledTimes(2);
  await h.advance(2000);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(h.value()).toBe(value);
  expect(h.tree().props.children.props.children[0]).toBeNull();
});

test('initial transient failure retries without a manual refresh', async () => {
  fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  const h = mount(); await h.settle();
  expect(h.value()).toBeNull();
  await h.advance(2000);
  expect(h.value().active.ownerUserId).toBe('target');
});

test.each([401, 403, 404])('HTTP %i removes protected content and does not retry in the background', async (status) => {
  const h = mount(); await h.settle();
  fetch.mockResolvedValueOnce(response(status));
  await h.advance(30_000);
  expect(h.value()).toBeNull();
  expect(h.ownerStorage.getBotManagementOwner()).toBe('target');
  await h.advance(60_000);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('auth changes bypass freshness and account changes never reuse the previous editor', async () => {
  const h = mount(); await h.settle();
  fetch.mockResolvedValueOnce(response(200, { ...context(), actorUserId: 'another-account' }));
  await h.event('arubot:auth-changed');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(h.value()).toBeNull();
  expect(h.ownerStorage.getBotManagementOwner()).toBe('target');
});

test('permission changes propagate even when the selected owner stays the same', async () => {
  const h = mount(); await h.settle();
  expect(h.value().canWrite('commands')).toBe(true);
  fetch.mockResolvedValueOnce(response(200, { ...context(), active: { ...context().active, scopes: ['commands:read'] } }));
  await h.advance(30_000);
  expect(h.value().canWrite('commands')).toBe(false);
  expect(h.value().canRead('commands')).toBe(true);
});

test('restored connectivity retries promptly and logout cancels outstanding recovery', async () => {
  const h = mount(); await h.settle();
  fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await h.advance(30_000);
  await h.event('online');
  expect(fetch).toHaveBeenCalledTimes(3);
  fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await h.advance(30_000);
  await h.event('arubot:logout');
  await h.advance(60_000);
  expect(h.value()).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(4);
});

test('tab visibility events do not cancel or duplicate an in-flight verification', async () => {
  let resolve;
  fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const h = mount(); await h.settle();
  await h.visible(); await h.visible();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
  resolve(response()); await h.settle();
  expect(h.value().active.ownerUserId).toBe('target');
});
