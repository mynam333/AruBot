import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import pkg from 'pg';
import fs from 'fs';
import path from 'path';
const { Client, Pool } = pkg;

let supabase;
let storageClient;
let columnCache = new Map(); // key: table, value: Set of column names
let pgPool = null;
let pgPoolUrl = null;

const DB_PROVIDER_SUPABASE = 'supabase';
const DB_PROVIDER_POSTGRES = 'postgres';

export function getDbProvider() {
  const provider = String(process.env.ARUBOT_DB_PROVIDER || DB_PROVIDER_SUPABASE).trim().toLowerCase();
  return provider === DB_PROVIDER_POSTGRES ? DB_PROVIDER_POSTGRES : DB_PROVIDER_SUPABASE;
}

export function isPostgresProvider() {
  return getDbProvider() === DB_PROVIDER_POSTGRES;
}

function looksLikeOfficialSupabaseDatabaseUrl(dbUrl) {
  try {
    const parsed = new URL(dbUrl);
    const host = parsed.hostname.toLowerCase();
    return host.includes('supabase.co') || host.includes('supabase.com');
  } catch {
    return false;
  }
}

function validateDatabaseUrlForProvider(provider, dbUrl) {
  if (
    provider === DB_PROVIDER_POSTGRES &&
    dbUrl &&
    looksLikeOfficialSupabaseDatabaseUrl(dbUrl) &&
    String(process.env.ARUBOT_ALLOW_SUPABASE_POSTGRES_URL || '').trim().toLowerCase() !== 'true'
  ) {
    throw new Error('POSTGRES_URL points to an official Supabase host. Use a local/self-hosted Postgres URL for ARUBOT_DB_PROVIDER=postgres, or set ARUBOT_ALLOW_SUPABASE_POSTGRES_URL=true only for an explicit one-off diagnostic shell.');
  }
  return dbUrl;
}

const PG_CONNECT_TIMEOUT_MS = Math.max(1000, Number(
  process.env.POSTGRES_CONNECT_TIMEOUT_MS ||
  process.env.SUPABASE_DB_CONNECT_TIMEOUT_MS ||
  5000
));
const PG_STATEMENT_TIMEOUT_MS = Math.max(1000, Number(
  process.env.POSTGRES_STATEMENT_TIMEOUT_MS ||
  process.env.SUPABASE_DB_STATEMENT_TIMEOUT_MS ||
  15000
));
const PG_IDLE_TIMEOUT_MS = Math.max(1000, Number(
  process.env.POSTGRES_IDLE_TIMEOUT_MS ||
  process.env.SUPABASE_DB_IDLE_TIMEOUT_MS ||
  30000
));
const PG_POOL_MAX = Math.max(1, Number(
  process.env.POSTGRES_POOL_MAX ||
  process.env.SUPABASE_DB_POOL_MAX ||
  10
));

function getDbUrl() {
  const provider = getDbProvider();
  const dbUrl = provider === DB_PROVIDER_POSTGRES
    ? (process.env.POSTGRES_RUNTIME_URL || process.env.POSTGRES_URL || '')
    : (process.env.SUPABASE_DB_URL || '');
  return validateDatabaseUrlForProvider(provider, dbUrl);
}

function getSupabaseStorageClient() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const bucket = String(process.env.DRAWING_DONATION_STORAGE_BUCKET || process.env.ARUBOT_STORAGE_BUCKET || '').trim();
  if (!url || !key || !bucket) return null;
  if (isPostgresProvider() && String(process.env.ARUBOT_ALLOW_SUPABASE_ENV_WITH_POSTGRES || '').trim().toLowerCase() !== 'true') return null;
  if (!storageClient) {
    storageClient = createClient(url, key, { auth: { persistSession: false } });
  }
  return { client: storageClient, bucket };
}

function collectDrawingDonationObjectKeys(item) {
  return uniqueNonEmpty([
    item?.strokeObjectKey,
    item?.stroke_object_key,
    item?.previewObjectKey,
    item?.preview_object_key,
  ]);
}

export async function deleteDrawingDonationObjectKeys(keys = []) {
  const objectKeys = uniqueNonEmpty(keys);
  const storage = getSupabaseStorageClient();
  if (!objectKeys.length || !storage) return { deleted: 0, skipped: objectKeys.length };
  let deleted = 0;
  for (let index = 0; index < objectKeys.length; index += 100) {
    const chunk = objectKeys.slice(index, index + 100);
    const { error } = await storage.client.storage.from(storage.bucket).remove(chunk);
    if (error) throw new Error(error.message || 'drawing_storage_delete_failed');
    deleted += chunk.length;
  }
  return { deleted, skipped: 0 };
}

function providerSslEnv(provider) {
  return provider === DB_PROVIDER_POSTGRES
    ? process.env.POSTGRES_SSL
    : process.env.SUPABASE_DB_SSL;
}

function isLocalDatabaseUrl(dbUrl) {
  try {
    const host = new URL(dbUrl).hostname.toLowerCase();
    return ['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(host);
  } catch {
    return false;
  }
}

function readPgSslCa(provider) {
  const prefix = provider === DB_PROVIDER_POSTGRES ? 'POSTGRES' : 'SUPABASE_DB';
  const inline = String(process.env[`${prefix}_SSL_CA`] || '').trim();
  if (inline) return inline.replace(/\\n/g, '\n');
  const filePath = String(process.env[`${prefix}_SSL_CA_FILE`] || '').trim();
  if (!filePath) return undefined;
  return fs.readFileSync(path.resolve(filePath), 'utf8');
}

function shouldUsePgSsl(dbUrl = getDbUrl()) {
  const provider = getDbProvider();
  const explicit = String(providerSslEnv(provider) || '').trim().toLowerCase();
  const localDatabase = isLocalDatabaseUrl(dbUrl);
  if (['false', '0', 'no', 'disable', 'disabled'].includes(explicit)) {
    if (process.env.NODE_ENV === 'production' && !localDatabase) {
      throw new Error('Remote PostgreSQL connections must use verified TLS in production');
    }
    return false;
  }
  const ca = readPgSslCa(provider);
  if (['true', '1', 'yes', 'require', 'required', 'verify-ca', 'verify-full'].includes(explicit)) {
    return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
  }
  let sslMode = '';
  try { sslMode = String(new URL(dbUrl).searchParams.get('sslmode') || '').toLowerCase(); } catch { }
  if (sslMode === 'disable') {
    if (process.env.NODE_ENV === 'production' && !localDatabase) {
      throw new Error('sslmode=disable is not allowed for remote PostgreSQL in production');
    }
    return false;
  }
  if (['require', 'prefer', 'verify-ca', 'verify-full'].includes(sslMode)) {
    return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
  }
  if (localDatabase) return false;
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
}

function pgClientOptions(dbUrl = getDbUrl()) {
  const options = {
    connectionString: dbUrl,
    connectionTimeoutMillis: PG_CONNECT_TIMEOUT_MS,
    statement_timeout: PG_STATEMENT_TIMEOUT_MS,
    query_timeout: PG_STATEMENT_TIMEOUT_MS,
  };
  const ssl = shouldUsePgSsl(dbUrl);
  if (ssl) options.ssl = ssl;
  return options;
}

function getPgPool() {
  const dbUrl = getDbUrl();
  if (!dbUrl) throw new Error('A direct database URL is required for database operations. Set POSTGRES_URL for ARUBOT_DB_PROVIDER=postgres or SUPABASE_DB_URL for ARUBOT_DB_PROVIDER=supabase.');
  if (!pgPool || pgPoolUrl !== dbUrl) {
    if (pgPool) {
      pgPool.end().catch(() => {});
    }
    pgPoolUrl = dbUrl;
    pgPool = new Pool({
      ...pgClientOptions(dbUrl),
      max: PG_POOL_MAX,
      idleTimeoutMillis: PG_IDLE_TIMEOUT_MS,
      allowExitOnIdle: true,
    });
    pgPool.on('error', (error) => {
      console.warn('[Supabase] PG pool idle client error:', error?.message || error);
    });
  }
  return pgPool;
}

function createPgClient(dbUrl = getDbUrl()) {
  return new Client(pgClientOptions(dbUrl));
}

function quoteIdent(value) {
  return String(value).split('.').map((part) => `"${part.replace(/"/g, '""')}"`).join('.');
}

function normalizeColumnName(column) {
  return String(column || '').trim();
}

function buildColumnExpression(column, values, forOrder = false) {
  const name = normalizeColumnName(column);
  const jsonMatch = name.match(/^([A-Za-z_][A-Za-z0-9_]*)->>'([^']+)'$/);
  if (jsonMatch) {
    const keyParam = values.push(jsonMatch[2]);
    return `${quoteIdent(jsonMatch[1])}->>$${keyParam}`;
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(name)) {
    if (forOrder) throw new Error(`Unsafe order column: ${name}`);
    throw new Error(`Unsafe column: ${name}`);
  }
  return quoteIdent(name);
}

function parseSelectColumns(columns) {
  const text = String(columns || '*').trim();
  if (!text || text === '*') return '*';
  return text.split(',')
    .map((column) => column.trim())
    .filter(Boolean)
    .map((column) => buildColumnExpression(column, [], false))
    .join(', ');
}

function normalizeFilterValue(value) {
  if (value === 'null') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

const DEFAULT_UPSERT_CONFLICT_COLUMNS = {
  sessions: ['sid'],
  tokens: ['sid'],
  bot_settings: ['sid'],
  bot_stats: ['sid'],
  live_sessions: ['sid'],
  live_days: ['sid', 'date'],
  attendance_state: ['sid', 'user_id'],
  bot_rules: ['sid', 'id'],
};

const PG_JSON_COLUMNS = Object.freeze({
  action_blueprint_run_steps: new Set(['input', 'output']),
  action_blueprint_runs: new Set(['context']),
  action_blueprint_versions: new Set(['nodes', 'edges', 'viewport']),
  app_users: new Set(['metadata']),
  automation_connections: new Set(['config', 'capabilities', 'discovery_cache']),
  automation_jobs: new Set(['payload', 'result']),
  automation_local_agents: new Set(['capabilities']),
  automation_settings: new Set(['settings']),
  bot_event_logs: new Set(['metadata']),
  bot_rules: new Set(['keywords', 'responses']),
  bot_settings: new Set(['settings']),
  channel_tokens: new Set(['metadata']),
  channel_viewer_tokens: new Set(['metadata']),
  drawing_donation_items: new Set(['point_deductions', 'canvas', 'strokes', 'metrics', 'replay']),
  durable_runtime_jobs: new Set(['payload', 'result']),
  macro_schedules: new Set(['metadata']),
  migration_log: new Set(['details']),
  platform_accounts: new Set(['metadata']),
  prediction_events: new Set(['options']),
  video_donation_queue: new Set(['metadata']),
  viewer_playback_state: new Set(['metadata']),
  youtube_streamer_channels: new Set(['metadata']),
});

export function isPgJsonColumn(table, column) {
  return PG_JSON_COLUMNS[String(table || '')]?.has(String(column || '')) === true;
}

export function normalizePgJsonColumnValue(table, column, value) {
  if (!isPgJsonColumn(table, column) || value == null) return value ?? null;
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(value);
}

function addPgColumnValue(values, table, column, value) {
  const jsonColumn = isPgJsonColumn(table, column);
  const position = values.push(normalizePgJsonColumnValue(table, column, value));
  return `$${position}${jsonColumn ? '::jsonb' : ''}`;
}

class PgQueryBuilder {
  constructor(table) {
    this.table = table;
    this.action = 'select';
    this.selectColumns = '*';
    this.selectOptions = {};
    this.filters = [];
    this.orFilters = [];
    this.orderings = [];
    this.limitCount = null;
    this.offsetCount = null;
    this.payload = null;
    this.conflictColumns = [];
    this.returning = false;
    this.singleMode = null;
  }

  select(columns = '*', options = {}) {
    this.action = this.action || 'select';
    this.selectColumns = columns || '*';
    this.selectOptions = options || {};
    if (this.action !== 'select') this.returning = true;
    return this;
  }

  insert(row) {
    this.action = 'insert';
    this.payload = row;
    return this;
  }

  upsert(row, options = {}) {
    this.action = 'upsert';
    this.payload = row;
    const configuredColumns = String(options?.onConflict || '')
      .split(',')
      .map((column) => column.trim())
      .filter(Boolean);
    this.conflictColumns = configuredColumns.length
      ? configuredColumns
      : (DEFAULT_UPSERT_CONFLICT_COLUMNS[this.table] || []);
    return this;
  }

  update(row) {
    this.action = 'update';
    this.payload = row || {};
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  eq(column, value) { this.filters.push({ column, op: '=', value }); return this; }
  neq(column, value) { this.filters.push({ column, op: '<>', value }); return this; }
  gt(column, value) { this.filters.push({ column, op: '>', value }); return this; }
  gte(column, value) { this.filters.push({ column, op: '>=', value }); return this; }
  lt(column, value) { this.filters.push({ column, op: '<', value }); return this; }
  lte(column, value) { this.filters.push({ column, op: '<=', value }); return this; }
  like(column, value) { this.filters.push({ column, op: 'like', value }); return this; }
  ilike(column, value) { this.filters.push({ column, op: 'ilike', value }); return this; }
  is(column, value) { this.filters.push({ column, op: 'is', value }); return this; }
  in(column, values) { this.filters.push({ column, op: 'in', value: Array.isArray(values) ? values : [] }); return this; }

  or(expression) {
    const parts = String(expression || '').split(',').map((part) => part.trim()).filter(Boolean);
    const parsed = [];
    for (const part of parts) {
      const match = part.match(/^(.+?)\.(is|eq|neq|gt|gte|lt|lte|like|ilike)\.(.*)$/);
      if (!match) continue;
      const [, column, op, rawValue] = match;
      const opMap = {
        is: 'is',
        eq: '=',
        neq: '<>',
        gt: '>',
        gte: '>=',
        lt: '<',
        lte: '<=',
        like: 'like',
        ilike: 'ilike',
      };
      parsed.push({ column, op: opMap[op], value: normalizeFilterValue(rawValue) });
    }
    if (parsed.length) this.orFilters.push(parsed);
    return this;
  }

  order(column, options = {}) {
    this.orderings.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(count) {
    this.limitCount = Math.max(0, Number(count || 0));
    return this;
  }

  range(from, to) {
    const start = Math.max(0, Number(from || 0));
    const end = Math.max(start, Number(to || start));
    this.offsetCount = start;
    this.limitCount = end - start + 1;
    return this;
  }

  single() {
    this.singleMode = 'single';
    return this._execute();
  }

  maybeSingle() {
    this.singleMode = 'maybeSingle';
    return this._execute();
  }

  then(resolve, reject) {
    return this._execute().then(resolve, reject);
  }

  catch(reject) {
    return this._execute().catch(reject);
  }

  _addFilterSql(filter, values) {
    const columnSql = buildColumnExpression(filter.column, values);
    if (filter.op === 'is') {
      if (filter.value === null || filter.value === 'null') return `${columnSql} is null`;
      return `${columnSql} is not distinct from $${values.push(filter.value)}`;
    }
    if (filter.op === 'in') {
      if (!filter.value.length) return 'false';
      const placeholders = filter.value.map((value) => `$${values.push(value)}`).join(', ');
      return `${columnSql} in (${placeholders})`;
    }
    return `${columnSql} ${filter.op} $${values.push(filter.value)}`;
  }

  _whereSql(values) {
    const clauses = this.filters.map((filter) => this._addFilterSql(filter, values));
    for (const group of this.orFilters) {
      const parts = group.map((filter) => this._addFilterSql(filter, values));
      if (parts.length) clauses.push(`(${parts.join(' or ')})`);
    }
    return clauses.length ? ` where ${clauses.join(' and ')}` : '';
  }

  _orderLimitSql(values) {
    const orderSql = this.orderings.length
      ? ` order by ${this.orderings.map(({ column, ascending }) => `${buildColumnExpression(column, values, true)} ${ascending ? 'asc' : 'desc'}`).join(', ')}`
      : '';
    const limitSql = this.limitCount != null ? ` limit ${Math.max(0, Number(this.limitCount))}` : '';
    const offsetSql = this.offsetCount != null ? ` offset ${Math.max(0, Number(this.offsetCount))}` : '';
    return `${orderSql}${limitSql}${offsetSql}`;
  }

  _insertSql(rows, values, upsert = false) {
    if (!rows.length) return { sql: 'select null where false', values };
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row || {})))];
    if (!columns.length) return { sql: 'select null where false', values };
    const tuples = rows.map((row) => `(${columns.map((column) => addPgColumnValue(values, this.table, column, row[column] ?? null)).join(', ')})`);
    let sql = `insert into ${quoteIdent(this.table)} (${columns.map(quoteIdent).join(', ')}) values ${tuples.join(', ')}`;
    if (upsert) {
      if (!this.conflictColumns.length) {
        sql += ' on conflict do nothing';
      } else {
        const updateColumns = columns.filter((column) => !this.conflictColumns.includes(column));
        sql += ` on conflict (${this.conflictColumns.map(quoteIdent).join(', ')})`;
        sql += updateColumns.length
          ? ` do update set ${updateColumns.map((column) => `${quoteIdent(column)} = excluded.${quoteIdent(column)}`).join(', ')}`
          : ' do nothing';
      }
    }
    if (this.returning || this.singleMode) sql += ' returning *';
    return { sql, values };
  }

  _buildSql() {
    const values = [];
    const table = quoteIdent(this.table);
    if (this.action === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      return this._insertSql(rows, values, false);
    }
    if (this.action === 'upsert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      return this._insertSql(rows, values, true);
    }
    if (this.action === 'update') {
      const entries = Object.entries(this.payload || {});
      if (!entries.length) return { sql: 'select null where false', values };
      const setSql = entries.map(([column, value]) => `${quoteIdent(column)} = ${addPgColumnValue(values, this.table, column, value)}`).join(', ');
      const returningSql = this.returning || this.singleMode ? ' returning *' : '';
      return {
        sql: `update ${table} set ${setSql}${this._whereSql(values)}${returningSql}`,
        values,
      };
    }
    if (this.action === 'delete') {
      const returningSql = this.returning || this.singleMode ? ' returning *' : '';
      return {
        sql: `delete from ${table}${this._whereSql(values)}${returningSql}`,
        values,
      };
    }
    if (this.selectOptions?.count === 'exact' && this.selectOptions?.head) {
      return {
        sql: `select count(*)::bigint as count from ${table}${this._whereSql(values)}`,
        values,
        countOnly: true,
      };
    }
    return {
      sql: `select ${parseSelectColumns(this.selectColumns)} from ${table}${this._whereSql(values)}${this._orderLimitSql(values)}`,
      values,
    };
  }

  async _execute() {
    try {
      const built = this._buildSql();
      const result = await withPgClient((pg) => pg.query(built.sql, built.values));
      if (built.countOnly) {
        return { data: null, error: null, count: Number(result.rows?.[0]?.count || 0) };
      }
      let data = result.rows || [];
      if (this.singleMode === 'single') {
        if (data.length !== 1) return { data: data[0] || null, error: data.length ? null : { message: 'No rows returned' } };
        data = data[0];
      } else if (this.singleMode === 'maybeSingle') {
        data = data[0] || null;
      }
      return { data, error: null };
    } catch (error) {
      return { data: this.singleMode ? null : [], error };
    }
  }
}

function createPostgresProviderClient() {
  return {
    from(table) {
      return new PgQueryBuilder(table);
    },
  };
}

export function getPgPoolStatus() {
  return pgPool ? {
    totalCount: pgPool.totalCount,
    idleCount: pgPool.idleCount,
    waitingCount: pgPool.waitingCount,
    max: PG_POOL_MAX,
    connectTimeoutMs: PG_CONNECT_TIMEOUT_MS,
    statementTimeoutMs: PG_STATEMENT_TIMEOUT_MS,
    idleTimeoutMs: PG_IDLE_TIMEOUT_MS,
  } : {
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
    max: PG_POOL_MAX,
    connectTimeoutMs: PG_CONNECT_TIMEOUT_MS,
    statementTimeoutMs: PG_STATEMENT_TIMEOUT_MS,
    idleTimeoutMs: PG_IDLE_TIMEOUT_MS,
  };
}

function getSecretEncryptionKey() {
  const secret = String(
    process.env.ARUBOT_SECRET_ENCRYPTION_KEY ||
    process.env.TOKEN_ENCRYPTION_SECRET ||
    process.env.OAUTH_STATE_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  );
  if (!secret || secret.length < 16) return null;
  return crypto.createHash('sha256').update(secret).digest();
}

const PLACEHOLDER_SECRET_VALUES = new Set([
  'replace_with_stable_random_32_bytes',
  'arubot-oauth-state-development-secret',
  'default_secret',
  'change_me',
  'changeme',
]);

function isPlaceholderSecret(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  return PLACEHOLDER_SECRET_VALUES.has(normalized) || /^(replace_with_|your_|example_|placeholder)/.test(normalized);
}

