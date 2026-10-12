const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const modulePath = path.join(root, 'server/bot-management-store.js');
const migration = fs.readFileSync(path.join(root, 'server/migrations/026_bot_managers.sql'), 'utf8');
const source = fs.readFileSync(modulePath, 'utf8');
const context = { URL, readFile: async () => migration, module: { exports: {} } };
vm.runInNewContext(`${source.replace(/^import .*;$/gm, '').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(modulePath).href)).replace(/^export /gm, '')}
module.exports = { createBotManagementStore };`, context);
const { createBotManagementStore } = context.module.exports;

const GRANT = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-10-12T00:00:00.000Z';
const memberRow = (extra = {}) => ({
  id: GRANT, member_user_id: 'manager', display_name: 'Manager', avatar_url: 'avatar',
  primary_provider: 'chzzk', scopes: ['*'], created_at: NOW, updated_at: NOW, ...extra,
});

function normalizeScopes(input) {
  const result = new Set(input);
  if (input.length === 1 && input[0] === '*') return ['*'];
  for (const scope of input) {
    if (!/^(commands|points):(read|write)$/.test(scope)) throw Object.assign(new Error('unknown_scope'), { code: 'unknown_scope' });
    if (scope.endsWith(':write')) result.add(scope.replace(':write', ':read'));
  }
  return [...result].sort();
}

function harness(handler = () => ({ rows: [] }), options = {}) {
  const calls = [];
  const pg = { query: jest.fn(async (sql, values = []) => {
    const text = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    calls.push({ sql, text, values });
    if (sql === migration || ['begin', 'commit', 'rollback'].includes(text) || text.includes('pg_advisory_xact_lock')) return { rows: [] };
    return handler(text, values);
  }) };
  const withPgClient = jest.fn(async (fn) => fn(pg));
  const ensureIdentityTables = jest.fn(async () => {});
  const store = createBotManagementStore({ withPgClient, ensureIdentityTables, normalizeScopes, ...options });
  return { store, pg, calls, withPgClient, ensureIdentityTables };
}

async function ready(h) {
  await h.store.ensureSchema();
  h.calls.length = 0;
  h.withPgClient.mockClear();
  return h;
}

function grantHandler(text, values) {
  if (text.startsWith('select id, is_admin from app_users')) return { rows: [{ id: values[0], is_admin: false }] };
  if (text.startsWith('insert into bot_managers')) return { rows: [{ id: GRANT, member_user_id: values[1] }] };
  if (text.startsWith('select m.id, m.member_user_id, m.scopes from')) return { rows: [{ id: GRANT, member_user_id: 'manager', scopes: ['*'] }] };
  if (text.startsWith('select m.id, m.member_user_id')) return { rows: [memberRow({ scopes: ['commands:read', 'commands:write'] })] };
  if (text.startsWith('delete from bot_managers')) return { rows: [memberRow()] };
  return { rows: [] };
}

