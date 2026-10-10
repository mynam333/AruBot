const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const characters = [
  ['mask-dude', '마스크 듀드', 'Mask Dude'],
  ['ninja-frog', '닌자 프로그', 'Ninja Frog'],
  ['pink-man', '핑크 맨', 'Pink Man'],
  ['virtual-guy', '버추얼 가이', 'Virtual Guy'],
];
const files = new Map();
const avatars = characters.map(([id, name, directory]) => {
  const states = {};
  for (const [state, animation] of Object.entries({
    idle: 'Idle',
    walk: 'Run',
    jump: 'Jump',
    hit: 'Hit',
  })) {
    const file = path.join(
      __dirname,
      'bundled',
      directory,
      `${animation} (32x32).png`,
    );
    const buffer = fs.readFileSync(file);
    const asset = `${crypto.createHash('sha256').update(buffer).digest('hex')}.png`;
    const columns = buffer.readUInt32BE(16) / 32;
    const rows = buffer.readUInt32BE(20) / 32;
    files.set(asset, file);
    states[state] = { asset, columns, rows, frames: columns * rows, fps: 20 };
  }
  return { id: `pixel-${id}`, name, pixelated: true, states };
});

function migrateLegacyAvatars(config) {
  if (
    !Array.isArray(config?.avatars) ||
    !config.avatars.some((a) => ['mint', 'rose', 'gold'].includes(a.builtin))
  )
    return config;
  const custom = config.avatars.filter(
    (a) => !['mint', 'rose', 'gold'].includes(a.builtin),
  );
  const defaults = structuredClone(avatars)
    .filter((a) => !custom.some((c) => c.id === a.id))
    .slice(0, 64 - custom.length);
  const next = [...defaults, ...custom];
  return {
    ...config,
    avatars: next,
    defaultAvatar: next.some((a) => a.id === config.defaultAvatar)
      ? config.defaultAvatar
      : next[0].id,
  };
}

module.exports = { avatars, files, migrateLegacyAvatars };