export function validateSecretEncryptionConfig() {
  const explicit = String(process.env.ARUBOT_SECRET_ENCRYPTION_KEY || process.env.TOKEN_ENCRYPTION_SECRET || '').trim();
  const hasFallback = !!getSecretEncryptionKey();
  const isProduction = process.env.NODE_ENV === 'production';
  const requireExplicit = isProduction && process.env.ARUBOT_REQUIRE_TOKEN_ENCRYPTION_KEY !== 'false';
  if (isProduction) {
    const configuredSecrets = [
      ['ARUBOT_SECRET_ENCRYPTION_KEY', process.env.ARUBOT_SECRET_ENCRYPTION_KEY],
      ['TOKEN_ENCRYPTION_SECRET', process.env.TOKEN_ENCRYPTION_SECRET],
      ['OAUTH_STATE_SECRET', process.env.OAUTH_STATE_SECRET],
      ['SESSION_SECRET', process.env.SESSION_SECRET],
      ['CHZZK_CLIENT_SECRET', process.env.CHZZK_CLIENT_SECRET],
      ['CIME_CLIENT_SECRET', process.env.CIME_CLIENT_SECRET],
      ['YOUTUBE_CLIENT_SECRET', process.env.YOUTUBE_CLIENT_SECRET],
      ['GOOGLE_YOUTUBE_CLIENT_SECRET', process.env.GOOGLE_YOUTUBE_CLIENT_SECRET],
      ['OPS_ADMIN_TOKEN', process.env.OPS_ADMIN_TOKEN],
      ['ADMIN_API_TOKEN', process.env.ADMIN_API_TOKEN],
      ['ADMIN_TOKEN', process.env.ADMIN_TOKEN],
      ['TOKEN_SECRET', process.env.TOKEN_SECRET],
      ['PVD_TOKEN_SECRET', process.env.PVD_TOKEN_SECRET],
      ['DRAWING_DONATION_TOKEN_SECRET', process.env.DRAWING_DONATION_TOKEN_SECRET],
      ['YOUTUBE_WEBSUB_VERIFY_TOKEN', process.env.YOUTUBE_WEBSUB_VERIFY_TOKEN],
    ];
    for (const [name, value] of configuredSecrets) {
      if (value && isPlaceholderSecret(value)) {
        throw new Error(`${name} must not use a placeholder value in production`);
      }
    }
    const resolvedOAuthStateSecret = String(
      process.env.OAUTH_STATE_SECRET ||
      process.env.SESSION_SECRET ||
      process.env.CHZZK_CLIENT_SECRET ||
      process.env.CIME_CLIENT_SECRET ||
      process.env.YOUTUBE_CLIENT_SECRET ||
      process.env.GOOGLE_YOUTUBE_CLIENT_SECRET ||
      'arubot-oauth-state-development-secret'
    );
    if (isPlaceholderSecret(resolvedOAuthStateSecret)) {
      throw new Error('OAuth state signing must use a non-placeholder secret in production');
    }
  }
  if (requireExplicit && explicit.length < 16) {
    throw new Error('ARUBOT_SECRET_ENCRYPTION_KEY or TOKEN_ENCRYPTION_SECRET must be set to at least 16 characters in production');
  }
  if (!hasFallback) {
    console.warn('[Supabase] No token encryption key is configured; new credentials may be stored without encryption.');
  } else if (!explicit) {
    console.warn('[Supabase] Token encryption is using a fallback secret. Set ARUBOT_SECRET_ENCRYPTION_KEY for stable production key rotation.');
  }
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

function secretHash(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

// Ensure 'tokens' table exists using direct PG connection (for PostgREST cache heal)
async function ensureTokensTableExists() {
  const dbUrl = getDbUrl();
  if (!dbUrl) return; // cannot heal without direct DB access
  const client = createPgClient(dbUrl);
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
        api_key_hash text unique,
        api_key_hint text,
        owner_pid text not null,
        created_at timestamptz default now(),
        last_used timestamptz,
        scopes text[] not null default array['user-api','desktop','warudo']::text[],
        expires_at timestamptz not null default (now() + interval '90 days'),
        device_id text,
        revoked boolean default false
      );
      alter table api_keys add column if not exists api_key_hash text;
      alter table api_keys add column if not exists api_key_hint text;
      alter table api_keys add column if not exists scopes text[] not null default array['user-api','desktop','warudo']::text[];
      alter table api_keys add column if not exists expires_at timestamptz;
      alter table api_keys add column if not exists device_id text;
      update api_keys set expires_at = coalesce(expires_at, now() + interval '90 days');
      alter table api_keys alter column expires_at set not null;
      create unique index if not exists idx_api_keys_hash on api_keys(api_key_hash) where api_key_hash is not null;
      create index if not exists idx_api_keys_owner_active on api_keys(owner_pid, expires_at desc) where revoked = false;
    `);
  });
}

const API_KEY_SCOPES = new Set(['user-api', 'desktop', 'warudo']);

function normalizeApiKeyScopes(scopes) {
  const values = Array.isArray(scopes) ? scopes : String(scopes || '').split(',');
  const normalized = [...new Set(values.map((value) => String(value || '').trim().toLowerCase()).filter((value) => API_KEY_SCOPES.has(value)))];
  return normalized.length ? normalized : ['user-api', 'desktop', 'warudo'];
}

export async function issueApiKey(ownerPid, options = {}) {
  await ensureApiKeysTable();
  const key = crypto.randomBytes(32).toString('hex');
  const hash = secretHash(key);
  const hint = `${key.slice(0, 8)}...${key.slice(-4)}`;
  const scopes = normalizeApiKeyScopes(options.scopes);
  const ttlDays = Math.max(1, Math.min(365, Number(options.ttlDays || process.env.API_KEY_TTL_DAYS || 90)));
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  await withPgClient(async (pg) => {
    await pg.query(
      `insert into api_keys (api_key, api_key_hash, api_key_hint, owner_pid, scopes, expires_at, device_id)
       values ($1, $2, $3, $4, $5::text[], $6, $7)`,
      [protectSecret(key), hash, hint, String(ownerPid), scopes, expiresAt.toISOString(), options.deviceId ? String(options.deviceId) : null]
    );
  });
  return key;
}

export async function getOwnerPidForApiKey(key, options = {}) {
  if (!key) return null;
  await ensureApiKeysTable();
  let row = null;
  const hash = secretHash(key);
  const requiredScope = String(options.requiredScope || '').trim().toLowerCase();
  await withPgClient(async (pg) => {
    const r = await pg.query(
      `select api_key, api_key_hash, owner_pid, revoked, scopes, expires_at, device_id
         from api_keys
        where (api_key_hash = $1 or api_key = $2)
          and revoked = false
          and expires_at > now()
        limit 1`,
      [hash, String(key)]
    );
    row = r?.rows?.[0] || null;
    if (row && requiredScope && !normalizeApiKeyScopes(row.scopes).includes(requiredScope)) row = null;
    if (row && options.deviceId && row.device_id && String(row.device_id) !== String(options.deviceId)) row = null;
    if (row && !row.api_key_hash) {
      await pg.query(
        `update api_keys set api_key = $1, api_key_hash = $2, api_key_hint = $3 where api_key = $4`,
        [protectSecret(key), hash, `${String(key).slice(0, 8)}...${String(key).slice(-4)}`, String(key)]
      );
    }
  });
  return row ? String(row.owner_pid) : null;
}

async function ensureApiWebSocketTicketsTable() {
  await withPgClient(async (pg) => {
    await pg.query(`
      create table if not exists api_websocket_tickets (
        ticket_hash text primary key,
        owner_pid text not null,
        scope text not null check (scope in ('desktop', 'warudo')),
        created_at timestamptz not null default now(),
        expires_at timestamptz not null,
        consumed_at timestamptz
      );
      create index if not exists idx_api_websocket_tickets_expiry
        on api_websocket_tickets(expires_at)
        where consumed_at is null;
    `);
  });
}

export async function issueApiWebSocketTicket(ownerPid, scope, ttlMs = 30_000) {
  const owner = String(ownerPid || '').trim();
  const normalizedScope = String(scope || '').trim().toLowerCase();
  if (!owner) throw new Error('ownerPid is required');
  if (!['desktop', 'warudo'].includes(normalizedScope)) throw new Error('Unsupported WebSocket ticket scope');
  const ttl = Math.max(5_000, Math.min(60_000, Math.floor(Number(ttlMs || 30_000))));
  const ticket = `ws_${crypto.randomBytes(32).toString('base64url')}`;
  const ticketHash = secretHash(ticket);
  const expiresAt = new Date(Date.now() + ttl);
  await ensureApiWebSocketTicketsTable();
  await withPgClient(async (pg) => {
    await pg.query(
      `insert into api_websocket_tickets (ticket_hash, owner_pid, scope, expires_at)
       values ($1, $2, $3, $4)`,
      [ticketHash, owner, normalizedScope, expiresAt.toISOString()]
    );
    await pg.query('delete from api_websocket_tickets where expires_at < now() - interval \'10 minutes\' or consumed_at < now() - interval \'10 minutes\'');
  });
  return { ticket, expiresAt: expiresAt.toISOString(), scope: normalizedScope };
}

export async function consumeApiWebSocketTicket(ticket, requiredScope) {
  const rawTicket = String(ticket || '').trim();
  const scope = String(requiredScope || '').trim().toLowerCase();
  if (!rawTicket || !['desktop', 'warudo'].includes(scope)) return null;
  await ensureApiWebSocketTicketsTable();
  return withPgClient(async (pg) => {
    const consumed = await pg.query(
      `update api_websocket_tickets
          set consumed_at = now()
        where ticket_hash = $1
          and scope = $2
          and consumed_at is null
          and expires_at > now()
      returning owner_pid`,
      [secretHash(rawTicket), scope]
    );
    return consumed.rows?.[0]?.owner_pid ? String(consumed.rows[0].owner_pid) : null;
  });
}

export async function touchApiKeyLastUsed(key) {
  if (!key) return;
  const hash = secretHash(key);
  await withPgClient(async (pg) => {
    await pg.query(`update api_keys set last_used = now() where api_key_hash = $1 or api_key = $2`, [hash, String(key)]);
  });
}

export async function revokeApiKey(ownerPid, key) {
  if (!key) return false;
  const hash = secretHash(key);
  await withPgClient(async (pg) => {
    await pg.query(
      `update api_keys set revoked = true where (api_key_hash = $1 or api_key = $2) and owner_pid = $3`,
      [hash, String(key), String(ownerPid)]
    );
  });
  return true;
}

export async function getActiveApiKeyForOwner(ownerPid, options = {}) {
  await ensureApiKeysTable();
  let row = null;
  const requiredScopes = options.scopes ? normalizeApiKeyScopes(options.scopes) : [];
  await withPgClient(async (pg) => {
    const r = await pg.query(
      `select api_key from api_keys
        where owner_pid = $1 and revoked = false and expires_at > now()
          and ($2::text[] is null or scopes @> $2::text[])
        order by created_at desc limit 1`,
      [String(ownerPid), requiredScopes.length ? requiredScopes : null]
    );
    row = r?.rows?.[0] || null;
  });
  return row ? revealSecret(row.api_key) : null;
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
  const dbUrl = getDbUrl();
  if (!dbUrl) throw new Error('A direct database URL is required for channel points operations');
  let lastErr;
  for (let i=0;i<=retries;i++) {
    const pool = getPgPool();
    let client = null;
    try {
      client = await pool.connect();
      const res = await fn(client);
      return res;
    } catch (e) {
      lastErr = e;
      const code = e && (e.code || e.errno);
      const msg = String(e && (e.message || e.toString()) || '');
      const transient = code === 'XX000' || msg.includes('db_termination') || msg.includes('terminating connection') || msg.includes('server closed the connection');
      if (i < retries && transient) { await sleep(300 * (i+1)); continue; }
      throw e;
    } finally {
      if (client) client.release();
    }
  }
  throw lastErr;
}

function isUndefinedDbFunctionError(error, functionName) {
  const message = String(error?.message || error?.toString?.() || '');
  return error?.code === '42883' && (!functionName || message.includes(functionName));
}

async function ensureChannelPointsTableWithClient(pg, streamerUid) {
  const suffix = sanitizeTableNameSuffix(streamerUid);
  const table = `channelpoint_${suffix}`;
  const tableSql = quoteIdent(table);
  const constraintName = `${table.slice(0, 40)}_points_nonnegative_ck`;
  await pg.query(`
    create table if not exists ${tableSql} (
      user_id text primary key,
      username text,
      points integer not null default 0,
      constraint ${quoteIdent(constraintName)} check (points >= 0)
    )
  `);
  return table;
}

export async function ensureChannelPointsTable(streamerUid) {
  return withPgClient((pg) => ensureChannelPointsTableWithClient(pg, streamerUid));
}

export async function listChannelPoints(streamerUid) {
  return withPgClient(async (pg) => {
    const channelIdentity = await resolvePointChannelIdentity(pg, streamerUid);
    const tables = await listPointTablesForChannelAliases(channelIdentity.channelAliases, pg);
    const users = new Map();
    const rawRows = [];

    for (const table of tables) {
      const { rows } = await pg.query(`select user_id, username, points from ${table}`);
      rawRows.push(...(rows || []));
    }

    const userIdentities = await resolvePointUserIdentities(pg, rawRows.map((row) => row.user_id));
    for (const row of rawRows) {
      const rawUserId = String(row.user_id || '').trim();
      if (!rawUserId) continue;

      const userIdentity = userIdentities.get(rawUserId) || { canonicalUserId: rawUserId };
      const canonicalUserId = String(userIdentity.canonicalUserId || rawUserId);
      const existing = users.get(canonicalUserId) || {
        user_id: canonicalUserId,
        username: null,
        points: 0,
      };
      existing.username = existing.username || row.username || rawUserId;
      existing.points += Number(row.points || 0);
      users.set(canonicalUserId, existing);
    }

    return Array.from(users.values()).sort((a, b) => {
      return Number(b.points || 0) - Number(a.points || 0)
        || String(a.username || '').localeCompare(String(b.username || ''))
        || String(a.user_id || '').localeCompare(String(b.user_id || ''));
    });
  });
}

function buildChannelPointPageCte(tables, useIdentityLookup = true) {
  const rawUnion = tables
    .map((table) => `select user_id::text as raw_user_id, username::text as username, coalesce(points, 0)::bigint as points from ${table}`)
    .join('\nunion all\n');
  const matchedCte = useIdentityLookup
    ? `
    matched as (
      select r.raw_user_id, min(pa.user_id) as canonical_user_id
      from raw_ids r
      join platform_accounts pa
        on pa.user_id = r.raw_user_id
        or pa.platform_user_id = r.raw_user_id
        or pa.channel_id = r.raw_user_id
        or pa.channel_handle = r.raw_user_id
        or pa.platform_user_id = regexp_replace(r.raw_user_id, '^(user:|cime:|chzzk:|youtube:)', '')
        or pa.channel_id = regexp_replace(r.raw_user_id, '^(user:|cime:|chzzk:|youtube:)', '')
        or pa.channel_handle = regexp_replace(r.raw_user_id, '^(user:|cime:|chzzk:|youtube:)', '')
        or r.raw_user_id = pa.provider || ':' || pa.platform_user_id
        or r.raw_user_id = pa.provider || ':' || pa.channel_id
        or r.raw_user_id = pa.provider || ':' || pa.channel_handle
      group by r.raw_user_id
    ),`
    : `
    matched as (
      select raw_user_id, null::text as canonical_user_id
      from raw_ids
      where false
    ),`;
  return `
    with raw as (
      ${rawUnion}
    ),
    raw_ids as (
      select distinct raw_user_id
      from raw
      where nullif(raw_user_id, '') is not null
    ),
    ${matchedCte}
    grouped as (
      select
        coalesce(m.canonical_user_id, r.raw_user_id) as user_id,
        (array_agg(r.username order by r.username) filter (where nullif(r.username, '') is not null))[1] as username,
        sum(r.points)::bigint as points
      from raw r
      left join matched m on m.raw_user_id = r.raw_user_id
      where nullif(r.raw_user_id, '') is not null
      group by coalesce(m.canonical_user_id, r.raw_user_id)
    )
  `;
}

export async function listChannelPointsPage(streamerUid, options = {}) {
  const offset = Math.max(0, Number(options.offset || 0) || 0);
  const limit = Math.max(1, Math.min(5000, Number(options.limit || 1000) || 1000));
  return withPgClient(async (pg) => {
    const channelIdentity = await resolvePointChannelIdentity(pg, streamerUid);
    const tables = await listPointTablesForChannelAliases(channelIdentity.channelAliases, pg);
    const platformAccounts = await pg.query(`select to_regclass('public.platform_accounts') as table_name`);
    const cte = buildChannelPointPageCte(tables, !!platformAccounts.rows?.[0]?.table_name);
    const totals = await pg.query(`
      ${cte}
      select count(*)::integer as total, coalesce(sum(points), 0)::bigint as total_points
      from grouped
    `);
    const total = Number(totals.rows?.[0]?.total || 0);
    const totalPoints = Number(totals.rows?.[0]?.total_points || 0);
    if (!total) return { rows: [], total: 0, totalPoints: 0, offset, limit };

    const page = await pg.query(`
      ${cte}
      select user_id, username, points::double precision as points
      from grouped
      order by points desc, coalesce(username, '') asc, user_id asc
      offset $1
      limit $2
    `, [offset, limit]);
    return {
      rows: page.rows || [],
      total,
      totalPoints,
      offset,
      limit,
    };
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
        select distinct user_id, provider, platform_user_id, channel_id, channel_name, avatar_url
        from platform_accounts
        where coalesce(channel_id, platform_user_id) is not null
      `);
      for (const row of knownChannels.rows || []) {
        const channelUid = String(row.channel_id || row.platform_user_id || '').trim();
        const canonicalChannelUid = String(row.user_id || channelUid).trim();
        if (!channelUid) continue;
        const lookup = {
          channelUid,
          canonicalChannelUid,
          channelName: row.channel_name || null,
          avatarUrl: row.avatar_url || null,
          provider: row.provider || null,
        };
        tableUidLookup.set(`channelpoint_${sanitizeTableNameSuffix(channelUid)}`, lookup);
        if (canonicalChannelUid) {
          const canonicalTable = `channelpoint_${sanitizeTableNameSuffix(canonicalChannelUid)}`;
          if (!tableUidLookup.has(canonicalTable) || row.provider === 'chzzk') {
            tableUidLookup.set(canonicalTable, lookup);
          }
        }
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
      const channelKey = lookup?.canonicalChannelUid || channelUid;
      const existing = balancesByChannel.get(channelKey) || {
        channelUid,
        canonicalChannelUid: channelKey,
        channelName: lookup?.channelName || null,
        avatarUrl: lookup?.avatarUrl || null,
        provider: lookup?.provider || null,
        points: 0,
        identities: [],
      };
      if (lookup?.provider === 'chzzk' || !existing.provider) {
        existing.channelUid = lookup?.channelUid || existing.channelUid;
        existing.channelName = lookup?.channelName || existing.channelName;
        existing.avatarUrl = lookup?.avatarUrl || existing.avatarUrl;
        existing.provider = lookup?.provider || existing.provider;
      }
      existing.points += pointRows.reduce((sum, row) => sum + row.points, 0);
      existing.identities.push(...pointRows);
      balancesByChannel.set(channelKey, existing);
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
          const channelKey = lookup?.canonicalChannelUid || channelUid;
          const existing = balancesByChannel.get(channelKey) || {
            channelUid,
            canonicalChannelUid: channelKey,
            channelName: lookup?.channelName || null,
            avatarUrl: lookup?.avatarUrl || null,
            provider: lookup?.provider || null,
            points: 0,
            identities: [],
          };
          if (lookup?.provider === 'chzzk' || !existing.provider) {
            existing.channelUid = lookup?.channelUid || existing.channelUid;
            existing.channelName = lookup?.channelName || existing.channelName;
            existing.avatarUrl = lookup?.avatarUrl || existing.avatarUrl;
            existing.provider = lookup?.provider || existing.provider;
          }
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
          balancesByChannel.set(channelKey, existing);
        }
      }
    } catch {
      // Newer consolidated point table is optional; legacy per-channel tables remain the source of truth.
    }

    balances.push(...balancesByChannel.values());
    return balances.sort((a, b) => b.points - a.points || String(a.channelUid).localeCompare(String(b.channelUid)));
  });
}

function uniqueNonEmpty(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean)));
}

function pointLookupCandidates(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  const candidates = [text];
  for (const prefix of ['user:', 'cime:', 'chzzk:', 'youtube:']) {
    if (text.startsWith(prefix)) candidates.push(text.slice(prefix.length));
  }
  return uniqueNonEmpty(candidates);
}

async function resolvePointChannelIdentity(pg, streamerUid) {
  const raw = String(streamerUid || '').trim();
  if (!raw) return { canonicalChannelUid: '', channelAliases: [] };
  const candidates = pointLookupCandidates(raw);
  try {
    const matched = await pg.query(
      `select user_id
         from platform_accounts
        where platform_user_id = any($1::text[])
           or channel_id = any($1::text[])
           or user_id = any($1::text[])
        limit 1`,
      [candidates]
    );
    const appUserId = String(matched.rows?.[0]?.user_id || '').trim();
    if (appUserId) {
      const accounts = await pg.query(
        `select user_id, platform_user_id, channel_id
           from platform_accounts
          where user_id = $1`,
        [appUserId]
      );
      const aliases = [raw, appUserId];
      for (const account of accounts.rows || []) {
        aliases.push(account.user_id, account.platform_user_id, account.channel_id);
      }
      return {
        canonicalChannelUid: appUserId,
        channelAliases: uniqueNonEmpty(aliases),
      };
    }
  } catch {
    // Platform identity tables are optional for legacy installs.
  }
  return { canonicalChannelUid: raw, channelAliases: [raw] };
}

async function resolvePointUserIdentity(pg, userId) {
  const raw = String(userId || '').trim();
  if (!raw) return { canonicalUserId: '', identityKeys: [] };
  const identities = await resolvePointUserIdentities(pg, [raw]);
  return identities.get(raw) || { canonicalUserId: raw, identityKeys: uniqueNonEmpty([raw, ...pointLookupCandidates(raw)]) };
}

async function resolvePointUserIdentities(pg, userIds) {
  const raws = uniqueNonEmpty(userIds);
  const result = new Map();
  if (!raws.length) return result;

  const candidatesByRaw = new Map(raws.map((raw) => [raw, pointLookupCandidates(raw)]));
  const allCandidates = uniqueNonEmpty(Array.from(candidatesByRaw.values()).flat());

  try {
    const matched = await pg.query(
      `select user_id
         from platform_accounts
        where platform_user_id = any($1::text[])
           or channel_id = any($1::text[])
           or user_id = any($1::text[])`,
      [allCandidates]
    );
    const appUserIds = uniqueNonEmpty((matched.rows || []).map((row) => row.user_id));
    const accountsByAppUser = new Map();
    if (appUserIds.length) {
      const accounts = await pg.query(
        `select user_id, provider, platform_user_id, channel_id, channel_name, channel_handle, avatar_url, metadata
           from platform_accounts
          where user_id = any($1::text[])`,
        [appUserIds]
      );
      for (const account of accounts.rows || []) {
        const key = String(account.user_id || '');
        const list = accountsByAppUser.get(key) || [];
        list.push(account);
        accountsByAppUser.set(key, list);
      }
    }
    const appUserLookup = buildPointIdentityLookup(appUserIds, accountsByAppUser);

    for (const raw of raws) {
      const candidates = candidatesByRaw.get(raw) || [raw];
      const appUserId = candidates.map((candidate) => appUserLookup.get(candidate)).find(Boolean) || null;

      if (appUserId) {
        const accounts = accountsByAppUser.get(appUserId) || [];
        const keys = [raw, ...candidates, appUserId, makeArubotViewerUuid(appUserId)];
        for (const account of accounts) {
          keys.push(...collectPlatformPointIdentityKeys(account));
        }
        result.set(raw, {
          canonicalUserId: appUserId,
          identityKeys: uniqueNonEmpty(keys),
        });
      } else {
        result.set(raw, {
          canonicalUserId: raw,
          identityKeys: uniqueNonEmpty([raw, ...candidates]),
        });
      }
    }
  } catch {
    for (const raw of raws) {
      result.set(raw, {
        canonicalUserId: raw,
        identityKeys: uniqueNonEmpty([raw, ...(candidatesByRaw.get(raw) || [])]),
      });
    }
  }
  return result;
}

async function listPointTablesForChannelAliases(channelAliases, pg = null) {
  const tables = [];
  for (const channelUid of uniqueNonEmpty(channelAliases)) {
    tables.push(pg
      ? await ensureChannelPointsTableWithClient(pg, channelUid)
      : await ensureChannelPointsTable(channelUid));
  }
  return uniqueNonEmpty(tables);
}

async function sumPointsForIdentity(pg, channelAliases, identityKeys) {
  const keys = uniqueNonEmpty(identityKeys);
  if (!keys.length) return 0;
  let total = 0;
  const tables = await listPointTablesForChannelAliases(channelAliases, pg);
  for (const table of tables) {
    const { rows } = await pg.query(`select coalesce(sum(points), 0) as points from ${table} where user_id = any($1::text[])`, [keys]);
    total += Number(rows?.[0]?.points || 0);
  }
  return total;
}

async function getPointBalanceSummaryForIdentity(pg, channelAliases, identityKeys) {
  const keys = uniqueNonEmpty(identityKeys);
  if (!keys.length) return { username: null, points: 0, found: false };
  let total = 0;
  let username = null;
  let found = false;
  const tables = await listPointTablesForChannelAliases(channelAliases, pg);
  for (const table of tables) {
    const { rows } = await pg.query(`select username, points from ${table} where user_id = any($1::text[])`, [keys]);
    for (const row of rows || []) {
      found = true;
      if (!username && row.username) username = row.username;
      total += Number(row.points || 0);
    }
  }
  return { username, points: total, found };
}

async function deletePointRowsForIdentity(pg, channelAliases, identityKeys) {
  const keys = uniqueNonEmpty(identityKeys);
  if (!keys.length) return;
  const tables = await listPointTablesForChannelAliases(channelAliases, pg);
  for (const table of tables) {
    await pg.query(`delete from ${table} where user_id = any($1::text[])`, [keys]);
  }
}

async function upsertCanonicalPointDelta(pg, canonicalChannelUid, canonicalUserId, username, delta) {
  const table = await ensureChannelPointsTableWithClient(pg, canonicalChannelUid);
  await pg.query(
    `insert into ${table} (user_id, username, points) values ($1, $2, $3)
     on conflict (user_id) do update set
       username = coalesce(excluded.username, ${table}.username),
       points = ${table}.points + excluded.points`,
    [String(canonicalUserId), username ? String(username) : null, Number(delta) || 0]
  );
}

async function setCanonicalPointBalance(pg, channelIdentity, userIdentity, username, points) {
  await deletePointRowsForIdentity(pg, channelIdentity.channelAliases, userIdentity.identityKeys);
  const table = await ensureChannelPointsTableWithClient(pg, channelIdentity.canonicalChannelUid);
  await pg.query(
    `insert into ${table} (user_id, username, points) values ($1, $2, $3)
     on conflict (user_id) do update set username = excluded.username, points = excluded.points`,
    [String(userIdentity.canonicalUserId), username ? String(username) : null, Number(points) || 0]
  );
}

export async function setChannelPoints(streamerUid, userId, username, points) {
  await withPgClient(async (pg) => {
    const channelIdentity = await resolvePointChannelIdentity(pg, streamerUid);
    const userIdentity = await resolvePointUserIdentity(pg, userId);
    if (!channelIdentity.canonicalChannelUid || !userIdentity.canonicalUserId) return;
    await setCanonicalPointBalance(pg, channelIdentity, userIdentity, username, points);
  });
}

export async function incrChannelPoints(streamerUid, userId, username, delta = 1) {
  await withPgClient(async (pg) => {
    const channelIdentity = await resolvePointChannelIdentity(pg, streamerUid);
    const userIdentity = await resolvePointUserIdentity(pg, userId);
    if (!channelIdentity.canonicalChannelUid || !userIdentity.canonicalUserId) return;
    await upsertCanonicalPointDelta(pg, channelIdentity.canonicalChannelUid, userIdentity.canonicalUserId, username, delta);
  });
}

function normalizePointDeductionAmount(amount) {
  const normalized = Math.floor(Number(amount));
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    const error = new Error('point deduction amount must be a positive safe integer');
    error.code = 'invalid_point_deduction_amount';
    throw error;
  }
  return normalized;
}

function normalizePointDeductionResult(row, fallback = {}) {
  const value = row || {};
  const before = Number(value.balance_before ?? value.balanceBefore ?? value.before ?? 0);
  const after = Number(value.balance_after ?? value.balanceAfter ?? value.after ?? before);
  return {
    deducted: value.deducted === true,
    sufficient: value.sufficient === true || value.deducted === true,
    amount: Number(value.amount ?? fallback.amount ?? 0),
    balanceBefore: before,
    balanceAfter: after,
    streamerUid: String(value.canonical_channel_uid ?? value.canonicalChannelUid ?? fallback.streamerUid ?? ''),
    userId: String(value.canonical_user_id ?? value.canonicalUserId ?? fallback.userId ?? ''),
  };
}

export async function checkDatabaseReady() {
  const startedAt = Date.now();
  try {
    if (getDbUrl()) {
      await withPgClient((pg) => pg.query('select 1 as ok'));
    } else {
      ensure();
      const { error } = await supabase.from('bot_settings').select('sid').limit(1);
      if (error) throw error;
    }
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - startedAt, error: error?.message || String(error) };
  }
}

export async function closeDatabaseConnections() {
  const pool = pgPool;
  pgPool = null;
  pgPoolUrl = null;
  if (pool) await pool.end();
}

let runtimeLeasesReady = false;

async function ensureRuntimeLeasesWithClient(pg) {
  if (runtimeLeasesReady) return;
  await pg.query(`
    create table if not exists runtime_leases (
      resource_key text primary key,
      owner_id text not null,
      fencing_token bigint not null default 1,
      expires_at timestamptz not null,
      updated_at timestamptz not null default now()
    );
    create index if not exists idx_runtime_leases_expiry on runtime_leases(expires_at);
  `);
  runtimeLeasesReady = true;
}

export async function claimRuntimeLease(resourceKey, ownerId, ttlMs = 30_000) {
  const key = String(resourceKey || '').trim();
  const owner = String(ownerId || '').trim();
  const ttl = Math.max(5_000, Math.min(5 * 60_000, Math.floor(Number(ttlMs || 30_000))));
  if (!key || !owner) throw new Error('resourceKey and ownerId are required');
  if (!getDbUrl()) return { acquired: true, resourceKey: key, ownerId: owner, fencingToken: 1, fallback: true };
  return withPgClient(async (pg) => {
    await ensureRuntimeLeasesWithClient(pg);
    const result = await pg.query(
      `insert into runtime_leases (resource_key, owner_id, fencing_token, expires_at, updated_at)
       values ($1, $2, 1, now() + ($3::bigint * interval '1 millisecond'), now())
       on conflict (resource_key) do update
         set owner_id = excluded.owner_id,
             fencing_token = case when runtime_leases.owner_id = excluded.owner_id
                                  then runtime_leases.fencing_token
                                  else runtime_leases.fencing_token + 1 end,
             expires_at = excluded.expires_at,
             updated_at = now()
       where runtime_leases.owner_id = excluded.owner_id or runtime_leases.expires_at <= now()
       returning resource_key, owner_id, fencing_token, expires_at`,
      [key, owner, ttl]
    );
    const row = result.rows?.[0];
    if (!row) return { acquired: false, resourceKey: key, ownerId: owner };
    return {
      acquired: true,
      resourceKey: String(row.resource_key),
      ownerId: String(row.owner_id),
      fencingToken: Number(row.fencing_token),
      expiresAt: row.expires_at,
    };
  });
}

export async function releaseRuntimeLease(resourceKey, ownerId) {
  const key = String(resourceKey || '').trim();
  const owner = String(ownerId || '').trim();
  if (!key || !owner || !getDbUrl()) return false;
  return withPgClient(async (pg) => {
    await ensureRuntimeLeasesWithClient(pg);
    const result = await pg.query('delete from runtime_leases where resource_key = $1 and owner_id = $2', [key, owner]);
    return Number(result.rowCount || 0) > 0;
  });
}

async function deductChannelPointsIfEnoughWithClient(pg, streamerUid, userId, username, amount) {
  const normalizedAmount = normalizePointDeductionAmount(amount);
  const channelIdentity = await resolvePointChannelIdentity(pg, streamerUid);
  const userIdentity = await resolvePointUserIdentity(pg, userId);
  if (!channelIdentity.canonicalChannelUid || !userIdentity.canonicalUserId) {
    const error = new Error('streamerUid and userId must resolve to valid point identities');
    error.code = 'invalid_point_identity';
    throw error;
  }

  const lockKey = `${channelIdentity.canonicalChannelUid}:${userIdentity.canonicalUserId}`;
  await pg.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);

  const tables = (await listPointTablesForChannelAliases(channelIdentity.channelAliases, pg)).sort();
  let balanceBefore = 0;
  let resolvedUsername = username ? String(username) : null;
  for (const table of tables) {
    const result = await pg.query(
      `select username, points from ${quoteIdent(table)} where user_id = any($1::text[]) for update`,
      [userIdentity.identityKeys]
    );
    for (const row of result.rows || []) {
      balanceBefore += Number(row.points || 0);
      if (!resolvedUsername && row.username) resolvedUsername = String(row.username);
    }
  }

  if (balanceBefore < normalizedAmount) {
    return normalizePointDeductionResult({
      deducted: false,
      sufficient: false,
      amount: normalizedAmount,
      balance_before: balanceBefore,
      balance_after: balanceBefore,
      canonical_channel_uid: channelIdentity.canonicalChannelUid,
      canonical_user_id: userIdentity.canonicalUserId,
    });
  }

  await deletePointRowsForIdentity(pg, channelIdentity.channelAliases, userIdentity.identityKeys);
  const balanceAfter = balanceBefore - normalizedAmount;
  const canonicalTable = await ensureChannelPointsTableWithClient(pg, channelIdentity.canonicalChannelUid);
  await pg.query(
    `insert into ${quoteIdent(canonicalTable)} (user_id, username, points)
     values ($1, $2, $3)
     on conflict (user_id) do update set username = excluded.username, points = excluded.points`,
    [String(userIdentity.canonicalUserId), resolvedUsername, balanceAfter]
  );

  return normalizePointDeductionResult({
    deducted: true,
    sufficient: true,
    amount: normalizedAmount,
    balance_before: balanceBefore,
    balance_after: balanceAfter,
    canonical_channel_uid: channelIdentity.canonicalChannelUid,
    canonical_user_id: userIdentity.canonicalUserId,
  });
}

