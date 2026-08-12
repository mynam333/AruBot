const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const postgresTest = process.env.ARUBOT_TEST_POSTGRES_URL ? test : test.skip;

describe('PostgreSQL bot counter increments', () => {
  postgresTest('atomically separates user/global scopes and preserves bigint precision', () => {
    const root = path.join(__dirname, '..');
    const dbUrl = process.env.ARUBOT_TEST_POSTGRES_URL;
    const databaseUrl = pathToFileURL(path.join(root, 'server', 'supabase.js')).href;
    const migrationPath = path.join(root, 'server', 'migrations', '022_bot_counter_values.sql');
    const script = `
      import fs from 'node:fs';
      import pg from 'pg';

      const { Client } = pg;
      const dbUrl = process.env.ARUBOT_TEST_POSTGRES_URL;
      const parsed = new URL(dbUrl);
      if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) || !/test/i.test(parsed.pathname)) {
        throw new Error('Counter integration test requires a local database whose name contains test');
      }
      const client = new Client({ connectionString: dbUrl, ssl: false });
      await client.connect();
      const sid = 'user:counter-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
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
          const concurrent = await Promise.all(Array.from({ length: 40 }, () => database.incrementBotCounter({
            sid,
            counterName: '동시 호출',
            scope: 'global',
          })));
          const userA1 = await database.incrementBotCounter({ sid, counterName: '도전', scope: 'user', subjectKey: 'youtube:a' });
          const userA2 = await database.incrementBotCounter({ sid, counterName: '도전', scope: 'user', subjectKey: 'youtube:a' });
          const userB1 = await database.incrementBotCounter({ sid, counterName: '도전', scope: 'user', subjectKey: 'chzzk:a' });
          const global1 = await database.incrementBotCounter({ sid, counterName: '도전', scope: 'global' });

          await client.query(
            'insert into public.bot_counter_values (sid, counter_name, counter_scope, subject_key, value) values ($1, $2, $3, $4, $5)',
            [sid, '큰 수', 'global', '', '9007199254740992']
          );
          const big = await database.incrementBotCounter({ sid, counterName: '큰 수', scope: 'global' });
          const final = await client.query(
            'select value::text as value from public.bot_counter_values where sid = $1 and counter_name = $2 and counter_scope = $3 and subject_key = $4',
            [sid, '동시 호출', 'global', '']
          );
          let invalidCode = null;
          try {
            await database.incrementBotCounter({ sid, counterName: '잘못/됨', scope: 'global' });
          } catch (error) {
            invalidCode = error.code;
          }
          console.log(JSON.stringify({
            concurrent: concurrent.map(Number).sort((a, b) => a - b),
            final: final.rows[0]?.value,
            userA1,
            userA2,
            userB1,
            global1,
            big,
            invalidCode,
          }));
        } finally {
          await database.closeDatabaseConnections();
        }
      } finally {
        await client.query('delete from public.bot_counter_values where sid = $1', [sid]).catch(() => undefined);
        await client.end();
      }
    `;

    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: root,
      env: { ...process.env, ARUBOT_TEST_POSTGRES_URL: dbUrl },
      encoding: 'utf8',
      timeout: 30_000,
    }).trim().split(/\r?\n/).at(-1));

    expect(result.concurrent).toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
    expect(result.final).toBe('40');
    expect(result).toMatchObject({
      userA1: '1',
      userA2: '2',
      userB1: '1',
      global1: '1',
      big: '9007199254740993',
      invalidCode: 'invalid_counter_name',
    });
  }, 35_000);
});

