import { createHash } from 'node:crypto';

export const COMMAND_LIMITS = Object.freeze({
  burst: 8, refillPerSecond: 0.5, channelBurst: 120, channelPerSecond: 20,
  globalBurst: 600, globalPerSecond: 100, maxEntries: 25000, idleMs: 600000,
});

export function createCommandAdmission({ now = Date.now, limits = {}, claim = null, onBlocked = () => {} } = {}) {
  const config = { ...COMMAND_LIMITS, ...limits };
  const actors = new Map();
  const channels = new Map();
  const global = { tokens: config.globalBurst, at: now() };
  let sweptAt = now();
  let reportAt = -Infinity;
  let suppressed = 0;

  function refill(bucket, capacity, rate, time) {
    bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, time - bucket.at) * rate / 1000);
    bucket.at = Math.max(bucket.at, time);
  }
  function block(reason, retryAfterMs, sid) {
    suppressed += 1;
    const time = now();
    if (time - reportAt >= 30000) {
      onBlocked({ reason, sid, suppressed });
      reportAt = time;
      suppressed = 0;
    }
    return { allowed: false, reason, retryAfterMs: Math.max(1, Math.ceil(retryAfterMs)) };
  }
  async function admit({ sid, provider, userId }) {
    if (!sid || !provider || !userId || userId === 'unknown_user') return block('identity', 1000, sid);
    const time = now();
    if (time - sweptAt >= 30000) {
      for (const map of [actors, channels]) {
        for (const [key, value] of map) if (time - value.at >= config.idleMs) map.delete(key);
      }
      sweptAt = time;
    }
    const key = createHash('sha256').update(JSON.stringify([sid, provider, userId])).digest('hex');
    let actor = actors.get(key);
    if (!actor) {
      if (actors.size >= config.maxEntries) return block('capacity', 30000, sid);
      actor = { tokens: config.burst, at: time, until: 0, strikes: 0, level: 0, violationAt: 0 };
      actors.set(key, actor);
    }
    if (actor.until > time) return block('cooloff', actor.until - time, sid);
    refill(actor, config.burst, config.refillPerSecond, time);
    if (actor.tokens < 1) {
      if (time - actor.violationAt > 10000) actor.strikes = 0;
      actor.violationAt = time;
      actor.strikes += 1;
      if (actor.strikes >= 3) {
        actor.until = time + [5000, 15000, 60000][Math.min(actor.level, 2)];
        actor.level += 1;
        actor.strikes = 0;
      }
      return block('user_rate', Math.max(actor.until - time, (1 - actor.tokens) * 1000 / config.refillPerSecond), sid);
    }
    if (time - actor.violationAt >= config.idleMs) { actor.level = 0; actor.strikes = 0; }
    let channel = channels.get(sid);
    if (!channel) {
      if (channels.size >= config.maxEntries) return block('capacity', 30000, sid);
      channel = { tokens: config.channelBurst, at: time };
      channels.set(sid, channel);
    }
    refill(channel, config.channelBurst, config.channelPerSecond, time);
    refill(global, config.globalBurst, config.globalPerSecond, time);
    if (channel.tokens < 1 || global.tokens < 1) return block('load', 1000, sid);
    // Reserve synchronously before awaiting the shared store to prevent races.
    actor.tokens -= 1;
    channel.tokens -= 1;
    global.tokens -= 1;
    if (claim) {
      try {
        if (!await claim(key, config.burst, config.refillPerSecond)) return block('shared_rate', 2000, sid);
      } catch {
        return block('store_unavailable', 5000, sid);
      }
    }
    return { allowed: true, retryAfterMs: 0 };
  }
  return { admit };
}
