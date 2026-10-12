import Matter from 'matter-js';
import { normalizeEmoteSettings } from '../../../shared/emote-overlay.js';

const { Engine, Bodies, Body, Composite } = Matter;
export const FIXED_STEP_MS = 1000 / 60;
export const MAX_CATCHUP_STEPS = 5;
export const MAX_FRAGMENT_BUDGET = 240;
export const MAX_TRAIL_BUDGET = 120;
const LOGICAL_HEIGHT = 1080;
const TAU = Math.PI * 2;
const TILE_EFFECTS = new Set(['dissolve', 'dust', 'explode']);
const clamp = (n, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { const p = clamp(t); return p * p * (3 - 2 * p); };
const directionVector = (direction) => ({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction] || [0, 0]);

export function createSeededRandom(seed = 1) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = Math.imul(state ^ (state >>> 15), state | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

export function getEmoteArea(settings, width, height = LOGICAL_HEIGHT) {
  return { x: width * settings.area.x / 100, y: height * settings.area.y / 100,
    width: width * settings.area.width / 100, height: height * settings.area.height / 100 };
}

export function createParticleSpec(input, seed = 1) {
  const settings = normalizeEmoteSettings(input);
  const random = createSeededRandom(seed);
  const vary = (value) => value * (1 + (random() * 2 - 1) * settings.variation);
  const choose = (values) => values[Math.floor(random() * values.length)];
  const mode = settings.mode === 'random' ? choose(['float', 'rain', 'sticker', 'launch']) : settings.mode;
  const duration = vary(settings.duration) * 1000;
  const speed = vary(settings.speed);
  let enterMs = vary(settings.sticker.enterMs) / speed;
  let exitMs = vary(settings.sticker.exitMs) / speed;
  const transitionScale = Math.min(1, duration * 0.9 / (enterMs + exitMs));
  enterMs *= transitionScale;
  exitMs *= transitionScale;
  return {
    seed: Number(seed) >>> 0, settings, mode, duration, speed,
    size: vary(settings.size), opacity: clamp(vary(settings.opacity)),
    fadeMs: Math.min(duration * 0.45, vary(settings.fadeMs)),
    u: random(), v: random(), phase: random() * TAU,
    floatDirection: settings.float.direction === 'random'
      ? choose(['leftToRight', 'rightToLeft', 'bottomToTop', 'topToBottom']) : settings.float.direction,
    sway: vary(settings.float.sway), swaySpeed: vary(settings.float.swaySpeed), floatSpin: vary(settings.float.spin),
    gravity: vary(mode === 'launch' ? settings.launch.gravity : settings.rain.gravity),
    restitution: clamp(vary(lerp(settings.rain.restitutionMin, settings.rain.restitutionMax, random())), 0.01, 0.99),
    friction: vary(settings.rain.friction), drift: (random() * 2 - 1) * vary(settings.rain.drift),
    releaseAfter: clamp(vary(settings.rain.releaseAfter), 0.1, 0.98),
    enterMs, exitMs, stickerRotation: (random() * 2 - 1) * settings.sticker.rotation,
    direction: settings.sticker.direction === 'random' ? choose(['up', 'down', 'left', 'right', 'center']) : settings.sticker.direction,
    fragments: Math.round(clamp(vary(settings.sticker.fragments), 4, 25)),
    origin: settings.launch.origin === 'random'
      ? choose(['bottomLeft', 'bottom', 'bottomRight', 'left', 'right', 'topLeft', 'top', 'topRight']) : settings.launch.origin,
    launchAngle: vary(settings.launch.angle) + (random() - 0.5) * settings.launch.spread,
    power: vary(settings.launch.power), launchSpin: vary(settings.launch.spin),
    trail: Math.round(clamp(vary(settings.launch.trail), 0, 6)),
  };
}

export function sampleFloatMotion(spec, ageMs, area) {
  const seconds = Math.max(0, ageMs) / 1000;
  const progress = Math.max(0, ageMs) / spec.duration * spec.speed;
  const vertical = spec.floatDirection === 'bottomToTop' || spec.floatDirection === 'topToBottom';
  const reverse = spec.floatDirection === 'rightToLeft' || spec.floatDirection === 'bottomToTop';
  const length = vertical ? area.height : area.width;
  const cross = vertical ? area.width : area.height;
  const amplitude = Math.min(spec.sway, Math.max(0, (cross - spec.size) / 4));
  const margin = Math.min(cross / 2, spec.size / 2 + amplitude);
  const center = lerp(margin, cross - margin, spec.v);
  const along = lerp(-spec.size, length + spec.size, reverse ? 1 - progress : progress);
  const wave = Math.sin(seconds * spec.swaySpeed + spec.phase) * amplitude;
  return { x: area.x + (vertical ? center + wave : along), y: area.y + (vertical ? along : center + wave),
    angle: (spec.floatSpin * seconds + Math.sin(seconds * spec.swaySpeed * 0.55 + spec.phase) * 8) * Math.PI / 180 };
}

export function getParticleLifetime(spec) {
  return spec.mode === 'float' ? Math.min(spec.duration, spec.duration / spec.speed) : spec.duration;
}

export function sampleParticleAlpha(spec, ageMs) {
  const lifetime = getParticleLifetime(spec);
  const fadeMs = Math.min(spec.fadeMs, lifetime * 0.45);
  return spec.opacity * smooth(Math.min(ageMs / fadeMs, (lifetime - ageMs) / fadeMs));
}

export function getLaunchState(spec, area) {
  const radius = Math.min(spec.size / 2, area.width / 2, area.height / 2);
  const left = area.x + radius;
  const right = area.x + area.width - radius;
  const top = area.y + radius;
  const bottom = area.y + area.height - radius;
  const cx = area.x + area.width / 2;
  const cy = area.y + area.height / 2;
  const origins = {
    bottomLeft: [left, bottom, 0], bottom: [cx, bottom, 1], bottomRight: [right, bottom, 2],
    left: [left, cy, 0], right: [right, cy, 2], topLeft: [left, top, 3], top: [cx, top, 4], topRight: [right, top, 5],
    custom: [lerp(area.x, area.x + area.width, spec.settings.launch.x / 100),
      lerp(area.y, area.y + area.height, spec.settings.launch.y / 100), 0],
  };
  const [x, y, orientation] = origins[spec.origin] || origins.bottomLeft;
  let angle = spec.launchAngle * Math.PI / 180;
  // Angle is elevation from the inward horizontal; center anchors rotate that fan upright.
  if (orientation === 1 || orientation === 4) angle += Math.PI / 6;
  let vx = Math.cos(angle) * spec.power * spec.speed;
  let vy = -Math.sin(angle) * spec.power * spec.speed;
  if (orientation === 2 || orientation === 5) vx *= -1;
  if (orientation >= 3) vy *= -1;
  return { x, y, vx, vy, angularVelocity: spec.launchSpin * spec.speed * Math.PI / 180 / 60 };
}

function bounceOut(t) {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

export function sampleStickerTransition(type, progress, { enter = true, direction = 'center', size = 84, seed = 1 } = {}) {
  const p = clamp(progress);
  const visible = enter ? p : 1 - p;
  const hidden = 1 - smooth(visible);
  const [dx, dy] = directionVector(direction);
  const result = { x: dx * size * 0.08 * hidden, y: dy * size * 0.08 * hidden,
    scaleX: 1, scaleY: 1, angle: 0, opacity: smooth(visible), blur: 0, clip: 'none' };
  if (type === 'pop') {
    const back = 1 + 2.70158 * (visible - 1) ** 3 + 1.70158 * (visible - 1) ** 2;
    result.scaleX = result.scaleY = Math.max(0.15, enter ? 0.2 + 0.8 * back : 0.2 + 0.8 * smooth(visible));
  } else if (type === 'bounce') {
    result.scaleX = result.scaleY = 0.35 + 0.65 * bounceOut(visible);
    result.x = dx * size * (1 - bounceOut(visible));
    result.y = (dy || (dx ? 0 : -1)) * size * (1 - bounceOut(visible));
  } else if (type === 'spin') {
    result.angle = hidden * TAU * (dx < 0 || dy < 0 ? -1 : 1);
    result.scaleX = result.scaleY = 0.5 + 0.5 * smooth(visible);
  } else if (type === 'glitch') {
    const random = createSeededRandom(seed + Math.floor(p * 14));
    result.x += (random() - 0.5) * size * 0.5 * hidden;
    result.y += (random() - 0.5) * size * 0.12 * hidden;
    result.clip = hidden > 0.03 ? `inset(${random() * 25 * hidden}% 0 ${random() * 20 * hidden}% 0)` : 'none';
    result.opacity *= 0.65 + 0.35 * random();
  } else if (type === 'blur') {
    result.blur = hidden * 18;
    result.scaleX = result.scaleY = 1 + hidden * 0.25;
  } else if (type === 'dissolve') {
    result.scaleX = result.scaleY = 1 - hidden * 0.12;
    result.clip = hidden > 0 ? `inset(${hidden * 50}% ${hidden * 50}%)` : 'none';
  } else if (type === 'dust') {
    result.x = (dx || (dy ? 0 : 1)) * size * hidden * 1.4;
    result.y = (dy || -0.5) * size * hidden;
    result.angle = hidden * 0.8;
    result.scaleX = result.scaleY = 1 - hidden * 0.6;
  } else if (type === 'drop') {
    result.x = dx * size * hidden * 1.6;
    result.y = (dy || (dx ? 0 : 1)) * size * hidden * 1.6;
    result.angle = hidden * 0.2;
  } else if (type === 'explode') {
    result.scaleX = result.scaleY = 1 + hidden * 1.8;
    result.angle = hidden * -0.5;
  } else if (type === 'compress') {
    const horizontal = dx !== 0 || direction === 'center';
    result.scaleX = horizontal ? Math.max(0.02, 1 - hidden) : 1 + hidden * 0.5;
    result.scaleY = horizontal ? 1 + hidden * 0.5 : Math.max(0.02, 1 - hidden);
  }
  if (visible === 1) return { ...result, x: 0, y: 0, scaleX: 1, scaleY: 1, angle: 0, opacity: 1, blur: 0, clip: 'none' };
  return result;
}

export function createFragmentLayout(count, seed = 1) {
  const total = Math.round(clamp(count, 1, 25));
  const rows = Math.floor(Math.sqrt(total));
  const random = createSeededRandom(seed);
  const result = [];
  for (let row = 0; row < rows; row++) {
    const columns = Math.floor(total / rows) + (row < total % rows ? 1 : 0);
    for (let col = 0; col < columns; col++) {
      result.push({ x: col / columns, y: row / rows, width: 1 / columns, height: 1 / rows,
        delay: random() * 0.3, angle: random() * TAU, distance: 0.8 + random() * 1.5, spin: (random() - 0.5) * TAU });
    }
  }
  return result;
}

export function sampleFragmentMotion(tile, type, progress, { enter = true, direction = 'center', size = 84 } = {}) {
  const [dx, dy] = directionVector(direction);
  const order = dx < 0 ? tile.x : dx > 0 ? 1 - tile.x : dy < 0 ? tile.y : dy > 0 ? 1 - tile.y : tile.delay;
  const local = clamp((clamp(progress) - tile.delay * 0.5 - order * 0.15) / 0.7);
  const hidden = enter ? 1 - smooth(local) : smooth(local);
  const result = { x: 0, y: 0, angle: 0, scale: 1, opacity: 1 - hidden };
  if (hidden === 0) return result;
  if (type === 'dissolve') {
    result.scale = 1 - hidden * 0.7;
  } else if (type === 'dust') {
    result.x = ((dx || (dy ? 0 : 1)) * tile.distance + Math.cos(tile.angle) * 0.3) * size * hidden;
    result.y = ((dy || -0.45) * tile.distance + Math.sin(hidden * Math.PI + tile.angle) * 0.35) * size * hidden;
    result.angle = tile.spin * hidden;
    result.scale = 1 - hidden * 0.8;
  } else {
    const x = tile.x + tile.width / 2 - 0.5;
    const y = tile.y + tile.height / 2 - 0.5;
    const angle = Math.abs(x) + Math.abs(y) < 0.01 ? tile.angle : Math.atan2(y, x);
    result.x = (Math.cos(angle) * tile.distance * 2 + dx * 0.5) * size * hidden;
    result.y = (Math.sin(angle) * tile.distance * 2 + dy * 0.5) * size * hidden + size * hidden ** 2 * 0.6;
    result.angle = tile.spin * hidden * 1.8;
    result.scale = 1 - hidden * 0.4;
  }
  return result;
}

export function advanceFixedStep(accumulator, elapsedMs) {
  const available = Math.max(0, accumulator) + clamp(Number.isFinite(elapsedMs) ? elapsedMs : 0, 0, FIXED_STEP_MS * MAX_CATCHUP_STEPS);
  const steps = Math.min(MAX_CATCHUP_STEPS, Math.floor((available + 1e-7) / FIXED_STEP_MS));
  return { steps, accumulator: Math.max(0, available - steps * FIXED_STEP_MS) };
}

function allowedImageUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return false;
  return /^https:\/\//i.test(value) || /^blob:/i.test(value) || /^\/(?!\/)/.test(value);
}

/** Renderer admission is bounded here; per-user cooldown and provider authorization belong to chat ingress. */
export function createEmoteEngine(container, input, { onCount } = {}) {
  if (!container?.ownerDocument) throw new TypeError('An emote container is required.');
  const document = container.ownerDocument;
  const view = document.defaultView;
  if (!view?.requestAnimationFrame) throw new TypeError('A browser animation clock is required.');
  let settings = normalizeEmoteSettings(input);
  let destroyed = false;
  let paused = false;
  let raf = null;
  let lastFrame = null;
  let clock = 0;
  let accumulator = 0;
  let physicsSteps = 0;
  let width = 1920;
  let pixelWidth = 0;
  let pixelHeight = 0;
  let fragmentCount = 0;
  let trailCount = 0;
  let serial = 0;
  let dropped = 0;
  let admission = [];
  const particles = [];
  const worlds = new Map();
  const element = (tag, styles = {}) => {
    const el = document.createElement(tag);
    Object.assign(el.style, { pointerEvents: 'none', userSelect: 'none', boxSizing: 'border-box', ...styles });
    return el;
  };
  const root = element('div', { position: 'absolute', inset: '0', overflow: 'hidden' });
  root.setAttribute('aria-hidden', 'true');
  const scene = element('div', { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', height: `${LOGICAL_HEIGHT}px` });
  root.appendChild(scene);
  container.appendChild(root);
  const notify = () => { try { onCount?.(particles.length); } catch { /* Consumer callbacks must not stop animation cleanup. */ } };
  const image = (url) => {
    const img = element('img', { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', display: 'block', maxWidth: 'none' });
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.src = url;
    return img;
  };
  const cancelFrame = () => {
    if (raf !== null) view.cancelAnimationFrame(raf);
    raf = null;
    lastFrame = null;
  };
  function remove(particle) {
    const index = particles.indexOf(particle);
    if (index < 0) return;
    particles.splice(index, 1);
    particle.img.onload = null;
    particle.img.onerror = null;
    particle.group.remove();
    fragmentCount -= particle.tiles.length;
    trailCount -= particle.trails.length;
    if (particle.world) {
      Composite.remove(particle.world.engine.world, particle.body);
      particle.world.count--;
      if (!particle.world.count) {
        Composite.clear(particle.world.engine.world, false);
        Engine.clear(particle.world.engine);
        worlds.delete(particle.world.key);
      }
    }
    if (!particles.length) { cancelFrame(); accumulator = 0; }
    notify();
  }
  function rebuildWalls(world) {
    for (const wall of world.walls) Composite.remove(world.engine.world, wall);
    world.walls = [];
    if (!world.area) return;
    const area = getEmoteArea({ area: world.area }, width);
    const options = { isStatic: true, restitution: 0, friction: 1, collisionFilter: { category: 1, mask: 2 } };
    world.walls = [
      Bodies.rectangle(area.x + area.width / 2, area.y + area.height + 60, area.width + 240, 120, options),
      Bodies.rectangle(area.x - 60, area.y + area.height / 2, 120, area.height + 2000, options),
      Bodies.rectangle(area.x + area.width + 60, area.y + area.height / 2, 120, area.height + 2000, options),
    ];
    Composite.add(world.engine.world, world.walls);
  }
  function getWorld(spec) {
    const key = spec.mode === 'rain' ? JSON.stringify(spec.settings.area) : 'launch';
    if (worlds.has(key)) return worlds.get(key);
    const engine = Engine.create({ enableSleeping: false, gravity: { x: 0, y: 0, scale: 0 } });
    const world = { key, engine, walls: [], count: 0, area: spec.mode === 'rain' ? spec.settings.area : null };
    worlds.set(key, world);
    rebuildWalls(world);
    return world;
  }
  function createPhysics(particle) {
    const { spec } = particle;
    const area = getEmoteArea(spec.settings, width);
    const launch = spec.mode === 'launch';
    const state = launch ? getLaunchState(spec, area) : {
      x: area.x + lerp(Math.min(spec.size / 2, area.width / 2), Math.max(area.width / 2, area.width - spec.size / 2), spec.u),
      y: area.y - spec.size * (0.6 + spec.v * 1.5), vx: spec.drift * spec.speed, vy: spec.speed,
      angularVelocity: spec.drift * 0.005,
    };
    const radius = Math.max(2, Math.min(spec.size * 0.43, area.width * 0.4, area.height * 0.4));
    const body = Bodies.circle(state.x, state.y, radius, {
      restitution: spec.restitution, friction: spec.friction, frictionStatic: spec.friction * 2,
      frictionAir: launch ? 0.001 : 0.002 + spec.friction * 0.02,
      collisionFilter: { category: 2, mask: launch ? 0 : (spec.settings.rain.collisions ? 3 : 1) },
    });
    Body.setVelocity(body, { x: state.vx, y: state.vy });
    Body.setAngularVelocity(body, state.angularVelocity);
    particle.body = body;
    particle.world = getWorld(spec);
    particle.world.count++;
    Composite.add(particle.world.engine.world, body);
    particle.previous = { x: body.position.x, y: body.position.y, angle: body.angle };
    particle.position = { ...particle.previous };
  }
  function ensureFrame() {
    if (!destroyed && !paused && !document.hidden && pixelWidth > 0 && pixelHeight > 0 && particles.length && raf === null) {
      if (lastFrame === null) lastFrame = view.performance.now();
      raf = view.requestAnimationFrame(frame);
    }
  }
  function resize() {
    if (destroyed) return;
    const bounds = container.getBoundingClientRect();
    pixelWidth = Math.max(0, bounds.width);
    pixelHeight = Math.max(0, bounds.height);
    if (!pixelWidth || !pixelHeight) { cancelFrame(); return; }
    const nextWidth = pixelWidth / pixelHeight * LOGICAL_HEIGHT;
    const ratio = nextWidth / width;
    width = nextWidth;
    scene.style.width = `${width}px`;
    scene.style.transform = `scale(${pixelHeight / LOGICAL_HEIGHT})`;
    if (Math.abs(ratio - 1) > 1e-8) {
      for (const particle of particles) {
        if (particle.body) {
          Body.setPosition(particle.body, { x: particle.body.position.x * ratio, y: particle.body.position.y });
          Body.setVelocity(particle.body, { x: particle.body.velocity.x * ratio, y: particle.body.velocity.y });
          particle.previous.x *= ratio;
          particle.position.x *= ratio;
          for (const point of particle.history) point.x *= ratio;
        }
      }
      for (const world of worlds.values()) rebuildWalls(world);
    }
    render();
    ensureFrame();
  }
  function transitionFor(particle, age) {
    const { spec } = particle;
    if (age < spec.enterMs) return { type: spec.settings.sticker.enter, progress: age / spec.enterMs, enter: true };
    if (age > spec.duration - spec.exitMs) return { type: spec.settings.sticker.exit,
      progress: (age - spec.duration + spec.exitMs) / spec.exitMs, enter: false };
    return null;
  }
  function render() {
    const interpolation = accumulator / FIXED_STEP_MS;
    for (const particle of particles) {
      const { spec, body } = particle;
      const age = Math.max(0, clock - particle.born);
      const area = getEmoteArea(spec.settings, width);
      let position;
      if (body) position = {
        x: lerp(particle.previous.x, body.position.x, interpolation),
        y: lerp(particle.previous.y, body.position.y, interpolation),
        angle: lerp(particle.previous.angle, body.angle, interpolation),
      };
      else if (spec.mode === 'float') position = sampleFloatMotion(spec, age, area);
      else {
        const mx = Math.min(spec.size / 2, area.width / 2);
        const my = Math.min(spec.size / 2, area.height / 2);
        position = { x: area.x + lerp(mx, area.width - mx, spec.u), y: area.y + lerp(my, area.height - my, spec.v), angle: spec.stickerRotation * Math.PI / 180 };
      }
      particle.position = position;
      const transition = spec.mode === 'sticker' ? transitionFor(particle, age) : null;
      const options = { enter: transition?.enter, direction: spec.direction, size: spec.size, seed: spec.seed };
      const style = transition ? sampleStickerTransition(transition.type, transition.progress, options)
        : { x: 0, y: 0, scaleX: 1, scaleY: 1, angle: 0, opacity: 1, blur: 0, clip: 'none' };
      const tiled = transition && TILE_EFFECTS.has(transition.type) && particle.tiles.length;
      const loaded = particle.ready || (particle.img.complete && particle.img.naturalWidth > 0);
      const alpha = loaded ? sampleParticleAlpha(spec, age) : 0;
      particle.node.style.transform = `translate3d(${position.x - spec.size / 2 + (tiled ? 0 : style.x)}px,${position.y - spec.size / 2 + (tiled ? 0 : style.y)}px,0) rotate(${position.angle + (tiled ? 0 : style.angle)}rad) scale(${tiled ? 1 : style.scaleX},${tiled ? 1 : style.scaleY})`;
      particle.node.style.opacity = `${alpha * (tiled ? 1 : style.opacity)}`;
      particle.node.style.filter = style.blur && !tiled ? `blur(${style.blur}px)` : 'none';
      particle.img.style.visibility = tiled ? 'hidden' : 'visible';
      particle.img.style.clipPath = tiled ? 'none' : style.clip;
      particle.tileLayer.style.display = tiled ? 'block' : 'none';
      if (tiled) {
        for (const tile of particle.tiles) {
          const motion = sampleFragmentMotion(tile.layout, transition.type, transition.progress, options);
          tile.node.style.transform = `translate3d(${motion.x}px,${motion.y}px,0) rotate(${motion.angle}rad) scale(${motion.scale})`;
          tile.node.style.opacity = `${motion.opacity}`;
        }
      }
      for (let index = 0; index < particle.trails.length; index++) {
        const trail = particle.trails[index];
        const point = particle.history[Math.max(0, particle.history.length - (index + 1) * 3 - 1)];
        trail.style.opacity = point && particle.history.length > (index + 1) * 3 ? `${alpha * 0.17 * (1 - index / particle.trails.length)}` : '0';
        if (point) trail.style.transform = `translate3d(${point.x - spec.size / 2}px,${point.y - spec.size / 2}px,0) rotate(${point.angle}rad) scale(${1 - (index + 1) * 0.055})`;
      }
    }
  }
  function frame(timestamp) {
    raf = null;
    if (destroyed || paused) return;
    const elapsed = Math.max(0, timestamp - (lastFrame ?? timestamp));
    lastFrame = timestamp;
    clock += elapsed;
    for (const particle of [...particles]) {
      const age = clock - particle.born;
      if (age >= getParticleLifetime(particle.spec)) remove(particle);
      else if (particle.spec.mode === 'rain' && age >= particle.spec.duration * particle.spec.releaseAfter) particle.body.collisionFilter.mask = 0;
    }
    if (!particles.length) { accumulator = 0; return; }
    const step = advanceFixedStep(accumulator, elapsed);
    accumulator = step.accumulator;
    for (let index = 0; index < step.steps; index++) {
      for (const particle of particles) {
        if (!particle.body) continue;
        const { body, spec } = particle;
        particle.previous = { x: body.position.x, y: body.position.y, angle: body.angle };
        body.force.y += body.mass * 0.001 * spec.gravity * (spec.mode === 'rain' ? spec.speed : 1);
      }
      for (const world of worlds.values()) Engine.update(world.engine, FIXED_STEP_MS);
      physicsSteps++;
      for (const particle of particles) {
        if (!particle.body || !particle.trails.length) continue;
        particle.history.push({ x: particle.body.position.x, y: particle.body.position.y, angle: particle.body.angle });
        if (particle.history.length > particle.trails.length * 3 + 2) particle.history.shift();
      }
    }
    for (const particle of [...particles]) {
      if (!particle.body) continue;
      const { x, y } = particle.body.position;
      if (!Number.isFinite(x + y + particle.body.angle)
        || (particle.spec.mode === 'launch' && y > LOGICAL_HEIGHT + particle.spec.size * 2 && particle.body.velocity.y > 0)) remove(particle);
    }
    render();
    ensureFrame();
  }
  const resizeObserver = view.ResizeObserver ? new view.ResizeObserver(resize) : null;
  resizeObserver?.observe(container);
  if (!resizeObserver) view.addEventListener('resize', resize);
  const onVisibility = () => {
    if (document.hidden) { clear(); cancelFrame(); }
    else { lastFrame = null; ensureFrame(); }
  };
  document.addEventListener('visibilitychange', onVisibility);
  function clear() {
    for (const particle of [...particles]) remove(particle);
    cancelFrame();
    accumulator = 0;
    admission = [];
  }
  function emit(items, { settings: packetSettings, seed } = {}) {
    if (destroyed || document.hidden || !Array.isArray(items)) return 0;
    const config = packetSettings ? normalizeEmoteSettings(packetSettings) : settings;
    const now = view.performance.now();
    admission = admission.filter((time) => now - time < 1000);
    const limit = Math.min(config.maxPerMessage, Math.max(0, config.perSecond - admission.length));
    let accepted = 0;
    const baseSeed = Number.isFinite(seed) ? seed >>> 0 : (++serial * 2654435761) >>> 0;
    for (const item of items.slice(0, limit)) {
      if (!allowedImageUrl(item?.url)) continue;
      const spec = createParticleSpec(config, (baseSeed + accepted * 2654435761) >>> 0);
      while (particles.length >= Math.min(settings.maxActive, config.maxActive)) { dropped++; remove(particles[0]); }
      const area = config.area;
      const group = element('div', { position: 'absolute', inset: '0',
        clipPath: `inset(${area.y}% ${100 - area.x - area.width}% ${100 - area.y - area.height}% ${area.x}%)` });
      const node = element('div', { position: 'absolute', left: '0', top: '0', width: `${spec.size}px`, height: `${spec.size}px`, opacity: '0', willChange: 'transform, opacity' });
      node.dataset.emoteMode = spec.mode;
      const img = image(item.url);
      const tileLayer = element('div', { position: 'absolute', inset: '0', display: 'none' });
      const particle = { spec, group, node, img, tileLayer, born: clock, ready: false, tiles: [], trails: [], history: [], body: null, world: null, previous: null, position: null };
      if (spec.mode === 'sticker' && (TILE_EFFECTS.has(config.sticker.enter) || TILE_EFFECTS.has(config.sticker.exit))) {
        const count = Math.min(spec.fragments, MAX_FRAGMENT_BUDGET - fragmentCount);
        if (count >= 4) {
          for (const layout of createFragmentLayout(count, spec.seed)) {
            const tile = element('div', { position: 'absolute', inset: '0',
              clipPath: `inset(${layout.y * 100}% ${(1 - layout.x - layout.width) * 100}% ${(1 - layout.y - layout.height) * 100}% ${layout.x * 100}%)`,
              transformOrigin: `${(layout.x + layout.width / 2) * 100}% ${(layout.y + layout.height / 2) * 100}%` });
            tile.appendChild(image(item.url));
            tileLayer.appendChild(tile);
            particle.tiles.push({ node: tile, layout });
          }
          fragmentCount += particle.tiles.length;
        }
      }
      if (spec.mode === 'launch') {
        const count = Math.min(spec.trail, MAX_TRAIL_BUDGET - trailCount);
        for (let index = 0; index < count; index++) {
          const trail = element('div', { position: 'absolute', width: `${spec.size}px`, height: `${spec.size}px`, opacity: '0' });
          trail.appendChild(image(item.url));
          group.appendChild(trail);
          particle.trails.push(trail);
        }
        trailCount += particle.trails.length;
      }
      node.appendChild(img);
      node.appendChild(tileLayer);
      group.appendChild(node);
      scene.appendChild(group);
      particles.push(particle);
      if (spec.mode === 'rain' || spec.mode === 'launch') createPhysics(particle);
      img.onload = () => { particle.ready = true; if (!destroyed) render(); };
      img.onerror = () => remove(particle);
      if (img.complete && img.naturalWidth === 0) remove(particle);
      admission.push(now);
      accepted++;
    }
    render();
    notify();
    ensureFrame();
    return accepted;
  }
  resize();
  return {
    setSettings(next) {
      if (destroyed) return;
      settings = normalizeEmoteSettings(next);
      while (particles.length > settings.maxActive) { dropped++; remove(particles[0]); }
    },
    emit, clear,
    pause(value) {
      if (destroyed) return;
      paused = Boolean(value);
      cancelFrame();
      if (!paused) ensureFrame();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clear();
      resizeObserver?.disconnect();
      if (!resizeObserver) view.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      root.remove();
    },
    stats() {
      return { active: particles.length, fragments: fragmentCount, trails: trailCount, worlds: worlds.size,
        bodies: particles.filter((particle) => particle.body).length, paused, destroyed, rafPending: raf !== null,
        width: pixelWidth, height: pixelHeight, logicalWidth: width, elapsedMs: clock, physicsSteps, dropped,
        particles: particles.map((particle) => ({ mode: particle.spec.mode, ageMs: clock - particle.born,
          durationMs: getParticleLifetime(particle.spec), ...particle.position, size: particle.spec.size,
          restitution: particle.body?.restitution, collisionMask: particle.body?.collisionFilter.mask,
          vx: particle.body?.velocity.x, vy: particle.body?.velocity.y })) };
    },
  };
}
