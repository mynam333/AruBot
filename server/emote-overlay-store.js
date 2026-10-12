import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { normalizeEmoteSettings, safeEmoteImageUrl } from '../shared/emote-overlay.js';

const migration = new URL('./migrations/028_emote_overlay.sql', import.meta.url);
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const makeToken = () => `emo_${randomBytes(32).toString('base64url')}`;
const config = row => normalizeEmoteSettings(row?.config || {});
const packet = row => ({ ...row.payload, id: String(row.id), createdAt: new Date(row.created_at).getTime() });

export function createEmoteOverlayStore({ withPgClient, ensureIdentityTables }) {
  let schema;
  async function transaction(fn) {
    return withPgClient(async pg => {
      await pg.query('begin');
      try { const result = await fn(pg); await pg.query('commit'); return result; }
      catch (error) { await pg.query('rollback').catch(() => {}); throw error; }
    }, 0);
  }
  function ensureSchema() {
    if (!schema) schema = (async () => {
      await ensureIdentityTables();
      const sql = await readFile(migration, 'utf8');
      await transaction(async pg => {
        await pg.query('select pg_advisory_xact_lock(hashtext($1))', ['emote-overlay-schema:028']);
        await pg.query(sql);
      });
    })().catch(error => { schema = null; throw error; });
    return schema;
  }
  async function locked(owner, fn, create = true) {
    await ensureSchema();
    return transaction(async pg => {
      if (create) await pg.query('insert into emote_overlay_settings(owner_user_id,viewer_token) values ($1,$2) on conflict(owner_user_id) do nothing', [owner, makeToken()]);
      const row = (await pg.query('select * from emote_overlay_settings where owner_user_id=$1 for update', [owner])).rows[0];
      return fn(pg, row);
    });
  }
  async function get(owner, { create = false } = {}) {
    await ensureSchema();
    if (create) await locked(owner, () => {});
    return withPgClient(async pg => {
      const row = (await pg.query('select * from emote_overlay_settings where owner_user_id=$1', [owner])).rows[0];
      if (!row) return null;
      return { settings: config(row), revision: row.revision, epoch: Number(row.epoch), viewerPath: `/viewer/emotes/${row.viewer_token}` };
    });
  }
  async function save(owner, settings, revision) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || !Number.isSafeInteger(revision) || revision < 1) fail('설정과 버전을 확인해 주세요.');
    const normalized = normalizeEmoteSettings(settings, { strict: true });
    return locked(owner, async (pg, row) => {
      if (revision !== row.revision) fail('다른 곳에서 설정이 변경되었습니다. 새로고침 후 다시 저장해 주세요.', 409);
      const disabled = !normalized.enabled;
      await pg.query('update emote_overlay_settings set config=$2,revision=revision+1,epoch=epoch+$3,updated_at=now() where owner_user_id=$1', [owner, JSON.stringify(normalized), disabled ? 1 : 0]);
      if (disabled) await pg.query('delete from emote_overlay_events where owner_user_id=$1', [owner]);
      return { settings: normalized, revision: row.revision + 1, epoch: Number(row.epoch) + (disabled ? 1 : 0), viewerPath: `/viewer/emotes/${row.viewer_token}` };
    });
  }
  async function clear(owner, rotate = false) {
    return locked(owner, async (pg, row) => {
      const token = rotate ? makeToken() : row.viewer_token;
      await pg.query('update emote_overlay_settings set epoch=epoch+1,viewer_token=$2,updated_at=now() where owner_user_id=$1', [owner, token]);
      await pg.query('delete from emote_overlay_events where owner_user_id=$1', [owner]);
      return { cleared: true, epoch: Number(row.epoch) + 1, viewerPath: `/viewer/emotes/${token}` };
    });
  }
  async function append(owner, event, { test = false, epoch, expiresAt } = {}) {
    return locked(owner, async (pg, row) => {
      if (!row || (epoch != null && String(epoch) !== String(row.epoch)) || (expiresAt != null && Date.now() >= expiresAt)) return null;
      const settings = config(row);
      if (!settings.enabled) return null;
      let items = (Array.isArray(event?.items) ? event.items : []).slice(0, 16).flatMap(item => {
        if (!item || (!test && !(['chzzk', 'cime', 'youtube'].includes(item.provider) && settings.providers[item.provider]))) return [];
        const url = test && item.url === '/files/logo.png' ? item.url : safeEmoteImageUrl(item.url);
        return url ? [{ url, name: String(item.name || '이모티콘').slice(0, 80), provider: item.provider }] : [];
      }).slice(0, settings.maxPerMessage);
      if (!items.length) return null;
      const duplicate = await pg.query('select id from emote_overlay_events where owner_user_id=$1 and event_key=$2', [owner, event.key]);
      if (duplicate.rows.length) return null;
      if (!test && settings.cooldownMs) {
        const recent = await pg.query("select id from emote_overlay_events where owner_user_id=$1 and actor_key=$2 and created_at>clock_timestamp()-($3 * interval '1 millisecond') limit 1", [owner, event.actor, settings.cooldownMs]);
        if (recent.rows.length) return null;
      }
      const used = Number((await pg.query("select coalesce(sum(count),0) as count from emote_overlay_events where owner_user_id=$1 and created_at>clock_timestamp()-interval '1 second'", [owner])).rows[0].count);
      items = items.slice(0, Math.max(0, settings.perSecond - used));
      if (!items.length) return null;
      const payload = { items, settings, seed: randomBytes(4).readUInt32LE() };
      const result = await pg.query('insert into emote_overlay_events(owner_user_id,event_key,actor_key,epoch,count,payload) values($1,$2,$3,$4,$5,$6) returning *', [owner, event.key, event.actor, row.epoch, items.length, JSON.stringify(payload)]);
      await pg.query("delete from emote_overlay_events where owner_user_id=$1 and created_at<clock_timestamp()-interval '30 seconds'", [owner]);
      return packet(result.rows[0]);
    }, false);
  }
  async function snapshot(token, after) {
    if (typeof token !== 'string' || !/^emo_[A-Za-z0-9_-]{43}$/.test(token)) fail('유효하지 않은 오버레이 주소입니다.', 401);
    if (after != null && (typeof after !== 'string' || !/^\d{1,19}$/.test(after) || BigInt(after) > 9223372036854775807n)) fail('이벤트 커서를 확인해 주세요.');
    await ensureSchema();
    return transaction(async pg => {
      // Share lock prevents token rotation/clear racing with an old event batch.
      const row = (await pg.query('select * from emote_overlay_settings where viewer_token=$1 for share', [token])).rows[0];
      if (!row) fail('오버레이 주소가 변경되었거나 만료되었습니다.', 401);
      const settings = config(row);
      const latest = String((await pg.query('select coalesce(max(id),0) as id from emote_overlay_events where owner_user_id=$1', [row.owner_user_id])).rows[0].id);
      const rows = after == null || !settings.enabled ? [] : (await pg.query("select * from emote_overlay_events where owner_user_id=$1 and epoch=$2 and id>$3 and created_at>clock_timestamp()-interval '8 seconds' order by id limit 120", [row.owner_user_id, row.epoch, after])).rows;
      return { settings, revision: row.revision, epoch: Number(row.epoch), cursor: rows.length >= 120 ? String(rows.at(-1).id) : latest, events: rows.map(packet), serverNow: Date.now() };
    });
  }
  async function cleanup() {
    await ensureSchema();
    return withPgClient(pg => pg.query("delete from emote_overlay_events where created_at<clock_timestamp()-interval '30 seconds'"));
  }
  return { ensureSchema, get, save, clear, append, snapshot, cleanup };
}
