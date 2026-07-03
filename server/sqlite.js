import Database from 'better-sqlite3';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const dataDir = path.join(process.cwd(), 'server');
const dbPath = path.join(dataDir, 'data.sqlite');
let db;

function getSecretEncryptionKey() {
  const secret = String(
    process.env.ARUBOT_SECRET_ENCRYPTION_KEY ||
    process.env.TOKEN_ENCRYPTION_SECRET ||
    process.env.OAUTH_STATE_SECRET ||
    process.env.SESSION_SECRET ||
    ''
  );
  if (!secret || secret.length < 16) return null;
  return crypto.createHash('sha256').update(secret).digest();
}

function protectSecret(value) {
  if (value == null || value === '') return value ?? null;
  const text = String(value);
  if (text.startsWith('enc:v1:')) return text;
  const key = getSecretEncryptionKey();
  if (!key) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

function revealSecret(value) {
  if (value == null || value === '') return value ?? null;
  const text = String(value);
  if (!text.startsWith('enc:v1:')) return text;
  const key = getSecretEncryptionKey();
  if (!key) throw new Error('Secret encryption key is required to decrypt stored credentials');
  const [, version, ivText, tagText, encryptedText] = text.split(':');
  if (version !== 'v1' || !ivText || !tagText || !encryptedText) throw new Error('Invalid encrypted secret format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

export function initDb() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  // New schema: per-session tokens keyed by sid
  db.exec(`
    CREATE TABLE IF NOT EXISTS tokens (
      sid TEXT PRIMARY KEY,
      accessToken TEXT,
      refreshToken TEXT,
      tokenType TEXT,
      expiresAt TEXT
    );
  `);
  // Per-user (sid) bot settings
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_settings (
      sid TEXT PRIMARY KEY,
      settings TEXT
    );
  `);
  // Per-user (sid) bot stats
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_stats (
      sid TEXT PRIMARY KEY,
      messagesProcessed INTEGER DEFAULT 0,
      commandsHandled INTEGER DEFAULT 0,
      lastActive TEXT
    );
  `);

  // Attendance: per-sid live days and user attendance/streaks
  db.exec(`
    CREATE TABLE IF NOT EXISTS live_days (
      sid TEXT NOT NULL,
      date TEXT NOT NULL,
      PRIMARY KEY (sid, date)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendance (
      sid TEXT NOT NULL,
      userId TEXT NOT NULL,
      date TEXT NOT NULL,
      username TEXT,
      PRIMARY KEY (sid, userId, date)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendance_state (
      sid TEXT NOT NULL,
      userId TEXT NOT NULL,
      lastDate TEXT,
      streak INTEGER DEFAULT 0,
      PRIMARY KEY (sid, userId)
    );
  `);
  // Per-user (sid) bot rules
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_rules (
      sid TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT,
      keywords TEXT, -- JSON array
      responses TEXT, -- JSON array
      enabled INTEGER DEFAULT 1,
      adminOnly INTEGER DEFAULT 0,
      requiredRoleLevel INTEGER DEFAULT 1,
      pointsCost INTEGER DEFAULT 0,
      cooldown INTEGER DEFAULT 1000,
      lastUsed INTEGER DEFAULT 0,
      PRIMARY KEY (sid, id)
    );
  `);

  // Sessions: 세션 매핑 테이블 (멀티 방송 지원)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel_id TEXT,
      isolation_level TEXT DEFAULT 'strict',
      connection_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_seen TEXT,
      expires_at TEXT,
      revoked INTEGER DEFAULT 0
    );
  `);

  // Live sessions: 방송 세션 상태 관리 (다중 방송 환경 지원)
  db.exec(`
    CREATE TABLE IF NOT EXISTS live_sessions (
      sid TEXT PRIMARY KEY,
      live INTEGER NOT NULL DEFAULT 0,    -- SQLite에서는 BOOLEAN 대신 INTEGER 사용
      start_date TEXT,                     -- YYYY-MM-DD 형식 (KST)
      session_start_time INTEGER,          -- 방송 시작 타임스탬프
      last_update INTEGER NOT NULL,        -- 마지막 업데이트 타임스탬프
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Roulette sessions: 룰렛 실행 결과 저장 (멀티 방송 지원)
  db.exec(`
    CREATE TABLE IF NOT EXISTS roulette_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sid TEXT NOT NULL,
      channel_id TEXT,
      token TEXT NOT NULL,
      roulette_name TEXT NOT NULL,
      user_id TEXT,
      username TEXT,
      result_label TEXT,
      result_value REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migration log: 마이그레이션 추적
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration_name TEXT NOT NULL,
      executed_at TEXT DEFAULT (datetime('now')),
      status TEXT NOT NULL, -- 'success', 'failed', 'rollback'
      details TEXT, -- JSON string
      execution_time_ms INTEGER
    );
  `);

  // Channel tokens: 채널별 토큰 관리
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      token_type TEXT NOT NULL CHECK (token_type IN ('roulette', 'pvd', 'api')),
      token_value TEXT NOT NULL UNIQUE,
      sid TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT,
      last_used TEXT,
      active INTEGER DEFAULT 1, -- SQLite에서는 BOOLEAN 대신 INTEGER 사용
      usage_count INTEGER DEFAULT 0,
      metadata TEXT DEFAULT '{}' -- JSON string
    );
  `);

  // 인덱스 생성 (성능 최적화)
  db.exec(`
    -- Sessions 테이블 인덱스
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_channel_id ON sessions(channel_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_isolation ON sessions(isolation_level);
    CREATE INDEX IF NOT EXISTS idx_sessions_connection_id ON sessions(connection_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_channel_isolation ON sessions(channel_id, isolation_level);
    
    -- Live sessions 인덱스
    CREATE INDEX IF NOT EXISTS idx_live_sessions_live ON live_sessions(live);
    CREATE INDEX IF NOT EXISTS idx_live_sessions_last_update ON live_sessions(last_update);
    CREATE INDEX IF NOT EXISTS idx_live_sessions_live_date ON live_sessions(live, start_date);
    CREATE INDEX IF NOT EXISTS idx_live_sessions_sid_live ON live_sessions(sid, live);
    
    -- Roulette sessions 인덱스
    CREATE INDEX IF NOT EXISTS idx_roulette_sessions_sid ON roulette_sessions(sid);
    CREATE INDEX IF NOT EXISTS idx_roulette_sessions_channel_id ON roulette_sessions(channel_id);
    CREATE INDEX IF NOT EXISTS idx_roulette_sessions_token ON roulette_sessions(token);
    CREATE INDEX IF NOT EXISTS idx_roulette_sessions_created ON roulette_sessions(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_roulette_sessions_channel_sid ON roulette_sessions(channel_id, sid);
    
    -- Migration log 인덱스
    CREATE INDEX IF NOT EXISTS idx_migration_log_name ON migration_log(migration_name);
    CREATE INDEX IF NOT EXISTS idx_migration_log_status ON migration_log(status);
    CREATE INDEX IF NOT EXISTS idx_migration_log_executed ON migration_log(executed_at DESC);
    
    -- Channel tokens 인덱스
    CREATE INDEX IF NOT EXISTS idx_channel_tokens_channel_type ON channel_tokens(channel_id, token_type);
    CREATE INDEX IF NOT EXISTS idx_channel_tokens_value ON channel_tokens(token_value);
    CREATE INDEX IF NOT EXISTS idx_channel_tokens_sid ON channel_tokens(sid);
    CREATE INDEX IF NOT EXISTS idx_channel_tokens_active ON channel_tokens(active) WHERE active = 1;
    CREATE INDEX IF NOT EXISTS idx_channel_tokens_expires ON channel_tokens(expires_at) WHERE expires_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_channel_tokens_last_used ON channel_tokens(last_used DESC);
    CREATE INDEX IF NOT EXISTS idx_channel_tokens_channel_active ON channel_tokens(channel_id, active) WHERE active = 1;
    CREATE INDEX IF NOT EXISTS idx_channel_tokens_type_active ON channel_tokens(token_type, active) WHERE active = 1;
    
    -- 성능 최적화 인덱스 (SQLite용)
    CREATE INDEX IF NOT EXISTS idx_sessions_channel_user_active ON sessions(channel_id, user_id) 
      WHERE revoked = 0 AND (expires_at IS NULL OR expires_at > datetime('now'));
    CREATE INDEX IF NOT EXISTS idx_roulette_sessions_channel_created ON roulette_sessions(channel_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_channel_tokens_channel_type_active ON channel_tokens(channel_id, token_type, active) 
      WHERE active = 1;
    CREATE INDEX IF NOT EXISTS idx_sessions_active_by_channel ON sessions(channel_id, last_seen DESC) 
      WHERE revoked = 0 AND (expires_at IS NULL OR expires_at > datetime('now'));
    CREATE INDEX IF NOT EXISTS idx_channel_tokens_unexpired ON channel_tokens(channel_id, token_type, created_at DESC) 
      WHERE active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'));
    CREATE INDEX IF NOT EXISTS idx_roulette_sessions_recent ON roulette_sessions(channel_id, sid, created_at DESC) 
      WHERE created_at > datetime('now', '-7 days');
    CREATE INDEX IF NOT EXISTS idx_channel_tokens_usage_stats ON channel_tokens(channel_id, token_type, usage_count DESC, last_used DESC) 
      WHERE active = 1;
    CREATE INDEX IF NOT EXISTS idx_roulette_sessions_stats ON roulette_sessions(channel_id, roulette_name, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_channel_tokens_cleanup ON channel_tokens(expires_at, active) 
      WHERE expires_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_sessions_cleanup ON sessions(expires_at, revoked) 
      WHERE expires_at IS NOT NULL;
    
    -- 추가 성능 최적화 인덱스
    CREATE INDEX IF NOT EXISTS idx_live_sessions_cleanup ON live_sessions(last_update) WHERE live = 0;
    CREATE INDEX IF NOT EXISTS idx_live_sessions_active_by_update ON live_sessions(last_update DESC) WHERE live = 1;
    CREATE INDEX IF NOT EXISTS idx_attendance_sid_date ON attendance(sid, date);
    CREATE INDEX IF NOT EXISTS idx_attendance_state_sid_user ON attendance_state(sid, userId);
    CREATE INDEX IF NOT EXISTS idx_bot_rules_sid_enabled ON bot_rules(sid, enabled);
    CREATE INDEX IF NOT EXISTS idx_live_days_sid_date_desc ON live_days(sid, date DESC);
  `);
  // Migration: add requiredRoleLevel if missing
  try {
    const cols = db.prepare("PRAGMA table_info(bot_rules)").all();
    const hasReq = cols.some(c => c.name === 'requiredRoleLevel');
    if (!hasReq) {
      db.exec('ALTER TABLE bot_rules ADD COLUMN requiredRoleLevel INTEGER DEFAULT 1');
    }
    const hasPointsCost = cols.some(c => c.name === 'pointsCost');
    if (!hasPointsCost) {
      db.exec('ALTER TABLE bot_rules ADD COLUMN pointsCost INTEGER DEFAULT 0');
    }
  } catch {}
  // Attempt simple migration from legacy single-row table (id=1)
  try {
    const info = db.prepare("PRAGMA table_info(tokens)").all();
    const hasSid = info.some(c => c.name === 'sid');
    const hasId = info.some(c => c.name === 'id');
    if (hasId && !hasSid) {
      // Legacy table detected; rename and create new
      db.exec('ALTER TABLE tokens RENAME TO tokens_legacy');
      db.exec(`
        CREATE TABLE tokens (
          sid TEXT PRIMARY KEY,
          accessToken TEXT,
          refreshToken TEXT,
          tokenType TEXT,
          expiresAt TEXT
        );
      `);
      const legacy = db.prepare('SELECT accessToken, refreshToken, tokenType, expiresAt FROM tokens_legacy WHERE id = 1').get();
      if (legacy && legacy.accessToken) {
        // Migrate legacy tokens into a default sid 'default'
        db.prepare('INSERT OR REPLACE INTO tokens (sid, accessToken, refreshToken, tokenType, expiresAt) VALUES (?, ?, ?, ?, ?)')
          .run('default', legacy.accessToken, legacy.refreshToken, legacy.tokenType, legacy.expiresAt);
      }
      db.exec('DROP TABLE tokens_legacy');
    }
  } catch (e) {
    // ignore
  }
}

