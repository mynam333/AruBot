export const EMOTE_MODES = ['float', 'rain', 'sticker', 'launch', 'random'];
export const EMOTE_ANIMATIONS = ['fade', 'pop', 'bounce', 'spin', 'glitch', 'blur', 'dissolve', 'dust', 'drop', 'explode', 'compress'];
export const EMOTE_DIRECTIONS = ['random', 'up', 'down', 'left', 'right', 'center'];
export const EMOTE_ORIGINS = ['bottomLeft', 'bottom', 'bottomRight', 'left', 'right', 'topLeft', 'top', 'topRight', 'random', 'custom'];

export const DEFAULT_EMOTE_SETTINGS = {
  version: 1, enabled: false, providers: { chzzk: true, cime: true, youtube: true }, mode: 'float',
  size: 84, opacity: 1, duration: 9, speed: 1, variation: 0.18, fadeMs: 900,
  maxActive: 60, maxPerMessage: 8, perSecond: 20, cooldownMs: 500,
  area: { x: 0, y: 0, width: 100, height: 100 },
  float: { direction: 'leftToRight', sway: 65, swaySpeed: 1.2, spin: 32 },
  rain: { gravity: 1, restitutionMin: 0.48, restitutionMax: 0.82, friction: 0.04, drift: 2, releaseAfter: 0.75, collisions: true },
  sticker: { enter: 'pop', exit: 'dissolve', enterMs: 450, exitMs: 800, direction: 'random', rotation: 14, fragments: 16 },
  launch: { origin: 'bottomLeft', x: 0, y: 100, angle: 60, spread: 24, power: 18, gravity: 1, spin: 130, trail: 3 },
};

export const EMOTE_NUMERIC_FIELDS = {
  size: [24, 240, 1], opacity: [0.1, 1, 0.05], duration: [2, 30, 0.5], speed: [0.2, 3, 0.1], variation: [0, 0.5, 0.01], fadeMs: [100, 5000, 50],
  maxActive: [5, 120, 1], maxPerMessage: [1, 16, 1], perSecond: [1, 60, 1], cooldownMs: [0, 10000, 100],
  'area.x': [0, 95, 1], 'area.y': [0, 95, 1], 'area.width': [5, 100, 1], 'area.height': [5, 100, 1],
  'float.sway': [0, 240, 5], 'float.swaySpeed': [0.1, 5, 0.1], 'float.spin': [-180, 180, 5],
  'rain.gravity': [0.1, 3, 0.1], 'rain.restitutionMin': [0.05, 0.95, 0.05], 'rain.restitutionMax': [0.05, 0.98, 0.05], 'rain.friction': [0, 0.2, 0.01], 'rain.drift': [0, 12, 0.5], 'rain.releaseAfter': [0.2, 0.95, 0.05],
  'sticker.enterMs': [100, 3000, 50], 'sticker.exitMs': [100, 4000, 50], 'sticker.rotation': [0, 180, 1], 'sticker.fragments': [4, 25, 1],
  'launch.x': [0, 100, 1], 'launch.y': [0, 100, 1], 'launch.angle': [0, 180, 1], 'launch.spread': [0, 120, 1], 'launch.power': [3, 40, 0.5], 'launch.gravity': [0.1, 3, 0.1], 'launch.spin': [-360, 360, 5], 'launch.trail': [0, 6, 1],
};

const enumFields = {
  mode: EMOTE_MODES, 'float.direction': ['leftToRight', 'rightToLeft', 'bottomToTop', 'topToBottom', 'random'],
  'sticker.enter': EMOTE_ANIMATIONS, 'sticker.exit': EMOTE_ANIMATIONS, 'sticker.direction': EMOTE_DIRECTIONS, 'launch.origin': EMOTE_ORIGINS,
};
const booleanFields = ['enabled', 'providers.chzzk', 'providers.cime', 'providers.youtube', 'rain.collisions'];
const integers = new Set(['maxActive', 'maxPerMessage', 'perSecond', 'cooldownMs', 'fadeMs', 'sticker.enterMs', 'sticker.exitMs', 'sticker.fragments', 'launch.trail']);
const get = (obj, path) => path.split('.').reduce((value, key) => value && Object.hasOwn(value, key) ? value[key] : undefined, obj);
const put = (obj, path, value) => { const keys = path.split('.'); if (keys.length === 1) obj[keys[0]] = value; else obj[keys[0]][keys[1]] = value; };

export function normalizeEmoteSettings(input = {}, { strict = false } = {}) {
  const bad = () => { throw Object.assign(new Error('이모티콘 효과 설정값을 확인해 주세요.'), { status: 400 }); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) { if (strict) bad(); input = {}; }
  const next = JSON.parse(JSON.stringify(DEFAULT_EMOTE_SETTINGS));
  for (const [path, [min, max]] of Object.entries(EMOTE_NUMERIC_FIELDS)) {
    const raw = get(input, path);
    if (raw === undefined) continue;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) { if (strict) bad(); continue; }
    if (strict && (raw < min || raw > max || (integers.has(path) && !Number.isInteger(raw)))) bad();
    put(next, path, Math.max(min, Math.min(max, integers.has(path) ? Math.round(raw) : raw)));
  }
  for (const [path, values] of Object.entries(enumFields)) {
    const raw = get(input, path);
    if (raw === undefined) continue;
    if (!values.includes(raw)) { if (strict) bad(); continue; }
    put(next, path, raw);
  }
  for (const path of booleanFields) {
    const raw = get(input, path);
    if (raw === undefined) continue;
    if (typeof raw !== 'boolean') { if (strict) bad(); continue; }
    put(next, path, raw);
  }
  next.area.width = Math.min(next.area.width, 100 - next.area.x);
  next.area.height = Math.min(next.area.height, 100 - next.area.y);
  if (next.rain.restitutionMin > next.rain.restitutionMax) {
    if (strict) throw Object.assign(new Error('최소 탄성은 최대 탄성보다 클 수 없습니다.'), { status: 400 });
    [next.rain.restitutionMin, next.rain.restitutionMax] = [next.rain.restitutionMax, next.rain.restitutionMin];
  }
  return next;
}

// Never fetch chat-provided URLs on the server. Images are loaded by the browser.
export function safeEmoteImageUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (!host.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
      || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return null;
    return url.href;
  } catch { return null; }
}