export async function deductChannelPointsIfEnough(streamerUid, userId, username, amount) {
  const normalizedAmount = normalizePointDeductionAmount(amount);
  if (!getDbUrl()) {
    ensure();
    if (typeof supabase.rpc !== 'function') throw new Error('Atomic point deduction RPC is unavailable');
    const { data, error } = await supabase.rpc('arubot_deduct_channel_points_if_enough', {
      p_streamer_uid: String(streamerUid || ''),
      p_user_id: String(userId || ''),
      p_username: username ? String(username) : null,
      p_amount: normalizedAmount,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return normalizePointDeductionResult(row, { streamerUid, userId, amount: normalizedAmount });
  }

  return withPgClient(async (pg) => {
    await pg.query('begin');
    try {
      const result = await deductChannelPointsIfEnoughWithClient(pg, streamerUid, userId, username, normalizedAmount);
      await pg.query('commit');
      return result;
    } catch (error) {
      try { await pg.query('rollback'); } catch {}
      throw error;
    }
  });
}

export async function getChannelPoints(streamerUid, userId) {
  return withPgClient(async (pg) => {
    const channelIdentity = await resolvePointChannelIdentity(pg, streamerUid);
    const userIdentity = await resolvePointUserIdentity(pg, userId);
    return sumPointsForIdentity(pg, channelIdentity.channelAliases, userIdentity.identityKeys);
  });
}

export async function getChannelPointBalanceSummary(streamerUid, userId) {
  return withPgClient(async (pg) => {
    const channelIdentity = await resolvePointChannelIdentity(pg, streamerUid);
    const userIdentity = await resolvePointUserIdentity(pg, userId);
    if (!channelIdentity.canonicalChannelUid || !userIdentity.canonicalUserId) return null;
    const summary = await getPointBalanceSummaryForIdentity(pg, channelIdentity.channelAliases, userIdentity.identityKeys);
    return {
      userId: String(userIdentity.canonicalUserId),
      username: summary.username,
      points: Number(summary.points || 0),
      found: summary.found === true,
    };
  });
}

export async function deleteChannelPoints(streamerUid, userId) {
  await withPgClient(async (pg) => {
    const channelIdentity = await resolvePointChannelIdentity(pg, streamerUid);
    const userIdentity = await resolvePointUserIdentity(pg, userId);
    await deletePointRowsForIdentity(pg, channelIdentity.channelAliases, userIdentity.identityKeys);
  });
}

export async function clearAllChannelPoints(streamerUid) {
  await withPgClient(async (pg) => {
    const channelIdentity = await resolvePointChannelIdentity(pg, streamerUid);
    const tables = await listPointTablesForChannelAliases(channelIdentity.channelAliases, pg);
    for (const table of tables) {
      await pg.query(`delete from ${table}`);
    }
  });
}

export async function bulkUpsertChannelPoints(streamerUid, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  // Insert in batches to avoid very large queries
  const batchSize = 200;
  await withPgClient(async (pg) => {
    const channelIdentity = await resolvePointChannelIdentity(pg, streamerUid);
    if (!channelIdentity.canonicalChannelUid) return;
    const table = await ensureChannelPointsTableWithClient(pg, channelIdentity.canonicalChannelUid);
    const normalizedRowsByUser = new Map();
    const userIdentities = await resolvePointUserIdentities(pg, rows.map((row) => row?.user_id));

    for (const row of rows) {
      const rawUserId = String(row?.user_id || '').trim();
      if (!rawUserId) continue;
      const userIdentity = userIdentities.get(rawUserId) || { canonicalUserId: rawUserId, identityKeys: [rawUserId] };
      if (!userIdentity.canonicalUserId) continue;
      await deletePointRowsForIdentity(pg, channelIdentity.channelAliases, userIdentity.identityKeys);
      normalizedRowsByUser.set(String(userIdentity.canonicalUserId), {
        user_id: String(userIdentity.canonicalUserId),
        username: row.username != null ? String(row.username) : null,
        points: Number(row.points) || 0,
      });
    }

    const normalizedRows = Array.from(normalizedRowsByUser.values());
    for (let i = 0; i < normalizedRows.length; i += batchSize) {
      const slice = normalizedRows.slice(i, i + batchSize);
      const values = [];
      const params = [];
      slice.forEach((r, idx) => {
        params.push(r.user_id, r.username, r.points);
        const base = idx * 3;
        values.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
      });
      if (!values.length) continue;
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

export async function revokeSession(sid) {
  ensure();
  const sessionId = String(sid || '').trim();
  if (!sessionId) return false;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('sessions')
    .update({ revoked: true, expires_at: now, last_seen: now })
    .eq('sid', sessionId);
  if (error) throw error;
  return true;
}

export async function getSessionUserId(sid) {
  ensure();
  if (!sid) return null;
  
  // PostgREST 스키마 캐시 문제를 우회하기 위해 직접 PostgreSQL 연결 사용
  try {
    let result = null;
    
    await withPgClient(async (pg) => {
      const res = await pg.query(
        `select user_id
           from sessions
          where sid = $1
            and revoked is not true
            and (expires_at is null or expires_at > now())
          limit 1`,
        [sid]
      );
      if (res.rows.length > 0) {
        const row = res.rows[0];
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
  if (isPostgresProvider()) {
    const dbUrl = getDbUrl();
    if (!dbUrl) {
      console.warn('[Postgres] POSTGRES_RUNTIME_URL/POSTGRES_URL missing. Database features will be disabled.');
      return;
    }
    supabase = createPostgresProviderClient();
    try {
      await ensureTokensTableExists();
      await ensureSchema();
      console.log('[Postgres] Direct Postgres provider initialized.');
    } catch (e) {
      console.warn('[Postgres] ensureSchema failed:', e?.message || e);
    }
    return;
  }

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
  if (getDbUrl()) {
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
  if (!supabase) throw new Error('Database client not initialized. Call initDb() and set provider-specific database environment variables.');
}

async function ensureMigrationLogTable(client) {
  await client.query(`
    create table if not exists migration_log (
      id bigint generated always as identity primary key,
      migration_name text not null,
      executed_at timestamptz default now(),
      status text not null,
      details jsonb,
      execution_time_ms integer
    );
  `);
  await client.query(`create index if not exists idx_migration_log_name on migration_log(migration_name);`);
  await client.query(`create index if not exists idx_migration_log_status on migration_log(status);`);
  await client.query(`create index if not exists idx_migration_log_executed on migration_log(executed_at desc);`);
}

function migrationNameAliases(fileName) {
  const baseName = String(fileName || '').replace(/\.sql$/i, '');
  return [String(fileName || ''), baseName].filter(Boolean);
}

async function getSuccessfulMigrationNames(client) {
  await ensureMigrationLogTable(client);
  const { rows } = await client.query(
    `select distinct migration_name
       from migration_log
      where status = 'success'
        and migration_name is not null`
  );
  return new Set((rows || []).map((row) => String(row.migration_name || '').trim()).filter(Boolean));
}

async function recordMigrationResult(client, fileName, status, details = {}, executionTimeMs = null) {
  await ensureMigrationLogTable(client);
  await client.query(
    `insert into migration_log (migration_name, status, details, execution_time_ms)
     values ($1, $2, $3::jsonb, $4)`,
    [String(fileName), String(status), JSON.stringify(details || {}), executionTimeMs]
  );
}

// 마이그레이션 실행 함수
export async function runMigrations() {
  const dbUrl = getDbUrl();
  if (!dbUrl) {
    console.warn('[Migration] Direct database URL not available, skipping migrations');
    return;
  }

  const client = createPgClient(dbUrl);
  await client.connect();

  try {
    console.log('[Migration] Starting database migrations...');
    await ensureMigrationLogTable(client);
    const successfulMigrations = await getSuccessfulMigrationNames(client);

    const migrationsDir = path.join(process.cwd(), 'server', 'migrations');
    const migrationFiles = fs.existsSync(migrationsDir)
      ? fs.readdirSync(migrationsDir)
        .filter((fileName) => /^\d+_.+\.sql$/i.test(fileName))
        .sort((a, b) => a.localeCompare(b, 'en'))
      : [];

    for (const fileName of migrationFiles) {
      const filePath = path.join(migrationsDir, fileName);
      
      if (fs.existsSync(filePath)) {
        const aliases = migrationNameAliases(fileName);
        if (aliases.some((name) => successfulMigrations.has(name))) {
          console.log(`[Migration] Skipping already successful ${fileName}`);
          continue;
        }

        console.log(`[Migration] Executing ${fileName}...`);
        const sql = fs.readFileSync(filePath, 'utf8');
        const startedAt = Date.now();
        
        try {
          await client.query(sql);
          const executionTimeMs = Date.now() - startedAt;
          await recordMigrationResult(client, fileName, 'success', { source: 'runner' }, executionTimeMs);
          successfulMigrations.add(fileName);
          successfulMigrations.add(fileName.replace(/\.sql$/i, ''));
          console.log(`[Migration] Successfully executed ${fileName}`);
        } catch (error) {
          console.error(`[Migration] Failed to execute ${fileName}:`, error.message);
          await recordMigrationResult(client, fileName, 'failed', { source: 'runner', error: error.message }, Date.now() - startedAt);
          throw error;
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
  const dbUrl = getDbUrl();
  if (!dbUrl) {
    console.warn('[Migration] Direct database URL not available, skipping channel ID migration');
    return;
  }
  
  const client = createPgClient(dbUrl);
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
  const dbUrl = getDbUrl();
  if (!dbUrl) {
    throw new Error('A direct database URL is required for token generation');
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
  const dbUrl = getDbUrl();
  if (!dbUrl) {
    throw new Error('A direct database URL is required for token validation');
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
  const dbUrl = getDbUrl();
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

async function ensureBotEventLogTables() {
  await withPgClient(async (pg) => {
    await pg.query(`
      create table if not exists public.bot_event_logs (
        id text primary key,
        owner_user_id text not null,
        sid text,
        channel_uid text,
        provider text,
        category text not null
          check (category in ('command', 'donation', 'roulette', 'video_donation', 'drawing_donation', 'prediction')),
        event_type text not null,
        source text,
        trigger_name text,
        target_name text,
        viewer_user_id text,
        viewer_name text,
        point_delta integer not null default 0,
        point_before integer,
        point_after integer,
        status text not null default 'success'
          check (status in ('success', 'failed', 'cancelled', 'refunded')),
        summary text,
        result_label text,
        result_value text,
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );
      create index if not exists idx_bot_event_logs_owner_created
        on public.bot_event_logs(owner_user_id, created_at desc);
      create index if not exists idx_bot_event_logs_created
        on public.bot_event_logs(created_at desc, id desc);
      create index if not exists idx_bot_event_logs_owner_category_created
        on public.bot_event_logs(owner_user_id, category, created_at desc);
      create index if not exists idx_bot_event_logs_owner_provider_created
        on public.bot_event_logs(owner_user_id, provider, created_at desc);
      create index if not exists idx_bot_event_logs_owner_viewer_created
        on public.bot_event_logs(owner_user_id, viewer_user_id, created_at desc);
    `);
  });
}

function normalizeBotEventCategory(category) {
  const value = String(category || '').trim().toLowerCase();
  return ['command', 'donation', 'roulette', 'video_donation', 'drawing_donation', 'prediction'].includes(value) ? value : 'command';
}

function normalizeBotEventStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  return ['success', 'failed', 'cancelled', 'refunded'].includes(value) ? value : 'success';
}

export async function recordBotEventLog(event = {}) {
  const ownerUserId = String(event.ownerUserId || event.owner_user_id || '').replace(/^user:/, '').trim();
  if (!ownerUserId) return null;
  await ensureBotEventLogTables();
  const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
  const id = event.id ? String(event.id) : makeId('evt');
  return withPgClient(async (pg) => {
    const result = await pg.query(
      `insert into public.bot_event_logs (
         id, owner_user_id, sid, channel_uid, provider, category, event_type, source,
         trigger_name, target_name, viewer_user_id, viewer_name,
         point_delta, point_before, point_after, status, summary, result_label, result_value, metadata, created_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12,
         $13, $14, $15, $16, $17, $18, $19, $20::jsonb, coalesce($21::timestamptz, now())
       )
       returning *`,
      [
        id,
        ownerUserId,
        event.sid ? String(event.sid) : null,
        event.channelUid || event.channel_uid ? String(event.channelUid || event.channel_uid) : null,
        event.provider ? String(event.provider).toLowerCase() : null,
        normalizeBotEventCategory(event.category),
        String(event.eventType || event.event_type || 'event').slice(0, 80),
        event.source ? String(event.source).slice(0, 120) : null,
        event.triggerName || event.trigger_name ? String(event.triggerName || event.trigger_name).slice(0, 160) : null,
        event.targetName || event.target_name ? String(event.targetName || event.target_name).slice(0, 200) : null,
        event.viewerUserId || event.viewer_user_id ? String(event.viewerUserId || event.viewer_user_id).slice(0, 200) : null,
        event.viewerName || event.viewer_name ? String(event.viewerName || event.viewer_name).slice(0, 200) : null,
        Number(event.pointDelta ?? event.point_delta ?? 0) || 0,
        event.pointBefore ?? event.point_before ?? null,
        event.pointAfter ?? event.point_after ?? null,
        normalizeBotEventStatus(event.status),
        event.summary ? String(event.summary).slice(0, 1000) : null,
        event.resultLabel || event.result_label ? String(event.resultLabel || event.result_label).slice(0, 300) : null,
        event.resultValue || event.result_value ? String(event.resultValue || event.result_value).slice(0, 1000) : null,
        JSON.stringify(metadata),
        event.createdAt || event.created_at ? new Date(event.createdAt || event.created_at).toISOString() : null,
      ]
    );
    return result.rows?.[0] || null;
  });
}

function parseEventLogDate(value, endOfDay = false) {
  const text = String(value || '').trim();
  if (!text) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+09:00`)
    : new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export async function listBotEventLogs(ownerUserId, options = {}) {
  const owner = String(ownerUserId || '').replace(/^user:/, '').trim();
  if (!owner) return { logs: [], total: 0, page: 1, limit: 25, totalPages: 1 };
  await ensureBotEventLogTables();

  const page = Math.max(1, Number(options.page || 1) || 1);
  const limit = Math.max(1, Math.min(100, Number(options.limit || 25) || 25));
  const offset = (page - 1) * limit;
  const params = [owner];
  const where = ['owner_user_id = $1'];

  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  const category = String(options.category || '').trim().toLowerCase();
  if (category && category !== 'all') where.push(`category = ${addParam(category)}`);

  const provider = String(options.provider || '').trim().toLowerCase();
  if (provider && provider !== 'all') where.push(`provider = ${addParam(provider)}`);

  const from = parseEventLogDate(options.from || options.startDate || options.start);
  if (from) where.push(`created_at >= ${addParam(from)}::timestamptz`);

  const to = parseEventLogDate(options.to || options.endDate || options.end, true);
  if (to) where.push(`created_at <= ${addParam(to)}::timestamptz`);

  const query = String(options.q || options.query || '').trim();
  if (query) {
    const needle = `%${query.replace(/[%_\\]/g, '\\$&')}%`;
    const slot = addParam(needle);
    where.push(`(
      viewer_user_id ilike ${slot} escape '\\'
      or viewer_name ilike ${slot} escape '\\'
      or trigger_name ilike ${slot} escape '\\'
      or target_name ilike ${slot} escape '\\'
      or summary ilike ${slot} escape '\\'
    )`);
  }

  const whereSql = where.join(' and ');
  return withPgClient(async (pg) => {
    const countResult = await pg.query(`select count(*)::int as total from public.bot_event_logs where ${whereSql}`, params);
    const rowParams = [...params, limit, offset];
    const rowsResult = await pg.query(
      `select *
         from public.bot_event_logs
        where ${whereSql}
        order by created_at desc, id desc
        limit $${rowParams.length - 1} offset $${rowParams.length}`,
      rowParams
    );
    const total = Number(countResult.rows?.[0]?.total || 0);
    return {
      logs: rowsResult.rows || [],
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  });
}

export async function getBotEventLog(ownerUserId, id) {
  const owner = String(ownerUserId || '').replace(/^user:/, '').trim();
  const logId = String(id || '').trim();
  if (!owner || !logId) return null;
  await ensureBotEventLogTables();
  return withPgClient(async (pg) => {
    const result = await pg.query(
      `select *
         from public.bot_event_logs
        where owner_user_id = $1 and id = $2
        limit 1`,
      [owner, logId]
    );
    return result.rows?.[0] || null;
  });
}

async function ensureDrawingDonationTables() {
  await withPgClient(async (pg) => {
    await pg.query(`
      create table if not exists public.drawing_donation_items (
        id text primary key,
        sid text not null,
        owner_user_id text,
        channel_uid text not null,
        viewer_user_id text not null,
        viewer_name text,
        status text not null default 'queued'
          check (status in ('queued', 'approved', 'playing', 'done', 'rejected', 'deleted')),
        cost integer not null default 0,
        point_deductions jsonb not null default '[]'::jsonb,
        point_refunded boolean not null default false,
        canvas jsonb not null default '{}'::jsonb,
        strokes jsonb not null default '[]'::jsonb,
        stroke_object_key text,
        preview_image text,
        preview_object_key text,
        metrics jsonb not null default '{}'::jsonb,
        replay jsonb not null default '{}'::jsonb,
        result_hold_sec integer not null default 8,
        position integer not null default 0,
        created_at timestamptz not null default now(),
        approved_at timestamptz,
        playing_at timestamptz,
        rejected_at timestamptz,
        done_at timestamptz,
        updated_at timestamptz not null default now()
      );
      create index if not exists idx_drawing_donation_sid_status_created
        on public.drawing_donation_items(sid, status, created_at);
      create index if not exists idx_drawing_donation_sid_status_position_created
        on public.drawing_donation_items(sid, status, position, created_at);
      create index if not exists idx_drawing_donation_sid_position
        on public.drawing_donation_items(sid, position, created_at);
      create index if not exists idx_drawing_donation_viewer_created
        on public.drawing_donation_items(sid, viewer_user_id, created_at desc);
      alter table public.drawing_donation_items add column if not exists stroke_object_key text;
      alter table public.drawing_donation_items add column if not exists preview_object_key text;
    `);
  });
}

function normalizeDrawingDonationRow(row, { includeStrokes = false } = {}) {
  if (!row) return null;
  const item = {
    id: row.id,
    ownerSid: row.sid,
    ownerUserId: row.owner_user_id || null,
    channelUid: row.channel_uid,
    viewerUserId: row.viewer_user_id,
    viewerName: row.viewer_name || null,
    status: row.status,
    cost: Number(row.cost || 0),
    pointDeductions: Array.isArray(row.point_deductions) ? row.point_deductions : [],
    pointRefunded: row.point_refunded === true,
    canvas: row.canvas || {},
    previewImage: row.preview_image || null,
    strokeObjectKey: row.stroke_object_key || null,
    previewObjectKey: row.preview_object_key || null,
    metrics: row.metrics || {},
    replay: row.replay || {},
    resultHoldSec: Number(row.result_hold_sec || 8),
    position: Number(row.position || 0),
    createdAt: row.created_at || null,
    approvedAt: row.approved_at || null,
    playingAt: row.playing_at || null,
    rejectedAt: row.rejected_at || null,
    doneAt: row.done_at || null,
    updatedAt: row.updated_at || null,
  };
  if (includeStrokes) item.strokes = Array.isArray(row.strokes) ? row.strokes : [];
  return item;
}

export async function uploadDrawingDonationObject(key, payload, contentType = 'application/json') {
  const storage = getSupabaseStorageClient();
  if (!storage || !key) return null;
  const body = typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload);
  const { error } = await storage.client.storage.from(storage.bucket).upload(key, body, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(error.message || 'drawing_storage_upload_failed');
  return key;
}

export async function downloadDrawingDonationJson(key) {
  const storage = getSupabaseStorageClient();
  if (!storage || !key) return null;
  const { data, error } = await storage.client.storage.from(storage.bucket).download(key);
  if (error || !data) throw new Error(error?.message || 'drawing_storage_download_failed');
  const text = await data.text();
  return JSON.parse(text);
}

async function hydrateDrawingDonationStrokes(item) {
  if (!item || !item.strokeObjectKey || (Array.isArray(item.strokes) && item.strokes.length)) return item;
  try {
    const strokes = await downloadDrawingDonationJson(item.strokeObjectKey);
    item.strokes = Array.isArray(strokes) ? strokes : Array.isArray(strokes?.strokes) ? strokes.strokes : [];
  } catch (error) {
    console.warn('[Drawing Donation] stroke object load failed:', error?.message || error);
    item.strokes = [];
  }
  return item;
}

export async function insertDrawingDonationItem(item = {}) {
  await ensureDrawingDonationTables();
  const id = item.id ? String(item.id) : makeId('draw');
  const sid = String(item.ownerSid || item.sid || '');
  if (!sid) throw new Error('sid required');
  return withPgClient(async (pg) => {
    const positionResult = await pg.query(
      `select coalesce(max(position), -1) + 1 as next_position
         from public.drawing_donation_items
        where sid = $1 and status in ('queued', 'approved', 'playing')`,
      [sid]
    );
    const position = Number(positionResult.rows?.[0]?.next_position || 0);
    const result = await pg.query(
      `insert into public.drawing_donation_items (
         id, sid, owner_user_id, channel_uid, viewer_user_id, viewer_name, status,
         cost, point_deductions, point_refunded, canvas, strokes, stroke_object_key, preview_image, preview_object_key,
         metrics, replay, result_hold_sec, position, created_at, approved_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9::jsonb, $10, $11::jsonb, $12::jsonb, $13, $14, $15,
         $16::jsonb, $17::jsonb, $18, $19, coalesce($20::timestamptz, now()), $21::timestamptz
       )
       returning *`,
      [
        id,
        sid,
        item.ownerUserId || item.owner_user_id ? String(item.ownerUserId || item.owner_user_id) : null,
        String(item.channelUid || item.channel_uid || ''),
        String(item.viewerUserId || item.viewer_user_id || ''),
        item.viewerName || item.viewer_name ? String(item.viewerName || item.viewer_name).slice(0, 200) : null,
        ['queued', 'approved', 'playing', 'done', 'rejected', 'deleted'].includes(String(item.status)) ? String(item.status) : 'queued',
        Math.max(0, Number(item.cost || 0) || 0),
        JSON.stringify(Array.isArray(item.pointDeductions) ? item.pointDeductions : []),
        item.pointRefunded === true,
        JSON.stringify(item.canvas && typeof item.canvas === 'object' ? item.canvas : {}),
        JSON.stringify(Array.isArray(item.strokes) ? item.strokes : []),
        item.strokeObjectKey || item.stroke_object_key ? String(item.strokeObjectKey || item.stroke_object_key) : null,
        item.previewImage ? String(item.previewImage).slice(0, 512 * 1024) : null,
        item.previewObjectKey || item.preview_object_key ? String(item.previewObjectKey || item.preview_object_key) : null,
        JSON.stringify(item.metrics && typeof item.metrics === 'object' ? item.metrics : {}),
        JSON.stringify(item.replay && typeof item.replay === 'object' ? item.replay : {}),
        Math.max(1, Number(item.resultHoldSec || 8) || 8),
        position,
        item.createdAt || item.created_at ? new Date(item.createdAt || item.created_at).toISOString() : null,
        item.approvedAt || item.approved_at ? new Date(item.approvedAt || item.approved_at).toISOString() : null,
      ]
    );
    return normalizeDrawingDonationRow(result.rows?.[0], { includeStrokes: true });
  });
}

export async function listDrawingDonationItems(sid, { limit = 100, includeDone = false } = {}) {
  await ensureDrawingDonationTables();
  return withPgClient(async (pg) => {
    const statuses = includeDone
      ? ['queued', 'approved', 'playing', 'done', 'rejected']
      : ['queued', 'approved', 'playing'];
    const result = await pg.query(
      `select id, sid, owner_user_id, channel_uid, viewer_user_id, viewer_name, status,
              cost, point_deductions, point_refunded, canvas, preview_image, preview_object_key, stroke_object_key,
              metrics, replay, result_hold_sec, position,
              created_at, approved_at, playing_at, rejected_at, done_at, updated_at
         from public.drawing_donation_items
        where sid = $1 and status = any($2::text[])
        order by position asc, created_at asc
        limit $3`,
      [String(sid), statuses, Math.max(1, Math.min(200, Number(limit || 100)))]
    );
    return (result.rows || []).map((row) => normalizeDrawingDonationRow(row));
  });
}

export async function getDrawingDonationItem(sid, id, { includeStrokes = false } = {}) {
  await ensureDrawingDonationTables();
  return withPgClient(async (pg) => {
    const columns = includeStrokes ? '*' : `id, sid, owner_user_id, channel_uid, viewer_user_id, viewer_name, status,
      cost, point_deductions, point_refunded, canvas, preview_image, preview_object_key, stroke_object_key, metrics, replay,
      result_hold_sec, position, created_at, approved_at, playing_at, rejected_at, done_at, updated_at`;
    const result = await pg.query(
      `select ${columns} from public.drawing_donation_items where sid = $1 and id = $2 limit 1`,
      [String(sid), String(id)]
    );
    const item = normalizeDrawingDonationRow(result.rows?.[0], { includeStrokes });
    return includeStrokes ? hydrateDrawingDonationStrokes(item) : item;
  });
}

export async function getCurrentDrawingDonationItem(sid) {
  await ensureDrawingDonationTables();
  return withPgClient(async (pg) => {
    const result = await pg.query(
      `with existing as (
         select *
           from public.drawing_donation_items
          where sid = $1 and status = 'playing'
          order by position asc, created_at asc
          limit 1
       ),
       promoted as (
         update public.drawing_donation_items
            set status = 'playing', playing_at = coalesce(playing_at, now()), updated_at = now()
          where id = (
            select id
              from public.drawing_donation_items
             where sid = $1
               and status = 'approved'
               and not exists (select 1 from existing)
             order by position asc, created_at asc
             limit 1
             for update skip locked
          )
          returning *
       )
       select * from existing
       union all
       select * from promoted
       limit 1`,
      [String(sid)]
    );
    return hydrateDrawingDonationStrokes(normalizeDrawingDonationRow(result.rows?.[0], { includeStrokes: true }));
  });
}

export async function updateDrawingDonationItemStatus(sid, id, status, extra = {}) {
  await ensureDrawingDonationTables();
  const nextStatus = ['queued', 'approved', 'playing', 'done', 'rejected', 'deleted'].includes(String(status)) ? String(status) : 'queued';
  const timestampColumn = nextStatus === 'approved' ? 'approved_at'
    : nextStatus === 'playing' ? 'playing_at'
      : nextStatus === 'done' ? 'done_at'
        : nextStatus === 'rejected' ? 'rejected_at'
          : null;
  return withPgClient(async (pg) => {
    const setParts = ['status = $3', 'updated_at = now()'];
    const params = [String(sid), String(id), nextStatus];
    if (timestampColumn) setParts.push(`${timestampColumn} = coalesce(${timestampColumn}, now())`);
    if (extra.pointRefunded != null) {
      params.push(extra.pointRefunded === true);
      setParts.push(`point_refunded = $${params.length}`);
    }
    const result = await pg.query(
      `update public.drawing_donation_items
          set ${setParts.join(', ')}
        where sid = $1 and id = $2
        returning *`,
      params
    );
    return hydrateDrawingDonationStrokes(normalizeDrawingDonationRow(result.rows?.[0], { includeStrokes: true }));
  });
}

export async function deleteDrawingDonationItem(sid, id) {
  await ensureDrawingDonationTables();
  const item = await withPgClient(async (pg) => {
    const result = await pg.query(
      `delete from public.drawing_donation_items where sid = $1 and id = $2 returning *`,
      [String(sid), String(id)]
    );
    return hydrateDrawingDonationStrokes(normalizeDrawingDonationRow(result.rows?.[0], { includeStrokes: true }));
  });
  const objectKeys = collectDrawingDonationObjectKeys(item);
  if (objectKeys.length) {
    try {
      await deleteDrawingDonationObjectKeys(objectKeys);
    } catch (error) {
      console.warn('[Drawing Donation] object delete failed:', error?.message || error);
    }
  }
  return item;
}

async function tableExistsPg(pg, tableName) {
  const normalized = String(tableName || '').includes('.') ? String(tableName) : `public.${String(tableName || '')}`;
  const { rows } = await pg.query(`select to_regclass($1) as table_name`, [normalized]);
  return !!rows?.[0]?.table_name;
}

async function tableColumnsPg(pg, tableName) {
  const normalized = String(tableName || '');
  const [schema, table] = normalized.includes('.') ? normalized.split('.', 2) : ['public', normalized];
  const { rows } = await pg.query(
    `select column_name
       from information_schema.columns
      where table_schema = $1 and table_name = $2`,
    [schema || 'public', table]
  );
  return new Set((rows || []).map((row) => String(row.column_name)));
}

function addPrivacyDeleteCount(summary, tableName, rowCount) {
  const count = Number(rowCount || 0);
  if (!count) return;
  summary.deleted[tableName] = (summary.deleted[tableName] || 0) + count;
}

async function deleteRowsByColumnValues(pg, summary, tableName, columnValues = []) {
  if (!await tableExistsPg(pg, tableName)) return 0;
  const columns = await tableColumnsPg(pg, tableName);
  const params = [];
  const where = [];
  for (const item of columnValues) {
    const column = String(item?.column || '').trim();
    const values = uniqueNonEmpty(item?.values);
    if (!column || !columns.has(column) || !values.length) continue;
    params.push(values);
    where.push(`${quoteIdent(column)} = any($${params.length}::text[])`);
  }
  if (!where.length) return 0;
  const result = await pg.query(`delete from ${quoteIdent(tableName)} where ${where.join(' or ')}`, params);
  addPrivacyDeleteCount(summary, tableName, result.rowCount);
  return result.rowCount || 0;
}

async function deleteRowsWhere(pg, summary, tableName, whereSql, params = []) {
  if (!await tableExistsPg(pg, tableName)) return 0;
  const result = await pg.query(`delete from ${quoteIdent(tableName)} where ${whereSql}`, params);
  addPrivacyDeleteCount(summary, tableName, result.rowCount);
  return result.rowCount || 0;
}

async function collectDrawingDonationKeysWhere(pg, whereSql, params = []) {
  if (!await tableExistsPg(pg, 'public.drawing_donation_items')) return [];
  const { rows } = await pg.query(
    `select stroke_object_key, preview_object_key
       from public.drawing_donation_items
      where ${whereSql}`,
    params
  );
  return uniqueNonEmpty((rows || []).flatMap((row) => collectDrawingDonationObjectKeys(row)));
}

function addIdentityCandidates(target, values = []) {
  for (const value of values) {
    for (const candidate of pointLookupCandidates(value)) target.add(candidate);
    const text = String(value || '').trim();
    if (text) target.add(text);
  }
}

function addPlatformAccountCandidates(target, account) {
  addIdentityCandidates(target, [
    account?.user_id,
    account?.platform_user_id,
    account?.channel_id,
    account?.channel_handle,
    account?.provider && account?.platform_user_id ? `${account.provider}:${account.platform_user_id}` : null,
    account?.provider && account?.channel_id ? `${account.provider}:${account.channel_id}` : null,
    account?.provider && account?.channel_handle ? `${account.provider}:${account.channel_handle}` : null,
    ...collectPlatformPointIdentityKeys(account),
  ]);
}

async function collectAccountPrivacyScope(pg, ownerUserId) {
  const owner = String(ownerUserId || '').replace(/^user:/, '').trim();
  const ownerSid = owner ? `user:${owner}` : '';
  const identityKeys = new Set();
  const channelAliases = new Set();
  addIdentityCandidates(identityKeys, [owner, ownerSid, owner ? makeArubotViewerUuid(owner) : null]);
  addIdentityCandidates(channelAliases, [owner, ownerSid]);

  if (owner && await tableExistsPg(pg, 'public.app_users')) {
    const appUser = await pg.query(
      `select id, primary_provider, primary_platform_user_id, display_name
         from public.app_users
        where id = $1
        limit 1`,
      [owner]
    );
    const row = appUser.rows?.[0];
    if (row) {
      addIdentityCandidates(identityKeys, [row.id, row.primary_platform_user_id, row.display_name]);
      addIdentityCandidates(channelAliases, [row.id, row.primary_platform_user_id]);
      if (row.primary_provider && row.primary_platform_user_id) {
        addIdentityCandidates(identityKeys, [`${row.primary_provider}:${row.primary_platform_user_id}`]);
        addIdentityCandidates(channelAliases, [`${row.primary_provider}:${row.primary_platform_user_id}`]);
      }
    }
  }

  if (owner && await tableExistsPg(pg, 'public.platform_accounts')) {
    const accounts = await pg.query(
      `select user_id, provider, platform_user_id, channel_id, channel_name, channel_handle, avatar_url, metadata
         from public.platform_accounts
        where user_id = $1`,
      [owner]
    );
    for (const account of accounts.rows || []) {
      addPlatformAccountCandidates(identityKeys, account);
      addPlatformAccountCandidates(channelAliases, account);
    }
  }

  return {
    owner,
    ownerSid,
    ownerPids: uniqueNonEmpty([owner, ownerSid]),
    identityKeys: uniqueNonEmpty(Array.from(identityKeys)),
    channelAliases: uniqueNonEmpty(Array.from(channelAliases)),
  };
}

async function deleteDynamicChannelPointRows(pg, summary, scope) {
  const result = await pg.query(
    `select table_schema, table_name
       from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'
        and table_name like 'channelpoint\\_%' escape '\\'`
  );
  const ownedPointTables = new Set(scope.channelAliases.map((alias) => `channelpoint_${sanitizeTableNameSuffix(alias)}`));
  for (const row of result.rows || []) {
    const tableName = `${row.table_schema}.${row.table_name}`;
    const fullChannelDelete = ownedPointTables.has(String(row.table_name));
    const deleteResult = fullChannelDelete
      ? await pg.query(`delete from ${quoteIdent(tableName)}`)
      : await pg.query(`delete from ${quoteIdent(tableName)} where user_id = any($1::text[])`, [scope.identityKeys]);
    addPrivacyDeleteCount(summary, tableName, deleteResult.rowCount);
  }
}

export async function deleteAccountData(ownerUserId, options = {}) {
  const owner = String(ownerUserId || '').replace(/^user:/, '').trim();
  if (!owner || !getDbUrl()) return { ok: false, deleted: {}, objectKeysDeleted: 0, reason: 'missing_owner_or_database' };
  const summary = {
    ok: true,
    ownerUserId: owner,
    reason: String(options.reason || 'user_request').slice(0, 120),
    deleted: {},
    objectKeysDeleted: 0,
    objectKeysSkipped: 0,
  };
  const drawingObjectKeys = [];

  await withPgClient(async (pg) => {
    const scope = await collectAccountPrivacyScope(pg, owner);
    await pg.query('begin');
    try {
      await deleteRowsByColumnValues(pg, summary, 'public.prediction_bets', [
        { column: 'user_id', values: scope.identityKeys },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.prediction_events', [
        { column: 'sid', values: scope.channelAliases },
        { column: 'channel_uid', values: scope.channelAliases },
      ]);
      if (await tableExistsPg(pg, 'public.drawing_donation_items')) {
        drawingObjectKeys.push(...await collectDrawingDonationKeysWhere(
          pg,
          `owner_user_id = any($1::text[]) or sid = any($2::text[]) or channel_uid = any($2::text[]) or viewer_user_id = any($3::text[])`,
          [[scope.owner], scope.channelAliases, scope.identityKeys]
        ));
      }
      await deleteRowsByColumnValues(pg, summary, 'public.drawing_donation_items', [
        { column: 'owner_user_id', values: [scope.owner] },
        { column: 'sid', values: scope.channelAliases },
        { column: 'channel_uid', values: scope.channelAliases },
        { column: 'viewer_user_id', values: scope.identityKeys },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.bot_event_logs', [
        { column: 'owner_user_id', values: [scope.owner] },
        { column: 'sid', values: scope.channelAliases },
        { column: 'channel_uid', values: scope.channelAliases },
        { column: 'viewer_user_id', values: scope.identityKeys },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.video_donation_queue', [
        { column: 'channel_uid', values: scope.channelAliases },
        { column: 'requester_user_id', values: scope.identityKeys },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.viewer_playback_state', [
        { column: 'channel_uid', values: scope.channelAliases },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.macro_schedules', [
        { column: 'channel_uid', values: scope.channelAliases },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.channel_points_balances', [
        { column: 'channel_uid', values: scope.channelAliases },
        { column: 'user_id', values: scope.identityKeys },
      ]);
      await deleteDynamicChannelPointRows(pg, summary, scope);
      await deleteRowsByColumnValues(pg, summary, 'public.automation_jobs', [
        { column: 'owner_user_id', values: [scope.owner] },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.automation_connections', [
        { column: 'owner_user_id', values: [scope.owner] },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.automation_local_agents', [
        { column: 'owner_user_id', values: [scope.owner] },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.automation_settings', [
        { column: 'owner_user_id', values: [scope.owner] },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.action_blueprint_runs', [
        { column: 'owner_user_id', values: [scope.owner] },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.action_blueprints', [
        { column: 'owner_user_id', values: [scope.owner] },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.action_blueprint_versions', [
        { column: 'owner_user_id', values: [scope.owner] },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.youtube_streamer_channels', [
        { column: 'owner_user_id', values: [scope.owner] },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.platform_tokens', [
        { column: 'user_id', values: [scope.owner] },
        { column: 'platform_user_id', values: scope.identityKeys },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.platform_accounts', [
        { column: 'user_id', values: [scope.owner] },
        { column: 'platform_user_id', values: scope.identityKeys },
        { column: 'channel_id', values: scope.identityKeys },
        { column: 'channel_handle', values: scope.identityKeys },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.sessions', [
        { column: 'sid', values: scope.channelAliases },
        { column: 'user_id', values: scope.identityKeys },
        { column: 'account_user_id', values: [scope.owner] },
        { column: 'channel_id', values: scope.channelAliases },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.tokens', [
        { column: 'sid', values: scope.channelAliases },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.channel_tokens', [
        { column: 'sid', values: scope.channelAliases },
        { column: 'channel_id', values: scope.channelAliases },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.channel_viewer_tokens', [
        { column: 'channel_uid', values: scope.channelAliases },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.live_sessions', [
        { column: 'sid', values: scope.channelAliases },
        { column: 'channel_id', values: scope.channelAliases },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.roulette_sessions', [
        { column: 'sid', values: scope.channelAliases },
        { column: 'channel_id', values: scope.channelAliases },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.bot_settings', [
        { column: 'sid', values: scope.channelAliases },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.bot_stats', [
        { column: 'sid', values: scope.channelAliases },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.bot_rules', [
        { column: 'sid', values: scope.channelAliases },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.live_days', [
        { column: 'sid', values: scope.channelAliases },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.attendance_state', [
        { column: 'sid', values: scope.channelAliases },
        { column: 'user_id', values: scope.identityKeys },
        { column: 'userid', values: scope.identityKeys },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.attendance', [
        { column: 'sid', values: scope.channelAliases },
        { column: 'user_id', values: scope.identityKeys },
        { column: 'userid', values: scope.identityKeys },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.api_keys', [
        { column: 'owner_pid', values: scope.ownerPids },
      ]);
      await deleteRowsByColumnValues(pg, summary, 'public.app_users', [
        { column: 'id', values: [scope.owner] },
      ]);
      await pg.query('commit');
    } catch (error) {
      try { await pg.query('rollback'); } catch {}
      throw error;
    }
  }, 0);

  const objectDelete = await deleteDrawingDonationObjectKeys(drawingObjectKeys).catch((error) => {
    console.warn('[Privacy] Drawing donation object cleanup failed:', error?.message || error);
    return { deleted: 0, skipped: uniqueNonEmpty(drawingObjectKeys).length };
  });
  summary.objectKeysDeleted = objectDelete.deleted || 0;
  summary.objectKeysSkipped = objectDelete.skipped || 0;
  return summary;
}

function retentionDays(value, fallbackDays) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallbackDays;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallbackDays;
  return Math.max(0, Math.floor(parsed));
}

function cutoffIsoForDays(days) {
  const normalized = Number(days);
  if (!Number.isFinite(normalized) || normalized <= 0) return null;
  return new Date(Date.now() - normalized * 24 * 60 * 60 * 1000).toISOString();
}

export async function cleanupPrivacyRetentionData(options = {}) {
  if (!getDbUrl()) return { ok: false, deleted: {}, reason: 'missing_database' };
  const config = {
    botEventLogDays: retentionDays(options.botEventLogDays ?? process.env.ARUBOT_BOT_EVENT_LOG_RETENTION_DAYS, 365),
    drawingDonationDays: retentionDays(options.drawingDonationDays ?? process.env.ARUBOT_DRAWING_DONATION_RETENTION_DAYS, 365),
    predictionDays: retentionDays(options.predictionDays ?? process.env.ARUBOT_PREDICTION_RETENTION_DAYS, 365),
    videoDonationDays: retentionDays(options.videoDonationDays ?? process.env.ARUBOT_VIDEO_DONATION_RETENTION_DAYS, 365),
    automationJobDays: retentionDays(options.automationJobDays ?? process.env.ARUBOT_AUTOMATION_JOB_RETENTION_DAYS, 90),
    actionRunDays: retentionDays(options.actionRunDays ?? process.env.ARUBOT_ACTION_RUN_RETENTION_DAYS, 180),
  };
  const summary = { ok: true, deleted: {}, objectKeysDeleted: 0, objectKeysSkipped: 0, config };
  const drawingObjectKeys = [];

  await withPgClient(async (pg) => {
    const botEventLogCutoff = cutoffIsoForDays(config.botEventLogDays);
    if (botEventLogCutoff) {
      await deleteRowsWhere(pg, summary, 'public.bot_event_logs', `created_at < $1::timestamptz`, [botEventLogCutoff]);
    }

    const drawingCutoff = cutoffIsoForDays(config.drawingDonationDays);
    if (drawingCutoff && await tableExistsPg(pg, 'public.drawing_donation_items')) {
      const where = `status in ('done', 'rejected', 'deleted') and created_at < $1::timestamptz`;
      drawingObjectKeys.push(...await collectDrawingDonationKeysWhere(pg, where, [drawingCutoff]));
      await deleteRowsWhere(pg, summary, 'public.drawing_donation_items', where, [drawingCutoff]);
    }

    const predictionCutoff = cutoffIsoForDays(config.predictionDays);
    if (predictionCutoff) {
      await deleteRowsWhere(pg, summary, 'public.prediction_events', `status in ('settled', 'cancelled') and created_at < $1::timestamptz`, [predictionCutoff]);
    }

    const videoDonationCutoff = cutoffIsoForDays(config.videoDonationDays);
    if (videoDonationCutoff) {
      await deleteRowsWhere(pg, summary, 'public.video_donation_queue', `status in ('played', 'refunded', 'failed', 'skipped') and updated_at < $1::timestamptz`, [videoDonationCutoff]);
    }

    const automationJobCutoff = cutoffIsoForDays(config.automationJobDays);
    if (automationJobCutoff) {
      await deleteRowsWhere(pg, summary, 'public.automation_jobs', `status in ('done', 'failed') and updated_at < $1::timestamptz`, [automationJobCutoff]);
    }

    const actionRunCutoff = cutoffIsoForDays(config.actionRunDays);
    if (actionRunCutoff) {
      await deleteRowsWhere(pg, summary, 'public.action_blueprint_runs', `finished_at is not null and finished_at < $1::timestamptz`, [actionRunCutoff]);
    }
  });

  const objectDelete = await deleteDrawingDonationObjectKeys(drawingObjectKeys).catch((error) => {
    console.warn('[Privacy] Retention object cleanup failed:', error?.message || error);
    return { deleted: 0, skipped: uniqueNonEmpty(drawingObjectKeys).length };
  });
  summary.objectKeysDeleted = objectDelete.deleted || 0;
  summary.objectKeysSkipped = objectDelete.skipped || 0;
  return summary;
}

export async function reorderDrawingDonationItems(sid, ids = []) {
  await ensureDrawingDonationTables();
  const normalizedIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean)));
  if (!normalizedIds.length) return listDrawingDonationItems(sid, { limit: 100 });
  return withPgClient(async (pg) => {
    await pg.query('begin');
    try {
      for (let index = 0; index < normalizedIds.length; index += 1) {
        await pg.query(
          `update public.drawing_donation_items
              set position = $3, updated_at = now()
            where sid = $1
              and id = $2
              and status in ('queued', 'approved', 'playing')`,
          [String(sid), normalizedIds[index], index]
        );
      }
      await pg.query('commit');
      const result = await pg.query(
        `select id, sid, owner_user_id, channel_uid, viewer_user_id, viewer_name, status,
                cost, point_deductions, point_refunded, canvas, preview_image,
                metrics, replay, result_hold_sec, position,
                created_at, approved_at, playing_at, rejected_at, done_at, updated_at
           from public.drawing_donation_items
          where sid = $1
            and status = any($2::text[])
          order by position asc, created_at asc
          limit 100`,
        [String(sid), ['queued', 'approved', 'playing']]
      );
      return (result.rows || []).map((row) => normalizeDrawingDonationRow(row));
    } catch (error) {
      try { await pg.query('rollback'); } catch {}
      throw error;
    }
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

export async function getActivePredictionForChannel(channelUid, options = {}) {
  await ensurePredictionTables();
  return withPgClient(async (pg) => {
    const channelIdentity = await resolvePointChannelIdentity(pg, channelUid);
    const channelAliases = channelIdentity.channelAliases.length ? channelIdentity.channelAliases : [String(channelUid)];
    const includeRecentlySettled = options.includeRecentlySettled === true;
    const resultVisibleMs = Math.max(1000, Math.min(30000, Number(options.resultVisibleMs || 5000)));
    const result = await pg.query(
      `select * from prediction_events
       where channel_uid = any($1::text[])
         and (
           status in ('open', 'locked')
           or (
             $2::boolean = true
             and status = 'settled'
             and settled_at is not null
             and settled_at >= now() - ($3::int * interval '1 millisecond')
           )
         )
       order by
         case when status in ('open', 'locked') then 0 else 1 end,
         coalesce(settled_at, locked_at, created_at) desc
       limit 1`,
      [channelAliases, includeRecentlySettled, resultVisibleMs]
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
    const table = await ensureChannelPointsTableWithClient(pg, row.channel_uid);
    const bets = await pg.query(`select * from prediction_bets where prediction_id = $1 and refunded = false`, [row.id]);
    const eventLogs = [];
    for (const bet of bets.rows || []) {
      await pg.query(
        `insert into ${table} (user_id, username, points) values ($1, $2, $3)
         on conflict (user_id) do update set
           username = coalesce(excluded.username, ${table}.username),
           points = ${table}.points + excluded.points`,
        [String(bet.user_id), bet.username ? String(bet.username) : null, Number(bet.amount || 0)]
      );
      eventLogs.push({
        eventType: 'prediction_refund',
        userId: String(bet.user_id),
        username: bet.username || null,
        pointDelta: Number(bet.amount || 0),
        optionId: bet.option_id || null,
      });
    }
    await pg.query(`update prediction_bets set refunded = true, updated_at = now() where prediction_id = $1`, [row.id]);
    await pg.query(
      `update prediction_events set status = 'cancelled', settlement_note = $3, settled_at = now()
       where id = $1 and sid = $2`,
      [row.id, String(sid), 'cancelled_refunded']
    );
    const normalized = await fetchPredictionWithBets(pg, predictionId);
    if (normalized) normalized._eventLogs = eventLogs;
    return normalized;
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

    const table = await ensureChannelPointsTableWithClient(pg, row.channel_uid);
    const bets = await pg.query(`select * from prediction_bets where prediction_id = $1 order by created_at asc`, [row.id]);
    const allBets = bets.rows || [];
    const eventLogs = [];
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
        eventLogs.push({
          eventType: 'prediction_refund',
          userId: String(bet.user_id),
          username: bet.username || null,
          pointDelta: Number(bet.amount || 0),
          optionId: bet.option_id || null,
        });
      }
      await pg.query(`update prediction_bets set refunded = true, updated_at = now() where prediction_id = $1`, [row.id]);
      await pg.query(
        `update prediction_events
         set status = 'settled', winning_option_id = $3, settlement_note = 'no_winner_refunded', settled_at = now()
         where id = $1 and sid = $2`,
        [row.id, String(sid), winning.id]
      );
      const normalized = await fetchPredictionWithBets(pg, predictionId);
      if (normalized) normalized._eventLogs = eventLogs;
      return normalized;
    }

    for (const bet of winners) {
      const payout = Math.floor((Number(bet.amount || 0) * total) / winnerTotal);
      await pg.query(
        `insert into ${table} (user_id, username, points) values ($1, $2, $3)
         on conflict (user_id) do update set
           username = coalesce(excluded.username, ${table}.username),
           points = ${table}.points + excluded.points`,
        [String(bet.user_id), bet.username ? String(bet.username) : null, payout]
      );
      await pg.query(`update prediction_bets set payout = $2, updated_at = now() where id = $1`, [bet.id, payout]);
      eventLogs.push({
        eventType: 'prediction_payout',
        userId: String(bet.user_id),
        username: bet.username || null,
        pointDelta: payout,
        optionId: bet.option_id || null,
        payout,
      });
    }
    await pg.query(
      `update prediction_events
       set status = 'settled', winning_option_id = $3, settlement_note = 'pari_mutuel', settled_at = now()
       where id = $1 and sid = $2`,
      [row.id, String(sid), winning.id]
    );
    const normalized = await fetchPredictionWithBets(pg, predictionId);
    if (normalized) normalized._eventLogs = eventLogs;
    return normalized;
  });
}

export async function placePredictionBet({ channelUid, userId, username, optionToken, amount }) {
  await ensurePredictionTables();
  if (!channelUid || !userId) throw new Error('channelUid and userId are required');

  return withPgClient(async (pg) => {
    await pg.query('begin');
    try {
      const channelIdentity = await resolvePointChannelIdentity(pg, channelUid);
      const userIdentity = await resolvePointUserIdentity(pg, userId);
      if (!channelIdentity.canonicalChannelUid || !userIdentity.canonicalUserId) {
        throw new Error('invalid_identity');
      }

      const prediction = await pg.query(
        `select * from prediction_events
         where channel_uid = any($1::text[])
           and status = 'open'
           and (closes_at is null or closes_at > now())
         order by created_at desc
         limit 1
         for update`,
        [channelIdentity.channelAliases]
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

      const have = await sumPointsForIdentity(pg, channelIdentity.channelAliases, userIdentity.identityKeys);
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

      const betUserId = String(userIdentity.canonicalUserId);
      const existing = await pg.query(
        `select * from prediction_bets where prediction_id = $1 and user_id = $2 for update`,
        [row.id, betUserId]
      );
      const existingBet = existing.rows?.[0] || null;
      if (existingBet && String(existingBet.option_id) !== matched.id) throw new Error('option_change_not_allowed');

      await setCanonicalPointBalance(pg, channelIdentity, userIdentity, username, have - normalizedAmount);

      if (existingBet) {
        await pg.query(
          `update prediction_bets set amount = amount + $3, username = coalesce($4, username), updated_at = now()
           where prediction_id = $1 and user_id = $2`,
          [row.id, betUserId, normalizedAmount, username ? String(username) : null]
        );
      } else {
        await pg.query(
          `insert into prediction_bets (id, prediction_id, channel_uid, user_id, username, option_id, amount)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [makeId('bet'), row.id, String(row.channel_uid || channelUid), betUserId, username ? String(username) : null, matched.id, normalizedAmount]
        );
      }
      await pg.query('commit');
      const normalized = await fetchPredictionWithBets(pg, row.id);
      if (normalized) {
        normalized._eventLogs = [{
          eventType: 'prediction_bet',
          userId: betUserId,
          username: username ? String(username) : null,
          pointDelta: -normalizedAmount,
          pointBefore: have,
          pointAfter: have - normalizedAmount,
          optionId: matched.id,
          optionLabel: matched.label,
          amount: normalizedAmount,
        }];
      }
      return normalized;
    } catch (error) {
      try { await pg.query('rollback'); } catch {}
      throw error;
    }
  });
}

export async function rotateViewerTokenSupabase(channelId, tokenType, sid, prefix) {
  if (!channelId || !tokenType || !sid) return null;
  const dbUrl = getDbUrl();
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
  const dbUrl = getDbUrl();
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
  const dbUrl = getDbUrl();
  if (!dbUrl) {
    console.warn('[Token Cleanup] Direct database URL not available, skipping cleanup');
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
  const dbUrl = getDbUrl();
  if (!dbUrl) {
    throw new Error('A direct database URL is required for performance stats');
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
  const dbUrl = getDbUrl();
  if (!dbUrl) {
    throw new Error('A direct database URL is required for query analysis');
  }
  
  return withPgClient(async (pg) => {
    let result;
    try {
      result = await pg.query('SELECT * FROM analyze_channel_query_performance()');
    } catch (error) {
      if (!isUndefinedDbFunctionError(error, 'analyze_channel_query_performance') && error?.code !== '42703' && error?.code !== '42804') {
        throw error;
      }
      console.warn('[Performance Monitor] analyze_channel_query_performance() is unavailable or stale; using direct pg_stat_user_indexes query');
      result = await pg.query(`
        SELECT
          (schemaname||'.'||relname)::TEXT as table_name,
          indexrelname::TEXT as index_name,
          idx_tup_read as index_usage_count,
          pg_size_pretty(pg_total_relation_size(relid)) as table_size,
          pg_size_pretty(pg_relation_size(indexrelid)) as index_size
        FROM pg_stat_user_indexes
        WHERE schemaname = 'public'
          AND (relname LIKE '%session%' OR relname LIKE '%token%' OR relname = 'roulette_sessions')
        ORDER BY idx_tup_read DESC
      `);
    }

    return result.rows.map(row => ({
      tableName: row.table_name,
      indexName: row.index_name,
      indexUsageCount: parseInt(row.index_usage_count),
      tableSize: row.table_size,
      indexSize: row.index_size
    }));
  });
}

// 인덱스 사용률 모니터링
export async function monitorIndexUsageSupabase() {
  const dbUrl = getDbUrl();
  if (!dbUrl) {
    throw new Error('A direct database URL is required for index monitoring');
  }
  
  return withPgClient(async (pg) => {
    let result;
    try {
      result = await pg.query('SELECT * FROM monitor_index_usage()');
    } catch (error) {
      if (!isUndefinedDbFunctionError(error, 'monitor_index_usage') && error?.code !== '42703' && error?.code !== '42804') {
        throw error;
      }
      console.warn('[Performance Monitor] monitor_index_usage() is unavailable or stale; using direct pg_stat_user_indexes query');
      result = await pg.query(`
        SELECT
          (schemaname||'.'||relname)::TEXT as table_name,
          indexrelname::TEXT as index_name,
          CASE
            WHEN idx_tup_read + idx_tup_fetch = 0 THEN 0::NUMERIC
            ELSE ROUND((idx_tup_read::NUMERIC / (idx_tup_read + idx_tup_fetch + 1)) * 100, 2)
          END as usage_ratio,
          CASE
            WHEN idx_tup_read + idx_tup_fetch = 0 THEN 'Consider dropping - unused index'
            WHEN idx_tup_read::NUMERIC / (idx_tup_read + idx_tup_fetch + 1) < 0.1 THEN 'Low usage - review necessity'
            WHEN idx_tup_read::NUMERIC / (idx_tup_read + idx_tup_fetch + 1) > 0.8 THEN 'High usage - keep index'
            ELSE 'Moderate usage - monitor'
          END as recommendation
        FROM pg_stat_user_indexes
        WHERE schemaname = 'public'
          AND (relname LIKE '%session%' OR relname LIKE '%token%' OR relname = 'roulette_sessions')
        ORDER BY usage_ratio DESC
      `);
    }

    return result.rows.map(row => ({
      tableName: row.table_name,
      indexName: row.index_name,
      usageRatio: parseFloat(row.usage_ratio),
      recommendation: row.recommendation
    }));
  });
}

// 성능 최적화 권장사항
export async function getPerformanceRecommendationsSupabase() {
  const dbUrl = getDbUrl();
  if (!dbUrl) {
    throw new Error('A direct database URL is required for performance recommendations');
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
    if (
      isUndefinedDbFunctionError(error, 'get_performance_recommendations') ||
      error?.code === '42703' ||
      error?.code === '42804'
    ) {
      console.warn('[Performance Monitor] get_performance_recommendations() is unavailable or stale; skipping recommendations');
      return [];
    }
    throw error;
  }
}

// 데이터베이스 통계 업데이트
export async function updateChannelStatisticsSupabase() {
  const dbUrl = getDbUrl();
  if (!dbUrl) {
    console.warn('[Statistics] Direct database URL not available, skipping statistics update');
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
  const dbUrl = getDbUrl();
  if (!dbUrl) {
    console.warn('[Verification] Direct database URL not available, skipping integrity check');
    return null;
  }
  
  const client = createPgClient(dbUrl);
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
  const dbUrl = getDbUrl();
  if (!dbUrl) return; // optional
  const client = createPgClient(dbUrl);
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
        result_value text,
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
        api_key_hash text unique,
        api_key_hint text,
        owner_pid text not null,
        created_at timestamptz default now(),
        last_used timestamptz,
        revoked boolean default false
      );
      alter table api_keys add column if not exists api_key_hash text;
      alter table api_keys add column if not exists api_key_hint text;
      
      -- API Keys 인덱스
      create index if not exists idx_api_keys_owner_pid on api_keys(owner_pid);
      create index if not exists idx_api_keys_active on api_keys(owner_pid, revoked) where revoked = false;
      create unique index if not exists idx_api_keys_hash on api_keys(api_key_hash) where api_key_hash is not null;
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
  const dbUrl = getDbUrl();
  if (!dbUrl) {
    // Be conservative: assume column is NOT available to avoid PostgREST schema cache errors
    return false;
  }
  const client = createPgClient(dbUrl);
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
    access_token: protectSecret(accessToken),
    refresh_token: protectSecret(refreshToken),
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
      if (getDbUrl()) {
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

export async function getTokens(sid) {
  ensure();
  const { data, error } = await supabase.from('tokens').select('access_token, refresh_token, token_type, expires_at').eq('sid', sid).single();
  if (error || !data || !data.access_token) return null;
  const accessToken = revealSecret(data.access_token);
  const refreshToken = revealSecret(data.refresh_token);
  if (accessToken === data.access_token || refreshToken === data.refresh_token) {
    const nextAccessToken = protectSecret(accessToken);
    const nextRefreshToken = protectSecret(refreshToken);
    if (nextAccessToken !== data.access_token || nextRefreshToken !== data.refresh_token) {
      await supabase.from('tokens')
        .update({ access_token: nextAccessToken, refresh_token: nextRefreshToken })
        .eq('sid', sid)
        .then(() => null);
    }
  }
  return {
    accessToken,
    refreshToken,
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
  if (!getDbUrl()) return;
  await withPgClient(async (pg) => {
    await pg.query(`
      create table if not exists app_users (
        id text primary key,
        primary_provider text,
        primary_platform_user_id text,
        display_name text,
        avatar_url text,
        is_admin boolean not null default false,
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      alter table app_users add column if not exists is_admin boolean not null default false;
      create index if not exists idx_app_users_is_admin on app_users(is_admin) where is_admin = true;
      create index if not exists idx_app_users_created_id on app_users(created_at desc, id desc);
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
        consent_granted_at timestamptz not null default now(),
        consent_confirmed_at timestamptz not null default now(),
        last_used_at timestamptz not null default now(),
        last_validated_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key (provider, user_id),
        unique (provider, platform_user_id)
      );
      create index if not exists idx_platform_accounts_user_provider on platform_accounts(user_id, provider);
      create index if not exists idx_platform_accounts_provider_user on platform_accounts(provider, user_id);
      create index if not exists idx_platform_accounts_provider_channel on platform_accounts(provider, channel_id);
      create index if not exists idx_platform_tokens_expiry on platform_tokens(provider, expires_at) where expires_at is not null;
      alter table platform_tokens add column if not exists last_validated_at timestamptz not null default now();
      alter table platform_tokens add column if not exists consent_granted_at timestamptz not null default now();
      alter table platform_tokens add column if not exists consent_confirmed_at timestamptz not null default now();
      alter table platform_tokens add column if not exists last_used_at timestamptz not null default now();
      create index if not exists idx_platform_tokens_validation on platform_tokens(provider, last_validated_at);
      create index if not exists idx_platform_tokens_youtube_activity on platform_tokens(last_used_at) where provider = 'youtube';
      create index if not exists idx_platform_tokens_user_provider on platform_tokens(user_id, provider);
      alter table sessions add column if not exists account_user_id text;
      create index if not exists idx_sessions_account_user_id on sessions(account_user_id);
      create index if not exists idx_sessions_account_last_seen_active on sessions(account_user_id, last_seen desc) where revoked = false;
    `);
  });
}

export async function getAppUserAdminStatus(userId) {
  const id = String(userId || '').replace(/^user:/, '').trim();
  if (!id || !getDbUrl()) return { userId: id || null, isAdmin: false };
  await ensurePlatformIdentityTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `select id, is_admin, display_name, avatar_url
         from app_users
        where id = $1
        limit 1`,
      [id]
    );
    const row = rows[0] || null;
    return {
      userId: id,
      exists: !!row,
      isAdmin: row?.is_admin === true,
      displayName: row?.display_name || null,
      avatarUrl: row?.avatar_url || null,
    };
  });
}

let arubotAdminConsoleReadyPromise = null;

async function ensureArubotAdminConsoleTables() {
  if (!getDbUrl()) throw new Error('PostgreSQL is required for the AruBot admin console');
  if (!arubotAdminConsoleReadyPromise) {
    arubotAdminConsoleReadyPromise = (async () => {
      await ensurePlatformIdentityTables();
      await Promise.all([
        ensureYoutubeCentralBotTables(),
        ensureAutomationTables(),
        ensureBotEventLogTables(),
      ]);
    })().catch((error) => {
      arubotAdminConsoleReadyPromise = null;
      throw error;
    });
  }
  await arubotAdminConsoleReadyPromise;
}

function normalizeArubotAdminConsoleCursor(value) {
  const encoded = String(value || '').trim();
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    const createdAt = new Date(parsed?.createdAt || '');
    const userId = String(parsed?.userId || '').trim();
    if (!Number.isFinite(createdAt.getTime()) || !userId) return null;
    return { createdAt: createdAt.toISOString(), userId };
  } catch {
    return null;
  }
}

function encodeArubotAdminConsoleCursor(row) {
  if (!row?.createdAt || !row?.userId) return null;
  return Buffer.from(JSON.stringify({ createdAt: row.createdAt, userId: row.userId }), 'utf8').toString('base64url');
}

export async function getArubotAdminConsoleSnapshot(options = {}) {
  await ensureArubotAdminConsoleTables();

  const limit = Math.max(1, Math.min(100, Number(options.limit || 25) || 25));
  const query = String(options.q || options.query || '').trim().slice(0, 120);
  const platform = ['chzzk', 'cime', 'youtube'].includes(String(options.platform || '').toLowerCase())
    ? String(options.platform).toLowerCase()
    : 'all';
  const live = ['live', 'offline'].includes(String(options.live || '').toLowerCase())
    ? String(options.live).toLowerCase()
    : 'all';
  const feature = ['commands', 'macros', 'roulettes', 'actions', 'donations', 'automations'].includes(String(options.feature || '').toLowerCase())
    ? String(options.feature).toLowerCase()
    : 'all';
  const cursor = normalizeArubotAdminConsoleCursor(options.cursor);

  const params = [];
  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = ['true'];

  if (query) {
    const needle = `%${query.replace(/[%_\\]/g, '\\$&')}%`;
    const slot = addParam(needle);
    where.push(`(
      b.user_id ilike ${slot} escape '\\'
      or b.display_name ilike ${slot} escape '\\'
      or b.platform_search ilike ${slot} escape '\\'
    )`);
  }
  if (platform !== 'all') {
    const slot = addParam(platform);
    where.push(`${slot} = any(b.providers)`);
  }
  if (live === 'live') where.push('b.live = true');
  if (live === 'offline') where.push('b.live = false');

  const featureFilters = {
    commands: 'b.commands_total > 0',
    macros: 'b.macros_total > 0',
    roulettes: 'b.roulettes_total > 0',
    actions: 'b.actions_total > 0',
    donations: 'b.donation_rules_total > 0',
    automations: 'b.automation_connections_total > 0',
  };
  if (featureFilters[feature]) where.push(featureFilters[feature]);

  let cursorSql = '';
  if (cursor) {
    const createdSlot = addParam(cursor.createdAt);
    const userSlot = addParam(cursor.userId);
    cursorSql = `where (p.created_at, p.user_id) < (${createdSlot}::timestamptz, ${userSlot})`;
  }

  const pageLimitSlot = addParam(limit + 1);
  const whereSql = where.join(' and ');

  return withPgClient(async (pg) => {
    await ensureRuntimeLeasesWithClient(pg);
    const result = await pg.query(
      `with account_source as (
         select pa.user_id,
                lower(pa.provider) as provider,
                pa.platform_user_id,
                coalesce(ysc.youtube_channel_id, pa.channel_id) as channel_id,
                coalesce(ysc.title, pa.channel_name) as channel_name,
                coalesce(ysc.youtube_handle, pa.channel_handle) as channel_handle,
                coalesce(ysc.thumbnail_url, pa.avatar_url) as avatar_url,
                pa.connected_at,
                greatest(pa.last_login_at, pa.connected_at, ysc.updated_at) as last_activity_at,
                case
                  when pt.user_id is not null
                       and pt.expires_at is not null
                       and pt.expires_at <= now()
                       and nullif(pt.refresh_token, '') is null then 'expired'
                  when pt.user_id is not null then 'valid'
                  when lower(pa.provider) = 'chzzk'
                       and nullif(lt.access_token, '') is not null
                       and nullif(lt.refresh_token, '') is null
                       and lt.expires_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
                       and lt.expires_at <= to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') then 'expired'
                  when lower(pa.provider) = 'chzzk' and nullif(lt.access_token, '') is not null then 'valid'
                  when lower(pa.provider) = 'youtube' and ysc.owner_user_id is not null then 'configured'
                  else 'unknown'
                end as authorization,
                coalesce(
                  to_char(pt.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                  case when lower(pa.provider) = 'chzzk' then nullif(lt.expires_at, '') end
                ) as authorization_expires_at,
                pt.last_validated_at,
                ysc.moderator_registered,
                ysc.websub_status,
                ysc.websub_lease_expires_at,
                ysc.last_live_title,
                ysc.last_live_started_at,
                ysc.last_error,
                exists (
                  select 1
                    from runtime_leases rl
                   where rl.expires_at > now()
                     and rl.resource_key = case
                       when lower(pa.provider) = 'chzzk'
                         then 'provider-runtime:chzzk:' || coalesce(nullif(pa.channel_id, ''), pa.platform_user_id)
                       else 'provider-runtime:' || lower(pa.provider) || ':' || pa.user_id
                     end
                ) as runtime_lease_active
           from platform_accounts pa
           left join platform_tokens pt
             on pt.user_id = pa.user_id and lower(pt.provider) = lower(pa.provider)
           left join tokens lt
             on lower(pa.provider) = 'chzzk' and lt.sid = 'user:' || pa.user_id
           left join youtube_streamer_channels ysc
             on ysc.owner_user_id = pa.user_id and lower(pa.provider) = 'youtube'
         union all
         select ysc.owner_user_id,
                'youtube',
                ysc.youtube_channel_id,
                ysc.youtube_channel_id,
                ysc.title,
                ysc.youtube_handle,
                ysc.thumbnail_url,
                ysc.created_at,
                ysc.updated_at,
                'configured',
                null::text,
                null::timestamptz,
                ysc.moderator_registered,
                ysc.websub_status,
                ysc.websub_lease_expires_at,
                ysc.last_live_title,
                ysc.last_live_started_at,
                ysc.last_error,
                exists (
                  select 1
                    from runtime_leases rl
                   where rl.expires_at > now()
                     and rl.resource_key = 'provider-runtime:youtube:' || ysc.owner_user_id
                )
           from youtube_streamer_channels ysc
          where not exists (
            select 1 from platform_accounts pa
             where pa.user_id = ysc.owner_user_id and lower(pa.provider) = 'youtube'
          )
       ),
       account_stats as (
         select user_id,
                count(*)::int as platform_count,
                array_agg(distinct provider order by provider) as providers,
                string_agg(concat_ws(' ', provider, platform_user_id, channel_id, channel_name, channel_handle), ' ') as platform_search,
                max(last_activity_at) as last_platform_activity_at,
                jsonb_agg(
                  jsonb_build_object(
                    'provider', provider,
                    'platformUserId', platform_user_id,
                    'channelId', channel_id,
                    'channelName', channel_name,
                    'channelHandle', channel_handle,
                    'avatarUrl', avatar_url,
                    'connectedAt', connected_at,
                    'lastActivityAt', last_activity_at,
                    'authorization', authorization,
                    'authorizationExpiresAt', authorization_expires_at,
                    'lastValidatedAt', last_validated_at,
                    'moderatorRegistered', moderator_registered,
                    'websubStatus', websub_status,
                    'websubLeaseExpiresAt', websub_lease_expires_at,
                    'lastLiveTitle', last_live_title,
                    'lastLiveStartedAt', last_live_started_at,
                    'lastError', last_error,
                    'runtimeLeaseActive', runtime_lease_active
                  ) order by provider, channel_name nulls last
                ) as platforms
           from account_source
          group by user_id
       ),
       rule_stats as (
         select regexp_replace(sid, '^user:', '') as user_id,
                count(*)::int as commands_total,
                (count(*) filter (where enabled is not false))::int as commands_enabled,
                max(last_used) as commands_last_used
           from bot_rules
          where sid like 'user:%'
          group by regexp_replace(sid, '^user:', '')
       ),
       settings_stats as (
         select regexp_replace(bs.sid, '^user:', '') as user_id,
                case when jsonb_typeof(bs.settings->'macros') = 'array'
                     then jsonb_array_length(bs.settings->'macros') else 0 end as macros_total,
                case when jsonb_typeof(bs.settings->'macros') = 'array'
                     then (select count(*)::int from jsonb_array_elements(bs.settings->'macros') item where coalesce(lower(item->>'enabled') <> 'false', true))
                     else 0 end as macros_enabled,
                case when jsonb_typeof(bs.settings->'rouletteDefs') = 'array'
                     then jsonb_array_length(bs.settings->'rouletteDefs') else 0 end as roulettes_total,
                case when jsonb_typeof(bs.settings->'rouletteDefs') = 'array'
                     then coalesce((select sum(case when jsonb_typeof(item->'items') = 'array' then jsonb_array_length(item->'items') else 0 end)::int from jsonb_array_elements(bs.settings->'rouletteDefs') item), 0)
                     else 0 end as roulette_items_total,
                case when jsonb_typeof(bs.settings->'donationRules') = 'array'
                     then jsonb_array_length(bs.settings->'donationRules') else 0 end as donation_rules_total,
                coalesce(lower(bs.settings->>'botEnabled') <> 'false', true) as bot_enabled,
                coalesce(lower(bs.settings->>'videoDonationAcceptEnabled') = 'true', false) as video_donation_enabled,
                coalesce(lower(bs.settings->'drawingDonation'->>'enabled') = 'true', false) as drawing_donation_enabled
           from bot_settings bs
          where bs.sid like 'user:%'
       ),
       action_stats as (
         select ab.owner_user_id as user_id,
                count(*)::int as actions_total,
                (count(*) filter (where ab.enabled is not false))::int as actions_enabled,
                (count(*) filter (where av.published = true))::int as actions_published,
                max(ab.updated_at) as actions_updated_at
           from action_blueprints ab
           left join action_blueprint_versions av on av.id = ab.current_version_id
          group by ab.owner_user_id
       ),
       automation_stats as (
         select ac.owner_user_id as user_id,
                count(*)::int as automation_connections_total,
                (count(*) filter (where ac.enabled is not false))::int as automation_connections_enabled,
                (count(*) filter (where lower(coalesce(ac.last_status, '')) in ('error', 'failed', 'offline')))::int as automation_connections_attention,
                max(ac.last_checked_at) as automation_last_checked_at
           from automation_connections ac
          group by ac.owner_user_id
       ),
       agent_stats as (
         select ala.owner_user_id as user_id,
                (count(*) filter (where ala.revoked_at is null))::int as local_agents_total,
                (count(*) filter (
                  where ala.revoked_at is null
                    and ala.status = 'online'
                    and ala.last_seen_at > now() - interval '2 minutes'
                ))::int as local_agents_online
           from automation_local_agents ala
          group by ala.owner_user_id
       ),
       event_recent as (
         select bel.owner_user_id as user_id,
                count(*)::int as events_24h,
                (count(*) filter (where bel.status = 'failed'))::int as failed_events_24h
           from bot_event_logs bel
          where bel.created_at > now() - interval '24 hours'
          group by bel.owner_user_id
       ),
       base as (
         select u.id as user_id,
                u.display_name,
                u.avatar_url,
                u.primary_provider,
                u.is_admin,
                u.created_at,
                u.updated_at,
                coalesce(a.platform_count, 0) as platform_count,
                coalesce(a.providers, array[]::text[]) as providers,
                coalesce(a.platform_search, '') as platform_search,
                coalesce(a.platforms, '[]'::jsonb) as platforms,
                a.last_platform_activity_at,
                (coalesce(ls.live, false) and coalesce(ls.last_update, 0) >= (extract(epoch from now()) * 1000 - 300000)) as live,
                (coalesce(ls.live, false) and coalesce(ls.last_update, 0) < (extract(epoch from now()) * 1000 - 300000)) as live_stale,
                ls.start_date as live_start_date,
                ls.session_start_time,
                ls.last_update as live_last_update,
                coalesce(rs.commands_total, 0) as commands_total,
                coalesce(rs.commands_enabled, 0) as commands_enabled,
                rs.commands_last_used,
                coalesce(ss.macros_total, 0) as macros_total,
                coalesce(ss.macros_enabled, 0) as macros_enabled,
                coalesce(ss.roulettes_total, 0) as roulettes_total,
                coalesce(ss.roulette_items_total, 0) as roulette_items_total,
                coalesce(ss.donation_rules_total, 0) as donation_rules_total,
                coalesce(ss.bot_enabled, true) as bot_enabled,
                coalesce(ss.video_donation_enabled, false) as video_donation_enabled,
                coalesce(ss.drawing_donation_enabled, false) as drawing_donation_enabled,
                coalesce(acs.actions_total, 0) as actions_total,
                coalesce(acs.actions_enabled, 0) as actions_enabled,
                coalesce(acs.actions_published, 0) as actions_published,
                acs.actions_updated_at,
                coalesce(ats.automation_connections_total, 0) as automation_connections_total,
                coalesce(ats.automation_connections_enabled, 0) as automation_connections_enabled,
                coalesce(ats.automation_connections_attention, 0) as automation_connections_attention,
                ats.automation_last_checked_at,
                coalesce(ags.local_agents_total, 0) as local_agents_total,
                coalesce(ags.local_agents_online, 0) as local_agents_online,
                coalesce(bs.messages_processed, 0) as messages_processed,
                coalesce(bs.commands_handled, 0) as commands_handled,
                bs.last_active,
                coalesce(er.events_24h, 0) as events_24h,
                coalesce(er.failed_events_24h, 0) as failed_events_24h
           from app_users u
           left join account_stats a on a.user_id = u.id
           left join live_sessions ls on ls.sid = 'user:' || u.id
           left join rule_stats rs on rs.user_id = u.id
           left join settings_stats ss on ss.user_id = u.id
           left join action_stats acs on acs.user_id = u.id
           left join automation_stats ats on ats.user_id = u.id
           left join agent_stats ags on ags.user_id = u.id
           left join bot_stats bs on bs.sid = 'user:' || u.id
           left join event_recent er on er.user_id = u.id
       ),
       filtered as (
         select * from base b where ${whereSql}
       ),
       page_rows as (
         select * from filtered p
          ${cursorSql}
          order by created_at desc, user_id desc
          limit ${pageLimitSlot}
       ),
       page_event_last as (
         select p.user_id,
                latest.created_at as last_event_at
           from page_rows p
           left join lateral (
             select bel.created_at
               from bot_event_logs bel
              where bel.owner_user_id = p.user_id
              order by bel.created_at desc, bel.id desc
              limit 1
           ) latest on true
       ),
       page_rows_with_activity as (
         select p.*, pel.last_event_at
           from page_rows p
           left join page_event_last pel on pel.user_id = p.user_id
       ),
       recent_events as (
         select bel.id,
                bel.owner_user_id,
                coalesce(u.display_name, bel.owner_user_id) as streamer_name,
                bel.provider,
                bel.category,
                bel.event_type,
                bel.trigger_name,
                bel.viewer_name,
                bel.status,
                bel.summary,
                bel.created_at
           from bot_event_logs bel
           left join app_users u on u.id = bel.owner_user_id
          order by bel.created_at desc, bel.id desc
          limit 30
       )
       select jsonb_build_object(
                'registeredUsers', (select count(*)::int from base),
                'linkedStreamers', (select (count(*) filter (where platform_count > 0))::int from base),
                'connectedPlatforms', (select count(*)::int from account_source),
                'liveStreamers', (select (count(*) filter (where live = true))::int from base),
                'activeLast24h', (select (count(*) filter (where events_24h > 0))::int from base),
                'failedEvents24h', (select coalesce(sum(failed_events_24h), 0)::int from base),
                'platforms', (
                  select coalesce(jsonb_object_agg(provider, total), '{}'::jsonb)
                    from (select provider, count(distinct user_id)::int as total from account_source group by provider) counts
                ),
                'features', jsonb_build_object(
                  'commands', jsonb_build_object('users', (select (count(*) filter (where commands_total > 0))::int from base), 'total', (select coalesce(sum(commands_total), 0)::int from base), 'enabled', (select coalesce(sum(commands_enabled), 0)::int from base)),
                  'macros', jsonb_build_object('users', (select (count(*) filter (where macros_total > 0))::int from base), 'total', (select coalesce(sum(macros_total), 0)::int from base), 'enabled', (select coalesce(sum(macros_enabled), 0)::int from base)),
                  'roulettes', jsonb_build_object('users', (select (count(*) filter (where roulettes_total > 0))::int from base), 'total', (select coalesce(sum(roulettes_total), 0)::int from base), 'items', (select coalesce(sum(roulette_items_total), 0)::int from base)),
                  'actions', jsonb_build_object('users', (select (count(*) filter (where actions_total > 0))::int from base), 'total', (select coalesce(sum(actions_total), 0)::int from base), 'enabled', (select coalesce(sum(actions_enabled), 0)::int from base), 'published', (select coalesce(sum(actions_published), 0)::int from base)),
                  'donations', jsonb_build_object('users', (select (count(*) filter (where donation_rules_total > 0))::int from base), 'total', (select coalesce(sum(donation_rules_total), 0)::int from base)),
                  'automations', jsonb_build_object('users', (select (count(*) filter (where automation_connections_total > 0))::int from base), 'total', (select coalesce(sum(automation_connections_total), 0)::int from base), 'enabled', (select coalesce(sum(automation_connections_enabled), 0)::int from base))
                )
              ) as summary,
              (select count(*)::int from filtered) as total,
              coalesce((
                select jsonb_agg(jsonb_build_object(
                  'userId', p.user_id,
                  'displayName', p.display_name,
                  'avatarUrl', p.avatar_url,
                  'primaryProvider', p.primary_provider,
                  'isAdmin', p.is_admin,
                  'createdAt', p.created_at,
                  'updatedAt', p.updated_at,
                  'lastPlatformActivityAt', p.last_platform_activity_at,
                  'platforms', p.platforms,
                  'live', jsonb_build_object('live', p.live, 'stale', p.live_stale, 'startDate', p.live_start_date, 'sessionStartTime', p.session_start_time, 'lastUpdate', p.live_last_update),
                  'features', jsonb_build_object(
                    'commands', jsonb_build_object('total', p.commands_total, 'enabled', p.commands_enabled, 'lastUsed', p.commands_last_used),
                    'macros', jsonb_build_object('total', p.macros_total, 'enabled', p.macros_enabled),
                    'roulettes', jsonb_build_object('total', p.roulettes_total, 'items', p.roulette_items_total),
                    'actions', jsonb_build_object('total', p.actions_total, 'enabled', p.actions_enabled, 'published', p.actions_published, 'updatedAt', p.actions_updated_at),
                    'donations', jsonb_build_object('total', p.donation_rules_total),
                    'automations', jsonb_build_object('total', p.automation_connections_total, 'enabled', p.automation_connections_enabled, 'attention', p.automation_connections_attention, 'lastCheckedAt', p.automation_last_checked_at, 'localAgents', p.local_agents_total, 'localAgentsOnline', p.local_agents_online),
                    'videoDonations', jsonb_build_object('enabled', p.video_donation_enabled),
                    'drawingDonations', jsonb_build_object('enabled', p.drawing_donation_enabled)
                  ),
                  'bot', jsonb_build_object('enabled', p.bot_enabled, 'messagesProcessed', p.messages_processed, 'commandsHandled', p.commands_handled, 'lastActiveAt', p.last_active),
                  'activity', jsonb_build_object('lastEventAt', p.last_event_at, 'events24h', p.events_24h, 'failedEvents24h', p.failed_events_24h)
                ) order by p.created_at desc, p.user_id desc)
                  from page_rows_with_activity p
              ), '[]'::jsonb) as streamers,
              coalesce((
                select jsonb_agg(jsonb_build_object(
                  'id', e.id,
                  'ownerUserId', e.owner_user_id,
                  'streamerName', e.streamer_name,
                  'provider', e.provider,
                  'category', e.category,
                  'eventType', e.event_type,
                  'triggerName', e.trigger_name,
                  'viewerName', e.viewer_name,
                  'status', e.status,
                  'summary', e.summary,
                  'createdAt', e.created_at
                ) order by e.created_at desc, e.id desc) from recent_events e
              ), '[]'::jsonb) as recent_events`,
      params
    );

    const row = result.rows?.[0] || {};
    const pageRows = Array.isArray(row.streamers) ? row.streamers : [];
    const hasMore = pageRows.length > limit;
    const streamers = hasMore ? pageRows.slice(0, limit) : pageRows;
    const last = streamers[streamers.length - 1] || null;
    return {
      generatedAt: new Date().toISOString(),
      filters: { q: query, platform, live, feature, limit },
      summary: row.summary || {},
      total: Number(row.total || 0),
      streamers,
      recentEvents: Array.isArray(row.recent_events) ? row.recent_events : [],
      nextCursor: hasMore ? encodeArubotAdminConsoleCursor(last) : null,
    };
  });
}

function normalizeProvider(provider) {
  return String(provider || '').trim().toLowerCase();
}

const ARUBOT_ADMIN_FEATURE_DETAIL_LIMIT = 100;

function normalizeArubotAdminDetailText(value, maxLength = 120) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeArubotAdminDetailPreview(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 240) : null;
}

function normalizeArubotAdminDetailNumber(value, { minimum = 0, integer = false } = {}) {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.max(minimum, parsed);
  return integer ? Math.trunc(normalized) : normalized;
}

function formatArubotAdminDonationAmount(value) {
  const amount = normalizeArubotAdminDetailNumber(value);
  if (amount == null) return null;
  return amount.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

function summarizeArubotAdminDonationAmount(item = {}) {
  const conditions = Array.isArray(item.amountConditions) ? item.amountConditions.slice(0, 20) : [];
  const summaries = conditions.map((condition) => {
    const amount = formatArubotAdminDonationAmount(condition?.amount);
    if (amount == null) return null;
    const operator = String(condition?.operator || 'gte').toLowerCase();
    if (operator === 'lt') return `${amount}원 미만`;
    if (operator === 'eq') return `${amount}원 일치`;
    if (operator === 'range') {
      const amountTo = formatArubotAdminDonationAmount(condition?.amountTo);
      return amountTo == null ? null : `${amount}원~${amountTo}원`;
    }
    return `${amount}원 이상`;
  }).filter(Boolean);
  if (summaries.length) return normalizeArubotAdminDetailPreview(summaries.join(' · '));

  const minAmount = formatArubotAdminDonationAmount(item.minAmount) || '0';
  const maxAmountValue = normalizeArubotAdminDetailNumber(item.maxAmount);
  const maxAmount = maxAmountValue != null && maxAmountValue > 0
    ? formatArubotAdminDonationAmount(maxAmountValue)
    : null;
  return maxAmount
    ? normalizeArubotAdminDetailPreview(`${minAmount}원~${maxAmount}원`)
    : normalizeArubotAdminDetailPreview(`${minAmount}원 이상`);
}

function takeArubotAdminFeatureDetails(value) {
  const rows = Array.isArray(value) ? value : [];
  return {
    rows: rows.slice(0, ARUBOT_ADMIN_FEATURE_DETAIL_LIMIT),
    truncated: rows.length > ARUBOT_ADMIN_FEATURE_DETAIL_LIMIT,
  };
}

export async function getArubotAdminStreamerFeatureDetails(userId) {
  await ensureArubotAdminConsoleTables();
  const owner = String(userId || '').replace(/^user:/, '').trim();
  if (!owner || owner.length > 240) return null;

  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `with target as (
         select id
           from app_users
          where id = $1
          limit 1
       ),
       settings_source as (
         select case when jsonb_typeof(bs.settings->'macros') = 'array' then bs.settings->'macros' else '[]'::jsonb end as macros,
                case when jsonb_typeof(bs.settings->'rouletteDefs') = 'array' then bs.settings->'rouletteDefs' else '[]'::jsonb end as roulettes,
                case when jsonb_typeof(bs.settings->'donationRules') = 'array' then bs.settings->'donationRules' else '[]'::jsonb end as donations
           from target t
           left join bot_settings bs on bs.sid = 'user:' || t.id
       ),
       command_rows as (
         select lower(coalesce(br.name, '')) as sort_name,
                br.id as sort_id,
                jsonb_build_object(
                  'id', br.id,
                  'name', nullif(left(trim(coalesce(br.name, '')), 120), ''),
                  'keywords', coalesce((
                    select jsonb_agg(
                             left(trim(regexp_replace(keyword.value #>> '{}', '[[:space:]]+', ' ', 'g')), 120)
                             order by keyword_position.position
                           )
                      from generate_series(0, least(jsonb_array_length(safe.keywords), 20) - 1) as keyword_position(position)
                      cross join lateral (select safe.keywords -> keyword_position.position as value) keyword
                     where jsonb_typeof(keyword.value) = 'string'
                       and trim(keyword.value #>> '{}') <> ''
                  ), '[]'::jsonb),
                  'responsePreview', nullif(left(coalesce((
                    select string_agg(
                             left(trim(regexp_replace(response.value #>> '{}', '[[:space:]]+', ' ', 'g')), 240),
                             ' · ' order by response_position.position
                           )
                      from generate_series(0, least(jsonb_array_length(safe.responses), 3) - 1) as response_position(position)
                      cross join lateral (select safe.responses -> response_position.position as value) response
                     where jsonb_typeof(response.value) = 'string'
                       and trim(response.value #>> '{}') <> ''
                  ), ''), 240), ''),
                  'enabled', coalesce(br.enabled, true),
                  'adminOnly', coalesce(br.admin_only, false)
                ) as item
           from target t
           join bot_rules br on br.sid = 'user:' || t.id
           cross join lateral (
             select case when jsonb_typeof(br.keywords) = 'array' then br.keywords else '[]'::jsonb end as keywords,
                    case when jsonb_typeof(br.responses) = 'array' then br.responses else '[]'::jsonb end as responses
           ) safe
          order by lower(coalesce(br.name, '')), br.id
          limit 101
       ),
       macro_rows as (
         select macro_position.position,
                jsonb_build_object(
                  'id', nullif(left(trim(coalesce(macro.value->>'id', '')), 120), ''),
                  'messagePreview', nullif(left(trim(regexp_replace(coalesce(macro.value->>'message', ''), '[[:space:]]+', ' ', 'g')), 240), ''),
                  'intervalSec', case
                    when coalesce(macro.value->>'intervalSec', '') ~ '^[0-9]+([.][0-9]+)?$'
                         and length(macro.value->>'intervalSec') <= 18
                      then greatest(1, (macro.value->>'intervalSec')::numeric)
                    else null
                  end,
                  'enabled', lower(coalesce(macro.value->>'enabled', 'true')) <> 'false'
                ) as item
           from settings_source ss
           cross join lateral generate_series(0, least(jsonb_array_length(ss.macros), 101) - 1) as macro_position(position)
           cross join lateral (select ss.macros -> macro_position.position as value) macro
          order by macro_position.position
          limit 101
       ),
       roulette_rows as (
         select roulette_position.position,
                jsonb_build_object(
                  'id', nullif(left(trim(coalesce(roulette.value->>'id', '')), 120), ''),
                  'name', nullif(left(trim(coalesce(roulette.value->>'name', '')), 120), ''),
                  'type', left(coalesce(nullif(trim(roulette.value->>'type'), ''), 'items'), 40),
                  'theme', left(coalesce(nullif(trim(roulette.value->>'theme'), ''), 'studio'), 80),
                  'itemCount', case when jsonb_typeof(roulette.value->'items') = 'array' then jsonb_array_length(roulette.value->'items') else 0 end
                ) as item
           from settings_source ss
           cross join lateral generate_series(0, least(jsonb_array_length(ss.roulettes), 101) - 1) as roulette_position(position)
           cross join lateral (select ss.roulettes -> roulette_position.position as value) roulette
          order by roulette_position.position
          limit 101
       ),
       donation_rows as (
         select donation_position.position,
                jsonb_build_object(
                  'id', nullif(left(trim(coalesce(donation.value->>'id', '')), 120), ''),
                  'name', nullif(left(trim(coalesce(donation.value->>'name', '')), 120), ''),
                  'enabled', lower(coalesce(donation.value->>'enabled', 'true')) <> 'false',
                  'amountConditions', coalesce((
                    select jsonb_agg(jsonb_build_object(
                             'operator', left(coalesce(condition.value->>'operator', 'gte'), 16),
                             'amount', left(coalesce(condition.value->>'amount', ''), 32),
                             'amountTo', left(coalesce(condition.value->>'amountTo', ''), 32)
                           ) order by condition_position.position)
                      from generate_series(0, least(jsonb_array_length(donation.amount_conditions), 20) - 1) as condition_position(position)
                      cross join lateral (select donation.amount_conditions -> condition_position.position as value) condition
                  ), '[]'::jsonb),
                  'minAmount', left(coalesce(donation.value->>'minAmount', ''), 32),
                  'maxAmount', left(coalesce(donation.value->>'maxAmount', ''), 32)
                ) as item
           from settings_source ss
           cross join lateral generate_series(0, least(jsonb_array_length(ss.donations), 101) - 1) as donation_position(position)
           cross join lateral (
             select ss.donations -> donation_position.position as value,
                    case
                      when jsonb_typeof((ss.donations -> donation_position.position)->'amountConditions') = 'array'
                        then (ss.donations -> donation_position.position)->'amountConditions'
                      else '[]'::jsonb
                    end as amount_conditions
           ) donation
          order by donation_position.position
          limit 101
       ),
       action_rows as (
         select ab.updated_at as sort_updated_at,
                ab.id as sort_id,
                jsonb_build_object(
                  'id', ab.id,
                  'name', nullif(left(trim(coalesce(ab.name, '')), 120), ''),
                  'slug', nullif(left(trim(coalesce(ab.slug, '')), 120), ''),
                  'description', nullif(left(trim(regexp_replace(coalesce(ab.description, ''), '[[:space:]]+', ' ', 'g')), 240), ''),
                  'enabled', coalesce(ab.enabled, true),
                  'published', coalesce(av.published, false),
                  'updatedAt', ab.updated_at
                ) as item
           from target t
           join action_blueprints ab on ab.owner_user_id = t.id
           left join action_blueprint_versions av
             on av.id = ab.current_version_id and av.owner_user_id = t.id
          order by ab.updated_at desc, ab.id
          limit 101
       ),
       automation_rows as (
         select ac.updated_at as sort_updated_at,
                ac.id as sort_id,
                jsonb_build_object(
                  'id', ac.id,
                  'name', nullif(left(trim(coalesce(ac.name, '')), 120), ''),
                  'type', nullif(left(trim(coalesce(ac.type, '')), 80), ''),
                  'enabled', coalesce(ac.enabled, true),
                  'executionMode', case when ac.execution_mode = 'local_program' then 'local_program' else 'oracle_direct' end,
                  'lastStatus', nullif(left(trim(coalesce(ac.last_status, '')), 80), ''),
                  'lastCheckedAt', ac.last_checked_at
                ) as item
           from target t
           join automation_connections ac on ac.owner_user_id = t.id
          order by ac.updated_at desc, ac.id
          limit 101
       )
       select t.id as user_id,
              coalesce((select jsonb_agg(item order by sort_name, sort_id) from command_rows), '[]'::jsonb) as commands,
              coalesce((select jsonb_agg(item order by position) from macro_rows), '[]'::jsonb) as macros,
              coalesce((select jsonb_agg(item order by position) from roulette_rows), '[]'::jsonb) as roulettes,
              coalesce((select jsonb_agg(item order by sort_updated_at desc, sort_id) from action_rows), '[]'::jsonb) as actions,
              coalesce((select jsonb_agg(item order by position) from donation_rows), '[]'::jsonb) as donations,
              coalesce((select jsonb_agg(item order by sort_updated_at desc, sort_id) from automation_rows), '[]'::jsonb) as automations
         from target t`,
      [owner]
    );

    const row = rows?.[0];
    if (!row) return null;

    const commands = takeArubotAdminFeatureDetails(row.commands);
    const macros = takeArubotAdminFeatureDetails(row.macros);
    const roulettes = takeArubotAdminFeatureDetails(row.roulettes);
    const actions = takeArubotAdminFeatureDetails(row.actions);
    const donations = takeArubotAdminFeatureDetails(row.donations);
    const automations = takeArubotAdminFeatureDetails(row.automations);

    return {
      userId: owner,
      generatedAt: new Date().toISOString(),
      commands: commands.rows.map((item, index) => ({
        id: normalizeArubotAdminDetailText(item?.id) || `command-${index + 1}`,
        name: normalizeArubotAdminDetailText(item?.name),
        keywords: (Array.isArray(item?.keywords) ? item.keywords : [])
          .map((keyword) => normalizeArubotAdminDetailText(keyword, 120))
          .filter(Boolean)
          .slice(0, 20),
        responsePreview: normalizeArubotAdminDetailPreview(item?.responsePreview),
        enabled: item?.enabled !== false,
        adminOnly: item?.adminOnly === true,
      })),
      macros: macros.rows.map((item, index) => ({
        id: normalizeArubotAdminDetailText(item?.id) || `macro-${index + 1}`,
        messagePreview: normalizeArubotAdminDetailPreview(item?.messagePreview),
        intervalSec: normalizeArubotAdminDetailNumber(item?.intervalSec, { minimum: 1 }),
        enabled: item?.enabled !== false,
      })),
      roulettes: roulettes.rows.map((item, index) => ({
        id: normalizeArubotAdminDetailText(item?.id) || `roulette-${index + 1}`,
        name: normalizeArubotAdminDetailText(item?.name),
        type: normalizeArubotAdminDetailText(item?.type, 40) || 'items',
        theme: normalizeArubotAdminDetailText(item?.theme, 80) || 'studio',
        itemCount: normalizeArubotAdminDetailNumber(item?.itemCount, { minimum: 0, integer: true }) || 0,
      })),
      actions: actions.rows.map((item, index) => ({
        id: normalizeArubotAdminDetailText(item?.id) || `action-${index + 1}`,
        name: normalizeArubotAdminDetailText(item?.name),
        slug: normalizeArubotAdminDetailText(item?.slug),
        description: normalizeArubotAdminDetailPreview(item?.description),
        enabled: item?.enabled !== false,
        published: item?.published === true,
        updatedAt: normalizeArubotAdminDetailText(item?.updatedAt, 64),
      })),
      donations: donations.rows.map((item, index) => ({
        id: normalizeArubotAdminDetailText(item?.id) || `donation-${index + 1}`,
        name: normalizeArubotAdminDetailText(item?.name),
        enabled: item?.enabled !== false,
        amountSummary: summarizeArubotAdminDonationAmount(item),
      })),
      automations: automations.rows.map((item, index) => ({
        id: normalizeArubotAdminDetailText(item?.id) || `automation-${index + 1}`,
        name: normalizeArubotAdminDetailText(item?.name),
        type: normalizeArubotAdminDetailText(item?.type, 80),
        enabled: item?.enabled !== false,
        executionMode: item?.executionMode === 'local_program' ? 'local_program' : 'oracle_direct',
        lastStatus: normalizeArubotAdminDetailText(item?.lastStatus, 80),
        lastCheckedAt: normalizeArubotAdminDetailText(item?.lastCheckedAt, 64),
      })),
      truncated: {
        commands: commands.truncated,
        macros: macros.truncated,
        roulettes: roulettes.truncated,
        actions: actions.truncated,
        donations: donations.truncated,
        automations: automations.truncated,
      },
    };
  });
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

export async function findAppUserIdByChannelUid(channelUid) {
  const raw = String(channelUid || '').trim();
  if (!raw || !getDbUrl()) return null;
  await ensurePlatformIdentityTables();
  const withoutPrefix = raw.replace(/^(user:|cime:|chzzk:|youtube:)/, '');
  const withoutAt = withoutPrefix.replace(/^@/, '');
  const candidates = uniqueNonEmpty([raw, withoutPrefix, withoutAt]);
  return withPgClient(async (pg) => {
    const platformMatch = await pg.query(
      `select user_id
         from platform_accounts
        where user_id = any($1::text[])
           or platform_user_id = any($1::text[])
           or channel_id = any($1::text[])
           or channel_handle = any($1::text[])
           or provider || ':' || platform_user_id = any($1::text[])
           or provider || ':' || channel_id = any($1::text[])
        order by
          case
            when user_id = $2 then 0
            when channel_id = $2 then 1
            when platform_user_id = $2 then 2
            else 3
          end,
          last_login_at desc
        limit 1`,
      [candidates, raw]
    );
    const platformUserId = String(platformMatch.rows?.[0]?.user_id || '').trim();
    if (platformUserId) return platformUserId;

    const youtubeTable = await pg.query(`select to_regclass('public.youtube_streamer_channels') as table_name`);
    if (youtubeTable.rows?.[0]?.table_name) {
      const youtubeMatch = await pg.query(
        `select owner_user_id
           from youtube_streamer_channels
          where owner_user_id = any($1::text[])
             or youtube_channel_id = any($1::text[])
             or youtube_handle = any($1::text[])
             or selected_channel_id = any($1::text[])
          order by updated_at desc nulls last
          limit 1`,
        [candidates]
      );
      const youtubeOwnerId = String(youtubeMatch.rows?.[0]?.owner_user_id || '').trim();
      if (youtubeOwnerId) return youtubeOwnerId;
    }

    return null;
  }).catch(() => null);
}

function makeArubotViewerUuid(value) {
  return `aru_${crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24)}`;
}

function collectPlatformPointIdentityKeys(account) {
  const keys = new Set();
  const provider = normalizeProvider(account?.provider);
  const add = (value) => {
    const text = String(value || '').trim();
    if (!text) return;
    keys.add(text);
    if (text.startsWith('user:')) keys.add(text.slice(5));
    if (text.startsWith('cime:')) keys.add(text.slice(5));
    if (text.startsWith('chzzk:')) keys.add(text.slice(6));
    if (provider && !text.startsWith(`${provider}:`)) keys.add(`${provider}:${text}`);
  };

  add(account?.platformUserId ?? account?.platform_user_id);
  add(account?.channelId ?? account?.channel_id);
  add(account?.handle ?? account?.channel_handle);

  const metadata = normalizeJsonObject(account?.metadata);
  const raw = normalizeJsonObject(metadata.raw);
  add(raw.userId);
  add(raw.channelId);
  add(raw.id);
  add(raw.channel?.channelId);
  add(raw.channel?.id);
  add(raw.profile?.userId);
  add(raw.profile?.channelId);

  const publicProfile = normalizeJsonObject(metadata.publicProfile);
  add(publicProfile.userId);
  add(publicProfile.channelId);

  return Array.from(keys);
}

function addPointIdentityLookup(lookup, key, appUserId) {
  const normalizedKey = String(key || '').trim();
  const normalizedAppUserId = String(appUserId || '').trim();
  if (normalizedKey && normalizedAppUserId && !lookup.has(normalizedKey)) lookup.set(normalizedKey, normalizedAppUserId);
}

function buildPointIdentityLookup(appUserIds, accountsByAppUser) {
  const lookup = new Map();
  for (const appUserId of appUserIds || []) {
    addPointIdentityLookup(lookup, appUserId, appUserId);
    const accounts = accountsByAppUser.get(appUserId) || [];
    for (const account of accounts) {
      addPointIdentityLookup(lookup, account.platformUserId ?? account.platform_user_id, appUserId);
      addPointIdentityLookup(lookup, account.channelId ?? account.channel_id, appUserId);
      addPointIdentityLookup(lookup, account.handle ?? account.channel_handle, appUserId);
      for (const key of collectPlatformPointIdentityKeys(account)) {
        addPointIdentityLookup(lookup, key, appUserId);
      }
    }
  }
  return lookup;
}

export async function listPointViewerIdentitySummaries(userIds) {
  const ids = Array.from(
    new Set((Array.isArray(userIds) ? userIds : []).map((id) => String(id || '').trim()).filter(Boolean))
  );
  if (!ids.length || !getDbUrl()) return {};
  await ensurePlatformIdentityTables();
  return withPgClient(async (pg) => {
    const direct = await pg.query(
      `select user_id
         from platform_accounts
        where platform_user_id = any($1::text[])
           or channel_id = any($1::text[])
           or user_id = any($1::text[])`,
      [ids]
    );
    const appUserIds = Array.from(new Set((direct.rows || []).map((row) => String(row.user_id || '')).filter(Boolean)));
    const accountsByAppUser = new Map();
    if (appUserIds.length) {
      const accounts = await pg.query(
        `select user_id, provider, platform_user_id, channel_id, channel_name, channel_handle, avatar_url, metadata
           from platform_accounts
          where user_id = any($1::text[])
          order by provider asc, last_login_at desc`,
        [appUserIds]
      );
      for (const row of accounts.rows || []) {
        const key = String(row.user_id || '');
        const list = accountsByAppUser.get(key) || [];
        list.push({
          provider: row.provider,
          platformUserId: row.platform_user_id,
          channelId: row.channel_id,
          nickname: row.channel_name,
          handle: row.channel_handle,
          avatarUrl: row.avatar_url,
          metadata: normalizeJsonObject(row.metadata),
        });
        accountsByAppUser.set(key, list);
      }
    }
    const appUserLookup = buildPointIdentityLookup(appUserIds, accountsByAppUser);

    const result = {};
    for (const rawId of ids) {
      const matchedAppUserId = appUserLookup.get(rawId) || null;
      const platformAccounts = matchedAppUserId ? (accountsByAppUser.get(matchedAppUserId) || []) : [];
      const arubotUuid = matchedAppUserId ? makeArubotViewerUuid(matchedAppUserId) : null;
      const identityKeys = matchedAppUserId
        ? Array.from(new Set([
          rawId,
          matchedAppUserId,
          arubotUuid,
          ...platformAccounts.flatMap((account) => collectPlatformPointIdentityKeys(account)),
        ].filter(Boolean)))
        : [rawId];

      result[rawId] = {
        arubotUuid,
        appUserId: matchedAppUserId || null,
        platformAccounts,
        identityKeys,
      };
    }
    return result;
  });
}

export async function listPointIdentityKeysForUserId(userId) {
  const id = String(userId || '').trim();
  if (!id) return [];
  const summaries = await listPointViewerIdentitySummaries([id]).catch(() => ({}));
  const summary = summaries[id];
  return summary?.identityKeys?.length ? summary.identityKeys : [id];
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

export async function upsertPlatformTokens(provider, userId, platformUserId, {
  accessToken,
  refreshToken,
  tokenType,
  expiresAt,
  scope,
  consentGrantedAt = null,
  consentConfirmedAt = null,
  lastUsedAt = null,
}) {
  const p = normalizeProvider(provider);
  if (!p || !userId || !platformUserId || !accessToken) throw new Error('provider, userId, platformUserId and accessToken are required');
  await ensurePlatformIdentityTables();
  await withPgClient(async (pg) => {
    await pg.query(
      `insert into platform_tokens
        (provider, user_id, platform_user_id, access_token, refresh_token, token_type, expires_at, scope,
         consent_granted_at, consent_confirmed_at, last_used_at, last_validated_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8,
         coalesce($9::timestamptz, now()), coalesce($10::timestamptz, now()), coalesce($11::timestamptz, now()), now(), now())
       on conflict (provider, user_id) do update set
         platform_user_id = excluded.platform_user_id,
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         token_type = excluded.token_type,
         expires_at = excluded.expires_at,
         scope = excluded.scope,
         consent_granted_at = coalesce($9::timestamptz, platform_tokens.consent_granted_at),
         consent_confirmed_at = coalesce($10::timestamptz, platform_tokens.consent_confirmed_at),
         last_used_at = greatest(platform_tokens.last_used_at, coalesce($11::timestamptz, platform_tokens.last_used_at)),
         last_validated_at = now(),
         updated_at = now()`,
      [
        p,
        String(userId).replace(/^user:/, ''),
        String(platformUserId),
        protectSecret(accessToken),
        protectSecret(refreshToken || null),
        tokenType || 'Bearer',
        expiresAt || null,
        scope || null,
        consentGrantedAt,
        consentConfirmedAt,
        lastUsedAt,
      ]
    );
  });
}

export async function getPlatformTokens(provider, userId) {
  const p = normalizeProvider(provider);
  if (!p || !userId) return null;
  await ensurePlatformIdentityTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `select provider, user_id, platform_user_id, access_token, refresh_token, token_type, expires_at, scope,
              consent_granted_at, consent_confirmed_at, last_used_at, last_validated_at
       from platform_tokens
       where provider = $1 and user_id = $2
       limit 1`,
      [p, String(userId).replace(/^user:/, '')]
    );
    const row = rows[0];
    if (!row) return null;
    const accessToken = revealSecret(row.access_token);
    const refreshToken = revealSecret(row.refresh_token);
    if (accessToken === row.access_token || refreshToken === row.refresh_token) {
      const nextAccessToken = protectSecret(accessToken);
      const nextRefreshToken = protectSecret(refreshToken);
      if (nextAccessToken !== row.access_token || nextRefreshToken !== row.refresh_token) {
        await pg.query(
          `update platform_tokens set access_token = $1, refresh_token = $2, updated_at = now()
           where provider = $3 and user_id = $4`,
          [nextAccessToken, nextRefreshToken, p, String(userId).replace(/^user:/, '')]
        );
      }
    }
    return {
      provider: row.provider,
      userId: row.user_id,
      platformUserId: row.platform_user_id,
      accessToken,
      refreshToken,
      tokenType: row.token_type,
      expiresAt: row.expires_at,
      scope: row.scope,
      consentGrantedAt: row.consent_granted_at,
      consentConfirmedAt: row.consent_confirmed_at,
      lastUsedAt: row.last_used_at,
      lastValidatedAt: row.last_validated_at
    };
  });
}

export async function listPlatformTokenUsers(provider) {
  const p = normalizeProvider(provider);
  if (!p || !getDbUrl()) return [];
  await ensurePlatformIdentityTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `select pt.user_id, pt.platform_user_id, pt.expires_at, pt.scope,
              pt.consent_granted_at, pt.consent_confirmed_at, pt.last_used_at, pt.last_validated_at,
              pa.last_login_at
         from platform_tokens pt
         left join platform_accounts pa
           on pa.provider = pt.provider and pa.user_id = pt.user_id and pa.platform_user_id = pt.platform_user_id
        where pt.provider = $1
          and pt.access_token is not null
        order by pt.updated_at desc`,
      [p]
    );
    return (rows || []).map((row) => ({
      userId: row.user_id,
      platformUserId: row.platform_user_id,
      expiresAt: row.expires_at,
      scope: row.scope,
      consentGrantedAt: row.consent_granted_at,
      consentConfirmedAt: row.consent_confirmed_at,
      lastUsedAt: row.last_used_at,
      lastLoginAt: row.last_login_at,
      lastValidatedAt: row.last_validated_at
    }));
  });
}

export async function markPlatformTokenValidated(provider, userId) {
  const p = normalizeProvider(provider);
  if (!p || !userId || !getDbUrl()) return false;
  await ensurePlatformIdentityTables();
  return withPgClient(async (pg) => {
    const result = await pg.query(
      `update platform_tokens
          set last_validated_at = now(), updated_at = now()
        where provider = $1 and user_id = $2`,
      [p, String(userId).replace(/^user:/, '')]
    );
    return (result.rowCount || 0) > 0;
  });
}

export async function touchPlatformTokenUsed(provider, userId) {
  const p = normalizeProvider(provider);
  if (!p || !userId || !getDbUrl()) return false;
  await ensurePlatformIdentityTables();
  return withPgClient(async (pg) => {
    const result = await pg.query(
      `update platform_tokens
          set last_used_at = now(), updated_at = now()
        where provider = $1 and user_id = $2
          and last_used_at < now() - interval '5 minutes'`,
      [p, String(userId).replace(/^user:/, '')]
    );
    return (result.rowCount || 0) > 0;
  });
}

export async function confirmPlatformTokenConsent(provider, userId) {
  const p = normalizeProvider(provider);
  if (!p || !userId || !getDbUrl()) return false;
  await ensurePlatformIdentityTables();
  return withPgClient(async (pg) => {
    const result = await pg.query(
      `update platform_tokens
          set consent_confirmed_at = now(), last_validated_at = now(), updated_at = now()
        where provider = $1 and user_id = $2`,
      [p, String(userId).replace(/^user:/, '')]
    );
    return (result.rowCount || 0) > 0;
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
  if (!getDbUrl()) return { tokensDeleted: 0, accountsDeleted: 0 };
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

async function ensureYoutubeCentralBotTables() {
  if (!getDbUrl()) return;
  await ensurePlatformIdentityTables();
  await withPgClient(async (pg) => {
    await pg.query(`
      create table if not exists youtube_bot_profiles (
        id text primary key,
        selected_channel_id text not null,
        selected_channel_title text,
        selected_channel_handle text,
        selected_channel_thumbnail_url text,
        google_subject_hash text,
        access_token text not null,
        refresh_token text,
        token_type text,
        expires_at timestamptz,
        scope text,
        status text not null default 'active',
        consent_granted_at timestamptz not null default now(),
        consent_confirmed_at timestamptz not null default now(),
        last_used_at timestamptz not null default now(),
        last_verified_at timestamptz,
        last_error text,
        configured_by text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      alter table youtube_bot_profiles add column if not exists consent_granted_at timestamptz not null default now();
      alter table youtube_bot_profiles add column if not exists consent_confirmed_at timestamptz not null default now();
      alter table youtube_bot_profiles add column if not exists last_used_at timestamptz not null default now();
      create index if not exists idx_youtube_bot_profiles_activity on youtube_bot_profiles(last_used_at);

      create table if not exists youtube_streamer_channels (
        owner_user_id text primary key references app_users(id) on delete cascade,
        youtube_channel_id text,
        youtube_handle text,
        title text,
        thumbnail_url text,
        input_value text,
        bot_profile_id text references youtube_bot_profiles(id) on delete set null,
        moderator_registered boolean not null default false,
        websub_status text not null default 'pending',
        websub_secret text,
        websub_lease_expires_at timestamptz,
        last_detected_video_id text,
        last_live_chat_id text,
        last_live_title text,
        last_live_started_at timestamptz,
        last_error text,
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create index if not exists idx_youtube_streamer_channels_channel_id
        on youtube_streamer_channels (youtube_channel_id);
      create index if not exists idx_youtube_streamer_channels_bot_profile
        on youtube_streamer_channels (bot_profile_id);
    `);
  });
}

function normalizeYoutubeBotProfileRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    selectedChannelId: row.selected_channel_id,
    selectedChannelTitle: row.selected_channel_title,
    selectedChannelHandle: row.selected_channel_handle,
    selectedChannelThumbnailUrl: row.selected_channel_thumbnail_url,
    googleSubjectHash: row.google_subject_hash,
    accessToken: revealSecret(row.access_token),
    refreshToken: revealSecret(row.refresh_token),
    tokenType: row.token_type || 'Bearer',
    expiresAt: row.expires_at,
    scope: row.scope,
    status: row.status || 'active',
    consentGrantedAt: row.consent_granted_at,
    consentConfirmedAt: row.consent_confirmed_at,
    lastUsedAt: row.last_used_at,
    lastVerifiedAt: row.last_verified_at,
    lastError: row.last_error,
    configuredBy: row.configured_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeYoutubeStreamerChannelRow(row) {
  if (!row) return null;
  return {
    ownerUserId: row.owner_user_id,
    youtubeChannelId: row.youtube_channel_id,
    youtubeHandle: row.youtube_handle,
    title: row.title,
    thumbnailUrl: row.thumbnail_url,
    inputValue: row.input_value,
    botProfileId: row.bot_profile_id,
    moderatorRegistered: row.moderator_registered === true,
    websubStatus: row.websub_status || 'pending',
    websubSecret: revealSecret(row.websub_secret),
    websubLeaseExpiresAt: row.websub_lease_expires_at,
    lastDetectedVideoId: row.last_detected_video_id,
    lastLiveChatId: row.last_live_chat_id,
    lastLiveTitle: row.last_live_title,
    lastLiveStartedAt: row.last_live_started_at,
    lastError: row.last_error,
    metadata: normalizeJsonObject(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function upsertYoutubeBotProfile(profile) {
  if (!profile?.selectedChannelId || !profile?.accessToken) throw new Error('selectedChannelId and accessToken are required');
  await ensureYoutubeCentralBotTables();
  return withPgClient(async (pg) => {
    const id = String(profile.id || 'default');
    const { rows } = await pg.query(
      `insert into youtube_bot_profiles
        (id, selected_channel_id, selected_channel_title, selected_channel_handle, selected_channel_thumbnail_url,
         google_subject_hash, access_token, refresh_token, token_type, expires_at, scope, status,
         consent_granted_at, consent_confirmed_at, last_used_at, last_verified_at, last_error, configured_by, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, coalesce($12, 'active'),
         coalesce($14::timestamptz, now()), coalesce($15::timestamptz, now()), coalesce($16::timestamptz, now()), now(), null, $13, now())
       on conflict (id) do update set
         selected_channel_id = excluded.selected_channel_id,
         selected_channel_title = excluded.selected_channel_title,
         selected_channel_handle = excluded.selected_channel_handle,
         selected_channel_thumbnail_url = excluded.selected_channel_thumbnail_url,
         google_subject_hash = excluded.google_subject_hash,
         access_token = excluded.access_token,
         refresh_token = coalesce(excluded.refresh_token, youtube_bot_profiles.refresh_token),
         token_type = excluded.token_type,
         expires_at = excluded.expires_at,
         scope = excluded.scope,
         status = excluded.status,
         consent_granted_at = coalesce($14::timestamptz, youtube_bot_profiles.consent_granted_at),
         consent_confirmed_at = coalesce($15::timestamptz, youtube_bot_profiles.consent_confirmed_at),
         last_used_at = greatest(youtube_bot_profiles.last_used_at, coalesce($16::timestamptz, youtube_bot_profiles.last_used_at)),
         last_verified_at = now(),
         last_error = null,
         configured_by = excluded.configured_by,
         updated_at = now()
       returning *`,
      [
        id,
        String(profile.selectedChannelId),
        profile.selectedChannelTitle || null,
        profile.selectedChannelHandle || null,
        profile.selectedChannelThumbnailUrl || null,
        profile.googleSubjectHash || null,
        protectSecret(profile.accessToken),
        protectSecret(profile.refreshToken || null),
        profile.tokenType || 'Bearer',
        profile.expiresAt || null,
        profile.scope || null,
        profile.status || 'active',
        profile.configuredBy || null,
        profile.consentGrantedAt || null,
        profile.consentConfirmedAt || null,
        profile.lastUsedAt || null,
      ]
    );
    return normalizeYoutubeBotProfileRow(rows[0]);
  });
}

export async function getYoutubeBotProfile(id = 'default') {
  if (!getDbUrl()) return null;
  await ensureYoutubeCentralBotTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(`select * from youtube_bot_profiles where id = $1 limit 1`, [String(id || 'default')]);
    return normalizeYoutubeBotProfileRow(rows[0]);
  });
}

export async function updateYoutubeBotProfileTokens(id, tokens) {
  if (!id || !tokens?.accessToken) throw new Error('id and accessToken are required');
  await ensureYoutubeCentralBotTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `update youtube_bot_profiles
          set access_token = $2,
              refresh_token = coalesce($3, refresh_token),
              token_type = $4,
              expires_at = $5,
              scope = coalesce($6, scope),
              status = 'active',
              last_error = null,
              last_verified_at = now(),
              updated_at = now()
        where id = $1
        returning *`,
      [
        String(id),
        protectSecret(tokens.accessToken),
        tokens.refreshToken ? protectSecret(tokens.refreshToken) : null,
        tokens.tokenType || 'Bearer',
        tokens.expiresAt || null,
        tokens.scope || null,
      ]
    );
    return normalizeYoutubeBotProfileRow(rows[0]);
  });
}

export async function markYoutubeBotProfileStatus(id, { status = 'error', lastError = null } = {}) {
  if (!id) return null;
  await ensureYoutubeCentralBotTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `update youtube_bot_profiles
          set status = $2,
              last_error = $3,
              updated_at = now()
        where id = $1
        returning *`,
      [String(id), String(status || 'error'), lastError ? String(lastError).slice(0, 1000) : null]
    );
    return normalizeYoutubeBotProfileRow(rows[0]);
  });
}

export async function touchYoutubeBotProfileUsed(id = 'default') {
  await ensureYoutubeCentralBotTables();
  return withPgClient(async (pg) => {
    const result = await pg.query(
      `update youtube_bot_profiles
          set last_used_at = now(), updated_at = now()
        where id = $1
          and last_used_at < now() - interval '5 minutes'`,
      [String(id || 'default')]
    );
    return (result.rowCount || 0) > 0;
  });
}

export async function confirmYoutubeBotProfileConsent(id = 'default') {
  await ensureYoutubeCentralBotTables();
  return withPgClient(async (pg) => {
    const result = await pg.query(
      `update youtube_bot_profiles
          set consent_confirmed_at = now(), last_verified_at = now(), status = 'active', last_error = null, updated_at = now()
        where id = $1`,
      [String(id || 'default')]
    );
    return (result.rowCount || 0) > 0;
  });
}

export async function deleteYoutubeBotProfile(id = 'default') {
  await ensureYoutubeCentralBotTables();
  return withPgClient(async (pg) => {
    await pg.query(`delete from youtube_bot_profiles where id = $1`, [String(id || 'default')]);
    return true;
  });
}

export async function upsertYoutubeStreamerChannel(ownerUserId, channel) {
  const ownerId = String(ownerUserId || '').replace(/^user:/, '');
  if (!ownerId) throw new Error('ownerUserId is required');
  await ensureYoutubeCentralBotTables();
  return withPgClient(async (pg) => {
    await pg.query(
      `insert into app_users (id, primary_provider, primary_platform_user_id, display_name, metadata)
       values ($1, 'youtube-central', $1, $2, '{}'::jsonb)
       on conflict (id) do nothing`,
      [ownerId, ownerId]
    );
    const { rows } = await pg.query(
      `insert into youtube_streamer_channels
        (owner_user_id, youtube_channel_id, youtube_handle, title, thumbnail_url, input_value,
         bot_profile_id, moderator_registered, websub_status, websub_secret, last_error, metadata, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, false, coalesce($8, 'pending'), $9, $10, $11::jsonb, now())
       on conflict (owner_user_id) do update set
         youtube_channel_id = excluded.youtube_channel_id,
         youtube_handle = excluded.youtube_handle,
         title = excluded.title,
         thumbnail_url = excluded.thumbnail_url,
         input_value = excluded.input_value,
         bot_profile_id = excluded.bot_profile_id,
         moderator_registered = case
           when coalesce($12::boolean, true) then false
           when youtube_streamer_channels.youtube_channel_id is distinct from excluded.youtube_channel_id then false
           else youtube_streamer_channels.moderator_registered
         end,
         websub_status = excluded.websub_status,
         websub_secret = excluded.websub_secret,
         last_error = excluded.last_error,
         metadata = excluded.metadata,
         updated_at = now()
       returning *`,
      [
        ownerId,
        channel.youtubeChannelId || null,
        channel.youtubeHandle || null,
        channel.title || null,
        channel.thumbnailUrl || null,
        channel.inputValue || null,
        channel.botProfileId || null,
        channel.websubStatus || 'pending',
        protectSecret(channel.websubSecret || null),
        channel.lastError || null,
        JSON.stringify(channel.metadata || {}),
        channel.resetModeratorRegistered !== false,
      ]
    );
    return normalizeYoutubeStreamerChannelRow(rows[0]);
  });
}

export async function getYoutubeStreamerChannel(ownerUserId) {
  const ownerId = String(ownerUserId || '').replace(/^user:/, '');
  if (!ownerId || !getDbUrl()) return null;
  await ensureYoutubeCentralBotTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(`select * from youtube_streamer_channels where owner_user_id = $1 limit 1`, [ownerId]);
    return normalizeYoutubeStreamerChannelRow(rows[0]);
  });
}

export async function listYoutubeStreamerChannelsByYoutubeChannelId(youtubeChannelId) {
  const channelId = String(youtubeChannelId || '').trim();
  if (!channelId || !getDbUrl()) return [];
  await ensureYoutubeCentralBotTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(`select * from youtube_streamer_channels where youtube_channel_id = $1`, [channelId]);
    return (rows || []).map(normalizeYoutubeStreamerChannelRow).filter(Boolean);
  });
}

