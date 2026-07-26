const { execFileSync } = require('child_process');

describe('PVD YouTube metadata fallback', () => {
  let result;

  beforeAll(() => {
    const moduleUrl = new URL('../server/pvd-youtube-metadata-fallback.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const script = `
      const { resolvePvdYouTubeMetadata } = await import(${JSON.stringify(moduleUrl)});

      const serverFirst = await resolvePvdYouTubeMetadata({
        fetchServerMetadata: async () => ({ title: 'Server title', durationSec: 81.1 }),
        fetchViewerDuration: () => new Promise(() => {}),
      });
      let resolveViewerFirstServer;
      let viewerFirstResolved = false;
      const viewerFirstPromise = resolvePvdYouTubeMetadata({
        fetchServerMetadata: () => new Promise((resolve) => {
          resolveViewerFirstServer = resolve;
        }),
        fetchViewerDuration: async () => 82.2,
      });
      viewerFirstPromise.then(() => {
        viewerFirstResolved = true;
      });
      await Promise.resolve();
      await Promise.resolve();
      const viewerFirstReturnedBeforeTitle = viewerFirstResolved;
      resolveViewerFirstServer({ title: 'Delayed server title', durationSec: null });
      const viewerFirst = await viewerFirstPromise;
      const viewerAfterUnknownServer = await resolvePvdYouTubeMetadata({
        fetchServerMetadata: async () => ({ title: 'Known title', durationSec: null }),
        fetchViewerDuration: async () => 83,
      });

      let fireTimeout = null;
      const timedOutPromise = resolvePvdYouTubeMetadata({
        fetchServerMetadata: () => new Promise(() => {}),
        fetchViewerDuration: async () => null,
        timeoutMs: 500,
        scheduleTimeout: (callback) => {
          fireTimeout = callback;
          return { unref() {} };
        },
        cancelTimeout: () => {},
      });
      await Promise.resolve();
      await Promise.resolve();
      fireTimeout();
      const timedOut = await timedOutPromise;

      console.log(JSON.stringify({ serverFirst, viewerFirst, viewerFirstReturnedBeforeTitle, viewerAfterUnknownServer, timedOut }));
    `;
    result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
    }).trim());
  });

  test('keeps the delayed server title when the viewer provides duration first', () => {
    expect(result.serverFirst).toEqual({ title: 'Server title', durationSec: 82 });
    expect(result.viewerFirstReturnedBeforeTitle).toBe(false);
    expect(result.viewerFirst).toEqual({ title: 'Delayed server title', durationSec: 83 });
  });

  test('keeps an available title and bounds total metadata wait time', () => {
    expect(result.viewerAfterUnknownServer).toEqual({ title: 'Known title', durationSec: 83 });
    expect(result.timedOut).toEqual({ title: null, durationSec: null });
  });
});
