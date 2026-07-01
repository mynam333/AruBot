import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import pkg from 'pg';
import fs from 'fs';
import path from 'path';
const { Client } = pkg;

let supabase;
let columnCache = new Map(); // key: table, value: Set of column names

// Ensure 'tokens' table exists using direct PG connection (for PostgREST cache heal)
async function ensureTokensTableExists() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) return; // cannot heal without direct DB access
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const sql = `
      create table if not exists tokens (
        sid text primary key
      );
      alter table tokens add column if not exists access_token text;
      alter table tokens add column if not exists refresh_token text;
      alter table tokens add column if not exists token_type text;
      alter table tokens add column if not exists expires_at text;
    `;
    await client.query(sql);
  } finally {
    await client.end();
  }
}

// ---------------- API Keys ----------------
async function ensureApiKeysTable() {
  await withPgClient(async (pg) => {
    await pg.query(`
      create table if not exists api_keys (
        api_key text primary key,
        owner_pid text not null,
        created_at timestamptz default now(),
        last_used timestamptz,
        revoked boolean default false
      );
    `);
  });
}

export async function issueApiKey(ownerPid) {
  await ensureApiKeysTable();
  const key = crypto.randomBytes(32).toString('hex');
  await withPgClient(async (pg) => {
    await pg.query(`insert into api_keys (api_key, owner_pid) values ($1, $2)`, [key, String(ownerPid)]);
  });
  return key;
}

export async function getOwnerPidForApiKey(key) {
  if (!key) return null;
  await ensureApiKeysTable();
  let row = null;
  await withPgClient(async (pg) => {
    const r = await pg.query(`select owner_pid, revoked from api_keys where api_key = $1`, [String(key)]);
    row = r?.rows?.[0] || null;
    if (row && row.revoked) row = null;
  });
  return row ? String(row.owner_pid) : null;
}

export async function touchApiKeyLastUsed(key) {
  if (!key) return;
  await withPgClient(async (pg) => {
    await pg.query(`update api_keys set last_used = now() where api_key = $1`, [String(key)]);
  });
}

export async function revokeApiKey(ownerPid, key) {
  if (!key) return false;
  await withPgClient(async (pg) => {
    await pg.query(`update api_keys set revoked = true where api_key = $1 and owner_pid = $2`, [String(key), String(ownerPid)]);
  });
  return true;
}

export async function getActiveApiKeyForOwner(ownerPid) {
  await ensureApiKeysTable();
  let row = null;
  await withPgClient(async (pg) => {
    const r = await pg.query(
      `select api_key from api_keys where owner_pid = $1 and revoked = false order by created_at desc limit 1`,
      [String(ownerPid)]
    );
    row = r?.rows?.[0] || null;
  });
  return row ? String(row.api_key) : null;
}

export async function revokeAllApiKeysForOwner(ownerPid) {
  await ensureApiKeysTable();
  await withPgClient(async (pg) => {
    await pg.query(`update api_keys set revoked = true where owner_pid = $1 and revoked = false`, [String(ownerPid)]);
  });
}

// ---------------- Channel Points (per-streamer table) ----------------
function sanitizeTableNameSuffix(s) {
  const base = String(s || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_');
  // ensure starts with a letter to be a valid identifier
  return /^[A-Za-z_]/.test(base) ? base : `u_${base}`;
}

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
async function withPgClient(fn, retries = 2) {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error('SUPABASE_DB_URL is required for channel points operations');
  let lastErr;
  for (let i=0;i<=retries;i++) {
    const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    try {
      await client.connect();
      const res = await fn(client);
      await client.end();
      return res;
    } catch (e) {
      lastErr = e;
      try { await client.end(); } catch {}
      const code = e && (e.code || e.errno);
      const msg = String(e && (e.message || e.toString()) || '');
      const transient = code === 'XX000' || msg.includes('db_termination') || msg.includes('terminating connection') || msg.includes('server closed the connection');
      if (i < retries && transient) { await sleep(300 * (i+1)); continue; }
      throw e;
    }
  }
  throw lastErr;
}

function isUndefinedDbFunctionError(error, functionName) {
  const message = String(error?.message || error?.toString?.() || '');
  return error?.code === '42883' && (!functionName || message.includes(functionName));
}

export async function ensureChannelPointsTable(streamerUid) {
  const suffix = sanitizeTableNameSuffix(streamerUid);
  const table = `channelpoint_${suffix}`;
  await withPgClient(async (pg) => {
    const sql = `
      create table if not exists ${table} (
        user_id text primary key,
        username text,
        points integer default 0
      );
    `;
    await pg.query(sql);
  });
  return table;
}

export async function listChannelPoints(streamerUid) {
  const table = await ensureChannelPointsTable(streamerUid);
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(`select user_id, username, points from ${table} order by points desc, username asc`);
    return rows || [];
  });
}

