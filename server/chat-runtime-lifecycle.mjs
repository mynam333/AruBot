import { createRuntimeHandoff } from './runtime-handoff.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function createChatRuntimeLifecycle({ client, getPending, getMaps, getWorkerId,
  transferJobs, beforeCapture = () => {}, afterRestore = () => {}, onResume = () => {},
  now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let drained = false;
  let transitioning = false;
  const handoff = () => createRuntimeHandoff({
    maps: getMaps(),
    state: { getInFlight: getPending, getActiveCount: () => 0, rouletteProcessing: new Set() },
  });
  function assertIdle() {
    if (client.canRun() || getPending() !== 0 || (client.active && !drained)) throw new Error('runtime_not_drained');
  }
  function authorized(req) {
    return LOOPBACK.has(req.socket?.remoteAddress) && client.authorize(req.headers?.authorization);
  }
  async function handle(req, res) {
    if (!authorized(req)) return res.status(404).json({ error: 'not_found' });
    if (transitioning) return res.status(409).json({ error: 'runtime_transition_in_progress' });
    transitioning = true;
    try {
      const action = req.path.split('/').filter(Boolean).at(-1);
      if (action === 'drain' && req.method === 'POST') {
        drained = false;
        client.drain();
        await client.refresh();
        if (client.active) await client.request('/runtime/drain', { runtimeId: client.runtimeId });
        const timeoutMs = Math.min(120000, Math.max(1000, Number(req.body?.timeoutMs) || 60000));
        const deadline = now() + timeoutMs;
        while (getPending() !== 0) {
          if (now() >= deadline) throw new Error('runtime_drain_timeout');
          await sleep(25);
        }
        drained = true;
        return res.json({ ok: true, runtimeId: client.runtimeId, pending: 0 });
      }
      if (action === 'resume' && req.method === 'POST') {
        await client.refresh();
        if (!client.active) throw new Error('runtime_not_active');
        await client.request('/runtime/resume', { runtimeId: client.runtimeId });
        await client.refresh();
        drained = false;
        client.resume();
        await onResume();
        return res.json({ ok: true, runtimeId: client.runtimeId });
      }
      if (action === 'checkpoint' && req.method === 'GET') {
        assertIdle();
        beforeCapture();
        return res.json({ runtimeId: client.runtimeId, workerId: getWorkerId(), state: handoff().capture() });
      }
      if (action === 'import' && req.method === 'POST') {
        assertIdle();
        const { runtimeId, workerId, state } = req.body || {};
        if (typeof runtimeId !== 'string' || typeof workerId !== 'string' || !workerId || workerId.length > 200) throw new Error('invalid_runtime_source');
        const helper = handoff();
        const validated = helper.validate(state);
        const queues = validated.maps.videoDonationQueues;
        const jobIds = [...new Set([...queues.values()].flatMap(queue => queue.map(item => item.runtimeJobId).filter(Boolean)))];
        await transferJobs({ fromWorkerId: workerId, toWorkerId: getWorkerId(), jobIds });
        helper.restore(state);
        afterRestore();
        return res.json({ ok: true, importedFrom: runtimeId, jobs: jobIds.length });
      }
      return res.status(404).json({ error: 'not_found' });
    } catch (error) {
      // Remain fenced on failure. The deployment coordinator explicitly resumes or rolls back.
      return res.status(409).json({ error: error?.code || error?.message || 'runtime_handoff_failed' });
    } finally { transitioning = false; }
  }
  return { authorized, handle, get drained() { return drained; } };
}

export function protectRuntimeSocket(socket, { canRun, started, finished }) {
  const originalOn = socket.on;
  socket.on = function (name, listener) {
    if (name !== 'message') return originalOn.call(this, name, listener);
    return originalOn.call(this, name, function (...args) {
      if (!canRun()) { socket.close(1012, 'runtime_handoff'); return; }
      started();
      try {
        const result = listener.apply(this, args);
        if (result?.then) return result.finally(finished);
        finished();
        return result;
      } catch (error) { finished(); throw error; }
    });
  };
}