describe('bot management schema bootstrap', () => {
  test('does no I/O when constructed and coalesces concurrent schema setup', async () => {
    const h = harness();
    expect(h.calls).toHaveLength(0);
    expect(h.ensureIdentityTables).not.toHaveBeenCalled();
    await Promise.all([h.store.ensureSchema(), h.store.ensureSchema(), h.store.ensureSchema()]);
    expect(h.ensureIdentityTables).toHaveBeenCalledTimes(1);
    expect(h.calls.filter((call) => call.sql === migration)).toHaveLength(1);
    expect(h.calls.map((call) => call.text).slice(0, 2)).toEqual(['begin', 'select pg_advisory_xact_lock(hashtext($1))']);
    expect(h.calls.at(-1).text).toBe('commit');
  });

  test('a failed bootstrap can be retried and rolls back', async () => {
    const h = harness();
    const original = h.pg.query.getMockImplementation();
    h.pg.query.mockImplementationOnce(async () => ({ rows: [] }))
      .mockImplementationOnce(async () => { throw new Error('setup failed'); });
    await expect(h.store.ensureSchema()).rejects.toThrow('setup failed');
    expect(h.pg.query).toHaveBeenCalledWith('rollback');
    h.pg.query.mockImplementation(original);
    await h.store.ensureSchema();
    expect(h.ensureIdentityTables).toHaveBeenCalledTimes(2);
  });

  test('migration limits access and preserves grant audit history after deletion', () => {
    expect(migration).toContain('unique (owner_user_id, member_user_id)');
    expect(migration).toContain('owner_user_id <> member_user_id');
    expect(migration).toContain('enable row level security');
    expect(migration).toContain('revoke all on table bot_managers, bot_management_audit from public');
    expect(migration).toContain('actor_user_id text references app_users(id) on delete set null');
    expect(migration).not.toMatch(/member_id uuid references/);
    expect(migration).not.toMatch(/drop table|delete from|truncate/i);
  });

  test('default normalizer uses the actual shared policy without starting the app', () => {
    const script = `
      import assert from 'node:assert/strict';
      import { createBotManagementStore } from ${JSON.stringify(pathToFileURL(modulePath).href)};
      let scopes = ['video:write'];
      const client = { query: async (sql) => ({ rows: sql.includes('left join bot_managers') ? [{ id: 'owner', scopes }] : [] }) };
      const store = createBotManagementStore({ withPgClient: async (fn) => fn(client) });
      assert.deepEqual((await store.getAccess('manager', 'owner')).scopes, ['video:read', 'video:write']);
      scopes = ['not-a-feature:write'];
      await assert.rejects(store.getAccess('manager', 'owner'), { code: 'invalid_manager_scopes' });
      console.log('ok');
    `;
    expect(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: root, encoding: 'utf8', timeout: 10000,
    }).trim()).toBe('ok');
  });
});

