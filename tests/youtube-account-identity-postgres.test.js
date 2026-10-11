const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const postgresTest = process.env.ARUBOT_TEST_POSTGRES_URL ? test : test.skip;

describe('YouTube account repair in PostgreSQL', () => {
  postgresTest('migration is idempotent and concurrent reconnects retain one identity without changing tokens', () => {
    const root = path.join(__dirname, '..');
    const moduleUrl = pathToFileURL(path.join(root, 'server/youtube-account-identity.js')).href;
    const foundation = path.join(root, 'server/migrations/005_multi_platform_accounts.sql');
    const migration = path.join(root, 'server/migrations/025_youtube_account_identity_deduplication.sql');
    const script = `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import pg from 'pg';
      import { upsertYoutubeIdentityWithClient, updateYoutubeProfileWithClient } from ${JSON.stringify(moduleUrl)};
      const url = process.env.ARUBOT_TEST_POSTGRES_URL;
      const parsed = new URL(url);
      if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) || !/test/i.test(parsed.pathname)) {
        throw new Error('YouTube repair tests require a local database whose name contains test');
      }
      const schema = 'youtube_identity_test_' + process.pid + '_' + Date.now();
      const client = new pg.Client({ connectionString: url, ssl: false });
      const channel = (letter) => 'UC' + letter.repeat(22);
      const google = (letter) => 'google:' + letter.repeat(64);
      await client.connect();
      try {
        await client.query('create schema ' + schema);
        await client.query('set search_path to ' + schema + ', public');
        const tables = fs.readFileSync(${JSON.stringify(foundation)}, 'utf8').split('alter table public.sessions')[0];
        await client.query(tables.replaceAll('public.', schema + '.'));
        for (const owner of ['owner', 'other', 'ambiguous', 'conflict', 'reconnect']) {
          await client.query('insert into app_users (id, metadata) values ($1, $2)', [owner, { retainedSetting: owner }]);
        }
        const insert = async (owner, id, channelId, metadata = {}, provider = 'youtube', connected = '2026-10-01') => {
          await client.query(
            'insert into platform_accounts (user_id, provider, platform_user_id, channel_id, channel_name, metadata, connected_at) values ($1, $2, $3, $4, $5, $6, $7)',
            [owner, provider, id, channelId, 'Channel ' + channelId, metadata, connected],
          );
        };
        await insert('owner', channel('A'), channel('A'), { legacyField: true }, 'youtube', '2026-01-01');
        await insert('owner', google('a'), channel('A'), { currentField: true });
        await insert('owner', channel('A'), channel('A'), {}, 'chzzk');
        await insert('other', channel('B'), channel('B'));
        await insert('owner', google('b'), channel('B'));
        await insert('ambiguous', channel('C'), channel('C'));
        await insert('ambiguous', google('c'), channel('C'));
        await insert('ambiguous', google('d'), channel('C'));
        await insert('conflict', channel('D'), channel('D'), { googleSubjectHash: 'f'.repeat(64) });
        await insert('conflict', google('e'), channel('D'));
        await client.query(
          'insert into platform_tokens (provider, user_id, platform_user_id, access_token, refresh_token) values ($1, $2, $3, $4, $5)',
          ['youtube', 'owner', channel('A'), 'untouched-access', 'untouched-refresh'],
        );
        const usersBefore = (await client.query('select * from app_users order by id')).rows;
        const tokensBefore = (await client.query('select * from platform_tokens')).rows;
        const sql = fs.readFileSync(${JSON.stringify(migration)}, 'utf8').replaceAll('public.', schema + '.');
        await client.query(sql);
        const after = (await client.query('select * from platform_accounts order by id')).rows;
        assert.equal(after.length, 9);
        const canonical = after.find((row) => row.platform_user_id === google('a'));
        assert.equal(canonical.user_id, 'owner');
        assert.deepEqual(canonical.metadata, { legacyField: true, currentField: true, googleSubjectHash: 'a'.repeat(64) });
        assert.equal(canonical.connected_at.toISOString().slice(0, 10), '2026-01-01');
        assert(!after.some((row) => row.provider === 'youtube' && row.platform_user_id === channel('A')));
        assert(after.some((row) => row.provider === 'chzzk' && row.platform_user_id === channel('A')));
        assert(after.some((row) => row.platform_user_id === channel('B') && row.user_id === 'other'));
        assert(after.some((row) => row.platform_user_id === channel('C')));
        assert(after.some((row) => row.platform_user_id === channel('D')));
        await client.query(sql);
        assert.deepEqual((await client.query('select * from platform_accounts order by id')).rows, after);
        assert.deepEqual((await client.query('select * from app_users order by id')).rows, usersBefore);
        assert.deepEqual((await client.query('select * from platform_tokens')).rows, tokensBefore);

        const aliasUpdated = await updateYoutubeProfileWithClient(client, 'owner', channel('A'), {
          platformUserId: channel('A'), channelId: channel('A'), channelName: 'Refreshed', metadata: { publicProfile: { status: 'ok' } },
        });
        assert.equal(aliasUpdated.platform_user_id, google('a'));
        assert.equal(aliasUpdated.metadata.googleSubjectHash, 'a'.repeat(64));

        await insert('reconnect', channel('E'), channel('E'));
        const results = await Promise.all(Array.from({ length: 6 }, async () => {
          const worker = new pg.Client({ connectionString: url, ssl: false });
          await worker.connect();
          try {
            await worker.query('set search_path to ' + schema + ', public');
            return await upsertYoutubeIdentityWithClient(worker, {
              platformUserId: google('f'), channelId: channel('E'), channelName: 'Reconnected',
            }, 'reconnect');
          } finally { await worker.end(); }
        }));
        assert(results.every((result) => result.userId === 'reconnect' && result.account.platform_user_id === google('f')));
        assert.equal((await client.query('select * from platform_accounts where user_id = $1', ['reconnect'])).rowCount, 1);
        const relogin = await upsertYoutubeIdentityWithClient(client, {
          platformUserId: google('f'), channelId: null, channelName: 'Google display name',
          metadata: { publicProfile: { status: 'identity_only' } },
        }, 'other');
        assert.equal(relogin.userId, 'reconnect');
        assert.equal(relogin.account.channel_id, channel('E'));
        assert.equal(relogin.account.channel_name, 'Reconnected');
        assert.deepEqual((await client.query('select * from platform_tokens')).rows, tokensBefore);
      } finally {
        await client.query('rollback').catch(() => {});
        await client.query('drop schema if exists ' + schema + ' cascade');
        await client.end();
      }
    `;
    execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: root, env: process.env, encoding: 'utf8', timeout: 30_000,
    });
  }, 35_000);
});
