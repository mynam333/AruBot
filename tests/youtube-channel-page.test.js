const path = require('path');
const { execFileSync } = require('child_process');

describe('YouTube public channel page metadata', () => {
  let result;

  beforeAll(() => {
    const moduleUrl = new URL('../server/youtube-channel-page.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const script = `
      const channelPage = await import(${JSON.stringify(moduleUrl)});
      const metaPage = channelPage.extractYoutubeChannelPageMetadata(
        '<html><head>'
          + '<meta content="UC1234567890123456789012" itemprop="channelId">'
          + '<meta content="Quota &amp; Free Channel" property="og:title">'
          + '<meta property="og:image" content="https://yt3.example/avatar.jpg">'
          + '<link href="https://www.youtube.com/@quota_free" rel="canonical">'
          + '</head></html>'
      );
      const rendererPage = channelPage.extractYoutubeChannelPageMetadata(
        '<script>{"channelMetadataRenderer":{"title":"Renderer Channel","externalId":"UCabcdefghijklmnopqrstuv","vanityChannelUrl":"https://www.youtube.com/@renderer"},"other":{"externalId":"UCzzzzzzzzzzzzzzzzzzzzzz"}}</script>'
      );
      const boundedPage = channelPage.extractYoutubeChannelPageMetadata(
        '<script>{"channelMetadataRenderer":{"title":"No channel id"},"other":{"externalId":"UCzzzzzzzzzzzzzzzzzzzzzz"}}</script>'
      );
      console.log(JSON.stringify({
        metaPage,
        rendererPage,
        boundedPage,
        validId: channelPage.isYoutubeChannelId('UC1234567890123456789012'),
        invalidId: channelPage.isYoutubeChannelId('google:subject-hash'),
      }));
    `;
    result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    }).trim());
  });

  test('reads channel identity from public metadata regardless of attribute order', () => {
    expect(result.metaPage).toMatchObject({
      channelId: 'UC1234567890123456789012',
      handle: 'quota_free',
      title: 'Quota & Free Channel',
      thumbnailUrl: 'https://yt3.example/avatar.jpg',
    });
  });

  test('reads the bounded channelMetadataRenderer object', () => {
    expect(result.rendererPage).toMatchObject({
      channelId: 'UCabcdefghijklmnopqrstuv',
      handle: 'renderer',
      title: 'Renderer Channel',
    });
    expect(result.boundedPage.channelId).toBeNull();
  });

  test('does not treat a Google OAuth subject as a YouTube channel id', () => {
    expect(result.validId).toBe(true);
    expect(result.invalidId).toBe(false);
  });
});
