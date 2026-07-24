const { execFileSync } = require('child_process');

describe('PVD duration probe transports', () => {
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
      const coordinator = createPvdDurationProbeCoordinator({
        timeoutMs: 5000,
        createId: () => 'probe-late-viewer',
        logger: () => {},
      });

      const pendingPromise = coordinator.request({
        sid: 'sid-late',
        provider: 'youtube',
        mediaId: 'lateVideo01',
        sockets: new Set(),
      });
      const listedBeforeConnect = coordinator.listPending('sid-late');
      const dispatched = coordinator.dispatchPendingToSocket('sid-late', socket);
      const failure = coordinator.settle({
        sid: 'sid-late',
        probeId: 'probe-late-viewer',
        provider: 'youtube',
        mediaId: 'lateVideo01',
        errorCode: 'player_error_101',
      });
      const listedAfterFailure = coordinator.listPending('sid-late');
      const success = coordinator.settle({
        sid: 'sid-late',
        probeId: 'probe-late-viewer',
        provider: 'youtube',
        mediaId: 'lateVideo01',
        durationSec: 92.1,
      });
      const durationSec = await pendingPromise;

      console.log(JSON.stringify({
        listedBeforeConnect,
        dispatched,
        sent,
        failure,
        listedAfterFailure,
        success,
        durationSec,
        listedAfterSuccess: coordinator.listPending('sid-late'),
        pendingCount: coordinator.getPendingCount(),
      }));
    `;
    result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
    }).trim());
  });

  test('keeps a probe pending until a viewer connects and dispatches it then', () => {
    expect(result.listedBeforeConnect).toHaveLength(1);
    expect(result.listedBeforeConnect[0]).toMatchObject({
      type: 'duration_probe',
      probeId: 'probe-late-viewer',
      mediaProvider: 'youtube',
      mediaId: 'lateVideo01',
    });
    expect(result.dispatched).toBe(1);
    expect(result.sent).toHaveLength(1);
  });

  test('keeps polling-visible probes pending after one viewer failure', () => {
    expect(result.failure).toEqual({ accepted: true, pending: true, reason: 'probe_failed' });
    expect(result.listedAfterFailure).toHaveLength(1);
  });

  test('settles and removes the probe after a valid duration arrives', () => {
    expect(result.success).toEqual({ accepted: true, durationSec: 93 });
    expect(result.durationSec).toBe(93);
    expect(result.listedAfterSuccess).toEqual([]);
    expect(result.pendingCount).toBe(0);
  });
});
