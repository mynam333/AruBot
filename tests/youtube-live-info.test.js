const path = require('path');
const { execFileSync } = require('child_process');

describe('YouTube provider-scoped live info', () => {
  let result;

  beforeAll(() => {
    const moduleUrl = new URL('../server/youtube-live-info.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const script = `
      const live = await import(${JSON.stringify(moduleUrl)});
      const contaminated = live.buildYoutubeLiveLookupContext({
        ownerUserId: 'owner',
        entry: { channelId: 'yt-channel', broadcastId: 'yt-video', liveChatId: 'yt-chat', connected: true },
        streamerChannel: { youtubeChannelId: 'yt-channel', title: 'YouTube 채널', lastLiveTitle: '저장된 YouTube 제목' },
        cachedState: { provider: 'cime', live: true, title: '씨미 방송 제목', broadcastId: 'cime-live' },
      });
      const youtubeCached = live.buildYoutubeLiveLookupContext({
        ownerUserId: 'owner',
        streamerChannel: { youtubeChannelId: 'yt-channel', lastDetectedVideoId: 'older-video' },
        cachedState: { provider: 'youtube', live: true, title: '현재 YouTube 제목', broadcastId: 'current-video', liveChatId: 'yt-chat', startTs: 1000 },
      });
      console.log(JSON.stringify({
        contaminated,
        contaminatedFallback: live.buildYoutubeLiveInfoFallback(contaminated),
        youtubeCached,
        youtubeFallback: live.buildYoutubeLiveInfoFallback(youtubeCached),
        youtubeOffline: live.buildYoutubeOfflineLiveInfo({ hasIdentity: true, channel: 'YouTube 채널', channelId: 'yt-channel' }),
        missingOffline: live.buildYoutubeOfflineLiveInfo({ hasIdentity: false }),
      }));
    `;
    result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    }).trim());
  });

  test('never reuses a CIME cache entry for a YouTube command', () => {
    expect(result.contaminated.title).toBe('저장된 YouTube 제목');
    expect(result.contaminated.broadcastIds).toEqual(['yt-video']);
    expect(result.contaminatedFallback.title).toBe('저장된 YouTube 제목');
    expect(result.contaminatedFallback.provider).toBe('youtube');
  });

  test('preserves YouTube title and broadcast identity from a YouTube cache entry', () => {
    expect(result.youtubeCached.title).toBe('현재 YouTube 제목');
    expect(result.youtubeCached.broadcastIds).toEqual(['current-video', 'older-video']);
    expect(result.youtubeFallback.title).toBe('현재 YouTube 제목');
    expect(result.youtubeFallback.startedAtTs).toBe(1000);
  });

  test('represents a successful no-active-broadcast lookup as not_live', () => {
    expect(result.youtubeOffline).toMatchObject({
      provider: 'youtube',
      status: 'not_live',
      channel: 'YouTube 채널',
      live: false,
    });
    expect(result.missingOffline).toBeNull();
  });
});
