const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../local-program/avatars/overlay.js'),
  'utf8',
);
const sandbox = { module: { exports: {} } };
vm.runInNewContext(source, sandbox);
const {
  normalizeClip,
  resolveClip,
  clipGeometry,
  frameAt,
  framePosition,
  sceneLayout,
  fitActor,
  labelVisibility,
  createFrameGate,
  reloadBudget,
  createAssetCache,
} = sandbox.module.exports;
const asset = (letter, extension = 'png') =>
  `${letter.repeat(64)}.${extension}`;
const idle = { asset: asset('a'), columns: 4, rows: 2, frames: 8, fps: 10 };
const walk = { ...idle, asset: asset('b') };
const avatar = { id: 'avatar', stride: 50, states: { idle, walk } };
const actor = {
  id: 'actor',
  number: 1,
  avatar: 'avatar',
  name: 'Viewer',
  state: 'idle',
  size: 80,
  direction: 1,
  x: 960,
  y: 1056,
  animationStartedAt: 1000,
  travelDistance: 0,
  lastChat: 1000,
};
const snapshot = (changes = {}) => ({
  protocolVersion: 3,
  sessionId: 'session-a',
  sequence: 1,
  configRevision: 1,
  at: 2000,
  simulationTime: 2000,
  actors: [{ ...actor }],
  avatars: [avatar],
  width: 1920,
  height: 1080,
  ground: 1056,
  ...changes,
});

test('non-square frames use explicit metadata, then natural image dimensions per cell', () => {
  const image = { naturalWidth: 400, naturalHeight: 100 };
  const natural = clipGeometry(idle, actor, image);
  assert.equal(natural.width, 160);
  assert.equal(natural.height, 80);
  assert.equal(natural.left, -80);
  assert.equal(natural.top, -80);
  const metadata = clipGeometry(
    { ...idle, frameWidth: 30, frameHeight: 60 },
    actor,
    image,
  );
  assert.equal(metadata.width, 40);
  assert.equal(metadata.height, 80);
  assert.equal(
    clipGeometry({ ...idle, preserveAspect: false }, actor, image).width,
    80,
  );
  assert.equal(clipGeometry(idle, actor).width, 80);
});

test('anchors, offsets, source direction, and scale preserve the foot pivot without double temporary sizing', () => {
  const clip = {
    ...idle,
    frameWidth: 40,
    frameHeight: 80,
    anchorX: 0.25,
    anchorY: 0.75,
    offsetX: 5,
    offsetY: -3,
    scale: 2,
    direction: 'left',
  };
  const g = clipGeometry(clip, { ...actor, temporaryScale: 1.5 });
  assert.equal(g.height, 160);
  assert.equal(g.width, 80);
  assert.equal(g.flip, -1);
  assert.equal(g.left, -65);
  assert.equal(g.top, -123);
  const originalFacing = clipGeometry(clip, { ...actor, direction: -1 });
  assert.equal(originalFacing.flip, 1);
  assert.equal(originalFacing.left, -15);
});

test('run falls back to walk, then idle, and failed assets fall back without recursive retry', () => {
  assert.equal(resolveClip(avatar, 'run').state, 'walk');
  assert.equal(resolveClip({ states: { idle } }, 'run').state, 'idle');
  assert.equal(
    resolveClip(avatar, 'run', (id) => id === walk.asset).state,
    'idle',
  );
  assert.equal(
    resolveClip(avatar, 'run', () => true),
    null,
  );
  assert.equal(resolveClip(null, 'run'), null);
});

