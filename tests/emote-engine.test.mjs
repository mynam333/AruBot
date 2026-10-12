import test from 'node:test';
import assert from 'node:assert/strict';
import { EMOTE_ANIMATIONS, EMOTE_ORIGINS, normalizeEmoteSettings } from '../shared/emote-overlay.js';
import {
  createEmoteEngine, createSeededRandom, createParticleSpec, getEmoteArea, getLaunchState,
  sampleFloatMotion, sampleStickerTransition, createFragmentLayout, sampleFragmentMotion,
  advanceFixedStep, FIXED_STEP_MS, MAX_CATCHUP_STEPS, MAX_FRAGMENT_BUDGET, MAX_TRAIL_BUDGET,
  getParticleLifetime, sampleParticleAlpha,
} from '../src/features/emote-overlay/emote-engine.js';

function config(patch = {}) {
  const defaults = normalizeEmoteSettings({ enabled: true, variation: 0 });
  const next = { ...defaults, ...patch };
  for (const key of ['area', 'float', 'rain', 'sticker', 'launch', 'providers']) next[key] = { ...defaults[key], ...patch[key] };
  return normalizeEmoteSettings(next);
}

const item = { url: '/files/logo.png', provider: 'chzzk', name: 'sample' };
const batch = (count) => Array.from({ length: count }, () => ({ ...item }));

function browser(input = {}, { resizeObserver = true, onCount } = {}) {
  let now = 0;
  let nextId = 0;
  let bounds = { width: 1920, height: 1080 };
  const callbacks = new Map();
  const listeners = new Map();
  const windowListeners = new Map();
  const observers = [];
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.style = {}; this.dataset = {}; this.attributes = {};
      this.children = []; this.ownerDocument = document; this.parentNode = null;
      this.complete = false; this.naturalWidth = 0;
    }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    setAttribute(key, value) { this.attributes[key] = value; }
    remove() {
      if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
      this.parentNode = null;
    }
    getBoundingClientRect() { return { ...bounds }; }
    set src(value) { this.source = value; this.complete = true; this.naturalWidth = 84; }
    get src() { return this.source; }
  }
  const view = {
    performance: { now: () => now },
    requestAnimationFrame(callback) { callbacks.set(++nextId, callback); return nextId; },
    cancelAnimationFrame(id) { callbacks.delete(id); },
    addEventListener(type, fn) { windowListeners.set(type, fn); },
    removeEventListener(type) { windowListeners.delete(type); },
    ...(resizeObserver ? { ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    } } : {}),
  };
  const document = {
    defaultView: view, hidden: false,
    createElement: (tag) => new Element(tag),
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); },
  };
  const container = new Element('div');
  const counts = [];
  const engine = createEmoteEngine(container, config(input), { onCount: onCount || ((value) => counts.push(value)) });
  const walk = (node = container) => [node, ...node.children.flatMap((child) => walk(child))];
  return {
    engine, container, document, observers, callbacks, listeners, windowListeners, counts, walk,
    step(ms = FIXED_STEP_MS) {
      now += ms;
      const pending = [...callbacks.values()]; callbacks.clear();
      for (const callback of pending) callback(now);
    },
    advance(ms, fps = 60) {
      const count = Math.round(ms / (1000 / fps));
      for (let i = 0; i < count; i++) this.step(ms / count);
    },
    resize(width, height) {
      bounds = { width, height };
      if (resizeObserver) for (const observer of observers) observer.callback();
      else windowListeners.get('resize')?.();
    },
    visibility(hidden) { document.hidden = hidden; listeners.get('visibilitychange')?.(); },
  };
}

test('seeded specifications are reproducible, bounded and vary once per particle', () => {
  const a = createSeededRandom(42);
  const b = createSeededRandom(42);
  assert.deepEqual(Array.from({ length: 10 }, a), Array.from({ length: 10 }, b));
  const settings = config({ variation: 0.18, mode: 'random' });
  assert.deepEqual(createParticleSpec(settings, 42), createParticleSpec(settings, 42));
  const specs = Array.from({ length: 100 }, (_, i) => createParticleSpec(settings, i));
  assert.equal(new Set(specs.map((spec) => spec.mode)).size, 4);
  assert.ok(new Set(specs.map((spec) => spec.restitution)).size > 80);
  for (const spec of specs) {
    assert.ok(spec.size >= settings.size * 0.82 && spec.size <= settings.size * 1.18);
    assert.ok(spec.duration >= settings.duration * 820 && spec.duration <= settings.duration * 1180);
    assert.ok(spec.restitution > 0 && spec.restitution < 1);
    assert.ok(spec.enterMs + spec.exitMs <= spec.duration * 0.9 + 1e-8);
    assert.ok(spec.opacity > 0 && spec.opacity <= 1);
  }
});

