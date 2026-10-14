const Matter = require('matter-js');
const crypto = require('crypto');
const { LIMITS, text, number, speechText } = require('./schema.cjs');
const { hasZalgoText } = require('./text-safety.cjs');
const { Engine, Bodies, Body, Composite } = Matter;
const WIDTH = 1920,
  HEIGHT = 1080;
const lane = (step) =>
  step.action === 'say'
    ? 'speech'
    : step.action === 'size'
      ? 'size'
      : ['wave', 'dance', 'sit'].includes(step.action)
        ? 'pose'
        : 'motion';

class AvatarEngine {
  constructor(config, profiles = {}, options = {}) {
    this.config = config;
    this.profiles = profiles;
    this.externalClock = !!options.now;
    this.clock = Date.now();
    this.wallNow = options.wallNow || options.now || Date.now;
    this.now = options.now || (() => this.clock);
    this.lastTick = performance.now();
    this.random = options.random || Math.random;
    this.scope = '';
    this.actors = new Map();
    this.seen = new Map();
    this.cooldowns = new Map();
    this.tasks = [];
    this.sequences = new Map();
    this.waiting = new Map();
    this.firstJoins = new Set();
    this.diagnostics = [];
    this.sequenceNumber = 0;
    this.actorNumber = 0;
    this.sessionId = crypto.randomUUID();
    this.snapshotSequence = 0;
    this.configRevision = 1;
    this.pausedAt = config.paused ? this.now() : 0;
    this.dirty = false;
    this.stats = { received: 0, ignored: 0, actions: 0 };
    this.game = null;
    this.recent = [];
    this.engine = Engine.create();
    this.engine.gravity.y = 1.2;
    this.setWalls();
    this.budgetAt = 0;
    this.budget = 0;
    this.budgets = {};
  }
  setWalls() {
    if (this.walls) Composite.remove(this.engine.world, this.walls);
    this.ground = HEIGHT - this.config.floor;
    this.walls = [
      Bodies.rectangle(WIDTH / 2, this.ground + 30, WIDTH + 400, 60, {
        isStatic: true,
        collisionFilter: { category: 2 },
      }),
      Bodies.rectangle(
        (this.config.safeLeft || 0) - 30,
        HEIGHT / 2,
        60,
        HEIGHT * 3,
        {
          isStatic: true,
          collisionFilter: { category: 2 },
        },
      ),
      Bodies.rectangle(
        WIDTH - (this.config.safeRight || 0) + 30,
        HEIGHT / 2,
        60,
        HEIGHT * 3,
        {
          isStatic: true,
          collisionFilter: { category: 2 },
        },
      ),
    ];
    Composite.add(this.engine.world, this.walls);
  }
  setConfig(config) {
    if (!this.config.paused && config.paused) this.pausedAt = this.now();
    if (this.config.paused && !config.paused) {
      const elapsed = this.now() - this.pausedAt;
      for (const task of this.tasks) task.at += elapsed;
      for (const sequence of this.sequences.values()) {
        sequence.endsAt += elapsed;
        for (const group of sequence.groups) group.end += elapsed;
        for (const active of sequence.active) {
          active.startedAt += elapsed;
          active.deadline += elapsed;
        }
      }
      for (const [key, until] of this.cooldowns)
        this.cooldowns.set(key, until + elapsed);
      for (const a of this.actors.values()) {
        if (a.flight) a.flight.startedAt += elapsed;
        for (const key of [
          'until',
          'nextWalk',
          'bubbleStartedAt',
          'bubbleUntil',
          'effectUntil',
          'pushedUntil',
          'lastChat',
          'poseUntil',
          'temporaryUntil',
          'animationStartedAt',
        ])
          if (a[key]) a[key] += elapsed;
      }
      if (this.game) {
        this.game.startedAt += elapsed;
        this.game.endsAt += elapsed;
        if (this.game.hideAt) this.game.hideAt += elapsed;
        if (this.game.phaseEndsAt) this.game.phaseEndsAt += elapsed;
        for (const id of Object.keys(this.game.cooldowns))
          this.game.cooldowns[id] += elapsed;
      }
      this.pausedAt = 0;
    }
    const groundChanged = ['floor', 'safeLeft', 'safeRight'].some(
      (key) => this.config[key] !== config[key],
    );
    this.configRevision++;
    this.config = config;
    for (const profile of Object.values(this.profiles)) {
      if (profile.avatarAssignment && !config.avatars.some((v) => v.id === profile.avatarAssignment)) {
        delete profile.avatarAssignment;
        this.dirty = true;
      }
    }
    if (groundChanged) this.setWalls();
    for (const a of this.actors.values()) {
      if (!config.avatars.some((v) => v.id === a.profile.avatar)) {
        a.profile.avatar = config.defaultAvatar;
        if (!a.test) this.dirty = true;
      }
      if (groundChanged) this.resetMotion(a);
      Body.setPosition(a.body, {
        x: Math.max(
          (config.safeLeft || 0) + 30,
          Math.min(WIDTH - (config.safeRight || 0) - 30, a.body.position.x),
        ),
        y: Math.min(a.body.position.y, this.ground - 16),
      });
    }
    while (this.actors.size > config.maxActors)
      this.remove(this.actors.keys().next().value);
    if (!config.enabled) this.clear();
  }
  setScope(scope) {
    if (this.scope === scope) return;
    this.clear();
    this.seen.clear();
    this.cooldowns.clear();
    this.firstJoins.clear();
    this.scope = String(scope || '');
  }
  key(userId, test = false) {
    return crypto
      .createHash('sha256')
      .update(`${test ? 'test' : this.scope}:${userId}`)
      .digest('hex');
  }
  note(message) {
    this.recent.unshift({ at: this.now(), message: text(message, 140) });
    this.recent.length = Math.min(40, this.recent.length);
  }
  diagnose(code, detail = '', event = {}, rule = {}) {
    const result = {
      at: this.now(),
      code,
      detail: text(detail, 160),
      eventId: text(event?.id, 160),
      ruleId: rule?.id || '',
      configRevision: this.configRevision,
      latency: Number.isFinite(Number(event?.at))
        ? Math.max(0, this.wallNow() - Number(event.at))
        : 0,
    };
    this.lastResult = result;
    this.diagnostics.unshift(result);
    this.diagnostics.length = Math.min(
      LIMITS.diagnostics,
      this.diagnostics.length,
    );
    return false;
  }
  reject(code, event, rule, detail = '') {
    this.stats.ignored++;
    return this.diagnose(code, detail, event, rule);
  }
  cancelSequence(id, reason = 'REPLACED') {
    const sequence = this.sequences.get(id);
    if (!sequence) return;
    this.tasks = this.tasks.filter((t) => t.sequence !== id);
    this.sequences.delete(id);
    const actor = this.actors.get(sequence.actorId);
    if (actor) {
      if (actor.motionOwner === id) this.resetMotion(actor);
      if (actor.poseOwner === id) {
        actor.poseUntil = 0;
        actor.pose = '';
      }
      if (actor.sizeOwner === id) actor.temporaryUntil = 0;
      if (actor.speechOwner === id) actor.bubbleUntil = 0;
    }
    this.diagnose(reason, '', sequence.event, sequence.rule);
    this.lastResult.configRevision = sequence.revision;
  }
  remove(id) {
    for (const sequence of [...this.sequences.values()])
      if (sequence.actorId === id)
        this.cancelSequence(sequence.id, 'ACTOR_LEFT');
    const a = this.actors.get(id);
    if (a) Composite.remove(this.engine.world, a.body);
    this.actors.delete(id);
    this.tasks = this.tasks.filter((t) => t.id !== id);
    this.waiting.delete(id);
    if (
      this.game &&
      !this.game.result &&
      this.game.settings?.departures === 'reduce'
    ) {
      this.game.players = this.game.players.filter((key) => key !== id);
      this.game.goal = Math.max(
        this.game.score + 1,
        Math.min(
          this.game.goal,
          this.game.players.length *
            Math.ceil(Math.max(0, this.game.endsAt - this.now()) / 3000) +
            this.game.score,
        ),
      );
    }
  }
  clear(testOnly = false) {
    for (const a of this.actors.values())
      if (!testOnly || a.test) this.remove(a.id);
    if (!testOnly) {
      this.game = null;
      this.waiting.clear();
    }
  }
  resetMotion(actor) {
    if (
      actor.flight &&
      this.now() >= actor.flight.startedAt + actor.flight.duration
    )
      Body.setPosition(actor.body, {
        x: actor.body.position.x,
        y: actor.flight.landY,
      });
    if (actor.body.isStatic) Body.setStatic(actor.body, false);
    actor.flight = null;
    actor.follow = null;
    actor.targetX = null;
    actor.contact = null;
    actor.pushedUntil = 0;
    actor.dx = 0;
    actor.state = 'idle';
    actor.motion = 'idle';
    actor.until = 0;
    actor.nextWalk = this.now() + 1000;
    actor.motionOwner = null;
    Body.setVelocity(actor.body, { x: 0, y: actor.body.velocity.y });
  }
  resetTestActor(userId, avatarId) {
    const id = this.key(userId, true),
      actor = this.actors.get(id);
    for (const sequence of [...this.sequences.values()])
      if (sequence.actorId === id)
        this.cancelSequence(sequence.id, 'TEST_RESET');
    this.tasks = this.tasks.filter((t) => t.id !== id);
    for (const key of this.cooldowns.keys())
      if (key.startsWith(`${id}:`)) this.cooldowns.delete(key);
    if (actor) {
      this.resetMotion(actor);
      if (this.config.avatars.some((a) => a.id === avatarId))
        actor.profile.avatar = avatarId;
    }
  }
  join(event, force = false, triggerRules = true) {
    const key = this.key(event.userId, event.test);
    const existing = this.actors.get(key);
    const profile = existing?.profile ||
      this.profiles[key] || {
        name: '',
        avatar: this.config.defaultAvatar,
        color: '#ffffff',
        scale: 1,
        seen: this.now(),
        wins: 0,
      };
    if (
      profile.blocked ||
      profile.blockedUntil > this.wallNow() ||
      (profile.hidden && !force)
    ) {
      this.diagnose(
        profile.blocked || profile.blockedUntil > this.wallNow()
          ? 'BLOCKED'
          : 'HIDDEN',
        '',
        event,
      );
      return null;
    }
    if (force) profile.hidden = false;
    profile.name = text(event.name, 32) || '시청자';
    profile.seen = this.now();
    if (!this.config.avatars.some((a) => a.id === profile.avatar))
      profile.avatar = this.config.defaultAvatar;
    if (!event.test) {
      profile.scopeKey = this.key('');
      this.profiles[key] = profile;
      this.dirty = true;
      const keys = Object.keys(this.profiles);
      if (keys.length > LIMITS.profiles) {
        const oldest = keys
          .filter(
            (k) =>
              !this.actors.has(k) &&
              !this.profiles[k].avatarAssignment &&
              !this.profiles[k].blocked &&
              !(this.profiles[k].blockedUntil > this.wallNow()),
          )
          .sort((a, b) => this.profiles[a].seen - this.profiles[b].seen);
        for (const k of oldest.slice(0, keys.length - LIMITS.profiles))
          delete this.profiles[k];
      }
    }
    if (existing) return existing;
    if (this.config.newJoins === false && !event.preview) {
      this.diagnose('JOINS_CLOSED', '', event);
      return null;
    }
    if (this.actors.size >= this.config.maxActors) {
      if (this.config.admission === 'replaceIdle') {
        const oldest = [...this.actors.values()]
          .filter(
            (a) =>
              this.now() - a.lastChat > 60000 &&
              !this.game?.players.includes(a.id),
          )
          .sort((a, b) => a.lastChat - b.lastChat)[0];
        if (oldest) this.remove(oldest.id);
      }
      if (this.actors.size >= this.config.maxActors) {
        if (this.config.admission === 'queue' && this.waiting.size < 30)
          this.waiting.set(key, {
            ...event,
            text: '',
            queuedAt: this.wallNow(),
          });
        this.diagnose('ACTOR_LIMIT', '', event);
        return null;
      }
    }
    const body = Bodies.circle(
      (this.config.safeLeft || 0) +
        40 +
        this.random() *
          (WIDTH -
            80 -
            (this.config.safeLeft || 0) -
            (this.config.safeRight || 0)),
      this.ground - 18,
      16,
      {
        friction: 0,
        frictionAir: 0.015,
        restitution: 0.15,
        inertia: Infinity,
        collisionFilter: { category: 1, mask: 2 },
      },
    );
    Composite.add(this.engine.world, body);
    const actor = {
      id: key,
      profile,
      body,
      state: 'idle',
      until: 0,
      nextWalk: this.now() + this.random() * 3000,
      direction: 1,
      dx: 0,
      bubble: '',
      bubbleUntil: 0,
      effect: '',
      effectUntil: 0,
      test: event.test === true,
      lastChat: this.now(),
      number: ++this.actorNumber,
      animationStartedAt: this.now(),
      travelDistance: 0,
      lastX: body.position.x,
    };
    this.actors.set(key, actor);
    const first = !this.firstJoins.has(key);
    this.firstJoins.add(key);
    if (this.firstJoins.size > LIMITS.profiles)
      this.firstJoins.delete(this.firstJoins.values().next().value);
    if (triggerRules)
      for (const rule of this.config.rules.filter((r) => r.trigger === 'join'))
        if (this.runRule(rule, actor, event)) break;
    if (triggerRules && first)
      for (const rule of this.config.rules.filter(
        (r) => r.trigger === 'firstJoin',
      ))
        if (this.runRule(rule, actor, event)) break;
    return actor;
  }
  receive(event) {
    if (!event) return false;
    this.stats.received++;
    if (!this.config.enabled) return this.reject('DISABLED', event);
    if (this.config.paused) return this.reject('PAUSED', event);
    if (!this.scope && !event.test) return this.reject('NO_CHANNEL', event);
    const now = this.now();
    if (
      !event.userId ||
      String(event.userId).length > 160 ||
      !['chat', 'donation', 'subscription'].includes(event.kind)
    )
      return this.reject('INVALID_EVENT', event);
    if (
      !Number.isFinite(Number(event.at)) ||
      Math.abs(this.wallNow() - Number(event.at)) > 30000
    )
      return this.reject('STALE_EVENT', event);
    const eventId = String(event.id || '').slice(0, 160);
    if (!eventId || this.seen.has(eventId))
      return this.reject('DUPLICATE', event);
    if (hasZalgoText(event.text) || hasZalgoText(event.name))
      return this.reject('UNSAFE_TEXT', event);
    const content = text(event.text, 300);
    const [rawCommand, ...rest] = content.split(/\s+/);
    const command = rawCommand.toLowerCase();
    const arg = rest.join(' ');
    const priority = ['!퇴장', '!leave', '!상호작용', '!targeting'].includes(
      command,
    )
      ? 'control'
      : event.kind !== 'chat'
        ? 'paid'
        : content.startsWith('!')
          ? 'command'
          : 'chat';
    if (now - this.budgetAt >= 1000) {
      this.budgetAt = now;
      this.budget = 0;
      this.budgets = {};
    }
    this.budgets[priority] = (this.budgets[priority] || 0) + 1;
    if (
      this.budgets[priority] >
      { control: 60, paid: 120, command: 120, chat: 120 }[priority]
    )
      return this.reject('RATE_LIMIT', event);
    this.seen.set(eventId, now);
    if (this.seen.size > 4096) this.seen.delete(this.seen.keys().next().value);
    const key = this.key(event.userId, event.test);
    const profile = this.profiles[key] || this.actors.get(key)?.profile;
    if (profile?.blocked || profile?.blockedUntil > this.wallNow())
      return this.reject('BLOCKED', event);
    if (['!퇴장', '!leave'].includes(command)) {
      if (profile) {
        profile.hidden = true;
        profile.seen = now;
        if (!event.test) this.dirty = true;
      }
      this.remove(key);
      this.diagnose('LEFT', '', event);
      return true;
    }
    const isJoin = ['!입장', '!join'].includes(command);
    const actor =
      this.actors.get(key) ||
      (this.config.autoJoin || isJoin ? this.join(event, isJoin) : null);
    if (!actor)
      return this.reject(
        this.lastResult?.eventId === event.id
          ? this.lastResult.code
          : 'NOT_JOINED',
        event,
      );
    actor.profile.name = text(event.name, 32) || actor.profile.name;
    actor.profile.seen = now;
    actor.lastChat = now;
    if (!actor.test) this.dirty = true;
    if (
      this.config.bubbles &&
      event.kind === 'chat' &&
      !content.startsWith('!')
    )
      this.say(actor, content, this.config.bubbleDuration ?? 6, this.config.bubbleMaxLength ?? 72);
    const controlKey = `${key}:control`;
    const customControl =
      [
        '!상호작용',
        '!targeting',
        '!참가',
        '!participate',
        '!부스트',
        '!boost',
      ].includes(command) &&
      this.config.rules.some(
        (r) => r.trigger === 'command' && r.aliases.includes(command),
      );
    if (
      !customControl &&
      [
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
        '!상호작용',
        '!targeting',
        '!참가',
        '!participate',
        '!부스트',
        '!boost',
      ].includes(command)
    ) {
      if ((this.cooldowns.get(controlKey) || 0) > now && priority !== 'control')
        return this.reject('COOLDOWN', event);
      this.cooldowns.set(controlKey, now + 1000);
      if (['!캐릭터', '!avatar'].includes(command)) {
        const avatar = this.config.avatars.find(
          (a) => a.name.toLowerCase() === arg.toLowerCase() || a.id === arg,
        );
        if (avatar) actor.profile.avatar = avatar.id;
        else this.say(actor, this.config.avatars.map((a) => a.name).join(', '));
      } else if (
        ['!색', '!color'].includes(command) &&
        /^#[a-f0-9]{6}$/i.test(arg)
      )
        actor.profile.color = arg;
      else if (['!크기', '!size'].includes(command))
        actor.profile.scale = number(arg, 0.5, 1.6, 1);
      else if (['!상호작용', '!targeting'].includes(command)) {
        if (!['on', 'off', '켜기', '끄기'].includes(arg.toLowerCase()))
          return this.reject('INVALID_ARGUMENT', event);
        actor.profile.targeting = ['on', '켜기'].includes(arg.toLowerCase());
      } else if (['!참가', '!participate'].includes(command))
        return this.participate(actor);
      else if (['!부스트', '!boost'].includes(command))
        return this.boost(actor);
      else if (['!응원', '!cheer'].includes(command)) this.cheer(actor);
      else if (['!도움말', '!help'].includes(command))
        this.say(
          actor,
          '!입장 · !퇴장 · !점프 · !달리기 5 · !부양 5 · !캐릭터 이름 · !응원',
        );
      this.diagnose('CONTROL_APPLIED', '', event);
      return true;
    }
    const matching = this.config.rules.filter(
      (rule) =>
        rule.trigger === 'command' &&
        event.kind === 'chat' &&
        rule.aliases.includes(command),
    );
    const candidates = matching.length
      ? matching
      : this.config.rules.filter((rule) => rule.trigger === event.kind);
    let applied = false;
    for (const rule of candidates) {
      if (
        this.runRule(rule, actor, {
          ...event,
          targetName: arg.replace(/^@/, ''),
        })
      ) {
        applied = true;
        break;
      }
    }
    if (!candidates.length) this.diagnose('NO_RULE', '', event);
    return applied || !candidates.length;
  }
  say(actor, message, duration = 5, maxLength = 100) {
    const content = speechText(message, maxLength);
    if (!content) return;
    actor.speechOwner = null;
    actor.bubble = content;
    actor.bubbleStartedAt = this.now();
    actor.bubbleUntil = this.now() + number(duration, 0.1, LIMITS.duration, 5) * 1000;
  }
  target(actor, name) {
    if (
      !this.config.allowTargeting ||
      actor.profile.targeting === false ||
      !name
    )
      return null;
    const found = [...this.actors.values()].filter(
      (a) =>
        a.id !== actor.id &&
        a.profile.targeting !== false &&
        (a.profile.name === name || `#${a.number}` === name),
    );
    return found.length === 1 ? found[0] : null;
  }
  runRule(rule, actor, event) {
    if (!rule.enabled) return this.reject('RULE_DISABLED', event, rule);
    if (
      (rule.role === 'owner' && event.role !== 'owner') ||
      (rule.role === 'moderator' &&
        !['owner', 'moderator'].includes(event.role))
    )
      return this.reject('ROLE_DENIED', event, rule);
    if (rule.trigger === 'donation' && Number(event.amount || 0) < rule.minimum)
      return this.reject('MINIMUM_AMOUNT', event, rule);
    const now = this.now(),
      key = `${actor.id}:${rule.id}`;
    if ((this.cooldowns.get(key) || 0) > now)
      return this.reject('COOLDOWN', event, rule);
    let argument = text(event.targetName, 100),
      durationArgument;
    const needsTarget = rule.steps.some((s) =>
      ['follow', 'push', 'highfive'].includes(s.action),
    );
    if (
      (rule.durationFromChat && !rule.durationMode) || rule.durationMode === 'legacyAllSteps' ||
      rule.durationMode === 'step'
    ) {
      const match = argument.match(/(?:^|\s)(\d+(?:\.\d+)?)(?:초|s)?$/i);
      if (match) {
        durationArgument = number(match[1], 0.1, LIMITS.duration, 5);
        argument = argument.slice(0, match.index).trim();
        if (Number(match[1]) !== durationArgument)
          this.diagnose('DURATION_CLAMPED', `${durationArgument}`, event, rule);
      } else if (argument && !needsTarget)
        return this.reject('INVALID_ARGUMENT', event, rule);
    }
    const targetName = argument.replace(/^@/, '').replace(/^"(.*)"$/, '$1');
    if (needsTarget && !this.target(actor, targetName)) {
      const duplicate =
        [...this.actors.values()].filter((a) => a.profile.name === targetName)
          .length > 1;
      return this.reject(
        !this.config.allowTargeting || actor.profile.targeting === false
          ? 'TARGETING_DISABLED'
          : duplicate
            ? 'TARGET_AMBIGUOUS'
            : 'TARGET_MISSING',
        event,
        rule,
      );
    }
    const interrupt = rule.interrupt || 'replace';
    const owned = [...this.sequences.values()].filter(
      (s) => s.actorId === actor.id,
    );
    if (
      (interrupt !== 'replace' && owned.length >= LIMITS.pendingPerActor) ||
      this.sequences.size >= LIMITS.pending
    )
      return this.reject('QUEUE_FULL', event, rule);
    const steps = rule.steps.map((s, i) => ({
      ...s,
      duration:
        durationArgument !== undefined &&
        (rule.durationMode === 'legacyAllSteps' ||
          !rule.durationMode ||
          i === (rule.durationStep || 0))
          ? durationArgument
          : number(
              s.duration,
              0.1,
              120,
              ['run', 'float'].includes(s.action) ? 5 : 2,
            ),
    }));
    if (
      this.game?.phase === 'running' &&
      this.game.type === 'race' &&
      this.game.players.includes(actor.id) &&
      steps.some((s) => lane(s) === 'motion' && s.action !== 'jump')
    )
      return this.reject('GAME_OWNS_MOTION', event, rule);
    if (
      interrupt === 'parallel' &&
      steps.some((s) => lane(s) === 'motion') &&
      (actor.until > now || owned.some((s) => s.lanes.has('motion')))
    )
      return this.reject('LANE_BUSY', event, rule);
    let offset = 0,
      previousStart = 0,
      previousEnd = 0;
    let invalidLanes = false;
    let groupIndex = -1;
    const groupLanes = new Set();
    const planned = steps.map((step, index) => {
      const start =
        index && step.start === 'withPrevious' ? previousStart : previousEnd;
      if (!index || step.start !== 'withPrevious') {
        groupLanes.clear();
        groupIndex++;
      }
      if (groupLanes.has(lane(step))) invalidLanes = true;
      groupLanes.add(lane(step));
      previousStart = start;
      previousEnd = Math.max(previousEnd, start + step.duration * 1000);
      offset = Math.max(offset, previousEnd);
      return { step, offset: start, index, group: groupIndex };
    });
    if (invalidLanes) return this.reject('LANE_CONFLICT', event, rule);
    if (
      interrupt === 'parallel' &&
      owned.some((s) =>
        [...s.lanes].some((name) => steps.some((step) => lane(step) === name)),
      )
    )
      return this.reject('LANE_BUSY', event, rule);
    if (offset > (rule.maxDuration || 960) * 1000)
      return this.reject('DURATION_LIMIT', event, rule);
    if (interrupt === 'replace') {
      for (const s of owned) this.cancelSequence(s.id);
      this.resetMotion(actor);
    }
    const at =
      interrupt === 'queue'
        ? Math.max(now, ...owned.map((s) => s.endsAt))
        : now;
    const id = ++this.sequenceNumber;
    const sequence = {
      id,
      actorId: actor.id,
      rule: structuredClone(rule),
      event: { id: event.id, at: event.at },
      revision: this.configRevision,
      endsAt: at + offset,
      active: [],
      lanes: new Set(steps.map(lane)),
      interrupt,
      predecessors: interrupt === 'queue' ? owned.map((s) => s.id) : [],
      queued: interrupt === 'queue' && owned.length > 0,
      groups: Array.from({ length: groupIndex + 1 }, (_, group) => ({
        end:
          at +
          Math.max(
            ...planned
              .filter((p) => p.group === group)
              .map((p) => p.offset + p.step.duration * 1000),
          ),
        dynamic: planned.some(
          (p) =>
            p.group === group &&
            p.step.completion &&
            p.step.completion !== 'duration',
        ),
        pending: planned.filter((p) => p.group === group).length,
        hasMotion: planned.some((p) => p.group === group && lane(p.step) === 'motion'),
        started: false,
        done: false,
      })),
      pending: planned.length,
    };
    this.sequences.set(id, sequence);
    for (const item of planned)
      this.tasks.push({
        id: actor.id,
        sequence: id,
        step: item.step,
        index: item.index,
        group: item.group,
        at: at + item.offset,
        target: targetName,
      });
    this.cooldowns.set(key, now + rule.cooldown * 1000);
    this.diagnose('QUEUED', '', event, rule);
    this.note(`${actor.profile.name}: ${rule.name}`);
    return true;
  }
  action(actor, step, targetName = '', sequence = null) {
    const now = this.now();
    const target = this.target(actor, targetName);
    const racing =
      this.game?.type === 'race' &&
      this.game.phase === 'running' &&
      this.game.players.includes(actor.id);
    if (step.action === 'say') {
      this.stats.actions++;
      this.say(
        actor,
        step.value
          .replaceAll('{user}', actor.profile.name)
          .replaceAll('{target}', target?.profile.name || ''),
      );
      actor.speechOwner = sequence?.id;
      actor.bubbleUntil =
        now + number(step.duration, 0.1, LIMITS.duration, 5) * 1000;
      return true;
    }
    if (step.action === 'size') {
      this.stats.actions++;
      if (step.sizeMode === 'temporary') {
        actor.temporaryScale = number(step.value, 0.5, 1.6, 1);
        actor.temporaryUntil = now + step.duration * 1000;
        actor.sizeOwner = sequence?.id;
      } else {
        actor.profile.scale = number(step.value, 0.5, 1.6, 1);
        if (!actor.test) this.dirty = true;
      }
      return true;
    }
    if (racing && lane(step) === 'motion' && step.action !== 'jump')
      return this.diagnose(
        'GAME_OWNS_MOTION',
        '',
        sequence?.event,
        sequence?.rule,
      );
    if (
      lane(step) === 'pose' &&
      (sequence?.interrupt === 'parallel' ||
        sequence?.groups[sequence.currentGroup]?.hasMotion ||
        sequence?.active.some((s) => lane(s.step) === 'motion'))
    ) {
      if (
        step.action !== 'wave' &&
        (sequence?.groups[sequence.currentGroup]?.hasMotion || (actor.until > now &&
        ['run', 'walk', 'float', 'jump'].includes(actor.motion)))
      )
        return this.diagnose(
          'POSE_CONFLICT',
          '',
          sequence.event,
          sequence.rule,
        );
      this.stats.actions++;
      actor.pose = step.action;
      actor.poseUntil = now + step.duration * 1000;
      actor.poseOwner = sequence.id;
      return true;
    }
    if (step.action === 'wait' && step.waitMode === 'continue') {
      this.stats.actions++;
      return true;
    }
    if (['follow', 'highfive', 'push'].includes(step.action)) {
      if (!target)
        return this.diagnose(
          'TARGET_MISSING',
          '',
          sequence?.event,
          sequence?.rule,
        );
      const pair = `pair:${actor.id}:${target.id}`;
      if ((this.cooldowns.get(pair) || 0) > now)
        return this.diagnose(
          'TARGET_COOLDOWN',
          '',
          sequence?.event,
          sequence?.rule,
        );
      this.cooldowns.set(pair, now + 3000);
    }
    this.resetMotion(actor);
    this.stats.actions++;
    actor.motionOwner = sequence?.id;
    if (step.action === 'jump') {
      if (actor.body.position.y >= this.ground - 24)
        Body.setVelocity(actor.body, {
          x: actor.body.velocity.x,
          y: -number(step.jumpStrength, 4, 20, 12),
        });
      actor.state = 'jump';
      actor.motion = 'jump';
      actor.until = now + 900;
      return true;
    }
    if (step.action === 'float') {
      const duration = number(step.duration, 0.1, LIMITS.duration, 5) * 1000;
      const height = number(step.value, 30, 500, 160);
      const landY = this.ground - 16;
      const topY = Math.max((this.config.safeTop || 0) + this.config.size, landY - height);
      if (landY - topY < height) this.diagnose('HEIGHT_CLAMPED', `${height} -> ${Math.max(0, landY-topY)}`, sequence?.event, sequence?.rule);
      actor.flight = {
        startedAt: now,
        duration,
        edge: Math.min(
          step.legacyTiming ? 1200 : duration,
          (duration * number(step.risePercent, 0, 45, 25)) / 100,
        ),
        fall: Math.min(
          step.legacyTiming ? 1200 : duration,
          (duration * number(step.fallPercent, 0, 45, 25)) / 100,
        ),
        fromY: actor.body.position.y,
        topY,
        landY,
      };
      Body.setStatic(actor.body, true);
      Body.setVelocity(actor.body, { x: 0, y: 0 });
      actor.state = 'float';
    } else if (['follow', 'highfive', 'push'].includes(step.action)) {
      actor.follow = target.id;
      if (step.action !== 'follow') {
        actor.targetX =
          target.body.position.x +
          (actor.body.position.x < target.body.position.x ? -65 : 65);
        actor.contact = { type: step.action, target: target.id };
      }
      actor.state = 'walk';
    } else if (step.action === 'gather') {
      actor.targetX = WIDTH / 2;
      actor.state = 'walk';
    } else if (step.action === 'walk' || step.action === 'run') {
      actor.dx =
        step.action === 'run'
          ? actor.direction
          : Number(step.value) < 0
            ? -1
            : 1;
      actor.runSpeed = number(step.value, 1.5, 6, 3);
      actor.state = step.action;
    } else actor.state = step.action === 'wait' ? 'idle' : step.action;
    actor.until = now + step.duration * 1000;
    actor.motion = actor.state;
    actor.nextWalk = actor.until + 1000;
    return true;
  }
  processTasks() {
    const now = this.now();
    for (const sequence of [...this.sequences.values()]) {
      const actor = this.actors.get(sequence.actorId);
      if (!actor) {
        this.cancelSequence(sequence.id, 'ACTOR_LEFT');
        continue;
      }
      for (const active of [...sequence.active]) {
        let complete = now >= active.deadline;
        if (
          active.step.completion === 'landing' &&
          active.step.action === 'jump'
        )
          complete =
            now > active.startedAt &&
            actor.body.position.y >= this.ground - 24 &&
            Math.abs(actor.body.velocity.y) < 2;
        if (active.step.completion === 'arrival') {
          const target = active.target
            ? this.target(actor, active.target)
            : null;
          if (active.target && !target) {
            if (sequence.rule.failure !== 'skip') {
              this.cancelSequence(sequence.id, 'TARGET_MISSING');
              break;
            }
            complete = true;
          } else
            complete =
              Math.abs(
                (target?.body.position.x ?? WIDTH / 2) - actor.body.position.x,
              ) <= 80 &&
              (!target ||
                Math.abs(target.body.position.y - actor.body.position.y) < 60);
        }
        if (!complete && now >= active.deadline) {
          if (sequence.rule.failure !== 'skip') {
            this.cancelSequence(sequence.id, 'STEP_TIMEOUT');
            break;
          }
          complete = true;
        }
        if (complete) {
          if (active.step.completion && active.step.completion !== 'duration') {
            if (
              actor.motionOwner === sequence.id &&
              lane(active.step) === 'motion'
            )
              this.resetMotion(actor);
          }
          sequence.active = sequence.active.filter((a) => a !== active);
        }
      }
      if (!this.sequences.has(sequence.id)) continue;
      for (const [index, group] of sequence.groups.entries()) {
        if (
          group.done ||
          !group.started ||
          group.pending ||
          sequence.active.some((active) => active.group === index)
        )
          continue;
        group.done = true;
        if (!group.dynamic) continue;
        const shift = now - group.end;
        for (const task of this.tasks)
          if (task.sequence === sequence.id && task.group > index)
            task.at += shift;
        for (const later of sequence.groups.slice(index + 1))
          later.end += shift;
        sequence.endsAt += shift;
      }
      if (sequence.predecessors.some((id) => this.sequences.has(id))) continue;
      if (sequence.queued) {
        const shift =
          now -
          Math.min(
            ...this.tasks
              .filter((t) => t.sequence === sequence.id)
              .map((t) => t.at),
          );
        for (const task of this.tasks)
          if (task.sequence === sequence.id) task.at += shift;
        for (const group of sequence.groups) group.end += shift;
        sequence.endsAt += shift;
        sequence.queued = false;
      }
      const due = this.tasks.filter(
        (t) => t.sequence === sequence.id && t.at <= now,
      );
      for (const task of due) {
        if (task.at > now) continue;
        if (sequence.active.some((active) => active.group < task.group)) break;
        this.tasks = this.tasks.filter((t) => t !== task);
        sequence.pending--;
        sequence.groups[task.group].pending--;
        sequence.groups[task.group].started = true;
        // Start from the current simulation frame after lag, never replay all overdue steps at once.
        if (now > task.at) {
          const lag = now - task.at;
          for (const next of this.tasks)
            if (next.sequence === sequence.id && next.index > task.index)
              next.at += lag;
          sequence.endsAt += lag;
          for (const group of sequence.groups.slice(task.group))
            group.end += lag;
        }
        sequence.currentGroup = task.group;
        if (!this.action(actor, task.step, task.target, sequence)) {
          if (sequence.rule.failure !== 'skip') {
            this.cancelSequence(
              sequence.id,
              this.lastResult?.code || 'STEP_FAILED',
            );
            break;
          }
        } else {
          sequence.active.push({
            step: task.step,
            target: task.target,
            index: task.index,
            group: task.group,
            startedAt: now,
            deadline: now + task.step.duration * 1000,
          });
          this.diagnose('EXECUTED', '', sequence.event, sequence.rule);
          this.lastResult.configRevision = sequence.revision;
        }
      }
      if (!sequence.pending && !sequence.active.length)
        this.sequences.delete(sequence.id);
    }
  }
  cheer(actor) {
    this.action(actor, { action: 'jump' });
    if (
      this.game?.type !== 'cheer' ||
      this.game.phase !== 'running' ||
      !this.game.players.includes(actor.id)
    )
      return;
    if ((this.game.cooldowns[actor.id] || 0) > this.now()) return;
    this.game.cooldowns[actor.id] = this.now() + 3000;
    this.game.score++;
    if (this.game.score >= this.game.goal) this.finishGame('공동 응원 성공!');
  }
  participate(actor) {
    if (!this.game || this.game.phase !== 'recruit')
      return this.diagnose('GAME_JOIN_CLOSED');
    if (!this.game.players.includes(actor.id)) this.game.players.push(actor.id);
    this.diagnose('GAME_JOINED');
    return true;
  }
  boost(actor) {
    const game = this.game;
    if (
      !game ||
      game.phase !== 'running' ||
      game.type !== 'race' ||
      !game.players.includes(actor.id)
    )
      return this.diagnose('NO_ACTIVE_RACE');
    const used = game.boosts[actor.id] || 0;
    if (used >= game.settings.boosts) return this.diagnose('BOOST_LIMIT');
    game.boosts[actor.id] = used + 1;
    game.speeds[actor.id] = Math.min(4, game.speeds[actor.id] + 0.2);
    this.diagnose('BOOST_APPLIED');
    return true;
  }
  startGame(type, duration, options = {}) {
    if (!this.config.enabled || this.config.paused)
      throw new Error('아바타를 실행한 상태에서 시작해 주세요.');
    if (!['race', 'cheer'].includes(type))
      throw new Error('지원하지 않는 게임입니다.');
    if (this.game && !this.game.result)
      throw new Error('이미 게임이 진행 중입니다.');
    const players = [...this.actors.values()];
    const settings = {
      duration: 30,
      recruitSeconds: 0,
      countdownSeconds: 0,
      resultSeconds: 10,
      goal: 0,
      departures: 'keep',
      boosts: 0,
      ...this.config.gameSettings,
      ...options,
    };
    settings.duration = number(duration ?? settings.duration, 10, 120, 30);
    settings.recruitSeconds = number(settings.recruitSeconds, 0, 60, 0);
    settings.countdownSeconds = number(settings.countdownSeconds, 0, 10, 0);
    settings.resultSeconds = number(settings.resultSeconds, 1, 30, 10);
    settings.boosts = Math.round(number(settings.boosts, 0, 5, 0));
    settings.goal = Math.round(number(settings.goal, 0, 10000, 0));
    if (!players.length && !settings.recruitSeconds)
      throw new Error(
        '참여자가 없습니다. 테스트 채팅 또는 실제 채팅으로 입장해 주세요.',
      );
    if (
      type === 'cheer' &&
      !settings.recruitSeconds &&
      settings.goal > players.length * Math.ceil(settings.duration / 3)
    )
      throw new Error(
        '참가 인원과 제한 시간으로 달성할 수 없는 응원 목표입니다.',
      );
    const phase = settings.recruitSeconds
      ? 'recruit'
      : settings.countdownSeconds
        ? 'countdown'
        : 'running';
    this.game = {
      type,
      startedAt: this.now(),
      endsAt:
        this.now() +
        (settings.recruitSeconds +
          settings.countdownSeconds +
          settings.duration) *
          1000,
      phase,
      phaseEndsAt:
        this.now() +
        (phase === 'recruit'
          ? settings.recruitSeconds
          : phase === 'countdown'
            ? settings.countdownSeconds
            : settings.duration) *
          1000,
      settings,
      boosts: {},
      players: phase === 'recruit' ? [] : players.map((a) => a.id),
      score: 0,
      goal:
        settings.goal ||
        Math.min(
          Math.max(5, players.length * 3),
          players.length * Math.ceil(settings.duration / 3),
        ),
      cooldowns: {},
      result: '',
      speeds: {},
    };
    if (phase === 'running') this.beginGame();
    this.note(type === 'race' ? '달리기 시작' : '공동 응원 시작');
  }
  beginGame() {
    const game = this.game;
    game.players = game.players.filter((id) => this.actors.has(id));
    if (!game.players.length) {
      this.finishGame('참여자가 없어 종료되었습니다.');
      return;
    }
    if (game.type === 'cheer') {
      const reachable =
        game.players.length * Math.ceil(game.settings.duration / 3);
      if (game.settings.goal > reachable) {
        this.finishGame('달성할 수 없는 목표로 취소되었습니다.');
        return;
      }
      game.goal =
        game.settings.goal ||
        Math.min(Math.max(5, game.players.length * 3), reachable);
    }
    game.phase = 'running';
    game.startedAt = this.now();
    game.endsAt = this.now() + game.settings.duration * 1000;
    game.phaseEndsAt = game.endsAt;
    for (const id of game.players) {
      const a = this.actors.get(id);
      for (const sequence of [...this.sequences.values()])
        if (sequence.actorId === id)
          this.cancelSequence(sequence.id, 'GAME_STARTED');
      this.resetMotion(a);
      this.game.speeds[a.id] = 1.7 + this.random() * 1.3;
      if (game.type === 'race')
        Body.setPosition(a.body, {
          x: (this.config.safeLeft || 0) + 55 + this.random() * 15,
          y: this.ground - 16,
        });
    }
  }
  finishGame(result, winner) {
    if (!this.game || this.game.result) return;
    this.game.result = result;
    this.game.endsAt = this.now();
    this.game.phase = 'result';
    this.game.hideAt =
      this.now() + (this.game.settings?.resultSeconds || 10) * 1000;
    this.game.phaseEndsAt = this.game.hideAt;
    if (winner) {
      winner.profile.wins = (winner.profile.wins || 0) + 1;
      if (!winner.test) this.dirty = true;
      this.say(winner, '1위!');
    }
    for (const a of this.actors.values()) {
      if (!this.game.players.includes(a.id)) continue;
      this.resetMotion(a);
      a.until = this.now() + 2000;
      a.state = 'wave';
      a.motion = 'wave';
    }
    this.note(result);
  }
  advance(milliseconds = 1000 / 30) {
    const wasPaused = this.config.paused;
    if (wasPaused) this.setConfig({ ...this.config, paused: false });
    const total = number(milliseconds, 1, 5000, 1000 / 30);
    for (let elapsed = 0; elapsed < total; elapsed += 1000 / 30)
      this.tick(Math.min(1000 / 30, total - elapsed));
    if (wasPaused) this.setConfig({ ...this.config, paused: true });
  }
  tick(delta) {
    const monotonic = performance.now();
    let dt =
      delta ?? (this.externalClock ? 1000 / 30 : monotonic - this.lastTick);
    this.lastTick = monotonic;
    if (!this.externalClock && dt > 1000) {
      this.diagnose('SUSPEND_GAP', `${Math.round(dt)}ms`);
      if (this.game && !this.game.result)
        this.finishGame('시스템 대기로 게임이 중단되었습니다.');
      dt = 0;
    }
    dt = Math.min(100, Math.max(0, dt));
    if (!this.externalClock) this.clock += dt;
    if (!this.config.enabled || this.config.paused) return;
    const now = this.now();
    this.processTasks();
    for (const [key, event] of this.waiting) {
      if (this.wallNow() - event.queuedAt > 30000) {
        this.waiting.delete(key);
        continue;
      }
      if (this.actors.size >= this.config.maxActors) break;
      this.waiting.delete(key);
      this.join(event, false);
    }
    if (
      this.game &&
      !this.game.result &&
      this.game.phase !== 'running' &&
      now >= this.game.phaseEndsAt
    ) {
      if (
        this.game.phase === 'recruit' &&
        this.game.settings.countdownSeconds
      ) {
        this.game.phase = 'countdown';
        this.game.phaseEndsAt =
          now + this.game.settings.countdownSeconds * 1000;
      } else this.beginGame();
    }
    for (const [key, until] of this.cooldowns)
      if (until < now) this.cooldowns.delete(key);
    for (const a of this.actors.values()) {
      if (now - a.lastChat > this.config.idleMinutes * 60000) {
        this.remove(a.id);
        continue;
      }
      if (a.flight) {
        const f = a.flight,
          elapsed = now - f.startedAt;
        const ease = (v) => {
          const t = Math.max(0, Math.min(1, v));
          return t * t * (3 - 2 * t);
        };
        let y;
        if (elapsed < f.edge)
          y = f.fromY + (f.topY - f.fromY) * ease(elapsed / f.edge);
        else if (elapsed < f.duration - f.fall) {
          const progress = (elapsed - f.edge) / (f.duration - f.edge - f.fall);
          y =
            f.topY +
            Math.sin(progress * Math.PI) ** 2 *
              Math.sin((elapsed - f.edge) / 400) *
              5;
        } else
          y =
            f.topY +
            (f.landY - f.topY) *
              ease(f.fall ? (elapsed - f.duration + f.fall) / f.fall : 1);
        Body.setPosition(a.body, { x: a.body.position.x, y });
        if (elapsed < f.duration) {
          a.state = 'float';
          continue;
        }
        this.resetMotion(a);
        Body.setVelocity(a.body, { x: 0, y: 0 });
      }
      let vx = 0;
      const racing =
        this.game?.type === 'race' &&
        this.game.phase === 'running' &&
        !this.game.result &&
        this.game.players.includes(a.id);
      if (racing) {
        vx = this.game.speeds[a.id] * 2;
        a.state = 'run';
      } else if (a.until > now) {
        a.state = a.motion || a.state;
        if (a.follow) {
          const target = this.actors.get(a.follow);
          if (
            !target ||
            target.profile.targeting === false ||
            !this.config.allowTargeting ||
            a.profile.targeting === false
          ) {
            const owner = a.motionOwner;
            this.resetMotion(a);
            if (owner) this.cancelSequence(owner, 'TARGET_MISSING');
          } else
            a.targetX =
              target.body.position.x +
              (a.body.position.x < target.body.position.x ? -60 : 60);
        }
        if (a.targetX != null) {
          const distance = a.targetX - a.body.position.x;
          vx =
            Math.abs(distance) > 12
              ? Math.sign(distance) * this.config.speed * 2
              : 0;
          if (!vx && a.contact) {
            const target = this.actors.get(a.contact.target);
            if (
              target &&
              Math.abs(target.body.position.x - a.body.position.x) < 140 &&
              Math.abs(target.body.position.y - a.body.position.y) < 60
            ) {
              const pushing = a.contact.type === 'push';
              target.effect = pushing ? 'push' : 'highfive';
              target.effectUntil = now + 1200;
              a.effect = target.effect;
              a.effectUntil = now + 1200;
              if (pushing) {
                this.resetMotion(target);
                target.pushedUntil = now + 500;
                Body.setVelocity(target.body, {
                  x: a.body.position.x < target.body.position.x ? 9 : -9,
                  y: -5,
                });
              }
            }
            a.contact = null;
          }
          if (!vx) a.state = 'idle';
          else a.state = 'walk';
        } else if (a.state === 'walk' || a.state === 'run') {
          if (a.body.position.x < (this.config.safeLeft || 0) + 50) a.dx = 1;
          if (a.body.position.x > WIDTH - (this.config.safeRight || 0) - 50)
            a.dx = -1;
          vx =
            a.dx * this.config.speed * 2 * (a.state === 'run' ? a.runSpeed : 1);
        }
      } else {
        a.follow = null;
        a.targetX = null;
        a.contact = null;
        if (now > a.nextWalk) {
          a.dx = this.random() < 0.3 ? 0 : this.random() < 0.5 ? -1 : 1;
          a.nextWalk = now + 1200 + this.random() * 3500;
        }
        if (a.body.position.x < (this.config.safeLeft || 0) + 50) a.dx = 1;
        if (a.body.position.x > WIDTH - (this.config.safeRight || 0) - 50)
          a.dx = -1;
        vx = a.dx * this.config.speed;
        a.state = vx ? 'walk' : 'idle';
      }
      if (vx) a.direction = Math.sign(vx);
      if (!(a.pushedUntil > now))
        Body.setVelocity(a.body, { x: vx, y: a.body.velocity.y });
      if (a.pushedUntil > now) a.state = 'hit';
      else if (a.body.position.y < this.ground - 28) a.state = 'jump';
      if (a.body.position.y > HEIGHT + 100)
        Body.setPosition(a.body, { x: WIDTH / 2, y: this.ground - 18 });
    }
    for (let i = 0; i < Math.ceil(dt / (1000 / 60)); i++)
      Engine.update(this.engine, dt / Math.ceil(dt / (1000 / 60)));
    for (const a of this.actors.values()) {
      a.travelDistance += Math.abs(a.body.position.x - a.lastX);
      a.lastX = a.body.position.x;
      const visibleState =
        a.poseUntil > now && ['idle', 'walk', 'run'].includes(a.state)
          ? a.pose
          : a.state;
      if (visibleState !== a.previousState) {
        a.animationStartedAt = now;
        a.previousState = visibleState;
      }
    }
    if (this.game && !this.game.result && this.game.phase === 'running') {
      const players = this.game.players
        .map((id) => this.actors.get(id))
        .filter(Boolean);
      if (!players.length) this.finishGame('참여자가 없어 종료되었습니다.');
      else if (
        this.game.type === 'race' &&
        (now >= this.game.endsAt ||
          players.some(
            (a) =>
              a.body.position.x > WIDTH - (this.config.safeRight || 0) - 100,
          ))
      ) {
        const winner = players.sort(
          (a, b) => b.body.position.x - a.body.position.x,
        )[0];
        this.finishGame(`${winner.profile.name} 1위!`, winner);
      } else if (now >= this.game.endsAt)
        this.finishGame(`응원 종료: ${this.game.score} / ${this.game.goal}`);
    }
    if (this.game?.hideAt < now) this.game = null;
  }
  moderate(action, id, options = {}) {
    const actor = this.actors.get(id),
      profile = actor?.profile || this.profiles[id];
    if (!profile) throw new Error('시청자를 찾을 수 없습니다.');
    if (action === 'block') profile.blocked = true;
    else if (action === 'targeting') profile.targeting = typeof options.allowed === 'boolean' ? options.allowed : profile.targeting === false;
    else if (action === 'timeout')
      profile.blockedUntil =
        this.wallNow() + number(options.minutes, 1, 10080, 10) * 60000;
    else if (action === 'unblock') {
      profile.blocked = false;
      profile.blockedUntil = 0;
      profile.hidden = false;
    } else if (action === 'forget') delete this.profiles[id];
    else if (action === 'remove') profile.hidden = true;
    else throw new Error('지원하지 않는 관리 동작입니다.');
    if (!['unblock', 'targeting'].includes(action)) this.remove(id);
    this.dirty = true;
  }
  snapshot() {
    const now = this.config.paused ? this.pausedAt : this.now();
    return {
      at: now,
      protocolVersion: 3,
      sessionId: this.sessionId,
      sequence: ++this.snapshotSequence,
      configRevision: this.configRevision,
      simulationTime: now,
      width: WIDTH,
      height: HEIGHT,
      enabled: this.config.enabled,
      paused: this.config.paused,
      showNames: this.config.showNames,
      outputHidden: this.config.outputHidden,
      safeLeft: this.config.safeLeft || 0,
      safeRight: this.config.safeRight || 0,
      safeTop: this.config.safeTop || 0,
      nameSize: this.config.nameSize || 20,
      nameLimit: this.config.nameLimit ?? 150,
      namesMode: this.config.namesMode || 'always',
      bubbleLimit: this.config.bubbleLimit ?? 10,
      bubbleSize: this.config.bubbleSize ?? 22,
      gameBottom: this.config.gameBottom ?? 245,
      ground: this.ground,
      previewHeight: Math.min(
        HEIGHT,
        Math.max(
          360,
          this.config.floor +
            this.config.size * 1.6 +
            70 +
            Math.max(
              200,
              ...this.config.rules.flatMap((r) =>
                r.steps
                  .filter((s) => s.action === 'float')
                  .map((s) => number(s.value, 30, 500, 160)),
              ),
            ),
        ),
      ),
      avatars: this.config.avatars,
      actors: [...this.actors.values()].map((a) => ({
        id: a.id,
        number: a.number,
        name: a.profile.name,
        avatar: this.config.avatars.some((v) => v.id === a.profile.avatarAssignment) ? a.profile.avatarAssignment : a.profile.avatar,
        color: a.profile.color,
        size:
          this.config.size *
          (a.temporaryUntil > now ? a.temporaryScale : a.profile.scale),
        temporaryScale: a.temporaryUntil > now ? a.temporaryScale : null,
        x: a.body.position.x,
        y: a.body.position.y + 16,
        direction: a.direction,
        state:
          a.poseUntil > now && ['idle', 'walk', 'run'].includes(a.state)
            ? a.pose
            : a.state,
        animationStartedAt: a.animationStartedAt,
        travelDistance: a.travelDistance,
        lastChat: a.lastChat,
        targeting: a.profile.targeting !== false,
        animationRate: a.state === 'run' ? 1.7 : 1,
        bubble: a.bubbleUntil > now ? a.bubble : '',
        bubbleStartedAt: a.bubbleStartedAt,
        bubbleUntil: a.bubbleUntil,
        effect: a.effectUntil > now ? a.effect : '',
        test: a.test,
        wins: a.profile.wins,
      })),
      game: this.game
        ? {
            type: this.game.type,
            phase: this.game.phase,
            phaseEndsAt: this.game.phaseEndsAt,
            participants: this.game.players.length,
            boosts: this.game.settings.boosts,
            endsAt: this.game.endsAt,
            score: this.game.score,
            goal: this.game.goal,
            result: this.game.result,
          }
        : null,
    };
  }
}
module.exports = { AvatarEngine, WIDTH, HEIGHT };