describe('bot access and safe public listings', () => {
  test.each([
    ['owner', 'owner', false, 'owner', ['*']],
    ['manager', 'owner', false, 'manager', ['commands:read', 'commands:write']],
    ['admin', 'owner', true, 'site_admin', ['*']],
    ['owner', 'owner', true, 'owner', ['*']],
  ])('getAccess separates %s from %s', async (actor, owner, admin, role, scopes) => {
    const h = await ready(harness(() => ({ rows: [{ id: owner, display_name: 'Owner', primary_provider: 'youtube', scopes: ['commands:write'] }] })));
    expect(await h.store.getAccess(actor, owner, admin)).toEqual({ ownerUserId: owner, displayName: 'Owner', avatarUrl: null, provider: 'youtube', role, scopes });
    expect(h.calls[0].values).toEqual([actor, owner, admin]);
    expect(h.calls[0].text).toContain('u.id = $2 and (u.id = $1 or $3::boolean or m.id is not null)');
  });

  test('unknown or ungranted owner returns null, and truthy non-booleans cannot grant site access', async () => {
    const h = await ready(harness());
    expect(await h.store.getAccess('actor', 'unknown', 'true')).toBeNull();
    expect(h.calls[0].values).toEqual(['actor', 'unknown', false]);
  });

  test('corrupt stored scopes fail closed, never grant full access', async () => {
    const h = harness(() => ({ rows: [{ id: 'owner', scopes: null }] }));
    await expect(h.store.getAccess('manager', 'owner')).rejects.toMatchObject({ code: 'invalid_manager_scopes' });
  });

  test('site-admin basic list contains only own and explicit channels; search can find others', async () => {
    const h = await ready(harness(() => ({ rows: [{ id: 'owner', display_name: 'Owner', scopes: null }] })));
    expect((await h.store.listChannels('admin', { isSiteAdmin: true }))[0].role).toBe('site_admin');
    expect(h.calls[0].values).toEqual(['admin', null, true, 50]);
    expect(h.calls[0].text).toContain('($3::boolean and $2::text is not null)');
    await h.store.listChannels('admin', { isSiteAdmin: true, query: 'owner', limit: 999999 });
    expect(h.calls[1].values).toEqual(['admin', '%owner%', true, 100]);
    expect(h.calls.every((call) => call.text.startsWith('select '))).toBe(true);
  });

  test('regular channel search cannot escape membership filtering', async () => {
    const h = await ready(harness());
    await h.store.listChannels('actor', { query: '%_!', limit: 0 });
    expect(h.calls[0].values).toEqual(['actor', '%!%!_!!%', false, 1]);
    expect(h.calls[0].text).toContain('u.id = $1 or m.id is not null');
  });

  test('member DTO omits internal fields and filters administrators at SQL level', async () => {
    const h = await ready(harness(() => ({ rows: [memberRow({ display_name: null, email: 'private', metadata: { token: 'secret' } })] })));
    expect(await h.store.listMembers('owner')).toEqual([{
      id: GRANT, memberUserId: 'manager', displayName: 'manager', avatarUrl: 'avatar', provider: 'chzzk',
      scopes: ['*'], createdAt: NOW, updatedAt: NOW,
    }]);
    expect(h.calls[0].values).toEqual(['owner']);
    expect(h.calls[0].text).toContain('m.owner_user_id = $1 and u.is_admin = false');
  });

  test('user search escapes wildcard input, bounds results and selects only public identity', async () => {
    const h = await ready(harness(() => ({ rows: [{ id: 'user', display_name: 'Public', avatar_url: null, primary_provider: 'chzzk', email: 'secret', metadata: {} }] })));
    const query = "_%!' OR 1=1 --";
    expect(await h.store.searchUsers(query, 999)).toEqual([{ userId: 'user', displayName: 'Public', avatarUrl: null, provider: 'chzzk' }]);
    expect(h.calls[0].values).toEqual(["%!_!%!!' OR 1=1 --%", 50]);
    expect(h.calls[0].text).toContain('u.is_admin = false');
    expect(h.calls[0].sql).not.toContain(query);
    expect(h.calls[0].sql).not.toMatch(/email|token|metadata/);
  });

  test('blank search does not bootstrap or enumerate all users', async () => {
    const h = harness();
    expect(await h.store.searchUsers('  ')).toEqual([]);
    expect(h.calls).toHaveLength(0);
    await expect(h.store.searchUsers('a'.repeat(101))).rejects.toMatchObject({ code: 'invalid_query' });
    await expect(h.store.getAccess('', 'owner')).rejects.toMatchObject({ code: 'invalid_user_id' });
  });
});

