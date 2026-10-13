const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server/youtube-account-identity.js'), 'utf8');
const scope = { module: { exports: {} } };
vm.runInNewContext(`${source.replace(/^export /gm, '')}
  module.exports = { mergeYoutubeAccountProfile, planYoutubeAccountRepairs, findYoutubeTokenAccount,
    repairYoutubeAccountsWithClient, upsertYoutubeIdentityWithClient, updateYoutubeProfileWithClient };`, scope);
const {
  mergeYoutubeAccountProfile, planYoutubeAccountRepairs, findYoutubeTokenAccount,
  repairYoutubeAccountsWithClient, upsertYoutubeIdentityWithClient, updateYoutubeProfileWithClient,
} = scope.module.exports;

const CHANNEL = `UC${'A'.repeat(22)}`;
const OTHER_CHANNEL = `UC${'B'.repeat(22)}`;
const HASH = 'a'.repeat(64);
const GOOGLE = `google:${HASH}`;
const OTHER_GOOGLE = `google:${'b'.repeat(64)}`;
const EARLY = '2026-01-01T00:00:00.000Z';
const LATE = '2026-10-01T00:00:00.000Z';

function account(platformUserId = GOOGLE, extra = {}) {
  return {
    id: platformUserId === GOOGLE ? 'canonical-id' : 'legacy-id',
    provider: 'youtube', user_id: 'owner', platform_user_id: platformUserId,
    channel_id: CHANNEL, channel_name: 'Channel', channel_handle: '@channel', avatar_url: 'avatar',
    metadata: {}, connected_at: LATE, last_login_at: LATE, ...extra,
  };
}

function profile(extra = {}) {
  return {
    platformUserId: GOOGLE, channelId: CHANNEL, channelName: 'Current channel',
    metadata: { googleSubjectHash: HASH, identitySource: 'youtube_data_api', publicProfile: { status: 'ok', channelId: CHANNEL } },
    ...extra,
  };
}

function fakeDatabase(initial, failOn = null) {
  let rows = structuredClone(initial);
  let snapshot;
  const calls = [];
  const pg = {
    calls, accounts: () => structuredClone(rows),
    query: jest.fn(async (sql, args = []) => {
      const query = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      calls.push({ query, args });
      if (failOn && query.includes(failOn)) throw new Error('injected database failure');
      if (query === 'begin') snapshot = structuredClone(rows);
      else if (query === 'rollback') rows = snapshot;
      else if (query === 'commit' || query.includes('pg_advisory_xact_lock')) { /* transaction boundary */ }
      else if (query === 'select id from app_users where id=$1 for update') { /* parent lock before account rows */ }
      else if (query.startsWith('select user_id from platform_accounts')) {
        return { rows: rows.filter((row) => row.provider === 'youtube' && row.platform_user_id === args[0]) };
      } else if (query.startsWith('select * from platform_accounts')) {
        return { rows: structuredClone(rows.filter((row) => row.provider === 'youtube' && row.user_id === args[0])) };
      } else if (query.startsWith('insert into app_users') || query.startsWith('update app_users')) { /* owner profile only */ }
      else if (query.startsWith('insert into platform_accounts')) {
        let row = rows.find((item) => item.provider === 'youtube' && item.platform_user_id === args[1]);
        if (!row) {
          row = { id: `inserted-${rows.length}`, provider: 'youtube', user_id: args[0], connected_at: LATE };
          rows.push(row);
        }
        Object.assign(row, {
          platform_user_id: args[1], channel_id: args[2], channel_name: args[3], channel_handle: args[4],
          avatar_url: args[5], metadata: JSON.parse(args[6]), last_login_at: LATE,
        });
        return { rows: [structuredClone(row)], rowCount: 1 };
      } else if (query.startsWith('update platform_accounts')) {
        const row = rows.find((item) => item.provider === 'youtube' && item.user_id === args[0] && item.platform_user_id === args[1]);
        if (!row) return { rows: [], rowCount: 0 };
        Object.assign(row, {
          channel_id: args[2], channel_name: args[3], channel_handle: args[4], avatar_url: args[5],
          metadata: JSON.parse(args[6]), connected_at: args[7], last_login_at: args[8],
        });
        return { rows: [structuredClone(row)], rowCount: 1 };
      } else if (query.startsWith('delete from platform_accounts')) {
        const previous = rows.length;
        rows = rows.filter((row) => !(row.provider === 'youtube' && row.user_id === args[0] && args[1].includes(row.id)));
        return { rows: [], rowCount: previous - rows.length };
      } else throw new Error(`Unexpected SQL: ${query}`);
      return { rows: [], rowCount: 0 };
    }),
  };
  return pg;
}

