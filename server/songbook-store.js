import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { normalizeSongbookSong, normalizeSongbookSettings, normalizeSongbookQuery, publicSongbookSong, songbookError } from '../shared/songbook.js';

const MIGRATION = new URL('./migrations/027_songbook.sql', import.meta.url);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const requireId = (value) => { if (typeof value !== 'string' || !UUID.test(value)) throw songbookError('항목 ID를 확인해 주세요.'); return value.toLowerCase(); };
const song = row => row ? { ...publicSongbookSong({ ...row.data, id: row.id }), privateNote: row.data.privateNote || '', visible: row.data.visible !== false, revision: row.revision } : null;
const request = row => row ? { id: row.id, songId: row.song_id, song: row.song, username: row.username, message: row.message, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at } : null;
const settings = row => ({ requestsEnabled: row?.requests_enabled === true, perUserLimit: row?.per_user_limit || 1 });

export function createSongbookStore({ withPgClient, ensureIdentityTables }) {
  let schema;
  async function transaction(fn) {
    return withPgClient(async pg => {
      await pg.query('begin');
      try { const value = await fn(pg); await pg.query('commit'); return value; }
      catch (error) { await pg.query('rollback').catch(() => {}); throw error; }
    }, 0);
  }
  function ensureSchema() {
    if (!schema) schema = (async () => {
      await ensureIdentityTables();
      const sql = await readFile(MIGRATION, 'utf8');
      await transaction(async pg => {
        await pg.query('select pg_advisory_xact_lock(hashtext($1))', ['songbook-schema:027']);
        await pg.query(sql);
      });
    })().catch(error => { schema = null; throw error; });
    return schema;
  }
  async function locked(owner, fn) {
    await ensureSchema();
    return transaction(async pg => {
      await pg.query('insert into songbook_settings(owner_user_id) values ($1) on conflict do nothing', [owner]);
      const { rows } = await pg.query('select * from songbook_settings where owner_user_id=$1 for update', [owner]);
      return fn(pg, settings(rows[0]));
    });
  }
  async function getSettings(owner) {
    await ensureSchema();
    const { rows } = await withPgClient(pg => pg.query('select * from songbook_settings where owner_user_id=$1', [owner]));
    return settings(rows[0]);
  }
  async function listSongs(owner, query = {}, { publicOnly = false } = {}) {
    await ensureSchema();
    const q = normalizeSongbookQuery(query);
    const values = [owner];
    const predicates = ['owner_user_id=$1'];
    if (publicOnly) predicates.push("coalesce((data->>'visible')::boolean, true)");
    const escapeLike = value => value.replace(/[!%_]/g, '!$&');
    for (const term of q.search.split(/\s+/).filter(Boolean).slice(0, 8)) {
      values.push(`%${escapeLike(term)}%`);
      predicates.push(`concat_ws(' ',data->>'title',data->>'artist',data->'tags') ilike $${values.length} escape '!'`);
    }
    if (q.tag) { values.push(q.tag); predicates.push(`data->'tags' ? $${values.length}`); }
    if (q.difficulty) { values.push(q.difficulty); predicates.push(`(data->>'difficulty')::integer=$${values.length}`); }
    const where = predicates.join(' and ');
    return withPgClient(async pg => {
      const total = Number((await pg.query(`select count(*) as total from songbook_songs where ${where}`, values)).rows[0].total);
      const page = Math.min(q.page, Math.max(1, Math.ceil(total / q.limit)));
      const order = q.sort === 'newest' ? 'created_at desc, id' : q.sort === 'artist' ? "lower(data->>'artist'),lower(data->>'title'),id" : "lower(data->>'title'),lower(data->>'artist'),id";
      const { rows } = await pg.query(`select * from songbook_songs where ${where} order by ${order} limit $${values.length + 1} offset $${values.length + 2}`, [...values, q.limit, (page - 1) * q.limit]);
      const tagRows = await pg.query(`select distinct jsonb_array_elements_text(data->'tags') as tag from songbook_songs where owner_user_id=$1 ${publicOnly ? "and coalesce((data->>'visible')::boolean,true)" : ''} order by tag limit 500`, [owner]);
      const settingRows = await pg.query('select * from songbook_settings where owner_user_id=$1', [owner]);
      return { songs: rows.map(row => publicOnly ? publicSongbookSong({ ...row.data, id: row.id }) : song(row)), total, page, limit: q.limit, tags: tagRows.rows.map(row => row.tag), settings: settings(settingRows.rows[0]) };
    });
  }
  async function upsertSong(owner, input) {
    const data = normalizeSongbookSong(input);
    const id = input.id ? requireId(input.id) : randomUUID();
    return locked(owner, async pg => {
      if (input.id) {
        const { rows } = await pg.query('update songbook_songs set data=$3,revision=revision+1,updated_at=now() where owner_user_id=$1 and id=$2 and revision=$4 returning *', [owner, id, JSON.stringify(data), Number(input.revision) || 0]);
        if (!rows[0]) throw songbookError('다른 곳에서 곡이 변경되었거나 삭제되었습니다. 새로고침 후 다시 수정해 주세요.', 409);
        return song(rows[0]);
      }
      const count = Number((await pg.query('select count(*) as total from songbook_songs where owner_user_id=$1', [owner])).rows[0].total);
      if (count >= 5000) throw songbookError('노래책은 최대 5,000곡까지 등록할 수 있습니다.', 409);
      const { rows } = await pg.query('insert into songbook_songs(id,owner_user_id,data) values ($1,$2,$3) returning *', [id, owner, JSON.stringify(data)]);
      return song(rows[0]);
    });
  }
  async function deleteSong(owner, id, revision) {
    requireId(id);
    return locked(owner, async pg => {
      const existing = await pg.query('select id from songbook_songs where owner_user_id=$1 and id=$2 and revision=$3', [owner, id, Number(revision) || 0]);
      if (!existing.rows[0]) throw songbookError('곡이 변경되었거나 삭제되었습니다. 새로고침해 주세요.', 409);
      await pg.query("update songbook_requests set status='cancelled',updated_at=now() where owner_user_id=$1 and song_id=$2 and status='pending'", [owner, id]);
      await pg.query('delete from songbook_songs where owner_user_id=$1 and id=$2', [owner, id]);
      return { deleted: true };
    });
  }
  async function updateSettings(owner, input) {
    const next = normalizeSongbookSettings(input);
    return locked(owner, async pg => {
      await pg.query('update songbook_settings set requests_enabled=$2,per_user_limit=$3 where owner_user_id=$1', [owner, next.requestsEnabled, next.perUserLimit]);
      return next;
    });
  }
  async function listRequests(owner, { viewerUserId = null, history = false } = {}) {
    await ensureSchema();
    const values = [owner];
    const where = ['owner_user_id=$1'];
    if (viewerUserId) { values.push(viewerUserId); where.push('viewer_user_id=$2'); }
    if (!viewerUserId) where.push(history ? "status not in ('pending','singing')" : "status in ('pending','singing')");
    const { rows } = await withPgClient(pg => pg.query(`select * from songbook_requests where ${where.join(' and ')} order by ${viewerUserId ? "case when status in ('pending','singing') then 0 else 1 end,created_at desc" : history ? 'created_at desc' : "case when status='singing' then 0 else 1 end,created_at,id"} limit ${viewerUserId ? 30 : history ? 100 : 500}`, values));
    return { items: rows.map(request) };
  }
  async function requestSong(owner, viewer, input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw songbookError('신청 정보를 확인해 주세요.');
    const songId = requireId(input.songId);
    const key = requireId(input.requestKey);
    if (typeof (input.message ?? '') !== 'string' || (input.message || '').length > 200 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.message || '')) throw songbookError('신청 메시지는 제어 문자 없이 200자 이내로 입력해 주세요.');
    return locked(owner, async (pg, config) => {
      const previous = await pg.query('select * from songbook_requests where owner_user_id=$1 and viewer_user_id=$2 and request_key=$3', [owner, viewer, key]);
      if (previous.rows[0]) return request(previous.rows[0]);
      if (!config.requestsEnabled) throw songbookError('지금은 노래 신청을 받지 않습니다.', 409);
      const selected = (await pg.query('select * from songbook_songs where owner_user_id=$1 and id=$2', [owner, songId])).rows[0];
      if (!selected || selected.data.visible === false || selected.data.requestable === false) throw songbookError('현재 신청할 수 없는 곡입니다.', 409);
      const active = (await pg.query("select * from songbook_requests where owner_user_id=$1 and status in ('pending','singing')", [owner])).rows;
      const duplicate = active.find(row => row.viewer_user_id === viewer && row.song_id === songId);
      if (duplicate) return request(duplicate);
      if (active.filter(row => row.viewer_user_id === viewer).length >= config.perUserLimit) throw songbookError(`진행 중인 신청은 인당 ${config.perUserLimit}곡까지 가능합니다.`, 409);
      if (active.length >= 500) throw songbookError('신청 대기열이 가득 찼습니다. 잠시 후 신청해 주세요.', 409);
      const recent = await pg.query("select 1 from songbook_requests where owner_user_id=$1 and viewer_user_id=$2 and created_at>now()-interval '10 seconds' limit 1", [owner, viewer]);
      if (recent.rows.length) throw songbookError('잠시 후 다시 신청해 주세요.', 429);
      const profile = (await pg.query('select display_name from app_users where id=$1', [viewer])).rows[0];
      if (!profile) throw songbookError('로그인이 필요합니다.', 401);
      const { rows } = await pg.query('insert into songbook_requests(id,owner_user_id,viewer_user_id,song_id,request_key,song,username,message) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *', [randomUUID(), owner, viewer, songId, key, JSON.stringify(publicSongbookSong({ ...selected.data, id: songId })), String(profile.display_name || '익명 시청자').slice(0, 100), String(input.message || '').trim()]);
      return request(rows[0]);
    });
  }
  async function changeRequest(owner, id, status, { viewerUserId = null, expectedStatus } = {}) {
    requireId(id);
    if (!['singing', 'done', 'rejected', 'cancelled'].includes(status)) throw songbookError('신청 처리 상태를 확인해 주세요.');
    return locked(owner, async pg => {
      const row = (await pg.query('select * from songbook_requests where owner_user_id=$1 and id=$2', [owner, id])).rows[0];
      if (!row || (viewerUserId && row.viewer_user_id !== viewerUserId)) throw songbookError('신청을 찾지 못했습니다.', 404);
      if (row.status === status) return request(row);
      if (viewerUserId && (status !== 'cancelled' || row.status !== 'pending')) throw songbookError('대기 중인 내 신청만 취소할 수 있습니다.', 409);
      if (expectedStatus && row.status !== expectedStatus) throw songbookError('신청 상태가 변경되었습니다. 새로고침해 주세요.', 409);
      const valid = row.status === 'pending' ? ['singing', 'rejected', 'cancelled'] : row.status === 'singing' ? ['done', 'rejected'] : [];
      if (!valid.includes(status)) throw songbookError('이미 처리되었거나 변경할 수 없는 신청입니다.', 409);
      if (status === 'singing') {
        const singing = await pg.query("select 1 from songbook_requests where owner_user_id=$1 and status='singing'", [owner]);
        if (singing.rows.length) throw songbookError('현재 부르는 곡을 먼저 완료해 주세요.', 409);
      }
      const { rows } = await pg.query('update songbook_requests set status=$3,updated_at=now() where owner_user_id=$1 and id=$2 returning *', [owner, id, status]);
      return request(rows[0]);
    });
  }
  return { ensureSchema, getSettings, listSongs, upsertSong, deleteSong, updateSettings, listRequests, requestSong, changeRequest };
}