export function upsertTokens(sid, { accessToken, refreshToken, tokenType, expiresAt }) {
  db.prepare('INSERT OR REPLACE INTO tokens (sid, accessToken, refreshToken, tokenType, expiresAt) VALUES (?, ?, ?, ?, ?)')
    .run(sid, protectSecret(accessToken), protectSecret(refreshToken), tokenType, expiresAt);
}

export function getTokens(sid) {
  const row = db.prepare('SELECT accessToken, refreshToken, tokenType, expiresAt FROM tokens WHERE sid = ?').get(sid);
  if (!row || !row.accessToken) return null;
  const accessToken = revealSecret(row.accessToken);
  const refreshToken = revealSecret(row.refreshToken);
  if (accessToken === row.accessToken || refreshToken === row.refreshToken) {
    const nextAccessToken = protectSecret(accessToken);
    const nextRefreshToken = protectSecret(refreshToken);
    if (nextAccessToken !== row.accessToken || nextRefreshToken !== row.refreshToken) {
      db.prepare('UPDATE tokens SET accessToken = ?, refreshToken = ? WHERE sid = ?')
        .run(nextAccessToken, nextRefreshToken, sid);
    }
  }
  return { ...row, accessToken, refreshToken };
}

export function updateTokens(sid, tokensOrNull) {
  if (!tokensOrNull) {
    db.prepare('DELETE FROM tokens WHERE sid = ?').run(sid);
    return;
  }
  const { accessToken, refreshToken, tokenType, expiresAt } = tokensOrNull;
  upsertTokens(sid, { accessToken, refreshToken, tokenType, expiresAt });
}

