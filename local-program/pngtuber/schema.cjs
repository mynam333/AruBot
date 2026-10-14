const crypto = require('node:crypto');

const LIMITS = Object.freeze({
  fileBytes: 20 * 1024 * 1024,
  pixels: 16000000,
  reactions: 32,
  pending: 20,
  assets: 256,
  deliveries: 1024,
  staleMeterMs: 1000,
});
const assetId = (value) => typeof value === 'string' && /^[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(value);
const text = (value, max = 128) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
function number(value, min, max, name) {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '' || !Number.isFinite(Number(value)))
    throw new Error(`Invalid ${name}`);
  return Math.min(max, Math.max(min, Number(value)));
}
const duration = (value) => number(value, 0.1, 300, 'durationSec');
function defaultConfig() {
  return {
    version: 1, enabled: false, port: 17842, inputName: '', inputUuid: '',
    thresholdDb: -38, hysteresisDb: 6, holdMs: 160,
    openAsset: '', closedAsset: '', mutedAsset: '', fit: 'contain', flipX: false,
    reactionMode: 'queue', reactions: [], key: crypto.randomBytes(24).toString('hex'),
  };
}
function validateConfig(next, previous = defaultConfig()) {
  if (!next || typeof next !== 'object' || Array.isArray(next)) throw new Error('Invalid PNGTuber config');
  if (next.version !== undefined && next.version !== 1) {
    const error = new Error('Unsupported PNGTuber config version');
    error.code = 'FUTURE_CONFIG_VERSION';
    throw error;
  }
  const value = { ...previous, ...next };
  if (!Array.isArray(value.reactions) || value.reactions.length > LIMITS.reactions)
    throw new Error('At most 32 reactions are allowed');
  const ids = new Set();
  const image = (id) => {
    if (id === '') return '';
    if (!assetId(id)) throw new Error('Invalid image asset');
    return id;
  };
  const reactions = value.reactions.map((reaction) => {
    if (!reaction || !/^[a-zA-Z0-9_-]{1,64}$/.test(reaction.id) || ids.has(reaction.id))
      throw new Error('Reaction IDs must be unique');
    ids.add(reaction.id);
    const name = text(reaction.name, 96);
    if (!name || !reaction.asset) throw new Error('Reaction name and image are required');
    return { id: reaction.id, name, asset: image(reaction.asset), durationSec: duration(reaction.durationSec ?? 5) };
  });
  if (!['contain', 'cover', 'fill'].includes(value.fit)) throw new Error('Invalid image fit');
  if (!['queue', 'replace'].includes(value.reactionMode)) throw new Error('Invalid reaction mode');
  return {
    version: 1, enabled: value.enabled === true,
    port: Math.round(number(value.port, 1024, 65535, 'port')),
    inputName: text(value.inputName, 256), inputUuid: text(value.inputUuid, 128),
    thresholdDb: number(value.thresholdDb, -100, 0, 'thresholdDb'),
    hysteresisDb: number(value.hysteresisDb, 0, 40, 'hysteresisDb'),
    holdMs: Math.round(number(value.holdMs, 0, 2000, 'holdMs')),
    openAsset: image(value.openAsset), closedAsset: image(value.closedAsset), mutedAsset: image(value.mutedAsset),
    fit: value.fit, flipX: value.flipX === true, reactionMode: value.reactionMode,
    reactions, key: previous.key,
  };
}
function publicConfig(config) {
  const { key, ...visible } = config;
  return structuredClone(visible);
}
function referencedAssets(config) {
  return new Set([config.closedAsset, config.openAsset, config.mutedAsset, ...config.reactions.map((r) => r.asset)].filter(Boolean));
}
module.exports = { LIMITS, assetId, text, duration, defaultConfig, validateConfig, publicConfig, referencedAssets };