export async function updateYoutubeStreamerChannelLive(ownerUserId, patch = {}) {
  const ownerId = String(ownerUserId || '').replace(/^user:/, '');
  if (!ownerId) return null;
  await ensureYoutubeCentralBotTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `update youtube_streamer_channels
          set last_detected_video_id = coalesce($2, last_detected_video_id),
              last_live_chat_id = $3,
              last_live_title = coalesce($4, last_live_title),
              last_live_started_at = $5,
              last_error = $6,
              metadata = coalesce($7::jsonb, metadata),
              updated_at = now()
        where owner_user_id = $1
        returning *`,
      [
        ownerId,
        patch.lastDetectedVideoId || null,
        patch.lastLiveChatId || null,
        patch.lastLiveTitle || null,
        patch.lastLiveStartedAt || null,
        patch.lastError || null,
        patch.metadata ? JSON.stringify(patch.metadata) : null,
      ]
    );
    return normalizeYoutubeStreamerChannelRow(rows[0]);
  });
}

export async function updateYoutubeStreamerChannelWebsub(ownerUserId, patch = {}) {
  const ownerId = String(ownerUserId || '').replace(/^user:/, '');
  if (!ownerId) return null;
  await ensureYoutubeCentralBotTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `update youtube_streamer_channels
          set websub_status = coalesce($2, websub_status),
              websub_lease_expires_at = $3,
              last_error = $4,
              updated_at = now()
        where owner_user_id = $1
        returning *`,
      [ownerId, patch.websubStatus || null, patch.websubLeaseExpiresAt || null, patch.lastError || null]
    );
    return normalizeYoutubeStreamerChannelRow(rows[0]);
  });
}

