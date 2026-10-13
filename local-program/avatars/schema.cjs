const crypto = require('crypto');
const { avatars: bundledAvatars } = require('./bundled.cjs');
const { sanitizeZalgoText } = require('./text-safety.cjs');

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
const TRIGGERS = [
  'command',
  'join',
  'firstJoin',
  'chat',
  'donation',
  'subscription',
];
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
  diagnostics: 200,
  pending: 256,
  pendingPerActor: 3,
};
const number = (value, min, max, fallback) =>
  value !== '' && value != null && Number.isFinite(Number(value))
    ? Math.min(max, Math.max(min, Number(value)))
    : fallback;
const text = (value, limit = 80) =>
  sanitizeZalgoText(String(value ?? ''))
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .trim()
    .slice(0, limit);
const speechSegments = new Intl.Segmenter('ko', { granularity: 'grapheme' });
function speechText(value, limit = 72) {
  const clean = text(String(value ?? '').replace(/\s+/gu, ' '), 8192);
  const parts = Array.from(speechSegments.segment(clean), (part) => part.segment);
  const max = Math.round(number(limit, 16, 120, 72));
  return parts.length > max ? `${parts.slice(0, max - 3).join('').trimEnd()}...` : clean;
}
const id = () => crypto.randomUUID();
const assetId = (value) =>
  /^[a-f0-9]{64}\.(png|gif|webp|jpg)$/.test(String(value)) ? value : '';
const bool = (value, fallback) =>
  typeof value === 'boolean' ? value : fallback;
