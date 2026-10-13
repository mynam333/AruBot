import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { createMarbleState } from '../shared/marble.js';

const hookSources = Object.fromEntries(['use-marble-snapshot.ts', 'marble-participant-page.tsx'].map(file => [file,
  transformSync(readFileSync(new URL(`../src/features/marble/${file}`, import.meta.url), 'utf8'), {
    loader: file.endsWith('.tsx') ? 'tsx' : 'ts', format: 'cjs', target: 'es2022',
  }).code,
]));

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function packet(revision = 10) {
  return { state: { ...createMarbleState(), revision }, serverNow: 1000 + revision, access: 'participant', actorPlayerId: 'player-1' };
}

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('OBS connection and layout revisions allow lower-revision room switches but reject delayed previous-room snapshots', async t => {
  const initial = { ...packet(90), access: 'overlay' };
  let next = initial;
  const h = hookHarness(t, { fetch: async () => response(200, next) });
  h.mount(() => h.useMarbleSnapshot('/api/overlays/marble?token=personal'));
  await h.current.refresh();
  const connected = { ...packet(3), access: 'overlay', overlayRevision: { connection: 1, source: 90 } };
  next = connected; await h.current.refresh();
  assert.equal(h.current.snapshot, connected);
  assert.equal(h.current.error, null);
  h.current.accept(initial);
  assert.equal(h.current.snapshot, connected);
  next = initial; await h.current.refresh();
  assert.equal(h.current.snapshot, connected);
  assert.ok(h.current.error);
  const updatedLayout = { ...connected, overlayRevision: { connection: 1, source: 91 } };
  next = updatedLayout; await h.current.refresh();
  assert.equal(h.current.snapshot, updatedLayout);
  assert.equal(h.current.error, null);
  h.current.accept(connected);
  assert.equal(h.current.snapshot, updatedLayout);
  const switched = { ...packet(1), access: 'overlay', overlayRevision: { connection: 2, source: 91 } };
  next = switched; await h.current.refresh();
  assert.equal(h.current.snapshot, switched);
  const restored = { ...packet(91), access: 'overlay', overlayRevision: { connection: 3, source: 91 } };
  next = restored; await h.current.refresh();
  assert.equal(h.current.snapshot, restored);
  h.current.accept({ ...packet(1000), access: 'overlay', overlayRevision: { connection: 2, source: 1000 } });
  h.current.accept({ ...packet(1000), access: 'overlay' });
  assert.equal(h.current.snapshot, restored);
});

test('revocation fallback supersedes the remote board even with a lower personal revision and preserves later reacceptance', async t => {
  const online = { ...packet(500), access: 'overlay', overlayRevision: { connection: 8, source: 1 } };
  let next = online;
  const h = hookHarness(t, { fetch: async () => response(200, next) });
  h.mount(() => h.useMarbleSnapshot('/api/overlays/marble?token=personal'));
  await h.current.refresh();
  const restored = { ...packet(1), access: 'overlay', overlayRevision: { connection: 9, source: 1 } };
  next = restored; await h.current.refresh();
  assert.equal(h.current.snapshot, restored);
  h.current.accept({ ...online, serverNow: 100000 });
  assert.equal(h.current.snapshot, restored);
  const reaccepted = { ...packet(2), access: 'overlay', overlayRevision: { connection: 10, source: 1 } };
  next = reaccepted; await h.current.refresh();
  assert.equal(h.current.snapshot, reaccepted);
  h.current.accept(restored);
  assert.equal(h.current.snapshot, reaccepted);
});

