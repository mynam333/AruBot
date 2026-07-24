const { execFileSync } = require('child_process');

describe('PVD viewer duration probe coordinator', () => {
  let result;

  beforeAll(() => {
    const moduleUrl = new URL('../server/pvd-duration-probe.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const script = `
      const { createPvdDurationProbeCoordinator } = await import(${JSON.stringify(moduleUrl)});
      const sent = [];
      const socket = {
        readyState: 1,
        send(raw) {
          sent.push(JSON.parse(raw));
        },
      };
      let nextId = 0;
      const coordinator = createPvdDurationProbeCoordinator({
        timeoutMs: 5000,
        createId: () => 'probe-' + (++nextId),
      });

      const first = coordinator.request({
        sid: 'sid-a',
        provider: 'youtube',
        mediaId: 'video123456',
        sockets: new Set([socket]),
      });
      const duplicate = coordinator.request({
        sid: 'sid-a',
        provider: 'youtube',
        mediaId: 'video123456',
        sockets: new Set([socket]),
      });
      const mismatch = coordinator.settle({
        sid: 'sid-other',
        probeId: 'probe-1',
        provider: 'youtube',
        mediaId: 'video123456',
        durationSec: 83,
      });
      const settled = coordinator.settle({
        sid: 'sid-a',
        probeId: 'probe-1',
        provider: 'youtube',
        mediaId: 'video123456',
        durationSec: 82.2,
      });
      const values = await Promise.all([first, duplicate]);
      const cached = await coordinator.request({
        sid: 'sid-b',
        provider: 'youtube',
        mediaId: 'video123456',
        sockets: new Set(),
      });

      let fireTimeout = null;
      const timeoutCoordinator = createPvdDurationProbeCoordinator({
        timeoutMs: 500,
        createId: () => 'probe-timeout',
        logger: () => {},
        scheduleTimeout: (callback) => {
          fireTimeout = callback;
          return { unref() {} };
        },
        cancelTimeout: () => {},
      });
      const timedOutPromise = timeoutCoordinator.request({
        sid: 'sid-timeout',
        provider: 'youtube',
        mediaId: 'timeout12345',
        sockets: new Set([socket]),
      });
      fireTimeout();
      const timedOut = await timedOutPromise;

      console.log(JSON.stringify({
        sent,
        mismatch,
        settled,
        values,
        cached,
        timedOut,
        pending: coordinator.getPendingCount(),
      }));
    `;
    result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
    }).trim());
  });

  test('deduplicates in-flight probes and accepts only matching viewer results', () => {
    expect(result.sent[0]).toMatchObject({
      type: 'duration_probe',
      probeId: 'probe-1',
      mediaProvider: 'youtube',
      mediaId: 'video123456',
    });
    expect(result.sent).toHaveLength(2);
    expect(result.mismatch).toEqual({ accepted: false, reason: 'probe_mismatch' });
    expect(result.settled).toEqual({ accepted: true, durationSec: 83 });
    expect(result.values).toEqual([83, 83]);
    expect(result.pending).toBe(0);
  });

  test('reuses successful durations and resolves timed-out probes without a value', () => {
    expect(result.cached).toBe(83);
    expect(result.timedOut).toBeNull();
  });
});