export async function listViewerPointBalancesForUserIds(userIds) {
  const ids = Array.from(
    new Set((Array.isArray(userIds) ? userIds : []).map((id) => String(id || '').trim()).filter(Boolean))
  );
  if (!ids.length) return [];

  return withPgClient(async (pg) => {
    const balancesByChannel = new Map();
    const tableUidLookup = new Map();
    try {
      const knownChannels = await pg.query(`
        select distinct provider, platform_user_id, channel_id, channel_name, avatar_url
        from platform_accounts
        where coalesce(channel_id, platform_user_id) is not null
      `);
      for (const row of knownChannels.rows || []) {
        const channelUid = String(row.channel_id || row.platform_user_id || '').trim();
        if (!channelUid) continue;
        tableUidLookup.set(`channelpoint_${sanitizeTableNameSuffix(channelUid)}`, {
          channelUid,
          channelName: row.channel_name || null,
          avatarUrl: row.avatar_url || null,
          provider: row.provider || null,
        });
      }
    } catch {
      // Platform account metadata is an optimization for nicer public links.
    }

    const { rows: tableRows } = await pg.query(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'
        and table_name like 'channelpoint\\_%' escape '\\'
      order by table_name asc
    `);

    const balances = [];
    for (const tableRow of tableRows || []) {
      const table = String(tableRow.table_name || '');
      if (!/^channelpoint_[A-Za-z0-9_]+$/.test(table)) continue;

      const result = await pg.query(
        `select user_id, username, points from ${table} where user_id = any($1::text[])`,
        [ids]
      );
      if (!result.rows?.length) continue;

      const lookup = tableUidLookup.get(table);
      const pointRows = result.rows.map((row) => ({
        userId: row.user_id,
        username: row.username,
        points: Number(row.points || 0),
      }));
      const channelUid = lookup?.channelUid || table.replace(/^channelpoint_/, '');
      const existing = balancesByChannel.get(channelUid) || {
        channelUid,
        channelName: lookup?.channelName || null,
        avatarUrl: lookup?.avatarUrl || null,
        provider: lookup?.provider || null,
        points: 0,
        identities: [],
      };
      existing.points += pointRows.reduce((sum, row) => sum + row.points, 0);
      existing.identities.push(...pointRows);
      balancesByChannel.set(channelUid, existing);
    }

    try {
      const exists = await pg.query(`
        select to_regclass('public.channel_points_balances') as table_name
      `);
      if (exists.rows?.[0]?.table_name) {
        const result = await pg.query(
          `select channel_uid, user_id, username, points from public.channel_points_balances where user_id = any($1::text[])`,
          [ids]
        );
        for (const row of result.rows || []) {
          const channelUid = String(row.channel_uid || '').trim();
          if (!channelUid) continue;
          const lookup = tableUidLookup.get(`channelpoint_${sanitizeTableNameSuffix(channelUid)}`);
          const existing = balancesByChannel.get(channelUid) || {
            channelUid,
            channelName: lookup?.channelName || null,
            avatarUrl: lookup?.avatarUrl || null,
            provider: lookup?.provider || null,
            points: 0,
            identities: [],
          };
          const userId = String(row.user_id || '');
          if (!existing.identities.some((identity) => String(identity.userId || '') === userId)) {
            const points = Number(row.points || 0);
            existing.points += points;
            existing.identities.push({
              userId,
              username: row.username,
              points,
            });
          }
          balancesByChannel.set(channelUid, existing);
        }
      }
    } catch {
      // Newer consolidated point table is optional; legacy per-channel tables remain the source of truth.
    }

    balances.push(...balancesByChannel.values());
    return balances.sort((a, b) => b.points - a.points || String(a.channelUid).localeCompare(String(b.channelUid)));
  });
}

export async function setChannelPoints(streamerUid, userId, username, points) {
  const table = await ensureChannelPointsTable(streamerUid);
  await withPgClient(async (pg) => {
    await pg.query(
      `insert into ${table} (user_id, username, points) values ($1, $2, $3)
       on conflict (user_id) do update set username = excluded.username, points = excluded.points`,
      [String(userId), username ? String(username) : null, Number(points) || 0]
    );
  });
}

export async function incrChannelPoints(streamerUid, userId, username, delta = 1) {
  const table = await ensureChannelPointsTable(streamerUid);
  await withPgClient(async (pg) => {
    await pg.query(
      `insert into ${table} (user_id, username, points) values ($1, $2, $3)
       on conflict (user_id) do update set 
         username = coalesce(excluded.username, ${table}.username),
         points = ${table}.points + EXCLUDED.points`,
      [String(userId), username ? String(username) : null, Number(delta) || 0]
    );
  });
}

export async function getChannelPoints(streamerUid, userId) {
  const table = await ensureChannelPointsTable(streamerUid);
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(`select points from ${table} where user_id = $1`, [String(userId)]);
    if (rows && rows.length > 0 && rows[0] && typeof rows[0].points === 'number') return rows[0].points;
    return 0;
  });
}

export async function deleteChannelPoints(streamerUid, userId) {
  const table = await ensureChannelPointsTable(streamerUid);
  await withPgClient(async (pg) => {
    await pg.query(`delete from ${table} where user_id = $1`, [String(userId)]);
  });
}

export async function clearAllChannelPoints(streamerUid) {
  const table = await ensureChannelPointsTable(streamerUid);
  await withPgClient(async (pg) => {
    await pg.query(`delete from ${table}`);
  });
}

export async function bulkUpsertChannelPoints(streamerUid, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const table = await ensureChannelPointsTable(streamerUid);
  // Insert in batches to avoid very large queries
  const batchSize = 200;
  await withPgClient(async (pg) => {
    for (let i = 0; i < rows.length; i += batchSize) {
      const slice = rows.slice(i, i + batchSize);
      const values = [];
      const params = [];
      slice.forEach((r, idx) => {
        const u = String(r.user_id);
        const name = r.username != null ? String(r.username) : null;
        const pts = Number(r.points) || 0;
        params.push(u, name, pts);
        const base = idx * 3;
        values.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
      });
      const sql = `insert into ${table} (user_id, username, points) values ${values.join(', ')}
        on conflict (user_id) do update set username = coalesce(excluded.username, ${table}.username), points = excluded.points`;
      await pg.query(sql, params);
      // small pacing to avoid connection saturation
      await sleep(50);
    }
  });
}

// --- Sessions (random cookie sid -> userId) ---
export async function upsertSession(sid, userId, days = 30) {
  ensure();
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const hasAccountUserId = await tableHasColumn('sessions', 'account_user_id');
  const row = {
    sid,
    user_id: String(userId),
    last_seen: now,
    expires_at: expires,
    revoked: false,
    ...(hasAccountUserId ? { account_user_id: String(userId) } : {})
  };
  const { error } = await supabase.from('sessions').upsert(row);
  if (error) throw error;
}

export async function getSessionUserId(sid) {
  ensure();
  if (!sid) return null;
  
  // PostgREST 스키마 캐시 문제를 우회하기 위해 직접 PostgreSQL 연결 사용
  try {
    const nowIso = new Date().toISOString();
    let result = null;
    
    await withPgClient(async (pg) => {
      const res = await pg.query(
        `SELECT user_id, revoked, expires_at FROM sessions WHERE sid = $1`,
        [sid]
      );
      if (res.rows.length > 0) {
        const row = res.rows[0];
        
        if (row.revoked) {
          return;
        }
        if (row.expires_at && row.expires_at < nowIso) {
          return;
        }
        result = row.user_id ? String(row.user_id) : null;
      }
    });
    return result;
  } catch (error) {
    console.error('[getSessionUserId] Error:', error.message);
    return null;
  }
}

export async function initDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.warn('[Supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing. Database features will be disabled.');
    return;
  }
  supabase = createClient(url, key, {
    auth: { persistSession: false }
  });
  // Optionally bootstrap schema if direct DB URL is provided
  if (process.env.SUPABASE_DB_URL) {
    try {
      // Pre-create tokens early so OAuth callback doesn't fail on first write
      await ensureTokensTableExists();
      await ensureSchema();
    } catch (e) {
      console.warn('[Supabase] ensureSchema failed:', e?.message || e);
    }
  }
}

function ensure() {
  if (!supabase) throw new Error('Supabase client not initialized. Call initDb() and set SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY.');
}

// 마이그레이션 실행 함수
export async function runMigrations() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.warn('[Migration] SUPABASE_DB_URL not available, skipping migrations');
    return;
  }

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    console.log('[Migration] Starting database migrations...');

    // 마이그레이션 파일들을 순서대로 실행
    const migrationFiles = [
      '001_add_channel_id_columns.sql',
      '002_create_channel_tokens_table.sql',
      '003_performance_optimization_indexes.sql',
      '004_stable_viewer_tokens_and_runtime_state.sql',
      '005_multi_platform_accounts.sql'
    ];

    for (const fileName of migrationFiles) {
      const filePath = path.join(process.cwd(), 'server', 'migrations', fileName);
      
      if (fs.existsSync(filePath)) {
        console.log(`[Migration] Executing ${fileName}...`);
        const sql = fs.readFileSync(filePath, 'utf8');
        
        try {
          await client.query(sql);
          console.log(`[Migration] Successfully executed ${fileName}`);
        } catch (error) {
          console.error(`[Migration] Failed to execute ${fileName}:`, error.message);
          // 일부 마이그레이션은 이미 실행되었을 수 있으므로 계속 진행
        }
      } else {
        console.warn(`[Migration] Migration file not found: ${fileName}`);
      }
    }

    console.log('[Migration] Database migrations completed');

  } catch (error) {
    console.error('[Migration] Migration execution failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// 채널 ID 데이터 마이그레이션 함수
export async function migrateChannelIdData() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.warn('[Migration] SUPABASE_DB_URL not available, skipping channel ID migration');
    return;
  }
  
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  
  try {
    console.log('[Migration] Starting channel ID data migration...');
    
    // sessions 테이블 마이그레이션: user_id를 channel_id로 복사
    const sessionsResult = await client.query(`
      UPDATE sessions 
      SET channel_id = user_id 
      WHERE channel_id IS NULL AND user_id IS NOT NULL
    `);
    console.log(`[Migration] Updated ${sessionsResult.rowCount} sessions with channel_id`);
    
    // roulette_sessions 테이블 마이그레이션: sid를 channel_id로 복사 (임시)
    const rouletteResult = await client.query(`
      UPDATE roulette_sessions 
      SET channel_id = sid 
      WHERE channel_id IS NULL AND sid IS NOT NULL
    `);
    console.log(`[Migration] Updated ${rouletteResult.rowCount} roulette_sessions with channel_id`);
    
    // 데이터 무결성 검증
    const integrityCheck = await client.query(`
      SELECT 
        'sessions' as table_name,
        COUNT(*) as total_rows,
        COUNT(channel_id) as rows_with_channel_id,
        COUNT(*) - COUNT(channel_id) as rows_missing_channel_id
      FROM sessions
      UNION ALL
      SELECT 
        'roulette_sessions' as table_name,
        COUNT(*) as total_rows,
        COUNT(channel_id) as rows_with_channel_id,
        COUNT(*) - COUNT(channel_id) as rows_missing_channel_id
      FROM roulette_sessions
    `);
    
    console.log('[Migration] Data integrity check:', integrityCheck.rows);
    
    // 마이그레이션 로그 기록
    await client.query(`
      INSERT INTO migration_log (migration_name, status, details) 
      VALUES ($1, $2, $3)
    `, [
      'channel_id_data_migration',
      'success',
      JSON.stringify({
        sessions_updated: sessionsResult.rowCount,
        roulette_sessions_updated: rouletteResult.rowCount,
        integrity_check: integrityCheck.rows
      })
    ]);
    
    console.log('[Migration] Channel ID data migration completed successfully');
    
  } catch (error) {
    console.error('[Migration] Channel ID data migration failed:', error);
    
    // 실패 로그 기록
    try {
      await client.query(`
        INSERT INTO migration_log (migration_name, status, details) 
        VALUES ($1, $2, $3)
      `, [
        'channel_id_data_migration',
        'failed',
        JSON.stringify({ error: error.message })
      ]);
    } catch (logError) {
      console.error('[Migration] Failed to log migration error:', logError);
    }
    
    throw error;
  } finally {
    await client.end();
  }
}

// =============================
// 채널 토큰 관리 함수들 (Supabase)
// =============================

// 채널 토큰 생성
export async function generateChannelTokenSupabase(channelId, tokenType, sid, expiresHours = null) {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    throw new Error('SUPABASE_DB_URL is required for token generation');
  }
  
  return withPgClient(async (pg) => {
    const result = await pg.query(
      'SELECT generate_channel_token($1, $2, $3, $4) as token',
      [channelId, tokenType, sid, expiresHours]
    );
    
    return result.rows[0].token;
  });
}

// 채널 토큰 검증
export async function validateChannelTokenSupabase(tokenValue, expectedChannelId = null) {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    throw new Error('SUPABASE_DB_URL is required for token validation');
  }
  
  return withPgClient(async (pg) => {
    const result = await pg.query(
      'SELECT validate_channel_token($1, $2) as result',
      [tokenValue, expectedChannelId]
    );
    
    return result.rows[0].result;
  });
}

// 채널의 활성 토큰 조회
export async function getActiveChannelTokensSupabase(channelId, tokenType = null) {
  ensure();
  
  let query = supabase
    .from('channel_tokens')
    .select('*')
    .eq('channel_id', channelId)
    .eq('active', true)
    .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
    .order('created_at', { ascending: false });
  
  if (tokenType) {
    query = query.eq('token_type', tokenType);
  }
  
  const { data, error } = await query;
  
  if (error) throw error;
  
  return data || [];
}

// 토큰 비활성화
export async function deactivateChannelTokenSupabase(tokenValue) {
  ensure();
  
  const { error } = await supabase
    .from('channel_tokens')
    .update({ active: false })
    .eq('token_value', tokenValue);
  
  if (error) throw error;
  
  return true;
}

// 채널의 모든 토큰 비활성화
export async function deactivateChannelTokensSupabase(channelId, tokenType = null) {
  ensure();
  
  let query = supabase
    .from('channel_tokens')
    .update({ active: false })
    .eq('channel_id', channelId);
  
  if (tokenType) {
    query = query.eq('token_type', tokenType);
  }
  
  const { error } = await query;
  
  if (error) throw error;
  
  return true;
}

function makeViewerToken(prefix) {
  return `${prefix}_${crypto.randomBytes(24).toString('base64url')}`;
}

export async function getOrCreateViewerTokenSupabase(channelId, tokenType, sid, prefix) {
  if (!channelId || !tokenType || !sid) return null;
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) return null;

  return withPgClient(async (pg) => {
    const existing = await pg.query(
      `select token_value
         from channel_tokens
        where channel_id = $1
          and token_type = $2
          and sid = $3
          and active = true
          and (expires_at is null or expires_at > now())
        order by created_at desc
        limit 1`,
      [String(channelId), String(tokenType), String(sid)]
    );
    if (existing.rows[0]?.token_value) return String(existing.rows[0].token_value);

    const token = makeViewerToken(prefix);
    await pg.query(
      `insert into channel_tokens (channel_id, token_type, token_value, sid, active, metadata)
       values ($1, $2, $3, $4, true, $5::jsonb)`,
      [String(channelId), String(tokenType), token, String(sid), JSON.stringify({ source: 'next-migration' })]
    );
    return token;
  });
}

// ---------------- Prediction Betting ----------------
function makeId(prefix = 'pred') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

function safeJsonParse(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function normalizePredictionOptions(options) {
  const source = Array.isArray(options) ? options : [];
  return source
    .map((option, index) => {
      if (typeof option === 'string') {
        return { id: String(index + 1), label: option.trim() };
      }
      const label = String(option?.label || option?.name || '').trim();
      const id = String(option?.id || index + 1).trim();
      return { id, label };
    })
    .filter((option) => option.id && option.label)
}

function normalizePredictionRow(row, bets = []) {
  if (!row) return null;
  const options = normalizePredictionOptions(safeJsonParse(row.options, []));
  const totals = new Map(options.map((option) => [option.id, 0]));
  const counts = new Map(options.map((option) => [option.id, 0]));
  const participants = new Set();
  let totalPoints = 0;

  for (const bet of Array.isArray(bets) ? bets : []) {
    const optionId = String(bet.option_id || '');
    const amount = Math.max(0, Number(bet.amount || 0));
    participants.add(String(bet.user_id || ''));
    totalPoints += amount;
    totals.set(optionId, (totals.get(optionId) || 0) + amount);
    counts.set(optionId, (counts.get(optionId) || 0) + 1);
  }

  return {
    id: row.id,
    sid: row.sid,
    channelUid: row.channel_uid,
    question: row.question,
    status: row.status,
    command: row.command || '!투표',
    minBet: Number(row.min_bet || 1),
    maxBet: Number(row.max_bet || 100000),
    options: options.map((option) => ({
      ...option,
      total: totals.get(option.id) || 0,
      count: counts.get(option.id) || 0,
      percentage: totalPoints > 0 ? Math.round(((totals.get(option.id) || 0) / totalPoints) * 1000) / 10 : 0,
      payoutMultiplier: totalPoints > 0 && (totals.get(option.id) || 0) > 0
        ? Math.round((totalPoints / (totals.get(option.id) || 1)) * 100) / 100
        : null,
      payoutPer100: totalPoints > 0 && (totals.get(option.id) || 0) > 0
        ? Math.floor((100 * totalPoints) / (totals.get(option.id) || 1))
        : null,
    })),
    winningOptionId: row.winning_option_id || null,
    settlementNote: row.settlement_note || null,
    totalPoints,
    participantCount: participants.size,
    createdAt: row.created_at,
    closesAt: row.closes_at,
    lockedAt: row.locked_at,
    settledAt: row.settled_at,
    bets: bets.map((bet) => ({
      id: bet.id,
      userId: bet.user_id,
      username: bet.username,
      optionId: bet.option_id,
      amount: Number(bet.amount || 0),
      payout: Number(bet.payout || 0),
      refunded: !!bet.refunded,
      createdAt: bet.created_at,
      updatedAt: bet.updated_at,
    })),
  };
}

function parsePredictionBetAmount(rawAmount, { have = 0, maxBet = 100000 } = {}) {
  const raw = String(rawAmount ?? '').trim().toLowerCase().replace(/,/g, '');
  if (!raw) return NaN;
  if (['all', 'allin', 'all-in', 'max', '풀', '올인', '전부', '전체'].includes(raw)) {
    return Math.max(0, Math.min(Number(have || 0), Number(maxBet || have || 0)));
  }
  const compact = raw.replace(/\s+/g, '');
  const match = compact.match(/^(\d+(?:\.\d+)?)(만|천|k|m|p|포인트)?$/i);
  if (!match) return NaN;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return NaN;
  const unit = String(match[2] || '').toLowerCase();
  const multiplier =
    unit === '만' ? 10000 :
      unit === '천' || unit === 'k' ? 1000 :
        unit === 'm' ? 1000000 :
          1;
  return Math.floor(base * multiplier);
}

export async function ensurePredictionTables() {
  await withPgClient(async (pg) => {
    await pg.query(`
      create table if not exists prediction_events (
        id text primary key,
        sid text not null,
        channel_uid text not null,
        question text not null,
        status text not null default 'open' check (status in ('open', 'locked', 'settled', 'cancelled')),
        command text not null default '!투표',
        options jsonb not null default '[]'::jsonb,
        min_bet integer not null default 1,
        max_bet integer not null default 100000,
        winning_option_id text,
        settlement_note text,
        created_at timestamptz not null default now(),
        closes_at timestamptz,
        locked_at timestamptz,
        settled_at timestamptz
      );
    `);
    await pg.query(`alter table prediction_events alter column command set default '!투표';`);
    await pg.query(`
      create table if not exists prediction_bets (
        id text primary key,
        prediction_id text not null references prediction_events(id) on delete cascade,
        channel_uid text not null,
        user_id text not null,
        username text,
        option_id text not null,
        amount integer not null check (amount > 0),
        payout integer not null default 0,
        refunded boolean not null default false,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (prediction_id, user_id)
      );
    `);
    await pg.query(`create index if not exists idx_prediction_events_sid_created on prediction_events (sid, created_at desc);`);
    await pg.query(`create index if not exists idx_prediction_events_channel_status on prediction_events (channel_uid, status, created_at desc);`);
    await pg.query(`create index if not exists idx_prediction_bets_prediction_amount on prediction_bets (prediction_id, amount desc);`);
    await pg.query(`create index if not exists idx_prediction_bets_user on prediction_bets (prediction_id, user_id);`);
  });
}

async function fetchPredictionWithBets(pg, id) {
  const prediction = await pg.query(`select * from prediction_events where id = $1`, [String(id)]);
  const row = prediction.rows?.[0] || null;
  if (!row) return null;
  const bets = await pg.query(`select * from prediction_bets where prediction_id = $1 order by amount desc, updated_at asc`, [String(id)]);
  return normalizePredictionRow(row, bets.rows || []);
}

export async function listPredictionsForSid(sid, limit = 20) {
  await ensurePredictionTables();
  return withPgClient(async (pg) => {
    const result = await pg.query(
      `select * from prediction_events where sid = $1 order by created_at desc limit $2`,
      [String(sid), Math.max(1, Math.min(100, Number(limit || 20)))]
    );
    const rows = result.rows || [];
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const bets = await pg.query(`select * from prediction_bets where prediction_id = any($1::text[])`, [ids]);
    const grouped = new Map();
    for (const bet of bets.rows || []) {
      const key = String(bet.prediction_id);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(bet);
    }
    return rows.map((row) => normalizePredictionRow(row, grouped.get(String(row.id)) || []));
  });
}

export async function getPredictionForSid(sid, predictionId) {
  await ensurePredictionTables();
  return withPgClient(async (pg) => {
    const result = await pg.query(`select * from prediction_events where id = $1 and sid = $2`, [String(predictionId), String(sid)]);
    if (!result.rows?.[0]) return null;
    const bets = await pg.query(`select * from prediction_bets where prediction_id = $1 order by amount desc, updated_at asc`, [String(predictionId)]);
    return normalizePredictionRow(result.rows[0], bets.rows || []);
  });
}

export async function getActivePredictionForChannel(channelUid) {
  await ensurePredictionTables();
  return withPgClient(async (pg) => {
    const result = await pg.query(
      `select * from prediction_events
       where channel_uid = $1
         and status in ('open', 'locked')
       order by created_at desc
       limit 1`,
      [String(channelUid)]
    );
    let row = result.rows?.[0] || null;
    if (!row) return null;
    if (row.status === 'open' && row.closes_at && new Date(row.closes_at).getTime() <= Date.now()) {
      const locked = await pg.query(
        `update prediction_events
         set status = 'locked', locked_at = coalesce(locked_at, now())
         where id = $1 and status = 'open'
         returning *`,
        [row.id]
      );
      row = locked.rows?.[0] || row;
    }
    const bets = await pg.query(`select * from prediction_bets where prediction_id = $1 order by amount desc, updated_at asc`, [row.id]);
    return normalizePredictionRow(row, bets.rows || []);
  });
}

export async function createPrediction({ sid, channelUid, question, options, minBet = 1, maxBet = 100000, closesAt = null }) {
  await ensurePredictionTables();
  const normalizedOptions = normalizePredictionOptions(options);
  if (!sid || !channelUid) throw new Error('sid and channelUid are required');
  if (!String(question || '').trim()) throw new Error('question is required');
  if (normalizedOptions.length < 2) throw new Error('at least two options are required');
  const id = makeId('prediction');
  return withPgClient(async (pg) => {
    await pg.query(
      `update prediction_events set status = 'locked', locked_at = coalesce(locked_at, now())
       where sid = $1 and status = 'open'`,
      [String(sid)]
    );
    await pg.query(
      `insert into prediction_events (id, sid, channel_uid, question, options, min_bet, max_bet, closes_at)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [
        id,
        String(sid),
        String(channelUid),
        String(question).trim(),
        JSON.stringify(normalizedOptions),
        Math.max(1, Number(minBet || 1)),
        Math.max(Math.max(1, Number(minBet || 1)), Number(maxBet || 100000)),
        closesAt ? new Date(closesAt).toISOString() : null,
      ]
    );
    return fetchPredictionWithBets(pg, id);
  });
}