// Execute the actual exported hooks without rendering their component imports.
// Preserve hook slots, dependency comparisons, rerenders and effect cleanup;
// timers never advance unless a test explicitly triggers another request.
function hookHarness(t, { fetch, readJsonResult } = {}) {
  const slots = [], effects = [], timers = new Map();
  let cursor = 0, dirty = false, renderHook, value, timerId = 0;
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = { value: typeof initial === 'function' ? initial() : initial };
        slots[index].set = next => {
          const resolved = typeof next === 'function' ? next(slots[index].value) : next;
          if (!Object.is(resolved, slots[index].value)) { slots[index].value = resolved; dirty = true; }
        };
      }
      return [slots[index].value, slots[index].set];
    },
    useRef(initial) {
      const index = cursor++;
      slots[index] ??= { current: initial };
      return slots[index];
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { value: callback, deps };
      return slots[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!slots[index] || !sameDeps(slots[index].deps, deps)) {
        const cleanup = slots[index]?.cleanup;
        slots[index] = { deps };
        effects.push(() => { cleanup?.(); slots[index].cleanup = effect(); });
      }
    },
  };
  const setTimeout = callback => { timers.set(++timerId, callback); return timerId; };
  const clearTimeout = id => timers.delete(id);
  const window = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const unexpected = () => { throw new Error('Unexpected network request'); };
  const http = { apiUrl: path => path, readJsonResult: readJsonResult ?? unexpected };
  const context = vm.createContext({
    AbortController, DOMException, console, window, document, navigator: { onLine: true },
    setTimeout, clearTimeout, fetch: fetch ?? unexpected,
    require: id => id === 'react' ? react : id === '@/shared/api/http' ? http : {},
  });
  function load(file) {
    const module = { exports: {} };
    context.module = module; context.exports = module.exports;
    vm.runInContext(hookSources[file], context, { filename: file });
    return module.exports;
  }
  const { useMarbleSnapshot } = load('use-marble-snapshot.ts');
  const { useMarbleMutation } = load('marble-participant-page.tsx');
  function render() {
    for (let attempt = 0; attempt < 25; attempt++) {
      cursor = 0; dirty = false;
      value = renderHook();
      for (const effect of effects.splice(0)) effect();
      if (!dirty) return value;
    }
    throw new Error('Hook did not settle after 25 renders');
  }
  t.after(() => {
    for (const slot of slots) slot?.cleanup?.();
    timers.clear();
  });
  return {
    useMarbleSnapshot, useMarbleMutation,
    mount(hook) { renderHook = hook; return render(); },
    get current() { return render(); },
  };
}

for (const code of ['command_conflict', 'request_id_conflict', 'invitation_expired', undefined]) {
  test(`mutation 409 ${code ?? 'without code'} preserves backend error without marking a draft stale`, async t => {
    const message = `Backend explanation: ${code ?? 'unknown conflict'}`;
    let conflicts = 0, successes = 0, accepts = 0;
    const h = hookHarness(t, { readJsonResult: async () => ({ ok: false, status: 409, data: null, message, ...(code ? { code } : {}) }) });
    h.mount(() => h.useMarbleMutation(() => { accepts++; }, () => {}));
    const result = await h.current.send({
      path: '/api/marble/settings', method: 'PUT', body: { requestId: 'validation-test' }, snapshot: true,
      conflict: () => { conflicts++; }, success: () => { successes++; },
    });
    assert.equal(result, false);
    assert.equal(h.current.error, message);
    assert.equal(conflicts, 0);
    assert.equal(successes, 0);
    assert.equal(accepts, 0);
    assert.equal(h.current.retry, null);
    assert.equal(h.current.busy, false);
  });
}

for (const code of ['stale_revision', 'stale_player_state', 'stale_participation', 'stale_participation_revision', 'stale_overlay_revision']) {
  test(`mutation 409 ${code} invokes conflict callback and refreshes`, async t => {
    let conflicts = 0, refreshes = 0, successes = 0;
    const h = hookHarness(t, { readJsonResult: async () => ({ ok: false, status: 409, data: null, code, message: `Backend explanation: ${code}` }) });
    h.mount(() => h.useMarbleMutation(() => assert.fail('Rejected mutation must not accept a snapshot'), () => { refreshes++; }));
    assert.equal(await h.current.send({
      path: '/api/marble/settings', method: 'PUT', body: { requestId: code }, snapshot: true,
      conflict: () => { conflicts++; }, success: () => { successes++; },
    }), false);
    assert.equal(conflicts, 1);
    assert.equal(refreshes, 1);
    assert.equal(successes, 0);
    assert.ok(h.current.error);
    assert.equal(h.current.retry, null);
    assert.equal(h.current.busy, false);
  });
}

