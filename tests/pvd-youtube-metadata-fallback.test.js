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
      const viewerFirst = await resolvePvdYouTubeMetadata({
        fetchServerMetadata: () => new Promise(() => {}),
        fetchViewerDuration: async () => 82.2,
      });
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

      console.log(JSON.stringify({ serverFirst, viewerFirst, viewerAfterUnknownServer, timedOut }));
    `;
    result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
    }).trim());
  });

  test('returns whichever source provides a usable duration first', () => {
    expect(result.serverFirst).toEqual({ title: 'Server title', durationSec: 82 });
    expect(result.viewerFirst).toEqual({ title: null, durationSec: 83 });
  });

  test('keeps an available title and bounds total metadata wait time', () => {
    expect(result.viewerAfterUnknownServer).toEqual({ title: 'Known title', durationSec: 83 });
    expect(result.timedOut).toEqual({ title: null, durationSec: null });
  });
});