export async function lockPredictionForSid(sid, predictionId) {
  await ensurePredictionTables();
  return withPgClient(async (pg) => {
    await pg.query(
      `update prediction_events set status = 'locked', locked_at = coalesce(locked_at, now())
       where id = $1 and sid = $2 and status = 'open'`,
      [String(predictionId), String(sid)]
    );
    return fetchPredictionWithBets(pg, predictionId);
  });
}

export async function cancelPredictionForSid(sid, predictionId) {
  await ensurePredictionTables();
  return withPgClient(async (pg) => {
    const prediction = await pg.query(
      `select * from prediction_events where id = $1 and sid = $2 for update`,
      [String(predictionId), String(sid)]
    );
    const row = prediction.rows?.[0] || null;
    if (!row) return null;
    if (row.status === 'settled' || row.status === 'cancelled') return fetchPredictionWithBets(pg, predictionId);
    const table = await ensureChannelPointsTable(row.channel_uid);
    const bets = await pg.query(`select * from prediction_bets where prediction_id = $1 and refunded = false`, [row.id]);
    for (const bet of bets.rows || []) {
      await pg.query(
        `insert into ${table} (user_id, username, points) values ($1, $2, $3)
         on conflict (user_id) do update set
           username = coalesce(excluded.username, ${table}.username),
           points = ${table}.points + excluded.points`,
        [String(bet.user_id), bet.username ? String(bet.username) : null, Number(bet.amount || 0)]
      );
    }
    await pg.query(`update prediction_bets set refunded = true, updated_at = now() where prediction_id = $1`, [row.id]);
    await pg.query(
      `update prediction_events set status = 'cancelled', settlement_note = $3, settled_at = now()
       where id = $1 and sid = $2`,
      [row.id, String(sid), 'cancelled_refunded']
    );
    return fetchPredictionWithBets(pg, predictionId);
  });
}

export async function settlePredictionForSid(sid, predictionId, winningOptionId) {
  await ensurePredictionTables();
  return withPgClient(async (pg) => {
    const prediction = await pg.query(
      `select * from prediction_events where id = $1 and sid = $2 for update`,
      [String(predictionId), String(sid)]
    );
    const row = prediction.rows?.[0] || null;
    if (!row) return null;
    if (row.status === 'settled' || row.status === 'cancelled') return fetchPredictionWithBets(pg, predictionId);

    const options = normalizePredictionOptions(row.options);
    const winning = options.find((option) => option.id === String(winningOptionId));
    if (!winning) throw new Error('invalid winning option');

    const table = await ensureChannelPointsTable(row.channel_uid);
    const bets = await pg.query(`select * from prediction_bets where prediction_id = $1 order by created_at asc`, [row.id]);
    const allBets = bets.rows || [];
    const total = allBets.reduce((sum, bet) => sum + Math.max(0, Number(bet.amount || 0)), 0);
    const winners = allBets.filter((bet) => String(bet.option_id) === winning.id);
    const winnerTotal = winners.reduce((sum, bet) => sum + Math.max(0, Number(bet.amount || 0)), 0);

    if (total <= 0 || winnerTotal <= 0) {
      for (const bet of allBets) {
        await pg.query(
          `insert into ${table} (user_id, username, points) values ($1, $2, $3)
           on conflict (user_id) do update set
             username = coalesce(excluded.username, ${table}.username),
             points = ${table}.points + excluded.points`,
          [String(bet.user_id), bet.username ? String(bet.username) : null, Number(bet.amount || 0)]
        );
      }
      await pg.query(`update prediction_bets set refunded = true, updated_at = now() where prediction_id = $1`, [row.id]);
      await pg.query(
        `update prediction_events
         set status = 'settled', winning_option_id = $3, settlement_note = 'no_winner_refunded', settled_at = now()
         where id = $1 and sid = $2`,
        [row.id, String(sid), winning.id]
      );
      return fetchPredictionWithBets(pg, predictionId);
    }

    for (const bet of winners) {
      const payout = Math.max(1, Math.floor((Number(bet.amount || 0) * total) / winnerTotal));
      await pg.query(
        `insert into ${table} (user_id, username, points) values ($1, $2, $3)
         on conflict (user_id) do update set
           username = coalesce(excluded.username, ${table}.username),
           points = ${table}.points + excluded.points`,
        [String(bet.user_id), bet.username ? String(bet.username) : null, payout]
      );
      await pg.query(`update prediction_bets set payout = $2, updated_at = now() where id = $1`, [bet.id, payout]);
    }
    await pg.query(
      `update prediction_events
       set status = 'settled', winning_option_id = $3, settlement_note = 'pari_mutuel', settled_at = now()
       where id = $1 and sid = $2`,
      [row.id, String(sid), winning.id]
    );
    return fetchPredictionWithBets(pg, predictionId);
  });
}