test('fixed step has a hard catch-up ceiling and fractional remainder', () => {
  assert.deepEqual(advanceFixedStep(0, FIXED_STEP_MS / 2), { steps: 0, accumulator: FIXED_STEP_MS / 2 });
  const next = advanceFixedStep(FIXED_STEP_MS / 2, 10000);
  assert.equal(next.steps, MAX_CATCHUP_STEPS);
  assert.ok(next.accumulator < FIXED_STEP_MS);
  assert.equal(advanceFixedStep(0, NaN).steps, 0);
});

test('float travels all four directions with smooth deterministic sway', () => {
  const area = getEmoteArea(config(), 1920);
  for (const direction of ['leftToRight', 'rightToLeft', 'bottomToTop', 'topToBottom']) {
    const spec = createParticleSpec(config({ float: { direction } }), 7);
    const start = sampleFloatMotion(spec, 0, area);
    const end = sampleFloatMotion(spec, spec.duration, area);
    if (direction === 'leftToRight') assert.ok(start.x < 0 && end.x > area.width);
    if (direction === 'rightToLeft') assert.ok(start.x > area.width && end.x < 0);
    if (direction === 'bottomToTop') assert.ok(start.y > area.height && end.y < 0);
    if (direction === 'topToBottom') assert.ok(start.y < 0 && end.y > area.height);
    const a = sampleFloatMotion(spec, 1500, area);
    const b = sampleFloatMotion(spec, 1501, area);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1);
    assert.deepEqual(a, sampleFloatMotion(spec, 1500, area));
  }
});

test('fast float fades before reaching its exit and is removed immediately after crossing', () => {
  const spec = createParticleSpec(config({ speed: 3, duration: 9 }), 1);
  assert.equal(getParticleLifetime(spec), 3000);
  assert.ok(sampleParticleAlpha(spec, 2500) > sampleParticleAlpha(spec, 2900));
  assert.equal(sampleParticleAlpha(spec, 3000), 0);
  const w = browser({ speed: 3, duration: 9 });
  w.engine.emit([item], { seed: 1 });
  w.advance(3100);
  assert.equal(w.engine.stats().active, 0);
  assert.equal(w.callbacks.size, 0);
  w.engine.destroy();
});

test('slow float still respects the explicit duration', () => {
  const spec = createParticleSpec(config({ speed: 0.2, duration: 2 }), 1);
  assert.equal(getParticleLifetime(spec), 2000);
  assert.equal(sampleParticleAlpha(spec, 2000), 0);
});

test('launch origins, custom coordinates, angle and power produce finite physical vectors', () => {
  const area = { x: 100, y: 200, width: 1000, height: 600 };
  for (const origin of EMOTE_ORIGINS) {
    const spec = createParticleSpec(config({ mode: 'launch', launch: { origin, x: 25, y: 75 } }), 4);
    const state = getLaunchState(spec, area);
    assert.ok(Object.values(state).every(Number.isFinite));
    assert.ok(state.x >= area.x && state.x <= area.x + area.width);
    assert.ok(state.y >= area.y && state.y <= area.y + area.height);
    if (origin.startsWith('bottom')) assert.ok(state.vy < 0);
    if (origin.startsWith('top')) assert.ok(state.vy > 0);
    if (origin === 'custom') assert.deepEqual([state.x, state.y], [350, 650]);
  }
  const slow = getLaunchState(createParticleSpec(config({ launch: { power: 10 } }), 1), area);
  const fast = getLaunchState(createParticleSpec(config({ launch: { power: 20 } }), 1), area);
  assert.equal(fast.vx, slow.vx * 2);
  assert.equal(fast.vy, slow.vy * 2);
});

test('all eleven entrance and exit styles are distinct, finite and converge to the unmodified image', () => {
  for (const enter of [true, false]) {
    const styles = EMOTE_ANIMATIONS.map((type) => sampleStickerTransition(type, 0.42, { enter, direction: 'left', size: 84, seed: 7 }));
    assert.equal(new Set(styles.map((style) => JSON.stringify(style))).size, 11);
    for (let i = 0; i < styles.length; i++) {
      assert.ok(Object.entries(styles[i]).every(([key, value]) => key === 'clip' || Number.isFinite(value)));
      const rest = sampleStickerTransition(EMOTE_ANIMATIONS[i], enter ? 1 : 0, { enter });
      assert.deepEqual(rest, { x: 0, y: 0, scaleX: 1, scaleY: 1, angle: 0, opacity: 1, blur: 0, clip: 'none' });
      assert.equal(sampleStickerTransition(EMOTE_ANIMATIONS[i], enter ? 0 : 1, { enter }).opacity, 0);
    }
  }
});

