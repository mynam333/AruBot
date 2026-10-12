import { readFile } from 'node:fs/promises';

const MIGRATION_URL = new URL('./migrations/026_bot_managers.sql', import.meta.url);
const USER_FIELDS = 'u.id, u.display_name, u.avatar_url, u.primary_provider';
const MEMBER_FIELDS = `m.id, m.member_user_id, m.scopes, m.created_at, m.updated_at,
  u.display_name, u.avatar_url, u.primary_provider`;
const SCOPE_PATTERN = /^[a-z][a-z0-9_-]{0,63}:(read|write)$/;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function fail(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

function identity(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) {
    fail('invalid_user_id');
  }
  return value.trim();
}

function memberId(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail('invalid_manager_id');
  return value;
}

function boundedLimit(value, fallback, maximum = 100) {
  return Number.isSafeInteger(value) ? Math.max(1, Math.min(maximum, value)) : fallback;
}

function searchPattern(value = '') {
  if (typeof value !== 'string' || value.length > 100 || /[\u0000-\u001f\u007f]/.test(value)) fail('invalid_query');
  const query = value.trim();
  return query ? `%${query.replace(/[!%_]/g, '!$&')}%` : null;
}

function publicIdentity(row) {
  return {
    displayName: row.display_name || row.member_user_id || row.id,
    avatarUrl: row.avatar_url || null,
    provider: row.primary_provider || null,
  };
}

function auditEntry(row) {
  return {
    id: row.id, ownerUserId: row.owner_user_id, actorUserId: row.actor_user_id,
    action: row.action, memberId: row.member_id, memberUserId: row.member_user_id,
    previousScopes: row.previous_scopes, scopes: row.scopes,
    method: row.method, path: row.path, status: row.status, createdAt: row.created_at,
  };
}

async function sharedNormalizeScopes(scopes) {
  const { normalizeBotManagerScopes } = await import('../shared/bot-management-policy.js');
  return normalizeBotManagerScopes(scopes);
}

