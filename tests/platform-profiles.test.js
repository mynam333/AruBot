const { execFileSync } = require('child_process');

function runModuleTest(source) {
  execFileSync('node', ['--input-type=module', '-e', source], {
    cwd: process.cwd(),
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

describe('Platform profile normalization', () => {
  test('normalizes CHZZK public channel response', () => {
    runModuleTest(`
      import assert from 'node:assert/strict';
      import { normalizeChzzkPublicProfile } from './server/platform-profiles.js';
      const result = normalizeChzzkPublicProfile({
        content: {
          channelId: 'abc123',
          channelName: '테스트 채널',
          channelImageUrl: 'https://example.com/profile.png',
          channelDescription: '채널 소개',
          followerCount: 1234,
          verified: true,
          openLive: true,
          channelType: 'STREAMING'
        }
      });
      assert.equal(result.channelId, 'abc123');
      assert.equal(result.channelName, '테스트 채널');
      assert.equal(result.channelImageUrl, 'https://example.com/profile.png');
      assert.equal(result.description, '채널 소개');
      assert.equal(result.followerCount, 1234);
      assert.equal(result.verified, true);
      assert.equal(result.openLive, true);
      assert.equal(result.channelType, 'STREAMING');
    `);
  });

  test('normalizes CIME app channel response', () => {
    runModuleTest(`
      import assert from 'node:assert/strict';
      import { normalizeCimePublicProfile } from './server/platform-profiles.js';
      const result = normalizeCimePublicProfile({
        code: 200,
        data: {
          id: '10',
          slug: 'indongyoo',
          name: '유인동',
          description: '유인동님의 채널',
          imageUrl: 'https://streaming.cf.ci.me/profile.jpg',
          videoBannerImageUrl: 'https://streaming.cf.ci.me/banner.jpg',
          followerCount: 409,
          subscriberCount: 12,
          level: 1,
          isLive: false,
          canSubscription: true,
          canChatDonation: false,
          canVideoDonation: true,
          canMissionDonation: true
        }
      });
      assert.equal(result.channelId, '10');
      assert.equal(result.channelHandle, 'indongyoo');
      assert.equal(result.channelName, '유인동');
      assert.equal(result.description, '유인동님의 채널');
      assert.equal(result.channelImageUrl, 'https://streaming.cf.ci.me/profile.jpg');
      assert.equal(result.videoBannerImageUrl, 'https://streaming.cf.ci.me/banner.jpg');
      assert.equal(result.followerCount, 409);
      assert.equal(result.subscriberCount, 12);
      assert.equal(result.level, 1);
      assert.equal(result.isLive, false);
      assert.equal(result.canSubscription, true);
      assert.equal(result.canChatDonation, false);
      assert.equal(result.canVideoDonation, true);
      assert.equal(result.canMissionDonation, true);
    `);
  });

  test('builds profile refresh URL from CIME template first', () => {
    runModuleTest(`
      import assert from 'node:assert/strict';
      import { createPlatformProfileService } from './server/platform-profiles.js';
      const called = [];
      const service = createPlatformProfileService({
        cimeProfileUrlTemplate: 'https://ci.me/custom/{channelId}/{handle}',
        httpGet: async (url) => {
          called.push(url);
          return { data: { id: '10', slug: 'indongyoo', name: '유인동' } };
        },
        now: () => '2026-07-01T00:00:00.000Z'
      });
      const enriched = await service.enrichCimeProfile({
        platformUserId: '10',
        channelId: '10',
        channelHandle: 'indongyoo',
        metadata: {}
      }, null, { forceRefresh: true });
      assert.equal(called[0], 'https://ci.me/custom/10/indongyoo');
      assert.equal(enriched.channelName, '유인동');
      assert.equal(enriched.metadata.publicProfile.status, 'ok');
    `);
  });

  test('records failed public profile refresh without dropping existing profile', () => {
    runModuleTest(`
      import assert from 'node:assert/strict';
      import { createPlatformProfileService } from './server/platform-profiles.js';
      const service = createPlatformProfileService({
        chzzkApiBase: 'https://api.chzzk.naver.com',
        httpGet: async () => {
          throw new Error('network down');
        },
        now: () => '2026-07-01T00:00:00.000Z'
      });
      const enriched = await service.enrichChzzkProfile({
        platformUserId: 'abc123',
        channelId: 'abc123',
        channelName: '기존 채널',
        channelImageUrl: 'https://example.com/old.png',
        metadata: {}
      }, { forceRefresh: true });
      assert.equal(enriched.channelName, '기존 채널');
      assert.equal(enriched.channelImageUrl, 'https://example.com/old.png');
      assert.equal(enriched.metadata.publicProfile.provider, 'chzzk');
      assert.equal(enriched.metadata.publicProfile.status, 'failed');
      assert.equal(enriched.metadata.publicProfile.error, 'network down');
    `);
  });

  test('reuses fresh public profile metadata without another request', () => {
    runModuleTest(`
      import assert from 'node:assert/strict';
      import { createPlatformProfileService } from './server/platform-profiles.js';
      let requests = 0;
      const service = createPlatformProfileService({
        nowMs: () => Date.parse('2026-07-01T00:05:00.000Z'),
        httpGet: async () => {
          requests += 1;
          return { content: { channelId: 'abc123', channelName: 'fresh-name' } };
        }
      });
      const profile = {
        platformUserId: 'abc123',
        channelId: 'abc123',
        channelName: 'cached-name',
        metadata: {
          publicProfile: {
            provider: 'chzzk',
            status: 'ok',
            fetchedAt: '2026-07-01T00:00:00.000Z'
          }
        }
      };
      const enriched = await service.enrichChzzkProfile(profile);
      assert.equal(enriched.channelName, 'cached-name');
      assert.equal(requests, 0);
    `);
  });

  test('deduplicates CIME profile candidate URLs', () => {
    runModuleTest(`
      import assert from 'node:assert/strict';
      import { createPlatformProfileService } from './server/platform-profiles.js';
      const called = [];
      const service = createPlatformProfileService({
        cimeAppApiBase: 'https://ci.me/api/app',
        cimeProfileUrlTemplate: 'https://ci.me/api/app/channels/id/{channelId}',
        httpGet: async (url) => {
          called.push(url);
          return { data: { id: '10', slug: 'streamer', name: 'streamer' } };
        }
      });
      await service.enrichCimeProfile({
        platformUserId: '10',
        channelId: '10',
        metadata: {}
      }, null, { forceRefresh: true });
      assert.deepEqual(called, ['https://ci.me/api/app/channels/id/10']);
    `);
  });
});