export async function markYoutubeStreamerChannelModeratorRegistered(ownerUserId, registered = true, lastError = null) {
  const ownerId = String(ownerUserId || '').replace(/^user:/, '');
  if (!ownerId) return null;
  await ensureYoutubeCentralBotTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `update youtube_streamer_channels
          set moderator_registered = $2,
              last_error = case when $2 then null else coalesce($3, last_error) end,
              updated_at = now()
        where owner_user_id = $1
        returning *`,
      [ownerId, registered === true, lastError ? String(lastError).slice(0, 1000) : null]
    );
    return normalizeYoutubeStreamerChannelRow(rows[0]);
  });
}

export async function deleteYoutubeStreamerChannel(ownerUserId) {
  const ownerId = String(ownerUserId || '').replace(/^user:/, '');
  if (!ownerId) return false;
  await ensureYoutubeCentralBotTables();
  return withPgClient(async (pg) => {
    await pg.query(`delete from youtube_streamer_channels where owner_user_id = $1`, [ownerId]);
    return true;
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

      create table if not exists action_blueprints (
        id text primary key,
        owner_user_id text not null,
        name text not null,
        slug text not null,
        enabled boolean not null default true,
        description text,
        current_version_id text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create unique index if not exists idx_action_blueprints_owner_slug
        on action_blueprints(owner_user_id, slug);

      create index if not exists idx_action_blueprints_owner
        on action_blueprints(owner_user_id, updated_at desc);

      create table if not exists action_blueprint_versions (
        id text primary key,
        blueprint_id text not null references action_blueprints(id) on delete cascade,
        owner_user_id text not null,
        version integer not null,
        nodes jsonb not null default '[]'::jsonb,
        edges jsonb not null default '[]'::jsonb,
        viewport jsonb not null default '{}'::jsonb,
        published boolean not null default false,
        created_at timestamptz not null default now(),
        created_by text
      );

      create unique index if not exists idx_action_blueprint_versions_unique
        on action_blueprint_versions(blueprint_id, version);

      create index if not exists idx_action_blueprint_versions_owner
        on action_blueprint_versions(owner_user_id, blueprint_id, created_at desc);

      create table if not exists action_blueprint_runs (
        id text primary key,
        blueprint_id text not null,
        version_id text,
        owner_user_id text not null,
        trigger_source text,
        trigger_ref text,
        context jsonb not null default '{}'::jsonb,
        status text not null default 'running',
        started_at timestamptz not null default now(),
        finished_at timestamptz,
        error text
      );

      create index if not exists idx_action_blueprint_runs_owner
        on action_blueprint_runs(owner_user_id, started_at desc);

      create table if not exists action_blueprint_run_steps (
        id text primary key,
        run_id text not null references action_blueprint_runs(id) on delete cascade,
        node_id text not null,
        node_type text not null,
        status text not null,
        input jsonb not null default '{}'::jsonb,
        output jsonb not null default '{}'::jsonb,
        duration_ms integer,
        error text,
        started_at timestamptz not null default now(),
        finished_at timestamptz
      );
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

const memoryBlueprints = new Map();
const memoryBlueprintVersions = new Map();
const memoryBlueprintRuns = new Map();
const memoryBlueprintRunSteps = new Map();

function slugifyBlueprint(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || `blueprint-${Date.now().toString(36)}`;
}

function normalizeBlueprintRow(row, version = null) {
  if (!row) return null;
  return {
    id: row.id,
    ownerUserId: row.owner_user_id || row.ownerUserId,
    name: row.name || '새 블루프린트',
    slug: row.slug || slugifyBlueprint(row.name),
    enabled: row.enabled !== false,
    description: row.description || '',
    currentVersionId: row.current_version_id || row.currentVersionId || null,
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
    version: version ? normalizeBlueprintVersionRow(version) : row.version ? normalizeBlueprintVersionRow(row.version) : null
  };
}

function normalizeBlueprintVersionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    blueprintId: row.blueprint_id || row.blueprintId,
    ownerUserId: row.owner_user_id || row.ownerUserId,
    version: Number(row.version || 1),
    nodes: Array.isArray(row.nodes) ? row.nodes : [],
    edges: Array.isArray(row.edges) ? row.edges : [],
    viewport: normalizeJsonObject(row.viewport),
    published: !!row.published,
    createdAt: row.created_at || row.createdAt || null,
    createdBy: row.created_by || row.createdBy || null
  };
}

function normalizeBlueprintRunRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    blueprintId: row.blueprint_id || row.blueprintId,
    versionId: row.version_id || row.versionId || null,
    ownerUserId: row.owner_user_id || row.ownerUserId,
    triggerSource: row.trigger_source || row.triggerSource || '',
    triggerRef: row.trigger_ref || row.triggerRef || '',
    context: normalizeJsonObject(row.context),
    status: row.status || 'running',
    startedAt: row.started_at || row.startedAt || null,
    finishedAt: row.finished_at || row.finishedAt || null,
    error: row.error || null
  };
}

function normalizeBlueprintRunStepRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id || row.runId,
    nodeId: row.node_id || row.nodeId,
    nodeType: row.node_type || row.nodeType,
    status: row.status || 'done',
    input: normalizeJsonObject(row.input),
    output: normalizeJsonObject(row.output),
    durationMs: row.duration_ms ?? row.durationMs ?? null,
    error: row.error || null,
    startedAt: row.started_at || row.startedAt || null,
    finishedAt: row.finished_at || row.finishedAt || null
  };
}

function memoryOwnerBlueprints(owner) {
  return Array.from(memoryBlueprints.values()).filter((item) => item.owner_user_id === owner);
}

export async function listActionBlueprints(ownerUserId) {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner) return [];
  if (!getDbUrl()) {
    return memoryOwnerBlueprints(owner)
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
      .map((blueprint) => normalizeBlueprintRow(blueprint, blueprint.current_version_id ? memoryBlueprintVersions.get(blueprint.current_version_id) : null));
  }
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `select b.*, v.id as v_id, v.blueprint_id as v_blueprint_id, v.owner_user_id as v_owner_user_id,
              v.version as v_version, v.nodes as v_nodes, v.edges as v_edges, v.viewport as v_viewport,
              v.published as v_published, v.created_at as v_created_at, v.created_by as v_created_by
       from action_blueprints b
       left join action_blueprint_versions v on v.id = b.current_version_id
       where b.owner_user_id = $1
       order by b.updated_at desc`,
      [owner]
    );
    return (rows || []).map((row) => normalizeBlueprintRow(row, row.v_id ? {
      id: row.v_id,
      blueprint_id: row.v_blueprint_id,
      owner_user_id: row.v_owner_user_id,
      version: row.v_version,
      nodes: row.v_nodes,
      edges: row.v_edges,
      viewport: row.v_viewport,
      published: row.v_published,
      created_at: row.v_created_at,
      created_by: row.v_created_by
    } : null)).filter(Boolean);
  });
}