export async function revokeTokens({ clientId, clientSecret, token, tokenTypeHint = 'access_token', baseUrl }) {
  const url = `${baseUrl}/auth/v1/token/revoke`;
  await axios.post(url, {
    clientId,
    clientSecret,
    token,
    tokenTypeHint
  }, {
    headers: { 'Content-Type': 'application/json' }
  });
}

// Settings helpers
export function getBotSettings(sid) {
  const row = db.prepare('SELECT settings FROM bot_settings WHERE sid = ?').get(sid);
  if (!row || !row.settings) return {};
  try { return JSON.parse(row.settings); } catch { return {}; }
}

export function setBotSettings(sid, settingsObj) {
  const settings = JSON.stringify(settingsObj || {});
  db.prepare('INSERT OR REPLACE INTO bot_settings (sid, settings) VALUES (?, ?)').run(sid, settings);
}

// Stats helpers
export function getBotStats(sid) {
  const row = db.prepare('SELECT messagesProcessed, commandsHandled, lastActive FROM bot_stats WHERE sid = ?').get(sid);
  if (!row) return { messagesProcessed: 0, commandsHandled: 0, lastActive: null };
  return row;
}

export function updateBotStats(sid, delta = { messagesProcessed: 0, commandsHandled: 0 }) {
  const current = getBotStats(sid);
  const next = {
    messagesProcessed: (current.messagesProcessed || 0) + (delta.messagesProcessed || 0),
    commandsHandled: (current.commandsHandled || 0) + (delta.commandsHandled || 0),
    lastActive: new Date().toISOString()
  };
  db.prepare('INSERT OR REPLACE INTO bot_stats (sid, messagesProcessed, commandsHandled, lastActive) VALUES (?, ?, ?, ?)')
    .run(sid, next.messagesProcessed, next.commandsHandled, next.lastActive);
  return next;
}

// Rules helpers
export function getBotRules(sid) {
  const rows = db.prepare('SELECT id, name, keywords, responses, enabled, adminOnly, requiredRoleLevel, pointsCost, cooldown, lastUsed FROM bot_rules WHERE sid = ? ORDER BY rowid ASC').all(sid);
  return rows.map(r => ({
    id: r.id,
    name: r.name || '',
    keywords: safeParseJson(r.keywords, []),
    responses: safeParseJson(r.responses, []),
    enabled: !!r.enabled,
    adminOnly: !!r.adminOnly,
    requiredRoleLevel: Number(r.requiredRoleLevel || 1),
    pointsCost: Math.max(0, Number(r.pointsCost || 0)),
    cooldown: Number(r.cooldown || 1000),
    lastUsed: Number(r.lastUsed || 0),
  }));
}

export function upsertBotRule(sid, rule) {
  const keywords = JSON.stringify(rule.keywords || []);
  const responses = JSON.stringify(rule.responses || []);
  const cooldown = Math.max(1000, Number(rule.cooldown || 0));
  const requiredRoleLevel = Math.max(1, Math.min(4, Number(rule.requiredRoleLevel || 1)));
  const pointsCost = Math.max(0, Number(rule.pointsCost || 0));
  db.prepare(`
    INSERT INTO bot_rules (sid, id, name, keywords, responses, enabled, adminOnly, requiredRoleLevel, pointsCost, cooldown, lastUsed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sid, id) DO UPDATE SET
      name=excluded.name,
      keywords=excluded.keywords,
      responses=excluded.responses,
      enabled=excluded.enabled,
      adminOnly=excluded.adminOnly,
      requiredRoleLevel=excluded.requiredRoleLevel,
      pointsCost=excluded.pointsCost,
      cooldown=excluded.cooldown,
      lastUsed=excluded.lastUsed
  `).run(sid, rule.id, rule.name || '', keywords, responses, rule.enabled ? 1 : 0, rule.adminOnly ? 1 : 0, requiredRoleLevel, pointsCost, cooldown, Number(rule.lastUsed || 0));
}