describe('YouTube account identity preservation', () => {
  test('refresh keeps the Google key and identity metadata instead of adopting the channel ID', () => {
    const original = account(GOOGLE, { metadata: { identitySource: 'google_oidc', googleSubjectHash: HASH, retained: true } });
    const updated = mergeYoutubeAccountProfile(original, profile({ platformUserId: CHANNEL, metadata: { publicProfile: { status: 'ok' } } }));
    expect(updated.platform_user_id).toBe(GOOGLE);
    expect(updated.metadata).toEqual({ identitySource: 'google_oidc', googleSubjectHash: HASH, retained: true, publicProfile: { status: 'ok' } });
    expect(original.channel_name).toBe('Channel');
  });

  test('quota fallback and viewer login preserve a known channel and restore its Google hash', () => {
    const original = account(GOOGLE, { metadata: { publicProfile: { status: 'ok', channelId: CHANNEL } } });
    const updated = mergeYoutubeAccountProfile(original, profile({
      channelId: null, channelName: 'Google name', channelImageUrl: 'google-avatar',
      metadata: { identitySource: 'google_oidc', publicProfile: { status: 'identity_only', channelId: null } },
    }));
    expect(updated).toMatchObject({ channel_id: CHANNEL, channel_name: 'Channel', avatar_url: 'avatar' });
    expect(updated.metadata).toMatchObject({ googleSubjectHash: HASH, publicProfile: { status: 'ok', channelId: CHANNEL } });
  });

  test('first identity-only login does not invent a channel ID', () => {
    const result = mergeYoutubeAccountProfile(null, profile({ channelId: null }));
    expect(result.channel_id).toBeNull();
    expect(result.platform_user_id).toBe(GOOGLE);
  });

  test('repair merges only the same-owner channel alias, preserving metadata and dates', () => {
    const legacy = account(CHANNEL, { connected_at: EARLY, metadata: { preserved: 'legacy' } });
    const canonical = account(GOOGLE, { channel_handle: null, metadata: { preserved: 'current' } });
    const repairs = planYoutubeAccountRepairs([legacy, canonical, account(OTHER_CHANNEL, { channel_id: OTHER_CHANNEL })]);
    expect(repairs).toHaveLength(1);
    expect(repairs[0].remove).toEqual([legacy]);
    expect(repairs[0].keep).toMatchObject({ platform_user_id: GOOGLE, connected_at: EARLY, channel_handle: '@channel', metadata: { preserved: 'current', googleSubjectHash: HASH } });
  });

  test.each([
    ['another owner', account(CHANNEL, { user_id: 'other' })],
    ['another channel', account(OTHER_CHANNEL, { channel_id: OTHER_CHANNEL })],
    ['a conflicting verified subject', account(CHANNEL, { metadata: { googleSubjectHash: 'b'.repeat(64) } })],
    ['another provider', account(CHANNEL, { provider: 'chzzk' })],
    ['a channel overwritten by the old refresh loop', account(OTHER_CHANNEL)],
  ])('does not merge %s', (_label, legacy) => {
    expect(planYoutubeAccountRepairs([account(), legacy])).toEqual([]);
  });

  test('keeps ambiguous connections belonging to different Google principals', () => {
    const accounts = [account(), account(OTHER_GOOGLE), account(CHANNEL)];
    expect(planYoutubeAccountRepairs(accounts)).toEqual([]);
    expect(findYoutubeTokenAccount(accounts.slice(0, 2), CHANNEL)).toBeNull();
    expect(findYoutubeTokenAccount(accounts, OTHER_GOOGLE)).toBe(accounts[1]);
  });

  test('resolves a retained legacy token to the canonical account without rewriting the grant', () => {
    const canonical = account();
    expect(findYoutubeTokenAccount([canonical], CHANNEL)).toBe(canonical);
    expect(findYoutubeTokenAccount([canonical], OTHER_GOOGLE)).toBeNull();
    expect(findYoutubeTokenAccount([canonical], null)).toBeNull();
  });
});