export async function getActionBlueprint(ownerUserId, idOrSlug) {
  const owner = normalizeAutomationOwner(ownerUserId);
  const key = String(idOrSlug || '').trim();
  if (!owner || !key) return null;
  if (!getDbUrl()) {
    const blueprint = memoryOwnerBlueprints(owner).find((item) => item.id === key || item.slug === key);
    if (!blueprint) return null;
    return normalizeBlueprintRow(blueprint, blueprint.current_version_id ? memoryBlueprintVersions.get(blueprint.current_version_id) : null);
  }
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `select b.*, v.id as v_id, v.blueprint_id as v_blueprint_id, v.owner_user_id as v_owner_user_id,
              v.version as v_version, v.nodes as v_nodes, v.edges as v_edges, v.viewport as v_viewport,
              v.published as v_published, v.created_at as v_created_at, v.created_by as v_created_by
       from action_blueprints b
       left join action_blueprint_versions v on v.id = b.current_version_id
       where b.owner_user_id = $1 and (b.id = $2 or b.slug = $2)
       limit 1`,
      [owner, key]
    );
    const row = rows?.[0];
    return normalizeBlueprintRow(row, row?.v_id ? {
      id: row.v_id,
      blueprint_id: row.v_blueprint_id,
      owner_user_id: row.v_owner_user_id,
      version: row.v_version,
      nodes: row.v_nodes,
      edges: row.v_edges,
      viewport: row.v_viewport,
      published: row.v_published,
      created_at: row.v_created_at,
      created_by: row.v_created_by
    } : null);
  });
}

export async function upsertActionBlueprint(ownerUserId, blueprint) {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner) throw new Error('ownerUserId is required');
  const id = String(blueprint?.id || makeId('bp'));
  const name = String(blueprint?.name || '새 블루프린트').trim().slice(0, 120) || '새 블루프린트';
  const slug = slugifyBlueprint(blueprint?.slug || name);
  const enabled = blueprint?.enabled === false ? false : true;
  const description = String(blueprint?.description || '').slice(0, 500);
  const nodes = Array.isArray(blueprint?.nodes) ? blueprint.nodes : [];
  const edges = Array.isArray(blueprint?.edges) ? blueprint.edges : [];
  const viewport = normalizeJsonObject(blueprint?.viewport, { x: 0, y: 0, zoom: 1 });
  const now = new Date().toISOString();
  if (!getDbUrl()) {
    const existing = memoryBlueprints.get(id);
    const versionNumber = Math.max(0, ...Array.from(memoryBlueprintVersions.values()).filter((item) => item.blueprint_id === id).map((item) => Number(item.version || 0))) + 1;
    const versionId = makeId('bpv');
    const version = { id: versionId, blueprint_id: id, owner_user_id: owner, version: versionNumber, nodes, edges, viewport, published: false, created_at: now, created_by: owner };
    const row = {
      id,
      owner_user_id: owner,
      name,
      slug,
      enabled,
      description,
      current_version_id: versionId,
      created_at: existing?.created_at || now,
      updated_at: now
    };
    memoryBlueprints.set(id, row);
    memoryBlueprintVersions.set(versionId, version);
    return normalizeBlueprintRow(row, version);
  }
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    await pg.query('begin');
    try {
      const existing = await pg.query(`select id from action_blueprints where owner_user_id = $1 and id = $2 limit 1`, [owner, id]);
      const { rows } = await pg.query(
        `insert into action_blueprints (id, owner_user_id, name, slug, enabled, description, updated_at)
         values ($1, $2, $3, $4, $5, $6, now())
         on conflict (id)
         do update set name = excluded.name,
                       slug = excluded.slug,
                       enabled = excluded.enabled,
                       description = excluded.description,
                       updated_at = now()
         where action_blueprints.owner_user_id = excluded.owner_user_id
         returning *`,
        [id, owner, name, slug, enabled, description]
      );
      if (!rows?.[0]) throw new Error('blueprint_not_found');
      const nextVersion = await pg.query(
        `select coalesce(max(version), 0) + 1 as version from action_blueprint_versions where blueprint_id = $1`,
        [id]
      );
      const versionNumber = Number(nextVersion.rows?.[0]?.version || (existing.rowCount ? 2 : 1));
      const versionId = makeId('bpv');
      const versionResult = await pg.query(
        `insert into action_blueprint_versions
          (id, blueprint_id, owner_user_id, version, nodes, edges, viewport, published, created_by)
         values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, false, $8)
         returning *`,
        [versionId, id, owner, versionNumber, JSON.stringify(nodes), JSON.stringify(edges), JSON.stringify(viewport), owner]
      );
      const updated = await pg.query(
        `update action_blueprints set current_version_id = $2, updated_at = now()
         where owner_user_id = $1 and id = $3 returning *`,
        [owner, versionId, id]
      );
      await pg.query('commit');
      return normalizeBlueprintRow(updated.rows?.[0], versionResult.rows?.[0]);
    } catch (error) {
      try { await pg.query('rollback'); } catch {}
      throw error;
    }
  });
}

export async function publishActionBlueprint(ownerUserId, id) {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner || !id) return null;
  if (!getDbUrl()) {
    const blueprint = memoryBlueprints.get(String(id));
    if (!blueprint || blueprint.owner_user_id !== owner) return null;
    const version = blueprint.current_version_id ? memoryBlueprintVersions.get(blueprint.current_version_id) : null;
    if (version) memoryBlueprintVersions.set(version.id, { ...version, published: true });
    return normalizeBlueprintRow(blueprint, version ? { ...version, published: true } : null);
  }
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    await pg.query('begin');
    try {
      const { rows } = await pg.query(`select * from action_blueprints where owner_user_id = $1 and id = $2 limit 1`, [owner, String(id)]);
      const blueprint = rows?.[0];
      if (!blueprint?.current_version_id) throw new Error('version_not_found');
      await pg.query(`update action_blueprint_versions set published = true where owner_user_id = $1 and id = $2`, [owner, blueprint.current_version_id]);
      const version = await pg.query(`select * from action_blueprint_versions where id = $1`, [blueprint.current_version_id]);
      await pg.query('commit');
      return normalizeBlueprintRow(blueprint, version.rows?.[0]);
    } catch (error) {
      try { await pg.query('rollback'); } catch {}
      throw error;
    }
  });
}

export async function listActionBlueprintVersions(ownerUserId, blueprintId, limit = 20) {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner || !blueprintId) return [];
  if (!getDbUrl()) {
    return Array.from(memoryBlueprintVersions.values())
      .filter((version) => version.owner_user_id === owner && version.blueprint_id === String(blueprintId))
      .sort((a, b) => Number(b.version || 0) - Number(a.version || 0))
      .slice(0, Math.max(1, Math.min(100, Number(limit || 20))))
      .map(normalizeBlueprintVersionRow);
  }
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `select * from action_blueprint_versions
       where owner_user_id = $1 and blueprint_id = $2
       order by version desc
       limit $3`,
      [owner, String(blueprintId), Math.max(1, Math.min(100, Number(limit || 20)))]
    );
    return (rows || []).map(normalizeBlueprintVersionRow).filter(Boolean);
  });
}

export async function restoreActionBlueprintVersion(ownerUserId, blueprintId, versionId) {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner || !blueprintId || !versionId) return null;
  if (!getDbUrl()) {
    const blueprint = memoryBlueprints.get(String(blueprintId));
    const version = memoryBlueprintVersions.get(String(versionId));
    if (!blueprint || !version || blueprint.owner_user_id !== owner || version.owner_user_id !== owner || version.blueprint_id !== String(blueprintId)) return null;
    const now = new Date().toISOString();
    const next = { ...blueprint, current_version_id: String(versionId), updated_at: now };
    memoryBlueprints.set(String(blueprintId), next);
    return normalizeBlueprintRow(next, version);
  }
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    await pg.query('begin');
    try {
      const versionResult = await pg.query(
        `select * from action_blueprint_versions
         where owner_user_id = $1 and blueprint_id = $2 and id = $3
         limit 1`,
        [owner, String(blueprintId), String(versionId)]
      );
      const version = versionResult.rows?.[0];
      if (!version) throw new Error('version_not_found');
      const blueprintResult = await pg.query(
        `update action_blueprints
         set current_version_id = $3, updated_at = now()
         where owner_user_id = $1 and id = $2
         returning *`,
        [owner, String(blueprintId), String(versionId)]
      );
      await pg.query('commit');
      return normalizeBlueprintRow(blueprintResult.rows?.[0], version);
    } catch (error) {
      try { await pg.query('rollback'); } catch {}
      throw error;
    }
  });
}

export async function deleteActionBlueprint(ownerUserId, id) {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner || !id) return false;
  if (!getDbUrl()) {
    const blueprint = memoryBlueprints.get(String(id));
    if (!blueprint || blueprint.owner_user_id !== owner) return false;
    memoryBlueprints.delete(String(id));
    for (const [versionId, version] of memoryBlueprintVersions.entries()) {
      if (version.blueprint_id === String(id)) memoryBlueprintVersions.delete(versionId);
    }
    return true;
  }
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    const result = await pg.query(`delete from action_blueprints where owner_user_id = $1 and id = $2`, [owner, String(id)]);
    return (result.rowCount || 0) > 0;
  });
}

export async function insertActionBlueprintRun(ownerUserId, run) {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner) throw new Error('ownerUserId is required');
  const id = String(run?.id || makeId('bpr'));
  const row = {
    id,
    blueprint_id: String(run?.blueprintId || run?.blueprint_id || ''),
    version_id: run?.versionId || run?.version_id || null,
    owner_user_id: owner,
    trigger_source: String(run?.triggerSource || run?.trigger_source || 'manual'),
    trigger_ref: run?.triggerRef || run?.trigger_ref || null,
    context: normalizeJsonObject(run?.context),
    status: String(run?.status || 'running'),
    started_at: new Date().toISOString(),
    finished_at: null,
    error: null
  };
  if (!getDbUrl()) {
    memoryBlueprintRuns.set(id, row);
    return normalizeBlueprintRunRow(row);
  }
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `insert into action_blueprint_runs
        (id, blueprint_id, version_id, owner_user_id, trigger_source, trigger_ref, context, status)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       returning *`,
      [id, row.blueprint_id, row.version_id, owner, row.trigger_source, row.trigger_ref, JSON.stringify(row.context), row.status]
    );
    return normalizeBlueprintRunRow(rows?.[0]);
  });
}

export async function finishActionBlueprintRun(ownerUserId, runId, { status = 'done', error = null } = {}) {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner || !runId) return null;
  if (!getDbUrl()) {
    const row = memoryBlueprintRuns.get(String(runId));
    if (!row || row.owner_user_id !== owner) return null;
    const next = { ...row, status, error, finished_at: new Date().toISOString() };
    memoryBlueprintRuns.set(String(runId), next);
    return normalizeBlueprintRunRow(next);
  }
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `update action_blueprint_runs
       set status = $3, error = $4, finished_at = now()
       where owner_user_id = $1 and id = $2
       returning *`,
      [owner, String(runId), String(status), error ? String(error).slice(0, 1000) : null]
    );
    return normalizeBlueprintRunRow(rows?.[0]);
  });
}

export async function insertActionBlueprintRunStep(ownerUserId, step) {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner || !step?.runId) return null;
  const row = {
    id: String(step?.id || makeId('bps')),
    run_id: String(step.runId),
    node_id: String(step.nodeId || ''),
    node_type: String(step.nodeType || ''),
    status: String(step.status || 'done'),
    input: normalizeJsonObject(step.input),
    output: normalizeJsonObject(step.output),
    duration_ms: Number.isFinite(Number(step.durationMs)) ? Number(step.durationMs) : null,
    error: step.error ? String(step.error).slice(0, 1000) : null,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString()
  };
  if (!getDbUrl()) {
    memoryBlueprintRunSteps.set(row.id, row);
    return row;
  }
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `insert into action_blueprint_run_steps
        (id, run_id, node_id, node_type, status, input, output, duration_ms, error, finished_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, now())
       returning *`,
      [row.id, row.run_id, row.node_id, row.node_type, row.status, JSON.stringify(row.input), JSON.stringify(row.output), row.duration_ms, row.error]
    );
    return rows?.[0] || null;
  });
}

export async function listActionBlueprintRuns(ownerUserId, blueprintId, limit = 20) {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner) return [];
  if (!getDbUrl()) {
    return Array.from(memoryBlueprintRuns.values())
      .filter((row) => row.owner_user_id === owner && (!blueprintId || row.blueprint_id === String(blueprintId)))
      .sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')))
      .slice(0, Math.max(1, Math.min(100, Number(limit || 20))))
      .map(normalizeBlueprintRunRow);
  }
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(
      `select * from action_blueprint_runs
       where owner_user_id = $1 and ($2::text is null or blueprint_id = $2)
       order by started_at desc
       limit $3`,
      [owner, blueprintId ? String(blueprintId) : null, Math.max(1, Math.min(100, Number(limit || 20)))]
    );
    return (rows || []).map(normalizeBlueprintRunRow).filter(Boolean);
  });
}

export async function listActionBlueprintRunSteps(ownerUserId, runId) {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner || !runId) return [];
  if (!getDbUrl()) {
    const run = memoryBlueprintRuns.get(String(runId));
    if (!run || run.owner_user_id !== owner) return [];
    return Array.from(memoryBlueprintRunSteps.values())
      .filter((step) => step.run_id === String(runId))
      .sort((a, b) => String(a.started_at || '').localeCompare(String(b.started_at || '')))
      .map(normalizeBlueprintRunStepRow)
      .filter(Boolean);
  }
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    const runCheck = await pg.query(`select id from action_blueprint_runs where owner_user_id = $1 and id = $2 limit 1`, [owner, String(runId)]);
    if (!runCheck.rows?.[0]) return [];
    const { rows } = await pg.query(
      `select * from action_blueprint_run_steps
       where run_id = $1
       order by started_at asc`,
      [String(runId)]
    );
    return (rows || []).map(normalizeBlueprintRunStepRow).filter(Boolean);
  });
}

export async function getAutomationSettings(ownerUserId) {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner || !getDbUrl()) return {};
  await ensureAutomationTables();
  return withPgClient(async (pg) => {
    const { rows } = await pg.query(`select settings from automation_settings where owner_user_id = $1`, [owner]);
    return normalizeJsonObject(rows?.[0]?.settings, {});
  });
}

