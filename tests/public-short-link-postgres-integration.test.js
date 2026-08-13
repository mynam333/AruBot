const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const postgresTest = process.env.ARUBOT_TEST_POSTGRES_URL ? test : test.skip;

describe('PostgreSQL public short links', () => {
  postgresTest('is permanent, target-idempotent, and rejects malformed codes', () => {
    const root = path.join(__dirname, '..');
    const dbUrl = process.env.ARUBOT_TEST_POSTGRES_URL;
    const databaseUrl = pathToFileURL(path.join(root, 'server', 'supabase.js')).href;
    const migrationPath = path.join(root, 'server', 'migrations', '023_public_short_links.sql');
    const script = `
      import fs from 'node:fs';
      import pg from 'pg';

      const { Client } = pg;
      const dbUrl = process.env.ARUBOT_TEST_POSTGRES_URL;
      const parsed = new URL(dbUrl);
      if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) || !/test/i.test(parsed.pathname)) {
        throw new Error('Short-link integration test requires a local database whose name contains test');
      }
      const client = new Client({ connectionString: dbUrl, ssl: false });
      await client.connect();
      const target = '/c/short-link-test-' + Date.now();
      try {
        const sql = fs.readFileSync(${JSON.stringify(migrationPath)}, 'utf8');
        await client.query(sql);
        await client.query(sql);

        process.env.ARUBOT_DB_PROVIDER = 'postgres';
        process.env.POSTGRES_RUNTIME_URL = dbUrl;
        process.env.POSTGRES_URL = dbUrl;
        process.env.POSTGRES_SSL = 'false';
        const database = await import(${JSON.stringify(databaseUrl)});
        await database.initDb();
        try {
          const first = await database.getOrCreatePublicShortLink(target, { createdBy: 'test-owner' });
          const second = await database.getOrCreatePublicShortLink(target, { createdBy: 'other-owner' });
          const resolved = await database.resolvePublicShortLink(first.code);
          const malformed = await database.resolvePublicShortLink('../secret');
          const count = await client.query(
            'select count(*)::integer as count from public.public_short_links where target_path = $1',
            [target]
          );
          console.log(JSON.stringify({ first, second, resolved, malformed, row: count.rows[0] }));
        } finally {
          await database.closeDatabaseConnections();
        }
      } finally {
        await client.query('delete from public.public_short_links where target_path = $1', [target]).catch(() => undefined);
        await client.end();
      }
    `;

    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: root,
      env: { ...process.env, ARUBOT_TEST_POSTGRES_URL: dbUrl },
      encoding: 'utf8',
      timeout: 30_000,
    }).trim().split(/\r?\n/).at(-1));

    expect(result.first.code).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(result.second.code).toBe(result.first.code);
    expect(result.resolved.targetPath).toBe(result.first.targetPath);
    expect(result.malformed).toBeNull();
    expect(result.row).toMatchObject({ count: 1 });
  }, 35_000);
});
