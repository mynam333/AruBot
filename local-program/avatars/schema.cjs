const crypto = require('crypto');
const { avatars: bundledAvatars } = require('./bundled.cjs');

const STATES = [
  'idle',
  'walk',
  'run',
  'float',
  'jump',
  'dance',
  'wave',
  'sit',
  'hit',
];
const ACTIONS = [
  'wait',
  'jump',
  'dance',
  'wave',
  'sit',
  'walk',
  'run',
  'float',
  'gather',
  'follow',
  'highfive',
  'push',
  'size',
  'say',
];
const TRIGGERS = ['command', 'join', 'chat', 'donation', 'subscription'];
const ROLES = ['everyone', 'moderator', 'owner'];
const LIMITS = {
  assets: 64,
  fileBytes: 8 * 1024 * 1024,
  totalBytes: 48 * 1024 * 1024,
  profiles: 5000,
  actors: 150,
  rules: 64,
  steps: 8,
  duration: 120,
};
const number = (value, min, max, fallback) =>
  value !== '' && value != null && Number.isFinite(Number(value))
    ? Math.min(max, Math.max(min, Number(value)))
    : fallback;
const text = (value, limit = 80) =>
  String(value ?? '')
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{M}]/gu, '')
    .trim()
    .slice(0, limit);
const id = () => crypto.randomUUID();
const assetId = (value) =>
  /^[a-f0-9]{64}\.(png|gif|webp|jpg)$/.test(String(value)) ? value : '';
const bool = (value, fallback) =>
  typeof value === 'boolean' ? value : fallback;

function motionRules() {
  return [
    ['run', '달리기', ['!달리기', '!run'], '3'],
    ['float', '공중부양', ['!부양', '!공중부양', '!float'], '160'],
  ].map(([action, name, aliases, value]) => ({
    id: `builtin-${action}-v2`,
    name,
    aliases,
    enabled: true,
    trigger: 'command',
    role: 'everyone',
    cooldown: 3,
    minimum: 0,
    durationFromChat: true,
    steps: [{ action, value, duration: 5 }],
  }));
}

function migrateConfig(config) {
  if (!config || Number(config.version) >= 2 || !Array.isArray(config.rules))
    return config;
  const aliases = new Set(
    config.rules.flatMap((r) =>
      Array.isArray(r.aliases)
        ? r.aliases.map((a) => String(a).toLowerCase())
        : String(r.aliases || '')
            .toLowerCase()
            .split(/\s+/),
    ),
  );
  const additions = motionRules().filter(
    (r) =>
      !config.rules.some((v) => v.id === r.id) &&
      !r.aliases.some((a) => aliases.has(a)),
  );
  return {
    ...config,
    version: 2,
    rules: [
      ...config.rules,
      ...additions.slice(0, Math.max(0, LIMITS.rules - config.rules.length)),
    ],
  };
}

function defaultConfig() {
  const commands = [
    ['점프', '!점프 !jump', 'jump'],
    ['춤', '!춤 !dance', 'dance'],
    ['인사', '!인사 !wave', 'wave'],
    ['앉기', '!앉기 !sit', 'sit'],
    ['왼쪽', '!왼쪽 !left', 'walk', -1],
    ['오른쪽', '!오른쪽 !right', 'walk', 1],
    ['모이기', '!모여 !gather', 'gather'],
    ['따라가기', '!따라 !follow', 'follow'],
    ['하이파이브', '!하이파이브 !highfive', 'highfive'],
    ['밀기', '!밀기 !push', 'push'],
  ];
  return {
    version: 2,
    enabled: false,
    paused: false,
    port: 17841,
    key: crypto.randomBytes(24).toString('hex'),
    autoJoin: true,
    maxActors: 60,
    idleMinutes: 15,
    size: 76,
    speed: 1.5,
    floor: 24,
    showNames: true,
    bubbles: false,
    allowTargeting: false,
    defaultAvatar: bundledAvatars[0].id,
    avatars: structuredClone(bundledAvatars),
    rules: [
      ...commands.map(([name, aliases, action, value]) => ({
        id: id(),
        name,
        aliases: aliases.split(' '),
        enabled: true,
        trigger: 'command',
        role: 'everyone',
        cooldown: 3,
        minimum: 0,
        durationFromChat: false,
        steps: [{ action, value: value || '', duration: 2 }],
      })),
      ...motionRules(),
    ],
  };
}

