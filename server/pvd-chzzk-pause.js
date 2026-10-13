// Keep external interruptions separate from the viewer's explicit pause choice.
export function setChzzkPlaybackBlocked(state, item, blocked, now = Date.now()) {
  if (!state || !item || Boolean(state.chzzkBlocked) === blocked) return false;
  const start = Math.max(0, Number(item.startSec) || 0);
  if (blocked) {
    state.chzzkResumePaused = state.bgmBlocked ? state.bgmResumePaused === true : state.paused === true && !state.idleDeferred;
    state.pausedAtSec = state.paused ? state.pausedAtSec ?? start : start + Math.max(0, (now - state.baseStartMs) / 1000);
    state.paused = true;
  } else {
    state.baseStartMs = now - Math.max(0, Number(state.pausedAtSec ?? start) - start) * 1000;
    state.paused = Boolean(state.bgmBlocked || state.idleDeferred || state.chzzkResumePaused);
    if (!state.paused) state.pausedAtSec = null;
    delete state.chzzkResumePaused;
  }
  state.chzzkBlocked = blocked;
  return true;
}