export async function setAutomationSettings(ownerUserId, settings) {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner) throw new Error('ownerUserId is required');
  if (!getDbUrl()) return normalizeJsonObject(settings);
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
  if (!owner || !getDbUrl()) return [];
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
  if (!tokenHash || !getDbUrl()) return null;
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
  if (!getDbUrl()) {
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
  if (!owner || !id || !getDbUrl()) return false;
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
  if (!getDbUrl()) {
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
  if (!getDbUrl()) {
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

export async function getOrCreateAutomationLocalAgent(ownerUserId, name = 'AruBot Local Program', { rotate = false } = {}) {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner) throw new Error('ownerUserId is required');
  if (!getDbUrl()) {
    return createAutomationLocalAgent(owner, name);
  }
  await ensureAutomationTables();
  if (!rotate) {
    const existing = await withPgClient(async (pg) => {
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
         order by created_at desc
         limit 1`,
        [owner]
      );
      return normalizeAutomationLocalAgent(rows?.[0]);
    });
    if (existing) {
      return { token: null, agent: existing, tokenShownOnce: false };
    }
  }
  await withPgClient(async (pg) => {
    await pg.query(
      `update automation_local_agents
       set revoked_at = now(), updated_at = now(), status = 'offline'
       where owner_user_id = $1 and revoked_at is null`,
      [owner]
    );
  });
  const result = await createAutomationLocalAgent(owner, name);
  return { ...result, tokenShownOnce: true };
}

export async function listAutomationLocalAgents(ownerUserId) {
  const owner = normalizeAutomationOwner(ownerUserId);
  if (!owner || !getDbUrl()) return [];
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
  if (!token || !getDbUrl()) return null;
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
  if (!agentId || !getDbUrl()) return null;
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
  if (!agent?.id || !agent?.ownerUserId || !getDbUrl()) return [];
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
  if (!agent?.id || !agent?.ownerUserId || !jobId || !getDbUrl()) return null;
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
    if (!error && data?.sid) return String(data.sid);
  } catch {
    // Fall through to roulette session lookup.
  }
  try {
    await ensureRouletteSessions();
    const { data, error } = await supabase
      .from('roulette_sessions')
      .select('sid')
      .eq('token', String(token))
      .order('created_at', { ascending: false })
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
  const messagesDelta = Number.isFinite(Number(delta.messagesProcessed)) ? Math.trunc(Number(delta.messagesProcessed)) : 0;
  const commandsDelta = Number.isFinite(Number(delta.commandsHandled)) ? Math.trunc(Number(delta.commandsHandled)) : 0;
  const lastActive = new Date().toISOString();
  if (getDbUrl()) {
    const result = await withPgClient((pg) => pg.query(
      `insert into bot_stats (sid, messages_processed, commands_handled, last_active)
       values ($1, $2, $3, $4)
       on conflict (sid) do update set
         messages_processed = coalesce(bot_stats.messages_processed, 0) + excluded.messages_processed,
         commands_handled = coalesce(bot_stats.commands_handled, 0) + excluded.commands_handled,
         last_active = excluded.last_active
       returning messages_processed, commands_handled, last_active`,
      [String(sid), messagesDelta, commandsDelta, lastActive]
    ));
    const row = result.rows?.[0] || {};
    return {
      messagesProcessed: Number(row.messages_processed || 0),
      commandsHandled: Number(row.commands_handled || 0),
      lastActive: row.last_active || lastActive,
    };
  }
  const current = await getBotStats(sid);
  const next = {
    messagesProcessed: (current.messagesProcessed || 0) + messagesDelta,
    commandsHandled: (current.commandsHandled || 0) + commandsDelta,
    lastActive
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
function normalizeBotRuleStringArray(value) {
  const parsed = typeof value === 'string' ? safeJsonParse(value, value) : value;
  const source = Array.isArray(parsed) ? parsed : (parsed == null || parsed === '' ? [] : [parsed]);
  return source
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
}

function normalizeBotRuleRow(row = {}, columns = {}) {
  return {
    id: row.id,
    name: row.name || '',
    keywords: normalizeBotRuleStringArray(row.keywords),
    responses: normalizeBotRuleStringArray(row.responses),
    enabled: row.enabled !== false,
    adminOnly: columns.adminOnly ? !!row.admin_only : !!row.adminOnly,
    requiredRoleLevel: columns.requiredRoleLevel ? Number(row.required_role_level || 1) : Number(row.requiredRoleLevel || 1),
    pointsCost: columns.pointsCost ? Math.max(0, Number(row.points_cost || 0)) : Math.max(0, Number(row.pointsCost || 0)),
    cooldown: columns.cooldown ? Number(row.cooldown || 1000) : Number(row.cooldown || 1000),
    lastUsed: columns.lastUsed ? Number(row.last_used || 0) : Number(row.lastUsed || 0),
  };
}

export async function getBotRules(sid) {
  ensure();
  const hasAdminOnly = await tableHasColumn('bot_rules', 'admin_only');
  const hasReq = await tableHasColumn('bot_rules', 'required_role_level');
  const hasPointsCost = await tableHasColumn('bot_rules', 'points_cost');
  const hasCooldown = await tableHasColumn('bot_rules', 'cooldown');
  const hasLastUsed = await tableHasColumn('bot_rules', 'last_used');
  const columns = {
    adminOnly: hasAdminOnly,
    requiredRoleLevel: hasReq,
    pointsCost: hasPointsCost,
    cooldown: hasCooldown,
    lastUsed: hasLastUsed,
  };
  const selectCols = ['id','name','keywords','responses','enabled']
    .concat(hasAdminOnly ? ['admin_only'] : [])
    .concat(hasReq ? ['required_role_level'] : [])
    .concat(hasPointsCost ? ['points_cost'] : [])
    .concat(hasCooldown ? ['cooldown'] : [])
    .concat(hasLastUsed ? ['last_used'] : []);
  if (getDbUrl()) {
    const result = await withPgClient((pg) => pg.query(
      `select ${selectCols.map(quoteIdent).join(', ')}
         from bot_rules
        where sid = $1
        order by id asc`,
      [String(sid)]
    ));
    return (result.rows || []).map((row) => normalizeBotRuleRow(row, columns));
  }
  const { data, error } = await supabase.from('bot_rules')
    .select(selectCols.join(', '))
    .eq('sid', sid)
    .order('id', { ascending: true });
  if (error || !Array.isArray(data)) return [];
  return data.map((row) => normalizeBotRuleRow(row, columns));
}

// =============================
// Roulette sessions (per-sid persisted results)
// =============================
export async function ensureRouletteSessionsPg() {
  // Prefer direct PG to avoid PostgREST schema cache issues
  const dbUrl = getDbUrl();
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
        result_value text,
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

      -- Roulette values may contain executable action/command tokens, not only numbers.
      -- Preserve existing numeric values losslessly while upgrading the legacy schema.
      do $$
      begin
        if exists (
          select 1
            from information_schema.columns
           where table_schema = 'public'
             and table_name = 'roulette_sessions'
             and column_name = 'result_value'
             and data_type <> 'text'
        ) then
          alter table public.roulette_sessions
            alter column result_value type text
            using result_value::text;
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

export async function listRouletteSessionsByToken(token, { q, limit = 50, offset = 0, rouletteName, userId, userIds } = {}) {
  ensure();
  await ensureRouletteSessions();
  let query = supabase.from('roulette_sessions').select('*').eq('token', token);
  const normalizedRouletteName = String(rouletteName || '').trim();
  if (normalizedRouletteName) {
    query = query.eq('roulette_name', normalizedRouletteName);
  }
  const identityFilters = Array.isArray(userIds)
    ? userIds.map((value) => String(value || '').trim()).filter(Boolean)
    : (userId ? [String(userId).trim()].filter(Boolean) : []);
  if (identityFilters.length === 1) {
    query = query.eq('user_id', identityFilters[0]);
  } else if (identityFilters.length > 1) {
    query = query.in('user_id', identityFilters.slice(0, 50));
  }
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
  const keywords = normalizeBotRuleStringArray(rule.keywords);
  const responses = normalizeBotRuleStringArray(rule.responses);
  const row = {
    sid,
    id: rule.id,
    name: rule.name || '',
    keywords,
    responses,
    enabled: !!rule.enabled,
    ...(hasAdminOnly ? { admin_only: !!rule.adminOnly } : {}),
    ...(hasReq ? { required_role_level: Math.max(1, Math.min(4, Number(rule.requiredRoleLevel || 1))) } : {}),
    ...(hasPointsCost ? { points_cost: Math.max(0, Number(rule.pointsCost || 0)) } : {}),
    ...(hasCooldown ? { cooldown: Math.max(1000, Number(rule.cooldown || 0)) } : {}),
    ...(hasLastUsed ? { last_used: Number(rule.lastUsed || 0) } : {}),
  };
  if (getDbUrl()) {
    const columns = Object.keys(row);
    const values = Object.values(row).map((value, index) =>
      normalizePgJsonColumnValue('bot_rules', columns[index], value)
    );
    const placeholders = columns.map((column, index) => {
      const placeholder = `$${index + 1}`;
      return isPgJsonColumn('bot_rules', column) ? `${placeholder}::jsonb` : placeholder;
    });
    const updateColumns = columns.filter((column) => !['sid', 'id'].includes(column));
    await withPgClient((pg) => pg.query(
      `insert into bot_rules (${columns.map(quoteIdent).join(', ')})
       values (${placeholders.join(', ')})
       on conflict (sid, id) do update set
       ${updateColumns.map((column) => `${quoteIdent(column)} = excluded.${quoteIdent(column)}`).join(', ')}`,
      values
    ));
    return;
  }
  const { error } = await supabase.from('bot_rules').upsert(row, { onConflict: 'sid,id' });
  if (error) throw error;
}

function normalizeCooldownClaimResult(row, fallback = {}) {
  const value = row || {};
  const claimedAt = Number(value.claimed_at ?? value.claimedAt ?? fallback.claimedAt ?? Date.now());
  const lastUsed = Number(value.last_used ?? value.lastUsed ?? 0);
  const cooldownMs = Math.max(0, Number(value.cooldown_ms ?? value.cooldownMs ?? fallback.cooldownMs ?? 0));
  return {
    found: value.found !== false && !!(value.rule_id ?? value.ruleId ?? fallback.ruleId),
    claimed: value.claimed === true,
    sid: String(value.sid ?? fallback.sid ?? ''),
    ruleId: String(value.rule_id ?? value.ruleId ?? fallback.ruleId ?? ''),
    claimedAt,
    lastUsed,
    cooldownMs,
    retryAfterMs: value.claimed === true ? 0 : Math.max(0, cooldownMs - (claimedAt - lastUsed)),
  };
}

export async function claimBotRuleCooldown(sid, ruleId, options = {}) {
  const normalizedSid = String(sid || '').trim();
  const normalizedRuleId = String(ruleId || '').trim();
  if (!normalizedSid || !normalizedRuleId) {
    const error = new Error('sid and ruleId are required');
    error.code = 'invalid_bot_rule_cooldown_claim';
    throw error;
  }
  const nowMs = options.nowMs == null ? null : Math.floor(Number(options.nowMs));
  if (nowMs != null && !Number.isSafeInteger(nowMs)) throw new Error('nowMs must be a safe integer');
  const cooldownMs = options.cooldownMs == null ? null : Math.max(0, Math.floor(Number(options.cooldownMs)));
  if (cooldownMs != null && !Number.isSafeInteger(cooldownMs)) throw new Error('cooldownMs must be a safe integer');

  if (!getDbUrl()) {
    ensure();
    if (typeof supabase.rpc !== 'function') throw new Error('Bot rule cooldown claim RPC is unavailable');
    const { data, error } = await supabase.rpc('arubot_claim_bot_rule_cooldown', {
      p_sid: normalizedSid,
      p_rule_id: normalizedRuleId,
      p_now_ms: nowMs,
      p_cooldown_ms: cooldownMs,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return normalizeCooldownClaimResult(row, { sid: normalizedSid, ruleId: normalizedRuleId, claimedAt: nowMs, cooldownMs });
  }

  return withPgClient(async (pg) => {
    const claimed = await pg.query(
      `with input as (
         select coalesce($3::bigint, floor(extract(epoch from clock_timestamp()) * 1000)::bigint) as claimed_at
       )
       update bot_rules as rule
          set last_used = input.claimed_at
         from input
        where rule.sid = $1
          and rule.id = $2
          and input.claimed_at - coalesce(rule.last_used, 0) >= greatest(0, coalesce($4::bigint, rule.cooldown::bigint, 0))
       returning rule.sid, rule.id as rule_id, true as found, true as claimed,
                 input.claimed_at, rule.last_used, greatest(0, coalesce($4::bigint, rule.cooldown::bigint, 0)) as cooldown_ms`,
      [normalizedSid, normalizedRuleId, nowMs, cooldownMs]
    );
    if (claimed.rows?.[0]) return normalizeCooldownClaimResult(claimed.rows[0]);

    const current = await pg.query(
      `select sid, id as rule_id, true as found, false as claimed,
              coalesce($3::bigint, floor(extract(epoch from clock_timestamp()) * 1000)::bigint) as claimed_at,
              coalesce(last_used, 0)::bigint as last_used,
              greatest(0, coalesce($4::bigint, cooldown::bigint, 0)) as cooldown_ms
         from bot_rules
        where sid = $1 and id = $2
        limit 1`,
      [normalizedSid, normalizedRuleId, nowMs, cooldownMs]
    );
    if (current.rows?.[0]) return normalizeCooldownClaimResult(current.rows[0]);
    return normalizeCooldownClaimResult({ found: false, claimed: false }, {
      sid: normalizedSid,
      ruleId: normalizedRuleId,
      claimedAt: nowMs ?? Date.now(),
      cooldownMs: cooldownMs ?? 0,
    });
  });
}

export async function deleteBotRule(sid, id) {
  ensure();
  const { error } = await supabase.from('bot_rules').delete().eq('sid', sid).eq('id', id);
  if (error) throw error;
}

let durableRuntimeJobsReady = false;

async function ensureDurableRuntimeJobsWithClient(pg) {
  if (durableRuntimeJobsReady) return;
  await pg.query(`
    create table if not exists durable_runtime_jobs (
      id text primary key,
      sid text not null,
      job_type text not null,
      idempotency_key text not null,
      status text not null default 'queued',
      channel_uid text,
      user_id text,
      username text,
      points_cost bigint not null default 0,
      payload jsonb not null default '{}'::jsonb,
      result jsonb,
      attempt_count integer not null default 0,
      max_attempts integer not null default 5,
      available_at timestamptz not null default now(),
      locked_by text,
      locked_at timestamptz,
      last_error text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      completed_at timestamptz,
      constraint durable_runtime_jobs_status_ck check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
      constraint durable_runtime_jobs_points_cost_ck check (points_cost >= 0),
      constraint durable_runtime_jobs_attempts_ck check (attempt_count >= 0 and max_attempts > 0),
      constraint durable_runtime_jobs_job_type_ck check (job_type ~ '^[a-z0-9][a-z0-9._:-]{0,63}$'),
      constraint durable_runtime_jobs_idempotency_uniq unique (sid, job_type, idempotency_key)
    );
    create index if not exists idx_durable_runtime_jobs_claim
      on durable_runtime_jobs (status, available_at, created_at)
      where status in ('queued', 'processing');
    create index if not exists idx_durable_runtime_jobs_sid_created
      on durable_runtime_jobs (sid, created_at desc);
  `);
  durableRuntimeJobsReady = true;
}

function normalizeDurableRuntimeJobInput(input = {}) {
  const sid = String(input.sid || '').trim();
  const jobType = String(input.jobType || input.job_type || '').trim().toLowerCase();
  const idempotencyKey = String(input.idempotencyKey || input.idempotency_key || '').trim();
  if (!sid || !/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(jobType) || !idempotencyKey) {
    const error = new Error('sid, a valid jobType, and idempotencyKey are required');
    error.code = 'invalid_durable_runtime_job';
    throw error;
  }
  const pointsCost = Math.floor(Number(input.pointsCost ?? input.points_cost ?? 0));
  const maxAttempts = Math.floor(Number(input.maxAttempts ?? input.max_attempts ?? 5));
  if (!Number.isSafeInteger(pointsCost) || pointsCost < 0) throw new Error('pointsCost must be a non-negative safe integer');
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) throw new Error('maxAttempts must be between 1 and 100');
  const availableAtValue = input.availableAt ?? input.available_at ?? new Date();
  const availableAt = new Date(availableAtValue);
  if (!Number.isFinite(availableAt.getTime())) throw new Error('availableAt must be a valid date');
  const payload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload) ? input.payload : {};
  return {
    id: String(input.id || crypto.randomUUID()),
    sid,
    jobType,
    idempotencyKey: idempotencyKey.slice(0, 256),
    channelUid: input.channelUid ?? input.channel_uid ?? null,
    userId: input.userId ?? input.user_id ?? null,
    username: input.username ?? null,
    pointsCost,
    payload,
    maxAttempts,
    availableAt: availableAt.toISOString(),
  };
}

function durableRuntimeJobRow(input) {
  const job = normalizeDurableRuntimeJobInput(input);
  return {
    id: job.id,
    sid: job.sid,
    job_type: job.jobType,
    idempotency_key: job.idempotencyKey,
    status: 'queued',
    channel_uid: job.channelUid ? String(job.channelUid) : null,
    user_id: job.userId ? String(job.userId) : null,
    username: job.username ? String(job.username) : null,
    points_cost: job.pointsCost,
    payload: job.payload,
    max_attempts: job.maxAttempts,
    available_at: job.availableAt,
  };
}

function normalizeDurableRuntimeJob(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    sid: String(row.sid),
    jobType: String(row.job_type ?? row.jobType),
    idempotencyKey: String(row.idempotency_key ?? row.idempotencyKey),
    status: String(row.status),
    channelUid: row.channel_uid ?? row.channelUid ?? null,
    userId: row.user_id ?? row.userId ?? null,
    username: row.username ?? null,
    pointsCost: Number(row.points_cost ?? row.pointsCost ?? 0),
    payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
    result: row.result && typeof row.result === 'object' ? row.result : null,
    attemptCount: Number(row.attempt_count ?? row.attemptCount ?? 0),
    maxAttempts: Number(row.max_attempts ?? row.maxAttempts ?? 0),
    availableAt: row.available_at ?? row.availableAt ?? null,
    lockedBy: row.locked_by ?? row.lockedBy ?? null,
    lockedAt: row.locked_at ?? row.lockedAt ?? null,
    lastError: row.last_error ?? row.lastError ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    completedAt: row.completed_at ?? row.completedAt ?? null,
  };
}

async function insertDurableRuntimeJobWithClient(pg, row) {
  const inserted = await pg.query(
    `insert into durable_runtime_jobs
      (id, sid, job_type, idempotency_key, status, channel_uid, user_id, username,
       points_cost, payload, max_attempts, available_at)
     values ($1, $2, $3, $4, 'queued', $5, $6, $7, $8, $9::jsonb, $10, $11)
     on conflict (sid, job_type, idempotency_key) do nothing
     returning *`,
    [row.id, row.sid, row.job_type, row.idempotency_key, row.channel_uid, row.user_id,
      row.username, row.points_cost, JSON.stringify(row.payload || {}), row.max_attempts, row.available_at]
  );
  if (inserted.rows?.[0]) return { created: true, job: normalizeDurableRuntimeJob(inserted.rows[0]) };
  const existing = await pg.query(
    `select * from durable_runtime_jobs where sid = $1 and job_type = $2 and idempotency_key = $3 limit 1`,
    [row.sid, row.job_type, row.idempotency_key]
  );
  return { created: false, job: normalizeDurableRuntimeJob(existing.rows?.[0]) };
}

export async function enqueueDurableRuntimeJob(input) {
  const row = durableRuntimeJobRow(input);
  if (getDbUrl()) {
    return withPgClient(async (pg) => {
      await ensureDurableRuntimeJobsWithClient(pg);
      return insertDurableRuntimeJobWithClient(pg, row);
    });
  }

  ensure();
  const { data, error } = await supabase.from('durable_runtime_jobs').insert(row).select('*').maybeSingle();
  if (!error) return { created: true, job: normalizeDurableRuntimeJob(data) };
  if (error.code !== '23505' && !String(error.message || '').toLowerCase().includes('duplicate')) throw error;
  const existing = await supabase.from('durable_runtime_jobs')
    .select('*')
    .eq('sid', row.sid)
    .eq('job_type', row.job_type)
    .eq('idempotency_key', row.idempotency_key)
    .maybeSingle();
  if (existing.error) throw existing.error;
  return { created: false, job: normalizeDurableRuntimeJob(existing.data) };
}

export async function enqueuePaidDurableRuntimeJob(input) {
  const row = durableRuntimeJobRow(input);
  if (row.points_cost > 0 && (!row.channel_uid || !row.user_id)) {
    const error = new Error('channelUid and userId are required for a paid durable job');
    error.code = 'invalid_paid_durable_runtime_job';
    throw error;
  }

  if (!getDbUrl()) {
    ensure();
    if (typeof supabase.rpc !== 'function') throw new Error('Paid durable job RPC is unavailable');
    const { data, error } = await supabase.rpc('arubot_enqueue_paid_durable_runtime_job', {
      p_id: row.id,
      p_sid: row.sid,
      p_job_type: row.job_type,
      p_idempotency_key: row.idempotency_key,
      p_channel_uid: row.channel_uid,
      p_user_id: row.user_id,
      p_username: row.username,
      p_points_cost: row.points_cost,
      p_payload: row.payload,
      p_max_attempts: row.max_attempts,
      p_available_at: row.available_at,
    });
    if (error) throw error;
    const value = Array.isArray(data) ? data[0] : data;
    return {
      created: value?.created === true,
      job: normalizeDurableRuntimeJob(value?.job ?? value),
      deduction: value?.deducted == null ? null : normalizePointDeductionResult(value, {
        streamerUid: row.channel_uid,
        userId: row.user_id,
        amount: row.points_cost,
      }),
    };
  }

  return withPgClient(async (pg) => {
    await ensureDurableRuntimeJobsWithClient(pg);
    await pg.query('begin');
    try {
      await pg.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `durable-job:${row.sid}:${row.job_type}:${row.idempotency_key}`,
      ]);
      const existing = await pg.query(
        `select * from durable_runtime_jobs where sid = $1 and job_type = $2 and idempotency_key = $3 limit 1`,
        [row.sid, row.job_type, row.idempotency_key]
      );
      if (existing.rows?.[0]) {
        await pg.query('commit');
        return { created: false, job: normalizeDurableRuntimeJob(existing.rows[0]), deduction: null };
      }

      let deduction = null;
      if (row.points_cost > 0) {
        deduction = await deductChannelPointsIfEnoughWithClient(
          pg,
          row.channel_uid,
          row.user_id,
          row.username,
          row.points_cost
        );
        if (!deduction.deducted) {
          await pg.query('rollback');
          return { created: false, job: null, deduction };
        }
      }

      const inserted = await insertDurableRuntimeJobWithClient(pg, row);
      await pg.query('commit');
      return { ...inserted, deduction };
    } catch (error) {
      try { await pg.query('rollback'); } catch {}
      throw error;
    }
  });
}

export async function claimDurableRuntimeJobs(options = {}) {
  const workerId = String(options.workerId || '').trim();
  if (!workerId) throw new Error('workerId is required');
  const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit || 10))));
  const leaseMs = Math.max(1000, Math.min(60 * 60 * 1000, Math.floor(Number(options.leaseMs || 60_000))));
  const jobTypes = uniqueNonEmpty(options.jobTypes || []).map((value) => value.toLowerCase()).slice(0, 32);

  if (!getDbUrl()) {
    ensure();
    if (typeof supabase.rpc !== 'function') throw new Error('Durable job claim RPC is unavailable');
    const { data, error } = await supabase.rpc('arubot_claim_durable_runtime_jobs', {
      p_worker_id: workerId,
      p_limit: limit,
      p_lease_ms: leaseMs,
      p_job_types: jobTypes.length ? jobTypes : null,
    });
    if (error) throw error;
    return (Array.isArray(data) ? data : []).map(normalizeDurableRuntimeJob);
  }

  return withPgClient(async (pg) => {
    await ensureDurableRuntimeJobsWithClient(pg);
    await pg.query(
      `update durable_runtime_jobs
          set status = 'failed', last_error = coalesce(last_error, 'max_attempts_exhausted'),
              completed_at = coalesce(completed_at, now()), updated_at = now(), locked_by = null, locked_at = null
        where attempt_count >= max_attempts
          and (
            status = 'queued'
            or (status = 'processing' and locked_at < now() - ($1::bigint * interval '1 millisecond'))
          )`,
      [leaseMs]
    );
    const result = await pg.query(
      `with candidates as (
         select id
           from durable_runtime_jobs
          where attempt_count < max_attempts
            and ($4::text[] is null or job_type = any($4::text[]))
            and (
              (status = 'queued' and available_at <= now())
              or (status = 'processing' and locked_at < now() - ($3::bigint * interval '1 millisecond'))
            )
          order by available_at asc, created_at asc
          for update skip locked
          limit $2
       )
       update durable_runtime_jobs as job
          set status = 'processing', locked_by = $1, locked_at = now(),
              attempt_count = job.attempt_count + 1, updated_at = now()
         from candidates
        where job.id = candidates.id
       returning job.*`,
      [workerId, limit, leaseMs, jobTypes.length ? jobTypes : null]
    );
    return (result.rows || []).map(normalizeDurableRuntimeJob);
  });
}

export async function completeDurableRuntimeJob(jobId, workerId, result = {}) {
  const id = String(jobId || '').trim();
  const owner = String(workerId || '').trim();
  if (!id || !owner) throw new Error('jobId and workerId are required');
  const payload = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  if (getDbUrl()) {
    return withPgClient(async (pg) => {
      await ensureDurableRuntimeJobsWithClient(pg);
      const updated = await pg.query(
        `update durable_runtime_jobs
            set status = 'completed', result = $3::jsonb, completed_at = now(), updated_at = now(),
                locked_by = null, locked_at = null, last_error = null
          where id = $1 and status = 'processing' and locked_by = $2
        returning *`,
        [id, owner, JSON.stringify(payload)]
      );
      return normalizeDurableRuntimeJob(updated.rows?.[0]);
    });
  }
  ensure();
  const updated = await supabase.from('durable_runtime_jobs')
    .update({ status: 'completed', result: payload, completed_at: new Date().toISOString(), updated_at: new Date().toISOString(), locked_by: null, locked_at: null, last_error: null })
    .eq('id', id).eq('status', 'processing').eq('locked_by', owner).select('*').maybeSingle();
  if (updated.error) throw updated.error;
  return normalizeDurableRuntimeJob(updated.data);
}

export async function failDurableRuntimeJob(jobId, workerId, errorMessage, options = {}) {
  const id = String(jobId || '').trim();
  const owner = String(workerId || '').trim();
  if (!id || !owner) throw new Error('jobId and workerId are required');
  const message = String(errorMessage || 'durable_runtime_job_failed').slice(0, 2000);
  const retryAt = new Date(options.retryAt || Date.now() + Math.max(1000, Number(options.retryDelayMs || 5000)));
  if (!Number.isFinite(retryAt.getTime())) throw new Error('retryAt must be a valid date');
  const terminal = options.terminal === true;

  if (getDbUrl()) {
    return withPgClient(async (pg) => {
      await ensureDurableRuntimeJobsWithClient(pg);
      const updated = await pg.query(
        `update durable_runtime_jobs
            set status = case when $4::boolean or attempt_count >= max_attempts then 'failed' else 'queued' end,
                available_at = case when $4::boolean or attempt_count >= max_attempts then available_at else $3::timestamptz end,
                completed_at = case when $4::boolean or attempt_count >= max_attempts then coalesce(completed_at, now()) else null end,
                last_error = $5, updated_at = now(), locked_by = null, locked_at = null
          where id = $1 and status = 'processing' and locked_by = $2
        returning *`,
        [id, owner, retryAt.toISOString(), terminal, message]
      );
      return normalizeDurableRuntimeJob(updated.rows?.[0]);
    });
  }
  ensure();
  if (typeof supabase.rpc !== 'function') throw new Error('Durable job failure RPC is unavailable');
  const response = await supabase.rpc('arubot_fail_durable_runtime_job', {
    p_job_id: id,
    p_worker_id: owner,
    p_error: message,
    p_retry_at: retryAt.toISOString(),
    p_terminal: terminal,
  });
  if (response.error) throw response.error;
  return normalizeDurableRuntimeJob(Array.isArray(response.data) ? response.data[0] : response.data);
}

export async function getDurableRuntimeJob(jobId) {
  const id = String(jobId || '').trim();
  if (!id) return null;
  if (getDbUrl()) {
    return withPgClient(async (pg) => {
      await ensureDurableRuntimeJobsWithClient(pg);
      const result = await pg.query('select * from durable_runtime_jobs where id = $1 limit 1', [id]);
      return normalizeDurableRuntimeJob(result.rows?.[0]);
    });
  }
  ensure();
  const response = await supabase.from('durable_runtime_jobs').select('*').eq('id', id).maybeSingle();
  if (response.error) throw response.error;
  return normalizeDurableRuntimeJob(response.data);
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
