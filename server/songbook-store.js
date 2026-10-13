import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { normalizeSongbookSong, normalizeSongbookSettings, normalizeSongbookQuery, publicSongbookSong, songbookError } from '../shared/songbook.js';
import { normalizeSongbookOverlay, songbookOverlaySnapshot } from '../shared/songbook-overlay.js';
import { matchSongbookSongs } from '../shared/songbook-commands.js';

const MIGRATION = new URL('./migrations/027_songbook.sql', import.meta.url);
const OVERLAY_MIGRATION = new URL('./migrations/030_songbook_overlay.sql', import.meta.url);
const CHAT_MIGRATION = new URL('./migrations/031_songbook_chat_requests.sql', import.meta.url);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const requireId = (value) => { if (typeof value !== 'string' || !UUID.test(value)) throw songbookError('항목 ID를 확인해 주세요.'); return value.toLowerCase(); };
const song = row => row ? { ...publicSongbookSong({ ...row.data, id: row.id }), privateNote: row.data.privateNote || '', visible: row.data.visible !== false, revision: row.revision } : null;
const request = row => row ? { id: row.id, songId: row.song_id, song: row.song, username: row.username, message: row.message, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at } : null;
const settings = row => ({ requestsEnabled: row?.requests_enabled === true, perUserLimit: row?.per_user_limit || 1 });
// Only verified account links may combine website and chat identities.
const viewerPredicate = `(viewer_user_id=$2 or (viewer_user_id is null and exists (
  select 1 from platform_accounts a where a.user_id=$2 and a.provider=chat_provider
    and chat_user_id in (a.platform_user_id,a.channel_id))))`;

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
      const overlaySql = await readFile(OVERLAY_MIGRATION, 'utf8');
      const chatSql = await readFile(CHAT_MIGRATION, 'utf8');
      await transaction(async pg => {
        await pg.query('select pg_advisory_xact_lock(hashtext($1))', ['songbook-schema:027']);
        await pg.query(sql);
        await pg.query(overlaySql);
        await pg.query(chatSql);
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
    if (viewerUserId) { values.push(viewerUserId); where.push(viewerPredicate); }
    if (!viewerUserId) where.push(history ? "status not in ('pending','singing')" : "status in ('pending','singing')");
    const { rows } = await withPgClient(pg => pg.query(`select * from songbook_requests where ${where.join(' and ')} order by ${viewerUserId ? "case when status in ('pending','singing') then 0 else 1 end,created_at desc" : history ? 'created_at desc' : "case when status='singing' then 0 else 1 end,created_at,id"} limit ${viewerUserId ? 30 : history ? 100 : 500}`, values));
    return { items: rows.map(request) };
  }
  async function requestSong(owner, viewer, input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw songbookError('신청 정보를 확인해 주세요.');
    const songId = requireId(input.songId);
    const key = requireId(input.requestKey);
    if (typeof (input.message ?? '') !== 'string' || (input.message || '').length > 200 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.message || '')) throw songbookError('신청 메시지는 제어 문자 없이 200자 이내로 입력해 주세요.');
    return locked(owner, (pg, config) => insertRequest(pg, owner, viewer, { ...input, songId, requestKey: key }, config));
  }
  async function insertRequest(pg, owner, viewer, input, config, chat = null) {
      const songId = input.songId;
      const key = input.requestKey;
      const previous = await pg.query('select * from songbook_requests where owner_user_id=$1 and viewer_user_id=$2 and request_key=$3', [owner, viewer, key]);
      if (previous.rows[0]) return request(previous.rows[0]);
      if (chat) {
        const retried = await pg.query('select * from songbook_requests where owner_user_id=$1 and chat_provider=$2 and chat_user_id=$3 and request_key=$4', [owner, chat.provider, chat.userId, key]);
        if (retried.rows[0]) return request(retried.rows[0]);
      }
      if (!config.requestsEnabled) throw songbookError('지금은 노래 신청을 받지 않습니다.', 409);
      const selected = (await pg.query('select * from songbook_songs where owner_user_id=$1 and id=$2', [owner, songId])).rows[0];
      if (!selected || selected.data.visible === false || selected.data.requestable === false) throw songbookError('현재 신청할 수 없는 곡입니다.', 409);
      const active = (await pg.query("select * from songbook_requests where owner_user_id=$1 and status in ('pending','singing')", [owner])).rows;
      const accounts = viewer ? (await pg.query('select provider,platform_user_id,channel_id from platform_accounts where user_id=$1', [viewer])).rows : [];
      const mine = row => (viewer && row.viewer_user_id === viewer) || (chat && row.chat_provider === chat.provider && row.chat_user_id === chat.userId)
        || (!row.viewer_user_id && accounts.some(a => a.provider === row.chat_provider && [a.platform_user_id, a.channel_id].filter(Boolean).includes(row.chat_user_id)));
      const duplicate = active.find(row => mine(row) && row.song_id === songId);
      if (duplicate) return request(duplicate);
      if (active.filter(mine).length >= config.perUserLimit) throw songbookError(`진행 중인 신청은 인당 ${config.perUserLimit}곡까지 가능합니다.`, 409);
      if (active.length >= 500) throw songbookError('신청 대기열이 가득 찼습니다. 잠시 후 신청해 주세요.', 409);
      const recent = await pg.query(`select 1 from songbook_requests where owner_user_id=$1 and (${viewerPredicate} or (chat_provider=$3 and chat_user_id=$4)) and created_at>now()-interval '10 seconds' limit 1`, [owner, viewer, chat?.provider || null, chat?.userId || null]);
      if (recent.rows.length) throw songbookError('잠시 후 다시 신청해 주세요.', 429);
      const profile = chat ? { display_name: chat.username } : (await pg.query('select display_name from app_users where id=$1', [viewer])).rows[0];
      if (!profile) throw songbookError('로그인이 필요합니다.', 401);
      const { rows } = await pg.query('insert into songbook_requests(id,owner_user_id,viewer_user_id,song_id,request_key,song,username,message,chat_provider,chat_user_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *', [randomUUID(), owner, viewer, songId, key, JSON.stringify(publicSongbookSong({ ...selected.data, id: songId })), String(profile.display_name || '익명 시청자').slice(0, 100), String(input.message || '').trim(), chat?.provider || null, chat?.userId || null]);
      return request(rows[0]);
  }
  async function requestSongFromChat(owner, chat, query, requestKey) {
    if (!['chzzk', 'cime', 'youtube'].includes(chat?.provider) || typeof chat.userId !== 'string' || !chat.userId.trim() || chat.userId.length > 200) throw songbookError('채팅 사용자 정보를 확인할 수 없습니다. 노래책 페이지에서 신청해 주세요.');
    const userId = chat.userId.replace(new RegExp(`^${chat.provider}:`), '').trim();
    if (!userId || /[\s\u0000-\u001f\u007f]/.test(userId) || /^(?:unknown_user|nickname:)/.test(userId)) throw songbookError('채팅 사용자 정보를 확인할 수 없습니다. 노래책 페이지에서 신청해 주세요.');
    if (typeof query !== 'string' || !query.trim() || query.length > 320) throw songbookError('신청할 곡명 또는 가수와 곡명을 입력해 주세요.');
    requireId(requestKey);
    return locked(owner, async (pg, config) => {
      const previous = await pg.query('select * from songbook_requests where owner_user_id=$1 and chat_provider=$2 and chat_user_id=$3 and request_key=$4', [owner, chat.provider, userId, requestKey]);
      if (previous.rows[0]) return request(previous.rows[0]);
      if (!config.requestsEnabled) throw songbookError('지금은 노래 신청을 받지 않습니다.', 409);
      const { rows } = await pg.query("select id,data from songbook_songs where owner_user_id=$1 and coalesce((data->>'visible')::boolean,true) and coalesce((data->>'requestable')::boolean,true) limit 5000", [owner]);
      const matches = matchSongbookSongs(rows.map(row => ({ ...row.data, id: row.id })), query);
      if (!matches.length) throw songbookError('신청 가능한 곡을 찾지 못했습니다. 노래책의 곡명과 가수를 확인해 주세요.', 404);
      if (matches.length > 1) throw songbookError(`여러 곡이 검색되었습니다: ${matches.slice(0, 3).map(song => `${song.artist} - ${song.title}`.slice(0, 70)).join(' / ')}. 가수와 곡명을 함께 입력하거나 노래책에서 선택해 주세요.`, 409);
      const linked = (await pg.query('select distinct user_id from platform_accounts where provider=$1 and (platform_user_id=$2 or channel_id=$2) limit 2', [chat.provider, userId])).rows;
      if (linked.length > 1) throw songbookError('연결된 계정 정보를 확인할 수 없습니다. 노래책 페이지에서 신청해 주세요.', 409);
      return insertRequest(pg, owner, linked[0]?.user_id || null, { songId: matches[0].id, requestKey }, config, { ...chat, userId });
    });
  }
  async function changeRequest(owner, id, status, { viewerUserId = null, expectedStatus } = {}) {
    requireId(id);
    if (!['singing', 'done', 'rejected', 'cancelled'].includes(status)) throw songbookError('신청 처리 상태를 확인해 주세요.');
    return locked(owner, async pg => {
      const row = (await pg.query('select * from songbook_requests where owner_user_id=$1 and id=$2', [owner, id])).rows[0];
      if (!row) throw songbookError('신청을 찾지 못했습니다.', 404);
      if (viewerUserId && row.viewer_user_id !== viewerUserId) {
        const owned = await pg.query(`select id from songbook_requests where owner_user_id=$1 and ${viewerPredicate} and id=$3`, [owner, viewerUserId, id]);
        if (!owned.rows.length) throw songbookError('신청을 찾지 못했습니다.', 404);
      }
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
  const newOverlayToken = () => `${randomUUID()}${randomUUID()}`.replaceAll('-', '');
  const overlayResult = row => ({ config: normalizeSongbookOverlay(row.overlay_config || {}), revision: row.overlay_revision, viewerPath: `/viewer/songbook/${row.overlay_token}` });
  async function getOverlay(owner) {
    return locked(owner, async pg => {
      const { rows } = await pg.query('update songbook_settings set overlay_token=coalesce(overlay_token,$2) where owner_user_id=$1 returning *', [owner, newOverlayToken()]);
      return overlayResult(rows[0]);
    });
  }
  async function saveOverlay(owner, input = {}) {
    const config = normalizeSongbookOverlay(input?.config);
    if (!Number.isSafeInteger(input?.revision) || input.revision < 1) throw songbookError('설정 버전을 확인해 주세요.');
    return locked(owner, async pg => {
      const { rows } = await pg.query('update songbook_settings set overlay_config=$2,overlay_revision=overlay_revision+1 where owner_user_id=$1 and overlay_revision=$3 returning *', [owner, JSON.stringify(config), input.revision]);
      if (!rows[0]) throw songbookError('다른 곳에서 오버레이 설정이 변경되었습니다. 다시 불러온 후 저장해 주세요.', 409);
      return overlayResult(rows[0]);
    });
  }
  async function rotateOverlay(owner) {
    return locked(owner, async pg => {
      const { rows } = await pg.query('update songbook_settings set overlay_token=$2,overlay_revision=overlay_revision+1 where owner_user_id=$1 returning *', [owner, newOverlayToken()]);
      return overlayResult(rows[0]);
    });
  }
  async function getOverlaySnapshot(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw songbookError('오버레이 주소를 확인해 주세요.', 404);
    await ensureSchema();
    // One statement observes layout and queue from the same database snapshot.
    const { rows } = await withPgClient(pg => pg.query(`select s.overlay_config,s.requests_enabled,
      coalesce((select jsonb_agg(r order by r.created_at,r.id) from
        (select id,song,username,status,created_at from songbook_requests where owner_user_id=s.owner_user_id
          and status in ('pending','singing') order by created_at,id limit 500) r), '[]'::jsonb) as requests
      from songbook_settings s where s.overlay_token=$1`, [token]));
    if (!rows[0]) throw songbookError('오버레이 주소가 만료되었습니다.', 404);
    return songbookOverlaySnapshot(rows[0], rows[0].requests);
  }
  return { ensureSchema, getSettings, listSongs, upsertSong, deleteSong, updateSettings, listRequests, requestSong, requestSongFromChat, changeRequest,
    getOverlay, saveOverlay, rotateOverlay, getOverlaySnapshot };
}