test('fragment grids cover the entire source without missing or overlapping rectangles', () => {
  for (let count = 4; count <= 25; count++) {
    const tiles = createFragmentLayout(count, 42);
    assert.equal(tiles.length, count);
    assert.ok(Math.abs(tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0) - 1) < 1e-10);
    for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
      const a = tiles[i]; const b = tiles[j];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      assert.ok(overlapX < 1e-9 || overlapY < 1e-9);
    }
  }
});

test('dissolve, dust and explosion move actual tiles differently in both transitions', () => {
  const tile = createFragmentLayout(16, 12)[2];
  for (const enter of [true, false]) {
    const motions = ['dissolve', 'dust', 'explode'].map((type) => sampleFragmentMotion(tile, type, 0.5, { enter, direction: 'up', size: 84 }));
    assert.equal(new Set(motions.map((motion) => JSON.stringify(motion))).size, 3);
    assert.equal(motions[0].x, 0);
    assert.equal(motions[0].y, 0);
    assert.ok(Math.abs(motions[1].x) + Math.abs(motions[1].y) > 0);
    for (const type of ['dissolve', 'dust', 'explode']) {
      const visible = sampleFragmentMotion(tile, type, enter ? 1 : 0, { enter });
      assert.deepEqual(visible, { x: 0, y: 0, angle: 0, scale: 1, opacity: 1 });
      assert.equal(sampleFragmentMotion(tile, type, enter ? 0 : 1, { enter }).opacity, 0);
    }
  }
});

test('idle engine does not allocate RAF; all effects expire and release every resource', () => {
  for (const mode of ['float', 'rain', 'sticker', 'launch', 'random']) {
    const w = browser({ mode, duration: 2, sticker: { enter: 'explode', exit: 'dust' } });
    assert.equal(w.callbacks.size, 0);
    assert.equal(w.engine.emit(batch(8), { seed: 13 }), 8);
    assert.equal(w.callbacks.size, 1);
    w.advance(2200);
    const stats = w.engine.stats();
    assert.equal(stats.active, 0, mode);
    assert.equal(stats.fragments, 0, mode);
    assert.equal(stats.trails, 0, mode);
    assert.equal(stats.bodies, 0, mode);
    assert.equal(stats.worlds, 0, mode);
    assert.equal(w.callbacks.size, 0, mode);
    w.engine.destroy();
    assert.equal(w.container.children.length, 0);
    assert.ok(w.observers.every((observer) => observer.disconnected));
    assert.equal(w.listeners.size, 0);
  }
});

test('DOM keeps source image animation, blocks pointer events and clips all descendants to the area', () => {
  for (const mode of ['float', 'sticker', 'launch', 'rain']) {
    const w = browser({ mode, area: { x: 10, y: 20, width: 60, height: 50 }, sticker: { enter: 'dust', exit: 'explode' } });
    const url = 'https://cdn.example.com/emote.gif';
    w.engine.emit([{ ...item, url }]);
    const elements = w.walk().slice(1);
    assert.ok(elements.every((el) => el.style.pointerEvents === 'none'));
    const images = elements.filter((el) => el.tagName === 'IMG');
    assert.ok(images.length > 0);
    assert.ok(images.every((img) => img.src === url && img.referrerPolicy === 'no-referrer' && img.draggable === false));
    const group = w.container.children[0].children[0].children[0];
    assert.equal(group.style.clipPath, 'inset(20% 30% 30% 10%)');
    assert.equal(group.parentNode.style.height, '1080px');
    w.engine.destroy();
  }
});

test('pause stops RAF and resume neither jumps nor consumes the paused lifetime', () => {
  const w = browser({ mode: 'launch', duration: 10, launch: { power: 25 } });
  w.engine.emit([item], { seed: 1 });
  w.advance(500);
  const before = w.engine.stats();
  w.engine.pause(true);
  w.step(60000);
  assert.deepEqual(w.engine.stats().particles, before.particles);
  assert.equal(w.callbacks.size, 0);
  w.engine.pause(false);
  w.step();
  const after = w.engine.stats();
  assert.ok(after.particles[0].ageMs - before.particles[0].ageMs < 17);
  assert.ok(Math.abs(after.particles[0].y - before.particles[0].y) < 30);
  w.engine.destroy();
});

