import crypto from 'node:crypto';
import { createChzzkVideoDonationConnector, normalizeChzzkVideoDonationSettings } from './chzzk-video-donation.js';

const MAX_RETRY_JOBS = 200;
const MAX_RETRY_ATTEMPTS = 8;
const remember = (set, key) => {
  set.add(key);
  if (set.size > 10000) set.delete(set.values().next().value);
};
const retryDelay = attempts => Math.min(30000, 5000 * 2 ** Math.max(0, attempts - 1));

export function createChzzkVideoRuntime({ enqueue, remove, setPaused, resolveDuration, connectorFactory = createChzzkVideoDonationConnector, now = Date.now, timers = globalThis }) {
  const channels = new Map();
  let stopped = false;
  const close = (sid) => {
    const state = channels.get(sid);
    if (!state) return;
    channels.delete(sid);
    state.connector?.close();
    timers.clearTimeout(state.timer);
    timers.clearTimeout(state.retry);
    timers.clearTimeout(state.removeRetry);
    timers.clearTimeout(state.notifyRetry);
    state.removals.clear();
    state.notifications.clear();
    if (state.paused) Promise.resolve(setPaused(sid, false)).catch(() => {});
  };
  const drainRemovals = async (sid, state) => {
    if (channels.get(sid) !== state || state.removing || state.removeRetry != null) return;
    state.removing = true;
    let delay = 5000;
    try {
      for (const [id, job] of state.removals) {
        if (channels.get(sid) !== state) return;
        const version = job.version;
        try {
          await remove(sid, id);
          if (channels.get(sid) !== state) return;
          // An insert completed during this delete: confirm deletion again after it.
          if (job.version === version) state.removals.delete(id);
        } catch {
          if (channels.get(sid) !== state) return;
          job.attempts = Math.min(4, job.attempts + 1);
          state.error = '치지직 스킵 동기화 실패 · 자동 재시도 중';
          delay = Math.max(delay, retryDelay(job.attempts));
        }
      }
    } finally {
      state.removing = false;
      if (!state.removals.size && state.error === '치지직 스킵 동기화 실패 · 자동 재시도 중') state.error = null;
      if (channels.get(sid) === state && state.removals.size) {
        state.removeRetry = timers.setTimeout(() => {
          state.removeRetry = null;
          void drainRemovals(sid, state);
        }, delay);
        state.removeRetry?.unref?.();
      }
    }
  };
  const queueRemoval = (sid, state, id) => {
    if (channels.get(sid) !== state) return;
    const job = state.removals.get(id);
    if (job) job.version += 1;
    else {
      if (state.removals.size >= MAX_RETRY_JOBS) {
        state.error = '치지직 스킵 동기화 대기 한도 초과';
        return;
      }
      state.removals.set(id, { version: 0, attempts: 0 });
    }
    void drainRemovals(sid, state);
  };
  const drainNotifications = async (sid, state) => {
    if (channels.get(sid) !== state || state.notifying || state.notifyRetry != null) return;
    state.notifying = true;
    let delay = 5000;
    try {
      while (channels.get(sid) === state && state.notifications.size) {
        const [id, job] = state.notifications.entries().next().value;
        const action = job.action;
        try {
          const result = await state.connector.notifyPlayback(id, action);
          if (channels.get(sid) !== state) return;
          // End supersedes a queued/retrying play, but waits for an in-flight play.
          if (job.action !== action) continue;
          if (result === false) throw new Error('notification_not_sent');
          remember(state.acknowledgements, `${id}:${action}`);
          state.notifications.delete(id);
        } catch {
          if (channels.get(sid) !== state) return;
          if (job.action !== action) continue;
          job.attempts += 1;
          if (job.attempts >= MAX_RETRY_ATTEMPTS) {
            state.notifications.delete(id);
            state.error = '치지직 재생 상태 알림 재시도 한도 초과';
            continue;
          }
          state.error = '치지직 재생 상태 알림 실패 · 자동 재시도 중';
          delay = retryDelay(job.attempts);
          break;
        }
      }
    } finally {
      state.notifying = false;
      if (!state.notifications.size && state.error === '치지직 재생 상태 알림 실패 · 자동 재시도 중') state.error = null;
      if (channels.get(sid) === state && state.notifications.size) {
        state.notifyRetry = timers.setTimeout(() => {
          state.notifyRetry = null;
          void drainNotifications(sid, state);
        }, delay);
        state.notifyRetry?.unref?.();
      }
    }
  };
  const publishPause = (sid, state, paused) => {
    if (state.paused === paused) return;
    state.paused = paused;
    Promise.resolve(setPaused(sid, paused)).catch(() => { state.error = '재생 상태 동기화 실패'; });
  };
  const advance = (sid, state) => {
    timers.clearTimeout(state.timer);
    if (channels.get(sid) !== state) return;
    const head = state.native[0];
    publishPause(sid, state, Boolean(head && (!state.alertPaused || head.startedAt != null) && state.config.pauseEnabled && !state.config.queueEnabled));
    if (!head || (state.alertPaused && head.startedAt == null)) return;
    head.startedAt = now();
    state.timer = timers.setTimeout(() => {
      state.native.shift();
      advance(sid, state);
    }, head.remainingMs);
    state.timer?.unref?.();
  };
  const drain = async (sid, state) => {
    if (channels.get(sid) !== state || state.draining) return;
    timers.clearTimeout(state.retry);
    state.retry = null;
    state.draining = true;
    try {
      while (channels.get(sid) === state && state.pending.length) {
        const event = state.pending[0];
        try {
          if (state.cancelled.has(event.donationId)) { state.pending.shift(); continue; }
          let durationSec = event.durationSec;
          if (!(durationSec > 0)) durationSec = await resolveDuration(sid, event);
          if (!(durationSec > 0) || !Number.isFinite(durationSec)) throw new Error('duration_unavailable');
          if (channels.get(sid) !== state) return;
          if (state.cancelled.has(event.donationId)) { state.pending.shift(); continue; }
          if (state.config.queueEnabled) {
            await enqueue(sid, { ...event, durationSec }, event.key);
            if (channels.get(sid) !== state) return;
            // A skip can arrive while the durable insert is in flight.
            if (state.cancelled.has(event.donationId)) queueRemoval(sid, state, event.donationId);
          } else if (state.config.pauseEnabled) {
            if (state.native.length >= 200) throw new Error('queue_full');
            state.native.push({ donationId: event.donationId, remainingMs: Math.min(21600, durationSec) * 1000 + event.delayMs, startedAt: null });
            if (state.native.length === 1) advance(sid, state);
          }
          state.pending.shift();
          state.error = null;
        } catch (error) {
          if (channels.get(sid) !== state) return;
          if (state.cancelled.has(event.donationId)) {
            // A failed insert response does not prove that the transaction did not commit.
            queueRemoval(sid, state, event.donationId);
            state.pending.shift();
            continue;
          }
          if (Number(error?.status || error?.statusCode) === 400 || Number(error?.status) === 413) {
            state.pending.shift();
            state.error = '지원하지 않는 치지직 영상후원 정보를 건너뛰었습니다';
            continue;
          }
          state.error = '치지직 영상후원 처리 실패 · 자동 재시도 중';
          state.retry = timers.setTimeout(() => drain(sid, state), 5000);
          state.retry?.unref?.();
          break;
        }
      }
    } finally { state.draining = false; }
  };
  return {
    configure(sid, settings) {
      if (stopped) return;
      const config = normalizeChzzkVideoDonationSettings(settings);
      const signature = JSON.stringify(config);
      const old = channels.get(sid);
      if (old?.signature === signature) return;
      if (old?.config.overlayUrl === config.overlayUrl && old.config.queueEnabled && config.queueEnabled) {
        old.config = config;
        old.signature = signature;
        return;
      }
      close(sid);
      if (!config.overlayUrl || (!config.pauseEnabled && !config.queueEnabled)) return;
      const state = { config, signature, status: 'connecting', error: null, paused: false, native: [], pending: [], seen: new Map(), cancelled: new Set(), alertPaused: false, acknowledgements: new Set(), ended: new Set(), removals: new Map(), notifications: new Map() };
      channels.set(sid, state);
      state.connector = connectorFactory({
        overlayUrl: config.overlayUrl,
        onStatus(status, error) {
          if (channels.get(sid) !== state) return;
          state.status = typeof status === 'string' ? status : status.status;
          if (error) state.error = '치지직 연결 실패 · 자동 재연결 중';
          else if (state.status === 'connected' && state.error === '치지직 연결 실패 · 자동 재연결 중') state.error = null;
        },
        onDonation(event) {
          if (channels.get(sid) !== state || !event) return;
          for (const [key, at] of state.seen) if (now() - at > 86400000) state.seen.delete(key);
          const key = event.donationId === 'TEST'
            ? `test:${Math.floor(now() / 3000)}:${event.mediaId}` : event.donationId;
          if (!key || state.seen.has(key)) return;
          if (state.pending.length >= 200) { state.error = '치지직 영상후원 대기 한도 초과'; return; }
          state.seen.set(key, now());
          while (state.seen.size > 10000) state.seen.delete(state.seen.keys().next().value);
          const source = crypto.createHash('sha256').update(config.overlayUrl).digest('hex').slice(0, 16);
          state.pending.push({ ...event, key: `chzzk:${source}:${key}`, delayMs: Math.max(0, Number(event.delayMs) || 0) });
          void drain(sid, state);
        },
        onControl(event) {
          if (channels.get(sid) !== state || event?.stopVideo !== true || !event.donationId) return;
          state.cancelled.add(String(event.donationId));
          if (state.cancelled.size > 10000) state.cancelled.delete(state.cancelled.values().next().value);
          const wasHead = state.native[0]?.donationId === event.donationId;
          state.native = state.native.filter((item) => item.donationId !== event.donationId);
          if (wasHead) advance(sid, state);
          queueRemoval(sid, state, event.donationId);
        },
        onSettings(event) {
          if (channels.get(sid) !== state || typeof event?.alertPauseActive !== 'boolean') return;
          const paused = event.alertPauseActive;
          if (state.alertPaused === paused) return;
          state.alertPaused = paused;
          // CHZZK's alert pause holds subsequent alerts, not a video already playing.
          if (state.native[0]?.startedAt == null) advance(sid, state);
        },
      });
    },
    paused: (sid) => channels.get(sid)?.paused === true,
    status(sid) {
      const state = channels.get(sid);
      return { status: state?.status || 'disabled', error: state?.error || null };
    },
    async notifyPlayback(sid, item, action) {
      const state = channels.get(sid);
      if (!state || item?.source !== 'chzzk-donation' || !item.chzzkDonationId
        || item.chzzkDonationId === 'TEST' || !['play', 'end'].includes(action)) return;
      const id = String(item.chzzkDonationId);
      if (action === 'play' && state.ended.has(id)) return;
      const key = `${id}:${action}`;
      if (state.acknowledgements.has(key)) return;
      if (action === 'end') remember(state.ended, id);
      const job = state.notifications.get(id);
      if (job) {
        if (job.action === action) return;
        job.action = action;
        job.attempts = 0;
        timers.clearTimeout(state.notifyRetry);
        state.notifyRetry = null;
      } else {
        if (state.notifications.size >= MAX_RETRY_JOBS) {
          state.error = '치지직 재생 상태 알림 대기 한도 초과';
          return;
        }
        state.notifications.set(id, { action, attempts: 0 });
      }
      await drainNotifications(sid, state);
    },
    close,
    closeAll() { stopped = true; for (const sid of channels.keys()) close(sid); },
  };
}