describe('atomic explicit manager grants', () => {
  test('inserts normalized scopes and audits the real actor in the same transaction', async () => {
    const h = await ready(harness(grantHandler));
    const result = await h.store.addMember('owner', 'site-admin', { memberUserId: 'manager', scopes: ['commands:write'] });
    expect(result.memberUserId).toBe('manager');
    const grant = h.calls.find((call) => call.text.startsWith('insert into bot_managers'));
    expect(grant.values).toEqual(['owner', 'manager', '["commands:read","commands:write"]', 'site-admin']);
    const audit = h.calls.find((call) => call.text.startsWith('insert into bot_management_audit'));
    expect(audit.values).toEqual(['owner', 'site-admin', 'manager.add', GRANT, 'manager', null, '["commands:read","commands:write"]']);
    expect(h.calls[0].text).toBe('begin');
    expect(h.calls[1].values).toEqual(['bot-managers:owner']);
    expect(h.calls.at(-1).text).toBe('commit');
    expect(h.withPgClient.mock.calls[0][1]).toBe(0);
  });

  test('omitted scopes default to full access only on creation', async () => {
    const h = await ready(harness(grantHandler));
    await h.store.addMember('owner', 'owner', { memberUserId: 'manager' });
    expect(h.calls.find((call) => call.text.startsWith('insert into bot_managers')).values[2]).toBe('["*"]');
  });

  test('repeated add returns existing scopes without another audit event', async () => {
    const h = await ready(harness((text, values) => {
      if (text.startsWith('insert into bot_managers')) return { rows: [] };
      if (text.startsWith('select id from bot_managers')) return { rows: [{ id: GRANT }] };
      return grantHandler(text, values);
    }));
    expect((await h.store.addMember('owner', 'owner', { memberUserId: 'manager' })).scopes).toEqual(['commands:read', 'commands:write']);
    expect(h.calls.some((call) => call.text.startsWith('insert into bot_management_audit'))).toBe(false);
    expect(h.calls.find((call) => call.text.startsWith('insert into bot_managers')).text).toContain('on conflict (owner_user_id, member_user_id) do nothing');
  });

  test.each([
    [[], 'invalid_manager_scopes'], [null, 'invalid_manager_scopes'], [['*', 'commands:read'], 'invalid_manager_scopes'],
    [['other:write'], 'unknown_scope'], [['commands:execute'], 'invalid_manager_scopes'], [[{}], 'invalid_manager_scopes'],
  ])('rejects invalid or unknown scopes %j before any database call', async (scopes, code) => {
    const h = harness();
    await expect(h.store.addMember('owner', 'owner', { memberUserId: 'manager', scopes })).rejects.toMatchObject({ code });
    expect(h.calls).toHaveLength(0);
  });

  test('rejects a normalizer that escalates a feature to wildcard or omits implied read', async () => {
    for (const badScopes of [['*'], ['commands:write']]) {
      const h = harness(undefined, { normalizeScopes: () => badScopes });
      await expect(h.store.addMember('owner', 'owner', { memberUserId: 'manager', scopes: ['commands:write'] })).rejects.toMatchObject({ code: 'invalid_manager_scopes' });
      expect(h.calls).toHaveLength(0);
    }
  });

  test('rejects self-membership before connecting', async () => {
    const h = harness();
    await expect(h.store.addMember('owner', 'owner', { memberUserId: ' owner ' })).rejects.toMatchObject({ code: 'cannot_manage_self' });
    expect(h.calls).toHaveLength(0);
  });

  test.each([[true, 'site_admin_has_implicit_access'], [null, 'manager_user_not_found']])('cannot create an admin or unknown member', async (admin, code) => {
    const h = await ready(harness(() => ({ rows: admin === null ? [] : [{ id: 'manager', is_admin: admin }] })));
    await expect(h.store.addMember('owner', 'actor', { memberUserId: 'manager' })).rejects.toMatchObject({ code });
    expect(h.calls.at(-1).text).toBe('rollback');
    expect(h.calls.some((call) => call.text.startsWith('insert '))).toBe(false);
  });

  test('scope changes audit both previous and next scopes under the specified owner', async () => {
    const h = await ready(harness(grantHandler));
    await h.store.updateMember('owner', 'actor', GRANT, ['commands:write']);
    const update = h.calls.find((call) => call.text.startsWith('update bot_managers'));
    expect(update.values).toEqual(['owner', GRANT, '["commands:read","commands:write"]']);
    const audit = h.calls.find((call) => call.text.startsWith('insert into bot_management_audit'));
    expect(audit.values).toEqual(['owner', 'actor', 'manager.update', GRANT, 'manager', '["*"]', '["commands:read","commands:write"]']);
  });

  test('unchanged scope updates create no spurious audit or timestamp writes', async () => {
    const h = await ready(harness(grantHandler));
    await h.store.updateMember('owner', 'actor', GRANT, ['*']);
    expect(h.calls.some((call) => /^(insert|update) /.test(call.text))).toBe(false);
  });

  test('other owners cannot update or delete a grant and missing deletes are idempotent', async () => {
    const h = await ready(harness());
    expect(await h.store.updateMember('other-owner', 'actor', GRANT, ['*'])).toBeNull();
    expect(await h.store.removeMember('other-owner', 'actor', GRANT)).toBeNull();
    const queries = h.calls.filter((call) => call.text.includes('where m.owner_user_id') || call.text.startsWith('delete from'));
    expect(queries).toHaveLength(2);
    for (const call of queries) {
      expect(call.values).toEqual(['other-owner', GRANT]);
      expect(call.text).toContain('owner_user_id = $1');
      expect(call.text).toContain('id = $2');
    }
    expect(h.calls.some((call) => call.text.startsWith('insert into bot_management_audit'))).toBe(false);
  });

  test('removal logs the original member and scopes before commit', async () => {
    const h = await ready(harness(grantHandler));
    expect(await h.store.removeMember('owner', 'actor', GRANT)).toEqual({ id: GRANT, memberUserId: 'manager', scopes: ['*'] });
    expect(h.calls.find((call) => call.text.startsWith('insert into bot_management_audit')).values)
      .toEqual(['owner', 'actor', 'manager.remove', GRANT, 'manager', '["*"]', null]);
    expect(h.calls.at(-1).text).toBe('commit');
  });

  test.each(['add', 'update', 'remove'])('%s rolls back when audit persistence fails', async (operation) => {
    const h = await ready(harness((text, values) => {
      if (text.startsWith('insert into bot_management_audit')) throw new Error('audit unavailable');
      return grantHandler(text, values);
    }));
    const request = operation === 'add' ? h.store.addMember('owner', 'actor', { memberUserId: 'manager' })
      : operation === 'update' ? h.store.updateMember('owner', 'actor', GRANT, ['commands:read'])
        : h.store.removeMember('owner', 'actor', GRANT);
    await expect(request).rejects.toThrow('audit unavailable');
    expect(h.calls.at(-1).text).toBe('rollback');
    expect(h.calls.some((call) => call.text === 'commit')).toBe(false);
  });
});