export function deleteBotRule(sid, id) {
  db.prepare('DELETE FROM bot_rules WHERE sid = ? AND id = ?').run(sid, id);
}

function safeParseJson(s, fallback) {
  try { return s ? JSON.parse(s) : fallback; } catch { return fallback; }
}

// Attendance helpers
export function markLiveDay(sid, date) {
  db.prepare('INSERT OR IGNORE INTO live_days (sid, date) VALUES (?, ?)').run(sid, date);
}

export function recordAttendanceAndGetStreak(sid, userId, username, today) {
  // If already checked in today, return current streak
  const existing = db.prepare('SELECT 1 FROM attendance WHERE sid = ? AND userId = ? AND date = ?').get(sid, userId, today);
  if (existing) {
    const st = db.prepare('SELECT streak FROM attendance_state WHERE sid = ? AND userId = ?').get(sid, userId);
    return { streak: st?.streak || 0, isNew: false };
  }
  // Record today's attendance
  db.prepare('INSERT OR IGNORE INTO attendance (sid, userId, date, username) VALUES (?, ?, ?, ?)')
    .run(sid, userId, today, username);

  // Find previous live day before today
  const prevLive = db.prepare('SELECT date FROM live_days WHERE sid = ? AND date < ? ORDER BY date DESC LIMIT 1').get(sid, today);
  const state = db.prepare('SELECT lastDate, streak FROM attendance_state WHERE sid = ? AND userId = ?').get(sid, userId);
  let nextStreak = 1;
  if (state && state.lastDate && prevLive && prevLive.date) {
    if (state.lastDate === prevLive.date) {
      nextStreak = Math.max(1, (state.streak || 0) + 1);
    }
  } else if (state && state.lastDate && !prevLive) {
    // No previous live days recorded -> start at 1
    nextStreak = 1;
  }
  db.prepare('INSERT INTO attendance_state (sid, userId, lastDate, streak) VALUES (?, ?, ?, ?)\n             ON CONFLICT(sid, userId) DO UPDATE SET lastDate=excluded.lastDate, streak=excluded.streak')
    .run(sid, userId, today, nextStreak);
  return { streak: nextStreak, isNew: true };
}

// =============================
// Live Sessions (방송 세션 상태 관리)
// =============================

// 특정 SID의 라이브 세션 정보 조회
export function getLiveSessionFromDB(sid) {
  const row = db.prepare('SELECT * FROM live_sessions WHERE sid = ?').get(sid);
  if (!row) return null;
  
  return {
    sid: row.sid,
    live: !!row.live,
    start_date: row.start_date,
    session_start_time: row.session_start_time,
    last_update: row.last_update,
    created_at: row.created_at
  };
}

// 라이브 세션 정보 업서트 (생성 또는 업데이트)
export function upsertLiveSessionToDB(sessionData) {
  const { sid, live, start_date, session_start_time, last_update } = sessionData;
  
  db.prepare(`
    INSERT INTO live_sessions (sid, live, start_date, session_start_time, last_update)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(sid) DO UPDATE SET
      live = excluded.live,
      start_date = excluded.start_date,
      session_start_time = excluded.session_start_time,
      last_update = excluded.last_update
  `).run(
    sid,
    live ? 1 : 0,
    start_date || null,
    session_start_time || null,
    last_update || Date.now()
  );
}

// 특정 SID의 마지막 업데이트 시간만 갱신
export function updateLiveSessionLastUpdate(sid, timestamp) {
  db.prepare('UPDATE live_sessions SET last_update = ? WHERE sid = ?')
    .run(timestamp, sid);
}

// 활성 라이브 세션들 조회 (live = 1)
export function getActiveLiveSessionsFromDB() {
  const rows = db.prepare('SELECT * FROM live_sessions WHERE live = 1 ORDER BY last_update DESC').all();
  
  return rows.map(row => ({
    sid: row.sid,
    live: !!row.live,
    start_date: row.start_date,
    session_start_time: row.session_start_time,
    last_update: row.last_update,
    created_at: row.created_at
  }));
}

// 오래된 라이브 세션들 삭제 (cutoff 시간 이전)
export function deleteOldLiveSessionsFromDB(cutoff) {
  db.prepare('DELETE FROM live_sessions WHERE last_update < ? AND live = 0')
    .run(cutoff);
}

// 백엔드 시작 시 세션 복원 로직
export function initializeLiveSessionsOnStartup() {
  try {
    console.log('[Session] Initializing live sessions from DB...');
    
    // DB에서 활성 세션 조회
    const activeSessions = getActiveLiveSessionsFromDB();
    
    console.log(`[Session] Found ${activeSessions.length} active sessions in DB`);
    
    // 오래된 세션 정리 (24시간 이상)
    cleanupOldSessions();
    
    return activeSessions;
  } catch (error) {
    console.error('[Session] Failed to initialize from DB:', error);
    return [];
  }
}

// 오래된 세션 정리 함수
export function cleanupOldSessions() {
  const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24시간 전
  
  try {
    deleteOldLiveSessionsFromDB(cutoff);
    console.log('[Session] Cleaned up old sessions from DB');
  } catch (error) {
    console.error('[Session] Failed to cleanup old sessions:', error);
  }
}

// =============================
// 멀티 방송 지원: 세션 및 채널 관리
// =============================