const choice = (value, values, fallback) =>
  values.includes(value) ? value : fallback;

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
    durationMode: 'step',
    durationStep: 0,
    interrupt: 'replace',
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
    version: 3,
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
    bubbles: true,
    bubbleDuration: 6,
    bubbleMaxLength: 72,
    bubbleSize: 22,
    allowTargeting: false,
    newJoins: true,
    outputHidden: false,
    admission: 'reject',
    safeLeft: 0,
    safeRight: 0,
    safeTop: 0,
    nameSize: 20,
    nameLimit: 150,
    namesMode: 'recent',
    bubbleLimit: 10,
    gameBottom: 245,
    gameSettings: {
      duration: 30,
      recruitSeconds: 0,
      countdownSeconds: 0,
      resultSeconds: 10,
      goal: 0,
      departures: 'keep',
      boosts: 0,
    },
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
  if (Number(input.version) > 3) {
    const error = new Error(
      '더 최신 버전의 아바타 설정입니다. 앱을 업데이트해 주세요.',
    );
    error.code = 'FUTURE_CONFIG_VERSION';
    throw error;
  }
  const legacy = !input.version || Number(input.version) < 3;
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
        frameWidth: number(image.frameWidth, 0, 2048, 0),
        frameHeight: number(image.frameHeight, 0, 2048, 0),
        anchorX: number(image.anchorX, 0, 1, 0.5),
        anchorY: number(image.anchorY, 0, 1, 1),
        offsetX: number(image.offsetX, -200, 200, 0),
        offsetY: number(image.offsetY, -200, 200, 0),
        scale: number(image.scale, 0.25, 4, 1),
        direction: choice(image.direction, ['left', 'right'], 'right'),
        preserveAspect: bool(image.preserveAspect, !legacy),
        playback: choice(image.playback, ['loop', 'once', 'hold'], 'loop'),
        startFrame: Math.round(
          number(
            image.startFrame,
            0,
            Math.max(
              0,
              Math.min(Number(image.frames) || 1, columns * rows) - 1,
            ),
            0,
          ),
        ),
        endFrame: Math.round(
          number(
            image.endFrame,
            0,
            Math.max(
              0,
              Math.min(Number(image.frames) || 1, columns * rows) - 1,
            ),
            Math.max(
              0,
              Math.min(Number(image.frames) || 1, columns * rows) - 1,
            ),
          ),
        ),
      };
      if (states[state].startFrame > states[state].endFrame)
        throw new Error(`${name}: 시작 프레임이 종료 프레임보다 큽니다.`);
    }
    if (!states.idle) throw new Error('기본 이미지를 먼저 등록해 주세요.');
    return {
      id: key,
      name,
      pixelated: a.pixelated === true,
      stride: number(a.stride, 10, 200, 50),
      author: text(a.author, 80),
      source: text(a.source, 300),
      license: text(a.license, 80),
      redistributable: a.redistributable === true,
      states,
    };
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
      durationMode: choice(
        r.durationMode,
        ['fixed', 'step', 'legacyAllSteps'],
        r.durationFromChat ? (legacy ? 'legacyAllSteps' : 'step') : 'fixed',
      ),
      durationStep: Math.round(
        number(r.durationStep, 0, r.steps.length - 1, 0),
      ),
      interrupt: choice(
        r.interrupt,
        ['replace', 'queue', 'parallel'],
        legacy ? 'replace' : r.trigger === 'chat' ? 'parallel' : 'replace',
      ),
      maxDuration: number(r.maxDuration, 0.1, 960, legacy ? 960 : 120),
      failure: choice(r.failure, ['stop', 'skip'], 'stop'),
      templateId: text(r.templateId, 64),
      templateVersion: number(r.templateVersion, 0, 1000, 0),
      steps: r.steps.map((step) => {
        if (!ACTIONS.includes(step.action))
          throw new Error('지원하지 않는 동작입니다.');
        return {
          action: step.action,
          value: text(step.value, 100),
          start: choice(step.start, ['after', 'withPrevious'], 'after'),
          completion: choice(
            step.completion,
            ['duration', 'landing', 'arrival'],
            'duration',
          ),
          sizeMode: choice(
            step.sizeMode,
            ['permanent', 'temporary'],
            'permanent',
          ),
          waitMode: choice(step.waitMode, ['stop', 'continue'], 'stop'),
          jumpStrength: number(step.jumpStrength, 4, 20, 12),
          legacyTiming: bool(step.legacyTiming, legacy),
          risePercent: number(step.risePercent, 0, 45, 25),
          fallPercent: number(step.fallPercent, 0, 45, 25),
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
    version: 3,
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
    bubbles: bool(input.bubbles, previous.bubbles ?? true),
    bubbleDuration: number(input.bubbleDuration, 2, 15, 6),
    bubbleMaxLength: Math.round(number(input.bubbleMaxLength, 16, 120, 72)),
    bubbleSize: number(input.bubbleSize, 14, 36, 22),
    allowTargeting: bool(input.allowTargeting, false),
    newJoins: bool(input.newJoins, true),
    outputHidden: bool(input.outputHidden, false),
    admission: choice(
      input.admission,
      ['reject', 'replaceIdle', 'queue'],
      'reject',
    ),
    safeLeft: number(input.safeLeft, 0, 600, 0),
    safeRight: number(input.safeRight, 0, 600, 0),
    safeTop: number(input.safeTop, 0, 500, 0),
    nameSize: number(input.nameSize, 10, 40, 20),
    nameLimit: Math.round(number(input.nameLimit, 0, 150, 150)),
    namesMode: choice(input.namesMode, ['always', 'recent'], legacy ? 'always' : 'recent'),
    bubbleLimit: Math.round(number(input.bubbleLimit, 0, 30, 10)),
    gameBottom: number(input.gameBottom, 0, 900, 245),
    gameSettings: {
      duration: number(input.gameSettings?.duration, 10, 120, 30),
      recruitSeconds: number(input.gameSettings?.recruitSeconds, 0, 60, 0),
      countdownSeconds: number(input.gameSettings?.countdownSeconds, 0, 10, 0),
      resultSeconds: number(input.gameSettings?.resultSeconds, 1, 30, 10),
      goal: Math.round(number(input.gameSettings?.goal, 0, 10000, 0)),
      departures: choice(
        input.gameSettings?.departures,
        ['keep', 'reduce'],
        'keep',
      ),
      boosts: Math.round(number(input.gameSettings?.boosts, 0, 5, 0)),
    },
    defaultAvatar: avatarIds.has(input.defaultAvatar)
      ? input.defaultAvatar
      : avatars[0].id,
    avatars,
    rules,
  };
}

module.exports = {
  speechText,
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
  reactionTemplates,
};

function reactionTemplates() {
  const make = (key, name, trigger, steps, extra = {}) => ({
    id: `template-${key}`,
    name,
    trigger,
    aliases: trigger === 'command' ? [`!${name.replaceAll(' ', '')}`] : [],
    enabled: true,
    role: 'everyone',
    cooldown: 3,
    minimum: 0,
    durationFromChat: false,
    durationMode: 'fixed',
    durationStep: 0,
    interrupt: 'replace',
    maxDuration: 120,
    failure: 'stop',
    templateId: key,
    templateVersion: 1,
    steps,
    ...extra,
  });
  const step = (action, duration, value = '', extra = {}) => ({
    action,
    duration,
    value,
    start: 'after',
    completion: 'duration',
    ...extra,
  });
  return [
    make(
      'run-wave',
      '달리고 인사',
      'command',
      [step('run', 5, '3'), step('wave', 2)],
      { durationFromChat: true, durationMode: 'step' },
    ),
    make(
      'float-say',
      '떠오르며 말하기',
      'command',
      [
        step('float', 5, '160'),
        step('say', 5, '{user}입니다!', { start: 'withPrevious' }),
      ],
      { durationFromChat: true, durationMode: 'step' },
    ),
    make(
      'temporary-size',
      '잠깐 커지기',
      'command',
      [step('size', 5, '1.4', { sizeMode: 'temporary' })],
      { interrupt: 'parallel' },
    ),
    make(
      'first-welcome',
      '첫 참여 환영',
      'firstJoin',
      [step('wave', 2), step('say', 3, '{user}님, 반가워요!')],
      { interrupt: 'parallel' },
    ),
    make('approach-wave', '다가가 인사', 'command', [
      step('follow', 8, '', { completion: 'arrival' }),
      step('wave', 2),
    ]),
    make(
      'donation-thanks',
      '후원 감사',
      'donation',
      [
        step('wave', 2),
        step('say', 4, '{user}님, 감사합니다!', { start: 'withPrevious' }),
      ],
      { minimum: 1000, interrupt: 'parallel' },
    ),
  ];
}
