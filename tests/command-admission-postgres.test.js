const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const postgresTest = process.env.ARUBOT_TEST_POSTGRES_URL ? test : test.skip;

function runIsolated(scenario) {
  const root = path.join(__dirname, '..');
  const storeUrl = pathToFileURL(path.join(root, 'server/command-admission-store.js')).href;
  const script = `
    import assert from 'node:assert/strict';
    import { randomBytes, randomUUID } from 'node:crypto';
    import pg from 'pg';
    import { createCommandAdmissionStore } from ${JSON.stringify(storeUrl)};

    const connectionString = process.env.ARUBOT_TEST_POSTGRES_URL;
    const parsed = new URL(connectionString);
    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname)
      || !/test/i.test(parsed.pathname) || !['postgres:', 'postgresql:'].includes(parsed.protocol)) {
      throw new Error('Requires an explicitly configured local PostgreSQL test database');
    }
    const schema = 'command_admission_test_' + randomBytes(10).toString('hex');
    const config = {
      connectionString, ssl: false, connectionTimeoutMillis: 5000,
      statement_timeout: 5000, lock_timeout: 2000,
      idle_in_transaction_session_timeout: 15000,
    };
    const admin = new pg.Client(config);
    await admin.connect();
    let pool;
    let created = false;
    try {
      await admin.query('create schema "' + schema + '"');
      created = true;
      pool = new pg.Pool({ ...config, max: 8, options: '-c search_path=' + schema });
      async function withPgClient(fn) {
        const client = await pool.connect();
        try { return await fn(client); } finally { client.release(); }
      }
      const query = (sql, values) => withPgClient((client) => client.query(sql, values));
      const makeStore = () => createCommandAdmissionStore({ withPgClient, now: () => 0 });
      const stores = [makeStore(), makeStore()];
      await Promise.all(stores.map((store) => store.ensureSchema()));
      // Freeze refill, not the configured 0.5/s rate, so slow CI cannot add tokens.
      const seedBurst = (key) => query(
        "insert into command_admission_buckets(bucket_key, tokens, updated_at) values ($1, 8, clock_timestamp() + interval '1 hour')",
        [key],
      );
      ${scenario}
      console.log(JSON.stringify({ passed: true }));
    } finally {
      try {
        if (pool) await pool.end();
      } finally {
        try {
          if (created && /^command_admission_test_[a-f0-9]{20}$/.test(schema)) {
            await admin.query('drop schema "' + schema + '" cascade');
          }
        } finally { await admin.end(); }
      }
    }
  `;
  const result = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: root, env: { ...process.env }, encoding: 'utf8', timeout: 40_000,
  });
  expect(JSON.parse(result.trim().split(/\r?\n/).at(-1))).toEqual({ passed: true });
}

describe('command admission isolated PostgreSQL integration', () => {
  postgresTest('two store instances admit exactly eight simultaneous claims in total', () => {
    runIsolated(`
      const key = 'a'.repeat(64);
      await seedBurst(key);
      const results = await Promise.all(Array.from({ length: 40 }, (_, index) =>
        stores[index % 2].claim(key, 8, 0.5)));
      assert.equal(results.filter(Boolean).length, 8);
      const result = await query('select tokens from command_admission_buckets where bucket_key = $1', [key]);
      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0].tokens, 0);
    `);
  }, 45_000);

  postgresTest('a restarted store cannot immediately refill an exhausted bucket', () => {
    runIsolated(`
      const key = 'b'.repeat(64);
      await seedBurst(key);
      for (let index = 0; index < 8; index += 1) {
        assert.equal(await stores[0].claim(key, 8, 0.5), true);
      }
      const restarted = makeStore();
      assert.equal(await restarted.claim(key, 8, 0.5), false);
      assert.equal(await stores[1].claim(key, 8, 0.5), false);
    `);
  }, 45_000);

  postgresTest('chain jobs share the 100-job cap across instances and restarts', () => {
    runIsolated(`
      const chain = { rootId: randomUUID(), sid: 'user:owner' };
      const results = await Promise.all(Array.from({ length: 160 }, (_, index) =>
        stores[index % 2].claimChainJob(chain)));
      assert.equal(results.filter(Boolean).length, 100);
      assert.equal(await makeStore().claimChainJob(chain), false);
      const result = await query('select sid, jobs from command_execution_budgets where root_id = $1', [chain.rootId]);
      assert.deepEqual(result.rows, [{ sid: chain.sid, jobs: 100 }]);
    `);
  }, 45_000);

  postgresTest('cleanup skips a concurrently refreshed bucket and deletes other expired rows', () => {
    runIsolated(`
      const refreshedKey = 'c'.repeat(64);
      const expiredKey = 'd'.repeat(64);
      await query(
        "insert into command_admission_buckets(bucket_key, tokens, updated_at) values ($1, 0, clock_timestamp() - interval '2 hours'), ($2, 0, clock_timestamp() - interval '2 hours')",
        [refreshedKey, expiredKey],
      );
      const locker = await pool.connect();
      try {
        await locker.query('begin');
        await locker.query('update command_admission_buckets set tokens = 7, updated_at = clock_timestamp() where bucket_key = $1', [refreshedKey]);
        // Another session still sees the old expired version while this row is locked.
        assert.equal(await stores[0].claim('e'.repeat(64), 8, 0.5), true);
        const expired = await query('select bucket_key from command_admission_buckets where bucket_key = $1', [expiredKey]);
        assert.equal(expired.rows.length, 0, 'cleanup must progress rather than time out behind the refreshed row');
        await locker.query('commit');
      } catch (error) {
        await locker.query('rollback').catch(() => {});
        throw error;
      } finally { locker.release(); }
      // A later sweep must also retain the now-committed refresh.
      assert.equal(await stores[1].claim('f'.repeat(64), 8, 0.5), true);
      const refreshed = await query('select tokens from command_admission_buckets where bucket_key = $1', [refreshedKey]);
      assert.deepEqual(refreshed.rows, [{ tokens: 7 }]);
    `);
  }, 45_000);
});