// 세션 생성/업데이트
export function upsertSession(sid, userId, channelId = null, options = {}) {
  const {
    isolationLevel = 'strict',
    connectionId = null,
    expiresAt = null,
    lastSeen = new Date().toISOString()
  } = options;
  
  db.prepare(`
    INSERT INTO sessions (sid, user_id, channel_id, isolation_level, connection_id, last_seen, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sid) DO UPDATE SET
      user_id = excluded.user_id,
      channel_id = excluded.channel_id,
      isolation_level = excluded.isolation_level,
      connection_id = excluded.connection_id,
      last_seen = excluded.last_seen,
      expires_at = excluded.expires_at
  `).run(sid, userId, channelId, isolationLevel, connectionId, lastSeen, expiresAt);
}

// 세션 조회
export function getSession(sid) {
  const row = db.prepare('SELECT * FROM sessions WHERE sid = ? AND revoked = 0').get(sid);
  if (!row) return null;
  
  // 만료 확인
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return null;
  }
  
  return {
    sid: row.sid,
    userId: row.user_id,
    channelId: row.channel_id,
    isolationLevel: row.isolation_level,
    connectionId: row.connection_id,
    createdAt: row.created_at,
    lastSeen: row.last_seen,
    expiresAt: row.expires_at,
    revoked: !!row.revoked
  };
}

// 채널 ID로 세션 조회
export function getSessionsByChannelId(channelId) {
  const rows = db.prepare(`
    SELECT * FROM sessions 
    WHERE channel_id = ? AND revoked = 0 
    AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY last_seen DESC
  `).all(channelId);
  
  return rows.map(row => ({
    sid: row.sid,
    userId: row.user_id,
    channelId: row.channel_id,
    isolationLevel: row.isolation_level,
    connectionId: row.connection_id,
    createdAt: row.created_at,
    lastSeen: row.last_seen,
    expiresAt: row.expires_at,
    revoked: !!row.revoked
  }));
}

