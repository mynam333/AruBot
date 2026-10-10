const Matter = require('matter-js');
const crypto = require('crypto');
const { LIMITS, text, number } = require('./schema.cjs');
const { Engine, Bodies, Body, Composite } = Matter;
const WIDTH = 1920,
  HEIGHT = 1080;

class AvatarEngine {
  constructor(config, profiles = {}, options = {}) {
    this.config = config;
    this.profiles = profiles;
    this.now = options.now || Date.now;
    this.random = options.random || Math.random;
    this.scope = '';
    this.actors = new Map();
    this.seen = new Map();
    this.cooldowns = new Map();
    this.tasks = [];
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
  }
  setWalls() {
    if (this.walls) Composite.remove(this.engine.world, this.walls);
    this.ground = HEIGHT - this.config.floor;
    this.walls = [
      Bodies.rectangle(WIDTH / 2, this.ground + 30, WIDTH + 400, 60, {
        isStatic: true,
        collisionFilter: { category: 2 },
      }),
      Bodies.rectangle(-30, HEIGHT / 2, 60, HEIGHT * 3, {
        isStatic: true,
        collisionFilter: { category: 2 },
      }),
      Bodies.rectangle(WIDTH + 30, HEIGHT / 2, 60, HEIGHT * 3, {
        isStatic: true,
        collisionFilter: { category: 2 },
      }),
    ];
    Composite.add(this.engine.world, this.walls);
  }
  setConfig(config) {
    if (!this.config.paused && config.paused) this.pausedAt = this.now();
    if (this.config.paused && !config.paused) {
      const elapsed = this.now() - this.pausedAt;
      for (const task of this.tasks) task.at += elapsed;
      for (const [key, until] of this.cooldowns)
        this.cooldowns.set(key, until + elapsed);
      for (const a of this.actors.values()) {
        if (a.flight) a.flight.startedAt += elapsed;
        for (const key of [
          'until',
          'nextWalk',
          'bubbleUntil',
          'effectUntil',
          'pushedUntil',
          'lastChat',
        ])
          if (a[key]) a[key] += elapsed;
      }
      if (this.game) {
        this.game.startedAt += elapsed;
        this.game.endsAt += elapsed;
        if (this.game.hideAt) this.game.hideAt += elapsed;
        for (const id of Object.keys(this.game.cooldowns))
          this.game.cooldowns[id] += elapsed;
      }
      this.pausedAt = 0;
    }
    if (JSON.stringify(this.config.rules) !== JSON.stringify(config.rules)) {
      this.tasks = [];
      this.cooldowns.clear();
    }
    const groundChanged = this.config.floor !== config.floor;
    this.config = config;
    if (groundChanged) this.setWalls();
    for (const a of this.actors.values()) {
      if (!config.avatars.some((v) => v.id === a.profile.avatar)) {
        a.profile.avatar = config.defaultAvatar;
        if (!a.test) this.dirty = true;
      }
      if (groundChanged) this.resetMotion(a);
      Body.setPosition(a.body, {
        x: Math.max(30, Math.min(WIDTH - 30, a.body.position.x)),
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
  remove(id) {
    const a = this.actors.get(id);
    if (a) Composite.remove(this.engine.world, a.body);
    this.actors.delete(id);
    this.tasks = this.tasks.filter((t) => t.id !== id);
  }
  clear(testOnly = false) {
    for (const a of this.actors.values())
      if (!testOnly || a.test) this.remove(a.id);
    if (!testOnly) this.game = null;
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
    Body.setVelocity(actor.body, { x: 0, y: actor.body.velocity.y });
  }
  resetTestActor(userId, avatarId) {
    const id = this.key(userId, true),
      actor = this.actors.get(id);
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
    if (profile.blocked || (profile.hidden && !force)) return null;
    if (force) profile.hidden = false;
    profile.name = text(event.name, 32) || '시청자';
    profile.seen = this.now();
    if (!this.config.avatars.some((a) => a.id === profile.avatar))
      profile.avatar = this.config.defaultAvatar;
    if (!event.test) {
      this.profiles[key] = profile;
      this.dirty = true;
      const keys = Object.keys(this.profiles);
      if (keys.length > LIMITS.profiles) {
        const oldest = keys
          .filter((k) => !this.actors.has(k))
          .sort((a, b) => this.profiles[a].seen - this.profiles[b].seen);
        for (const k of oldest.slice(0, keys.length - LIMITS.profiles))
          delete this.profiles[k];
      }
    }
    if (existing) return existing;
    if (this.actors.size >= this.config.maxActors) return null;
    const body = Bodies.circle(
      40 + this.random() * (WIDTH - 80),
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
    };
    this.actors.set(key, actor);
    if (triggerRules)
      for (const rule of this.config.rules.filter((r) => r.trigger === 'join'))
        if (this.runRule(rule, actor, event)) break;
    return actor;
  }
  receive(event) {
    if (
      !event ||
      !this.config.enabled ||
      this.config.paused ||
      (!this.scope && !event.test)
    )
      return false;
    const now = this.now();
    if (
      !event.userId ||
      String(event.userId).length > 160 ||
      !['chat', 'donation', 'subscription'].includes(event.kind)
    )
      return false;
    if (
      !Number.isFinite(Number(event.at)) ||
      Math.abs(now - Number(event.at)) > 30000
    )
      return false;
    const eventId = String(event.id || '').slice(0, 160);
    if (!eventId || this.seen.has(eventId)) return false;
    if (now - this.budgetAt >= 1000) {
      this.budgetAt = now;
      this.budget = 0;
    }
    if (++this.budget > 120) {
      this.stats.ignored++;
      return false;
    }
    this.seen.set(eventId, now);
    if (this.seen.size > 4096) this.seen.delete(this.seen.keys().next().value);
    this.stats.received++;
    const content = text(event.text, 300);
    const [rawCommand, ...rest] = content.split(/\s+/);
    const command = rawCommand.toLowerCase();
    const arg = rest.join(' ');
    const key = this.key(event.userId, event.test);
    const profile = this.profiles[key] || this.actors.get(key)?.profile;
    if (profile?.blocked) return false;
    if (['!퇴장', '!leave'].includes(command)) {
      if (profile) {
        profile.hidden = true;
        profile.seen = now;
        if (!event.test) this.dirty = true;
      }
      this.remove(key);
      return true;
    }
    const isJoin = ['!입장', '!join'].includes(command);
    const actor =
      this.actors.get(key) ||
      (this.config.autoJoin || isJoin ? this.join(event, isJoin) : null);
    if (!actor) return false;
    actor.profile.name = text(event.name, 32) || actor.profile.name;
    actor.profile.seen = now;
    actor.lastChat = now;
    if (!actor.test) this.dirty = true;
    if (
      this.config.bubbles &&
      event.kind === 'chat' &&
      !content.startsWith('!')
    )
      this.say(actor, content);
    const controlKey = `${key}:control`;
    if (
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
      ].includes(command)
    ) {
      if ((this.cooldowns.get(controlKey) || 0) > now) return false;
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
      else if (['!응원', '!cheer'].includes(command)) this.cheer(actor);
      else if (['!도움말', '!help'].includes(command))
        this.say(
          actor,
          '!입장 · !퇴장 · !점프 · !달리기 5 · !부양 5 · !캐릭터 이름 · !응원',
        );
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
    for (const rule of candidates) {
      if (
        this.runRule(rule, actor, {
          ...event,
          targetName: arg.replace(/^@/, ''),
        })
      )
        break;
    }
    return true;
  }
  say(actor, message) {
    actor.bubble = text(message, 100);
    actor.bubbleUntil = this.now() + 5000;
  }
  target(actor, name) {
    if (!this.config.allowTargeting || !name) return null;
    const found = [...this.actors.values()].filter(
      (a) => a.id !== actor.id && a.profile.name === name,
    );
    return found.length === 1 ? found[0] : null;
  }
  runRule(rule, actor, event) {
    if (
      !rule.enabled ||
      (rule.role === 'owner' && event.role !== 'owner') ||
      (rule.role === 'moderator' &&
        !['owner', 'moderator'].includes(event.role))
    )
      return false;
    if (rule.trigger === 'donation' && Number(event.amount || 0) < rule.minimum)
      return false;
    const now = this.now(),
      key = `${actor.id}:${rule.id}`;
    const remaining = this.tasks.filter((t) => t.id !== actor.id);
    if (
      (this.cooldowns.get(key) || 0) > now ||
      remaining.length + rule.steps.length > 512
    )
      return false;
    this.cooldowns.set(key, now + rule.cooldown * 1000);
    // A new sequence replaces that viewer's old sequence rather than building an unbounded queue.
    this.tasks = remaining;
    this.resetMotion(actor);
    let at = now;
    for (const step of rule.steps) {
      const argument = text(event.targetName, 32);
      const duration =
        rule.durationFromChat && /^(?:\d+(?:\.\d+)?)(?:초|s)?$/i.test(argument)
          ? number(
              argument.replace(/(?:초|s)$/i, ''),
              0.1,
              LIMITS.duration,
              step.duration,
            )
          : step.duration;
      this.tasks.push({
        id: actor.id,
        step: { ...step, duration },
        at,
        target: event.targetName || '',
      });
      at += duration * 1000;
    }
    this.note(`${actor.profile.name}: ${rule.name}`);
    return true;
  }
  action(actor, step, targetName = '') {
    const now = this.now();
    this.stats.actions++;
    const target = this.target(actor, targetName);
    const racing =
      this.game?.type === 'race' &&
      this.game.endsAt > now &&
      this.game.players.includes(actor.id);
    if (step.action === 'say') {
      this.say(
        actor,
        step.value
          .replaceAll('{user}', actor.profile.name)
          .replaceAll('{target}', target?.profile.name || ''),
      );
      actor.bubbleUntil =
        now + number(step.duration, 0.1, LIMITS.duration, 5) * 1000;
      return;
    }
    if (step.action === 'size') {
      actor.profile.scale = number(step.value, 0.5, 1.6, 1);
      if (!actor.test) this.dirty = true;
      return;
    }
    if (racing && step.action !== 'jump') return;
    this.resetMotion(actor);
    if (step.action === 'jump') {
      if (actor.body.position.y >= this.ground - 24)
        Body.setVelocity(actor.body, { x: actor.body.velocity.x, y: -12 });
      actor.state = 'jump';
      actor.motion = 'jump';
      actor.until = now + 900;
      return;
    }
    if (step.action === 'float') {
      const duration = number(step.duration, 0.1, LIMITS.duration, 5) * 1000;
      const height = number(step.value, 30, 500, 160);
      const landY = this.ground - 16;
      actor.flight = {
        startedAt: now,
        duration,
        edge: Math.min(1200, duration * 0.25),
        fromY: actor.body.position.y,
        topY: landY - height,
        landY,
      };
      Body.setStatic(actor.body, true);
      Body.setVelocity(actor.body, { x: 0, y: 0 });
      actor.state = 'float';
    } else if (['follow', 'highfive', 'push'].includes(step.action)) {
      if (!target) {
        this.say(
          actor,
          this.config.allowTargeting
            ? '대상 닉네임을 정확히 입력해 주세요.'
            : '대상 상호작용이 꺼져 있습니다.',
        );
        return;
      }
      if (step.action === 'follow') actor.follow = target.id;
      else {
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
  }
  cheer(actor) {
    this.action(actor, { action: 'jump' });
    if (
      this.game?.type !== 'cheer' ||
      this.game.endsAt <= this.now() ||
      !this.game.players.includes(actor.id)
    )
      return;
    if ((this.game.cooldowns[actor.id] || 0) > this.now()) return;
    this.game.cooldowns[actor.id] = this.now() + 3000;
    this.game.score++;
    if (this.game.score >= this.game.goal) this.finishGame('공동 응원 성공!');
  }
  startGame(type, duration = 30) {
    if (!this.config.enabled || this.config.paused)
      throw new Error('아바타를 실행한 상태에서 시작해 주세요.');
    if (!['race', 'cheer'].includes(type))
      throw new Error('지원하지 않는 게임입니다.');
    if (this.game && this.game.endsAt > this.now())
      throw new Error('이미 게임이 진행 중입니다.');
    const players = [...this.actors.values()];
    if (!players.length)
      throw new Error(
        '참여자가 없습니다. 테스트 채팅 또는 실제 채팅으로 입장해 주세요.',
      );
    this.tasks = [];
    this.game = {
      type,
      startedAt: this.now(),
      endsAt: this.now() + number(duration, 10, 120, 30) * 1000,
      players: players.map((a) => a.id),
      score: 0,
      goal: Math.max(5, players.length * 3),
      cooldowns: {},
      result: '',
      speeds: {},
    };
    for (const a of players) {
      this.resetMotion(a);
      this.game.speeds[a.id] = 1.7 + this.random() * 1.3;
      if (type === 'race')
        Body.setPosition(a.body, {
          x: 55 + this.random() * 15,
          y: this.ground - 16,
        });
    }
    this.note(type === 'race' ? '달리기 시작' : '공동 응원 시작');
  }
  finishGame(result, winner) {
    if (!this.game) return;
    this.game.result = result;
    this.game.endsAt = this.now();
    this.game.hideAt = this.now() + 10000;
    if (winner) {
      winner.profile.wins++;
      if (!winner.test) this.dirty = true;
      this.say(winner, '1위!');
    }
    for (const a of this.actors.values()) {
      this.resetMotion(a);
      a.until = this.now() + 2000;
      a.state = 'wave';
      a.motion = 'wave';
    }
    this.note(result);
  }
  tick(delta = 1000 / 30) {
    if (!this.config.enabled || this.config.paused) return;
    const now = this.now();
    const due = this.tasks.filter((t) => t.at <= now);
    this.tasks = this.tasks.filter((t) => t.at > now);
    for (const task of due) {
      const a = this.actors.get(task.id);
      if (a) this.action(a, task.step, task.target);
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
        else if (elapsed < f.duration - f.edge) {
          const progress = (elapsed - f.edge) / (f.duration - 2 * f.edge);
          y =
            f.topY +
            Math.sin(progress * Math.PI) ** 2 *
              Math.sin((elapsed - f.edge) / 400) *
              5;
        } else
          y =
            f.topY +
            (f.landY - f.topY) * ease((elapsed - f.duration + f.edge) / f.edge);
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
        !this.game.result &&
        this.game.players.includes(a.id);
      if (racing) {
        vx = this.game.speeds[a.id] * 2;
        a.state = 'run';
      } else if (a.until > now) {
        a.state = a.motion || a.state;
        if (a.follow) a.targetX = this.actors.get(a.follow)?.body.position.x;
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
              Math.abs(target.body.position.x - a.body.position.x) < 140
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
          if (a.body.position.x < 50) a.dx = 1;
          if (a.body.position.x > WIDTH - 50) a.dx = -1;
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
        if (a.body.position.x < 50) a.dx = 1;
        if (a.body.position.x > WIDTH - 50) a.dx = -1;
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
    const dt = Math.min(100, Math.max(0, delta));
    for (let i = 0; i < Math.ceil(dt / (1000 / 60)); i++)
      Engine.update(this.engine, dt / Math.ceil(dt / (1000 / 60)));
    if (this.game && !this.game.result) {
      const players = this.game.players
        .map((id) => this.actors.get(id))
        .filter(Boolean);
      if (!players.length) this.finishGame('참여자가 없어 종료되었습니다.');
      else if (
        this.game.type === 'race' &&
        (now >= this.game.endsAt ||
          players.some((a) => a.body.position.x > WIDTH - 100))
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
  moderate(action, id) {
    const actor = this.actors.get(id),
      profile = actor?.profile || this.profiles[id];
    if (!profile) throw new Error('시청자를 찾을 수 없습니다.');
    if (action === 'block') profile.blocked = true;
    else if (action === 'unblock') {
      profile.blocked = false;
      profile.hidden = false;
    } else if (action === 'forget') delete this.profiles[id];
    else if (action === 'remove') profile.hidden = true;
    else throw new Error('지원하지 않는 관리 동작입니다.');
    if (action !== 'unblock') this.remove(id);
    this.dirty = true;
  }
  snapshot() {
    const now = this.config.paused ? this.pausedAt : this.now();
    return {
      at: now,
      width: WIDTH,
      height: HEIGHT,
      enabled: this.config.enabled,
      paused: this.config.paused,
      showNames: this.config.showNames,
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
        name: a.profile.name,
        avatar: a.profile.avatar,
        color: a.profile.color,
        size: this.config.size * a.profile.scale,
        x: a.body.position.x,
        y: a.body.position.y + 16,
        direction: a.direction,
        state: a.state,
        animationRate: a.state === 'run' ? 1.7 : 1,
        bubble: a.bubbleUntil > now ? a.bubble : '',
        effect: a.effectUntil > now ? a.effect : '',
        test: a.test,
        wins: a.profile.wins,
      })),
      game: this.game
        ? {
            type: this.game.type,
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
