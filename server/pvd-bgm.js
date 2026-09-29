export function getPvdBgmSettings(settings = {}) {
  const rate = Number(settings.bgmPointsPerSecond ?? 1);
  return {
    enabled: settings.bgmEnabled === true && settings.videoDonationIdlePlaylist?.enabled !== true,
    acceptEnabled: settings.bgmAcceptEnabled === true,
    pointsPerSecond: Number.isFinite(rate) ? Math.max(0, rate) : 1,
  };
}

// Video requests interrupt BGM without completing or charging it again.
export function insertPvdRequest(queue, item, state, atSec = 0) {
  const previous = queue[0];
  if (item.kind === 'bgm') queue.push(item);
  else {
    const firstBgm = queue.findIndex((entry) => entry.kind === 'bgm');
    if (firstBgm === 0 && state) {
      previous.resumePlayback = { atSec, paused: state.bgmBlocked ? state.bgmResumePaused === true : state.paused === true };
    }
    queue.splice(firstBgm < 0 ? queue.length : firstBgm, 0, item);
  }
  return queue[0] !== previous;
}

export function updateBgmPlaybackAvailability(state, item, available, now = Date.now()) {
  if (item?.kind !== 'bgm' || !state || state.bgmBlocked === !available) return false;
  const start = Math.max(0, Number(item.startSec) || 0);
  if (!available) {
    state.bgmResumePaused = state.paused === true;
    state.pausedAtSec = state.paused ? state.pausedAtSec : start + Math.max(0, (now - state.baseStartMs) / 1000);
    state.paused = true;
  } else {
    state.baseStartMs = now - Math.max(0, Number(state.pausedAtSec ?? start) - start) * 1000;
    state.paused = state.bgmResumePaused === true;
    if (!state.paused) state.pausedAtSec = null;
  }
  state.bgmBlocked = !available;
  return true;
}

export function createBgmPlayerPresence({ now = Date.now, leaseMs = 12000 } = {}) {
  const players = new Map();
  const reports = new Map();
  const current = (sid) => {
    const player = players.get(sid);
    if (player && player.expiresAt > now()) return player;
    players.delete(sid);
    return null;
  };
  return {
    current,
    report(sid, { clientId, visible, sequence, readyItemId }) {
      if (!/^[A-Za-z0-9_-]{8,80}$/.test(String(clientId || ''))) return false;
      const owner = current(sid);
      const key = `${sid}:${clientId}`;
      for (const [id, report] of reports) if (report.expiresAt <= now()) reports.delete(id);
      if (Number.isSafeInteger(sequence)) {
        if (sequence <= (reports.get(key)?.sequence || 0)) return owner?.clientId === clientId;
        reports.set(key, { sequence, expiresAt: now() + leaseMs * 2 });
      }
      if (visible !== true) {
        if (owner?.clientId === clientId) players.delete(sid);
        return false;
      }
      if (owner && owner.clientId !== clientId) return false;
      players.set(sid, { clientId, readyItemId: String(readyItemId || ''), expiresAt: now() + leaseMs });
      return true;
    },
  };
}