for (const status of [401, 403, 404]) {
  test(`snapshot GET ${status} immediately clears previously visible state`, async t => {
    const initial = packet();
    let nextResponse = response(200, initial);
    const h = hookHarness(t, { fetch: async () => nextResponse });
    h.mount(() => h.useMarbleSnapshot('/api/viewer/marble/rooms/owner'));
    await h.current.refresh();
    assert.equal(h.current.snapshot, initial);

    nextResponse = response(status, { message: `Denied ${status}` });
    await h.current.refresh();
    assert.equal(h.current.snapshot, null);
    assert.equal(h.current.error, `Denied ${status}`);
  });

  test(`late successful mutation cannot resurrect state denied by GET ${status}`, async t => {
    const write = deferred();
    let nextResponse = response(200, packet());
    const h = hookHarness(t, { fetch: async () => nextResponse, readJsonResult: () => write.promise });
    h.mount(() => {
      const snapshot = h.useMarbleSnapshot('/api/viewer/marble/rooms/owner');
      return { snapshot, mutation: h.useMarbleMutation(snapshot.accept, snapshot.refresh) };
    });
    await h.current.snapshot.refresh();
    const pendingWrite = h.current.mutation.send({
      path: '/api/viewer/marble/rooms/owner/action', method: 'POST',
      body: { action: 'roll', requestId: 'delayed-write' }, snapshot: true,
    });
    assert.equal(h.current.mutation.busy, true);

    nextResponse = response(status, { message: `Denied ${status}` });
    await h.current.snapshot.refresh();
    write.resolve({ ok: true, status: 200, data: packet(100) });
    await pendingWrite;
    assert.equal(h.current.mutation.busy, false);
    assert.equal(h.current.snapshot.snapshot, null);
    assert.equal(h.current.snapshot.error, `Denied ${status}`);

    for (const revision of [1, 10, 1000]) {
      h.current.snapshot.accept(packet(revision));
      assert.equal(h.current.snapshot.snapshot, null, `Mutation revision ${revision} must remain blocked`);
      assert.equal(h.current.snapshot.error, `Denied ${status}`);
    }
  });

  test(`after GET ${status}, only a valid fresh GET restores snapshots and mutation acceptance`, async t => {
    let nextResponse = response(status, { message: `Denied ${status}` });
    const h = hookHarness(t, { fetch: async () => nextResponse });
    h.mount(() => h.useMarbleSnapshot('/api/viewer/marble/rooms/owner'));
    await h.current.refresh();

    for (const failedRead of [response(503, { message: 'Temporarily unavailable' }), response(200, { invalid: true })]) {
      nextResponse = failedRead;
      await h.current.refresh();
      const error = h.current.error;
      assert.ok(error);
      h.current.accept(packet(100));
      assert.equal(h.current.snapshot, null);
      assert.equal(h.current.error, error);
    }

    const recovery = deferred();
    nextResponse = recovery.promise;
    const pendingRead = h.current.refresh();
    h.current.accept(packet(1000));
    assert.equal(h.current.snapshot, null, 'Starting a fresh GET must not unblock mutation snapshots');

    const restored = packet(1);
    recovery.resolve(response(200, restored));
    await pendingRead;
    assert.equal(h.current.snapshot, restored);
    assert.equal(h.current.error, null);

    const updated = packet(2);
    h.current.accept(updated);
    assert.equal(h.current.snapshot, updated);
    assert.equal(h.current.error, null);
  });
}