describe('YouTube transactional account writes', () => {
  test('repeated reconnects consolidate the legacy row and preserve the original owner', async () => {
    const pg = fakeDatabase([account(CHANNEL, { connected_at: EARLY, metadata: { legacySetting: 42 } })]);
    const first = await upsertYoutubeIdentityWithClient(pg, profile(), 'owner');
    const second = await upsertYoutubeIdentityWithClient(pg, profile({ channelId: null }), 'different-owner');
    expect(first.userId).toBe('owner');
    expect(second.userId).toBe('owner');
    expect(pg.accounts()).toHaveLength(1);
    expect(second.account).toMatchObject({ platform_user_id: GOOGLE, channel_id: CHANNEL, connected_at: EARLY, metadata: { legacySetting: 42 } });
    expect(pg.calls[1].args).toEqual([`youtube-accounts:identity:${GOOGLE}`]);
    expect(pg.calls.at(-1).query).toBe('commit');
    expect(pg.calls.some((call) => /platform_tokens|points|bot_settings/.test(call.query))).toBe(false);
  });

  test('profile refresh repairs existing duplicates and accepts the legacy token alias afterward', async () => {
    const pg = fakeDatabase([account(CHANNEL, { connected_at: EARLY }), account()]);
    const updated = await updateYoutubeProfileWithClient(pg, 'owner', CHANNEL, profile({ platformUserId: CHANNEL }));
    expect(updated).toMatchObject({ platform_user_id: GOOGLE, channel_name: 'Current channel', connected_at: EARLY });
    expect(pg.accounts()).toHaveLength(1);
    expect(await repairYoutubeAccountsWithClient(pg, 'owner')).toBe(0);
  });

  test('resolved channel lookup repairs an identity-only duplicate in the same transaction', async () => {
    const pg = fakeDatabase([account(CHANNEL), account(GOOGLE, { channel_id: null })]);
    const updated = await updateYoutubeProfileWithClient(pg, 'owner', GOOGLE, profile());
    expect(updated.platform_user_id).toBe(GOOGLE);
    expect(pg.accounts()).toHaveLength(1);
  });

  test('does not create a missing identity from a profile refresh', async () => {
    const pg = fakeDatabase([account()]);
    expect(await updateYoutubeProfileWithClient(pg, 'owner', OTHER_GOOGLE, profile())).toBeNull();
    expect(pg.accounts()).toHaveLength(1);
  });

  test('cleanup failure rolls back the inserted account and does not commit partial deletion', async () => {
    const legacy = account(CHANNEL);
    const pg = fakeDatabase([legacy], 'delete from platform_accounts');
    await expect(upsertYoutubeIdentityWithClient(pg, profile(), 'owner')).rejects.toThrow('injected database failure');
    expect(pg.accounts()).toEqual([legacy]);
    expect(pg.calls.at(-1).query).toBe('rollback');
    expect(pg.calls.some((call) => call.query === 'commit')).toBe(false);
  });
});