export async function placePredictionBet({ channelUid, userId, username, optionToken, amount }) {
  await ensurePredictionTables();
  if (!channelUid || !userId) throw new Error('channelUid and userId are required');

  return withPgClient(async (pg) => {
    await pg.query('begin');
    try {
      const prediction = await pg.query(
        `select * from prediction_events
         where channel_uid = $1
           and status = 'open'
           and (closes_at is null or closes_at > now())
         order by created_at desc
         limit 1
         for update`,
        [String(channelUid)]
      );
      const row = prediction.rows?.[0] || null;
      if (!row) throw new Error('no_open_prediction');

      const options = normalizePredictionOptions(row.options);
      const token = String(optionToken || '').trim().toLowerCase();
      const matched = options.find((option, index) => {
        return (
          option.id.toLowerCase() === token ||
          String(index + 1) === token ||
          option.label.toLowerCase() === token
        );
      });
      if (!matched) throw new Error('invalid_option');

      const pointsTable = await ensureChannelPointsTable(channelUid);
      const points = await pg.query(`select points from ${pointsTable} where user_id = $1 for update`, [String(userId)]);
      const have = Number(points.rows?.[0]?.points || 0);
      const normalizedAmount = parsePredictionBetAmount(amount, { have, maxBet: Number(row.max_bet || 100000) });
      if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) throw new Error('invalid amount');
      if (normalizedAmount < Number(row.min_bet || 1)) throw new Error('below_min_bet');
      if (normalizedAmount > Number(row.max_bet || 100000)) throw new Error('above_max_bet');
      if (have < normalizedAmount) {
        const err = new Error('insufficient_points');
        err.have = have;
        err.need = normalizedAmount;
        throw err;
      }

      const existing = await pg.query(
        `select * from prediction_bets where prediction_id = $1 and user_id = $2 for update`,
        [row.id, String(userId)]
      );
      const existingBet = existing.rows?.[0] || null;
      if (existingBet && String(existingBet.option_id) !== matched.id) throw new Error('option_change_not_allowed');

      await pg.query(
        `update ${pointsTable} set points = points - $2, username = coalesce($3, username) where user_id = $1`,
        [String(userId), normalizedAmount, username ? String(username) : null]
      );

      if (existingBet) {
        await pg.query(
          `update prediction_bets set amount = amount + $3, username = coalesce($4, username), updated_at = now()
           where prediction_id = $1 and user_id = $2`,
          [row.id, String(userId), normalizedAmount, username ? String(username) : null]
        );
      } else {
        await pg.query(
          `insert into prediction_bets (id, prediction_id, channel_uid, user_id, username, option_id, amount)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [makeId('bet'), row.id, String(channelUid), String(userId), username ? String(username) : null, matched.id, normalizedAmount]
        );
      }
      await pg.query('commit');
      return fetchPredictionWithBets(pg, row.id);
    } catch (error) {
      try { await pg.query('rollback'); } catch {}
      throw error;
    }
  });
}

export async function rotateViewerTokenSupabase(channelId, tokenType, sid, prefix) {
  if (!channelId || !tokenType || !sid) return null;
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) return null;

  return withPgClient(async (pg) => {
    await pg.query(
      `update channel_tokens
          set active = false
        where channel_id = $1
          and token_type = $2
          and sid = $3
          and active = true`,
      [String(channelId), String(tokenType), String(sid)]
    );
    const token = makeViewerToken(prefix);
    await pg.query(
      `insert into channel_tokens (channel_id, token_type, token_value, sid, active, metadata)
       values ($1, $2, $3, $4, true, $5::jsonb)`,
      [String(channelId), String(tokenType), token, String(sid), JSON.stringify({ source: 'next-migration', rotated: true })]
    );
    return token;
  });
}

export async function findSidByChannelViewerTokenSupabase(tokenValue, tokenType) {
  if (!tokenValue || !tokenType) return null;
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) return null;

  return withPgClient(async (pg) => {
    const result = await pg.query(
      `update channel_tokens
          set last_used = now(),
              usage_count = coalesce(usage_count, 0) + 1
        where token_value = $1
          and token_type = $2
          and active = true
          and (expires_at is null or expires_at > now())
        returning sid`,
      [String(tokenValue), String(tokenType)]
    );
    return result.rows[0]?.sid ? String(result.rows[0].sid) : null;
  });
}

// 만료된 토큰 정리
export async function cleanupExpiredTokensSupabase() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.warn('[Token Cleanup] SUPABASE_DB_URL not available, skipping cleanup');
    return { deactivated: 0, deleted: 0 };
  }
  
  return withPgClient(async (pg) => {
    const result = await pg.query('SELECT cleanup_expired_tokens() as count');
    
    return {
      deactivated: result.rows[0].count,
      deleted: 0 // 함수에서 삭제도 처리하지만 별도 카운트는 없음
    };
  });
}

// 채널 토큰 통계
export async function getChannelTokenStatsSupabase(channelId = null) {
  ensure();
  
  let query = supabase
    .from('channel_token_stats')
    .select('*');
  
  if (channelId) {
    query = query.eq('channel_id', channelId);
  }
  
  const { data, error } = await query;
  
  if (error) throw error;
  
  return data || [];
}

// =============================
// 성능 모니터링 및 최적화 함수들 (Supabase)
// =============================

// 채널 성능 통계 조회
export async function getChannelPerformanceStatsSupabase(channelId = null) {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    throw new Error('SUPABASE_DB_URL is required for performance stats');
  }
  
  return withPgClient(async (pg) => {
    let query = `
      SELECT 
        s.channel_id,
        COUNT(DISTINCT s.sid) as active_sessions,
        COUNT(DISTINCT rs.token) as roulette_sessions_today,
        COUNT(DISTINCT ct.token_value) as active_tokens,
        AVG(ct.usage_count) as avg_token_usage,
        MAX(s.last_seen) as last_activity
      FROM sessions s
      LEFT JOIN roulette_sessions rs ON s.channel_id = rs.channel_id 
        AND rs.created_at > NOW() - INTERVAL '1 day'
      LEFT JOIN channel_tokens ct ON s.channel_id = ct.channel_id 
        AND ct.active = TRUE
      WHERE s.revoked = FALSE 
        AND (s.expires_at IS NULL OR s.expires_at > NOW())
        AND s.channel_id IS NOT NULL
    `;
    const params = [];
    
    if (channelId) {
      query += ' AND s.channel_id = $1';
      params.push(channelId);
    }
    
    query += ' GROUP BY s.channel_id ORDER BY active_sessions DESC';
    
    const result = await pg.query(query, params);
    
    return result.rows.map(row => ({
      channelId: row.channel_id,
      activeSessions: parseInt(row.active_sessions),
      rouletteSessionsToday: parseInt(row.roulette_sessions_today),
      activeTokens: parseInt(row.active_tokens),
      avgTokenUsage: Math.round((parseFloat(row.avg_token_usage) || 0) * 100) / 100,
      lastActivity: row.last_activity
    }));
  });
}

// 쿼리 성능 분석
export async function analyzeQueryPerformanceSupabase() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    throw new Error('SUPABASE_DB_URL is required for query analysis');
  }
  
  try {
    return await withPgClient(async (pg) => {
      const result = await pg.query('SELECT * FROM analyze_channel_query_performance()');

      return result.rows.map(row => ({
        tableName: row.table_name,
        indexName: row.index_name,
        indexUsageCount: parseInt(row.index_usage_count),
        tableSize: row.table_size,
        indexSize: row.index_size
      }));
    });
  } catch (error) {
    if (isUndefinedDbFunctionError(error, 'analyze_channel_query_performance')) {
      console.warn('[Performance Monitor] analyze_channel_query_performance() is not installed; skipping query analysis');
      return [];
    }
    throw error;
  }
}

// 인덱스 사용률 모니터링
export async function monitorIndexUsageSupabase() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    throw new Error('SUPABASE_DB_URL is required for index monitoring');
  }
  
  try {
    return await withPgClient(async (pg) => {
      const result = await pg.query('SELECT * FROM monitor_index_usage()');

      return result.rows.map(row => ({
        tableName: row.table_name,
        indexName: row.index_name,
        usageRatio: parseFloat(row.usage_ratio),
        recommendation: row.recommendation
      }));
    });
  } catch (error) {
    if (isUndefinedDbFunctionError(error, 'monitor_index_usage')) {
      console.warn('[Performance Monitor] monitor_index_usage() is not installed; skipping index monitoring');
      return [];
    }
    throw error;
  }
}

// 성능 최적화 권장사항
export async function getPerformanceRecommendationsSupabase() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    throw new Error('SUPABASE_DB_URL is required for performance recommendations');
  }
  
  try {
    return await withPgClient(async (pg) => {
      const result = await pg.query('SELECT * FROM get_performance_recommendations()');

      return result.rows.map(row => ({
        category: row.category,
        recommendation: row.recommendation,
        priority: row.priority,
        estimatedImpact: row.estimated_impact
      }));
    });
  } catch (error) {
    if (isUndefinedDbFunctionError(error, 'get_performance_recommendations')) {
      console.warn('[Performance Monitor] get_performance_recommendations() is not installed; skipping recommendations');
      return [];
    }
    throw error;
  }
}

// 데이터베이스 통계 업데이트
export async function updateChannelStatisticsSupabase() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.warn('[Statistics] SUPABASE_DB_URL not available, skipping statistics update');
    return false;
  }
  
  try {
    await withPgClient(async (pg) => {
      await pg.query('SELECT update_channel_statistics()');
    });
    
    console.log('[Statistics] Channel statistics updated successfully');
    return true;
    
  } catch (error) {
    if (isUndefinedDbFunctionError(error, 'update_channel_statistics')) {
      console.warn('[Statistics] update_channel_statistics() is not installed; skipping statistics update');
      return false;
    }
    console.error('[Statistics] Failed to update statistics:', error);
    return false;
  }
}

// 성능 모니터링 스케줄러 시작 (Supabase)
export async function startPerformanceMonitoringSchedulerSupabase() {
  // 6시간마다 성능 분석 실행
  const monitoringInterval = 6 * 60 * 60 * 1000; // 6시간
  
  const monitor = async () => {
    try {
      const stats = await getChannelPerformanceStatsSupabase();
      const indexUsage = await monitorIndexUsageSupabase();
      const recommendations = await getPerformanceRecommendationsSupabase();
      
      console.log(`[Performance Monitor] Active channels: ${stats.length}`);
      
      // 성능 이슈 감지
      const highUsageChannels = stats.filter(s => s.activeSessions > 10 || s.activeTokens > 50);
      if (highUsageChannels.length > 0) {
        console.log(`[Performance Monitor] High usage channels detected: ${highUsageChannels.length}`);
      }
      
      // 사용률이 낮은 인덱스 감지
      const lowUsageIndexes = indexUsage.filter(idx => idx.usageRatio < 10);
      if (lowUsageIndexes.length > 0) {
        console.log(`[Performance Monitor] Low usage indexes detected: ${lowUsageIndexes.length}`);
      }
      
      // 높은 우선순위 권장사항 확인
      const highPriorityRecs = recommendations.filter(r => r.priority === 'High');
      if (highPriorityRecs.length > 0) {
        console.log(`[Performance Monitor] High priority recommendations: ${highPriorityRecs.length}`);
      }
      
      // 통계 업데이트
      await updateChannelStatisticsSupabase();
      
    } catch (error) {
      console.error('[Performance Monitor] Monitoring failed:', error);
    }
  };
  
  // 즉시 한 번 실행
  await monitor();
  
  // 주기적 실행
  const intervalId = setInterval(monitor, monitoringInterval);
  
  console.log('[Performance Monitor] Supabase performance monitoring scheduler started (interval: 6 hours)');
  
  return intervalId;
}

// 데이터 무결성 검증 함수
export async function verifyChannelIdIntegrity() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.warn('[Verification] SUPABASE_DB_URL not available, skipping integrity check');
    return null;
  }
  
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  
  try {
    const result = await client.query(`
      SELECT 
        'sessions' as table_name,
        COUNT(*) as total_rows,
        COUNT(channel_id) as rows_with_channel_id,
        COUNT(*) - COUNT(channel_id) as rows_missing_channel_id
      FROM sessions
      UNION ALL
      SELECT 
        'roulette_sessions' as table_name,
        COUNT(*) as total_rows,
        COUNT(channel_id) as rows_with_channel_id,
        COUNT(*) - COUNT(channel_id) as rows_missing_channel_id
      FROM roulette_sessions
    `);
    
    return result.rows;
  } catch (error) {
    console.error('[Verification] Channel ID integrity check failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

export async function ensureSchema() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) return; // optional
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const sql = `
      create table if not exists tokens (
        sid text primary key
      );

      -- Ensure snake_case columns exist
      alter table tokens add column if not exists access_token text;
      alter table tokens add column if not exists refresh_token text;
      alter table tokens add column if not exists token_type text;
      alter table tokens add column if not exists expires_at text;

      -- Backfill from possible legacy camelCase columns (if they exist)
      do $$
      begin
        if exists (select 1 from information_schema.columns where table_name='tokens' and column_name='accesstoken') then
          update tokens set access_token = coalesce(access_token, accesstoken);
        end if;
        if exists (select 1 from information_schema.columns where table_name='tokens' and column_name='refreshtoken') then
          update tokens set refresh_token = coalesce(refresh_token, refreshtoken);
        end if;
        if exists (select 1 from information_schema.columns where table_name='tokens' and column_name='tokentype') then
          update tokens set token_type = coalesce(token_type, tokentype);
        end if;
        if exists (select 1 from information_schema.columns where table_name='tokens' and column_name='expiresat') then
          update tokens set expires_at = coalesce(expires_at, expiresat);
        end if;
      end $$;

      create table if not exists bot_settings (
        sid text primary key,
        settings jsonb
      );

      create table if not exists bot_stats (
        sid text primary key
      );
      alter table bot_stats add column if not exists messages_processed integer default 0;
      alter table bot_stats add column if not exists commands_handled integer default 0;
      alter table bot_stats add column if not exists last_active text;
      -- Backfill from legacy camelCase (if any)
      do $$ begin
        if exists (select 1 from information_schema.columns where table_name='bot_stats' and column_name='messagesprocessed') then
          update bot_stats set messages_processed = coalesce(messages_processed, messagesprocessed);
        end if;
        if exists (select 1 from information_schema.columns where table_name='bot_stats' and column_name='commandshandled') then
          update bot_stats set commands_handled = coalesce(commands_handled, commandshandled);
        end if;
        if exists (select 1 from information_schema.columns where table_name='bot_stats' and column_name='lastactive') then
          update bot_stats set last_active = coalesce(last_active, lastactive);
        end if;
      end $$;

      create table if not exists bot_rules (
        sid text not null,
        id text not null,
        name text,
        keywords jsonb default '[]'::jsonb,
        responses jsonb default '[]'::jsonb,
        enabled boolean default true,
        primary key (sid, id)
      );
      -- Ensure types and indexes for upsert compatibility
      do $$ begin
        -- Force keywords/responses to jsonb if they pre-exist as text
        begin
          alter table bot_rules alter column keywords type jsonb using coalesce(keywords::jsonb, '[]'::jsonb);
        exception when others then null; end;
        begin
          alter table bot_rules alter column responses type jsonb using coalesce(responses::jsonb, '[]'::jsonb);
        exception when others then null; end;
      end $$;
      do $$ begin
        if not exists (
          select 1 from pg_indexes where schemaname='public' and indexname='bot_rules_sid_id_idx'
        ) then
          create unique index bot_rules_sid_id_idx on bot_rules(sid, id);
        end if;
      end $$;
      -- Also ensure a named UNIQUE constraint if not present (some tools rely on constraints over indexes)
      do $$
      declare
        has_unique boolean;
      begin
        select exists (
          select 1
          from pg_constraint c
          join pg_class t on c.conrelid = t.oid
          where t.relname = 'bot_rules'
            and c.contype = 'u'
            and c.conkey is not null
        ) into has_unique;
        if not has_unique then
          alter table bot_rules add constraint bot_rules_sid_id_uniq unique (sid, id);
        end if;
      end $$;
      alter table bot_rules add column if not exists admin_only boolean default false;
      alter table bot_rules add column if not exists required_role_level integer default 1;
      alter table bot_rules add column if not exists points_cost integer default 0;
      alter table bot_rules add column if not exists cooldown integer default 1000;
      alter table bot_rules add column if not exists last_used bigint default 0;
      -- Backfill from legacy camelCase columns
      do $$ begin
        if exists (select 1 from information_schema.columns where table_name='bot_rules' and column_name='adminonly') then
          update bot_rules set admin_only = coalesce(admin_only, adminonly);
        end if;
        if exists (select 1 from information_schema.columns where table_name='bot_rules' and column_name='requiredrolelevel') then
          update bot_rules set required_role_level = coalesce(required_role_level, requiredrolelevel);
        end if;
        if exists (select 1 from information_schema.columns where table_name='bot_rules' and column_name='lastused') then
          update bot_rules set last_used = coalesce(last_used, lastused);
        end if;
      end $$;

      create table if not exists live_days (
        sid text not null,
        date text not null,
        primary key (sid, date)
      );

      create table if not exists attendance (
        sid text not null,
        date text not null,
        username text,
        -- legacy installs might miss user_id, so don't include in PK until ensured below
        primary key (sid, date, username)
      );
      -- ensure user_id column exists
      alter table attendance add column if not exists user_id text;
      -- if PK is not (sid,user_id,date), leave as-is (changing PK online is complex); uniqueness can be enforced by upsert logic
      -- Backfill from legacy camelCase
      do $$ begin
        if exists (select 1 from information_schema.columns where table_name='attendance' and column_name='userid') then
          update attendance set user_id = coalesce(user_id, userid);
        end if;
      end $$;
      -- ensure unique index for upsert conflict (snake_case)
      do $$ begin
        if not exists (
          select 1 from pg_indexes where schemaname = 'public' and indexname = 'attendance_sid_user_id_date_idx'
        ) then
          create unique index attendance_sid_user_id_date_idx on attendance(sid, user_id, date);
        end if;
      end $$;
      -- ensure unique index for legacy installs using userid (legacy)
      do $$ begin
        if exists (select 1 from information_schema.columns where table_name='attendance' and column_name='userid') then
          if not exists (
            select 1 from pg_indexes where schemaname = 'public' and indexname = 'attendance_sid_userid_date_idx'
          ) then
            create unique index attendance_sid_userid_date_idx on attendance(sid, userid, date);
          end if;
        end if;
      end $$;

      create table if not exists attendance_state (
        sid text not null,
        streak integer default 0
      );
      alter table attendance_state add column if not exists user_id text;
      alter table attendance_state add column if not exists last_date text;
      alter table attendance_state add column if not exists total_days integer default 0;
      -- add PK only if not exists
      do $$
      declare has_pk boolean;
      begin
        select exists (
          select 1 from pg_constraint c
          join pg_class t on c.conrelid = t.oid
          where t.relname = 'attendance_state' and c.contype='p'
        ) into has_pk;
        if not has_pk then
          begin
            alter table attendance_state add primary key (sid, user_id);
          exception when others then null; end;
        end if;
      end $$;
      -- Backfill from legacy camelCase
      do $$ begin
        if exists (select 1 from information_schema.columns where table_name='attendance_state' and column_name='userid') then
          update attendance_state set user_id = coalesce(user_id, userid);
        end if;
        if exists (select 1 from information_schema.columns where table_name='attendance_state' and column_name='lastdate') then
          update attendance_state set last_date = coalesce(last_date, lastdate);
        end if;
      end $$;
      -- ensure unique index on legacy keys for installs still using userid (legacy)
      do $$ begin
        if exists (select 1 from information_schema.columns where table_name='attendance_state' and column_name='userid') then
          if not exists (
            select 1 from pg_indexes where schemaname='public' and indexname='attendance_state_sid_userid_uniq'
          ) then
            create unique index attendance_state_sid_userid_uniq on attendance_state(sid, userid);
          end if;
        end if;
      end $$;

      -- Session mapping: random cookie sid -> userId
      create table if not exists sessions (
        sid text primary key,
        user_id text not null,
        created_at timestamptz default now(),
        last_seen timestamptz,
        expires_at timestamptz,
        revoked boolean default false
      );
      
      -- 멀티 방송 지원: 세션 테이블에 채널 관련 컬럼 추가
      alter table sessions add column if not exists channel_id text;
      alter table sessions add column if not exists isolation_level text default 'strict';
      alter table sessions add column if not exists connection_id text;

      -- Live sessions: 방송 세션 상태 관리 (다중 방송 환경 지원)
      create table if not exists live_sessions (
        sid text primary key,
        live boolean not null default false,
        start_date text,                    -- YYYY-MM-DD 형식 (KST)
        session_start_time bigint,          -- 방송 시작 타임스탬프
        last_update bigint not null,        -- 마지막 업데이트 타임스탬프
        created_at timestamptz default now()
      );

      -- 인덱스 생성 (성능 최적화)
      create index if not exists idx_live_sessions_live on live_sessions(live);
      create index if not exists idx_live_sessions_last_update on live_sessions(last_update);
      create index if not exists idx_live_sessions_live_date on live_sessions(live, start_date);
      create index if not exists idx_live_sessions_sid_live on live_sessions(sid, live);
      
      -- 추가 성능 최적화 인덱스
      create index if not exists idx_live_sessions_cleanup on live_sessions(last_update) where live = false;
      create index if not exists idx_live_sessions_active_by_update on live_sessions(last_update desc) where live = true;
      create index if not exists idx_attendance_sid_date on attendance(sid, date);
      create index if not exists idx_attendance_state_sid_user on attendance_state(sid, user_id);
      create index if not exists idx_bot_rules_sid_enabled on bot_rules(sid, enabled);
      create index if not exists idx_live_days_sid_date_desc on live_days(sid, date desc);
      
      -- 멀티 방송 지원: 채널 ID 관련 인덱스
      create index if not exists idx_sessions_channel_id on sessions(channel_id);
      create index if not exists idx_sessions_isolation on sessions(isolation_level);
      create index if not exists idx_sessions_connection_id on sessions(connection_id);
      create index if not exists idx_sessions_channel_isolation on sessions(channel_id, isolation_level);
      create index if not exists idx_roulette_sessions_channel_sid on roulette_sessions(channel_id, sid);

      -- Roulette sessions: 룰렛 실행 결과 저장
      create table if not exists roulette_sessions (
        id bigint generated always as identity primary key,
        sid text not null,
        token text not null,
        roulette_name text not null,
        user_id text,
        username text,
        result_label text,
        result_value numeric,
        created_at timestamptz default now()
      );
      
      -- 멀티 방송 지원: 룰렛 세션 테이블에 채널 ID 컬럼 추가
      alter table roulette_sessions add column if not exists channel_id text;
      
      create index if not exists roulette_sessions_sid_idx on roulette_sessions(sid);
      create index if not exists roulette_sessions_token_idx on roulette_sessions(token);
      create index if not exists roulette_sessions_created_idx on roulette_sessions(created_at desc);
      create index if not exists roulette_sessions_channel_id_idx on roulette_sessions(channel_id);
      
      -- 마이그레이션 로그 테이블
      create table if not exists migration_log (
        id bigint generated always as identity primary key,
        migration_name text not null,
        executed_at timestamptz default now(),
        status text not null, -- 'success', 'failed', 'rollback'
        details jsonb,
        execution_time_ms integer
      );
      create index if not exists idx_migration_log_name on migration_log(migration_name);
      create index if not exists idx_migration_log_status on migration_log(status);
      create index if not exists idx_migration_log_executed on migration_log(executed_at desc);
      
      -- 채널 토큰 관리 테이블
      create table if not exists channel_tokens (
        id bigint generated always as identity primary key,
        channel_id text not null,
        token_type text not null, -- 'roulette', 'pvd', 'api'
        token_value text not null unique,
        sid text not null,
        created_at timestamptz default now(),
        expires_at timestamptz,
        last_used timestamptz,
        active boolean default true,
        usage_count integer default 0,
        metadata jsonb default '{}'::jsonb
      );
      
      -- 채널 토큰 인덱스
      create index if not exists idx_channel_tokens_channel_type on channel_tokens(channel_id, token_type);
      create index if not exists idx_channel_tokens_value on channel_tokens(token_value);
      create index if not exists idx_channel_tokens_sid on channel_tokens(sid);
      create index if not exists idx_channel_tokens_active on channel_tokens(active) where active = true;
      create index if not exists idx_channel_tokens_expires on channel_tokens(expires_at) where expires_at is not null;
      create index if not exists idx_channel_tokens_last_used on channel_tokens(last_used desc);
      create index if not exists idx_channel_tokens_channel_active on channel_tokens(channel_id, active) where active = true;
      create index if not exists idx_channel_tokens_type_active on channel_tokens(token_type, active) where active = true;
      
      -- 토큰 타입 제약조건
      do $$ begin
        if not exists (
          select 1 from pg_constraint 
          where conname = 'chk_token_type' and conrelid = 'channel_tokens'::regclass
        ) then
          alter table channel_tokens add constraint chk_token_type 
            check (token_type in ('roulette', 'pvd', 'api'));
        end if;
      end $$;
      
      -- 토큰 값 길이 제약조건
      do $$ begin
        if not exists (
          select 1 from pg_constraint 
          where conname = 'chk_token_value_length' and conrelid = 'channel_tokens'::regclass
        ) then
          alter table channel_tokens add constraint chk_token_value_length 
            check (length(token_value) >= 8 and length(token_value) <= 255);
        end if;
      end $$;
      
      -- 성능 최적화 인덱스
      create index if not exists idx_sessions_channel_user_active on sessions(channel_id, user_id, expires_at) 
        where revoked = false;
      create index if not exists idx_roulette_sessions_channel_created on roulette_sessions(channel_id, created_at desc);
      create index if not exists idx_channel_tokens_channel_type_active on channel_tokens(channel_id, token_type, active) 
        where active = true;
      create index if not exists idx_sessions_active_by_channel on sessions(channel_id, last_seen desc, expires_at) 
        where revoked = false;
      create index if not exists idx_channel_tokens_unexpired on channel_tokens(channel_id, token_type, expires_at, created_at desc) 
        where active = true;
      create index if not exists idx_roulette_sessions_recent on roulette_sessions(channel_id, sid, created_at desc);
      create index if not exists idx_channel_tokens_usage_stats on channel_tokens(channel_id, token_type, usage_count desc, last_used desc) 
        where active = true;
      create index if not exists idx_roulette_sessions_stats on roulette_sessions(channel_id, roulette_name, created_at desc);
      create index if not exists idx_channel_tokens_cleanup on channel_tokens(expires_at, active) 
        where expires_at is not null;
      create index if not exists idx_sessions_cleanup on sessions(expires_at, revoked) 
        where expires_at is not null;

      -- API Keys 테이블 생성
      create table if not exists api_keys (
        api_key text primary key,
        owner_pid text not null,
        created_at timestamptz default now(),
        last_used timestamptz,
        revoked boolean default false
      );
      
      -- API Keys 인덱스
      create index if not exists idx_api_keys_owner_pid on api_keys(owner_pid);
      create index if not exists idx_api_keys_active on api_keys(owner_pid, revoked) where revoked = false;
    `;
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function tableHasColumn(table, column) {
  const key = `public.${table}`;
  const cached = columnCache.get(key);
  if (cached) return cached.has(column);
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    // Be conservative: assume column is NOT available to avoid PostgREST schema cache errors
    return false;
  }
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query(
      "select column_name from information_schema.columns where table_schema='public' and table_name=$1",
      [table]
    );
    const set = new Set(rows.map(r => r.column_name));
    columnCache.set(key, set);
    return set.has(column);
  } finally {
    await client.end();
  }
}


// Tokens
export async function upsertTokens(sid, { accessToken, refreshToken, tokenType, expiresAt }) {
  ensure();
  const row = {
    sid,
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: tokenType,
    expires_at: expiresAt,
  };
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { error } = await supabase.from('tokens').upsert(row, { onConflict: 'sid' });
    if (!error) return;
    lastError = error;
    const msg = String(error.message || '');
    if (msg.includes("table 'public.tokens'")) {
      if (process.env.SUPABASE_DB_URL) {
        // Heal via direct PG and retry
        await ensureTokensTableExists();
      } else {
        // Likely PostgREST schema cache lag; wait and retry
        await new Promise(r => setTimeout(r, 1000));
      }
      continue;
    }
    break;
  }
  throw lastError || new Error('Unknown error upserting tokens');
}

export function getTokens(sid) {
  ensure();
  return supabase.from('tokens').select('access_token, refresh_token, token_type, expires_at').eq('sid', sid).single()
    .then(({ data, error }) => {
      if (error) return null;
      if (!data || !data.access_token) return null;
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        tokenType: data.token_type,
        expiresAt: data.expires_at,
      };
    });
}

// Bootstrap helper: get any token row (best-effort) to resolve userId
export async function getAnyTokens() {
  ensure();
  const { data, error } = await supabase.from('tokens').select('sid, access_token, refresh_token, token_type, expires_at').limit(1).maybeSingle();
  if (error || !data || !data.access_token) return null;
  return {
    sid: data.sid,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    tokenType: data.token_type,
    expiresAt: data.expires_at,
  };
}

// List all sids that currently have tokens stored
export async function listAllSidsWithTokens() {
  ensure();
  const { data, error } = await supabase.from('tokens').select('sid').neq('access_token', null);
  if (error || !Array.isArray(data)) return [];
  return data.map(r => String(r.sid)).filter(Boolean);
}

export async function updateTokens(sid, tokensOrNull) {
  ensure();
  if (!tokensOrNull) {
    const del = await supabase.from('tokens').delete().eq('sid', sid);
    if (del.error && String(del.error.message || '').includes("table 'public.tokens'")) {
      await ensureTokensTableExists();
      await supabase.from('tokens').delete().eq('sid', sid);
    }
    return;
  }
  const { accessToken, refreshToken, tokenType, expiresAt } = tokensOrNull;
  await upsertTokens(sid, { accessToken, refreshToken, tokenType, expiresAt });
}

async function ensurePlatformIdentityTables() {
  if (!process.env.SUPABASE_DB_URL) return;
  await withPgClient(async (pg) => {
    await pg.query(`
      create table if not exists app_users (
        id text primary key,
        primary_provider text,
        primary_platform_user_id text,
        display_name text,
        avatar_url text,
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table if not exists platform_accounts (
        id uuid primary key default gen_random_uuid(),
        user_id text not null references app_users(id) on delete cascade,
        provider text not null,
        platform_user_id text not null,
        channel_id text,
        channel_name text,
        channel_handle text,
        avatar_url text,
        metadata jsonb not null default '{}'::jsonb,
        connected_at timestamptz not null default now(),
        last_login_at timestamptz not null default now(),
        unique (provider, platform_user_id)
      );
      create table if not exists platform_tokens (
        provider text not null,
        user_id text not null references app_users(id) on delete cascade,
        platform_user_id text not null,
        access_token text not null,
        refresh_token text,
        token_type text,
        expires_at timestamptz,
        scope text,
        updated_at timestamptz not null default now(),
        primary key (provider, user_id),
        unique (provider, platform_user_id)
      );
      create index if not exists idx_platform_accounts_user_provider on platform_accounts(user_id, provider);
      create index if not exists idx_platform_accounts_provider_channel on platform_accounts(provider, channel_id);
      create index if not exists idx_platform_tokens_expiry on platform_tokens(provider, expires_at) where expires_at is not null;
      alter table sessions add column if not exists account_user_id text;
      create index if not exists idx_sessions_account_user_id on sessions(account_user_id);
    `);
  });
}

function normalizeProvider(provider) {
  return String(provider || '').trim().toLowerCase();
}

export async function upsertPlatformIdentity(provider, profile, preferredUserId = null) {
  const p = normalizeProvider(provider);
  const platformUserId = String(profile?.platformUserId || profile?.channelId || '').trim();
  if (!p || !platformUserId) throw new Error('provider and platformUserId are required');
  await ensurePlatformIdentityTables();

  let userId = preferredUserId ? String(preferredUserId).replace(/^user:/, '') : null;
  let account = null;
  await withPgClient(async (pg) => {
    const existing = await pg.query(
      `select user_id from platform_accounts where provider = $1 and platform_user_id = $2 limit 1`,
      [p, platformUserId]
    );
    if (existing.rows[0]?.user_id) userId = String(existing.rows[0].user_id);
    if (!userId) userId = `${p}:${platformUserId}`;

    await pg.query(
      `insert into app_users (id, primary_provider, primary_platform_user_id, display_name, avatar_url, metadata)
       values ($1, $2, $3, $4, $5, $6::jsonb)
       on conflict (id) do update set
         display_name = coalesce(excluded.display_name, app_users.display_name),
         avatar_url = coalesce(excluded.avatar_url, app_users.avatar_url),
         updated_at = now()`,
      [
        userId,
        p,
        platformUserId,
        profile?.channelName || profile?.displayName || null,
        profile?.avatarUrl || profile?.channelImageUrl || null,
        JSON.stringify(profile?.metadata || {})
      ]
    );

    const upserted = await pg.query(
      `insert into platform_accounts
        (user_id, provider, platform_user_id, channel_id, channel_name, channel_handle, avatar_url, metadata, last_login_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
       on conflict (provider, platform_user_id) do update set
         user_id = excluded.user_id,
         channel_id = excluded.channel_id,
         channel_name = excluded.channel_name,
         channel_handle = excluded.channel_handle,
         avatar_url = excluded.avatar_url,
         metadata = excluded.metadata,
         last_login_at = now()
       returning *`,
      [
        userId,
        p,
        platformUserId,
        profile?.channelId || platformUserId,
        profile?.channelName || profile?.displayName || null,
        profile?.channelHandle || null,
        profile?.avatarUrl || profile?.channelImageUrl || null,
        JSON.stringify(profile?.metadata || {})
      ]
    );
    account = upserted.rows[0] || null;
  });
  return { userId, account };
}

export async function listPlatformAccounts(userId) {
  if (!userId) return [];
  await ensurePlatformIdentityTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `select provider, platform_user_id, channel_id, channel_name, channel_handle, avatar_url, avatar_url as profile_image_url, metadata, connected_at, last_login_at
       from platform_accounts
       where user_id = $1
       order by provider asc`,
      [String(userId).replace(/^user:/, '')]
    );
    return rows || [];
  });
}

export async function updatePlatformAccountProfile(provider, userId, platformUserId, profile) {
  const p = normalizeProvider(provider);
  if (!p || !userId || !platformUserId) throw new Error('provider, userId and platformUserId are required');
  await ensurePlatformIdentityTables();
  return withPgClient(async (pg) => {
    const normalizedUserId = String(userId).replace(/^user:/, '');
    await pg.query(
      `update app_users
       set display_name = coalesce($2, display_name),
           avatar_url = coalesce($3, avatar_url),
           updated_at = now()
       where id = $1`,
      [
        normalizedUserId,
        profile?.channelName || profile?.displayName || null,
        profile?.avatarUrl || profile?.channelImageUrl || null
      ]
    );

    const { rows } = await pg.query(
      `update platform_accounts
       set channel_id = coalesce($4, channel_id),
           channel_name = coalesce($5, channel_name),
           channel_handle = coalesce($6, channel_handle),
           avatar_url = coalesce($7, avatar_url),
           metadata = $8::jsonb
       where provider = $1 and user_id = $2 and platform_user_id = $3
       returning provider, platform_user_id, channel_id, channel_name, channel_handle, avatar_url, avatar_url as profile_image_url, metadata, connected_at, last_login_at`,
      [
        p,
        normalizedUserId,
        String(platformUserId),
        profile?.channelId || platformUserId,
        profile?.channelName || profile?.displayName || null,
        profile?.channelHandle || null,
        profile?.avatarUrl || profile?.channelImageUrl || null,
        JSON.stringify(profile?.metadata || {})
      ]
    );
    return rows[0] || null;
  });
}

export async function upsertPlatformTokens(provider, userId, platformUserId, { accessToken, refreshToken, tokenType, expiresAt, scope }) {
  const p = normalizeProvider(provider);
  if (!p || !userId || !platformUserId || !accessToken) throw new Error('provider, userId, platformUserId and accessToken are required');
  await ensurePlatformIdentityTables();
  await withPgClient(async (pg) => {
    await pg.query(
      `insert into platform_tokens
        (provider, user_id, platform_user_id, access_token, refresh_token, token_type, expires_at, scope, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now())
       on conflict (provider, user_id) do update set
         platform_user_id = excluded.platform_user_id,
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         token_type = excluded.token_type,
         expires_at = excluded.expires_at,
         scope = excluded.scope,
         updated_at = now()`,
      [p, String(userId).replace(/^user:/, ''), String(platformUserId), accessToken, refreshToken || null, tokenType || 'Bearer', expiresAt || null, scope || null]
    );
  });
}

export async function getPlatformTokens(provider, userId) {
  const p = normalizeProvider(provider);
  if (!p || !userId) return null;
  await ensurePlatformIdentityTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `select provider, user_id, platform_user_id, access_token, refresh_token, token_type, expires_at, scope
       from platform_tokens
       where provider = $1 and user_id = $2
       limit 1`,
      [p, String(userId).replace(/^user:/, '')]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      provider: row.provider,
      userId: row.user_id,
      platformUserId: row.platform_user_id,
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      tokenType: row.token_type,
      expiresAt: row.expires_at,
      scope: row.scope
    };
  });
}

export async function deletePlatformTokens(provider, userId) {
  const p = normalizeProvider(provider);
  if (!p || !userId) return;
  await ensurePlatformIdentityTables();
  await withPgClient(async (pg) => {
    await pg.query(`delete from platform_tokens where provider = $1 and user_id = $2`, [p, String(userId).replace(/^user:/, '')]);
  });
}

export async function deletePlatformAccount(provider, userId, platformUserId = null) {
  const p = normalizeProvider(provider);
  if (!p || !userId) return { tokensDeleted: 0, accountsDeleted: 0 };
  if (!process.env.SUPABASE_DB_URL) return { tokensDeleted: 0, accountsDeleted: 0 };
  await ensurePlatformIdentityTables();
  return withPgClient(async (pg) => {
    const normalizedUserId = String(userId).replace(/^user:/, '');
    const tokenResult = platformUserId
      ? await pg.query(
        `delete from platform_tokens
         where provider = $1 and user_id = $2 and platform_user_id = $3`,
        [p, normalizedUserId, String(platformUserId)]
      )
      : await pg.query(
        `delete from platform_tokens
         where provider = $1 and user_id = $2`,
        [p, normalizedUserId]
      );
    const accountResult = platformUserId
      ? await pg.query(
        `delete from platform_accounts
         where provider = $1 and user_id = $2 and platform_user_id = $3`,
        [p, normalizedUserId, String(platformUserId)]
      )
      : await pg.query(
        `delete from platform_accounts
         where provider = $1 and user_id = $2`,
        [p, normalizedUserId]
      );
    return {
      tokensDeleted: tokenResult.rowCount || 0,
      accountsDeleted: accountResult.rowCount || 0
    };
  });
}

// ---------------- Automation Action Builder ----------------
async function ensureAutomationTables() {
  await withPgClient(async (pg) => {
    await pg.query(`
      create table if not exists automation_settings (
        owner_user_id text primary key,
        settings jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      );

      create table if not exists automation_connections (
        id text primary key,
        owner_user_id text not null,
        type text not null,
        name text not null,
        enabled boolean not null default true,
        execution_mode text not null default 'oracle_direct',
        endpoint text,
        config jsonb not null default '{}'::jsonb,
        capabilities jsonb not null default '{}'::jsonb,
        discovery_cache jsonb not null default '{}'::jsonb,
        discovery_updated_at timestamptz,
        last_status text,
        last_checked_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create index if not exists idx_automation_connections_owner
        on automation_connections(owner_user_id, type, enabled);

      create table if not exists automation_jobs (
        id text primary key,
        owner_user_id text not null,
        connection_id text,
        job_type text not null,
        payload jsonb not null default '{}'::jsonb,
        status text not null default 'queued',
        priority integer not null default 100,
        run_after timestamptz not null default now(),
        locked_by text,
        locked_at timestamptz,
        attempts integer not null default 0,
        max_attempts integer not null default 3,
        result jsonb,
        error_message text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create index if not exists idx_automation_jobs_claim
        on automation_jobs(status, run_after, priority, created_at)
        where status = 'queued';

      create index if not exists idx_automation_jobs_owner_recent
        on automation_jobs(owner_user_id, created_at desc);

      create table if not exists automation_local_agents (
        id text primary key,
        owner_user_id text not null,
        name text not null,
        token_hash text not null unique,
        status text not null default 'offline',
        capabilities jsonb not null default '{}'::jsonb,
        last_seen_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        revoked_at timestamptz
      );

      create index if not exists idx_automation_local_agents_owner
        on automation_local_agents(owner_user_id, revoked_at, last_seen_at desc);
    `);
  });
}

function normalizeAutomationOwner(ownerUserId) {
  return String(ownerUserId || '').replace(/^user:/, '').trim();
}

function normalizeJsonObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function normalizeExecutionMode(value) {
  return String(value || '').trim() === 'local_program' ? 'local_program' : 'oracle_direct';
}

function normalizeAutomationConnection(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    type: row.type,
    name: row.name,
    enabled: !!row.enabled,
    executionMode: normalizeExecutionMode(row.execution_mode),
    endpoint: row.endpoint || '',
    config: normalizeJsonObject(row.config),
    capabilities: normalizeJsonObject(row.capabilities),
    discoveryCache: normalizeJsonObject(row.discovery_cache),
    discoveryUpdatedAt: row.discovery_updated_at || null,
    lastStatus: row.last_status || null,
    lastCheckedAt: row.last_checked_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

export async function getAutomationSettings(ownerUserId) {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner || !process.env.SUPABASE_DB_URL) return {};
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(`select settings from automation_settings where owner_user_id = $1`, [owner]);
    return normalizeJsonObject(rows?.[0]?.settings, {});
  });
}

export async function setAutomationSettings(ownerUserId, settings) {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner) throw new Error('ownerUserId is required');
  if (!process.env.SUPABASE_DB_URL) return normalizeJsonObject(settings);
  await ensureAutomationTables();
  const safeSettings = normalizeJsonObject(settings, {});
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `insert into automation_settings (owner_user_id, settings, updated_at)
       values ($1, $2::jsonb, now())
       on conflict (owner_user_id)
       do update set settings = excluded.settings, updated_at = now()
       returning settings`,
      [owner, JSON.stringify(safeSettings)]
    );
    return normalizeJsonObject(rows?.[0]?.settings, {});
  });
}

export async function listAutomationConnections(ownerUserId) {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner || !process.env.SUPABASE_DB_URL) return [];
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `select * from automation_connections where owner_user_id = $1 order by created_at desc`,
      [owner]
    );
    return (rows || []).map(normalizeAutomationConnection).filter(Boolean);
  });
}

export async function findAutomationConnectionByControlTokenHash(tokenHash) {
  if (!tokenHash || !process.env.SUPABASE_DB_URL) return null;
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `select * from automation_connections
       where type = 'stream_deck_touch_portal'
         and enabled = true
         and config->>'tokenHash' = $1
       order by created_at desc
       limit 1`,
      [String(tokenHash)]
    );
    return normalizeAutomationConnection(rows?.[0]);
  });
}

export async function upsertAutomationConnection(ownerUserId, connection) {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner) throw new Error('ownerUserId is required');
  if (!process.env.SUPABASE_DB_URL) {
    return normalizeAutomationConnection({
      id: connection?.id || makeId('auto_conn'),
      owner_user_id: owner,
      type: connection?.type,
      name: connection?.name,
      enabled: connection?.enabled !== false,
      execution_mode: connection?.executionMode || connection?.execution_mode,
      endpoint: connection?.endpoint,
      config: connection?.config || {},
      capabilities: connection?.capabilities || {},
      discovery_cache: connection?.discoveryCache || {},
      discovery_updated_at: connection?.discoveryUpdatedAt || null
    });
  }
  const id = String(connection?.id || makeId('auto_conn'));
  const type = String(connection?.type || '').trim();
  const name = String(connection?.name || '').trim() || type || '연결';
  if (!type) throw new Error('type is required');
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `insert into automation_connections
        (id, owner_user_id, type, name, enabled, execution_mode, endpoint, config, capabilities, discovery_cache, discovery_updated_at, last_status, last_checked_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13, now())
       on conflict (id)
       do update set
         type = excluded.type,
         name = excluded.name,
         enabled = excluded.enabled,
         execution_mode = excluded.execution_mode,
         endpoint = excluded.endpoint,
         config = excluded.config,
         capabilities = excluded.capabilities,
         discovery_cache = excluded.discovery_cache,
         discovery_updated_at = excluded.discovery_updated_at,
         last_status = excluded.last_status,
         last_checked_at = excluded.last_checked_at,
         updated_at = now()
       where automation_connections.owner_user_id = excluded.owner_user_id
       returning *`,
      [
        id,
        owner,
        type,
        name,
        connection?.enabled === false ? false : true,
        normalizeExecutionMode(connection?.executionMode || connection?.execution_mode),
        connection?.endpoint ? String(connection.endpoint).trim() : null,
        JSON.stringify(normalizeJsonObject(connection?.config)),
        JSON.stringify(normalizeJsonObject(connection?.capabilities)),
        JSON.stringify(normalizeJsonObject(connection?.discoveryCache || connection?.discovery_cache)),
        connection?.discoveryUpdatedAt || connection?.discovery_updated_at || null,
        connection?.lastStatus || connection?.last_status || null,
        connection?.lastCheckedAt || connection?.last_checked_at || null
      ]
    );
    return normalizeAutomationConnection(rows?.[0]);
  });
}

export async function deleteAutomationConnection(ownerUserId, id) {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner || !id || !process.env.SUPABASE_DB_URL) return false;
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    const result = await pg.query(`delete from automation_connections where owner_user_id = $1 and id = $2`, [owner, String(id)]);
    return (result.rowCount || 0) > 0;
  });
}

export async function enqueueAutomationJob(ownerUserId, job) {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner) throw new Error('ownerUserId is required');
  const payload = normalizeJsonObject(job?.payload);
  if (!process.env.SUPABASE_DB_URL) {
    return { id: makeId('auto_job'), owner_user_id: owner, status: 'queued', payload };
  }
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `insert into automation_jobs
        (id, owner_user_id, connection_id, job_type, payload, priority, run_after, max_attempts)
       values ($1, $2, $3, $4, $5::jsonb, $6, coalesce($7::timestamptz, now()), $8)
       returning *`,
      [
        String(job?.id || makeId('auto_job')),
        owner,
        job?.connectionId || job?.connection_id || null,
        String(job?.jobType || job?.job_type || 'automation.action'),
        JSON.stringify(payload),
        Number.isFinite(Number(job?.priority)) ? Number(job.priority) : 100,
        job?.runAfter || job?.run_after || null,
        Number.isFinite(Number(job?.maxAttempts)) ? Number(job.maxAttempts) : 3
      ]
    );
    return rows?.[0] || null;
  });
}

function hashAutomationAgentToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function normalizeAutomationLocalAgent(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    status: row.status || 'offline',
    capabilities: normalizeJsonObject(row.capabilities),
    lastSeenAt: row.last_seen_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    revokedAt: row.revoked_at || null
  };
}

export async function createAutomationLocalAgent(ownerUserId, name = 'AruBot Local Program') {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner) throw new Error('ownerUserId is required');
  const id = makeId('auto_agent');
  const token = `alp_${crypto.randomBytes(32).toString('base64url')}`;
  if (!process.env.SUPABASE_DB_URL) {
    return {
      token,
      agent: normalizeAutomationLocalAgent({
        id,
        owner_user_id: owner,
        name,
        status: 'offline',
        capabilities: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    };
  }
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `insert into automation_local_agents (id, owner_user_id, name, token_hash, status, capabilities)
       values ($1, $2, $3, $4, 'offline', '{}'::jsonb)
       returning *`,
      [id, owner, String(name || 'AruBot Local Program').slice(0, 120), hashAutomationAgentToken(token)]
    );
    return { token, agent: normalizeAutomationLocalAgent(rows?.[0]) };
  });
}

export async function listAutomationLocalAgents(ownerUserId) {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner || !process.env.SUPABASE_DB_URL) return [];
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `select
         id,
         owner_user_id,
         name,
         case
           when last_seen_at is not null and last_seen_at > now() - interval '45 seconds' then 'online'
           else 'offline'
         end as status,
         capabilities,
         last_seen_at,
         created_at,
         updated_at,
         revoked_at
       from automation_local_agents
       where owner_user_id = $1 and revoked_at is null
       order by coalesce(last_seen_at, created_at) desc`,
      [owner]
    );
    return (rows || []).map(normalizeAutomationLocalAgent).filter(Boolean);
  });
}

export async function authenticateAutomationLocalAgent(token) {
  if (!token || !process.env.SUPABASE_DB_URL) return null;
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `select * from automation_local_agents
       where token_hash = $1 and revoked_at is null
       limit 1`,
      [hashAutomationAgentToken(token)]
    );
    return normalizeAutomationLocalAgent(rows?.[0]);
  });
}

export async function touchAutomationLocalAgent(agentId, capabilities = {}) {
  if (!agentId || !process.env.SUPABASE_DB_URL) return null;
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `update automation_local_agents
       set status = 'online',
           capabilities = coalesce($2::jsonb, capabilities),
           last_seen_at = now(),
           updated_at = now()
       where id = $1 and revoked_at is null
       returning *`,
      [String(agentId), JSON.stringify(normalizeJsonObject(capabilities))]
    );
    return normalizeAutomationLocalAgent(rows?.[0]);
  });
}

export async function claimAutomationJobsForAgent(agent, limit = 5) {
  if (!agent?.id || !agent?.ownerUserId || !process.env.SUPABASE_DB_URL) return [];
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    await pg.query('begin');
    try {
      await pg.query(
        `update automation_jobs
         set status = 'queued',
             locked_by = null,
             locked_at = null,
             run_after = now() + interval '3 seconds',
             updated_at = now()
         where owner_user_id = $1
           and status = 'running'
           and locked_at is not null
           and locked_at < now() - interval '2 minutes'
           and attempts < max_attempts`,
        [String(agent.ownerUserId)]
      );
      const { rows } = await pg.query(
        `select id from automation_jobs
         where owner_user_id = $1
           and status = 'queued'
           and run_after <= now()
         order by priority asc, created_at asc
         limit $2
         for update skip locked`,
        [String(agent.ownerUserId), Math.max(1, Math.min(20, Number(limit || 5)))]
      );
      const ids = (rows || []).map((row) => row.id);
      if (!ids.length) {
        await pg.query('commit');
        return [];
      }
      const claimed = await pg.query(
        `update automation_jobs
         set status = 'running',
             locked_by = $2,
             locked_at = now(),
             attempts = attempts + 1,
             updated_at = now()
         where id = any($1::text[])
         returning *`,
        [ids, String(agent.id)]
      );
      await pg.query('commit');
      return claimed.rows || [];
    } catch (error) {
      try { await pg.query('rollback'); } catch {}
      throw error;
    }
  });
}

export async function completeAutomationJobForAgent(agent, jobId, { status = 'done', result = {}, errorMessage = null } = {}) {
  if (!agent?.id || !agent?.ownerUserId || !jobId || !process.env.SUPABASE_DB_URL) return null;
  const nextStatus = status === 'failed' ? 'failed' : 'done';
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `update automation_jobs
       set status = $4,
           result = $5::jsonb,
           error_message = $6,
           locked_by = null,
           locked_at = null,
           updated_at = now()
       where id = $1
         and owner_user_id = $2
         and locked_by = $3
       returning *`,
      [String(jobId), String(agent.ownerUserId), String(agent.id), nextStatus, JSON.stringify(normalizeJsonObject(result)), errorMessage ? String(errorMessage).slice(0, 1000) : null]
    );
    return rows?.[0] || null;
  });
}

// OAuth revoke helper is HTTP-based; leave as-is to maintain compatibility
export async function revokeTokens({ clientId, clientSecret, token, tokenTypeHint = 'access_token', baseUrl }) {
  const url = `${baseUrl}/auth/v1/token/revoke`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret, token, tokenTypeHint })
  });
}

// Settings
export function getBotSettings(sid) {
  ensure();
  return supabase.from('bot_settings').select('settings').eq('sid', sid).single()
    .then(({ data, error }) => {
      if (error || !data) return {};
      // settings is stored as jsonb
      try { return data.settings || {}; } catch { return {}; }
    });
}

export async function setBotSettings(sid, settingsObj) {
  ensure();
  const settings = settingsObj || {};
  const { error } = await supabase.from('bot_settings').upsert({ sid, settings });
  if (error) throw error;
}

// Find sid by viewer token stored in bot_settings.settings.videoDonationViewerToken
export async function findSidByViewerToken(token) {
  ensure();
  if (!token) return null;
  try {
    const sid = await findSidByChannelViewerTokenSupabase(token, 'pvd');
    if (sid) return sid;
  } catch { }
  try {
    // PostgREST supports JSON path operators using ->>
    const { data, error } = await supabase
      .from('bot_settings')
      .select('sid')
      .eq('settings->>videoDonationViewerToken', String(token))
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data.sid ? String(data.sid) : null;
  } catch {
    return null;
  }
}

// Resolve sid by roulette viewer token stored at bot_settings.settings.rouletteViewerToken
export async function findSidByRouletteToken(token) {
  ensure();
  if (!token) return null;
  try {
    const sid = await findSidByChannelViewerTokenSupabase(token, 'roulette');
    if (sid) return sid;
  } catch { }
  try {
    const { data, error } = await supabase
      .from('bot_settings')
      .select('sid')
      .eq('settings->>rouletteViewerToken', String(token))
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data.sid ? String(data.sid) : null;
  } catch {
    return null;
  }
}

// Stats
export function getBotStats(sid) {
  ensure();
  // Select '*' to avoid referencing columns that might not yet be in PostgREST schema cache
  return supabase.from('bot_stats').select('*').eq('sid', sid).single()
    .then(({ data, error }) => {
      if (error || !data) return { messagesProcessed: 0, commandsHandled: 0, lastActive: null };
      return {
        messagesProcessed: Number(data.messages_processed ?? data.messagesProcessed ?? 0),
        commandsHandled: Number(data.commands_handled ?? data.commandsHandled ?? 0),
        lastActive: data.last_active ?? data.lastActive ?? null,
      };
    });
}

export async function updateBotStats(sid, delta = { messagesProcessed: 0, commandsHandled: 0 }) {
  ensure();
  const current = await getBotStats(sid);
  const next = {
    messagesProcessed: (current.messagesProcessed || 0) + (delta.messagesProcessed || 0),
    commandsHandled: (current.commandsHandled || 0) + (delta.commandsHandled || 0),
    lastActive: new Date().toISOString()
  };
  // Build row only with columns that exist to avoid PostgREST schema cache errors
  const hasMP = await tableHasColumn('bot_stats', 'messages_processed');
  const hasCH = await tableHasColumn('bot_stats', 'commands_handled');
  const hasLA = await tableHasColumn('bot_stats', 'last_active');
  const row = { sid };
  if (hasMP) row.messages_processed = next.messagesProcessed;
  if (hasCH) row.commands_handled = next.commandsHandled;
  if (hasLA) row.last_active = next.lastActive;
  const { error } = await supabase.from('bot_stats').upsert(row, { onConflict: 'sid' });
  if (error) throw error;
  return next;
}

// Rules
export async function getBotRules(sid) {
  ensure();
  const hasAdminOnly = await tableHasColumn('bot_rules', 'admin_only');
  const hasReq = await tableHasColumn('bot_rules', 'required_role_level');
  const hasPointsCost = await tableHasColumn('bot_rules', 'points_cost');
  const hasCooldown = await tableHasColumn('bot_rules', 'cooldown');
  const hasLastUsed = await tableHasColumn('bot_rules', 'last_used');
  const selectCols = ['id','name','keywords','responses','enabled']
    .concat(hasAdminOnly ? ['admin_only'] : [])
    .concat(hasReq ? ['required_role_level'] : [])
    .concat(hasPointsCost ? ['points_cost'] : [])
    .concat(hasCooldown ? ['cooldown'] : [])
    .concat(hasLastUsed ? ['last_used'] : []);
  const { data, error } = await supabase.from('bot_rules')
    .select(selectCols.join(', '))
    .eq('sid', sid)
    .order('id', { ascending: true });
  if (error || !Array.isArray(data)) return [];
  return data.map(r => ({
    id: r.id,
    name: r.name || '',
    keywords: Array.isArray(r.keywords) ? r.keywords : [],
    responses: Array.isArray(r.responses) ? r.responses : [],
    enabled: !!r.enabled,
    adminOnly: hasAdminOnly ? !!r.admin_only : !!r.adminOnly,
    requiredRoleLevel: hasReq ? Number(r.required_role_level || 1) : Number(r.requiredRoleLevel || 1),
    pointsCost: hasPointsCost ? Math.max(0, Number(r.points_cost || 0)) : 0,
    cooldown: hasCooldown ? Number(r.cooldown || 1000) : Number(r.cooldown || 1000),
    lastUsed: hasLastUsed ? Number(r.last_used || 0) : Number(r.lastUsed || 0),
  }));
}

// =============================
// Roulette sessions (per-sid persisted results)
// =============================
export async function ensureRouletteSessionsPg() {
  // Prefer direct PG to avoid PostgREST schema cache issues
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) return false;
  await withPgClient(async (pg) => {
    const sql = `
      create table if not exists roulette_sessions (
        id bigint generated always as identity primary key,
        sid text not null,
        token text not null,
        channel_id text,
        roulette_name text not null,
        user_id text,
        username text,
        result_label text,
        result_value numeric,
        created_at timestamptz default now()
      );
      
      -- 기존 테이블에 channel_id 컬럼 추가 (존재하지 않는 경우)
      do $$
      begin
        if not exists (
          select 1 from information_schema.columns 
          where table_name = 'roulette_sessions' 
          and column_name = 'channel_id'
        ) then
          alter table roulette_sessions add column channel_id text;
        end if;
      end $$;
      
      create index if not exists roulette_sessions_sid_idx on roulette_sessions(sid);
      create index if not exists roulette_sessions_token_idx on roulette_sessions(token);
      create index if not exists roulette_sessions_channel_idx on roulette_sessions(channel_id);
      create index if not exists roulette_sessions_created_idx on roulette_sessions(created_at desc);
      create index if not exists roulette_sessions_channel_created_idx on roulette_sessions(channel_id, created_at desc);
    `;
    await pg.query(sql);
  });
  return true;
}

async function ensureRouletteSessions() {
  ensure();
  try {
    const ok = await ensureRouletteSessionsPg();
    if (ok) {
      // PostgREST 스키마 캐시 무효화를 위해 컬럼 캐시 클리어
      columnCache.delete('public.roulette_sessions');
      return;
    }
  } catch (e) {
    console.warn('[Supabase] Failed to ensure roulette_sessions table:', e?.message || e);
  }
  // If we cannot ensure via PG (no DB URL), skip; callers will handle missing table gracefully
}

export async function insertRouletteSession(row) {
  ensure();
  await ensureRouletteSessions();
  
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    try {
      const { error } = await supabase.from('roulette_sessions').insert(row);
      if (!error) return; // 성공
      
      const msg = String(error.message || '');
      
      // 스키마 캐시 오류인 경우 재시도
      if (msg.includes('schema cache') || msg.includes('resultLabel') || msg.includes('column')) {
        console.warn(`[Supabase] Schema cache issue detected, attempt ${attempts + 1}/${maxAttempts}:`, msg);
        
        // 캐시 클리어 및 테이블 재생성 시도
        columnCache.delete('public.roulette_sessions');
        await ensureRouletteSessionsPg();
        
        attempts++;
        if (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempts)); // 지수 백오프
          continue;
        }
      }
      
      throw error;
    } catch (error) {
      if (attempts >= maxAttempts - 1) {
        console.error('[Supabase] Failed to insert roulette session after retries:', error);
        throw error;
      }
      attempts++;
    }
  }
}

// =============================
// Live Sessions (방송 세션 상태 관리)
// =============================

// 특정 SID의 라이브 세션 정보 조회
export async function getLiveSessionFromDB(sid) {
  ensure();
  const { data, error } = await supabase
    .from('live_sessions')
    .select('*')
    .eq('sid', sid)
    .maybeSingle();
  
  if (error) throw error;
  return data;
}

// 라이브 세션 정보 업서트 (생성 또는 업데이트)
export async function upsertLiveSessionToDB(sessionData) {
  ensure();
  const { sid, live, start_date, session_start_time, last_update } = sessionData;
  
  const row = {
    sid,
    live: !!live,
    start_date: start_date || null,
    session_start_time: session_start_time || null,
    last_update: last_update || Date.now()
  };
  
  const { error } = await supabase
    .from('live_sessions')
    .upsert(row, { onConflict: 'sid' });
  
  if (error) throw error;
}

// 특정 SID의 마지막 업데이트 시간만 갱신
export async function updateLiveSessionLastUpdate(sid, timestamp) {
  ensure();
  const { error } = await supabase
    .from('live_sessions')
    .update({ last_update: timestamp })
    .eq('sid', sid);
  
  if (error) throw error;
}

// 활성 라이브 세션들 조회 (live = true)
export async function getActiveLiveSessionsFromDB() {
  ensure();
  const { data, error } = await supabase
    .from('live_sessions')
    .select('*')
    .eq('live', true)
    .order('last_update', { ascending: false });
  
  if (error) throw error;
  return data || [];
}

// 오래된 라이브 세션들 삭제 (cutoff 시간 이전)
export async function deleteOldLiveSessionsFromDB(cutoff) {
  ensure();
  const { error } = await supabase
    .from('live_sessions')
    .delete()
    .lt('last_update', cutoff)
    .eq('live', false);
  
  if (error) throw error;
}

// 백엔드 시작 시 세션 복원 로직
export async function initializeLiveSessionsOnStartup() {
  if (!supabase) {
    console.warn('[Session] Supabase is not initialized; live session restore skipped');
    return [];
  }
  try {
    console.log('[Session] Initializing live sessions from DB...');
    
    // DB에서 활성 세션 조회
    const activeSessions = await getActiveLiveSessionsFromDB();
    
    console.log(`[Session] Found ${activeSessions.length} active sessions in DB`);
    
    // 오래된 세션 정리 (24시간 이상)
    await cleanupOldSessions();
    
    return activeSessions;
  } catch (error) {
    console.warn('[Session] Failed to initialize from DB:', error?.message || error);
    return [];
  }
}

// 오래된 세션 정리 함수
export async function cleanupOldSessions() {
  if (!supabase) return;
  const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24시간 전
  
  try {
    await deleteOldLiveSessionsFromDB(cutoff);
    console.log('[Session] Cleaned up old sessions from DB');
  } catch (error) {
    console.error('[Session] Failed to cleanup old sessions:', error);
  }
}

export async function getRouletteSessionByToken(token) {
  ensure();
  await ensureRouletteSessions();
  const { data, error } = await supabase
    .from('roulette_sessions')
    .select('*')
    .eq('token', token)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    const msg = String(error.message || '');
    if (msg.includes("table 'public.roulette_sessions'") || msg.toLowerCase().includes('roulette_sessions')) {
      // Table missing: treat as no session stored
      return null;
    }
    throw error;
  }
  return data || null;
}

/**
 * 채널별 룰렛 세션 조회
 * @param {string} channelId - 채널 ID
 * @param {Object} options - 조회 옵션
 * @returns {Promise<Array>} - 룰렛 세션 목록
 */
export async function listRouletteSessionsByChannel(channelId, { q, limit = 50, offset = 0 } = {}) {
  ensure();
  await ensureRouletteSessions();
  
  if (!channelId) {
    return [];
  }
  
  try {
    let query = supabase.from('roulette_sessions').select('*').eq('channel_id', channelId);
    
    if (q && String(q).trim()) {
      const s = `%${String(q).trim()}%`;
      query = query.or(`username.ilike.${s},roulette_name.ilike.${s},result_label.ilike.${s}`);
    }
    
    query = query.order('created_at', { ascending: false }).range(offset, offset + Math.max(1, Math.min(200, limit)) - 1);
    
    const { data, error } = await query;
    
    if (error) {
      const msg = String(error.message || '');
      if (msg.includes("table 'public.roulette_sessions'") || msg.toLowerCase().includes('roulette_sessions')) {
        return [];
      }
      throw error;
    }
    
    return data || [];
    
  } catch (error) {
    console.error('[Supabase] Failed to list roulette sessions by channel:', error);
    return [];
  }
}

/**
 * 채널별 룰렛 통계 조회
 * @param {string} channelId - 채널 ID
 * @param {number} days - 조회 기간 (일)
 * @returns {Promise<Object>} - 통계 정보
 */
export async function getRouletteStatsByChannel(channelId, days = 7) {
  ensure();
  await ensureRouletteSessions();
  
  if (!channelId) {
    return { totalSpins: 0, uniqueUsers: 0, topRoulettes: [], recentActivity: [] };
  }
  
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    // 총 스핀 수와 고유 사용자 수
    const { data: totalData, error: totalError } = await supabase
      .from('roulette_sessions')
      .select('user_id')
      .eq('channel_id', channelId)
      .gte('created_at', cutoffDate.toISOString());
    
    if (totalError) throw totalError;
    
    const totalSpins = totalData?.length || 0;
    const uniqueUsers = new Set(totalData?.map(row => row.user_id).filter(Boolean)).size;
    
    // 인기 룰렛 목록
    const { data: rouletteData, error: rouletteError } = await supabase
      .from('roulette_sessions')
      .select('roulette_name')
      .eq('channel_id', channelId)
      .gte('created_at', cutoffDate.toISOString());
    
    if (rouletteError) throw rouletteError;
    
    const rouletteCounts = {};
    rouletteData?.forEach(row => {
      const name = row.roulette_name;
      rouletteCounts[name] = (rouletteCounts[name] || 0) + 1;
    });
    
    const topRoulettes = Object.entries(rouletteCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));
    
    // 최근 활동
    const { data: recentData, error: recentError } = await supabase
      .from('roulette_sessions')
      .select('*')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (recentError) throw recentError;
    
    return {
      totalSpins,
      uniqueUsers,
      topRoulettes,
      recentActivity: recentData || []
    };
    
  } catch (error) {
    console.error('[Supabase] Failed to get roulette stats by channel:', error);
    return { totalSpins: 0, uniqueUsers: 0, topRoulettes: [], recentActivity: [] };
  }
}

export async function listRouletteSessionsByToken(token, { q, limit = 50, offset = 0 } = {}) {
  ensure();
  await ensureRouletteSessions();
  let query = supabase.from('roulette_sessions').select('*').eq('token', token);
  if (q && String(q).trim()) {
    const s = `%${String(q).trim()}%`;
    query = query.or(`username.ilike.${s},roulette_name.ilike.${s},result_label.ilike.${s}`);
  }
  query = query.order('created_at', { ascending: false }).range(offset, offset + Math.max(1, Math.min(200, limit)) - 1);
  const { data, error } = await query;
  if (error) {
    const msg = String(error.message || '');
    if (msg.includes("table 'public.roulette_sessions'") || msg.toLowerCase().includes('roulette_sessions')) {
      return [];
    }
    throw error;
  }
  return Array.isArray(data) ? data : [];
}

export async function upsertBotRule(sid, rule) {
  ensure();
  const hasAdminOnly = await tableHasColumn('bot_rules', 'admin_only');
  const hasReq = await tableHasColumn('bot_rules', 'required_role_level');
  const hasPointsCost = await tableHasColumn('bot_rules', 'points_cost');
  const hasCooldown = await tableHasColumn('bot_rules', 'cooldown');
  const hasLastUsed = await tableHasColumn('bot_rules', 'last_used');
  const row = {
    sid,
    id: rule.id,
    name: rule.name || '',
    keywords: rule.keywords || [],
    responses: rule.responses || [],
    enabled: !!rule.enabled,
    ...(hasAdminOnly ? { admin_only: !!rule.adminOnly } : {}),
    ...(hasReq ? { required_role_level: Math.max(1, Math.min(4, Number(rule.requiredRoleLevel || 1))) } : {}),
    ...(hasPointsCost ? { points_cost: Math.max(0, Number(rule.pointsCost || 0)) } : {}),
    ...(hasCooldown ? { cooldown: Math.max(1000, Number(rule.cooldown || 0)) } : {}),
    ...(hasLastUsed ? { last_used: Number(rule.lastUsed || 0) } : {}),
  };
  const { error } = await supabase.from('bot_rules').upsert(row, { onConflict: 'sid,id' });
  if (error) throw error;
}

export async function deleteBotRule(sid, id) {
  ensure();
  const { error } = await supabase.from('bot_rules').delete().eq('sid', sid).eq('id', id);
  if (error) throw error;
}

// Migrate data from cookie-based sid partition to user-id based partition
export async function migrateSidToUserPid(oldSid, userId) {
  ensure();
  if (!oldSid || !userId) return;
  const oldPidCandidates = [String(oldSid), `sid:${oldSid}`];
  const newPid = `user:${userId}`;
  const tables = ['tokens', 'bot_settings', 'bot_stats', 'bot_rules', 'live_days', 'attendance', 'attendance_state'];
  for (const t of tables) {
    try {
      // Update rows that match either plain sid or prefixed sid
      for (const oldPid of oldPidCandidates) {
        await supabase.from(t).update({ sid: newPid }).eq('sid', oldPid);
      }
    } catch {}
  }
}

// Attendance helpers
export async function markLiveDay(sid, date) {
  ensure();
  await supabase.from('live_days').upsert({ sid, date }, { onConflict: 'sid,date' });
}

export async function recordAttendanceAndGetStreak(sid, userId, username, today) {
  ensure();
  // Determine available columns dynamically (snake_case, legacy camelCase, or fallback username)
  let hasUserId = await tableHasColumn('attendance', 'user_id');
  let hasUserIdCamel = await tableHasColumn('attendance', 'userid');
  let hasUsernameCol = await tableHasColumn('attendance', 'username');
  if (!hasUserId && !hasUserIdCamel && !hasUsernameCol) {
    // Heuristic fallback when schema inspection is unavailable: prefer legacy userid
    hasUserIdCamel = true;
  }

  // 1) Check if already checked in today
  let query = supabase.from('attendance').select('*').eq('sid', sid).eq('date', today);
  if (hasUserId) query = query.eq('user_id', userId);
  else if (hasUserIdCamel) query = query.eq('userid', userId);
  else if (hasUsernameCol) query = query.eq('username', username);
  const existing = await query.maybeSingle();
  if (existing && existing.data) {
    // Fetch streak from state
    let hasStateUserId = await tableHasColumn('attendance_state', 'user_id');
    let hasStateUserIdCamel = await tableHasColumn('attendance_state', 'userid');
    let hasLastDate = await tableHasColumn('attendance_state', 'last_date');
    let hasLastDateCamel = await tableHasColumn('attendance_state', 'lastdate');
    if (!hasStateUserId && !hasStateUserIdCamel) {
      hasStateUserIdCamel = true;
    }
    if (!hasLastDate && !hasLastDateCamel) {
      hasLastDateCamel = true;
    }
    let stq = supabase.from('attendance_state').select('*').eq('sid', sid);
    if (hasStateUserId) stq = stq.eq('user_id', userId);
    else if (hasStateUserIdCamel) stq = stq.eq('userid', userId);
    const st = await stq.maybeSingle();
    const streakVal = st?.data?.streak || 0;
    return { streak: Number(streakVal) || 0, isNew: false };
  }

  // 2) Insert attendance (manual insert after existence check; no onConflict requirement)
  const attRow = { sid, date: today };
  if (hasUserId) attRow.user_id = userId;
  else if (hasUserIdCamel) attRow.userid = userId;
  if (hasUsernameCol) attRow.username = username;
  {
    const { error } = await supabase.from('attendance').insert(attRow);
    if (error) throw error;
  }

  // 3) Compute next streak
  const prevLive = await supabase.from('live_days')
    .select('date')
    .eq('sid', sid)
    .lt('date', today)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  let hasStateUserId = await tableHasColumn('attendance_state', 'user_id');
  let hasStateUserIdCamel = await tableHasColumn('attendance_state', 'userid');
  let hasLastDate = await tableHasColumn('attendance_state', 'last_date');
  let hasLastDateCamel = await tableHasColumn('attendance_state', 'lastdate');
  let hasTotalDays = await tableHasColumn('attendance_state', 'total_days');
  if (!hasStateUserId && !hasStateUserIdCamel) {
    hasStateUserIdCamel = true;
  }
  if (!hasLastDate && !hasLastDateCamel) {
    hasLastDateCamel = true;
  }

  let stateQ = supabase.from('attendance_state').select('*').eq('sid', sid);
  if (hasStateUserId) stateQ = stateQ.eq('user_id', userId);
  else if (hasStateUserIdCamel) stateQ = stateQ.eq('userid', userId);
  const state = await stateQ.maybeSingle();

  let lastDateVal = state?.data ? (hasLastDate ? state.data.last_date : (hasLastDateCamel ? state.data.lastdate : null)) : null;
  let streakVal = state?.data ? Number(state.data.streak || 0) : 0;
  let totalDaysVal = state?.data ? Number((hasTotalDays ? state.data.total_days : state.data.totalDays) || 0) : 0;
  let nextStreak = 1;
  if (lastDateVal && prevLive?.data && prevLive.data.date) {
    if (lastDateVal === prevLive.data.date) {
      nextStreak = Math.max(1, streakVal + 1);
    }
  } else if (state?.data && !prevLive?.data) {
    nextStreak = 1;
  }

  // 4) Upsert state via update-or-insert to avoid relying on constraints
  const stateKeyFilter = (q) => {
    q = q.eq('sid', sid);
    if (hasStateUserId) return q.eq('user_id', userId);
    if (hasStateUserIdCamel) return q.eq('userid', userId);
    return q; // worst case: sid only
  };
  const row = { sid, streak: nextStreak };
  if (hasStateUserId) row.user_id = userId;
  else if (hasStateUserIdCamel) row.userid = userId;
  if (hasLastDate) row.last_date = today;
  else if (hasLastDateCamel) row.lastdate = today;
  if (hasTotalDays) row.total_days = (Number(totalDaysVal) || 0) + 1;

  // Try update first (select to know affected rows)
  const upd = await stateKeyFilter(
    supabase.from('attendance_state').update(row).select()
  );
  if (upd.error) throw upd.error;
  if (!upd.data || upd.data.length === 0) {
    const ins = await supabase.from('attendance_state').insert(row);
    if (ins.error) throw ins.error;
  }

  return { streak: nextStreak, isNew: true };
}

export async function getUserAttendanceTotalDays(sid, userId) {
  ensure();
  // Try to read from attendance_state.total_days; if column missing, fallback to counting attendance rows
  const hasTotal = await tableHasColumn('attendance_state', 'total_days');
  if (hasTotal) {
    let q = supabase.from('attendance_state').select('total_days').eq('sid', sid);
    const hasUserId = await tableHasColumn('attendance_state', 'user_id');
    const hasUserIdCamel = await tableHasColumn('attendance_state', 'userid');
    if (hasUserId) q = q.eq('user_id', userId);
    else if (hasUserIdCamel) q = q.eq('userid', userId);
    const { data, error } = await q.maybeSingle();
    if (!error && data && typeof data.total_days === 'number') return Number(data.total_days) || 0;
  }
  // Fallback: count distinct days in attendance (best-effort, may be slower)
  let q2 = supabase.from('attendance').select('date', { count: 'exact', head: true }).eq('sid', sid);
  const hasAttUserId = await tableHasColumn('attendance', 'user_id');
  const hasAttUserIdCamel = await tableHasColumn('attendance', 'userid');
  const hasUsernameCol = await tableHasColumn('attendance', 'username');
  if (hasAttUserId) q2 = q2.eq('user_id', userId);
  else if (hasAttUserIdCamel) q2 = q2.eq('userid', userId);
  else if (hasUsernameCol) {
    // no reliable username here; return 0
    return 0;
  }
  const { count } = await q2;
  return Number(count || 0);
}

// =============================
// Live Sessions (방송 세션 상태 관리) - Supabase 버전
// =============================

// 중복된 함수들 제거됨 - 이미 위에 정의되어 있음

// =============================
// 배치 처리 함수들 (성능 최적화) - Supabase 버전
// =============================

// 여러 세션을 배치로 업데이트 (PostgreSQL 사용)
export async function batchUpdateLiveSessionsLastUpdate(sessionUpdates) {
  if (!Array.isArray(sessionUpdates) || sessionUpdates.length === 0) {
    return;
  }
  
  ensure();
  
  try {
    // PostgreSQL의 경우 배치 업데이트를 위해 직접 PG 클라이언트 사용
    await withPgClient(async (pg) => {
      const values = sessionUpdates.map((update, index) => 
        `($${index * 2 + 1}, $${index * 2 + 2})`
      ).join(', ');
      
      const params = sessionUpdates.flatMap(update => [update.timestamp, update.sid]);
      
      const sql = `
        UPDATE live_sessions 
        SET last_update = updates.timestamp
        FROM (VALUES ${values}) AS updates(timestamp, sid)
        WHERE live_sessions.sid = updates.sid
      `;
      
      await pg.query(sql, params);
    });
    
    console.log(`[Session-DB] Batch updated ${sessionUpdates.length} session timestamps`);
  } catch (error) {
    console.error('[Session-DB] Batch update failed:', error);
    
    // Fallback: 개별 업데이트
    for (const { sid, timestamp } of sessionUpdates) {
      try {
        await updateLiveSessionLastUpdate(sid, timestamp);
      } catch (individualError) {
        console.error(`[Session-DB] Individual update failed for ${sid}:`, individualError);
      }
    }
  }
}

// 여러 세션을 배치로 업서트 (PostgreSQL 사용)
export async function batchUpsertLiveSessions(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return;
  }
  
  ensure();
  
  try {
    // 배치 크기 제한 (PostgreSQL 파라미터 제한 고려)
    const batchSize = 100;
    
    for (let i = 0; i < sessions.length; i += batchSize) {
      const batch = sessions.slice(i, i + batchSize);
      
      const { error } = await supabase
        .from('live_sessions')
        .upsert(
          batch.map(session => ({
            sid: session.sid,
            live: !!session.live,
            start_date: session.start_date || null,
            session_start_time: session.session_start_time || null,
            last_update: session.last_update || Date.now()
          })),
          { onConflict: 'sid' }
        );
      
      if (error) throw error;
      
      // 배치 간 짧은 대기 (연결 포화 방지)
      if (i + batchSize < sessions.length) {
        await sleep(50);
      }
    }
    
    console.log(`[Session-DB] Batch upserted ${sessions.length} sessions`);
  } catch (error) {
    console.error('[Session-DB] Batch upsert failed:', error);
    throw error;
  }
}

// 배치로 출석 기록 처리 (PostgreSQL 사용)
export async function batchRecordAttendance(attendanceRecords) {
  if (!Array.isArray(attendanceRecords) || attendanceRecords.length === 0) {
    return [];
  }
  
  ensure();
  
  try {
    const results = [];
    
    // 배치 크기 제한
    const batchSize = 50;
    
    for (let i = 0; i < attendanceRecords.length; i += batchSize) {
      const batch = attendanceRecords.slice(i, i + batchSize);
      
      for (const record of batch) {
        try {
          const result = await recordAttendanceAndGetStreak(
            record.sid,
            record.userId,
            record.username,
            record.date
          );
          results.push({ ...record, ...result });
        } catch (error) {
          console.error(`[Attendance-DB] Failed to process record for ${record.sid}:${record.userId}:`, error);
          results.push({ ...record, streak: 0, isNew: false, error: error.message });
        }
      }
      
      // 배치 간 짧은 대기
      if (i + batchSize < attendanceRecords.length) {
        await sleep(100);
      }
    }
    
    console.log(`[Attendance-DB] Batch processed ${attendanceRecords.length} attendance records`);
    return results;
  } catch (error) {
    console.error('[Attendance-DB] Batch processing failed:', error);
    throw error;
  }
}

// 연결 풀 최적화 (Supabase 클라이언트 설정)
export function optimizeSupabaseConnection() {
  // Supabase 클라이언트는 내부적으로 연결 풀링을 관리하므로
  // 여기서는 주로 쿼리 최적화 관련 설정을 수행
  console.log('[Supabase] Connection pool optimization - using default Supabase settings');
}

// 주기적 DB 최적화 실행 (PostgreSQL)
export async function performPeriodicOptimization() {
  try {
    await withPgClient(async (pg) => {
      // PostgreSQL 통계 업데이트
      await pg.query('ANALYZE live_sessions, attendance, attendance_state, bot_rules');
      
      // 자동 VACUUM은 PostgreSQL이 자동으로 수행하므로 수동 실행은 피함
      console.log('[DB] Periodic optimization completed (PostgreSQL)');
    });
  } catch (error) {
    console.error('[DB] Periodic optimization failed:', error);
  }
}
