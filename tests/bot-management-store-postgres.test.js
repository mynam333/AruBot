const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const postgresTest = process.env.ARUBOT_TEST_POSTGRES_URL ? test : test.skip;

describe('bot management isolated PostgreSQL integration', () => {
  postgresTest('migration, concurrency, ownership, administrator visibility and audit rollback', () => {
    const root = path.join(__dirname, '..');
    const storeUrl = pathToFileURL(path.join(root, 'server/bot-management-store.js')).href;
    const migrationPath = path.join(root, 'server/migrations/026_bot_managers.sql');
    const script = `
      import assert from 'node:assert/strict';
      import { readFile } from 'node:fs/promises';
      import { randomBytes } from 'node:crypto';
      import pg from 'pg';
      import { createBotManagementStore } from ${JSON.stringify(storeUrl)};

      const connectionString = process.env.ARUBOT_TEST_POSTGRES_URL;
      const parsed = new URL(connectionString);
      if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname)
        || !/test/i.test(parsed.pathname) || !['postgres:', 'postgresql:'].includes(parsed.protocol)) {
        throw new Error('Requires an explicitly configured local PostgreSQL test database');
      }
      const schema = 'bot_manager_test_' + randomBytes(10).toString('hex');
      const admin = new pg.Client({ connectionString, ssl: false, connectionTimeoutMillis: 5000 });
      await admin.connect();
      let pool;
      let created = false;
      try {
        await admin.query('create schema "' + schema + '"');
        created = true;
        pool = new pg.Pool({ connectionString, ssl: false, max: 4, options: '-c search_path=' + schema, connectionTimeoutMillis: 5000 });
        async function withPgClient(fn) {
          const client = await pool.connect();
          try { return await fn(client); } finally { client.release(); }
        }
        const query = (sql, values) => withPgClient((client) => client.query(sql, values));
        await query('create table app_users (id text primary key, display_name text, avatar_url text, primary_provider text, is_admin boolean not null default false)');
        await query('create table platform_accounts (user_id text references app_users(id), channel_name text, channel_id text, channel_handle text)');
        await query("insert into app_users(id, display_name, primary_provider, is_admin) values ('owner','Owner','chzzk',false), ('other','Other','youtube',false), ('manager','Manager','chzzk',false), ('spare','Spare','chzzk',false), ('admin','Admin','chzzk',true), ('fail-actor','Fail Actor','chzzk',true), ('literal_%!','Literal','chzzk',false)");
        await query("insert into platform_accounts(user_id, channel_name, channel_id) values ('manager','Public Manager Channel','public-manager-id')");
        const migration = await readFile(${JSON.stringify(migrationPath)}, 'utf8');
        await query(migration);
        await query(migration);
        const normalizeScopes = (input) => {
          if (input.length === 1 && input[0] === '*') return ['*'];
          const scopes = new Set(input);
          for (const scope of input) {
            if (!/^(commands|points):(read|write)$/.test(scope)) throw new Error('unknown_scope');
            if (scope.endsWith(':write')) scopes.add(scope.replace(':write', ':read'));
          }
          return [...scopes].sort();
        };
        let identitySetupCalls = 0;
        const store = createBotManagementStore({ withPgClient, normalizeScopes, ensureIdentityTables: async () => { identitySetupCalls++; } });
        await Promise.all([store.ensureSchema(), store.ensureSchema()]);
        assert.equal(identitySetupCalls, 1);
        const flags = await query("select relname, relrowsecurity from pg_class where relnamespace = $1::regnamespace and relname in ('bot_managers','bot_management_audit')", [schema]);
        assert.equal(flags.rows.length, 2);
        assert.ok(flags.rows.every((row) => row.relrowsecurity));
        const count = async (table) => (await query('select count(*)::integer as n from ' + table)).rows[0].n;

        assert.equal(await store.getAccess('manager', 'owner'), null);
        assert.equal((await store.getAccess('owner', 'owner')).role, 'owner');
        assert.equal((await store.getAccess('admin', 'owner', true)).role, 'site_admin');
        assert.equal(await count('bot_managers'), 0);
        assert.deepEqual((await store.listChannels('admin', { isSiteAdmin: true })).map((item) => item.ownerUserId), ['admin']);
        assert.deepEqual((await store.listChannels('admin', { isSiteAdmin: true, query: 'Owner' })).map((item) => item.ownerUserId), ['owner']);
        assert.equal((await store.listChannels('manager', { query: 'Owner' })).length, 0);

        const grants = await Promise.all(Array.from({ length: 4 }, () => store.addMember('owner', 'admin', { memberUserId: 'manager', scopes: ['commands:write'] })));
        assert.ok(grants.every((grant) => grant.id === grants[0].id));
        const grant = grants[0];
        assert.deepEqual(grant.scopes, ['commands:read', 'commands:write']);
        assert.equal(await count('bot_managers'), 1);
        assert.equal(await count('bot_management_audit'), 1);
        const unchanged = await store.addMember('owner', 'owner', { memberUserId: 'manager' });
        assert.deepEqual(unchanged.scopes, grant.scopes);
        assert.equal((await store.getAccess('manager', 'owner')).role, 'manager');
        assert.deepEqual((await store.listChannels('manager')).map((item) => item.ownerUserId), ['manager', 'owner']);
        assert.equal(await store.updateMember('other', 'other', grant.id, ['*']), null);
        assert.equal(await store.removeMember('other', 'other', grant.id), null);
        assert.equal(await count('bot_management_audit'), 1);

        assert.deepEqual((await store.searchUsers('public-manager-id')).map((user) => user.userId), ['manager']);
        assert.deepEqual((await store.searchUsers('_%!')).map((user) => user.userId), ['literal_%!']);
        assert.equal((await store.searchUsers('Admin')).length, 0);
        assert.equal((await store.searchUsers("' OR 1=1 --")).length, 0);
        await assert.rejects(store.addMember('owner', 'owner', { memberUserId: 'admin' }), { code: 'site_admin_has_implicit_access' });
        await assert.rejects(store.addMember('owner', 'owner', { memberUserId: 'owner' }), { code: 'cannot_manage_self' });

        await store.updateMember('owner', 'admin', grant.id, ['points:read']);
        let audit = await store.listAudit('owner');
        assert.equal(audit[0].actorUserId, 'admin');
        assert.equal(audit[0].action, 'manager.update');
        assert.deepEqual(audit[0].previousScopes, ['commands:read', 'commands:write']);
        assert.deepEqual(audit[0].scopes, ['points:read']);
        await query("create function reject_test_audit() returns trigger language plpgsql as $$ begin if new.actor_user_id = 'fail-actor' then raise exception 'test audit failure'; end if; return new; end $$");
        await query('create trigger reject_test_audit before insert on bot_management_audit for each row execute function reject_test_audit()');
        await assert.rejects(store.updateMember('owner', 'fail-actor', grant.id, ['*']), /test audit failure/);
        await assert.rejects(store.removeMember('owner', 'fail-actor', grant.id), /test audit failure/);
        await assert.rejects(store.addMember('owner', 'fail-actor', { memberUserId: 'spare' }), /test audit failure/);
        assert.equal(await count('bot_managers'), 1);
        assert.equal(await count('bot_management_audit'), 2);
        assert.deepEqual((await store.getAccess('manager', 'owner')).scopes, ['points:read']);

        // Promotion hides an old explicit grant without inserting hidden admin rows.
        await query("update app_users set is_admin = true where id = 'manager'");
        assert.equal((await store.listMembers('owner')).length, 0);
        assert.equal((await store.searchUsers('Public Manager')).length, 0);
        await query("update app_users set is_admin = false where id = 'manager'");
        assert.equal((await store.listMembers('owner')).length, 1);

        for (const scopes of ['{}', '[]', '[1]', '["*","commands:read"]']) {
          await assert.rejects(query('insert into bot_managers(owner_user_id, member_user_id, scopes) values ($1,$2,$3::jsonb)', ['other', 'spare', scopes]), { code: '23514' });
        }
        await assert.rejects(query("insert into bot_managers(owner_user_id, member_user_id) values ('owner','owner')"), { code: '23514' });
        await assert.rejects(query("insert into bot_managers(owner_user_id, member_user_id) values ('missing','spare')"), { code: '23503' });

        const action = await store.recordAction({ ownerUserId: 'owner', actorUserId: 'manager', action: 'points.update', method: 'PATCH', path: '/api/points/:id?token=secret#private', status: 200, body: { password: 'secret' } });
        assert.equal(action.path, '/api/points/:id');
        assert.equal(action.actorUserId, 'manager');
        assert.deepEqual(await store.removeMember('owner', 'admin', grant.id), { id: grant.id, memberUserId: 'manager', scopes: ['points:read'] });
        assert.equal(await store.removeMember('owner', 'admin', grant.id), null);
        assert.equal(await store.getAccess('manager', 'owner'), null);
        audit = await store.listAudit('owner');
        assert.equal(audit.length, 4);
        assert.equal(audit[0].action, 'manager.remove');
        assert.equal(audit[0].memberId, grant.id);
        assert.equal(audit[0].actorUserId, 'admin');

        await store.addMember('other', 'other', { memberUserId: 'spare' });
        await query("delete from app_users where id = 'spare'");
        assert.equal((await store.listMembers('other')).length, 0);
        assert.equal((await store.listAudit('other'))[0].memberUserId, null);
        await query("delete from app_users where id = 'other'");
        assert.equal((await store.listAudit('other')).length, 0);
        console.log(JSON.stringify({ passed: true }));
      } finally {
        if (pool) await pool.end();
        if (created && /^bot_manager_test_[a-f0-9]{20}$/.test(schema)) {
          await admin.query('drop schema "' + schema + '" cascade');
        }
        await admin.end();
      }
    `;
    const result = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: root, env: { ...process.env }, encoding: 'utf8', timeout: 40_000,
    });
    expect(JSON.parse(result.trim().split(/\r?\n/).at(-1))).toEqual({ passed: true });
  }, 45_000);
});