test('real physics matches at 30, 60 and 120 Hz without frame-rate acceleration', () => {
  const results = [30, 60, 120].map((fps) => {
    const w = browser({ mode: 'launch', duration: 10, launch: { power: 30, gravity: 0.5, spin: 0 } });
    w.engine.emit([item], { seed: 5 });
    w.advance(1000, fps);
    const result = w.engine.stats();
    w.engine.destroy();
    return result;
  });
  for (const stats of results) assert.equal(stats.physicsSteps, 60);
  for (const result of results.slice(1)) {
    assert.ok(Math.abs(result.particles[0].x - results[0].particles[0].x) < 1e-7);
    assert.ok(Math.abs(result.particles[0].y - results[0].particles[0].y) < 1e-7);
  }
});

test('higher launch velocity increases real reach and gravity pulls the projectile down', () => {
  const sample = (power, gravity) => {
    const w = browser({ mode: 'launch', duration: 10, launch: { power, gravity, spin: 0 } });
    w.engine.emit([item], { seed: 8 });
    w.advance(500);
    const particle = w.engine.stats().particles[0];
    w.engine.destroy();
    return particle;
  };
  const low = sample(12, 1);
  const high = sample(24, 1);
  const heavy = sample(24, 2);
  assert.ok(high.y < low.y);
  assert.ok(high.x > low.x);
  assert.ok(heavy.y > high.y);
  assert.ok(heavy.vy > high.vy);
});

test('rain actually bounces, then releases collisions before lifetime end', () => {
  const w = browser({ mode: 'rain', duration: 9, rain: { restitutionMin: 0.8, restitutionMax: 0.8, releaseAfter: 0.65, drift: 0 } });
  w.engine.emit([item], { seed: 1 });
  let lastVy = 0;
  let bounced = false;
  for (let i = 0; i < 330; i++) {
    w.step();
    const p = w.engine.stats().particles[0];
    if (lastVy > 1 && p.vy < -1) bounced = true;
    lastVy = p.vy;
    assert.ok(Number.isFinite(p.x + p.y));
  }
  assert.ok(bounced);
  assert.equal(w.engine.stats().particles[0].collisionMask, 3);
  w.advance(700);
  assert.equal(w.engine.stats().particles[0].collisionMask, 0);
  w.advance(1500);
  assert.ok(w.engine.stats().particles[0].y > 1080);
  w.engine.destroy();
});

test('rain collision toggle retains wall collisions without emote-emote collisions', () => {
  const w = browser({ mode: 'rain', rain: { collisions: false } });
  w.engine.emit(batch(2));
  assert.ok(w.engine.stats().particles.every((p) => p.collisionMask === 1));
  w.engine.destroy();
});

test('burst caps, maxActive changes and rate windows stay bounded', () => {
  const w = browser({ mode: 'sticker', maxActive: 5, maxPerMessage: 8, perSecond: 10 });
  assert.equal(w.engine.emit(batch(16)), 8);
  assert.equal(w.engine.stats().active, 5);
  assert.equal(w.engine.stats().dropped, 3);
  assert.equal(w.engine.emit(batch(16)), 2);
  assert.equal(w.engine.emit(batch(1)), 0);
  w.advance(1100);
  assert.equal(w.engine.emit(batch(16)), 8);
  assert.equal(w.engine.stats().active, 5);
  w.engine.setSettings(config({ mode: 'rain', maxActive: 10, perSecond: 60 }));
  w.engine.emit(batch(8));
  assert.equal(w.engine.stats().active, 10);
  assert.ok(w.engine.stats().particles.some((p) => p.mode === 'rain'));
  w.engine.setSettings(config({ maxActive: 5 }));
  assert.equal(w.engine.stats().active, 5);
  w.engine.destroy();
});

test('shared fragment and trail budgets never grow with unlimited bursts', () => {
  for (const mode of ['sticker', 'launch']) {
    const w = browser({ mode, duration: 30, maxActive: 120, perSecond: 60, maxPerMessage: 16,
      sticker: { enter: 'dissolve', exit: 'explode', fragments: 25 }, launch: { trail: 6, power: 40, gravity: 0.1 } });
    w.engine.pause(true);
    for (let i = 0; i < 30; i++) {
      w.engine.emit(batch(16), { seed: i });
      w.step(300);
      const stats = w.engine.stats();
      assert.ok(stats.fragments <= MAX_FRAGMENT_BUDGET);
      assert.ok(stats.trails <= MAX_TRAIL_BUDGET);
      assert.ok(stats.active <= 120);
    }
    assert.ok(mode === 'sticker' ? w.engine.stats().fragments > 0 : w.engine.stats().trails > 0);
    w.engine.clear();
    assert.equal(w.engine.stats().fragments, 0);
    assert.equal(w.engine.stats().trails, 0);
    assert.equal(w.engine.stats().worlds, 0);
    w.engine.destroy();
  }
});