// 룰렛 세션 저장 (채널 ID 포함)
export function insertRouletteSession(sessionData) {
  const {
    sid,
    channelId,
    token,
    rouletteName,
    userId,
    username,
    resultLabel,
    resultValue,
    createdAt = new Date().toISOString()
  } = sessionData;
  
  const result = db.prepare(`
    INSERT INTO roulette_sessions 
    (sid, channel_id, token, roulette_name, user_id, username, result_label, result_value, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sid, channelId, token, rouletteName, userId, username, resultLabel, resultValue, createdAt);
  
  return result.lastInsertRowid;
}

// 채널별 룰렛 세션 조회
export function getRouletteSessionsByChannel(channelId, limit = 100) {
  const rows = db.prepare(`
    SELECT * FROM roulette_sessions 
    WHERE channel_id = ? 
    ORDER BY created_at DESC 
    LIMIT ?
  `).all(channelId, limit);
  
  return rows.map(row => ({
    id: row.id,
    sid: row.sid,
    channelId: row.channel_id,
    token: row.token,
    rouletteName: row.roulette_name,
    userId: row.user_id,
    username: row.username,
    resultLabel: row.result_label,
    resultValue: row.result_value,
    createdAt: row.created_at
  }));
}

// 마이그레이션 로그 기록
export function logMigration(migrationName, status, details = null, executionTimeMs = null) {
  if (!db) return;
  db.prepare(`
    INSERT INTO migration_log (migration_name, status, details, execution_time_ms)
    VALUES (?, ?, ?, ?)
  `).run(migrationName, status, details ? JSON.stringify(details) : null, executionTimeMs);
}

// =============================
// 채널 토큰 관리 함수들
// =============================

// 채널 토큰 생성
export function generateChannelToken(channelId, tokenType, sid, expiresHours = null) {
  // 토큰 타입 검증
  const validTypes = ['roulette', 'pvd', 'api'];
  if (!validTypes.includes(tokenType)) {
    throw new Error(`Invalid token type: ${tokenType}`);
  }
  
  // 고유한 토큰 생성
  let token;
  let attempts = 0;
  const maxAttempts = 10;
  
  do {
    token = crypto.randomBytes(32).toString('hex');
    attempts++;
    
    if (attempts > maxAttempts) {
      throw new Error('Failed to generate unique token');
    }
  } while (db.prepare('SELECT 1 FROM channel_tokens WHERE token_value = ?').get(token));
  
  // 만료 시간 계산
  const expiresAt = expiresHours ? 
    new Date(Date.now() + expiresHours * 60 * 60 * 1000).toISOString() : 
    null;
  
  // 토큰 저장
  const result = db.prepare(`
    INSERT INTO channel_tokens (channel_id, token_type, token_value, sid, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(channelId, tokenType, token, sid, expiresAt);
  
  console.log(`[Token] Generated ${tokenType} token for channel ${channelId}: ${token.substring(0, 8)}...`);
  
  return {
    token,
    id: result.lastInsertRowid,
    channelId,
    tokenType,
    sid,
    expiresAt
  };
}

// 채널 토큰 검증
export function validateChannelToken(tokenValue, expectedChannelId = null) {
  const row = db.prepare(`
    SELECT * FROM channel_tokens 
    WHERE token_value = ? 
      AND active = 1 
      AND (expires_at IS NULL OR expires_at > datetime('now'))
  `).get(tokenValue);
  
  if (!row) {
    return {
      valid: false,
      error: 'Token not found or expired'
    };
  }
  
  // 채널 ID 검증 (선택적)
  if (expectedChannelId && row.channel_id !== expectedChannelId) {
    return {
      valid: false,
      error: 'Channel mismatch'
    };
  }
  
  // 사용 횟수 증가
  db.prepare(`
    UPDATE channel_tokens 
    SET usage_count = usage_count + 1, last_used = datetime('now')
    WHERE token_value = ?
  `).run(tokenValue);
  
  return {
    valid: true,
    channelId: row.channel_id,
    tokenType: row.token_type,
    sid: row.sid,
    usageCount: row.usage_count + 1,
    metadata: row.metadata ? JSON.parse(row.metadata) : {}
  };
}

// 채널의 활성 토큰 조회
export function getActiveChannelTokens(channelId, tokenType = null) {
  let query = `
    SELECT * FROM channel_tokens 
    WHERE channel_id = ? 
      AND active = 1 
      AND (expires_at IS NULL OR expires_at > datetime('now'))
  `;
  const params = [channelId];
  
  if (tokenType) {
    query += ' AND token_type = ?';
    params.push(tokenType);
  }
  
  query += ' ORDER BY created_at DESC';
  
  const rows = db.prepare(query).all(...params);
  
  return rows.map(row => ({
    id: row.id,
    channelId: row.channel_id,
    tokenType: row.token_type,
    tokenValue: row.token_value,
    sid: row.sid,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsed: row.last_used,
    active: !!row.active,
    usageCount: row.usage_count,
    metadata: row.metadata ? JSON.parse(row.metadata) : {}
  }));
}

// 토큰 비활성화
export function deactivateChannelToken(tokenValue) {
  const result = db.prepare(`
    UPDATE channel_tokens 
    SET active = 0 
    WHERE token_value = ?
  `).run(tokenValue);
  
  return result.changes > 0;
}

// 채널의 모든 토큰 비활성화
export function deactivateChannelTokens(channelId, tokenType = null) {
  let query = 'UPDATE channel_tokens SET active = 0 WHERE channel_id = ?';
  const params = [channelId];
  
  if (tokenType) {
    query += ' AND token_type = ?';
    params.push(tokenType);
  }
  
  const result = db.prepare(query).run(...params);
  
  console.log(`[Token] Deactivated ${result.changes} tokens for channel ${channelId}${tokenType ? ` (type: ${tokenType})` : ''}`);
  
  return result.changes;
}

// 만료된 토큰 정리
export function cleanupExpiredTokens() {
  // 만료된 토큰 비활성화
  const deactivateResult = db.prepare(`
    UPDATE channel_tokens 
    SET active = 0 
    WHERE expires_at IS NOT NULL 
      AND expires_at < datetime('now') 
      AND active = 1
  `).run();
  
  // 30일 이상 된 비활성 토큰 삭제
  const deleteResult = db.prepare(`
    DELETE FROM channel_tokens 
    WHERE active = 0 
      AND created_at < datetime('now', '-30 days')
  `).run();
  
  if (deactivateResult.changes > 0 || deleteResult.changes > 0) {
    console.log(`[Token Cleanup] Deactivated ${deactivateResult.changes} expired tokens, deleted ${deleteResult.changes} old tokens`);
  }
  
  return {
    deactivated: deactivateResult.changes,
    deleted: deleteResult.changes
  };
}

// 채널 토큰 통계
export function getChannelTokenStats(channelId = null) {
  let query = `
    SELECT 
      channel_id,
      token_type,
      COUNT(*) as total_tokens,
      SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active_tokens,
      SUM(CASE WHEN expires_at IS NOT NULL AND expires_at < datetime('now') THEN 1 ELSE 0 END) as expired_tokens,
      AVG(usage_count) as avg_usage_count,
      MAX(last_used) as last_activity
    FROM channel_tokens
  `;
  const params = [];
  
  if (channelId) {
    query += ' WHERE channel_id = ?';
    params.push(channelId);
  }
  
  query += ' GROUP BY channel_id, token_type ORDER BY channel_id, token_type';
  
  const rows = db.prepare(query).all(...params);
  
  return rows.map(row => ({
    channelId: row.channel_id,
    tokenType: row.token_type,
    totalTokens: row.total_tokens,
    activeTokens: row.active_tokens,
    expiredTokens: row.expired_tokens,
    avgUsageCount: Math.round(row.avg_usage_count * 100) / 100,
    lastActivity: row.last_activity
  }));
}

// 채널 ID 데이터 마이그레이션 (SQLite용)
export function migrateChannelIdDataSQLite() {
  console.log('[SQLite Migration] Starting channel ID data migration...');
  if (!db) {
    console.warn('[SQLite Migration] SQLite database is not initialized; skipping migration');
    return { skipped: true };
  }
  
  try {
    // 기존 데이터가 있는지 확인
    const sessionCount = db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
    const rouletteCount = db.prepare('SELECT COUNT(*) as count FROM roulette_sessions').get().count;
    const tokenCount = db.prepare('SELECT COUNT(*) as count FROM channel_tokens').get().count;
    
    console.log(`[SQLite Migration] Found ${sessionCount} sessions, ${rouletteCount} roulette sessions, ${tokenCount} channel tokens`);
    
    // 마이그레이션 로그 기록
    logMigration('sqlite_channel_tokens_migration', 'success', {
      sessions_count: sessionCount,
      roulette_sessions_count: rouletteCount,
      channel_tokens_count: tokenCount,
      description: 'SQLite schema updated with channel_tokens table'
    });
    
    console.log('[SQLite Migration] Channel tokens migration completed successfully');
    
  } catch (error) {
    console.error('[SQLite Migration] Migration failed:', error);
    
    logMigration('sqlite_channel_tokens_migration', 'failed', {
      error: error.message
    });
    
    throw error;
  }
}

// 토큰 정리 스케줄러 시작
export function startTokenCleanupScheduler() {
  if (!db) {
    console.warn('[Token Scheduler] SQLite database is not initialized; cleanup scheduler disabled');
    return null;
  }
  // 1시간마다 만료된 토큰 정리
  const cleanupInterval = 60 * 60 * 1000; // 1시간
  
  const cleanup = () => {
    try {
      const result = cleanupExpiredTokens();
      if (result.deactivated > 0 || result.deleted > 0) {
        console.log(`[Token Scheduler] Cleanup completed: ${result.deactivated} deactivated, ${result.deleted} deleted`);
      }
    } catch (error) {
      console.error('[Token Scheduler] Cleanup failed:', error);
    }
  };
  
  // 즉시 한 번 실행
  cleanup();
  
  // 주기적 실행
  const intervalId = setInterval(cleanup, cleanupInterval);
  
  console.log('[Token Scheduler] Token cleanup scheduler started (interval: 1 hour)');
  
  return intervalId;
}

// =============================
// 성능 모니터링 및 최적화 함수들
// =============================

// 채널 성능 통계 조회
export function getChannelPerformanceStats(channelId = null) {
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
      AND rs.created_at > datetime('now', '-1 day')
    LEFT JOIN channel_tokens ct ON s.channel_id = ct.channel_id 
      AND ct.active = 1
    WHERE s.revoked = 0 
      AND (s.expires_at IS NULL OR s.expires_at > datetime('now'))
      AND s.channel_id IS NOT NULL
  `;
  const params = [];
  
  if (channelId) {
    query += ' AND s.channel_id = ?';
    params.push(channelId);
  }
  
  query += ' GROUP BY s.channel_id ORDER BY active_sessions DESC';
  
  const rows = db.prepare(query).all(...params);
  
  return rows.map(row => ({
    channelId: row.channel_id,
    activeSessions: row.active_sessions,
    rouletteSessionsToday: row.roulette_sessions_today,
    activeTokens: row.active_tokens,
    avgTokenUsage: Math.round((row.avg_token_usage || 0) * 100) / 100,
    lastActivity: row.last_activity
  }));
}

// 데이터베이스 성능 분석
export function analyzeDatabasePerformance() {
  try {
    // 테이블 크기 정보
    const tableStats = db.prepare(`
      SELECT 
        name as table_name,
        (SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND tbl_name=name) as index_count
      FROM sqlite_master 
      WHERE type='table' 
        AND name IN ('sessions', 'channel_tokens', 'roulette_sessions', 'migration_log')
      ORDER BY name
    `).all();
    
    // 인덱스 사용률 분석 (SQLite는 제한적)
    const indexInfo = [];
    for (const table of tableStats) {
      const indexes = db.prepare(`
        SELECT name, sql 
        FROM sqlite_master 
        WHERE type='index' AND tbl_name=? AND name NOT LIKE 'sqlite_%'
      `).all(table.table_name);
      
      indexInfo.push({
        tableName: table.table_name,
        indexCount: table.index_count,
        indexes: indexes.map(idx => ({
          name: idx.name,
          definition: idx.sql
        }))
      });
    }
    
    return {
      tableStats,
      indexInfo,
      recommendations: generatePerformanceRecommendations(tableStats)
    };
    
  } catch (error) {
    console.error('[Performance Analysis] Failed to analyze database:', error);
    return {
      tableStats: [],
      indexInfo: [],
      recommendations: [],
      error: error.message
    };
  }
}

// 성능 최적화 권장사항 생성
function generatePerformanceRecommendations(tableStats) {
  const recommendations = [];
  
  // 기본 권장사항
  recommendations.push({
    category: 'Maintenance',
    recommendation: 'Run VACUUM periodically to reclaim space',
    priority: 'Medium',
    estimatedImpact: 'Improved storage efficiency'
  });
  
  recommendations.push({
    category: 'Statistics',
    recommendation: 'Run ANALYZE to update query planner statistics',
    priority: 'Low',
    estimatedImpact: 'Better query planning'
  });
  
  // 테이블별 권장사항
  for (const table of tableStats) {
    if (table.index_count < 3) {
      recommendations.push({
        category: 'Indexing',
        recommendation: `Consider adding more indexes to ${table.table_name}`,
        priority: 'Low',
        estimatedImpact: 'Faster queries'
      });
    }
  }
  
  return recommendations.sort((a, b) => {
    const priorityOrder = { 'High': 1, 'Medium': 2, 'Low': 3 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

// 데이터베이스 최적화 실행
export function optimizeDatabase() {
  console.log('[DB Optimization] Starting database optimization...');
  if (!db) {
    console.warn('[DB Optimization] SQLite database is not initialized; skipping optimization');
    return { success: false, skipped: true, reason: 'sqlite_not_initialized' };
  }
  
  try {
    const startTime = Date.now();
    
    // VACUUM 실행 (공간 회수)
    console.log('[DB Optimization] Running VACUUM...');
    db.exec('VACUUM');
    
    // ANALYZE 실행 (통계 업데이트)
    console.log('[DB Optimization] Running ANALYZE...');
    db.exec('ANALYZE');
    
    // 성능 통계 업데이트
    console.log('[DB Optimization] Updating performance statistics...');
    const stats = analyzeDatabasePerformance();
    
    const executionTime = Date.now() - startTime;
    
    // 최적화 로그 기록
    logMigration('database_optimization', 'success', {
      execution_time_ms: executionTime,
      table_count: stats.tableStats.length,
      index_count: stats.indexInfo.reduce((sum, table) => sum + table.indexCount, 0),
      recommendations_count: stats.recommendations.length
    }, executionTime);
    
    console.log(`[DB Optimization] Optimization completed in ${executionTime}ms`);
    
    return {
      success: true,
      executionTime,
      stats
    };
    
  } catch (error) {
    console.error('[DB Optimization] Optimization failed:', error);
    
    logMigration('database_optimization', 'failed', {
      error: error.message
    });
    
    return {
      success: false,
      error: error.message
    };
  }
}

// 성능 모니터링 스케줄러 시작
export function startPerformanceMonitoringScheduler() {
  if (!db) {
    console.warn('[Performance Monitor] SQLite database is not initialized; monitoring scheduler disabled');
    return null;
  }
  // 6시간마다 성능 분석 실행
  const monitoringInterval = 6 * 60 * 60 * 1000; // 6시간
  
  const monitor = () => {
    try {
      const stats = getChannelPerformanceStats();
      const dbStats = analyzeDatabasePerformance();
      
      console.log(`[Performance Monitor] Active channels: ${stats.length}`);
      
      // 성능 이슈 감지
      const highUsageChannels = stats.filter(s => s.activeSessions > 10 || s.activeTokens > 50);
      if (highUsageChannels.length > 0) {
        console.log(`[Performance Monitor] High usage channels detected: ${highUsageChannels.length}`);
      }
      
      // 권장사항이 있으면 로그 출력
      if (dbStats.recommendations.length > 0) {
        const highPriorityRecs = dbStats.recommendations.filter(r => r.priority === 'High');
        if (highPriorityRecs.length > 0) {
          console.log(`[Performance Monitor] High priority recommendations: ${highPriorityRecs.length}`);
        }
      }
      
    } catch (error) {
      console.error('[Performance Monitor] Monitoring failed:', error);
    }
  };
  
  // 즉시 한 번 실행
  monitor();
  
  // 주기적 실행
  const intervalId = setInterval(monitor, monitoringInterval);
  
  console.log('[Performance Monitor] Performance monitoring scheduler started (interval: 6 hours)');
  
  return intervalId;
}

// =============================
// 배치 처리 함수들 (성능 최적화)
// =============================

// 여러 세션을 배치로 업데이트
export function batchUpdateLiveSessionsLastUpdate(sessionUpdates) {
  if (!Array.isArray(sessionUpdates) || sessionUpdates.length === 0) {
    return;
  }
  
  const stmt = db.prepare('UPDATE live_sessions SET last_update = ? WHERE sid = ?');
  const transaction = db.transaction((updates) => {
    for (const { sid, timestamp } of updates) {
      stmt.run(timestamp, sid);
    }
  });
  
  try {
    transaction(sessionUpdates);
    console.log(`[Session-DB] Batch updated ${sessionUpdates.length} session timestamps`);
  } catch (error) {
    console.error('[Session-DB] Batch update failed:', error);
    throw error;
  }
}

// 여러 세션을 배치로 업서트
export function batchUpsertLiveSessions(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return;
  }
  
  const stmt = db.prepare(`
    INSERT INTO live_sessions (sid, live, start_date, session_start_time, last_update)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(sid) DO UPDATE SET
      live = excluded.live,
      start_date = excluded.start_date,
      session_start_time = excluded.session_start_time,
      last_update = excluded.last_update
  `);
  
  const transaction = db.transaction((sessionList) => {
    for (const session of sessionList) {
      const { sid, live, start_date, session_start_time, last_update } = session;
      stmt.run(
        sid,
        live ? 1 : 0,
        start_date || null,
        session_start_time || null,
        last_update || Date.now()
      );
    }
  });
  
  try {
    transaction(sessions);
    console.log(`[Session-DB] Batch upserted ${sessions.length} sessions`);
  } catch (error) {
    console.error('[Session-DB] Batch upsert failed:', error);
    throw error;
  }
}

// 배치로 출석 기록 처리
export function batchRecordAttendance(attendanceRecords) {
  if (!Array.isArray(attendanceRecords) || attendanceRecords.length === 0) {
    return [];
  }
  
  const insertStmt = db.prepare('INSERT OR IGNORE INTO attendance (sid, userId, date, username) VALUES (?, ?, ?, ?)');
  const selectStmt = db.prepare('SELECT streak FROM attendance_state WHERE sid = ? AND userId = ?');
  const upsertStateStmt = db.prepare(`
    INSERT INTO attendance_state (sid, userId, lastDate, streak) VALUES (?, ?, ?, ?)
    ON CONFLICT(sid, userId) DO UPDATE SET lastDate=excluded.lastDate, streak=excluded.streak
  `);
  
  const transaction = db.transaction((records) => {
    const results = [];
    
    for (const { sid, userId, username, date } of records) {
      // 출석 기록 삽입 (중복 무시)
      const insertResult = insertStmt.run(sid, userId, date, username);
      const isNew = insertResult.changes > 0;
      
      if (isNew) {
        // 새로운 출석인 경우 스트릭 계산
        const currentState = selectStmt.get(sid, userId);
        const newStreak = (currentState?.streak || 0) + 1;
        
        upsertStateStmt.run(sid, userId, date, newStreak);
        results.push({ sid, userId, streak: newStreak, isNew: true });
      } else {
        // 이미 출석한 경우 현재 스트릭 반환
        const currentState = selectStmt.get(sid, userId);
        results.push({ sid, userId, streak: currentState?.streak || 0, isNew: false });
      }
    }
    
    return results;
  });
  
  try {
    const results = transaction(attendanceRecords);
    console.log(`[Attendance-DB] Batch processed ${attendanceRecords.length} attendance records`);
    return results;
  } catch (error) {
    console.error('[Attendance-DB] Batch processing failed:', error);
    throw error;
  }
}

// DB 연결 풀링 최적화 설정
export function optimizeDbConnection() {
  if (!db) return;
  
  try {
    // WAL 모드 최적화 설정
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL'); // 성능과 안정성의 균형
    db.pragma('cache_size = -64000'); // 64MB 캐시
    db.pragma('temp_store = MEMORY'); // 임시 테이블을 메모리에 저장
    db.pragma('mmap_size = 268435456'); // 256MB 메모리 맵
    db.pragma('optimize'); // 통계 최적화
    
    console.log('[DB] Connection optimized for performance');
  } catch (error) {
    console.error('[DB] Failed to optimize connection:', error);
  }
}

// 주기적 DB 최적화 실행
export function performPeriodicOptimization() {
  try {
    // VACUUM 및 ANALYZE 실행 (주의: 큰 DB에서는 시간이 오래 걸릴 수 있음)
    db.exec('PRAGMA optimize');
    
    // 통계 업데이트
    db.exec('ANALYZE');
    
    console.log('[DB] Periodic optimization completed');
  } catch (error) {
    console.error('[DB] Periodic optimization failed:', error);
  }
}
