const DEFAULT_EARLY_TOLERANCE_MS = 250;
const DEFAULT_FALLBACK_DELAY_MS = 15_000;

function normalizeIdentifier(value, maxLength = 256) {
  const text = String(value || '').trim();
  if (!text || text.length > maxLength) return '';
  return text;
}

function normalizeResultLabel(value) {
  return String(value || '').trim().normalize('NFC');
}

function pendingKey(token, spinId) {
  return `${token}\u0000${spinId}`;
}

/**
 * Keeps roulette result side effects pending until the authenticated overlay
 * reports that the matching spin has visibly settled.
 */
export function createRouletteResultActionCoordinator(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const setTimeoutFn = typeof options.setTimeoutFn === 'function' ? options.setTimeoutFn : setTimeout;
  const clearTimeoutFn = typeof options.clearTimeoutFn === 'function' ? options.clearTimeoutFn : clearTimeout;
  const earlyToleranceMs = Math.max(0, Number(options.earlyToleranceMs ?? DEFAULT_EARLY_TOLERANCE_MS));
  const onError = typeof options.onError === 'function' ? options.onError : () => {};
  const pending = new Map();

  async function executePending(key, reason) {
    const entry = pending.get(key);
    if (!entry) return { status: 'missing' };

    // Delete before awaiting so duplicate overlay acknowledgements can never
    // execute the same action twice, even when several OBS sources are open.
    pending.delete(key);
    if (entry.timer) clearTimeoutFn(entry.timer);

    try {
      const value = await entry.execute({
        reason,
        spinId: entry.spinId,
        settledAt: now(),
      });
      return { status: 'executed', value };
    } catch (error) {
      try { onError(error, entry, reason); } catch { }
      return { status: 'failed', error };
    }
  }

  function register(input = {}) {
    const token = normalizeIdentifier(input.token, 512);
    const spinId = normalizeIdentifier(input.spinId, 128);
    const channelId = normalizeIdentifier(input.channelId, 256);
    const label = normalizeResultLabel(input.label);
    if (!token || !spinId || !channelId || !label || typeof input.execute !== 'function') return false;

    const key = pendingKey(token, spinId);
    if (pending.has(key)) return false;

    const notBefore = Math.max(0, Number(input.notBefore || 0));
    const fallbackDelayMs = Math.max(0, Number(input.fallbackDelayMs ?? DEFAULT_FALLBACK_DELAY_MS));
    const entry = {
      token,
      spinId,
      channelId,
      label,
      notBefore,
      execute: input.execute,
      timer: null,
    };
    entry.timer = setTimeoutFn(() => {
      void executePending(key, 'settlement-timeout');
    }, fallbackDelayMs);
    entry.timer?.unref?.();
    pending.set(key, entry);
    return true;
  }

  async function settle(input = {}) {
    const token = normalizeIdentifier(input.token, 512);
    const spinId = normalizeIdentifier(input.spinId, 128);
    const channelId = normalizeIdentifier(input.channelId, 256);
    const label = normalizeResultLabel(input.label);
    const key = pendingKey(token, spinId);
    const entry = pending.get(key);
    if (!entry) return { status: 'missing' };
    if (entry.channelId !== channelId) return { status: 'channel-mismatch' };
    if (!label || entry.label !== label) return { status: 'label-mismatch' };
    if (now() + earlyToleranceMs < entry.notBefore) return { status: 'too-early' };
    return executePending(key, 'overlay-settled');
  }

  async function release(input = {}, reason = 'overlay-unavailable') {
    const token = normalizeIdentifier(input.token, 512);
    const spinId = normalizeIdentifier(input.spinId, 128);
    return executePending(pendingKey(token, spinId), reason);
  }

  function has(input = {}) {
    const token = normalizeIdentifier(input.token, 512);
    const spinId = normalizeIdentifier(input.spinId, 128);
    return pending.has(pendingKey(token, spinId));
  }

  return {
    register,
    settle,
    release,
    has,
    pendingCount: () => pending.size,
  };
}
