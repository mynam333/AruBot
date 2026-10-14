const { LIMITS, duration } = require('./schema.cjs');

class PngTuberEngine {
  constructor(config, now = Date.now) {
    this.config = config;
    this.now = now;
    this.connected = false;
    this.sourceAvailable = false;
    this.muted = false;
    this.levelDb = -100;
    this.mouthOpen = false;
    this.lastMeterAt = null;
    this.belowAt = null;
    this.active = null;
    this.queue = [];
    this.deliveries = new Map();
    this.error = '';
  }
  setConfig(config) {
    const changed = config.inputUuid !== this.config.inputUuid || config.inputName !== this.config.inputName;
    this.config = config;
    this.resetMeter();
    if (changed) this.setSource(false);
    const valid = (item) => config.reactions.some((r) => r.id === item.id && r.asset === item.asset);
    this.queue = this.queue.filter(valid);
    if (this.active && !valid(this.active)) this.active = null;
    if (!config.enabled) this.clear();
  }
  resetMeter() {
    this.levelDb = -100;
    this.mouthOpen = false;
    this.lastMeterAt = null;
    this.belowAt = null;
  }
  setConnected(value) {
    this.connected = value === true;
    if (!this.connected) this.setSource(false);
  }
  setSource(available, muted = false) {
    this.sourceAvailable = available === true;
    this.muted = this.sourceAvailable && muted === true;
    this.resetMeter();
  }
  setMuted(muted) {
    this.muted = muted === true;
    this.resetMeter();
  }
  meter(levels) {
    if (!this.config.enabled || !this.connected || !this.sourceAvailable || this.muted) return;
    if (!Array.isArray(levels)) return;
    const peaks = levels.map((channel) => Array.isArray(channel) ? channel[1] : null)
      .filter((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0);
    if (!peaks.length) return;
    const peak = Math.max(...peaks.slice(0, 64));
    this.levelDb = peak > 0 ? Math.min(0, Math.max(-100, 20 * Math.log10(peak))) : -100;
    const now = this.now();
    this.lastMeterAt = now;
    if (!this.mouthOpen && this.levelDb >= this.config.thresholdDb) {
      this.mouthOpen = true;
      this.belowAt = null;
    } else if (this.mouthOpen) {
      if (this.levelDb < this.config.thresholdDb - this.config.hysteresisDb) {
        this.belowAt ??= now;
        if (now - this.belowAt >= this.config.holdMs) this.mouthOpen = false;
      } else this.belowAt = null;
    }
  }
  tick() {
    const now = this.now();
    if (this.lastMeterAt !== null && now - this.lastMeterAt >= LIMITS.staleMeterMs) this.resetMeter();
    if (this.mouthOpen && this.belowAt !== null && now - this.belowAt >= this.config.holdMs)
      this.mouthOpen = false;
    // Queue deadlines advance from the previous deadline, not from a delayed timer tick.
    while (this.active && this.active.until <= now) {
      const start = this.active.until;
      this.active = this.queue.shift() || null;
      if (this.active) this.active.until = start + this.active.durationMs;
    }
    if (!this.active && this.queue.length) {
      this.active = this.queue.shift();
      this.active.until = now + this.active.durationMs;
    }
    for (const [id, record] of this.deliveries)
      if (record.expires <= now) this.deliveries.delete(id);
  }
  clear() { this.active = null; this.queue.length = 0; }
  trigger(payload, deliveryId) {
    this.tick();
    const validDelivery = typeof deliveryId === 'string' && deliveryId.length > 0 && deliveryId.length <= 256;
    if (deliveryId !== undefined && !validDelivery) return { ok: false, reason: 'invalid-delivery-id' };
    if (validDelivery && this.deliveries.has(deliveryId))
      return { ...this.deliveries.get(deliveryId).result, duplicate: true };
    const pendingDuplicate = validDelivery && [this.active, ...this.queue].find((item) => item?.deliveryId === deliveryId);
    if (pendingDuplicate) return { ...pendingDuplicate.result, duplicate: true };
    let result;
    if (!this.config.enabled) result = { ok: false, reason: 'disabled' };
    else if (!payload || typeof payload.reactionId !== 'string' || payload.reactionId.length > 96)
      result = { ok: false, reason: 'invalid-reaction' };
    else if (payload.expiresAt !== undefined && (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= this.now()))
      result = { ok: false, reason: 'expired' };
    else {
      const exact = this.config.reactions.find((r) => r.id === payload.reactionId);
      const matches = exact ? [exact] : this.config.reactions.filter((r) => r.name === payload.reactionId);
      if (matches.length !== 1) result = { ok: false, reason: matches.length ? 'ambiguous-reaction' : 'unknown-reaction' };
      else {
        const reaction = matches[0];
        let seconds;
        try { seconds = duration(payload.durationSec ?? reaction.durationSec); }
        catch { result = { ok: false, reason: 'invalid-duration' }; }
        if (!result) {
          const item = { id: reaction.id, asset: reaction.asset, durationMs: seconds * 1000, deliveryId };
          if (this.config.reactionMode === 'replace') this.clear();
          if (!this.active) { item.until = this.now() + item.durationMs; this.active = item; }
          else if (this.queue.length < LIMITS.pending) this.queue.push(item);
          else result = { ok: false, reason: 'queue-full' };
          result ||= { ok: true, reactionId: reaction.id, durationSec: seconds, queued: this.queue.length };
          item.result = result;
        }
      }
    }
    if (validDelivery) {
      this.deliveries.set(deliveryId, { result, expires: this.now() + 24 * 60 * 60 * 1000 });
      while (this.deliveries.size > LIMITS.deliveries) this.deliveries.delete(this.deliveries.keys().next().value);
    }
    return { ...result };
  }
  snapshot(preview = false) {
    this.tick();
    const config = this.config;
    let mode = 'closed', asset = config.closedAsset;
    if (!config.enabled) { mode = 'disabled'; asset = preview ? config.closedAsset : ''; }
    else if (this.active) { mode = 'reaction'; asset = this.active.asset; }
    else if (this.muted && this.connected && this.sourceAvailable) { mode = 'muted'; asset = config.mutedAsset || config.closedAsset; }
    else if (this.mouthOpen && this.connected && this.sourceAvailable) { mode = 'open'; asset = config.openAsset || config.closedAsset; }
    return {
      connected: this.connected, sourceAvailable: this.sourceAvailable, muted: this.muted,
      levelDb: this.levelDb, mouthOpen: this.mouthOpen, mode, asset,
      reactionId: this.active?.id || '', remainingMs: Math.max(0, (this.active?.until || 0) - this.now()),
      queued: this.queue.length, error: this.error,
    };
  }
}
module.exports = { PngTuberEngine };
