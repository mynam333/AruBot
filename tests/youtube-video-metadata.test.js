const path = require('path');
const { execFileSync } = require('child_process');

describe('quota-free YouTube video metadata', () => {
  let result;

  beforeAll(() => {
    const moduleUrl = new URL('../server/youtube-video-metadata.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const script = `
      const metadata = await import(${JSON.stringify(moduleUrl)});
      const calls = [];
      const httpGet = async (url) => {
        calls.push(url);
        return {
          data: '<html><head><meta property="og:title" content="Quota &amp; Free"><\/head>'
            + '<body><script>ytInitialPlayerResponse={"videoDetails":{"lengthSeconds":"123"}}<\/script><\/body><\/html>',
        };
      };
      const [first, second] = await Promise.all([
        metadata.fetchYouTubeVideoMetadata('quotaTest01', { httpGet, cacheTtlMs: 60000 }),
        metadata.fetchYouTubeVideoMetadata('quotaTest01', { httpGet, cacheTtlMs: 60000 }),
      ]);
      const cached = await metadata.fetchYouTubeVideoMetadata('quotaTest01', { httpGet, cacheTtlMs: 60000 });

      const fallbackCalls = [];
      const fallback = await metadata.fetchYouTubeVideoMetadata('quotaTest02', {
        cacheTtlMs: 0,
        failureCacheTtlMs: 0,
        httpGet: async (url) => {
          fallbackCalls.push(url);
          if (url.includes('/oembed?')) return { data: { title: 'oEmbed title' } };
          return { data: '<script>ytInitialPlayerResponse={"videoDetails":{"lengthSeconds":"77"}}<\/script>' };
        },
      });

      const genericTitle = metadata.extractYouTubeWatchTitle('<html><head><title>YouTube<\/title><\/head><\/html>');
      console.log(JSON.stringify({ first, second, cached, calls, fallback, fallbackCalls, genericTitle }));
    `;
    result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    }).trim());
  });

  test('reads title and duration from the watch page', () => {
    expect(result.first).toEqual({ title: 'Quota & Free', durationSec: 123 });
    expect(result.second).toEqual(result.first);
    expect(result.cached).toEqual(result.first);
  });

  test('deduplicates concurrent requests and caches repeated lookups', () => {
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toContain('youtube.com/watch?');
  });

  test('uses the quota-free title fallback without calling Data API endpoints', () => {
    expect(result.fallback).toEqual({ title: 'oEmbed title', durationSec: 77 });
    expect(result.fallbackCalls).toHaveLength(2);
    expect(result.fallbackCalls.some((url) => url.includes('/oembed?'))).toBe(true);
    expect([...result.calls, ...result.fallbackCalls].some((url) => url.includes('googleapis.com/youtube/v3'))).toBe(false);
  });

  test('does not treat a generic error-page title as video metadata', () => {
    expect(result.genericTitle).toBeNull();
  });
});
