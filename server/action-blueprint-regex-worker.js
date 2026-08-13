import { parentPort } from 'node:worker_threads';

if (!parentPort) throw new Error('action_blueprint_regex_worker_parent_missing');

parentPort.on('message', (message) => {
  const id = message?.id;
  try {
    const matched = new RegExp(String(message?.pattern || '')).test(String(message?.input ?? ''));
    parentPort.postMessage({ id, ok: true, matched });
  } catch {
    parentPort.postMessage({ id, ok: false, matched: false });
  }
});

parentPort.postMessage({ type: 'ready' });
