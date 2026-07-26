function isSuccessfulDelivery(result) {
  return Number(result?.success || 0) > 0;
}

function notifyMirrorSettled(callback, outcome) {
  if (typeof callback !== 'function') return;
  try {
    callback(outcome);
  } catch {
    // Delivery must not fail because optional diagnostics failed.
  }
}

export function createRouletteBroadcastDelivery({
  deliverToTest,
  deliverToChannel,
  mirrorTestToChannel = false,
  onMirrorSettled,
} = {}) {
  if (typeof deliverToTest !== 'function') throw new TypeError('deliverToTest must be a function');
  if (typeof deliverToChannel !== 'function') throw new TypeError('deliverToChannel must be a function');

  let mirrorAttempted = false;

  return async function deliverRouletteBroadcast(payload = {}) {
    const targetConnectionId = String(payload?.targetConnectionId || '').trim();
    if (!targetConnectionId) return deliverToChannel(payload);

    const testResult = await deliverToTest(payload);
    if (mirrorTestToChannel !== true || mirrorAttempted || !isSuccessfulDelivery(testResult)) {
      return testResult;
    }

    // Mark the attempt before dispatching so retries or overlapping calls cannot
    // make the OBS overlay spin more than once for the same test execution.
    mirrorAttempted = true;
    try {
      const mirrorDelivery = deliverToChannel(payload);
      Promise.resolve(mirrorDelivery).then(
        (result) => notifyMirrorSettled(onMirrorSettled, { result, error: null }),
        (error) => notifyMirrorSettled(onMirrorSettled, { result: null, error }),
      );
    } catch (error) {
      notifyMirrorSettled(onMirrorSettled, { result: null, error });
    }

    // The isolated popup is authoritative for an administrator test. An OBS
    // source may be closed, slow, or unavailable while the offline test still succeeds.
    return testResult;
  };
}
