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

      const playerCalls = [];
      const playerFallback = await metadata.fetchYouTubeVideoMetadata('quotaTest03', {
        cacheTtlMs: 0,
        failureCacheTtlMs: 0,
        httpGet: async (url) => {
          playerCalls.push({ method: 'get', url });
          return {
            status: 200,
            data: '<script>{"INNERTUBE_API_KEY":"test-key","INNERTUBE_CLIENT_VERSION":"2.20260720.01.00","VISITOR_DATA":"visitor%3D"}<\/script>',
          };
        },
        httpPost: async (url, body) => {
          playerCalls.push({ method: 'post', url, body });
          return {
            status: 200,
            data: {
              playabilityStatus: { status: 'OK' },
              videoDetails: { title: 'Player title', lengthSeconds: '89' },
            },
          };
        },
      });

      const blockedWatchCalls = [];
      const blockedWatchFallback = await metadata.fetchYouTubeVideoMetadata('quotaTest04', {
        cacheTtlMs: 0,
        failureCacheTtlMs: 0,
        httpGet: async (url) => {
          blockedWatchCalls.push({ method: 'get', url });
          if (url.includes('/watch?')) {
            const error = new Error('Request failed with status code 403');
            error.response = { status: 403 };
            throw error;
          }
          return {
            status: 200,
            data: '<script>{"INNERTUBE_API_KEY":"embed-key","INNERTUBE_CLIENT_VERSION":"2.20260720.01.00"}<\/script>',
          };
        },
        httpPost: async (url) => {
          blockedWatchCalls.push({ method: 'post', url });
          return {
            status: 200,
            data: {
              playabilityStatus: { status: 'UNPLAYABLE', reason: 'Playback unavailable' },
              videoDetails: { title: 'Recovered title', lengthSeconds: '91' },
            },
          };
        },
      });

      const failureLogs = [];
      const failed = await metadata.fetchYouTubeVideoMetadata('quotaTest05', {
        cacheTtlMs: 0,
        failureCacheTtlMs: 0,
        logger: (...args) => failureLogs.push(args),
        httpGet: async (url) => {
          if (url.includes('/oembed?')) {
            const error = new Error('Request failed with status code 404');
            error.response = { status: 404 };
            throw error;
          }
          return { status: 200, data: '<html><head><title>YouTube<\/title><\/head><\/html>' };
        },
      });

      const incompleteCalls = [];
      let incompleteRound = 0;
      const incompleteHttpGet = async (url) => {
        incompleteCalls.push(url);
        if (url.includes('/watch?')) {
          incompleteRound += 1;
          return {
            status: 200,
            data: '<script>ytInitialPlayerResponse={"videoDetails":{"lengthSeconds":"66"}}<\/script>',
          };
        }
        if (url.includes('/oembed?') && incompleteRound === 1) {
          const error = new Error('Request failed with status code 503');
          error.response = { status: 503 };
          throw error;
        }
        if (url.includes('/oembed?')) return { data: { title: 'Recovered cached title' } };
        return { status: 200, data: '' };
      };
      const incompleteFirst = await metadata.fetchYouTubeVideoMetadata('quotaTest06', {
        httpGet: incompleteHttpGet,
        cacheTtlMs: 60000,
        failureCacheTtlMs: 0,
      });
      const incompleteSecond = await metadata.fetchYouTubeVideoMetadata('quotaTest06', {
        httpGet: incompleteHttpGet,
        cacheTtlMs: 60000,
        failureCacheTtlMs: 0,
      });

      const embeddedTitle = metadata.extractYouTubeWatchTitle(
        '<script>ytInitialPlayerResponse={"videoDetails":{"title":"Embedded player title","lengthSeconds":"44"}}<\/script>',
      );
      const misleadingLikeTitle = metadata.extractYouTubeWatchTitle(
        '<script>{"videoDetails":{"lengthSeconds":"147"},"videoActions":{"buttonViewModel":{"title":"2만"}}}<\/script>'
          + '<title>YouTube<\/title>',
      );
      const genericTitle = metadata.extractYouTubeWatchTitle('<html><head><title>YouTube<\/title><\/head><\/html>');
      console.log(JSON.stringify({
        first,
        second,
        cached,
        calls,
        fallback,
        fallbackCalls,
        playerFallback,
        playerCalls,
        blockedWatchFallback,
        blockedWatchCalls,
        failed,
        failureLogs,
        incompleteFirst,
        incompleteSecond,
        incompleteCalls,
        embeddedTitle,
        misleadingLikeTitle,
        genericTitle,
      }));
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

  test('reads a title embedded in the watch page player response', () => {
    expect(result.embeddedTitle).toBe('Embedded player title');
  });

  test('does not cross the videoDetails boundary into a like-count title', () => {
    expect(result.misleadingLikeTitle).toBeNull();
  });

  test('retries metadata lookup when only duration was cached previously', () => {
    expect(result.incompleteFirst).toEqual({ title: null, durationSec: 66 });
    expect(result.incompleteSecond).toEqual({ title: 'Recovered cached title', durationSec: 66 });
    expect(result.incompleteCalls.filter((url) => url.includes('/watch?'))).toHaveLength(2);
    expect(result.incompleteCalls.filter((url) => url.includes('/oembed?'))).toHaveLength(2);
  });

  test('does not treat a generic error-page title as video metadata', () => {
    expect(result.genericTitle).toBeNull();
  });

  test('falls back to player metadata when the watch page omits duration', () => {
    expect(result.playerFallback).toEqual({ title: 'Player title', durationSec: 89 });
    expect(result.playerCalls.map((call) => call.method)).toEqual(['get', 'post']);
    expect(result.playerCalls[1].url).toContain('/youtubei/v1/player?key=');
    expect(result.playerCalls[1].body.videoId).toBe('quotaTest03');
  });

  test('recovers through the embed page when the watch page is blocked', () => {
    expect(result.blockedWatchFallback).toEqual({ title: 'Recovered title', durationSec: 91 });
    const methods = result.blockedWatchCalls.map((call) => call.method);
    const urls = result.blockedWatchCalls.map((call) => call.url);
    expect(methods.filter((method) => method === 'post')).toHaveLength(1);
    expect(urls.some((url) => url.includes('/embed/quotaTest04'))).toBe(true);
    expect(urls.some((url) => url.includes('youtube-nocookie.com/embed/quotaTest04'))).toBe(true);
    expect(urls.some((url) => url.includes('m.youtube.com/watch?'))).toBe(true);
    expect(urls.some((url) => url.includes('/get_video_info?'))).toBe(true);
  });

  test('records bounded diagnostics when every duration lookup fails', () => {
    expect(result.failed).toEqual({ title: null, durationSec: null });
    expect(result.failureLogs).toHaveLength(1);
    expect(result.failureLogs[0][0]).toBe('[YouTube video metadata] Duration lookup failed');
    expect(result.failureLogs[0][1]).toMatchObject({ videoId: 'quotaTest05' });
    expect(result.failureLogs[0][1].attempts.map((attempt) => attempt.source)).toEqual(expect.arrayContaining([
      'watch',
      'embed',
      'embed_nocookie',
      'watch_mobile',
      'video_info',
      'oembed',
    ]));
  });
});