test('frame ranges loop, play once to idle, or hold their final frame on engine time', () => {
  const clip = { ...idle, startFrame: 2, endFrame: 5 };
  assert.equal(frameAt(clip, actor, 1000).frame, 2);
  assert.equal(frameAt(clip, actor, 1300).frame, 5);
  assert.equal(frameAt(clip, actor, 1400).frame, 2);
  assert.equal(
    frameAt({ ...clip, playback: 'once' }, actor, 1399).returnToIdle,
    false,
  );
  assert.equal(
    frameAt({ ...clip, playback: 'once' }, actor, 1400).returnToIdle,
    true,
  );
  const held = frameAt({ ...clip, playback: 'hold' }, actor, 9000);
  assert.equal(held.frame, 5);
  assert.equal(held.returnToIdle, false);
  assert.equal(held.finished, true);
  const position = framePosition(normalizeClip(clip), 5)
    .split(' ')
    .map(parseFloat);
  assert.ok(Math.abs(position[0] - 100 / 3) < 1e-10);
  assert.equal(position[1], 100);
});

test('movement phase depends on shared distance and stride, not output age or the old fixed rate', () => {
  const moving = {
    ...actor,
    state: 'run',
    travelDistance: 25,
    animationRate: 1.7,
  };
  assert.equal(frameAt(walk, moving, 2000, 50).frame, 4);
  assert.equal(frameAt(walk, moving, 50000, 50).frame, 4);
  assert.equal(frameAt(walk, moving, 50000, 100).frame, 2);
  assert.equal(
    frameAt(walk, { ...moving, travelDistance: 50 }, 50000, 50).frame,
    0,
  );
  assert.equal(
    frameAt({ ...walk, playback: 'once' }, moving, 2000).returnToIdle,
    true,
  );
});

test('native GIF and WebP originals are not treated as controllable sprite playback', () => {
  for (const extension of ['gif', 'webp']) {
    const clip = { asset: asset('a', extension), frames: 1, playback: 'once' };
    assert.equal(frameAt(clip, actor, 99999).returnToIdle, false);
    assert.equal(
      clipGeometry(clip, actor, { naturalWidth: 200, naturalHeight: 100 })
        .width,
      160,
    );
  }
});

test('frame metadata is bounded and malformed ranges cannot select nonexistent cells', () => {
  const clip = normalizeClip({
    columns: 2,
    rows: 2,
    frames: 80,
    startFrame: 9,
    endFrame: -1,
  });
  assert.equal(clip.frames, 4);
  assert.equal(clip.startFrame, 3);
  assert.equal(clip.endFrame, 3);
  assert.equal(frameAt(clip, actor, 100000).frame, 3);
  assert.equal(
    normalizeClip({ asset: 'http://example.com/file.png' }).asset,
    '',
  );
});

test('OBS width scaling and full monitor scene agree at 720p while zoom remains explicit', () => {
  const output = sceneLayout(snapshot(), { width: 1280, height: 720 });
  assert.equal(output.scale, 2 / 3);
  assert.equal(output.bottom, 0);
  const full = sceneLayout(
    snapshot(),
    { width: 960, height: 540 },
    { monitor: true, view: 'full' },
  );
  assert.equal(full.scale, 0.5);
  assert.equal(full.bottom, 0);
  const letterbox = sceneLayout(
    snapshot(),
    { width: 960, height: 270 },
    { monitor: true, view: 'full' },
  );
  assert.equal(letterbox.scale, 0.25);
  assert.equal(letterbox.left, 240);
  const zoom = sceneLayout(
    snapshot(),
    { width: 960, height: 270 },
    { monitor: true, view: 'zoom' },
  );
  assert.equal(zoom.scale, 0.5);
  assert.equal(zoom.safe.top, 540);
  const ignored = sceneLayout(
    snapshot(),
    { width: 960, height: 270 },
    { monitor: false, view: 'full', follow: actor },
  );
  assert.equal(ignored.scale, 0.5);
});