describe('minimal audit logging', () => {
  test('stores actor and owner separately, strips query/fragment and ignores private extra fields', async () => {
    const h = await ready(harness((text, values) => ({ rows: [{ id: GRANT, owner_user_id: values[0], actor_user_id: values[1], action: values[2], method: values[3], path: values[4], status: values[5] }] })));
    const result = await h.store.recordAction({ ownerUserId: 'owner', actorUserId: 'actor', action: 'commands.update',
      method: 'patch', path: '/api/rules/:id?token=secret#private', status: 200,
      body: { password: 'hidden' }, headers: { authorization: 'Bearer private' }, token: 'sensitive' });
    expect(result.actorUserId).toBe('actor');
    expect(h.calls[0].values).toEqual(['owner', 'actor', 'commands.update', 'PATCH', '/api/rules/:id', 200]);
    expect(JSON.stringify(h.calls)).not.toMatch(/secret|hidden|Bearer|sensitive/);
    expect(h.withPgClient.mock.calls[0][1]).toBe(0);
  });

  test.each([
    [{ action: 'manager.add' }, 'reserved_audit_action'],
    [{ status: 700 }, 'invalid_audit_status'],
    [{ method: 'UNSAFE' }, 'invalid_audit_method'],
    [{ path: 'https://user:pass@example.com/api' }, 'invalid_audit_path'],
    [{ path: '//user:pass@example.com/api' }, 'invalid_audit_path'],
  ])('rejects invalid audit attributes %j', async (extra, code) => {
    const h = harness();
    await expect(h.store.recordAction({ ownerUserId: 'owner', actorUserId: 'actor', action: 'commands.update', method: 'POST', path: '/api/rules', status: 200, ...extra })).rejects.toMatchObject({ code });
    expect(h.calls).toHaveLength(0);
  });

  test('audit listing is owner-filtered, bounded and excludes unrecognized fields', async () => {
    const h = await ready(harness(() => ({ rows: [{ id: GRANT, owner_user_id: 'owner', actor_user_id: 'actor', action: 'manager.add', metadata: { token: 'secret' } }] })));
    const result = await h.store.listAudit('owner', 9999);
    expect(h.calls[0].values).toEqual(['owner', 200]);
    expect(h.calls[0].text).toContain('where owner_user_id = $1');
    expect(result[0].actorUserId).toBe('actor');
    expect(result[0]).not.toHaveProperty('metadata');
  });
});
