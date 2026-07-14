const path = require('path');
const { execFileSync } = require('child_process');
const fs = require('fs');

describe('multi-platform session channel identity', () => {
  test('normalizes known platform-prefixed owner ids without weakening validation', () => {
    const moduleUrl = new URL('../server/channel-identity.js', `file://${__filename.replace(/\\/g, '/')}`).href;
    const script = `
      const identity = await import(${JSON.stringify(moduleUrl)});
      console.log(JSON.stringify({
        youtube: identity.getChannelIdFromUserId('youtube:UC0YROn6wSwVbqu5MzEnvnQw'),
        nestedYoutube: identity.getChannelIdFromUserId('user:youtube:UC0YROn6wSwVbqu5MzEnvnQw'),
        chzzk: identity.getChannelIdFromUserId('chzzk:abc_DEF-123'),
        cime: identity.getChannelIdFromUserId('cime:channel_123'),
        invalid: identity.getChannelIdFromUserId('youtube:bad:value'),
        valid: identity.validateChannelId('UC0YROn6wSwVbqu5MzEnvnQw'),
        youtubeOnly: identity.selectPlatformChannelId([
          { provider: 'youtube', channel_id: 'UC0YROn6wSwVbqu5MzEnvnQw' }
        ]),
        youtubeAsChzzk: identity.selectPlatformChannelId([
          { provider: 'youtube', channel_id: 'UC0YROn6wSwVbqu5MzEnvnQw' }
        ], 'chzzk'),
        genericPrefersChzzk: identity.selectPlatformChannelId([
          { provider: 'youtube', channel_id: 'youtube_channel' },
          { provider: 'chzzk', channel_id: 'chzzk_channel' }
        ]),
      }));
    `;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    }).trim());

    expect(result.youtube).toBe('UC0YROn6wSwVbqu5MzEnvnQw');
    expect(result.nestedYoutube).toBe(result.youtube);
    expect(result.chzzk).toBe('abc_DEF-123');
    expect(result.cime).toBe('channel_123');
    expect(result.invalid).toBeNull();
    expect(result.valid).toBe(true);
    expect(result.youtubeOnly).toBe(result.youtube);
    expect(result.youtubeAsChzzk).toBeNull();
    expect(result.genericPrefersChzzk).toBe('chzzk_channel');
  });

  test('generic authenticated sessions are not rejected when channel context is unavailable', () => {
    const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
    const partitionStart = serverIndex.indexOf('async function getPartitionId(req, res)');
    const partitionEnd = serverIndex.indexOf('async function requirePartitionId', partitionStart);
    const partition = serverIndex.slice(partitionStart, partitionEnd > partitionStart ? partitionEnd : partitionStart + 12000);

    expect(partition).toContain('const channelId = await resolveChannelIdForOwnerUserId(userId);');
    expect(partition).toContain('if (channelId) {');
    expect(partition).toContain('return sid;');
    expect(partition).not.toContain('Channel ID validation failed for userId');
  });

  test('legacy SQLite maintenance is opt-in for PostgreSQL deployments', () => {
    const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
    expect(serverIndex).toContain("const USE_LEGACY_SQLITE = String(process.env.ARUBOT_ENABLE_LEGACY_SQLITE || '')");
    expect(serverIndex).toContain('if (USE_LEGACY_SQLITE) {');
  });
});