describe('YouTube profile refresh routing', () => {
  const server = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');
  const start = server.indexOf("app.post('/api/account/platforms/refresh'");
  const end = server.indexOf("app.get('/api/automations/overview'", start);

  function route(accounts, tokens, extra = {}) {
    let handler;
    const context = {
      app: { post: (_path, _limiter, callback) => { handler = callback; } },
      rateLimiters: {}, getCurrentSessionUserId: async () => 'owner',
      repairYoutubePlatformAccounts: jest.fn(async () => 0),
      listPlatformAccounts: jest.fn(async () => accounts), getPlatformTokens: jest.fn(async () => tokens),
      findYoutubeTokenAccount, invalidatePublicChannelIdentityCaches: jest.fn(),
      fetchYoutubeMyChannel: jest.fn(async () => profile()),
      updatePlatformAccountProfile: jest.fn(async () => null),
      ...extra,
    };
    vm.runInNewContext(server.slice(start, end), context);
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    return { context, response, run: (body = {}) => handler({ body }, response) };
  }

  test('fetches only the token-linked account even when other YouTube connections exist', async () => {
    const { context, run, response } = route([account(OTHER_GOOGLE), account()], { platformUserId: GOOGLE });
    await run({ provider: 'youtube' });
    expect(context.fetchYoutubeMyChannel).toHaveBeenCalledTimes(1);
    expect(context.fetchYoutubeMyChannel).toHaveBeenCalledWith('owner', GOOGLE);
    expect(context.updatePlatformAccountProfile).toHaveBeenCalledWith('youtube', 'owner', GOOGLE, expect.any(Object));
    expect(response.json.mock.calls[0][0].errors).toEqual([]);
  });

  test('does not use a mismatched or absent token to overwrite any account', async () => {
    for (const tokens of [null, { platformUserId: OTHER_GOOGLE }]) {
      const { context, run, response } = route([account()], tokens);
      await run();
      expect(context.fetchYoutubeMyChannel).not.toHaveBeenCalled();
      expect(context.updatePlatformAccountProfile).not.toHaveBeenCalled();
      expect(response.json.mock.calls[0][0].errors).toHaveLength(1);
    }
  });

  test('quota errors leave the stored profile unchanged while successful repair is reported', async () => {
    const { context, run, response } = route([account()], { platformUserId: GOOGLE }, {
      repairYoutubePlatformAccounts: jest.fn(async () => 1),
      fetchYoutubeMyChannel: jest.fn(async () => { throw new Error('quotaExceeded'); }),
    });
    await run();
    expect(context.updatePlatformAccountProfile).not.toHaveBeenCalled();
    expect(context.invalidatePublicChannelIdentityCaches).toHaveBeenCalledWith('owner');
    expect(response.json.mock.calls[0][0]).toMatchObject({ repairedYoutubeAccounts: 1, errors: [{ error: 'quotaExceeded' }] });
  });

  test('refreshing another platform does not trigger YouTube repairs or token access', async () => {
    const { context, run } = route([account()], { platformUserId: GOOGLE });
    await run({ provider: 'chzzk' });
    expect(context.repairYoutubePlatformAccounts).not.toHaveBeenCalled();
    expect(context.getPlatformTokens).not.toHaveBeenCalled();
  });

  test('a token switch during lookup is rejected before making a channel request', async () => {
    const functionStart = server.indexOf('async function fetchYoutubeMyChannel(ownerUserId,');
    const functionEnd = server.indexOf('function latestIsoTimestamp', functionStart);
    const context = {
      getValidYoutubeAccessToken: async () => 'original-access-token',
      getPlatformTokens: async () => ({ platformUserId: OTHER_GOOGLE, accessToken: 'new-access-token' }),
      youtubeApiGetWithAccessToken: jest.fn(), normalizeYoutubeProfile: jest.fn(),
    };
    vm.runInNewContext(server.slice(functionStart, functionEnd), context);
    await expect(context.fetchYoutubeMyChannel('owner', GOOGLE)).rejects.toThrow('connection changed');
    expect(context.youtubeApiGetWithAccessToken).not.toHaveBeenCalled();
  });
});
