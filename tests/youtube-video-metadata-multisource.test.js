const { execFileSync } = require('child_process');

describe('multi-source YouTube video metadata fallbacks', () => {
  let result;

  beforeAll(() => {
    const moduleUrl = new URL('../server/youtube-video-metadata.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const script = `
      const metadata = await import(${JSON.stringify(moduleUrl)});

      const embeddedCalls = [];
      const embeddedFallback = await metadata.fetchYouTubeVideoMetadata('embedTest01', {
        cacheTtlMs: 0,
        failureCacheTtlMs: 0,
        httpGet: async (url) => {
          embeddedCalls.push({ method: 'get', url });
          return {
            status: 200,
            data: '<script>{"INNERTUBE_API_KEY":"key","INNERTUBE_CLIENT_VERSION":"2.20260720.01.00"}<\/script>',
          };
        },
        httpPost: async (url, body) => {
          embeddedCalls.push({ method: 'post', url, clientName: body.context.client.clientName });
          if (body.context.client.clientName === 'WEB') {
            return { status: 200, data: { playabilityStatus: { status: 'UNPLAYABLE' } } };
          }
          return {
            status: 200,
            data: {
              playabilityStatus: { status: 'OK' },
              videoDetails: { title: 'Embedded player title', lengthSeconds: '94' },
            },
          };
        },
      });

      const legacyCalls = [];
      const legacyPlayerResponse = JSON.stringify({
        playabilityStatus: { status: 'OK' },
        videoDetails: { title: 'Legacy title', lengthSeconds: '95' },
      });
      const legacyFallback = await metadata.fetchYouTubeVideoMetadata('legacyTest01', {
        cacheTtlMs: 0,
        failureCacheTtlMs: 0,
        httpGet: async (url) => {
          legacyCalls.push(url);
          if (url.includes('/get_video_info?')) {
            return {
              status: 200,
              data: new URLSearchParams({ player_response: legacyPlayerResponse }).toString(),
            };
          }
          return { status: 200, data: '<html><head><title>YouTube<\/title><\/head><\/html>' };
        },
      });

      console.log(JSON.stringify({ embeddedFallback, embeddedCalls, legacyFallback, legacyCalls }));
    `;
    result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
    }).trim());
  });

  test('retries player metadata with the embedded client profile', () => {
    expect(result.embeddedFallback).toEqual({ title: 'Embedded player title', durationSec: 94 });
    expect(result.embeddedCalls.filter((call) => call.method === 'post').map((call) => call.clientName)).toEqual([
      'WEB',
      'WEB_EMBEDDED_PLAYER',
    ]);
  });

  test('parses the legacy player response when page metadata is unavailable', () => {
    expect(result.legacyFallback).toEqual({ title: 'Legacy title', durationSec: 95 });
    expect(result.legacyCalls.some((url) => url.includes('/get_video_info?'))).toBe(true);
    expect(result.legacyCalls.some((url) => url.includes('googleapis.com/youtube/v3'))).toBe(false);
  });
});