function validateConfig(input, previous = defaultConfig()) {
  if (!input || typeof input !== 'object')
    throw new Error('설정 형식이 올바르지 않습니다.');
  if (
    !Array.isArray(input.avatars) ||
    input.avatars.length < 1 ||
    input.avatars.length > 64
  )
    throw new Error('캐릭터는 1~64개여야 합니다.');
  const avatarIds = new Set();
  const avatarNames = new Set();
  const avatars = input.avatars.map((a) => {
    const key = text(a.id, 64);
    const name = text(a.name, 32);
    if (
      !/^[a-zA-Z0-9_-]+$/.test(key) ||
      !name ||
      avatarIds.has(key) ||
      avatarNames.has(name.toLowerCase())
    )
      throw new Error('캐릭터 ID와 이름은 비어 있거나 중복될 수 없습니다.');
    avatarIds.add(key);
    avatarNames.add(name.toLowerCase());
    const states = {};
    for (const state of STATES) {
      const image = a.states?.[state];
      if (!image) continue;
      const asset = assetId(image.asset);
      if (!asset) throw new Error('잘못된 이미지 파일입니다.');
      const columns = Math.round(number(image.columns, 1, 32, 1));
      const rows = Math.round(number(image.rows, 1, 32, 1));
      states[state] = {
        asset,
        columns,
        rows,
        frames: Math.round(number(image.frames, 1, columns * rows, 1)),
        fps: number(image.fps, 1, 60, 12),
      };
    }
    if (!states.idle) throw new Error('기본 이미지를 먼저 등록해 주세요.');
    return { id: key, name, pixelated: a.pixelated === true, states };
  });
  if (!Array.isArray(input.rules) || input.rules.length > LIMITS.rules)
    throw new Error('반응은 최대 64개입니다.');
  const aliases = new Set([
    '!입장',
    '!join',
    '!퇴장',
    '!leave',
    '!캐릭터',
    '!avatar',
    '!색',
    '!color',
    '!크기',
    '!size',
    '!도움말',
    '!help',
    '!응원',
    '!cheer',
  ]);
  const ruleIds = new Set();
  const rules = input.rules.map((r) => {
    const key = text(r.id, 64) || id();
    if (ruleIds.has(key)) throw new Error('반응 ID가 중복됩니다.');
    ruleIds.add(key);
    if (!TRIGGERS.includes(r.trigger) || !ROLES.includes(r.role))
      throw new Error('반응 종류 또는 권한이 올바르지 않습니다.');
    const names = [
      ...new Set(
        (Array.isArray(r.aliases)
          ? r.aliases
          : String(r.aliases || '').split(/\s+/)
        )
          .map((v) => text(v, 32).toLowerCase())
          .filter(Boolean),
      ),
    ];
    if (r.trigger === 'command') {
      if (!names.length || names.length > 8)
        throw new Error('명령어 별칭은 1~8개입니다.');
      for (const name of names) {
        if (!/^![^\s]{1,31}$/u.test(name) || aliases.has(name))
          throw new Error(`중복 또는 잘못된 명령어: ${name}`);
        aliases.add(name);
      }
    }
    if (
      !Array.isArray(r.steps) ||
      !r.steps.length ||
      r.steps.length > LIMITS.steps
    )
      throw new Error('반응 동작은 1~8개입니다.');
    return {
      id: key,
      name: text(r.name, 48) || '반응',
      aliases: names,
      enabled: r.enabled !== false,
      trigger: r.trigger,
      role: r.role,
      cooldown: number(r.cooldown, 1, 600, 3),
      minimum: number(r.minimum, 0, 1e9, 0),
      durationFromChat: r.trigger === 'command' && r.durationFromChat === true,
      steps: r.steps.map((step) => {
        if (!ACTIONS.includes(step.action))
          throw new Error('지원하지 않는 동작입니다.');
        return {
          action: step.action,
          value: text(step.value, 100),
          duration: number(
            step.duration,
            0.1,
            LIMITS.duration,
            ['run', 'float'].includes(step.action) ? 5 : 2,
          ),
        };
      }),
    };
  });
  return {
    version: 2,
    key: previous.key,
    port: Math.round(number(input.port, 1024, 65535, previous.port)),
    enabled: bool(input.enabled, previous.enabled),
    paused: bool(input.paused, previous.paused),
    autoJoin: bool(input.autoJoin, true),
    maxActors: Math.round(number(input.maxActors, 1, LIMITS.actors, 60)),
    idleMinutes: number(input.idleMinutes, 1, 120, 15),
    size: number(input.size, 24, 160, 76),
    speed: number(input.speed, 0.2, 4, 1.5),
    floor: number(input.floor, 0, 300, 24),
    showNames: bool(input.showNames, true),
    bubbles: bool(input.bubbles, false),
    allowTargeting: bool(input.allowTargeting, false),
    defaultAvatar: avatarIds.has(input.defaultAvatar)
      ? input.defaultAvatar
      : avatars[0].id,
    avatars,
    rules,
  };
}

module.exports = {
  STATES,
  ACTIONS,
  TRIGGERS,
  ROLES,
  LIMITS,
  number,
  text,
  id,
  assetId,
  defaultConfig,
  validateConfig,
  migrateConfig,
};
