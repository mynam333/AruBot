const path = require('path');
const { execFileSync } = require('child_process');

describe('drawing donation live playback', () => {
  let result;

  beforeAll(() => {
    const moduleUrl = new URL('../server/drawing-live-playback.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const script = `
      const playback = await import(${JSON.stringify(moduleUrl)});
      const cime = { data: { playback: { url: 'https://example.playback.live-video.net/live.m3u8?token=abc' } } };
      const chzzk = { content: { livePlaybackJson: JSON.stringify({ media: [
        { mediaId: 'HLS', path: 'https://example.com/hls.m3u8' },
        { mediaId: 'LLHLS', path: 'https://example.com/llhls.m3u8' },
      ] }) } };
      const youtube = (channelId, content = 'live', embeddable = true) => ({
        live: true,
        raw: {
          id: 'abcdefghijk',
          snippet: { channelId, liveBroadcastContent: content },
          liveStreamingDetails: { actualStartTime: '2026-09-26T00:00:00Z' },
          status: { embeddable },
        },
      });
      console.log(JSON.stringify({
        cime: playback.parseCimeLivePlaybackUrl(cime),
        cimeLegacy: playback.parseCimeLivePlaybackUrl({ data: { playbackUrl: 'https://example.com/legacy.m3u8' } }),
        cimeInvalid: playback.parseCimeLivePlaybackUrl({ data: { playback: { url: 'http://example.com/live.m3u8' } } }),
        cimeSlug: playback.parseCimeChannelSlug({ data: { id: 1033927, slug: 'hebi' } }, '1033927'),
        cimeWrongSlug: playback.parseCimeChannelSlug({ data: { id: 1033928, slug: 'hebi' } }, '1033927'),
        chzzk: playback.parseChzzkLivePlaybackUrl(chzzk),
        chzzkFallback: playback.parseChzzkLivePlaybackUrl({ content: { livePlaybackJson: JSON.stringify({ media: [{ mediaId: 'HLS', path: 'https://example.com/hls.m3u8' }] }) } }),
        youtube: playback.youtubeLiveEmbedUrl(youtube('UC0123456789012345678901'), 'UC0123456789012345678901'),
        youtubeOtherChannel: playback.youtubeLiveEmbedUrl(youtube('UC9999999999999999999999'), 'UC0123456789012345678901'),
        youtubeOffline: playback.youtubeLiveEmbedUrl(youtube('UC0123456789012345678901', 'none'), 'UC0123456789012345678901'),
        youtubeRestricted: playback.youtubeLiveEmbedUrl(youtube('UC0123456789012345678901', 'live', false), 'UC0123456789012345678901'),
      }));
    `;
    result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    }).trim());
  });

  test('reads CIME playback.url and resolves numeric channel IDs through a verified slug', () => {
    expect(result.cime).toBe('https://example.playback.live-video.net/live.m3u8?token=abc');
    expect(result.cimeLegacy).toBe('https://example.com/legacy.m3u8');
    expect(result.cimeInvalid).toBeNull();
    expect(result.cimeSlug).toBe('hebi');
    expect(result.cimeWrongSlug).toBeNull();
  });

  test('prefers CHZZK low-latency HLS and falls back to ordinary HLS', () => {
    expect(result.chzzk).toBe('https://example.com/llhls.m3u8');
    expect(result.chzzkFallback).toBe('https://example.com/hls.m3u8');
  });

  test('only embeds a live, embeddable video belonging to the selected YouTube channel', () => {
    expect(result.youtube).toBe('https://www.youtube.com/embed/abcdefghijk?autoplay=1&mute=1&playsinline=1');
    expect(result.youtubeOtherChannel).toBeNull();
    expect(result.youtubeOffline).toBeNull();
    expect(result.youtubeRestricted).toBeNull();
  });
});
