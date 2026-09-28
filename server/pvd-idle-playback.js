const LEASE_MS = 20000;

export function createPvdIdlePlaybackStore({ now = Date.now } = {}) {
  const states = new Map();
  const disconnected = new Map();
  let controlVersion = now();
  const get = (sid) => {
    const state = states.get(sid);
    return state && now() - state.updatedAt < LEASE_MS ? state : null;
  };
  const snapshot = (sid) => {
    const state = get(sid);
    if (!state?.item) return null;
    return {
      item: state.item, clientId: state.clientId, paused: state.paused,
      atSec: Math.min(state.item.durationSec, state.atSec + (state.playing && !state.paused ? (now() - state.updatedAt) / 1000 : 0)),
      updatedAt: state.updatedAt,
    };
  };
  return {
    snapshot,
    report(sid, report = {}) {
      const clientId = String(report.clientId || '');
      const sequence = Number(report.sequence);
      if (!/^[a-z0-9_-]{8,80}$/i.test(clientId) || !Number.isSafeInteger(sequence) || sequence < 1) return { accepted: false };
      if ((disconnected.get(`${sid}:${clientId}`) || 0) > now()) return { accepted: false };
      let state = get(sid);
      if (state && state.clientId !== clientId && !(report.source === 'obs' && state.source !== 'obs')) return { accepted: false };
      if (state?.clientId === clientId && sequence <= state.sequence) return { accepted: true, command: state.command };
      if (report.mode !== 'idle') {
        if (state?.clientId === clientId) states.delete(sid);
        return { accepted: true };
      }
      const track = report.track;
      const mediaId = String(track?.mediaId || '');
      const duration = Number(track?.durationSec);
      if (!/^[a-z0-9_-]{11}$/i.test(mediaId) || !Number.isFinite(duration) || duration < 60 || duration > 600) {
        return { accepted: true, command: state?.command };
      }
      const trackKey = String(track?.id || mediaId).slice(0, 100);
      if (!state || state.clientId !== clientId) state = { clientId, source: report.source === 'obs' ? 'obs' : 'browser', command: null };
      const pendingControl = state.command && Number(report.controlVersion || 0) < state.command.version;
      state.sequence = sequence;
      state.item = {
        id: `idle:${clientId}:${trackKey}`, mediaProvider: 'youtube', mediaId, videoId: mediaId,
        title: String(track.title || `YouTube ${mediaId}`).slice(0, 500), durationSec: duration, startSec: 0,
        thumbnailUrl: `https://i.ytimg.com/vi/${mediaId}/hqdefault.jpg`, idle: true,
      };
      state.paused = state.command?.op === 'pause' || (pendingControl ? false : report.paused === true);
      state.playing = report.playing === true;
      state.atSec = Math.max(0, Math.min(duration, Number(report.atSec) || 0));
      state.updatedAt = now();
      states.set(sid, state);
      return { accepted: true, command: state.command };
    },
    control(sid, op, expectedItemId = '') {
      const state = get(sid);
      if (!state?.item) return null;
      if (expectedItemId && expectedItemId !== state.item.id) return { mismatch: true };
      if (!['play', 'pause', 'skip'].includes(op)) return null;
      if (op === 'skip' && state.command?.op === 'skip' && state.command.itemId === state.item.id) return state.command;
      state.atSec = snapshot(sid).atSec;
      state.updatedAt = now();
      state.paused = op === 'pause';
      state.command = { version: ++controlVersion, op, itemId: state.item.id, clientId: state.clientId };
      return state.command;
    },
    clear(sid) { states.delete(sid); },
    connect(sid, clientId) { disconnected.delete(`${sid}:${clientId}`); },
    release(sid, clientId) {
      if (clientId) disconnected.set(`${sid}:${clientId}`, now() + LEASE_MS);
      if (!clientId || states.get(sid)?.clientId !== clientId) return false;
      states.delete(sid);
      return true;
    },
    expire() {
      const expired = [];
      for (const [key, until] of disconnected) if (until <= now()) disconnected.delete(key);
      for (const [sid, state] of states) {
        if (now() - state.updatedAt >= LEASE_MS) { states.delete(sid); expired.push(sid); }
      }
      return expired;
    },
  };
}