test('ultrawide, bottom strip, safe insets and selected actor follow stay within visible scene bounds', () => {
  const strip = sceneLayout(
    snapshot({ safeLeft: 100, safeRight: 120, safeTop: 40 }),
    { width: 1920, height: 240 },
  );
  assert.equal(strip.safe.left, 100);
  assert.equal(strip.safe.right, 1800);
  assert.equal(strip.safe.top, 840);
  assert.equal(strip.safe.bottom, 1056);
  assert.equal(
    sceneLayout(snapshot(), { width: 2560, height: 1080 }).scale,
    4 / 3,
  );
  const follow = sceneLayout(
    snapshot(),
    { width: 960, height: 270 },
    { monitor: true, view: 'zoom', follow: { x: 960, y: 250 } },
  );
  assert.equal(follow.safe.top, 0);
  assert.equal(follow.safe.bottom, 540);
  const bounds = { left: -150, right: 170, top: -320, bottom: 20 };
  const position = fitActor({ x: 20, y: 150 }, bounds, strip.safe);
  assert.ok(position.scale < 1);
  assert.ok(position.x + bounds.left * position.scale >= strip.safe.left);
  assert.ok(position.y + bounds.top * position.scale >= strip.safe.top - 1e-9);
  assert.ok(
    position.y + bounds.bottom * position.scale <= strip.safe.bottom + 1e-9,
  );
});

test('name and bubble limits prioritize activity deterministically and recent names expire', () => {
  const actors = [
    { id: 'old', number: 1, bubble: 'a' },
    { id: 'new', number: 2, bubble: 'b' },
    { id: 'newer', number: 3, bubble: 'c' },
  ];
  const activity = new Map([
    ['old', 0],
    ['new', 14000],
    ['newer', 18000],
  ]);
  const recent = labelVisibility(
    actors,
    {
      simulationTime: 20000,
      namesMode: 'recent',
      nameLimit: 1,
      bubbleLimit: 2,
    },
    activity,
  );
  assert.deepEqual([...recent.names], ['newer']);
  assert.deepEqual([...recent.bubbles], ['newer', 'new']);
  const all = labelVisibility(actors, { simulationTime: 20000 }, activity);
  assert.equal(all.names.size, 3);
  assert.equal(
    labelVisibility(actors, { showNames: false, bubbleLimit: 0 }, activity)
      .names.size,
    0,
  );
  assert.equal(
    labelVisibility(actors, { showNames: false, bubbleLimit: 0 }, activity)
      .bubbles.size,
    0,
  );
});

test('protocol gate rejects duplicates, backwards revisions/clocks, and retired sessions', () => {
  const gate = createFrameGate();
  assert.equal(gate(snapshot()).reset, true);
  assert.equal(gate(snapshot()).code, 'STALE_FRAME');
  assert.equal(
    gate(snapshot({ sequence: 2, configRevision: 0 })).code,
    'STALE_FRAME',
  );
  assert.equal(
    gate(snapshot({ sequence: 2, simulationTime: 1999 })).code,
    'STALE_FRAME',
  );
  assert.equal(gate(snapshot({ sequence: 2, paused: true })).accepted, true);
  assert.equal(
    gate(snapshot({ sessionId: 'session-b', sequence: 0, simulationTime: 0 }))
      .reset,
    true,
  );
  assert.equal(gate(snapshot({ sequence: 99 })).code, 'STALE_FRAME');
  assert.equal(
    gate(snapshot({ sessionId: 'session-b', sequence: 1, simulationTime: 0 }))
      .reset,
    false,
  );
});

test('gate requires complete bootstrap and valid v3 fields without silently downgrading', () => {
  const gate = createFrameGate();
  assert.equal(
    gate(snapshot({ protocolVersion: 4 })).code,
    'PROTOCOL_MISMATCH',
  );
  assert.equal(gate(snapshot({ rendererVersion: 2 })).code, 'VERSION_MISMATCH');
  assert.equal(
    gate(snapshot({ avatars: undefined })).code,
    'BOOTSTRAP_MISSING',
  );
  assert.equal(gate(snapshot({ sequence: 1.5 })).code, 'INVALID_FRAME');
  assert.equal(
    gate(snapshot({ actors: [{ ...actor, x: NaN }] })).code,
    'INVALID_FRAME',
  );
  assert.equal(
    gate(snapshot({ configRevision: undefined })).code,
    'INVALID_FRAME',
  );
  assert.equal(gate(snapshot()).accepted, true);
  assert.equal(gate({ at: 3000, actors: [], avatars: [] }).code, 'STALE_FRAME');
});