// Authentication, grant-management authorization and feature checks belong to the
// caller. Pass canonical app_users IDs, never a selected owner's ID as the actor.
export function createBotManagementStore({ withPgClient, ensureIdentityTables, normalizeScopes = sharedNormalizeScopes } = {}) {
  if (typeof withPgClient !== 'function' || typeof normalizeScopes !== 'function'
    || (ensureIdentityTables !== undefined && typeof ensureIdentityTables !== 'function')) {
    throw new TypeError('Bot management requires withPgClient and a scope normalizer');
  }

  let schemaPromise = null;

  async function transaction(callback) {
    // A lost COMMIT response must not replay a successful grant/audit write.
    return withPgClient(async (pg) => {
      await pg.query('begin');
      try {
        const result = await callback(pg);
        await pg.query('commit');
        return result;
      } catch (error) {
        await pg.query('rollback').catch(() => undefined);
        throw error;
      }
    }, 0);
  }

  function ensureSchema() {
    if (!schemaPromise) {
      schemaPromise = (async () => {
        await ensureIdentityTables?.();
        const sql = await readFile(MIGRATION_URL, 'utf8');
        await transaction(async (pg) => {
          await pg.query('select pg_advisory_xact_lock(hashtext($1))', ['bot-management-schema:026']);
          await pg.query(sql);
        });
      })().catch((error) => {
        schemaPromise = null;
        throw error;
      });
    }
    return schemaPromise;
  }

  async function checkedScopes(input) {
    if (!Array.isArray(input) || input.length < 1 || input.length > 128
      || input.some((scope) => typeof scope !== 'string' || (scope !== '*' && !SCOPE_PATTERN.test(scope)))
      || (input.includes('*') && input.length !== 1)) fail('invalid_manager_scopes');
    const normalized = await normalizeScopes([...input]);
    if (!Array.isArray(normalized) || !normalized.length || normalized.length > 128
      || normalized.some((scope) => typeof scope !== 'string' || (scope !== '*' && !SCOPE_PATTERN.test(scope)))
      || (normalized.includes('*') && (normalized.length !== 1 || !input.includes('*')))) fail('invalid_manager_scopes');
    const result = [...new Set(normalized)];
    for (const scope of result) {
      if (scope.endsWith(':write') && !result.includes(scope.replace(/:write$/, ':read'))) fail('invalid_manager_scopes');
    }
    return result;
  }

  async function member(row) {
    if (!row) return null;
    return {
      id: row.id, memberUserId: row.member_user_id, ...publicIdentity(row),
      scopes: await checkedScopes(row.scopes), createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  async function access(row, actor, isSiteAdmin) {
    const role = row.id === actor ? 'owner' : isSiteAdmin === true ? 'site_admin' : 'manager';
    return {
      ownerUserId: row.id, ...publicIdentity(row), role,
      scopes: role === 'manager' ? await checkedScopes(row.scopes) : ['*'],
    };
  }

  async function getAccess(actorUserId, ownerUserId, isSiteAdmin = false) {
    const actor = identity(actorUserId);
    const owner = identity(ownerUserId);
    await ensureSchema();
    const { rows } = await withPgClient((pg) => pg.query(
      `select ${USER_FIELDS}, m.scopes from app_users u
       left join bot_managers m on m.owner_user_id = u.id and m.member_user_id = $1
       where u.id = $2 and (u.id = $1 or $3::boolean or m.id is not null)`,
      [actor, owner, isSiteAdmin === true],
    ));
    return rows[0] ? access(rows[0], actor, isSiteAdmin) : null;
  }

  const matchesUser = `(u.id ilike $2 escape '!' or u.display_name ilike $2 escape '!'
    or exists (select 1 from platform_accounts p where p.user_id = u.id
      and (p.channel_name ilike $2 escape '!' or p.channel_id ilike $2 escape '!'
        or p.channel_handle ilike $2 escape '!')))`;

  async function listChannels(actorUserId, { isSiteAdmin = false, query = '', limit = 50 } = {}) {
    const actor = identity(actorUserId);
    const pattern = searchPattern(query);
    await ensureSchema();
    const { rows } = await withPgClient((pg) => pg.query(
      `select ${USER_FIELDS}, m.scopes from app_users u
       left join bot_managers m on m.owner_user_id = u.id and m.member_user_id = $1
       where (u.id = $1 or m.id is not null or ($3::boolean and $2::text is not null))
         and ($2::text is null or ${matchesUser})
       order by (u.id = $1) desc, (m.id is not null) desc,
         coalesce(u.display_name, u.id), u.id limit $4`,
      [actor, pattern, isSiteAdmin === true, boundedLimit(limit, 50)],
    ));
    return Promise.all(rows.map((row) => access(row, actor, isSiteAdmin)));
  }

  async function listMembers(ownerUserId) {
    const owner = identity(ownerUserId);
    await ensureSchema();
    const { rows } = await withPgClient((pg) => pg.query(
      `select ${MEMBER_FIELDS} from bot_managers m join app_users u on u.id = m.member_user_id
       where m.owner_user_id = $1 and u.is_admin = false order by m.created_at, m.id`, [owner],
    ));
    return Promise.all(rows.map(member));
  }

  async function searchUsers(query, limit = 20) {
    const pattern = searchPattern(query);
    if (!pattern) return [];
    await ensureSchema();
    const { rows } = await withPgClient((pg) => pg.query(
      `select ${USER_FIELDS} from app_users u where u.is_admin = false and ${matchesUser.replaceAll('$2', '$1')}
       order by coalesce(u.display_name, u.id), u.id limit $2`, [pattern, boundedLimit(limit, 20, 50)],
    ));
    return rows.map((row) => ({ userId: row.id, ...publicIdentity(row) }));
  }

  async function lockOwner(pg, owner) {
    await pg.query('select pg_advisory_xact_lock(hashtext($1))', [`bot-managers:${owner}`]);
  }

  async function writeGrantAudit(pg, owner, actor, action, row, previousScopes, scopes) {
    await pg.query(
      `insert into bot_management_audit
       (owner_user_id, actor_user_id, action, member_id, member_user_id, previous_scopes, scopes)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [owner, actor, action, row.id, row.member_user_id,
        previousScopes == null ? null : JSON.stringify(previousScopes), scopes == null ? null : JSON.stringify(scopes)],
    );
  }

  async function readMember(pg, owner, id) {
    const { rows } = await pg.query(
      `select ${MEMBER_FIELDS} from bot_managers m join app_users u on u.id = m.member_user_id
       where m.owner_user_id = $1 and m.id = $2 and u.is_admin = false`, [owner, id],
    );
    return member(rows[0]);
  }

  // Adding an existing pair leaves its permissions unchanged; use updateMember
  // for scope edits. This makes retries harmless and prevents accidental resets.
  async function addMember(ownerUserId, actorUserId, { memberUserId, scopes = ['*'] } = {}) {
    const owner = identity(ownerUserId);
    const actor = identity(actorUserId);
    const target = identity(memberUserId);
    if (owner === target) fail('cannot_manage_self');
    const normalized = await checkedScopes(scopes);
    await ensureSchema();
    return transaction(async (pg) => {
      await lockOwner(pg, owner);
      const targetUser = await pg.query('select id, is_admin from app_users where id = $1 for share', [target]);
      if (!targetUser.rows[0]) fail('manager_user_not_found', 404);
      if (targetUser.rows[0].is_admin === true) fail('site_admin_has_implicit_access');
      const inserted = await pg.query(
        `insert into bot_managers (owner_user_id, member_user_id, scopes, created_by)
         values ($1, $2, $3::jsonb, $4) on conflict (owner_user_id, member_user_id) do nothing
         returning id, member_user_id`, [owner, target, JSON.stringify(normalized), actor],
      );
      let row = inserted.rows[0];
      if (row) await writeGrantAudit(pg, owner, actor, 'manager.add', row, null, normalized);
      else {
        const existing = await pg.query('select id from bot_managers where owner_user_id = $1 and member_user_id = $2', [owner, target]);
        row = existing.rows[0];
      }
      return row ? readMember(pg, owner, row.id) : null;
    });
  }

  async function updateMember(ownerUserId, actorUserId, id, scopes) {
    const owner = identity(ownerUserId);
    const actor = identity(actorUserId);
    const grantId = memberId(id);
    const normalized = await checkedScopes(scopes);
    await ensureSchema();
    return transaction(async (pg) => {
      await lockOwner(pg, owner);
      const { rows } = await pg.query(
        `select m.id, m.member_user_id, m.scopes from bot_managers m
         join app_users u on u.id = m.member_user_id
         where m.owner_user_id = $1 and m.id = $2 and m.member_user_id <> $1 and u.is_admin = false
         for update of m`, [owner, grantId],
      );
      const previous = rows[0];
      if (!previous) return null;
      const unchanged = Array.isArray(previous.scopes) && previous.scopes.length === normalized.length
        && previous.scopes.every((scope) => normalized.includes(scope));
      if (!unchanged) {
        await pg.query('update bot_managers set scopes = $3::jsonb, updated_at = now() where owner_user_id = $1 and id = $2',
          [owner, grantId, JSON.stringify(normalized)]);
        await writeGrantAudit(pg, owner, actor, 'manager.update', previous, previous.scopes, normalized);
      }
      return readMember(pg, owner, grantId);
    });
  }

  async function removeMember(ownerUserId, actorUserId, id) {
    const owner = identity(ownerUserId);
    const actor = identity(actorUserId);
    const grantId = memberId(id);
    await ensureSchema();
    return transaction(async (pg) => {
      await lockOwner(pg, owner);
      const { rows } = await pg.query(
        `delete from bot_managers where owner_user_id = $1 and id = $2 and member_user_id <> $1
         returning id, member_user_id, scopes`, [owner, grantId],
      );
      if (!rows[0]) return null;
      await writeGrantAudit(pg, owner, actor, 'manager.remove', rows[0], rows[0].scopes, null);
      return { id: rows[0].id, memberUserId: rows[0].member_user_id, scopes: rows[0].scopes };
    });
  }

  async function listAudit(ownerUserId, limit = 50) {
    const owner = identity(ownerUserId);
    await ensureSchema();
    const { rows } = await withPgClient((pg) => pg.query(
      `select id, owner_user_id, actor_user_id, action, member_id, member_user_id,
         previous_scopes, scopes, method, path, status, created_at
       from bot_management_audit where owner_user_id = $1 order by created_at desc, id desc limit $2`,
      [owner, boundedLimit(limit, 50, 200)],
    ));
    return rows.map(auditEntry);
  }

  // path must be a trusted route template (e.g. /api/rules/:id), not a raw URL
  // containing credentials in its segments. Query strings/fragments are dropped.
  async function recordAction({ ownerUserId, actorUserId, action, method, path, status } = {}) {
    const owner = identity(ownerUserId);
    const actor = identity(actorUserId);
    if (typeof action !== 'string' || !/^[a-z][a-z0-9_.:-]{0,99}$/.test(action)) fail('invalid_audit_action');
    if (action.startsWith('manager.')) fail('reserved_audit_action');
    if (typeof method !== 'string' || !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method.toUpperCase())) {
      fail('invalid_audit_method');
    }
    if (typeof path !== 'string') fail('invalid_audit_path');
    const routePath = path.split(/[?#]/, 1)[0];
    if (!routePath.startsWith('/') || routePath.startsWith('//') || routePath.length > 512
      || /[\u0000-\u0020\u007f\\]/.test(routePath)) fail('invalid_audit_path');
    if (!Number.isSafeInteger(status) || status < 100 || status > 599) fail('invalid_audit_status');
    await ensureSchema();
    const { rows } = await withPgClient((pg) => pg.query(
      `insert into bot_management_audit (owner_user_id, actor_user_id, action, method, path, status)
       values ($1, $2, $3, $4, $5, $6)
       returning id, owner_user_id, actor_user_id, action, member_id, member_user_id,
         previous_scopes, scopes, method, path, status, created_at`,
      [owner, actor, action, method.toUpperCase(), routePath, status],
    ), 0);
    return auditEntry(rows[0]);
  }

  return { ensureSchema, getAccess, listChannels, listMembers, searchUsers, addMember, updateMember, removeMember, listAudit, recordAction };
}