test('resize scales the logical stage, preserves physics and works while paused', () => {
  const w = browser({ mode: 'rain', duration: 20 });
  w.engine.emit([item], { seed: 11 });
  w.advance(500);
  w.engine.pause(true);
  const before = w.engine.stats().particles[0];
  w.resize(960, 1080);
  const after = w.engine.stats().particles[0];
  assert.ok(Math.abs(after.x - before.x * 0.5) < 1e-7);
  assert.equal(after.y, before.y);
  assert.equal(w.engine.stats().logicalWidth, 960);
  assert.equal(w.callbacks.size, 0);
  w.resize(480, 540);
  assert.equal(w.container.children[0].children[0].style.transform, 'scale(0.5)');
  w.resize(0, 0);
  assert.equal(w.callbacks.size, 0);
  w.resize(1920, 1080);
  w.engine.pause(false);
  w.advance(500);
  assert.ok(w.engine.stats().particles.every((p) => Number.isFinite(p.x + p.y)));
  w.engine.destroy();
});

test('window resize fallback is removed at teardown', () => {
  const w = browser({}, { resizeObserver: false });
  assert.equal(w.windowListeners.size, 1);
  w.resize(800, 600);
  assert.equal(w.engine.stats().logicalWidth, 1440);
  w.engine.destroy();
  assert.equal(w.windowListeners.size, 0);
});

test('image failures remove physics, fragments and trails and do not retain handlers', () => {
  for (const mode of ['sticker', 'launch', 'rain']) {
    const w = browser({ mode, sticker: { enter: 'dust' } });
    w.engine.emit([item]);
    const img = w.walk().find((el) => el.tagName === 'IMG' && el.onerror);
    img.onerror();
    assert.equal(w.engine.stats().active, 0);
    assert.equal(w.engine.stats().fragments, 0);
    assert.equal(w.engine.stats().trails, 0);
    assert.equal(w.engine.stats().worlds, 0);
    assert.equal(w.callbacks.size, 0);
    assert.equal(img.onerror, null);
    w.engine.destroy();
  }
});

test('hidden documents clear ephemeral chat effects and do not accumulate emissions', () => {
  const w = browser({ mode: 'rain' });
  w.engine.emit(batch(4));
  w.visibility(true);
  assert.equal(w.engine.stats().active, 0);
  assert.equal(w.engine.emit([item]), 0);
  assert.equal(w.callbacks.size, 0);
  w.visibility(false);
  assert.equal(w.engine.emit([item]), 1);
  assert.equal(w.callbacks.size, 1);
  w.engine.destroy();
});

test('long unpaused stalls expire images instead of replaying stale history or unbounded catch-up', () => {
  const w = browser({ mode: 'rain', duration: 30 });
  w.engine.emit([item]);
  w.step(10000);
  assert.ok(w.engine.stats().physicsSteps <= MAX_CATCHUP_STEPS);
  w.step(30000);
  assert.equal(w.engine.stats().active, 0);
  assert.equal(w.callbacks.size, 0);
  w.engine.destroy();
});

test('image URL contract supports local logo and blobs, rejecting executable or insecure schemes', () => {
  const w = browser({ maxPerMessage: 16, perSecond: 60 });
  for (const url of ['/files/logo.png', 'blob:http://localhost/id', 'https://cdn.example.com/emote.webp']) {
    assert.equal(w.engine.emit([{ url }]), 1);
  }
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'http://example.com/test.png', '//example.com/test.png', '', null]) {
    assert.equal(w.engine.emit([{ url }]), 0);
  }
  w.engine.destroy();
});

test('callbacks cannot prevent cleanup; destroy and clear are idempotent', () => {
  const w = browser({ mode: 'sticker' }, { onCount: () => { throw new Error('Consumer callback'); } });
  w.engine.emit([item]);
  w.engine.destroy();
  w.engine.destroy();
  w.engine.clear();
  w.engine.pause(false);
  w.engine.setSettings(config());
  assert.equal(w.engine.emit([item]), 0);
  assert.equal(w.callbacks.size, 0);
  assert.equal(w.container.children.length, 0);
});