test('unversioned v2 snapshots remain readable until the first v3 session', () => {
  const gate = createFrameGate();
  assert.equal(
    gate({ at: 3000, actors: [actor], avatars: [avatar] }).legacy,
    true,
  );
  assert.equal(gate({ at: 2999, actors: [], avatars: [] }).accepted, false);
  assert.equal(gate({ at: 3000, actors: [], avatars: [] }).accepted, true);
  assert.equal(gate(snapshot()).accepted, true);
});

test('asset failures are memoized until session reset and stale async completions are discarded', async () => {
  let loads = 0;
  const errors = [];
  const cache = createAssetCache(
    async () => {
      loads++;
      throw new Error('private-path-or-key');
    },
    (...error) => errors.push(error),
  );
  await cache.get(idle.asset).promise;
  for (let i = 0; i < 100; i++)
    assert.equal(cache.get(idle.asset).status, 'failed');
  assert.equal(loads, 1);
  assert.equal(errors.length, 1);
  assert.equal(JSON.stringify(errors).includes('private-path-or-key'), false);
  cache.reset();
  await cache.get(idle.asset).promise;
  assert.equal(loads, 2);
  let complete;
  const pendingCache = createAssetCache(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
    () => {},
  );
  const old = pendingCache.get(walk.asset);
  await Promise.resolve();
  pendingCache.reset();
  complete({ naturalWidth: 32 });
  await old.promise;
  assert.equal(old.status, 'loading');
  assert.notEqual(pendingCache.get(walk.asset), old);
});

test('reload budget allows only three attempts at least thirty seconds apart', () => {
  let budget = reloadBudget(null, 1000);
  assert.equal(budget.attempts, 1);
  assert.equal(reloadBudget(budget, 30999), null);
  budget = reloadBudget(budget, 31000);
  assert.equal(budget.attempts, 2);
  budget = reloadBudget(budget, 61000);
  assert.equal(budget.attempts, 3);
  assert.equal(reloadBudget(budget, 100000000), null);
});

// A DOM/socket harness tests the read-only client lifecycle without a browser or server.
function client({
  search = '?key=private-output-key',
  version = '3',
  storage = new Map(),
} = {}) {
  let time = 100000,
    nextId = 1,
    raf,
    reloads = 0;
  const timers = new Map(),
    sockets = [],
    images = [],
    events = [],
    listeners = new Map();
  class Element {
    constructor() {
      this.style = {};
      this.dataset = {};
      this.children = [];
      this.hidden = false;
      this.textContent = '';
      this.className = '';
      this.classList = { toggle() {} };
    }
    append(...children) {
      this.children.push(...children);
      for (const child of children) child.parent = this;
    }
    remove() {
      this.parent.children = this.parent.children.filter(
        (child) => child !== this,
      );
    }
    get offsetWidth() {
      return this.hidden
        ? 0
        : Math.min(
            parseFloat(this.style.maxWidth) || 240,
            this.textContent.length * 10 + 24,
          );
    }
    get offsetHeight() {
      return this.hidden ? 0 : 30;
    }
  }
  const elements = Object.fromEntries(
    [
      'stage',
      'game',
      'safe-guide',
      'connection-status',
      'overlay-diagnostics',
    ].map((id) => [id, new Element()]),
  );
  elements.stage.append(elements.game, elements['safe-guide']);
  const html = new Element();
  html.dataset.overlayVersion = version;
  const document = {
    documentElement: html,
    getElementById: (id) => elements[id],
    createElement: () => new Element(),
    dispatchEvent: (event) => events.push(event),
  };
  class Socket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      sockets.push(this);
    }
    open() {
      this.readyState = 1;
      this.onopen?.();
    }
    message(data) {
      this.onmessage?.({ data: JSON.stringify(data) });
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
    send() {
      assert.fail('The overlay must never send engine commands');
    }
  }
  class Image {
    set src(value) {
      images.push(value);
      this.naturalWidth = 400;
      this.naturalHeight = 100;
      queueMicrotask(() => this.onload?.());
    }
  }
  const context = {
    document,
    location: {
      search,
      pathname: '/overlay',
      origin: 'http://127.0.0.1:17841',
      reload: () => reloads++,
    },
    URLSearchParams,
    WebSocket: Socket,
    Image,
    performance: { now: () => time },
    Date: { now: () => time },
    innerWidth: 960,
    innerHeight: 540,
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    setTimeout(fn, delay) {
      const id = nextId++;
      timers.set(id, { fn, at: time + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(fn, delay) {
      const id = nextId++;
      timers.set(id, { fn, at: time + delay, interval: delay });
      return id;
    },
    requestAnimationFrame(fn) {
      raf = fn;
    },
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return {
    elements,
    html,
    sockets,
    images,
    events,
    storage,
    get reloads() {
      return reloads;
    },
    render() {
      raf?.(time);
    },
    async ready(data = snapshot()) {
      sockets.at(-1).open();
      sockets.at(-1).message(data);
      this.render();
      await new Promise(setImmediate);
      this.render();
    },
    advance(ms) {
      const end = time + ms;
      while (true) {
        const next = [...timers]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        time = timer.at;
        if (timer.interval) timer.at += timer.interval;
        else timers.delete(id);
        timer.fn();
      }
      time = end;
    },
    actor() {
      return elements.stage.children.find((node) =>
        node.className.startsWith('actor'),
      );
    },
  };
}

test('client draws run-to-walk fallback with frame aspect, ignores stale frames, and resets on a new session', async () => {
  const app = client();
  await app.ready(
    snapshot({
      actors: [
        { ...actor, state: 'run', travelDistance: 25, temporaryScale: 1.5 },
      ],
    }),
  );
  const root = app.actor();
  assert.equal(root.dataset.clipState, 'walk');
  assert.equal(root.children[0].style.width, '160px');
  assert.equal(root.children[0].style.height, '80px');
  assert.equal(root.children[0].children[0].style.transform, '');
  app.sockets[0].message(snapshot({ actors: [{ ...actor, name: 'Stale' }] }));
  assert.equal(root.children[1].textContent, 'Viewer');
  app.sockets[0].message(
    snapshot({ sessionId: 'new-session', actors: [{ ...actor, x: 400 }] }),
  );
  app.render();
  await new Promise(setImmediate);
  app.render();
  assert.notEqual(app.actor(), root);
  assert.match(app.actor().style.transform, /translate\(400px,/);
  assert.equal(app.elements['safe-guide'].hidden, true);
  assert.equal(app.elements['connection-status'].hidden, true);
});

test('client honors output hiding, recent names, limits, and authoritative game phase time', async () => {
  const app = client({
    search: '?key=private-output-key&monitor=1&view=full&rehearsal=1',
  });
  assert.match(app.sockets[0].url, /rehearsal=1/);
  await app.ready(
    snapshot({
      namesMode: 'recent',
      nameLimit: 1,
      nameSize: 24,
      bubbleLimit: 0,
      simulationTime: 20000,
      actors: [{ ...actor, bubble: 'Hello' }],
      game: {
        type: 'race',
        phase: 'recruit',
        phaseEndsAt: 23000,
        endsAt: 53000,
      },
    }),
  );
  assert.equal(app.actor().children[1].hidden, true);
  assert.equal(app.actor().children[1].style.fontSize, '24px');
  assert.equal(app.actor().children[2].hidden, true);
  assert.match(app.elements.game.textContent, /3초$/);
  assert.equal(app.elements['safe-guide'].hidden, false);
  assert.equal(app.elements.stage.style.transform, 'scale(0.5)');
  app.sockets[0].message(
    snapshot({ sequence: 2, simulationTime: 21000, outputHidden: true }),
  );
  assert.equal(app.elements.stage.hidden, true);
});

test('once playback returns to idle without reapplying the synthetic pose', async () => {
  const app = client();
  await app.ready(
    snapshot({
      avatars: [
        { ...avatar, states: { idle, dance: { ...walk, playback: 'once' } } },
      ],
      actors: [{ ...actor, state: 'dance' }],
    }),
  );
  assert.equal(app.actor().dataset.clipState, 'idle');
  assert.equal(app.actor().children[0].children[0].style.transform, '');
});

test('sprite pause is frozen while native animation limitations use sanitized DOM-only diagnostics', async () => {
  const app = client();
  await app.ready(snapshot({ paused: true }));
  const sprite = app.actor().children[0].children[0];
  const position = sprite.style.backgroundPosition;
  app.advance(5000);
  app.render();
  assert.equal(sprite.style.backgroundPosition, position);
  app.sockets[0].message(
    snapshot({
      sequence: 2,
      paused: true,
      avatars: [{ ...avatar, states: { idle: { asset: asset('c', 'gif') } } }],
    }),
  );
  app.render();
  await new Promise(setImmediate);
  app.render();
  assert.equal(app.actor().dataset.nativeAnimation, 'true');
  assert.ok(
    app.events.some(
      (event) => event.detail.code === 'NATIVE_ANIMATION_UNCONTROLLED',
    ),
  );
  assert.equal(
    app.elements['overlay-diagnostics'].textContent.includes(
      'private-output-key',
    ),
    false,
  );
  assert.equal(
    app.elements['overlay-diagnostics'].textContent.includes('/assets/'),
    false,
  );
});

test('old sockets cannot update after reconnect and reconnect attempts continue indefinitely', async () => {
  const app = client();
  await app.ready();
  const old = app.sockets[0];
  old.close();
  app.advance(1400);
  const current = app.sockets.at(-1);
  assert.notEqual(current, old);
  current.open();
  current.message(snapshot({ sequence: 2 }));
  old.message(
    snapshot({ sequence: 100, actors: [{ ...actor, name: 'Old socket' }] }),
  );
  assert.equal(app.actor().children[1].textContent, 'Viewer');
  current.close();
  app.advance(240000);
  assert.ok(app.sockets.length > 8);
  assert.equal(app.reloads, 0);
});

test('missing DOM bootstrap reloads are bounded across page loads', () => {
  const storage = new Map();
  for (let attempt = 0; attempt < 4; attempt++) {
    const app = client({ version: '2', storage });
    if (attempt > 0) {
      for (const [key, value] of storage) {
        const previous = JSON.parse(value);
        previous.at -= 30000;
        storage.set(key, JSON.stringify(previous));
      }
    }
    app.advance(30000);
    assert.equal(app.reloads, attempt < 3 ? 1 : 0);
    assert.equal(app.sockets.length, 0);
  }
});

test('version mismatch schedules recovery but valid bootstrap cancels an unnecessary reload', async () => {
  const app = client();
  app.sockets[0].open();
  app.sockets[0].message(snapshot({ protocolVersion: 4 }));
  assert.equal(app.html.dataset.connection, 'mismatch');
  await app.ready();
  for (let sequence = 2; sequence <= 8; sequence++) {
    app.advance(5000);
    app.sockets[0].message(snapshot({ sequence }));
  }
  assert.equal(app.reloads, 0);
  assert.equal(app.html.dataset.connection, 'connected');
});
